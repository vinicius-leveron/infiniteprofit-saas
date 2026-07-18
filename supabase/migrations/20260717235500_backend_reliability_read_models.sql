-- Bounded operational read models, history retention, and table-specific
-- maintenance settings. Dashboard metrics and formulas are intentionally
-- untouched.

set lock_timeout = '5s';

alter table public.raw_events set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_threshold = 500
);

alter table public.sync_runs set (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_threshold = 500
);

reset lock_timeout;

create or replace function public.enqueue_sync_jobs(_jobs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  item jsonb;
  existing public.sync_jobs%rowtype;
  result jsonb := '[]'::jsonb;
  result_status text;
  result_id uuid;
  requeue_after_minutes integer;
  revive_dead_letter boolean;
begin
  if pg_catalog.jsonb_typeof(_jobs) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Sync jobs payload must be a JSON array';
  end if;

  if pg_catalog.jsonb_array_length(_jobs) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Sync jobs batch exceeds 1000 items';
  end if;

  for item in
    select value from pg_catalog.jsonb_array_elements(_jobs)
  loop
    existing := null;
    result_id := null;
    requeue_after_minutes :=
      nullif(item ->> 'requeue_succeeded_after_minutes', '')::integer;
    revive_dead_letter :=
      coalesce((item ->> 'revive_dead_letter')::boolean, false);

    select job.*
      into existing
    from public.sync_jobs job
    where job.dedupe_key = item ->> 'dedupe_key'
    for update;

    if existing.id is null then
      insert into public.sync_jobs (
        workspace_id,
        project_id,
        source,
        entity_type,
        entity_id,
        date_start,
        date_end,
        priority,
        status,
        attempt_count,
        max_attempts,
        available_at,
        locked_at,
        locked_by,
        dedupe_key,
        payload,
        last_error,
        finished_at
      )
      values (
        (item ->> 'workspace_id')::uuid,
        (item ->> 'project_id')::uuid,
        item ->> 'source',
        item ->> 'entity_type',
        nullif(item ->> 'entity_id', ''),
        (item ->> 'date_start')::date,
        (item ->> 'date_end')::date,
        greatest(coalesce((item ->> 'priority')::integer, 100), 0),
        'queued',
        0,
        greatest(coalesce((item ->> 'max_attempts')::integer, 5), 1),
        coalesce((item ->> 'available_at')::timestamptz, pg_catalog.now()),
        null,
        null,
        item ->> 'dedupe_key',
        coalesce(item -> 'payload', '{}'::jsonb),
        null,
        null
      )
      on conflict (dedupe_key) do nothing
      returning id into result_id;

      if result_id is not null then
        result_status := 'inserted';
      else
        select job.*
          into existing
        from public.sync_jobs job
        where job.dedupe_key = item ->> 'dedupe_key'
        for update;
      end if;
    end if;

    if result_id is null then
      result_id := existing.id;

      if existing.status = 'running'
        or (
          existing.status = 'succeeded'
          and (
            requeue_after_minutes is null
            or (
              requeue_after_minutes > 0
              and existing.finished_at is not null
              and existing.finished_at >=
                pg_catalog.now()
                - pg_catalog.make_interval(mins => requeue_after_minutes)
            )
          )
        )
        or (
          existing.status = 'dead_letter'
          and not revive_dead_letter
        ) then
        result_status := 'skipped';
      else
        update public.sync_jobs job
        set
          workspace_id = (item ->> 'workspace_id')::uuid,
          project_id = (item ->> 'project_id')::uuid,
          source = item ->> 'source',
          entity_type = item ->> 'entity_type',
          entity_id = nullif(item ->> 'entity_id', ''),
          date_start = (item ->> 'date_start')::date,
          date_end = (item ->> 'date_end')::date,
          priority =
            greatest(coalesce((item ->> 'priority')::integer, 100), 0),
          status = 'queued',
          attempt_count = 0,
          max_attempts =
            greatest(coalesce((item ->> 'max_attempts')::integer, 5), 1),
          available_at =
            coalesce(
              (item ->> 'available_at')::timestamptz,
              pg_catalog.now()
            ),
          locked_at = null,
          locked_by = null,
          payload = coalesce(item -> 'payload', '{}'::jsonb),
          last_error = null,
          finished_at = null
        where job.id = existing.id;
        result_status := 'updated';
      end if;
    end if;

    result := result || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'dedupe_key', item ->> 'dedupe_key',
        'status', result_status,
        'job_id', result_id,
        'existing_status', existing.status
      )
    );
  end loop;

  return result;
end;
$$;

revoke all on function public.enqueue_sync_jobs(jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_sync_jobs(jsonb)
  to service_role;

create or replace function public.list_source_health_signals(
  _workspace_id uuid default null
)
returns table (
  workspace_id uuid,
  project_id uuid,
  project_name text,
  source text,
  configured boolean,
  last_success_at timestamptz,
  last_event_at timestamptz,
  last_error_at timestamptz,
  sync_status text,
  warning_count bigint,
  critical_count bigint
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  with accessible_projects as (
    select
      project.id,
      project.workspace_id,
      project.name
    from public.projects project
    where (_workspace_id is null or project.workspace_id = _workspace_id)
      and app_private.is_workspace_member(project.workspace_id)
  ),
  project_sources as (
    select project.*, source.name as source
    from accessible_projects project
    cross join (
      values ('meta'::text), ('vturb'::text), ('gateway'::text), ('creative'::text)
    ) source(name)
  )
  select
    project.workspace_id,
    project.id as project_id,
    project.name as project_name,
    project.source,
    case project.source
      when 'meta' then exists (
        select 1
        from public.project_meta_accounts binding
        where binding.project_id = project.id
      )
      when 'vturb' then exists (
        select 1
        from public.project_vturb_players binding
        where binding.project_id = project.id
      )
      when 'gateway' then exists (
        select 1
        from public.project_checkout_bindings binding
        where binding.project_id = project.id
          and binding.enabled
      )
      when 'creative' then exists (
        select 1
        from public.creative_assets asset
        where asset.project_id = project.id
      )
      else false
    end as configured,
    successful_run.last_success_at,
    source_event.last_event_at,
    failed_run.last_error_at,
    latest_run.sync_status,
    coalesce(source_alerts.warning_count, 0)::bigint,
    coalesce(source_alerts.critical_count, 0)::bigint
  from project_sources project
  left join lateral (
    select run.status::text as sync_status
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
    order by run.created_at desc
    limit 1
  ) latest_run on true
  left join lateral (
    select coalesce(run.finished_at, run.created_at) as last_success_at
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
      and run.status::text = 'succeeded'
    order by run.created_at desc
    limit 1
  ) successful_run on true
  left join lateral (
    select run.created_at as last_error_at
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
      and run.status::text = 'failed'
    order by run.created_at desc
    limit 1
  ) failed_run on true
  left join lateral (
    select event.received_at as last_event_at
    from public.raw_events event
    where event.project_id = project.id
      and event.source::text = project.source
    order by event.received_at desc
    limit 1
  ) source_event on true
  left join lateral (
    select
      count(*) filter (where alert.severity = 'warning') as warning_count,
      count(*) filter (where alert.severity = 'critical') as critical_count
    from public.operational_alerts alert
    where alert.project_id = project.id
      and alert.source = project.source
      and alert.status = 'active'
  ) source_alerts on true
  order by project.name, project.source;
$$;

revoke all on function public.list_source_health_signals(uuid)
  from public, anon;
grant execute on function public.list_source_health_signals(uuid)
  to authenticated, service_role;

create or replace function public.list_client_operational_summaries(
  _organization_id uuid
)
returns table (
  workspace_id uuid,
  workspace_name text,
  organization_id uuid,
  funnel_count bigint,
  health_status text,
  action_funnels bigint,
  syncing_funnels bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if not (
    app_private.is_org_member(_organization_id)
    or app_private.has_workspace_in_organization(_organization_id)
  ) then
    raise exception using
      errcode = '42501',
      message = 'Organization access denied';
  end if;

  return query
  with accessible_clients as (
    select
      workspace.id,
      workspace.name,
      workspace.organization_id,
      workspace.updated_at
    from public.workspaces workspace
    where workspace.organization_id = _organization_id
      and app_private.is_workspace_member(workspace.id)
  ),
  accessible_projects as (
    select
      project.id,
      project.workspace_id,
      project.updated_at
    from public.projects project
    join accessible_clients client on client.id = project.workspace_id
  ),
  signals as (
    select signal.*
    from public.list_source_health_signals(null) signal
    join accessible_projects project on project.id = signal.project_id
  ),
  classified_sources as (
    select
      signal.workspace_id,
      signal.project_id,
      greatest(signal.last_success_at, signal.last_event_at) as last_activity_at,
      case
        when not signal.configured then 0
        when signal.sync_status in ('queued', 'running') then 2
        when signal.critical_count > 0
          or (
            signal.last_error_at is not null
            and (
              signal.last_success_at is null
              or signal.last_error_at > signal.last_success_at
            )
          ) then 4
        when signal.warning_count > 0
          or greatest(signal.last_success_at, signal.last_event_at) is null
          or greatest(signal.last_success_at, signal.last_event_at)
            < pg_catalog.now() - interval '48 hours' then 3
        else 1
      end as health_weight
    from signals signal
  ),
  project_health as (
    select
      project.workspace_id,
      project.id as project_id,
      max(coalesce(source.health_weight, 0)) as health_weight,
      max(source.last_activity_at) as last_activity_at
    from accessible_projects project
    left join classified_sources source on source.project_id = project.id
    group by project.workspace_id, project.id
  ),
  client_health as (
    select
      project.workspace_id,
      count(*)::bigint as funnel_count,
      max(project.health_weight) as health_weight,
      count(*) filter (where project.health_weight >= 3)::bigint as action_funnels,
      count(*) filter (where project.health_weight = 2)::bigint as syncing_funnels,
      max(greatest(project.last_activity_at, source_project.updated_at)) as last_activity_at
    from project_health project
    join accessible_projects source_project on source_project.id = project.project_id
    group by project.workspace_id
  )
  select
    client.id as workspace_id,
    client.name as workspace_name,
    client.organization_id,
    coalesce(health.funnel_count, 0)::bigint,
    case
      when coalesce(health.funnel_count, 0) = 0 then 'not_configured'
      when health.health_weight >= 4 then 'error'
      when health.health_weight = 3 then 'warning'
      when health.health_weight = 2 then 'syncing'
      when health.health_weight = 1 then 'healthy'
      else 'not_configured'
    end::text as health_status,
    coalesce(health.action_funnels, 0)::bigint,
    coalesce(health.syncing_funnels, 0)::bigint,
    greatest(client.updated_at, health.last_activity_at) as last_activity_at
  from accessible_clients client
  left join client_health health on health.workspace_id = client.id
  order by client.name;
end;
$$;

revoke all on function public.list_client_operational_summaries(uuid)
  from public, anon;
grant execute on function public.list_client_operational_summaries(uuid)
  to authenticated, service_role;

create or replace function public.list_funnel_event_coverage(
  _project_id uuid
)
returns table (
  source text,
  event_type text,
  event_count bigint,
  last_event_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  selected_workspace_id uuid;
begin
  select project.workspace_id
    into selected_workspace_id
  from public.projects project
  where project.id = _project_id;

  if selected_workspace_id is null
    or not app_private.is_workspace_member(selected_workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'Project access denied';
  end if;

  return query
  select
    event.source::text,
    event.event_type,
    count(*)::bigint,
    max(event.received_at)
  from public.raw_events event
  where event.project_id = _project_id
  group by event.source::text, event.event_type
  order by event.source::text, event.event_type;
end;
$$;

revoke all on function public.list_funnel_event_coverage(uuid)
  from public, anon;
grant execute on function public.list_funnel_event_coverage(uuid)
  to authenticated, service_role;

create or replace function public.get_watchdog_project_signal(
  _project_id uuid,
  _date_start date,
  _date_end date
)
returns table (
  raw_dates date[],
  latest_gateway_event_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  select
    coalesce(
      array_agg(distinct event.event_date order by event.event_date),
      array[]::date[]
    ) as raw_dates,
    max(event.received_at)
      filter (where event.source::text = 'gateway') as latest_gateway_event_at
  from public.raw_events event
  where event.project_id = _project_id
    and event.event_date between _date_start and _date_end;
$$;

revoke all on function public.get_watchdog_project_signal(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_watchdog_project_signal(uuid, date, date)
  to service_role;

create or replace function public.list_watchdog_project_statuses(
  _project_ids uuid[],
  _date_start date,
  _date_end date
)
returns table (
  project_id uuid,
  raw_dates date[],
  daily_dates date[],
  latest_gateway_event_at timestamptz,
  meta_accounts bigint,
  vturb_players bigint,
  has_vturb_key boolean,
  checkout_enabled boolean,
  latest_meta_sync_at timestamptz,
  latest_vturb_sync_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with selected_projects as (
    select project.id, project.workspace_id
    from public.projects project
    where project.id = any(coalesce(_project_ids, array[]::uuid[]))
      and project.workspace_id is not null
  ),
  raw_date_summary as (
    select
      event.project_id,
      array_agg(distinct event.event_date order by event.event_date)
        as raw_dates
    from public.raw_events event
    join selected_projects project on project.id = event.project_id
    where event.event_date between _date_start and _date_end
    group by event.project_id
  ),
  gateway_event_summary as (
    select
      project.id as project_id,
      gateway_event.received_at as latest_gateway_event_at
    from selected_projects project
    left join lateral (
      select event.received_at
      from public.raw_events event
      where event.project_id = project.id
        and event.source::text = 'gateway'
      order by event.received_at desc
      limit 1
    ) gateway_event on true
  ),
  daily_summary as (
    select
      metric.project_id,
      array_agg(distinct metric.event_date order by metric.event_date)
        as daily_dates
    from public.daily_metrics metric
    join selected_projects project on project.id = metric.project_id
    where metric.event_date between _date_start and _date_end
    group by metric.project_id
  ),
  meta_summary as (
    select binding.project_id, count(*)::bigint as meta_accounts
    from public.project_meta_accounts binding
    join selected_projects project on project.id = binding.project_id
    group by binding.project_id
  ),
  vturb_summary as (
    select binding.project_id, count(*)::bigint as vturb_players
    from public.project_vturb_players binding
    join selected_projects project on project.id = binding.project_id
    group by binding.project_id
  ),
  checkout_summary as (
    select binding.project_id, bool_or(binding.enabled) as checkout_enabled
    from public.project_checkout_bindings binding
    join selected_projects project on project.id = binding.project_id
    group by binding.project_id
  ),
  latest_sync as (
    select distinct on (run.project_id, run.source)
      run.project_id,
      run.source::text as source,
      coalesce(run.finished_at, run.started_at, run.created_at)
        as activity_at
    from public.sync_runs run
    join selected_projects project on project.id = run.project_id
    where run.source::text in ('meta', 'vturb')
    order by run.project_id, run.source, run.created_at desc
  ),
  sync_summary as (
    select
      run.project_id,
      max(run.activity_at) filter (where run.source = 'meta')
        as latest_meta_sync_at,
      max(run.activity_at) filter (where run.source = 'vturb')
        as latest_vturb_sync_at
    from latest_sync run
    group by run.project_id
  )
  select
    project.id as project_id,
    coalesce(raw_event.raw_dates, array[]::date[]) as raw_dates,
    coalesce(daily.daily_dates, array[]::date[]) as daily_dates,
    coalesce(
      gateway_event.latest_gateway_event_at,
      integration.gateway_last_event_at
    ) as latest_gateway_event_at,
    coalesce(meta.meta_accounts, 0)::bigint as meta_accounts,
    coalesce(vturb.vturb_players, 0)::bigint as vturb_players,
    coalesce(
      pg_catalog.length(pg_catalog.btrim(integration.vturb_api_key)) > 0,
      false
    ) as has_vturb_key,
    coalesce(checkout.checkout_enabled, false) as checkout_enabled,
    sync.latest_meta_sync_at,
    sync.latest_vturb_sync_at
  from selected_projects project
  left join raw_date_summary raw_event on raw_event.project_id = project.id
  left join gateway_event_summary gateway_event
    on gateway_event.project_id = project.id
  left join daily_summary daily on daily.project_id = project.id
  left join meta_summary meta on meta.project_id = project.id
  left join vturb_summary vturb on vturb.project_id = project.id
  left join checkout_summary checkout on checkout.project_id = project.id
  left join public.workspace_integrations integration
    on integration.workspace_id = project.workspace_id
  left join sync_summary sync on sync.project_id = project.id;
$$;

revoke all on function public.list_watchdog_project_statuses(uuid[], date, date)
  from public, anon, authenticated;
grant execute on function public.list_watchdog_project_statuses(uuid[], date, date)
  to service_role;

create or replace function app_private.prune_operational_history(
  _batch_size integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  bounded_batch integer := least(greatest(coalesce(_batch_size, 5000), 100), 20000);
  deleted_sync_jobs integer := 0;
  deleted_sync_runs integer := 0;
  deleted_alerts integer := 0;
begin
  with candidates as (
    select job.id
    from public.sync_jobs job
    where (
      (job.status = 'succeeded' and job.finished_at < pg_catalog.now() - interval '7 days')
      or (job.status = 'failed' and job.finished_at < pg_catalog.now() - interval '30 days')
      or (job.status = 'dead_letter' and job.finished_at < pg_catalog.now() - interval '90 days')
    )
    order by job.finished_at
    limit bounded_batch
  )
  delete from public.sync_jobs job
  using candidates
  where job.id = candidates.id;
  get diagnostics deleted_sync_jobs = row_count;

  with candidates as (
    select run.id
    from public.sync_runs run
    where (
      (run.status::text = 'succeeded' and run.created_at < pg_catalog.now() - interval '30 days')
      or (run.status::text = 'failed' and run.created_at < pg_catalog.now() - interval '90 days')
    )
    order by run.created_at
    limit bounded_batch
  )
  delete from public.sync_runs run
  using candidates
  where run.id = candidates.id;
  get diagnostics deleted_sync_runs = row_count;

  with candidates as (
    select alert.id
    from public.operational_alerts alert
    where alert.status <> 'active'
      and alert.last_seen_at < pg_catalog.now() - interval '90 days'
    order by alert.last_seen_at
    limit bounded_batch
  )
  delete from public.operational_alerts alert
  using candidates
  where alert.id = candidates.id;
  get diagnostics deleted_alerts = row_count;

  return pg_catalog.jsonb_build_object(
    'sync_jobs', deleted_sync_jobs,
    'sync_runs', deleted_sync_runs,
    'operational_alerts', deleted_alerts,
    'pruned_at', pg_catalog.now()
  );
end;
$$;

revoke all on function app_private.prune_operational_history(integer)
  from public, anon, authenticated;
grant execute on function app_private.prune_operational_history(integer)
  to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select job.jobid
    into existing_job_id
  from cron.job job
  where job.jobname = 'prune-operational-history'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'prune-operational-history',
    '43 4 * * *',
    'select app_private.prune_operational_history(5000);'
  );
end;
$$;

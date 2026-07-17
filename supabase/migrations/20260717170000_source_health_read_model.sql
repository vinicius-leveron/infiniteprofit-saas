-- Authorized per-funnel source health signals. The model intentionally derives
-- timestamps from each project, never from workspace-level integration fields.

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
    select
      run.status::text as sync_status
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
    order by run.created_at desc
    limit 1
  ) latest_run on true
  left join lateral (
    select
      max(coalesce(run.finished_at, run.created_at)) as last_success_at
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
      and run.status::text = 'succeeded'
  ) successful_run on true
  left join lateral (
    select
      max(run.created_at) as last_error_at
    from public.sync_runs run
    where run.project_id = project.id
      and run.source::text = project.source
      and run.status::text = 'failed'
  ) failed_run on true
  left join lateral (
    select
      max(event.received_at) as last_event_at
    from public.raw_events event
    where event.project_id = project.id
      and event.source::text = project.source
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

revoke all on function public.list_source_health_signals(uuid) from public, anon;
grant execute on function public.list_source_health_signals(uuid)
  to authenticated, service_role;

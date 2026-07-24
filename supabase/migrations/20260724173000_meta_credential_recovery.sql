-- Treat Meta as one client-level credential. Provider authentication failures
-- suspend Meta/creative work until an administrator atomically replaces the
-- credential for every account in the client.

set lock_timeout = '5s';

alter table public.workspace_integrations
  add column if not exists meta_sync_suspended_at timestamptz,
  add column if not exists meta_sync_suspension_reason text,
  add column if not exists meta_validated_at timestamptz,
  add column if not exists meta_credential_updated_at timestamptz;

alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_meta_suspension_reason_length;

alter table public.workspace_integrations
  add constraint workspace_integrations_meta_suspension_reason_length
  check (
    meta_sync_suspension_reason is null
    or pg_catalog.length(meta_sync_suspension_reason) <= 2000
  ) not valid;

alter table public.workspace_integrations
  validate constraint workspace_integrations_meta_suspension_reason_length;

create index if not exists idx_workspace_integrations_meta_suspended
  on public.workspace_integrations (meta_sync_suspended_at desc)
  where meta_sync_suspended_at is not null;

reset lock_timeout;

insert into public.workspace_integrations (workspace_id, created_by)
select distinct workspace.id, workspace.created_by
from public.workspaces workspace
join public.workspace_meta_accounts account
  on account.workspace_id = workspace.id
on conflict (workspace_id) do nothing;

update public.workspace_integrations integration
set meta_validated_at = latest.last_synced_at
from (
  select
    account.workspace_id,
    pg_catalog.max(account.last_synced_at) as last_synced_at
  from public.workspace_meta_accounts account
  group by account.workspace_id
) latest
where integration.workspace_id = latest.workspace_id
  and latest.last_synced_at is not null
  and integration.meta_validated_at is null;

create or replace function public.suspend_workspace_meta_sync(
  _workspace_id uuid,
  _reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  affected integer := 0;
  bounded_reason text;
  suspended_at timestamptz := pg_catalog.now();
begin
  bounded_reason := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(_reason), ''),
      'A sincronização Meta foi suspensa após uma falha permanente da credencial.'
    ),
    2000
  );

  insert into public.workspace_integrations (
    workspace_id,
    created_by,
    meta_sync_suspended_at,
    meta_sync_suspension_reason
  )
  select
    workspace.id,
    workspace.created_by,
    suspended_at,
    bounded_reason
  from public.workspaces workspace
  where workspace.id = _workspace_id
  on conflict (workspace_id) do update
  set
    meta_sync_suspended_at = excluded.meta_sync_suspended_at,
    meta_sync_suspension_reason = excluded.meta_sync_suspension_reason;

  update public.sync_jobs job
  set
    status = 'dead_letter',
    available_at = suspended_at,
    locked_at = null,
    locked_by = null,
    last_error = bounded_reason,
    finished_at = suspended_at,
    payload = coalesce(job.payload, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'failure',
        pg_catalog.jsonb_build_object(
          'kind', 'permanent',
          'cause', 'meta_credential_suspended',
          'failed_at', suspended_at
        )
      )
  where job.workspace_id = _workspace_id
    and job.source in ('meta', 'creative')
    and job.status in ('queued', 'running');

  get diagnostics affected = row_count;

  insert into public.operational_alerts (
    workspace_id,
    project_id,
    source,
    type,
    severity,
    status,
    title,
    message,
    dedupe_key,
    details,
    first_seen_at,
    last_seen_at,
    resolved_at
  )
  select distinct
    project.workspace_id,
    project.id,
    'meta',
    'credential_suspended',
    'critical',
    'active',
    'Meta requer nova credencial',
    bounded_reason,
    'meta-credential-suspended',
    pg_catalog.jsonb_build_object('action', 'replace_meta_credential'),
    suspended_at,
    suspended_at,
    null
  from public.projects project
  join public.project_meta_accounts binding
    on binding.project_id = project.id
  where project.workspace_id = _workspace_id
  on conflict (project_id, type, dedupe_key) do update
  set
    severity = 'critical',
    status = 'active',
    title = excluded.title,
    message = excluded.message,
    details = excluded.details,
    last_seen_at = excluded.last_seen_at,
    resolved_at = null;

  return affected;
end;
$$;

revoke all on function public.suspend_workspace_meta_sync(uuid, text)
  from public, anon, authenticated;
grant execute on function public.suspend_workspace_meta_sync(uuid, text)
  to service_role;

create or replace function public.replace_workspace_meta_credential(
  _workspace_id uuid,
  _access_token text,
  _validated_at timestamptz,
  _actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  updated_accounts integer := 0;
  effective_actor uuid;
  effective_validated_at timestamptz :=
    coalesce(_validated_at, pg_catalog.now());
begin
  if nullif(pg_catalog.btrim(_access_token), '') is null
    or pg_catalog.length(_access_token) > 2000
  then
    raise exception 'invalid_meta_access_token'
      using errcode = '22023';
  end if;

  select coalesce(_actor_id, workspace.created_by)
  into effective_actor
  from public.workspaces workspace
  where workspace.id = _workspace_id;

  if effective_actor is null then
    raise exception 'workspace_not_found'
      using errcode = 'P0002';
  end if;

  update public.workspace_meta_accounts account
  set access_token = pg_catalog.btrim(_access_token)
  where account.workspace_id = _workspace_id;

  get diagnostics updated_accounts = row_count;
  if updated_accounts = 0 then
    raise exception 'workspace_has_no_meta_accounts'
      using errcode = 'P0002';
  end if;

  insert into public.workspace_integrations (
    workspace_id,
    created_by,
    meta_sync_suspended_at,
    meta_sync_suspension_reason,
    meta_validated_at,
    meta_credential_updated_at
  )
  values (
    _workspace_id,
    effective_actor,
    null,
    null,
    effective_validated_at,
    pg_catalog.now()
  )
  on conflict (workspace_id) do update
  set
    meta_sync_suspended_at = null,
    meta_sync_suspension_reason = null,
    meta_validated_at = excluded.meta_validated_at,
    meta_credential_updated_at = excluded.meta_credential_updated_at;

  update public.operational_alerts alert
  set
    status = 'resolved',
    resolved_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where alert.workspace_id = _workspace_id
    and alert.source = 'meta'
    and alert.type in ('credential_suspended', 'sync_failed')
    and alert.status = 'active';

  update public.sync_jobs job
  set
    status = 'queued',
    attempt_count = 0,
    available_at = pg_catalog.now(),
    locked_at = null,
    locked_by = null,
    last_error = null,
    finished_at = null,
    payload = (coalesce(job.payload, '{}'::jsonb) - 'failure')
      || pg_catalog.jsonb_build_object(
        'recovery',
        pg_catalog.jsonb_build_object(
          'cause', 'meta_credential_replaced',
          'requeued_at', pg_catalog.now()
        )
      )
  where job.workspace_id = _workspace_id
    and job.source = 'creative'
    and job.status = 'dead_letter'
    and (
      lower(coalesce(job.last_error, '')) like '%token%'
      or lower(coalesce(job.last_error, '')) like '%oauth%'
      or job.payload -> 'failure' ->> 'cause' = 'meta_credential_suspended'
    );

  return updated_accounts;
end;
$$;

revoke all on function public.replace_workspace_meta_credential(
  uuid,
  text,
  timestamptz,
  uuid
) from public, anon, authenticated;
grant execute on function public.replace_workspace_meta_credential(
  uuid,
  text,
  timestamptz,
  uuid
) to service_role;

create or replace function public.refresh_workspace_meta_credential_state(
  _workspace_id uuid,
  _actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  token_variants bigint := 0;
  effective_actor uuid;
begin
  select
    pg_catalog.count(distinct nullif(pg_catalog.btrim(account.access_token), ''))
  into token_variants
  from public.workspace_meta_accounts account
  where account.workspace_id = _workspace_id;

  if token_variants <> 1 then
    return false;
  end if;

  select coalesce(_actor_id, workspace.created_by)
  into effective_actor
  from public.workspaces workspace
  where workspace.id = _workspace_id;

  if effective_actor is null then
    return false;
  end if;

  insert into public.workspace_integrations (
    workspace_id,
    created_by,
    meta_sync_suspended_at,
    meta_sync_suspension_reason,
    meta_validated_at,
    meta_credential_updated_at
  )
  values (
    _workspace_id,
    effective_actor,
    null,
    null,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (workspace_id) do update
  set
    meta_sync_suspended_at = null,
    meta_sync_suspension_reason = null,
    meta_validated_at = excluded.meta_validated_at,
    meta_credential_updated_at = excluded.meta_credential_updated_at;

  return true;
end;
$$;

revoke all on function public.refresh_workspace_meta_credential_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_workspace_meta_credential_state(uuid, uuid)
  to service_role;

-- Backfill the circuit breaker for current permanent incidents only when no
-- newer successful Meta run has recovered the client.
with failure_state as (
  select
    job.workspace_id,
    pg_catalog.max(
      coalesce(job.finished_at, job.updated_at, job.created_at)
    ) as failed_at,
    (pg_catalog.array_agg(
      job.last_error
      order by coalesce(job.finished_at, job.updated_at, job.created_at) desc
    ))[1] as reason
  from public.sync_jobs job
  where job.source = 'meta'
    and job.status = 'dead_letter'
    and (
      job.payload -> 'failure' ->> 'kind' = 'permanent'
      or lower(coalesce(job.last_error, '')) like '%token meta expirado%'
      or lower(coalesce(job.last_error, '')) like '%error validating access token%'
    )
  group by job.workspace_id
),
success_state as (
  select
    run.workspace_id,
    pg_catalog.max(coalesce(run.finished_at, run.created_at)) as succeeded_at
  from public.sync_runs run
  where run.source::text = 'meta'
    and run.status::text = 'succeeded'
  group by run.workspace_id
)
update public.workspace_integrations integration
set
  meta_sync_suspended_at = failure.failed_at,
  meta_sync_suspension_reason = pg_catalog.left(
    coalesce(
      failure.reason,
      'A sincronização Meta foi suspensa após uma falha permanente da credencial.'
    ),
    2000
  )
from failure_state failure
left join success_state success
  on success.workspace_id = failure.workspace_id
where integration.workspace_id = failure.workspace_id
  and (
    success.succeeded_at is null
    or failure.failed_at > success.succeeded_at
  )
  and integration.meta_sync_suspended_at is null;

insert into public.operational_alerts (
  workspace_id,
  project_id,
  source,
  type,
  severity,
  status,
  title,
  message,
  dedupe_key,
  details,
  first_seen_at,
  last_seen_at
)
select distinct
  project.workspace_id,
  project.id,
  'meta',
  'credential_suspended',
  'critical',
  'active',
  'Meta requer nova credencial',
  integration.meta_sync_suspension_reason,
  'meta-credential-suspended',
  pg_catalog.jsonb_build_object('action', 'replace_meta_credential'),
  integration.meta_sync_suspended_at,
  integration.meta_sync_suspended_at
from public.workspace_integrations integration
join public.projects project
  on project.workspace_id = integration.workspace_id
join public.project_meta_accounts binding
  on binding.project_id = project.id
where integration.meta_sync_suspended_at is not null
on conflict (project_id, type, dedupe_key) do update
set
  severity = 'critical',
  status = 'active',
  title = excluded.title,
  message = excluded.message,
  details = excluded.details,
  last_seen_at = excluded.last_seen_at,
  resolved_at = null;

drop function if exists public.get_workspace_integration_safe(uuid);

create function public.get_workspace_integration_safe(
  _workspace_id uuid
)
returns table (
  workspace_id uuid,
  vturb_last_event_at timestamptz,
  gateway_provider public.gateway_provider,
  gateway_webhook_token text,
  gateway_last_event_at timestamptz,
  has_vturb_api_key boolean,
  has_gateway_secret boolean,
  has_meta_credential boolean,
  meta_sync_suspended_at timestamptz,
  meta_sync_suspension_reason text,
  meta_validated_at timestamptz,
  meta_credential_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied'
      using errcode = '42501';
  end if;

  caller_is_admin := app_private.is_workspace_admin(_workspace_id);

  return query
  select
    integration.workspace_id,
    integration.vturb_last_event_at,
    integration.gateway_provider,
    case
      when caller_is_admin then integration.gateway_webhook_token
      else null
    end,
    integration.gateway_last_event_at,
    nullif(pg_catalog.btrim(integration.vturb_api_key), '') is not null,
    nullif(pg_catalog.btrim(integration.gateway_webhook_secret), '') is not null,
    exists (
      select 1
      from public.workspace_meta_accounts account
      where account.workspace_id = integration.workspace_id
        and nullif(pg_catalog.btrim(account.access_token), '') is not null
    ),
    integration.meta_sync_suspended_at,
    case
      when caller_is_admin then integration.meta_sync_suspension_reason
      else null
    end,
    integration.meta_validated_at,
    integration.meta_credential_updated_at
  from public.workspace_integrations integration
  where integration.workspace_id = _workspace_id;
end;
$$;

comment on function public.get_workspace_integration_safe(uuid) is
  'Returns non-secret integration metadata; credential reasons and webhook tokens are restricted to effective admins.';

revoke all on function public.get_workspace_integration_safe(uuid)
  from public, anon;
grant execute on function public.get_workspace_integration_safe(uuid)
  to authenticated, service_role;

comment on column public.workspace_integrations.meta_sync_suspended_at is
  'Automatic Meta and Meta-dependent creative sync is paused until the client credential is replaced.';
comment on column public.workspace_integrations.meta_sync_suspension_reason is
  'Sanitized operational reason for the current Meta credential suspension.';
comment on column public.workspace_integrations.meta_validated_at is
  'Last time the client-level Meta credential was validated against every configured ad account.';
comment on column public.workspace_integrations.meta_credential_updated_at is
  'Last atomic replacement of the client-level Meta credential.';
comment on function public.suspend_workspace_meta_sync(uuid, text) is
  'Service-only Meta circuit breaker that terminally classifies pending Meta-dependent work.';
comment on function public.replace_workspace_meta_credential(uuid, text, timestamptz, uuid) is
  'Service-only atomic replacement of the Meta credential across all ad accounts in a client.';
comment on function public.refresh_workspace_meta_credential_state(uuid, uuid) is
  'Marks a Meta credential validated only when every account in the client stores the same token.';

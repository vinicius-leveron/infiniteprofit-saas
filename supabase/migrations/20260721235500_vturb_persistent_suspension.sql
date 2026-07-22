-- Persist provider capability failures so the scheduler does not retry a
-- VTurb integration until an administrator changes or validates it again.

set lock_timeout = '5s';

alter table public.workspace_integrations
  add column if not exists vturb_sync_suspended_at timestamptz,
  add column if not exists vturb_sync_suspension_reason text,
  add column if not exists vturb_validated_at timestamptz;

alter table public.workspace_integrations
  drop constraint if exists workspace_integrations_vturb_suspension_reason_length;

alter table public.workspace_integrations
  add constraint workspace_integrations_vturb_suspension_reason_length
  check (
    vturb_sync_suspension_reason is null
    or pg_catalog.length(vturb_sync_suspension_reason) <= 2000
  ) not valid;

alter table public.workspace_integrations
  validate constraint workspace_integrations_vturb_suspension_reason_length;

create index if not exists idx_workspace_integrations_vturb_suspended
  on public.workspace_integrations (vturb_sync_suspended_at desc)
  where vturb_sync_suspended_at is not null;

reset lock_timeout;

create or replace function public.suspend_workspace_vturb_sync(
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
begin
  bounded_reason := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(_reason), ''),
      'VTurb sync suspended after a permanent provider capability failure.'
    ),
    2000
  );

  update public.workspace_integrations integration
  set
    vturb_sync_suspended_at = pg_catalog.now(),
    vturb_sync_suspension_reason = bounded_reason
  where integration.workspace_id = _workspace_id;

  update public.sync_jobs job
  set
    status = 'dead_letter',
    available_at = pg_catalog.now(),
    locked_at = null,
    locked_by = null,
    last_error = bounded_reason,
    finished_at = pg_catalog.now(),
    payload = coalesce(job.payload, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'failure',
        pg_catalog.jsonb_build_object(
          'kind', 'permanent',
          'cause', 'integration_suspended',
          'failed_at', pg_catalog.now()
        )
      )
  where job.workspace_id = _workspace_id
    and job.source = 'vturb'
    and job.status in ('queued', 'running');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.suspend_workspace_vturb_sync(uuid, text)
  from public, anon, authenticated;
grant execute on function public.suspend_workspace_vturb_sync(uuid, text)
  to service_role;

-- Preserve the provider incident discovered before this migration. The state
-- remains suspended until the stored credential is saved or validated again.
with permanent_failures as (
  select
    job.workspace_id,
    pg_catalog.max(
      coalesce(job.finished_at, job.updated_at, job.created_at)
    ) as suspended_at,
    (pg_catalog.array_agg(
      job.last_error
      order by coalesce(job.finished_at, job.updated_at, job.created_at) desc
    ))[1] as reason
  from public.sync_jobs job
  where job.source = 'vturb'
    and job.status = 'dead_letter'
    and job.payload -> 'failure' ->> 'kind' = 'permanent'
  group by job.workspace_id
)
update public.workspace_integrations integration
set
  vturb_sync_suspended_at = failure.suspended_at,
  vturb_sync_suspension_reason = pg_catalog.left(
    coalesce(
      failure.reason,
      'VTurb sync suspended after a permanent provider capability failure.'
    ),
    2000
  )
from permanent_failures failure
where integration.workspace_id = failure.workspace_id
  and integration.vturb_sync_suspended_at is null;

-- These jobs exhausted a transient timeout, but later successful creative
-- syncs made them obsolete. Keep the audit row terminal and classify it
-- explicitly instead of presenting it as an unknown DLQ incident.
with superseded_creative_jobs as (
  select dead.id
  from public.sync_jobs dead
  where dead.status = 'dead_letter'
    and dead.source = 'creative'
    and coalesce(dead.payload -> 'failure' ->> 'kind', '') = 'retryable'
    and exists (
      select 1
      from public.sync_jobs newer
      where newer.project_id = dead.project_id
        and newer.source = dead.source
        and newer.entity_type = dead.entity_type
        and newer.entity_id is not distinct from dead.entity_id
        and newer.status = 'succeeded'
        and newer.finished_at > dead.updated_at
        and newer.date_end >= dead.date_end
    )
)
update public.sync_jobs job
set payload = pg_catalog.jsonb_set(
  coalesce(job.payload, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'resolution',
      pg_catalog.jsonb_build_object(
        'kind', 'superseded_by_newer_success',
        'resolved_at', pg_catalog.now()
      )
    ),
  '{failure,kind}',
  '"superseded"'::jsonb,
  true
)
from superseded_creative_jobs superseded
where job.id = superseded.id;

comment on column public.workspace_integrations.vturb_sync_suspended_at is
  'Automatic VTurb sync is paused after a permanent provider capability failure.';
comment on column public.workspace_integrations.vturb_sync_suspension_reason is
  'Sanitized operational reason for the current VTurb sync suspension.';
comment on column public.workspace_integrations.vturb_validated_at is
  'Last successful explicit or operational VTurb credential validation.';
comment on function public.suspend_workspace_vturb_sync(uuid, text) is
  'Service-only circuit breaker: suspends VTurb and terminally classifies pending jobs.';

-- A retryable job can exhaust its attempts and later be made obsolete by a
-- successful, newer window. Keep the terminal row for audit, but stop counting
-- it as an unknown DLQ incident.

create or replace function public.classify_superseded_sync_jobs(
  _succeeded_job_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  succeeded public.sync_jobs%rowtype;
  affected integer := 0;
begin
  select job.*
  into succeeded
  from public.sync_jobs job
  where job.id = _succeeded_job_id
    and job.status = 'succeeded';

  if succeeded.id is null then
    return 0;
  end if;

  update public.sync_jobs dead
  set
    payload = pg_catalog.jsonb_set(
      coalesce(dead.payload, '{}'::jsonb),
      '{failure,kind}',
      '"superseded"'::jsonb,
      true
    ) || pg_catalog.jsonb_build_object(
      'recovery',
      pg_catalog.jsonb_build_object(
        'resolution', 'superseded_by_newer_success',
        'succeeded_job_id', succeeded.id,
        'resolved_at', pg_catalog.now()
      )
    ),
    updated_at = pg_catalog.now()
  where dead.status = 'dead_letter'
    and dead.project_id = succeeded.project_id
    and dead.source = succeeded.source
    and dead.entity_type = succeeded.entity_type
    and dead.id <> succeeded.id
    and coalesce(dead.payload -> 'failure' ->> 'kind', '') = 'retryable'
    and coalesce(dead.finished_at, dead.updated_at, dead.created_at)
      < coalesce(succeeded.finished_at, succeeded.updated_at)
    and dead.date_end <= succeeded.date_end
    and (
      (
        succeeded.source = 'meta'
        and coalesce(
          nullif(dead.payload ->> 'account_id', ''),
          pg_catalog.split_part(coalesce(dead.entity_id, ''), ':', 1)
        ) = coalesce(
          nullif(succeeded.payload ->> 'account_id', ''),
          pg_catalog.split_part(coalesce(succeeded.entity_id, ''), ':', 1)
        )
      )
      or (
        succeeded.source <> 'meta'
        and dead.entity_id is not distinct from succeeded.entity_id
      )
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.classify_superseded_sync_jobs(uuid)
  from public, anon, authenticated;
grant execute on function public.classify_superseded_sync_jobs(uuid)
  to service_role;

-- Repair historical retryable incidents already superseded by a newer success.
with superseded as (
  select distinct on (dead.id)
    dead.id as dead_job_id,
    newer.id as succeeded_job_id
  from public.sync_jobs dead
  join public.sync_jobs newer
    on newer.project_id = dead.project_id
    and newer.source = dead.source
    and newer.entity_type = dead.entity_type
    and newer.id <> dead.id
    and newer.status = 'succeeded'
    and coalesce(newer.finished_at, newer.updated_at)
      > coalesce(dead.finished_at, dead.updated_at, dead.created_at)
    and newer.date_end >= dead.date_end
    and (
      (
        dead.source = 'meta'
        and coalesce(
          nullif(dead.payload ->> 'account_id', ''),
          pg_catalog.split_part(coalesce(dead.entity_id, ''), ':', 1)
        ) = coalesce(
          nullif(newer.payload ->> 'account_id', ''),
          pg_catalog.split_part(coalesce(newer.entity_id, ''), ':', 1)
        )
      )
      or (
        dead.source <> 'meta'
        and dead.entity_id is not distinct from newer.entity_id
      )
    )
  where dead.status = 'dead_letter'
    and coalesce(dead.payload -> 'failure' ->> 'kind', '') = 'retryable'
  order by dead.id, newer.finished_at desc nulls last
)
update public.sync_jobs dead
set
  payload = pg_catalog.jsonb_set(
    coalesce(dead.payload, '{}'::jsonb),
    '{failure,kind}',
    '"superseded"'::jsonb,
    true
  ) || pg_catalog.jsonb_build_object(
    'recovery',
    pg_catalog.jsonb_build_object(
      'resolution', 'superseded_by_newer_success',
      'succeeded_job_id', superseded.succeeded_job_id,
      'resolved_at', pg_catalog.now()
    )
  ),
  updated_at = pg_catalog.now()
from superseded
where dead.id = superseded.dead_job_id;


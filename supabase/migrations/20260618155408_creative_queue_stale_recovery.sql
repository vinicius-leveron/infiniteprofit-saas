-- Recover stale creative jobs before claiming new work. This prevents jobs
-- left in `running` by a crashed worker from blocking the queue forever.

create or replace function public.claim_creative_asset_jobs(job_limit integer, worker_name text)
returns setof public.creative_asset_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.creative_asset_jobs as jobs
  set
    status = case
      when jobs.attempt_count >= jobs.max_attempts then 'failed'
      else 'queued'
    end,
    available_at = case
      when jobs.attempt_count >= jobs.max_attempts then now()
      else now() + make_interval(
        secs => least(
          3600,
          greatest(60, (30 * power(2, least(jobs.attempt_count, 7)))::integer)
        )
      )
    end,
    locked_at = null,
    locked_by = null,
    last_error = case
      when jobs.attempt_count >= jobs.max_attempts
        then coalesce(jobs.last_error, 'Job marked failed after stale worker lock exceeded max attempts')
      else coalesce(jobs.last_error, 'Job requeued after stale worker lock')
    end,
    finished_at = case
      when jobs.attempt_count >= jobs.max_attempts then now()
      else null
    end,
    updated_at = now()
  where jobs.status = 'running'
    and jobs.locked_at < now() - interval '60 minutes';

  return query
  with locked as (
    select j.id
    from public.creative_asset_jobs j
    where j.status = 'queued'
      and j.available_at <= now()
      and coalesce(j.payload ->> 'job_trigger', j.payload ->> 'trigger') = 'manual'
    order by j.available_at asc, j.created_at asc
    limit greatest(job_limit, 0)
    for update skip locked
  )
  update public.creative_asset_jobs as jobs
  set
    status = 'running',
    attempt_count = jobs.attempt_count + 1,
    locked_at = now(),
    locked_by = nullif(worker_name, ''),
    updated_at = now()
  from locked
  where jobs.id = locked.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_creative_asset_jobs(integer, text)
from public, anon, authenticated;
grant execute on function public.claim_creative_asset_jobs(integer, text) to service_role;

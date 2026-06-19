-- Market readiness hardening:
-- - Retire duplicate public cron RPCs/jobs.
-- - Restrict SECURITY DEFINER RPCs that should not be callable from the Data API.
-- - Fix mutable search_path on the creative job claim RPC.

do $$
begin
  if to_regprocedure('app_private.unschedule_job_by_name(text)') is not null then
    perform app_private.unschedule_job_by_name('daily-meta-pull');
    perform app_private.unschedule_job_by_name('daily-creative-sync-morning');
    perform app_private.unschedule_job_by_name('daily-creative-sync-midday');
    perform app_private.unschedule_job_by_name('daily-creative-sync-evening');
  end if;
end $$;

drop function if exists public.cron_meta_pull();
drop function if exists public.cron_creative_sync();

revoke all on table public.cron_config from public, anon, authenticated;

create or replace function public.claim_creative_asset_jobs(job_limit integer, worker_name text)
returns setof public.creative_asset_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
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

-- These legacy public SECURITY DEFINER RPCs are now server-only. The app should
-- call Edge Functions (`accept-invite`, `ai-settings`) instead of invoking them
-- from the browser.
revoke all on function public.accept_organization_invite(text)
from public, anon, authenticated;
revoke all on function public.accept_workspace_invite(text)
from public, anon, authenticated;
revoke all on function public.get_my_ai_settings_safe()
from public, anon, authenticated;
revoke all on function public.upsert_my_ai_settings(text, text, text, text, text, boolean)
from public, anon, authenticated;
revoke all on function public.delete_my_ai_settings()
from public, anon, authenticated;

grant execute on function public.accept_organization_invite(text) to service_role;
grant execute on function public.accept_workspace_invite(text) to service_role;
grant execute on function public.get_my_ai_settings_safe() to service_role;
grant execute on function public.upsert_my_ai_settings(text, text, text, text, text, boolean) to service_role;
grant execute on function public.delete_my_ai_settings() to service_role;

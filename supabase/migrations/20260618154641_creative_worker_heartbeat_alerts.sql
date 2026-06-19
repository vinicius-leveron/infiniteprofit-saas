-- Worker observability for the creative processing queue.
-- The Render worker writes these rows with service_role; app users can only
-- read heartbeat status for workspaces they belong to.

create table if not exists public.creative_worker_heartbeats (
  worker_id text primary key,
  status text not null default 'idle'
    check (status in ('starting', 'idle', 'claiming', 'processing', 'error', 'stopping')),
  active_job_id uuid references public.creative_asset_jobs(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_creative_worker_heartbeats_last_seen
  on public.creative_worker_heartbeats (last_seen_at desc);

alter table public.creative_worker_heartbeats enable row level security;

drop trigger if exists update_creative_worker_heartbeats_updated_at
  on public.creative_worker_heartbeats;

create trigger update_creative_worker_heartbeats_updated_at
  before update on public.creative_worker_heartbeats
  for each row
  execute function public.update_updated_at_column();

drop policy if exists "Workspace members can view creative worker heartbeats"
  on public.creative_worker_heartbeats;

create policy "Workspace members can view creative worker heartbeats"
on public.creative_worker_heartbeats for select
to authenticated
using (
  active_job_id is null
  or exists (
    select 1
    from public.creative_asset_jobs job
    where job.id = active_job_id
      and app_private.is_workspace_member(job.workspace_id)
  )
);

revoke insert, update, delete on table public.creative_worker_heartbeats
from public, anon, authenticated;

-- Operational alerts now include the creative pipeline.
alter table public.operational_alerts
  drop constraint if exists operational_alerts_source_check;

alter table public.operational_alerts
  add constraint operational_alerts_source_check
  check (source in ('meta', 'vturb', 'gateway', 'coverage', 'funnel', 'creative'));

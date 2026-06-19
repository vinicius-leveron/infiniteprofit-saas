-- Admin workflow for creative queue operations. This adds an explicit
-- dead-letter state plus an audit trail for requeue/dead-letter actions.

alter table public.creative_asset_jobs
  drop constraint if exists creative_asset_jobs_status_check;

alter table public.creative_asset_jobs
  add constraint creative_asset_jobs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter'));

create table if not exists public.creative_asset_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.creative_asset_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id uuid not null references public.creative_assets(id) on delete cascade,
  action text not null check (action in ('requeue', 'dead_letter')),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  previous_status text not null,
  next_status text not null,
  previous_attempt_count integer not null default 0,
  next_attempt_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_creative_asset_job_events_job
  on public.creative_asset_job_events (job_id, created_at desc);

create index if not exists idx_creative_asset_job_events_project
  on public.creative_asset_job_events (project_id, created_at desc);

create index if not exists idx_creative_asset_job_events_workspace
  on public.creative_asset_job_events (workspace_id, created_at desc);

alter table public.creative_asset_job_events enable row level security;

revoke all on table public.creative_asset_job_events
from public, anon, authenticated;

grant select on table public.creative_asset_job_events
to authenticated;

grant select, insert, update, delete on table public.creative_asset_job_events
to service_role;

drop policy if exists "Workspace members can view creative job events"
  on public.creative_asset_job_events;

create policy "Workspace members can view creative job events"
on public.creative_asset_job_events for select
to authenticated
using (app_private.is_workspace_member(workspace_id));

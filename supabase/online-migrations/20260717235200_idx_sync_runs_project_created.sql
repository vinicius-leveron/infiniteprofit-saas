create index concurrently if not exists idx_sync_runs_project_created
  on public.sync_runs (project_id, created_at desc);

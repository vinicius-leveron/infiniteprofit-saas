create index concurrently if not exists idx_sync_runs_project_source_status_started
  on public.sync_runs (project_id, source, status, started_at desc);

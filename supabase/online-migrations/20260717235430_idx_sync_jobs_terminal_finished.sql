create index concurrently if not exists idx_sync_jobs_terminal_finished
  on public.sync_jobs (status, finished_at)
  where status in ('succeeded', 'failed', 'dead_letter');

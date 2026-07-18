create index concurrently if not exists idx_raw_events_project_source_received
  on public.raw_events (project_id, source, received_at desc);

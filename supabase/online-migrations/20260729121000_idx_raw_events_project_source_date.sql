create index concurrently if not exists idx_raw_events_project_source_date
  on public.raw_events (project_id, source, event_date desc);

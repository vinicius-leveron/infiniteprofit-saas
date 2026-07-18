create index concurrently if not exists idx_operational_alerts_project_source_status
  on public.operational_alerts (project_id, source, status, last_seen_at desc);

-- Applied separately from Supabase db push because the CLI executes ordinary
-- migrations in an implicit transaction.

create index concurrently if not exists idx_raw_events_project_received
  on public.raw_events (project_id, received_at desc);

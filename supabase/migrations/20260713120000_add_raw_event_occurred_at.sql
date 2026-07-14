ALTER TABLE public.raw_events
  ADD COLUMN IF NOT EXISTS event_occurred_at TIMESTAMPTZ;

UPDATE public.raw_events
SET event_occurred_at = received_at
WHERE event_occurred_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_events_project_occurred_at
  ON public.raw_events (project_id, event_occurred_at);

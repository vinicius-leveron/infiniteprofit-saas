ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS landing_pageviews NUMERIC;

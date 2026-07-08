alter table public.daily_metrics
  add column if not exists plays_unicos numeric;

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS plays_unicos numeric;

ALTER TABLE public.creative_asset_ads
  ADD COLUMN IF NOT EXISTS ad_created_time timestamptz;


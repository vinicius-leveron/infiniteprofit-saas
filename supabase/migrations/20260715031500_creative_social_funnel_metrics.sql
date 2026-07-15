alter table public.creative_assets
  add column if not exists facebook_post_url text,
  add column if not exists instagram_post_url text;

update public.creative_assets
set
  facebook_post_url = case
    when post_url ilike '%facebook.com/%' then post_url
    else facebook_post_url
  end,
  instagram_post_url = case
    when post_url ilike '%instagram.com/%' then post_url
    else instagram_post_url
  end
where post_url is not null;

alter table public.creative_asset_daily_metrics
  add column if not exists refund_value numeric not null default 0,
  add column if not exists order_bump_purchases numeric not null default 0,
  add column if not exists order_bump_revenue numeric not null default 0,
  add column if not exists upsell_purchases numeric not null default 0,
  add column if not exists upsell_revenue numeric not null default 0;

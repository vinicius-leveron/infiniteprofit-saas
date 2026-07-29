alter table public.daily_metrics
  add column if not exists order_bump_orders integer,
  add column if not exists upsell_orders integer,
  add column if not exists conv_geral_upsell numeric;

comment on column public.daily_metrics.order_bump_orders is
  'Unique front-order identities that accepted at least one order bump.';
comment on column public.daily_metrics.upsell_orders is
  'Unique front-order identities linked to at least one upsell.';
comment on column public.daily_metrics.conv_geral_upsell is
  'Unique upsell orders divided by front sales for the date.';

update public.daily_metrics
set aov = case
  when coalesce(vendas_front, 0) > 0
    then coalesce(fat_bruto, 0) / vendas_front
  else null
end;

alter table public.creative_asset_daily_metrics
  add column if not exists net_revenue numeric not null default 0,
  add column if not exists profit numeric not null default 0,
  add column if not exists order_bump_conversion numeric,
  add column if not exists upsell_conversion numeric;

comment on column public.creative_asset_daily_metrics.net_revenue is
  'Checkout net revenue after provider fees and refunds.';
comment on column public.creative_asset_daily_metrics.profit is
  'Net revenue minus Meta spend and the platform Meta tax.';

alter table public.creative_asset_analysis
  add column if not exists prompt_hash text;

comment on column public.creative_asset_analysis.prompt_hash is
  'SHA-256 of the exact versioned prompt sent for this analysis.';

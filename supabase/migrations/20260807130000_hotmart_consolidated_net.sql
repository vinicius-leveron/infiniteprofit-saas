alter table public.daily_metrics
  add column if not exists financial_pending_count integer not null default 0;

comment on column public.daily_metrics.financial_pending_count is
  'Hotmart financial signals awaiting the complete receiver commission split.';

alter table public.creative_asset_daily_metrics
  add column if not exists financial_pending_count integer not null default 0,
  add column if not exists refund_net_value numeric not null default 0;

comment on column public.creative_asset_daily_metrics.financial_pending_count is
  'Attributed Hotmart signals whose consolidated net is still being enriched.';
comment on column public.creative_asset_daily_metrics.refund_net_value is
  'Consolidated net portion reversed by refunds; refund_value remains gross.';

-- The existing dimensional refresh historically treated gross as net when a
-- provider did not send a trustworthy net amount. Correct only the Hotmart
-- contribution after the regular refresh, preserving Hubla and all traffic/VSL
-- dimensions. This function is intentionally service-role only.
create or replace function public.apply_hotmart_consolidated_dimension_financials(
  _project_id uuid,
  _dates date[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _affected integer := 0;
begin
  if pg_catalog.coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  with hotmart_events as (
    select
      event.event_date,
      pg_catalog.coalesce(
        attribution.ad_id,
        pg_catalog.nullif(event.payload->>'ad_id', '')
      ) as ad_id,
      pg_catalog.regexp_replace(
        pg_catalog.coalesce(
          event.payload->>'transaction_id',
          event.external_id,
          event.id::text
        ),
        '-offer-[0-9]+$',
        '',
        'i'
      ) as order_id,
      event.event_type,
      pg_catalog.coalesce(
        pg_catalog.nullif(event.payload->>'net', '')::numeric,
        pg_catalog.nullif(event.payload->>'total', '')::numeric,
        pg_catalog.nullif(event.payload->>'gross', '')::numeric,
        0
      ) as legacy_approved_net,
      case
        when pg_catalog.lower(
          pg_catalog.coalesce(event.payload->>'financial_metrics_ready', 'true')
        ) = 'false' then 0
        else pg_catalog.coalesce(
          pg_catalog.nullif(event.payload->>'net', '')::numeric,
          0
        )
      end as consolidated_net,
      pg_catalog.abs(pg_catalog.coalesce(
        pg_catalog.nullif(event.payload->>'refund_value', '')::numeric,
        pg_catalog.nullif(event.payload->>'refunded_amount', '')::numeric,
        pg_catalog.nullif(event.payload->>'total', '')::numeric,
        pg_catalog.nullif(event.payload->>'gross', '')::numeric,
        0
      )) as legacy_refund_net
    from public.raw_events event
    left join public.transaction_ad_attribution attribution
      on attribution.project_id = event.project_id
      and attribution.transaction_id = pg_catalog.regexp_replace(
        pg_catalog.coalesce(event.payload->>'transaction_id', event.external_id),
        '-offer-[0-9]+$',
        '',
        'i'
      )
    where event.project_id = _project_id
      and event.source = 'gateway'
      and event.event_type in ('purchase.approved', 'purchase.refunded')
      and pg_catalog.lower(pg_catalog.coalesce(event.payload->>'provider', '')) = 'hotmart'
      and pg_catalog.lower(pg_catalog.coalesce(event.payload->>'metrics_ready', 'true')) <> 'false'
      and (_dates is null or event.event_date = any(_dates))
  ), orders as (
    select
      event_date,
      ad_id,
      order_id,
      pg_catalog.max(legacy_approved_net) filter (
        where event_type = 'purchase.approved'
      ) as legacy_approved_net,
      pg_catalog.max(consolidated_net) filter (
        where event_type = 'purchase.approved'
      ) as consolidated_approved_net,
      pg_catalog.max(legacy_refund_net) filter (
        where event_type = 'purchase.refunded'
      ) as legacy_refund_net,
      pg_catalog.max(consolidated_net) filter (
        where event_type = 'purchase.refunded'
      ) as consolidated_refund_net
    from hotmart_events
    where ad_id is not null
    group by event_date, ad_id, order_id
  ), corrections as (
    select
      event_date,
      ad_id,
      pg_catalog.greatest(
        0,
        pg_catalog.sum(pg_catalog.coalesce(legacy_approved_net, 0))
          - pg_catalog.sum(pg_catalog.coalesce(legacy_refund_net, 0))
      ) as legacy_net,
      pg_catalog.greatest(
        0,
        pg_catalog.sum(pg_catalog.coalesce(consolidated_approved_net, 0))
          - pg_catalog.sum(pg_catalog.coalesce(consolidated_refund_net, 0))
      ) as consolidated_net
    from orders
    group by event_date, ad_id
  )
  update public.daily_ad_dimension_metrics metric
  set fat_liquido = pg_catalog.greatest(
        0,
        metric.fat_liquido - correction.legacy_net + correction.consolidated_net
      ),
      updated_at = pg_catalog.now()
  from corrections correction
  where metric.project_id = _project_id
    and metric.event_date = correction.event_date
    and metric.ad_id = correction.ad_id;

  get diagnostics _affected = row_count;
  return _affected;
end;
$$;

revoke all on function public.apply_hotmart_consolidated_dimension_financials(uuid, date[])
  from public, anon, authenticated;
grant execute on function public.apply_hotmart_consolidated_dimension_financials(uuid, date[])
  to service_role;

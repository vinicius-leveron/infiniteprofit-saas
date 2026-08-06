-- Foundations for the August product feedback rollout. New business metrics
-- remain shadow-only until their rules are explicitly activated.

alter table public.creative_asset_ads
  add column if not exists ad_effective_status text,
  add column if not exists ad_configured_status text,
  add column if not exists ad_updated_time timestamptz;

create index if not exists idx_creative_asset_ads_project_status
  on public.creative_asset_ads (project_id, ad_effective_status, ad_created_time desc);

create table if not exists public.payment_attempt_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('hubla', 'hotmart', 'kiwify')),
  provider_event_key text not null,
  buyer_key text not null,
  identity_source text not null check (identity_source in ('provider_id', 'email', 'invoice')),
  order_id text not null,
  front_product_id text,
  method text not null check (method in ('card', 'pix')),
  outcome text not null check (outcome in ('approved', 'refused')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider, provider_event_key)
);

create index if not exists idx_payment_attempt_signals_project_occurred
  on public.payment_attempt_signals (project_id, occurred_at desc);
create index if not exists idx_payment_attempt_signals_project_buyer
  on public.payment_attempt_signals (project_id, buyer_key, occurred_at desc);

alter table public.payment_attempt_signals enable row level security;
revoke all on table public.payment_attempt_signals from public, anon, authenticated;

create or replace function public.list_dashboard_ad_dimensions_v2(
  _project_id uuid,
  _from date default null,
  _to date default null,
  _activity text default 'all'
)
returns table (
  account_id text,
  account_label text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
begin
  if _activity not in ('spent_in_period', 'all') then
    raise exception 'invalid_activity';
  end if;

  select project.workspace_id into _workspace_id
  from public.projects project where project.id = _project_id;

  if _workspace_id is null
    or not (
      app_private.is_workspace_member(_workspace_id)
      or app_private.is_org_admin_for_workspace(_workspace_id)
    )
  then
    raise exception 'forbidden';
  end if;

  return query
  select distinct
    nullif(metric.account_id, ''),
    coalesce(account.label, nullif(metric.account_id, '')),
    nullif(metric.campaign_id, ''),
    coalesce(metric.campaign_name, nullif(metric.campaign_id, '')),
    nullif(metric.adset_id, ''),
    coalesce(metric.adset_name, nullif(metric.adset_id, '')),
    metric.ad_id,
    coalesce(metric.ad_name, metric.ad_id)
  from public.daily_ad_dimension_metrics metric
  left join public.workspace_meta_accounts account
    on account.workspace_id = metric.workspace_id
    and account.account_id = metric.account_id
  where metric.project_id = _project_id
    and (_from is null or metric.event_date >= _from)
    and (_to is null or metric.event_date <= _to)
    and (_activity = 'all' or metric.investimento > 0)
  order by 2 nulls last, 4 nulls last, 6 nulls last, 8;
end;
$$;

revoke all on function public.list_dashboard_ad_dimensions_v2(uuid, date, date, text)
  from public, anon;
grant execute on function public.list_dashboard_ad_dimensions_v2(uuid, date, date, text)
  to authenticated, service_role;

create or replace function public.get_dashboard_dimension_metrics_v2(
  _project_id uuid,
  _from date default null,
  _to date default null,
  _account_ids text[] default '{}',
  _campaign_ids text[] default '{}',
  _adset_ids text[] default '{}',
  _include_unattributed boolean default false
)
returns table (
  event_date date,
  investimento numeric,
  impressoes bigint,
  cliques bigint,
  landing_pageviews bigint,
  pageviews bigint,
  plays_unicos bigint,
  chegaram_pitch bigint,
  checkouts bigint,
  vendas_front bigint,
  vendas_totais bigint,
  fat_bruto numeric,
  fat_liquido numeric,
  reembolsos bigint,
  valor_reembolsado numeric,
  order_bump_orders bigint,
  upsell_orders bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
begin
  select project.workspace_id into _workspace_id
  from public.projects project where project.id = _project_id;

  if _workspace_id is null
    or not (
      app_private.is_workspace_member(_workspace_id)
      or app_private.is_org_admin_for_workspace(_workspace_id)
    )
  then
    raise exception 'forbidden';
  end if;

  return query
  with base as (
    select
      metric.event_date,
      greatest(coalesce(metric.investimento, 0), 0)::numeric as investimento,
      greatest(coalesce(metric.impressoes, 0), 0)::bigint as impressoes,
      greatest(coalesce(metric.cliques, 0), 0)::bigint as cliques,
      greatest(coalesce(metric.landing_pageviews, 0), 0)::bigint as landing_pageviews,
      greatest(coalesce(metric.pageviews, 0), 0)::bigint as pageviews,
      greatest(coalesce(metric.plays_unicos, 0), 0)::bigint as plays_unicos,
      greatest(coalesce(metric.chegaram_pitch, 0), 0)::bigint as chegaram_pitch,
      greatest(coalesce(metric.checkouts, 0), 0)::bigint as checkouts,
      greatest(coalesce(metric.vendas_front, 0), 0)::bigint as vendas_front,
      greatest(coalesce(metric.vendas_totais, 0), 0)::bigint as vendas_totais,
      greatest(coalesce(metric.fat_bruto, 0), 0)::numeric as fat_bruto,
      greatest(coalesce(metric.fat_liquido, 0), 0)::numeric as fat_liquido,
      greatest(coalesce(metric.reembolsos, 0), 0)::bigint as reembolsos,
      greatest(coalesce(metric.valor_reembolsado, 0), 0)::numeric as valor_reembolsado,
      greatest(coalesce(metric.order_bump_orders, 0), 0)::bigint as order_bump_orders,
      greatest(coalesce(metric.upsell_orders, 0), 0)::bigint as upsell_orders
    from public.daily_metrics metric
    where metric.project_id = _project_id
      and (_from is null or metric.event_date >= _from)
      and (_to is null or metric.event_date <= _to)
  ),
  attributed as (
    select
      metric.event_date,
      sum(metric.investimento)::numeric as investimento,
      sum(metric.impressoes)::bigint as impressoes,
      sum(metric.cliques)::bigint as cliques,
      sum(metric.landing_pageviews)::bigint as landing_pageviews,
      sum(metric.pageviews)::bigint as pageviews,
      sum(metric.plays_unicos)::bigint as plays_unicos,
      sum(metric.chegaram_pitch)::bigint as chegaram_pitch,
      sum(metric.checkouts)::bigint as checkouts,
      sum(metric.vendas_front)::bigint as vendas_front,
      sum(metric.vendas_totais)::bigint as vendas_totais,
      sum(metric.fat_bruto)::numeric as fat_bruto,
      sum(metric.fat_liquido)::numeric as fat_liquido,
      sum(metric.reembolsos)::bigint as reembolsos,
      sum(metric.valor_reembolsado)::numeric as valor_reembolsado,
      sum(metric.order_bump_orders)::bigint as order_bump_orders,
      sum(metric.upsell_orders)::bigint as upsell_orders
    from public.daily_ad_dimension_metrics metric
    where metric.project_id = _project_id
      and (_from is null or metric.event_date >= _from)
      and (_to is null or metric.event_date <= _to)
    group by metric.event_date
  ),
  selected as (
    select
      metric.event_date,
      sum(metric.investimento)::numeric as investimento,
      sum(metric.impressoes)::bigint as impressoes,
      sum(metric.cliques)::bigint as cliques,
      sum(metric.landing_pageviews)::bigint as landing_pageviews,
      sum(metric.pageviews)::bigint as pageviews,
      sum(metric.plays_unicos)::bigint as plays_unicos,
      sum(metric.chegaram_pitch)::bigint as chegaram_pitch,
      sum(metric.checkouts)::bigint as checkouts,
      sum(metric.vendas_front)::bigint as vendas_front,
      sum(metric.vendas_totais)::bigint as vendas_totais,
      sum(metric.fat_bruto)::numeric as fat_bruto,
      sum(metric.fat_liquido)::numeric as fat_liquido,
      sum(metric.reembolsos)::bigint as reembolsos,
      sum(metric.valor_reembolsado)::numeric as valor_reembolsado,
      sum(metric.order_bump_orders)::bigint as order_bump_orders,
      sum(metric.upsell_orders)::bigint as upsell_orders
    from public.daily_ad_dimension_metrics metric
    where metric.project_id = _project_id
      and (_from is null or metric.event_date >= _from)
      and (_to is null or metric.event_date <= _to)
      and (coalesce(array_length(_account_ids, 1), 0) = 0 or metric.account_id = any(_account_ids))
      and (coalesce(array_length(_campaign_ids, 1), 0) = 0 or metric.campaign_id = any(_campaign_ids))
      and (coalesce(array_length(_adset_ids, 1), 0) = 0 or metric.adset_id = any(_adset_ids))
    group by metric.event_date
  )
  select
    base.event_date,
    least(base.investimento, coalesce(selected.investimento, 0) + case when _include_unattributed then greatest(base.investimento - coalesce(attributed.investimento, 0), 0) else 0 end),
    least(base.impressoes, coalesce(selected.impressoes, 0) + case when _include_unattributed then greatest(base.impressoes - coalesce(attributed.impressoes, 0), 0) else 0 end)::bigint,
    least(base.cliques, coalesce(selected.cliques, 0) + case when _include_unattributed then greatest(base.cliques - coalesce(attributed.cliques, 0), 0) else 0 end)::bigint,
    least(base.landing_pageviews, coalesce(selected.landing_pageviews, 0) + case when _include_unattributed then greatest(base.landing_pageviews - coalesce(attributed.landing_pageviews, 0), 0) else 0 end)::bigint,
    least(base.pageviews, coalesce(selected.pageviews, 0) + case when _include_unattributed then greatest(base.pageviews - coalesce(attributed.pageviews, 0), 0) else 0 end)::bigint,
    least(base.plays_unicos, coalesce(selected.plays_unicos, 0) + case when _include_unattributed then greatest(base.plays_unicos - coalesce(attributed.plays_unicos, 0), 0) else 0 end)::bigint,
    least(base.chegaram_pitch, coalesce(selected.chegaram_pitch, 0) + case when _include_unattributed then greatest(base.chegaram_pitch - coalesce(attributed.chegaram_pitch, 0), 0) else 0 end)::bigint,
    least(base.checkouts, coalesce(selected.checkouts, 0) + case when _include_unattributed then greatest(base.checkouts - coalesce(attributed.checkouts, 0), 0) else 0 end)::bigint,
    least(base.vendas_front, coalesce(selected.vendas_front, 0) + case when _include_unattributed then greatest(base.vendas_front - coalesce(attributed.vendas_front, 0), 0) else 0 end)::bigint,
    least(base.vendas_totais, coalesce(selected.vendas_totais, 0) + case when _include_unattributed then greatest(base.vendas_totais - coalesce(attributed.vendas_totais, 0), 0) else 0 end)::bigint,
    least(base.fat_bruto, coalesce(selected.fat_bruto, 0) + case when _include_unattributed then greatest(base.fat_bruto - coalesce(attributed.fat_bruto, 0), 0) else 0 end),
    least(base.fat_liquido, coalesce(selected.fat_liquido, 0) + case when _include_unattributed then greatest(base.fat_liquido - coalesce(attributed.fat_liquido, 0), 0) else 0 end),
    least(base.reembolsos, coalesce(selected.reembolsos, 0) + case when _include_unattributed then greatest(base.reembolsos - coalesce(attributed.reembolsos, 0), 0) else 0 end)::bigint,
    least(base.valor_reembolsado, coalesce(selected.valor_reembolsado, 0) + case when _include_unattributed then greatest(base.valor_reembolsado - coalesce(attributed.valor_reembolsado, 0), 0) else 0 end),
    least(base.order_bump_orders, coalesce(selected.order_bump_orders, 0) + case when _include_unattributed then greatest(base.order_bump_orders - coalesce(attributed.order_bump_orders, 0), 0) else 0 end)::bigint,
    least(base.upsell_orders, coalesce(selected.upsell_orders, 0) + case when _include_unattributed then greatest(base.upsell_orders - coalesce(attributed.upsell_orders, 0), 0) else 0 end)::bigint
  from base
  left join attributed using (event_date)
  left join selected using (event_date)
  order by base.event_date;
end;
$$;

revoke all on function public.get_dashboard_dimension_metrics_v2(uuid, date, date, text[], text[], text[], boolean)
  from public, anon;
grant execute on function public.get_dashboard_dimension_metrics_v2(uuid, date, date, text[], text[], text[], boolean)
  to authenticated, service_role;

create or replace function public.get_dashboard_attribution_summary(
  _project_id uuid,
  _from date default null,
  _to date default null
)
returns table (
  front_sales_percent numeric,
  revenue_percent numeric,
  vsl_percent numeric,
  unattributed_front_sales numeric,
  unattributed_revenue numeric,
  unattributed_vsl numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
begin
  select project.workspace_id into _workspace_id
  from public.projects project where project.id = _project_id;
  if _workspace_id is null
    or not (app_private.is_workspace_member(_workspace_id) or app_private.is_org_admin_for_workspace(_workspace_id))
  then raise exception 'forbidden'; end if;

  return query
  with base as (
    select
      coalesce(sum(coalesce(metric.vendas_front, 0)), 0)::numeric as vendas_front,
      coalesce(sum(coalesce(metric.fat_bruto, 0)), 0)::numeric as fat_bruto,
      coalesce(sum(coalesce(metric.pageviews, 0)), 0)::numeric as pageviews
    from public.daily_metrics metric
    where metric.project_id = _project_id
      and (_from is null or metric.event_date >= _from)
      and (_to is null or metric.event_date <= _to)
  ), attributed as (
    select
      coalesce(sum(coalesce(metric.vendas_front, 0)), 0)::numeric as vendas_front,
      coalesce(sum(coalesce(metric.fat_bruto, 0)), 0)::numeric as fat_bruto,
      coalesce(sum(coalesce(metric.pageviews, 0)), 0)::numeric as pageviews
    from public.daily_ad_dimension_metrics metric
    where metric.project_id = _project_id
      and (_from is null or metric.event_date >= _from)
      and (_to is null or metric.event_date <= _to)
  )
  select
    case when base.vendas_front > 0 then least(100, attributed.vendas_front / base.vendas_front * 100) else 0 end,
    case when base.fat_bruto > 0 then least(100, attributed.fat_bruto / base.fat_bruto * 100) else 0 end,
    case when base.pageviews > 0 then least(100, attributed.pageviews / base.pageviews * 100) else 0 end,
    greatest(base.vendas_front - attributed.vendas_front, 0),
    greatest(base.fat_bruto - attributed.fat_bruto, 0),
    greatest(base.pageviews - attributed.pageviews, 0)
  from base cross join attributed;
end;
$$;

revoke all on function public.get_dashboard_attribution_summary(uuid, date, date)
  from public, anon;
grant execute on function public.get_dashboard_attribution_summary(uuid, date, date)
  to authenticated, service_role;

create or replace function public.get_dashboard_sales_heatmap_v2(
  _project_id uuid,
  _from date,
  _to date,
  _account_ids text[] default '{}',
  _campaign_ids text[] default '{}',
  _adset_ids text[] default '{}',
  _include_unattributed boolean default false
)
returns table (weekday integer, hour integer, sales bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
begin
  select project.workspace_id into _workspace_id
  from public.projects project where project.id = _project_id;
  if _workspace_id is null
    or not (app_private.is_workspace_member(_workspace_id) or app_private.is_org_admin_for_workspace(_workspace_id))
  then raise exception 'forbidden'; end if;

  return query
  with purchases as (
    select distinct on (
      regexp_replace(coalesce(event.payload->>'transaction_id', event.external_id, event.id::text), '-offer-[0-9]+$', '', 'i')
    )
      coalesce(event.event_occurred_at, event.received_at) as occurred_at,
      coalesce(
        nullif(event.payload->>'net', '')::numeric,
        nullif(event.payload->>'total', '')::numeric,
        nullif(event.payload->>'gross', '')::numeric,
        0
      ) as revenue,
      attribution.ad_id
    from public.raw_events event
    left join public.transaction_ad_attribution attribution
      on attribution.project_id = event.project_id
      and attribution.transaction_id = regexp_replace(
        coalesce(event.payload->>'transaction_id', event.external_id), '-offer-[0-9]+$', '', 'i'
      )
    where event.project_id = _project_id
      and event.source = 'gateway'
      and event.event_type = 'purchase.approved'
      and event.event_date between _from and _to
      and pg_catalog.lower(coalesce(event.payload->>'metrics_ready', 'true')) <> 'false'
      and (
        pg_catalog.lower(coalesce(event.payload->>'is_front', '')) in ('true', '1', 'yes', 'sim')
        or (
          event.payload->>'is_front' is null
          and pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false')) not in ('true', '1', 'yes', 'sim')
          and pg_catalog.lower(coalesce(event.payload->>'product_role', 'front')) = 'front'
        )
      )
    order by
      regexp_replace(coalesce(event.payload->>'transaction_id', event.external_id, event.id::text), '-offer-[0-9]+$', '', 'i'),
      coalesce(event.event_occurred_at, event.received_at)
  ), filtered as (
    select purchase.*
    from purchases purchase
    left join lateral (
      select metric.account_id, metric.campaign_id, metric.adset_id
      from public.daily_ad_dimension_metrics metric
      where metric.project_id = _project_id and metric.ad_id = purchase.ad_id
      order by metric.event_date desc
      limit 1
    ) dimension on true
    where (
      (
        coalesce(array_length(_account_ids, 1), 0) = 0
        and coalesce(array_length(_campaign_ids, 1), 0) = 0
        and coalesce(array_length(_adset_ids, 1), 0) = 0
      )
      or (
        purchase.ad_id is not null
        and (coalesce(array_length(_account_ids, 1), 0) = 0 or dimension.account_id = any(_account_ids))
        and (coalesce(array_length(_campaign_ids, 1), 0) = 0 or dimension.campaign_id = any(_campaign_ids))
        and (coalesce(array_length(_adset_ids, 1), 0) = 0 or dimension.adset_id = any(_adset_ids))
      )
      or (_include_unattributed and purchase.ad_id is null)
    )
  )
  select
    (extract(isodow from filtered.occurred_at at time zone 'America/Sao_Paulo') - 1)::integer,
    extract(hour from filtered.occurred_at at time zone 'America/Sao_Paulo')::integer,
    pg_catalog.count(*)::bigint,
    pg_catalog.sum(filtered.revenue)
  from filtered
  group by 1, 2
  order by 1, 2;
end;
$$;

revoke all on function public.get_dashboard_sales_heatmap_v2(uuid, date, date, text[], text[], text[], boolean)
  from public, anon;
grant execute on function public.get_dashboard_sales_heatmap_v2(uuid, date, date, text[], text[], text[], boolean)
  to authenticated, service_role;

create or replace function public.get_payment_attempt_shadow_summary(
  _project_id uuid,
  _from timestamptz,
  _to timestamptz
)
returns table (
  method text,
  attempts bigint,
  unique_buyers bigint,
  approvals bigint,
  unique_approved_buyers bigint,
  invoice_fallbacks bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
begin
  select project.workspace_id into _workspace_id
  from public.projects project where project.id = _project_id;
  if _workspace_id is null or not (
    app_private.is_workspace_admin(_workspace_id)
    or app_private.is_org_admin_for_workspace(_workspace_id)
  )
  then raise exception 'forbidden'; end if;

  return query
  select
    signal.method,
    count(*)::bigint,
    count(distinct signal.buyer_key)::bigint,
    count(*) filter (where signal.outcome = 'approved')::bigint,
    count(distinct signal.buyer_key) filter (where signal.outcome = 'approved')::bigint,
    count(*) filter (where signal.identity_source = 'invoice')::bigint
  from public.payment_attempt_signals signal
  where signal.project_id = _project_id
    and signal.occurred_at >= _from
    and signal.occurred_at < _to
  group by signal.method;
end;
$$;

revoke all on function public.get_payment_attempt_shadow_summary(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_payment_attempt_shadow_summary(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

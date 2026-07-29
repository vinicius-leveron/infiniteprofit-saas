create table if not exists public.transaction_ad_attribution (
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id text not null,
  ad_id text not null,
  attribution_method text not null check (attribution_method in ('ad_id', 'utm_content')),
  confidence numeric not null default 1 check (confidence >= 0 and confidence <= 1),
  attributed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, transaction_id)
);

create index if not exists idx_transaction_ad_attribution_ad
  on public.transaction_ad_attribution (project_id, ad_id);

alter table public.transaction_ad_attribution enable row level security;

-- Transaction identifiers are an internal correlation detail. Dashboards
-- consume only the aggregate read model below.
revoke all on table public.transaction_ad_attribution from anon, authenticated;

create table if not exists public.daily_ad_dimension_metrics (
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_date date not null,
  account_id text not null default '',
  campaign_id text not null default '',
  campaign_name text,
  adset_id text not null default '',
  adset_name text,
  ad_id text not null,
  ad_name text,
  investimento numeric not null default 0,
  impressoes bigint not null default 0,
  cliques bigint not null default 0,
  hook_count bigint not null default 0,
  landing_pageviews bigint not null default 0,
  pageviews bigint not null default 0,
  plays_unicos bigint not null default 0,
  chegaram_pitch bigint not null default 0,
  checkouts bigint not null default 0,
  vendas_front bigint not null default 0,
  vendas_totais bigint not null default 0,
  fat_bruto numeric not null default 0,
  fat_liquido numeric not null default 0,
  reembolsos bigint not null default 0,
  valor_reembolsado numeric not null default 0,
  order_bump_orders bigint not null default 0,
  upsell_orders bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (project_id, event_date, account_id, campaign_id, adset_id, ad_id)
);

alter table public.daily_ad_dimension_metrics
  add column if not exists hook_count bigint not null default 0;

create index if not exists idx_daily_ad_dimension_project_date
  on public.daily_ad_dimension_metrics (project_id, event_date desc);
create index if not exists idx_daily_ad_dimension_account
  on public.daily_ad_dimension_metrics (project_id, account_id, event_date desc);
create index if not exists idx_daily_ad_dimension_campaign
  on public.daily_ad_dimension_metrics (project_id, campaign_id, event_date desc);
create index if not exists idx_daily_ad_dimension_adset
  on public.daily_ad_dimension_metrics (project_id, adset_id, event_date desc);

alter table public.daily_ad_dimension_metrics enable row level security;

revoke all on table public.daily_ad_dimension_metrics from anon, authenticated;
grant select on table public.daily_ad_dimension_metrics to authenticated, service_role;

drop policy if exists "Workspace members read dashboard dimensions"
  on public.daily_ad_dimension_metrics;
create policy "Workspace members read dashboard dimensions"
  on public.daily_ad_dimension_metrics
  for select to authenticated
  using (
    app_private.is_workspace_member(workspace_id)
    or app_private.is_org_admin_for_workspace(workspace_id)
  );

create or replace function public.refresh_dashboard_ad_dimensions(
  _project_id uuid,
  _dates date[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _workspace_id uuid;
  _affected integer := 0;
begin
  select project.workspace_id
  into _workspace_id
  from public.projects project
  where project.id = _project_id;

  if _workspace_id is null then
    raise exception 'project_not_found';
  end if;

  with resolved_attribution as (
    select
      event.received_at,
      regexp_replace(
        coalesce(event.payload->>'transaction_id', event.external_id),
        '-offer-[0-9]+$',
        '',
        'i'
      ) as transaction_id,
      coalesce(
        nullif(event.payload->>'ad_id', ''),
        matched_ad.ad_id
      ) as ad_id,
      case
        when nullif(event.payload->>'ad_id', '') is not null then 'ad_id'
        else 'utm_content'
      end as attribution_method
    from public.raw_events event
    left join lateral (
      select link.ad_id
      from public.creative_asset_ads link
      where link.project_id = _project_id
        and nullif(event.payload->>'utm_content', '') is not null
        and (
          pg_catalog.lower(event.payload->>'utm_content') = pg_catalog.lower(link.ad_id)
          or pg_catalog.lower(event.payload->>'utm_content')
            like '%' || pg_catalog.lower(link.ad_id) || '%'
        )
      order by pg_catalog.length(link.ad_id) desc
      limit 1
    ) matched_ad on true
    where event.project_id = _project_id
      and event.source = 'gateway'
      and event.event_type in ('purchase.approved', 'purchase.refunded', 'checkout_created')
      and coalesce(event.payload->>'transaction_id', event.external_id) is not null
  )
  insert into public.transaction_ad_attribution (
    project_id,
    workspace_id,
    transaction_id,
    ad_id,
    attribution_method,
    confidence,
    updated_at
  )
  select distinct on (resolved.transaction_id)
    _project_id,
    _workspace_id,
    resolved.transaction_id,
    resolved.ad_id,
    resolved.attribution_method,
    case when resolved.attribution_method = 'ad_id' then 1 else 0.9 end,
    now()
  from resolved_attribution resolved
  where resolved.ad_id is not null
  order by resolved.transaction_id,
    case when resolved.attribution_method = 'ad_id' then 0 else 1 end,
    resolved.received_at
  on conflict (project_id, transaction_id) do update set
    ad_id = excluded.ad_id,
    attribution_method = excluded.attribution_method,
    confidence = excluded.confidence,
    updated_at = now();

  delete from public.daily_ad_dimension_metrics metric
  where metric.project_id = _project_id
    and (_dates is null or metric.event_date = any(_dates));

  with meta as (
    select
      event.event_date,
      coalesce(event.account_id, event.payload->>'account_id', '') as account_id,
      coalesce(event.payload->>'campaign_id', '') as campaign_id,
      max(event.payload->>'campaign_name') as campaign_name,
      coalesce(event.payload->>'adset_id', '') as adset_id,
      max(event.payload->>'adset_name') as adset_name,
      event.payload->>'ad_id' as ad_id,
      max(event.payload->>'ad_name') as ad_name,
      sum(coalesce(nullif(event.payload->>'spend', '')::numeric, 0)) as investimento,
      sum(coalesce(nullif(event.payload->>'impressions', '')::bigint, 0)) as impressoes,
      sum(coalesce(
        (
          select sum(coalesce(nullif(action->>'value', '')::numeric, 0))
          from pg_catalog.jsonb_array_elements(coalesce(event.payload->'actions', '[]'::jsonb)) action
          where action->>'action_type' in ('link_click', 'omni_link_click')
        ),
        nullif(event.payload->>'clicks', '')::numeric,
        0
      ))::bigint as cliques,
      sum(coalesce(
        (
          select sum(coalesce(nullif(action->>'value', '')::numeric, 0))
          from pg_catalog.jsonb_array_elements(
            coalesce(event.payload->'video_p25_watched_actions', '[]'::jsonb)
          ) action
        ),
        (
          select sum(coalesce(nullif(action->>'value', '')::numeric, 0))
          from pg_catalog.jsonb_array_elements(
            coalesce(event.payload->'video_play_actions', '[]'::jsonb)
          ) action
        ),
        0
      ))::bigint as hook_count,
      sum(coalesce(
        (
          select sum(coalesce(nullif(action->>'value', '')::numeric, 0))
          from pg_catalog.jsonb_array_elements(coalesce(event.payload->'actions', '[]'::jsonb)) action
          where action->>'action_type' in ('landing_page_view', 'omni_landing_page_view')
        ),
        nullif(event.payload->>'landing_pageviews', '')::numeric,
        0
      ))::bigint as landing_pageviews
    from public.raw_events event
    where event.project_id = _project_id
      and event.source = 'meta'
      and event.event_type = 'insight_ad'
      and nullif(event.payload->>'ad_id', '') is not null
      and (_dates is null or event.event_date = any(_dates))
    group by event.event_date, coalesce(event.account_id, event.payload->>'account_id', ''),
      coalesce(event.payload->>'campaign_id', ''), coalesce(event.payload->>'adset_id', ''),
      event.payload->>'ad_id'
  ),
  ad_context as (
    select distinct on (event.payload->>'ad_id')
      event.payload->>'ad_id' as ad_id,
      coalesce(event.account_id, event.payload->>'account_id', '') as account_id,
      coalesce(event.payload->>'campaign_id', '') as campaign_id,
      event.payload->>'campaign_name' as campaign_name,
      coalesce(event.payload->>'adset_id', '') as adset_id,
      event.payload->>'adset_name' as adset_name,
      event.payload->>'ad_name' as ad_name
    from public.raw_events event
    where event.project_id = _project_id
      and event.source = 'meta'
      and event.event_type = 'insight_ad'
      and nullif(event.payload->>'ad_id', '') is not null
    order by event.payload->>'ad_id', event.event_date desc, event.received_at desc
  ),
  gateway_events as (
    select
      event.event_date,
      coalesce(attribution.ad_id, nullif(event.payload->>'ad_id', '')) as ad_id,
      regexp_replace(coalesce(event.payload->>'transaction_id', event.external_id, event.id::text), '-offer-[0-9]+$', '', 'i') as order_id,
      event.event_type,
      coalesce(
        nullif(event.payload->>'total', '')::numeric,
        nullif(event.payload->>'gross', '')::numeric,
        0
      ) as gross_value,
      coalesce(
        nullif(event.payload->>'net', '')::numeric,
        nullif(event.payload->>'total', '')::numeric,
        nullif(event.payload->>'gross', '')::numeric,
        0
      ) as net_value,
      abs(coalesce(
        nullif(event.payload->>'refund_value', '')::numeric,
        nullif(event.payload->>'refunded_amount', '')::numeric,
        nullif(event.payload->>'total', '')::numeric,
        0
      )) as refund_value,
      (
        pg_catalog.lower(coalesce(event.payload->>'is_front', '')) in ('true', '1', 'yes', 'sim')
        or (
          event.payload->>'is_front' is null
          and pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false')) not in ('true', '1', 'yes', 'sim')
          and pg_catalog.lower(coalesce(event.payload->>'product_role', 'front')) = 'front'
        )
      ) as is_front,
      (
        pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false')) in ('true', '1', 'yes', 'sim')
      ) as is_offer,
      (
        event.event_type = 'purchase.approved'
        and pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false'))
          not in ('true', '1', 'yes', 'sim')
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements(coalesce(event.payload->'items', '[]'::jsonb)) item
          where pg_catalog.lower(coalesce(item->>'is_bump', 'false'))
            in ('true', '1', 'yes', 'sim')
        )
      ) as main_includes_offer_items,
      case
        when event.event_type <> 'purchase.approved' then 0
        when pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false'))
          in ('true', '1', 'yes', 'sim')
        then greatest(
          1,
          (
            select pg_catalog.count(*)
            from pg_catalog.jsonb_array_elements(coalesce(event.payload->'items', '[]'::jsonb)) item
            where pg_catalog.lower(coalesce(item->>'is_bump', 'false'))
              in ('true', '1', 'yes', 'sim')
              and (
                coalesce(nullif(item->>'price', '')::numeric, 0) > 0
                or pg_catalog.lower(coalesce(item->>'count_as_sale', 'false'))
                  in ('true', '1', 'yes', 'sim')
              )
          )::integer
        )
        else 1 + (
          select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(coalesce(event.payload->'items', '[]'::jsonb)) item
          where pg_catalog.lower(coalesce(item->>'is_bump', 'false'))
            in ('true', '1', 'yes', 'sim')
            and (
              coalesce(nullif(item->>'price', '')::numeric, 0) > 0
              or pg_catalog.lower(coalesce(item->>'count_as_sale', 'false'))
                in ('true', '1', 'yes', 'sim')
            )
        )::integer
      end as approved_sale_count,
      (
        pg_catalog.lower(coalesce(event.payload->>'is_upsell', 'false')) in ('true', '1', 'yes', 'sim')
        or pg_catalog.lower(coalesce(event.payload->>'product_role', '')) = 'upsell'
        or event.payload::text ~* 'upsell'
      ) as has_upsell,
      (
        pg_catalog.lower(coalesce(event.payload->>'product_role', '')) = 'order_bump'
        or event.payload::text ~* 'order.?bump'
      ) as has_order_bump
    from public.raw_events event
    left join public.transaction_ad_attribution attribution
      on attribution.project_id = event.project_id
      and attribution.transaction_id =
        regexp_replace(coalesce(event.payload->>'transaction_id', event.external_id), '-offer-[0-9]+$', '', 'i')
    where event.project_id = _project_id
      and event.source = 'gateway'
      and event.event_type in ('checkout_created', 'purchase.approved', 'purchase.refunded')
      and pg_catalog.lower(coalesce(event.payload->>'metrics_ready', 'true')) <> 'false'
      and (_dates is null or event.event_date = any(_dates))
  ),
  gateway_orders as (
    select
      event.event_date,
      event.ad_id,
      event.order_id,
      bool_or(event.event_type = 'checkout_created') as has_checkout,
      bool_or(event.event_type = 'purchase.approved') as approved,
      bool_or(event.event_type = 'purchase.approved' and event.is_front) as is_front,
      bool_or(
        event.event_type = 'purchase.approved'
        and (event.has_order_bump or (event.is_offer and not event.has_upsell))
      ) as has_order_bump,
      bool_or(event.event_type = 'purchase.approved' and event.has_upsell) as has_upsell,
      case
        when max(event.gross_value) filter (
          where event.event_type = 'purchase.approved' and not event.is_offer
        ) is not null
        then
          max(event.gross_value) filter (
            where event.event_type = 'purchase.approved' and not event.is_offer
          )
          + case
              when bool_or(event.main_includes_offer_items) then 0
              else coalesce(sum(event.gross_value) filter (
                where event.event_type = 'purchase.approved' and event.is_offer
              ), 0)
            end
        else coalesce(sum(event.gross_value) filter (
          where event.event_type = 'purchase.approved'
        ), 0)
      end as gross_value,
      case
        when max(event.net_value) filter (
          where event.event_type = 'purchase.approved' and not event.is_offer
        ) is not null
        then
          max(event.net_value) filter (
            where event.event_type = 'purchase.approved' and not event.is_offer
          )
          + case
              when bool_or(event.main_includes_offer_items) then 0
              else coalesce(sum(event.net_value) filter (
                where event.event_type = 'purchase.approved' and event.is_offer
              ), 0)
            end
        else coalesce(sum(event.net_value) filter (
          where event.event_type = 'purchase.approved'
        ), 0)
      end as net_value,
      case
        when max(event.approved_sale_count) filter (
          where event.event_type = 'purchase.approved' and not event.is_offer
        ) is not null
        then
          max(event.approved_sale_count) filter (
            where event.event_type = 'purchase.approved' and not event.is_offer
          )
          + case
              when bool_or(event.main_includes_offer_items) then 0
              else coalesce(sum(event.approved_sale_count) filter (
                where event.event_type = 'purchase.approved' and event.is_offer
              ), 0)
            end
        else coalesce(sum(event.approved_sale_count) filter (
          where event.event_type = 'purchase.approved'
        ), 0)
      end as approved_sale_count,
      bool_or(event.event_type = 'purchase.refunded') as has_refund,
      max(event.refund_value) filter (where event.event_type = 'purchase.refunded') as refund_value
    from gateway_events event
    where event.ad_id is not null
    group by event.event_date, event.ad_id, event.order_id
  ),
  gateway as (
    select
      orders.event_date,
      orders.ad_id,
      count(*) filter (where orders.has_checkout) as checkouts,
      count(*) filter (where orders.approved and orders.is_front) as vendas_front,
      sum(orders.approved_sale_count) filter (where orders.approved) as vendas_totais,
      sum(coalesce(orders.gross_value, 0)) filter (where orders.approved) as fat_bruto,
      sum(coalesce(orders.net_value, 0)) filter (where orders.approved) as fat_liquido,
      count(*) filter (where orders.has_refund) as reembolsos,
      sum(coalesce(orders.refund_value, 0)) filter (where orders.has_refund) as valor_reembolsado,
      count(*) filter (where orders.is_front and orders.has_order_bump) as order_bump_orders,
      count(*) filter (where orders.is_front and orders.has_upsell) as upsell_orders
    from gateway_orders orders
    group by orders.event_date, orders.ad_id
  ),
  vturb_events as (
    select
      event.event_date,
      coalesce(nullif(event.payload->>'ad_id', ''), matched_ad.ad_id) as ad_id,
      coalesce(
        nullif(nullif(event.payload->>'total_viewed_session_uniq', '')::bigint, 0),
        nullif(nullif(event.payload->>'total_viewed_device_uniq', '')::bigint, 0),
        nullif(event.payload->>'pageviews', '')::bigint,
        nullif(event.payload->>'page_views', '')::bigint,
        0
      ) as pageviews,
      coalesce(
        nullif(nullif(event.payload->>'total_started_session_uniq', '')::bigint, 0),
        nullif(nullif(event.payload->>'total_started_device_uniq', '')::bigint, 0),
        nullif(event.payload->>'plays', '')::bigint,
        nullif(event.payload->>'views', '')::bigint,
        0
      ) as plays_unicos,
      coalesce(
        nullif(event.payload->>'total_over_pitch', '')::bigint,
        nullif(event.payload->>'pitch_reached', '')::bigint,
        nullif(event.payload->>'pitch', '')::bigint,
        nullif(event.payload->>'chegaram_pitch', '')::bigint,
        0
      ) as chegaram_pitch
    from public.raw_events event
    left join lateral (
      select link.ad_id
      from public.creative_asset_ads link
      where link.project_id = _project_id
        and nullif(event.payload->>'utm_content', '') is not null
        and (
          pg_catalog.lower(event.payload->>'utm_content') = pg_catalog.lower(link.ad_id)
          or pg_catalog.lower(event.payload->>'utm_content')
            like '%' || pg_catalog.lower(link.ad_id) || '%'
        )
      order by pg_catalog.length(link.ad_id) desc
      limit 1
    ) matched_ad on true
    where event.project_id = _project_id
      and event.source = 'vturb'
      and (_dates is null or event.event_date = any(_dates))
  ),
  vturb as (
    select
      event.event_date,
      event.ad_id,
      sum(event.pageviews) as pageviews,
      sum(event.plays_unicos) as plays_unicos,
      sum(event.chegaram_pitch) as chegaram_pitch
    from vturb_events event
    where event.ad_id is not null
    group by event.event_date, event.ad_id
  ),
  keys as (
    select event_date, ad_id from meta
    union
    select event_date, ad_id from gateway
    union
    select event_date, ad_id from vturb
  )
  insert into public.daily_ad_dimension_metrics (
    project_id, workspace_id, event_date,
    account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    investimento, impressoes, cliques, hook_count, landing_pageviews,
    pageviews, plays_unicos, chegaram_pitch, checkouts,
    vendas_front, vendas_totais, fat_bruto, fat_liquido,
    reembolsos, valor_reembolsado, order_bump_orders, upsell_orders
  )
  select
    _project_id,
    _workspace_id,
    key.event_date,
    coalesce(meta.account_id, context.account_id, ''),
    coalesce(meta.campaign_id, context.campaign_id, ad.campaign_id, ''),
    coalesce(meta.campaign_name, context.campaign_name, ad.campaign_name),
    coalesce(meta.adset_id, context.adset_id, ad.adset_id, ''),
    coalesce(meta.adset_name, context.adset_name, ad.adset_name),
    key.ad_id,
    coalesce(meta.ad_name, context.ad_name, ad.ad_name),
    coalesce(meta.investimento, 0),
    coalesce(meta.impressoes, 0),
    coalesce(meta.cliques, 0),
    coalesce(meta.hook_count, 0),
    coalesce(meta.landing_pageviews, 0),
    coalesce(vturb.pageviews, 0),
    coalesce(vturb.plays_unicos, 0),
    coalesce(vturb.chegaram_pitch, 0),
    coalesce(gateway.checkouts, 0),
    coalesce(gateway.vendas_front, 0),
    coalesce(gateway.vendas_totais, 0),
    coalesce(gateway.fat_bruto, 0),
    greatest(0, coalesce(gateway.fat_liquido, 0) - coalesce(gateway.valor_reembolsado, 0)),
    coalesce(gateway.reembolsos, 0),
    coalesce(gateway.valor_reembolsado, 0),
    coalesce(gateway.order_bump_orders, 0),
    coalesce(gateway.upsell_orders, 0)
  from keys key
  left join meta on meta.event_date = key.event_date and meta.ad_id = key.ad_id
  left join ad_context context on context.ad_id = key.ad_id
  left join gateway on gateway.event_date = key.event_date and gateway.ad_id = key.ad_id
  left join vturb on vturb.event_date = key.event_date and vturb.ad_id = key.ad_id
  left join lateral (
    select link.campaign_id, link.campaign_name, link.adset_id, link.adset_name, link.ad_name
    from public.creative_asset_ads link
    where link.project_id = _project_id and link.ad_id = key.ad_id
    order by link.updated_at desc
    limit 1
  ) ad on true;

  get diagnostics _affected = row_count;
  return _affected;
end;
$$;

revoke all on function public.refresh_dashboard_ad_dimensions(uuid, date[])
  from public, anon, authenticated;
grant execute on function public.refresh_dashboard_ad_dimensions(uuid, date[])
  to service_role;

create or replace function public.list_dashboard_ad_dimensions(_project_id uuid)
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
  order by 2 nulls last, 4 nulls last, 6 nulls last, 8;
end;
$$;

revoke all on function public.list_dashboard_ad_dimensions(uuid)
  from public, anon;
grant execute on function public.list_dashboard_ad_dimensions(uuid)
  to authenticated, service_role;

create or replace function public.get_dashboard_dimension_metrics(
  _project_id uuid,
  _from date default null,
  _to date default null,
  _account_ids text[] default '{}',
  _campaign_ids text[] default '{}',
  _adset_ids text[] default '{}'
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
  select
    metric.event_date,
    sum(metric.investimento),
    sum(metric.impressoes)::bigint,
    sum(metric.cliques)::bigint,
    sum(metric.landing_pageviews)::bigint,
    sum(metric.pageviews)::bigint,
    sum(metric.plays_unicos)::bigint,
    sum(metric.chegaram_pitch)::bigint,
    sum(metric.checkouts)::bigint,
    sum(metric.vendas_front)::bigint,
    sum(metric.vendas_totais)::bigint,
    sum(metric.fat_bruto),
    sum(metric.fat_liquido),
    sum(metric.reembolsos)::bigint,
    sum(metric.valor_reembolsado),
    sum(metric.order_bump_orders)::bigint,
    sum(metric.upsell_orders)::bigint
  from public.daily_ad_dimension_metrics metric
  where metric.project_id = _project_id
    and (_from is null or metric.event_date >= _from)
    and (_to is null or metric.event_date <= _to)
    and (coalesce(array_length(_account_ids, 1), 0) = 0 or metric.account_id = any(_account_ids))
    and (coalesce(array_length(_campaign_ids, 1), 0) = 0 or metric.campaign_id = any(_campaign_ids))
    and (coalesce(array_length(_adset_ids, 1), 0) = 0 or metric.adset_id = any(_adset_ids))
  group by metric.event_date
  order by metric.event_date;
end;
$$;

revoke all on function public.get_dashboard_dimension_metrics(uuid, date, date, text[], text[], text[])
  from public, anon;
grant execute on function public.get_dashboard_dimension_metrics(uuid, date, date, text[], text[], text[])
  to authenticated, service_role;

create or replace function public.get_dashboard_sales_heatmap(
  _project_id uuid,
  _from date,
  _to date,
  _account_ids text[] default '{}',
  _campaign_ids text[] default '{}',
  _adset_ids text[] default '{}'
)
returns table (
  weekday integer,
  hour integer,
  sales bigint,
  revenue numeric
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
  with purchases as (
    select distinct on (
      regexp_replace(
        coalesce(event.payload->>'transaction_id', event.external_id, event.id::text),
        '-offer-[0-9]+$',
        '',
        'i'
      )
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
        coalesce(event.payload->>'transaction_id', event.external_id),
        '-offer-[0-9]+$',
        '',
        'i'
      )
    where event.project_id = _project_id
      and event.source = 'gateway'
      and event.event_type = 'purchase.approved'
      and event.event_date >= _from
      and event.event_date <= _to
      and pg_catalog.lower(coalesce(event.payload->>'metrics_ready', 'true')) <> 'false'
      and (
        pg_catalog.lower(coalesce(event.payload->>'is_front', '')) in ('true', '1', 'yes', 'sim')
        or (
          event.payload->>'is_front' is null
          and pg_catalog.lower(coalesce(event.payload->>'is_offer_event', 'false'))
            not in ('true', '1', 'yes', 'sim')
          and pg_catalog.lower(coalesce(event.payload->>'product_role', 'front')) = 'front'
        )
      )
    order by
      regexp_replace(
        coalesce(event.payload->>'transaction_id', event.external_id, event.id::text),
        '-offer-[0-9]+$',
        '',
        'i'
      ),
      coalesce(event.event_occurred_at, event.received_at)
  ),
  filtered as (
    select purchase.*
    from purchases purchase
    left join lateral (
      select
        metric.account_id,
        metric.campaign_id,
        metric.adset_id
      from public.daily_ad_dimension_metrics metric
      where metric.project_id = _project_id
        and metric.ad_id = purchase.ad_id
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

revoke all on function public.get_dashboard_sales_heatmap(uuid, date, date, text[], text[], text[])
  from public, anon;
grant execute on function public.get_dashboard_sales_heatmap(uuid, date, date, text[], text[], text[])
  to authenticated, service_role;

create or replace function public.list_creative_processing_status_safe(_project_id uuid)
returns table (
  asset_id uuid,
  status text,
  job_trigger text,
  manual_requested_at timestamptz,
  finished_at timestamptz
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
  select distinct on (job.asset_id)
    job.asset_id,
    job.status::text,
    coalesce(job.payload->>'job_trigger', job.payload->>'trigger', 'auto')::text,
    nullif(job.payload->>'manual_requested_at', '')::timestamptz,
    job.finished_at
  from public.creative_asset_jobs job
  where job.project_id = _project_id
  order by job.asset_id, job.created_at desc;
end;
$$;

revoke all on function public.list_creative_processing_status_safe(uuid)
  from public, anon;
grant execute on function public.list_creative_processing_status_safe(uuid)
  to authenticated, service_role;

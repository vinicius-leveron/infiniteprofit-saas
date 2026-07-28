-- Expand checkout integrations without breaking the legacy one-gateway-per-workspace
-- contract. Legacy columns remain available during the dual-read rollout.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.workspace_checkout_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider public.gateway_provider not null,
  label text not null,
  external_account_id text,
  external_account_name text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'requires_action', 'disconnected')),
  auth_mode text not null default 'webhook'
    check (auth_mode in ('webhook', 'client_credentials')),
  credential_secret_id uuid,
  webhook_secret_id uuid,
  credential_expires_at timestamptz,
  validated_at timestamptz,
  catalog_synced_at timestamptz,
  last_event_at timestamptz,
  last_backfill_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_checkout_integrations_account_uidx
  on public.workspace_checkout_integrations (
    workspace_id,
    provider,
    external_account_id
  )
  where external_account_id is not null;

create index if not exists idx_workspace_checkout_integrations_workspace
  on public.workspace_checkout_integrations (workspace_id, created_at);

drop trigger if exists update_workspace_checkout_integrations_updated_at
  on public.workspace_checkout_integrations;
create trigger update_workspace_checkout_integrations_updated_at
  before update on public.workspace_checkout_integrations
  for each row execute function public.update_updated_at_column();

create table if not exists public.workspace_checkout_products (
  id uuid primary key default gen_random_uuid(),
  checkout_integration_id uuid not null
    references public.workspace_checkout_integrations(id) on delete cascade,
  provider_product_id text not null,
  product_ucode text,
  name text not null,
  status text not null default 'ACTIVE',
  format text,
  is_subscription boolean not null default false,
  currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checkout_integration_id, provider_product_id)
);

create index if not exists idx_workspace_checkout_products_integration
  on public.workspace_checkout_products (checkout_integration_id, status, name);

drop trigger if exists update_workspace_checkout_products_updated_at
  on public.workspace_checkout_products;
create trigger update_workspace_checkout_products_updated_at
  before update on public.workspace_checkout_products
  for each row execute function public.update_updated_at_column();

create table if not exists public.workspace_checkout_offers (
  id uuid primary key default gen_random_uuid(),
  checkout_integration_id uuid not null
    references public.workspace_checkout_integrations(id) on delete cascade,
  checkout_product_id uuid not null
    references public.workspace_checkout_products(id) on delete cascade,
  provider_offer_code text not null,
  name text,
  status text not null default 'ACTIVE',
  price numeric,
  currency_code text,
  payment_mode text,
  is_main_offer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checkout_integration_id, provider_offer_code)
);

create index if not exists idx_workspace_checkout_offers_product
  on public.workspace_checkout_offers (checkout_product_id, status);

drop trigger if exists update_workspace_checkout_offers_updated_at
  on public.workspace_checkout_offers;
create trigger update_workspace_checkout_offers_updated_at
  before update on public.workspace_checkout_offers
  for each row execute function public.update_updated_at_column();

alter table public.project_checkout_bindings
  add column if not exists checkout_integration_id uuid
    references public.workspace_checkout_integrations(id) on delete restrict;

create index if not exists idx_project_checkout_bindings_integration
  on public.project_checkout_bindings (checkout_integration_id, enabled);

create table if not exists public.project_checkout_products (
  project_id uuid not null references public.projects(id) on delete cascade,
  checkout_product_id uuid not null
    references public.workspace_checkout_products(id) on delete cascade,
  checkout_offer_id uuid
    references public.workspace_checkout_offers(id) on delete set null,
  role text not null check (role in ('front', 'order_bump', 'upsell')),
  created_at timestamptz not null default now(),
  primary key (project_id, checkout_product_id)
);

create unique index if not exists project_checkout_products_one_front_uidx
  on public.project_checkout_products (project_id)
  where role = 'front';

create index if not exists idx_project_checkout_products_product
  on public.project_checkout_products (checkout_product_id, project_id);

-- Move every existing workspace checkout into the expanded catalog. The
-- persisted project webhook_token never changes.
do $$
declare
  legacy record;
  integration_id uuid;
  secret_id uuid;
begin
  for legacy in
    select
      integration.workspace_id,
      integration.gateway_provider,
      integration.gateway_webhook_secret,
      integration.gateway_last_event_at,
      integration.created_by,
      integration.created_at
    from public.workspace_integrations integration
    where integration.gateway_provider is not null
  loop
    select checkout.id
      into integration_id
    from public.workspace_checkout_integrations checkout
    where checkout.workspace_id = legacy.workspace_id
      and checkout.provider = legacy.gateway_provider
      and checkout.external_account_id is null
    order by checkout.created_at
    limit 1;

    if integration_id is null then
      integration_id := gen_random_uuid();
      secret_id := null;

      if nullif(pg_catalog.btrim(legacy.gateway_webhook_secret), '') is not null then
        secret_id := vault.create_secret(
          legacy.gateway_webhook_secret,
          'checkout-webhook-' || integration_id::text,
          'Migrated checkout webhook secret'
        );
      end if;

      insert into public.workspace_checkout_integrations (
        id,
        workspace_id,
        provider,
        label,
        status,
        auth_mode,
        webhook_secret_id,
        validated_at,
        last_event_at,
        created_by,
        created_at
      ) values (
        integration_id,
        legacy.workspace_id,
        legacy.gateway_provider,
        pg_catalog.initcap(legacy.gateway_provider::text),
        case when secret_id is null then 'pending' else 'connected' end,
        'webhook',
        secret_id,
        case when secret_id is null then null else legacy.created_at end,
        legacy.gateway_last_event_at,
        legacy.created_by,
        legacy.created_at
      );
    end if;

    update public.project_checkout_bindings binding
    set checkout_integration_id = integration_id
    from public.projects project
    where binding.project_id = project.id
      and project.workspace_id = legacy.workspace_id
      and binding.checkout_integration_id is null;
  end loop;
end;
$$;

alter table public.workspace_checkout_integrations enable row level security;
alter table public.workspace_checkout_products enable row level security;
alter table public.workspace_checkout_offers enable row level security;
alter table public.project_checkout_products enable row level security;

-- Secret-bearing checkout tables are service-only. Browser access goes
-- through the safe read models below.
revoke all on table public.workspace_checkout_integrations
  from anon, authenticated;
revoke all on table public.workspace_checkout_products
  from anon, authenticated;
revoke all on table public.workspace_checkout_offers
  from anon, authenticated;
revoke all on table public.project_checkout_products
  from anon, authenticated;

grant all on table public.workspace_checkout_integrations to service_role;
grant all on table public.workspace_checkout_products to service_role;
grant all on table public.workspace_checkout_offers to service_role;
grant all on table public.project_checkout_products to service_role;

-- Vault access is intentionally available only to the service role through
-- these narrow functions. Secret material never appears in member read models.
create or replace function public.store_checkout_integration_secret(
  _integration_id uuid,
  _kind text,
  _secret text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
  stored_secret_id uuid;
begin
  if _kind not in ('credential', 'webhook') then
    raise exception 'Unsupported checkout secret kind';
  end if;

  select case
    when _kind = 'credential' then integration.credential_secret_id
    else integration.webhook_secret_id
  end
  into current_secret_id
  from public.workspace_checkout_integrations integration
  where integration.id = _integration_id
  for update;

  if not found then
    raise exception 'Checkout integration not found';
  end if;

  if nullif(pg_catalog.btrim(_secret), '') is null then
    raise exception 'Checkout secret cannot be empty';
  end if;

  if current_secret_id is null then
    stored_secret_id := vault.create_secret(
      _secret,
      'checkout-' || _kind || '-' || _integration_id::text,
      'Infinite Profit checkout integration secret'
    );
  else
    perform vault.update_secret(current_secret_id, _secret);
    stored_secret_id := current_secret_id;
  end if;

  update public.workspace_checkout_integrations integration
  set
    credential_secret_id = case
      when _kind = 'credential' then stored_secret_id
      else integration.credential_secret_id
    end,
    webhook_secret_id = case
      when _kind = 'webhook' then stored_secret_id
      else integration.webhook_secret_id
    end
  where integration.id = _integration_id;

  return stored_secret_id;
end;
$$;

create or replace function public.read_checkout_integration_secret(
  _integration_id uuid,
  _kind text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from public.workspace_checkout_integrations integration
  join vault.decrypted_secrets secret
    on secret.id = case
      when _kind = 'credential' then integration.credential_secret_id
      when _kind = 'webhook' then integration.webhook_secret_id
      else null
    end
  where integration.id = _integration_id
$$;

create or replace function public.delete_checkout_integration_secret(
  _integration_id uuid,
  _kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  select case
    when _kind = 'credential' then integration.credential_secret_id
    when _kind = 'webhook' then integration.webhook_secret_id
    else null
  end
  into current_secret_id
  from public.workspace_checkout_integrations integration
  where integration.id = _integration_id
  for update;

  if current_secret_id is not null then
    perform vault.delete_secret(current_secret_id);
  end if;

  update public.workspace_checkout_integrations integration
  set
    credential_secret_id = case
      when _kind = 'credential' then null
      else integration.credential_secret_id
    end,
    webhook_secret_id = case
      when _kind = 'webhook' then null
      else integration.webhook_secret_id
    end
  where integration.id = _integration_id;
end;
$$;

revoke all on function public.store_checkout_integration_secret(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.read_checkout_integration_secret(uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_checkout_integration_secret(uuid, text)
  from public, anon, authenticated;
grant execute on function public.store_checkout_integration_secret(uuid, text, text)
  to service_role;
grant execute on function public.read_checkout_integration_secret(uuid, text)
  to service_role;
grant execute on function public.delete_checkout_integration_secret(uuid, text)
  to service_role;

create or replace function public.save_checkout_binding(
  _workspace_id uuid,
  _project_id uuid,
  _integration_id uuid,
  _enabled boolean,
  _product_bindings jsonb default '[]'::jsonb
)
returns table (
  project_id uuid,
  webhook_token text,
  enabled boolean,
  checkout_integration_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_provider public.gateway_provider;
  selected_status text;
  front_count integer;
  invalid_count integer;
begin
  if not exists (
    select 1
    from public.projects project
    where project.id = _project_id
      and project.workspace_id = _workspace_id
  ) then
    raise exception 'Project not found in workspace';
  end if;

  select integration.provider, integration.status
    into selected_provider, selected_status
  from public.workspace_checkout_integrations integration
  where integration.id = _integration_id
    and integration.workspace_id = _workspace_id;

  if selected_provider is null then
    raise exception 'Checkout integration not found in workspace';
  end if;
  if coalesce(_enabled, true) and selected_status <> 'connected' then
    raise exception 'Checkout integration is not connected';
  end if;

  if jsonb_typeof(coalesce(_product_bindings, '[]'::jsonb)) <> 'array' then
    raise exception 'product_bindings must be an array';
  end if;

  select count(*)
    into invalid_count
  from jsonb_to_recordset(coalesce(_product_bindings, '[]'::jsonb))
    as requested(product_id uuid, offer_id uuid, role text)
  left join public.workspace_checkout_products product
    on product.id = requested.product_id
    and product.checkout_integration_id = _integration_id
  left join public.workspace_checkout_offers offer
    on offer.id = requested.offer_id
    and offer.checkout_product_id = product.id
  where product.id is null
    or requested.role not in ('front', 'order_bump', 'upsell')
    or (
      pg_catalog.upper(product.status) in (
        'DELETED',
        'INACTIVE',
        'DISABLED',
        'UNAVAILABLE'
      )
      and not exists (
        select 1
        from public.project_checkout_products existing_product
        where existing_product.project_id = _project_id
          and existing_product.checkout_product_id = product.id
      )
    )
    or (
      requested.offer_id is not null
      and (
        offer.id is null
        or (
          pg_catalog.upper(offer.status) in (
            'DELETED',
            'INACTIVE',
            'DISABLED',
            'UNAVAILABLE'
          )
          and not exists (
            select 1
            from public.project_checkout_products existing_offer
            where existing_offer.project_id = _project_id
              and existing_offer.checkout_offer_id = offer.id
          )
        )
      )
    );

  if invalid_count > 0 then
    raise exception 'Invalid checkout product binding';
  end if;

  select count(*)
    into front_count
  from jsonb_to_recordset(coalesce(_product_bindings, '[]'::jsonb))
    as requested(product_id uuid, offer_id uuid, role text)
  where requested.role = 'front';

  if selected_provider = 'hotmart' and coalesce(_enabled, true) and front_count <> 1 then
    raise exception 'Hotmart requires exactly one front product';
  end if;

  insert into public.project_checkout_bindings (
    project_id,
    checkout_integration_id,
    enabled
  ) values (
    _project_id,
    _integration_id,
    coalesce(_enabled, true)
  )
  on conflict (project_id) do update
  set
    checkout_integration_id = excluded.checkout_integration_id,
    enabled = excluded.enabled;

  delete from public.project_checkout_products project_product
  where project_product.project_id = _project_id;

  insert into public.project_checkout_products (
    project_id,
    checkout_product_id,
    checkout_offer_id,
    role
  )
  select
    _project_id,
    requested.product_id,
    requested.offer_id,
    requested.role
  from jsonb_to_recordset(coalesce(_product_bindings, '[]'::jsonb))
    as requested(product_id uuid, offer_id uuid, role text);

  return query
  select
    binding.project_id,
    binding.webhook_token,
    binding.enabled,
    binding.checkout_integration_id
  from public.project_checkout_bindings binding
  where binding.project_id = _project_id;
end;
$$;

revoke all on function public.save_checkout_binding(uuid, uuid, uuid, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_checkout_binding(uuid, uuid, uuid, boolean, jsonb)
  to service_role;

create or replace function public.list_workspace_checkout_integrations_safe(
  _workspace_id uuid
)
returns table (
  id uuid,
  workspace_id uuid,
  provider public.gateway_provider,
  label text,
  external_account_name text,
  status text,
  auth_mode text,
  has_credentials boolean,
  has_webhook_secret boolean,
  validated_at timestamptz,
  catalog_synced_at timestamptz,
  last_event_at timestamptz,
  last_backfill_at timestamptz,
  last_error_code text,
  last_error_message text,
  product_count bigint,
  bound_project_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  return query
  select
    integration.id,
    integration.workspace_id,
    integration.provider,
    integration.label,
    integration.external_account_name,
    integration.status,
    integration.auth_mode,
    integration.credential_secret_id is not null,
    integration.webhook_secret_id is not null,
    integration.validated_at,
    integration.catalog_synced_at,
    integration.last_event_at,
    integration.last_backfill_at,
    integration.last_error_code,
    integration.last_error_message,
    (
      select count(*)
      from public.workspace_checkout_products product
      where product.checkout_integration_id = integration.id
    ),
    (
      select count(*)
      from public.project_checkout_bindings binding
      where binding.checkout_integration_id = integration.id
        and binding.enabled
    )
  from public.workspace_checkout_integrations integration
  where integration.workspace_id = _workspace_id
  order by integration.created_at, integration.id;
end;
$$;

create or replace function public.list_workspace_checkout_catalog_safe(
  _workspace_id uuid
)
returns table (
  integration_id uuid,
  product_id uuid,
  provider_product_id text,
  product_ucode text,
  product_name text,
  product_status text,
  is_subscription boolean,
  currency_code text,
  offers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;

  return query
  select
    product.checkout_integration_id,
    product.id,
    product.provider_product_id,
    product.product_ucode,
    product.name,
    product.status,
    product.is_subscription,
    product.currency_code,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', offer.id,
        'code', offer.provider_offer_code,
        'name', offer.name,
        'status', offer.status,
        'price', offer.price,
        'currency_code', offer.currency_code,
        'payment_mode', offer.payment_mode,
        'is_main_offer', offer.is_main_offer
      ) order by offer.is_main_offer desc, offer.provider_offer_code)
      from public.workspace_checkout_offers offer
      where offer.checkout_product_id = product.id
    ), '[]'::jsonb)
  from public.workspace_checkout_products product
  join public.workspace_checkout_integrations integration
    on integration.id = product.checkout_integration_id
  where integration.workspace_id = _workspace_id
  order by product.name, product.id;
end;
$$;

drop function if exists public.get_funnel_checkout_binding_safe(uuid);
create function public.get_funnel_checkout_binding_safe(
  _project_id uuid
)
returns table (
  project_id uuid,
  enabled boolean,
  webhook_token text,
  checkout_integration_id uuid,
  provider public.gateway_provider,
  integration_label text,
  integration_status text,
  product_bindings jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_workspace_id uuid;
  caller_is_admin boolean;
begin
  select project.workspace_id
    into selected_workspace_id
  from public.projects project
  where project.id = _project_id;

  if selected_workspace_id is null
    or not app_private.is_workspace_member(selected_workspace_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  caller_is_admin := app_private.is_workspace_admin(selected_workspace_id);

  return query
  select
    binding.project_id,
    binding.enabled,
    case when caller_is_admin then binding.webhook_token else null end,
    binding.checkout_integration_id,
    integration.provider,
    integration.label,
    integration.status,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', project_product.checkout_product_id,
        'offer_id', project_product.checkout_offer_id,
        'role', project_product.role
      ) order by
        case project_product.role
          when 'front' then 1
          when 'order_bump' then 2
          else 3
        end,
        project_product.checkout_product_id
      )
      from public.project_checkout_products project_product
      where project_product.project_id = binding.project_id
    ), '[]'::jsonb)
  from public.project_checkout_bindings binding
  left join public.workspace_checkout_integrations integration
    on integration.id = binding.checkout_integration_id
  where binding.project_id = _project_id;
end;
$$;

revoke all on function public.list_workspace_checkout_integrations_safe(uuid)
  from public, anon;
revoke all on function public.list_workspace_checkout_catalog_safe(uuid)
  from public, anon;
revoke all on function public.get_funnel_checkout_binding_safe(uuid)
  from public, anon;
grant execute on function public.list_workspace_checkout_integrations_safe(uuid)
  to authenticated, service_role;
grant execute on function public.list_workspace_checkout_catalog_safe(uuid)
  to authenticated, service_role;
grant execute on function public.get_funnel_checkout_binding_safe(uuid)
  to authenticated, service_role;

alter table public.sync_jobs
  drop constraint if exists sync_jobs_entity_type_check;
alter table public.sync_jobs
  add constraint sync_jobs_entity_type_check
  check (
    entity_type in (
      'meta_account',
      'vturb_player',
      'hubla_reconcile',
      'hotmart_catalog',
      'hotmart_sales_backfill',
      'aggregate_project_dates',
      'creative_project'
    )
  );

-- The table-returning function exposes `project_id` as an output variable.
-- `on conflict (project_id)` was therefore ambiguous inside PL/pgSQL.
-- Target the existing primary-key constraint explicitly.

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

  if selected_provider = 'hotmart'
    and coalesce(_enabled, true)
    and front_count <> 1 then
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
  on conflict on constraint project_checkout_bindings_pkey do update
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

revoke all on function public.save_checkout_binding(
  uuid,
  uuid,
  uuid,
  boolean,
  jsonb
) from public, anon, authenticated;
grant execute on function public.save_checkout_binding(
  uuid,
  uuid,
  uuid,
  boolean,
  jsonb
) to service_role;

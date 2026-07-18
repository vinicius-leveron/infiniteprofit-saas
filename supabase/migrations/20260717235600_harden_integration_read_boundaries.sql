-- Keep operational credentials behind explicit, permission-aware contracts.
-- Browser clients must never read the secret-bearing tables directly.

create or replace function public.get_workspace_integration_safe(
  _workspace_id uuid
)
returns table (
  workspace_id uuid,
  vturb_last_event_at timestamptz,
  gateway_provider public.gateway_provider,
  gateway_webhook_token text,
  gateway_last_event_at timestamptz,
  has_vturb_api_key boolean,
  has_gateway_secret boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied'
      using errcode = '42501';
  end if;

  caller_is_admin := app_private.is_workspace_admin(_workspace_id);

  return query
  select
    integration.workspace_id,
    integration.vturb_last_event_at,
    integration.gateway_provider,
    case
      when caller_is_admin then integration.gateway_webhook_token
      else null
    end,
    integration.gateway_last_event_at,
    nullif(pg_catalog.btrim(integration.vturb_api_key), '') is not null,
    nullif(pg_catalog.btrim(integration.gateway_webhook_secret), '') is not null
  from public.workspace_integrations integration
  where integration.workspace_id = _workspace_id;
end;
$$;

comment on function public.get_workspace_integration_safe(uuid) is
  'Returns non-secret integration metadata to members and the persisted webhook token only to effective workspace admins.';

revoke all on function public.get_workspace_integration_safe(uuid)
  from public, anon;
grant execute on function public.get_workspace_integration_safe(uuid)
  to authenticated, service_role;

create or replace function public.list_workspace_meta_accounts_safe(
  _workspace_id uuid
)
returns table (
  id uuid,
  workspace_id uuid,
  account_id text,
  label text,
  last_synced_at timestamptz,
  created_at timestamptz,
  has_access_token boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied'
      using errcode = '42501';
  end if;

  return query
  select
    account.id,
    account.workspace_id,
    account.account_id,
    account.label,
    account.last_synced_at,
    account.created_at,
    nullif(pg_catalog.btrim(account.access_token), '') is not null
  from public.workspace_meta_accounts account
  where account.workspace_id = _workspace_id
  order by account.created_at asc, account.id asc;
end;
$$;

comment on function public.list_workspace_meta_accounts_safe(uuid) is
  'Returns the member-visible Meta account catalog without access tokens.';

revoke all on function public.list_workspace_meta_accounts_safe(uuid)
  from public, anon;
grant execute on function public.list_workspace_meta_accounts_safe(uuid)
  to authenticated, service_role;

create or replace function public.list_workspace_checkout_bindings_safe(
  _workspace_id uuid
)
returns table (
  project_id uuid,
  enabled boolean,
  webhook_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_is_admin boolean;
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception 'Workspace access denied'
      using errcode = '42501';
  end if;

  caller_is_admin := app_private.is_workspace_admin(_workspace_id);

  return query
  select
    binding.project_id,
    binding.enabled,
    case
      when caller_is_admin then binding.webhook_token
      else null
    end
  from public.project_checkout_bindings binding
  join public.projects project
    on project.id = binding.project_id
  where project.workspace_id = _workspace_id
  order by project.updated_at desc, binding.project_id;
end;
$$;

comment on function public.list_workspace_checkout_bindings_safe(uuid) is
  'Returns checkout configuration to members and webhook tokens only to effective workspace admins.';

revoke all on function public.list_workspace_checkout_bindings_safe(uuid)
  from public, anon;
grant execute on function public.list_workspace_checkout_bindings_safe(uuid)
  to authenticated, service_role;

create or replace function public.get_funnel_checkout_binding_safe(
  _project_id uuid
)
returns table (
  project_id uuid,
  enabled boolean,
  webhook_token text
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
    raise exception 'Project access denied'
      using errcode = '42501';
  end if;

  caller_is_admin := app_private.is_workspace_admin(selected_workspace_id);

  return query
  select
    binding.project_id,
    binding.enabled,
    case
      when caller_is_admin then binding.webhook_token
      else null
    end
  from public.project_checkout_bindings binding
  where binding.project_id = _project_id;
end;
$$;

comment on function public.get_funnel_checkout_binding_safe(uuid) is
  'Returns checkout state to project members and the webhook token only to effective workspace admins.';

revoke all on function public.get_funnel_checkout_binding_safe(uuid)
  from public, anon;
grant execute on function public.get_funnel_checkout_binding_safe(uuid)
  to authenticated, service_role;

create or replace function public.get_project_sync_settings_safe(
  _project_id uuid
)
returns table (
  project_id uuid,
  sheet_url text,
  sync_token text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_workspace_id uuid;
begin
  select project.workspace_id
    into selected_workspace_id
  from public.projects project
  where project.id = _project_id;

  if selected_workspace_id is null
    or not app_private.is_workspace_admin(selected_workspace_id) then
    raise exception 'Project administration access denied'
      using errcode = '42501';
  end if;

  return query
  select project.id, project.sheet_url, project.sync_token
  from public.projects project
  where project.id = _project_id;
end;
$$;

comment on function public.get_project_sync_settings_safe(uuid) is
  'Returns sheet synchronization credentials only to effective workspace admins.';

revoke all on function public.get_project_sync_settings_safe(uuid)
  from public, anon;
grant execute on function public.get_project_sync_settings_safe(uuid)
  to authenticated, service_role;

create or replace function app_private.can_bind_meta_account(
  _meta_account_id uuid,
  _workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.is_workspace_admin(_workspace_id)
    and exists (
      select 1
      from public.workspace_meta_accounts account
      where account.id = _meta_account_id
        and account.workspace_id = _workspace_id
    );
$$;

revoke all on function app_private.can_bind_meta_account(uuid, uuid)
  from public, anon;
grant execute on function app_private.can_bind_meta_account(uuid, uuid)
  to authenticated, service_role;

alter policy "Workspace admins can manage project meta bindings"
  on public.project_meta_accounts
  with check (
    exists (
      select 1
      from public.projects project
      where project.id = project_id
        and app_private.can_bind_meta_account(
          meta_account_id,
          project.workspace_id
        )
    )
  );

create or replace function public.delete_workspace_meta_account(
  _workspace_id uuid,
  _meta_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if exists (
    select 1
    from public.project_meta_accounts binding
    join public.projects project
      on project.id = binding.project_id
    where binding.meta_account_id = _meta_account_id
      and project.workspace_id = _workspace_id
  ) then
    raise exception 'Meta account is still linked to one or more funnels'
      using errcode = '23503';
  end if;

  delete from public.workspace_meta_accounts account
  where account.id = _meta_account_id
    and account.workspace_id = _workspace_id
  returning account.id into deleted_id;

  if deleted_id is null then
    raise exception 'Meta account not found in workspace'
      using errcode = 'P0002';
  end if;

  return deleted_id;
end;
$$;

comment on function public.delete_workspace_meta_account(uuid, uuid) is
  'Service-only atomic deletion that refuses to remove Meta accounts still linked to a funnel.';

revoke all on function public.delete_workspace_meta_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_workspace_meta_account(uuid, uuid)
  to service_role;

drop policy if exists "Workspace members can view workspace integrations"
  on public.workspace_integrations;
drop policy if exists "Workspace members can view workspace meta accounts"
  on public.workspace_meta_accounts;
drop policy if exists "Workspace members can view checkout bindings"
  on public.project_checkout_bindings;

alter policy "Workspace members can view public project links"
  on public.project_public_links
  using (
    exists (
      select 1
      from public.projects project
      where project.id = project_id
        and app_private.is_workspace_admin(project.workspace_id)
    )
  );

revoke select on table public.workspace_integrations
  from public, anon, authenticated;
revoke select on table public.workspace_meta_accounts
  from public, anon, authenticated;
revoke select on table public.project_checkout_bindings
  from public, anon, authenticated;

revoke select on table public.projects
  from public, anon, authenticated;
grant select (
  id,
  user_id,
  workspace_id,
  name,
  source,
  file_name,
  csv_content,
  sheet_url,
  last_synced_at,
  created_at,
  updated_at
) on table public.projects to authenticated;

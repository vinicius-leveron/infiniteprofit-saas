-- Transactional account bootstrap, inherited organization access, and safe
-- member/invite directories for the administrative UI.

create or replace function app_private.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = ws_id
      and member.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.workspaces workspace
    join public.organization_members member
      on member.organization_id = workspace.organization_id
    where workspace.id = ws_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  );
$$;

create or replace function app_private.is_workspace_admin(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = ws_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.workspaces workspace
    join public.organization_members member
      on member.organization_id = workspace.organization_id
    where workspace.id = ws_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  );
$$;

revoke all on function app_private.is_workspace_member(uuid) from public, anon;
revoke all on function app_private.is_workspace_admin(uuid) from public, anon;
grant execute on function app_private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app_private.is_workspace_admin(uuid) to authenticated, service_role;

create or replace function app_private.has_workspace_in_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces workspace
    join public.workspace_members member
      on member.workspace_id = workspace.id
    where workspace.organization_id = org_id
      and member.user_id = (select auth.uid())
  );
$$;

revoke all on function app_private.has_workspace_in_organization(uuid)
  from public, anon;
grant execute on function app_private.has_workspace_in_organization(uuid)
  to authenticated, service_role;

alter policy "Authenticated users can view accessible organizations"
on public.organizations
using (
  app_private.is_org_member(id)
  or created_by = (select auth.uid())
  or app_private.has_workspace_in_organization(id)
);

create or replace function public.bootstrap_account(
  _workspace_name text,
  _organization_name text default null,
  _organization_id uuid default null
)
returns table (
  organization_id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_organization_id uuid;
  selected_workspace_id uuid;
  clean_organization_name text := nullif(pg_catalog.btrim(_organization_name), '');
  clean_workspace_name text := nullif(pg_catalog.btrim(_workspace_name), '');
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Not authenticated';
  end if;

  if clean_workspace_name is null then
    raise exception using
      errcode = '22023',
      message = 'Workspace name is required';
  end if;

  -- Serializes retries and double-clicks from the same user. Because the
  -- function reuses an existing organization/workspace, the operation remains
  -- idempotent if the network response is lost after commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  if _organization_id is not null then
    select organization.id
      into selected_organization_id
    from public.organizations organization
    join public.organization_members member
      on member.organization_id = organization.id
    where organization.id = _organization_id
      and member.user_id = current_user_id
      and member.role in ('owner', 'admin')
    limit 1;

    if selected_organization_id is null then
      raise exception using
        errcode = '42501',
        message = 'Organization access denied';
    end if;
  else
    select organization.id
      into selected_organization_id
    from public.organizations organization
    join public.organization_members member
      on member.organization_id = organization.id
    where member.user_id = current_user_id
      and member.role in ('owner', 'admin')
    order by organization.created_at, organization.id
    limit 1;

    if selected_organization_id is null then
      if clean_organization_name is null then
        raise exception using
          errcode = '22023',
          message = 'Organization name is required';
      end if;

      insert into public.organizations (name, created_by)
      values (clean_organization_name, current_user_id)
      returning id into selected_organization_id;

      insert into public.organization_members (organization_id, user_id, role)
      values (selected_organization_id, current_user_id, 'owner')
      on conflict (organization_id, user_id) do nothing;
    end if;
  end if;

  select workspace.id
    into selected_workspace_id
  from public.workspaces workspace
  where workspace.organization_id = selected_organization_id
  order by workspace.created_at, workspace.id
  limit 1;

  if selected_workspace_id is null then
    insert into public.workspaces (organization_id, name, created_by)
    values (selected_organization_id, clean_workspace_name, current_user_id)
    returning id into selected_workspace_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (selected_workspace_id, current_user_id, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return query
  select selected_organization_id, selected_workspace_id;
end;
$$;

revoke all on function public.bootstrap_account(text, text, uuid) from public, anon;
grant execute on function public.bootstrap_account(text, text, uuid)
  to authenticated, service_role;

create or replace function public.list_organization_access_directory(
  _organization_id uuid
)
returns table (
  entry_id uuid,
  entry_type text,
  full_name text,
  email text,
  role text,
  access_origin text,
  status text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_org_member(_organization_id) then
    raise exception using
      errcode = '42501',
      message = 'Organization access denied';
  end if;

  return query
  select
    directory.entry_id,
    directory.entry_type,
    directory.full_name,
    directory.email,
    directory.role,
    directory.access_origin,
    directory.status,
    directory.expires_at
  from (
    select
      member.user_id as entry_id,
      'member'::text as entry_type,
      coalesce(
        nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'full_name'), ''),
        nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'name'), ''),
        pg_catalog.split_part(account.email, '@', 1)
      ) as full_name,
      account.email::text as email,
      member.role::text as role,
      'organization'::text as access_origin,
      'active'::text as status,
      null::timestamptz as expires_at
    from public.organization_members member
    join auth.users account on account.id = member.user_id
    where member.organization_id = _organization_id

    union all

    select
      invite.id as entry_id,
      'invite'::text as entry_type,
      null::text as full_name,
      invite.email,
      invite.role::text,
      'organization'::text as access_origin,
      case
        when invite.accepted_at is not null then 'accepted'
        when invite.revoked_at is not null then 'revoked'
        when invite.expires_at <= pg_catalog.now() then 'expired'
        else 'pending'
      end::text as status,
      invite.expires_at
    from public.organization_invites invite
    where invite.organization_id = _organization_id
  ) directory
  order by directory.entry_type, directory.full_name nulls last, directory.email;
end;
$$;

create or replace function public.list_workspace_access_directory(
  _workspace_id uuid
)
returns table (
  entry_id uuid,
  entry_type text,
  full_name text,
  email text,
  role text,
  access_origin text,
  status text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_workspace_member(_workspace_id) then
    raise exception using
      errcode = '42501',
      message = 'Workspace access denied';
  end if;

  return query
  with workspace_context as (
    select workspace.organization_id
    from public.workspaces workspace
    where workspace.id = _workspace_id
  ),
  access_candidates as (
    select
      member.user_id,
      member.role::text as role,
      'workspace'::text as access_origin,
      case member.role::text
        when 'owner' then 4
        when 'admin' then 3
        when 'moderator' then 2
        else 1
      end as role_weight
    from public.workspace_members member
    where member.workspace_id = _workspace_id

    union all

    select
      member.user_id,
      member.role::text as role,
      'organization'::text as access_origin,
      case member.role::text
        when 'owner' then 4
        else 3
      end as role_weight
    from public.organization_members member
    join workspace_context context
      on context.organization_id = member.organization_id
    where member.role in ('owner', 'admin')
  ),
  effective_access as (
    select distinct on (candidate.user_id)
      candidate.user_id,
      candidate.role,
      candidate.access_origin
    from access_candidates candidate
    order by
      candidate.user_id,
      candidate.role_weight desc,
      case candidate.access_origin when 'workspace' then 0 else 1 end
  )
  select
    directory.entry_id,
    directory.entry_type,
    directory.full_name,
    directory.email,
    directory.role,
    directory.access_origin,
    directory.status,
    directory.expires_at
  from (
    select
      access.user_id as entry_id,
      'member'::text as entry_type,
      coalesce(
        nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'full_name'), ''),
        nullif(pg_catalog.btrim(account.raw_user_meta_data ->> 'name'), ''),
        pg_catalog.split_part(account.email, '@', 1)
      ) as full_name,
      account.email::text as email,
      access.role,
      access.access_origin,
      'active'::text as status,
      null::timestamptz as expires_at
    from effective_access access
    join auth.users account on account.id = access.user_id

    union all

    select
      invite.id as entry_id,
      'invite'::text as entry_type,
      null::text as full_name,
      invite.email,
      invite.role::text,
      'workspace'::text as access_origin,
      case
        when invite.accepted_at is not null then 'accepted'
        when invite.revoked_at is not null then 'revoked'
        when invite.expires_at <= pg_catalog.now() then 'expired'
        else 'pending'
      end::text as status,
      invite.expires_at
    from public.workspace_invites invite
    where invite.workspace_id = _workspace_id
      and app_private.is_workspace_admin(_workspace_id)
  ) directory
  order by directory.entry_type, directory.full_name nulls last, directory.email;
end;
$$;

revoke all on function public.list_organization_access_directory(uuid) from public, anon;
revoke all on function public.list_workspace_access_directory(uuid) from public, anon;
grant execute on function public.list_organization_access_directory(uuid)
  to authenticated, service_role;
grant execute on function public.list_workspace_access_directory(uuid)
  to authenticated, service_role;

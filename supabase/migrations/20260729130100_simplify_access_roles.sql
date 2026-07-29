-- Daily operation exposes only Admin and Member. Organization Owner remains
-- the internal principal administrator and is changed only by a dedicated
-- ownership-transfer flow.

update public.workspace_members
set role = 'member'
where role = 'moderator';

update public.workspace_invites
set role = 'member'
where role = 'moderator';

update public.workspace_members
set role = 'admin'
where role = 'owner';

update public.workspace_invites
set role = 'admin'
where role = 'owner';

create or replace function app_private.normalize_workspace_operational_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role in ('owner', 'moderator') then
    new.role := case when new.role = 'owner' then 'admin' else 'member' end;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_workspace_operational_role
  on public.workspace_members;
create trigger normalize_workspace_operational_role
before insert or update of role on public.workspace_members
for each row execute function app_private.normalize_workspace_operational_role();

drop trigger if exists normalize_workspace_invite_operational_role
  on public.workspace_invites;
create trigger normalize_workspace_invite_operational_role
before insert or update of role on public.workspace_invites
for each row execute function app_private.normalize_workspace_operational_role();

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
      and member.role in ('owner', 'admin', 'member')
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
      and member.role in ('admin')
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

drop policy if exists "Workspace members can update daily metrics" on public.daily_metrics;
create policy "Workspace admins can update daily metrics"
on public.daily_metrics for update to authenticated
using (app_private.is_workspace_admin(workspace_id))
with check (app_private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace members can view raw events" on public.raw_events;
create policy "Workspace admins can view raw events"
on public.raw_events for select to authenticated
using (app_private.is_workspace_admin(workspace_id));

drop policy if exists "Org members can view organization members"
  on public.organization_members;
create policy "Organization admins view team; members view self"
on public.organization_members for select to authenticated
using (
  user_id = (select auth.uid())
  or app_private.is_org_admin(organization_id)
);

drop policy if exists "Workspace members or org admins can view workspace members"
  on public.workspace_members;
create policy "Workspace admins view team; members view self"
on public.workspace_members for select to authenticated
using (
  user_id = (select auth.uid())
  or app_private.is_workspace_admin(workspace_id)
);

create or replace function public.manage_scope_member(
  p_scope_type text,
  p_scope_id uuid,
  p_user_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_role text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_role text;
  v_owner_count bigint;
begin
  if p_scope_type not in ('organization', 'workspace') then
    raise exception using errcode = '22023', message = 'Invalid membership scope';
  end if;
  if p_action not in ('update', 'remove') then
    raise exception using errcode = '22023', message = 'Invalid membership action';
  end if;

  if p_scope_type = 'organization' then
    perform 1 from public.organizations where id = p_scope_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Organization not found'; end if;
    select role::text into v_previous_role
    from public.organization_members
    where organization_id = p_scope_id and user_id = p_user_id;
  else
    perform 1 from public.workspaces where id = p_scope_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Workspace not found'; end if;
    select role::text into v_previous_role
    from public.workspace_members
    where workspace_id = p_scope_id and user_id = p_user_id;
  end if;

  if v_previous_role is null then
    raise exception using errcode = 'P0002', message = 'Direct member not found';
  end if;

  if p_action = 'update' then
    if p_scope_type = 'organization' and p_role not in ('admin', 'member') then
      raise exception using errcode = '22023', message = 'Invalid organization role';
    end if;
    if p_scope_type = 'workspace' and p_role not in ('admin', 'member') then
      raise exception using errcode = '22023', message = 'Invalid workspace role';
    end if;
  end if;

  if p_scope_type = 'organization' and v_previous_role = 'owner' then
    select count(*) into v_owner_count
    from public.organization_members
    where organization_id = p_scope_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception using errcode = '23514', message = 'Use the ownership transfer flow';
    end if;
  end if;

  if p_scope_type = 'organization' then
    if p_action = 'update' then
      update public.organization_members
      set role = p_role::public.organization_role
      where organization_id = p_scope_id and user_id = p_user_id;
    else
      delete from public.organization_members
      where organization_id = p_scope_id and user_id = p_user_id;
    end if;
  else
    if p_action = 'update' then
      update public.workspace_members
      set role = p_role::public.workspace_role
      where workspace_id = p_scope_id and user_id = p_user_id;
    else
      delete from public.workspace_members
      where workspace_id = p_scope_id and user_id = p_user_id;
    end if;
  end if;

  insert into public.access_audit_events (
    scope_type, scope_id, action, actor_user_id, subject_user_id,
    previous_role, next_role
  ) values (
    p_scope_type, p_scope_id,
    case when p_action = 'update' then 'member_role_updated' else 'member_removed' end,
    p_actor_user_id, p_user_id, v_previous_role,
    case when p_action = 'update' then p_role else null end
  );

  return v_previous_role;
end;
$$;

revoke all on function public.manage_scope_member(text, uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.manage_scope_member(text, uuid, uuid, text, uuid, text)
  to service_role;

create or replace function public.transfer_organization_ownership(
  p_organization_id uuid,
  p_new_owner_user_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.organization_members
  where organization_id = p_organization_id
  for update;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_actor_user_id
      and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Only the current Owner can transfer ownership';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_new_owner_user_id
      and role = 'admin'
  ) then
    raise exception using errcode = '22023', message = 'The new Owner must be an existing Admin';
  end if;

  update public.organization_members
  set role = 'admin'
  where organization_id = p_organization_id
    and user_id = p_actor_user_id;

  update public.organization_members
  set role = 'owner'
  where organization_id = p_organization_id
    and user_id = p_new_owner_user_id;

  insert into public.access_audit_events (
    scope_type, scope_id, action, actor_user_id, subject_user_id,
    previous_role, next_role
  ) values (
    'organization', p_organization_id, 'ownership_transferred',
    p_actor_user_id, p_new_owner_user_id, 'admin', 'owner'
  );
end;
$$;

revoke all on function public.transfer_organization_ownership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transfer_organization_ownership(uuid, uuid, uuid)
  to service_role;

-- Team directories contain names, email addresses and invitations. They are
-- administrative contracts, so inherited Members must not be able to call
-- them even though they can read dashboards across the Organization.
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
  if not app_private.is_org_admin(_organization_id) then
    raise exception using errcode = '42501', message = 'Organization administration denied';
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
      invite.id,
      'invite'::text,
      null::text,
      invite.email,
      invite.role::text,
      'organization'::text,
      case
        when invite.accepted_at is not null then 'accepted'
        when invite.revoked_at is not null then 'revoked'
        when invite.expires_at <= pg_catalog.now() then 'expired'
        else 'pending'
      end::text,
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
  if not app_private.is_workspace_admin(_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace administration denied';
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
        else 1
      end as role_weight
    from public.workspace_members member
    where member.workspace_id = _workspace_id

    union all

    select
      member.user_id,
      member.role::text,
      'organization'::text,
      case member.role::text
        when 'owner' then 4
        when 'admin' then 3
        else 1
      end
    from public.organization_members member
    join workspace_context context
      on context.organization_id = member.organization_id
    where member.role in ('owner', 'admin', 'member')
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
      invite.id,
      'invite'::text,
      null::text,
      invite.email,
      invite.role::text,
      'workspace'::text,
      case
        when invite.accepted_at is not null then 'accepted'
        when invite.revoked_at is not null then 'revoked'
        when invite.expires_at <= pg_catalog.now() then 'expired'
        else 'pending'
      end::text,
      invite.expires_at
    from public.workspace_invites invite
    where invite.workspace_id = _workspace_id
  ) directory
  order by directory.entry_type, directory.full_name nulls last, directory.email;
end;
$$;

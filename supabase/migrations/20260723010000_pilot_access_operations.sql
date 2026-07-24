alter table public.organization_invites
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_error text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0;

alter table public.workspace_invites
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_error text,
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'organization_invites_delivery_status_check'
  ) then
    alter table public.organization_invites
      add constraint organization_invites_delivery_status_check
      check (delivery_status in ('pending', 'sent', 'failed'));
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'workspace_invites_delivery_status_check'
  ) then
    alter table public.workspace_invites
      add constraint workspace_invites_delivery_status_check
      check (delivery_status in ('pending', 'sent', 'failed'));
  end if;
end;
$$;

create table if not exists public.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('organization', 'workspace')),
  scope_id uuid not null,
  action text not null check (
    action in (
      'invite_created',
      'invite_resent',
      'invite_revoked',
      'member_role_updated',
      'member_removed'
    )
  ),
  -- Keep immutable actor/subject identifiers even when an Auth user is deleted.
  -- Foreign-key cascades would conflict with the append-only audit trigger below.
  actor_user_id uuid not null,
  subject_user_id uuid,
  subject_invite_id uuid,
  previous_role text,
  next_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint access_audit_events_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint access_audit_events_metadata_size
    check (pg_column_size(metadata) <= 2048)
);

create index if not exists access_audit_events_scope_created_idx
  on public.access_audit_events (scope_type, scope_id, created_at desc);

create index if not exists access_audit_events_actor_created_idx
  on public.access_audit_events (actor_user_id, created_at desc);

alter table public.access_audit_events enable row level security;

revoke all on table public.access_audit_events from public, anon, authenticated;
grant all on table public.access_audit_events to service_role;

comment on table public.access_audit_events is
  'Append-only audit trail for access operations. Email bodies, tokens and provider secrets are forbidden.';

create or replace function app_private.prevent_access_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Access audit events are append-only';
end;
$$;

drop trigger if exists prevent_access_audit_mutation
  on public.access_audit_events;
create trigger prevent_access_audit_mutation
  before update or delete on public.access_audit_events
  for each row execute function app_private.prevent_access_audit_mutation();

-- Membership changes must go through the service-only operation below. Besides
-- centralizing role validation, locking the scope row makes the last-owner
-- invariant safe when two administrators act concurrently.
drop policy if exists "Org admins can manage organization members"
  on public.organization_members;
drop policy if exists "Org admins can delete organization members"
  on public.organization_members;
drop policy if exists "Workspace admins or org admins can update workspace members"
  on public.workspace_members;
drop policy if exists "Workspace admins or org admins can delete workspace members"
  on public.workspace_members;
drop policy if exists "Org admins can create organization invites"
  on public.organization_invites;
drop policy if exists "Org admins can update organization invites"
  on public.organization_invites;
drop policy if exists "Workspace admins or org admins can create workspace invites"
  on public.workspace_invites;
drop policy if exists "Workspace admins or org admins can update workspace invites"
  on public.workspace_invites;

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
    perform 1
    from public.organizations
    where id = p_scope_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Organization not found';
    end if;

    select role::text
    into v_previous_role
    from public.organization_members
    where organization_id = p_scope_id
      and user_id = p_user_id;
  else
    perform 1
    from public.workspaces
    where id = p_scope_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Workspace not found';
    end if;

    select role::text
    into v_previous_role
    from public.workspace_members
    where workspace_id = p_scope_id
      and user_id = p_user_id;
  end if;

  if v_previous_role is null then
    raise exception using errcode = 'P0002', message = 'Direct member not found';
  end if;

  if p_action = 'update' then
    if p_role is null then
      raise exception using errcode = '22023', message = 'Role is required';
    end if;
    if p_scope_type = 'organization' and p_role not in ('owner', 'admin') then
      raise exception using errcode = '22023', message = 'Invalid organization role';
    end if;
    if p_scope_type = 'workspace'
       and p_role not in ('owner', 'admin', 'moderator', 'member') then
      raise exception using errcode = '22023', message = 'Invalid workspace role';
    end if;
  end if;

  if v_previous_role = 'owner'
     and (p_action = 'remove' or p_role is distinct from 'owner') then
    if p_scope_type = 'organization' then
      select count(*)
      into v_owner_count
      from public.organization_members
      where organization_id = p_scope_id
        and role = 'owner';
    else
      select count(*)
      into v_owner_count
      from public.workspace_members
      where workspace_id = p_scope_id
        and role = 'owner';
    end if;

    if v_owner_count <= 1 then
      raise exception using
        errcode = '23514',
        message = 'The last Owner cannot be removed or demoted';
    end if;
  end if;

  if p_scope_type = 'organization' then
    if p_action = 'update' then
      update public.organization_members
      set role = p_role::public.organization_role
      where organization_id = p_scope_id
        and user_id = p_user_id;
    else
      delete from public.organization_members
      where organization_id = p_scope_id
        and user_id = p_user_id;
    end if;
  else
    if p_action = 'update' then
      update public.workspace_members
      set role = p_role::public.workspace_role
      where workspace_id = p_scope_id
        and user_id = p_user_id;
    else
      delete from public.workspace_members
      where workspace_id = p_scope_id
        and user_id = p_user_id;
    end if;
  end if;

  insert into public.access_audit_events (
    scope_type,
    scope_id,
    action,
    actor_user_id,
    subject_user_id,
    previous_role,
    next_role
  )
  values (
    p_scope_type,
    p_scope_id,
    case
      when p_action = 'update' then 'member_role_updated'
      else 'member_removed'
    end,
    p_actor_user_id,
    p_user_id,
    v_previous_role,
    case when p_action = 'update' then p_role else null end
  );

  return v_previous_role;
end;
$$;

revoke all on function public.manage_scope_member(
  text,
  uuid,
  uuid,
  text,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.manage_scope_member(
  text,
  uuid,
  uuid,
  text,
  uuid,
  text
) to service_role;

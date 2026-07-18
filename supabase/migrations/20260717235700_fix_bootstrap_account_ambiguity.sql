-- Output column names in a RETURNS TABLE function are PL/pgSQL variables.
-- Referencing organization_id/workspace_id in ON CONFLICT column lists made
-- bootstrap_account fail at runtime with SQLSTATE 42702.

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
      on conflict on constraint organization_members_pkey do nothing;
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
    on conflict on constraint workspace_members_pkey do nothing;
  end if;

  return query
  select selected_organization_id, selected_workspace_id;
end;
$$;

revoke all on function public.bootstrap_account(text, text, uuid)
  from public, anon;
grant execute on function public.bootstrap_account(text, text, uuid)
  to authenticated, service_role;

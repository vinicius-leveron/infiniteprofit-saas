-- Optimize tenancy helper functions used by RLS policies.
--
-- Supabase performance advisor flags policies when auth.uid() is evaluated per
-- row. Wrapping the call in a scalar SELECT lets Postgres initplan it once per
-- statement. Keep all object references schema-qualified because these
-- SECURITY DEFINER helpers run with an empty search_path.

create or replace function app_private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function app_private.is_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function app_private.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
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
    from public.workspace_members m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function app_private.is_org_admin_for_workspace(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members m
      on m.organization_id = w.organization_id
    where w.id = ws_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function app_private.is_org_member(uuid) from public, anon;
revoke all on function app_private.is_org_admin(uuid) from public, anon;
revoke all on function app_private.is_workspace_member(uuid) from public, anon;
revoke all on function app_private.is_workspace_admin(uuid) from public, anon;
revoke all on function app_private.is_org_admin_for_workspace(uuid) from public, anon;

grant execute on function app_private.is_org_member(uuid) to authenticated, service_role;
grant execute on function app_private.is_org_admin(uuid) to authenticated, service_role;
grant execute on function app_private.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app_private.is_workspace_admin(uuid) to authenticated, service_role;
grant execute on function app_private.is_org_admin_for_workspace(uuid) to authenticated, service_role;

-- Rewrite direct auth.uid() uses in hot RLS policies.

alter policy "Users view own integrations"
on public.integrations
using ((select auth.uid()) = user_id);

alter policy "Users insert own integrations"
on public.integrations
with check ((select auth.uid()) = user_id);

alter policy "Users update own integrations"
on public.integrations
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Users delete own integrations"
on public.integrations
using ((select auth.uid()) = user_id);

alter policy "Users view own meta accounts"
on public.meta_accounts
using ((select auth.uid()) = user_id);

alter policy "Users insert own meta accounts"
on public.meta_accounts
with check ((select auth.uid()) = user_id);

alter policy "Users update own meta accounts"
on public.meta_accounts
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Users delete own meta accounts"
on public.meta_accounts
using ((select auth.uid()) = user_id);

alter policy "Users view own vturb players"
on public.vturb_players
using ((select auth.uid()) = user_id);

alter policy "Users insert own vturb players"
on public.vturb_players
with check ((select auth.uid()) = user_id);

alter policy "Users update own vturb players"
on public.vturb_players
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter policy "Users delete own vturb players"
on public.vturb_players
using ((select auth.uid()) = user_id);

alter policy "Authenticated users can create organizations"
on public.organizations
with check ((select auth.uid()) = created_by);

drop policy if exists "Creators can view owned organizations" on public.organizations;
drop policy if exists "Org members can view organizations" on public.organizations;

create policy "Authenticated users can view accessible organizations"
on public.organizations for select
to authenticated
using (
  app_private.is_org_member(id)
  or created_by = (select auth.uid())
);

alter policy "Creators can add initial organization ownership"
on public.organization_members
with check (
  (select auth.uid()) = user_id
  and role = 'owner'::public.organization_role
  and exists (
    select 1
    from public.organizations o
    where o.id = organization_members.organization_id
      and o.created_by = (select auth.uid())
  )
);

alter policy "Org admins can create organization invites"
on public.organization_invites
with check (
  app_private.is_org_admin(organization_id)
  and (select auth.uid()) = created_by
);

alter policy "Org admins can create workspaces"
on public.workspaces
with check (
  app_private.is_org_admin(organization_id)
  and (select auth.uid()) = created_by
);

alter policy "Creators can add initial workspace ownership"
on public.workspace_members
with check (
  (select auth.uid()) = user_id
  and role = 'owner'::public.workspace_role
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = (select auth.uid())
  )
);

alter policy "Workspace admins or org admins can create workspace invites"
on public.workspace_invites
with check (
  (
    app_private.is_workspace_admin(workspace_id)
    or app_private.is_org_admin_for_workspace(workspace_id)
  )
  and (select auth.uid()) = created_by
);

alter policy "Workspace admins can create projects"
on public.projects
with check (
  app_private.is_workspace_admin(workspace_id)
  and (select auth.uid()) = user_id
);

alter policy "Workspace members can create simulations"
on public.simulations
with check (
  app_private.is_workspace_member(workspace_id)
  and (select auth.uid()) = user_id
);

alter policy "Workspace admins can manage workspace integrations"
on public.workspace_integrations
with check (
  app_private.is_workspace_admin(workspace_id)
  and (select auth.uid()) = created_by
);

alter policy "Workspace admins can manage workspace meta accounts"
on public.workspace_meta_accounts
with check (
  app_private.is_workspace_admin(workspace_id)
  and (select auth.uid()) = created_by
);

alter policy "Workspace admins can manage workspace vturb players"
on public.workspace_vturb_players
with check (
  app_private.is_workspace_admin(workspace_id)
  and (select auth.uid()) = created_by
);

alter policy "Workspace admins can create sync runs"
on public.sync_runs
with check (
  app_private.is_workspace_admin(workspace_id)
  and (
    initiated_by is null
    or initiated_by = (select auth.uid())
  )
);

alter policy "Workspace admins can manage creative assets"
on public.creative_assets
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can manage creative asset ads"
on public.creative_asset_ads
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can manage creative asset daily metrics"
on public.creative_asset_daily_metrics
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can manage creative asset analysis"
on public.creative_asset_analysis
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can manage creative asset jobs"
on public.creative_asset_jobs
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace members can view creative groups"
on public.creative_groups
using (
  app_private.is_workspace_member(workspace_id)
  and (
    visibility = 'workspace'::text
    or user_id = (select auth.uid())
  )
);

alter policy "Workspace admins can manage creative groups"
on public.creative_groups
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can update creative groups"
on public.creative_groups
using (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
)
with check (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

alter policy "Workspace admins can delete creative groups"
on public.creative_groups
using (
  app_private.is_workspace_admin(workspace_id)
  and user_id = (select auth.uid())
);

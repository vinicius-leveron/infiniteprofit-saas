CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public.organization_role AS ENUM ('owner', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.sync_source AS ENUM ('meta', 'vturb', 'sheet', 'gateway', 'aggregate');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.sync_status AS ENUM ('queued', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_created_by
  ON public.organizations (created_by);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.organization_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON public.organization_members (user_id);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.organization_role NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_invites_org
  ON public.organization_invites (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_organization_invites_email
  ON public.organization_invites (lower(email));

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_organization
  ON public.workspaces (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_workspaces_created_by
  ON public.workspaces (created_by);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON public.workspace_members (user_id);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspace_members_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.workspace_role NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace
  ON public.workspace_invites (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email
  ON public.workspace_invites (lower(email));

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspace_integrations (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  vturb_api_key TEXT,
  vturb_last_event_at TIMESTAMPTZ,
  gateway_provider public.gateway_provider,
  gateway_webhook_secret TEXT,
  gateway_webhook_token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  gateway_last_event_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_integrations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspace_integrations_updated_at
  BEFORE UPDATE ON public.workspace_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.workspace_meta_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  label TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_meta_accounts_workspace
  ON public.workspace_meta_accounts (workspace_id, created_at DESC);

ALTER TABLE public.workspace_meta_accounts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspace_meta_accounts_updated_at
  BEFORE UPDATE ON public.workspace_meta_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.workspace_vturb_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  label TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_vturb_players_workspace
  ON public.workspace_vturb_players (workspace_id, created_at DESC);

ALTER TABLE public.workspace_vturb_players ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspace_vturb_players_updated_at
  BEFORE UPDATE ON public.workspace_vturb_players
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_workspace_id
  ON public.projects (workspace_id, updated_at DESC);

ALTER TABLE public.raw_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_raw_events_workspace_date
  ON public.raw_events (workspace_id, event_date DESC);

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_daily_metrics_workspace_date
  ON public.daily_metrics (workspace_id, event_date DESC);

ALTER TABLE public.bump_catalog
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_bump_catalog_workspace
  ON public.bump_catalog (workspace_id, project_id);

ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_simulations_workspace_project
  ON public.simulations (workspace_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.project_meta_accounts (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  meta_account_id UUID NOT NULL REFERENCES public.workspace_meta_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, meta_account_id)
);

CREATE INDEX IF NOT EXISTS idx_project_meta_accounts_meta_account
  ON public.project_meta_accounts (meta_account_id);

ALTER TABLE public.project_meta_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.project_vturb_players (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  vturb_player_id UUID NOT NULL REFERENCES public.workspace_vturb_players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, vturb_player_id)
);

CREATE INDEX IF NOT EXISTS idx_project_vturb_players_player
  ON public.project_vturb_players (vturb_player_id);

ALTER TABLE public.project_vturb_players ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.project_checkout_bindings (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  webhook_token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_checkout_bindings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_project_checkout_bindings_updated_at
  BEFORE UPDATE ON public.project_checkout_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  source public.sync_source NOT NULL,
  status public.sync_status NOT NULL DEFAULT 'queued',
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_workspace_created
  ON public.sync_runs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_project_source
  ON public.sync_runs (project_id, source, created_at DESC);

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = org_id
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.organization_id = org_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members m
    WHERE m.workspace_id = ws_id
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_workspace_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members m
    WHERE m.workspace_id = ws_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION app_private.is_org_admin_for_workspace(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    JOIN public.organization_members m
      ON m.organization_id = w.organization_id
    WHERE w.id = ws_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin')
  );
$$;

GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_org_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_workspace_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_org_admin_for_workspace(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_organization_invite(_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_row public.organization_invites%ROWTYPE;
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO invite_row
  FROM public.organization_invites
  WHERE token = _token
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or expired';
  END IF;

  IF lower(invite_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) THEN
    RAISE EXCEPTION 'Invite email does not match current user';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (invite_row.organization_id, uid, invite_row.role)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.organization_invites
  SET accepted_at = now()
  WHERE id = invite_row.id;

  RETURN invite_row.organization_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_row public.workspace_invites%ROWTYPE;
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO invite_row
  FROM public.workspace_invites
  WHERE token = _token
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or expired';
  END IF;

  IF lower(invite_row.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) THEN
    RAISE EXCEPTION 'Invite email does not match current user';
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (invite_row.workspace_id, uid, invite_row.role)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.workspace_invites
  SET accepted_at = now()
  WHERE id = invite_row.id;

  RETURN invite_row.workspace_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_organization_invite(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;

CREATE POLICY "Workspace members can view projects"
  ON public.projects FOR SELECT TO authenticated
  USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can create projects"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    app_private.is_workspace_admin(workspace_id)
    AND auth.uid() = user_id
  );

CREATE POLICY "Workspace admins can update projects"
  ON public.projects FOR UPDATE TO authenticated
  USING (app_private.is_workspace_admin(workspace_id))
  WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace admins can delete projects"
  ON public.projects FOR DELETE TO authenticated
  USING (app_private.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Users can view their own simulations" ON public.simulations;
DROP POLICY IF EXISTS "Users can create their own simulations" ON public.simulations;
DROP POLICY IF EXISTS "Users can update their own simulations" ON public.simulations;
DROP POLICY IF EXISTS "Users can delete their own simulations" ON public.simulations;

CREATE POLICY "Workspace members can view simulations"
ON public.simulations FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can create simulations"
ON public.simulations FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_member(workspace_id)
  AND auth.uid() = user_id
);

CREATE POLICY "Workspace members can update simulations"
ON public.simulations FOR UPDATE
TO authenticated
USING (app_private.is_workspace_member(workspace_id))
WITH CHECK (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can delete simulations"
ON public.simulations FOR DELETE
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users view own raw events" ON public.raw_events;

CREATE POLICY "Workspace members can view raw events"
ON public.raw_events FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users view own daily metrics" ON public.daily_metrics;
DROP POLICY IF EXISTS "Users update own daily metrics obs" ON public.daily_metrics;

CREATE POLICY "Workspace members can view daily metrics"
ON public.daily_metrics FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace members can update daily metrics"
ON public.daily_metrics FOR UPDATE
TO authenticated
USING (app_private.is_workspace_member(workspace_id))
WITH CHECK (app_private.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users view own bump catalog" ON public.bump_catalog;
DROP POLICY IF EXISTS "Users update own bump catalog" ON public.bump_catalog;

CREATE POLICY "Workspace members can view bump catalog"
ON public.bump_catalog FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can update bump catalog"
ON public.bump_catalog FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Org members can view organizations"
ON public.organizations FOR SELECT
TO authenticated
USING (app_private.is_org_member(id));

CREATE POLICY "Authenticated users can create organizations"
ON public.organizations FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Org admins can update organizations"
ON public.organizations FOR UPDATE
TO authenticated
USING (app_private.is_org_admin(id))
WITH CHECK (app_private.is_org_admin(id));

CREATE POLICY "Org members can view organization members"
ON public.organization_members FOR SELECT
TO authenticated
USING (app_private.is_org_member(organization_id));

CREATE POLICY "Creators can add initial organization ownership"
ON public.organization_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'owner'
  AND EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = organization_id
      AND o.created_by = auth.uid()
  )
);

CREATE POLICY "Org admins can manage organization members"
ON public.organization_members FOR UPDATE
TO authenticated
USING (app_private.is_org_admin(organization_id))
WITH CHECK (app_private.is_org_admin(organization_id));

CREATE POLICY "Org admins can delete organization members"
ON public.organization_members FOR DELETE
TO authenticated
USING (app_private.is_org_admin(organization_id));

CREATE POLICY "Org admins can view organization invites"
ON public.organization_invites FOR SELECT
TO authenticated
USING (app_private.is_org_admin(organization_id));

CREATE POLICY "Org admins can create organization invites"
ON public.organization_invites FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_org_admin(organization_id)
  AND auth.uid() = created_by
);

CREATE POLICY "Org admins can update organization invites"
ON public.organization_invites FOR UPDATE
TO authenticated
USING (app_private.is_org_admin(organization_id))
WITH CHECK (app_private.is_org_admin(organization_id));

CREATE POLICY "Workspace members or org admins can view workspaces"
ON public.workspaces FOR SELECT
TO authenticated
USING (
  app_private.is_workspace_member(id)
  OR app_private.is_org_admin(organization_id)
);

CREATE POLICY "Org admins can create workspaces"
ON public.workspaces FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_org_admin(organization_id)
  AND auth.uid() = created_by
);

CREATE POLICY "Workspace admins or org admins can update workspaces"
ON public.workspaces FOR UPDATE
TO authenticated
USING (
  app_private.is_workspace_admin(id)
  OR app_private.is_org_admin(organization_id)
)
WITH CHECK (
  app_private.is_workspace_admin(id)
  OR app_private.is_org_admin(organization_id)
);

CREATE POLICY "Workspace members or org admins can view workspace members"
ON public.workspace_members FOR SELECT
TO authenticated
USING (
  app_private.is_workspace_member(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
);

CREATE POLICY "Creators can add initial workspace ownership"
ON public.workspace_members FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND role = 'owner'
  AND EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = workspace_id
      AND w.created_by = auth.uid()
  )
);

CREATE POLICY "Workspace admins or org admins can update workspace members"
ON public.workspace_members FOR UPDATE
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
)
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
);

CREATE POLICY "Workspace admins or org admins can delete workspace members"
ON public.workspace_members FOR DELETE
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
);

CREATE POLICY "Workspace admins or org admins can view workspace invites"
ON public.workspace_invites FOR SELECT
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
);

CREATE POLICY "Workspace admins or org admins can create workspace invites"
ON public.workspace_invites FOR INSERT
TO authenticated
WITH CHECK (
  (
    app_private.is_workspace_admin(workspace_id)
    OR app_private.is_org_admin_for_workspace(workspace_id)
  )
  AND auth.uid() = created_by
);

CREATE POLICY "Workspace admins or org admins can update workspace invites"
ON public.workspace_invites FOR UPDATE
TO authenticated
USING (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
)
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  OR app_private.is_org_admin_for_workspace(workspace_id)
);

CREATE POLICY "Workspace members can view workspace integrations"
ON public.workspace_integrations FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage workspace integrations"
ON public.workspace_integrations FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND auth.uid() = created_by
);

CREATE POLICY "Workspace admins can update workspace integrations"
ON public.workspace_integrations FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view workspace meta accounts"
ON public.workspace_meta_accounts FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage workspace meta accounts"
ON public.workspace_meta_accounts FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND auth.uid() = created_by
);

CREATE POLICY "Workspace admins can update workspace meta accounts"
ON public.workspace_meta_accounts FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace admins can delete workspace meta accounts"
ON public.workspace_meta_accounts FOR DELETE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view workspace vturb players"
ON public.workspace_vturb_players FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage workspace vturb players"
ON public.workspace_vturb_players FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND auth.uid() = created_by
);

CREATE POLICY "Workspace admins can update workspace vturb players"
ON public.workspace_vturb_players FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace admins can delete workspace vturb players"
ON public.workspace_vturb_players FOR DELETE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace members can view project meta bindings"
ON public.project_meta_accounts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_member(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can manage project meta bindings"
ON public.project_meta_accounts FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.workspace_meta_accounts a
      ON a.id = meta_account_id
    WHERE p.id = project_id
      AND p.workspace_id = a.workspace_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can delete project meta bindings"
ON public.project_meta_accounts FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace members can view project vturb bindings"
ON public.project_vturb_players FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_member(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can manage project vturb bindings"
ON public.project_vturb_players FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.workspace_vturb_players v
      ON v.id = vturb_player_id
    WHERE p.id = project_id
      AND p.workspace_id = v.workspace_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can delete project vturb bindings"
ON public.project_vturb_players FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace members can view checkout bindings"
ON public.project_checkout_bindings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_member(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can manage checkout bindings"
ON public.project_checkout_bindings FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can update checkout bindings"
ON public.project_checkout_bindings FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace members can view sync runs"
ON public.sync_runs FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can create sync runs"
ON public.sync_runs FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND (
    initiated_by IS NULL
    OR initiated_by = auth.uid()
  )
);

CREATE POLICY "Workspace admins can update sync runs"
ON public.sync_runs FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

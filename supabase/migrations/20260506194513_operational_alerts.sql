CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('meta', 'vturb', 'gateway', 'coverage', 'funnel')),
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_project_status
  ON public.operational_alerts (project_id, status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_workspace_status
  ON public.operational_alerts (workspace_id, status, last_seen_at DESC);

ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_operational_alerts_updated_at
  BEFORE UPDATE ON public.operational_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Workspace members can view operational alerts"
ON public.operational_alerts FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can update operational alerts"
ON public.operational_alerts FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE POLICY "Workspace admins can delete operational alerts"
ON public.operational_alerts FOR DELETE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id));

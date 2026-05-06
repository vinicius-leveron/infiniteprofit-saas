CREATE TABLE IF NOT EXISTS public.project_public_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  enabled BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  last_accessed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_public_links_project
  ON public.project_public_links (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_public_links_token_enabled
  ON public.project_public_links (token)
  WHERE enabled = true;

ALTER TABLE public.project_public_links ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_project_public_links_updated_at
  BEFORE UPDATE ON public.project_public_links
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Workspace members can view public project links"
ON public.project_public_links FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_member(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can create public project links"
ON public.project_public_links FOR INSERT
TO authenticated
WITH CHECK (
  (select auth.uid()) = created_by
  AND EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

CREATE POLICY "Workspace admins can update public project links"
ON public.project_public_links FOR UPDATE
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

CREATE POLICY "Workspace admins can delete public project links"
ON public.project_public_links FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_id
      AND app_private.is_workspace_admin(p.workspace_id)
  )
);

DROP POLICY IF EXISTS "Workspace admins can create public project links"
ON public.project_public_links;

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

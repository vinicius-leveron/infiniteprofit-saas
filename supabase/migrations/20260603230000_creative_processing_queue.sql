ALTER TABLE public.creative_assets
  ADD COLUMN IF NOT EXISTS source_media_url TEXT,
  ADD COLUMN IF NOT EXISTS source_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS media_duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS media_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS poster_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS last_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_version TEXT;

ALTER TABLE public.creative_asset_analysis
  ADD COLUMN IF NOT EXISTS transcript_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS transcript_language TEXT,
  ADD COLUMN IF NOT EXISTS transcript_provider TEXT,
  ADD COLUMN IF NOT EXISTS transcript_model TEXT,
  ADD COLUMN IF NOT EXISTS transcript_error_message TEXT,
  ADD COLUMN IF NOT EXISTS hook_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visual_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis_coverage TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS analysis_error_message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creative_asset_analysis_transcript_status_check'
  ) THEN
    ALTER TABLE public.creative_asset_analysis
      ADD CONSTRAINT creative_asset_analysis_transcript_status_check
      CHECK (transcript_status IN ('pending', 'processing', 'ready', 'failed', 'not_applicable', 'missing_media', 'oversized_queued'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creative_asset_analysis_analysis_coverage_check'
  ) THEN
    ALTER TABLE public.creative_asset_analysis
      ADD CONSTRAINT creative_asset_analysis_analysis_coverage_check
      CHECK (analysis_coverage IN ('pending', 'full', 'partial', 'failed', 'not_applicable'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.creative_asset_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.creative_assets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  input_fingerprint TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_creative_asset_jobs_project_status
  ON public.creative_asset_jobs (project_id, status, available_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_creative_asset_jobs_asset_status
  ON public.creative_asset_jobs (asset_id, status, updated_at DESC);

ALTER TABLE public.creative_asset_jobs ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_creative_asset_jobs_updated_at
  BEFORE UPDATE ON public.creative_asset_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Workspace members can view creative asset jobs"
ON public.creative_asset_jobs FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

CREATE POLICY "Workspace admins can manage creative asset jobs"
ON public.creative_asset_jobs FOR INSERT
TO authenticated
WITH CHECK (
  app_private.is_workspace_admin(workspace_id)
  AND user_id = auth.uid()
);

CREATE POLICY "Workspace admins can update creative asset jobs"
ON public.creative_asset_jobs FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE OR REPLACE FUNCTION public.claim_creative_asset_jobs(job_limit INTEGER, worker_name TEXT)
RETURNS SETOF public.creative_asset_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT j.id
    FROM public.creative_asset_jobs j
    WHERE j.status = 'queued'
      AND j.available_at <= now()
    ORDER BY j.available_at ASC, j.created_at ASC
    LIMIT GREATEST(job_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.creative_asset_jobs AS jobs
  SET
    status = 'running',
    attempt_count = jobs.attempt_count + 1,
    locked_at = now(),
    locked_by = NULLIF(worker_name, ''),
    updated_at = now()
  FROM locked
  WHERE jobs.id = locked.id
  RETURNING jobs.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_creative_asset_jobs(INTEGER, TEXT) TO authenticated;

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
      AND COALESCE(j.payload ->> 'job_trigger', j.payload ->> 'trigger') = 'manual'
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

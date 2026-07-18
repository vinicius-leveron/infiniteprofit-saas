CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('meta', 'vturb', 'gateway', 'aggregate')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('meta_account', 'vturb_player', 'hubla_reconcile', 'aggregate_project_dates')),
  entity_id TEXT,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT sync_jobs_date_range_check CHECK (date_start <= date_end),
  CONSTRAINT sync_jobs_priority_check CHECK (priority >= 0),
  CONSTRAINT sync_jobs_attempts_check CHECK (attempt_count >= 0 AND max_attempts > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_dedupe_key_idx
  ON public.sync_jobs (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_ready
  ON public.sync_jobs (priority ASC, available_at ASC, created_at ASC)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_sync_jobs_project_source_status
  ON public.sync_jobs (project_id, source, status, available_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_workspace_status
  ON public.sync_jobs (workspace_id, status, available_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_running
  ON public.sync_jobs (locked_at ASC)
  WHERE status = 'running';

DROP TRIGGER IF EXISTS update_sync_jobs_updated_at ON public.sync_jobs;
CREATE TRIGGER update_sync_jobs_updated_at
  BEFORE UPDATE ON public.sync_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view sync jobs" ON public.sync_jobs;
CREATE POLICY "Workspace members can view sync jobs"
ON public.sync_jobs FOR SELECT
TO authenticated
USING (app_private.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Workspace admins can update sync jobs" ON public.sync_jobs;
CREATE POLICY "Workspace admins can update sync jobs"
ON public.sync_jobs FOR UPDATE
TO authenticated
USING (app_private.is_workspace_admin(workspace_id))
WITH CHECK (app_private.is_workspace_admin(workspace_id));

CREATE OR REPLACE FUNCTION public.claim_sync_jobs(job_limit INTEGER, worker_name TEXT)
RETURNS SETOF public.sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  bounded_limit INTEGER;
BEGIN
  bounded_limit := least(greatest(coalesce(job_limit, 1), 1), 50);

  RETURN QUERY
  WITH locked AS (
    SELECT j.id
    FROM public.sync_jobs j
    WHERE j.status = 'queued'
      AND j.available_at <= now()
    ORDER BY j.priority ASC, j.available_at ASC, j.created_at ASC
    LIMIT bounded_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sync_jobs AS jobs
  SET
    status = 'running',
    attempt_count = jobs.attempt_count + 1,
    locked_at = now(),
    locked_by = nullif(worker_name, ''),
    last_error = NULL,
    updated_at = now()
  FROM locked
  WHERE jobs.id = locked.id
  RETURNING jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sync_jobs(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sync_jobs(INTEGER, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_stale_sync_jobs(max_age_minutes INTEGER DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected INTEGER;
  cutoff TIMESTAMPTZ;
BEGIN
  cutoff := now() - make_interval(mins => least(greatest(coalesce(max_age_minutes, 15), 1), 1440));

  UPDATE public.sync_jobs
  SET
    status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'queued' END,
    available_at = CASE WHEN attempt_count >= max_attempts THEN available_at ELSE now() END,
    locked_at = NULL,
    locked_by = NULL,
    last_error = coalesce(last_error, 'Job destravado automaticamente por timeout do worker.'),
    finished_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE finished_at END,
    updated_at = now()
  WHERE status = 'running'
    AND locked_at < cutoff;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_sync_jobs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_sync_jobs(INTEGER) TO service_role;

DROP FUNCTION IF EXISTS app_private.install_sync_cron_jobs(TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION app_private.install_sync_cron_jobs(
  scheduler_schedule TEXT DEFAULT '*/5 * * * *',
  worker_schedule TEXT DEFAULT '* * * * *',
  sync_days INTEGER DEFAULT 3
)
RETURNS TABLE(job_name TEXT, job_schedule TEXT)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  project_url TEXT;
  automation_key TEXT;
  bounded_days INTEGER;
  scheduler_body JSONB;
  worker_body JSONB;
  watchdog_body JSONB;
  scheduler_backfill_body JSONB;
  watchdog_backfill_body JSONB;
  scheduler_command TEXT;
  worker_command TEXT;
  watchdog_command TEXT;
  scheduler_backfill_command TEXT;
  watchdog_backfill_command TEXT;
BEGIN
  project_url := rtrim(app_private.get_vault_secret('project_url'), '/');
  automation_key := app_private.get_vault_secret('automation_key');
  bounded_days := greatest(1, least(coalesce(sync_days, 3), 90));

  scheduler_body := jsonb_build_object(
    'recent_days', bounded_days,
    'include_backfill', false
  );
  worker_body := jsonb_build_object(
    'batch_size', 4,
    'max_runtime_ms', 50000
  );
  watchdog_body := jsonb_build_object(
    'recent_days', bounded_days,
    'reprocess_days', 7,
    'trigger_sync', true,
    'generate_alerts', true
  );
  scheduler_backfill_body := jsonb_build_object(
    'recent_days', bounded_days,
    'include_backfill', true,
    'backfill_days', 30
  );
  watchdog_backfill_body := jsonb_build_object(
    'recent_days', bounded_days,
    'reprocess_days', 30,
    'trigger_sync', false,
    'generate_alerts', true
  );

  scheduler_command := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$,
    project_url || '/functions/v1/sync-scheduler',
    automation_key,
    scheduler_body::TEXT
  );

  worker_command := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$,
    project_url || '/functions/v1/sync-worker',
    automation_key,
    worker_body::TEXT
  );

  watchdog_command := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$,
    project_url || '/functions/v1/sync-watchdog',
    automation_key,
    watchdog_body::TEXT
  );

  scheduler_backfill_command := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$,
    project_url || '/functions/v1/sync-scheduler',
    automation_key,
    scheduler_backfill_body::TEXT
  );

  watchdog_backfill_command := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 120000
    ) AS request_id;
    $cmd$,
    project_url || '/functions/v1/sync-watchdog',
    automation_key,
    watchdog_backfill_body::TEXT
  );

  PERFORM app_private.unschedule_job_by_name('daily-meta-pull');
  PERFORM app_private.unschedule_job_by_name('daily-creative-sync-morning');
  PERFORM app_private.unschedule_job_by_name('daily-creative-sync-midday');
  PERFORM app_private.unschedule_job_by_name('daily-creative-sync-evening');
  PERFORM app_private.unschedule_job_by_name('sync-meta-projects');
  PERFORM app_private.unschedule_job_by_name('sync-vturb-projects');
  PERFORM app_private.unschedule_job_by_name('sync-watchdog-projects');
  PERFORM app_private.unschedule_job_by_name('sync-meta-backfill');
  PERFORM app_private.unschedule_job_by_name('sync-vturb-backfill');
  PERFORM app_private.unschedule_job_by_name('sync-watchdog-backfill');
  PERFORM app_private.unschedule_job_by_name('sync-scheduler-projects');
  PERFORM app_private.unschedule_job_by_name('sync-worker-projects');
  PERFORM app_private.unschedule_job_by_name('sync-scheduler-backfill');

  PERFORM cron.schedule('sync-scheduler-projects', scheduler_schedule, scheduler_command);
  PERFORM cron.schedule('sync-worker-projects', worker_schedule, worker_command);
  PERFORM cron.schedule('sync-watchdog-projects', '*/15 * * * *', watchdog_command);
  PERFORM cron.schedule('sync-scheduler-backfill', '17 3 * * *', scheduler_backfill_command);
  PERFORM cron.schedule('sync-watchdog-backfill', '25 4 * * *', watchdog_backfill_command);

  RETURN QUERY
  SELECT 'sync-scheduler-projects'::TEXT, scheduler_schedule
  UNION ALL
  SELECT 'sync-worker-projects'::TEXT, worker_schedule
  UNION ALL
  SELECT 'sync-watchdog-projects'::TEXT, '*/15 * * * *'::TEXT
  UNION ALL
  SELECT 'sync-scheduler-backfill'::TEXT, '17 3 * * *'::TEXT
  UNION ALL
  SELECT 'sync-watchdog-backfill'::TEXT, '25 4 * * *'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION app_private.install_sync_cron_jobs(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM app_private.install_sync_cron_jobs();
END;
$$;

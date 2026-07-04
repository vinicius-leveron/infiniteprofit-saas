CREATE OR REPLACE FUNCTION app_private.install_sync_cron_jobs(
  meta_schedule TEXT DEFAULT '0 * * * *',
  vturb_schedule TEXT DEFAULT '*/10 * * * *',
  sync_days INTEGER DEFAULT 2
)
RETURNS TABLE(job_name TEXT, job_schedule TEXT)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  project_url TEXT;
  automation_key TEXT;
  bounded_days INTEGER;
  meta_body JSONB;
  vturb_body JSONB;
  meta_command TEXT;
  vturb_command TEXT;
BEGIN
  project_url := rtrim(app_private.get_vault_secret('project_url'), '/');
  automation_key := app_private.get_vault_secret('automation_key');
  bounded_days := greatest(1, least(coalesce(sync_days, 2), 90));

  meta_body := jsonb_build_object('days', bounded_days);
  vturb_body := jsonb_build_object(
    'days', bounded_days,
    'max_runtime_ms', 90000,
    'max_players', 50
  );

  meta_command := format(
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
    project_url || '/functions/v1/meta-pull',
    automation_key,
    meta_body::TEXT
  );

  vturb_command := format(
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
    project_url || '/functions/v1/vturb-pull',
    automation_key,
    vturb_body::TEXT
  );

  PERFORM app_private.unschedule_job_by_name('sync-meta-projects');
  PERFORM app_private.unschedule_job_by_name('sync-vturb-projects');

  PERFORM cron.schedule('sync-meta-projects', meta_schedule, meta_command);
  PERFORM cron.schedule('sync-vturb-projects', vturb_schedule, vturb_command);

  RETURN QUERY
  SELECT 'sync-meta-projects'::TEXT, meta_schedule
  UNION ALL
  SELECT 'sync-vturb-projects'::TEXT, vturb_schedule;
END;
$$;

REVOKE ALL ON FUNCTION app_private.install_sync_cron_jobs(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM app_private.install_sync_cron_jobs();
END;
$$;

CREATE OR REPLACE FUNCTION app_private.install_sync_cron_jobs(
  meta_schedule TEXT DEFAULT '0 * * * *',
  vturb_schedule TEXT DEFAULT '*/10 * * * *',
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
  recent_days INTEGER;
  meta_body JSONB;
  vturb_body JSONB;
  watchdog_body JSONB;
  meta_backfill_body JSONB;
  vturb_backfill_body JSONB;
  watchdog_backfill_body JSONB;
  meta_command TEXT;
  vturb_command TEXT;
  watchdog_command TEXT;
  meta_backfill_command TEXT;
  vturb_backfill_command TEXT;
  watchdog_backfill_command TEXT;
BEGIN
  project_url := rtrim(app_private.get_vault_secret('project_url'), '/');
  automation_key := app_private.get_vault_secret('automation_key');
  bounded_days := greatest(1, least(coalesce(sync_days, 3), 90));
  recent_days := greatest(3, bounded_days);

  meta_body := jsonb_build_object('days', recent_days);
  vturb_body := jsonb_build_object(
    'days', recent_days,
    'max_runtime_ms', 70000,
    'max_players', 50
  );
  watchdog_body := jsonb_build_object(
    'recent_days', recent_days,
    'reprocess_days', 7,
    'trigger_sync', true,
    'generate_alerts', true
  );
  meta_backfill_body := jsonb_build_object('days', 30);
  vturb_backfill_body := jsonb_build_object(
    'days', 30,
    'max_runtime_ms', 70000,
    'max_players', 50
  );
  watchdog_backfill_body := jsonb_build_object(
    'recent_days', recent_days,
    'reprocess_days', 30,
    'trigger_sync', false,
    'generate_alerts', true
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

  meta_backfill_command := format(
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
    meta_backfill_body::TEXT
  );

  vturb_backfill_command := format(
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
    vturb_backfill_body::TEXT
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

  PERFORM app_private.unschedule_job_by_name('sync-meta-projects');
  PERFORM app_private.unschedule_job_by_name('sync-vturb-projects');
  PERFORM app_private.unschedule_job_by_name('sync-watchdog-projects');
  PERFORM app_private.unschedule_job_by_name('sync-meta-backfill');
  PERFORM app_private.unschedule_job_by_name('sync-vturb-backfill');
  PERFORM app_private.unschedule_job_by_name('sync-watchdog-backfill');

  PERFORM cron.schedule('sync-meta-projects', meta_schedule, meta_command);
  PERFORM cron.schedule('sync-vturb-projects', vturb_schedule, vturb_command);
  PERFORM cron.schedule('sync-watchdog-projects', '*/15 * * * *', watchdog_command);
  PERFORM cron.schedule('sync-meta-backfill', '17 3 * * *', meta_backfill_command);
  PERFORM cron.schedule('sync-vturb-backfill', '47 3 * * *', vturb_backfill_command);
  PERFORM cron.schedule('sync-watchdog-backfill', '25 4 * * *', watchdog_backfill_command);

  RETURN QUERY
  SELECT 'sync-meta-projects'::TEXT, meta_schedule
  UNION ALL
  SELECT 'sync-vturb-projects'::TEXT, vturb_schedule
  UNION ALL
  SELECT 'sync-watchdog-projects'::TEXT, '*/15 * * * *'::TEXT
  UNION ALL
  SELECT 'sync-meta-backfill'::TEXT, '17 3 * * *'::TEXT
  UNION ALL
  SELECT 'sync-vturb-backfill'::TEXT, '47 3 * * *'::TEXT
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

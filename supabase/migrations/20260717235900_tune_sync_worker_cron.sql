-- Keep the minutely worker below its scheduling interval so invocations do
-- not overlap under normal API latency.

do $$
declare
  target_job_id bigint;
  project_url text;
  automation_key text;
  worker_body jsonb;
  worker_command text;
begin
  select job.jobid
    into target_job_id
  from cron.job job
  where job.jobname = 'sync-worker-projects'
  limit 1;

  if target_job_id is null then
    raise exception 'sync-worker-projects cron job not found';
  end if;

  project_url := pg_catalog.rtrim(
    app_private.get_vault_secret('project_url'),
    '/'
  );
  automation_key := app_private.get_vault_secret('automation_key');
  worker_body := pg_catalog.jsonb_build_object(
    'batch_size', 4,
    'max_runtime_ms', 50000
  );
  worker_command := pg_catalog.format(
    $command$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := %L::jsonb,
      timeout_milliseconds := 90000
    ) as request_id;
    $command$,
    project_url || '/functions/v1/sync-worker',
    automation_key,
    worker_body::text
  );

  perform cron.alter_job(
    job_id := target_job_id,
    command := worker_command
  );
end;
$$;

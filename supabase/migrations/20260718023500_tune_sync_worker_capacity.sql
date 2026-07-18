-- The production catalog currently schedules about 50 VTurb player jobs every
-- 15 minutes. A batch of four leaves one slot for aggregation and drains only
-- three player jobs per minute, below the steady-state arrival rate. Increase
-- the serial claim batch while keeping the same runtime budget and singleton
-- lease: no additional downstream concurrency or overlapping worker is added.

create or replace function app_private.tune_sync_worker_cron(
  _batch_size integer default 12,
  _max_runtime_ms integer default 50000
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target_job_id bigint;
  project_url text;
  automation_key text;
  worker_body jsonb;
  worker_command text;
  bounded_batch_size integer;
  bounded_runtime_ms integer;
begin
  bounded_batch_size :=
    least(greatest(coalesce(_batch_size, 12), 1), 50);
  bounded_runtime_ms :=
    least(
      greatest(coalesce(_max_runtime_ms, 50000), 5000),
      110000
    );

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
    'batch_size', bounded_batch_size,
    'max_runtime_ms', bounded_runtime_ms
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

revoke all on function app_private.tune_sync_worker_cron(integer, integer)
  from public, anon, authenticated;
grant execute on function app_private.tune_sync_worker_cron(integer, integer)
  to service_role;

select app_private.tune_sync_worker_cron();

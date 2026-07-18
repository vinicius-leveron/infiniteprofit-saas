create table if not exists public.backend_canary_runs (
  id bigint generated always as identity primary key,
  status text not null check (status in ('pass', 'fail')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  frontend_status integer,
  frontend_p95_ms integer,
  auth_status integer,
  auth_p95_ms integer,
  postgrest_status integer,
  postgrest_p95_ms integer,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists idx_backend_canary_runs_created
  on public.backend_canary_runs (created_at desc);

alter table public.backend_canary_runs enable row level security;

revoke all on table public.backend_canary_runs
  from public, anon, authenticated;
grant select, insert, update, delete on table public.backend_canary_runs
  to service_role;
grant usage, select on sequence public.backend_canary_runs_id_seq
  to service_role;

comment on table public.backend_canary_runs is
  'Service-only internal probes of frontend, Auth and PostgREST availability.';

create or replace function app_private.install_backend_canary_cron(
  canary_schedule text default '*/15 * * * *'
)
returns table (
  job_name text,
  job_schedule text
)
language plpgsql
set search_path = ''
as $$
declare
  project_url text;
  automation_key text;
  canary_command text;
begin
  project_url := pg_catalog.rtrim(
    app_private.get_vault_secret('project_url'),
    '/'
  );
  automation_key := app_private.get_vault_secret('automation_key');
  canary_command := pg_catalog.format(
    $command$
    select net.http_post(
      url := %L,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', %L
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
    $command$,
    project_url || '/functions/v1/backend-canary',
    automation_key
  );

  perform app_private.unschedule_job_by_name('backend-internal-canary');
  perform cron.schedule(
    'backend-internal-canary',
    canary_schedule,
    canary_command
  );

  return query
  select 'backend-internal-canary'::text, canary_schedule;
end;
$$;

revoke all on function app_private.install_backend_canary_cron(text)
  from public, anon, authenticated;
grant execute on function app_private.install_backend_canary_cron(text)
  to service_role;

do $$
begin
  begin
    perform app_private.install_backend_canary_cron();
  exception
    when others then
      raise notice 'Backend internal canary cron not installed: %', sqlerrm;
  end;
end;
$$;

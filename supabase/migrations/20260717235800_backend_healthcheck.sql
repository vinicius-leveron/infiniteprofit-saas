-- A canary must touch Postgres without depending on access to business tables.

create or replace function public.backend_healthcheck()
returns table (
  ok boolean,
  checked_at timestamptz
)
language sql
set search_path = ''
set statement_timeout = '2s'
as $$
  select true, pg_catalog.clock_timestamp();
$$;

comment on function public.backend_healthcheck() is
  'Data-free PostgREST/Postgres liveness contract used by production canaries.';

revoke all on function public.backend_healthcheck()
  from public;
grant execute on function public.backend_healthcheck()
  to anon, authenticated, service_role;

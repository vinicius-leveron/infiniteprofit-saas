-- Keep the minutely sync-worker singleton even when one downstream provider
-- exceeds the normal runtime budget. A crashed worker releases itself through
-- lease expiry; healthy workers release explicitly.

create table if not exists app_private.sync_worker_leases (
  lease_name text primary key,
  holder text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.now()
);

revoke all on table app_private.sync_worker_leases
  from public, anon, authenticated;

create or replace function public.try_acquire_sync_worker_lease(
  _lease_name text,
  _holder text,
  _lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  affected integer := 0;
  bounded_seconds integer;
begin
  if pg_catalog.nullif(pg_catalog.btrim(_lease_name), '') is null
    or pg_catalog.nullif(pg_catalog.btrim(_holder), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Lease name and holder are required';
  end if;

  bounded_seconds := pg_catalog.least(
    pg_catalog.greatest(pg_catalog.coalesce(_lease_seconds, 300), 60),
    900
  );

  insert into app_private.sync_worker_leases (
    lease_name,
    holder,
    expires_at,
    updated_at
  )
  values (
    _lease_name,
    _holder,
    pg_catalog.now() + pg_catalog.make_interval(secs => bounded_seconds),
    pg_catalog.now()
  )
  on conflict (lease_name) do update
  set
    holder = excluded.holder,
    expires_at = excluded.expires_at,
    updated_at = pg_catalog.now()
  where app_private.sync_worker_leases.expires_at <= pg_catalog.now()
    or app_private.sync_worker_leases.holder = excluded.holder;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.renew_sync_worker_lease(
  _lease_name text,
  _holder text,
  _lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  affected integer := 0;
  bounded_seconds integer;
begin
  bounded_seconds := pg_catalog.least(
    pg_catalog.greatest(pg_catalog.coalesce(_lease_seconds, 300), 60),
    900
  );

  update app_private.sync_worker_leases lease
  set
    expires_at =
      pg_catalog.now() + pg_catalog.make_interval(secs => bounded_seconds),
    updated_at = pg_catalog.now()
  where lease.lease_name = _lease_name
    and lease.holder = _holder
    and lease.expires_at > pg_catalog.now();

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.release_sync_worker_lease(
  _lease_name text,
  _holder text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  affected integer := 0;
begin
  delete from app_private.sync_worker_leases lease
  where lease.lease_name = _lease_name
    and lease.holder = _holder;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.try_acquire_sync_worker_lease(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.renew_sync_worker_lease(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_sync_worker_lease(text, text)
  from public, anon, authenticated;

grant execute on function public.try_acquire_sync_worker_lease(text, text, integer)
  to service_role;
grant execute on function public.renew_sync_worker_lease(text, text, integer)
  to service_role;
grant execute on function public.release_sync_worker_lease(text, text)
  to service_role;

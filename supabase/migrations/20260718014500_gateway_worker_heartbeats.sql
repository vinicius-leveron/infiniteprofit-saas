create table if not exists public.gateway_worker_heartbeats (
  worker_id text primary key
    check (char_length(worker_id) between 1 and 120),
  status text not null
    check (status in ('starting', 'healthy', 'error', 'stopping')),
  last_seen_at timestamptz not null default pg_catalog.now(),
  started_at timestamptz not null default pg_catalog.now(),
  processed_count bigint not null default 0
    check (processed_count >= 0),
  failed_count bigint not null default 0
    check (failed_count >= 0),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index if not exists idx_gateway_worker_heartbeats_last_seen
  on public.gateway_worker_heartbeats (last_seen_at desc);

alter table public.gateway_worker_heartbeats enable row level security;

drop trigger if exists update_gateway_worker_heartbeats_updated_at
  on public.gateway_worker_heartbeats;

create trigger update_gateway_worker_heartbeats_updated_at
  before update on public.gateway_worker_heartbeats
  for each row
  execute function public.update_updated_at_column();

revoke all on table public.gateway_worker_heartbeats
  from public, anon, authenticated;
grant select, insert, update, delete on table public.gateway_worker_heartbeats
  to service_role;

comment on table public.gateway_worker_heartbeats is
  'Service-only liveness signal for the external checkout queue consumer.';

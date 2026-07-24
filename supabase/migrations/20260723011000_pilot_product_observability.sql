alter table public.projects
  add column if not exists first_dashboard_opened_at timestamptz;

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (
    event_name in (
      'account_bootstrapped',
      'funnel_setup_started',
      'source_prepared',
      'funnel_created',
      'activation_viewed',
      'first_dashboard_opened',
      'share_created'
    )
  ),
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_events_has_scope
    check (
      organization_id is not null
      or workspace_id is not null
      or project_id is not null
    ),
  constraint product_events_properties_object
    check (jsonb_typeof(properties) = 'object'),
  constraint product_events_properties_size
    check (pg_column_size(properties) <= 4096)
);

create index if not exists product_events_name_created_idx
  on public.product_events (event_name, created_at desc);
create index if not exists product_events_project_created_idx
  on public.product_events (project_id, created_at desc)
  where project_id is not null;
create index if not exists product_events_workspace_created_idx
  on public.product_events (workspace_id, created_at desc)
  where workspace_id is not null;

alter table public.product_events enable row level security;
revoke all on table public.product_events from public, anon, authenticated;
grant all on table public.product_events to service_role;

comment on table public.product_events is
  'Allowlisted product telemetry. Never store email, tokens, secrets, imported files or provider payloads.';

create table if not exists public.client_error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  environment text not null,
  release text not null,
  route text not null,
  error_type text not null,
  fingerprint text not null,
  safe_message text not null,
  created_at timestamptz not null default now(),
  constraint client_error_environment_size check (length(environment) between 1 and 40),
  constraint client_error_release_size check (length(release) between 1 and 120),
  constraint client_error_route_size check (length(route) between 1 and 300),
  constraint client_error_type_size check (length(error_type) between 1 and 120),
  constraint client_error_fingerprint_size check (length(fingerprint) between 8 and 128),
  constraint client_error_message_size check (length(safe_message) between 1 and 500)
);

create index if not exists client_error_events_created_idx
  on public.client_error_events (created_at desc);
create index if not exists client_error_events_fingerprint_idx
  on public.client_error_events (fingerprint, created_at desc);

alter table public.client_error_events enable row level security;
revoke all on table public.client_error_events from public, anon, authenticated;
grant all on table public.client_error_events to service_role;

create or replace view public.product_activation_funnel
with (security_invoker = true)
as
with setup_events as (
  select
    event.organization_id,
    event.workspace_id,
    event.user_id,
    coalesce(
      nullif(event.properties ->> 'setup_session_id', ''),
      event.id::text
    ) as setup_session_id,
    min(event.created_at) as setup_started_at
  from public.product_events event
  where event.event_name = 'funnel_setup_started'
  group by
    event.organization_id,
    event.workspace_id,
    event.user_id,
    coalesce(
      nullif(event.properties ->> 'setup_session_id', ''),
      event.id::text
    )
),
created_events as (
  select
    event.workspace_id,
    event.project_id,
    nullif(event.properties ->> 'setup_session_id', '') as setup_session_id,
    min(event.created_at) as funnel_created_event_at
  from public.product_events event
  where event.event_name = 'funnel_created'
    and event.project_id is not null
  group by
    event.workspace_id,
    event.project_id,
    nullif(event.properties ->> 'setup_session_id', '')
),
project_events as (
  select
    event.project_id,
    min(event.created_at) filter (
      where event.event_name = 'source_prepared'
    ) as source_prepared_at,
    min(event.created_at) filter (
      where event.event_name = 'activation_viewed'
    ) as activation_viewed_at,
    min(event.created_at) filter (
      where event.event_name = 'first_dashboard_opened'
    ) as first_dashboard_opened_at
  from public.product_events event
  where event.project_id is not null
  group by event.project_id
)
select
  setup.organization_id,
  setup.workspace_id,
  created.project_id,
  coalesce(project.created_at, created.funnel_created_event_at)
    as funnel_created_at,
  project.first_trusted_signal_at,
  setup.setup_session_id,
  setup.setup_started_at,
  project_event.source_prepared_at,
  project_event.activation_viewed_at,
  project_event.first_dashboard_opened_at,
  case
    when project.first_trusted_signal_at is null then null
    else extract(
      epoch from (
        project.first_trusted_signal_at - setup.setup_started_at
      )
    )::bigint
  end as seconds_to_first_signal
from setup_events setup
left join created_events created
  on created.workspace_id = setup.workspace_id
 and created.setup_session_id = setup.setup_session_id
left join public.projects project
  on project.id = created.project_id
left join project_events project_event
  on project_event.project_id = created.project_id;

revoke all on table public.product_activation_funnel from public, anon, authenticated;
grant select on table public.product_activation_funnel to service_role;

create or replace view public.pilot_organization_usage
with (security_invoker = true)
as
select
  organization.id as organization_id,
  organization.name as organization_name,
  (
    select count(*)
    from public.workspaces workspace
    where workspace.organization_id = organization.id
  )::bigint as client_count,
  (
    select count(*)
    from public.projects project
    join public.workspaces workspace on workspace.id = project.workspace_id
    where workspace.organization_id = organization.id
  )::bigint as funnel_count,
  (
    select count(*)
    from public.raw_events event
    join public.workspaces workspace on workspace.id = event.workspace_id
    where workspace.organization_id = organization.id
  )::bigint as raw_event_count,
  (
    select count(*)
    from public.sync_runs run
    join public.workspaces workspace on workspace.id = run.workspace_id
    where workspace.organization_id = organization.id
  )::bigint as sync_run_count,
  (
    select count(*)
    from public.creative_asset_jobs job
    join public.workspaces workspace on workspace.id = job.workspace_id
    where workspace.organization_id = organization.id
  )::bigint as creative_job_count,
  greatest(
    organization.updated_at,
    coalesce((
      select max(project.updated_at)
      from public.projects project
      join public.workspaces workspace on workspace.id = project.workspace_id
      where workspace.organization_id = organization.id
    ), organization.updated_at),
    coalesce((
      select max(event.received_at)
      from public.raw_events event
      join public.workspaces workspace on workspace.id = event.workspace_id
      where workspace.organization_id = organization.id
    ), organization.updated_at)
  ) as last_activity_at
from public.organizations organization;

revoke all on table public.pilot_organization_usage from public, anon, authenticated;
grant select on table public.pilot_organization_usage to service_role;

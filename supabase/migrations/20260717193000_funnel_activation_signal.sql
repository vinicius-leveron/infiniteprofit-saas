-- Persist the product activation milestone only when the funnel itself has a
-- trustworthy signal. Workspace timestamps are intentionally excluded.

alter table public.projects
  add column if not exists first_trusted_signal_at timestamptz,
  add column if not exists activation_source text;

create index if not exists idx_projects_first_trusted_signal
  on public.projects (first_trusted_signal_at)
  where first_trusted_signal_at is not null;

create or replace function public.mark_funnel_first_trusted_signal(
  _project_id uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id uuid;
  existing_activation_at timestamptz;
  detected_activation_at timestamptz;
  detected_source text;
begin
  select
    project.workspace_id,
    project.first_trusted_signal_at
  into
    target_workspace_id,
    existing_activation_at
  from public.projects project
  where project.id = _project_id;

  if target_workspace_id is null
    or not app_private.is_workspace_member(target_workspace_id)
  then
    raise exception 'project_not_accessible';
  end if;

  if existing_activation_at is not null then
    return existing_activation_at;
  end if;

  select signal.signal_at, signal.source
  into detected_activation_at, detected_source
  from (
    select
      min(event.received_at) as signal_at,
      event.source::text as source
    from public.raw_events event
    where event.project_id = _project_id
    group by event.source

    union all

    select
      min(metric.updated_at) as signal_at,
      'daily_metrics'::text as source
    from public.daily_metrics metric
    where metric.project_id = _project_id

    union all

    select
      min(coalesce(run.finished_at, run.created_at)) as signal_at,
      run.source::text as source
    from public.sync_runs run
    where run.project_id = _project_id
      and run.status::text = 'succeeded'
    group by run.source
  ) signal
  where signal.signal_at is not null
  order by signal.signal_at asc
  limit 1;

  if detected_activation_at is null then
    return null;
  end if;

  update public.projects project
  set
    first_trusted_signal_at = detected_activation_at,
    activation_source = detected_source
  where project.id = _project_id
    and project.first_trusted_signal_at is null;

  select project.first_trusted_signal_at
  into existing_activation_at
  from public.projects project
  where project.id = _project_id;

  return existing_activation_at;
end;
$$;

revoke all on function public.mark_funnel_first_trusted_signal(uuid)
  from public, anon;
grant execute on function public.mark_funnel_first_trusted_signal(uuid)
  to authenticated, service_role;

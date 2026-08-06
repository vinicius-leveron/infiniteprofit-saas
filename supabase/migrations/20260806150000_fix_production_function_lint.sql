-- Repair two pre-existing production functions found by `supabase db lint`.
-- These changes preserve their public contracts and grants.

create or replace function public.suspend_workspace_meta_sync(
  _workspace_id uuid,
  _reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  affected integer := 0;
  bounded_reason text;
  suspended_at timestamptz := pg_catalog.now();
begin
  bounded_reason := pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(_reason), ''),
      'A sincronização Meta foi suspensa após uma falha permanente da credencial.'
    ),
    2000
  );

  insert into public.workspace_integrations (
    workspace_id,
    created_by,
    meta_sync_suspended_at,
    meta_sync_suspension_reason
  )
  select
    workspace.id,
    workspace.created_by,
    suspended_at,
    bounded_reason
  from public.workspaces workspace
  where workspace.id = _workspace_id
  on conflict (workspace_id) do update
  set
    meta_sync_suspended_at = excluded.meta_sync_suspended_at,
    meta_sync_suspension_reason = excluded.meta_sync_suspension_reason;

  update public.sync_jobs job
  set
    status = 'dead_letter',
    available_at = suspended_at,
    locked_at = null,
    locked_by = null,
    last_error = bounded_reason,
    finished_at = suspended_at,
    payload = coalesce(job.payload, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'failure',
        pg_catalog.jsonb_build_object(
          'kind', 'permanent',
          'cause', 'meta_credential_suspended',
          'failed_at', suspended_at
        )
      )
  where job.workspace_id = _workspace_id
    and job.source in ('meta', 'creative')
    and job.status in ('queued', 'running');

  get diagnostics affected = row_count;

  insert into public.operational_alerts (
    workspace_id,
    project_id,
    source,
    type,
    severity,
    status,
    title,
    message,
    dedupe_key,
    details,
    first_seen_at,
    last_seen_at,
    resolved_at
  )
  select distinct
    project.workspace_id,
    project.id,
    'meta',
    'credential_suspended',
    'critical',
    'active',
    'Meta requer nova credencial',
    bounded_reason,
    'meta-credential-suspended',
    pg_catalog.jsonb_build_object('action', 'replace_meta_credential'),
    suspended_at,
    suspended_at,
    null::timestamptz
  from public.projects project
  join public.project_meta_accounts binding
    on binding.project_id = project.id
  where project.workspace_id = _workspace_id
  on conflict (project_id, type, dedupe_key) do update
  set
    severity = 'critical',
    status = 'active',
    title = excluded.title,
    message = excluded.message,
    details = excluded.details,
    last_seen_at = excluded.last_seen_at,
    resolved_at = null::timestamptz;

  return affected;
end;
$$;

revoke all on function public.suspend_workspace_meta_sync(uuid, text)
  from public, anon, authenticated;
grant execute on function public.suspend_workspace_meta_sync(uuid, text)
  to service_role;

create or replace function public.delete_checkout_integration_secret(
  _integration_id uuid,
  _kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_secret_id uuid;
begin
  select case
    when _kind = 'credential' then integration.credential_secret_id
    when _kind = 'webhook' then integration.webhook_secret_id
    else null
  end
  into current_secret_id
  from public.workspace_checkout_integrations integration
  where integration.id = _integration_id
  for update;

  update public.workspace_checkout_integrations integration
  set
    credential_secret_id = case
      when _kind = 'credential' then null
      else integration.credential_secret_id
    end,
    webhook_secret_id = case
      when _kind = 'webhook' then null
      else integration.webhook_secret_id
    end
  where integration.id = _integration_id;

  if current_secret_id is not null then
    delete from vault.secrets secret
    where secret.id = current_secret_id;
  end if;
end;
$$;

revoke all on function public.delete_checkout_integration_secret(uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_checkout_integration_secret(uuid, text)
  to service_role;

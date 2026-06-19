-- Prevent browser clients from selecting operational secrets. RLS still limits
-- rows by workspace membership/admin role; these grants limit columns exposed
-- through PostgREST/Supabase Data API.

revoke select on table public.workspace_integrations from public, anon, authenticated;
grant select (
  workspace_id,
  vturb_last_event_at,
  gateway_provider,
  gateway_webhook_token,
  gateway_last_event_at,
  created_by,
  created_at,
  updated_at
) on table public.workspace_integrations to authenticated;

revoke select on table public.workspace_meta_accounts from public, anon, authenticated;
grant select (
  id,
  workspace_id,
  account_id,
  label,
  last_synced_at,
  created_by,
  created_at,
  updated_at
) on table public.workspace_meta_accounts to authenticated;

-- Legacy per-user integration table is not part of the SaaS workspace model,
-- but it contains historical secret columns. Keep direct client reads limited
-- to non-secret metadata if any old screen still references it.
do $$
begin
  if to_regclass('public.integrations') is not null then
    revoke select on table public.integrations from public, anon, authenticated;
    grant select (
      project_id,
      user_id,
      meta_account_id,
      meta_last_synced_at,
      gateway_provider,
      vturb_last_event_at,
      gateway_last_event_at,
      created_at,
      updated_at
    ) on table public.integrations to authenticated;
  end if;
end $$;

-- Prevent browser clients from writing operational secret columns directly.
-- Secret replacement goes through the `workspace-credentials` Edge Function,
-- which validates JWT + workspace/org admin role and writes with service_role.

revoke insert, update on table public.workspace_integrations
from public, anon, authenticated;

revoke insert, update on table public.workspace_meta_accounts
from public, anon, authenticated;

do $$
begin
  if to_regclass('public.integrations') is not null then
    execute 'revoke insert, update on table public.integrations from public, anon, authenticated';
  end if;
end $$;

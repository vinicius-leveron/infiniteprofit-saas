#!/usr/bin/env node
import { validateStagingTarget } from "./staging-readiness-fixture-core.mjs";
import { buildSafeVaultStatements } from "./staging-runtime-core.mjs";

const mode = process.argv[2];
if (!["vault", "install"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/configure-staging-runtime.mjs vault|install",
  );
}

const target = validateStagingTarget({
  url: required("VITE_SUPABASE_URL"),
  projectRef: required("SUPABASE_PROJECT_REF"),
  acknowledgement: required("STAGING_FIXTURE_ACK"),
});
const accessToken = required("SUPABASE_ACCESS_TOKEN");
const automationKey = mode === "vault"
  ? required("STAGING_AUTOMATION_KEY")
  : null;

if (mode === "vault") {
  await runQuery(vaultSql({
    projectUrl: target.url,
    automationKey,
  }), true);
} else {
  await runQuery(installSql(), false);
}

console.log(JSON.stringify({
  schema_version: 1,
  environment: "staging",
  project_ref: target.projectRef,
  mode,
  completed_at: new Date().toISOString(),
  configured: true,
}, null, 2));

async function runQuery(query, sensitive) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only: false }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = sensitive
      ? "sensitive query details redacted"
      : String(body?.message ?? body?.error ?? response.statusText).slice(
        0,
        300,
      );
    throw new Error(`Staging runtime query ${response.status}: ${detail}`);
  }
}

function vaultSql({ projectUrl, automationKey: key }) {
  const literals = buildSafeVaultStatements({
    projectUrl,
    automationKey: key,
  });
  return `
    do $configure_vault$
    declare
      target_id uuid;
    begin
      select secret.id into target_id
      from vault.secrets secret
      where secret.name = 'project_url'
      order by secret.created_at
      limit 1;

      if target_id is null then
        perform vault.create_secret(
          ${literals.projectUrlLiteral},
          'project_url',
          'Staging project URL used by pg_cron',
          null
        );
      else
        perform vault.update_secret(
          target_id,
          ${literals.projectUrlLiteral},
          'project_url',
          'Staging project URL used by pg_cron',
          null
        );
      end if;

      target_id := null;
      select secret.id into target_id
      from vault.secrets secret
      where secret.name = 'automation_key'
      order by secret.created_at
      limit 1;

      if target_id is null then
        perform vault.create_secret(
          ${literals.automationKeyLiteral},
          'automation_key',
          'Staging automation key used by pg_cron',
          null
        );
      else
        perform vault.update_secret(
          target_id,
          ${literals.automationKeyLiteral},
          'automation_key',
          'Staging automation key used by pg_cron',
          null
        );
      end if;
    end
    $configure_vault$;
  `;
}

function installSql() {
  return `
    select * from app_private.install_sync_cron_jobs();

    do $install_optional_canary$
    begin
      if pg_catalog.to_regprocedure(
        'app_private.install_backend_canary_cron(text)'
      ) is not null then
        perform app_private.install_backend_canary_cron();
      end if;
    end
    $install_optional_canary$;
  `;
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for staging runtime setup.`);
  return value;
}

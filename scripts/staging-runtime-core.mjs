export function buildSafeVaultStatements({ projectUrl, automationKey }) {
  return {
    projectUrlLiteral: sqlLiteral(projectUrl),
    automationKeyLiteral: sqlLiteral(automationKey),
  };
}

export function buildStagingRuntimeInstallSql() {
  return `
    select * from app_private.install_sync_cron_jobs();

    do $install_optional_runtime$
    begin
      if pg_catalog.to_regprocedure(
        'app_private.tune_sync_worker_cron(integer,integer)'
      ) is not null then
        perform app_private.tune_sync_worker_cron();
      end if;

      if pg_catalog.to_regprocedure(
        'app_private.install_backend_canary_cron(text)'
      ) is not null then
        perform app_private.install_backend_canary_cron();
      end if;
    end
    $install_optional_runtime$;
  `;
}

function sqlLiteral(value) {
  const normalized = String(value ?? "");
  if (!normalized) throw new Error("Vault value must not be empty.");
  if (normalized.includes("\0")) {
    throw new Error("Vault value contains an invalid null byte.");
  }
  return `'${normalized.replaceAll("'", "''")}'`;
}

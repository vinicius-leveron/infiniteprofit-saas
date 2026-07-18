export function buildSafeVaultStatements({ projectUrl, automationKey }) {
  return {
    projectUrlLiteral: sqlLiteral(projectUrl),
    automationKeyLiteral: sqlLiteral(automationKey),
  };
}

function sqlLiteral(value) {
  const normalized = String(value ?? "");
  if (!normalized) throw new Error("Vault value must not be empty.");
  if (normalized.includes("\0")) {
    throw new Error("Vault value contains an invalid null byte.");
  }
  return `'${normalized.replaceAll("'", "''")}'`;
}

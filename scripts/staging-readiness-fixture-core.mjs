export const PRODUCTION_PROJECT_REF = "nztnctrkmfrgclrnflfa";

export function validateStagingTarget({
  url,
  projectRef,
  acknowledgement,
  productionProjectRef = PRODUCTION_PROJECT_REF,
}) {
  const normalizedUrl = String(url ?? "").trim().replace(/\/$/, "");
  const normalizedRef = String(projectRef ?? "").trim();
  const normalizedAck = String(acknowledgement ?? "").trim();

  if (!normalizedUrl || !normalizedRef) {
    throw new Error("Staging URL and project ref are required.");
  }
  if (
    normalizedRef === productionProjectRef ||
    normalizedUrl.includes(productionProjectRef)
  ) {
    throw new Error("Staging fixture refuses the production Supabase project.");
  }
  if (!normalizedUrl.includes(normalizedRef)) {
    throw new Error("Staging URL does not match SUPABASE_PROJECT_REF.");
  }
  if (normalizedAck !== normalizedRef) {
    throw new Error(
      "STAGING_FIXTURE_ACK must exactly match SUPABASE_PROJECT_REF.",
    );
  }

  return { url: normalizedUrl, projectRef: normalizedRef };
}

export function githubEnvironmentLines({ organizationId, workspaceId, projectId }) {
  return [
    `RLS_ORGANIZATION_ID=${requiredId(organizationId, "organization")}`,
    `RLS_WORKSPACE_ID=${requiredId(workspaceId, "workspace")}`,
    `RLS_PROJECT_ID=${requiredId(projectId, "project")}`,
    `LOAD_TEST_WORKSPACE_ID=${workspaceId}`,
  ].join("\n") + "\n";
}

function requiredId(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} id is required.`);
  if (/[\r\n=]/.test(normalized)) {
    throw new Error(`${label} id contains invalid characters.`);
  }
  return normalized;
}

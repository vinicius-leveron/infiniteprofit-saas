const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTOMATION_KEY = Deno.env.get("AUTOMATION_KEY")?.trim() || null;
const RELEASE_AUTOMATION_KEY =
  Deno.env.get("RELEASE_AUTOMATION_KEY")?.trim() || null;

export function isAutomationRequest(req: Request) {
  const apiKey = req.headers.get("apikey")?.trim() || null;
  const authHeader = req.headers.get("Authorization")?.trim() || null;

  // The service-role credential is the root backend identity and is used by
  // release/recovery jobs running in an ephemeral, masked CI environment.
  if (authHeader === `Bearer ${SERVICE_KEY}`) {
    return true;
  }

  if (
    RELEASE_AUTOMATION_KEY &&
    (
      apiKey === RELEASE_AUTOMATION_KEY ||
      authHeader === `Bearer ${RELEASE_AUTOMATION_KEY}`
    )
  ) {
    return true;
  }

  if (AUTOMATION_KEY) {
    return apiKey === AUTOMATION_KEY || authHeader === `Bearer ${AUTOMATION_KEY}`;
  }

  return false;
}

export function buildAutomationHeaders(contentType = "application/json") {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };

  if (AUTOMATION_KEY) {
    headers.apikey = AUTOMATION_KEY;
    return headers;
  }

  headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

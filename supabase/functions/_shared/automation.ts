const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTOMATION_KEY = Deno.env.get("AUTOMATION_KEY")?.trim() || null;

export function isAutomationRequest(req: Request) {
  const apiKey = req.headers.get("apikey")?.trim() || null;
  const authHeader = req.headers.get("Authorization")?.trim() || null;

  if (AUTOMATION_KEY) {
    return apiKey === AUTOMATION_KEY || authHeader === `Bearer ${AUTOMATION_KEY}`;
  }

  return authHeader === `Bearer ${SERVICE_KEY}`;
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

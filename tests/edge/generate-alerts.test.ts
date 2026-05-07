import { describe, expect, it } from "vitest";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const automationKey = process.env.E2E_AUTOMATION_KEY;
const projectId = process.env.E2E_PROJECT_ID;

async function post(functionName: string, body: unknown, headers: Record<string, string>) {
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL is required.");
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { response, json };
}

describe("generate-alerts edge contract", () => {
  it("rejects unauthenticated anonymous calls", async () => {
    if (!supabaseUrl || !anonKey) {
      console.warn("Skipping generate-alerts edge auth test: Supabase env vars are not set.");
      return;
    }

    const { response, json } = await post(
      "generate-alerts",
      { project_id: "00000000-0000-0000-0000-000000000000" },
      { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    );

    expect(response.status).toBe(401);
    expect(String(json.error ?? "")).toMatch(/unauthorized/i);
  });

  it("generates active alerts for a QA project with automation key", async () => {
    if (!supabaseUrl || !automationKey || !projectId) {
      console.warn("Skipping generate-alerts positive test: E2E_AUTOMATION_KEY and E2E_PROJECT_ID are not set.");
      return;
    }

    const { response, json } = await post(
      "generate-alerts",
      { project_id: projectId },
      { apikey: automationKey },
    );

    expect(response.ok).toBe(true);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.alerts)).toBe(true);
    expect(typeof json.generated).toBe("number");
  });
});

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

describe("creative-sync edge contract", () => {
  it("rejects anonymous unauthenticated calls", async () => {
    if (!supabaseUrl || !anonKey) {
      console.warn("Skipping creative-sync auth test: Supabase env vars are not set.");
      return;
    }

    const { response, json } = await post(
      "creative-sync",
      { project_id: "00000000-0000-0000-0000-000000000000" },
      { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    );

    expect([401, 404]).toContain(response.status);
    if (response.status === 401) {
      expect(String(json.error ?? "")).toMatch(/unauthorized/i);
    }
  });

  it("returns a structured result for a QA project with automation key", async () => {
    if (!supabaseUrl || !automationKey || !projectId) {
      console.warn("Skipping creative-sync positive test: E2E_AUTOMATION_KEY and E2E_PROJECT_ID are not set.");
      return;
    }

    const { response, json } = await post(
      "creative-sync",
      { project_id: projectId, days: 7 },
      { apikey: automationKey },
    );

    expect(response.ok).toBe(true);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.results)).toBe(true);
    if (Array.isArray(json.results) && json.results.length > 0) {
      expect(json.results[0]).toEqual(expect.objectContaining({
        project_id: expect.any(String),
      }));
    }
  });
});

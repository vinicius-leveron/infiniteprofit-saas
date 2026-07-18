import { describe, expect, it } from "vitest";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const publicShareToken = process.env.E2E_PUBLIC_SHARE_TOKEN;
const remoteDescribe =
  process.env.RUN_REMOTE_CONTRACT_TESTS === "1" ? describe : describe.skip;

async function invoke(functionName: string, body: unknown, headers: Record<string, string> = {}) {
  if (!supabaseUrl || !anonKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  return { response, json };
}

remoteDescribe("public-share edge contract", () => {
  it("rejects invalid public share tokens without leaking project data", async () => {
    if (!supabaseUrl || !anonKey) {
      console.warn("Skipping public-share edge test: Supabase env vars are not set.");
      return;
    }

    const { response, json } = await invoke("public-share", { token: "invalid-e2e-token" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(json.project).toBeUndefined();
    expect(json.metrics).toBeUndefined();
    expect(String(json.error ?? "")).toMatch(/inválido|invalido|desativado|not found|invalid/i);
  });

  it("returns project and metrics for a valid public token", async () => {
    if (!supabaseUrl || !anonKey || !publicShareToken) {
      console.warn("Skipping valid public-share edge test: E2E_PUBLIC_SHARE_TOKEN is not set.");
      return;
    }

    const { response, json } = await invoke("public-share", { token: publicShareToken });

    expect(response.ok).toBe(true);
    expect(json.ok).toBe(true);
    expect(json.project?.name).toBeTruthy();
    expect(Array.isArray(json.metrics)).toBe(true);
  });
});

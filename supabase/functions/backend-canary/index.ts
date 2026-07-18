import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import { CanaryTarget, runBackendCanary } from "./core.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const appUrl = (
  Deno.env.get("CANARY_APP_URL") ??
    "https://infiniteprofit-saas.onrender.com"
).replace(/\/$/, "");

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!isAutomationRequest(request)) {
    return json({ error: "unauthorized" }, 401);
  }

  const targets: CanaryTarget[] = [
    {
      name: "frontend",
      url: `${appUrl}/`,
      thresholdMs: 3_000,
    },
    {
      name: "auth",
      url: `${supabaseUrl}/auth/v1/health`,
      thresholdMs: 2_000,
      init: { headers: { apikey: anonKey } },
    },
    {
      name: "postgrest",
      url: `${supabaseUrl}/rest/v1/rpc/backend_healthcheck`,
      thresholdMs: 800,
      init: {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    },
  ];

  try {
    const report = await runBackendCanary({ targets });
    const byName = new Map(
      report.results.map((result) => [result.name, result]),
    );
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("backend_canary_runs").insert({
      status: report.status,
      started_at: report.started_at,
      finished_at: report.finished_at,
      duration_ms: report.duration_ms,
      frontend_status: statusCode(byName.get("frontend")),
      frontend_p95_ms: byName.get("frontend")?.p95_ms ?? null,
      auth_status: statusCode(byName.get("auth")),
      auth_p95_ms: byName.get("auth")?.p95_ms ?? null,
      postgrest_status: statusCode(byName.get("postgrest")),
      postgrest_p95_ms: byName.get("postgrest")?.p95_ms ?? null,
      result: report,
    });
    if (error) throw new Error(error.message);

    await supabase
      .from("backend_canary_runs")
      .delete()
      .lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());

    return json(report, report.status === "pass" ? 200 : 503);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "canary unavailable",
    }, 500);
  }
});

function statusCode(result: { statuses: Record<string, number> } | undefined) {
  if (!result) return null;
  const entries = Object.entries(result.statuses);
  if (entries.length !== 1) return null;
  const parsed = Number(entries[0][0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

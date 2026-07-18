import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import { normalizeGatewayWorkerHeartbeat } from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-request-id",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!isAutomationRequest(request)) {
    return json({ error: "unauthorized" }, 401);
  }

  let heartbeat;
  try {
    heartbeat = normalizeGatewayWorkerHeartbeat(
      await request.json().catch(() => null),
    );
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "invalid heartbeat",
    }, 400);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase
      .from("gateway_worker_heartbeats")
      .upsert(heartbeat, { onConflict: "worker_id" });
    if (error) throw new Error(error.message);
    return json({ ok: true, last_seen_at: heartbeat.last_seen_at }, 200);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "heartbeat unavailable",
    }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

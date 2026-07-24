import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }
    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { error } = await admin.from("client_error_events").insert({
      user_id: userId,
      environment: safeText(body.environment, 40, "unknown"),
      release: safeText(body.release, 120, "unknown"),
      route: safeRoute(body.route),
      error_type: safeText(body.error_type, 120, "Error"),
      fingerprint: safeText(body.fingerprint, 128, "unknown-error"),
      safe_message: redact(safeText(body.safe_message, 500, "Unexpected client error")),
    });
    if (error) throw new Error(error.message);
    return json({ ok: true }, 202);
  } catch {
    return json({ error: "Unable to record client error" }, 500);
  }
});

function safeText(value: unknown, max: number, fallback: string) {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, max);
}

function safeRoute(value: unknown) {
  const route = safeText(value, 300, "/");
  return route.split("?")[0].split("#")[0] || "/";
}

function redact(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[?&](token|secret|key|code)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "[id]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Testa rapidamente uma API key da VTurb Analytics.
 * Body: { api_key: string }
 * Resp: { ok: true, platforms: string[] } | { ok: false, error }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = String(body.api_key ?? "").trim();
    if (!apiKey) return json({ ok: false, error: "api_key obrigatória" }, 400);

    const today = new Date();
    const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = past.toISOString().slice(0, 10);

    const r = await fetch("https://analytics.vturb.net/conversions/active_platforms", {
      method: "POST",
      headers: {
        "X-Api-Token": apiKey,
        "X-Api-Version": "v1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start_date: startDate, timezone: "America/Sao_Paulo" }),
    });

    const data: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({
        ok: false,
        error: data?.message ?? data?.error ?? `HTTP ${r.status}`,
      });
    }

    return json({
      ok: true,
      platforms: Array.isArray(data) ? data : [],
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Testa rapidamente um par (account_id, access_token) na Meta API.
 * Body: { account_id: string, access_token: string }
 * Resp: { ok: true, name, account_status, currency } | { ok: false, error }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const rawAcc = String(body.account_id ?? "").trim();
    const token = String(body.access_token ?? "").trim();

    if (!rawAcc || !token) {
      return json({ ok: false, error: "account_id e access_token são obrigatórios" }, 400);
    }

    const accountId = rawAcc.startsWith("act_") ? rawAcc : `act_${rawAcc}`;
    const url = `https://graph.facebook.com/v21.0/${accountId}?fields=name,account_status,currency,timezone_name&access_token=${encodeURIComponent(token)}`;

    const r = await fetch(url);
    const data: any = await r.json().catch(() => ({}));

    if (!r.ok || data.error) {
      const msg = data?.error?.message ?? `HTTP ${r.status}`;
      return json({ ok: false, error: msg, code: data?.error?.code });
    }

    return json({
      ok: true,
      name: data.name ?? null,
      account_status: data.account_status ?? null,
      currency: data.currency ?? null,
      timezone: data.timezone_name ?? null,
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

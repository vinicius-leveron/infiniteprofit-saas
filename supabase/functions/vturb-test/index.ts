/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Testa rapidamente uma API key da VTurb Analytics.
 * Body: { api_key: string }
 * Resp: { ok: true, platforms: string[], players: Array<{ id, name, duration, pitch_time, created_at }> } | { ok: false, error }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = String(body.api_key ?? "").trim();
    if (!apiKey) return json({ ok: false, error: "api_key obrigatória" }, 400);

    const today = new Date();
    const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = `${past.toISOString().slice(0, 10)} 00:00:00 -0300`;

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

    const players = await fetchPlayers(apiKey);

    return json({
      ok: true,
      platforms: Array.isArray(data) ? data : [],
      players,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});

async function fetchPlayers(apiKey: string) {
  const r = await fetch("https://analytics.vturb.net/players/list", {
    method: "GET",
    headers: {
      "X-Api-Token": apiKey,
      "X-Api-Version": "v1",
      "Content-Type": "application/json",
    },
  });

  const data: any = await r.json().catch(() => []);
  const players = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.players)
        ? data.players
        : [];
  if (!r.ok || !Array.isArray(players)) return [];

  return players.map((player: any) => ({
    id: String(player?.id ?? ""),
    name: typeof player?.name === "string" ? player.name : null,
    duration: typeof player?.duration === "number" ? player.duration : null,
    pitch_time: typeof player?.pitch_time === "number" ? player.pitch_time : null,
    created_at: typeof player?.created_at === "string" ? player.created_at : null,
  })).filter((player) => player.id);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

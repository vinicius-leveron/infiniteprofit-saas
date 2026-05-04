/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!isAutomationRequest(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { project_id, dates } = await req.json().catch(() => ({}));
    if (!project_id || !Array.isArray(dates) || dates.length === 0) {
      return json({ error: "project_id and dates[] required" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: project, error: projectError } = await sb
      .from("projects")
      .select("user_id, workspace_id")
      .eq("id", project_id)
      .maybeSingle();

    if (projectError || !project?.workspace_id) {
      return json({ error: "project not found" }, 404);
    }

    let processed = 0;

    for (const date of dates) {
      const { data: events, error: eventsError } = await sb
        .from("raw_events")
        .select("source, event_type, payload")
        .eq("project_id", project_id)
        .eq("event_date", date);

      if (eventsError) {
        console.error("aggregate-daily events error", date, eventsError);
        continue;
      }

      const metrics = aggregateOneDay((events ?? []) as Array<{ source: string; event_type: string; payload: any }>);

      const { error: upsertError } = await sb
        .from("daily_metrics")
        .upsert(
          {
            project_id,
            user_id: project.user_id,
            workspace_id: project.workspace_id,
            event_date: date,
            ...metrics,
          },
          { onConflict: "project_id,event_date" },
        );

      if (upsertError) {
        console.error("aggregate-daily upsert error", date, upsertError);
        continue;
      }

      processed++;
    }

    return json({ ok: true, processed });
  } catch (error) {
    console.error("aggregate-daily error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

function aggregateOneDay(events: Array<{ source: string; event_type: string; payload: any }>) {
  let investimento = 0;
  let impressoes = 0;
  let cliques = 0;

  let pageviews = 0;
  let viewsUnicas = 0;
  let plays = 0;
  let chegaramPitch = 0;

  let vendasFront = 0;
  let vendasTotais = 0;
  let fatBruto = 0;
  let fatLiquido = 0;
  let fatFront = 0;
  let fatOrderbump = 0;
  let fatFunil = 0;
  let reembolsos = 0;
  let valorReembolsado = 0;
  let cardApproved = 0;
  let cardTotal = 0;
  let pixApproved = 0;
  let pixTotal = 0;
  let checkouts = 0;
  const bumpAgg = new Map<string, { name: string; type: string; count: number; revenue: number }>();

  for (const event of events) {
    const payload = event.payload || {};

    if (event.source === "meta" && event.event_type === "insight") {
      investimento += num(payload.spend);
      impressoes += num(payload.impressions);
      cliques += num(payload.clicks);
      continue;
    }

    if (event.source === "vturb") {
      const vturb = extractVturbMetrics(event.event_type, payload);
      pageviews += vturb.pageviews;
      viewsUnicas += vturb.viewsUnicas;
      plays += vturb.plays;
      chegaramPitch += vturb.chegaramPitch;
      continue;
    }

    if (event.source !== "gateway") {
      continue;
    }

    if (event.event_type === "checkout_created") {
      checkouts++;
      continue;
    }

    if (event.event_type === "purchase.approved") {
      vendasTotais++;
      const total = num(payload.total);
      const liquid = num(payload.net ?? payload.total);
      fatBruto += total;
      fatLiquido += liquid;

      const isFront = payload.is_front ?? true;
      if (isFront) {
        vendasFront++;
        fatFront += total;
      } else {
        fatFunil += total;
      }

      const items: any[] = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) {
        if (!item?.is_bump) continue;
        const key = String(item.external_id ?? item.name ?? "");
        if (!key) continue;
        const current = bumpAgg.get(key) ?? {
          name: String(item.name ?? key),
          type: String(item.type ?? "orderbump"),
          count: 0,
          revenue: 0,
        };
        current.count += 1;
        current.revenue += num(item.price);
        fatOrderbump += num(item.price);
        bumpAgg.set(key, current);
      }

      const method = String(payload.payment_method ?? "").toLowerCase();
      if (method.includes("card") || method.includes("cart")) {
        cardApproved++;
        cardTotal++;
      } else if (method.includes("pix")) {
        pixApproved++;
        pixTotal++;
      }
      continue;
    }

    if (event.event_type === "purchase.refused") {
      const method = String(payload.payment_method ?? "").toLowerCase();
      if (method.includes("card") || method.includes("cart")) cardTotal++;
      else if (method.includes("pix")) pixTotal++;
      continue;
    }

    if (event.event_type === "purchase.refunded") {
      reembolsos++;
      valorReembolsado += num(payload.total);
    }
  }

  const cpm = impressoes > 0 ? (investimento / impressoes) * 1000 : null;
  const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : null;
  const cpc = cliques > 0 ? investimento / cliques : null;
  const playRate = pageviews > 0 ? (plays / pageviews) * 100 : null;
  const retPitch = plays > 0 ? (chegaramPitch / plays) * 100 : null;
  const passChk = pageviews > 0 ? (checkouts / pageviews) * 100 : null;
  const pitchChk = chegaramPitch > 0 ? (checkouts / chegaramPitch) * 100 : null;
  const pitchVenda = chegaramPitch > 0 ? (vendasFront / chegaramPitch) * 100 : null;
  const chkVenda = checkouts > 0 ? (vendasFront / checkouts) * 100 : null;
  const custoPageview = pageviews > 0 ? investimento / pageviews : null;
  const custoIC = checkouts > 0 ? investimento / checkouts : null;
  const cpaFront = vendasFront > 0 ? investimento / vendasFront : null;
  const cac = vendasTotais > 0 ? investimento / vendasTotais : null;
  const aov = vendasTotais > 0 ? fatBruto / vendasTotais : null;
  const lucro = fatLiquido - investimento;
  const roi = investimento > 0 ? lucro / investimento : null;
  const taxaReembolso = vendasTotais > 0 ? (reembolsos / vendasTotais) * 100 : null;
  const aprovCartao = cardTotal > 0 ? (cardApproved / cardTotal) * 100 : null;
  const aprovPix = pixTotal > 0 ? (pixApproved / pixTotal) * 100 : null;
  const bumpCount = Array.from(bumpAgg.values()).reduce((sum, bump) => sum + bump.count, 0);
  const convGeralOrderbump = vendasFront > 0 ? (bumpCount / vendasFront) * 100 : null;
  const proporcaoFunilFront = fatFront > 0 ? fatFunil / fatFront : null;

  const bumps = Array.from(bumpAgg.values()).map((bump) => ({
    name: bump.name,
    type: bump.type,
    count: bump.count,
    revenue: bump.revenue,
    rate: vendasFront > 0 ? (bump.count / vendasFront) * 100 : null,
  }));

  return {
    investimento: orNull(investimento),
    impressoes: orNull(impressoes),
    cliques: orNull(cliques),
    cpm,
    ctr,
    cpc,
    pageviews: orNull(pageviews),
    views_unicas: orNull(viewsUnicas),
    play_rate: playRate,
    ret_pitch: retPitch,
    chegaram_pitch: orNull(chegaramPitch),
    checkouts: orNull(checkouts),
    custo_pageview: custoPageview,
    custo_ic: custoIC,
    taxa_carreg: null,
    pass_chk: passChk,
    pitch_chk: pitchChk,
    pitch_venda: pitchVenda,
    chk_venda: chkVenda,
    vendas_front: orNull(vendasFront),
    vendas_totais: orNull(vendasTotais),
    cpa_front: cpaFront,
    cac,
    aov,
    roi,
    lucro: orNull(lucro),
    fat_bruto: orNull(fatBruto),
    fat_liquido: orNull(fatLiquido),
    fat_front: orNull(fatFront),
    fat_orderbump: orNull(fatOrderbump),
    fat_funil: orNull(fatFunil),
    reembolsos: orNull(reembolsos),
    taxa_reembolso: taxaReembolso,
    valor_reembolsado: orNull(valorReembolsado),
    aprov_cartao: aprovCartao,
    aprov_pix: aprovPix,
    conv_geral_orderbump: convGeralOrderbump,
    proporcao_funil_front: proporcaoFunilFront,
    bumps,
  };
}

function extractVturbMetrics(eventType: string, payload: any) {
  if (eventType === "pageview") {
    return { pageviews: 1, viewsUnicas: 0, plays: 0, chegaramPitch: 0 };
  }
  if (eventType === "play") {
    return { pageviews: 0, viewsUnicas: 1, plays: 1, chegaramPitch: 0 };
  }
  if (eventType === "pitch_reached") {
    return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 1 };
  }
  if (eventType === "stats_by_day") {
    const pageviews = firstNumber(payload, [
      "pageviews",
      "page_views",
      "page_views_count",
      "landing_page_views",
      "visits",
    ]);
    const plays = firstNumber(payload, [
      "plays",
      "play",
      "started",
      "video_starts",
      "video_started",
      "viewed",
    ]);
    const viewsUnicas = firstNumber(payload, [
      "views_unicas",
      "unique_views",
      "unique_viewers",
      "visitors",
    ]) || plays;
    const chegaramPitch = firstNumber(payload, [
      "pitch_reached",
      "reached_pitch",
      "sales_page_viewers",
      "pitch",
    ]);
    return { pageviews, viewsUnicas, plays, chegaramPitch };
  }
  if (eventType === "retention_curve") {
    return {
      pageviews: 0,
      viewsUnicas: 0,
      plays: 0,
      chegaramPitch: estimatePitchReached(payload),
    };
  }

  return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 0 };
}

function estimatePitchReached(payload: any) {
  const grouped = Array.isArray(payload?.grouped_timed) ? payload.grouped_timed : [];
  if (grouped.length === 0) return 0;

  for (const point of grouped) {
    const serialized = JSON.stringify(point).toLowerCase();
    if (!serialized.includes("pitch")) continue;
    const direct = firstNumber(point, ["count", "value", "views", "viewers", "users", "started"]);
    if (direct > 0) return direct;
  }

  const points = grouped
    .map((point: any, index: number) => ({
      time: firstNumber(point, ["second", "seconds", "time", "position", "x"]) || index,
      value: firstNumber(point, ["count", "value", "views", "viewers", "users", "started"]),
    }))
    .filter((point) => point.value > 0)
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return 0;
  const pivot = points[Math.floor((points.length - 1) * 0.75)] ?? points[points.length - 1];
  return pivot?.value ?? 0;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = num(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function orNull(value: number) {
  return value === 0 ? null : value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

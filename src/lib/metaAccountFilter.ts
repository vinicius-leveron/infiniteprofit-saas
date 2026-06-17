import type { DailyRow } from "./csv";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reagrega métricas Meta por conta e sobrepõe nas linhas do dashboard.
 * Quando uma conta específica é selecionada, mantém vendas/VSL totais
 * e troca apenas: investimento, impressões, cliques no link, LP views, cpm, ctr, cpc,
 * custo_pageview, custo_ic, cpa_front, cac, lucro, roi.
 */
export async function applyMetaAccountFilter(
  rows: DailyRow[],
  projectId: string,
  accountId: string,
): Promise<DailyRow[]> {
  if (rows.length === 0) return rows;

  const { data: events } = await supabase
    .from("raw_events")
    .select("event_date, payload")
    .eq("project_id", projectId)
    .eq("source", "meta")
    .eq("event_type", "insight")
    .eq("account_id", accountId);

  // Soma por dia (uma conta = um insight por dia, mas defendo agregando)
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number; landingPageviews: number }>();
  for (const ev of events ?? []) {
    const p = (ev.payload as Record<string, unknown>) ?? {};
    const meta = extractMetaTrafficMetrics(p);
    const acc = byDate.get(ev.event_date as string) ?? { spend: 0, impressions: 0, clicks: 0, landingPageviews: 0 };
    acc.spend += meta.spend;
    acc.impressions += meta.impressions;
    acc.clicks += meta.linkClicks;
    acc.landingPageviews += meta.landingPageviews;
    byDate.set(ev.event_date as string, acc);
  }

  return rows.map((r) => {
    if (!r.date) return r;
    const key = ymd(r.date);
    const m = byDate.get(key);
    const investimento = m?.spend ?? null;
    const impressoes = m?.impressions ?? null;
    const cliques = m?.clicks ?? null;
    const landingPageviews = m?.landingPageviews ?? null;
    const cpm = impressoes && impressoes > 0 ? (investimento ?? 0) / impressoes * 1000 : null;
    const ctr = impressoes && impressoes > 0 ? (cliques ?? 0) / impressoes * 100 : null;
    const cpc = cliques && cliques > 0 ? (investimento ?? 0) / cliques : null;
    const taxaCarreg = cliques && cliques > 0 ? ((landingPageviews ?? 0) / cliques) * 100 : null;
    const custoPageview = landingPageviews && landingPageviews > 0 ? (investimento ?? 0) / landingPageviews : null;
    const custoIC = r.checkouts && r.checkouts > 0 ? (investimento ?? 0) / r.checkouts : null;
    const cpaFront = r.vendasFront && r.vendasFront > 0 ? (investimento ?? 0) / r.vendasFront : null;
    const cac = r.vendasTotais && r.vendasTotais > 0 ? (investimento ?? 0) / r.vendasTotais : null;
    const lucro = (r.fatLiquido ?? 0) - (investimento ?? 0);
    const roi = investimento && investimento > 0 ? lucro / investimento : null;
    return {
      ...r,
      investimento,
      impressoes,
      cliques,
      landingPageviews,
      cpm,
      ctr,
      cpc,
      taxaCarreg,
      custoPageview,
      custoIC,
      cpaFront,
      cac,
      lucro,
      roi,
    };
  });
}

function extractMetaTrafficMetrics(payload: Record<string, unknown>) {
  const linkClicks =
    firstActionNumber(payload.actions, ["link_click"])
    ?? firstActionNumber(payload.actions, ["omni_link_click"])
    ?? firstActionNumber(payload.outbound_clicks, ["outbound_click", "link_click"])
    ?? num(payload.clicks);
  const landingPageviews =
    firstActionNumber(payload.actions, ["landing_page_view"])
    ?? firstActionNumber(payload.actions, ["omni_landing_page_view"])
    ?? 0;

  return {
    spend: num(payload.spend),
    impressions: num(payload.impressions),
    linkClicks,
    landingPageviews,
  };
}

function firstActionNumber(actions: unknown, actionTypes: string[]) {
  if (!Array.isArray(actions)) return null;

  for (const actionType of actionTypes) {
    let found = false;
    let total = 0;
    for (const action of actions) {
      const item = action as { action_type?: unknown; value?: unknown };
      if (String(item?.action_type ?? "").toLowerCase() !== actionType) continue;
      found = true;
      total += num(item?.value);
    }
    if (found) return total;
  }

  return null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
}
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

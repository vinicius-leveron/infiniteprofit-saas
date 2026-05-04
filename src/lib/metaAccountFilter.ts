import type { DailyRow } from "./csv";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reagrega métricas Meta por conta e sobrepõe nas linhas do dashboard.
 * Quando uma conta específica é selecionada, mantém vendas/VSL totais
 * e troca apenas: investimento, impressões, cliques, cpm, ctr, cpc,
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
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const ev of events ?? []) {
    const p = (ev.payload as Record<string, unknown>) ?? {};
    const acc = byDate.get(ev.event_date as string) ?? { spend: 0, impressions: 0, clicks: 0 };
    acc.spend += num(p.spend);
    acc.impressions += num(p.impressions);
    acc.clicks += num(p.clicks);
    byDate.set(ev.event_date as string, acc);
  }

  return rows.map((r) => {
    if (!r.date) return r;
    const key = ymd(r.date);
    const m = byDate.get(key);
    const investimento = m?.spend ?? null;
    const impressoes = m?.impressions ?? null;
    const cliques = m?.clicks ?? null;
    const cpm = impressoes && impressoes > 0 ? (investimento ?? 0) / impressoes * 1000 : null;
    const ctr = impressoes && impressoes > 0 ? (cliques ?? 0) / impressoes * 100 : null;
    const cpc = cliques && cliques > 0 ? (investimento ?? 0) / cliques : null;
    const custoPageview = r.pageviews && r.pageviews > 0 ? (investimento ?? 0) / r.pageviews : null;
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
      cpm,
      ctr,
      cpc,
      custoPageview,
      custoIC,
      cpaFront,
      cac,
      lucro,
      roi,
    };
  });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) ? n : 0;
}
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
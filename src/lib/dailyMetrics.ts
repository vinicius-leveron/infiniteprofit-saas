import type { DailyRow, BumpDaily } from "./csv";

/** Linha como vem do banco public.daily_metrics */
export interface DailyMetricsRow {
  event_date: string; // YYYY-MM-DD
  investimento: number | null; impressoes: number | null; cliques: number | null;
  cpm: number | null; ctr: number | null; cpc: number | null;
  pageviews: number | null; views_unicas: number | null; play_rate: number | null;
  ret_pitch: number | null; chegaram_pitch: number | null;
  checkouts: number | null; custo_pageview: number | null; custo_ic: number | null;
  taxa_carreg: number | null; pass_chk: number | null;
  pitch_chk: number | null; pitch_venda: number | null; chk_venda: number | null;
  vendas_front: number | null; vendas_totais: number | null;
  cpa_front: number | null; cac: number | null; aov: number | null; roi: number | null; lucro: number | null;
  fat_bruto: number | null; fat_liquido: number | null;
  fat_front: number | null; fat_orderbump: number | null; fat_funil: number | null;
  reembolsos: number | null; taxa_reembolso: number | null; valor_reembolsado: number | null;
  aprov_cartao: number | null; aprov_pix: number | null;
  conv_geral_orderbump: number | null; proporcao_funil_front: number | null;
  obs: string | null;
  bumps: Array<{
    name: string;
    type?: "orderbump" | "upsell";
    count: number | null;
    revenue: number | null;
    rate?: number | null;
  }> | null;
}

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function dateFromISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtBR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function dailyMetricsToDailyRows(rows: DailyMetricsRow[]): DailyRow[] {
  return rows
    .map((r): DailyRow | null => {
      const date = dateFromISO(r.event_date);
      if (!date) return null;
      const bumps: BumpDaily[] = (r.bumps ?? []).map((b) => ({
        name: b.name,
        type: b.type ?? "orderbump",
        count: b.count ?? null,
        revenue: b.revenue ?? null,
        rate: b.rate ?? null,
      }));
      return {
        data: fmtBR(date),
        date,
        diaSemana: WEEKDAYS[date.getDay()],
        investimento: r.investimento,
        vendasFront: r.vendas_front,
        vendasTotais: r.vendas_totais,
        cpaFront: r.cpa_front,
        fatBruto: r.fat_bruto,
        fatLiquido: r.fat_liquido,
        roi: r.roi,
        lucro: r.lucro,
        cac: r.cac,
        aov: r.aov,
        fatFront: r.fat_front,
        fatOrderbump: r.fat_orderbump,
        fatFunil: r.fat_funil,
        reembolsos: r.reembolsos,
        taxaReembolso: r.taxa_reembolso,
        valorReembolsado: r.valor_reembolsado,
        aprovCartao: r.aprov_cartao,
        aprovPix: r.aprov_pix,
        impressoes: r.impressoes,
        cliques: r.cliques,
        pageviews: r.pageviews,
        checkouts: r.checkouts,
        cpm: r.cpm,
        ctr: r.ctr,
        cpc: r.cpc,
        custoPageview: r.custo_pageview,
        custoIC: r.custo_ic,
        taxaCarreg: r.taxa_carreg,
        passChk: r.pass_chk,
        playRate: r.play_rate,
        retPitch: r.ret_pitch,
        viewsUnicas: r.views_unicas,
        chegaramPitch: r.chegaram_pitch,
        pitchChk: r.pitch_chk,
        pitchVenda: r.pitch_venda,
        chkVenda: r.chk_venda,
        obs: r.obs ?? "",
        convGeralOrderbump: r.conv_geral_orderbump,
        proporcaoFunilFront: r.proporcao_funil_front,
        bumps,
      };
    })
    .filter((x): x is DailyRow => x != null)
    .sort((a, b) => (a.date && b.date ? a.date.getTime() - b.date.getTime() : 0));
}
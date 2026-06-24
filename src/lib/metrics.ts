import type { DailyRow } from "./csv";

export const META_TAX_RATE = 0.1215;

export const fBRL = (v: number | null | undefined) =>
  v == null || isNaN(v as number)
    ? "—"
    : "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fPct = (v: number | null | undefined, d = 1) =>
  v == null || isNaN(v as number) ? "—" : Number(v).toFixed(d) + "%";

export const fNum = (v: number | null | undefined) =>
  v == null || isNaN(v as number) ? "—" : Number(v).toLocaleString("pt-BR");

export const fMult = (v: number | null | undefined, d = 2) =>
  v == null || isNaN(v as number) ? "—" : Number(v).toFixed(d) + "x";

const sumK = (rows: DailyRow[], k: keyof DailyRow): number =>
  rows.reduce((s, r) => s + (typeof r[k] === "number" && !isNaN(r[k] as number) ? (r[k] as number) : 0), 0);

const safeDiv = (a: number, b: number): number | null => (b ? a / b : null);

export interface KpiTotals {
  days: number;
  investimento: number;
  vendasTotais: number;
  vendasFront: number;
  fatBruto: number;
  fatLiquido: number;
  impostoMeta: number;
  fatFront: number;
  fatOrderbump: number;
  fatFunil: number;
  lucro: number;
  reembolsos: number;
  valorReembolsado: number;
  impressoes: number;
  cliques: number;
  landingPageviews: number;
  pageviews: number;
  checkouts: number;
  // computed
  roi: number | null;
  cac: number | null;
  aov: number | null;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  custoPageview: number | null;
  custoIC: number | null;
  taxaCarreg: number | null; // landingPageviews/cliques
  passChk: number | null; // checkouts/pageviews VSL
  taxaReembolso: number | null;
  // averages from daily values
  avgPlayRate: number | null;
  avgRetPitch: number | null;
  avgPitchChk: number | null;
  avgPitchVenda: number | null;
  avgChkVenda: number | null;
  avgAprovCartao: number | null;
  avgAprovPix: number | null;
}

const avgK = (rows: DailyRow[], k: keyof DailyRow): number | null => {
  const vals = rows
    .map((r) => r[k])
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
};

export function computeTotals(rows: DailyRow[]): KpiTotals {
  const investimento = sumK(rows, "investimento");
  const vendasTotais = sumK(rows, "vendasTotais");
  const vendasFront = sumK(rows, "vendasFront");
  const fatBruto = sumK(rows, "fatBruto");
  const fatLiquido = sumK(rows, "fatLiquido");
  const impostoMeta = rows.reduce((sum, row) => {
    const rowInvestimento = typeof row.investimento === "number" && !isNaN(row.investimento) ? row.investimento : 0;
    const rowImposto = typeof row.impostoMeta === "number" && !isNaN(row.impostoMeta)
      ? row.impostoMeta
      : rowInvestimento * META_TAX_RATE;
    return sum + rowImposto;
  }, 0);
  const fatFront = sumK(rows, "fatFront");
  const fatOrderbump = sumK(rows, "fatOrderbump");
  const fatFunil = sumK(rows, "fatFunil");
  const lucro = rows.reduce((sum, row) => {
    if (typeof row.lucro === "number" && !isNaN(row.lucro)) return sum + row.lucro;
    const rowFatLiquido = typeof row.fatLiquido === "number" && !isNaN(row.fatLiquido) ? row.fatLiquido : 0;
    const rowInvestimento = typeof row.investimento === "number" && !isNaN(row.investimento) ? row.investimento : 0;
    const rowImposto = typeof row.impostoMeta === "number" && !isNaN(row.impostoMeta)
      ? row.impostoMeta
      : rowInvestimento * META_TAX_RATE;
    return sum + rowFatLiquido - rowInvestimento - rowImposto;
  }, 0);
  const reembolsos = sumK(rows, "reembolsos");
  const valorReembolsado = sumK(rows, "valorReembolsado");
  const impressoes = sumK(rows, "impressoes");
  const cliques = sumK(rows, "cliques");
  const landingPageviews = sumK(rows, "landingPageviews");
  const pageviews = sumK(rows, "pageviews");
  const checkouts = sumK(rows, "checkouts");
  const chegaramPitch = sumK(rows, "chegaramPitch");
  const estimatedPlays = rows.reduce((sum, row) => {
    const rowPageviews = typeof row.pageviews === "number" ? row.pageviews : 0;
    const rowPlayRate = typeof row.playRate === "number" ? row.playRate : null;
    return sum + (rowPlayRate == null ? 0 : (rowPageviews * rowPlayRate) / 100);
  }, 0);

  return {
    days: rows.length,
    investimento,
    vendasTotais,
    vendasFront,
    fatBruto,
    fatLiquido,
    impostoMeta,
    fatFront,
    fatOrderbump,
    fatFunil,
    lucro,
    reembolsos,
    valorReembolsado,
    impressoes,
    cliques,
    landingPageviews,
    pageviews,
    checkouts,
    roi: safeDiv(fatLiquido - impostoMeta, investimento),
    cac: safeDiv(investimento, vendasTotais),
    aov: safeDiv(fatLiquido, vendasTotais),
    cpm: impressoes ? (investimento / impressoes) * 1000 : null,
    ctr: impressoes ? (cliques / impressoes) * 100 : null,
    cpc: safeDiv(investimento, cliques),
    custoPageview: safeDiv(investimento, landingPageviews),
    custoIC: safeDiv(investimento, checkouts),
    taxaCarreg: cliques ? (landingPageviews / cliques) * 100 : null,
    passChk: pageviews ? (checkouts / pageviews) * 100 : null,
    taxaReembolso: vendasTotais ? (reembolsos / vendasTotais) * 100 : null,
    avgPlayRate: pageviews ? (estimatedPlays / pageviews) * 100 : avgK(rows, "playRate"),
    avgRetPitch: estimatedPlays ? (chegaramPitch / estimatedPlays) * 100 : avgK(rows, "retPitch"),
    avgPitchChk: chegaramPitch ? (checkouts / chegaramPitch) * 100 : avgK(rows, "pitchChk"),
    avgPitchVenda: chegaramPitch ? (vendasFront / chegaramPitch) * 100 : avgK(rows, "pitchVenda"),
    avgChkVenda: checkouts ? (vendasFront / checkouts) * 100 : avgK(rows, "chkVenda"),
    avgAprovCartao: avgK(rows, "aprovCartao"),
    avgAprovPix: avgK(rows, "aprovPix"),
  };
}

/** Aggregate sales/profit/investment by weekday (segunda → domingo) */
export function weekdayAggregates(rows: DailyRow[]) {
  const order = [
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
    "domingo",
  ];
  const map = new Map<string, { vendas: number; investimento: number; fatLiquido: number; days: number }>();
  order.forEach((d) => map.set(d, { vendas: 0, investimento: 0, fatLiquido: 0, days: 0 }));
  rows.forEach((r) => {
    const k = (r.diaSemana || "").toLowerCase();
    const slot = map.get(k);
    if (!slot) return;
    slot.vendas += r.vendasTotais ?? 0;
    slot.investimento += r.investimento ?? 0;
    slot.fatLiquido += r.fatLiquido ?? 0;
    slot.days += 1;
  });
  return order.map((d) => ({
    dia: d.replace("-feira", "").replace(/^./, (c) => c.toUpperCase()),
    diaFull: d,
    ...map.get(d)!,
    avgVendas: map.get(d)!.days ? map.get(d)!.vendas / map.get(d)!.days : 0,
  }));
}

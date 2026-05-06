export type CoverageStatus = "OK" | "Parcial" | "Faltando";

export interface CoverageInput {
  rawBySource: Record<string, number>;
  rawByType: Record<string, number>;
  metricFilled: Record<string, number>;
  totalMetricDays: number;
}

export interface CoverageRow {
  group: "Tráfego Meta" | "VSL VTurb" | "Checkout Hubla" | "Derivados de funil";
  kpi: string;
  source: string;
  rawFound: number;
  metricFilled: number;
  status: CoverageStatus;
  reason: string;
}

interface CoverageDef {
  group: CoverageRow["group"];
  kpi: string;
  source: string;
  rawSource?: string;
  rawTypes?: string[];
  metricKeys: string[];
  partialReason?: string;
}

const DEFINITIONS: CoverageDef[] = [
  {
    group: "Tráfego Meta",
    kpi: "Investimento, Impressões, Cliques",
    source: "Meta",
    rawSource: "meta",
    rawTypes: ["insight", "insight_account"],
    metricKeys: ["investimento", "impressoes", "cliques"],
  },
  {
    group: "Tráfego Meta",
    kpi: "CPM, CTR, CPC",
    source: "Meta",
    rawSource: "meta",
    rawTypes: ["insight", "insight_account"],
    metricKeys: ["cpm", "ctr", "cpc"],
  },
  {
    group: "VSL VTurb",
    kpi: "Pageviews, Visualizações únicas",
    source: "VTurb",
    rawSource: "vturb",
    rawTypes: ["stats_by_day"],
    metricKeys: ["pageviews", "views_unicas"],
    partialReason: "VTurb entrega agregados por player/dia; a precisão depende dos campos disponíveis no payload.",
  },
  {
    group: "VSL VTurb",
    kpi: "Play Rate, Retenção Pitch, Chegaram no Pitch",
    source: "VTurb",
    rawSource: "vturb",
    rawTypes: ["stats_by_day"],
    metricKeys: ["play_rate", "ret_pitch", "chegaram_pitch"],
    partialReason: "Alguns players retornam apenas proxies de visualização; quando o payload não traz pitch explícito, o KPI fica parcial.",
  },
  {
    group: "Checkout Hubla",
    kpi: "Vendas, Faturamento, Reembolso",
    source: "Hubla",
    rawSource: "gateway",
    metricKeys: ["vendas_totais", "fat_liquido", "reembolsos", "valor_reembolsado"],
  },
  {
    group: "Checkout Hubla",
    kpi: "Aprovação cartão/PIX",
    source: "Hubla",
    rawSource: "gateway",
    metricKeys: ["aprov_cartao", "aprov_pix"],
    partialReason: "Depende de eventos recusados e do método de pagamento no payload.",
  },
  {
    group: "Checkout Hubla",
    kpi: "Orderbump/Upsell e faturamento por bump",
    source: "Hubla",
    rawSource: "gateway",
    metricKeys: ["fat_orderbump", "fat_funil", "conv_geral_orderbump"],
    partialReason: "Depende de itens/ofertas no payload do checkout, nem todos os eventos trazem essa quebra.",
  },
  {
    group: "Derivados de funil",
    kpi: "Pitch -> Checkout, Pitch -> Venda, Checkout -> Venda",
    source: "VTurb + Hubla",
    rawTypes: ["stats_by_day", "payment_approved", "payment_refused", "payment_refunded", "webhook"],
    metricKeys: ["pitch_chk", "pitch_venda", "chk_venda"],
    partialReason: "É agregado por dia; ainda não é atribuição por sessão, UTM, fbclid ou transação.",
  },
  {
    group: "Derivados de funil",
    kpi: "Taxa de carregamento e custos por etapa",
    source: "Meta + VTurb + Hubla",
    rawTypes: ["insight", "insight_account", "stats_by_day"],
    metricKeys: ["taxa_carreg", "custo_pageview", "custo_ic", "pass_chk"],
    partialReason: "Combina fontes por data; fica parcial quando alguma fonte do dia está ausente.",
  },
];

export function buildCoverageRows(input: CoverageInput): CoverageRow[] {
  return DEFINITIONS.map((def) => {
    const rawFound = countRaw(def, input);
    const metricFilled = countMetrics(def.metricKeys, input.metricFilled);
    const status = resolveStatus(rawFound, metricFilled, def);
    return {
      group: def.group,
      kpi: def.kpi,
      source: def.source,
      rawFound,
      metricFilled,
      status,
      reason: buildReason(status, rawFound, metricFilled, def),
    };
  });
}

export function summarizeCoverage(rows: CoverageRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { OK: 0, Parcial: 0, Faltando: 0 } as Record<CoverageStatus, number>,
  );
}

function countRaw(def: CoverageDef, input: CoverageInput) {
  const bySource = def.rawSource ? input.rawBySource[def.rawSource] ?? 0 : 0;
  const byType = (def.rawTypes ?? []).reduce((sum, type) => sum + (input.rawByType[type] ?? 0), 0);
  return Math.max(bySource, byType);
}

function countMetrics(keys: string[], metricFilled: Record<string, number>) {
  return keys.reduce((sum, key) => sum + (metricFilled[key] ?? 0), 0);
}

function resolveStatus(rawFound: number, metricFilled: number, def: CoverageDef): CoverageStatus {
  if (rawFound === 0 && metricFilled === 0) return "Faltando";
  if (metricFilled === 0) return "Parcial";
  if (def.partialReason) return "Parcial";
  return "OK";
}

function buildReason(status: CoverageStatus, rawFound: number, metricFilled: number, def: CoverageDef) {
  if (status === "Faltando") {
    return "Sem evento bruto e sem daily_metrics preenchido para este KPI.";
  }
  if (metricFilled === 0) {
    return "Evento bruto existe, mas o agregado diário ainda não preencheu o KPI.";
  }
  if (def.partialReason) return def.partialReason;
  return `Fonte real encontrada e ${metricFilled} preenchimento(s) em daily_metrics.`;
}

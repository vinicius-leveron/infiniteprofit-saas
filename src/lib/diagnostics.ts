import type { DailyRow } from "./csv";
import { computeTotals, type KpiTotals } from "./metrics";

export type Severity = "yellow" | "red";
export type Direction = "up" | "down";
/** Para cada métrica, dizemos qual direção é RUIM (gera alerta). */
type BadDirection = "up" | "down";

export interface DiagnosticAlert {
  metric: string;
  category: "Geral" | "Tráfego" | "Funil VSL" | "Bumps & Upsell";
  current: number | null;
  previous: number | null;
  /** Variação em pontos percentuais relativos (ex: 12 = +12%) */
  changePct: number;
  direction: Direction;
  severity: Severity;
  /** Texto curto explicando o contexto */
  message: string;
}

interface MetricDef {
  key: string;
  label: string;
  category: DiagnosticAlert["category"];
  /** Direção considerada RUIM (que dispara alerta). */
  bad: BadDirection;
  get: (t: KpiTotals) => number | null;
}

const METRICS: MetricDef[] = [
  // Geral
  { key: "fatLiquido", label: "Faturamento Líquido", category: "Geral", bad: "down", get: (t) => t.fatLiquido },
  { key: "lucro", label: "Lucro", category: "Geral", bad: "down", get: (t) => t.lucro },
  { key: "roi", label: "ROI", category: "Geral", bad: "down", get: (t) => t.roi },
  { key: "vendasTotais", label: "Vendas Totais", category: "Geral", bad: "down", get: (t) => t.vendasTotais },
  { key: "vendasFront", label: "Vendas Front", category: "Geral", bad: "down", get: (t) => t.vendasFront },
  { key: "investimento", label: "Investimento", category: "Geral", bad: "down", get: (t) => t.investimento },
  { key: "cac", label: "CAC", category: "Geral", bad: "up", get: (t) => t.cac },
  { key: "aov", label: "AOV (Ticket)", category: "Geral", bad: "down", get: (t) => t.aov },
  { key: "taxaReembolso", label: "Taxa de Reembolso", category: "Geral", bad: "up", get: (t) => t.taxaReembolso },
  { key: "avgAprovCartao", label: "Aprov. Cartão", category: "Geral", bad: "down", get: (t) => t.avgAprovCartao },
  { key: "avgAprovPix", label: "Aprov. Pix", category: "Geral", bad: "down", get: (t) => t.avgAprovPix },

  // Tráfego
  { key: "impressoes", label: "Impressões", category: "Tráfego", bad: "down", get: (t) => t.impressoes },
  { key: "cliques", label: "Cliques", category: "Tráfego", bad: "down", get: (t) => t.cliques },
  { key: "ctr", label: "CTR", category: "Tráfego", bad: "down", get: (t) => t.ctr },
  { key: "taxaCarreg", label: "Taxa de Carregamento", category: "Tráfego", bad: "down", get: (t) => t.taxaCarreg },
  { key: "passChk", label: "Pageview → Checkout", category: "Tráfego", bad: "down", get: (t) => t.passChk },
  { key: "cpm", label: "CPM", category: "Tráfego", bad: "up", get: (t) => t.cpm },
  { key: "cpc", label: "CPC", category: "Tráfego", bad: "up", get: (t) => t.cpc },
  { key: "custoPageview", label: "Custo por Pageview", category: "Tráfego", bad: "up", get: (t) => t.custoPageview },
  { key: "custoIC", label: "Custo por I.C.", category: "Tráfego", bad: "up", get: (t) => t.custoIC },

  // Funil VSL
  { key: "avgPlayRate", label: "Play Rate", category: "Funil VSL", bad: "down", get: (t) => t.avgPlayRate },
  { key: "avgRetPitch", label: "Retenção do Pitch", category: "Funil VSL", bad: "down", get: (t) => t.avgRetPitch },
  { key: "avgPitchChk", label: "Pitch → Checkout", category: "Funil VSL", bad: "down", get: (t) => t.avgPitchChk },
  { key: "avgPitchVenda", label: "Pitch → Venda", category: "Funil VSL", bad: "down", get: (t) => t.avgPitchVenda },
  { key: "avgChkVenda", label: "Checkout → Venda", category: "Funil VSL", bad: "down", get: (t) => t.avgChkVenda },

  // Bumps & Upsell
  { key: "fatOrderbump", label: "Faturamento Orderbump", category: "Bumps & Upsell", bad: "down", get: (t) => t.fatOrderbump },
  { key: "fatFunil", label: "Faturamento Funil", category: "Bumps & Upsell", bad: "down", get: (t) => t.fatFunil },
];

const YELLOW_MIN = 5;
const RED_MIN = 20;

/**
 * Compara totais e retorna alertas amarelos (5–19%) e vermelhos (≥20%)
 * apenas quando a variação acontece na direção considerada ruim.
 */
export function buildDiagnostics(
  current: DailyRow[],
  previous: DailyRow[],
): DiagnosticAlert[] {
  if (!current.length || !previous.length) return [];
  const cur = computeTotals(current);
  const prev = computeTotals(previous);

  const alerts: DiagnosticAlert[] = [];
  for (const m of METRICS) {
    const c = m.get(cur);
    const p = m.get(prev);
    if (c == null || p == null) continue;
    if (p === 0) continue; // evita divisão por zero
    const change = ((c - p) / Math.abs(p)) * 100;
    const abs = Math.abs(change);
    if (abs < YELLOW_MIN) continue;

    const direction: Direction = change > 0 ? "up" : "down";
    // só alerta se a variação for na direção ruim
    if (direction !== m.bad) continue;

    const severity: Severity = abs >= RED_MIN ? "red" : "yellow";
    alerts.push({
      metric: m.label,
      category: m.category,
      current: c,
      previous: p,
      changePct: change,
      direction,
      severity,
      message: buildMessage(m.label, direction, abs),
    });
  }

  // ordena: vermelhos primeiro, depois maior variação
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "red" ? -1 : 1;
    return Math.abs(b.changePct) - Math.abs(a.changePct);
  });
  return alerts;
}

function buildMessage(label: string, dir: Direction, abs: number): string {
  const verb = dir === "up" ? "subiu" : "caiu";
  return `${label} ${verb} ${abs.toFixed(1)}% vs período anterior`;
}

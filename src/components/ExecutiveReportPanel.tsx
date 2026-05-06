import { AlertTriangle } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { computeTotals, fBRL, fMult, fNum, fPct } from "@/lib/metrics";

interface ExecutiveReportPanelProps {
  current: DailyRow[];
  previous: DailyRow[];
}

export function ExecutiveReportPanel({ current, previous }: ExecutiveReportPanelProps) {
  const totals = computeTotals(current);
  const prev = previous.length ? computeTotals(previous) : null;
  const bestDay = [...current].sort((a, b) => (b.fatLiquido ?? 0) - (a.fatLiquido ?? 0))[0] ?? null;
  const worstDay = [...current].sort((a, b) => (a.fatLiquido ?? 0) - (b.fatLiquido ?? 0))[0] ?? null;
  const dataAlerts = buildDataAlerts(current);
  const recommendation = buildRecommendation(totals, dataAlerts);

  return (
    <div className="space-y-4">
      <div className="section-card">
        <h2 className="text-base font-semibold mb-1">Relatório Executivo</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Resumo do período atual com comparação, gargalo principal e alertas de qualidade dos dados.
        </p>
        <div className="grid sm:grid-cols-4 gap-3">
          <ReportStat label="Faturamento" value={fBRL(totals.fatLiquido)} delta={delta(totals.fatLiquido, prev?.fatLiquido)} />
          <ReportStat label="Investimento" value={fBRL(totals.investimento)} delta={delta(totals.investimento, prev?.investimento)} />
          <ReportStat label="Vendas" value={fNum(totals.vendasTotais)} delta={delta(totals.vendasTotais, prev?.vendasTotais)} />
          <ReportStat label="ROI" value={fMult(totals.roi)} delta={delta(totals.roi, prev?.roi)} />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="section-card">
          <h3 className="text-sm font-semibold mb-3">Leitura do período</h3>
          <div className="space-y-2 text-sm">
            <Line label="Melhor dia" value={bestDay ? `${bestDay.data} · ${fBRL(bestDay.fatLiquido)}` : "—"} />
            <Line label="Pior dia" value={worstDay ? `${worstDay.data} · ${fBRL(worstDay.fatLiquido)}` : "—"} />
            <Line label="Checkout -> Venda" value={fPct(totals.avgChkVenda)} />
            <Line label="Custo por checkout" value={fBRL(totals.custoIC)} />
            <Line label="Gargalo principal" value={mainBottleneck(totals)} />
          </div>
        </div>

        <div className="section-card">
          <h3 className="text-sm font-semibold mb-3">Alertas e acao recomendada</h3>
          {dataAlerts.length > 0 ? (
            <div className="mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-xs font-semibold text-amber-600">Alertas de qualidade dos dados</span>
              </div>
              <div className="space-y-1">
                {dataAlerts.map((alert) => (
                  <p key={alert} className="text-xs text-muted-foreground">• {alert}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-3">Sem alerta critico de dados no periodo filtrado.</p>
          )}
          <div className="rounded-md border border-border/50 p-3 text-sm">
            {recommendation}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportStat({ label, value, delta: deltaValue }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{deltaValue}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/30 pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function delta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return "sem comparação";
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs anterior`;
}

function buildDataAlerts(rows: DailyRow[]) {
  const alerts: string[] = [];
  if (rows.some((row) => (row.investimento ?? 0) > 0 && (row.pageviews ?? 0) === 0)) {
    alerts.push("Há dias com gasto Meta e sem pageview VTurb.");
  }
  if (rows.some((row) => (row.checkouts ?? 0) > 0 && (row.vendasTotais ?? 0) === 0)) {
    alerts.push("Há dias com checkout e sem venda aprovada.");
  }
  if (rows.some((row) => (row.vendasTotais ?? 0) > 0 && (row.investimento ?? 0) === 0)) {
    alerts.push("Há vendas em dias sem origem de mídia no agregado.");
  }
  return alerts;
}

function mainBottleneck(totals: ReturnType<typeof computeTotals>) {
  if ((totals.taxaCarreg ?? 100) < 50) return "Carregamento entre clique e pageview.";
  if ((totals.avgPlayRate ?? 100) < 40) return "Play rate da VSL.";
  if ((totals.avgPitchChk ?? 100) < 10) return "Pitch para checkout.";
  if ((totals.avgChkVenda ?? 100) < 20) return "Checkout para venda.";
  return "Sem gargalo dominante no agregado.";
}

function buildRecommendation(totals: ReturnType<typeof computeTotals>, alerts: string[]) {
  if (alerts.length > 0) return "Antes de otimizar campanha, corrija a cobertura dos dados no Diagnóstico.";
  if ((totals.roi ?? 0) < 1) return "Priorize reduzir CPC/CAC ou ajustar oferta antes de escalar gasto.";
  if ((totals.avgChkVenda ?? 100) < 20) return "Revise checkout, método de pagamento e recuperação de abandono.";
  if ((totals.avgPitchChk ?? 100) < 10) return "Revise pitch, CTA e momento de chamada para checkout na VSL.";
  return "Manter monitoramento e testar escala controlada nos dias/campanhas com melhor retorno.";
}

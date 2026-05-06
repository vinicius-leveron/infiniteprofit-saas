import type { DailyRow } from "@/lib/csv";
import { fBRL, fNum, fPct } from "@/lib/metrics";

interface AttributionPanelProps {
  rows: DailyRow[];
}

export function AttributionPanel({ rows }: AttributionPanelProps) {
  const sorted = [...rows].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  return (
    <div className="section-card">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold">Atribuicao V1</h2>
          <p className="text-xs text-muted-foreground">
            Cruzamento diario entre Meta, VTurb e Hubla. Nao e atribuicao por sessao.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-600 text-[10px] font-semibold shrink-0">
          Agregado diario
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border/50">
            <tr>
              <th className="text-left py-2 pr-3">Dia</th>
              <th className="text-right py-2 pr-3">Gasto</th>
              <th className="text-right py-2 pr-3">Cliques</th>
              <th className="text-right py-2 pr-3">Pageviews</th>
              <th className="text-right py-2 pr-3">Checkouts</th>
              <th className="text-right py-2 pr-3">Vendas</th>
              <th className="text-right py-2 pr-3">Custo/play</th>
              <th className="text-right py-2 pr-3">Custo/checkout</th>
              <th className="text-left py-2">Gargalo</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const pageviews = row.pageviews ?? 0;
              const checkouts = row.checkouts ?? 0;
              const investimento = row.investimento ?? 0;
              const chegaramPitch = row.chegaramPitch ?? row.viewsUnicas ?? 0;
              return (
                <tr key={row.data} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.data}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.investimento)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.cliques)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.pageviews)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.checkouts)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.vendasTotais)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(chegaramPitch ? investimento / chegaramPitch : null)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(checkouts ? investimento / checkouts : null)}</td>
                  <td className="py-2 text-xs text-muted-foreground min-w-[220px]">{gargalo(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <MiniStat label="Play -> Checkout" value={fPct(rate(sum(rows, "checkouts"), sum(rows, "chegaramPitch")))} />
        <MiniStat label="Checkout -> Venda" value={fPct(rate(sum(rows, "vendasTotais"), sum(rows, "checkouts")))} />
        <MiniStat label="Confiança" value="Agregado diário" />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

function gargalo(row: DailyRow) {
  if ((row.investimento ?? 0) > 0 && (row.pageviews ?? 0) === 0) return "Gasto sem pageview.";
  if ((row.pageviews ?? 0) > 0 && (row.playRate ?? 0) === 0 && (row.viewsUnicas ?? 0) === 0) return "Pageview sem play/visualização.";
  if ((row.chegaramPitch ?? 0) > 0 && (row.checkouts ?? 0) === 0) return "Pitch sem checkout.";
  if ((row.checkouts ?? 0) > 0 && (row.vendasTotais ?? 0) === 0) return "Checkout sem venda.";
  if ((row.vendasTotais ?? 0) > 0 && (row.investimento ?? 0) === 0) return "Venda sem origem de tráfego no dia.";
  return "Sem gargalo crítico no agregado diário.";
}

function sum(rows: DailyRow[], key: keyof DailyRow) {
  return rows.reduce((acc, row) => acc + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);
}

function rate(numerator: number, denominator: number) {
  return denominator ? (numerator / denominator) * 100 : null;
}

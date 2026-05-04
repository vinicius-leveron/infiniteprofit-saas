import type { TooltipProps } from "recharts";

/** Eixos / grid padronizados */
export const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 };
export const grid = "hsl(var(--border) / 0.6)";

/**
 * Paleta padronizada para séries de gráficos.
 * Filosofia:
 *  - Violeta = série principal/destaque
 *  - Azul    = série secundária/comparação
 *  - Verde   = positivo / receita / sucesso
 *  - Vermelho= negativo / custo / alerta
 *  - Amarelo = média / referência
 *  - Cyan    = volume/tráfego (entrada do funil)
 */
export const chartColors = {
  primary: "hsl(var(--kpi-violet))",
  secondary: "hsl(var(--kpi-blue))",
  positive: "hsl(var(--kpi-emerald))",
  negative: "hsl(var(--kpi-red))",
  reference: "hsl(var(--kpi-yellow))",
  volume: "hsl(var(--kpi-cyan))",
  warning: "hsl(var(--kpi-orange))",
} as const;

/** Tooltip rico: cabeçalho com label, dot colorido por série, valor formatado */
interface RichTooltipProps extends TooltipProps<number, string> {
  /** Função para formatar valores (ex: BRL, %) */
  formatter?: (v: number, name?: string) => string;
  /** Label opcional para o cabeçalho (ex: "Dia 12/04") */
  labelPrefix?: string;
}

export const RichTooltip = ({ active, payload, label, formatter, labelPrefix }: RichTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-border bg-popover/95 backdrop-blur-sm shadow-lg px-3 py-2 text-xs min-w-[140px]"
      style={{ boxShadow: "0 8px 24px -8px hsl(0 0% 0% / 0.4)" }}
    >
      {label != null && (
        <div className="text-popover-foreground font-semibold mb-1.5 pb-1.5 border-b border-border/60">
          {labelPrefix ? `${labelPrefix} ${label}` : label}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => {
          const v = typeof entry.value === "number" ? entry.value : Number(entry.value);
          const formatted = formatter && Number.isFinite(v) ? formatter(v, entry.name as string) : String(entry.value);
          return (
            <div key={i} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: entry.color || (entry as { stroke?: string }).stroke || "hsl(var(--muted-foreground))" }}
                />
                <span className="text-muted-foreground truncate">{entry.name}</span>
              </div>
              <span className="text-popover-foreground font-semibold tabular-nums">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Cursor padrão para BarChart */
export const barCursor = { fill: "hsl(var(--foreground) / 0.06)" };

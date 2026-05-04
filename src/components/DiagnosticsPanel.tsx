import { useMemo } from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { buildDiagnostics, type DiagnosticAlert } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";
import { ComparisonStrip } from "./ComparisonStrip";

interface Props {
  current: DailyRow[];
  previous: DailyRow[];
}

const CATEGORIES: DiagnosticAlert["category"][] = [
  "Geral",
  "Tráfego",
  "Funil VSL",
  "Bumps & Upsell",
];

const fmtVal = (v: number | null) => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 10) return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
};

export const DiagnosticsPanel = ({ current, previous }: Props) => {
  const alerts = useMemo(() => buildDiagnostics(current, previous), [current, previous]);

  const reds = alerts.filter((a) => a.severity === "red");
  const yellows = alerts.filter((a) => a.severity === "yellow");

  if (!previous.length) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="section-card text-center py-16 text-muted-foreground">
          Selecione um período (7d, 15d ou 30d) para gerar o diagnóstico comparativo.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          tone="red"
          icon={AlertCircle}
          count={reds.length}
          label="Alertas Críticos"
          hint="Variação ≥ 20% na direção ruim"
        />
        <SummaryCard
          tone="yellow"
          icon={AlertTriangle}
          count={yellows.length}
          label="Alertas de Atenção"
          hint="Variação entre 5% e 19%"
        />
        <SummaryCard
          tone="green"
          icon={CheckCircle2}
          count={alerts.length === 0 ? 1 : 0}
          label="Tudo Estável"
          hint={alerts.length === 0 ? "Nenhum alerta no período" : "Há alertas a revisar"}
          showCount={false}
        />
      </div>

      {/* Comparativo vs período anterior */}
      <ComparisonStrip current={current} previous={previous} />

      {alerts.length === 0 ? (
        <div className="section-card text-center py-12">
          <CheckCircle2 className="w-10 h-10 mx-auto text-kpi-emerald mb-3" />
          <h3 className="text-base font-semibold text-foreground mb-1">
            Nenhuma variação relevante detectada
          </h3>
          <p className="text-sm text-muted-foreground">
            Todas as métricas se mantiveram dentro de ±5% em relação ao período anterior.
          </p>
        </div>
      ) : (
        CATEGORIES.map((cat) => {
          const list = alerts.filter((a) => a.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat} className="section-card">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-1 h-4 bg-primary rounded-full" />
                {cat}
                <span className="text-xs font-normal text-muted-foreground">
                  ({list.length} {list.length === 1 ? "alerta" : "alertas"})
                </span>
              </h3>
              <div className="space-y-2">
                {list.map((a) => (
                  <AlertRow key={`${cat}-${a.metric}`} alert={a} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
};

interface SummaryCardProps {
  tone: "red" | "yellow" | "green";
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  hint: string;
  showCount?: boolean;
}

const SummaryCard = ({ tone, icon: Icon, count, label, hint, showCount = true }: SummaryCardProps) => {
  const toneCls = {
    red: "text-kpi-red bg-kpi-red/10 border-kpi-red/30",
    yellow: "text-kpi-yellow bg-kpi-yellow/10 border-kpi-yellow/30",
    green: "text-kpi-emerald bg-kpi-emerald/10 border-kpi-emerald/30",
  }[tone];
  return (
    <div className={cn("rounded-xl border p-4 flex items-center gap-3", toneCls)}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-background/60">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {showCount && <span className="text-2xl font-bold tabular-nums">{count}</span>}
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <p className="text-xs opacity-80 mt-0.5">{hint}</p>
      </div>
    </div>
  );
};

const AlertRow = ({ alert }: { alert: DiagnosticAlert }) => {
  const isRed = alert.severity === "red";
  const TrendIcon = alert.direction === "up" ? TrendingUp : TrendingDown;

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-colors",
        isRed
          ? "border-kpi-red/30 bg-kpi-red/5"
          : "border-kpi-yellow/30 bg-kpi-yellow/5",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          isRed ? "bg-kpi-red/15 text-kpi-red" : "bg-kpi-yellow/15 text-kpi-yellow",
        )}
      >
        {isRed ? <AlertCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{alert.metric}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {fmtVal(alert.previous)} → {fmtVal(alert.current)}
        </div>
      </div>
      <div
        className={cn(
          "flex items-center gap-1 text-sm font-bold tabular-nums shrink-0",
          isRed ? "text-kpi-red" : "text-kpi-yellow",
        )}
      >
        <TrendIcon className="w-4 h-4" />
        {alert.changePct > 0 ? "+" : ""}
        {alert.changePct.toFixed(1)}%
      </div>
    </div>
  );
};

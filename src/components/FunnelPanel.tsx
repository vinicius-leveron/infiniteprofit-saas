import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { Play, Film, ArrowRightLeft, Target, CheckCircle2 } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { computeTotals, fPct, fNum } from "@/lib/metrics";
import { KpiCard } from "./KpiCard";
import { ChartSection } from "./ChartSection";
import { axis, grid, RichTooltip, chartColors } from "./charts/chartShared";

interface Props {
  rows: DailyRow[];
}

const fmtDay = (d: Date | null) => (d ? format(d, "dd/MM") : "");

export const FunnelPanel = ({ rows }: Props) => {
  const t = useMemo(() => computeTotals(rows), [rows]);

  const series = useMemo(
    () =>
      rows.map((r) => ({
        day: fmtDay(r.date),
        playRate: r.playRate ?? 0,
        retPitch: r.retPitch ?? 0,
        pitchChk: r.pitchChk ?? 0,
        pitchVenda: r.pitchVenda ?? 0,
        chkVenda: r.chkVenda ?? 0,
      })),
    [rows],
  );

  // Aggregated funnel
  const funnel = useMemo(() => {
    const views = rows.reduce((s, r) => s + (r.viewsUnicas ?? 0), 0);
    const pitch = rows.reduce((s, r) => s + (r.chegaramPitch ?? 0), 0);
    const checkouts = rows.reduce((s, r) => s + (r.checkouts ?? 0), 0);
    const vendas = rows.reduce((s, r) => s + (r.vendasFront ?? 0), 0);
    return { views, pitch, checkouts, vendas };
  }, [rows]);

  const fmax = Math.max(funnel.views, 1);

  const stages: { label: string; value: number; tone: string; pctOfPrev?: number | null }[] = [
    { label: "Visualizações Únicas", value: funnel.views, tone: "kpi-cyan" },
    {
      label: "Chegaram no Pitch",
      value: funnel.pitch,
      tone: "kpi-blue",
      pctOfPrev: funnel.views ? (funnel.pitch / funnel.views) * 100 : null,
    },
    {
      label: "Checkouts",
      value: funnel.checkouts,
      tone: "kpi-violet",
      pctOfPrev: funnel.pitch ? (funnel.checkouts / funnel.pitch) * 100 : null,
    },
    {
      label: "Vendas (Front)",
      value: funnel.vendas,
      tone: "kpi-emerald",
      pctOfPrev: funnel.checkouts ? (funnel.vendas / funnel.checkouts) * 100 : null,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Play Rate" value={fPct(t.avgPlayRate)} hint="Média do período" icon={Play} tone="cyan" />
        <KpiCard label="Retenção Pitch" value={fPct(t.avgRetPitch)} hint="Média do período" icon={Film} tone="blue" />
        <KpiCard label="Pitch → Checkout" value={fPct(t.avgPitchChk)} hint="Média do período" icon={ArrowRightLeft} tone="indigo" />
        <KpiCard label="Pitch → Venda" value={fPct(t.avgPitchVenda)} hint="Média do período" icon={Target} tone="violet" />
        <KpiCard label="Checkout → Venda" value={fPct(t.avgChkVenda)} hint="Média do período" icon={CheckCircle2} tone="green" />
      </div>

      {/* Aggregated funnel */}
      <ChartSection
        title="Funil Agregado"
        description="Soma do período · taxa exibida = conversão em relação à etapa anterior"
      >
        <div className="space-y-3">
          {stages.map((s, i) => {
            const widthPct = Math.max((s.value / fmax) * 100, 6);
            return (
              <div key={s.label} className="flex items-center gap-4">
                <div className="w-44 shrink-0 text-xs text-muted-foreground">{s.label}</div>
                <div className="flex-1 h-10 bg-secondary/50 rounded-md overflow-hidden relative">
                  <div
                    className="h-full rounded-md flex items-center px-3 text-sm font-semibold tabular-nums transition-all"
                    style={{
                      width: `${widthPct}%`,
                      background: `hsl(var(--${s.tone}) / 0.2)`,
                      borderLeft: `3px solid hsl(var(--${s.tone}))`,
                      color: `hsl(var(--${s.tone}))`,
                    }}
                  >
                    {fNum(s.value)}
                  </div>
                </div>
                <div className="w-20 shrink-0 text-right text-xs">
                  {i === 0 ? (
                    <span className="text-muted-foreground">100%</span>
                  ) : s.pctOfPrev != null ? (
                    <span className="text-foreground font-medium">{s.pctOfPrev.toFixed(1)}%</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ChartSection>

      {/* Play rate & retention */}
      <ChartSection
        title="Play Rate & Retenção do Pitch"
        description="Quantos iniciam o vídeo e quantos chegam até o pitch"
      >
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} domain={[0, "auto"]} />
              <Tooltip content={<RichTooltip formatter={(v) => fPct(v)} />} />
              <Line type="monotone" dataKey="playRate" name="Play Rate" stroke={chartColors.volume} strokeWidth={2.4} dot={false} />
              <Line type="monotone" dataKey="retPitch" name="Retenção Pitch" stroke={chartColors.primary} strokeWidth={2.4} dot={false} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartSection title="Pitch → Checkout (%)" description="Quantos vão do pitch para o checkout">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fPct(v)} />} />
                {t.avgPitchChk != null && (
                  <ReferenceLine
                    y={t.avgPitchChk}
                    stroke={chartColors.reference}
                    strokeDasharray="4 4"
                    label={{ value: "Média", fill: chartColors.reference, fontSize: 10, position: "right" }}
                  />
                )}
                <Line type="monotone" dataKey="pitchChk" name="Pitch → Checkout" stroke={chartColors.secondary} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title="Pitch → Venda (%)" description="Conversão direta de quem chegou no pitch">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fPct(v)} />} />
                {t.avgPitchVenda != null && (
                  <ReferenceLine
                    y={t.avgPitchVenda}
                    stroke={chartColors.reference}
                    strokeDasharray="4 4"
                    label={{ value: "Média", fill: chartColors.reference, fontSize: 10, position: "right" }}
                  />
                )}
                <Line type="monotone" dataKey="pitchVenda" name="Pitch → Venda" stroke={chartColors.primary} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>

      <ChartSection
        title="Checkout → Venda (%)"
        description="Eficiência de fechamento no checkout — quanto maior, melhor"
      >
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} domain={[0, 100]} />
              <Tooltip content={<RichTooltip formatter={(v) => fPct(v)} />} />
              {t.avgChkVenda != null && (
                <ReferenceLine
                  y={t.avgChkVenda}
                  stroke={chartColors.reference}
                  strokeDasharray="4 4"
                  label={{ value: "Média", fill: chartColors.reference, fontSize: 10, position: "right" }}
                />
              )}
              <Line type="monotone" dataKey="chkVenda" name="Checkout → Venda" stroke={chartColors.positive} strokeWidth={2.6} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>
    </div>
  );
};

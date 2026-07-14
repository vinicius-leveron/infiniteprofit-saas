import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { Eye, MousePointerClick, FileText, ShoppingBag, Percent, Gauge, Target, Download } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import type { DashboardDateRange } from "@/lib/dashboardRows";
import { computeTotals, weekdayAggregates, fBRL, fNum, fPct } from "@/lib/metrics";
import { KpiCard } from "./KpiCard";
import { ChartSection } from "./ChartSection";
import { SalesHeatmap } from "./SalesHeatmap";
import { axis, grid, RichTooltip, chartColors, barCursor } from "./charts/chartShared";

interface Props {
  rows: DailyRow[];
  previous?: DailyRow[];
  projectId?: string | null;
  dateRange?: DashboardDateRange;
}

const fmtDay = (d: Date | null) => (d ? format(d, "dd/MM") : "");

const delta = (current: number | null | undefined, previous: number | null | undefined) => {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

export const TrafficPanel = ({ rows, previous, projectId, dateRange }: Props) => {
  const t = useMemo(() => computeTotals(rows), [rows]);
  const tPrev = useMemo(
    () => (previous && previous.length > 0 ? computeTotals(previous) : null),
    [previous],
  );
  const weekday = useMemo(() => weekdayAggregates(rows), [rows]);

  const series = useMemo(
    () =>
      rows.map((r) => ({
        day: fmtDay(r.date),
        impressoes: r.impressoes ?? 0,
        cliques: r.cliques ?? 0,
        landingPageviews: r.landingPageviews ?? 0,
        checkouts: r.checkouts ?? 0,
        cpm: r.cpm ?? 0,
        ctr: r.ctr ?? 0,
        cpc: r.cpc ?? 0,
        custoIC: r.custoIC ?? 0,
        custoPageview: r.custoPageview ?? 0,
        taxaCarreg: r.taxaCarreg ?? 0,
      })),
    [rows],
  );

  const bestDay = [...weekday].sort((a, b) => b.avgVendas - a.avgVendas)[0];
  const sparks = useMemo(
    () => ({
      impressoes: series.map((item) => item.impressoes),
      cliques: series.map((item) => item.cliques),
      landingPageviews: series.map((item) => item.landingPageviews),
      checkouts: series.map((item) => item.checkouts),
      ctr: series.map((item) => item.ctr),
      taxaCarreg: series.map((item) => item.taxaCarreg),
      cpm: series.map((item) => item.cpm),
      cpc: series.map((item) => item.cpc),
      custoIC: series.map((item) => item.custoIC),
      custoPageview: series.map((item) => item.custoPageview),
    }),
    [series],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* — Volume — */}
        <KpiCard label="Impressões" value={fNum(t.impressoes)} icon={Eye} tone="cyan" spark={sparks.impressoes} deltaPct={delta(t.impressoes, tPrev?.impressoes)} />
        <KpiCard label="Cliques no link" value={fNum(t.cliques)} icon={MousePointerClick} tone="blue" spark={sparks.cliques} deltaPct={delta(t.cliques, tPrev?.cliques)} />
        <KpiCard label="LP Views" value={fNum(t.landingPageviews)} icon={FileText} tone="indigo" spark={sparks.landingPageviews} deltaPct={delta(t.landingPageviews, tPrev?.landingPageviews)} />
        <KpiCard label="Checkouts" value={fNum(t.checkouts)} hint={`P/ Chk: ${fPct(t.passChk)}`} icon={ShoppingBag} tone="violet" spark={sparks.checkouts} deltaPct={delta(t.checkouts, tPrev?.checkouts)} />

        {/* — Conversões / Taxas — */}
        <KpiCard
          label="CTR"
          value={fPct(t.ctr, 2)}
          hint="Cliques no link ÷ Impressões"
          icon={Target}
          tone="emerald"
          spark={sparks.ctr}
          deltaPct={delta(t.ctr, tPrev?.ctr)}
        />
        <KpiCard
          label="Taxa de Carregamento"
          value={fPct(t.taxaCarreg)}
          hint="Landing Page Views ÷ Cliques no link"
          icon={Download}
          tone="emerald"
          spark={sparks.taxaCarreg}
          deltaPct={delta(t.taxaCarreg, tPrev?.taxaCarreg)}
        />

        {/* — Custos — */}
        <KpiCard label="CPM" value={fBRL(t.cpm)} icon={Gauge} tone="orange" spark={sparks.cpm} deltaPct={delta(t.cpm, tPrev?.cpm)} goodWhenUp={false} />
        <KpiCard label="CPC" value={fBRL(t.cpc)} icon={Gauge} tone="yellow" spark={sparks.cpc} deltaPct={delta(t.cpc, tPrev?.cpc)} goodWhenUp={false} />
        <KpiCard label="Custo por I.C" value={fBRL(t.custoIC)} icon={Percent} tone="pink" spark={sparks.custoIC} deltaPct={delta(t.custoIC, tPrev?.custoIC)} goodWhenUp={false} />
        <KpiCard label="Custo LP View" value={fBRL(t.custoPageview)} icon={Percent} tone="purple" spark={sparks.custoPageview} deltaPct={delta(t.custoPageview, tPrev?.custoPageview)} goodWhenUp={false} />
      </div>

      <ChartSection
        title="Mapa de Calor de Vendas"
        description="Vendas aprovadas por dia da semana e horário de Brasília — passe o mouse para ver quantidade e faturamento"
      >
        <SalesHeatmap projectId={projectId} dateRange={dateRange} />
      </ChartSection>

      <ChartSection
        title="Vendas por Dia da Semana"
        description={
          bestDay && bestDay.avgVendas > 0
            ? `Melhor dia: ${bestDay.dia} · média ${bestDay.avgVendas.toFixed(1)} vendas/dia`
            : undefined
        }
      >
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={weekday} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="dia" {...axis} />
              <YAxis {...axis} />
              <Tooltip
                content={<RichTooltip formatter={(v) => `${v.toFixed(1)} vendas/dia`} />}
                cursor={barCursor}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
              <Bar dataKey="avgVendas" name="Média de vendas" fill={chartColors.primary} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartSection title="CTR (%)">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fPct(v, 2)} />} />
                <Line type="monotone" dataKey="ctr" name="CTR" stroke={chartColors.positive} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title="CPC & CPM">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis yAxisId="l" {...axis} />
                <YAxis yAxisId="r" orientation="right" {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
                <Line yAxisId="r" type="monotone" dataKey="cpc" name="CPC (R$)" stroke={chartColors.warning} strokeWidth={2.4} dot={false} />
                <Line yAxisId="l" type="monotone" dataKey="cpm" name="CPM (R$)" stroke={chartColors.primary} strokeWidth={2.4} strokeDasharray="6 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>

      <ChartSection
        title="Taxa de Carregamento (%)"
        description="Landing Page Views ÷ Cliques no link — quão bem sua página retém o tráfego pago"
      >
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} domain={[0, 100]} />
              <Tooltip content={<RichTooltip formatter={(v) => fPct(v)} />} />
              <Line type="monotone" dataKey="taxaCarreg" name="Taxa carreg." stroke={chartColors.positive} strokeWidth={2.4} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartSection title="Impressões, Cliques e LP Views">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={4} barCategoryGap="20%">
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis yAxisId="l" {...axis} />
                <YAxis yAxisId="r" orientation="right" {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fNum(v)} />} cursor={barCursor} />
                <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
                <Bar yAxisId="l" dataKey="impressoes" name="Impressões" fill={chartColors.primary} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="r" dataKey="cliques" name="Cliques no link" fill={chartColors.secondary} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="r" dataKey="landingPageviews" name="LP Views" fill={chartColors.positive} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title="Custo por I.C">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} />
                <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
                <Line type="monotone" dataKey="custoIC" name="Custo por I.C" stroke={chartColors.warning} strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>
    </div>
  );
};

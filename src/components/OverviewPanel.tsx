import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
  ComposedChart,
} from "recharts";
import { format } from "date-fns";
import { TrendingUp, DollarSign, ShoppingCart, Target, Wallet, Receipt, Percent, Activity, CreditCard, QrCode, CalendarDays, ShoppingBag, RotateCcw, BadgeDollarSign } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { computeTotals } from "@/lib/metrics";
import { fBRL, fNum, fMult, fPct } from "@/lib/metrics";
import { KpiCard } from "./KpiCard";
import { ChartSection } from "./ChartSection";
import { axis, grid, RichTooltip, chartColors } from "./charts/chartShared";


interface Props {
  rows: DailyRow[];
  previous?: DailyRow[];
  /** Callback ao clicar em um dia — abre drill-down */
  onDayClick?: (row: DailyRow) => void;
}

const fmtDay = (d: Date | null) => (d ? format(d, "dd/MM") : "");

export const OverviewPanel = ({ rows, previous, onDayClick }: Props) => {
  const t = useMemo(() => computeTotals(rows), [rows]);
  const tPrev = useMemo(
    () => (previous && previous.length ? computeTotals(previous) : null),
    [previous],
  );

  /** Handler de clique no gráfico do recharts */
  const handleChartClick = (data: unknown) => {
    if (!onDayClick) return;
    const d = data as { activeLabel?: string } | null;
    if (!d?.activeLabel) return;
    const target = rows.find((r) => fmtDay(r.date) === d.activeLabel);
    if (target) onDayClick(target);
  };

  /** Variação % entre valor atual e anterior. Retorna null se não dá para comparar. */
  const delta = (cur: number | null | undefined, prev: number | null | undefined) => {
    if (cur == null || prev == null) return null;
    if (prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };

  const series = useMemo(
    () =>
      rows.map((r) => {
        const day = fmtDay(r.date);
        return {
          day,
          investimento: r.investimento ?? 0,
          fatLiquido: r.fatLiquido ?? 0,
          vendas: r.vendasTotais ?? 0,
          vendasFront: r.vendasFront ?? 0,
          roi: r.roi ?? 0,
          cac: r.cac ?? 0,
          aov: r.aov ?? 0,
          lucro: r.lucro ?? 0,
          reembolsos: r.reembolsos ?? 0,
          taxaReembolso: r.taxaReembolso ?? 0,
          valorReembolsado: r.valorReembolsado ?? 0,
        };
      }),
    [rows],
  );

  // Séries 1-D para sparklines (ordem cronológica)
  const sparks = useMemo(
    () => ({
      fatLiquido: series.map((d) => d.fatLiquido),
      lucro: series.map((d) => d.lucro),
      roi: series.map((d) => d.roi),
      vendas: series.map((d) => d.vendas),
      vendasFront: series.map((d) => d.vendasFront),
      investimento: series.map((d) => d.investimento),
      cac: series.map((d) => d.cac),
      aov: series.map((d) => d.aov),
      reembolsos: series.map((d) => d.reembolsos),
      taxaReembolso: series.map((d) => d.taxaReembolso),
      valorReembolsado: series.map((d) => d.valorReembolsado),
    }),
    [series],
  );

  const lucroAcum = useMemo(() => {
    let acc = 0;
    return series.map((d) => {
      acc += d.lucro;
      return { day: d.day, acumulado: acc };
    });
  }, [series]);

  // 7-day moving average for ROI
  const roiWithMA = useMemo(() => {
    const w = 7;
    return series.map((d, i) => {
      let ma: number | null = null;
      if (i >= w - 1) {
        let s = 0;
        for (let j = i - w + 1; j <= i; j++) s += series[j].roi;
        ma = s / w;
      }
      return { ...d, ma };
    });
  }, [series]);

  return (
    <div className={`space-y-6 animate-fade-in ${onDayClick ? "[&_.recharts-bar-rectangle]:cursor-pointer [&_.recharts-active-dot]:cursor-pointer" : ""}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          featured
          label="Faturamento Líquido"
          value={fBRL(t.fatLiquido)}
          hint={`Bruto: ${fBRL(t.fatBruto)}`}
          icon={DollarSign}
          tone="emerald"
          spark={sparks.fatLiquido}
          deltaPct={delta(t.fatLiquido, tPrev?.fatLiquido)}
        />
        <KpiCard
          featured
          label="Lucro"
          value={fBRL(t.lucro)}
          hint={
            t.fatLiquido && t.investimento
              ? `Margem: ${fPct((t.lucro / t.fatLiquido) * 100)}`
              : undefined
          }
          icon={TrendingUp}
          tone="green"
          spark={sparks.lucro}
          deltaPct={delta(t.lucro, tPrev?.lucro)}
        />
        <KpiCard
          featured
          label="ROI"
          value={fMult(t.roi)}
          hint={
            t.roi != null
              ? t.roi >= 1
                ? "Acima do break-even"
                : "Abaixo do break-even"
              : undefined
          }
          icon={Activity}
          tone={t.roi != null && t.roi >= 1 ? "green" : "red"}
          spark={sparks.roi}
          deltaPct={delta(t.roi, tPrev?.roi)}
        />
      </div>

      {/* KPIs secundários */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Investimento"
          value={fBRL(t.investimento)}
          hint={`${t.days} dias`}
          icon={Wallet}
          tone="orange"
          spark={sparks.investimento}
          deltaPct={delta(t.investimento, tPrev?.investimento)}
          goodWhenUp={false}
        />
        <KpiCard
          label="Imposto Meta"
          value={fBRL(t.impostoMeta)}
          hint="12,15% do investimento"
          icon={Receipt}
          tone="red"
          deltaPct={delta(t.impostoMeta, tPrev?.impostoMeta)}
          goodWhenUp={false}
        />
        <KpiCard
          label="Invest. Médio/Dia"
          value={fBRL(t.days ? t.investimento / t.days : null)}
          hint="Aporte diário médio"
          icon={CalendarDays}
          tone="orange"
        />
        <KpiCard
          label="Vendas Totais"
          value={fNum(t.vendasTotais)}
          hint={`Front: ${fNum(t.vendasFront)}`}
          icon={ShoppingCart}
          tone="blue"
          spark={sparks.vendas}
          deltaPct={delta(t.vendasTotais, tPrev?.vendasTotais)}
        />
        <KpiCard
          label="Vendas Front"
          value={fNum(t.vendasFront)}
          hint={
            t.vendasTotais
              ? `${fPct((t.vendasFront / t.vendasTotais) * 100)} do total`
              : undefined
          }
          icon={ShoppingBag}
          tone="blue"
          spark={sparks.vendasFront}
          deltaPct={delta(t.vendasFront, tPrev?.vendasFront)}
        />
        <KpiCard
          label="AOV"
          value={fBRL(t.aov)}
          hint="Faturamento ÷ Vendas"
          icon={Receipt}
          tone="violet"
          spark={sparks.aov}
          deltaPct={delta(t.aov, tPrev?.aov)}
        />
        <KpiCard
          label="CAC"
          value={fBRL(t.cac)}
          hint="Investimento ÷ Vendas"
          icon={Target}
          tone="indigo"
          spark={sparks.cac}
          deltaPct={delta(t.cac, tPrev?.cac)}
          goodWhenUp={false}
        />
        <KpiCard
          label="Aprov. Cartão"
          value={fPct(t.avgAprovCartao)}
          hint="Taxa média de aprovação"
          icon={CreditCard}
          tone="emerald"
          deltaPct={delta(t.avgAprovCartao, tPrev?.avgAprovCartao)}
        />
        <KpiCard
          label="Aprov. Pix"
          value={fPct(t.avgAprovPix)}
          hint="Taxa média de aprovação"
          icon={QrCode}
          tone="emerald"
          deltaPct={delta(t.avgAprovPix, tPrev?.avgAprovPix)}
        />
        <KpiCard
          label="Reembolsos"
          value={fNum(t.reembolsos)}
          hint="Quantidade no período"
          icon={RotateCcw}
          tone="red"
          spark={sparks.reembolsos}
          deltaPct={delta(t.reembolsos, tPrev?.reembolsos)}
          goodWhenUp={false}
        />
        <KpiCard
          label="Taxa de Reembolso"
          value={fPct(t.taxaReembolso)}
          hint="Reembolsos ÷ vendas totais"
          icon={Percent}
          tone="red"
          spark={sparks.taxaReembolso}
          deltaPct={delta(t.taxaReembolso, tPrev?.taxaReembolso)}
          goodWhenUp={false}
        />
        <KpiCard
          label="Valor Reembolsado"
          value={fBRL(t.valorReembolsado)}
          hint="Impacto financeiro no período"
          icon={BadgeDollarSign}
          tone="red"
          spark={sparks.valorReembolsado}
          deltaPct={delta(t.valorReembolsado, tPrev?.valorReembolsado)}
          goodWhenUp={false}
        />
      </div>

      {/* Comparativo movido para a aba Diagnóstico */}

      <ChartSection
        title="Reembolsos por Dia"
        description="Evolução conjunta da taxa de reembolso e do valor financeiro"
      >
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={series} margin={{ top: 8, right: 18, left: 8, bottom: 0 }} onClick={handleChartClick}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis
                yAxisId="currency"
                {...axis}
                tickFormatter={(value) => `R$ ${Number(value).toLocaleString("pt-BR", { notation: "compact" })}`}
              />
              <YAxis
                yAxisId="percent"
                orientation="right"
                {...axis}
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
              />
              <Tooltip content={<RefundTooltip />} />
              <Line
                yAxisId="currency"
                type="monotone"
                dataKey="valorReembolsado"
                name="Valor reembolsado"
                stroke={chartColors.negative}
                strokeWidth={2.4}
                dot={{ r: 2.5 }}
              />
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="taxaReembolso"
                name="Taxa de reembolso"
                stroke={chartColors.secondary}
                strokeWidth={2.4}
                dot={{ r: 2.5 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      {/* ROI chart */}
      <ChartSection
        title="ROI Diário"
        description="Linha vermelha = break-even (1.0x) · Linha tracejada = média móvel 7 dias"
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={roiWithMA} margin={{ top: 8, right: 12, left: -10, bottom: 0 }} barCategoryGap="25%" onClick={handleChartClick}>
            {/* Cursor pointer feedback when drill-down available */}
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} />
              <Tooltip
                content={<RichTooltip formatter={(v) => v.toFixed(2) + "x"} />}
                cursor={{ fill: "hsl(var(--foreground) / 0.06)" }}
              />
              <ReferenceLine y={1} stroke="hsl(var(--kpi-red))" strokeDasharray="4 4" />
              <Bar dataKey="roi" radius={[6, 6, 0, 0]} name="ROI">
                {roiWithMA.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.roi >= 1 ? "hsl(var(--kpi-emerald))" : "hsl(var(--kpi-red))"}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="ma"
                stroke="hsl(var(--kpi-violet))"
                strokeWidth={1.8}
                strokeDasharray="5 5"
                dot={false}
                name="MA 7d"
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartSection title="Vendas por Dia">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="25%" onClick={handleChartClick}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fNum(v)} />} cursor={{ fill: "hsl(var(--foreground) / 0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
                <Bar dataKey="vendas" fill={chartColors.primary} radius={[6, 6, 0, 0]} name="Vendas Totais" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title="CAC vs AOV" description="AOV acima do CAC = margem positiva">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} onClick={handleChartClick}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={{ fill: "hsl(var(--foreground) / 0.06)" }} />
                <Line dataKey="cac" stroke={chartColors.negative} strokeWidth={2.2} dot={false} name="CAC" />
                <Line dataKey="aov" stroke={chartColors.positive} strokeWidth={2.2} dot={false} name="AOV" />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>

      <ChartSection title="Investimento vs Faturamento">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barGap={4} barCategoryGap="20%" onClick={handleChartClick}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} />
              <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={{ fill: "hsl(var(--foreground) / 0.06)" }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
              <Bar dataKey="investimento" fill={chartColors.negative} radius={[4, 4, 0, 0]} name="Investimento" />
              <Bar dataKey="fatLiquido" fill={chartColors.positive} radius={[4, 4, 0, 0]} name="Faturamento" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartSection title="Lucro por Dia">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} onClick={handleChartClick}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={{ fill: "hsl(var(--foreground) / 0.06)" }} />
                <Bar dataKey="lucro" radius={[6, 6, 0, 0]}>
                  {series.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.lucro >= 0 ? "hsl(var(--kpi-green))" : "hsl(var(--kpi-red))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection title="Lucro Acumulado">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={lucroAcum} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} onClick={(d) => {
                const data = d as { activeLabel?: string } | null;
                if (!onDayClick || !data?.activeLabel) return;
                const target = rows.find((r) => fmtDay(r.date) === data.activeLabel);
                if (target) onDayClick(target);
              }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={{ fill: "hsl(var(--foreground) / 0.06)" }} />
                <ReferenceLine y={0} stroke={chartColors.negative} strokeDasharray="4 4" />
                <Line
                  type="monotone"
                  dataKey="acumulado"
                  name="Lucro acumulado"
                  stroke={chartColors.primary}
                  strokeWidth={2.6}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>
    </div>
  );
};

function RefundTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { reembolsos?: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const refunds = payload[0]?.payload?.reembolsos ?? 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-xl">
      <div className="mb-1.5 font-medium text-foreground">{label}</div>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
            {item.name}
          </span>
          <span className="font-medium tabular-nums text-foreground">
            {item.name === "Valor reembolsado" ? fBRL(item.value) : fPct(item.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-border/60 pt-1.5 text-muted-foreground">
        {fNum(refunds)} reembolso(s)
      </div>
    </div>
  );
}

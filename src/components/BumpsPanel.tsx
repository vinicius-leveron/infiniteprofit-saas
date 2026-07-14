import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { format } from "date-fns";
import { Gift, ArrowUpRight, Wallet, Percent, Scale } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { fBRL, fNum, fPct } from "@/lib/metrics";
import { KpiCard } from "./KpiCard";
import { ChartSection } from "./ChartSection";
import { axis, grid, RichTooltip, chartColors, barCursor } from "./charts/chartShared";

interface Props {
  rows: DailyRow[];
}

const fmtDay = (d: Date | null) => (d ? format(d, "dd/MM") : "");

// Paleta multi-cor para distinguir produtos individuais (bumps/upsells)
const PALETTE = [
  "hsl(var(--kpi-emerald))",
  "hsl(var(--kpi-violet))",
  "hsl(var(--kpi-orange))",
  "hsl(var(--kpi-cyan))",
  "hsl(var(--kpi-pink))",
  "hsl(var(--kpi-yellow))",
  "hsl(var(--kpi-indigo))",
];

export const BumpsPanel = ({ rows }: Props) => {
  const totals = useMemo(() => {
    const fatFront = rows.reduce((s, r) => s + (r.fatFront ?? 0), 0);
    const fatOrderbump = rows.reduce((s, r) => s + (r.fatOrderbump ?? 0), 0);
    const fatFunil = rows.reduce((s, r) => s + (r.fatFunil ?? 0), 0);
    const vendasFront = rows.reduce((s, r) => s + (r.vendasFront ?? 0), 0);

    // Per-bump aggregates
    const bumpMap = new Map<
      string,
      { name: string; type: "orderbump" | "upsell"; count: number; revenue: number; days: number; ratesSum: number; ratesN: number }
    >();
    rows.forEach((r) => {
      r.bumps?.forEach((b) => {
        const key = b.name;
        const slot =
          bumpMap.get(key) ||
          { name: b.name, type: b.type, count: 0, revenue: 0, days: 0, ratesSum: 0, ratesN: 0 };
        slot.count += b.count ?? 0;
        slot.revenue += b.revenue ?? 0;
        slot.days += 1;
        if (b.rate != null && !isNaN(b.rate)) {
          slot.ratesSum += b.rate;
          slot.ratesN += 1;
        }
        bumpMap.set(key, slot);
      });
    });
    const bumpsAgg = Array.from(bumpMap.values())
      .map((b) => ({
        ...b,
        avgRate: b.ratesN ? b.ratesSum / b.ratesN : null,
        // conversion rate using vendasFront as denominator (each front sale = chance to convert a bump)
        convRate: vendasFront ? (b.count / vendasFront) * 100 : null,
        ticket: b.count ? b.revenue / b.count : null,
      }))
      .filter((b) => b.revenue > 0 || b.count > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const bumpsRevTotal = bumpsAgg.reduce((s, b) => s + b.revenue, 0);
    const upsellsRev = bumpsAgg.filter((b) => b.type === "upsell").reduce((s, b) => s + b.revenue, 0);
    const orderbumpsRev = bumpsAgg.filter((b) => b.type === "orderbump").reduce((s, b) => s + b.revenue, 0);

    // Total de vendas de orderbumps (somando todos os orderbumps detectados)
    const totalOrderbumpSales = bumpsAgg
      .filter((b) => b.type === "orderbump")
      .reduce((s, b) => s + b.count, 0);

    return {
      fatFront,
      fatOrderbump,
      fatFunil,
      vendasFront,
      bumpsAgg,
      bumpsRevTotal,
      upsellsRev,
      orderbumpsRev,
      // Proporção Faturamento Front x Funil = Σ(fatFunil) / Σ(fatFront) — em %
      proporcaoFunilFront: fatFront ? (fatFunil / fatFront) * 100 : null,
      // % Conversão Geral Orderbump = Σ(vendas orderbumps) / Σ(vendas front) — em %
      convGeralOrderbump: vendasFront ? (totalOrderbumpSales / vendasFront) * 100 : null,
    };
  }, [rows]);

  // Daily series for front vs total funil
  const series = useMemo(
    () =>
      rows.map((r) => ({
        day: fmtDay(r.date),
        fatFront: r.fatFront ?? 0,
        fatOrderbump: r.fatOrderbump ?? 0,
        fatFunil: r.fatFunil ?? 0,
        convGeralOrderbump:
          r.convGeralOrderbump ?? dailyOrderbumpConversion(r),
        proporcaoFunilFront:
          r.proporcaoFunilFront ?? dailyFunnelProportion(r),
      })),
    [rows],
  );

  // Daily revenue per bump (stacked bar) — only top 6 bumps
  const topBumps = totals.bumpsAgg.slice(0, 6);
  const dailyBumpRev = useMemo(
    () =>
      rows.map((r) => {
        const o: Record<string, number | string> = { day: fmtDay(r.date) };
        topBumps.forEach((b) => {
          const found = r.bumps?.find((x) => x.name === b.name);
          o[b.name] = found?.revenue ?? 0;
        });
        return o;
      }),
    [rows, topBumps],
  );

  // Donut data
  const donutData = useMemo(() => {
    const arr = [
      { name: "Front (Produto principal)", value: totals.fatFront, color: "hsl(var(--kpi-blue))" },
    ];
    topBumps.forEach((b, i) => {
      arr.push({ name: b.name, value: b.revenue, color: PALETTE[i % PALETTE.length] });
    });
    return arr.filter((x) => x.value > 0);
  }, [totals.fatFront, topBumps]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Faturamento Total · Funil"
          value={fBRL(totals.fatFunil)}
          hint="Soma do funil completo"
          icon={Wallet}
          tone="blue"
        />
        <KpiCard
          label="Proporção Funil x Front"
          value={fPct(totals.proporcaoFunilFront)}
          hint="Faturamento Funil ÷ Front"
          icon={Scale}
          tone="indigo"
        />
        <KpiCard
          label="% Conv. Geral Orderbump"
          value={fPct(totals.convGeralOrderbump)}
          hint="Vendas orderbump ÷ vendas Front"
          icon={Percent}
          tone="orange"
        />
        <KpiCard
          label="Receita Bumps"
          value={fBRL(totals.orderbumpsRev)}
          hint={`${totals.bumpsAgg.filter((b) => b.type === "orderbump").length} order bumps`}
          icon={Gift}
          tone="emerald"
        />
        <KpiCard
          label="Receita Upsells"
          value={fBRL(totals.upsellsRev)}
          hint={`${totals.bumpsAgg.filter((b) => b.type === "upsell").length} upsells`}
          icon={ArrowUpRight}
          tone="violet"
        />
      </div>

      {/* Per-bump KPI cards */}
      {totals.bumpsAgg.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-medium">
            Receita & Conversão por Produto
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {totals.bumpsAgg.map((b, i) => (
              <div key={b.name} className="kpi-card group">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide " +
                          (b.type === "upsell"
                            ? "bg-kpi-violet/15 text-kpi-violet"
                            : "bg-kpi-emerald/15 text-kpi-emerald")
                        }
                      >
                        {b.type === "upsell" ? "Upsell" : "Order Bump"}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-foreground truncate" title={b.name}>
                      {b.name}
                    </div>
                  </div>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: `${PALETTE[i % PALETTE.length]}1A`,
                      color: PALETTE[i % PALETTE.length],
                    }}
                  >
                    {b.type === "upsell" ? (
                      <ArrowUpRight className="w-4 h-4" strokeWidth={2.4} />
                    ) : (
                      <Gift className="w-4 h-4" strokeWidth={2.4} />
                    )}
                  </div>
                </div>
                <div
                  className="text-xl font-bold tabular-nums"
                  style={{ color: PALETTE[i % PALETTE.length] }}
                >
                  {fBRL(b.revenue)}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Conversão</span>
                  <span className="tabular-nums font-medium text-foreground">
                    {fPct(b.avgRate ?? b.convRate)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Vendas</span>
                  <span className="tabular-nums text-muted-foreground">{fNum(b.count)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Donut + per-bump table */}
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <ChartSection title="Contribuição de Receita" description="Distribuição por produto no funil">
            {donutData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Sem dados de bumps no período
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={
                        <RichTooltip
                          formatter={(v) =>
                            `${fBRL(v)} · ${((v / donutData.reduce((s, d) => s + d.value, 0)) * 100).toFixed(1)}%`
                          }
                        />
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 space-y-1.5 text-xs">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
                  <span className="flex-1 text-muted-foreground truncate">{d.name}</span>
                  <span className="tabular-nums text-foreground font-medium">{fBRL(d.value)}</span>
                </div>
              ))}
            </div>
          </ChartSection>
        </div>

        <div className="lg:col-span-3">
          <ChartSection title="Detalhamento por Bump/Upsell" description="Período selecionado">
            {totals.bumpsAgg.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Nenhum bump encontrado no CSV</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Produto</th>
                      <th className="py-2 px-3 font-medium">Tipo</th>
                      <th className="py-2 px-3 font-medium text-right">Vendas</th>
                      <th className="py-2 px-3 font-medium text-right">Receita</th>
                      <th className="py-2 px-3 font-medium text-right">Ticket</th>
                      <th className="py-2 pl-3 font-medium text-right">Conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.bumpsAgg.map((b) => (
                      <tr key={b.name} className="border-b border-border/40 last:border-0">
                        <td className="py-2.5 pr-3 font-medium text-foreground">{b.name}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={
                              "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide " +
                              (b.type === "upsell"
                                ? "bg-kpi-violet/15 text-kpi-violet"
                                : "bg-kpi-emerald/15 text-kpi-emerald")
                            }
                          >
                            {b.type === "upsell" ? "Upsell" : "Order Bump"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{fNum(b.count)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-medium">{fBRL(b.revenue)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{fBRL(b.ticket)}</td>
                        <td className="py-2.5 pl-3 text-right tabular-nums">
                          <span className={b.convRate && b.convRate >= 10 ? "text-kpi-green" : "text-foreground"}>
                            {fPct(b.convRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartSection>
        </div>
      </div>

      {/* Front vs Funil daily */}
      <ChartSection
        title="Faturamento Front vs Funil (Diário)"
        description="Compara o produto principal contra o faturamento total do funil"
      >
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barGap={4} barCategoryGap="20%">
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="day" {...axis} />
              <YAxis {...axis} />
              <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={barCursor} />
              <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
              <Bar dataKey="fatFront" name="Front" fill={chartColors.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="fatFunil" name="Funil Total" fill={chartColors.secondary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartSection>

      {/* Stacked daily revenue per bump */}
      {topBumps.length > 0 && (
        <ChartSection
          title="Receita por Bump/Upsell (Diário)"
          description="Top 6 produtos do funil empilhados"
        >
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={dailyBumpRev} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} />
                <Tooltip content={<RichTooltip formatter={(v) => fBRL(v)} />} cursor={barCursor} />
                {topBumps.map((b, i) => (
                  <Bar
                    key={b.name}
                    dataKey={b.name}
                    stackId="bumps"
                    fill={PALETTE[i % PALETTE.length]}
                    radius={i === topBumps.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartSection
          title="Conversão Geral de Order Bump"
          description="Vendas de todos os order bumps ÷ vendas Front, dia a dia"
        >
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} domain={[0, "auto"]} tickFormatter={(value) => `${value}%`} />
                <Tooltip content={<RichTooltip formatter={(value) => fPct(value)} />} />
                <Line
                  type="monotone"
                  dataKey="convGeralOrderbump"
                  name="Conversão geral"
                  stroke={chartColors.positive}
                  strokeWidth={2.6}
                  dot={{ r: 3, fill: chartColors.positive }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>

        <ChartSection
          title="Conversão x Proporção do Funil"
          description="Relação diária entre conversão geral e faturamento Funil ÷ Front"
        >
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="day" {...axis} />
                <YAxis yAxisId="proportion" {...axis} tickFormatter={(value) => `${value}%`} />
                <YAxis yAxisId="conversion" orientation="right" {...axis} tickFormatter={(value) => `${value}%`} />
                <Tooltip content={<RichTooltip formatter={(value) => fPct(value)} />} cursor={barCursor} />
                <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
                <Bar
                  yAxisId="proportion"
                  dataKey="proporcaoFunilFront"
                  name="Proporção Funil ÷ Front"
                  fill={chartColors.primary}
                  radius={[5, 5, 0, 0]}
                  opacity={0.78}
                />
                <Line
                  yAxisId="conversion"
                  type="monotone"
                  dataKey="convGeralOrderbump"
                  name="Conversão geral"
                  stroke={chartColors.positive}
                  strokeWidth={2.6}
                  dot={{ r: 3, fill: chartColors.positive }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartSection>
      </div>
    </div>
  );
};

function dailyOrderbumpConversion(row: DailyRow) {
  const orderbumpSales = row.bumps
    ?.filter((bump) => bump.type === "orderbump")
    .reduce((sum, bump) => sum + (bump.count ?? 0), 0) ?? 0;
  return row.vendasFront ? (orderbumpSales / row.vendasFront) * 100 : null;
}

function dailyFunnelProportion(row: DailyRow) {
  return row.fatFront ? ((row.fatFunil ?? 0) / row.fatFront) * 100 : null;
}

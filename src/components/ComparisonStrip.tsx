import { TrendingUp, TrendingDown, Minus, BarChart3, Radio, Target, Gift } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { computeTotals, fBRL, fNum, fMult, fPct } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface Props {
  current: DailyRow[];
  previous: DailyRow[];
}

type Format = "brl" | "num" | "mult" | "pct";

const fmt = (v: number | null | undefined, f: Format) => {
  if (v == null || isNaN(v as number)) return "—";
  switch (f) {
    case "brl":
      return fBRL(v);
    case "num":
      return fNum(v);
    case "mult":
      return fMult(v);
    case "pct":
      return fPct(v);
  }
};

interface Metric {
  label: string;
  cur: number | null;
  prev: number | null;
  format: Format;
  /** Métricas onde "menor é melhor" (CAC, CPM, CPC, custos, reembolso) */
  inverse?: boolean;
}

const Delta = ({ cur, prev, inverse }: { cur: number | null; prev: number | null; inverse?: boolean }) => {
  if (cur == null || prev == null || prev === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="w-3 h-3" />
        —
      </span>
    );
  }
  const diff = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(diff) < 0.05) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="w-3 h-3" />
        0%
      </span>
    );
  }
  const positive = inverse ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        positive ? "text-kpi-green" : "text-kpi-red",
      )}
    >
      <Icon className="w-3 h-3" />
      {diff > 0 ? "+" : ""}
      {diff.toFixed(1)}%
    </span>
  );
};

const MetricCell = ({ m }: { m: Metric }) => (
  <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2.5">
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium truncate">
        {m.label}
      </span>
      <Delta cur={m.cur} prev={m.prev} inverse={m.inverse} />
    </div>
    <div className="text-base font-bold text-foreground tabular-nums leading-tight">
      {fmt(m.cur, m.format)}
    </div>
    <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
      vs {fmt(m.prev, m.format)}
    </div>
  </div>
);

interface SectionDef {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  metrics: Metric[];
}

const Section = ({ def }: { def: SectionDef }) => {
  if (!def.metrics.length) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", def.tone)}>
          <def.icon className="w-3.5 h-3.5" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">{def.title}</h4>
        <span className="text-xs text-muted-foreground">({def.metrics.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {def.metrics.map((m) => (
          <MetricCell key={m.label} m={m} />
        ))}
      </div>
    </section>
  );
};

/** Aggregates orderbump+upsell totals from the raw rows */
function bumpTotals(rows: DailyRow[]) {
  let fatFront = 0;
  let fatFunil = 0;
  let vendasFront = 0;
  let orderbumpRev = 0;
  let upsellRev = 0;
  let orderbumpSales = 0;
  rows.forEach((r) => {
    fatFront += r.fatFront ?? 0;
    fatFunil += r.fatFunil ?? 0;
    vendasFront += r.vendasFront ?? 0;
    r.bumps?.forEach((b) => {
      if (b.type === "orderbump") {
        orderbumpRev += b.revenue ?? 0;
        orderbumpSales += b.count ?? 0;
      } else {
        upsellRev += b.revenue ?? 0;
      }
    });
  });
  return {
    fatFront,
    fatFunil,
    orderbumpRev,
    upsellRev,
    proporcaoFunilFront: fatFront ? (fatFunil / fatFront) * 100 : null,
    convGeralOrderbump: vendasFront ? (orderbumpSales / vendasFront) * 100 : null,
  };
}

export const ComparisonStrip = ({ current, previous }: Props) => {
  if (!previous || previous.length === 0) return null;
  const c = computeTotals(current);
  const p = computeTotals(previous);
  const cb = bumpTotals(current);
  const pb = bumpTotals(previous);

  const sections: SectionDef[] = [
    {
      title: "Visão Geral",
      icon: BarChart3,
      tone: "bg-kpi-blue/15 text-kpi-blue",
      metrics: [
        { label: "Investimento", cur: c.investimento, prev: p.investimento, format: "brl" },
        { label: "Faturamento Líquido", cur: c.fatLiquido, prev: p.fatLiquido, format: "brl" },
        { label: "Lucro", cur: c.lucro, prev: p.lucro, format: "brl" },
        { label: "ROI", cur: c.roi, prev: p.roi, format: "mult" },
        { label: "Vendas Totais", cur: c.vendasTotais, prev: p.vendasTotais, format: "num" },
        { label: "Vendas Front", cur: c.vendasFront, prev: p.vendasFront, format: "num" },
        { label: "CAC", cur: c.cac, prev: p.cac, format: "brl", inverse: true },
        { label: "AOV", cur: c.aov, prev: p.aov, format: "brl" },
        { label: "Aprov. Cartão", cur: c.avgAprovCartao, prev: p.avgAprovCartao, format: "pct" },
        { label: "Aprov. Pix", cur: c.avgAprovPix, prev: p.avgAprovPix, format: "pct" },
        { label: "Reembolsos", cur: c.reembolsos, prev: p.reembolsos, format: "num", inverse: true },
        { label: "Taxa de Reembolso", cur: c.taxaReembolso, prev: p.taxaReembolso, format: "pct", inverse: true },
      ],
    },
    {
      title: "Tráfego",
      icon: Radio,
      tone: "bg-kpi-cyan/15 text-kpi-cyan",
      metrics: [
        { label: "Impressões", cur: c.impressoes, prev: p.impressoes, format: "num" },
        { label: "Cliques", cur: c.cliques, prev: p.cliques, format: "num" },
        { label: "Pageviews", cur: c.pageviews, prev: p.pageviews, format: "num" },
        { label: "Checkouts", cur: c.checkouts, prev: p.checkouts, format: "num" },
        { label: "CTR", cur: c.ctr, prev: p.ctr, format: "pct" },
        { label: "Taxa de Carregamento", cur: c.taxaCarreg, prev: p.taxaCarreg, format: "pct" },
        { label: "Pageview → Checkout", cur: c.passChk, prev: p.passChk, format: "pct" },
        { label: "CPM", cur: c.cpm, prev: p.cpm, format: "brl", inverse: true },
        { label: "CPC", cur: c.cpc, prev: p.cpc, format: "brl", inverse: true },
        { label: "Custo por Pageview", cur: c.custoPageview, prev: p.custoPageview, format: "brl", inverse: true },
        { label: "Custo por I.C.", cur: c.custoIC, prev: p.custoIC, format: "brl", inverse: true },
      ],
    },
    {
      title: "Funil VSL",
      icon: Target,
      tone: "bg-kpi-violet/15 text-kpi-violet",
      metrics: [
        { label: "Play Rate", cur: c.avgPlayRate, prev: p.avgPlayRate, format: "pct" },
        { label: "Retenção do Pitch", cur: c.avgRetPitch, prev: p.avgRetPitch, format: "pct" },
        { label: "Pitch → Checkout", cur: c.avgPitchChk, prev: p.avgPitchChk, format: "pct" },
        { label: "Pitch → Venda", cur: c.avgPitchVenda, prev: p.avgPitchVenda, format: "pct" },
        { label: "Checkout → Venda", cur: c.avgChkVenda, prev: p.avgChkVenda, format: "pct" },
      ],
    },
    {
      title: "Bumps & Upsell",
      icon: Gift,
      tone: "bg-kpi-emerald/15 text-kpi-emerald",
      metrics: [
        { label: "Faturamento Funil", cur: cb.fatFunil, prev: pb.fatFunil, format: "brl" },
        { label: "Faturamento Front", cur: cb.fatFront, prev: pb.fatFront, format: "brl" },
        { label: "Receita Order Bumps", cur: cb.orderbumpRev, prev: pb.orderbumpRev, format: "brl" },
        { label: "Receita Upsells", cur: cb.upsellRev, prev: pb.upsellRev, format: "brl" },
        { label: "Proporção Funil x Front", cur: cb.proporcaoFunilFront, prev: pb.proporcaoFunilFront, format: "pct" },
        { label: "% Conv. Geral Orderbump", cur: cb.convGeralOrderbump, prev: pb.convGeralOrderbump, format: "pct" },
      ],
    },
  ];

  return (
    <div className="section-card">
      <div className="flex items-baseline justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">Comparativo vs período anterior</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {current.length} dias atuais comparados a {previous.length} dias imediatamente anteriores
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {sections.map((s) => (
          <Section key={s.title} def={s} />
        ))}
      </div>
    </div>
  );
};

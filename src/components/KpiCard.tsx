import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getKpiInfo } from "@/lib/kpiInfo";

type Tone =
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "green"
  | "emerald"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "cyan";

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
  /** Variante destacada: card maior, valor grande, ocupa mais colunas */
  featured?: boolean;
  /** Série numérica para mini-sparkline (ex: lucro por dia) */
  spark?: number[];
  /** Variação percentual vs período anterior (ex: 12.3 = +12,3%) */
  deltaPct?: number | null;
  /** Para deltaPct: se a métrica é "boa quando sobe" (default true). Inverter para CAC, taxa de reembolso etc. */
  goodWhenUp?: boolean;
}

const toneRing: Record<Tone, string> = {
  blue: "text-kpi-blue bg-kpi-blue/10",
  indigo: "text-kpi-indigo bg-kpi-indigo/10",
  violet: "text-kpi-violet bg-kpi-violet/10",
  purple: "text-kpi-purple bg-kpi-purple/10",
  green: "text-kpi-green bg-kpi-green/10",
  emerald: "text-kpi-emerald bg-kpi-emerald/10",
  yellow: "text-kpi-yellow bg-kpi-yellow/10",
  orange: "text-kpi-orange bg-kpi-orange/10",
  red: "text-kpi-red bg-kpi-red/10",
  pink: "text-kpi-pink bg-kpi-pink/10",
  cyan: "text-kpi-cyan bg-kpi-cyan/10",
};

const toneText: Record<Tone, string> = {
  blue: "text-kpi-blue",
  indigo: "text-kpi-indigo",
  violet: "text-kpi-violet",
  purple: "text-kpi-purple",
  green: "text-kpi-green",
  emerald: "text-kpi-emerald",
  yellow: "text-kpi-yellow",
  orange: "text-kpi-orange",
  red: "text-kpi-red",
  pink: "text-kpi-pink",
  cyan: "text-kpi-cyan",
};

const toneStroke: Record<Tone, string> = {
  blue: "hsl(var(--kpi-blue))",
  indigo: "hsl(var(--kpi-indigo))",
  violet: "hsl(var(--kpi-violet))",
  purple: "hsl(var(--kpi-purple))",
  green: "hsl(var(--kpi-green))",
  emerald: "hsl(var(--kpi-emerald))",
  yellow: "hsl(var(--kpi-yellow))",
  orange: "hsl(var(--kpi-orange))",
  red: "hsl(var(--kpi-red))",
  pink: "hsl(var(--kpi-pink))",
  cyan: "hsl(var(--kpi-cyan))",
};

interface SparklineProps {
  data: number[];
  color: string;
  height: number;
  className?: string;
}

const Sparkline = ({ data, color, height, className }: SparklineProps) => {
  if (!data || data.length < 2) return null;
  const w = 100;
  const h = height;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  // area path
  const area = `M0,${h} L${points.split(" ").join(" L")} L${w},${h} Z`;
  const gradId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

interface DeltaProps {
  pct: number;
  goodWhenUp: boolean;
}

const Delta = ({ pct, goodWhenUp }: DeltaProps) => {
  if (!isFinite(pct)) return null;
  const up = pct >= 0;
  const isGood = goodWhenUp ? up : !up;
  const colorClass = isGood ? "text-kpi-green bg-kpi-green/10" : "text-kpi-red bg-kpi-red/10";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        colorClass,
      )}
      title="vs período anterior"
    >
      <Icon className="w-3 h-3" strokeWidth={2.6} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

export const KpiCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
  featured = false,
  spark,
  deltaPct,
  goodWhenUp = true,
}: Props) => {
  const showSpark = !!(spark && spark.length >= 2);
  const showDelta = deltaPct != null && isFinite(deltaPct);
  const info = getKpiInfo(label);

  return (
    <div className={cn("kpi-card group", featured && "ring-1 ring-border/70")}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground truncate">
            {label}
          </span>
          {info && (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground/60 hover:text-foreground transition-colors shrink-0"
                  aria-label={`Ajuda: ${label}`}
                >
                  <HelpCircle className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[240px] text-xs">
                {info.formula && (
                  <div className="font-mono text-[11px] mb-1 opacity-90">{info.formula}</div>
                )}
                <div>{info.description}</div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              "rounded-lg flex items-center justify-center",
              toneRing[tone],
              featured ? "w-10 h-10" : "w-8 h-8",
            )}
          >
            <Icon className={cn(featured ? "w-5 h-5" : "w-4 h-4")} strokeWidth={2.2} />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <div
          className={cn(
            "font-bold tabular-nums leading-none",
            featured ? "text-3xl md:text-4xl" : "text-2xl",
            toneText[tone],
          )}
        >
          {value}
        </div>
        {showDelta && <Delta pct={deltaPct as number} goodWhenUp={goodWhenUp} />}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
      {showSpark && (
        <div className="mt-3 -mx-1">
          <Sparkline
            data={spark as number[]}
            color={toneStroke[tone]}
            height={featured ? 44 : 28}
          />
        </div>
      )}
    </div>
  );
};

import { useEffect, useMemo, useState } from "react";
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
import { Loader2, Play, Film, ArrowRightLeft, Target, CheckCircle2 } from "lucide-react";
import type { DailyRow } from "@/lib/csv";
import { computeTotals, fPct, fNum } from "@/lib/metrics";
import { KpiCard } from "./KpiCard";
import { ChartSection } from "./ChartSection";
import { axis, grid, RichTooltip, chartColors } from "./charts/chartShared";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  rows: DailyRow[];
  projectId?: string | null;
  dateRange?: { from?: Date; to?: Date };
}

const fmtDay = (d: Date | null) => (d ? format(d, "dd/MM") : "");
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

type VturbPlayerOption = {
  id: string;
  player_id: string;
  label: string | null;
};

type VturbRawRow = {
  event_date: string;
  event_type: string;
  payload: Record<string, unknown> | null;
};

export const FunnelPanel = ({ rows, projectId, dateRange }: Props) => {
  const [players, setPlayers] = useState<VturbPlayerOption[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("all");
  const [playerRows, setPlayerRows] = useState<DailyRow[] | null>(null);
  const [loadingPlayerRows, setLoadingPlayerRows] = useState(false);
  const fromDate = dateRange?.from ?? rows[0]?.date ?? null;
  const toDate = dateRange?.to ?? rows[rows.length - 1]?.date ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadPlayers() {
      if (!projectId) {
        setPlayers([]);
        setSelectedPlayerId("all");
        return;
      }
      const { data: bindings, error: bindingError } = await supabase
        .from("project_vturb_players")
        .select("vturb_player_id")
        .eq("project_id", projectId);
      if (bindingError) return;
      const ids = [...new Set((bindings ?? []).map((row) => row.vturb_player_id).filter(Boolean))];
      if (ids.length === 0) {
        if (!cancelled) {
          setPlayers([]);
          setSelectedPlayerId("all");
        }
        return;
      }
      const { data, error } = await supabase
        .from("workspace_vturb_players")
        .select("id, player_id, label")
        .in("id", ids);
      if (cancelled || error) return;
      const options = ((data ?? []) as VturbPlayerOption[])
        .filter((player) => player.player_id)
        .sort((a, b) => (a.label ?? a.player_id).localeCompare(b.label ?? b.player_id, "pt-BR"));
      setPlayers(options);
      if (selectedPlayerId !== "all" && !options.some((player) => player.player_id === selectedPlayerId)) {
        setSelectedPlayerId("all");
      }
    }
    void loadPlayers();
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPlayerId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedPlayerRows() {
      if (!projectId || selectedPlayerId === "all" || !fromDate || !toDate) {
        setPlayerRows(null);
        setLoadingPlayerRows(false);
        return;
      }
      setLoadingPlayerRows(true);
      const { data, error } = await supabase
        .from("raw_events")
        .select("event_date, event_type, payload")
        .eq("project_id", projectId)
        .eq("source", "vturb")
        .eq("account_id", selectedPlayerId)
        .gte("event_date", ymd(fromDate))
        .lte("event_date", ymd(toDate))
        .limit(5000);
      if (cancelled) return;
      setLoadingPlayerRows(false);
      if (error) {
        setPlayerRows(null);
        return;
      }
      setPlayerRows(applyVturbRowsForPlayer(rows, (data ?? []) as VturbRawRow[]));
    }
    void loadSelectedPlayerRows();
    return () => {
      cancelled = true;
    };
  }, [fromDate, projectId, rows, selectedPlayerId, toDate]);

  const effectiveRows = selectedPlayerId === "all" ? rows : playerRows ?? rows;
  const t = useMemo(() => computeTotals(effectiveRows), [effectiveRows]);

  const series = useMemo(
    () =>
      effectiveRows.map((r) => ({
        day: fmtDay(r.date),
        playRate: r.playRate ?? 0,
        retPitch: r.retPitch ?? 0,
        pitchChk: r.pitchChk ?? 0,
        pitchVenda: r.pitchVenda ?? 0,
        chkVenda: r.chkVenda ?? 0,
      })),
    [effectiveRows],
  );

  // Aggregated funnel
  const funnel = useMemo(() => {
    const views = effectiveRows.reduce((s, r) => s + (r.viewsUnicas ?? 0), 0);
    const plays = effectiveRows.reduce((s, r) => {
      if (typeof r.playsUnicos === "number" && Number.isFinite(r.playsUnicos)) return s + r.playsUnicos;
      const pageviews = typeof r.pageviews === "number" ? r.pageviews : 0;
      const playRate = typeof r.playRate === "number" ? r.playRate : null;
      return s + (playRate == null ? 0 : (pageviews * playRate) / 100);
    }, 0);
    const pitch = effectiveRows.reduce((s, r) => s + (r.chegaramPitch ?? 0), 0);
    const checkouts = effectiveRows.reduce((s, r) => s + (r.checkouts ?? 0), 0);
    const vendas = effectiveRows.reduce((s, r) => s + (r.vendasFront ?? 0), 0);
    return { views, plays, pitch, checkouts, vendas };
  }, [effectiveRows]);

  const fmax = Math.max(funnel.views, 1);

  const stages: { label: string; value: number; tone: string; pctOfPrev?: number | null }[] = [
    { label: "Visualizações Únicas", value: funnel.views, tone: "kpi-cyan" },
    {
      label: "Plays Únicos",
      value: funnel.plays,
      tone: "kpi-blue",
      pctOfPrev: funnel.views ? (funnel.plays / funnel.views) * 100 : null,
    },
    {
      label: "Chegaram no Pitch",
      value: funnel.pitch,
      tone: "kpi-blue",
      pctOfPrev: funnel.plays ? (funnel.pitch / funnel.plays) * 100 : null,
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
      {players.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Player VTurb</div>
            <div className="text-xs text-muted-foreground">
              O padrão soma todos os players ativos; selecione um vídeo/lead para isolar o funil VSL.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loadingPlayerRows && selectedPlayerId !== "all" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
              <SelectTrigger className="w-full sm:w-[280px]">
                <SelectValue placeholder="Todos os players" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os players ativos</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.player_id}>
                    {player.label || player.player_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

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

function applyVturbRowsForPlayer(baseRows: DailyRow[], rawRows: VturbRawRow[]) {
  const byDate = new Map<string, { pageviews: number; viewsUnicas: number; plays: number; chegaramPitch: number }>();
  for (const row of rawRows) {
    const current = byDate.get(row.event_date) ?? { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 0 };
    const metrics = vturbPayloadMetrics(row.event_type, row.payload ?? {});
    current.pageviews += metrics.pageviews;
    current.viewsUnicas += metrics.viewsUnicas;
    current.plays += metrics.plays;
    current.chegaramPitch += metrics.chegaramPitch;
    byDate.set(row.event_date, current);
  }

  return baseRows.map((row) => {
    if (!row.date) return row;
    const key = ymd(row.date);
    const metrics = byDate.get(key);
    if (!metrics) {
      return {
        ...row,
        pageviews: null,
        viewsUnicas: null,
        playsUnicos: null,
        playRate: null,
        retPitch: null,
        chegaramPitch: null,
        pitchChk: null,
        pitchVenda: null,
      };
    }
    const pageviews = metrics.pageviews || null;
    const playsUnicos = metrics.plays || null;
    const chegaramPitch = metrics.chegaramPitch || null;
    return {
      ...row,
      pageviews,
      viewsUnicas: metrics.viewsUnicas || null,
      playsUnicos,
      playRate: pageviews && playsUnicos ? (playsUnicos / pageviews) * 100 : null,
      retPitch: playsUnicos && chegaramPitch ? (chegaramPitch / playsUnicos) * 100 : null,
      chegaramPitch,
      pitchChk: chegaramPitch && row.checkouts ? (row.checkouts / chegaramPitch) * 100 : null,
      pitchVenda: chegaramPitch && row.vendasFront ? (row.vendasFront / chegaramPitch) * 100 : null,
    };
  });
}

function vturbPayloadMetrics(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "pageview") return { pageviews: 1, viewsUnicas: 0, plays: 0, chegaramPitch: 0 };
  if (eventType === "play") return { pageviews: 0, viewsUnicas: 1, plays: 1, chegaramPitch: 0 };
  if (eventType === "pitch_reached") return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 1 };
  if (eventType === "sessions_stats_by_day") {
    const pageviews = firstNumber(payload, ["total_viewed_session_uniq", "total_viewed", "views", "pageviews"]);
    const viewsUnicas = firstNumber(payload, ["total_viewed_device_uniq", "total_viewed_session_uniq", "unique_views", "views_unicas"]) || pageviews;
    const plays = firstNumber(payload, ["total_started_session_uniq", "total_started", "plays", "started"]);
    const chegaramPitch = firstNumber(payload, ["total_over_pitch", "pitch_reached", "reached_pitch", "pitch"]);
    return { pageviews, viewsUnicas, plays, chegaramPitch };
  }
  if (eventType === "stats_by_day") {
    const pageviews = firstNumber(payload, ["pageviews", "page_views", "page_views_count", "landing_page_views", "visits", "total"]);
    const plays = firstNumber(payload, ["plays", "play", "started", "video_starts", "video_started", "viewed", "total_uniq_sessions", "total_uniq_device", "total"]);
    const viewsUnicas = firstNumber(payload, ["views_unicas", "unique_views", "unique_viewers", "visitors", "total_uniq_sessions", "total_uniq_device"]) || plays;
    const chegaramPitch = firstNumber(payload, ["pitch_reached", "reached_pitch", "sales_page_viewers", "pitch"]);
    return { pageviews, viewsUnicas, plays, chegaramPitch };
  }
  return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 0 };
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

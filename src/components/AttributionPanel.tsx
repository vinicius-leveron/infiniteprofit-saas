import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  GitBranch,
  Loader2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Play,
  ShoppingCart,
  CreditCard,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fBRL, fNum, fPct } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DailyRow } from "@/lib/csv";

interface AttributionPanelProps {
  rows: DailyRow[];
  projectId?: string | null;
}

type SortKey = "roas" | "revenue" | "spend" | "conversions";

interface PathMetric {
  id: string;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ad_name: string | null;
  player_id: string | null;
  player_name: string | null;
  // Metrics
  spend: number;
  clicks: number;
  views: number;
  pitch_reached: number;
  pitch_retention: number | null;
  checkouts: number;
  purchases: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  // Conversion rates
  click_to_view: number | null;
  view_to_pitch: number | null;
  pitch_to_checkout: number | null;
  checkout_to_purchase: number | null;
}

interface RawEventPayload {
  utm_source?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_medium?: string;
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  player_id?: string;
  // VTurb traffic data
  sessions?: number;
  views?: number;
  unique_views?: number;
  pitch_reached?: number;
  // Gateway data
  total?: number;
  net?: number;
  // General
  [key: string]: unknown;
}

export function AttributionPanel({ rows, projectId }: AttributionPanelProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [trafficData, setTrafficData] = useState<Array<{ payload: RawEventPayload }>>([]);
  const [gatewayData, setGatewayData] = useState<Array<{ event_type: string; payload: RawEventPayload }>>([]);
  const [metaData, setMetaData] = useState<Array<{ payload: RawEventPayload }>>([]);
  const [sortKey, setSortKey] = useState<SortKey>("roas");
  const [showLegacy, setShowLegacy] = useState(false);

  // Load UTM-based data from raw_events
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    Promise.all([
      // VTurb traffic by source
      supabase
        .from("raw_events")
        .select("payload")
        .eq("project_id", projectId)
        .eq("source", "vturb")
        .eq("event_type", "traffic_by_source")
        .limit(1000),
      // Gateway events with UTM
      supabase
        .from("raw_events")
        .select("event_type, payload")
        .eq("project_id", projectId)
        .eq("source", "gateway")
        .in("event_type", ["purchase.approved", "checkout_created"])
        .limit(5000),
      // Meta ad-level insights
      supabase
        .from("raw_events")
        .select("payload")
        .eq("project_id", projectId)
        .eq("source", "meta")
        .eq("event_type", "insight_ad")
        .limit(5000),
    ]).then(([traffic, gateway, meta]) => {
      setTrafficData((traffic.data ?? []) as Array<{ payload: RawEventPayload }>);
      setGatewayData((gateway.data ?? []) as Array<{ event_type: string; payload: RawEventPayload }>);
      setMetaData((meta.data ?? []) as Array<{ payload: RawEventPayload }>);
      setLoading(false);
    });
  }, [projectId]);

  // Build path metrics from raw data
  const paths = useMemo(() => {
    const pathMap = new Map<string, PathMetric>();

    // Process VTurb traffic by source (has UTM data)
    for (const event of trafficData) {
      const payload = event.payload ?? {};
      const utmSource = String(payload.utm_source ?? "direct").toLowerCase();
      const utmCampaign = payload.utm_campaign ? String(payload.utm_campaign) : null;
      const utmContent = payload.utm_content ? String(payload.utm_content) : null;

      // Build path key based on UTM params
      const pathKey = [utmSource, utmCampaign, utmContent].filter(Boolean).join(":") || "direct";

      const current = pathMap.get(pathKey) ?? createEmptyPath(pathKey);
      current.utm_source = utmSource;
      current.utm_campaign = utmCampaign;
      current.utm_content = utmContent;

      // Add VTurb metrics
      current.views += toNumber(payload.sessions ?? payload.views ?? payload.unique_views);
      current.pitch_reached += toNumber(payload.pitch_reached ?? payload.conversions);

      pathMap.set(pathKey, current);
    }

    // Process Meta ad insights to get spend/clicks per campaign/content
    const metaByContent = new Map<string, { spend: number; clicks: number; ad_name: string }>();
    for (const event of metaData) {
      const payload = event.payload ?? {};
      const adId = String(payload.ad_id ?? "");
      const adName = String(payload.ad_name ?? adId);

      if (!adId) continue;

      const current = metaByContent.get(adId) ?? { spend: 0, clicks: 0, ad_name: adName };
      current.spend += toNumber(payload.spend);
      current.clicks += extractLinkClicks(payload);
      metaByContent.set(adId, current);
    }

    // Process gateway events (purchases/checkouts with potential UTM)
    for (const event of gatewayData) {
      const payload = event.payload ?? {};
      const utmSource = payload.utm_source ? String(payload.utm_source).toLowerCase() : null;
      const utmCampaign = payload.utm_campaign ? String(payload.utm_campaign) : null;
      const utmContent = payload.utm_content ? String(payload.utm_content) : null;

      if (!utmSource) continue; // Skip events without UTM tracking

      const pathKey = [utmSource, utmCampaign, utmContent].filter(Boolean).join(":") || "direct";

      const current = pathMap.get(pathKey) ?? createEmptyPath(pathKey);
      current.utm_source = utmSource;
      current.utm_campaign = utmCampaign;
      current.utm_content = utmContent;

      if (event.event_type === "checkout_created") {
        current.checkouts += 1;
      } else if (event.event_type === "purchase.approved") {
        current.purchases += 1;
        current.revenue += toNumber(payload.total ?? payload.net ?? 0);
      }

      pathMap.set(pathKey, current);
    }

    // Try to correlate Meta spend with paths by matching utm_content to ad_id
    for (const [pathKey, path] of pathMap) {
      if (path.utm_content) {
        const metaMatch = metaByContent.get(path.utm_content);
        if (metaMatch) {
          path.spend = metaMatch.spend;
          path.clicks = metaMatch.clicks;
          path.ad_name = metaMatch.ad_name;
        }
      }
    }

    // Calculate derived metrics
    for (const path of pathMap.values()) {
      path.roas = path.spend > 0 && path.revenue > 0 ? path.revenue / path.spend : null;
      path.cpa = path.purchases > 0 && path.spend > 0 ? path.spend / path.purchases : null;
      path.click_to_view = path.clicks > 0 && path.views > 0 ? (path.views / path.clicks) * 100 : null;
      path.view_to_pitch = path.views > 0 && path.pitch_reached > 0 ? (path.pitch_reached / path.views) * 100 : null;
      path.pitch_to_checkout = path.pitch_reached > 0 && path.checkouts > 0 ? (path.checkouts / path.pitch_reached) * 100 : null;
      path.checkout_to_purchase = path.checkouts > 0 && path.purchases > 0 ? (path.purchases / path.checkouts) * 100 : null;
      path.pitch_retention = path.view_to_pitch;
    }

    // Sort paths
    return [...pathMap.values()]
      .filter((p) => p.views > 0 || p.purchases > 0 || p.spend > 0)
      .sort((a, b) => valueForSort(b, sortKey) - valueForSort(a, sortKey));
  }, [trafficData, gatewayData, metaData, sortKey]);

  // Calculate totals
  const totals = useMemo(() => {
    return {
      spend: paths.reduce((sum, p) => sum + p.spend, 0),
      clicks: paths.reduce((sum, p) => sum + p.clicks, 0),
      views: paths.reduce((sum, p) => sum + p.views, 0),
      checkouts: paths.reduce((sum, p) => sum + p.checkouts, 0),
      purchases: paths.reduce((sum, p) => sum + p.purchases, 0),
      revenue: paths.reduce((sum, p) => sum + p.revenue, 0),
    };
  }, [paths]);

  const hasUtmData = paths.length > 0;

  return (
    <div className="section-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold">Atribuição por Caminho</h2>
          <p className="text-xs text-muted-foreground">
            Comparativo de performance por origem de tráfego (UTM).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasUtmData && (
            <div className="flex flex-wrap gap-1">
              {(["roas", "revenue", "spend", "conversions"] as SortKey[]).map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant={sortKey === key ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setSortKey(key)}
                  className="h-7 gap-1 text-xs"
                >
                  <ArrowDownUp className="w-3 h-3" />
                  {labelForSort(key)}
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLegacy(!showLegacy)}
            className="h-7 text-xs"
          >
            {showLegacy ? "Ocultar Legado" : "Ver Agregado Diário"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasUtmData && !showLegacy ? (
        <div className="rounded-lg border border-border/50 p-8 text-center">
          <GitBranch className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Sem dados de atribuição UTM</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Configure UTMs nos seus anúncios para rastrear o caminho completo
            do clique até a conversão. Use <code className="text-xs bg-muted px-1 py-0.5 rounded">utm_content</code> com
            o ID do anúncio para correlacionar automaticamente.
          </p>
          <div className="flex justify-center gap-2">
            {projectId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/diagnostics?project=${projectId}`)}
              >
                Ver Diagnóstico
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowLegacy(true)}>
              Ver Agregado Diário
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Path Rankings */}
          {hasUtmData && !showLegacy && (
            <>
              <div className="space-y-2 mb-6">
                {paths.slice(0, 10).map((path, index) => (
                  <PathCard key={path.id} path={path} rank={index + 1} />
                ))}
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-4 border-t border-border/50">
                <SummaryStat label="Gasto Total" value={fBRL(totals.spend)} icon={BarChart3} />
                <SummaryStat label="Cliques no link" value={fNum(totals.clicks)} icon={Play} />
                <SummaryStat label="Views VTurb" value={fNum(totals.views)} icon={Play} />
                <SummaryStat label="Checkouts" value={fNum(totals.checkouts)} icon={ShoppingCart} />
                <SummaryStat label="Vendas" value={fNum(totals.purchases)} icon={CreditCard} />
                <SummaryStat
                  label="ROAS Geral"
                  value={totals.spend > 0 ? `${(totals.revenue / totals.spend).toFixed(2)}x` : "—"}
                  icon={TrendingUp}
                  highlight={totals.revenue / totals.spend >= 2}
                />
              </div>
            </>
          )}

          {/* Legacy Daily View */}
          {showLegacy && <LegacyDailyTable rows={rows} />}
        </>
      )}
    </div>
  );
}

function PathCard({ path, rank }: { path: PathMetric; rank: number }) {
  const isGoodRoas = path.roas !== null && path.roas >= 2;
  const isBadRoas = path.roas !== null && path.roas < 1;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        isGoodRoas && "border-emerald-500/30 bg-emerald-500/5",
        isBadRoas && "border-red-500/30 bg-red-500/5",
        !isGoodRoas && !isBadRoas && "border-border/50"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Rank */}
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0",
            rank === 1 && "bg-amber-500/20 text-amber-500",
            rank === 2 && "bg-slate-400/20 text-slate-400",
            rank === 3 && "bg-orange-600/20 text-orange-600",
            rank > 3 && "bg-muted text-muted-foreground"
          )}
        >
          {rank}
        </div>

        {/* Path Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold truncate">
              {path.ad_name || path.utm_content || path.utm_campaign || path.utm_source || "Direct"}
            </span>
            {path.roas !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                  isGoodRoas && "bg-emerald-500/20 text-emerald-600",
                  isBadRoas && "bg-red-500/20 text-red-500",
                  !isGoodRoas && !isBadRoas && "bg-amber-500/20 text-amber-600"
                )}
              >
                {isGoodRoas ? <TrendingUp className="w-3 h-3" /> : isBadRoas ? <TrendingDown className="w-3 h-3" /> : null}
                {path.roas.toFixed(2)}x ROAS
              </span>
            )}
          </div>

          {/* UTM Breadcrumb */}
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-3">
            {path.utm_source && <span className="bg-muted px-1.5 py-0.5 rounded">{path.utm_source}</span>}
            {path.utm_campaign && (
              <>
                <span>→</span>
                <span className="bg-muted px-1.5 py-0.5 rounded truncate max-w-[150px]">{path.utm_campaign}</span>
              </>
            )}
            {path.utm_content && (
              <>
                <span>→</span>
                <span className="bg-muted px-1.5 py-0.5 rounded truncate max-w-[100px]">{path.utm_content}</span>
              </>
            )}
          </div>

          {/* Funnel Visualization */}
          <div className="flex items-center gap-1 text-xs">
            <FunnelStep label="Cliques no link" value={path.clicks} />
            <FunnelArrow rate={path.click_to_view} />
            <FunnelStep label="Views" value={path.views} />
            <FunnelArrow rate={path.view_to_pitch} />
            <FunnelStep label="Pitch" value={path.pitch_reached} highlight={path.pitch_retention !== null && path.pitch_retention >= 50} />
            <FunnelArrow rate={path.pitch_to_checkout} />
            <FunnelStep label="Chk" value={path.checkouts} />
            <FunnelArrow rate={path.checkout_to_purchase} />
            <FunnelStep label="Vendas" value={path.purchases} highlight={path.purchases > 0} />
          </div>
        </div>

        {/* Metrics Summary */}
        <div className="flex items-center gap-4 text-sm shrink-0">
          <div className="text-center">
            <div className="font-semibold tabular-nums">{fBRL(path.spend)}</div>
            <div className="text-[10px] text-muted-foreground">Gasto</div>
          </div>
          <div className="text-center">
            <div className="font-semibold tabular-nums">{fBRL(path.revenue)}</div>
            <div className="text-[10px] text-muted-foreground">Receita</div>
          </div>
          <div className="text-center">
            <div className="font-semibold tabular-nums">{fBRL(path.cpa)}</div>
            <div className="text-[10px] text-muted-foreground">CPA</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelStep({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "text-center px-2 py-1 rounded min-w-[50px]",
        highlight ? "bg-emerald-500/10 text-emerald-600" : "bg-muted/50"
      )}
    >
      <div className="font-semibold tabular-nums">{fNum(value)}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: number | null }) {
  return (
    <div className="flex flex-col items-center px-1">
      <span className="text-muted-foreground/40">→</span>
      {rate !== null && (
        <span className={cn("text-[9px] tabular-nums", rate >= 50 ? "text-emerald-600" : rate >= 20 ? "text-amber-600" : "text-muted-foreground")}>
          {fPct(rate)}
        </span>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/50")}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function LegacyDailyTable({ rows }: { rows: DailyRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 text-amber-600 text-[10px] font-semibold">
          Agregado diário (legado)
        </span>
        <span className="text-xs text-muted-foreground">
          Cruzamento diário sem tracking de sessão individual.
        </span>
      </div>
      <div className="overflow-auto max-h-[400px]">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border/50 sticky top-0 bg-card">
            <tr>
              <th className="text-left py-2 pr-3">Dia</th>
              <th className="text-right py-2 pr-3">Gasto</th>
              <th className="text-right py-2 pr-3">Cliques link</th>
              <th className="text-right py-2 pr-3">LP Views</th>
              <th className="text-right py-2 pr-3">Pageviews VSL</th>
              <th className="text-right py-2 pr-3">Checkouts</th>
              <th className="text-right py-2 pr-3">Vendas</th>
              <th className="text-right py-2 pr-3">Custo/play</th>
              <th className="text-right py-2 pr-3">Custo/checkout</th>
              <th className="text-left py-2">Gargalo</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const checkouts = row.checkouts ?? 0;
              const investimento = row.investimento ?? 0;
              const chegaramPitch = row.chegaramPitch ?? row.viewsUnicas ?? 0;
              return (
                <tr key={row.data} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.data}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.investimento)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.cliques)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.landingPageviews)}</td>
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
        <MiniStat label="Play → Checkout" value={fPct(rate(sum(sorted, "checkouts"), sum(sorted, "chegaramPitch")))} />
        <MiniStat label="Checkout → Venda" value={fPct(rate(sum(sorted, "vendasTotais"), sum(sorted, "checkouts")))} />
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
  if ((row.investimento ?? 0) > 0 && (row.landingPageviews ?? 0) === 0) return "Gasto sem LP View.";
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

function createEmptyPath(id: string): PathMetric {
  return {
    id,
    utm_source: null,
    utm_campaign: null,
    utm_content: null,
    ad_name: null,
    player_id: null,
    player_name: null,
    spend: 0,
    clicks: 0,
    views: 0,
    pitch_reached: 0,
    pitch_retention: null,
    checkouts: 0,
    purchases: 0,
    revenue: 0,
    roas: null,
    cpa: null,
    click_to_view: null,
    view_to_pitch: null,
    pitch_to_checkout: null,
    checkout_to_purchase: null,
  };
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractLinkClicks(payload: RawEventPayload): number {
  return (
    actionValueFromUnknown(payload.actions, ["link_click"]) ??
    actionValueFromUnknown(payload.actions, ["omni_link_click"]) ??
    actionValueFromUnknown(payload.outbound_clicks, ["outbound_click", "link_click"]) ??
    toNumber(payload.clicks)
  );
}

function actionValueFromUnknown(value: unknown, actionTypes: string[]): number | null {
  if (Array.isArray(value)) {
    for (const actionType of actionTypes) {
      let found = false;
      let total = 0;
      for (const item of value) {
        const action = item as { action_type?: unknown; value?: unknown };
        if (String(action.action_type ?? "").toLowerCase() !== actionType) continue;
        found = true;
        total += toNumber(action.value);
      }
      if (found) return total;
    }
    return null;
  }

  if (typeof value === "number" || typeof value === "string") {
    return toNumber(value);
  }

  return null;
}

function valueForSort(path: PathMetric, key: SortKey) {
  if (key === "roas") return path.roas ?? -1;
  if (key === "revenue") return path.revenue;
  if (key === "spend") return path.spend;
  if (key === "conversions") return path.purchases;
  return path.roas ?? -1;
}

function labelForSort(key: SortKey) {
  if (key === "roas") return "ROAS";
  if (key === "revenue") return "Receita";
  if (key === "spend") return "Gasto";
  return "Conversões";
}

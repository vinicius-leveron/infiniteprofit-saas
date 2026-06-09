import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Link2,
  Link2Off,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fBRL, fNum, fPct } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  correlateAdFunnel,
  type RawMetaPayload,
  type RawVturbPayload,
  type RawGatewayPayload,
  type CampaignFunnelMetric,
  type AdsetFunnelMetric,
  type AdFunnelMetric,
  type FunnelSortKey,
  sortFunnelItems,
  labelForFunnelSort,
} from "@/lib/adFunnelCorrelation";

interface AdsPanelProps {
  projectId: string | null;
}

type SortKey = FunnelSortKey;
type ViewMode = "hierarchy" | "flat";

export function AdsFunnelView({ projectId }: AdsPanelProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [metaEvents, setMetaEvents] = useState<Array<{ payload: RawMetaPayload | null }>>([]);
  const [vturbEvents, setVturbEvents] = useState<Array<{ payload: RawVturbPayload | null }>>([]);
  const [gatewayEvents, setGatewayEvents] = useState<Array<{ event_type: string; payload: RawGatewayPayload | null }>>([]);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [viewMode, setViewMode] = useState<ViewMode>("hierarchy");
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedAdsets, setExpandedAdsets] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);

    Promise.all([
      // Meta ad insights
      supabase
        .from("raw_events")
        .select("payload")
        .eq("project_id", projectId)
        .eq("source", "meta")
        .eq("event_type", "insight_ad")
        .limit(5000),
      // VTurb traffic by source (para correlacao)
      supabase
        .from("raw_events")
        .select("payload")
        .eq("project_id", projectId)
        .eq("source", "vturb")
        .eq("event_type", "traffic_by_source")
        .limit(5000),
      // Gateway events (para correlacao)
      supabase
        .from("raw_events")
        .select("event_type, payload")
        .eq("project_id", projectId)
        .eq("source", "gateway")
        .in("event_type", ["purchase.approved", "checkout_created"])
        .limit(5000),
    ]).then(([meta, vturb, gateway]) => {
      setMetaEvents((meta.data ?? []) as Array<{ payload: RawMetaPayload | null }>);
      setVturbEvents((vturb.data ?? []) as Array<{ payload: RawVturbPayload | null }>);
      setGatewayEvents((gateway.data ?? []) as Array<{ event_type: string; payload: RawGatewayPayload | null }>);
      setLoading(false);
    });
  }, [projectId]);

  // Correlacionar dados de todas as fontes
  const { ads, campaigns: hierarchy } = useMemo(() => {
    const result = correlateAdFunnel({
      metaEvents,
      vturbEvents,
      gatewayEvents,
    });

    // Ordenar ads
    const sortedAds = sortFunnelItems(result.ads, sortKey);

    // Ordenar hierarquia
    const sortedCampaigns = sortFunnelItems(result.campaigns, sortKey).map((campaign) => ({
      ...campaign,
      adsets: sortFunnelItems(campaign.adsets, sortKey).map((adset) => ({
        ...adset,
        ads: sortFunnelItems(adset.ads, sortKey),
      })),
    }));

    return { ads: sortedAds, campaigns: sortedCampaigns };
  }, [metaEvents, vturbEvents, gatewayEvents, sortKey]);

  const toggleCampaign = (id: string) => {
    setExpandedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAdset = (id: string) => {
    setExpandedAdsets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedCampaigns(new Set(hierarchy.map((c) => c.id)));
    setExpandedAdsets(new Set(hierarchy.flatMap((c) => c.adsets.map((a) => a.id))));
  };

  const collapseAll = () => {
    setExpandedCampaigns(new Set());
    setExpandedAdsets(new Set());
  };

  if (!projectId) {
    return (
      <div className="section-card text-sm text-muted-foreground">
        Salve ou abra um projeto API para ver anúncios.
      </div>
    );
  }

  return (
    <div className="section-card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold">Funil por Anúncio</h2>
          <p className="text-xs text-muted-foreground">
            Campanha → Adset → Ad com funil completo (Meta + VTurb + Gateway).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("hierarchy")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "hierarchy"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent hover:bg-muted"
              )}
            >
              Hierarquia
            </button>
            <button
              type="button"
              onClick={() => setViewMode("flat")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "flat"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent hover:bg-muted"
              )}
            >
              Lista
            </button>
          </div>
          {viewMode === "hierarchy" && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs">
                Expandir
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs">
                Recolher
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {(["spend", "real_roas", "revenue", "purchases", "real_cpa"] as SortKey[]).map((key) => (
              <Button
                key={key}
                type="button"
                variant={sortKey === key ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSortKey(key)}
                className="h-7 gap-1 text-xs"
              >
                <ArrowDownUp className="w-3 h-3" />
                {labelForFunnelSort(key)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : ads.length === 0 ? (
        <div className="rounded-lg border border-border/50 p-8 text-center">
          <Megaphone className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Sem dados de anúncios</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Sincronize a Meta para ver insights por anúncio, campanha e adset.
          </p>
          {projectId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/diagnostics?project=${projectId}`)}
            >
              Ir para Diagnóstico
            </Button>
          )}
        </div>
      ) : viewMode === "flat" ? (
        <FlatTable ads={ads} />
      ) : (
        <HierarchyView
          campaigns={hierarchy}
          expandedCampaigns={expandedCampaigns}
          expandedAdsets={expandedAdsets}
          toggleCampaign={toggleCampaign}
          toggleAdset={toggleAdset}
        />
      )}

      {/* Summary Stats */}
      {ads.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-4 pt-4 border-t border-border/50">
          <SummaryStat
            label="Gasto Total"
            value={fBRL(ads.reduce((sum, a) => sum + a.spend, 0))}
          />
          <SummaryStat
            label="Vendas (Gateway)"
            value={fNum(ads.reduce((sum, a) => sum + a.gateway_purchases, 0))}
          />
          <SummaryStat
            label="Receita (Gateway)"
            value={fBRL(ads.reduce((sum, a) => sum + a.gateway_revenue, 0))}
          />
          <SummaryStat
            label="ROAS Real"
            value={(() => {
              const totalSpend = ads.reduce((sum, a) => sum + a.spend, 0);
              const totalRevenue = ads.reduce((sum, a) => sum + a.gateway_revenue, 0);
              return totalSpend > 0 && totalRevenue > 0 ? `${(totalRevenue / totalSpend).toFixed(2)}x` : "—";
            })()}
          />
          <SummaryStat
            label="CPA Real"
            value={(() => {
              const totalSpend = ads.reduce((sum, a) => sum + a.spend, 0);
              const totalPurchases = ads.reduce((sum, a) => sum + a.gateway_purchases, 0);
              return totalPurchases > 0 ? fBRL(totalSpend / totalPurchases) : "—";
            })()}
          />
          <SummaryStat
            label="Ads Correlacionados"
            value={`${ads.filter((a) => a.has_vturb_data || a.has_gateway_data).length}/${ads.length}`}
          />
        </div>
      )}
    </div>
  );
}

function HierarchyView({
  campaigns,
  expandedCampaigns,
  expandedAdsets,
  toggleCampaign,
  toggleAdset,
}: {
  campaigns: CampaignFunnelMetric[];
  expandedCampaigns: Set<string>;
  expandedAdsets: Set<string>;
  toggleCampaign: (id: string) => void;
  toggleAdset: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {campaigns.map((campaign) => (
        <div key={campaign.id} className="rounded-lg border border-border/50 overflow-hidden">
          {/* Campaign Header */}
          <button
            type="button"
            onClick={() => toggleCampaign(campaign.id)}
            className="w-full flex flex-col gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-3 w-full">
              {expandedCampaigns.has(campaign.id) ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{campaign.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {campaign.adsets.length} conjunto(s) · {campaign.total_ads} anúncio(s)
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <CorrelationBadge adsWithData={campaign.ads_with_data} totalAds={campaign.total_ads} />
                <RoasBadge roas={campaign.real_roas} label="Real" />
              </div>
            </div>
            {/* Funil da Campanha */}
            <div className="flex items-center gap-1 text-[10px] ml-7">
              <FunnelStep label="Cliques" value={campaign.clicks} />
              <FunnelArrow rate={campaign.click_to_view} />
              <FunnelStep label="Views" value={campaign.vturb_views} highlight={campaign.has_vturb_data} />
              <FunnelArrow rate={campaign.view_to_pitch} />
              <FunnelStep label="Pitch" value={campaign.vturb_pitch_reached} highlight={campaign.has_vturb_data} />
              <FunnelArrow rate={campaign.pitch_to_checkout} />
              <FunnelStep label="Chk" value={campaign.gateway_checkouts} highlight={campaign.has_gateway_data} />
              <FunnelArrow rate={campaign.checkout_to_purchase} />
              <FunnelStep label="Vendas" value={campaign.gateway_purchases} highlight={campaign.gateway_purchases > 0} />
              <div className="ml-3 text-xs">
                <span className="text-muted-foreground">{fBRL(campaign.spend)}</span>
                <span className="mx-1">→</span>
                <span className="font-medium text-emerald-600">{fBRL(campaign.gateway_revenue)}</span>
              </div>
            </div>
          </button>

          {/* Adsets */}
          {expandedCampaigns.has(campaign.id) && (
            <div className="border-t border-border/30">
              {campaign.adsets.map((adset) => (
                <div key={adset.id}>
                  {/* Adset Header */}
                  <button
                    type="button"
                    onClick={() => toggleAdset(adset.id)}
                    className="w-full flex flex-col gap-2 px-4 py-2.5 pl-8 bg-background hover:bg-muted/30 transition-colors text-left border-b border-border/20"
                  >
                    <div className="flex items-center gap-3 w-full">
                      {expandedAdsets.has(adset.id) ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{adset.name}</div>
                        <div className="text-[10px] text-muted-foreground">{adset.ads.length} anúncio(s)</div>
                      </div>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <CorrelationBadge adsWithData={adset.ads_with_data} totalAds={adset.total_ads} size="sm" />
                        <RoasBadge roas={adset.real_roas} size="sm" />
                      </div>
                    </div>
                    {/* Funil do Adset */}
                    <div className="flex items-center gap-1 text-[10px] ml-5">
                      <FunnelStep label="Cliques" value={adset.clicks} size="sm" />
                      <FunnelArrow rate={adset.click_to_view} />
                      <FunnelStep label="Views" value={adset.vturb_views} highlight={adset.has_vturb_data} size="sm" />
                      <FunnelArrow rate={adset.view_to_pitch} />
                      <FunnelStep label="Pitch" value={adset.vturb_pitch_reached} highlight={adset.has_vturb_data} size="sm" />
                      <FunnelArrow rate={adset.pitch_to_checkout} />
                      <FunnelStep label="Chk" value={adset.gateway_checkouts} highlight={adset.has_gateway_data} size="sm" />
                      <FunnelArrow rate={adset.checkout_to_purchase} />
                      <FunnelStep label="Vendas" value={adset.gateway_purchases} highlight={adset.gateway_purchases > 0} size="sm" />
                      <div className="ml-2 text-xs">
                        <span className="text-muted-foreground">{fBRL(adset.spend)}</span>
                        <span className="mx-1">→</span>
                        <span className="font-medium text-emerald-600">{fBRL(adset.gateway_revenue)}</span>
                      </div>
                    </div>
                  </button>

                  {/* Ads */}
                  {expandedAdsets.has(adset.id) && (
                    <div className="bg-muted/10">
                      {adset.ads.map((ad) => (
                        <div
                          key={ad.id}
                          className="flex flex-col gap-2 px-4 py-3 pl-14 border-b border-border/10 last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">{ad.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{ad.id}</div>
                            </div>
                            <CorrelationBadge status={ad.correlation_status} size="sm" />
                            <RoasBadge roas={ad.real_roas} size="sm" />
                          </div>

                          {/* Funil Completo do Ad */}
                          <div className="flex items-center gap-1 text-[10px]">
                            <FunnelStep label="Cliques" value={ad.clicks} size="sm" />
                            <FunnelArrow rate={ad.click_to_view} />
                            <FunnelStep label="Views" value={ad.vturb_views} highlight={ad.has_vturb_data} size="sm" />
                            <FunnelArrow rate={ad.view_to_pitch} />
                            <FunnelStep label="Pitch" value={ad.vturb_pitch_reached} highlight={ad.has_vturb_data} size="sm" />
                            <FunnelArrow rate={ad.pitch_to_checkout} />
                            <FunnelStep label="Chk" value={ad.gateway_checkouts} highlight={ad.has_gateway_data} size="sm" />
                            <FunnelArrow rate={ad.checkout_to_purchase} />
                            <FunnelStep label="Vendas" value={ad.gateway_purchases} highlight={ad.gateway_purchases > 0} size="sm" />
                            <div className="ml-2 text-xs">
                              <span className="text-muted-foreground">{fBRL(ad.spend)}</span>
                              <span className="mx-1">→</span>
                              <span className="font-medium text-emerald-600">{fBRL(ad.gateway_revenue)}</span>
                              {ad.real_cpa && (
                                <span className="ml-2 text-muted-foreground">CPA {fBRL(ad.real_cpa)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FlatTable({ ads }: { ads: AdFunnelMetric[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border/50">
          <tr>
            <th className="text-left py-2 pr-3">Anúncio</th>
            <th className="text-left py-2 pr-3">Campanha</th>
            <th className="text-right py-2 pr-3">Gasto</th>
            <th className="text-right py-2 pr-3">Cliques</th>
            <th className="text-right py-2 pr-3">Views</th>
            <th className="text-right py-2 pr-3">Pitch</th>
            <th className="text-right py-2 pr-3">Chk</th>
            <th className="text-right py-2 pr-3">Vendas</th>
            <th className="text-right py-2 pr-3">Receita</th>
            <th className="text-right py-2 pr-3">CPA</th>
            <th className="text-right py-2 pr-3">ROAS</th>
            <th className="text-center py-2">Corr.</th>
          </tr>
        </thead>
        <tbody>
          {ads.map((row) => (
            <tr key={row.id} className="border-b border-border/30 last:border-0">
              <td className="py-2 pr-3 min-w-[200px]">
                <div className="font-medium truncate max-w-[200px]">{row.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{row.id}</div>
              </td>
              <td className="py-2 pr-3 min-w-[150px]">
                <div className="truncate max-w-[150px]">{row.campaign_name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{row.adset_name}</div>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.spend)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.clicks)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.vturb_views)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.vturb_pitch_reached)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.gateway_checkouts)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.gateway_purchases)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.gateway_revenue)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.real_cpa)}</td>
              <td className="py-2 pr-3 text-right">
                <RoasBadge roas={row.real_roas} size="sm" />
              </td>
              <td className="py-2 text-center">
                <CorrelationBadge status={row.correlation_status} size="sm" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  highlight,
  size = "md",
}: {
  label: string;
  value: number;
  highlight?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "text-center rounded",
        size === "sm" ? "px-1 py-0.5" : "px-1.5 py-0.5",
        highlight && "bg-emerald-500/10 text-emerald-600"
      )}
    >
      <div className={cn("font-semibold tabular-nums", size === "sm" ? "text-[10px]" : "text-xs")}>
        {fNum(value)}
      </div>
      <div className={cn("opacity-70", size === "sm" ? "text-[8px]" : "text-[9px]")}>{label}</div>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: number | null }) {
  return (
    <div className="flex flex-col items-center px-0.5">
      <span className="text-muted-foreground/40 text-[10px]">→</span>
      {rate !== null && (
        <span
          className={cn(
            "text-[8px] tabular-nums",
            rate >= 50 ? "text-emerald-600" : rate >= 20 ? "text-amber-600" : "text-muted-foreground"
          )}
        >
          {fPct(rate)}
        </span>
      )}
    </div>
  );
}

function CorrelationBadge({
  status,
  adsWithData,
  totalAds,
  size = "md",
}: {
  status?: "full" | "partial" | "none";
  adsWithData?: number;
  totalAds?: number;
  size?: "sm" | "md";
}) {
  // Se temos adsWithData e totalAds, calculamos a porcentagem
  if (adsWithData !== undefined && totalAds !== undefined && totalAds > 0) {
    const pct = Math.round((adsWithData / totalAds) * 100);
    const isFull = pct === 100;
    const isPartial = pct > 0 && pct < 100;

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium",
          size === "sm" ? "text-[9px]" : "text-[10px]",
          isFull && "bg-emerald-500/10 text-emerald-600",
          isPartial && "bg-amber-500/10 text-amber-600",
          !isFull && !isPartial && "bg-muted text-muted-foreground"
        )}
      >
        {isFull ? <Link2 className="w-2.5 h-2.5" /> : <Link2Off className="w-2.5 h-2.5" />}
        {pct}%
      </span>
    );
  }

  // Caso contrário, usamos o status diretamente
  const finalStatus = status ?? "none";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium",
        size === "sm" ? "text-[9px]" : "text-[10px]",
        finalStatus === "full" && "bg-emerald-500/10 text-emerald-600",
        finalStatus === "partial" && "bg-amber-500/10 text-amber-600",
        finalStatus === "none" && "bg-muted text-muted-foreground"
      )}
    >
      {finalStatus === "full" ? (
        <Link2 className="w-2.5 h-2.5" />
      ) : (
        <Link2Off className="w-2.5 h-2.5" />
      )}
      {finalStatus === "full" ? "OK" : finalStatus === "partial" ? "Parcial" : "—"}
    </span>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RoasBadge({
  roas,
  size = "md",
  label,
}: {
  roas: number | null;
  size?: "sm" | "md";
  label?: string;
}) {
  if (roas === null || roas === 0) {
    return (
      <span className={cn("text-muted-foreground", size === "sm" ? "text-[10px]" : "text-xs")}>
        — {label ?? "ROAS"}
      </span>
    );
  }

  const isGood = roas >= 2;
  const isBad = roas < 1;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium tabular-nums",
        size === "sm" ? "text-[10px]" : "text-xs",
        isGood && "bg-emerald-500/10 text-emerald-600",
        isBad && "bg-red-500/10 text-red-500",
        !isGood && !isBad && "bg-amber-500/10 text-amber-600"
      )}
    >
      {isGood ? (
        <TrendingUp className={cn(size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />
      ) : isBad ? (
        <TrendingDown className={cn(size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />
      ) : null}
      {roas.toFixed(2)}x{label ? ` ${label}` : ""}
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

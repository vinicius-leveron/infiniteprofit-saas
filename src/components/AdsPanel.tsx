import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownUp, Loader2, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fBRL, fNum, fPct } from "@/lib/metrics";
import { Button } from "@/components/ui/button";

interface AdsPanelProps {
  projectId: string | null;
}

interface RawAdEvent {
  payload: {
    campaign_id?: string;
    campaign_name?: string;
    adset_id?: string;
    adset_name?: string;
    ad_id?: string;
    ad_name?: string;
    spend?: string | number;
    impressions?: string | number;
    clicks?: string | number;
  } | null;
}

type SortKey = "spend" | "clicks" | "cpc" | "ctr";

interface AdMetric {
  id: string;
  name: string;
  campaign: string;
  adset: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number | null;
  ctr: number | null;
}

export function AdsPanel({ projectId }: AdsPanelProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<RawAdEvent[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("spend");

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    void supabase
      .from("raw_events")
      .select("payload")
      .eq("project_id", projectId)
      .eq("source", "meta")
      .eq("event_type", "insight_ad")
      .limit(5000)
      .then(({ data }) => {
        setEvents((data ?? []) as RawAdEvent[]);
        setLoading(false);
      });
  }, [projectId]);

  const rows = useMemo(() => {
    const map = new Map<string, AdMetric>();
    for (const event of events) {
      const payload = event.payload ?? {};
      const id = String(payload.ad_id ?? "sem-ad");
      const current = map.get(id) ?? {
        id,
        name: String(payload.ad_name ?? id),
        campaign: String(payload.campaign_name ?? payload.campaign_id ?? "—"),
        adset: String(payload.adset_name ?? payload.adset_id ?? "—"),
        spend: 0,
        impressions: 0,
        clicks: 0,
        cpc: null,
        ctr: null,
      };
      current.spend += toNumber(payload.spend);
      current.impressions += toNumber(payload.impressions);
      current.clicks += toNumber(payload.clicks);
      current.cpc = current.clicks ? current.spend / current.clicks : null;
      current.ctr = current.impressions ? (current.clicks / current.impressions) * 100 : null;
      map.set(id, current);
    }
    return [...map.values()].sort((a, b) => valueForSort(b, sortKey) - valueForSort(a, sortKey));
  }, [events, sortKey]);

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
          <h2 className="text-base font-semibold">Anúncios Meta</h2>
          <p className="text-xs text-muted-foreground">Ranking por anúncio a partir de raw_events `insight_ad`.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["spend", "clicks", "cpc", "ctr"] as SortKey[]).map((key) => (
            <Button
              key={key}
              type="button"
              variant={sortKey === key ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSortKey(key)}
              className="h-8 gap-1.5"
            >
              <ArrowDownUp className="w-3.5 h-3.5" />
              {labelForSort(key)}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border/50 p-8 text-center">
          <Megaphone className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-1">Sem dados de anuncios</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Sincronize a Meta para ver insights por anuncio, campanha e adset.
          </p>
          {projectId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/diagnostics?project=${projectId}`)}
            >
              Ir para Diagnostico
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border/50">
              <tr>
                <th className="text-left py-2 pr-3">Anúncio</th>
                <th className="text-left py-2 pr-3">Campanha</th>
                <th className="text-right py-2 pr-3">Gasto</th>
                <th className="text-right py-2 pr-3">Impressões</th>
                <th className="text-right py-2 pr-3">Cliques</th>
                <th className="text-right py-2 pr-3">CPC</th>
                <th className="text-right py-2">CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-3 min-w-[220px]">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{row.id}</div>
                  </td>
                  <td className="py-2 pr-3 min-w-[220px]">
                    <div>{row.campaign}</div>
                    <div className="text-[10px] text-muted-foreground">{row.adset}</div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.spend)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.impressions)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fNum(row.clicks)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fBRL(row.cpc)}</td>
                  <td className="py-2 text-right tabular-nums">{fPct(row.ctr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function valueForSort(row: AdMetric, key: SortKey) {
  return row[key] ?? -1;
}

function labelForSort(key: SortKey) {
  if (key === "spend") return "Gasto";
  if (key === "clicks") return "Cliques";
  if (key === "cpc") return "CPC";
  return "CTR";
}

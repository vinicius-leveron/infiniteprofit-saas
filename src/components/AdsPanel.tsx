import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Eye,
  ExternalLink,
  Filter,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Target,
  TrendingUp,
  Trash2,
  Wand2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fBRL, fNum, fPct } from "@/lib/metrics";
import {
  FIXED_CREATIVE_GROUPS,
  applyCreativeFilters,
  buildCreativeAssetCards,
  groupCreativeCards,
  labelForMediaType,
  parseCreativeGroupRules,
  resolveSortKey,
  sortCreativeCards,
  type CreativeAnalysisCoverage,
  type CreativeAssetAdRow,
  type CreativeAssetAnalysisRow,
  type CreativeAssetCard,
  type CreativeAssetJobRow,
  type CreativeAssetMetricRow,
  type CreativeAssetRow,
  type CreativeGroupBy,
  type CreativeGroupRow,
  type CreativeGroupRules,
  type CreativeMediaType,
  type CreativePipelineStatus,
  type CreativeSortKey,
  type CreativeTranscriptStatus,
  type FixedCreativeGroupKey,
} from "@/lib/creativeAssets";
import {
  applyCreativeAssetSignedUrls,
  type CreativeAssetSignedUrl,
} from "@/lib/creativeAssetSignedUrls";
import { AdsFunnelView } from "@/components/ads/AdsFunnelView";
import { AdsPathsView } from "@/components/ads/AdsPathsView";
import { useAuth } from "@/hooks/useAuth";
import { type RawVturbPayload } from "@/lib/adFunnelCorrelation";

interface AdsPanelProps {
  projectId: string | null;
  dateRange?: {
    from: string | null;
    to: string | null;
  };
}

type CardsViewMode = "cards" | "funnel" | "paths";
type CreativeActivityFilter = "active" | "all";

type SyncRunRow = {
  source: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error_message: string | null;
  created_at: string;
};

type CreativeVturbMetrics = {
  playRate: number | null;
  pitchRetention: number | null;
};

type GroupFormState = {
  name: string;
  mediaType: CreativeMediaType | "all";
  pipelineStatus: CreativePipelineStatus | "all";
  campaignQuery: string;
  adsetQuery: string;
  minHookRate: string;
  minRoas: string;
  minCtr: string;
  maxCpm: string;
  minSpend: string;
  sortKey: CreativeSortKey;
};

const EMPTY_GROUP_FORM: GroupFormState = {
  name: "",
  mediaType: "all",
  pipelineStatus: "all",
  campaignQuery: "",
  adsetQuery: "",
  minHookRate: "",
  minRoas: "",
  minCtr: "",
  maxCpm: "",
  minSpend: "",
  sortKey: "purchases",
};

interface CreativeAssetSignedUrlResponse {
  ok?: boolean;
  error?: string;
  assets?: CreativeAssetSignedUrl[];
}

async function loadSignedCreativeAssetUrls(projectId: string, assets: CreativeAssetRow[]) {
  const assetIds = assets
    .filter((asset) => asset.media_storage_path || asset.poster_storage_path)
    .map((asset) => asset.id);

  if (assetIds.length === 0) return assets;

  try {
    const { data, error } = await supabase.functions.invoke("creative-asset-urls", {
      body: {
        project_id: projectId,
        asset_ids: assetIds,
      },
    });
    if (error) throw error;

    const response = data as CreativeAssetSignedUrlResponse | null;
    if (response?.error) throw new Error(response.error);

    return applyCreativeAssetSignedUrls(assets, response?.assets ?? []);
  } catch (error) {
    console.warn("Failed to load signed creative asset URLs", error);
    return assets;
  }
}

export function AdsPanel({ projectId, dateRange }: AdsPanelProps) {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<CardsViewMode>("cards");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [assets, setAssets] = useState<CreativeAssetRow[]>([]);
  const [assetAds, setAssetAds] = useState<CreativeAssetAdRow[]>([]);
  const [metrics, setMetrics] = useState<CreativeAssetMetricRow[]>([]);
  const [analyses, setAnalyses] = useState<CreativeAssetAnalysisRow[]>([]);
  const [jobs, setJobs] = useState<CreativeAssetJobRow[]>([]);
  const [groups, setGroups] = useState<CreativeGroupRow[]>([]);
  const [latestSyncRun, setLatestSyncRun] = useState<SyncRunRow | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [vturbEvents, setVturbEvents] = useState<Array<{ payload: RawVturbPayload | null }>>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<CreativeSortKey>("purchases");
  const [groupBy, setGroupBy] = useState<CreativeGroupBy>("none");
  const [mediaFilter, setMediaFilter] = useState<CreativeMediaType | "all">("all");
  const [pipelineFilter, setPipelineFilter] = useState<CreativePipelineStatus | "all">("all");
  const [activityFilter, setActivityFilter] = useState<CreativeActivityFilter>("active");
  const [activeFixedGroup, setActiveFixedGroup] = useState<FixedCreativeGroupKey>("all");
  const [activeCustomGroupId, setActiveCustomGroupId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [analyzingAssetId, setAnalyzingAssetId] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<CreativeGroupRow | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      let metricsQuery = supabase
        .from("creative_asset_daily_metrics" as never)
        .select("asset_id, event_date, spend, impressions, clicks, outbound_clicks, ctr, link_ctr, cpm, purchases, revenue, refunds, refund_value, refund_rate, order_bump_purchases, order_bump_revenue, upsell_purchases, upsell_revenue, roas, cpa, hook_rate, has_meta_data, has_gateway_data")
        .eq("project_id", projectId);

      if (dateRange?.from) metricsQuery = metricsQuery.gte("event_date", dateRange.from);
      if (dateRange?.to) metricsQuery = metricsQuery.lte("event_date", dateRange.to);

      let vturbEventQuery = supabase
        .from("raw_events")
        .select("payload")
        .eq("project_id", projectId)
        .eq("source", "vturb")
        .eq("event_type", "traffic_by_source");
      if (dateRange?.from) {
        vturbEventQuery = vturbEventQuery.gte("event_date", dateRange.from);
      }
      if (dateRange?.to) {
        vturbEventQuery = vturbEventQuery.lte("event_date", dateRange.to);
      }

      const [
        { data: projectRow },
        { data: assetRows },
        { data: adRows },
        { data: metricRows },
        { data: analysisRows },
        { data: jobRows },
        { data: groupRows },
        { data: syncRows },
        { data: vturbEventRows },
      ] = await Promise.all([
        supabase
          .from("projects")
          .select("workspace_id")
          .eq("id", projectId)
          .maybeSingle(),
        supabase
          .from("creative_assets" as never)
          .select("id, creative_id, asset_key, media_type, thumbnail_url, media_storage_path, headline, primary_text, cta, landing_url, post_url, facebook_post_url, instagram_post_url, analysis_status, last_meta_synced_at, source_media_url, source_fetched_at, media_bytes, media_duration_ms, media_fingerprint, poster_storage_path, last_processed_at, processing_version")
          .eq("project_id", projectId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("creative_asset_ads" as never)
          .select("asset_id, ad_id, ad_created_time, ad_name, adset_id, adset_name, campaign_id, campaign_name")
          .eq("project_id", projectId),
        metricsQuery,
        supabase
          .from("creative_asset_analysis" as never)
          .select("asset_id, status, transcript_status, transcript, transcript_segments, transcript_language, transcript_provider, transcript_model, transcript_error_message, summary, hook, hook_timestamps, angle, copy, cta, visual, visual_evidence, tags, scores, analysis_coverage, analysis_error_message, error_message, processed_at")
          .eq("project_id", projectId),
        supabase
          .from("creative_asset_jobs" as never)
          .select("asset_id, status")
          .eq("project_id", projectId)
          .in("status", ["queued", "running"]),
        supabase
          .from("creative_groups" as never)
          .select("id, name, rules, sort_key")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true }),
        supabase
          .from("sync_runs")
          .select("source, status, error_message, created_at")
          .eq("project_id", projectId)
          .eq("source", "creative")
          .order("created_at", { ascending: false })
          .limit(1),
        vturbEventQuery.limit(5000),
      ]);

      const loadedAssets = (assetRows ?? []) as unknown as CreativeAssetRow[];
      const assetsWithSignedUrls = await loadSignedCreativeAssetUrls(projectId, loadedAssets);

      setWorkspaceId((projectRow as { workspace_id?: string } | null)?.workspace_id ?? null);
      setAssets(assetsWithSignedUrls);
      setAssetAds((adRows ?? []) as unknown as CreativeAssetAdRow[]);
      setMetrics((metricRows ?? []) as unknown as CreativeAssetMetricRow[]);
      setAnalyses((analysisRows ?? []) as unknown as CreativeAssetAnalysisRow[]);
      setJobs((jobRows ?? []) as unknown as CreativeAssetJobRow[]);
      setGroups((groupRows ?? []) as unknown as CreativeGroupRow[]);
      setLatestSyncRun(((syncRows ?? [])[0] as SyncRunRow | undefined) ?? null);
      setVturbEvents((vturbEventRows ?? []) as Array<{ payload: RawVturbPayload | null }>);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar criativos");
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to, projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load();
  }, [load, projectId]);

  async function syncCreatives() {
    if (!projectId) return;
    setSyncing(true);
    try {
      const [creativeResponse, vturbResponse] = await Promise.all([
        supabase.functions.invoke("creative-sync", {
          body: {
            project_id: projectId,
            days: 30,
            enqueue_analysis: false,
          },
        }),
        supabase.functions.invoke("vturb-pull", {
          body: {
            project_id: projectId,
            days: 30,
          },
        }),
      ]);
      if (creativeResponse.error) throw creativeResponse.error;
      if ((creativeResponse.data as { error?: string } | null)?.error) {
        throw new Error((creativeResponse.data as { error: string }).error);
      }
      if (vturbResponse.error) throw vturbResponse.error;
      if ((vturbResponse.data as { error?: string } | null)?.error) {
        throw new Error((vturbResponse.data as { error: string }).error);
      }
      toast.success("Criativos sincronizados");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar criativos");
    } finally {
      setSyncing(false);
    }
  }

  async function analyzeCreative(card: CreativeAssetCard) {
    if (!projectId) return;
    setAnalyzingAssetId(card.id);
    try {
      const reprocessScope =
        card.mediaType === "video" && card.transcriptStatus !== "ready"
          ? "transcript"
          : "analysis";
      const { data, error } = await supabase.functions.invoke("creative-sync", {
        body: {
          project_id: projectId,
          asset_id: card.id,
          reprocess: true,
          reprocess_scope: reprocessScope,
          enqueue_analysis: true,
        },
      });
      if (error) throw error;
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error);
      }
      toast.success(
        reprocessScope === "transcript"
          ? "Transcrição e análise enfileiradas"
          : "Análise enfileirada",
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enfileirar análise");
    } finally {
      setAnalyzingAssetId(null);
    }
  }

  async function saveGroup() {
    if (!projectId || (!editingGroupId && (!workspaceId || !user?.id))) {
      toast.error("Contexto do projeto indisponível para salvar o grupo");
      return;
    }

    if (!groupForm.name.trim()) {
      toast.error("Dê um nome para o grupo");
      return;
    }

    const rules = buildGroupRulesFromForm(groupForm);
    try {
      if (editingGroupId) {
        const { data, error } = await supabase
          .from("creative_groups" as never)
          .update({
            name: groupForm.name.trim(),
            rules,
            sort_key: groupForm.sortKey,
          })
          .eq("id", editingGroupId)
          .eq("project_id", projectId)
          .select("id, name, rules, sort_key")
          .single();
        if (error) throw error;
        const updated = data as unknown as CreativeGroupRow;
        setGroups((current) => current.map((group) => group.id === updated.id ? updated : group));
        closeGroupDialog();
        toast.success("Grupo atualizado");
        return;
      }

      const { data, error } = await supabase
        .from("creative_groups" as never)
        .insert({
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: user.id,
          name: groupForm.name.trim(),
          rules,
          sort_key: groupForm.sortKey,
          visibility: "private",
        })
        .select("id, name, rules, sort_key")
        .single();
      if (error) throw error;
      const nextRow = data as unknown as CreativeGroupRow;
      setGroups((current) => [...current, nextRow]);
      setActiveCustomGroupId(nextRow.id);
      setActiveFixedGroup("all");
      closeGroupDialog();
      toast.success("Grupo salvo");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar grupo");
    }
  }

  function openCreateGroupDialog() {
    setEditingGroupId(null);
    setGroupForm(EMPTY_GROUP_FORM);
    setGroupDialogOpen(true);
  }

  function openEditGroupDialog(group: CreativeGroupRow) {
    setEditingGroupId(group.id);
    setGroupForm(groupFormFromRow(group));
    setGroupDialogOpen(true);
  }

  function closeGroupDialog() {
    setGroupDialogOpen(false);
    setEditingGroupId(null);
    setGroupForm(EMPTY_GROUP_FORM);
  }

  async function deleteGroup() {
    if (!projectId || !groupToDelete) return;
    const target = groupToDelete;
    try {
      const { error } = await supabase
        .from("creative_groups" as never)
        .delete()
        .eq("id", target.id)
        .eq("project_id", projectId);
      if (error) throw error;
      setGroups((current) => current.filter((group) => group.id !== target.id));
      if (activeCustomGroupId === target.id) {
        setActiveCustomGroupId(null);
        setActiveFixedGroup("all");
      }
      setGroupToDelete(null);
      toast.success("Grupo removido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao remover grupo");
    }
  }

  const cards = useMemo(
    () => buildCreativeAssetCards({ assets, ads: assetAds, metrics, analyses, jobs }),
    [assets, assetAds, metrics, analyses, jobs],
  );

  const activeCustomGroup = useMemo(
    () => groups.find((group) => group.id === activeCustomGroupId) ?? null,
    [groups, activeCustomGroupId],
  );

  const composedRules = useMemo(() => {
    const customRules = activeCustomGroup ? parseCreativeGroupRules(activeCustomGroup.rules) : {};
    const manualRules: CreativeGroupRules = {
      mediaType: mediaFilter,
      pipelineStatus: pipelineFilter,
    };
    return {
      ...customRules,
      ...(manualRules.mediaType && manualRules.mediaType !== "all" ? { mediaType: manualRules.mediaType } : {}),
      ...(manualRules.pipelineStatus && manualRules.pipelineStatus !== "all" ? { pipelineStatus: manualRules.pipelineStatus } : {}),
    };
  }, [activeCustomGroup, mediaFilter, pipelineFilter]);

  const filteredCards = useMemo(() => {
    const base = applyCreativeFilters(cards, { search, rules: composedRules });
    const activityScoped = activityFilter === "active"
      ? base.filter((card) => card.spend > 0 || card.purchases > 0 || card.impressions > 0)
      : base;
    if (activeFixedGroup === "best-hooks") {
      return activityScoped.filter((card) => (card.hookRate ?? 0) > 0);
    }
    if (activeFixedGroup === "best-roas") {
      return activityScoped.filter((card) => (card.roas ?? 0) > 0);
    }
    return activityScoped;
  }, [activeFixedGroup, activityFilter, cards, composedRules, search]);

  const effectiveSortKey = useMemo(
    () => resolveSortKey(activeFixedGroup, sortKey, activeCustomGroup?.sort_key ?? null),
    [activeCustomGroup?.sort_key, activeFixedGroup, sortKey],
  );

  const sortedCards = useMemo(
    () => sortCreativeCards(filteredCards, effectiveSortKey),
    [effectiveSortKey, filteredCards],
  );

  const groupedCards = useMemo(
    () => groupCreativeCards(sortedCards, groupBy),
    [groupBy, sortedCards],
  );

  const vturbMetricsByAsset = useMemo(
    () => buildCreativeVturbMetrics(cards, vturbEvents),
    [cards, vturbEvents],
  );

  const metricScale = useMemo(() => {
    const values = {
      ctr: Math.max(...sortedCards.map((card) => card.ctr ?? 0), 1),
      cpm: Math.max(...sortedCards.map((card) => card.cpm ?? 0), 1),
      playRate: Math.max(...sortedCards.map((card) => vturbMetricsByAsset.get(card.id)?.playRate ?? 0), 1),
      pitchRetention: Math.max(...sortedCards.map((card) => vturbMetricsByAsset.get(card.id)?.pitchRetention ?? 0), 1),
      hookRate: Math.max(...sortedCards.map((card) => card.hookRate ?? 0), 1),
      aov: Math.max(...sortedCards.map((card) => card.aov ?? 0), 1),
    };
    return values;
  }, [sortedCards, vturbMetricsByAsset]);

  if (!projectId) {
    return (
      <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-card/80 to-card/40 p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-4">
          <Layers className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Salve ou abra um projeto API para ver anúncios.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Principal */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Galeria de Criativos</h2>
          <p className="text-sm text-muted-foreground">
            {sortedCards.length > 0
              ? `${sortedCards.length} criativo${sortedCards.length > 1 ? "s" : ""} • análise, métricas e performance`
              : "Visual por asset criativo com análise e métricas"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Toggle Cards/Funil/Caminhos */}
          <div className="flex rounded-xl border border-border/60 bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all",
                viewMode === "cards"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode("funnel")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all",
                viewMode === "funnel"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Funil
            </button>
            <button
              type="button"
              onClick={() => setViewMode("paths")}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all",
                viewMode === "paths"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Target className="w-3.5 h-3.5" />
              Caminhos
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={syncCreatives}
            disabled={syncing}
            className="gap-2 rounded-xl border-border/60 bg-muted/20 hover:bg-muted/40"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Sincronizar</span>
          </Button>
        </div>
      </header>

      {/* Sync Status Banner */}
      {latestSyncRun && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            latestSyncRun.status === "failed" && "border-red-500/20 bg-red-500/5 text-red-200",
            latestSyncRun.status === "running" && "border-amber-500/20 bg-amber-500/5 text-amber-200",
            latestSyncRun.status === "succeeded" && "border-emerald-500/20 bg-emerald-500/5 text-emerald-200",
          )}
        >
          {latestSyncRun.status === "running" && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {latestSyncRun.status === "failed" && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {latestSyncRun.status === "succeeded" && <Sparkles className="w-4 h-4 shrink-0" />}
          <span className="flex-1">
            {latestSyncRun.status === "running"
              ? "Sincronização em andamento..."
              : latestSyncRun.status === "failed"
                ? latestSyncRun.error_message ?? "Sincronização falhou"
                : "Fila de criativos atualizada"}
          </span>
          <span className="text-xs opacity-70">
            {formatDistanceToNow(new Date(latestSyncRun.created_at), { addSuffix: true, locale: ptBR })}
          </span>
        </div>
      )}

      {viewMode === "funnel" ? (
        <AdsFunnelView projectId={projectId} dateRange={dateRange} />
      ) : viewMode === "paths" ? (
        <AdsPathsView projectId={projectId} dateRange={dateRange} />
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl animate-pulse" />
            <Loader2 className="relative w-8 h-8 animate-spin text-violet-400" />
          </div>
          <p className="text-sm text-muted-foreground">Carregando criativos...</p>
        </div>
      ) : (
        <>
          {/* Grupos de Criativos */}
          <div className="flex flex-wrap items-center gap-2">
            {FIXED_CREATIVE_GROUPS.map((group) => {
              const isActive = activeFixedGroup === group.key && !activeCustomGroupId;
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => {
                    setActiveFixedGroup(group.key);
                    setActiveCustomGroupId(null);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition-all",
                    isActive
                      ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {group.key === "best-hooks" && <Zap className="w-3.5 h-3.5" />}
                  {group.key === "best-roas" && <TrendingUp className="w-3.5 h-3.5" />}
                  {group.label}
                </button>
              );
            })}
            <div className="h-5 w-px bg-border/50 mx-1" />
            {groups.map((group) => {
              const isActive = activeCustomGroupId === group.id;
              return (
                <div
                  key={group.id}
                  className={cn(
                    "group/saved inline-flex items-center overflow-hidden rounded-xl text-xs font-medium transition-all",
                    isActive
                      ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCustomGroupId(group.id);
                      setActiveFixedGroup("all");
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2"
                  >
                    <Tag className="w-3 h-3" />
                    {group.name}
                  </button>
                  <span className="mr-1 flex items-center border-l border-current/10 pl-1">
                    <button
                      type="button"
                      onClick={() => openEditGroupDialog(group)}
                      className="rounded-md p-1.5 opacity-65 transition hover:bg-background/30 hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Editar grupo ${group.name}`}
                      title="Editar grupo"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupToDelete(group)}
                      className="rounded-md p-1.5 opacity-65 transition hover:bg-red-500/15 hover:text-red-300 hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remover grupo ${group.name}`}
                      title="Remover grupo"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              );
            })}
            <button
              type="button"
              onClick={openCreateGroupDialog}
              className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-border hover:bg-muted/30 hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo grupo
            </button>
          </div>

          {/* Toolbar de Filtros */}
          <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-muted/30 to-muted/10 p-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
              {/* Search */}
              <div className="relative lg:col-span-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar criativos..."
                  className="pl-10 h-10 rounded-xl border-border/50 bg-background/60 placeholder:text-muted-foreground/60"
                />
              </div>
              {/* Selects */}
              <ToolbarSelect
                icon={<Settings2 className="w-3.5 h-3.5" />}
                label="Ordenar"
                value={sortKey}
                onValueChange={(value) => setSortKey(value as CreativeSortKey)}
                options={[
                  { value: "purchases", label: "Vendas" },
                  { value: "roas", label: "ROAS" },
                  { value: "hook_rate", label: "Hook Rate" },
                  { value: "ctr", label: "CTR" },
                  { value: "cpm", label: "CPM" },
                  { value: "spend", label: "Gasto" },
                ]}
              />
              <ToolbarSelect
                icon={<Activity className="w-3.5 h-3.5" />}
                label="Atividade"
                value={activityFilter}
                onValueChange={(value) => setActivityFilter(value as CreativeActivityFilter)}
                options={[
                  { value: "active", label: "Ativos no período" },
                  { value: "all", label: "Todos" },
                ]}
              />
              <ToolbarSelect
                icon={<Layers className="w-3.5 h-3.5" />}
                label="Agrupar"
                value={groupBy}
                onValueChange={(value) => setGroupBy(value as CreativeGroupBy)}
                options={[
                  { value: "none", label: "Sem agrupar" },
                  { value: "campaign", label: "Campanha" },
                  { value: "adset", label: "Adset" },
                  { value: "media_type", label: "Tipo" },
                ]}
              />
              <ToolbarSelect
                icon={<Play className="w-3.5 h-3.5" />}
                label="Mídia"
                value={mediaFilter}
                onValueChange={(value) => setMediaFilter(value as CreativeMediaType | "all")}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "video", label: "Vídeo" },
                  { value: "image", label: "Imagem" },
                  { value: "unknown", label: "Sem mídia" },
                ]}
              />
              <ToolbarSelect
                icon={<Sparkles className="w-3.5 h-3.5" />}
                label="Pipeline"
                value={pipelineFilter}
                onValueChange={(value) => setPipelineFilter(value as CreativePipelineStatus | "all")}
                options={[
                  { value: "all", label: "Todos" },
                  { value: "ready", label: "Pronto" },
                  { value: "transcribing", label: "Transcrevendo" },
                  { value: "analyzing", label: "Analisando" },
                  { value: "pending", label: "Pendente" },
                  { value: "missing_transcript", label: "Sem transcript" },
                  { value: "oversized_queued", label: "Vídeo grande em fila" },
                  { value: "failed", label: "Falhou" },
                  { value: "missing_media", label: "Sem mídia" },
                ]}
              />
            </div>
          </div>

          {/* Grid de Cards */}
          {sortedCards.length === 0 ? (
            <EmptyCardsState
              latestSyncRun={latestSyncRun}
              onRetry={syncCreatives}
              syncing={syncing}
            />
          ) : (
            <div className="space-y-8">
              {groupedCards.map((group) => (
                <section key={group.key} className="space-y-4">
                  {groupBy !== "none" && (
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-gradient-to-r from-border/60 to-transparent" />
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Layers className="w-4 h-4 text-muted-foreground" />
                        {group.label}
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                          {group.cards.length}
                        </span>
                      </div>
                      <div className="h-px flex-1 bg-gradient-to-l from-border/60 to-transparent" />
                    </div>
                  )}
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {group.cards.map((card) => (
                      <CreativeCard
                        key={card.id}
                        card={card}
                        expanded={expandedCardId === card.id}
                        metricScale={metricScale}
                        vturbMetrics={vturbMetricsByAsset.get(card.id) ?? null}
                        onToggle={() => setExpandedCardId((current) => current === card.id ? null : card.id)}
                        onAnalyze={() => analyzeCreative(card)}
                        analyzing={analyzingAssetId === card.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={groupDialogOpen} onOpenChange={(open) => open ? setGroupDialogOpen(true) : closeGroupDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingGroupId ? "Editar grupo de criativos" : "Novo grupo de criativos"}</DialogTitle>
            <DialogDescription>
              {editingGroupId
                ? "Altere as regras e a ordenação aplicadas por este grupo."
                : "Salve um conjunto de regras para reaplicar filtros e ordenação na grade de cards."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome">
              <Input value={groupForm.name} onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))} />
            </Field>
            <Field label="Ordenação padrão">
              <Select value={groupForm.sortKey} onValueChange={(value) => setGroupForm((current) => ({ ...current, sortKey: value as CreativeSortKey }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchases">Vendas</SelectItem>
                  <SelectItem value="roas">ROAS</SelectItem>
                  <SelectItem value="hook_rate">Hook Rate</SelectItem>
                  <SelectItem value="ctr">CTR</SelectItem>
                  <SelectItem value="cpm">CPM</SelectItem>
                  <SelectItem value="spend">Gasto</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tipo de mídia">
              <Select value={groupForm.mediaType} onValueChange={(value) => setGroupForm((current) => ({ ...current, mediaType: value as CreativeMediaType | "all" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="video">Vídeo</SelectItem>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="unknown">Sem mídia</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status do pipeline">
              <Select value={groupForm.pipelineStatus} onValueChange={(value) => setGroupForm((current) => ({ ...current, pipelineStatus: value as CreativePipelineStatus | "all" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ready">Pronto</SelectItem>
                  <SelectItem value="transcribing">Transcrevendo</SelectItem>
                  <SelectItem value="analyzing">Analisando</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="missing_transcript">Sem transcript</SelectItem>
                  <SelectItem value="oversized_queued">Vídeo grande em fila</SelectItem>
                  <SelectItem value="failed">Falhou</SelectItem>
                  <SelectItem value="missing_media">Sem mídia</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Campanha contém">
              <Input value={groupForm.campaignQuery} onChange={(event) => setGroupForm((current) => ({ ...current, campaignQuery: event.target.value }))} />
            </Field>
            <Field label="Adset contém">
              <Input value={groupForm.adsetQuery} onChange={(event) => setGroupForm((current) => ({ ...current, adsetQuery: event.target.value }))} />
            </Field>
            <Field label="Hook Rate mínimo">
              <Input value={groupForm.minHookRate} onChange={(event) => setGroupForm((current) => ({ ...current, minHookRate: event.target.value }))} inputMode="decimal" />
            </Field>
            <Field label="ROAS mínimo">
              <Input value={groupForm.minRoas} onChange={(event) => setGroupForm((current) => ({ ...current, minRoas: event.target.value }))} inputMode="decimal" />
            </Field>
            <Field label="CTR mínimo">
              <Input value={groupForm.minCtr} onChange={(event) => setGroupForm((current) => ({ ...current, minCtr: event.target.value }))} inputMode="decimal" />
            </Field>
            <Field label="CPM máximo">
              <Input value={groupForm.maxCpm} onChange={(event) => setGroupForm((current) => ({ ...current, maxCpm: event.target.value }))} inputMode="decimal" />
            </Field>
            <Field label="Gasto mínimo">
              <Input value={groupForm.minSpend} onChange={(event) => setGroupForm((current) => ({ ...current, minSpend: event.target.value }))} inputMode="decimal" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeGroupDialog}>Cancelar</Button>
            <Button onClick={saveGroup}>{editingGroupId ? "Salvar alterações" : "Salvar grupo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(groupToDelete)} onOpenChange={(open) => !open && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover grupo?</AlertDialogTitle>
            <AlertDialogDescription>
              O grupo “{groupToDelete?.name}” será removido. Os criativos e seus dados não serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteGroup()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover grupo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyCardsState({
  latestSyncRun,
  onRetry,
  syncing,
}: {
  latestSyncRun: SyncRunRow | null;
  onRetry: () => void;
  syncing: boolean;
}) {
  const isFailed = latestSyncRun?.status === "failed";
  const isRunning = latestSyncRun?.status === "running";

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/30 bg-gradient-to-br from-card/90 via-card/60 to-card/40 px-8 py-16 text-center">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-violet-500/5 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-cyan-500/5 blur-3xl" />
      </div>

      <div className="relative">
        {/* Icon */}
        <div className="mx-auto mb-6 relative">
          {isFailed ? (
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
          ) : isRunning ? (
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center mx-auto">
              <Sparkles className="w-8 h-8 text-violet-300" />
            </div>
          )}
        </div>

        {/* Title */}
        <h3 className="text-xl font-semibold tracking-tight mb-2">
          {isFailed
            ? "Sincronização falhou"
            : isRunning
              ? "Processando criativos"
              : "Nenhum criativo encontrado"}
        </h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          {isFailed
            ? latestSyncRun?.error_message ?? "Ocorreu um erro durante a sincronização. Tente novamente."
            : isRunning
              ? "A sincronização está em andamento. Os criativos aparecerão em breve."
              : "Sincronize os criativos do Meta Ads para visualizar a galeria com mídia, análises e métricas."}
        </p>

        {/* Action */}
        {!isRunning && (
          <Button
            variant="outline"
            onClick={onRetry}
            disabled={syncing}
            className="mt-6 gap-2 rounded-xl border-border/60 bg-background/40 hover:bg-background/60"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Sincronizar criativos
          </Button>
        )}
      </div>
    </div>
  );
}

function CreativeCard({
  card,
  expanded,
  metricScale,
  vturbMetrics,
  analyzing,
  onAnalyze,
  onToggle,
}: {
  card: CreativeAssetCard;
  expanded: boolean;
  metricScale: { ctr: number; cpm: number; playRate: number; pitchRetention: number; hookRate: number; aov: number };
  vturbMetrics: CreativeVturbMetrics | null;
  analyzing: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
}) {
  const [showAdditionalMetrics, setShowAdditionalMetrics] = useState(false);
  const title = card.headline || card.adNames[0] || card.assetKey;
  const previewText = card.primaryText || card.summary || "";
  const landingLabel = compactUrlLabel(card.landingUrl);
  const facebookLabel = compactUrlLabel(card.facebookPostUrl) || "Facebook";
  const instagramLabel = compactUrlLabel(card.instagramPostUrl) || "Instagram";
  const analyzeLabel =
    card.mediaType === "video" && card.transcriptStatus !== "ready"
      ? "Transcrever"
      : card.pipelineStatus === "ready"
        ? "Reanalisar"
        : "Analisar";
  const actionDisabled =
    analyzing ||
    card.mediaType === "unknown" ||
    card.pipelineStatus === "analyzing" ||
    card.pipelineStatus === "transcribing" ||
    card.pipelineStatus === "oversized_queued" ||
    card.pipelineStatus === "missing_media";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border transition-all duration-300",
        expanded
          ? "border-violet-500/30 bg-gradient-to-b from-card to-card/80 shadow-xl shadow-violet-500/5"
          : "border-border/40 bg-card/90 hover:border-border/60 hover:shadow-lg hover:shadow-black/20",
      )}
    >
      {/* Hero Media */}
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800/90 to-slate-950">
        {card.mediaUrl ? (
          <>
            <img
              src={card.mediaUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          </>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-muted-foreground/60">
            {card.mediaType === "video" ? (
              <Clapperboard className="w-12 h-12" />
            ) : (
              <ImageIcon className="w-12 h-12" />
            )}
            <span className="text-xs">Sem preview</span>
          </div>
        )}

        {/* Top badges */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3 gap-2">
          <div className="flex flex-wrap gap-2">
            <PipelineBadge status={card.pipelineStatus} />
            <CoverageBadge coverage={card.analysisCoverage} />
          </div>
          <MediaBadge mediaType={card.mediaType} href={card.sourceMediaUrl} />
        </div>

        {/* Bottom overlay */}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug drop-shadow-lg">
            {title}
          </h3>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-white/70">
              <Eye className="w-3 h-3" />
              {card.adsCount} anúncio{card.adsCount !== 1 ? "s" : ""}
            </span>
            {card.processedAt && (
              <>
                <span className="text-white/30">•</span>
                <span className="text-[11px] text-white/60">
                  {formatDistanceToNow(new Date(card.processedAt), { addSuffix: true, locale: ptBR })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Tags */}
        {(card.tags.length > 0 || previewText) && (
          <div className="space-y-3">
            {card.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {card.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-lg bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
                {card.tags.length > 4 && (
                  <span className="inline-flex items-center rounded-lg bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground/70">
                    +{card.tags.length - 4}
                  </span>
                )}
              </div>
            )}
            {previewText && (
              <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                {previewText}
              </p>
            )}
          </div>
        )}

        {/* Source Metadata */}
        <div className="flex flex-wrap gap-1.5">
          {card.cta && <InfoPill label="CTA" value={card.cta} />}
          {card.firstAdCreatedAt && (
            <InfoPill label="Criado" value={format(new Date(card.firstAdCreatedAt), "dd/MM/yyyy", { locale: ptBR })} />
          )}
          <InfoPill label="Ads" value={String(card.adsCount)} />
          <InfoPill label="Campanhas" value={String(card.campaignNames.length)} />
          <InfoPill label="Adsets" value={String(card.adsetNames.length)} />
          {card.landingUrl && (
            <a
              href={card.landingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{landingLabel}</span>
            </a>
          )}
          {card.facebookPostUrl && (
            <a
              href={card.facebookPostUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{facebookLabel}</span>
            </a>
          )}
          {card.instagramPostUrl && card.instagramPostUrl !== card.facebookPostUrl && (
            <a
              href={card.instagramPostUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{instagramLabel}</span>
            </a>
          )}
          {card.sourceMediaUrl && (
            <a
              href={card.sourceMediaUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" />
              Mídia
            </a>
          )}
        </div>

        {/* Primary Metrics */}
        <div className="grid grid-cols-2 gap-2">
          <MetricTile
            label="Gasto"
            value={fBRL(card.spend)}
          />
          <MetricTile
            label="Vendas"
            value={fNum(card.purchases)}
            accent="violet"
            highlight={card.purchases > 0}
          />
          <MetricTile
            label="ROAS"
            value={card.roas != null ? `${card.roas.toFixed(2)}x` : "—"}
            accent="emerald"
            highlight={card.roas != null && card.roas >= 2}
          />
          <MetricTile
            label="Reembolsos"
            value={`${fNum(card.refunds)} · ${fBRL(card.refundValue)}`}
            detail={card.refundRate != null ? `${fPct(card.refundRate, 1)} das vendas` : undefined}
            accent="amber"
            highlight={card.refunds > 0}
          />
          {showAdditionalMetrics && (
            <>
              <MetricTile
                label="Order bump"
                value={fNum(card.orderBumpPurchases)}
                detail={fBRL(card.orderBumpRevenue)}
                accent="violet"
                highlight={card.orderBumpPurchases > 0}
              />
              <MetricTile
                label="Upsell"
                value={fNum(card.upsellPurchases)}
                detail={fBRL(card.upsellRevenue)}
                accent="emerald"
                highlight={card.upsellPurchases > 0}
              />
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAdditionalMetrics((current) => !current)}
          aria-expanded={showAdditionalMetrics}
          className="-mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {showAdditionalMetrics ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showAdditionalMetrics ? "Ver menos métricas" : "Ver order bump e upsell"}
        </button>

        {/* Secondary Metrics */}
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <MetricBar
            label="CPM"
            value={card.cpm != null ? fBRL(card.cpm) : "—"}
            width={card.cpm != null ? Math.min(100, (card.cpm / metricScale.cpm) * 100) : 0}
            tone="amber"
          />
          <MetricBar
            label="CTR"
            value={card.ctr != null ? fPct(card.ctr, 2) : "—"}
            width={card.ctr != null ? Math.min(100, (card.ctr / metricScale.ctr) * 100) : 0}
            tone="cyan"
          />
          <MetricBar
            label="Play Rate"
            value={vturbMetrics?.playRate != null ? fPct(vturbMetrics.playRate, 1) : "—"}
            width={vturbMetrics?.playRate != null ? Math.min(100, (vturbMetrics.playRate / metricScale.playRate) * 100) : 0}
            tone="emerald"
          />
          <MetricBar
            label="Ret. Pitch"
            value={vturbMetrics?.pitchRetention != null ? fPct(vturbMetrics.pitchRetention, 1) : "—"}
            width={vturbMetrics?.pitchRetention != null ? Math.min(100, (vturbMetrics.pitchRetention / metricScale.pitchRetention) * 100) : 0}
            tone="violet"
          />
          <MetricBar
            label="Hook"
            value={card.hookRate != null ? fPct(card.hookRate, 1) : "—"}
            width={card.hookRate != null ? Math.min(100, (card.hookRate / metricScale.hookRate) * 100) : 0}
            tone="amber"
          />
          <MetricBar
            label="AOV"
            value={card.aov != null ? fBRL(card.aov) : "—"}
            width={card.aov != null ? Math.min(100, (card.aov / metricScale.aov) * 100) : 0}
            tone="cyan"
          />
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAnalyze}
            disabled={actionDisabled}
            className="h-9 gap-2 rounded-xl border-border/60 bg-background/40 text-xs"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {analyzeLabel}
          </Button>
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-medium transition-all",
              expanded
                ? "bg-violet-500/10 text-violet-300 hover:bg-violet-500/15"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {expanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                Recolher
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                Detalhes
              </>
            )}
          </button>
        </div>

        {/* Expanded Content */}
        {expanded && (
          <div className="space-y-4 pt-2 animate-in slide-in-from-top-2 duration-300">
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="w-full grid grid-cols-2 h-9 p-1 bg-muted/40 rounded-xl">
                <TabsTrigger
                  value="summary"
                  className="rounded-lg text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Resumo
                </TabsTrigger>
                <TabsTrigger
                  value="transcript"
                  className="rounded-lg text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Transcrição
                </TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricTile label="Hook Score" value={card.scores.hook != null ? `${Math.round(card.scores.hook)}` : "—"} accent="violet" highlight={(card.scores.hook ?? 0) >= 75} />
                  <MetricTile label="Clareza" value={card.scores.clareza != null ? `${Math.round(card.scores.clareza)}` : "—"} accent="default" />
                  <MetricTile label="Escala" value={card.scores.potencial_de_escala != null ? `${Math.round(card.scores.potencial_de_escala)}` : "—"} accent="emerald" highlight={(card.scores.potencial_de_escala ?? 0) >= 75} />
                </div>

                {/* Analysis Grid */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <AnalysisBlock title="Resumo" text={card.summary} icon={<Sparkles className="w-3 h-3" />} />
                  <AnalysisBlock title="Hook" text={card.hook} icon={<Zap className="w-3 h-3" />} accent="amber" />
                  <AnalysisBlock title="Ângulo" text={card.angle} icon={<TrendingUp className="w-3 h-3" />} />
                  <AnalysisBlock title="Copy" text={card.copy} icon={<Filter className="w-3 h-3" />} />
                </div>

                {/* CTA & Visual */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <AnalysisBlock title="CTA" text={card.cta} compact />
                  <AnalysisBlock title="Visual" text={card.visual} compact />
                </div>

                {card.hookTimestamps.length > 0 && (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                      Timestamps do Hook
                    </div>
                    <div className="space-y-2">
                      {card.hookTimestamps.map((item) => (
                        <div key={`${item.start_ms}-${item.label}`} className="rounded-lg border border-border/20 bg-background/40 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium text-foreground">{item.label}</span>
                            <span className="text-[11px] text-amber-300">{formatMsLabel(item.start_ms)} - {formatMsLabel(item.end_ms)}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {card.visualEvidence.length > 0 && (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                      Evidências Visuais
                    </div>
                    <div className="space-y-2">
                      {card.visualEvidence.map((item) => (
                        <div key={`${item.timestamp_ms}-${item.observation}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/20 bg-background/40 px-3 py-2">
                          <p className="text-xs text-foreground/90">{item.observation}</p>
                          <span className="shrink-0 text-[11px] text-cyan-300">{formatMsLabel(item.timestamp_ms)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vínculos */}
                {(card.campaignNames.length > 0 || card.adsetNames.length > 0) && (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
                      Campanhas & Adsets
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {card.campaignNames.map((campaign) => (
                        <span
                          key={campaign}
                          className="inline-flex items-center rounded-lg bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300"
                        >
                          {campaign}
                        </span>
                      ))}
                      {card.adsetNames.map((adset) => (
                        <span
                          key={adset}
                          className="inline-flex items-center rounded-lg bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {adset}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error */}
                {(card.errorMessage || card.transcriptErrorMessage || card.analysisErrorMessage) && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {card.transcriptErrorMessage && <p className="text-xs text-red-200">Transcript: {card.transcriptErrorMessage}</p>}
                      {card.analysisErrorMessage && <p className="text-xs text-red-200">Análise: {card.analysisErrorMessage}</p>}
                      {!card.transcriptErrorMessage && !card.analysisErrorMessage && card.errorMessage && <p className="text-xs text-red-200">{card.errorMessage}</p>}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transcript" className="mt-4">
                {card.transcriptSegments.length > 0 ? (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-4 max-h-72 overflow-y-auto space-y-3">
                    {card.transcriptSegments.map((segment) => (
                      <div key={`${segment.start_ms}-${segment.end_ms}-${segment.text.slice(0, 12)}`} className="grid grid-cols-[88px_1fr] gap-3 rounded-lg border border-border/20 bg-background/40 px-3 py-2">
                        <span className="text-[11px] font-medium text-cyan-300">
                          {formatMsLabel(segment.start_ms)} - {formatMsLabel(segment.end_ms)}
                        </span>
                        <p className="text-sm text-foreground/90 leading-relaxed">{segment.text}</p>
                      </div>
                    ))}
                    {card.transcript && (
                      <div className="rounded-lg border border-dashed border-border/20 px-3 py-2">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Transcript completo</p>
                        <p className="mt-2 text-sm text-foreground/80 whitespace-pre-line leading-relaxed">{card.transcript}</p>
                      </div>
                    )}
                  </div>
                ) : card.transcript ? (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-4 max-h-64 overflow-y-auto">
                    <p className="text-sm text-foreground/90 whitespace-pre-line leading-relaxed">{card.transcript}</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/30 bg-muted/10 p-6 text-center">
                    <Clapperboard className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {labelForTranscriptStatus(card.transcriptStatus)}
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {card.mediaType === "image"
                        ? "Disponível apenas para vídeos"
                        : card.transcriptStatus === "oversized_queued"
                          ? "O worker está quebrando o áudio em partes para transcrever."
                          : card.transcriptStatus === "failed"
                            ? "A transcrição falhou e pode ser reprocessada."
                            : "Aguardando processamento"}
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </article>
  );
}

function ToolbarSelect({
  icon,
  label,
  value,
  onValueChange,
  options,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80 font-medium">
        {icon}
        {label}
      </div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-10 rounded-xl border-border/50 bg-background/60 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="rounded-lg">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
  accent = "default",
  highlight = false,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: "default" | "emerald" | "violet" | "amber";
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors",
        accent === "default" && "border-border/40 bg-muted/30",
        accent === "emerald" && "border-emerald-500/20 bg-emerald-500/5",
        accent === "violet" && "border-violet-500/20 bg-violet-500/5",
        accent === "amber" && "border-amber-500/20 bg-amber-500/5",
        highlight && accent === "emerald" && "border-emerald-500/40 bg-emerald-500/10",
        highlight && accent === "violet" && "border-violet-500/40 bg-violet-500/10",
        highlight && accent === "amber" && "border-amber-500/40 bg-amber-500/10",
      )}
    >
      {highlight && (
        <div
          className={cn(
            "absolute inset-0 opacity-30",
            accent === "emerald" && "bg-gradient-to-br from-emerald-500/20 to-transparent",
            accent === "violet" && "bg-gradient-to-br from-violet-500/20 to-transparent",
            accent === "amber" && "bg-gradient-to-br from-amber-500/20 to-transparent",
          )}
        />
      )}
      <div className="relative">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{label}</div>
        <div
          className={cn(
            "mt-0.5 text-base font-semibold tabular-nums",
            highlight && accent === "emerald" && "text-emerald-300",
            highlight && accent === "violet" && "text-violet-300",
            highlight && accent === "amber" && "text-amber-300",
          )}
        >
          {value}
        </div>
        {detail && <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="max-w-28 truncate text-foreground/80">{value}</span>
    </span>
  );
}

function MetricBar({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: string;
  width: number;
  tone: "amber" | "cyan" | "emerald" | "violet";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-[68px] shrink-0 truncate text-[11px] font-medium text-muted-foreground" title={label}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            tone === "amber" && "bg-gradient-to-r from-amber-500 to-amber-400",
            tone === "cyan" && "bg-gradient-to-r from-cyan-500 to-cyan-400",
            tone === "emerald" && "bg-gradient-to-r from-emerald-500 to-emerald-400",
            tone === "violet" && "bg-gradient-to-r from-violet-500 to-violet-400",
          )}
          style={{ width: width > 0 ? `${Math.max(2, width)}%` : "0%" }}
        />
      </div>
      <span className="w-14 shrink-0 text-right tabular-nums text-xs font-medium text-foreground/80">{value}</span>
    </div>
  );
}

function PipelineBadge({ status }: { status: CreativePipelineStatus }) {
  const config: Record<CreativePipelineStatus, { icon: ReactNode; label: string; className: string }> = {
    ready: {
      icon: <Sparkles className="w-3 h-3" />,
      label: "Pronto",
      className: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    },
    transcribing: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: "Transcrevendo",
      className: "bg-amber-500/20 text-amber-200 border-amber-500/30",
    },
    analyzing: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      label: "Analisando",
      className: "bg-cyan-500/20 text-cyan-200 border-cyan-500/30",
    },
    pending: {
      icon: <Loader2 className="w-3 h-3" />,
      label: "Pendente",
      className: "bg-muted/40 text-muted-foreground border-border/50",
    },
    missing_transcript: {
      icon: <Clapperboard className="w-3 h-3" />,
      label: "Sem transcript",
      className: "bg-orange-500/20 text-orange-200 border-orange-500/30",
    },
    oversized_queued: {
      icon: <Clapperboard className="w-3 h-3" />,
      label: "Vídeo grande em fila",
      className: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/30",
    },
    failed: {
      icon: <AlertTriangle className="w-3 h-3" />,
      label: "Falhou",
      className: "bg-red-500/20 text-red-200 border-red-500/30",
    },
    missing_media: {
      icon: <ImageIcon className="w-3 h-3" />,
      label: "Sem mídia",
      className: "bg-muted/40 text-muted-foreground border-border/50",
    },
  };

  const { icon, label, className } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium backdrop-blur-md",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function CoverageBadge({ coverage }: { coverage: CreativeAnalysisCoverage }) {
  const label =
    coverage === "full"
      ? "Cobertura total"
      : coverage === "partial"
        ? "Cobertura parcial"
        : coverage === "failed"
          ? "Cobertura falhou"
          : coverage === "not_applicable"
            ? "Sem transcript"
            : "Cobertura pendente";

  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-medium text-white/80 backdrop-blur-md">
      {label}
    </span>
  );
}

function MediaBadge({ mediaType, href }: { mediaType: CreativeMediaType; href: string | null }) {
  const content = (
    <>
      {mediaType === "video" ? (
        <Play className="w-3 h-3" />
      ) : mediaType === "image" ? (
        <ImageIcon className="w-3 h-3" />
      ) : (
        <Layers className="w-3 h-3" />
      )}
      {mediaType === "video" ? "Ver vídeo" : labelForMediaType(mediaType)}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-black/70"
      >
        {content}
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-md">
      {content}
    </span>
  );
}

function AnalysisBlock({
  title,
  text,
  icon,
  accent,
  compact = false,
}: {
  title: string;
  text: string | null;
  icon?: ReactNode;
  accent?: "amber" | "emerald" | "cyan" | "violet";
  compact?: boolean;
}) {
  const hasContent = text && text.trim().length > 0;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        hasContent
          ? "border-border/30 bg-muted/20"
          : "border-dashed border-border/20 bg-muted/10",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium",
          accent === "amber" && "text-amber-400/80",
          accent === "emerald" && "text-emerald-400/80",
          accent === "cyan" && "text-cyan-400/80",
          accent === "violet" && "text-violet-400/80",
          !accent && "text-muted-foreground",
        )}
      >
        {icon}
        {title}
      </div>
      <p
        className={cn(
          "mt-1.5 text-[13px] leading-relaxed",
          hasContent ? "text-foreground/90" : "text-muted-foreground/50 italic",
          compact && "line-clamp-2",
        )}
      >
        {hasContent ? text : "Não disponível"}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function labelForTranscriptStatus(status: CreativeTranscriptStatus) {
  switch (status) {
    case "processing":
      return "Transcrição em andamento";
    case "ready":
      return "Transcript pronta";
    case "failed":
      return "Transcript falhou";
    case "not_applicable":
      return "Sem transcript";
    case "missing_media":
      return "Sem mídia";
    case "oversized_queued":
      return "Vídeo grande em fila";
    default:
      return "Transcript pendente";
  }
}

function formatMsLabel(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function compactUrlLabel(url: string | null) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname}${path}`.slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

function buildCreativeVturbMetrics(
  cards: CreativeAssetCard[],
  events: Array<{ payload: RawVturbPayload | null }>,
) {
  const metricsByAdId = new Map<string, { pageviews: number; plays: number; pitchReached: number }>();

  for (const event of events) {
    const payload = event.payload ?? {};
    const attributionKey = String(payload.utm_content ?? payload.grouped_field ?? "").trim();
    if (!attributionKey) continue;
    const current = metricsByAdId.get(attributionKey) ?? { pageviews: 0, plays: 0, pitchReached: 0 };
    current.pageviews += firstPositiveMetric(
      payload.total_viewed_session_uniq,
      payload.total_viewed_device_uniq,
      payload.pageviews,
      payload.page_views,
      payload.landing_page_views,
    );
    current.plays += firstPositiveMetric(
      payload.total_started_session_uniq,
      payload.total_started_device_uniq,
      payload.plays,
      payload.play,
      payload.total_plays,
      payload.views,
      payload.sessions,
      payload.unique_views,
    );
    current.pitchReached += metricNumber(payload.total_over_pitch ?? payload.pitch_reached ?? payload.conversions);
    metricsByAdId.set(attributionKey, current);
  }

  const result = new Map<string, CreativeVturbMetrics>();

  for (const card of cards) {
    let pageviews = 0;
    let plays = 0;
    let pitchReached = 0;

    const attributionTerms = [...card.adIds, ...card.adNames]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length >= 3);
    for (const [content, metrics] of metricsByAdId) {
      const normalizedContent = content.toLowerCase();
      if (!attributionTerms.some((term) => normalizedContent === term || normalizedContent.includes(term))) continue;
      pageviews += metrics.pageviews;
      plays += metrics.plays;
      pitchReached += metrics.pitchReached;
    }

    result.set(card.id, {
      playRate: pageviews > 0 ? (plays / pageviews) * 100 : null,
      pitchRetention: plays > 0 ? (pitchReached / plays) * 100 : null,
    });
  }

  return result;
}

function firstPositiveMetric(...values: unknown[]) {
  for (const value of values) {
    const parsed = metricNumber(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function metricNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupFormFromRow(group: CreativeGroupRow): GroupFormState {
  const rules = parseCreativeGroupRules(group.rules);
  const sortKeys: CreativeSortKey[] = ["purchases", "roas", "hook_rate", "ctr", "cpm", "spend"];
  const sortKey = sortKeys.includes(group.sort_key as CreativeSortKey)
    ? (group.sort_key as CreativeSortKey)
    : "purchases";

  return {
    name: group.name,
    mediaType: rules.mediaType ?? "all",
    pipelineStatus: rules.pipelineStatus ?? "all",
    campaignQuery: rules.campaignQuery ?? "",
    adsetQuery: rules.adsetQuery ?? "",
    minHookRate: numberInputValue(rules.minHookRate),
    minRoas: numberInputValue(rules.minRoas),
    minCtr: numberInputValue(rules.minCtr),
    maxCpm: numberInputValue(rules.maxCpm),
    minSpend: numberInputValue(rules.minSpend),
    sortKey,
  };
}

function numberInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function buildGroupRulesFromForm(form: GroupFormState): CreativeGroupRules {
  const rules: CreativeGroupRules = {};
  if (form.mediaType !== "all") rules.mediaType = form.mediaType;
  if (form.pipelineStatus !== "all") rules.pipelineStatus = form.pipelineStatus;
  if (form.campaignQuery.trim()) rules.campaignQuery = form.campaignQuery.trim();
  if (form.adsetQuery.trim()) rules.adsetQuery = form.adsetQuery.trim();
  const numericRules: Array<[keyof CreativeGroupRules, string]> = [
    ["minHookRate", form.minHookRate],
    ["minRoas", form.minRoas],
    ["minCtr", form.minCtr],
    ["maxCpm", form.maxCpm],
    ["minSpend", form.minSpend],
  ];
  for (const [key, value] of numericRules) {
    const parsed = Number(value);
    if (value !== "" && Number.isFinite(parsed)) {
      (rules[key] as number | null | undefined) = parsed;
    }
  }
  return rules;
}

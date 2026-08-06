import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, formatDistanceToNow, parseISO, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Copy,
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
import { useAuth } from "@/hooks/useAuth";

interface AdsPanelProps {
  projectId: string | null;
  allowedAdIds?: string[] | null;
  canManage?: boolean;
  dateRange?: {
    from: string | null;
    to: string | null;
  };
}

type CardsViewMode = "cards" | "funnel";
type CreativeActivityFilter = "active" | "all";

type SyncRunRow = {
  source: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error_message: string | null;
  created_at: string;
};

type CreativeVturbMetrics = {
  pageviews: number;
  plays: number;
  pitchReached: number;
  playRate: number | null;
  pitchRetention: number | null;
};

type AdDimensionMetricRow = {
  event_date: string;
  ad_id: string;
  investimento: number | null;
  impressoes: number | null;
  cliques: number | null;
  hook_count: number | null;
  pageviews: number | null;
  plays_unicos: number | null;
  chegaram_pitch: number | null;
  vendas_front: number | null;
  fat_bruto: number | null;
  fat_liquido: number | null;
  reembolsos: number | null;
  valor_reembolsado: number | null;
  order_bump_orders: number | null;
  upsell_orders: number | null;
};

type GroupFormState = {
  name: string;
  mediaType: CreativeMediaType | "all";
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

export function AdsPanel({ projectId, dateRange, allowedAdIds = null, canManage = true }: AdsPanelProps) {
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
  const [adDimensionMetrics, setAdDimensionMetrics] = useState<AdDimensionMetricRow[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<CreativeSortKey>("purchases");
  const [mediaFilter, setMediaFilter] = useState<CreativeMediaType | "all">("all");
  const [activityFilter, setActivityFilter] = useState<CreativeActivityFilter>("active");
  const [activeFixedGroup, setActiveFixedGroup] = useState<FixedCreativeGroupKey>("all");
  const [activeCustomGroupId, setActiveCustomGroupId] = useState<string | null>(null);
  const [viewPreferenceHydrated, setViewPreferenceHydrated] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [analyzingAssetId, setAnalyzingAssetId] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<CreativeGroupRow | null>(null);
  const [analysisFrom, setAnalysisFrom] = useState("");
  const [analysisTo, setAnalysisTo] = useState("");
  const [analysisRoasCutoff, setAnalysisRoasCutoff] = useState("");
  const [analysisPreferenceFor, setAnalysisPreferenceFor] = useState<string | null>(null);

  const load = useCallback(async (showPageLoader = true) => {
    if (!projectId) return;
    if (showPageLoader) setLoading(true);
    try {
      const metricsQuery = supabase
        .from("creative_asset_daily_metrics")
        .select("asset_id, event_date, spend, impressions, clicks, outbound_clicks, ctr, link_ctr, cpm, purchases, revenue, net_revenue, profit, refunds, refund_value, refund_rate, order_bump_purchases, order_bump_revenue, upsell_purchases, upsell_revenue, order_bump_conversion, upsell_conversion, roas, cpa, hook_rate, has_meta_data, has_gateway_data")
        .eq("project_id", projectId)
        .order("event_date", { ascending: true })
        .limit(10_000);

      const vturbMetricQuery = supabase
        .from("daily_ad_dimension_metrics")
        .select("event_date, ad_id, investimento, impressoes, cliques, hook_count, pageviews, plays_unicos, chegaram_pitch, vendas_front, fat_bruto, fat_liquido, reembolsos, valor_reembolsado, order_bump_orders, upsell_orders")
        .eq("project_id", projectId)
        .order("event_date", { ascending: true });

      const [
        { data: projectRow },
        { data: assetRows },
        { data: adRows },
        { data: metricRows },
        { data: analysisRows },
        { data: jobRows },
        { data: groupRows },
        { data: syncRows },
        { data: vturbMetricRows },
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
          .select("asset_id, ad_id, ad_created_time, ad_updated_time, ad_effective_status, ad_configured_status, ad_name, adset_id, adset_name, campaign_id, campaign_name")
          .eq("project_id", projectId),
        metricsQuery,
        supabase
          .from("creative_asset_analysis" as never)
          .select("asset_id, status, transcript_status, transcript, transcript_segments, transcript_language, transcript_provider, transcript_model, transcript_error_message, summary, hook, hook_timestamps, angle, copy, cta, visual, visual_evidence, tags, scores, analysis_coverage, analysis_error_message, error_message, processed_at")
          .eq("project_id", projectId),
        supabase.rpc(
          "list_creative_processing_status_safe",
          { _project_id: projectId },
        ),
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
        vturbMetricQuery.limit(10_000),
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
      setAdDimensionMetrics((vturbMetricRows ?? []) as unknown as AdDimensionMetricRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao carregar criativos");
    } finally {
      if (showPageLoader) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || analysisPreferenceFor === projectId) return;
    let storedCutoff = "";
    try {
      storedCutoff = window.localStorage.getItem(`infiniteprofit.creativeAnalysis.${projectId}`) ?? "";
    } catch {
      // A preferência é opcional.
    }
    setAnalysisRoasCutoff(storedCutoff);
    setAnalysisFrom(dateRange?.from ?? "");
    setAnalysisTo(dateRange?.to ?? "");
    setAnalysisPreferenceFor(projectId);
  }, [analysisPreferenceFor, dateRange?.from, dateRange?.to, projectId]);

  useEffect(() => {
    if (!projectId || analysisPreferenceFor !== projectId) return;
    try {
      window.localStorage.setItem(
        `infiniteprofit.creativeAnalysis.${projectId}`,
        analysisRoasCutoff,
      );
    } catch {
      // A preferência é opcional.
    }
  }, [analysisPreferenceFor, analysisRoasCutoff, projectId]);

  useEffect(() => {
    if (!projectId) return;
    void load();
  }, [load, projectId]);

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`creative-analysis:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "creative_asset_analysis",
          filter: `project_id=eq.${projectId}`,
        },
        () => void load(false),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "creative_asset_jobs",
          filter: `project_id=eq.${projectId}`,
        },
        () => void load(false),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, projectId]);

  useEffect(() => {
    if (!projectId) return;
    const hasActiveProcessing = jobs.some(
      (job) => job.status === "queued" || job.status === "running",
    );
    if (!hasActiveProcessing) return;
    const interval = window.setInterval(() => void load(false), 4_000);
    return () => window.clearInterval(interval);
  }, [jobs, load, projectId]);

  useEffect(() => {
    if (!projectId || loading || viewPreferenceHydrated) return;
    try {
      const raw = window.localStorage.getItem(`infiniteprofit.creativeView.${projectId}`);
      if (raw) {
        const stored = JSON.parse(raw) as { fixed?: FixedCreativeGroupKey; customId?: string | null };
        if (stored.customId && groups.some((group) => group.id === stored.customId)) {
          setActiveCustomGroupId(stored.customId);
          setActiveFixedGroup("all");
        } else if (stored.fixed && FIXED_CREATIVE_GROUPS.some((group) => group.key === stored.fixed)) {
          setActiveCustomGroupId(null);
          setActiveFixedGroup(stored.fixed);
        }
      }
    } catch {
      // A preferência visual é opcional.
    } finally {
      setViewPreferenceHydrated(true);
    }
  }, [groups, loading, projectId, viewPreferenceHydrated]);

  useEffect(() => {
    if (!projectId || !viewPreferenceHydrated) return;
    try {
      window.localStorage.setItem(
        `infiniteprofit.creativeView.${projectId}`,
        JSON.stringify({ fixed: activeFixedGroup, customId: activeCustomGroupId }),
      );
    } catch {
      // A preferência visual é opcional.
    }
  }, [activeCustomGroupId, activeFixedGroup, projectId, viewPreferenceHydrated]);

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
      await load(false);
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
      const reprocessScope = card.mediaType === "video" ? "transcript" : "analysis";
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
      await load(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao enfileirar análise");
    } finally {
      setAnalyzingAssetId(null);
    }
  }

  async function saveGroup() {
    if (!projectId || (!editingGroupId && (!workspaceId || !user?.id))) {
      toast.error("Contexto do funil indisponível para salvar a visão");
      return;
    }

    if (!groupForm.name.trim()) {
      toast.error("Dê um nome para a visão");
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
        toast.success("Visão atualizada");
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
      toast.success("Visão salva");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar visão");
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
      toast.success("Visão removida");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao remover visão");
    }
  }

  const scopedCreativeMetrics = useMemo(() => {
    if (allowedAdIds === null) return metrics;
    return buildCreativeMetricsFromAdDimensions(
      adDimensionMetrics,
      assetAds,
      new Set(allowedAdIds),
    );
  }, [adDimensionMetrics, allowedAdIds, assetAds, metrics]);

  const galleryMetrics = useMemo(
    () => filterCreativeMetricsByRange(
      scopedCreativeMetrics,
      dateRange?.from ?? null,
      dateRange?.to ?? null,
    ),
    [dateRange?.from, dateRange?.to, scopedCreativeMetrics],
  );

  const cards = useMemo(
    () => buildCreativeAssetCards({
      assets,
      ads: assetAds,
      metrics: galleryMetrics,
      lifecycleMetrics: metrics,
      analyses,
      jobs,
    }),
    [analyses, assetAds, assets, galleryMetrics, jobs, metrics],
  );

  const creativePerformanceAnalysis = useMemo(() => {
    const cutoff = parseLocalizedNumber(analysisRoasCutoff);
    if (!analysisFrom || !analysisTo || cutoff == null || cutoff < 0) return null;
    const currentMetrics = filterCreativeMetricsByRange(
      scopedCreativeMetrics,
      analysisFrom,
      analysisTo,
    );
    const currentCards = buildCreativeAssetCards({
      assets,
      ads: assetAds,
      metrics: currentMetrics,
      lifecycleMetrics: metrics,
      analyses,
      jobs,
    });
    const previousRange = previousEquivalentRange(analysisFrom, analysisTo);
    const previousCards = previousRange
      ? buildCreativeAssetCards({
        assets,
        ads: assetAds,
        metrics: filterCreativeMetricsByRange(
          scopedCreativeMetrics,
          previousRange.from,
          previousRange.to,
        ),
        lifecycleMetrics: metrics,
        analyses,
        jobs,
      })
      : [];
    return {
      current: summarizeCreativePerformance(currentCards, analysisFrom, analysisTo, cutoff),
      previous: previousRange
        ? summarizeCreativePerformance(previousCards, previousRange.from, previousRange.to, cutoff)
        : null,
      cards: currentCards,
      cutoff,
    };
  }, [analysisFrom, analysisRoasCutoff, analysisTo, analyses, assetAds, assets, jobs, metrics, scopedCreativeMetrics]);

  const activeCustomGroup = useMemo(
    () => groups.find((group) => group.id === activeCustomGroupId) ?? null,
    [groups, activeCustomGroupId],
  );

  const composedRules = useMemo(() => {
    const customRules = activeCustomGroup ? parseCreativeGroupRules(activeCustomGroup.rules) : {};
    delete customRules.pipelineStatus;
    const manualRules: CreativeGroupRules = {
      mediaType: mediaFilter,
    };
    return {
      ...customRules,
      ...(manualRules.mediaType && manualRules.mediaType !== "all" ? { mediaType: manualRules.mediaType } : {}),
    };
  }, [activeCustomGroup, mediaFilter]);

  const filteredCards = useMemo(() => {
    const allowed = allowedAdIds ? new Set(allowedAdIds) : null;
    const scopedCards = allowed
      ? cards.filter(
        (card) =>
          card.adIds.length > 0 &&
          card.adIds.some((adId) => allowed.has(adId)),
      )
      : cards;
    const base = applyCreativeFilters(scopedCards, { search, rules: composedRules });
    const activityScoped = activityFilter === "active"
      ? base.filter((card) =>
        // A creative is active when it had any source event in the selected
        // range.  Relying only on spend/purchases hides creatives that only
        // received a refund, a zero-spend impression row, or gateway data.
        card.spend > 0,
      )
      : base;
    if (activeFixedGroup === "best-hooks") {
      return activityScoped.filter((card) => (card.hookRate ?? 0) > 0);
    }
    if (activeFixedGroup === "best-roas") {
      return activityScoped.filter((card) => (card.roas ?? 0) > 0);
    }
    if (activeFixedGroup === "highest-refunds") {
      return activityScoped.filter((card) => (card.refundRate ?? 0) > 0);
    }
    if (activeFixedGroup === "highest-aov") {
      return activityScoped.filter((card) => (card.aov ?? 0) > 0);
    }
    return activityScoped;
  }, [activeFixedGroup, activityFilter, allowedAdIds, cards, composedRules, search]);

  const effectiveSortKey = useMemo(
    () => resolveSortKey(activeFixedGroup, sortKey, activeCustomGroup?.sort_key ?? null),
    [activeCustomGroup?.sort_key, activeFixedGroup, sortKey],
  );

  const sortedCards = useMemo(
    () => sortCreativeCards(filteredCards, effectiveSortKey),
    [effectiveSortKey, filteredCards],
  );

  const galleryDimensionMetrics = useMemo(() => {
    const allowed = allowedAdIds === null ? null : new Set(allowedAdIds);
    return adDimensionMetrics.filter((metric) =>
      (!dateRange?.from || metric.event_date >= dateRange.from) &&
      (!dateRange?.to || metric.event_date <= dateRange.to) &&
      (!allowed || allowed.has(metric.ad_id))
    );
  }, [adDimensionMetrics, allowedAdIds, dateRange?.from, dateRange?.to]);

  const vturbMetricsByAsset = useMemo(
    () => buildCreativeVturbMetrics(cards, galleryDimensionMetrics),
    [cards, galleryDimensionMetrics],
  );

  const metricAverages = useMemo(() => {
    const spend = sortedCards.reduce((sum, card) => sum + card.spend, 0);
    const impressions = sortedCards.reduce((sum, card) => sum + card.impressions, 0);
    const clicks = sortedCards.reduce((sum, card) => sum + card.clicks, 0);
    const purchases = sortedCards.reduce((sum, card) => sum + card.purchases, 0);
    const revenue = sortedCards.reduce((sum, card) => sum + card.revenue, 0);
    const pageviews = sortedCards.reduce(
      (sum, card) => sum + (vturbMetricsByAsset.get(card.id)?.pageviews ?? 0),
      0,
    );
    const plays = sortedCards.reduce(
      (sum, card) => sum + (vturbMetricsByAsset.get(card.id)?.plays ?? 0),
      0,
    );
    const pitchReached = sortedCards.reduce(
      (sum, card) => sum + (vturbMetricsByAsset.get(card.id)?.pitchReached ?? 0),
      0,
    );
    return {
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      playRate: pageviews > 0 ? (plays / pageviews) * 100 : null,
      pitchRetention: plays > 0 ? (pitchReached / plays) * 100 : null,
      hookRate: weightedAverage(sortedCards.map((card) => ({
        value: card.hookRate,
        weight: Math.max(card.impressions, 1),
      }))),
      aov: purchases > 0 ? revenue / purchases : null,
    };
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
          {/* Toggle Cards/Funil */}
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
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={syncCreatives}
              disabled={syncing}
              aria-label={syncing ? "Sincronizando criativos" : "Sincronizar criativos"}
              className="gap-2 rounded-xl border-border/60 bg-muted/20 hover:bg-muted/40"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="hidden sm:inline">Sincronizar</span>
            </Button>
          )}
        </div>
      </header>

      {/* Sync Status Banner */}
      {latestSyncRun?.status === "running" && (
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

      {viewMode === "cards" && (
        <CreativePerformanceAnalysis
          from={analysisFrom}
          to={analysisTo}
          roasCutoff={analysisRoasCutoff}
          result={creativePerformanceAnalysis}
          onFromChange={setAnalysisFrom}
          onToChange={setAnalysisTo}
          onRoasCutoffChange={setAnalysisRoasCutoff}
        />
      )}

      {viewMode === "funnel" ? (
        <AdsFunnelView
          projectId={projectId}
          dateRange={dateRange}
          allowedAdIds={allowedAdIds}
        />
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
          {/* Visões rápidas e salvas */}
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
                  {(group.key === "best-roas" || group.key === "highest-aov") && <TrendingUp className="w-3.5 h-3.5" />}
                  {group.key === "highest-refunds" && <AlertTriangle className="w-3.5 h-3.5" />}
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
                      aria-label={`Editar visão ${group.name}`}
                      title="Editar visão"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupToDelete(group)}
                      className="rounded-md p-1.5 opacity-65 transition hover:bg-red-500/15 hover:text-red-300 hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remover visão ${group.name}`}
                      title="Remover visão"
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
              Nova visão
            </button>
          </div>

          {activeCustomGroup && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Filtros ativos:</span>
              {groupRuleChips(parseCreativeGroupRules(activeCustomGroup.rules)).map((chip) => (
                <span key={chip} className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                  {chip}
                </span>
              ))}
            </div>
          )}

          {/* Toolbar de Filtros */}
          <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-muted/30 to-muted/10 p-4">
            <div className="grid items-end gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Search */}
              <div className="space-y-1.5 lg:col-span-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar criativos..."
                    aria-label="Buscar criativos"
                    className="h-10 rounded-xl border-border/50 bg-background/60 pl-10 placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>
              {/* Selects */}
              <ToolbarSelect
                icon={<Settings2 className="w-3.5 h-3.5" />}
                label="Ordenar"
                value={sortKey}
                onValueChange={(value) => setSortKey(value as CreativeSortKey)}
                options={[
                  { value: "recent", label: "Mais recentes" },
                  { value: "purchases", label: "Vendas front" },
                  { value: "order_bump_orders", label: "Vendas order bump" },
                  { value: "upsell_orders", label: "Vendas upsell" },
                  { value: "revenue", label: "Faturamento" },
                  { value: "profit", label: "Lucro" },
                  { value: "roas", label: "ROAS" },
                  { value: "refund_rate", label: "Taxa de reembolso" },
                  { value: "aov", label: "AOV" },
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
            </div>
          </div>

          {/* Grid de Cards */}
          {sortedCards.length === 0 ? (
            <EmptyCardsState
              latestSyncRun={latestSyncRun}
              onRetry={canManage && allowedAdIds === null ? syncCreatives : undefined}
              syncing={syncing}
              filteredByMedia={allowedAdIds !== null}
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {sortedCards.map((card) => (
                      <CreativeCard
                        key={card.id}
                        card={card}
                        expanded={expandedCardId === card.id}
                        metricAverages={metricAverages}
                        vturbMetrics={vturbMetricsByAsset.get(card.id) ?? null}
                        offerRevenueUnavailable={allowedAdIds !== null}
                        onToggle={() => setExpandedCardId((current) => current === card.id ? null : card.id)}
                        onAnalyze={canManage ? () => analyzeCreative(card) : undefined}
                        analyzing={analyzingAssetId === card.id}
                      />
                    ))}
            </div>
          )}
        </>
      )}

      <Dialog open={groupDialogOpen} onOpenChange={(open) => open ? setGroupDialogOpen(true) : closeGroupDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingGroupId ? "Editar visão salva" : "Nova visão salva"}</DialogTitle>
            <DialogDescription>
              {editingGroupId
                ? "Altere as regras e a ordenação aplicadas por esta visão."
                : "Salve os filtros numéricos atuais para reaplicá-los na grade de cards."}
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
                  <SelectItem value="purchases">Vendas front</SelectItem>
                  <SelectItem value="recent">Mais recentes</SelectItem>
                  <SelectItem value="order_bump_orders">Vendas order bump</SelectItem>
                  <SelectItem value="upsell_orders">Vendas upsell</SelectItem>
                  <SelectItem value="revenue">Faturamento</SelectItem>
                  <SelectItem value="profit">Lucro</SelectItem>
                  <SelectItem value="roas">ROAS</SelectItem>
                  <SelectItem value="refund_rate">Taxa de reembolso</SelectItem>
                  <SelectItem value="aov">AOV</SelectItem>
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
            <Button onClick={saveGroup}>{editingGroupId ? "Salvar alterações" : "Salvar visão"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(groupToDelete)} onOpenChange={(open) => !open && setGroupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover visão?</AlertDialogTitle>
            <AlertDialogDescription>
              A visão “{groupToDelete?.name}” será removida. Os criativos e seus dados não serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteGroup()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover visão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type CreativePerformanceSummary = {
  tested: number;
  validatedTests: number;
  accuracy: number | null;
  testSpend: number;
  validatedTestSpend: number;
  testEfficiency: number | null;
  running: number;
  validatedRunning: number;
  generalSpend: number;
  validatedGeneralSpend: number;
  generalEfficiency: number | null;
  averageLifetimeDays: number | null;
  testedCards: CreativeAssetCard[];
};

type CreativePerformanceResult = {
  current: CreativePerformanceSummary;
  previous: CreativePerformanceSummary | null;
  cards: CreativeAssetCard[];
  cutoff: number;
};

function CreativePerformanceAnalysis({
  from,
  to,
  roasCutoff,
  result,
  onFromChange,
  onToChange,
  onRoasCutoffChange,
}: {
  from: string;
  to: string;
  roasCutoff: string;
  result: CreativePerformanceResult | null;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onRoasCutoffChange: (value: string) => void;
}) {
  const current = result?.current ?? null;
  const previous = result?.previous ?? null;
  const tableCards = current?.testedCards
    .slice()
    .sort((left, right) => String(right.firstAdCreatedAt).localeCompare(String(left.firstAdCreatedAt)))
    .slice(0, 50) ?? [];

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card/70">
      <div className="border-b border-border/40 p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-violet-300" />
              <h3 className="text-base font-semibold">Análise de criativos</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Testados usam a data de criação da Meta. Eficiência mede a parcela da verba investida acima do corte de ROAS.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Criados de">
              <Input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} className="h-10 min-w-[150px]" />
            </Field>
            <Field label="Até">
              <Input type="date" value={to} onChange={(event) => onToChange(event.target.value)} className="h-10 min-w-[150px]" />
            </Field>
            <Field label="Corte de ROAS">
              <Input
                value={roasCutoff}
                onChange={(event) => onRoasCutoffChange(event.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 1,70"
                className="h-10 min-w-[130px]"
              />
            </Field>
          </div>
        </div>
      </div>

      {!current ? (
        <div className="flex min-h-28 items-center justify-center px-5 py-8 text-center text-sm text-muted-foreground">
          Informe o período e o corte de ROAS para calcular a análise.
        </div>
      ) : (
        <div className="space-y-5 p-4 md:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AnalysisKpi
              label="Criativos testados"
              value={fNum(current.tested)}
              delta={metricDelta(current.tested, previous?.tested)}
              detail="Criados no período"
            />
            <AnalysisKpi
              label="Criativos validados"
              value={fNum(current.validatedTests)}
              delta={metricDelta(current.validatedTests, previous?.validatedTests)}
              detail={`ROAS ≥ ${result?.cutoff.toFixed(2)}x`}
              tone="emerald"
            />
            <AnalysisKpi
              label="Taxa de assertividade"
              value={fPct(current.accuracy, 1)}
              delta={metricDelta(current.accuracy, previous?.accuracy)}
              detail="Validados ÷ testados"
              tone="violet"
            />
            <AnalysisKpi
              label="Eficiência dos testes"
              value={fPct(current.testEfficiency, 1)}
              delta={metricDelta(current.testEfficiency, previous?.testEfficiency)}
              detail={`${fBRL(current.validatedTestSpend)} de ${fBRL(current.testSpend)}`}
              tone="cyan"
            />
            <AnalysisKpi
              label="Rodaram no período"
              value={fNum(current.running)}
              delta={metricDelta(current.running, previous?.running)}
              detail="Criativos com gasto"
            />
            <AnalysisKpi
              label="Acima do corte"
              value={fNum(current.validatedRunning)}
              delta={metricDelta(current.validatedRunning, previous?.validatedRunning)}
              detail="Entre todos que rodaram"
              tone="emerald"
            />
            <AnalysisKpi
              label="Eficiência geral"
              value={fPct(current.generalEfficiency, 1)}
              delta={metricDelta(current.generalEfficiency, previous?.generalEfficiency)}
              detail={`${fBRL(current.validatedGeneralSpend)} de ${fBRL(current.generalSpend)}`}
              tone="cyan"
            />
            <AnalysisKpi
              label="Tempo médio de saturação"
              value={current.averageLifetimeDays != null ? `${current.averageLifetimeDays.toFixed(1)} dias` : "—"}
              delta={metricDelta(current.averageLifetimeDays, previous?.averageLifetimeDays)}
              detail="Criação Meta → último gasto"
              tone="amber"
            />
          </div>

          <SpendEfficiencyBar
            label="Distribuição da verba geral"
            validated={current.validatedGeneralSpend}
            total={current.generalSpend}
          />

          {tableCards.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border/40">
              <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
                <div>
                  <h4 className="text-sm font-medium">Criativos testados no período</h4>
                  <p className="text-xs text-muted-foreground">Até 50 criativos, ordenados pelos mais recentes.</p>
                </div>
                <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">
                  {tableCards.length} exibidos
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Criativo</th>
                      <th className="px-3 py-3 font-medium">Criado</th>
                      <th className="px-3 py-3 font-medium">Compras</th>
                      <th className="px-3 py-3 font-medium">Gasto</th>
                      <th className="px-3 py-3 font-medium">ROAS</th>
                      <th className="px-3 py-3 font-medium">Situação</th>
                      <th className="px-3 py-3 font-medium">Saturação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {tableCards.map((card) => {
                      const validated = (card.roas ?? -Infinity) >= (result?.cutoff ?? Infinity);
                      const status = effectiveCreativeDeliveryStatus(card, to);
                      return (
                        <tr key={card.id} className="bg-background/20">
                          <td className="max-w-[280px] px-4 py-3">
                            <div className="truncate font-medium" title={card.headline || card.adNames[0] || card.assetKey}>
                              {card.headline || card.adNames[0] || card.assetKey}
                            </div>
                            <div className="mt-0.5 truncate text-muted-foreground" title={card.campaignNames.join(", ")}>
                              {card.campaignNames.join(", ") || "Sem campanha"}
                            </div>
                          </td>
                          <td className="px-3 py-3 tabular-nums">{formatCreativeDate(card.firstAdCreatedAt)}</td>
                          <td className="px-3 py-3 tabular-nums">{fNum(card.purchases)}</td>
                          <td className="px-3 py-3 tabular-nums">{fBRL(card.spend)}</td>
                          <td className="px-3 py-3">
                            <span className={cn(
                              "inline-flex rounded-full px-2 py-1 font-semibold tabular-nums",
                              validated ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300",
                            )}>
                              {card.roas != null ? `${card.roas.toFixed(2)}x` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2 py-1",
                              status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground",
                            )}>
                              {status === "active" ? <CheckCircle2 className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
                              {status === "active" ? "Ativo" : "Pausado"}
                            </span>
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {card.firstAdCreatedAt && card.lastSpendAt ? `${creativeLifetimeDays(card)} dias` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AnalysisKpi({
  label,
  value,
  detail,
  delta,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  delta: number | null;
  tone?: "default" | "emerald" | "violet" | "cyan" | "amber";
}) {
  const tones = {
    default: "text-foreground",
    emerald: "text-emerald-300",
    violet: "text-violet-300",
    cyan: "text-cyan-300",
    amber: "text-amber-300",
  };
  return (
    <div className="rounded-xl border border-border/40 bg-background/30 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {delta != null && (
          <span className={cn("text-[10px] font-medium tabular-nums", delta >= 0 ? "text-emerald-300" : "text-rose-300")}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      <div className={cn("mt-2 text-xl font-semibold tabular-nums", tones[tone])}>{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function SpendEfficiencyBar({ label, validated, total }: { label: string; validated: number; total: number }) {
  const validPercent = total > 0 ? Math.min(100, Math.max(0, validated / total * 100)) : 0;
  const invalid = Math.max(0, total - validated);
  return (
    <div className="rounded-xl border border-border/40 bg-background/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          <span className="text-emerald-300">{fBRL(validated)} acima</span>
          <span className="mx-1.5">·</span>
          <span className="text-rose-300">{fBRL(invalid)} abaixo</span>
        </span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-rose-500/20">
        <div className="bg-emerald-400 transition-[width]" style={{ width: `${validPercent}%` }} />
      </div>
    </div>
  );
}

function CopyTranscriptButton({ transcript }: { transcript: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success("Transcrição copiada");
    } catch {
      toast.error("Não foi possível copiar a transcrição");
    }
  };
  return (
    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void copy()}>
      <Copy className="h-3.5 w-3.5" />
      Copiar
    </Button>
  );
}

function EmptyCardsState({
  latestSyncRun,
  onRetry,
  syncing,
  filteredByMedia,
}: {
  latestSyncRun: SyncRunRow | null;
  onRetry?: () => void;
  syncing: boolean;
  filteredByMedia: boolean;
}) {
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
          {isRunning ? (
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
          {isRunning
            ? "Processando criativos"
            : filteredByMedia
              ? "Nenhum criativo nesta seleção"
              : "Nenhum criativo encontrado"}
        </h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          {isRunning
            ? "A sincronização está em andamento. Os criativos aparecerão em breve."
            : filteredByMedia
              ? "Nenhum anúncio desta seleção possui métricas no período. Ajuste os filtros ou confira a cobertura de atribuição."
            : "Sincronize os criativos do Meta Ads para visualizar a galeria com mídia, análises e métricas. Falhas anteriores ficam em Diagnóstico."}
        </p>

        {/* Action */}
        {!isRunning && onRetry && (
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
  metricAverages,
  vturbMetrics,
  offerRevenueUnavailable,
  analyzing,
  onAnalyze,
  onToggle,
}: {
  card: CreativeAssetCard;
  expanded: boolean;
  metricAverages: {
    ctr: number | null;
    cpm: number | null;
    playRate: number | null;
    pitchRetention: number | null;
    hookRate: number | null;
    aov: number | null;
  };
  vturbMetrics: CreativeVturbMetrics | null;
  offerRevenueUnavailable: boolean;
  analyzing: boolean;
  onToggle: () => void;
  onAnalyze?: () => void;
}) {
  const title = card.headline || card.adNames[0] || card.assetKey;
  const previewText = card.primaryText || card.summary || "";
  const landingLabel = compactUrlLabel(card.landingUrl);
  const facebookLabel = compactUrlLabel(card.facebookPostUrl) || "Facebook";
  const instagramLabel = compactUrlLabel(card.instagramPostUrl) || "Instagram";
  const analyzeLabel = card.mediaType === "video" ? "Transcrever" : "Analisar imagem";
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
        "group relative min-w-0 overflow-hidden rounded-2xl border transition-all duration-300",
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
          <h3 title={title} className="text-sm font-semibold text-white line-clamp-2 leading-snug drop-shadow-lg">
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
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {card.cta && <InfoPill label="CTA" value={card.cta} />}
          {card.firstAdCreatedAt && (
            <InfoPill label="Criado" value={format(new Date(card.firstAdCreatedAt), "dd/MM/yyyy", { locale: ptBR })} />
          )}
          <InfoPill
            label="Status"
            value={card.deliveryStatus === "active" ? "Ativo" : card.deliveryStatus === "paused" ? "Pausado" : "Sem status"}
          />
          {card.firstAdCreatedAt && card.lastSpendAt && (
            <InfoPill label="Veiculação" value={`${creativeLifetimeDays(card)} dias`} />
          )}
          <InfoPill label="Ads" value={String(card.adsCount)} />
          <InfoPill label="Campanhas" value={String(card.campaignNames.length)} />
          <InfoPill label="Adsets" value={String(card.adsetNames.length)} />
          {card.landingUrl && (
            <a
              href={card.landingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 max-w-full basis-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{landingLabel}</span>
            </a>
          )}
          {(card.facebookPostUrl || card.instagramPostUrl) && (
            <div className="flex min-w-0 basis-full flex-col gap-1.5">
              {card.facebookPostUrl && (
                <a
                  href={card.facebookPostUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Facebook: ${facebookLabel}`}
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
                  aria-label={`Instagram: ${instagramLabel}`}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{instagramLabel}</span>
                </a>
              )}
            </div>
          )}
          {card.sourceMediaUrl && (
            <a
              href={card.sourceMediaUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={card.mediaType === "video" ? "Ver vídeo" : "Ver mídia"}
              className="inline-flex min-w-0 max-w-full basis-full items-center gap-1 rounded-lg border border-border/40 bg-muted/30 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" />
              {card.mediaType === "video" ? "Ver vídeo" : "Ver mídia"}
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
            label="Vendas front"
            value={fNum(card.purchases)}
            detail="Oferta principal"
            accent="violet"
            highlight={card.purchases > 0}
          />
          <MetricTile
            label="Faturamento"
            value={fBRL(card.revenue)}
            accent="emerald"
            highlight={card.revenue > 0}
          />
          <MetricTile
            label="Lucro"
            value={fBRL(card.profit)}
            accent={card.profit >= 0 ? "emerald" : "amber"}
            highlight
          />
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-rose-300">Reembolsos</div>
          <div className="mt-1 flex items-center justify-between gap-3 text-xs">
            <span>{fNum(card.refunds)} pedido{card.refunds === 1 ? "" : "s"}</span>
            <span>{card.refundRate != null ? fPct(card.refundRate, 1) : "—"}</span>
            <span className="font-semibold">{fBRL(card.refundValue)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-2">
          <MetricTile
            label="Order bump"
            value={`${fNum(card.orderBumpPurchases)} pedidos`}
            detail={`${offerRevenueUnavailable ? "Receita —" : fBRL(card.orderBumpRevenue)} · ${fPct(card.orderBumpConversion, 1)} do front`}
            accent="violet"
            highlight={card.orderBumpPurchases > 0}
          />
          <MetricTile
            label="Upsell"
            value={`${fNum(card.upsellPurchases)} pedidos`}
            detail={`${offerRevenueUnavailable ? "Receita —" : fBRL(card.upsellRevenue)} · ${fPct(card.upsellConversion, 1)} do front`}
            accent="emerald"
            highlight={card.upsellPurchases > 0}
          />
        </div>

        {/* Secondary Metrics */}
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <MetricBar
            label="CPM"
            value={card.cpm != null ? fBRL(card.cpm) : "—"}
            metric={card.cpm}
            average={metricAverages.cpm}
            tone="amber"
          />
          <MetricBar
            label="CTR"
            value={card.ctr != null ? fPct(card.ctr, 2) : "—"}
            metric={card.ctr}
            average={metricAverages.ctr}
            tone="cyan"
          />
          <MetricBar
            label="Play Rate"
            value={vturbMetrics?.playRate != null ? fPct(vturbMetrics.playRate, 1) : "—"}
            metric={vturbMetrics?.playRate}
            average={metricAverages.playRate}
            tone="emerald"
          />
          <MetricBar
            label="Ret. Pitch"
            value={vturbMetrics?.pitchRetention != null ? fPct(vturbMetrics.pitchRetention, 1) : "—"}
            metric={vturbMetrics?.pitchRetention}
            average={metricAverages.pitchRetention}
            tone="violet"
          />
          <MetricBar
            label="Hook"
            value={card.hookRate != null ? fPct(card.hookRate, 1) : "—"}
            metric={card.hookRate}
            average={metricAverages.hookRate}
            tone="amber"
          />
          <MetricBar
            label="AOV"
            value={card.aov != null ? fBRL(card.aov) : "—"}
            metric={card.aov}
            average={metricAverages.aov}
            tone="cyan"
          />
        </div>

        <div className="min-h-[52px] rounded-xl border border-border/30 bg-muted/20 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium">{pipelineProgressLabel(card)}</span>
            {(card.pipelineStatus === "transcribing" || card.pipelineStatus === "analyzing") && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            )}
          </div>
          {card.transcript && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {card.transcript}
            </p>
          )}
          {card.pipelineStatus === "failed" && (
            <p className="mt-1 text-[11px] text-destructive">
              {card.analysisErrorMessage || card.transcriptErrorMessage || "O processamento não foi concluído. Tente novamente."}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          {card.transcript && (
            <Button
              type="button"
              size="sm"
              onClick={onToggle}
              className="col-span-2 h-10 gap-2 rounded-xl text-xs"
            >
              <Clapperboard className="h-4 w-4" />
              Ver transcrição
            </Button>
          )}
          {onAnalyze && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={actionDisabled}
              className="h-9 gap-2 rounded-xl border-border/60 bg-background/40 text-xs"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {card.mediaType === "video" && card.transcript
                ? "Transcrever novamente"
                : analyzeLabel}
            </Button>
          )}
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
            <Tabs defaultValue={card.transcript ? "transcript" : "summary"} className="w-full">
              <TabsList className="w-full grid grid-cols-2 h-9 p-1 bg-muted/40 rounded-xl">
                <TabsTrigger
                  value="transcript"
                  className="rounded-lg text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Transcrição
                </TabsTrigger>
                <TabsTrigger
                  value="summary"
                  className="rounded-lg text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Insights
                </TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <MetricTile label="Hook Score" value={card.scores.hook != null ? `${Math.round(card.scores.hook)}` : "—"} detail="Força dos 3s iniciais" accent="violet" highlight={(card.scores.hook ?? 0) >= 75} />
                  <MetricTile label="Clareza" value={card.scores.clareza != null ? `${Math.round(card.scores.clareza)}` : "—"} detail="Promessa, oferta e CTA" accent="default" />
                  <MetricTile label="Escala" value={card.scores.potencial_de_escala != null ? `${Math.round(card.scores.potencial_de_escala)}` : "—"} detail="Apelo amplo e replicável" accent="emerald" highlight={(card.scores.potencial_de_escala ?? 0) >= 75} />
                </div>

                {/* Analysis Grid */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <AnalysisBlock title="Resumo" text={card.summary} icon={<Sparkles className="w-3 h-3" />} />
                  <AnalysisBlock title="Hook" text={card.hook} icon={<Zap className="w-3 h-3" />} accent="amber" />
                  <AnalysisBlock title="Ângulo" text={card.angle} icon={<TrendingUp className="w-3 h-3" />} />
                  <AnalysisBlock title="Legenda" text={card.primaryText ?? card.copy} icon={<Filter className="w-3 h-3" />} />
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
                          title={campaign}
                          className="inline-flex items-center rounded-lg bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[10px] text-violet-300"
                        >
                          {campaign}
                        </span>
                      ))}
                      {card.adsetNames.map((adset) => (
                        <span
                          key={adset}
                          title={adset}
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
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">Transcrição completa</p>
                          <CopyTranscriptButton transcript={card.transcript} />
                        </div>
                        <p className="mt-2 text-sm text-foreground/80 whitespace-pre-line leading-relaxed">{card.transcript}</p>
                      </div>
                    )}
                  </div>
                ) : card.transcript ? (
                  <div className="rounded-xl border border-border/30 bg-muted/20 p-4 max-h-64 overflow-y-auto">
                    <div className="mb-3 flex justify-end">
                      <CopyTranscriptButton transcript={card.transcript} />
                    </div>
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
        <SelectTrigger
          aria-label={`${label}: ${options.find((option) => option.value === value)?.label ?? value}`}
          className="h-10 rounded-xl border-border/50 bg-background/60 text-sm"
        >
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

function weightedAverage(values: Array<{ value: number | null; weight: number }>) {
  const valid = values.filter((entry): entry is { value: number; weight: number } => entry.value != null);
  const weight = valid.reduce((sum, entry) => sum + entry.weight, 0);
  return weight > 0
    ? valid.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight
    : null;
}

function filterCreativeMetricsByRange(
  metrics: CreativeAssetMetricRow[],
  from: string | null,
  to: string | null,
) {
  return metrics.filter((metric) =>
    (!from || metric.event_date >= from) && (!to || metric.event_date <= to)
  );
}

function buildCreativeMetricsFromAdDimensions(
  dimensionMetrics: AdDimensionMetricRow[],
  assetAds: CreativeAssetAdRow[],
  allowedAdIds: Set<string>,
): CreativeAssetMetricRow[] {
  const assetIdsByAd = new Map<string, Set<string>>();
  for (const link of assetAds) {
    const assetIds = assetIdsByAd.get(link.ad_id) ?? new Set<string>();
    assetIds.add(link.asset_id);
    assetIdsByAd.set(link.ad_id, assetIds);
  }

  type Accumulator = {
    assetId: string;
    eventDate: string;
    spend: number;
    impressions: number;
    clicks: number;
    hookCount: number;
    purchases: number;
    revenue: number;
    netRevenue: number;
    refunds: number;
    refundValue: number;
    orderBumpOrders: number;
    upsellOrders: number;
  };

  const byAssetDate = new Map<string, Accumulator>();
  for (const row of dimensionMetrics) {
    if (!allowedAdIds.has(row.ad_id)) continue;
    const assetIds = assetIdsByAd.get(row.ad_id);
    if (!assetIds) continue;
    for (const assetId of assetIds) {
      const key = `${assetId}:${row.event_date}`;
      const current = byAssetDate.get(key) ?? {
        assetId,
        eventDate: row.event_date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        hookCount: 0,
        purchases: 0,
        revenue: 0,
        netRevenue: 0,
        refunds: 0,
        refundValue: 0,
        orderBumpOrders: 0,
        upsellOrders: 0,
      };
      current.spend += numericMetric(row.investimento);
      current.impressions += numericMetric(row.impressoes);
      current.clicks += numericMetric(row.cliques);
      current.hookCount += numericMetric(row.hook_count);
      current.purchases += numericMetric(row.vendas_front);
      current.revenue += numericMetric(row.fat_bruto);
      current.netRevenue += numericMetric(row.fat_liquido);
      current.refunds += numericMetric(row.reembolsos);
      current.refundValue += numericMetric(row.valor_reembolsado);
      current.orderBumpOrders += numericMetric(row.order_bump_orders);
      current.upsellOrders += numericMetric(row.upsell_orders);
      byAssetDate.set(key, current);
    }
  }

  return [...byAssetDate.values()].map((row) => ({
    asset_id: row.assetId,
    event_date: row.eventDate,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    outbound_clicks: row.clicks,
    ctr: row.impressions > 0 ? row.clicks / row.impressions * 100 : null,
    link_ctr: row.impressions > 0 ? row.clicks / row.impressions * 100 : null,
    cpm: row.impressions > 0 ? row.spend / row.impressions * 1_000 : null,
    purchases: row.purchases,
    revenue: row.revenue,
    net_revenue: row.netRevenue,
    profit: row.netRevenue - row.spend - row.spend * 0.1215,
    refunds: row.refunds,
    refund_value: row.refundValue,
    order_bump_purchases: row.orderBumpOrders,
    order_bump_revenue: 0,
    upsell_purchases: row.upsellOrders,
    upsell_revenue: 0,
    order_bump_conversion: row.purchases > 0 ? row.orderBumpOrders / row.purchases * 100 : null,
    upsell_conversion: row.purchases > 0 ? row.upsellOrders / row.purchases * 100 : null,
    refund_rate: row.purchases > 0 ? row.refunds / row.purchases * 100 : null,
    roas: row.spend > 0 ? row.revenue / row.spend : null,
    cpa: row.purchases > 0 ? row.spend / row.purchases : null,
    hook_rate: row.impressions > 0 ? row.hookCount / row.impressions * 100 : null,
    has_meta_data: row.spend > 0 || row.impressions > 0 || row.clicks > 0,
    has_gateway_data: row.purchases > 0 || row.revenue > 0 || row.refunds > 0,
  }));
}

function numericMetric(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLocalizedNumber(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function previousEquivalentRange(from: string, to: string) {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || toDate < fromDate) {
    return null;
  }
  const days = differenceInCalendarDays(toDate, fromDate) + 1;
  const previousTo = subDays(fromDate, 1);
  const previousFrom = subDays(previousTo, days - 1);
  return {
    from: format(previousFrom, "yyyy-MM-dd"),
    to: format(previousTo, "yyyy-MM-dd"),
  };
}

function summarizeCreativePerformance(
  cards: CreativeAssetCard[],
  from: string,
  to: string,
  cutoff: number,
): CreativePerformanceSummary {
  const testedCards = cards.filter((card) => {
    const created = card.firstAdCreatedAt?.slice(0, 10) ?? null;
    return Boolean(created && created >= from && created <= to);
  });
  const runningCards = cards.filter((card) => card.spend > 0);
  const validatedTests = testedCards.filter((card) => (card.roas ?? -Infinity) >= cutoff);
  const validatedRunning = runningCards.filter((card) => (card.roas ?? -Infinity) >= cutoff);
  const testSpend = testedCards.reduce((sum, card) => sum + card.spend, 0);
  const validatedTestSpend = validatedTests.reduce((sum, card) => sum + card.spend, 0);
  const generalSpend = runningCards.reduce((sum, card) => sum + card.spend, 0);
  const validatedGeneralSpend = validatedRunning.reduce((sum, card) => sum + card.spend, 0);
  const lifetimes = runningCards
    .map(creativeLifetimeDays)
    .filter((value): value is number => value != null);
  return {
    tested: testedCards.length,
    validatedTests: validatedTests.length,
    accuracy: testedCards.length > 0 ? validatedTests.length / testedCards.length * 100 : null,
    testSpend,
    validatedTestSpend,
    testEfficiency: testSpend > 0 ? validatedTestSpend / testSpend * 100 : null,
    running: runningCards.length,
    validatedRunning: validatedRunning.length,
    generalSpend,
    validatedGeneralSpend,
    generalEfficiency: generalSpend > 0 ? validatedGeneralSpend / generalSpend * 100 : null,
    averageLifetimeDays: lifetimes.length > 0
      ? lifetimes.reduce((sum, value) => sum + value, 0) / lifetimes.length
      : null,
    testedCards,
  };
}

function creativeLifetimeDays(card: CreativeAssetCard) {
  if (!card.firstAdCreatedAt || !card.lastSpendAt) return null;
  const created = parseISO(card.firstAdCreatedAt);
  const lastSpend = parseISO(card.lastSpendAt);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(lastSpend.getTime())) return null;
  return Math.max(1, differenceInCalendarDays(lastSpend, created) + 1);
}

function effectiveCreativeDeliveryStatus(card: CreativeAssetCard, rangeEnd: string) {
  if (card.deliveryStatus !== "unknown") return card.deliveryStatus;
  return card.lastSpendAt && card.lastSpendAt >= rangeEnd ? "active" : "paused";
}

function formatCreativeDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? format(parsed, "dd/MM/yyyy", { locale: ptBR }) : "—";
}

function metricDelta(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

function formatMetricAverage(label: string, value: number) {
  return label === "CPM" || label === "AOV" ? fBRL(value) : fPct(value, 1);
}

function pipelineProgressLabel(card: CreativeAssetCard) {
  switch (card.pipelineStatus) {
    case "transcribing":
    case "oversized_queued":
      return "Transcrevendo";
    case "analyzing":
      return card.transcript ? "Transcrição pronta · analisando insights" : "Analisando";
    case "ready":
      return card.analysisCoverage === "partial" ? "Pronto com análise parcial" : "Pronto";
    case "failed":
      return "Falhou";
    case "missing_media":
      return "Mídia indisponível";
    default:
      return "Não processado";
  }
}

function groupRuleChips(rules: CreativeGroupRules) {
  const chips: string[] = [];
  if (rules.minSpend != null) chips.push(`Gasto ≥ ${fBRL(rules.minSpend)}`);
  if (rules.minHookRate != null) chips.push(`Hook ≥ ${fPct(rules.minHookRate, 1)}`);
  if (rules.minRoas != null) chips.push(`ROAS ≥ ${rules.minRoas.toFixed(2)}x`);
  if (rules.minCtr != null) chips.push(`CTR ≥ ${fPct(rules.minCtr, 1)}`);
  if (rules.maxCpm != null) chips.push(`CPM ≤ ${fBRL(rules.maxCpm)}`);
  if (rules.campaignQuery) chips.push(`Campanha: ${rules.campaignQuery}`);
  if (rules.adsetQuery) chips.push(`Conjunto: ${rules.adsetQuery}`);
  if (rules.mediaType && rules.mediaType !== "all") chips.push(`Mídia: ${labelForMediaType(rules.mediaType)}`);
  return chips;
}

function MetricBar({
  label,
  value,
  metric,
  average,
  tone,
}: {
  label: string;
  value: string;
  metric: number | null | undefined;
  average: number | null;
  tone: "amber" | "cyan" | "emerald" | "violet";
}) {
  const difference = metric != null && average != null && average !== 0
    ? ((metric - average) / Math.abs(average)) * 100
    : null;
  const width = difference == null ? 0 : Math.min(50, Math.abs(difference) / 2);
  const above = (difference ?? 0) >= 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground" title={label}>{label}</span>
        <span className="shrink-0 tabular-nums text-xs font-medium text-foreground/80">{value}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div className="absolute left-1/2 top-0 h-full w-px bg-foreground/30" />
        <div
          className={cn(
            "absolute top-0 h-full rounded-full transition-all duration-500 ease-out",
            above ? "left-1/2" : "right-1/2",
            tone === "amber" && "bg-gradient-to-r from-amber-500 to-amber-400",
            tone === "cyan" && "bg-gradient-to-r from-cyan-500 to-cyan-400",
            tone === "emerald" && "bg-gradient-to-r from-emerald-500 to-emerald-400",
            tone === "violet" && "bg-gradient-to-r from-violet-500 to-violet-400",
          )}
          style={{ width: width > 0 ? `${Math.max(2, width)}%` : "0%" }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/70">
        <span>Média {average == null ? "—" : formatMetricAverage(label, average)}</span>
        <span className={cn(difference != null && (above ? "text-emerald-400" : "text-amber-400"))}>
          {difference == null ? "sem comparação" : `${above ? "+" : ""}${difference.toFixed(0)}%`}
        </span>
      </div>
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
        aria-label={mediaType === "video" ? "Abrir vídeo" : `Abrir ${labelForMediaType(mediaType).toLowerCase()}`}
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
  dimensionMetrics: AdDimensionMetricRow[],
) {
  const result = new Map<string, CreativeVturbMetrics>();

  for (const card of cards) {
    const adIds = new Set(card.adIds);
    const rows = dimensionMetrics.filter((row) => adIds.has(row.ad_id));
    const pageviews = rows.reduce((sum, row) => sum + numericMetric(row.pageviews), 0);
    const plays = rows.reduce((sum, row) => sum + numericMetric(row.plays_unicos), 0);
    const pitchReached = rows.reduce((sum, row) => sum + numericMetric(row.chegaram_pitch), 0);

    result.set(card.id, {
      pageviews,
      plays,
      pitchReached,
      playRate: pageviews > 0 ? (plays / pageviews) * 100 : null,
      pitchRetention: plays > 0 ? (pitchReached / plays) * 100 : null,
    });
  }

  return result;
}

function groupFormFromRow(group: CreativeGroupRow): GroupFormState {
  const rules = parseCreativeGroupRules(group.rules);
  const sortKeys: CreativeSortKey[] = [
    "purchases",
    "recent",
    "revenue",
    "profit",
    "order_bump_orders",
    "upsell_orders",
    "roas",
    "refund_rate",
    "aov",
    "hook_rate",
    "ctr",
    "cpm",
    "spend",
  ];
  const sortKey = sortKeys.includes(group.sort_key as CreativeSortKey)
    ? (group.sort_key as CreativeSortKey)
    : "purchases";

  return {
    name: group.name,
    mediaType: rules.mediaType ?? "all",
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

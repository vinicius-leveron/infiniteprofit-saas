import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HublaImportDialog } from "@/components/hubla/HublaImportDialog";
import { HotmartImportDialog } from "@/components/checkout/HotmartImportDialog";
import { OverviewPanel } from "@/components/OverviewPanel";
import { TrafficPanel } from "@/components/TrafficPanel";
import { FunnelPanel } from "@/components/FunnelPanel";
import { BumpsPanel } from "@/components/BumpsPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { AdsPanel } from "@/components/AdsPanel";
import { SimulatorPanel } from "@/components/SimulatorPanel";
import { SaveProjectDialog } from "@/components/SaveProjectDialog";
import { PeriodFilter, type Period } from "@/components/PeriodFilter";
import { DashboardMediaFilterBar } from "@/components/DashboardMediaFilterBar";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

import { DayDrilldownDialog } from "@/components/DayDrilldownDialog";
import { CommandPalette } from "@/components/CommandPalette";
import type { AppShellOutletContext } from "@/components/AppShell";
import { SheetSyncDialog } from "@/components/SheetSyncDialog";
import { parseCsv, type DailyRow } from "@/lib/csv";
import { dailyMetricsToDailyRows, type DailyMetricsRow } from "@/lib/dailyMetrics";
import {
  readStoredDashboardFilters,
  writeStoredDashboardFilters,
  type DashboardFilterState,
} from "@/lib/dashboardFilters";
import { getDashboardPeriodRows, getDashboardSelectedDateRange } from "@/lib/dashboardRows";
import { writeLastDashboardPreference } from "@/lib/lastDashboard";
import {
  applyDashboardDimensionMetrics,
  calculateAttributionCoverage,
  filterDashboardAdDimensions,
  getDashboardDimensionMetrics,
  hasDashboardMediaFilters,
  listDashboardAdDimensions,
  reconcileDashboardMediaFilters,
  type DashboardAdDimension,
  type DashboardAttributionCoverage,
} from "@/lib/dashboardDimensions";
import {
  getFunnelCheckoutBindingSafe,
  getProjectSyncSettingsSafe,
  listSourceHealthSignals,
  type CheckoutProvider,
  type SourceHealthSignalRow,
} from "@/lib/operationalReadApi";

import { exportElementToPdf } from "@/lib/exportPdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Radio,
  Target,
  Gift,
  Stethoscope,
  Settings2,
  Save,
  Download,
  Sliders,
  RefreshCw,
  Megaphone,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { trackProductEvent } from "@/lib/productEvents";

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "diagnostico" | "simulador";

const TAB_INFO: Record<Tab, { label: string; description: string; icon: React.ElementType }> = {
  geral: { label: "Visao Geral", description: "KPIs principais e performance consolidada", icon: BarChart3 },
  trafego: { label: "Trafego", description: "Metricas de aquisicao e custo por clique", icon: Radio },
  funil: { label: "Funil VSL", description: "Taxas de conversao em cada etapa do video", icon: Target },
  bumps: { label: "Bumps & Upsell", description: "Receita incremental e take-rate de ofertas", icon: Gift },
  anuncios: { label: "Anuncios", description: "Performance por campanha, adset e criativo", icon: Megaphone },
  diagnostico: { label: "Diagnóstico", description: "Comparativo do período e variações relevantes do dashboard", icon: Stethoscope },
  simulador: { label: "Simulador", description: "Projecoes e analise de sensibilidade", icon: Sliders },
};

const Index = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { commandPaletteOpen, setCommandPaletteOpen } =
    useOutletContext<AppShellOutletContext>();
  const projectId = searchParams.get("project");
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    currentWorkspace,
    isWorkspaceAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();

  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectWorkspaceId, setProjectWorkspaceId] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [metaSourceSignal, setMetaSourceSignal] =
    useState<SourceHealthSignalRow | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [projectSource, setProjectSource] = useState<"csv" | "sheet" | "api">("csv");
  const [checkoutProvider, setCheckoutProvider] =
    useState<CheckoutProvider | null>(null);
  const [rawApiRows, setRawApiRows] = useState<DailyRow[]>([]);
  const [mediaFilters, setMediaFilters] = useState<DashboardFilterState>({
    accountIds: [],
    campaignIds: [],
    adsetIds: [],
  });
  const [adDimensions, setAdDimensions] = useState<DashboardAdDimension[]>([]);
  const [dimensionsLoading, setDimensionsLoading] = useState(false);
  const [attributionCoverage, setAttributionCoverage] = useState<DashboardAttributionCoverage | null>(null);
  const [dimensionFilterError, setDimensionFilterError] = useState<string | null>(null);
  const [dimensionRetryKey, setDimensionRetryKey] = useState(0);

  // Tab vem do query param (sincronizado com sidebar)
  const requestedTab = searchParams.get("tab");
  const tab: Tab =
    requestedTab === "atribuicao" || requestedTab === "relatorio"
      ? "geral"
      : (requestedTab as Tab) || "geral";
  const setTab = useCallback((t: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", t);
    navigate(`/dashboard?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);

  useEffect(() => {
    if (requestedTab !== "atribuicao" && requestedTab !== "relatorio") return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", "geral");
    navigate(`/dashboard?${params.toString()}`, { replace: true });
  }, [navigate, requestedTab, searchParams]);
  const [period, setPeriod] = useState<Period>("this_month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [filtersHydratedFor, setFiltersHydratedFor] = useState<string | null>(null);

  // Drill-down
  const [drilldownRow, setDrilldownRow] = useState<DailyRow | null>(null);

  // Ref para captura PDF
  const dashboardRef = useRef<HTMLDivElement>(null);
  const dashboardOpenTracked = useRef(new Set<string>());

  // Redireciona se não autenticado
  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, userId, navigate]);

  useEffect(() => {
    if (!userId || !projectWorkspaceId || !currentProjectId) return;
    writeLastDashboardPreference({
      userId,
      clientId: projectWorkspaceId,
      funnelId: currentProjectId,
      dashboardTab: tab,
    });
  }, [currentProjectId, projectWorkspaceId, tab, userId]);

  useEffect(() => {
    if (
      !currentProjectId ||
      !projectWorkspaceId ||
      rows === null ||
      dashboardOpenTracked.current.has(currentProjectId)
    ) {
      return;
    }
    dashboardOpenTracked.current.add(currentProjectId);
    trackProductEvent({
      eventName: "first_dashboard_opened",
      workspaceId: projectWorkspaceId,
      projectId: currentProjectId,
      properties: {
        source: projectSource,
        has_data: rows.length > 0,
      },
    });
  }, [currentProjectId, projectSource, projectWorkspaceId, rows]);

  useEffect(() => {
    if (!currentProjectId) {
      setFiltersHydratedFor(null);
      return;
    }
    const stored = readStoredDashboardFilters(currentProjectId);
    setPeriod(stored.period ?? "this_month");
    setCustomFrom(stored.customFrom ?? "");
    setCustomTo(stored.customTo ?? "");
    setMediaFilters({
      accountIds: stored.accountIds ?? [],
      campaignIds: stored.campaignIds ?? [],
      adsetIds: stored.adsetIds ?? [],
    });
    setFiltersHydratedFor(currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId || filtersHydratedFor !== currentProjectId) return;
    writeStoredDashboardFilters(currentProjectId, {
      period,
      customFrom,
      customTo,
      accountIds: mediaFilters.accountIds,
      campaignIds: mediaFilters.campaignIds,
      adsetIds: mediaFilters.adsetIds,
    });
  }, [currentProjectId, customFrom, customTo, filtersHydratedFor, mediaFilters, period]);

  // Carrega projeto se vier ?project=ID
  useEffect(() => {
    if (!projectId || !userId) return;
    setLoadingProject(true);
    void supabase
      .from("projects")
      .select("id, name, file_name, csv_content, sheet_url, last_synced_at, source, workspace_id")
      .eq("id", projectId)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setLoadingProject(false);
          toast.error("Projeto não encontrado");
          navigate(
            currentWorkspace?.id
              ? `/clients/${currentWorkspace.id}/funnels`
              : "/clients",
            { replace: true },
          );
          return;
        }
        const src = (data.source ?? "csv") as "csv" | "sheet" | "api";
        setProjectSource(src);
        setProjectName(data.name);
        setCurrentProjectId(data.id);
        setProjectWorkspaceId(data.workspace_id ?? null);
        if (data.workspace_id && data.workspace_id !== currentWorkspace?.id) {
          setCurrentWorkspaceId(data.workspace_id);
        }
        setFileName(data.file_name ?? "");
        setSheetUrl(data.sheet_url ?? null);
        if (isWorkspaceAdmin) {
          try {
            const syncSettings = await getProjectSyncSettingsSafe(data.id);
            setSyncToken(syncSettings?.sync_token ?? null);
          } catch {
            setSyncToken(null);
            toast.error("Não foi possível carregar a credencial da planilha");
          }
        } else {
          setSyncToken(null);
        }
        setLastSyncedAt(data.last_synced_at ?? null);

        if (src === "api") {
          const [
            { data: metrics },
            { data: bindings },
            sourceSignals,
            checkoutBinding,
          ] =
            await Promise.all([
            supabase
              .from("daily_metrics")
              .select("*")
              .eq("project_id", data.id)
              .order("event_date", { ascending: true }),
            supabase
              .from("project_meta_accounts")
              .select("meta_account_id")
              .eq("project_id", data.id),
            listSourceHealthSignals(data.workspace_id),
            isWorkspaceAdmin
              ? getFunnelCheckoutBindingSafe(data.id).catch(() => null)
              : Promise.resolve(null),
          ]);
          setCheckoutProvider(checkoutBinding?.provider ?? null);
          const metaSignal =
            sourceSignals.find(
              (signal) =>
                signal.project_id === data.id && signal.source === "meta",
            ) ?? null;
          const hasMetaBindings = (bindings ?? []).length > 0;
          setMetaSourceSignal(metaSignal);
          setLastSyncedAt(
            metaSignal?.configured
              ? metaSignal.last_success_at
              : hasMetaBindings
                ? null
                : data.last_synced_at ?? null,
          );
          const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
          setRawApiRows(apiRows);
          setRows(apiRows);
          setCsvText("");
        } else if (data.csv_content) {
          setCheckoutProvider(null);
          setMetaSourceSignal(null);
          const parsed = parseCsv(data.csv_content);
          setRows(parsed.rows);
          setCsvText(data.csv_content);
        } else {
          setCheckoutProvider(null);
          setMetaSourceSignal(null);
          setRows([]);
          setCsvText("");
        }
        setLoadingProject(false);
      });
  }, [currentWorkspace?.id, isWorkspaceAdmin, navigate, projectId, setCurrentWorkspaceId, userId]);

  const reloadProject = async () => {
    if (!currentProjectId) return;
    if (projectSource === "api") {
      const workspaceId = projectWorkspaceId ?? currentWorkspace?.id;
      const [metricsResult, bindingsResult, sourceSignals] = await Promise.all([
        supabase
          .from("daily_metrics")
          .select("*")
          .eq("project_id", currentProjectId)
          .order("event_date", { ascending: true }),
        supabase
          .from("project_meta_accounts")
          .select("meta_account_id")
          .eq("project_id", currentProjectId),
        workspaceId
          ? listSourceHealthSignals(workspaceId)
          : Promise.resolve([]),
      ]);
      if (metricsResult.error) throw metricsResult.error;
      if (bindingsResult.error) throw bindingsResult.error;
      const metrics = metricsResult.data;
      const bindings = bindingsResult.data;
      const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
      setRawApiRows(apiRows);
      setRows(apiRows);
      const metaSignal =
        sourceSignals.find(
          (signal) =>
            signal.project_id === currentProjectId &&
            signal.source === "meta",
        ) ?? null;
      setMetaSourceSignal(metaSignal);
      setLastSyncedAt(
        metaSignal?.configured ? metaSignal.last_success_at : null,
      );
      return;
    }
    const { data, error } = await supabase
      .from("projects")
      .select("csv_content, file_name, last_synced_at")
      .eq("id", currentProjectId)
      .maybeSingle();
    if (error) throw error;
    if (!data || !data.csv_content) return;
    const parsed = parseCsv(data.csv_content);
    setRows(parsed.rows);
    setCsvText(data.csv_content);
    if (data.file_name) setFileName(data.file_name);
    setLastSyncedAt(data.last_synced_at ?? null);
  };

  useEffect(() => {
    if (projectSource !== "api" || !currentProjectId) {
      setAdDimensions([]);
      return;
    }
    let cancelled = false;
    setDimensionsLoading(true);
    setDimensionFilterError(null);
    void listDashboardAdDimensions(currentProjectId)
      .then((dimensions) => {
        if (!cancelled) {
          setAdDimensions(dimensions);
          setMediaFilters((current) =>
            reconcileDashboardMediaFilters(dimensions, current)
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAdDimensions([]);
          setDimensionFilterError(error instanceof Error ? error.message : "Não foi possível carregar os filtros de mídia.");
        }
      })
      .finally(() => {
        if (!cancelled) setDimensionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentProjectId, dimensionRetryKey, projectSource]);

  // A mesma agregação dimensional alimenta todas as abas do Dashboard.
  useEffect(() => {
    if (projectSource !== "api") return;
    if (!hasDashboardMediaFilters(mediaFilters)) {
      setRows(rawApiRows);
      setAttributionCoverage(null);
      setDimensionFilterError(null);
      return;
    }
    if (!currentProjectId) return;
    let cancelled = false;
    setDimensionsLoading(true);
    void getDashboardDimensionMetrics(currentProjectId, mediaFilters)
      .then((dimensionRows) => {
        if (cancelled) return;
        const selectedBaseRows = getDashboardPeriodRows(
          rawApiRows,
          period,
          customFrom,
          customTo,
        ).current;
        const selectedRange = getDashboardSelectedDateRange(
          rawApiRows,
          period,
          customFrom,
          customTo,
        );
        const selectedDimensionRows = dimensionRows.filter((row) =>
          (!selectedRange.from || row.event_date >= selectedRange.from) &&
          (!selectedRange.to || row.event_date <= selectedRange.to)
        );
        setRows(applyDashboardDimensionMetrics(rawApiRows, dimensionRows));
        setAttributionCoverage(calculateAttributionCoverage(selectedBaseRows, selectedDimensionRows));
        setDimensionFilterError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setRows([]);
        setAttributionCoverage(null);
        setDimensionFilterError(error instanceof Error ? error.message : "Falha ao aplicar os filtros.");
      })
      .finally(() => {
        if (!cancelled) setDimensionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    currentProjectId,
    customFrom,
    customTo,
    dimensionRetryKey,
    mediaFilters,
    period,
    projectSource,
    rawApiRows,
  ]);

  const handleQuickSync = async () => {
    if (!currentProjectId) return;
    if (projectSource === "sheet" && !sheetUrl) {
      setSyncDialogOpen(true);
      return;
    }
    setSyncingNow(true);
    try {
      if (projectSource === "sheet" && sheetUrl) {
        const { data, error } = await supabase.functions.invoke("pull-sheet", {
          body: { projectId: currentProjectId },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      await reloadProject();
      toast.success(projectSource === "sheet" ? "Planilha sincronizada" : "Dados atualizados");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar";
      toast.error(msg);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleSave = async (name: string) => {
    if (!user || !csvText || !currentWorkspace?.id) return;
    setSaving(true);
    try {
      if (currentProjectId) {
        const { error } = await supabase
          .from("projects")
          .update({ name, file_name: fileName, csv_content: csvText })
          .eq("id", currentProjectId);
        if (error) throw error;
        toast.success("Projeto atualizado");
      } else {
        const { data, error } = await supabase
          .from("projects")
          .insert({
            user_id: user.id,
            workspace_id: currentWorkspace.id,
            name,
            file_name: fileName,
            csv_content: csvText,
          })
          .select("id")
          .single();
        if (error) throw error;
        setCurrentProjectId(data.id);
        setProjectWorkspaceId(currentWorkspace.id);
        toast.success("Projeto salvo");
      }
      setProjectName(name);
      setSaveDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const { current: filtered, previous } = useMemo(() => {
    if (!rows) return { current: [] as DailyRow[], previous: [] as DailyRow[] };
    return getDashboardPeriodRows(rows, period, customFrom, customTo);
  }, [rows, period, customFrom, customTo]);

  const selectedDateRange = useMemo(() => {
    if (!rows) return { from: null, to: null };
    return getDashboardSelectedDateRange(rows, period, customFrom, customTo);
  }, [rows, period, customFrom, customTo]);

  // (Os totais para Insights da IA agora são calculados dentro do DiagnosticsPanel)

  // Atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignora se input/textarea estiver em foco
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (isTyping) return;

      if (e.key >= "1" && e.key <= "7") {
        const map: Tab[] = ["geral", "trafego", "funil", "bumps", "anuncios", "diagnostico", "simulador"];
        const idx = parseInt(e.key, 10) - 1;
        if (map[idx]) setTab(map[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  if (authLoading || loadingProject) {
    return <DashboardSkeleton />;
  }

  if (!rows) return <DashboardSkeleton />;

  const periodLabel =
    selectedDateRange.from && selectedDateRange.to
      ? `${formatDateKey(selectedDateRange.from)} → ${formatDateKey(selectedDateRange.to)} · ${filtered.length} dias com dados`
      : "Sem dados no período";
  const metaFailureIsLatest = Boolean(
    metaSourceSignal?.configured &&
      (
        metaSourceSignal.critical_count > 0 ||
        (
          metaSourceSignal.last_error_at &&
          (
            !metaSourceSignal.last_success_at ||
            new Date(metaSourceSignal.last_error_at).getTime() >
              new Date(metaSourceSignal.last_success_at).getTime()
          )
        )
      ),
  );
  const metaIsSyncing =
    metaSourceSignal?.sync_status === "queued" ||
    metaSourceSignal?.sync_status === "running";

  const handlePeriodChange = (p: Period) => {
    setPeriod(p);
    if (p !== "custom") {
      setCustomFrom("");
      setCustomTo("");
    }
  };

  const handleCustomChange = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (from || to) setPeriod("custom");
  };

  const handleExportPdf = async () => {
    if (!dashboardRef.current) return;
    const safeName = (projectName || "dashboard").replace(/[^\w-]+/g, "_");
    await exportElementToPdf(
      dashboardRef.current,
      `${safeName}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
    );
  };


  const showOperationalActions = tab === "diagnostico" && projectSource === "api" && !!currentProjectId;
  const hasMediaFilters = hasDashboardMediaFilters(mediaFilters);
  const allowedAdIds = hasMediaFilters
    ? filterDashboardAdDimensions(adDimensions, mediaFilters)
      .map((dimension) => dimension.ad_id)
    : null;

  return (
    <main className="min-h-screen">
      {/* Sticky header */}
      {/* Sticky header - Estilo SaaS */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border/60">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 md:px-6">
          {/* Contexto do projeto */}
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground truncate">
              {projectName || "Dashboard"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {periodLabel}
              {metaFailureIsLatest && currentProjectId ? (
                <button
                  type="button"
                  className="ml-1.5 inline-flex items-center gap-1 font-medium text-destructive hover:underline"
                  onClick={() => navigate(`/funnels/${currentProjectId}/health`)}
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  · Meta requer ação
                </button>
              ) : metaIsSyncing ? (
                <span className="ml-1.5 text-blue-600 dark:text-blue-300">
                  · Meta sincronizando
                </span>
              ) : lastSyncedAt && (
                <span className="ml-1.5">
                  · {projectSource === "api" && metaSourceSignal?.configured
                    ? "Meta "
                    : "Sync "}
                  {formatDistanceToNow(new Date(lastSyncedAt), { locale: ptBR })}
                </span>
              )}
            </p>
          </div>

          {/* Acoes */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Acoes secundarias */}
            <div className="flex items-center gap-1">
              {currentProjectId && isWorkspaceAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={handleQuickSync}
                  disabled={syncingNow}
                  title="Atualizar dados do dashboard"
                >
                  <RefreshCw className={cn("w-4 h-4", syncingNow && "animate-spin")} />
                  <span className="hidden sm:inline">Atualizar</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleExportPdf}
                title="Exportar PDF"
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>

            {/* Acao primaria */}
            {projectSource !== "api" && (
              <Button size="sm" onClick={() => setSaveDialogOpen(true)}>
                <Save className="w-4 h-4 mr-1.5" />
                Salvar
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
        {/* Tab Header + Period filter */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          {/* Tab title */}
          {(() => {
            const info = TAB_INFO[tab];
            return (
              <div>
                <h2 className="text-base font-semibold text-foreground">{info.label}</h2>
                <p className="text-xs text-muted-foreground">{info.description}</p>
              </div>
            );
          })()}

          {/* Filters */}
          {projectSource !== "api" && (
            <div className="flex flex-wrap items-end gap-3">
              <PeriodFilter
                period={period}
                customFrom={customFrom}
                customTo={customTo}
                onPeriodChange={handlePeriodChange}
                onCustomChange={handleCustomChange}
              />
            </div>
          )}
        </div>

        {projectSource === "api" && (
          <div className="mb-6 space-y-3">
            <DashboardMediaFilterBar
              dimensions={adDimensions}
              value={mediaFilters}
              onChange={setMediaFilters}
              loading={dimensionsLoading}
              periodControl={(
                <PeriodFilter
                  period={period}
                  customFrom={customFrom}
                  customTo={customTo}
                  onPeriodChange={handlePeriodChange}
                  onCustomChange={handleCustomChange}
                  showLabel={false}
                />
              )}
            />
            {hasMediaFilters && attributionCoverage && (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Resultado atribuído aos anúncios selecionados. Eventos sem identificação confiável ficam fora.
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  Cobertura: vendas {attributionCoverage.frontSalesPercent.toFixed(0)}% · faturamento {attributionCoverage.revenuePercent.toFixed(0)}% · VSL {attributionCoverage.vslPercent.toFixed(0)}%
                </span>
              </div>
            )}
            {dimensionFilterError && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <span>{dimensionFilterError}</span>
                <Button variant="outline" size="sm" onClick={() => setDimensionRetryKey((value) => value + 1)}>
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>
        )}

        {rows.length === 0 && projectSource === "api" && currentProjectId && !hasMediaFilters ? (
          <div className="section-card py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Radio className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-foreground">
              {isWorkspaceAdmin
                ? "Seu funil está pronto para receber o primeiro sinal"
                : "Aguardando a primeira sincronização"}
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-5 text-muted-foreground">
              {isWorkspaceAdmin
                ? `Conecte uma fonte, importe o histórico ${
                  checkoutProvider === "hotmart" ? "da Hotmart" : "da Hubla"
                } ou revise a saúde do funil. Assim que houver um sinal confiável, o dashboard será preenchido automaticamente.`
                : "Um administrador ainda está conectando as fontes deste funil. Você pode acompanhar o status permitido sem acessar credenciais ou ações operacionais."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {isWorkspaceAdmin && (
                <>
                  <Button
                    className="min-h-11 gap-2"
                    onClick={() => navigate(`/funnels/${currentProjectId}/sources`)}
                  >
                    <Settings2 className="h-4 w-4" />
                    Conectar fonte
                  </Button>
                  {checkoutProvider === "hotmart" ? (
                    <HotmartImportDialog
                      projectId={currentProjectId}
                      onImported={() => reloadProject()}
                    />
                  ) : (
                    <HublaImportDialog
                      projectId={currentProjectId}
                      onImported={() => reloadProject()}
                    />
                  )}
                </>
              )}
              <Button
                variant="outline"
                className="min-h-11 gap-2"
                onClick={() => navigate(`/funnels/${currentProjectId}/health`)}
              >
                <Stethoscope className="h-4 w-4" />
                Ver saúde
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="section-card text-center py-20">
            <div className="w-14 h-14 rounded-full bg-secondary/60 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {hasMediaFilters ? "Nenhum sinal atribuído a esta seleção" : "Nenhum dia no período"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {hasMediaFilters
                ? "As vendas e sessões sem ad_id ou UTM confiável não são exibidas como zero. Ajuste os filtros ou revise a cobertura de atribuição."
                : "Tente ajustar o período para visualizar os dados disponíveis."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => hasMediaFilters
                ? setMediaFilters({ accountIds: [], campaignIds: [], adsetIds: [] })
                : handlePeriodChange("all")}
            >
              {hasMediaFilters ? "Limpar filtros de mídia" : "Mostrar tudo"}
            </Button>
          </div>
        ) : (
          <div ref={dashboardRef} className="space-y-6">
            {showOperationalActions && (
              <div className="section-card border-primary/20 bg-primary/5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Esta aba mostra alertas comparativos do dashboard
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Para revisar integrações, eventos recebidos e sincronizar manualmente, abra a tela operacional da operação.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/diagnostics?project=${currentProjectId}`)}
                      className="gap-2"
                    >
                      <Stethoscope className="w-4 h-4" />
                      Diagnóstico operacional
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/connections?project=${currentProjectId}`)}
                      className="gap-2"
                    >
                      <Settings2 className="w-4 h-4" />
                      Conexões / sync
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {tab === "geral" ? (
              <OverviewPanel rows={filtered} previous={previous} onDayClick={setDrilldownRow} />
            ) : tab === "trafego" ? (
              <TrafficPanel
                rows={filtered}
                previous={previous}
                projectId={currentProjectId}
                dateRange={selectedDateRange}
                mediaFilters={mediaFilters}
              />
            ) : tab === "funil" ? (
              <FunnelPanel rows={filtered} />
            ) : tab === "bumps" ? (
              <BumpsPanel rows={filtered} />
            ) : tab === "anuncios" ? (
              <AdsPanel
                projectId={currentProjectId}
                dateRange={selectedDateRange}
                allowedAdIds={allowedAdIds}
                canManage={isWorkspaceAdmin}
              />
            ) : tab === "diagnostico" ? (
              <DiagnosticsPanel current={filtered} previous={previous} />
            ) : (
              <SimulatorPanel rows={filtered} />
            )}
          </div>
        )}

        <footer className="mt-12 pb-4 text-center text-xs text-muted-foreground">
          Infinite Profit · Dashboard de KPIs
        </footer>
      </div>

      <SaveProjectDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        defaultName={projectName}
        saving={saving}
        onSave={handleSave}
        isUpdate={!!currentProjectId}
      />

      <DayDrilldownDialog
        row={drilldownRow}
        onOpenChange={(o) => !o && setDrilldownRow(null)}
        projectId={currentProjectId}
        editable={projectSource === "api" && isWorkspaceAdmin}
        onObsSaved={(date, obs) => {
          // Atualiza in-memory pra UX instantânea
          const ts = date.getTime();
          setRawApiRows((arr) => arr.map((r) => (r.date?.getTime() === ts ? { ...r, obs } : r)));
          setRows((arr) => arr.map((r) => (r.date?.getTime() === ts ? { ...r, obs } : r)));
          setDrilldownRow((r) => (r && r.date?.getTime() === ts ? { ...r, obs } : r));
        }}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onSelectTab={setTab}
        onSelectPeriod={handlePeriodChange}
      />

      <SheetSyncDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        projectId={currentProjectId}
        initialUrl={sheetUrl}
        initialToken={syncToken}
        lastSyncedAt={lastSyncedAt}
        onSaved={({ sheet_url, sync_token }) => {
          setSheetUrl(sheet_url);
          setSyncToken(sync_token);
        }}
        onSynced={() => {
          void reloadProject();
        }}
      />
    </main>
  );
};

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default Index;

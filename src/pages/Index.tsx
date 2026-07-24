import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HublaImportDialog } from "@/components/hubla/HublaImportDialog";
import { OverviewPanel } from "@/components/OverviewPanel";
import { TrafficPanel } from "@/components/TrafficPanel";
import { FunnelPanel } from "@/components/FunnelPanel";
import { BumpsPanel } from "@/components/BumpsPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { AdsPanel } from "@/components/AdsPanel";
import { AttributionPanel } from "@/components/AttributionPanel";
import { ExecutiveReportPanel } from "@/components/ExecutiveReportPanel";
import { SimulatorPanel } from "@/components/SimulatorPanel";
import { SaveProjectDialog } from "@/components/SaveProjectDialog";
import { PeriodFilter, type Period } from "@/components/PeriodFilter";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";

import { DayDrilldownDialog } from "@/components/DayDrilldownDialog";
import { CommandPalette } from "@/components/CommandPalette";
import type { AppShellOutletContext } from "@/components/AppShell";
import { SheetSyncDialog } from "@/components/SheetSyncDialog";
import { parseCsv, type DailyRow } from "@/lib/csv";
import { dailyMetricsToDailyRows, type DailyMetricsRow } from "@/lib/dailyMetrics";
import { readStoredDashboardFilters, writeStoredDashboardFilters } from "@/lib/dashboardFilters";
import { getDashboardPeriodRows, getDashboardSelectedDateRange } from "@/lib/dashboardRows";
import { writeLastDashboardPreference } from "@/lib/lastDashboard";
import { applyMetaAccountFilter } from "@/lib/metaAccountFilter";
import {
  getProjectSyncSettingsSafe,
  listSourceHealthSignals,
  listWorkspaceMetaAccountsSafe,
  type SourceHealthSignalRow,
} from "@/lib/operationalReadApi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  Map,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { trackProductEvent } from "@/lib/productEvents";

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "atribuicao" | "relatorio" | "diagnostico" | "simulador";

const TAB_INFO: Record<Tab, { label: string; description: string; icon: React.ElementType }> = {
  geral: { label: "Visao Geral", description: "KPIs principais e performance consolidada", icon: BarChart3 },
  trafego: { label: "Trafego", description: "Metricas de aquisicao e custo por clique", icon: Radio },
  funil: { label: "Funil VSL", description: "Taxas de conversao em cada etapa do video", icon: Target },
  bumps: { label: "Bumps & Upsell", description: "Receita incremental e take-rate de ofertas", icon: Gift },
  anuncios: { label: "Anuncios", description: "Performance por campanha, adset e criativo", icon: Megaphone },
  atribuicao: { label: "Atribuicao", description: "Cruzamento diario entre fontes de dados", icon: Map },
  relatorio: { label: "Relatorio Executivo", description: "Resumo para tomada de decisao", icon: FileText },
  diagnostico: { label: "Alertas", description: "Comparativo do periodo e variacoes relevantes do dashboard", icon: Stethoscope },
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
  const [rawApiRows, setRawApiRows] = useState<DailyRow[]>([]);
  const [metaAccounts, setMetaAccounts] = useState<Array<{ account_id: string; label: string | null }>>([]);
  const [accountFilter, setAccountFilter] = useState<string>("all");

  // Tab vem do query param (sincronizado com sidebar)
  const tab = (searchParams.get("tab") as Tab) || "geral";
  const setTab = useCallback((t: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", t);
    navigate(`/dashboard?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [filtersHydratedFor, setFiltersHydratedFor] = useState<string | null>(null);

  // Drill-down
  const [drilldownRow, setDrilldownRow] = useState<DailyRow | null>(null);

  // Ref para captura PDF
  const dashboardRef = useRef<HTMLDivElement>(null);
  const dashboardOpenTracked = useRef(new Set<string>());

  interface ProjectMetaBindingRow {
    meta_account_id: string;
  }

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
    setPeriod(stored.period ?? "all");
    setCustomFrom(stored.customFrom ?? "");
    setCustomTo(stored.customTo ?? "");
    setAccountFilter(stored.accountFilter ?? "all");
    setFiltersHydratedFor(currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    if (!currentProjectId || filtersHydratedFor !== currentProjectId) return;
    writeStoredDashboardFilters(currentProjectId, {
      period,
      customFrom,
      customTo,
      accountFilter,
    });
  }, [accountFilter, currentProjectId, customFrom, customTo, filtersHydratedFor, period]);

  useEffect(() => {
    if (projectSource !== "api" || accountFilter === "all" || metaAccounts.length === 0) return;
    if (!metaAccounts.some((account) => account.account_id === accountFilter)) {
      setAccountFilter("all");
    }
  }, [accountFilter, metaAccounts, projectSource]);

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
          const [{ data: metrics }, { data: bindings }, sourceSignals] =
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
          ]);
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
          let accs: Array<{ account_id: string; label: string | null }> = [];
          const accountIds = ((bindings ?? []) as ProjectMetaBindingRow[]).map((binding) => binding.meta_account_id);
          if (accountIds.length > 0 && data.workspace_id) {
            const accountRows = await listWorkspaceMetaAccountsSafe(data.workspace_id);
            const selectedAccountIds = new Set(accountIds);
            accs = accountRows
              .filter((account) => selectedAccountIds.has(account.id))
              .map(({ account_id, label }) => ({ account_id, label }));
          }
          const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
          setRawApiRows(apiRows);
          setRows(apiRows);
          setMetaAccounts(accs);
          setCsvText("");
        } else if (data.csv_content) {
          setMetaSourceSignal(null);
          const parsed = parseCsv(data.csv_content);
          setRows(parsed.rows);
          setCsvText(data.csv_content);
        } else {
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
      let accs: Array<{ account_id: string; label: string | null }> = [];
      const accountIds = ((bindings ?? []) as ProjectMetaBindingRow[]).map((binding) => binding.meta_account_id);
      if (accountIds.length > 0 && workspaceId) {
        const accountRows = await listWorkspaceMetaAccountsSafe(workspaceId);
        const selectedAccountIds = new Set(accountIds);
        accs = accountRows
          .filter((account) => selectedAccountIds.has(account.id))
          .map(({ account_id, label }) => ({ account_id, label }));
      }
      const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
      setRawApiRows(apiRows);
      setRows(apiRows);
      setMetaAccounts(accs);
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

  // Aplica filtro de conta Meta (somente projetos API)
  useEffect(() => {
    if (projectSource !== "api") return;
    if (rawApiRows.length === 0) return;
    if (accountFilter === "all") {
      setRows(rawApiRows);
      return;
    }
    if (!currentProjectId) return;
    let cancelled = false;
    void applyMetaAccountFilter(rawApiRows, currentProjectId, accountFilter).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => { cancelled = true; };
  }, [accountFilter, rawApiRows, projectSource, currentProjectId]);

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

      if (e.key >= "1" && e.key <= "9") {
        const map: Tab[] = ["geral", "trafego", "funil", "bumps", "anuncios", "atribuicao", "relatorio", "diagnostico", "simulador"];
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


  // Refetch key para insights — muda sempre que projeto/período muda
  const insightsKey = `${currentProjectId ?? "local"}|${period}|${customFrom}|${customTo}|${filtered.length}`;
  const showOperationalActions = tab === "diagnostico" && projectSource === "api" && !!currentProjectId;

  return (
    <main className="min-h-screen">
      {/* Sticky header */}
      {/* Sticky header - Estilo SaaS */}
      <div className="sticky top-14 z-30 bg-background/95 backdrop-blur-sm border-b border-border/60">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
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
              {currentProjectId && (
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

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 md:py-8">
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
          <div className="flex flex-wrap items-end gap-3">
            <PeriodFilter
              period={period}
              customFrom={customFrom}
              customTo={customTo}
              onPeriodChange={handlePeriodChange}
              onCustomChange={handleCustomChange}
            />
            {projectSource === "api" && metaAccounts.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Conta Meta
                </span>
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="h-9 min-w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as contas</SelectItem>
                    {metaAccounts.map((a) => (
                      <SelectItem key={a.account_id} value={a.account_id}>
                        {a.label || a.account_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {rows.length === 0 && projectSource === "api" && currentProjectId ? (
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
                ? "Conecte uma fonte, importe o histórico da Hubla ou revise a saúde do funil. Assim que houver um sinal confiável, o dashboard será preenchido automaticamente."
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
                  <HublaImportDialog
                    projectId={currentProjectId}
                    onImported={() => reloadProject()}
                  />
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
            <h3 className="font-semibold text-foreground mb-1">Nenhum dia no período</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Tente ajustar o período para visualizar os dados disponíveis.
            </p>
            <Button variant="outline" size="sm" onClick={() => handlePeriodChange("all")}>
              Mostrar tudo
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
              />
            ) : tab === "funil" ? (
              <FunnelPanel rows={filtered} projectId={currentProjectId} dateRange={selectedDateRange} />
            ) : tab === "bumps" ? (
              <BumpsPanel rows={filtered} />
            ) : tab === "anuncios" ? (
              <AdsPanel
                projectId={currentProjectId}
                dateRange={selectedDateRange}
              />
            ) : tab === "atribuicao" ? (
              <AttributionPanel rows={filtered} projectId={currentProjectId} />
            ) : tab === "relatorio" ? (
              <ExecutiveReportPanel current={filtered} previous={previous} />
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
        editable={projectSource === "api"}
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

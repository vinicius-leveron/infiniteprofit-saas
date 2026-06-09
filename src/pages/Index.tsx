import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CsvUpload } from "@/components/CsvUpload";
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
import { SheetSyncDialog } from "@/components/SheetSyncDialog";
import { parseCsv, type DailyRow } from "@/lib/csv";
import { dailyMetricsToDailyRows, type DailyMetricsRow } from "@/lib/dailyMetrics";
import { applyMetaAccountFilter } from "@/lib/metaAccountFilter";
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
  ArrowLeft,
  BarChart3,
  Radio,
  Target,
  Gift,
  Stethoscope,
  Settings2,
  Save,
  Download,
  Search,
  Sliders,
  RefreshCw,
  Megaphone,
  Map,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

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
  const projectId = searchParams.get("project");
  const { user, loading: authLoading } = useAuth();
  const { currentWorkspace, setCurrentWorkspaceId } = useWorkspace();

  const [rows, setRows] = useState<DailyRow[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
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

  // Drill-down + Command palette
  const [drilldownRow, setDrilldownRow] = useState<DailyRow | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Ref para captura PDF
  const dashboardRef = useRef<HTMLDivElement>(null);

  interface ProjectMetaBindingRow {
    meta_account_id: string;
  }

  // Redireciona se não autenticado
  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);

  // Carrega projeto se vier ?project=ID
  useEffect(() => {
    if (!projectId || !user) return;
    setLoadingProject(true);
    void supabase
      .from("projects")
      .select("id, name, file_name, csv_content, sheet_url, sync_token, last_synced_at, source, workspace_id")
      .eq("id", projectId)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error || !data) {
          setLoadingProject(false);
          toast.error("Projeto não encontrado");
          navigate("/projects", { replace: true });
          return;
        }
        const src = (data.source ?? "csv") as "csv" | "sheet" | "api";
        setProjectSource(src);
        setProjectName(data.name);
        setCurrentProjectId(data.id);
        if (data.workspace_id && data.workspace_id !== currentWorkspace?.id) {
          setCurrentWorkspaceId(data.workspace_id);
        }
        setFileName(data.file_name ?? "");
        setSheetUrl(data.sheet_url ?? null);
        setSyncToken(data.sync_token ?? null);
        setLastSyncedAt(data.last_synced_at ?? null);

        if (src === "api") {
          const [{ data: metrics }, { data: bindings }] = await Promise.all([
            supabase
              .from("daily_metrics")
              .select("*")
              .eq("project_id", data.id)
              .order("event_date", { ascending: true }),
            supabase
              .from("project_meta_accounts")
              .select("meta_account_id")
              .eq("project_id", data.id)
          ]);
          let accs: Array<{ account_id: string; label: string | null }> = [];
          const accountIds = ((bindings ?? []) as ProjectMetaBindingRow[]).map((binding) => binding.meta_account_id);
          if (accountIds.length > 0) {
            const { data: accountRows } = await supabase
              .from("workspace_meta_accounts")
              .select("account_id, label")
              .in("id", accountIds)
              .order("created_at", { ascending: true });
            accs = (accountRows ?? []) as Array<{ account_id: string; label: string | null }>;
          }
          const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
          setRawApiRows(apiRows);
          setRows(apiRows);
          setMetaAccounts(accs);
          setCsvText("");
        } else if (data.csv_content) {
          const parsed = parseCsv(data.csv_content);
          setRows(parsed.rows);
          setCsvText(data.csv_content);
        } else {
          setRows([]);
          setCsvText("");
        }
        setLoadingProject(false);
      });
  }, [currentWorkspace?.id, navigate, projectId, setCurrentWorkspaceId, user]);

  const reloadProject = async () => {
    if (!currentProjectId) return;
    if (projectSource === "api") {
      const [{ data: metrics }, { data: bindings }] = await Promise.all([
        supabase
          .from("daily_metrics")
          .select("*")
          .eq("project_id", currentProjectId)
          .order("event_date", { ascending: true }),
        supabase
          .from("project_meta_accounts")
          .select("meta_account_id")
          .eq("project_id", currentProjectId)
      ]);
      let accs: Array<{ account_id: string; label: string | null }> = [];
      const accountIds = ((bindings ?? []) as ProjectMetaBindingRow[]).map((binding) => binding.meta_account_id);
      if (accountIds.length > 0) {
        const { data: accountRows } = await supabase
          .from("workspace_meta_accounts")
          .select("account_id, label")
          .in("id", accountIds)
          .order("created_at", { ascending: true });
        accs = (accountRows ?? []) as Array<{ account_id: string; label: string | null }>;
      }
      const apiRows = dailyMetricsToDailyRows((metrics ?? []) as unknown as DailyMetricsRow[]);
      setRawApiRows(apiRows);
      setRows(apiRows);
      setMetaAccounts(accs);
      const { data: proj } = await supabase
        .from("projects")
        .select("last_synced_at")
        .eq("id", currentProjectId)
        .maybeSingle();
      if (proj) setLastSyncedAt(proj.last_synced_at ?? null);
      return;
    }
    const { data, error } = await supabase
      .from("projects")
      .select("csv_content, file_name, last_synced_at")
      .eq("id", currentProjectId)
      .maybeSingle();
    if (error || !data || !data.csv_content) return;
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
    if (!sheetUrl) {
      setSyncDialogOpen(true);
      return;
    }
    setSyncingNow(true);
    try {
      const { data, error } = await supabase.functions.invoke("pull-sheet", {
        body: { projectId: currentProjectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await reloadProject();
      toast.success("Planilha sincronizada");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar";
      toast.error(msg);
    } finally {
      setSyncingNow(false);
    }
  };

  const handleFile = (text: string, name: string) => {
    const parsed = parseCsv(text);
    setRows(parsed.rows);
    setFileName(name);
    setCsvText(text);
    setProjectName(name.replace(/\.[^.]+$/, ""));
    setCurrentProjectId(null);
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

    const active = rows.filter(
      (r) =>
        r.date &&
        ((r.investimento ?? 0) > 0 ||
          (r.vendasTotais ?? 0) > 0 ||
          (r.fatLiquido ?? 0) > 0),
    );

    if (period === "all") {
      return { current: active, previous: [] };
    }
    if (period === "custom") {
      const from = customFrom ? new Date(customFrom) : null;
      const to = customTo ? new Date(customTo) : null;
      const cur = active.filter((r) => {
        if (!r.date) return false;
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        return true;
      });
      let prev: DailyRow[] = [];
      if (from && to) {
        const dur = to.getTime() - from.getTime();
        const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
        const prevFrom = new Date(prevTo.getTime() - dur);
        prev = active.filter((r) => r.date && r.date >= prevFrom && r.date <= prevTo);
      } else if (cur.length) {
        const firstIdx = active.findIndex((r) => r === cur[0]);
        prev = firstIdx > 0 ? active.slice(Math.max(0, firstIdx - cur.length), firstIdx) : [];
      }
      return { current: cur, previous: prev };
    }
    const n = period === "7d" ? 7 : period === "15d" ? 15 : 30;
    const cur = active.slice(-n);
    const prev = active.slice(Math.max(0, active.length - n * 2), active.length - n);
    return { current: cur, previous: prev };
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

      // ⌘K / Ctrl+K abre palette mesmo digitando
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }

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

  if (!rows) {
    return (
      <main className="min-h-screen">
        <div className="max-w-[900px] mx-auto px-4 pt-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Voltar para projetos
          </Button>
        </div>
        <CsvUpload onFile={handleFile} />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </main>
    );
  }

  const periodLabel =
    filtered.length > 0 && filtered[0].date && filtered[filtered.length - 1].date
      ? `${format(filtered[0].date!, "dd/MM/yyyy")} → ${format(filtered[filtered.length - 1].date!, "dd/MM/yyyy")} · ${filtered.length} dias`
      : "Sem dados no período";

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
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/60">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          {/* Contexto do projeto */}
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground truncate">
              {projectName || "Dashboard"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {periodLabel}
              {lastSyncedAt && (
                <span className="ml-1.5">
                  · Sync {formatDistanceToNow(new Date(lastSyncedAt), { locale: ptBR })}
                </span>
              )}
            </p>
          </div>

          {/* Acoes */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Search */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 hover:bg-muted/50 transition-colors text-sm text-muted-foreground"
            >
              <Search className="w-4 h-4" />
              <span>Buscar...</span>
            </button>

            {/* Acoes secundarias */}
            <div className="flex items-center gap-1">
              {currentProjectId && sheetUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleQuickSync}
                  disabled={syncingNow}
                  title="Sincronizar dados"
                >
                  <RefreshCw className={cn("w-4 h-4", syncingNow && "animate-spin")} />
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
            <Button size="sm" onClick={() => setSaveDialogOpen(true)}>
              <Save className="w-4 h-4 mr-1.5" />
              Salvar
            </Button>
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

        {filtered.length === 0 ? (
          <div className="section-card text-center py-20">
            <div className="w-14 h-14 rounded-full bg-secondary/60 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Nenhum dia no período</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Tente ajustar o período ou carregar outro CSV
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
              <TrafficPanel rows={filtered} />
            ) : tab === "funil" ? (
              <FunnelPanel rows={filtered} />
            ) : tab === "bumps" ? (
              <BumpsPanel rows={filtered} />
            ) : tab === "anuncios" ? (
              <AdsPanel
                projectId={currentProjectId}
                dateRange={{
                  from: filtered[0]?.date ? format(filtered[0].date, "yyyy-MM-dd") : null,
                  to: filtered[filtered.length - 1]?.date ? format(filtered[filtered.length - 1].date, "yyyy-MM-dd") : null,
                }}
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
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
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

export default Index;

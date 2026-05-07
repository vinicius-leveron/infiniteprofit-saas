import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
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
  BarChart3,
  Radio,
  FileUp,
  Target,
  Gift,
  Stethoscope,
  Save,
  ArrowLeft,
  Download,
  Command as CommandIcon,
  Sliders,
  RefreshCw,
  Settings2,
  Megaphone,
  Map,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "atribuicao" | "relatorio" | "diagnostico" | "simulador";

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
  const setTab = (t: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", t);
    navigate(`/?${params.toString()}`, { replace: true });
  };
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
  }, [projectId, user, navigate]);

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
  }, []);

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

  return (
    <main className="min-h-screen">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/60">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => navigate("/projects")}
                className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow shrink-0 hover:opacity-90 transition-opacity"
                title="Voltar para projetos"
              >
                <BarChart3 className="w-5 h-5 text-primary-foreground" strokeWidth={2.4} />
              </button>
              <div className="min-w-0">
                <h1 className="text-lg md:text-xl font-extrabold gradient-text-brand leading-none truncate">
                  {projectName || "Infinite Profit"}
                </h1>
                <p className="text-[11px] text-muted-foreground mt-1 truncate max-w-[260px] md:max-w-[600px]">
                  {fileName} · {periodLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPaletteOpen(true)}
                className="h-9 gap-1.5 hidden md:inline-flex text-xs text-muted-foreground hover:text-foreground"
                title="Abrir busca rápida (⌘K)"
              >
                <CommandIcon className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Buscar</span>
                <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">
                  ⌘K
                </kbd>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPdf}
                className="gap-2 hidden sm:inline-flex"
                title="Exportar dashboard em PDF"
              >
                <Download className="w-4 h-4" />
                <span className="hidden md:inline">PDF</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/projects")}
                className="gap-2 hidden sm:inline-flex"
              >
                <ArrowLeft className="w-4 h-4" />
                Projetos
              </Button>
              {currentProjectId && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleQuickSync}
                    disabled={syncingNow}
                    className="gap-2 hidden sm:inline-flex"
                    title={
                      sheetUrl
                        ? "Sincronizar planilha agora"
                        : "Configurar sincronização com Google Sheets"
                    }
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingNow ? "animate-spin" : ""}`} />
                    <span className="hidden md:inline">
                      {sheetUrl ? "Sync" : "Conectar planilha"}
                    </span>
                  </Button>
                  {sheetUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSyncDialogOpen(true)}
                      className="gap-2 hidden sm:inline-flex"
                      title="Configurar / regenerar script"
                    >
                      <Settings2 className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRows(null);
                  setFileName("");
                  setCsvText("");
                  setProjectName("");
                  setCurrentProjectId(null);
                  setSheetUrl(null);
                  setSyncToken(null);
                  setLastSyncedAt(null);
                }}
                className="gap-2 hidden sm:inline-flex"
              >
                <FileUp className="w-4 h-4" />
                Novo CSV
              </Button>
              <Button size="sm" onClick={() => setSaveDialogOpen(true)} className="gap-2">
                <Save className="w-4 h-4" />
                <span className="hidden sm:inline">{currentProjectId ? "Salvar" : "Salvar projeto"}</span>
              </Button>
            </div>
          </div>

        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Period filter */}
        <div className="mb-6 flex flex-wrap items-end gap-3">
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

            {tab === "geral" ? (
              <OverviewPanel rows={filtered} previous={previous} onDayClick={setDrilldownRow} />
            ) : tab === "trafego" ? (
              <TrafficPanel rows={filtered} />
            ) : tab === "funil" ? (
              <FunnelPanel rows={filtered} />
            ) : tab === "bumps" ? (
              <BumpsPanel rows={filtered} />
            ) : tab === "anuncios" ? (
              <AdsPanel projectId={currentProjectId} />
            ) : tab === "atribuicao" ? (
              <AttributionPanel rows={filtered} />
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

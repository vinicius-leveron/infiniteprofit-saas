import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArchiveX,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Copy,
  CreditCard,
  Loader2,
  Megaphone,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Zap,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { syncVturbUntilDone } from "@/lib/vturbSync";
import {
  buildCoverageRows,
  summarizeCoverage,
  type CoverageRow,
  type CoverageStatus,
} from "@/lib/dashboardCoverage";
import {
  canDeadLetterCreativeJob,
  canRequeueCreativeJob,
  creativeJobStatusLabel,
  getRecentActionableCreativeJobs,
  summarizeCreativeJobs,
  type CreativeJobQueueRow,
} from "@/lib/creativeJobQueue";
import { cn } from "@/lib/utils";
import {
  deriveSourceHealth,
  SOURCE_HEALTH_LABELS,
  type SourceHealthKey,
  type SourceHealthResult,
  type SourceHealthStatus,
} from "@/lib/sourceHealth";
import {
  getFunnelCheckoutBindingSafe,
  getWorkspaceIntegrationSafe,
  listFunnelEventCoverage,
  type FunnelEventCoverageRow,
} from "@/lib/operationalReadApi";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface ProjectRow {
  id: string;
  name: string;
  source: "csv" | "sheet" | "api";
  workspace_id: string;
}

interface RawEventRow {
  source: string;
  event_type: string;
  event_date: string;
  received_at: string;
  external_id: string | null;
}

interface DailyMetricRow {
  [key: string]: unknown;
  event_date: string;
}

interface BindingState {
  metaAccounts: number;
  vturbPlayers: number;
  creativeAssets: number;
  checkoutToken: string | null;
  gatewayProvider: string | null;
  lastMetaSync: string | null;
  lastVturbSync: string | null;
  lastCreativeSync: string | null;
  lastGatewayEvent: string | null;
}

interface OperationalAlertRow {
  id: string;
  source: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  last_seen_at: string;
}

interface SyncRunRow {
  source: "meta" | "vturb" | "creative";
  status: "queued" | "running" | "succeeded" | "failed";
  error_message: string | null;
  details: unknown;
  created_at: string;
}

type CreativeJobRow = CreativeJobQueueRow;
type CreativeJobAdminAction = "requeue" | "dead_letter";

interface CreativeJobActionState {
  action: CreativeJobAdminAction;
  job: CreativeJobRow;
}

export default function Diagnostics() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { funnelId } = useParams<{ funnelId?: string }>();
  const projectId = funnelId ?? params.get("project");
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    currentWorkspace,
    currentWorkspaceRole,
    isOrganizationAdmin,
    isWorkspaceAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [syncing, setSyncing] = useState<"meta" | "vturb" | "creative" | null>(null);
  const [generatingAlerts, setGeneratingAlerts] = useState(false);
  const [jobAction, setJobAction] = useState<CreativeJobActionState | null>(null);
  const [jobActionReason, setJobActionReason] = useState("");
  const [jobActionResetAttempts, setJobActionResetAttempts] = useState(true);
  const [jobActionSubmitting, setJobActionSubmitting] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [events, setEvents] = useState<RawEventRow[]>([]);
  const [eventCoverage, setEventCoverage] = useState<FunnelEventCoverageRow[]>([]);
  const [metrics, setMetrics] = useState<DailyMetricRow[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlertRow[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [creativeJobs, setCreativeJobs] = useState<CreativeJobRow[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [bindings, setBindings] = useState<BindingState>({
    metaAccounts: 0,
    vturbPlayers: 0,
    creativeAssets: 0,
    checkoutToken: null,
    gatewayProvider: null,
    lastMetaSync: null,
    lastVturbSync: null,
    lastCreativeSync: null,
    lastGatewayEvent: null,
  });

  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, navigate, userId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError("");
    try {
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("id, name, source, workspace_id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError || !projectData) throw projectError ?? new Error("Projeto não encontrado");

      const typedProject = projectData as ProjectRow;
      setProject(typedProject);
      if (typedProject.workspace_id && typedProject.workspace_id !== currentWorkspace?.id) {
        setCurrentWorkspaceId(typedProject.workspace_id);
      }

      const [
        rawResult,
        coverageResult,
        metricResult,
        metaResult,
        playerResult,
        creativeAssetResult,
        checkoutResult,
        integrationResult,
        alertResult,
        syncRunResult,
        creativeJobResult,
      ] = await Promise.all([
        supabase
          .from("raw_events")
          .select("source, event_type, event_date, received_at, external_id")
          .eq("project_id", typedProject.id)
          .order("received_at", { ascending: false })
          .limit(30),
        listFunnelEventCoverage(typedProject.id),
        supabase
          .from("daily_metrics")
          .select("*")
          .eq("project_id", typedProject.id)
          .order("event_date", { ascending: false })
          .limit(1000),
        supabase.from("project_meta_accounts").select("meta_account_id").eq("project_id", typedProject.id),
        supabase.from("project_vturb_players").select("vturb_player_id").eq("project_id", typedProject.id),
        supabase.from("creative_assets" as never).select("id").eq("project_id", typedProject.id),
        getFunnelCheckoutBindingSafe(typedProject.id),
        getWorkspaceIntegrationSafe(typedProject.workspace_id),
        supabase
          .from("operational_alerts" as never)
          .select("id, source, type, severity, title, message, last_seen_at")
          .eq("project_id", typedProject.id)
          .eq("status", "active")
          .order("last_seen_at", { ascending: false }),
        supabase
          .from("sync_runs")
          .select("source, status, error_message, details, created_at")
          .eq("project_id", typedProject.id)
          .in("source", ["meta", "vturb", "creative"])
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("creative_asset_jobs" as never)
          .select("id, asset_id, status, attempt_count, max_attempts, last_error, created_at, updated_at, available_at, locked_at, locked_by, finished_at")
          .eq("project_id", typedProject.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const firstError = [
        rawResult.error,
        metricResult.error,
        metaResult.error,
        playerResult.error,
        creativeAssetResult.error,
        alertResult.error,
        syncRunResult.error,
        creativeJobResult.error,
      ].find(Boolean);
      if (firstError) throw firstError;

      const typedEvents = (rawResult.data ?? []) as RawEventRow[];
      const typedCoverage = coverageResult;
      setEvents(typedEvents);
      setEventCoverage(typedCoverage);
      setMetrics((metricResult.data ?? []) as DailyMetricRow[]);
      const typedSyncRuns = (syncRunResult.data ?? []) as SyncRunRow[];
      setBindings({
        metaAccounts: (metaResult.data ?? []).length,
        vturbPlayers: (playerResult.data ?? []).length,
        creativeAssets: (creativeAssetResult.data ?? []).length,
        checkoutToken: checkoutResult?.enabled
          ? checkoutResult.webhook_token
          : null,
        gatewayProvider: integrationResult?.gateway_provider ?? null,
        lastMetaSync: lastCoverageAt(typedCoverage, "meta"),
        lastVturbSync: lastCoverageAt(typedCoverage, "vturb"),
        lastCreativeSync: typedSyncRuns.find((row) => row.source === "creative" && row.status === "succeeded")?.created_at ?? null,
        lastGatewayEvent: lastCoverageAt(typedCoverage, "gateway"),
      });
      setOperationalAlerts(
        (alertResult.data ?? []) as unknown as OperationalAlertRow[],
      );
      setSyncRuns(typedSyncRuns);
      setCreativeJobs(
        (creativeJobResult.data ?? []) as unknown as CreativeJobRow[],
      );
      setLastLoadedAt(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar a saúde do funil");
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace?.id, projectId, setCurrentWorkspaceId]);

  useEffect(() => {
    if (!userId || !projectId) return;
    void load();
  }, [load, projectId, userId]);

  async function refreshAlerts() {
    if (!project?.id) return;
    setGeneratingAlerts(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-alerts", {
        body: { project_id: project.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOperationalAlerts((data?.alerts ?? []) as OperationalAlertRow[]);
      toast.success("Alertas atualizados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar alertas");
    } finally {
      setGeneratingAlerts(false);
    }
  }

  function openJobAction(action: CreativeJobAdminAction, job: CreativeJobRow) {
    setJobAction({ action, job });
    setJobActionReason("");
    setJobActionResetAttempts(true);
  }

  async function confirmJobAction() {
    if (!jobAction) return;
    setJobActionSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("creative-jobs-admin", {
        body: {
          action: jobAction.action,
          job_id: jobAction.job.id,
          reason: jobActionReason.trim() || null,
          reset_attempts: jobActionResetAttempts,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(jobAction.action === "requeue" ? "Job reenfileirado" : "Job movido para dead letter");
      setJobAction(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar job");
    } finally {
      setJobActionSubmitting(false);
    }
  }

  const coverageRows = useMemo(() => {
    const rawBySource: Record<string, number> = {};
    const rawByType: Record<string, number> = {};
    for (const row of eventCoverage) {
      const count = Number(row.event_count) || 0;
      rawBySource[row.source] = (rawBySource[row.source] ?? 0) + count;
      rawByType[row.event_type] = (rawByType[row.event_type] ?? 0) + count;
    }
    const latestVturbRun = syncRuns.find((run) => run.source === "vturb") ?? null;
    const hasVturbPitchGap = detectVturbPitchGap(rawByType, metrics, latestVturbRun);
    const metricFilled: Record<string, number> = {};
    for (const row of metrics) {
      for (const [key, value] of Object.entries(row)) {
        if (key === "event_date" || key === "project_id" || key === "user_id") continue;
        if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
          metricFilled[key] = (metricFilled[key] ?? 0) + 1;
        }
      }
    }
    return buildCoverageRows({ rawBySource, rawByType, metricFilled, totalMetricDays: metrics.length }).map((row) => {
      if (!hasVturbPitchGap) return row;
      if (row.group === "VSL VTurb" && row.kpi === "Play Rate, Retenção Pitch, Chegaram no Pitch") {
        return {
          ...row,
          reason: "A VTurb retornou agregados básicos, mas não retornou sessions/stats_by_day com dados de pitch. Sem isso, Retenção Pitch e Chegaram no Pitch ficam vazios.",
        };
      }
      if (row.group === "Derivados de funil" && row.kpi === "Pitch -> Checkout, Pitch -> Venda, Checkout -> Venda") {
        return {
          ...row,
          reason: "Sem sessions/stats_by_day com total_over_pitch, os derivados de pitch ficam incompletos mesmo com o gateway entrando.",
        };
      }
      return row;
    });
  }, [eventCoverage, metrics, syncRuns]);
  const creativeJobSummary = useMemo(() => {
    return summarizeCreativeJobs(creativeJobs);
  }, [creativeJobs]);
  const actionableCreativeJobs = useMemo(() => getRecentActionableCreativeJobs(creativeJobs), [creativeJobs]);

  const coverageSummary = summarizeCoverage(coverageRows);
  const groupedCoverage = groupBy(coverageRows, (row) => row.group);
  const coverageIssues = useMemo(
    () => coverageRows
      .filter((row) => row.status !== "OK")
      .sort(compareCoverageIssues)
      .slice(0, 6),
    [coverageRows],
  );
  const canAdminCreativeJobs = isWorkspaceAdmin || isOrganizationAdmin;
  const webhookUrl =
    bindings.gatewayProvider && bindings.checkoutToken
      ? `${SUPABASE_URL}/functions/v1/webhook-gateway/${bindings.gatewayProvider}/${bindings.checkoutToken}`
      : "";
  const alerts = buildAlerts(
    bindings,
    coverageRows,
    eventCoverage,
    syncRuns,
    metrics,
  );
  const sourceHealth = useMemo(() => {
    const configured: Record<SourceHealthKey, boolean> = {
      meta: bindings.metaAccounts > 0,
      vturb: bindings.vturbPlayers > 0,
      gateway: Boolean(bindings.checkoutToken),
      creative: bindings.creativeAssets > 0,
    };
    const lastEvent: Record<SourceHealthKey, string | null> = {
      meta: bindings.lastMetaSync,
      vturb: bindings.lastVturbSync,
      gateway: bindings.lastGatewayEvent,
      creative: null,
    };

    return Object.fromEntries(
      (["meta", "vturb", "gateway", "creative"] as SourceHealthKey[]).map((source) => {
        const runs = syncRuns.filter((run) => run.source === source);
        const latestRun = runs[0] ?? null;
        const latestSuccess = runs.find((run) => run.status === "succeeded") ?? null;
        const latestFailure = runs.find((run) => run.status === "failed") ?? null;
        const sourceAlerts = operationalAlerts.filter((alert) => alert.source === source);
        return [
          source,
          deriveSourceHealth({
            workspaceId: project?.workspace_id ?? "",
            projectId: project?.id ?? "",
            source,
            configured: configured[source],
            lastSuccessAt: latestSuccess?.created_at ?? null,
            lastEventAt: lastEvent[source],
            lastErrorAt: latestFailure?.created_at ?? null,
            syncing: latestRun?.status === "queued" || latestRun?.status === "running",
            warningCount: sourceAlerts.filter((alert) => alert.severity === "warning").length,
            criticalCount: sourceAlerts.filter((alert) => alert.severity === "critical").length,
          }),
        ];
      }),
    ) as Record<SourceHealthKey, SourceHealthResult>;
  }, [bindings, operationalAlerts, project?.id, project?.workspace_id, syncRuns]);
  const canSeeDetailedHealth = currentWorkspaceRole !== "member";

  async function sync(source: "meta" | "vturb" | "creative", options?: { reprocessScope?: "all" | "analysis" | "transcript" | "media" }) {
    if (!project?.id) return;
    setSyncing(source);
    try {
      if (source === "vturb") {
        const result = await syncVturbUntilDone({ projectId: project.id, days: 30 });
        if (result.errors.length > 0) throw new Error(result.errors[0]);
      } else {
        const fn = source === "meta" ? "meta-pull" : "creative-sync";
        const { error } = await supabase.functions.invoke(fn, {
          body: {
            project_id: project.id,
            days: 30,
            ...(source === "creative"
              ? {
                reprocess: Boolean(options?.reprocessScope),
                reprocess_scope: options?.reprocessScope ?? "all",
                queue_analysis: Boolean(options?.reprocessScope),
              }
              : {}),
          },
        });
        if (error) throw error;
      }
      toast.success(source === "meta" ? "Meta sincronizada" : source === "vturb" ? "VTurb sincronizada" : "Criativos sincronizados");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar");
    } finally {
      setSyncing(null);
    }
  }

  if (!projectId) return <Navigate to="/health" replace />;

  if (authLoading || loading) {
    return (
      <main className="flex min-h-[calc(100vh-80px)] items-center justify-center" aria-busy="true">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Carregando saúde do funil</span>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-[760px] px-4 py-12 md:px-6 lg:px-8">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
          <p className="font-medium text-destructive">Falha ao carregar a saúde do funil</p>
          <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => void load()} className="mt-4 min-h-11">
            Tentar novamente
          </Button>
        </div>
      </main>
    );
  }

  const sortedOperationalAlerts = [...operationalAlerts].sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical") ||
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
  );

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            onClick={() => navigate(`/health?client=${project?.workspace_id ?? "all"}`)}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Voltar para saúde global</span>
          </Button>
          <div>
            <h1 className="text-2xl font-bold leading-8">
              Saúde do funil <span className="text-muted-foreground">· Diagnóstico</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {project?.name}
              {lastLoadedAt && (
                <span>
                  {" "}· atualizado {formatDistanceToNow(lastLoadedAt, { addSuffix: true, locale: ptBR })}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isWorkspaceAdmin && (
            <Button
              variant="outline"
              onClick={() => navigate(`/funnels/${projectId}/sources`)}
              className="min-h-11 gap-2"
            >
              <Settings2 className="h-4 w-4" />
              Fontes de dados
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => navigate(`/dashboard?project=${projectId}`)}
            className="min-h-11"
          >
            Dashboard
          </Button>
        </div>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo por fonte">
        <SourceCard
          icon={<Megaphone className="h-5 w-5" />}
          label="Meta"
          count={`${bindings.metaAccounts} conta(s)`}
          health={sourceHealth.meta}
          latestRun={syncRuns.find((run) => run.source === "meta") ?? null}
        />
        <SourceCard
          icon={<PlayCircle className="h-5 w-5" />}
          label="VTurb"
          count={`${bindings.vturbPlayers} player(s)`}
          health={sourceHealth.vturb}
          latestRun={syncRuns.find((run) => run.source === "vturb") ?? null}
        />
        <SourceCard
          icon={<CreditCard className="h-5 w-5" />}
          label="Gateway"
          count={bindings.gatewayProvider ?? "sem provedor"}
          health={sourceHealth.gateway}
          latestRun={null}
        />
        <SourceCard
          icon={<Sparkles className="h-5 w-5" />}
          label="Criativos"
          count={`${bindings.creativeAssets} ativo(s)`}
          health={sourceHealth.creative}
          latestRun={syncRuns.find((run) => run.source === "creative") ?? null}
        />
      </section>

      {operationalAlerts.length === 0 && alerts.length === 0 && coverageIssues.length === 0 ? (
        <section className="section-card mb-6 border-green-500/30 p-4 md:p-6">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            <h2 className="font-semibold">Nenhuma ação necessária</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            As fontes configuradas não possuem alertas ativos neste funil.
          </p>
        </section>
      ) : canSeeDetailedHealth ? (
        <section className="section-card mb-6 p-4 md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold">Precisa de ação</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {sortedOperationalAlerts.map((alert) => (
              <article
                key={alert.id}
                className={cn(
                  "rounded-lg border p-4",
                  alert.severity === "critical"
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">{alert.title}</h3>
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-semibold uppercase",
                      alert.severity === "critical"
                        ? "bg-red-500/10 text-red-700"
                        : "bg-amber-500/10 text-amber-700",
                    )}
                  >
                    {alert.severity === "critical" ? "Crítico" : "Atenção"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{alert.message}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(alert.last_seen_at), { addSuffix: true, locale: ptBR })}
                </p>
              </article>
            ))}
            {coverageIssues.map((row) => (
              <article key={`${row.group}-${row.kpi}-issue`} className="rounded-lg border border-border/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">{row.group}</h3>
                  <StatusPill status={row.status} reason={row.reason} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{row.kpi}</p>
                <p className="mt-3 text-sm">{row.nextAction}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Eventos {row.rawFound} · Agregado {row.metricFilled}
                </p>
              </article>
            ))}
            {alerts.map((alert) => (
              <article key={alert} className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
                {alert}
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="section-card mb-6 border-amber-500/30 p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-semibold">Este funil requer atenção</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Peça a um moderador ou administrador para revisar os detalhes operacionais.
          </p>
        </section>
      )}

      {isWorkspaceAdmin && (
        <section className="section-card mb-6 p-4 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold">Ações operacionais</h2>
              <p className="text-sm text-muted-foreground">Sincronizações manuais são restritas a administradores.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SyncButton label="Sincronizar Meta" active={syncing === "meta"} onClick={() => sync("meta")} />
              <SyncButton label="Sincronizar VTurb" active={syncing === "vturb"} onClick={() => sync("vturb")} />
              <SyncButton label="Sincronizar criativos" active={syncing === "creative"} onClick={() => sync("creative")} />
              <Button
                variant="outline"
                onClick={refreshAlerts}
                disabled={generatingAlerts}
                className="min-h-11 gap-2"
              >
                {generatingAlerts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Atualizar alertas
              </Button>
            </div>
          </div>
        </section>
      )}

      {isWorkspaceAdmin && (
        <Accordion type="single" collapsible className="section-card px-4 md:px-6">
          <AccordionItem value="advanced" className="border-0">
            <AccordionTrigger className="min-h-14 text-left hover:no-underline">
              <span>
                <span className="block font-semibold">Diagnóstico avançado</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Cobertura técnica, eventos brutos, execuções, filas e job IDs
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-8 pb-6 pt-2">
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Cobertura técnica</h3>
                    <p className="text-sm text-muted-foreground">
                      {metrics.length} dia(s) agregados; fórmulas existentes preservadas.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <StatusPill status="OK" /> {coverageSummary.OK}
                    <StatusPill status="Parcial" /> {coverageSummary.Parcial}
                    <StatusPill status="Faltando" /> {coverageSummary.Faltando}
                  </div>
                </div>
                <div className="space-y-4">
                  {[...groupedCoverage.entries()].map(([group, rows]) => (
                    <div key={group} className="overflow-x-auto rounded-lg border border-border/60">
                      <h4 className="border-b bg-muted/20 px-4 py-3 text-sm font-semibold">{group}</h4>
                      <table className="w-full min-w-[820px] text-sm">
                        <thead className="border-b text-xs text-muted-foreground">
                          <tr>
                            <th className="p-3 text-left">KPI</th>
                            <th className="p-3 text-left">Fonte</th>
                            <th className="p-3 text-right">Eventos</th>
                            <th className="p-3 text-right">Agregado</th>
                            <th className="p-3 text-left">Status</th>
                            <th className="p-3 text-left">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map((row) => (
                            <tr key={`${group}-${row.kpi}`}>
                              <td className="p-3 font-medium">{row.kpi}</td>
                              <td className="p-3 text-muted-foreground">{row.source}</td>
                              <td className="p-3 text-right tabular-nums">{row.rawFound}</td>
                              <td className="p-3 text-right tabular-nums">{row.metricFilled}</td>
                              <td className="p-3"><StatusPill status={row.status} reason={row.reason} /></td>
                              <td className="min-w-[260px] p-3 text-xs text-muted-foreground">{row.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-3 font-semibold">Execuções recentes</h3>
                {syncRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma execução registrada.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left">Fonte</th>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-left">Executada</th>
                          <th className="p-3 text-left">Erro</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {syncRuns.map((run, index) => (
                          <tr key={`${run.source}-${run.created_at}-${index}`}>
                            <td className="p-3 font-medium">{run.source}</td>
                            <td className="p-3">{run.status}</td>
                            <td className="p-3 text-muted-foreground">
                              {formatDistanceToNow(new Date(run.created_at), { addSuffix: true, locale: ptBR })}
                            </td>
                            <td className="max-w-md p-3 text-xs text-muted-foreground">{run.error_message ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Fila de criativos</h3>
                  <div className="flex gap-2 text-xs">
                    <span>{creativeJobSummary.queued + creativeJobSummary.running} pendente(s)</span>
                    <span>{creativeJobSummary.failed + creativeJobSummary.dead_letter} falha(s)</span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <QueueMetric label="Queued" value={creativeJobSummary.queued} tone="amber" />
                  <QueueMetric label="Running" value={creativeJobSummary.running} tone="cyan" />
                  <QueueMetric label="Succeeded" value={creativeJobSummary.succeeded} tone="emerald" />
                  <QueueMetric label="Failed" value={creativeJobSummary.failed} tone="red" />
                  <QueueMetric label="Dead letter" value={creativeJobSummary.dead_letter} tone="slate" />
                </div>
                {actionableCreativeJobs.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="border-b text-xs text-muted-foreground">
                        <tr>
                          <th className="p-3 text-left">Status</th>
                          <th className="p-3 text-left">Job</th>
                          <th className="p-3 text-right">Tentativas</th>
                          <th className="p-3 text-left">Erro</th>
                          <th className="p-3 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {actionableCreativeJobs.map((job) => (
                          <tr key={job.id}>
                            <td className="p-3"><JobStatusPill status={job.status} /></td>
                            <td className="p-3 font-mono text-xs">{job.id}</td>
                            <td className="p-3 text-right">{job.attempt_count ?? 0}/{job.max_attempts ?? 0}</td>
                            <td className="max-w-sm p-3 text-xs text-muted-foreground">{job.last_error ?? "—"}</td>
                            <td className="p-3">
                              <div className="flex justify-end gap-1">
                                {canAdminCreativeJobs && canRequeueCreativeJob(job.status) && (
                                  <JobActionButton label="Reenfileirar" onClick={() => openJobAction("requeue", job)}>
                                    <RotateCcw className="h-4 w-4" />
                                  </JobActionButton>
                                )}
                                {canAdminCreativeJobs && canDeadLetterCreativeJob(job.status) && (
                                  <JobActionButton label="Dead letter" destructive onClick={() => openJobAction("dead_letter", job)}>
                                    <ArchiveX className="h-4 w-4" />
                                  </JobActionButton>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Eventos brutos recentes</h3>
                  {webhookUrl && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(webhookUrl);
                        toast.success("Webhook copiado");
                      }}
                      className="min-h-11 gap-2"
                    >
                      <Copy className="h-4 w-4" />
                      Copiar webhook
                    </Button>
                  )}
                </div>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum raw event recebido neste funil.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {events.slice(0, 30).map((event, index) => (
                      <div key={`${event.source}-${event.event_type}-${event.received_at}-${index}`} className="rounded-lg border border-border/60 p-3">
                        <p className="text-xs font-medium">{event.source} · {event.event_type}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(event.received_at), { addSuffix: true, locale: ptBR })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      <Dialog
        open={!!jobAction}
        onOpenChange={(open) => {
          if (!open && !jobActionSubmitting) setJobAction(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {jobAction?.action === "requeue" ? "Reenfileirar job" : "Mover job para dead letter"}
            </DialogTitle>
            <DialogDescription>
              {jobAction?.job ? `${creativeJobStatusLabel(jobAction.job.status)} · ${jobAction.job.id.slice(0, 8)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {jobAction?.action === "requeue" && (
            <label className="flex min-h-11 items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
              <Checkbox
                checked={jobActionResetAttempts}
                onCheckedChange={(checked) => setJobActionResetAttempts(checked === true)}
              />
              Zerar tentativas
            </label>
          )}
          <Textarea
            value={jobActionReason}
            onChange={(event) => setJobActionReason(event.target.value)}
            placeholder="Motivo da alteração"
            maxLength={1000}
            rows={4}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={jobActionSubmitting} onClick={() => setJobAction(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={jobAction?.action === "dead_letter" ? "destructive" : "default"}
              disabled={jobActionSubmitting}
              onClick={confirmJobAction}
            >
              {jobActionSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SourceCard({
  icon,
  label,
  count,
  health,
  latestRun,
}: {
  icon: React.ReactNode;
  label: string;
  count: string;
  health: SourceHealthResult;
  latestRun: SyncRunRow | null;
}) {
  const recommendedAction =
    health.status === "not_configured"
      ? "Configure a fonte"
      : health.status === "error"
        ? "Revise o erro e tente novamente"
        : health.status === "warning"
          ? "Verifique a última atividade"
          : health.status === "syncing"
            ? "Aguarde a execução"
            : "Nenhuma ação necessária";

  return (
    <article className="section-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            health.status === "healthy" ? "bg-green-500/10 text-green-700" : "bg-secondary text-muted-foreground",
          )}>
            {icon}
          </div>
          <div>
            <h2 className="text-sm font-semibold">{label}</h2>
            <p className="text-xs text-muted-foreground">{count}</p>
          </div>
        </div>
        <HealthStatusPill status={health.status} />
      </div>
      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Última execução</dt>
          <dd className="text-right">
            {latestRun
              ? formatDistanceToNow(new Date(latestRun.created_at), { addSuffix: true, locale: ptBR })
              : "Sem execução"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Último evento</dt>
          <dd className="text-right">
            {health.lastEventAt
              ? formatDistanceToNow(new Date(health.lastEventAt), { addSuffix: true, locale: ptBR })
              : "Sem evento"}
          </dd>
        </div>
        {latestRun?.error_message && (
          <div>
            <dt className="text-muted-foreground">Erro</dt>
            <dd className="mt-1 line-clamp-2 text-red-700">{latestRun.error_message}</dd>
          </div>
        )}
      </dl>
      <p className="mt-4 border-t border-border/50 pt-3 text-xs font-medium">
        {recommendedAction}
      </p>
    </article>
  );
}

function HealthStatusPill({ status }: { status: SourceHealthStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold",
        status === "not_configured" && "bg-muted text-muted-foreground",
        status === "syncing" && "bg-blue-500/10 text-blue-700",
        status === "healthy" && "bg-green-500/10 text-green-700",
        status === "warning" && "bg-amber-500/10 text-amber-700",
        status === "error" && "bg-red-500/10 text-red-700",
      )}
    >
      {status === "healthy" ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : status === "syncing" ? (
        <RefreshCw className="h-3 w-3 animate-spin" />
      ) : status === "not_configured" ? (
        <Circle className="h-3 w-3" />
      ) : status === "error" ? (
        <XCircle className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {SOURCE_HEALTH_LABELS[status]}
    </span>
  );
}

function SyncButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" onClick={onClick} disabled={active} className="min-h-11 gap-2">
      {active ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {label}
    </Button>
  );
}

function StatusPill({ status, reason }: { status: CoverageStatus; reason?: string }) {
  const pill = (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
        status === "OK" && "bg-green-500/10 text-green-600",
        status === "Parcial" && "bg-amber-500/10 text-amber-600",
        status === "Faltando" && "bg-red-500/10 text-red-600",
        reason && "cursor-help",
      )}
    >
      {status}
    </span>
  );

  if (!reason) return pill;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{pill}</TooltipTrigger>
        <TooltipContent>
          <p className="text-xs max-w-[200px]">{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QueueMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "cyan" | "emerald" | "red" | "slate";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        tone === "amber" && "border-amber-500/20 bg-amber-500/5",
        tone === "cyan" && "border-cyan-500/20 bg-cyan-500/5",
        tone === "emerald" && "border-emerald-500/20 bg-emerald-500/5",
        tone === "red" && "border-red-500/20 bg-red-500/5",
        tone === "slate" && "border-slate-500/20 bg-slate-500/5",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function JobStatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
        status === "queued" && "bg-amber-500/10 text-amber-600",
        status === "running" && "bg-cyan-500/10 text-cyan-600",
        status === "succeeded" && "bg-green-500/10 text-green-600",
        status === "failed" && "bg-red-500/10 text-red-600",
        status === "dead_letter" && "bg-slate-500/10 text-slate-600",
      )}
    >
      {creativeJobStatusLabel(status)}
    </span>
  );
}

function JobActionButton({
  children,
  destructive,
  label,
  onClick,
}: {
  children: React.ReactNode;
  destructive?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={destructive ? "destructive" : "outline"}
            className="h-8 w-8"
            onClick={onClick}
          >
            {children}
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function lastCoverageAt(rows: FunnelEventCoverageRow[], source: string) {
  return rows
    .filter((row) => row.source === source && row.last_event_at)
    .map((row) => row.last_event_at as string)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

function groupBy<T, K>(items: T[], getKey: (item: T) => K) {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function buildAlerts(
  bindings: BindingState,
  coverageRows: CoverageRow[],
  eventCoverage: FunnelEventCoverageRow[],
  syncRuns: SyncRunRow[],
  metrics: DailyMetricRow[],
) {
  const alerts: string[] = [];
  const rawByType: Record<string, number> = {};
  for (const row of eventCoverage) {
    rawByType[row.event_type] =
      (rawByType[row.event_type] ?? 0) + (Number(row.event_count) || 0);
  }
  const latestVturbRun = syncRuns.find((run) => run.source === "vturb") ?? null;

  if (bindings.metaAccounts === 0) alerts.push("Meta sem conta vinculada neste projeto.");
  if (bindings.vturbPlayers === 0) alerts.push("VTurb sem player vinculado neste projeto.");
  if (!bindings.checkoutToken) alerts.push("Hubla sem webhook ativo para este projeto.");
  if (bindings.lastVturbSync && Date.now() - new Date(bindings.lastVturbSync).getTime() > 24 * 60 * 60 * 1000) {
    alerts.push("VTurb sem evento nas últimas 24h.");
  }
  if (bindings.lastGatewayEvent && Date.now() - new Date(bindings.lastGatewayEvent).getTime() > 24 * 60 * 60 * 1000) {
    alerts.push("Hubla sem evento nas últimas 24h.");
  }
  if (detectVturbPitchGap(rawByType, metrics, latestVturbRun)) {
    alerts.push("VTurb sem dados de pitch: a API não retornou sessions/stats_by_day com total_over_pitch para os players deste projeto. Retenção Pitch, Chegaram no Pitch, Pitch -> Checkout e Pitch -> Venda podem ficar vazios.");
  }
  if (runText(latestVturbRun).includes("rate limit exceeded")) {
    alerts.push("VTurb atingiu rate limit na sincronização mais recente. Parte dos players pode atrasar alguns minutos para aparecer.");
  }
  const missing = coverageRows.filter((row) => row.status === "Faltando").slice(0, 3);
  for (const row of missing) alerts.push(`${row.group}: ${row.kpi} está faltando.`);
  return alerts;
}

function detectVturbPitchGap(
  rawByType: Record<string, number>,
  metrics: DailyMetricRow[],
  latestVturbRun: SyncRunRow | null,
) {
  const hasSessionStatsByDay = (rawByType.sessions_stats_by_day ?? 0) > 0;
  const hasStatsByDay = (rawByType.stats_by_day ?? 0) > 0;
  const hasPitchMetric = metrics.some((row) => {
    const chegaramPitch = numericValue(row.chegaram_pitch);
    const pitchCheckout = numericValue(row.pitch_chk);
    const pitchVenda = numericValue(row.pitch_venda);
    return chegaramPitch > 0 || pitchCheckout > 0 || pitchVenda > 0;
  });

  if ((!hasSessionStatsByDay && !hasStatsByDay) || hasPitchMetric) return false;
  const vturbText = runText(latestVturbRun);
  return (
    (hasStatsByDay && !hasSessionStatsByDay)
    || vturbText.includes("sessions/stats_by_day")
    || vturbText.includes("public analytics api")
    || vturbText.includes("error code: 1010")
  );
}

function runText(run: SyncRunRow | null) {
  if (!run) return "";
  const detailsText =
    typeof run.details === "string"
      ? run.details
      : run.details == null
        ? ""
        : JSON.stringify(run.details);
  return `${run.error_message ?? ""} ${detailsText}`.toLowerCase();
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function compareCoverageIssues(a: CoverageRow, b: CoverageRow) {
  const rank = (row: CoverageRow) => {
    if (row.status === "Faltando") return 0;
    if (row.rawFound > 0 && row.metricFilled === 0) return 1;
    return 2;
  };
  return rank(a) - rank(b) || b.rawFound - a.rawFound || a.group.localeCompare(b.group);
}

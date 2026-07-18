import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Circle,
  CircleAlert,
  Clock3,
  Database,
  HeartPulse,
  Loader2,
  PlugZap,
  Radio,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  deriveActivationExperience,
  hasPlanErrors,
  readFunnelActivationPlan,
  runFunnelActivationSync,
  saveFunnelActivationPlan,
  type ActivationExperience,
  type ActivationSource,
  type ActivationSyncSource,
  type FunnelActivationPlan,
  type FunnelActivationSnapshot,
} from "@/lib/funnelActivation";
import { getFunnelCheckoutBindingSafe } from "@/lib/operationalReadApi";
import { cn } from "@/lib/utils";

interface ProjectSummary {
  id: string;
  name: string;
  workspace_id: string;
  created_at: string;
}

interface SyncRunSummary {
  source: string;
  status: string;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
}

interface ActivationData {
  project: ProjectSummary;
  snapshot: FunnelActivationSnapshot;
  latestActivityAt: string | null;
  latestSyncError: string | null;
}

type PageState = "loading" | "ready" | "error";
type ChecklistStatus = "done" | "active" | "pending" | "error" | "neutral";

const SOURCE_LABELS: Record<ActivationSource, string> = {
  meta: "Meta Ads",
  vturb: "VTurb",
  gateway: "Gateway",
};

const EMPTY_SNAPSHOT: FunnelActivationSnapshot = {
  configuredSources: [],
  rawEventCount: 0,
  metricsDayCount: 0,
  lastEventAt: null,
  lastMetricDate: null,
  successfulSyncSources: [],
  runningSyncSources: [],
  failedSyncSources: [],
};

export default function FunnelActivation() {
  const navigate = useNavigate();
  const { funnelId } = useParams<{ funnelId: string }>();
  const { isWorkspaceAdmin } = useWorkspace();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [data, setData] = useState<ActivationData | null>(null);
  const [plan, setPlan] = useState<FunnelActivationPlan | null>(() =>
    funnelId ? readFunnelActivationPlan(funnelId) : null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const initialSyncStarted = useRef(false);
  const activationMarked = useRef(false);

  const loadSnapshot = useCallback(
    async (background = false) => {
      if (!funnelId) {
        setErrorMessage("Funil não identificado.");
        setPageState("error");
        return;
      }

      if (background) setRefreshing(true);
      else setPageState("loading");

      try {
        const [
          projectResult,
          metaResult,
          vturbResult,
          gatewayResult,
          eventResult,
          metricResult,
          syncResult,
        ] = await Promise.all([
          supabase
            .from("projects")
            .select("id, name, workspace_id, created_at")
            .eq("id", funnelId)
            .single(),
          supabase
            .from("project_meta_accounts")
            .select("meta_account_id", { count: "exact", head: true })
            .eq("project_id", funnelId),
          supabase
            .from("project_vturb_players")
            .select("vturb_player_id", { count: "exact", head: true })
            .eq("project_id", funnelId),
          getFunnelCheckoutBindingSafe(funnelId),
          supabase
            .from("raw_events")
            .select("source, received_at", { count: "exact" })
            .eq("project_id", funnelId)
            .order("received_at", { ascending: false })
            .limit(1),
          supabase
            .from("daily_metrics")
            .select("event_date", { count: "exact" })
            .eq("project_id", funnelId)
            .order("event_date", { ascending: false })
            .limit(1),
          supabase
            .from("sync_runs")
            .select("source, status, error_message, created_at, finished_at")
            .eq("project_id", funnelId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        const firstError = [
          projectResult.error,
          metaResult.error,
          vturbResult.error,
          eventResult.error,
          metricResult.error,
          syncResult.error,
        ].find(Boolean);
        if (firstError) throw firstError;
        if (!projectResult.data) throw new Error("Funil não encontrado.");

        const configuredSources: ActivationSource[] = [];
        if ((metaResult.count ?? 0) > 0) configuredSources.push("meta");
        if ((vturbResult.count ?? 0) > 0) configuredSources.push("vturb");
        if (gatewayResult?.enabled) configuredSources.push("gateway");

        const runs = (syncResult.data ?? []) as SyncRunSummary[];
        const latestRunBySource = new Map<ActivationSyncSource, SyncRunSummary>();
        for (const run of runs) {
          if (!isSyncSource(run.source) || latestRunBySource.has(run.source)) continue;
          latestRunBySource.set(run.source, run);
        }

        const successfulSyncSources = uniqueSyncSources(
          runs
            .filter((run) => run.status === "succeeded" && isSyncSource(run.source))
            .map((run) => run.source as ActivationSyncSource),
        );
        const runningSyncSources = uniqueSyncSources(
          [...latestRunBySource.entries()]
            .filter(([, run]) => run.status === "queued" || run.status === "running")
            .map(([source]) => source),
        );
        const failedSyncSources = uniqueSyncSources(
          [...latestRunBySource.entries()]
            .filter(([, run]) => run.status === "failed")
            .map(([source]) => source),
        );
        const latestRun = runs[0] ?? null;
        const latestEvent = eventResult.data?.[0] ?? null;
        const latestMetric = metricResult.data?.[0] ?? null;
        const latestActivityAt = latestTimestamp(
          latestEvent?.received_at ?? null,
          latestRun?.finished_at ?? latestRun?.created_at ?? null,
        );

        setData({
          project: projectResult.data as unknown as ProjectSummary,
          snapshot: {
            configuredSources,
            rawEventCount: eventResult.count ?? 0,
            metricsDayCount: metricResult.count ?? 0,
            lastEventAt: latestEvent?.received_at ?? null,
            lastMetricDate: latestMetric?.event_date ?? null,
            successfulSyncSources,
            runningSyncSources,
            failedSyncSources,
          },
          latestActivityAt,
          latestSyncError:
            runs.find((run) => run.status === "failed" && run.error_message)
              ?.error_message ?? null,
        });
        setErrorMessage("");
        setPageState("ready");
      } catch (error) {
        if (!background) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Não foi possível acompanhar a ativação.",
          );
          setPageState("error");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [funnelId],
  );

  const startSync = useCallback(
    async (requestedSources?: ActivationSyncSource[]) => {
      if (!funnelId || !data || syncing || !isWorkspaceAdmin) return;
      const sources =
        requestedSources ??
        data.snapshot.configuredSources.filter(isSyncSource);
      if (sources.length === 0) return;

      const basePlan: FunnelActivationPlan = plan ?? {
        version: 1,
        projectId: funnelId,
        workspaceId: data.project.workspace_id,
        configuredSources: data.snapshot.configuredSources,
        skippedSources: [],
        syncSources: sources,
        syncState: "pending",
        createdAt: new Date().toISOString(),
      };
      const runningPlan: FunnelActivationPlan = {
        ...basePlan,
        configuredSources: data.snapshot.configuredSources,
        syncSources: sources,
        syncState: "running",
        startedAt: new Date().toISOString(),
        completedAt: undefined,
        errors: undefined,
      };

      setSyncing(true);
      setPlan(runningPlan);
      saveFunnelActivationPlan(runningPlan);

      const results = await Promise.all(
        sources.map(async (source) => {
          try {
            return await runFunnelActivationSync(funnelId, source);
          } catch (error) {
            return {
              source,
              errors: [
                error instanceof Error
                  ? error.message
                  : "A sincronização não pôde ser concluída.",
              ],
            };
          }
        }),
      );
      const errors = Object.fromEntries(
        results
          .filter((result) => result.errors.length > 0)
          .map((result) => [result.source, result.errors]),
      ) as FunnelActivationPlan["errors"];
      const completedPlan: FunnelActivationPlan = {
        ...runningPlan,
        syncState: Object.keys(errors).length > 0 ? "error" : "complete",
        completedAt: new Date().toISOString(),
        errors: Object.keys(errors).length > 0 ? errors : undefined,
      };

      setPlan(completedPlan);
      saveFunnelActivationPlan(completedPlan);
      setSyncing(false);
      await loadSnapshot(true);
    },
    [data, funnelId, isWorkspaceAdmin, loadSnapshot, plan, syncing],
  );

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (
      pageState !== "ready" ||
      !data ||
      !plan ||
      plan.syncState !== "pending" ||
      initialSyncStarted.current ||
      !isWorkspaceAdmin
    ) {
      return;
    }

    initialSyncStarted.current = true;
    void startSync(plan.syncSources);
  }, [data, isWorkspaceAdmin, pageState, plan, startSync]);

  const experience = useMemo(
    () => deriveActivationExperience(data?.snapshot ?? EMPTY_SNAPSHOT, plan),
    [data?.snapshot, plan],
  );

  useEffect(() => {
    if (
      pageState !== "ready" ||
      !funnelId ||
      (experience.state !== "preparing" &&
        experience.state !== "waiting_for_event") ||
      syncing
    ) {
      return;
    }

    const interval = window.setInterval(() => void loadSnapshot(true), 3000);
    return () => window.clearInterval(interval);
  }, [experience.state, funnelId, loadSnapshot, pageState, syncing]);

  useEffect(() => {
    if (
      !funnelId ||
      !experience.hasTrustedSignal ||
      activationMarked.current
    ) {
      return;
    }

    activationMarked.current = true;
    void supabase.rpc("mark_funnel_first_trusted_signal", {
      _project_id: funnelId,
    });
  }, [experience.hasTrustedSignal, funnelId]);

  if (pageState === "loading") {
    return <ActivationLoading />;
  }

  if (pageState === "error" || !data || !funnelId) {
    return (
      <main className="page-shell flex min-h-[calc(100vh-56px)] items-center justify-center">
        <section
          className="section-card w-full max-w-lg text-center"
          role="alert"
          aria-labelledby="activation-error-title"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CircleAlert className="h-6 w-6" />
          </div>
          <h1 id="activation-error-title" className="mt-5 text-2xl font-semibold">
            Não conseguimos acompanhar a ativação
          </h1>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            {errorMessage || "Tente carregar os sinais deste funil novamente."}
          </p>
          <Button className="mt-6 min-h-11 gap-2" onClick={() => void loadSnapshot()}>
            <RotateCcw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </section>
      </main>
    );
  }

  const planErrors = Object.values(plan?.errors ?? {}).flat();
  const sourceSyncErrors = [
    ...(plan?.setupError ? [plan.setupError] : []),
    ...planErrors,
    ...(data.latestSyncError ? [data.latestSyncError] : []),
  ];

  return (
    <main className="page-shell pb-12" aria-labelledby="activation-title">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <Sparkles className="h-4 w-4" />
          Ativação do funil
          {refreshing && (
            <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin motion-reduce:animate-none" />
              Atualizando
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.project.name} · seu progresso fica salvo automaticamente
        </p>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card/90 p-5 shadow-[0_24px_80px_-40px_hsl(var(--primary)/0.55)] md:p-8 lg:p-10">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative grid items-center gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
          <ActivationVisual experience={experience} />

          <div className="min-w-0">
            <ActivationBadge experience={experience} />
            <h1
              id="activation-title"
              className="mt-4 max-w-2xl text-3xl font-bold leading-tight tracking-[-0.03em] text-foreground md:text-4xl"
            >
              {experience.headline}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              {experience.description}
            </p>

            <div className="mt-7 max-w-2xl" aria-live="polite">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {progressLabel(experience)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {experience.progress}%
                </span>
              </div>
              <Progress
                value={experience.progress}
                aria-label="Progresso da ativação do funil"
                aria-valuetext={`${progressLabel(experience)}: ${experience.progress}%`}
                className={cn(
                  "h-2 overflow-hidden bg-secondary",
                  experience.state === "preparing" &&
                    "[&>div]:animate-pulse motion-reduce:[&>div]:animate-none",
                )}
              />
            </div>

            <ActivationActions
              experience={experience}
              funnelId={funnelId}
              clientId={data.project.workspace_id}
              canManage={isWorkspaceAdmin}
              syncing={syncing}
              hasSkippedSources={(plan?.skippedSources.length ?? 0) > 0}
              onNavigate={navigate}
              onSync={() => void startSync()}
            />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <ActivationChecklist
          experience={experience}
          snapshot={data.snapshot}
          plan={plan}
        />
        <FirstSignalCard data={data} experience={experience} plan={plan} />
      </div>

      {sourceSyncErrors.length > 0 && (
        <section className="mt-6 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 md:p-5" role="alert">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <h2 className="font-semibold">Uma fonte precisa de atenção</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                O funil continua salvo. Você não precisa repetir o onboarding.
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {[...new Set(sourceSyncErrors)].slice(0, 3).map((message) => (
                  <li key={message} className="break-words">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function ActivationLoading() {
  return (
    <main className="page-shell flex min-h-[calc(100vh-56px)] items-center justify-center" aria-busy="true">
      <section className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-primary/20 bg-card/90 p-6 text-center md:p-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/10 to-transparent"
          aria-hidden="true"
        />
        <div className="relative">
          <ActivationOrb active />
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Preparando seu espaço
          </p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">
            Organizando os primeiros sinais do funil
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            Estamos confirmando as conexões e montando uma visão clara do que já está pronto.
          </p>
          <div className="mx-auto mt-8 max-w-md space-y-3 text-left">
            <LoadingRow label="Localizando o funil" delayClass="" />
            <LoadingRow label="Confirmando as fontes conectadas" delayClass="[animation-delay:180ms]" />
            <LoadingRow label="Procurando o primeiro sinal" delayClass="[animation-delay:360ms]" />
          </div>
        </div>
        <span className="sr-only">Carregando ativação do funil</span>
      </section>
    </main>
  );
}

function LoadingRow({ label, delayClass }: { label: string; delayClass: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/35 p-3">
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none",
          delayClass,
        )}
      />
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full w-1/2 animate-[activation-scan_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:animate-none",
            delayClass,
          )}
        />
      </div>
    </div>
  );
}

function ActivationVisual({ experience }: { experience: ActivationExperience }) {
  return (
    <div className="flex justify-center">
      {experience.state === "activated" ? (
        <div className="relative flex h-44 w-44 items-center justify-center" aria-hidden="true">
          <span className="absolute inset-0 animate-[activation-breathe_2.8s_ease-in-out_infinite] rounded-full bg-primary/10 motion-reduce:animate-none" />
          <span className="absolute inset-5 rounded-full border border-primary/25 bg-primary/5" />
          <span className="absolute inset-10 rounded-full border border-primary/30 bg-card" />
          <CheckCircle2 className="relative h-16 w-16 text-primary" strokeWidth={1.5} />
          <Sparkles className="absolute right-2 top-5 h-6 w-6 text-primary" />
          <Sparkles className="absolute bottom-6 left-2 h-4 w-4 text-accent" />
        </div>
      ) : (
        <ActivationOrb active={experience.state === "preparing"} />
      )}
    </div>
  );
}

function ActivationOrb({ active }: { active: boolean }) {
  return (
    <div className="relative mx-auto flex h-44 w-44 items-center justify-center" aria-hidden="true">
      <span
        className={cn(
          "absolute inset-0 rounded-full border border-primary/15",
          active &&
            "animate-[spin_9s_linear_infinite] border-r-primary/70 motion-reduce:animate-none",
        )}
      />
      <span
        className={cn(
          "absolute inset-5 rounded-full border border-accent/20",
          active &&
            "animate-[spin_6s_linear_infinite_reverse] border-l-accent/70 motion-reduce:animate-none",
        )}
      />
      <span className="absolute inset-10 rounded-full bg-gradient-to-br from-primary/20 via-primary/5 to-accent/10 shadow-[0_0_50px_-16px_hsl(var(--primary))]" />
      <Radio
        className={cn(
          "relative h-12 w-12 text-primary",
          active && "animate-pulse motion-reduce:animate-none",
        )}
        strokeWidth={1.5}
      />
      <span className="absolute right-5 top-8 h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_16px_hsl(var(--primary))]" />
      <span className="absolute bottom-8 left-4 h-2 w-2 rounded-full bg-accent shadow-[0_0_14px_hsl(var(--accent))]" />
    </div>
  );
}

function ActivationBadge({ experience }: { experience: ActivationExperience }) {
  const config = {
    preparing: { label: "Sincronização em andamento", icon: Loader2, className: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
    activated: { label: "Primeiro sinal confirmado", icon: CheckCircle2, className: "text-primary bg-primary/10 border-primary/25" },
    ready_to_connect: { label: "Funil criado", icon: Check, className: "text-primary bg-primary/10 border-primary/25" },
    waiting_for_event: { label: "Pronto para receber eventos", icon: Radio, className: "text-blue-400 bg-blue-500/10 border-blue-500/25" },
    ready_to_sync: { label: "Fontes conectadas", icon: PlugZap, className: "text-primary bg-primary/10 border-primary/25" },
    needs_attention: { label: "Configuração preservada", icon: CircleAlert, className: "text-amber-400 bg-amber-500/10 border-amber-500/25" },
  } as const;
  const current = config[experience.state];
  const Icon = current.icon;

  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold", current.className)}>
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          experience.state === "preparing" &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      {current.label}
    </span>
  );
}

function ActivationActions({
  experience,
  funnelId,
  clientId,
  canManage,
  syncing,
  hasSkippedSources,
  onNavigate,
  onSync,
}: {
  experience: ActivationExperience;
  funnelId: string;
  clientId: string;
  canManage: boolean;
  syncing: boolean;
  hasSkippedSources: boolean;
  onNavigate: (to: string) => void;
  onSync: () => void;
}) {
  if (experience.state === "activated") {
    return (
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          className="min-h-11 gap-2 sm:min-w-48"
          onClick={() => onNavigate(`/dashboard?project=${encodeURIComponent(funnelId)}`)}
        >
          {experience.hasDataSignal ? "Ver meu primeiro resultado" : "Abrir dashboard"}
          <ArrowRight className="h-4 w-4" />
        </Button>
        {canManage && hasSkippedSources && (
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => onNavigate(`/funnels/${encodeURIComponent(funnelId)}/sources`)}
          >
            Conectar próxima fonte
          </Button>
        )}
      </div>
    );
  }

  if (experience.state === "ready_to_connect") {
    return (
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        {canManage ? (
          <Button
            className="min-h-11 gap-2 sm:min-w-48"
            onClick={() => onNavigate(`/funnels/${encodeURIComponent(funnelId)}/sources`)}
          >
            Conectar primeira fonte
            <PlugZap className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            className="min-h-11 gap-2 sm:min-w-48"
            onClick={() => onNavigate(`/dashboard?project=${encodeURIComponent(funnelId)}`)}
          >
            Abrir funil
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => onNavigate(`/clients/${encodeURIComponent(clientId)}/funnels`)}
        >
          Fazer isso depois
        </Button>
      </div>
    );
  }

  if (experience.state === "ready_to_sync" && canManage) {
    return (
      <div className="mt-7">
        <Button
          className="min-h-11 gap-2 sm:min-w-48"
          disabled={syncing}
          onClick={onSync}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Buscar primeiro resultado
        </Button>
      </div>
    );
  }

  if (experience.state === "needs_attention") {
    return (
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        {canManage && (
          <Button
            className="min-h-11 gap-2 sm:min-w-48"
            onClick={() => onNavigate(`/funnels/${encodeURIComponent(funnelId)}/sources`)}
          >
            Revisar fonte
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => onNavigate(`/funnels/${encodeURIComponent(funnelId)}/health`)}
        >
          Ver detalhes de saúde
        </Button>
      </div>
    );
  }

  if (experience.state === "waiting_for_event") {
    return (
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        {canManage && (
          <Button
            className="min-h-11 gap-2 sm:min-w-48"
            onClick={() => onNavigate(`/funnels/${encodeURIComponent(funnelId)}/sources`)}
          >
            Ver configuração do gateway
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => onNavigate(`/dashboard?project=${encodeURIComponent(funnelId)}`)}
        >
          Abrir dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-7 flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
      Esta tela se atualiza automaticamente.
    </div>
  );
}

function ActivationChecklist({
  experience,
  snapshot,
  plan,
}: {
  experience: ActivationExperience;
  snapshot: FunnelActivationSnapshot;
  plan: FunnelActivationPlan | null;
}) {
  const hasSources = snapshot.configuredSources.length > 0;
  const syncDone =
    snapshot.successfulSyncSources.length > 0 ||
    plan?.syncState === "complete";
  const syncError =
    snapshot.failedSyncSources.length > 0 ||
    plan?.syncState === "error" ||
    hasPlanErrors(plan);
  const syncActive =
    snapshot.runningSyncSources.length > 0 ||
    plan?.syncState === "running" ||
    plan?.syncState === "pending";

  const steps: Array<{
    label: string;
    detail: string;
    status: ChecklistStatus;
  }> = [
    {
      label: "Funil criado",
      detail: "Estrutura salva e vinculada ao cliente.",
      status: "done",
    },
    {
      label: hasSources ? "Fontes conectadas" : "Fontes opcionais",
      detail: hasSources
        ? snapshot.configuredSources.map((source) => SOURCE_LABELS[source]).join(", ")
        : "Você escolheu configurar depois.",
      status: hasSources ? "done" : "neutral",
    },
    {
      label: "Primeira sincronização",
      detail: syncDone
        ? "Busca inicial concluída."
        : syncError
          ? "Uma fonte precisa ser revisada."
          : syncActive
            ? "Buscando dados nas fontes conectadas."
            : hasSources
              ? "Pronta para iniciar."
              : "Disponível depois da primeira conexão.",
      status: syncDone
        ? "done"
        : syncError
          ? "error"
          : syncActive
            ? "active"
            : hasSources
              ? "pending"
              : "neutral",
    },
    {
      label: "Primeiro sinal confiável",
      detail: experience.hasTrustedSignal
        ? firstSignalDescription(snapshot, plan)
        : "Será confirmado por evento, dados agregados ou sync concluído.",
      status: experience.hasTrustedSignal
        ? "done"
        : experience.state === "preparing" || experience.state === "waiting_for_event"
          ? "active"
          : "pending",
    },
  ];

  return (
    <section className="section-card" aria-labelledby="activation-checklist-title">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Waypoints className="h-5 w-5" />
        </div>
        <div>
          <h2 id="activation-checklist-title" className="text-lg font-semibold">
            Caminho de ativação
          </h2>
          <p className="text-xs text-muted-foreground">Somente progresso real fica verde.</p>
        </div>
      </div>

      <ol className="mt-6 space-y-1">
        {steps.map((step, index) => (
          <li key={step.label} className="relative flex gap-4 pb-5 last:pb-0">
            {index < steps.length - 1 && (
              <span className="absolute left-[17px] top-9 h-[calc(100%-24px)] w-px bg-border" aria-hidden="true" />
            )}
            <ChecklistIcon status={step.status} />
            <div className="min-w-0 pt-1">
              <p className="text-sm font-medium">{step.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChecklistIcon({ status }: { status: ChecklistStatus }) {
  if (status === "done") {
    return (
      <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-400">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400">
        <CircleAlert className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
      {status === "neutral" ? <Clock3 className="h-4 w-4" /> : <Circle className="h-3.5 w-3.5" />}
    </span>
  );
}

function FirstSignalCard({
  data,
  experience,
  plan,
}: {
  data: ActivationData;
  experience: ActivationExperience;
  plan: FunnelActivationPlan | null;
}) {
  const metrics = [
    {
      label: "Fontes conectadas",
      value: String(data.snapshot.configuredSources.length),
      icon: PlugZap,
    },
    {
      label: "Sinais recebidos",
      value: String(data.snapshot.rawEventCount),
      icon: Radio,
    },
    {
      label: "Dias disponíveis",
      value: String(data.snapshot.metricsDayCount),
      icon: Database,
    },
  ];

  return (
    <section className="section-card" aria-labelledby="first-signal-title">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl",
            experience.hasTrustedSignal
              ? "bg-primary/10 text-primary"
              : "bg-secondary text-muted-foreground",
          )}
        >
          {experience.hasTrustedSignal ? <Sparkles className="h-5 w-5" /> : <BarChart3 className="h-5 w-5" />}
        </div>
        <div>
          <h2 id="first-signal-title" className="text-lg font-semibold">
            {experience.hasDataSignal
              ? "Primeiro resultado confirmado"
              : experience.hasTrustedSignal
                ? "Primeira conexão confirmada"
                : "Sinais deste funil"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Dados exclusivos de {data.project.name}.
          </p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-2">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-xl border border-border/60 bg-background/30 p-3">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <dd className="mt-3 text-xl font-bold tabular-nums md:text-2xl">{metric.value}</dd>
              <dt className="mt-1 text-[11px] leading-4 text-muted-foreground">{metric.label}</dt>
            </div>
          );
        })}
      </dl>

      <div className="mt-5 rounded-xl border border-border/60 bg-muted/15 p-4">
        <div className="flex items-start gap-3">
          {experience.hasTrustedSignal ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          ) : (
            <HeartPulse className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
            {firstSignalDescription(data.snapshot, plan)}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {data.latestActivityAt
                ? `Última atividade ${formatDistanceToNow(new Date(data.latestActivityAt), {
                    addSuffix: true,
                    locale: ptBR,
                  })}.`
                : data.snapshot.lastMetricDate
                  ? `Último dia disponível: ${format(
                      new Date(`${data.snapshot.lastMetricDate}T12:00:00`),
                      "dd/MM/yyyy",
                    )}.`
                  : "Aguardando atividade exclusiva deste funil."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function progressLabel(experience: ActivationExperience) {
  if (experience.state === "activated") return "Ativação concluída";
  if (experience.state === "ready_to_connect") return "Estrutura criada";
  if (experience.state === "needs_attention") return "Configuração preservada";
  if (experience.state === "waiting_for_event") return "Rastreamento preparado";
  if (experience.state === "ready_to_sync") return "Conexões prontas";
  return "Preparando primeiro resultado";
}

function firstSignalDescription(
  snapshot: FunnelActivationSnapshot,
  plan: FunnelActivationPlan | null,
) {
  if (snapshot.rawEventCount > 0) {
    return `${snapshot.rawEventCount} sinal(is) real(is) recebido(s)`;
  }
  if (snapshot.metricsDayCount > 0) {
    return `${snapshot.metricsDayCount} dia(s) de dados disponível(is)`;
  }
  if (snapshot.successfulSyncSources.length > 0) {
    return `Sincronização confirmada em ${snapshot.successfulSyncSources
      .map((source) => SOURCE_LABELS[source])
      .join(" e ")}`;
  }
  if (plan?.syncState === "complete" && plan.syncSources.length > 0 && !hasPlanErrors(plan)) {
    return "Primeira sincronização concluída com sucesso";
  }
  return "Ainda não recebemos o primeiro sinal";
}

function uniqueSyncSources(sources: ActivationSyncSource[]) {
  return [...new Set(sources)];
}

function isSyncSource(source: string): source is ActivationSyncSource {
  return source === "meta" || source === "vturb";
}

function latestTimestamp(...values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

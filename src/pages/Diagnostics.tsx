import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  Loader2,
  Megaphone,
  PlayCircle,
  RefreshCw,
  Settings2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  buildCoverageRows,
  summarizeCoverage,
  type CoverageRow,
  type CoverageStatus,
} from "@/lib/dashboardCoverage";
import { cn } from "@/lib/utils";
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
  checkoutToken: string | null;
  gatewayProvider: string | null;
  lastMetaSync: string | null;
  lastVturbSync: string | null;
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
  source: "meta" | "vturb";
  status: "queued" | "running" | "succeeded" | "failed";
  error_message: string | null;
  details: unknown;
  created_at: string;
}

export default function Diagnostics() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const { user, loading: authLoading } = useAuth();
  const { currentWorkspace, setCurrentWorkspaceId } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"meta" | "vturb" | null>(null);
  const [generatingAlerts, setGeneratingAlerts] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [events, setEvents] = useState<RawEventRow[]>([]);
  const [metrics, setMetrics] = useState<DailyMetricRow[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlertRow[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [bindings, setBindings] = useState<BindingState>({
    metaAccounts: 0,
    vturbPlayers: 0,
    checkoutToken: null,
    gatewayProvider: null,
    lastMetaSync: null,
    lastVturbSync: null,
    lastGatewayEvent: null,
  });

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, navigate, user]);

  useEffect(() => {
    if (!user || !projectId) return;
    void load();
  }, [projectId, user]);

  async function load() {
    if (!projectId) return;
    setLoading(true);
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
        { data: rawRows },
        { data: metricRows },
        { data: metaRows },
        { data: playerRows },
        { data: checkoutRow },
        { data: integrationRow },
        { data: alertRows },
        { data: syncRunRows },
      ] = await Promise.all([
        supabase
          .from("raw_events")
          .select("source, event_type, event_date, received_at, external_id")
          .eq("project_id", typedProject.id)
          .order("received_at", { ascending: false })
          .limit(5000),
        supabase
          .from("daily_metrics")
          .select("*")
          .eq("project_id", typedProject.id)
          .order("event_date", { ascending: false }),
        supabase.from("project_meta_accounts").select("meta_account_id").eq("project_id", typedProject.id),
        supabase.from("project_vturb_players").select("vturb_player_id").eq("project_id", typedProject.id),
        supabase
          .from("project_checkout_bindings")
          .select("webhook_token, enabled")
          .eq("project_id", typedProject.id)
          .maybeSingle(),
        supabase
          .from("workspace_integrations")
          .select("gateway_provider, gateway_last_event_at, vturb_last_event_at")
          .eq("workspace_id", typedProject.workspace_id)
          .maybeSingle(),
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
          .in("source", ["meta", "vturb"])
          .order("created_at", { ascending: false })
          .limit(12),
      ]);

      const typedEvents = (rawRows ?? []) as RawEventRow[];
      setEvents(typedEvents);
      setMetrics((metricRows ?? []) as DailyMetricRow[]);
      setBindings({
        metaAccounts: (metaRows ?? []).length,
        vturbPlayers: (playerRows ?? []).length,
        checkoutToken: checkoutRow?.enabled ? checkoutRow.webhook_token : null,
        gatewayProvider: integrationRow?.gateway_provider ?? null,
        lastMetaSync: lastReceivedAt(typedEvents, "meta"),
        lastVturbSync: integrationRow?.vturb_last_event_at ?? lastReceivedAt(typedEvents, "vturb"),
        lastGatewayEvent: integrationRow?.gateway_last_event_at ?? lastReceivedAt(typedEvents, "gateway"),
      });
      setOperationalAlerts((alertRows ?? []) as unknown as OperationalAlertRow[]);
      setSyncRuns((syncRunRows ?? []) as SyncRunRow[]);
      setLastLoadedAt(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar diagnóstico");
      navigate("/projects", { replace: true });
    } finally {
      setLoading(false);
    }
  }

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

  const coverageRows = useMemo(() => {
    const rawBySource: Record<string, number> = {};
    const rawByType: Record<string, number> = {};
    for (const event of events) {
      rawBySource[event.source] = (rawBySource[event.source] ?? 0) + 1;
      rawByType[event.event_type] = (rawByType[event.event_type] ?? 0) + 1;
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
  }, [events, metrics, syncRuns]);

  const coverageSummary = summarizeCoverage(coverageRows);
  const groupedCoverage = groupBy(coverageRows, (row) => row.group);
  const webhookUrl =
    bindings.gatewayProvider && bindings.checkoutToken
      ? `${SUPABASE_URL}/functions/v1/webhook-gateway/${bindings.gatewayProvider}/${bindings.checkoutToken}`
      : "";
  const alerts = buildAlerts(bindings, coverageRows, events, syncRuns, metrics);

  async function sync(source: "meta" | "vturb") {
    if (!project?.id) return;
    setSyncing(source);
    try {
      const { error } = await supabase.functions.invoke(source === "meta" ? "meta-pull" : "vturb-pull", {
        body: { project_id: project.id, days: 30 },
      });
      if (error) throw error;
      toast.success(source === "meta" ? "Meta sincronizada" : "VTurb sincronizada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar");
    } finally {
      setSyncing(null);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="max-w-[1180px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Projetos
          </Button>
          <div>
            <h1 className="text-xl font-bold">Diagnóstico — {project?.name}</h1>
            <p className="text-xs text-muted-foreground">
              Saúde das fontes, eventos recentes e cobertura dos KPIs do dashboard.
              {lastLoadedAt && (
                <span className="ml-2">
                  · Atualizado {formatDistanceToNow(lastLoadedAt, { addSuffix: true, locale: ptBR })}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/connections?project=${projectId}`)} className="gap-2">
            <Settings2 className="w-4 h-4" />
            Conexões
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard?project=${projectId}`)}>
            Dashboard
          </Button>
        </div>
      </header>

      <div className="grid md:grid-cols-4 gap-3 mb-5">
        <SourceCard icon={<Megaphone className="w-5 h-5" />} label="Meta" connected={bindings.metaAccounts > 0} count={`${bindings.metaAccounts} conta(s)`} last={bindings.lastMetaSync} />
        <SourceCard icon={<PlayCircle className="w-5 h-5" />} label="VTurb" connected={bindings.vturbPlayers > 0} count={`${bindings.vturbPlayers} player(s)`} last={bindings.lastVturbSync} />
        <SourceCard icon={<CreditCard className="w-5 h-5" />} label="Hubla" connected={!!bindings.checkoutToken} count={bindings.gatewayProvider ?? "sem gateway"} last={bindings.lastGatewayEvent} />
        <div className="section-card">
          <div className="text-xs text-muted-foreground mb-2">Cobertura</div>
          <div className="flex items-center gap-2 text-sm">
            <StatusPill status="OK" /> {coverageSummary.OK}
            <StatusPill status="Parcial" /> {coverageSummary.Parcial}
            <StatusPill status="Faltando" /> {coverageSummary.Faltando}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">{metrics.length} dia(s) com dados</p>
        </div>
      </div>

      <div className="section-card mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Ações rápidas</h2>
            <p className="text-xs text-muted-foreground">Use para validar fonte sem sair do projeto.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => sync("meta")} disabled={syncing === "meta"} className="gap-2">
              {syncing === "meta" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar Meta
            </Button>
            <Button size="sm" variant="outline" onClick={() => sync("vturb")} disabled={syncing === "vturb"} className="gap-2">
              {syncing === "vturb" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar VTurb
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!webhookUrl}
              onClick={() => {
                void navigator.clipboard.writeText(webhookUrl);
                toast.success("Webhook copiado");
              }}
              className="gap-2"
            >
              <Copy className="w-4 h-4" />
              Copiar webhook Hubla
            </Button>
            <Button size="sm" variant="outline" onClick={refreshAlerts} disabled={generatingAlerts} className="gap-2">
              {generatingAlerts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Atualizar alertas
            </Button>
          </div>
        </div>
      </div>

      {operationalAlerts.length === 0 && alerts.length === 0 && (
        <div className="section-card mb-5 border-green-500/30">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-semibold">Operacao saudavel</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Nenhum alerta ativo. Todas as fontes estao funcionando corretamente.
          </p>
        </div>
      )}

      {(operationalAlerts.length > 0 || alerts.length > 0) && (
        <div className="section-card mb-5 border-amber-500/30">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Alertas operacionais
          </h2>
          <div className="grid md:grid-cols-2 gap-2">
            {operationalAlerts.map((alert) => (
              <div key={alert.id} className={cn(
                "rounded-md border px-3 py-2 overflow-hidden",
                alert.severity === "critical" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5",
              )}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold truncate">{alert.title}</span>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0",
                    alert.severity === "critical" ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600",
                  )}>
                    {alert.severity}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 break-words">{alert.message}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  atualizado {formatDistanceToNow(new Date(alert.last_seen_at), { addSuffix: true, locale: ptBR })}
                </p>
              </div>
            ))}
            {alerts.map((alert) => (
              <div key={alert} className="rounded-md border border-border/50 px-3 py-2 text-xs text-muted-foreground">
                {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-5">
        <div className="space-y-5">
          {[...groupedCoverage.entries()].map(([group, rows]) => (
            <div key={group} className="section-card">
              <h2 className="text-sm font-semibold mb-3">{group}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b border-border/50">
                    <tr>
                      <th className="text-left py-2 pr-3">KPI</th>
                      <th className="text-left py-2 pr-3">Fonte</th>
                      <th className="text-right py-2 pr-3">Eventos</th>
                      <th className="text-right py-2 pr-3">Agregado</th>
                      <th className="text-left py-2 pr-3">Status</th>
                      <th className="text-left py-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${group}-${row.kpi}`} className="border-b border-border/30 last:border-0">
                        <td className="py-2 pr-3 font-medium">{row.kpi}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{row.source}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.rawFound}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{row.metricFilled}</td>
                        <td className="py-2 pr-3"><StatusPill status={row.status} reason={row.reason} /></td>
                        <td className="py-2 text-xs text-muted-foreground min-w-[240px]">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <div className="section-card h-fit">
          <h2 className="text-sm font-semibold mb-3">Eventos recentes</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum raw_event recebido neste projeto.</p>
          ) : (
            <div className="space-y-2">
              {events.slice(0, 20).map((event, index) => (
                <div key={`${event.source}-${event.event_type}-${event.received_at}-${index}`} className="rounded-md border border-border/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{event.source} · {event.event_type}</span>
                    <span className="text-[10px] text-muted-foreground">{event.event_date}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    recebido {formatDistanceToNow(new Date(event.received_at), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function SourceCard({ icon, label, connected, count, last }: { icon: React.ReactNode; label: string; connected: boolean; count: string; last: string | null }) {
  return (
    <div className="section-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", connected ? "bg-green-500/10 text-green-600" : "bg-secondary text-muted-foreground")}>
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-[11px] text-muted-foreground">{count}</div>
          </div>
        </div>
        {connected ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">
        {last ? `Último evento ${formatDistanceToNow(new Date(last), { addSuffix: true, locale: ptBR })}` : "Sem evento recente"}
      </p>
    </div>
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

function lastReceivedAt(events: RawEventRow[], source: string) {
  return events.find((event) => event.source === source)?.received_at ?? null;
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
  events: RawEventRow[],
  syncRuns: SyncRunRow[],
  metrics: DailyMetricRow[],
) {
  const alerts: string[] = [];
  const rawByType: Record<string, number> = {};
  for (const event of events) {
    rawByType[event.event_type] = (rawByType[event.event_type] ?? 0) + 1;
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

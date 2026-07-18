import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  listSourceHealthSignals,
  type SourceHealthSignalRow,
} from "@/lib/operationalReadApi";
import {
  deriveOverallHealth,
  deriveSourceHealth,
  SOURCE_HEALTH_LABELS,
  statusRequiresAction,
  type SourceHealthKey,
  type SourceHealthResult,
  type SourceHealthStatus,
} from "@/lib/sourceHealth";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  updated_at: string;
}

interface HealthRow {
  project: ProjectRow;
  clientName: string;
  sources: Record<SourceHealthKey, SourceHealthResult>;
  overall: SourceHealthStatus;
  lastActivityAt: string | null;
  problemCount: number;
}

const SOURCE_KEYS: SourceHealthKey[] = ["meta", "vturb", "gateway", "creative"];
const SOURCE_LABELS: Record<SourceHealthKey, string> = {
  meta: "Meta",
  vturb: "VTurb",
  gateway: "Gateway",
  creative: "Criativos",
};

export default function HealthOverview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentWorkspace, workspaces, loading: workspaceLoading } = useWorkspace();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceHealthKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SourceHealthStatus | "action" | "all">("all");

  const accessibleClientIds = useMemo(() => workspaces.map((workspace) => workspace.id), [workspaces]);
  const requestedClientId = searchParams.get("client");
  const scopeClientId =
    requestedClientId === "all"
      ? "all"
      : requestedClientId && accessibleClientIds.includes(requestedClientId)
        ? requestedClientId
        : currentWorkspace?.id ?? accessibleClientIds[0] ?? "all";

  const load = useCallback(async () => {
    if (accessibleClientIds.length === 0) {
      setRows([]);
      setState("ready");
      return;
    }

    setState("loading");
    setErrorMessage("");
    try {
      const scopedIds =
        scopeClientId === "all" ? accessibleClientIds : [scopeClientId];
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("id, workspace_id, name, updated_at")
        .in("workspace_id", scopedIds)
        .order("updated_at", { ascending: false });
      if (projectError) throw projectError;

      const projects = (projectData ?? []) as ProjectRow[];
      const projectIds = projects.map((project) => project.id);
      if (projectIds.length === 0) {
        setRows([]);
        setState("ready");
        return;
      }

      const authorizedSignals = await listSourceHealthSignals(
        scopeClientId === "all" ? null : scopeClientId,
      );
      const signalsByProject = new Map<
        string,
        Map<SourceHealthKey, SourceHealthSignalRow>
      >();
      for (const signal of authorizedSignals) {
        if (!projectIds.includes(signal.project_id)) continue;
        const projectSignals =
          signalsByProject.get(signal.project_id) ??
          new Map<SourceHealthKey, SourceHealthSignalRow>();
        projectSignals.set(signal.source, signal);
        signalsByProject.set(signal.project_id, projectSignals);
      }

      const nextRows = projects.map<HealthRow>((project) => {
        const projectSignals = signalsByProject.get(project.id);
        const sources = Object.fromEntries(
          SOURCE_KEYS.map((source) => {
            const authorizedSignal = projectSignals?.get(source);

            return [
              source,
              deriveSourceHealth({
                workspaceId: project.workspace_id,
                projectId: project.id,
                source,
                configured: authorizedSignal?.configured ?? false,
                lastSuccessAt: authorizedSignal?.last_success_at ?? null,
                lastEventAt: authorizedSignal?.last_event_at ?? null,
                lastErrorAt: authorizedSignal?.last_error_at ?? null,
                syncing:
                  authorizedSignal?.sync_status === "queued" ||
                  authorizedSignal?.sync_status === "running",
                warningCount: authorizedSignal?.warning_count ?? 0,
                criticalCount: authorizedSignal?.critical_count ?? 0,
              }),
            ];
          }),
        ) as Record<SourceHealthKey, SourceHealthResult>;

        const overall = deriveOverallHealth(Object.values(sources));

        const sourceActivities = Object.values(sources)
          .map((source) => source.lastActivityAt)
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
        const sourceProblemCount = Object.values(sources).filter((source) =>
          statusRequiresAction(source.status),
        ).length;

        return {
          project,
          clientName:
            workspaces.find((workspace) => workspace.id === project.workspace_id)?.name ??
            "Cliente",
          sources,
          overall,
          lastActivityAt: sourceActivities[0] ?? null,
          problemCount: sourceProblemCount,
        };
      });

      setRows(nextRows);
      setState("ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível carregar a saúde das fontes.",
      );
      setState("error");
    }
  }, [accessibleClientIds, scopeClientId, workspaces]);

  useEffect(() => {
    if (!workspaceLoading) void load();
  }, [load, workspaceLoading]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      const selectedStatus =
        sourceFilter === "all" ? row.overall : row.sources[sourceFilter].status;
      const matchesSearch =
        !normalizedSearch ||
        `${row.clientName} ${row.project.name}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "action"
          ? statusRequiresAction(selectedStatus)
          : selectedStatus === statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, sourceFilter, statusFilter]);

  const summary = useMemo(
    () => ({
      action: rows.filter((row) => statusRequiresAction(row.overall)).length,
      syncing: rows.filter((row) => row.overall === "syncing").length,
      healthy: rows.filter((row) => row.overall === "healthy").length,
      notConfigured: rows.filter((row) => row.overall === "not_configured").length,
    }),
    [rows],
  );

  const setClientScope = (clientId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("client", clientId);
    setSearchParams(next);
  };

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold leading-8">Saúde das fontes</h1>
          <p className="text-sm text-muted-foreground">
            Monitore todos os funis e vá direto ao problema que precisa de ação.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} className="min-h-11 gap-2">
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Requer ação"
          value={summary.action}
          status="error"
          active={statusFilter === "action"}
          onClick={() => setStatusFilter(statusFilter === "action" ? "all" : "action")}
        />
        <SummaryCard
          label="Sincronizando"
          value={summary.syncing}
          status="syncing"
          active={statusFilter === "syncing"}
          onClick={() => setStatusFilter(statusFilter === "syncing" ? "all" : "syncing")}
        />
        <SummaryCard
          label="Saudáveis"
          value={summary.healthy}
          status="healthy"
          active={statusFilter === "healthy"}
          onClick={() => setStatusFilter(statusFilter === "healthy" ? "all" : "healthy")}
        />
        <SummaryCard
          label="Sem conexão"
          value={summary.notConfigured}
          status="not_configured"
          active={statusFilter === "not_configured"}
          onClick={() =>
            setStatusFilter(statusFilter === "not_configured" ? "all" : "not_configured")
          }
        />
      </div>

      <section className="mb-6 grid gap-3 rounded-xl border border-border/60 bg-card p-4 md:grid-cols-[1fr_220px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente ou funil"
            className="min-h-11 pl-9"
          />
        </div>
        <Select value={scopeClientId} onValueChange={setClientScope}>
          <SelectTrigger className="min-h-11" aria-label="Filtrar por cliente">
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {workspaces.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                {workspace.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sourceFilter}
          onValueChange={(value) => setSourceFilter(value as SourceHealthKey | "all")}
        >
          <SelectTrigger className="min-h-11" aria-label="Filtrar por fonte">
            <SelectValue placeholder="Fonte" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as fontes</SelectItem>
            {SOURCE_KEYS.map((source) => (
              <SelectItem key={source} value={source}>
                {SOURCE_LABELS[source]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {state === "loading" && (
        <div className="flex min-h-64 items-center justify-center" aria-busy="true">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Carregando saúde das fontes</span>
        </div>
      )}

      {state === "error" && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5" role="alert">
          <p className="font-medium text-destructive">Falha ao carregar a saúde das fontes</p>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" onClick={() => void load()} className="mt-4 min-h-11">
            Tentar novamente
          </Button>
        </div>
      )}

      {state === "ready" && filteredRows.length === 0 && (
        <div className="section-card py-12 text-center">
          <Circle className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Nenhum funil encontrado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajuste os filtros ou crie o primeiro funil deste cliente.
          </p>
        </div>
      )}

      {state === "ready" && filteredRows.length > 0 && (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  {scopeClientId === "all" && <th className="px-4 py-3 text-left font-medium">Cliente</th>}
                  <th className="px-4 py-3 text-left font-medium">Funil</th>
                  <th className="px-3 py-3 text-left font-medium">Geral</th>
                  {SOURCE_KEYS.map((source) => (
                    <th key={source} className="px-3 py-3 text-left font-medium">
                      {SOURCE_LABELS[source]}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left font-medium">Última atividade</th>
                  <th className="px-3 py-3 text-center font-medium">Problemas</th>
                  <th className="px-4 py-3 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.map((row) => (
                  <tr key={row.project.id} className="hover:bg-muted/20">
                    {scopeClientId === "all" && (
                      <td className="max-w-40 truncate px-4 py-4 text-muted-foreground">
                        {row.clientName}
                      </td>
                    )}
                    <td className="max-w-48 truncate px-4 py-4 font-medium">{row.project.name}</td>
                    <td className="px-3 py-4"><HealthBadge status={row.overall} /></td>
                    {SOURCE_KEYS.map((source) => (
                      <td key={source} className="px-3 py-4">
                        <HealthBadge status={row.sources[source].status} compact />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-4 text-xs text-muted-foreground">
                      {formatRelativeActivity(row.lastActivityAt)}
                    </td>
                    <td className="px-3 py-4 text-center tabular-nums">{row.problemCount}</td>
                    <td className="px-4 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={() => navigate(`/funnels/${row.project.id}/health`)}
                      >
                        Ver detalhe
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {filteredRows.map((row) => (
              <article key={row.project.id} className="section-card p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    {scopeClientId === "all" && (
                      <p className="text-xs text-muted-foreground">{row.clientName}</p>
                    )}
                    <h2 className="font-semibold">{row.project.name}</h2>
                  </div>
                  <HealthBadge status={row.overall} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SOURCE_KEYS.map((source) => (
                    <div key={source} className="rounded-lg border border-border/50 p-3">
                      <p className="mb-2 text-xs text-muted-foreground">{SOURCE_LABELS[source]}</p>
                      <HealthBadge status={row.sources[source].status} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeActivity(row.lastActivityAt)} · {row.problemCount} problema(s)
                  </p>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => navigate(`/funnels/${row.project.id}/health`)}
                  >
                    Ver detalhe
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  status,
  active,
  onClick,
}: {
  label: string;
  value: number;
  status: SourceHealthStatus;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "section-card min-h-24 p-4 text-left transition-colors md:p-5",
        active && "border-primary ring-1 ring-primary/30",
      )}
    >
      <HealthStatusIcon status={status} />
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

export function HealthBadge({
  status,
  compact = false,
}: {
  status: SourceHealthStatus;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        status === "healthy" && "bg-green-500/10 text-green-700",
        status === "syncing" && "bg-blue-500/10 text-blue-700",
        status === "warning" && "bg-amber-500/10 text-amber-700",
        status === "error" && "bg-red-500/10 text-red-700",
        status === "not_configured" && "bg-muted text-muted-foreground",
      )}
    >
      <HealthStatusIcon status={status} />
      {!compact && SOURCE_HEALTH_LABELS[status]}
      {compact && <span className="sr-only">{SOURCE_HEALTH_LABELS[status]}</span>}
    </span>
  );
}

function HealthStatusIcon({ status }: { status: SourceHealthStatus }) {
  if (status === "healthy") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "syncing") return <RefreshCw className="h-3.5 w-3.5 animate-spin" />;
  if (status === "warning") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === "error") return <XCircle className="h-3.5 w-3.5" />;
  return <Circle className="h-3.5 w-3.5" />;
}

function formatRelativeActivity(value: string | null) {
  if (!value) return "Sem atividade";
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR });
}

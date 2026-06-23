import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  FileUp,
  Inbox,
  Link as LinkIcon,
  Loader2,
  Megaphone,
  PlayCircle,
  RefreshCw,
  Settings2,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { readHublaImportFile } from "@/lib/hublaImportFile";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type GatewayProvider = "hotmart" | "hubla" | "kiwify";
type EventSource = "meta" | "vturb" | "gateway";

interface ProjectRow {
  id: string;
  name: string;
  source: "csv" | "sheet" | "api";
  workspace_id: string;
}

interface RawEventRow {
  id: string;
  source: EventSource;
  event_type: string;
  event_date: string;
  account_id: string | null;
  received_at: string;
}

interface TestResult {
  ok: boolean;
  name?: string | null;
  account_status?: number | null;
  currency?: string | null;
  error?: string;
}

interface WorkspaceIntegrationRow {
  workspace_id: string;
  vturb_last_event_at: string | null;
  gateway_provider: GatewayProvider | null;
  gateway_webhook_token: string;
  gateway_last_event_at: string | null;
}

interface MetaAccountRow {
  id: string;
  account_id: string;
  label: string | null;
  last_synced_at: string | null;
}

interface VturbPlayerRow {
  id: string;
  player_id: string;
  label: string | null;
  last_synced_at: string | null;
}

interface ProjectCheckoutBindingRow {
  project_id: string;
  webhook_token: string;
  enabled: boolean;
}

interface ProjectMetaSelectionRow {
  meta_account_id: string;
}

interface ProjectVturbSelectionRow {
  vturb_player_id: string;
}

interface ProjectPublicLinkRow {
  id: string;
  project_id: string;
  token: string;
  enabled: boolean;
  label: string | null;
  last_accessed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function humanizeMetaError(err: string) {
  const e = err.toLowerCase();
  if (e.includes("oauth") || e.includes("access token") || e.includes("session has expired") || e.includes("190")) {
    return "Token expirado ou inválido. Gere um novo System User Token no Business Manager.";
  }
  if (e.includes("permission") || (e.includes("100") && e.includes("ads_read"))) {
    return "Token sem permissão ads_read nesta conta. Verifique o acesso do System User.";
  }
  if (e.includes("does not exist") || e.includes("unsupported get request")) {
    return "Ad Account ID inválido ou inacessível com este token.";
  }
  if (e.includes("rate limit") || e.includes("(#17)")) {
    return "Limite da Meta atingido. Tente novamente em alguns minutos.";
  }
  return err.length > 140 ? `${err.slice(0, 140)}…` : err;
}

export default function Connections() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { currentWorkspace, isWorkspaceAdmin, setCurrentWorkspaceId } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [workspaceIntegration, setWorkspaceIntegration] = useState<WorkspaceIntegrationRow | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccountRow[]>([]);
  const [selectedMetaIds, setSelectedMetaIds] = useState<string[]>([]);
  const [vturbPlayers, setVturbPlayers] = useState<VturbPlayerRow[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [checkoutBinding, setCheckoutBinding] = useState<ProjectCheckoutBindingRow | null>(null);
  const [publicLinks, setPublicLinks] = useState<ProjectPublicLinkRow[]>([]);
  const [events, setEvents] = useState<RawEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventSource | "all">("all");
  const [testingAccountId, setTestingAccountId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [vturbTesting, setVturbTesting] = useState(false);
  const [vturbTestResult, setVturbTestResult] = useState<{ ok: boolean; platforms?: string[]; error?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [vturbSyncing, setVturbSyncing] = useState(false);
  const [vturbSyncingPlayerId, setVturbSyncingPlayerId] = useState<string | null>(null);
  const [hublaImportOpen, setHublaImportOpen] = useState(false);
  const [hublaCsv, setHublaCsv] = useState("");
  const [hublaImporting, setHublaImporting] = useState(false);
  const [hublaImportPreview, setHublaImportPreview] = useState<{
    imported: number;
    skipped: number;
    dates: string[];
    warnings: string[];
    headers: string[];
  } | null>(null);

  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, navigate, userId]);

  useEffect(() => {
    if (!userId || !projectId) return;
    void load();
    void loadEvents();
  }, [projectId, userId]);

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

      setProject(projectData as ProjectRow);
      if (projectData.workspace_id && projectData.workspace_id !== currentWorkspace?.id) {
        setCurrentWorkspaceId(projectData.workspace_id);
      }

      const [
        { data: integrationRow },
        { data: metaRows },
        { data: selectedMetaRows },
        { data: playerRows },
        { data: selectedPlayerRows },
        { data: checkoutRow },
        { data: publicLinkRows },
      ] = await Promise.all([
        supabase
          .from("workspace_integrations")
          .select("workspace_id, vturb_last_event_at, gateway_provider, gateway_webhook_token, gateway_last_event_at")
          .eq("workspace_id", projectData.workspace_id)
          .maybeSingle(),
        supabase
          .from("workspace_meta_accounts")
          .select("id, account_id, label, last_synced_at")
          .eq("workspace_id", projectData.workspace_id)
          .order("created_at", { ascending: true }),
        supabase
          .from("project_meta_accounts")
          .select("meta_account_id")
          .eq("project_id", projectData.id),
        supabase
          .from("workspace_vturb_players")
          .select("id, player_id, label, last_synced_at")
          .eq("workspace_id", projectData.workspace_id)
          .order("created_at", { ascending: true }),
        supabase
          .from("project_vturb_players")
          .select("vturb_player_id")
          .eq("project_id", projectData.id),
        supabase
          .from("project_checkout_bindings")
          .select("project_id, webhook_token, enabled")
          .eq("project_id", projectData.id)
          .maybeSingle(),
        supabase
          .from("project_public_links" as never)
          .select("id, project_id, token, enabled, label, last_accessed_at, expires_at, created_at")
          .eq("project_id", projectData.id)
          .order("created_at", { ascending: false }),
      ]);

      setWorkspaceIntegration((integrationRow ?? null) as WorkspaceIntegrationRow | null);
      setMetaAccounts((metaRows ?? []) as MetaAccountRow[]);
      setSelectedMetaIds(
        ((selectedMetaRows ?? []) as ProjectMetaSelectionRow[]).map((row) => row.meta_account_id),
      );
      setVturbPlayers((playerRows ?? []) as VturbPlayerRow[]);
      setSelectedPlayerIds(
        ((selectedPlayerRows ?? []) as ProjectVturbSelectionRow[]).map((row) => row.vturb_player_id),
      );
      setCheckoutBinding(
        (checkoutRow ?? {
          project_id: projectData.id,
          webhook_token: crypto.getRandomValues(new Uint8Array(24)).reduce((acc, value) => acc + value.toString(16).padStart(2, "0"), ""),
          enabled: true,
        }) as ProjectCheckoutBindingRow,
      );
      setPublicLinks((publicLinkRows ?? []) as unknown as ProjectPublicLinkRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar conexões");
      navigate("/projects", { replace: true });
    } finally {
      setLoading(false);
    }
  }

  async function createPublicLink() {
    if (!project?.id || !user) return;
    try {
      const token = crypto.getRandomValues(new Uint8Array(24)).reduce((acc, value) => acc + value.toString(16).padStart(2, "0"), "");
      const { error } = await supabase.from("project_public_links" as never).insert({
        project_id: project.id,
        token,
        enabled: true,
        label: "Cliente",
        created_by: user.id,
      } as never);
      if (error) throw error;
      toast.success("Link público criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar link");
    }
  }

  async function togglePublicLink(link: ProjectPublicLinkRow) {
    try {
      const { error } = await supabase
        .from("project_public_links" as never)
        .update({ enabled: !link.enabled } as never)
        .eq("id", link.id);
      if (error) throw error;
      toast.success(link.enabled ? "Link desativado" : "Link ativado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar link");
    }
  }

  async function saveBindings() {
    if (!project?.id || !checkoutBinding) return;
    setSaving(true);
    try {
      const { error: metaDeleteError } = await supabase
        .from("project_meta_accounts")
        .delete()
        .eq("project_id", project.id);
      if (metaDeleteError) throw metaDeleteError;

      if (selectedMetaIds.length > 0) {
        const { error } = await supabase.from("project_meta_accounts").insert(
          selectedMetaIds.map((metaAccountId) => ({
            project_id: project.id,
            meta_account_id: metaAccountId,
          })),
        );
        if (error) throw error;
      }

      const { error: playerDeleteError } = await supabase
        .from("project_vturb_players")
        .delete()
        .eq("project_id", project.id);
      if (playerDeleteError) throw playerDeleteError;

      if (selectedPlayerIds.length > 0) {
        const { error } = await supabase.from("project_vturb_players").insert(
          selectedPlayerIds.map((vturbPlayerId) => ({
            project_id: project.id,
            vturb_player_id: vturbPlayerId,
          })),
        );
        if (error) throw error;
      }

      const { error: checkoutError } = await supabase.from("project_checkout_bindings").upsert({
        project_id: project.id,
        webhook_token: checkoutBinding.webhook_token,
        enabled: checkoutBinding.enabled,
      });
      if (checkoutError) throw checkoutError;

      toast.success("Conexões do projeto salvas");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function loadEvents() {
    if (!projectId) return;
    setEventsLoading(true);
    const { data, error } = await supabase
      .from("raw_events")
      .select("id, source, event_type, event_date, account_id, received_at")
      .eq("project_id", projectId)
      .order("received_at", { ascending: false })
      .limit(20);

    if (error) {
      toast.error("Erro ao carregar eventos");
    } else {
      setEvents((data ?? []) as RawEventRow[]);
    }
    setEventsLoading(false);
  }

  async function testAccount(account: MetaAccountRow) {
    setTestingAccountId(account.id);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: { meta_account_id: account.id },
      });
      if (error) throw error;
      const result = data as TestResult;
      setTestResults((current) => ({ ...current, [account.id]: result }));
      if (result.ok) {
        toast.success(`✓ Conexão OK${result.name ? ` — ${result.name}` : ""}`);
      } else {
        toast.error(humanizeMetaError(result.error ?? "Falha"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao testar conta";
      setTestResults((current) => ({ ...current, [account.id]: { ok: false, error: message } }));
      toast.error(message);
    } finally {
      setTestingAccountId(null);
    }
  }

  async function syncMeta(accountId?: string) {
    if (!project?.id) return;
    if (accountId) setSyncingAccountId(accountId);
    else setSyncing(true);

    try {
      const { data, error } = await supabase.functions.invoke("meta-pull", {
        body: { project_id: project.id, days: 30, ...(accountId ? { account_id: accountId } : {}) },
      });
      if (error) throw error;
      const results = (data?.results ?? []) as Array<{ inserted?: number; error?: string }>;
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        toast.error(humanizeMetaError(failed.error));
      } else {
        toast.success(accountId ? "Conta Meta sincronizada" : "Meta sincronizada");
      }
      await load();
      await loadEvents();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar Meta");
    } finally {
      setSyncing(false);
      setSyncingAccountId(null);
    }
  }

  async function testVturbKey() {
    if (!currentWorkspace?.id || !workspaceIntegration) {
      toast.error("Configure a API key da VTurb em Workspace Settings");
      return;
    }
    setVturbTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("vturb-test", {
        body: { workspace_id: currentWorkspace.id },
      });
      if (error) throw error;
      const result = data as { ok: boolean; platforms?: string[]; error?: string };
      setVturbTestResult(result);
      if (result.ok) toast.success("VTurb validada");
      else toast.error(result.error ?? "Falha ao validar a VTurb");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao testar VTurb";
      setVturbTestResult({ ok: false, error: message });
      toast.error(message);
    } finally {
      setVturbTesting(false);
    }
  }

  async function syncVturb(playerId?: string) {
    if (!project?.id) return;
    if (playerId) setVturbSyncingPlayerId(playerId);
    else setVturbSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("vturb-pull", {
        body: { project_id: project.id, days: 30, ...(playerId ? { player_id: playerId } : {}) },
      });
      if (error) throw error;
      const results = (data?.results ?? []) as Array<{ player_id: string; error?: string }>;
      const failed = results.find((result) => result.error);
      if (failed?.error) toast.error(failed.error);
      else toast.success(playerId ? "Player sincronizado" : "VTurb sincronizada");
      await load();
      await loadEvents();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao sincronizar VTurb");
    } finally {
      setVturbSyncing(false);
      setVturbSyncingPlayerId(null);
    }
  }

  async function importHublaCsv(dryRun = false) {
    if (!project?.id) return;
    if (!isWorkspaceAdmin || workspaceIntegration?.gateway_provider !== "hubla") {
      toast.error("Importação CSV disponível apenas para administradores usando Hubla");
      return;
    }
    if (!hublaCsv.trim()) {
      toast.error("Cole ou selecione um CSV/XLSX da Hubla");
      return;
    }

    setHublaImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("hubla-csv-import", {
        body: {
          project_id: project.id,
          csv: hublaCsv,
          dry_run: dryRun,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const result = {
        imported: Number(data?.imported ?? 0),
        skipped: Number(data?.skipped ?? 0),
        dates: Array.isArray(data?.dates) ? data.dates : [],
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        headers: Array.isArray(data?.headers) ? data.headers : [],
      };
      setHublaImportPreview(result);

      if (result.imported === 0) {
        toast.error("Nenhum evento Hubla reconhecido. Confira se o arquivo é export de faturas/vendas da Hubla com status, valor e data.");
        return;
      }

      if (dryRun) {
        toast.success(`Prévia: ${result.imported} evento(s) reconhecido(s)`);
      } else {
        toast.success(`${result.imported} evento(s) Hubla importado(s)`);
        setHublaImportOpen(false);
        setHublaCsv("");
        await load();
        await loadEvents();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao importar CSV Hubla");
    } finally {
      setHublaImporting(false);
    }
  }

  const gatewayWebhookUrl =
    workspaceIntegration?.gateway_provider && checkoutBinding?.webhook_token
      ? `${SUPABASE_URL}/functions/v1/webhook-gateway/${workspaceIntegration.gateway_provider}/${checkoutBinding.webhook_token}`
      : "";
  const publicOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const selectedMetaAccounts = metaAccounts.filter((account) => selectedMetaIds.includes(account.id));
  const selectedPlayers = vturbPlayers.filter((player) => selectedPlayerIds.includes(player.id));
  const filteredEvents = eventFilter === "all" ? events : events.filter((event) => event.source === eventFilter);
  const canImportHublaCsv = isWorkspaceAdmin && workspaceIntegration?.gateway_provider === "hubla";

  // Fallback: redirect to projects if no project param
  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="max-w-[980px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <header className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Projetos
          </Button>
          <div>
            <h1 className="text-xl font-bold">Conexões — {project?.name}</h1>
            <p className="text-xs text-muted-foreground">
              Vincule recursos do workspace a este projeto.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/workspace-settings")} className="gap-2">
            <Settings2 className="w-4 h-4" />
            Workspace Settings
          </Button>
          <Button onClick={() => navigate(`/dashboard?project=${projectId}`)} variant="outline" size="sm">
            Abrir dashboard
          </Button>
        </div>
      </header>

      <div className="space-y-4">
        <ConnectionCard
          icon={<Megaphone className="w-5 h-5" />}
          title="Meta Ads"
          subtitle="Escolha quais contas do workspace este projeto deve usar"
          connected={selectedMetaAccounts.length > 0}
          lastEvent={selectedMetaAccounts.reduce<string | null>(
            (latest, account) =>
              account.last_synced_at && (!latest || account.last_synced_at > latest)
                ? account.last_synced_at
                : latest,
            null,
          )}
        >
          {metaAccounts.length === 0 ? (
            <EmptyState text="Nenhuma conta Meta disponível. Cadastre as credenciais em Workspace Settings." />
          ) : (
            <div className="space-y-3">
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {metaAccounts.map((account) => (
                  <div key={account.id} className="rounded-lg border border-border/40 p-3 space-y-3 bg-background/40">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <Checkbox
                          checked={selectedMetaIds.includes(account.id)}
                          onCheckedChange={(checked) => {
                            setSelectedMetaIds((current) =>
                              checked
                                ? [...current, account.id]
                                : current.filter((id) => id !== account.id),
                            );
                          }}
                          disabled={!isWorkspaceAdmin}
                        />
                        <div>
                          <div className="text-sm font-medium">{account.label || account.account_id}</div>
                          <div className="text-xs text-muted-foreground font-mono">{account.account_id}</div>
                        </div>
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => testAccount(account)}
                          disabled={testingAccountId === account.id}
                        >
                          {testingAccountId === account.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                        </Button>
                        {selectedMetaIds.includes(account.id) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => syncMeta(account.account_id)}
                            disabled={syncingAccountId === account.account_id}
                          >
                            {syncingAccountId === account.account_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </div>

                    {testResults[account.id] && (
                      <div className={`text-[10px] px-2 py-1 rounded ${testResults[account.id].ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                        {testResults[account.id].ok
                          ? `✓ ${testResults[account.id].name ?? "OK"}`
                          : `✗ ${humanizeMetaError(testResults[account.id].error ?? "")}`}
                      </div>
                    )}

                    {account.last_synced_at && (
                      <div className="text-[10px] text-muted-foreground">
                        Última sync: {format(new Date(account.last_synced_at), "dd/MM HH:mm", { locale: ptBR })}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selectedMetaAccounts.length > 1 && (
                <Button onClick={() => syncMeta()} disabled={syncing} variant="secondary" size="sm" className="gap-2">
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sincronizar contas selecionadas
                </Button>
              )}
            </div>
          )}
        </ConnectionCard>

        <ConnectionCard
          icon={<PlayCircle className="w-5 h-5" />}
          title="VTurb"
          subtitle="Selecione os players que alimentam este projeto"
          connected={selectedPlayers.length > 0}
          lastEvent={workspaceIntegration?.vturb_last_event_at ?? null}
        >
          {!workspaceIntegration ? (
            <EmptyState text="Configure a API key da VTurb em Workspace Settings antes de vincular players." />
          ) : vturbPlayers.length === 0 ? (
            <EmptyState text="Nenhum player VTurb disponível. Cadastre players em Workspace Settings." />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  API key configurada no workspace.
                </div>
                <Button type="button" variant="outline" size="sm" onClick={testVturbKey} disabled={vturbTesting}>
                  {vturbTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  <span className="ml-2">Testar chave</span>
                </Button>
              </div>
              {vturbTestResult && (
                <div className={`text-[10px] px-2 py-1 rounded ${vturbTestResult.ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  {vturbTestResult.ok ? "✓ API key validada" : `✗ ${vturbTestResult.error ?? "Falha"}`}
                </div>
              )}

              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {vturbPlayers.map((player) => (
                  <div key={player.id} className="rounded-lg border border-border/40 p-3 space-y-3 bg-background/40">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <Checkbox
                          checked={selectedPlayerIds.includes(player.id)}
                          onCheckedChange={(checked) => {
                            setSelectedPlayerIds((current) =>
                              checked
                                ? [...current, player.id]
                                : current.filter((id) => id !== player.id),
                            );
                          }}
                          disabled={!isWorkspaceAdmin}
                        />
                        <div>
                          <div className="text-sm font-medium">{player.label || player.player_id}</div>
                          <div className="text-xs text-muted-foreground font-mono">{player.player_id}</div>
                        </div>
                      </label>
                      {selectedPlayerIds.includes(player.id) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => syncVturb(player.player_id)}
                          disabled={vturbSyncingPlayerId === player.player_id}
                        >
                          {vturbSyncingPlayerId === player.player_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                    </div>
                    {player.last_synced_at && (
                      <div className="text-[10px] text-muted-foreground">
                        Última sync: {format(new Date(player.last_synced_at), "dd/MM HH:mm", { locale: ptBR })}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {selectedPlayers.length > 1 && (
                <Button onClick={() => syncVturb()} disabled={vturbSyncing} variant="secondary" size="sm" className="gap-2">
                  {vturbSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Sincronizar players selecionados
                </Button>
              )}
            </div>
          )}
        </ConnectionCard>

        <ConnectionCard
          icon={<CreditCard className="w-5 h-5" />}
          title="Gateway de Pagamento"
          subtitle="Webhook opaco por projeto usando a configuração do workspace"
          connected={!!workspaceIntegration?.gateway_provider && checkoutBinding?.enabled}
          lastEvent={workspaceIntegration?.gateway_last_event_at ?? null}
        >
          {!workspaceIntegration?.gateway_provider ? (
            <EmptyState text="Configure o gateway em Workspace Settings para habilitar o webhook deste projeto." />
          ) : (
            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm font-medium">
                <Checkbox
                  checked={checkoutBinding?.enabled ?? false}
                  onCheckedChange={(checked) =>
                    setCheckoutBinding((current) =>
                      current ? { ...current, enabled: checked === true } : current,
                    )
                  }
                  disabled={!isWorkspaceAdmin}
                />
                Habilitar webhook deste projeto
              </label>

              {checkoutBinding?.enabled && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Configure o {workspaceIntegration?.gateway_provider || "gateway"} para receber
                    notificacoes de vendas automaticamente.
                  </p>
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(gatewayWebhookUrl);
                        toast.success("URL copiada! Cole no painel do seu gateway.");
                      }}
                      className="gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copiar URL de integracao
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      (URL segura gerada automaticamente)
                    </span>
                  </div>
                  {canImportHublaCsv && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setHublaImportPreview(null);
                          setHublaImportOpen(true);
                        }}
                        className="gap-2"
                      >
                        <FileUp className="w-4 h-4" />
                        Importar CSV/XLSX Hubla
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Use para vendas retroativas sem payload bruto do webhook.
                      </span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Eventos suportados: criacao de checkout, compra aprovada, recusada e reembolsada.
                  </p>
                </div>
              )}
            </div>
          )}
        </ConnectionCard>

        {/* Separador visual - seção de compartilhamento */}
        <div className="border-t border-border/60 pt-6 mt-6" id="sharing">
          <h2 className="text-lg font-semibold mb-1">Compartilhamento</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Crie links para clientes visualizarem o dashboard sem login.
          </p>
        </div>

        <ConnectionCard
          icon={<LinkIcon className="w-5 h-5" />}
          title="Link Publico"
          subtitle="Dashboard somente leitura para cliente"
          connected={publicLinks.some((link) => link.enabled)}
          lastEvent={publicLinks.reduce<string | null>(
            (latest, link) =>
              link.last_accessed_at && (!latest || link.last_accessed_at > latest)
                ? link.last_accessed_at
                : latest,
            null,
          )}
        >
          <div className="space-y-3">
            {publicLinks.length === 0 ? (
              <EmptyState text="Nenhum link público criado. Gere um link para enviar dashboard e relatório ao cliente sem expor conexões." />
            ) : (
              <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {publicLinks.map((link) => {
                  const shareUrl = `${publicOrigin}/share/${link.token}`;
                  return (
                    <div key={link.id} className="rounded-lg border border-border/40 p-3 space-y-3 bg-background/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{link.label || "Cliente"}</div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{shareUrl}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {link.last_accessed_at
                              ? `Último acesso: ${format(new Date(link.last_accessed_at), "dd/MM HH:mm", { locale: ptBR })}`
                              : "Ainda não acessado"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(shareUrl);
                              toast.success("Link copiado");
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {isWorkspaceAdmin && (
                            <Button
                              type="button"
                              variant={link.enabled ? "secondary" : "outline"}
                              size="sm"
                              onClick={() => togglePublicLink(link)}
                            >
                              {link.enabled ? "Desativar" : "Ativar"}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className={`text-[10px] px-2 py-1 rounded w-fit ${link.enabled ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
                        {link.enabled ? "ativo" : "desativado"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isWorkspaceAdmin && (
              <Button type="button" variant="secondary" size="sm" onClick={createPublicLink} className="gap-2">
                <LinkIcon className="w-4 h-4" />
                Criar link público
              </Button>
            )}
          </div>
        </ConnectionCard>

        {isWorkspaceAdmin && (
          <div className="flex justify-end">
            <Button onClick={saveBindings} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Salvar configuracoes
            </Button>
          </div>
        )}

        <div className="section-card">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold">Eventos recebidos</h3>
                <p className="text-xs text-muted-foreground">Últimos 20 eventos brutos deste projeto</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={eventFilter} onValueChange={(value) => setEventFilter(value as EventSource | "all")}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as fontes</SelectItem>
                  <SelectItem value="meta">Meta</SelectItem>
                  <SelectItem value="vturb">VTurb</SelectItem>
                  <SelectItem value="gateway">Gateway</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={loadEvents} disabled={eventsLoading}>
                {eventsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Atualizar
              </Button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center">
              {eventsLoading ? "Carregando…" : "Nenhum evento recebido ainda."}
            </p>
          ) : (
            <div className="max-h-[360px] overflow-auto rounded-md border border-border/40">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-secondary text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Quando</th>
                    <th className="text-left px-3 py-2 font-medium">Fonte</th>
                    <th className="text-left px-3 py-2 font-medium">Tipo</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Conta</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Data evento</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} className="border-t border-border/40">
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                        {format(new Date(event.received_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          event.source === "meta"
                            ? "bg-blue-500/10 text-blue-500"
                            : event.source === "vturb"
                              ? "bg-purple-500/10 text-purple-500"
                              : "bg-green-500/10 text-green-500"
                        }`}>
                          {event.source}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono">{event.event_type}</td>
                      <td className="px-3 py-1.5 text-muted-foreground font-mono hidden sm:table-cell">
                        {event.account_id ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground hidden sm:table-cell">
                        {format(new Date(event.event_date), "dd/MM/yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <Dialog open={hublaImportOpen} onOpenChange={setHublaImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar CSV/XLSX Hubla</DialogTitle>
            <DialogDescription>
              Importe vendas retroativas para preencher faturamento e vendas quando os webhooks antigos não têm payload bruto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Arquivo CSV ou XLSX</Label>
              <Input
                type="file"
                accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setHublaImportPreview(null);
                  try {
                    const result = await readHublaImportFile(file);
                    setHublaCsv(result.csv);
                    if (result.kind === "xlsx") {
                      toast.success(`XLSX convertido usando a aba "${result.sheetName}"`);
                    }
                  } catch (error) {
                    setHublaCsv("");
                    toast.error(error instanceof Error ? error.message : "Erro ao ler arquivo Hubla");
                  } finally {
                    event.currentTarget.value = "";
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Conteúdo CSV</Label>
              <Textarea
                value={hublaCsv}
                onChange={(event) => {
                  setHublaImportPreview(null);
                  setHublaCsv(event.target.value);
                }}
                rows={10}
                placeholder="Cole aqui o export da Hubla com colunas como ID da fatura, status, data, valor, email, produto e UTMs."
                className="font-mono text-xs"
              />
            </div>
            {hublaImportPreview && (
              <div className={`rounded-lg border p-3 text-sm ${
                hublaImportPreview.imported === 0
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-border/50 bg-muted/20"
              }`}>
                <div className="font-medium">
                  {hublaImportPreview.imported} evento(s) reconhecido(s) · {hublaImportPreview.skipped} linha(s) ignorada(s)
                </div>
                {hublaImportPreview.imported === 0 && (
                  <div className="mt-1 text-xs text-red-600">
                    Importação bloqueada: o arquivo não gerou vendas, reembolsos, recusas ou checkouts reconhecíveis.
                  </div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  Datas: {hublaImportPreview.dates.length > 0 ? hublaImportPreview.dates.join(", ") : "nenhuma"}
                </div>
                {hublaImportPreview.headers.length > 0 && (
                  <div className="mt-2 rounded border border-border/40 bg-background/50 p-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground/80 mb-1">Cabeçalhos detectados</div>
                    <div className="max-h-16 overflow-y-auto break-words">
                      {hublaImportPreview.headers.join(", ")}
                    </div>
                  </div>
                )}
                {hublaImportPreview.warnings.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded border border-border/40 bg-background/50 p-2 text-xs text-muted-foreground">
                    {hublaImportPreview.warnings.slice(0, 50).map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => importHublaCsv(true)} disabled={hublaImporting || !hublaCsv.trim()}>
              {hublaImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Validar
            </Button>
            <Button onClick={() => importHublaCsv(false)} disabled={hublaImporting || !hublaCsv.trim()} className="gap-2">
              {hublaImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
              Importar e reprocessar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-xs text-muted-foreground italic">{text}</div>;
}

function ConnectionCard({
  icon,
  title,
  subtitle,
  connected,
  lastEvent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  connected: boolean;
  lastEvent: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="section-card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${connected ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{title}</h2>
              {connected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600">
                  <CheckCircle2 className="w-3 h-3" />
                  ativo
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {lastEvent && (
          <div className="text-[11px] text-muted-foreground">
            Último evento: {format(new Date(lastEvent), "dd/MM HH:mm", { locale: ptBR })}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Save,
  ShoppingBag,
  Trash2,
  Video,
} from "lucide-react";
import { AdminPage } from "@/components/admin/AdminPage";
import { AsyncState } from "@/components/admin/AsyncState";
import { StatusPill } from "@/components/admin/StatusPill";
import { useAdminClient } from "@/components/admin/useAdminClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  getWorkspaceIntegrationSafe,
  listWorkspaceCheckoutBindingsSafe,
  listWorkspaceMetaAccountsSafe,
} from "@/lib/operationalReadApi";
import { toast } from "sonner";

type GatewayProvider = "hotmart" | "hubla" | "kiwify";
type IntegrationEditor = "meta" | "vturb" | "gateway" | null;

interface IntegrationRow {
  workspace_id: string;
  vturb_last_event_at: string | null;
  gateway_provider: GatewayProvider | null;
  gateway_last_event_at: string | null;
}

interface MetaAccount {
  id: string;
  account_id: string;
  label: string | null;
  last_synced_at: string | null;
  boundProjectCount: number;
}

interface VturbPlayer {
  id: string;
  player_id: string;
  label: string | null;
  last_synced_at: string | null;
  boundProjectCount: number;
}

interface DiscoveredMetaAccount {
  id: string;
  account_id: string;
  name: string | null;
  currency: string | null;
}

interface VturbPlayerMetadata {
  id: string;
  name: string | null;
}

function countBindings(
  rows: Array<Record<string, string | null>>,
  key: string,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatUseCount(count: number) {
  if (count === 0) return "Ainda não usada por nenhum funil";
  return `Usada por ${count} ${count === 1 ? "funil" : "funis"}`;
}

function formatLastActivity(value: string | null) {
  if (!value) return "Nenhuma atividade registrada";
  return `Última atividade em ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

export default function ClientIntegrations() {
  const { user } = useAuth();
  const { client, clientId, canManage } = useAdminClient();
  const [integration, setIntegration] = useState<IntegrationRow | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccount[]>([]);
  const [vturbPlayers, setVturbPlayers] = useState<VturbPlayer[]>([]);
  const [gatewayUseCount, setGatewayUseCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editor, setEditor] = useState<IntegrationEditor>(null);

  const [metaId, setMetaId] = useState<string | null>(null);
  const [metaLabel, setMetaLabel] = useState("");
  const [metaAccountId, setMetaAccountId] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [discoveredMeta, setDiscoveredMeta] = useState<DiscoveredMetaAccount[]>([]);
  const [discoveringMeta, setDiscoveringMeta] = useState(false);
  const [testingMetaId, setTestingMetaId] = useState<string | null>(null);

  const [vturbApiKey, setVturbApiKey] = useState("");
  const [refreshingVturb, setRefreshingVturb] = useState(false);
  const [gatewayProvider, setGatewayProvider] = useState<GatewayProvider | "">("");
  const [gatewaySecret, setGatewaySecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const [
        integrationRow,
        metaRows,
        { data: playerRows, error: playerError },
        { data: projectRows, error: projectError },
      ] = await Promise.all([
        getWorkspaceIntegrationSafe(clientId),
        listWorkspaceMetaAccountsSafe(clientId),
        supabase
          .from("workspace_vturb_players")
          .select("id, player_id, label, last_synced_at")
          .eq("workspace_id", clientId)
          .order("created_at", { ascending: true }),
        supabase.from("projects").select("id").eq("workspace_id", clientId),
      ]);
      if (playerError) throw playerError;
      if (projectError) throw projectError;

      const typedMeta = (metaRows ?? []) as Omit<MetaAccount, "boundProjectCount">[];
      const typedPlayers = (playerRows ?? []) as Omit<
        VturbPlayer,
        "boundProjectCount"
      >[];
      const metaIds = typedMeta.map((account) => account.id);
      const playerIds = typedPlayers.map((player) => player.id);
      const projectIds = (projectRows ?? []).map((project) => project.id);

      const [metaBindingResult, playerBindingResult, gatewayBindingResult] =
        await Promise.all([
          metaIds.length
            ? supabase
                .from("project_meta_accounts")
                .select("meta_account_id")
                .in("meta_account_id", metaIds)
            : Promise.resolve({ data: [], error: null }),
          playerIds.length
            ? supabase
                .from("project_vturb_players")
                .select("vturb_player_id")
                .in("vturb_player_id", playerIds)
            : Promise.resolve({ data: [], error: null }),
          projectIds.length
            ? listWorkspaceCheckoutBindingsSafe(clientId)
            : Promise.resolve([]),
        ]);
      if (metaBindingResult.error) throw metaBindingResult.error;
      if (playerBindingResult.error) throw playerBindingResult.error;

      const metaCounts = countBindings(
        (metaBindingResult.data ?? []) as Array<Record<string, string | null>>,
        "meta_account_id",
      );
      const playerCounts = countBindings(
        (playerBindingResult.data ?? []) as Array<Record<string, string | null>>,
        "vturb_player_id",
      );

      setIntegration((integrationRow as IntegrationRow | null) ?? null);
      setMetaAccounts(
        typedMeta.map((account) => ({
          ...account,
          boundProjectCount: metaCounts.get(account.id) ?? 0,
        })),
      );
      setVturbPlayers(
        typedPlayers.map((player) => ({
          ...player,
          boundProjectCount: playerCounts.get(player.id) ?? 0,
        })),
      );
      setGatewayUseCount(
        gatewayBindingResult.filter((binding) => binding.enabled).length,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao carregar as integrações.",
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    void loadIntegrations();
  }, [clientId, loadIntegrations]);

  function openNewMeta() {
    setMetaId(null);
    setMetaLabel("");
    setMetaAccountId("");
    setMetaToken("");
    setDiscoveredMeta([]);
    setEditor("meta");
  }

  function openMeta(account: MetaAccount) {
    setMetaId(account.id);
    setMetaLabel(account.label ?? "");
    setMetaAccountId(account.account_id);
    setMetaToken("");
    setDiscoveredMeta([]);
    setEditor("meta");
  }

  function openVturb() {
    setVturbApiKey("");
    setEditor("vturb");
  }

  function openGateway() {
    setGatewayProvider(integration?.gateway_provider ?? "");
    setGatewaySecret("");
    setEditor("gateway");
  }

  async function discoverMetaAccounts() {
    if (!clientId || !metaToken.trim()) return;
    setDiscoveringMeta(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: {
          action: "list_accounts",
          workspace_id: clientId,
          access_token: metaToken.trim(),
        },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error ?? "Token Meta inválido.");
      const accounts = (data?.accounts ?? []) as DiscoveredMetaAccount[];
      setDiscoveredMeta(accounts);
      if (accounts.length === 0) {
        toast.error("Nenhuma conta de anúncios foi encontrada para este token.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao buscar contas Meta.",
      );
    } finally {
      setDiscoveringMeta(false);
    }
  }

  async function testMeta(account: MetaAccount) {
    setTestingMetaId(account.id);
    try {
      const { data, error } = await supabase.functions.invoke("meta-test", {
        body: { meta_account_id: account.id },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error ?? "Credencial Meta inválida.");
      toast.success(`Meta validada${data?.name ? `: ${data.name}` : ""}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao validar a conta Meta.",
      );
    } finally {
      setTestingMetaId(null);
    }
  }

  async function saveMeta() {
    if (!clientId || !canManage || !metaAccountId.trim()) return;
    if (!metaId && !metaToken.trim()) {
      toast.error("Informe um token para cadastrar a conta Meta.");
      return;
    }
    setSaving(true);
    try {
      const accountId = metaAccountId.trim().startsWith("act_")
        ? metaAccountId.trim()
        : `act_${metaAccountId.trim()}`;
      const { error } = await supabase.functions.invoke("workspace-credentials", {
        body: {
          action: "upsert_meta_account",
          workspace_id: clientId,
          meta_account_id: metaId ?? undefined,
          account_id: accountId,
          access_token: metaToken.trim() || undefined,
          label: metaLabel.trim() || null,
        },
      });
      if (error) throw error;
      setEditor(null);
      await loadIntegrations();
      toast.success("Conta Meta salva");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar a conta Meta.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteMeta(account: MetaAccount) {
    if (account.boundProjectCount > 0) {
      toast.error("Desvincule esta conta dos funis antes de removê-la.");
      return;
    }
    setDeletingId(account.id);
    try {
      const { error } = await supabase.functions.invoke("workspace-credentials", {
        body: {
          action: "delete_meta_account",
          workspace_id: clientId,
          meta_account_id: account.id,
        },
      });
      if (error) throw error;
      await loadIntegrations();
      toast.success("Conta Meta removida");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao remover a conta Meta.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function saveVturb() {
    if (!clientId || !canManage || !vturbApiKey.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("workspace-credentials", {
        body: {
          action: "upsert_workspace_integration",
          workspace_id: clientId,
          vturb_api_key: vturbApiKey.trim(),
        },
      });
      if (error) throw error;
      await refreshVturbCatalog(vturbApiKey.trim());
      setEditor(null);
      toast.success("VTurb conectada");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar a integração VTurb.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function refreshVturbCatalog(apiKey?: string) {
    if (!clientId || !user) return;
    setRefreshingVturb(true);
    try {
      const { data, error } = await supabase.functions.invoke("vturb-test", {
        body: apiKey ? { api_key: apiKey } : { workspace_id: clientId },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error ?? "Chave VTurb inválida.");
      const players = ((data?.players ?? []) as VturbPlayerMetadata[]).filter(
        (player) => player.id,
      );
      if (players.length === 0) {
        throw new Error("A VTurb não retornou players para esta chave.");
      }
      const { error: upsertError } = await supabase
        .from("workspace_vturb_players")
        .upsert(
          players.map((player) => ({
            workspace_id: clientId,
            created_by: user.id,
            player_id: player.id,
            label: player.name,
          })),
          { onConflict: "workspace_id,player_id" },
        );
      if (upsertError) throw upsertError;
      await loadIntegrations();
      if (!apiKey) toast.success("Catálogo VTurb atualizado");
    } catch (error) {
      if (!apiKey) {
        toast.error(
          error instanceof Error ? error.message : "Falha ao atualizar players VTurb.",
        );
      } else {
        throw error;
      }
    } finally {
      setRefreshingVturb(false);
    }
  }

  async function deleteVturbPlayer(player: VturbPlayer) {
    if (player.boundProjectCount > 0) {
      toast.error("Desvincule este player dos funis antes de removê-lo.");
      return;
    }
    setDeletingId(player.id);
    try {
      const { error } = await supabase
        .from("workspace_vturb_players")
        .delete()
        .eq("id", player.id);
      if (error) throw error;
      await loadIntegrations();
      toast.success("Player removido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover player.");
    } finally {
      setDeletingId(null);
    }
  }

  async function saveGateway() {
    if (!clientId || !canManage || !gatewayProvider) return;
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("workspace-credentials", {
        body: {
          action: "upsert_workspace_integration",
          workspace_id: clientId,
          gateway_provider: gatewayProvider,
          gateway_webhook_secret: gatewaySecret.trim() || undefined,
        },
      });
      if (error) throw error;
      setEditor(null);
      await loadIntegrations();
      toast.success("Gateway salvo");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao salvar o gateway.",
      );
    } finally {
      setSaving(false);
    }
  }

  const status = useMemo(() => {
    if (loading) return "loading" as const;
    if (errorMessage || !clientId) return "error" as const;
    return "ready" as const;
  }, [clientId, errorMessage, loading]);

  return (
    <AdminPage
      context={client?.name ?? "Cliente"}
      title="Integrações"
      description="Cadastre credenciais e mantenha os catálogos compartilhados deste cliente. A vinculação aos funis acontece em Fontes de dados."
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? "Cliente não encontrado ou sem acesso."}
        onRetry={() => void loadIntegrations()}
      >
        <div className="space-y-6">
          <Card>
            <CardHeader className="p-5 md:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                    <Megaphone className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <CardTitle className="text-lg leading-7">Meta Ads</CardTitle>
                    <CardDescription>
                      Tokens e contas de anúncio disponíveis para os funis.
                    </CardDescription>
                  </div>
                </div>
                {canManage && (
                  <Button className="min-h-11 gap-2" onClick={openNewMeta}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Adicionar conta
                  </Button>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
              {metaAccounts.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <KeyRound className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">Nenhuma conta Meta cadastrada</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Adicione uma credencial para liberar contas nos funis deste cliente.
                  </p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {metaAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {account.label || account.account_id}
                          </p>
                          <StatusPill label="Configurada" tone="success" />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {account.account_id} · {formatUseCount(account.boundProjectCount)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatLastActivity(account.last_synced_at)}
                        </p>
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="min-h-11"
                            disabled={testingMetaId === account.id}
                            onClick={() => void testMeta(account)}
                          >
                            {testingMetaId === account.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                            )}
                            Testar
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-11"
                            onClick={() => openMeta(account)}
                          >
                            Configurar
                          </Button>
                          {account.boundProjectCount === 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-11 w-11 text-destructive hover:text-destructive"
                              aria-label={`Remover ${account.label || account.account_id}`}
                              disabled={deletingId === account.id}
                              onClick={() => void deleteMeta(account)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 md:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600">
                    <Video className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg leading-7">VTurb</CardTitle>
                      <StatusPill
                        label={vturbPlayers.length > 0 ? "Conectada" : "Não configurada"}
                        tone={vturbPlayers.length > 0 ? "success" : "neutral"}
                      />
                    </div>
                    <CardDescription>
                      Chave de API e catálogo de players do cliente.
                    </CardDescription>
                  </div>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {vturbPlayers.length > 0 && (
                      <Button
                        variant="outline"
                        className="min-h-11 gap-2"
                        disabled={refreshingVturb}
                        onClick={() => void refreshVturbCatalog()}
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${refreshingVturb ? "animate-spin" : ""}`}
                          aria-hidden="true"
                        />
                        Atualizar catálogo
                      </Button>
                    )}
                    <Button className="min-h-11" onClick={openVturb}>
                      {vturbPlayers.length > 0 ? "Trocar chave" : "Conectar VTurb"}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
              {vturbPlayers.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Nenhum player disponível. Conecte a VTurb para carregar o catálogo.
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {vturbPlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {player.label || "Player sem nome"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {player.player_id} · {formatUseCount(player.boundProjectCount)}
                        </p>
                      </div>
                      {canManage && player.boundProjectCount === 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-destructive hover:text-destructive"
                          aria-label={`Remover ${player.label || player.player_id}`}
                          disabled={deletingId === player.id}
                          onClick={() => void deleteVturbPlayer(player)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                {formatLastActivity(integration?.vturb_last_event_at ?? null)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 md:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                    <ShoppingBag className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-lg leading-7">
                        Gateway de pagamento
                      </CardTitle>
                      <StatusPill
                        label={
                          integration?.gateway_provider
                            ? "Configurado"
                            : "Não configurado"
                        }
                        tone={integration?.gateway_provider ? "success" : "neutral"}
                      />
                    </div>
                    <CardDescription>
                      Provedor e segredo compartilhados, sem exibir a credencial salva.
                    </CardDescription>
                  </div>
                </div>
                {canManage && (
                  <Button className="min-h-11" onClick={openGateway}>
                    {integration?.gateway_provider ? "Configurar" : "Conectar gateway"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Provedor</dt>
                  <dd className="mt-1 text-sm font-medium capitalize">
                    {integration?.gateway_provider ?? "Não definido"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Uso</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {formatUseCount(gatewayUseCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Atividade</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {formatLastActivity(integration?.gateway_last_event_at ?? null)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </AsyncState>

      <Sheet open={editor === "meta"} onOpenChange={(open) => !open && setEditor(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{metaId ? "Configurar conta Meta" : "Adicionar conta Meta"}</SheetTitle>
            <SheetDescription>
              O token é usado somente para salvar ou validar a conta e não volta a ser exibido.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="meta-token">Token de acesso</Label>
              <Input
                id="meta-token"
                type="password"
                autoComplete="off"
                value={metaToken}
                onChange={(event) => setMetaToken(event.target.value)}
                placeholder={metaId ? "Deixe vazio para manter o token atual" : "EAAB…"}
              />
            </div>
            {!metaId && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full gap-2"
                disabled={!metaToken.trim() || discoveringMeta}
                onClick={() => void discoverMetaAccounts()}
              >
                {discoveringMeta ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                Buscar contas acessíveis
              </Button>
            )}
            {discoveredMeta.length > 0 && (
              <div className="space-y-2">
                <Label>Contas encontradas</Label>
                <div className="divide-y rounded-lg border">
                  {discoveredMeta.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                      onClick={() => {
                        setMetaAccountId(account.account_id);
                        setMetaLabel(account.name ?? "");
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {account.name || account.account_id}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {account.account_id}
                          {account.currency ? ` · ${account.currency}` : ""}
                        </span>
                      </span>
                      {metaAccountId === account.account_id && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="meta-account-id">Ad Account ID</Label>
              <Input
                id="meta-account-id"
                value={metaAccountId}
                onChange={(event) => setMetaAccountId(event.target.value)}
                placeholder="act_1234567890"
                disabled={Boolean(
                  metaId &&
                    metaAccounts.find((account) => account.id === metaId)
                      ?.boundProjectCount,
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-label">Nome para identificação</Label>
              <Input
                id="meta-label"
                value={metaLabel}
                onChange={(event) => setMetaLabel(event.target.value)}
                placeholder="Ex.: Conta principal"
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              className="min-h-11 gap-2"
              disabled={saving || !metaAccountId.trim()}
              onClick={() => void saveMeta()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Salvar conta
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={editor === "vturb"} onOpenChange={(open) => !open && setEditor(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Conectar VTurb</SheetTitle>
            <SheetDescription>
              A chave será validada antes de atualizar o catálogo de players.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2 py-6">
            <Label htmlFor="vturb-key">Chave de API</Label>
            <Input
              id="vturb-key"
              type="password"
              autoComplete="off"
              value={vturbApiKey}
              onChange={(event) => setVturbApiKey(event.target.value)}
              placeholder="Cole a chave da VTurb"
            />
          </div>
          <SheetFooter>
            <Button
              className="min-h-11 gap-2"
              disabled={saving || !vturbApiKey.trim()}
              onClick={() => void saveVturb()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              Validar e conectar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={editor === "gateway"}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Configurar gateway</SheetTitle>
            <SheetDescription>
              O segredo salvo nunca será exibido novamente nesta página.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 py-6">
            <div className="space-y-2">
              <Label htmlFor="gateway-provider">Provedor</Label>
              <Select
                value={gatewayProvider}
                onValueChange={(value) => setGatewayProvider(value as GatewayProvider)}
              >
                <SelectTrigger id="gateway-provider" className="min-h-11">
                  <SelectValue placeholder="Selecione o provedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hotmart">Hotmart</SelectItem>
                  <SelectItem value="hubla">Hubla</SelectItem>
                  <SelectItem value="kiwify">Kiwify</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gateway-secret">Chave secreta</Label>
              <Input
                id="gateway-secret"
                type="password"
                autoComplete="off"
                value={gatewaySecret}
                onChange={(event) => setGatewaySecret(event.target.value)}
                placeholder={
                  integration?.gateway_provider
                    ? "Deixe vazio para manter a chave atual"
                    : "Cole a chave do gateway"
                }
              />
            </div>
          </div>
          <SheetFooter>
            <Button
              className="min-h-11 gap-2"
              disabled={saving || !gatewayProvider}
              onClick={() => void saveGateway()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Salvar gateway
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </AdminPage>
  );
}

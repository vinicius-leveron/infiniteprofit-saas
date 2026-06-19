import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Save, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace, type WorkspaceRole } from "@/hooks/useWorkspace";
import { toast } from "sonner";

type GatewayProvider = "hotmart" | "hubla" | "kiwify";

interface WorkspaceIntegrationRow {
  workspace_id: string;
  vturb_api_key: string | null;
  vturb_last_event_at: string | null;
  gateway_provider: GatewayProvider | null;
  gateway_webhook_secret: string | null;
  gateway_webhook_token: string;
  gateway_last_event_at: string | null;
}

interface MetaAccountRow {
  id?: string;
  account_id: string;
  original_account_id?: string;
  access_token: string;
  label: string | null;
  last_synced_at: string | null;
  boundProjectCount?: number;
}

interface VturbPlayerRow {
  id?: string;
  player_id: string;
  original_player_id?: string;
  label: string | null;
  last_synced_at: string | null;
  boundProjectCount?: number;
}

interface VturbPlayerMetadata {
  id: string;
  name: string | null;
}

interface WorkspaceMemberRow {
  user_id: string;
  role: WorkspaceRole;
}

interface WorkspaceInviteRow {
  id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
}

const randomSecret = () =>
  crypto.getRandomValues(new Uint8Array(24)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");

const normalizeMetaAccountId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
};

function countBindings<T extends Record<string, string | null>>(rows: T[], key: keyof T) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function formatBoundProjects(count: number) {
  return `${count} projeto${count === 1 ? "" : "s"} conectado${count === 1 ? "" : "s"}`;
}

export default function WorkspaceSettings() {
  const { user } = useAuth();
  const { currentWorkspace, isWorkspaceAdmin } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspaceIntegration, setWorkspaceIntegration] = useState<WorkspaceIntegrationRow | null>(null);
  const [metaAccounts, setMetaAccounts] = useState<MetaAccountRow[]>([]);
  const [vturbPlayers, setVturbPlayers] = useState<VturbPlayerRow[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [savingInvite, setSavingInvite] = useState(false);
  const [resolvingVturbNames, setResolvingVturbNames] = useState(false);

  const gatewayWebhookBase = useMemo(() => {
    if (!workspaceIntegration?.gateway_provider || !workspaceIntegration.gateway_webhook_token) return "";
    return `${window.location.origin.replace(/\/$/, "")}/api/webhooks`;
  }, [workspaceIntegration?.gateway_provider, workspaceIntegration?.gateway_webhook_token]);

  useEffect(() => {
    if (!currentWorkspace?.id) return;
    void load();
  }, [currentWorkspace?.id]);

  async function load() {
    if (!currentWorkspace?.id) return;
    setLoading(true);
    try {
      const [
        { data: integrationRow },
        { data: metaRows },
        { data: playerRows },
        { data: memberRows },
        { data: inviteRows },
      ] = await Promise.all([
        supabase
          .from("workspace_integrations")
          .select("workspace_id, vturb_api_key, vturb_last_event_at, gateway_provider, gateway_webhook_secret, gateway_webhook_token, gateway_last_event_at")
          .eq("workspace_id", currentWorkspace.id)
          .maybeSingle(),
        supabase
          .from("workspace_meta_accounts")
          .select("id, account_id, access_token, label, last_synced_at")
          .eq("workspace_id", currentWorkspace.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspace_vturb_players")
          .select("id, player_id, label, last_synced_at")
          .eq("workspace_id", currentWorkspace.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", currentWorkspace.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspace_invites")
          .select("id, email, role, token")
          .eq("workspace_id", currentWorkspace.id)
          .order("created_at", { ascending: false }),
      ]);

      const typedMetaRows = (metaRows ?? []) as MetaAccountRow[];
      const typedPlayerRows = (playerRows ?? []) as VturbPlayerRow[];
      let metaBindingCounts = new Map<string, number>();
      let playerBindingCounts = new Map<string, number>();

      const metaIds = typedMetaRows.map((row) => row.id).filter((value): value is string => Boolean(value));
      if (metaIds.length > 0) {
        const { data: metaBindingRows, error: metaBindingError } = await supabase
          .from("project_meta_accounts")
          .select("meta_account_id")
          .in("meta_account_id", metaIds);
        if (metaBindingError) throw metaBindingError;
        metaBindingCounts = countBindings((metaBindingRows ?? []) as Array<{ meta_account_id: string | null }>, "meta_account_id");
      }

      const playerIds = typedPlayerRows.map((row) => row.id).filter((value): value is string => Boolean(value));
      if (playerIds.length > 0) {
        const { data: playerBindingRows, error: playerBindingError } = await supabase
          .from("project_vturb_players")
          .select("vturb_player_id")
          .in("vturb_player_id", playerIds);
        if (playerBindingError) throw playerBindingError;
        playerBindingCounts = countBindings((playerBindingRows ?? []) as Array<{ vturb_player_id: string | null }>, "vturb_player_id");
      }

      setWorkspaceIntegration(
        (integrationRow as WorkspaceIntegrationRow | null) ?? {
          workspace_id: currentWorkspace.id,
          vturb_api_key: null,
          vturb_last_event_at: null,
          gateway_provider: null,
          gateway_webhook_secret: randomSecret(),
          gateway_webhook_token: randomSecret(),
          gateway_last_event_at: null,
        },
      );
      setMetaAccounts(
        typedMetaRows.map((row) => ({
          ...row,
          original_account_id: row.account_id,
          boundProjectCount: metaBindingCounts.get(row.id ?? "") ?? 0,
        })),
      );
      setVturbPlayers(
        typedPlayerRows.map((row) => ({
          ...row,
          original_player_id: row.player_id,
          boundProjectCount: playerBindingCounts.get(row.id ?? "") ?? 0,
        })),
      );
      setMembers((memberRows ?? []) as WorkspaceMemberRow[]);
      setInvites((inviteRows ?? []) as WorkspaceInviteRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar workspace");
    } finally {
      setLoading(false);
    }
  }

  async function saveWorkspaceConfig() {
    if (!user || !currentWorkspace?.id || !workspaceIntegration) return;
    setSaving(true);
    try {
      const { error: integrationError } = await supabase.from("workspace_integrations").upsert({
        workspace_id: currentWorkspace.id,
        created_by: user.id,
        vturb_api_key: workspaceIntegration.vturb_api_key?.trim() || null,
        gateway_provider: workspaceIntegration.gateway_provider || null,
        gateway_webhook_secret: workspaceIntegration.gateway_webhook_secret?.trim() || null,
        gateway_webhook_token: workspaceIntegration.gateway_webhook_token,
      });
      if (integrationError) throw integrationError;

      const validMeta = metaAccounts.filter((account) => account.account_id.trim() && account.access_token.trim());
      for (const account of validMeta) {
        const normalizedAccountId = normalizeMetaAccountId(account.account_id);
        if ((account.boundProjectCount ?? 0) > 0 && account.original_account_id && account.original_account_id !== normalizedAccountId) {
          throw new Error("Desvincule a conta Meta dos projetos em Conexões antes de trocar o Ad Account ID.");
        }

        const { error } = await supabase.from("workspace_meta_accounts").upsert({
          workspace_id: currentWorkspace.id,
          created_by: user.id,
          account_id: normalizedAccountId,
          access_token: account.access_token.trim(),
          label: account.label?.trim() || null,
        }, { onConflict: "workspace_id,account_id" });
        if (error) throw error;

        if (account.id && account.original_account_id && account.original_account_id !== normalizedAccountId) {
          const { error: deleteOldError } = await supabase.from("workspace_meta_accounts").delete().eq("id", account.id);
          if (deleteOldError) throw deleteOldError;
        }
      }

      const validPlayers = vturbPlayers.filter((player) => player.player_id.trim());
      for (const player of validPlayers) {
        const normalizedPlayerId = player.player_id.trim();
        if ((player.boundProjectCount ?? 0) > 0 && player.original_player_id && player.original_player_id !== normalizedPlayerId) {
          throw new Error("Desvincule o player VTurb dos projetos em Conexões antes de trocar o player ID.");
        }

        const { error } = await supabase.from("workspace_vturb_players").upsert({
          workspace_id: currentWorkspace.id,
          created_by: user.id,
          player_id: normalizedPlayerId,
          label: player.label?.trim() || null,
        }, { onConflict: "workspace_id,player_id" });
        if (error) throw error;

        if (player.id && player.original_player_id && player.original_player_id !== normalizedPlayerId) {
          const { error: deleteOldError } = await supabase.from("workspace_vturb_players").delete().eq("id", player.id);
          if (deleteOldError) throw deleteOldError;
        }
      }

      toast.success("Workspace atualizado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMetaAccount(row: MetaAccountRow, index: number) {
    try {
      if ((row.boundProjectCount ?? 0) > 0) {
        throw new Error(`Esta conta Meta está ligada a ${formatBoundProjects(row.boundProjectCount ?? 0)}. Desvincule em Conexões antes de remover.`);
      }
      if (row.id) {
        const { error } = await supabase.from("workspace_meta_accounts").delete().eq("id", row.id);
        if (error) throw error;
      }
      setMetaAccounts((current) => current.filter((_, currentIndex) => currentIndex !== index));
      toast.success("Conta Meta removida");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover conta");
    }
  }

  async function deleteVturbPlayer(row: VturbPlayerRow, index: number) {
    try {
      if ((row.boundProjectCount ?? 0) > 0) {
        throw new Error(`Este player VTurb está ligado a ${formatBoundProjects(row.boundProjectCount ?? 0)}. Desvincule em Conexões antes de remover.`);
      }
      if (row.id) {
        const { error } = await supabase.from("workspace_vturb_players").delete().eq("id", row.id);
        if (error) throw error;
      }
      setVturbPlayers((current) => current.filter((_, currentIndex) => currentIndex !== index));
      toast.success("Player removido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover player");
    }
  }

  async function resolveVturbPlayerNames() {
    const apiKey = workspaceIntegration?.vturb_api_key?.trim();
    if (!apiKey) {
      toast.error("Informe a API key da VTurb antes de buscar os nomes");
      return;
    }

    const playerIds = vturbPlayers.map((player) => player.player_id.trim()).filter(Boolean);
    if (playerIds.length === 0) {
      toast.error("Adicione pelo menos um player ID");
      return;
    }

    setResolvingVturbNames(true);
    try {
      const { data, error } = await supabase.functions.invoke("vturb-test", {
        body: { api_key: apiKey },
      });
      if (error) throw error;

      const players = ((data?.players ?? []) as VturbPlayerMetadata[])
        .filter((player) => player.id && player.name);
      const namesById = new Map(players.map((player) => [player.id, player.name as string]));
      let found = 0;

      setVturbPlayers((current) =>
        current.map((player) => {
          const name = namesById.get(player.player_id.trim());
          if (!name) return player;
          found += 1;
          return { ...player, label: name };
        }),
      );

      if (found === 0) {
        toast.error("Nenhum desses IDs apareceu na lista de players da VTurb");
      } else {
        toast.success(`${found} nome${found === 1 ? "" : "s"} preenchido${found === 1 ? "" : "s"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao buscar nomes dos players");
    } finally {
      setResolvingVturbNames(false);
    }
  }

  async function handleInvite() {
    if (!user || !currentWorkspace?.id || !inviteEmail.trim()) return;
    setSavingInvite(true);
    try {
      const { error } = await supabase.from("workspace_invites").insert({
        workspace_id: currentWorkspace.id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        created_by: user.id,
      });
      if (error) throw error;
      setInviteEmail("");
      await load();
      toast.success("Convite criado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao convidar");
    } finally {
      setSavingInvite(false);
    }
  }

  if (!currentWorkspace) return null;

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configuracoes do Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Membros e credenciais compartilhadas de {currentWorkspace.name}.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="section-card text-sm text-muted-foreground">Carregando workspace…</div>
      ) : (
        <div className="grid xl:grid-cols-[1.1fr,0.9fr] gap-6">
          <section className="section-card space-y-5">
            <div>
              <h2 className="text-base font-semibold mb-3">Integrações do workspace</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Estas credenciais ficam disponíveis para todos os projetos deste workspace.
              </p>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                IDs já conectados a projetos ficam travados aqui. Para trocar ou remover sem quebrar sincronizações,
                desvincule primeiro em Conexões do projeto.
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label>Chave de API da VTurb</Label>
                <Input
                  type="password"
                  value={workspaceIntegration?.vturb_api_key ?? ""}
                  disabled={!isWorkspaceAdmin}
                  onChange={(event) =>
                    setWorkspaceIntegration((current) => current
                      ? { ...current, vturb_api_key: event.target.value }
                      : current)
                  }
                  className="mt-1.5 font-mono text-xs"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Gateway</Label>
                  <Select
                    value={workspaceIntegration?.gateway_provider ?? ""}
                    onValueChange={(value) =>
                      setWorkspaceIntegration((current) => current
                        ? { ...current, gateway_provider: value as GatewayProvider }
                        : current)
                    }
                    disabled={!isWorkspaceAdmin}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Selecione o provedor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hotmart">Hotmart</SelectItem>
                      <SelectItem value="hubla">Hubla</SelectItem>
                      <SelectItem value="kiwify">Kiwify</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Chave secreta</Label>
                  <Input
                    value={workspaceIntegration?.gateway_webhook_secret ?? ""}
                    disabled={!isWorkspaceAdmin}
                    onChange={(event) =>
                      setWorkspaceIntegration((current) => current
                        ? { ...current, gateway_webhook_secret: event.target.value }
                        : current)
                    }
                    className="mt-1.5 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Contas Meta disponíveis</h3>
                {isWorkspaceAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setMetaAccounts((current) => [
                        ...current,
                        { account_id: "", access_token: "", label: "", last_synced_at: null },
                      ])
                    }
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {metaAccounts.map((account, index) => (
                  <div key={account.id ?? `meta-${index}`} className="rounded-lg border border-border/50 p-3 space-y-2">
                  <Input
                    value={account.label ?? ""}
                    disabled={!isWorkspaceAdmin}
                    placeholder="Apelido"
                    onChange={(event) =>
                      setMetaAccounts((current) =>
                        current.map((entry, currentIndex) =>
                          currentIndex === index ? { ...entry, label: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input
                      value={account.account_id}
                      disabled={!isWorkspaceAdmin || (account.boundProjectCount ?? 0) > 0}
                      placeholder="act_1234567890"
                      onChange={(event) =>
                        setMetaAccounts((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, account_id: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <Input
                      type="password"
                      value={account.access_token}
                      disabled={!isWorkspaceAdmin}
                      placeholder="EAAB..."
                      onChange={(event) =>
                        setMetaAccounts((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, access_token: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  {(account.boundProjectCount ?? 0) > 0 && (
                    <p className="text-[11px] text-amber-600">
                      {formatBoundProjects(account.boundProjectCount ?? 0)}. Para trocar o Ad Account ID, desvincule
                      a conta em Conexões primeiro.
                    </p>
                  )}
                  {isWorkspaceAdmin && (
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => deleteMetaAccount(account, index)}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remover
                      </Button>
                    </div>
                  )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Players VTurb disponíveis</h3>
                {isWorkspaceAdmin && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resolveVturbPlayerNames}
                      disabled={resolvingVturbNames}
                    >
                      {resolvingVturbNames ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      <span className="ml-2">Buscar nomes</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setVturbPlayers((current) => [
                          ...current,
                          { player_id: "", label: "", last_synced_at: null },
                        ])
                      }
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {vturbPlayers.map((player, index) => (
                  <div key={player.id ?? `vturb-${index}`} className="rounded-lg border border-border/50 p-3 space-y-2">
                  <div className="grid sm:grid-cols-[1fr,220px] gap-2">
                    <Input
                      value={player.player_id}
                      disabled={!isWorkspaceAdmin || (player.boundProjectCount ?? 0) > 0}
                      placeholder="player_id"
                      onChange={(event) =>
                        setVturbPlayers((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, player_id: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <Input
                      value={player.label ?? ""}
                      disabled={!isWorkspaceAdmin}
                      placeholder="Apelido"
                      onChange={(event) =>
                        setVturbPlayers((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, label: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  {(player.boundProjectCount ?? 0) > 0 && (
                    <p className="text-[11px] text-amber-600">
                      {formatBoundProjects(player.boundProjectCount ?? 0)}. Para trocar o player ID, desvincule o
                      projeto em Conexões primeiro.
                    </p>
                  )}
                  {isWorkspaceAdmin && (
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => deleteVturbPlayer(player, index)}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remover
                      </Button>
                    </div>
                  )}
                  </div>
                ))}
              </div>
            </div>

            {isWorkspaceAdmin && (
              <Button onClick={saveWorkspaceConfig} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className="ml-2">Salvar configurações</span>
              </Button>
            )}
          </section>

          <section className="section-card space-y-6">
            <div>
              <h2 className="text-base font-semibold mb-3">Membros do workspace</h2>
              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.user_id} className="rounded-lg border border-border/50 px-3 py-2">
                    <div className="text-sm font-medium">{member.role}</div>
                    <div className="text-xs text-muted-foreground font-mono">{member.user_id}</div>
                  </div>
                ))}
              </div>
            </div>

            {isWorkspaceAdmin && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold">Convidar membro</h2>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="cliente@empresa.com"
                />
                <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as WorkspaceRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Membro</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="owner">Proprietario</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleInvite} disabled={savingInvite} className="w-full">
                  {savingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  <span className="ml-2">Criar convite</span>
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <h2 className="text-base font-semibold">Convites ativos</h2>
              {invites.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum convite ativo.</div>
              ) : (
                invites.map((invite) => {
                  const url = `${window.location.origin}/accept-invite?kind=workspace&token=${invite.token}`;
                  return (
                    <div key={invite.id} className="rounded-lg border border-border/50 px-3 py-3 space-y-2">
                      <div className="text-sm font-medium">{invite.email}</div>
                      <div className="text-xs text-muted-foreground">{invite.role}</div>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={url} className="font-mono text-xs" />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(url);
                            toast.success("Link copiado");
                          }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

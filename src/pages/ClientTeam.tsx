import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, UserPlus, UsersRound } from "lucide-react";
import { AdminPage } from "@/components/admin/AdminPage";
import { AsyncState } from "@/components/admin/AsyncState";
import {
  InviteList,
  type AdminInvite,
} from "@/components/admin/InviteList";
import {
  TeamMemberList,
  type TeamMember,
} from "@/components/admin/TeamMemberList";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { WorkspaceRole } from "@/hooks/useWorkspace";
import { toast } from "sonner";

interface DirectMember {
  user_id: string;
  role: WorkspaceRole;
}

interface DirectoryEntry {
  entry_id: string;
  entry_type: "member" | "invite";
  full_name: string | null;
  email: string | null;
  role: WorkspaceRole;
  access_origin: "workspace" | "organization";
}

const roleDescriptions: Record<WorkspaceRole, string> = {
  owner: "Controle completo do cliente e de seus acessos.",
  admin: "Gerencia integrações, equipe, funis e sincronizações.",
  moderator: "Consulta dashboards e saúde detalhada em modo de leitura.",
  member: "Consulta dashboards e o resumo de saúde.",
};

export default function ClientTeam() {
  const { user } = useAuth();
  const { client, clientId, canManage, canInviteOwner } = useAdminClient();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [inviting, setInviting] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!canInviteOwner && role === "owner") setRole("admin");
  }, [canInviteOwner, role]);

  const loadTeam = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const [
        { data: directRows, error: memberError },
        { data: inviteRows, error: inviteError },
        directoryResult,
      ] = await Promise.all([
        supabase
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", clientId)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspace_invites")
          .select("id, email, role, token, expires_at, accepted_at, revoked_at")
          .eq("workspace_id", clientId)
          .order("created_at", { ascending: false }),
        supabase.rpc("list_workspace_access_directory", {
          _workspace_id: clientId,
        }),
      ]);
      if (memberError) throw memberError;
      if (inviteError) throw inviteError;

      const direct = (directRows ?? []) as DirectMember[];
      const directory = directoryResult.error
        ? []
        : ((directoryResult.data ?? []) as DirectoryEntry[]);
      const memberDirectory = directory.filter((entry) => entry.entry_type === "member");
      setMembers(
        directoryResult.error
          ? direct.map((member) => ({
              userId: member.user_id,
              role: member.role,
              accessOrigin: "workspace",
            }))
          : memberDirectory.map((entry) => ({
              userId: entry.entry_id,
              role: entry.role,
              accessOrigin: entry.access_origin,
              email: entry.email,
              fullName: entry.full_name,
            })),
      );
      setInvites((inviteRows ?? []) as AdminInvite[]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao carregar a equipe.",
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
    void loadTeam();
  }, [clientId, loadTeam]);

  async function createInvite() {
    if (!user || !clientId || !canManage || !email.trim()) return;
    setInviting(true);
    try {
      const { error } = await supabase.from("workspace_invites").insert({
        workspace_id: clientId,
        email: email.trim().toLowerCase(),
        role,
        created_by: user.id,
      });
      if (error) throw error;
      setEmail("");
      setRole("member");
      await loadTeam();
      toast.success("Convite criado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar convite.");
    } finally {
      setInviting(false);
    }
  }

  async function renewInvite(invite: AdminInvite) {
    setRenewingId(invite.id);
    try {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("workspace_invites")
        .update({ expires_at: expiresAt, revoked_at: null })
        .eq("id", invite.id);
      if (error) throw error;
      await loadTeam();
      const url = `${window.location.origin}/accept-invite?kind=workspace&token=${invite.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Convite renovado e link copiado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao renovar convite.");
    } finally {
      setRenewingId(null);
    }
  }

  async function revokeInvite(invite: AdminInvite) {
    setRevokingId(invite.id);
    try {
      const { error } = await supabase
        .from("workspace_invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", invite.id);
      if (error) throw error;
      await loadTeam();
      toast.success("Convite revogado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao revogar convite.");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyInvite(url: string) {
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }

  const status = useMemo(() => {
    if (loading) return "loading" as const;
    if (errorMessage || !clientId) return "error" as const;
    return "ready" as const;
  }, [clientId, errorMessage, loading]);

  return (
    <AdminPage
      context={client?.name ?? "Cliente"}
      title="Equipe"
      description="Gerencie quem acessa este cliente. Credenciais e configurações operacionais não aparecem nesta área."
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? "Cliente não encontrado ou sem acesso."}
        onRetry={() => void loadTeam()}
      >
        <section aria-labelledby="client-members-title">
          <div className="mb-4 flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <h2 id="client-members-title" className="text-lg font-semibold leading-7">
                Pessoas com acesso
              </h2>
              <p className="text-sm text-muted-foreground">
                A origem mostra se o acesso foi concedido no cliente ou herdado da
                organização.
              </p>
            </div>
          </div>
          <TeamMemberList
            members={members}
            currentUser={user}
            emptyMessage="Nenhum membro encontrado para este cliente."
          />
        </section>

        {canManage && (
          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Convidar pessoa</CardTitle>
              <CardDescription>
                Escolha o menor nível de acesso necessário para a função.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
              <form
                className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr),240px,auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createInvite();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="client-invite-email">Email</Label>
                  <Input
                    id="client-invite-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="pessoa@empresa.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-invite-role">Papel</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as WorkspaceRole)}
                  >
                    <SelectTrigger id="client-invite-role" className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Membro</SelectItem>
                      <SelectItem value="moderator">Moderador</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      {canInviteOwner && <SelectItem value="owner">Owner</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  className="min-h-11 gap-2"
                  disabled={inviting || !email.trim()}
                >
                  {inviting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                  )}
                  Convidar
                </Button>
              </form>
              <p className="mt-3 text-xs leading-4 text-muted-foreground">
                {roleDescriptions[role]}
              </p>
            </CardContent>
          </Card>
        )}

        <section aria-labelledby="client-invites-title">
          <div className="mb-4">
            <h2 id="client-invites-title" className="text-lg font-semibold leading-7">
              Convites
            </h2>
            <p className="text-sm text-muted-foreground">
              Acompanhe validade e status sem misturar convites com membros ativos.
            </p>
          </div>
          <InviteList
            invites={invites}
            kind="workspace"
            canManage={canManage}
            onCopy={(url) => void copyInvite(url)}
            onRenew={(invite) => void renewInvite(invite)}
            onRevoke={(invite) => void revokeInvite(invite)}
            renewingId={renewingId}
            revokingId={revokingId}
          />
        </section>
      </AsyncState>
    </AdminPage>
  );
}

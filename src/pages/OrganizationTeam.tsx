import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
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
import { useWorkspace, type OrganizationRole } from "@/hooks/useWorkspace";
import { runTeamAccess } from "@/lib/teamAccess";
import { toast } from "sonner";

interface DirectMember {
  user_id: string;
  role: OrganizationRole;
}

interface DirectoryEntry {
  entry_id: string;
  entry_type: "member" | "invite";
  full_name: string | null;
  email: string | null;
  role: OrganizationRole;
  access_origin: "organization";
}

export default function OrganizationTeam() {
  const { user } = useAuth();
  const {
    currentOrganization,
    currentWorkspace,
    organizations,
    currentOrganizationRole,
  } = useWorkspace();
  const organization =
    currentOrganization ??
    organizations.find((entry) => entry.id === currentWorkspace?.organization_id) ??
    organizations[0] ??
    null;
  const canManage =
    currentOrganizationRole === "owner" ||
    currentOrganizationRole === "admin" ||
    organization?.role === "owner" ||
    organization?.role === "admin";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(Boolean(organization?.id));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("admin");
  const [inviting, setInviting] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [ownershipTargetId, setOwnershipTargetId] = useState("");
  const [transferringOwnership, setTransferringOwnership] = useState(false);

  const loadTeam = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const [
        { data: directRows, error: memberError },
        { data: inviteRows, error: inviteError },
        directoryResult,
      ] = await Promise.all([
        supabase
          .from("organization_members")
          .select("user_id, role")
          .eq("organization_id", organization.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("organization_invites")
          .select("id, email, role, token, expires_at, accepted_at, revoked_at, delivery_status, delivery_error, last_sent_at, send_count")
          .eq("organization_id", organization.id)
          .order("created_at", { ascending: false }),
        supabase.rpc("list_organization_access_directory", {
          _organization_id: organization.id,
        }),
      ]);
      if (memberError) throw memberError;
      if (inviteError) throw inviteError;

      const direct = (directRows ?? []) as DirectMember[];
      const directory = directoryResult.error
        ? []
        : ((directoryResult.data ?? []) as DirectoryEntry[]);
      const directoryById = new Map(
        directory
          .filter((entry) => entry.entry_type === "member")
          .map((entry) => [entry.entry_id, entry]),
      );

      setMembers(
        direct.map((member) => {
          const identity = directoryById.get(member.user_id);
          return {
            userId: member.user_id,
            role: member.role,
            accessOrigin: "organization",
            email: identity?.email,
            fullName: identity?.full_name,
            inherited: false,
          };
        }),
      );
      setInvites((inviteRows ?? []) as AdminInvite[]);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Falha ao carregar a equipe da organização.",
      );
    } finally {
      setLoading(false);
    }
  }, [organization?.id]);

  useEffect(() => {
    if (!organization?.id) {
      setLoading(false);
      return;
    }
    void loadTeam();
  }, [loadTeam, organization?.id]);

  async function createInvite() {
    if (!organization?.id || !canManage || !email.trim()) return;
    setInviting(true);
    try {
      const result = await runTeamAccess({
        scope_type: "organization",
        scope_id: organization.id,
        action: "create_invite",
        email: email.trim().toLowerCase(),
        role,
      });
      setEmail("");
      setRole("admin");
      await loadTeam();
      if (result.delivery?.status === "sent") {
        toast.success("Convite enviado por email");
      } else {
        toast.warning("Convite criado. O email não foi enviado; copie o link abaixo.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar convite.");
    } finally {
      setInviting(false);
    }
  }

  async function renewInvite(invite: AdminInvite) {
    setRenewingId(invite.id);
    try {
      const result = await runTeamAccess({
        scope_type: "organization",
        scope_id: organization!.id,
        action: "resend_invite",
        invite_id: invite.id,
      });
      await loadTeam();
      if (result.delivery?.status === "sent") {
        toast.success("Convite reenviado por email");
      } else {
        toast.error("O email não foi enviado. Copie o link do convite.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao renovar convite.");
    } finally {
      setRenewingId(null);
    }
  }

  async function revokeInvite(invite: AdminInvite) {
    setRevokingId(invite.id);
    try {
      await runTeamAccess({
        scope_type: "organization",
        scope_id: organization!.id,
        action: "revoke_invite",
        invite_id: invite.id,
      });
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

  async function updateMemberRole(member: TeamMember, nextRole: string) {
    if (!organization?.id || nextRole === member.role) return;
    setBusyUserId(member.userId);
    try {
      await runTeamAccess({
        scope_type: "organization",
        scope_id: organization.id,
        action: "update_member_role",
        user_id: member.userId,
        role: nextRole,
      });
      await loadTeam();
      toast.success("Papel atualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar papel.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(member: TeamMember) {
    if (!organization?.id) return;
    setBusyUserId(member.userId);
    try {
      await runTeamAccess({
        scope_type: "organization",
        scope_id: organization.id,
        action: "remove_member",
        user_id: member.userId,
      });
      await loadTeam();
      toast.success("Acesso removido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover acesso.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function transferOwnership() {
    if (!organization?.id || !ownershipTargetId) return;
    const target = members.find((member) => member.userId === ownershipTargetId);
    if (!target) return;
    const confirmed = window.confirm(
      `Transferir a função de Administrador principal para ${target.fullName || target.email || "este Admin"}? Você passará a ser Admin.`,
    );
    if (!confirmed) return;
    setTransferringOwnership(true);
    try {
      await runTeamAccess({
        scope_type: "organization",
        scope_id: organization.id,
        action: "transfer_ownership",
        user_id: ownershipTargetId,
      });
      setOwnershipTargetId("");
      await loadTeam();
      toast.success("Propriedade transferida");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao transferir propriedade.");
    } finally {
      setTransferringOwnership(false);
    }
  }

  const status = useMemo(() => {
    if (loading) return "loading" as const;
    if (errorMessage || !organization) return "error" as const;
    return "ready" as const;
  }, [errorMessage, loading, organization]);

  return (
    <AdminPage
      context={organization?.name ?? "Organização"}
      title="Equipe da organização"
      description="Admins operam todos os clientes. Membros visualizam dashboards e a saúde permitida, sem acesso a credenciais ou administração."
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? "Organização não encontrada ou sem acesso."}
        onRetry={() => void loadTeam()}
      >
        <section aria-labelledby="organization-members-title">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <h2
                id="organization-members-title"
                className="text-lg font-semibold leading-7"
              >
                Pessoas da organização
              </h2>
              <p className="text-sm text-muted-foreground">
                O papel é herdado em todos os clientes da organização.
              </p>
            </div>
          </div>
          <TeamMemberList
            members={members}
            currentUser={user}
            emptyMessage="Nenhum administrador encontrado."
            canManage={canManage}
            canGrantOwner={false}
            availableRoles={["admin", "member"]}
            busyUserId={busyUserId}
            onUpdateRole={(member, nextRole) => void updateMemberRole(member, nextRole)}
            onRemove={(member) => void removeMember(member)}
          />
        </section>

        {(currentOrganizationRole === "owner" || organization?.role === "owner") && (
          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Administrador principal</CardTitle>
              <CardDescription>
                Transfira a propriedade somente para um Admin existente. A troca é transacional e fica registrada na auditoria.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end md:p-6">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="ownership-target">Novo Administrador principal</Label>
                <Select value={ownershipTargetId} onValueChange={setOwnershipTargetId}>
                  <SelectTrigger id="ownership-target" className="min-h-11">
                    <SelectValue placeholder="Selecione um Admin" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.filter((member) => member.role === "admin").map((member) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        {member.fullName || member.email || "Admin"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!ownershipTargetId || transferringOwnership}
                onClick={() => void transferOwnership()}
              >
                {transferringOwnership && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Transferir propriedade
              </Button>
            </CardContent>
          </Card>
        )}

        {canManage && (
          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Convidar pessoa</CardTitle>
              <CardDescription>
                Admin gerencia clientes, funis, integrações e equipe. Membro visualiza dashboards e saúde em todos os clientes.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <p className="text-sm font-semibold">Admin</p>
                  <p className="mt-1 text-xs leading-4 text-muted-foreground">
                    Administra clientes, funis, integrações, equipe e sincronizações.
                  </p>
                </div>
                <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                  <p className="text-sm font-semibold">Membro</p>
                  <p className="mt-1 text-xs leading-4 text-muted-foreground">
                    Visualiza dashboards e saúde permitida de todos os clientes, sem ações administrativas.
                  </p>
                </div>
              </div>
              <form
                className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr),220px,auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createInvite();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="organization-invite-email">Email</Label>
                  <Input
                    id="organization-invite-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@empresa.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="organization-invite-role">Papel</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as OrganizationRole)}
                  >
                    <SelectTrigger id="organization-invite-role" className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="member">Membro</SelectItem>
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
            </CardContent>
          </Card>
        )}

        <section aria-labelledby="organization-invites-title">
          <div className="mb-4">
            <h2
              id="organization-invites-title"
              className="text-lg font-semibold leading-7"
            >
              Convites
            </h2>
            <p className="text-sm text-muted-foreground">
              Consulte status, validade e revogue acessos ainda não aceitos.
            </p>
          </div>
          <InviteList
            invites={invites}
            kind="organization"
            canManage={canManage}
            canManageOwner={false}
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

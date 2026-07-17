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
    currentOrganizationRole === "owner" || organization?.role === "owner";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(Boolean(organization?.id));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("admin");
  const [inviting, setInviting] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

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
          .select("id, email, role, token, expires_at, accepted_at, revoked_at")
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
    if (!user || !organization?.id || !canManage || !email.trim()) return;
    setInviting(true);
    try {
      const { error } = await supabase.from("organization_invites").insert({
        organization_id: organization.id,
        email: email.trim().toLowerCase(),
        role,
        created_by: user.id,
      });
      if (error) throw error;
      setEmail("");
      setRole("admin");
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
        .from("organization_invites")
        .update({ expires_at: expiresAt, revoked_at: null })
        .eq("id", invite.id);
      if (error) throw error;
      await loadTeam();
      const url = `${window.location.origin}/accept-invite?kind=organization&token=${invite.token}`;
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
        .from("organization_invites")
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
    if (errorMessage || !organization) return "error" as const;
    return "ready" as const;
  }, [errorMessage, loading, organization]);

  return (
    <AdminPage
      context={organization?.name ?? "Organização"}
      title="Equipe da organização"
      description="Owners e admins recebem acesso operacional aos clientes da organização. A origem desse acesso fica explícita nas equipes de cada cliente."
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
                Administradores
              </h2>
              <p className="text-sm text-muted-foreground">
                Estas pessoas herdam acesso administrativo aos clientes da organização.
              </p>
            </div>
          </div>
          <TeamMemberList
            members={members}
            currentUser={user}
            emptyMessage="Nenhum administrador encontrado."
          />
        </section>

        {canManage && (
          <Card>
            <CardHeader className="p-5 md:p-6">
              <CardTitle className="text-lg leading-7">Convidar administrador</CardTitle>
              <CardDescription>
                Apenas owners podem conceder acesso no nível da organização.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="p-5 md:p-6">
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
                      <SelectItem value="owner">Owner</SelectItem>
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

import { useEffect, useMemo, useState } from "react";
import { Copy, FolderPlus, Loader2, Settings2, UserPlus } from "lucide-react";
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
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

type OrgRole = "owner" | "admin";

interface MemberRow {
  user_id: string;
  role: OrgRole;
}

interface WorkspaceRow {
  id: string;
  name: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  accepted_at: string | null;
  expires_at: string;
}

export default function OrganizationSettings() {
  const { user } = useAuth();
  const {
    organizations,
    currentOrganization,
    currentWorkspace,
    currentOrganizationRole,
    isOrganizationAdmin,
    refreshAccess,
  } = useWorkspace();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("admin");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [savingInvite, setSavingInvite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedOrganizationId) {
      setSelectedOrganizationId(currentOrganization?.id ?? organizations[0]?.id ?? "");
    }
  }, [currentOrganization?.id, organizations, selectedOrganizationId]);

  useEffect(() => {
    if (!selectedOrganizationId) return;
    void loadOrganizationData(selectedOrganizationId);
  }, [selectedOrganizationId]);

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrganizationId) ?? null,
    [organizations, selectedOrganizationId],
  );

  async function loadOrganizationData(organizationId: string) {
    setLoading(true);
    try {
      const [{ data: memberRows }, { data: workspaceRows }, { data: inviteRows }] = await Promise.all([
        supabase
          .from("organization_members")
          .select("user_id, role")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("workspaces")
          .select("id, name")
          .eq("organization_id", organizationId)
          .order("name", { ascending: true }),
        supabase
          .from("organization_invites")
          .select("id, email, role, token, accepted_at, expires_at")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
      ]);
      setMembers((memberRows ?? []) as MemberRow[]);
      setWorkspaces((workspaceRows ?? []) as WorkspaceRow[]);
      setInvites((inviteRows ?? []) as InviteRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar organização");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateWorkspace() {
    if (!user || !selectedOrganizationId || !newWorkspaceName.trim()) return;
    setSavingWorkspace(true);
    try {
      const { data: workspace, error } = await supabase
        .from("workspaces")
        .insert({
          organization_id: selectedOrganizationId,
          name: newWorkspaceName.trim(),
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error || !workspace) throw error ?? new Error("Falha ao criar workspace");

      const { error: memberError } = await supabase.from("workspace_members").insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: "owner",
      });
      if (memberError) throw memberError;

      setNewWorkspaceName("");
      await refreshAccess();
      await loadOrganizationData(selectedOrganizationId);
      toast.success("Workspace criado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar workspace");
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function handleInvite() {
    if (!user || !selectedOrganizationId || !inviteEmail.trim()) return;
    setSavingInvite(true);
    try {
      const { error } = await supabase.from("organization_invites").insert({
        organization_id: selectedOrganizationId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        created_by: user.id,
      });
      if (error) throw error;

      setInviteEmail("");
      await loadOrganizationData(selectedOrganizationId);
      toast.success("Convite criado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar convite");
    } finally {
      setSavingInvite(false);
    }
  }

  if (!currentWorkspace && !organizations.length) {
    return null;
  }

  if (!selectedOrganization || !currentOrganizationRole) {
    return (
      <main className="max-w-[1100px] mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="section-card text-sm text-muted-foreground">
          Você não tem acesso administrativo à organização deste workspace.
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1100px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organization Settings</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie workspaces e administradores da conta.
          </p>
        </div>
        <div className="w-[260px]">
          <Select value={selectedOrganizationId} onValueChange={setSelectedOrganizationId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a organização" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.15fr,0.85fr] gap-6">
        <section className="section-card space-y-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold">Workspaces</h2>
          </div>

          {isOrganizationAdmin && (
            <div className="grid sm:grid-cols-[1fr,auto] gap-2">
              <Input
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="Novo workspace"
              />
              <Button onClick={handleCreateWorkspace} disabled={savingWorkspace}>
                {savingWorkspace ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
                <span className="ml-2">Criar</span>
              </Button>
            </div>
          )}

          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando workspaces…</div>
          ) : workspaces.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhum workspace nesta organização.</div>
          ) : (
            <div className="space-y-2">
              {workspaces.map((workspace) => (
                <div key={workspace.id} className="rounded-lg border border-border/50 px-3 py-3">
                  <div className="font-medium text-foreground">{workspace.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-1">{workspace.id}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section-card space-y-6">
          <div>
            <h2 className="text-base font-semibold mb-3">Administradores da organização</h2>
            <div className="space-y-2">
              {members.map((member) => (
                <div key={member.user_id} className="rounded-lg border border-border/50 px-3 py-2">
                  <div className="text-sm font-medium">{member.role}</div>
                  <div className="text-xs text-muted-foreground font-mono">{member.user_id}</div>
                </div>
              ))}
            </div>
          </div>

          {isOrganizationAdmin && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Convidar admin</h2>
              <div className="space-y-2">
                <Label htmlFor="org-invite-email">Email</Label>
                <Input
                  id="org-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="admin@empresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Papel</Label>
                <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as OrgRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Org Admin</SelectItem>
                    <SelectItem value="owner">Org Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleInvite} disabled={savingInvite} className="w-full">
                {savingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                <span className="ml-2">Criar convite</span>
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-base font-semibold">Convites</h2>
            {invites.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhum convite emitido.</div>
            ) : (
              invites.map((invite) => {
                const url = `${window.location.origin}/accept-invite?kind=organization&token=${invite.token}`;
                return (
                  <div key={invite.id} className="rounded-lg border border-border/50 px-3 py-3 space-y-2">
                    <div className="text-sm font-medium text-foreground">{invite.email}</div>
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
    </main>
  );
}

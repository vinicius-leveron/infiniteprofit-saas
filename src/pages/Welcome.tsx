import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Loader2 } from "lucide-react";
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

function defaultOrgName(email: string | undefined) {
  if (!email) return "Minha organização";
  const prefix = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!prefix) return "Minha organização";
  return `${prefix[0]?.toUpperCase() ?? ""}${prefix.slice(1)} Organization`;
}

export default function Welcome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    organizations,
    hasWorkspaces,
    loading,
    refreshAccess,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [organizationName, setOrganizationName] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const shouldCreateOrganization = organizations.length === 0;

  useEffect(() => {
    if (hasWorkspaces) {
      navigate("/projects", { replace: true });
    }
  }, [hasWorkspaces, navigate]);

  useEffect(() => {
    if (!organizationName && shouldCreateOrganization) {
      setOrganizationName(defaultOrgName(user?.email));
    }
    if (!workspaceName) {
      setWorkspaceName("Workspace principal");
    }
    if (!selectedOrganizationId && organizations[0]?.id) {
      setSelectedOrganizationId(organizations[0].id);
    }
  }, [organizationName, organizations, selectedOrganizationId, shouldCreateOrganization, user?.email, workspaceName]);

  const activeOrganizationId = useMemo(
    () => (shouldCreateOrganization ? null : selectedOrganizationId || organizations[0]?.id || null),
    [organizations, selectedOrganizationId, shouldCreateOrganization],
  );

  const handleSubmit = async () => {
    if (!user) return;
    if (!workspaceName.trim()) {
      toast.error("Informe o nome do workspace");
      return;
    }
    if (shouldCreateOrganization && !organizationName.trim()) {
      toast.error("Informe o nome da organização");
      return;
    }

    setSubmitting(true);
    try {
      let organizationId = activeOrganizationId;

      if (shouldCreateOrganization) {
        const { data: organization, error: orgError } = await supabase
          .from("organizations")
          .insert({
            name: organizationName.trim(),
            created_by: user.id,
          })
          .select("id")
          .single();
        if (orgError || !organization) throw orgError ?? new Error("Falha ao criar organização");

        organizationId = organization.id;

        const { error: memberError } = await supabase.from("organization_members").insert({
          organization_id: organization.id,
          user_id: user.id,
          role: "owner",
        });
        if (memberError) throw memberError;
      }

      if (!organizationId) throw new Error("Organização inválida");

      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces")
        .insert({
          organization_id: organizationId,
          name: workspaceName.trim(),
          created_by: user.id,
        })
        .select("id")
        .single();
      if (workspaceError || !workspace) {
        throw workspaceError ?? new Error("Falha ao criar workspace");
      }

      const { error: workspaceMemberError } = await supabase
        .from("workspace_members")
        .insert({
          workspace_id: workspace.id,
          user_id: user.id,
          role: "owner",
        });
      if (workspaceMemberError) throw workspaceMemberError;

      await refreshAccess();
      setCurrentWorkspaceId(workspace.id);
      toast.success("Ambiente criado");
      navigate("/projects", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar ambiente");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !organizations.length) {
    return (
      <main className="min-h-[calc(100vh-80px)] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-80px)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl section-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Configurar seu ambiente</h1>
            <p className="text-sm text-muted-foreground">
              Crie a organização e o primeiro workspace para começar a operar.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {shouldCreateOrganization ? (
            <div>
              <Label htmlFor="organization-name">Organização</Label>
              <Input
                id="organization-name"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Ex: Agência Atlas"
                className="mt-1.5"
              />
            </div>
          ) : (
            <div>
              <Label>Organização</Label>
              <Select value={activeOrganizationId ?? ""} onValueChange={setSelectedOrganizationId}>
                <SelectTrigger className="mt-1.5">
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
          )}

          <div>
            <Label htmlFor="workspace-name">Workspace</Label>
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Ex: Cliente Acme"
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Recomendação: use 1 workspace por cliente/operação.
            </p>
          </div>

          <Button onClick={handleSubmit} className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Criar ambiente
          </Button>
        </div>
      </div>
    </main>
  );
}

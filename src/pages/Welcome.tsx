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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { toast } from "sonner";

function defaultOrgName(email: string | undefined) {
  if (!email) return "Minha organização";
  const prefix = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!prefix) return "Minha organização";
  return `Organização ${prefix[0]?.toUpperCase() ?? ""}${prefix.slice(1)}`;
}

interface BootstrapAccountResult {
  organization_id: string;
  workspace_id: string;
}

function bootstrapErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Não foi possível configurar sua conta. Tente novamente.";
  }
  const message = error.message.toLowerCase();
  if (message.includes("organization access denied")) {
    return "Você não tem permissão para criar clientes nesta organização.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.";
  }
  return error.message;
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const shouldCreateOrganization = organizations.length === 0;

  useEffect(() => {
    if (hasWorkspaces && !submitting) {
      navigate("/clients", { replace: true });
    }
  }, [hasWorkspaces, navigate, submitting]);

  useEffect(() => {
    if (!organizationName && shouldCreateOrganization) {
      setOrganizationName(defaultOrgName(user?.email));
    }
    if (!workspaceName) {
      setWorkspaceName("Meu primeiro cliente");
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
      setSubmitError("Informe o nome do primeiro cliente.");
      return;
    }
    if (shouldCreateOrganization && !organizationName.trim()) {
      setSubmitError("Informe o nome da sua empresa ou agência.");
      return;
    }

    setSubmitError(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("bootstrap_account", {
        _organization_name: shouldCreateOrganization ? organizationName.trim() : null,
        _workspace_name: workspaceName.trim(),
        _organization_id: activeOrganizationId,
      });
      if (error) throw error;

      const result = (Array.isArray(data) ? data[0] : data) as BootstrapAccountResult | null;
      if (!result?.workspace_id) {
        throw new Error("A configuração foi concluída sem retornar o cliente criado.");
      }

      await refreshAccess();
      setCurrentWorkspaceId(result.workspace_id);
      toast.success("Conta configurada. Agora crie seu primeiro funil.");
      navigate(`/clients/${result.workspace_id}/funnels/new`, { replace: true });
    } catch (error) {
      setSubmitError(bootstrapErrorMessage(error));
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
      <form
        className="w-full max-w-xl section-card"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Vamos configurar sua conta</h1>
            <p className="text-sm text-muted-foreground">
              Preencha os campos abaixo para começar a usar o Infinite Profit.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {shouldCreateOrganization ? (
            <div>
              <Label htmlFor="organization-name">Nome da sua empresa ou agência</Label>
              <Input
                id="organization-name"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Ex: Agência Atlas"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-2">
                A organização agrupa seus clientes, equipe e configurações gerais.
              </p>
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
            <Label htmlFor="workspace-name">Nome do primeiro cliente</Label>
            <Input
              id="workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Ex: Empresa Aurora"
              className="mt-1.5"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Cada cliente concentra seus funis, integrações e equipe. Você poderá criar mais depois.
            </p>
          </div>

          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full min-h-11" disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            Criar cliente e continuar
          </Button>
        </div>
      </form>
    </main>
  );
}

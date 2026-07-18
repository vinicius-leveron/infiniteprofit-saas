import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRight,
  Building2,
  FolderKanban,
  Loader2,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AdminPage } from "@/components/admin/AdminPage";
import { AsyncState } from "@/components/admin/AsyncState";
import { StatusPill, type StatusTone } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  listClientOperationalSummaries,
  type ClientOperationalSummaryRow,
} from "@/lib/operationalReadApi";
import { toast } from "sonner";

interface ClientSummary {
  id: string;
  name: string;
  organization_id: string;
  funnelCount: number;
  healthLabel: string;
  healthTone: StatusTone;
  lastActivity: string;
}

function summarizeClient(row: ClientOperationalSummaryRow): ClientSummary {
  const funnelCount = Number(row.funnel_count) || 0;
  const health =
    funnelCount === 0
      ? { label: "Sem funis", tone: "neutral" as const }
      : row.health_status === "healthy"
        ? { label: "Saudável", tone: "success" as const }
        : row.health_status === "syncing"
          ? { label: "Sincronizando", tone: "info" as const }
          : row.health_status === "warning" || row.health_status === "error"
            ? { label: "Requer ação", tone: "danger" as const }
            : { label: "Sem conexão", tone: "warning" as const };

  return {
    id: row.workspace_id,
    name: row.workspace_name,
    organization_id: row.organization_id,
    funnelCount,
    healthLabel: health.label,
    healthTone: health.tone,
    lastActivity: row.last_activity_at,
  };
}

export default function Clients() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    currentOrganization,
    currentWorkspace,
    organizations,
    isOrganizationAdmin,
    refreshAccess,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const organization =
    currentOrganization ??
    organizations.find((entry) => entry.id === currentWorkspace?.organization_id) ??
    null;
  const canCreate =
    isOrganizationAdmin ||
    organization?.role === "owner" ||
    organization?.role === "admin";

  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadClients = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const data = await listClientOperationalSummaries(organization.id);
      setClients(data.map(summarizeClient));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Falha ao carregar os clientes.",
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
    void loadClients();
  }, [loadClients, organization?.id]);

  async function createClient() {
    if (!user || !organization?.id || !clientName.trim()) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("workspaces")
        .insert({
          organization_id: organization.id,
          name: clientName.trim(),
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Falha ao criar cliente.");

      setClientName("");
      setDialogOpen(false);
      await refreshAccess();
      await loadClients();
      setCurrentWorkspaceId(data.id);
      toast.success("Cliente criado");
      navigate(`/clients/${data.id}/funnels`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar cliente.");
    } finally {
      setCreating(false);
    }
  }

  const status = useMemo(() => {
    if (loading) return "loading" as const;
    if (errorMessage) return "error" as const;
    if (clients.length === 0) return "empty" as const;
    return "ready" as const;
  }, [clients.length, errorMessage, loading]);

  const createAction = canCreate ? (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button className="min-h-11 gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>
            Crie o espaço onde a equipe, as integrações e os funis deste cliente serão
            organizados.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createClient();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="client-name">Nome do cliente</Label>
            <Input
              id="client-name"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="Ex.: Loja Aurora"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="min-h-11 gap-2"
              disabled={creating || !clientName.trim()}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Criar cliente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <AdminPage
      context={organization?.name ?? "Organização"}
      title="Clientes"
      description="Acompanhe a operação de cada cliente e entre no contexto certo antes de gerenciar funis ou integrações."
      action={status === "ready" ? createAction : null}
    >
      <AsyncState
        status={status}
        errorMessage={errorMessage ?? undefined}
        onRetry={() => void loadClients()}
        emptyTitle="Nenhum cliente criado"
        emptyDescription="Crie o primeiro cliente para organizar seus funis, integrações e equipe."
        emptyAction={createAction}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <Card key={client.id} className="flex min-h-64 flex-col">
              <CardHeader className="p-5 pb-3 md:p-6 md:pb-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <StatusPill label={client.healthLabel} tone={client.healthTone} />
                </div>
                <CardTitle className="pt-3 text-lg leading-7">{client.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between p-5 pt-0 md:p-6 md:pt-0">
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <FolderKanban className="h-4 w-4" aria-hidden="true" />
                    {client.funnelCount}{" "}
                    {client.funnelCount === 1 ? "funil" : "funis"}
                  </p>
                  <p>
                    Atividade{" "}
                    {formatDistanceToNow(new Date(client.lastActivity), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="mt-6 min-h-11 w-full justify-between"
                  onClick={() => {
                    setCurrentWorkspaceId(client.id);
                    navigate(`/clients/${client.id}/funnels`);
                  }}
                >
                  Abrir cliente
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </AsyncState>
    </AdminPage>
  );
}

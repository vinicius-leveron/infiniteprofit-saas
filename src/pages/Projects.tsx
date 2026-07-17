import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart3,
  Calendar,
  FileSpreadsheet,
  HeartPulse,
  Loader2,
  Plug,
  Plus,
  Settings2,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ProjectsSkeleton } from "@/components/DashboardSkeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { supabase } from "@/integrations/supabase/client";

interface ProjectRow {
  id: string;
  name: string;
  file_name: string | null;
  updated_at: string;
  created_at: string;
  source?: "csv" | "sheet" | "api";
}

export default function Projects() {
  const navigate = useNavigate();
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const {
    currentWorkspace,
    workspaces,
    loading: workspaceLoading,
    isWorkspaceAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const client =
    workspaces.find((workspace) => workspace.id === routeClientId) ??
    currentWorkspace;
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const newFunnelPath = client
    ? `/clients/${client.id}/funnels/new`
    : "/setup-operation";

  useEffect(() => {
    if (!authLoading && !userId) navigate("/auth", { replace: true });
  }, [authLoading, navigate, userId]);

  useEffect(() => {
    if (
      routeClientId &&
      client?.id === routeClientId &&
      currentWorkspace?.id !== routeClientId
    ) {
      setCurrentWorkspaceId(routeClientId);
    }
  }, [
    client?.id,
    currentWorkspace?.id,
    routeClientId,
    setCurrentWorkspaceId,
  ]);

  useEffect(() => {
    if (!userId || !client?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchFunnels = async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, file_name, updated_at, created_at, source")
        .eq("workspace_id", client.id)
        .order("updated_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        setLoadError("Não foi possível carregar os funis deste cliente.");
        setProjects([]);
      } else {
        setProjects(data ?? []);
      }
      setLoading(false);
    };

    void fetchFunnels();
    return () => {
      cancelled = true;
    };
  }, [client?.id, userId]);

  const reloadFunnels = () => {
    if (!client?.id) return;
    setLoading(true);
    setLoadError(null);
    void supabase
      .from("projects")
      .select("id, name, file_name, updated_at, created_at, source")
      .eq("workspace_id", client.id)
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setLoadError("Não foi possível carregar os funis deste cliente.");
          setProjects([]);
        } else {
          setProjects(data ?? []);
        }
        setLoading(false);
      });
  };

  const handleDelete = async () => {
    if (!isWorkspaceAdmin || !toDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("projects").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      toast.error("Não foi possível apagar o funil.");
    } else {
      toast.success(`"${toDelete.name}" foi apagado.`);
      setProjects((current) => current.filter((project) => project.id !== toDelete.id));
      setToDelete(null);
    }
  };

  if (authLoading || workspaceLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!client) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-8 md:px-6 lg:px-8">
        <div className="section-card py-12 text-center">
          <h1 className="text-xl font-semibold">Cliente não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Selecione um cliente ao qual você tenha acesso.
          </p>
          <Button className="mt-5" onClick={() => navigate("/clients")}>
            Ver clientes
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">{client.name}</p>
            <h1 className="mt-1 text-2xl font-bold leading-8 text-foreground">Funis</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {projects.length} {projects.length === 1 ? "funil" : "funis"} neste cliente
            </p>
          </div>
          {isWorkspaceAdmin && (
            <Button onClick={() => navigate(newFunnelPath)} className="min-h-11 gap-2">
              <Plus className="h-4 w-4" />
              Novo funil
            </Button>
          )}
        </header>

        {loading ? (
          <ProjectsSkeleton />
        ) : loadError ? (
          <div role="alert" className="section-card py-12 text-center">
            <HeartPulse className="mx-auto h-10 w-10 text-kpi-red" />
            <h2 className="mt-4 text-lg font-semibold">Erro ao carregar funis</h2>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" className="mt-5" onClick={reloadFunnels}>
              Tentar novamente
            </Button>
          </div>
        ) : projects.length === 0 ? (
          <div className="section-card py-16 text-center">
            <Plug className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Nenhum funil criado</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Crie o primeiro funil e escolha quais fontes de dados deseja conectar agora.
            </p>
            {isWorkspaceAdmin && (
              <Button onClick={() => navigate(newFunnelPath)} className="mt-5 gap-2">
                <Plus className="h-4 w-4" />
                Criar primeiro funil
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <article
                key={project.id}
                className="section-card flex flex-col transition-colors hover:border-primary/40"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/dashboard?project=${project.id}`)}
                  className="w-full flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {project.source === "api" ? (
                        <Plug className="h-5 w-5" />
                      ) : (
                        <FileSpreadsheet className="h-5 w-5" />
                      )}
                    </div>
                    <span
                      className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                      title={format(new Date(project.updated_at), "dd/MM/yyyy HH:mm", {
                        locale: ptBR,
                      })}
                    >
                      {formatDistanceToNow(new Date(project.updated_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {project.name}
                  </h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {project.source === "api"
                      ? "Fontes conectáveis"
                      : project.file_name || "Arquivo sem nome"}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Atualizado{" "}
                    {format(new Date(project.updated_at), "dd 'de' MMM 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </div>
                </button>

                <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border/40 pt-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 gap-1.5 text-xs"
                    onClick={() => navigate(`/dashboard?project=${project.id}`)}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Dashboard
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 gap-1.5 text-xs"
                    onClick={() => navigate(`/funnels/${project.id}/health`)}
                  >
                    <HeartPulse className="h-3.5 w-3.5" />
                    Saúde
                  </Button>
                  {isWorkspaceAdmin && project.source === "api" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 gap-1.5 text-xs"
                        onClick={() => navigate(`/funnels/${project.id}/sources`)}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        Fontes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 gap-1.5 text-xs"
                        onClick={() => navigate(`/funnels/${project.id}/sharing`)}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Compartilhar
                      </Button>
                    </>
                  )}
                  {isWorkspaceAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto min-h-11 gap-1.5 text-kpi-red hover:bg-kpi-red/10 hover:text-kpi-red"
                      onClick={() => setToDelete(project)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Apagar
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar funil?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" será apagado permanentemente. Essa ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="bg-kpi-red hover:bg-kpi-red/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apagar funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </main>
  );
}

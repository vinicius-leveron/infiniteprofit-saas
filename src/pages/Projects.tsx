import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/button";
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
import {
  BarChart3,
  Plus,
  Trash2,
  FileSpreadsheet,
  Loader2,
  Calendar,
  Command as CommandIcon,
  Plug,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { ProjectsSkeleton } from "@/components/DashboardSkeleton";
import { CommandPalette } from "@/components/CommandPalette";

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
  const { user, loading: authLoading } = useAuth();
  const { currentWorkspace, loading: workspaceLoading } = useWorkspace();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creatingApi, setCreatingApi] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user || !currentWorkspace?.id) return;
    void fetchProjects();
  }, [currentWorkspace?.id, user]);

  // Atalho ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fetchProjects = async () => {
    if (!currentWorkspace?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, file_name, updated_at, created_at, source")
      .eq("workspace_id", currentWorkspace.id)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error("Erro ao carregar projetos");
    } else {
      setProjects(data ?? []);
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("projects").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) {
      toast.error("Erro ao apagar projeto");
    } else {
      toast.success(`"${toDelete.name}" apagado`);
      setProjects((p) => p.filter((x) => x.id !== toDelete.id));
      setToDelete(null);
    }
  };

  const handleCreateApi = async () => {
    if (!user || !currentWorkspace?.id) return;
    setCreatingApi(true);
    try {
      const { data: proj, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          workspace_id: currentWorkspace.id,
          name: `Novo projeto API · ${format(new Date(), "dd/MM HH:mm", { locale: ptBR })}`,
          source: "api",
          csv_content: null,
        })
        .select("id")
        .single();
      if (error || !proj) throw error ?? new Error("Falha ao criar projeto");

      toast.success("Projeto criado — configure as conexões");
      navigate(`/connections?project=${proj.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar projeto");
    } finally {
      setCreatingApi(false);
    }
  };

  if (authLoading || workspaceLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 py-6 md:py-8">
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
              <BarChart3 className="w-5 h-5 text-primary-foreground" strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold gradient-text-brand leading-none">
                Infinite Profit
              </h1>
              <p className="text-xs text-muted-foreground mt-1.5">
                {currentWorkspace?.name ?? user?.email} · {projects.length} projeto{projects.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPaletteOpen(true)}
              className="hidden md:inline-flex gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Buscar (⌘K)"
            >
              <CommandIcon className="w-3.5 h-3.5" />
              <span>Buscar</span>
              <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">
                ⌘K
              </kbd>
            </Button>
            <Button onClick={() => navigate("/dashboard")} className="gap-2">
              <Plus className="w-4 h-4" />
              Novo
            </Button>
            <Button onClick={handleCreateApi} disabled={creatingApi} variant="secondary" className="gap-2">
              {creatingApi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              Novo via API
            </Button>
          </div>
        </header>

        {loading ? (
          <ProjectsSkeleton />
        ) : projects.length === 0 ? (
          <div className="section-card text-center py-16">
            <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-1">Nenhum projeto salvo</h2>
            <p className="text-sm text-muted-foreground mb-5">
              Carregue um CSV e salve para acessar depois de qualquer dispositivo
            </p>
            <Button onClick={() => navigate("/dashboard")} className="gap-2">
              <Plus className="w-4 h-4" />
              Criar primeiro projeto
            </Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <div
                key={p.id}
                className="section-card hover:border-primary/40 transition-colors group"
              >
                <button
                  onClick={() => navigate(`/dashboard?project=${p.id}`)}
                  className="text-left w-full"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {p.source === "api" ? <Plug className="w-5 h-5" /> : <FileSpreadsheet className="w-5 h-5" />}
                    </div>
                    <span
                      className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium"
                      title={format(new Date(p.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    >
                      {formatDistanceToNow(new Date(p.updated_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-foreground truncate mb-1">
                    {p.name}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate mb-3">
                    {p.source === "api" ? "Fonte: API (Meta · VTurb · Gateway)" : (p.file_name || "—")}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    Atualizado{" "}
                    {format(new Date(p.updated_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                  </div>
                </button>
                <div className="mt-3 pt-3 border-t border-border/40 flex justify-between">
                  {p.source === "api" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/connections?project=${p.id}`);
                      }}
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Conexões
                    </Button>
                  ) : <span />}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-kpi-red hover:text-kpi-red hover:bg-kpi-red/10 h-8 gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setToDelete(p);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Apagar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" será apagado permanentemente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-kpi-red hover:bg-kpi-red/90"
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </main>
  );
}

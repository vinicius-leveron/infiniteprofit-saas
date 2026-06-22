import { Outlet, useLocation, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  BarChart3,
  BarChart3 as ProjectIcon,
  Building2,
  ChevronDown,
  FolderKanban,
  Gift,
  LogOut,
  Megaphone,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  Sliders,
  Target,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { buildAuthRedirect } from "@/lib/authRedirect";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SidebarProject {
  id: string;
  name: string;
}

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "simulador";

const DASHBOARD_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "geral", label: "Visão Geral", icon: BarChart3 },
  { id: "trafego", label: "Tráfego", icon: Radio },
  { id: "funil", label: "Funil VSL", icon: Target },
  { id: "bumps", label: "Bumps & Upsell", icon: Gift },
  { id: "anuncios", label: "Anúncios", icon: Megaphone },
  { id: "simulador", label: "Simulador", icon: Sliders },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const currentTab = (searchParams.get("tab") as Tab) || "geral";
  const { user, loading: authLoading } = useAuth();
  const {
    loading,
    workspaces,
    currentWorkspaceId,
    currentOrganization,
    hasWorkspaces,
    needsOnboarding,
    isOrganizationAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [configOpen, setConfigOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const currentProject = projects.find((project) => project.id === projectId);

  // Fetch projects for sidebar
  useEffect(() => {
    if (!currentWorkspaceId) {
      setProjects([]);
      return;
    }
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", currentWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setProjects(data ?? []));
  }, [currentWorkspaceId]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando ambiente…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <Navigate
        to={buildAuthRedirect(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }

  if (needsOnboarding && location.pathname !== "/welcome") {
    return <Navigate to="/welcome" replace />;
  }

  const showWorkspacePicker = hasWorkspaces && location.pathname !== "/welcome";
  const isOnDashboard = location.pathname === "/dashboard" && projectId;

  const isActive = (path: string) => location.pathname === path;

  const NavItem = ({
    icon: Icon,
    label,
    onClick,
    active,
    indent,
    shortcut,
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    active?: boolean;
    indent?: boolean;
    shortcut?: string;
  }) => {
    const isNestedActive = Boolean(shortcut);

    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
          indent && "pl-8",
          active && !isNestedActive && "bg-primary/10 text-primary shadow-[inset_2px_0_0_hsl(var(--primary))]",
          active && isNestedActive && "bg-muted/55 text-foreground shadow-[inset_2px_0_0_hsl(var(--primary)/0.7)]",
          !active && "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground"
          )}
        />
        <span className="truncate flex-1 text-left">{label}</span>
        {shortcut && (
          <span className="min-w-5 rounded border border-border/50 px-1 text-center text-[10px] font-mono text-muted-foreground/70">
            {shortcut}
          </span>
        )}
      </button>
    );
  };

  const handleTabClick = (tabId: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tabId);
    navigate(`/dashboard?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="flex w-[276px] shrink-0 flex-col border-r border-border/70 bg-sidebar/95 backdrop-blur-sm">
        {/* Logo & Org */}
        <div className="border-b border-border/40 p-4">
          <button
            type="button"
            onClick={() => navigate("/projects")}
            className="flex w-full items-center gap-3 rounded-lg text-left transition-opacity hover:opacity-90"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-brand shadow-glow">
              <Building2 className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            <div className="min-w-0 text-left">
              <div className="truncate text-sm font-semibold text-foreground">
                {currentOrganization?.name ?? "Infinite Profit"}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {user.email}
              </div>
            </div>
          </button>
        </div>

        {/* Workspace Picker */}
        {showWorkspacePicker && (
          <div className="border-b border-border/40 p-3">
            <Select
              value={currentWorkspaceId ?? ""}
              onValueChange={(value) => setCurrentWorkspaceId(value)}
            >
              <SelectTrigger className="h-9 w-full border-border/60 bg-muted/30 text-[13px]">
                <SelectValue placeholder="Selecione um workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
          <div className="space-y-1">
            <NavItem
              icon={FolderKanban}
              label="Projetos"
              onClick={() => navigate("/projects")}
              active={isActive("/projects")}
            />
          </div>

          {/* Projetos recentes */}
          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen} className="space-y-1">
            <div className="flex items-center gap-1">
              <CollapsibleTrigger
                type="button"
                className="group flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground/80 transition-colors group-hover:text-foreground" />
                <span className="truncate text-left">Projetos recentes</span>
                <ChevronDown
                  className={cn(
                    "ml-auto h-4 w-4 shrink-0 transition-transform",
                    projectsOpen && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate("/setup-operation");
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                title="Novo projeto"
                aria-label="Novo projeto"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <CollapsibleContent className="space-y-0.5">
              {projects.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-muted-foreground">
                  Nenhum projeto
                </div>
              ) : (
                projects.map((p) => {
                  const isCurrentProject = projectId === p.id;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate(`/dashboard?project=${p.id}`)}
                      className={cn(
                        "group relative flex h-8 w-full items-center gap-2 rounded-md px-2.5 pl-7 text-[13px] transition-colors",
                        isCurrentProject
                          ? "bg-muted/60 text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      {isCurrentProject && (
                        <span className="absolute left-2 h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                      <ProjectIcon
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-colors",
                          isCurrentProject
                            ? "text-primary"
                            : "text-muted-foreground/70 group-hover:text-foreground"
                        )}
                      />
                      <span className="truncate text-left">{p.name}</span>
                    </button>
                  );
                })
              )}
              <button
                type="button"
                onClick={() => navigate("/projects")}
                className="flex h-8 w-full items-center rounded-md px-2.5 pl-7 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                Ver todos
              </button>
            </CollapsibleContent>
          </Collapsible>

          {projectId && (
            <div className="space-y-2 border-t border-border/45 pt-4">
              <div className="px-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                  Operação atual
                </div>
                <div className="mt-1 truncate text-[13px] font-semibold text-foreground">
                  {currentProject?.name ?? "Projeto selecionado"}
                </div>
              </div>
              <div className="space-y-1">
                <NavItem
                  icon={BarChart3}
                  label="Dashboard"
                  onClick={() => navigate(`/dashboard?project=${projectId}`)}
                  active={location.pathname === "/dashboard"}
                />
                <NavItem
                  icon={RefreshCw}
                  label="Conexões e sync"
                  onClick={() => navigate(`/connections?project=${projectId}`)}
                  active={location.pathname === "/connections"}
                />
              </div>
            </div>
          )}

          {/* Dashboard tabs - aparecem quando projeto selecionado */}
          {isOnDashboard && (
            <div className="space-y-1 border-t border-border/45 pt-4">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Dashboard
              </div>
              {DASHBOARD_TABS.map(({ id, label, icon }, index) => (
                <NavItem
                  key={id}
                  icon={icon}
                  label={label}
                  onClick={() => handleTabClick(id)}
                  active={currentTab === id}
                  shortcut={String(index + 1)}
                />
              ))}
            </div>
          )}

          {/* Configurações */}
          {showWorkspacePicker && (
            <div className="border-t border-border/45 pt-4">
              <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
                <CollapsibleTrigger
                  type="button"
                  className="group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                >
                  <Settings className="h-4 w-4 shrink-0 text-muted-foreground/80 transition-colors group-hover:text-foreground" />
                  <span className="min-w-0 flex-1 truncate text-left">Configurações</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform",
                      configOpen && "rotate-180"
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-1">
                  <NavItem
                    icon={Users}
                    label="Equipe"
                    onClick={() => navigate("/workspace-settings")}
                    active={isActive("/workspace-settings")}
                    indent
                  />
                  {isOrganizationAdmin && (
                    <NavItem
                      icon={Building2}
                      label="Organização"
                      onClick={() => navigate("/organization-settings")}
                      active={isActive("/organization-settings")}
                      indent
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </nav>

        <div className="border-t border-border/45 p-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate("/auth", { replace: true });
            }}
            className="h-9 w-full justify-start gap-2 rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

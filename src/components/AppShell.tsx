import { Outlet, useLocation, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BarChart3 as ProjectIcon,
  Building2,
  ChevronDown,
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
  workspace_id: string;
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
  const [contextOpen, setContextOpen] = useState(true);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const currentProject = projects.find((project) => project.id === projectId);
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  const projectsByWorkspace = workspaces.map((workspace) => ({
    workspace,
    projects: projects.filter((project) => project.workspace_id === workspace.id),
  }));

  useEffect(() => {
    const workspaceIds = workspaces.map((workspace) => workspace.id);

    if (workspaceIds.length === 0) {
      setProjects([]);
      return;
    }

    supabase
      .from("projects")
      .select("id, name, workspace_id")
      .in("workspace_id", workspaceIds)
      .order("updated_at", { ascending: false })
      .then(({ data }) => setProjects((data ?? []) as SidebarProject[]));
  }, [workspaces]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    setExpandedWorkspaceIds((current) => {
      if (current.has(currentWorkspaceId)) return current;
      const next = new Set(current);
      next.add(currentWorkspaceId);
      return next;
    });
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (
      location.pathname === "/connections" ||
      location.pathname === "/workspace-settings" ||
      location.pathname === "/organization-settings"
    ) {
      setConfigOpen(true);
    }
  }, [location.pathname]);

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

  const showProjectNavigation = hasWorkspaces && location.pathname !== "/welcome";

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
    if (!projectId) {
      navigate("/projects");
      return;
    }

    const params = new URLSearchParams(searchParams);
    params.set("tab", tabId);
    navigate(`/dashboard?${params.toString()}`);
  };

  const navigateToProject = (nextProject: SidebarProject) => {
    if (nextProject.workspace_id !== currentWorkspaceId) {
      setCurrentWorkspaceId(nextProject.workspace_id);
    }
    navigate(`/dashboard?project=${nextProject.id}`);
  };

  const projectPath = (path: "/connections" | "/diagnostics") => {
    if (!projectId) return "/projects";
    return `${path}?project=${projectId}`;
  };

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border/70 bg-sidebar/95 backdrop-blur-sm md:h-screen md:w-[276px] md:border-b-0 md:border-r">
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

        {/* Navigation */}
        <nav className="max-h-[64vh] flex-1 space-y-4 overflow-y-auto px-3 py-3 md:max-h-none">
          {showProjectNavigation && (
            <div className="space-y-2">
              <div className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Contexto
              </div>
              <Collapsible open={contextOpen} onOpenChange={setContextOpen}>
                <CollapsibleTrigger
                  type="button"
                  className="group w-full rounded-md border border-border/45 bg-muted/20 px-2.5 py-2 text-left transition-colors hover:border-border/70 hover:bg-muted/35"
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground/80 group-hover:text-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                      {currentWorkspace?.name ?? "Workspace"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        contextOpen && "rotate-180"
                      )}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <ProjectIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                      {currentProject?.name ?? "Selecione um projeto"}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-1">
                  {projectsByWorkspace.map(({ workspace, projects: workspaceProjects }) => {
                    const workspaceOpen = expandedWorkspaceIds.has(workspace.id);
                    const isCurrentWorkspace = workspace.id === currentWorkspaceId;

                    return (
                      <div key={workspace.id} className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => toggleWorkspace(workspace.id)}
                          className="group flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                        >
                          <Building2
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              isCurrentWorkspace && "text-primary"
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">{workspace.name}</span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {workspaceProjects.length}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 transition-transform",
                              workspaceOpen && "rotate-180"
                            )}
                          />
                        </button>
                        {workspaceOpen && (
                          <div className="space-y-0.5">
                            {workspaceProjects.length === 0 ? (
                              <div className="px-8 py-1.5 text-xs text-muted-foreground/70">
                                Nenhum projeto
                              </div>
                            ) : (
                              workspaceProjects.map((project) => {
                                const isCurrentProject = project.id === projectId;

                                return (
                                  <button
                                    key={project.id}
                                    type="button"
                                    onClick={() => navigateToProject(project)}
                                    className={cn(
                                      "group relative flex h-8 w-full items-center gap-2 rounded-md px-2.5 pl-7 text-[13px] transition-colors",
                                      isCurrentProject
                                        ? "bg-muted/55 text-foreground"
                                        : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                                    )}
                                  >
                                    {isCurrentProject && (
                                      <span className="absolute left-2 h-1.5 w-1.5 rounded-full bg-primary" />
                                    )}
                                    <ProjectIcon
                                      className={cn(
                                        "h-3.5 w-3.5 shrink-0",
                                        isCurrentProject
                                          ? "text-primary"
                                          : "text-muted-foreground/70 group-hover:text-foreground"
                                      )}
                                    />
                                    <span className="truncate text-left">{project.name}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => navigate("/setup-operation")}
                    className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Nova operação
                  </button>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

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
                active={location.pathname === "/dashboard" && currentTab === id}
                shortcut={String(index + 1)}
              />
            ))}
          </div>

          {showProjectNavigation && (
            <div className="space-y-1 border-t border-border/45 pt-4">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                Sistema
              </div>
              <NavItem
                icon={Activity}
                label="Diagnóstico"
                onClick={() => navigate(projectPath("/diagnostics"))}
                active={isActive("/diagnostics")}
              />
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
                    icon={RefreshCw}
                    label="Conexões e sync"
                    onClick={() => navigate(projectPath("/connections"))}
                    active={isActive("/connections")}
                    indent
                  />
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
      <main className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

import { Outlet, useLocation, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BarChart3 as ProjectIcon,
  Building2,
  ChevronDown,
  ChevronsUpDown,
  Check,
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
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buildAuthRedirect } from "@/lib/authRedirect";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SidebarProject {
  id: string;
  name: string;
  workspace_id: string;
}

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "diagnostico" | "simulador";

const DASHBOARD_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "geral", label: "Visão Geral", icon: BarChart3 },
  { id: "trafego", label: "Tráfego", icon: Radio },
  { id: "funil", label: "Funil VSL", icon: Target },
  { id: "bumps", label: "Bumps & Upsell", icon: Gift },
  { id: "anuncios", label: "Anúncios", icon: Megaphone },
  { id: "diagnostico", label: "Diagnóstico", icon: Activity },
  { id: "simulador", label: "Simulador", icon: Sliders },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const currentTab = (searchParams.get("tab") as Tab) || "geral";
  const { user, loading: authLoading } = useAuth();
  const {
    loading,
    workspaces,
    organizations,
    currentWorkspaceId,
    currentOrganization,
    hasWorkspaces,
    needsOnboarding,
    isWorkspaceAdmin,
    isOrganizationAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [configOpen, setConfigOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherStacksBelow, setSwitcherStacksBelow] = useState(false);
  const [switcherWorkspaceId, setSwitcherWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const currentProject = projects.find((project) => project.id === projectId);
  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  const switcherWorkspace =
    workspaces.find((workspace) => workspace.id === switcherWorkspaceId) ??
    currentWorkspace ??
    workspaces[0] ??
    null;
  const switcherProjects = switcherWorkspace
    ? projects.filter((project) => project.workspace_id === switcherWorkspace.id)
    : [];
  const contextLabel =
    currentProject?.name ??
    currentWorkspace?.name ??
    currentOrganization?.name ??
    "Infinite Profit";

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
    setSwitcherWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 920px)");
    const updatePlacement = () => setSwitcherStacksBelow(mediaQuery.matches);

    updatePlacement();
    mediaQuery.addEventListener("change", updatePlacement);
    return () => mediaQuery.removeEventListener("change", updatePlacement);
  }, []);

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
    setSwitcherOpen(false);
  };

  const projectPath = (path: "/connections" | "/diagnostics") => {
    if (!projectId) return "/projects";
    return `${path}?project=${projectId}`;
  };

  const selectWorkspace = (workspaceId: string) => {
    setSwitcherWorkspaceId(workspaceId);
    setCurrentWorkspaceId(workspaceId);
    if (currentProject && currentProject.workspace_id !== workspaceId) {
      navigate("/projects");
    }
  };

  const openWorkspaceSettings = (workspaceId: string) => {
    selectWorkspace(workspaceId);
    setSwitcherOpen(false);
    navigate("/workspace-settings");
  };

  const openOrganizationSettings = (organizationId: string) => {
    const firstWorkspace = workspaces.find(
      (workspace) => workspace.organization_id === organizationId,
    );
    if (firstWorkspace) selectWorkspace(firstWorkspace.id);
    setSwitcherOpen(false);
    navigate("/organization-settings");
  };

  const openWorkspaceCreation = () => {
    setSwitcherOpen(false);
    navigate(isOrganizationAdmin ? "/organization-settings" : "/workspace-settings");
  };

  const openProjectCreation = () => {
    if (!isWorkspaceAdmin) return;
    setSwitcherOpen(false);
    navigate("/setup-operation");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-b border-border/70 bg-sidebar/95 backdrop-blur-sm md:h-screen md:w-[276px] md:border-b-0 md:border-r">
        {/* Context switcher */}
        <div className="border-b border-border/40 p-3">
          <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-12 w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/35 px-3 text-left transition-colors hover:border-border hover:bg-muted/50"
              >
                <span className="h-8 w-8 shrink-0 rounded-full bg-kpi-orange" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                  {contextLabel}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side={switcherStacksBelow || isMobile ? "bottom" : "right"}
              align="start"
              sideOffset={switcherStacksBelow || isMobile ? 8 : 10}
              collisionPadding={12}
              className="w-[calc(100vw-24px)] overflow-hidden rounded-lg border-border/80 bg-popover p-0 shadow-2xl sm:w-[560px]"
            >
              <div className="grid sm:grid-cols-[240px_minmax(0,1fr)]">
                <div className="border-b border-border/60 sm:border-b-0 sm:border-r">
                  <div className="border-b border-border/60 px-5 py-4 text-[15px] font-semibold text-foreground">
                    Organizações
                  </div>
                  <div className="p-2">
                    {(organizations.length ? organizations : currentOrganization ? [currentOrganization] : []).map((organization) => {
                      const active = organization.id === currentOrganization?.id;

                      return (
                        <div
                          key={organization.id}
                          className="group flex h-11 items-center gap-1 rounded-md text-[14px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const firstWorkspace = workspaces.find(
                                (workspace) => workspace.organization_id === organization.id,
                              );
                              if (firstWorkspace) selectWorkspace(firstWorkspace.id);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 px-3 text-left"
                          >
                            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                            {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => openOrganizationSettings(organization.id)}
                            className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground"
                            aria-label={`Configurar organização ${organization.name}`}
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
                    <div className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                      Espaços de Trabalho
                    </div>
                    <button
                      type="button"
                      onClick={openWorkspaceCreation}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      aria-label="Criar workspace"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-[340px] overflow-y-auto p-2">
                    {workspaces.map((workspace) => {
                      const active = workspace.id === currentWorkspaceId;
                      const selected = workspace.id === switcherWorkspace?.id;

                      return (
                        <div
                          key={workspace.id}
                          className={cn(
                            "group flex h-11 w-full items-center gap-1 rounded-md text-[14px] transition-colors",
                            selected
                              ? "bg-muted/55 text-foreground"
                              : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => selectWorkspace(workspace.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 px-3 text-left"
                          >
                            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                            {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => openWorkspaceSettings(workspace.id)}
                            className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground"
                            aria-label={`Configurar workspace ${workspace.name}`}
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                    <div className="my-2 h-px bg-border/60" />
                    <div className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                        Projetos
                      </div>
                    {isWorkspaceAdmin && (
                      <button
                        type="button"
                        onClick={openProjectCreation}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        aria-label="Nova operação"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                    </div>
                    {switcherProjects.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Nenhum projeto neste workspace
                      </div>
                    ) : (
                      switcherProjects.map((project) => {
                        const active = project.id === projectId;

                        return (
                          <button
                            key={project.id}
                            type="button"
                            onClick={() => navigateToProject(project)}
                            className={cn(
                              "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] transition-colors",
                              active
                                ? "bg-muted/55 text-foreground"
                                : "text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                            )}
                          >
                            <ProjectIcon className="h-4 w-4 shrink-0 text-muted-foreground/80" />
                            <span className="min-w-0 flex-1 truncate">{project.name}</span>
                            {active && <Check className="h-4 w-4 shrink-0 text-foreground" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Navigation */}
        <nav className="max-h-[64vh] flex-1 space-y-4 overflow-y-auto px-3 py-3 md:max-h-none">
          <div className="space-y-1">
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
                label="Saúde das fontes"
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

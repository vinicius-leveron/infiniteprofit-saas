import { Outlet, useLocation, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  ChevronDown,
  FileText,
  FolderKanban,
  Gift,
  LogOut,
  Map,
  Megaphone,
  Plus,
  Radio,
  Settings,
  Sliders,
  Stethoscope,
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
import { useState } from "react";
import { cn } from "@/lib/utils";

type Tab = "geral" | "trafego" | "funil" | "bumps" | "anuncios" | "atribuicao" | "relatorio" | "diagnostico" | "simulador";

const DASHBOARD_TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "geral", label: "Visao Geral", icon: BarChart3 },
  { id: "trafego", label: "Trafego", icon: Radio },
  { id: "funil", label: "Funil VSL", icon: Target },
  { id: "bumps", label: "Bumps & Upsell", icon: Gift },
  { id: "anuncios", label: "Anuncios", icon: Megaphone },
  { id: "atribuicao", label: "Atribuicao", icon: Map },
  { id: "relatorio", label: "Relatorio", icon: FileText },
  { id: "diagnostico", label: "Diagnostico", icon: Stethoscope },
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
  const [configOpen, setConfigOpen] = useState(true);

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
  const isOnDashboard = location.pathname === "/" && projectId;

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
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
        indent && "pl-6",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-[10px] font-mono opacity-50">{shortcut}</span>
      )}
    </button>
  );

  const handleTabClick = (tabId: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tabId);
    navigate(`/?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/60 bg-background/95 backdrop-blur-sm flex flex-col shrink-0">
        {/* Logo & Org */}
        <div className="p-4 border-b border-border/40">
          <button
            onClick={() => navigate("/projects")}
            className="flex items-center gap-3 w-full"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow shrink-0">
              <Building2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 text-left">
              <div className="text-sm font-semibold text-foreground truncate">
                {currentOrganization?.name ?? "Infinite Profit"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {user.email}
              </div>
            </div>
          </button>
        </div>

        {/* Workspace Picker */}
        {showWorkspacePicker && (
          <div className="p-3 border-b border-border/40">
            <Select
              value={currentWorkspaceId ?? ""}
              onValueChange={(value) => setCurrentWorkspaceId(value)}
            >
              <SelectTrigger className="w-full">
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
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavItem
            icon={FolderKanban}
            label="Projetos"
            onClick={() => navigate("/projects")}
            active={isActive("/projects")}
          />

          <Button
            size="sm"
            onClick={() => navigate("/setup-operation")}
            className="w-full gap-2 mt-2"
          >
            <Plus className="w-4 h-4" />
            Novo Projeto
          </Button>

          {/* Dashboard tabs - aparecem quando projeto selecionado */}
          {isOnDashboard && (
            <div className="mt-4 pt-4 border-t border-border/40 space-y-1">
              <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
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
        </nav>

        {/* Bottom Section: Configuracoes + Sair */}
        <div className="border-t border-border/40">
          {/* Configuracoes */}
          {showWorkspacePicker && (
            <div className="p-3 pb-0">
              <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
                <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted">
                  <div className="flex items-center gap-3">
                    <Settings className="w-4 h-4" />
                    <span>Configuracoes</span>
                  </div>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 transition-transform",
                      configOpen && "rotate-180"
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1 mt-1">
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
                      label="Organizacao"
                      onClick={() => navigate("/organization-settings")}
                      active={isActive("/organization-settings")}
                      indent
                    />
                  )}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Sair */}
          <div className="p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/auth", { replace: true });
              }}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

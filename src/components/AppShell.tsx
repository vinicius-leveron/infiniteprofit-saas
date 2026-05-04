import { Outlet, useLocation, useNavigate, Navigate } from "react-router-dom";
import { Building2, ChevronsUpDown, FolderKanban, LogOut, Settings, Users } from "lucide-react";
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
import { buildAuthRedirect } from "@/lib/authRedirect";
import { supabase } from "@/integrations/supabase/client";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const {
    loading,
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    currentOrganization,
    hasWorkspaces,
    needsOnboarding,
    isOrganizationAdmin,
    setCurrentWorkspaceId,
  } = useWorkspace();

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

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate("/projects")}
              className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow shrink-0 hover:opacity-90 transition-opacity"
              title="Ir para projetos"
            >
              <Building2 className="w-5 h-5 text-primary-foreground" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {currentOrganization?.name ?? "Infinite Profit"}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {showWorkspacePicker ? currentWorkspace?.name ?? "Selecione um workspace" : user.email}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showWorkspacePicker && (
              <Select
                value={currentWorkspaceId ?? ""}
                onValueChange={(value) => setCurrentWorkspaceId(value)}
              >
                <SelectTrigger className="w-[240px] hidden md:flex">
                  <ChevronsUpDown className="w-4 h-4 mr-2 text-muted-foreground" />
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
            )}

            <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="gap-2">
              <FolderKanban className="w-4 h-4" />
              <span className="hidden sm:inline">Projetos</span>
            </Button>

            {showWorkspacePicker && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/workspace-settings")}
                className="gap-2"
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">Workspace</span>
              </Button>
            )}

            {isOrganizationAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/organization-settings")}
                className="gap-2"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Organização</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/auth", { replace: true });
              }}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </div>

      <Outlet />
    </div>
  );
}

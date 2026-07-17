import { useMemo, useState } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import {
  createAppNavigation,
  type AppNavigationItem,
} from "@/components/app-navigation";
import { ContextSwitcher } from "@/components/ContextSwitcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { buildAuthRedirect } from "@/lib/authRedirect";
import { supabase } from "@/integrations/supabase/client";

function getFunnelId(pathname: string, projectId: string | null): string | null {
  const funnelRouteMatch = pathname.match(/^\/funnels\/([^/]+)/);
  return funnelRouteMatch ? decodeURIComponent(funnelRouteMatch[1]) : projectId;
}

function getClientId(pathname: string, currentClientId: string | null): string | null {
  const clientRouteMatch = pathname.match(/^\/clients\/([^/]+)/);
  return clientRouteMatch ? decodeURIComponent(clientRouteMatch[1]) : currentClientId;
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const {
    loading,
    error: workspaceError,
    workspaces,
    organizations,
    currentWorkspaceId,
    needsOnboarding,
    isWorkspaceAdmin,
    isOrganizationAdmin,
    refreshAccess,
  } = useWorkspace();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const funnelId = getFunnelId(location.pathname, searchParams.get("project"));
  const clientId = getClientId(location.pathname, currentWorkspaceId);
  const navigationGroups = useMemo(
    () =>
      createAppNavigation({
        clientId,
        funnelId,
        canManageOrganization: isOrganizationAdmin,
        canManageClient: isWorkspaceAdmin,
      }),
    [clientId, funnelId, isOrganizationAdmin, isWorkspaceAdmin],
  );

  if (authLoading || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando ambiente…</p>
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

  if (workspaceError && workspaces.length === 0 && organizations.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-6 text-center" role="alert">
          <p className="font-semibold">Não foi possível carregar seus acessos</p>
          <p className="mt-1 text-sm text-muted-foreground">{workspaceError}</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => void refreshAccess()}>
            Tentar novamente
          </Button>
        </div>
      </main>
    );
  }

  if (needsOnboarding && location.pathname !== "/welcome") {
    return <Navigate to="/welcome" replace />;
  }

  if (location.pathname === "/welcome") {
    return <Outlet />;
  }

  const navigateFromSidebar = (item: AppNavigationItem) => {
    if (item.dashboardTab && funnelId) {
      const nextSearch = new URLSearchParams(location.search);
      nextSearch.set("project", funnelId);
      nextSearch.set("tab", item.dashboardTab);
      navigate(`/dashboard?${nextSearch.toString()}`);
    } else {
      navigate(item.href);
    }
    setMobileNavigationOpen(false);
  };

  const signOut = async () => {
    setMobileNavigationOpen(false);
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background md:flex md:h-screen md:min-h-0">
      <aside className="hidden h-screen w-[248px] shrink-0 border-r border-border/70 md:block">
        <AppSidebar
          groups={navigationGroups}
          pathname={location.pathname}
          search={location.search}
          onNavigate={navigateFromSidebar}
          onSignOut={() => void signOut()}
        />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavigationOpen(true)}
          className="h-11 w-11 shrink-0"
          aria-label="Abrir navegação"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <ContextSwitcher compact />
        </div>
      </header>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="w-[min(320px,88vw)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navegação principal</SheetTitle>
          </SheetHeader>
          <AppSidebar
            groups={navigationGroups}
            pathname={location.pathname}
            search={location.search}
            onNavigate={navigateFromSidebar}
            onSignOut={() => void signOut()}
            onContextSelect={() => setMobileNavigationOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1 overflow-x-hidden md:h-screen md:overflow-y-auto">
        {workspaceError && (
          <div className="m-4 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{workspaceError}</span>
            <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void refreshAccess()}>
              Tentar novamente
            </Button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

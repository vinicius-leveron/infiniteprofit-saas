import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { CommandPalette } from "@/components/CommandPalette";
import {
  createAppNavigation,
  getNavigationScope,
  type AppNavigationItem,
} from "@/components/app-navigation";
import { MobileContextNav } from "@/components/MobileContextNav";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { buildAuthRedirect } from "@/lib/authRedirect";

export interface AppShellOutletContext {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
}

function getFunnelId(pathname: string, projectId: string | null): string | null {
  const funnelRouteMatch = pathname.match(/^\/funnels\/([^/]+)/);
  return funnelRouteMatch ? decodeURIComponent(funnelRouteMatch[1]) : projectId;
}

function getClientId(pathname: string, currentClientId: string | null): string | null {
  const clientRouteMatch = pathname.match(/^\/clients\/([^/]+)/);
  return clientRouteMatch ? decodeURIComponent(clientRouteMatch[1]) : currentClientId;
}

function AppShellSkeleton() {
  return (
    <div className="min-h-screen bg-background md:flex md:h-screen" aria-busy="true">
      <aside className="hidden h-screen w-[248px] shrink-0 border-r border-border/70 p-4 md:flex md:flex-col">
        <div className="flex items-center gap-3 py-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="mt-8 space-y-3">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
        <Skeleton className="mt-auto h-14 w-full" />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex h-14 items-center gap-2 border-b border-border/70 px-3 md:px-6">
          <Skeleton className="h-10 w-10 md:w-[280px]" />
          <Skeleton className="h-10 w-10 md:w-[240px]" />
          <Skeleton className="ml-auto h-10 w-11 md:w-[180px]" />
        </div>
        <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-8 md:px-6 lg:px-8">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
      <span className="sr-only">Carregando ambiente</span>
    </div>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth();
  const {
    loading,
    error: workspaceError,
    workspaces,
    organizations,
    currentWorkspaceId,
    needsOnboarding,
    refreshAccess,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const scope = getNavigationScope(location.pathname);
  const funnelId = getFunnelId(location.pathname, searchParams.get("project"));
  const clientId = getClientId(location.pathname, currentWorkspaceId);
  const client = workspaces.find((workspace) => workspace.id === clientId) ?? null;
  const organization =
    organizations.find(
      (candidate) => candidate.id === client?.organization_id,
    ) ?? organizations[0] ?? null;
  const canManageClient =
    client?.role === "owner" || client?.role === "admin";
  const canManageOrganization =
    organization?.role === "owner" || organization?.role === "admin";

  const navigationGroups = createAppNavigation({
    clientId,
    funnelId,
    canManageOrganization,
    canManageClient,
    surface: scope,
  });
  const navigationGroup = navigationGroups[0] ?? null;

  useEffect(() => {
    if (client && client.id !== currentWorkspaceId) {
      setCurrentWorkspaceId(client.id);
    }
  }, [client, currentWorkspaceId, setCurrentWorkspaceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (authLoading || loading) {
    return <AppShellSkeleton />;
  }

  if (authError && !user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div
          className="w-full max-w-md rounded-xl border border-amber-500/30 bg-card p-6 text-center"
          role="alert"
        >
          <p className="font-semibold">Não foi possível validar sua sessão</p>
          <p className="mt-1 text-sm text-muted-foreground">{authError}</p>
          <Button
            variant="outline"
            className="mt-4 min-h-11"
            onClick={retryAuth}
          >
            Tentar novamente
          </Button>
        </div>
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

  const goHome = () => {
    setMobileNavigationOpen(false);
    navigate("/");
  };

  const outletContext: AppShellOutletContext = {
    commandPaletteOpen,
    setCommandPaletteOpen,
  };

  return (
    <div className="min-h-screen bg-background md:flex md:h-screen md:min-h-0">
      <aside className="hidden h-screen w-[248px] shrink-0 border-r border-border/70 md:block">
        <AppSidebar
          group={navigationGroup}
          pathname={location.pathname}
          search={location.search}
          clientId={clientId}
          clientName={client?.name ?? null}
          funnelId={funnelId}
          canManageOrganization={canManageOrganization}
          canManageClient={canManageClient}
          onNavigate={navigateFromSidebar}
          onHome={goHome}
          onOpenCommand={() => setCommandPaletteOpen(true)}
        />
      </aside>

      <div className="min-w-0 flex-1 md:h-screen md:overflow-y-auto">
        <AppTopbar
          scope={scope}
          clientId={clientId}
          clientName={client?.name ?? null}
          funnelId={funnelId}
          canManageOrganization={canManageOrganization}
          canManageClient={canManageClient}
          onOpenMobileNavigation={() => setMobileNavigationOpen(true)}
          onOpenCommand={() => setCommandPaletteOpen(true)}
          onHome={goHome}
        />

        {scope !== "dashboard" && navigationGroup && (
          <MobileContextNav
            group={navigationGroup}
            pathname={location.pathname}
            search={location.search}
            onNavigate={navigateFromSidebar}
          />
        )}

        {workspaceError && (
          <div className="m-4 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
            <span>{workspaceError}</span>
            <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void refreshAccess()}>
              Tentar novamente
            </Button>
          </div>
        )}

        <Outlet context={outletContext} />
      </div>

      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" className="flex w-[min(320px,88vw)] flex-col p-0">
          <SheetHeader className="border-b border-border/60 px-5 py-4 text-left">
            <SheetTitle>{navigationGroup?.label ?? "Navegação"}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <AppSidebar
              group={navigationGroup}
              pathname={location.pathname}
              search={location.search}
              clientId={clientId}
              clientName={client?.name ?? null}
              funnelId={funnelId}
              canManageOrganization={canManageOrganization}
              canManageClient={canManageClient}
              onNavigate={navigateFromSidebar}
              onHome={goHome}
              onOpenCommand={() => setCommandPaletteOpen(true)}
              showBrand={false}
              showAccount={false}
            />
          </div>
        </SheetContent>
      </Sheet>

      {scope !== "dashboard" && (
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
        />
      )}
    </div>
  );
}

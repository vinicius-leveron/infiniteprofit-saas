import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { WorkspaceProvider, useWorkspace } from "@/hooks/useWorkspace";
import { resolveClientLandingDestination } from "@/lib/lastDashboard";

const Index = lazy(() => import("./pages/Index.tsx"));
const Auth = lazy(() => import("./pages/Auth.tsx"));
const Projects = lazy(() => import("./pages/Projects.tsx"));
const Connections = lazy(() => import("./pages/Connections.tsx"));
const Diagnostics = lazy(() => import("./pages/Diagnostics.tsx"));
const HealthOverview = lazy(() => import("./pages/HealthOverview.tsx"));
const SetupOperation = lazy(() => import("./pages/SetupOperation.tsx"));
const FunnelActivation = lazy(() => import("./pages/FunnelActivation.tsx"));
const PublicShare = lazy(() => import("./pages/PublicShare.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const Welcome = lazy(() => import("./pages/Welcome.tsx"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite.tsx"));
const Clients = lazy(() => import("./pages/Clients.tsx"));
const ClientIntegrations = lazy(() => import("./pages/ClientIntegrations.tsx"));
const ClientTeam = lazy(() => import("./pages/ClientTeam.tsx"));
const ClientSettings = lazy(() => import("./pages/ClientSettings.tsx"));
const OrganizationGeneral = lazy(() => import("./pages/OrganizationGeneral.tsx"));
const OrganizationTeam = lazy(() => import("./pages/OrganizationTeam.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function RouteLoader() {
  return (
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Carregando página</span>
    </main>
  );
}

function HomeRedirect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentWorkspaceId } = useWorkspace();
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let active = true;
    if (!user?.id || !currentWorkspaceId) {
      setResolving(false);
      return;
    }

    setResolving(true);
    void resolveClientLandingDestination(user.id, currentWorkspaceId).then(
      (destination) => {
        if (!active) return;
        navigate(destination, { replace: true });
      },
    );

    return () => {
      active = false;
    };
  }, [currentWorkspaceId, navigate, user?.id]);

  if (!currentWorkspaceId && !resolving) {
    return <Navigate to="/clients" replace />;
  }

  return (
    <main className="flex min-h-[50vh] items-center justify-center" aria-busy="true">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="sr-only">Abrindo seu último Dashboard</span>
    </main>
  );
}

function LegacyFunnelRedirect({
  destination,
}: {
  destination: "sources" | "health" | "sharing";
}) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const projectId = searchParams.get("project");
  const resolvedDestination =
    destination === "sources" && location.hash === "#sharing" ? "sharing" : destination;
  return projectId ? (
    <Navigate to={`/funnels/${encodeURIComponent(projectId)}/${resolvedDestination}`} replace />
  ) : (
    <Navigate to="/clients" replace />
  );
}

function LegacyClientRedirect({
  destination,
}: {
  destination: "integrations" | "team" | "settings";
}) {
  const { currentWorkspaceId } = useWorkspace();
  return currentWorkspaceId ? (
    <Navigate
      to={`/clients/${encodeURIComponent(currentWorkspaceId)}/${destination}`}
      replace
    />
  ) : (
    <Navigate to="/clients" replace />
  );
}

function LegacyOrganizationRedirect() {
  const [searchParams] = useSearchParams();
  return (
    <Navigate
      to={searchParams.get("tab") === "team" ? "/organization/team" : "/organization/settings"}
      replace
    />
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <WorkspaceProvider>
            <Suspense fallback={<RouteLoader />}>
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/accept-invite" element={<AcceptInvite />} />
                <Route path="/share/:token" element={<PublicShare />} />

                <Route element={<AppShell />}>
                  <Route path="/" element={<HomeRedirect />} />
                  <Route path="/welcome" element={<Welcome />} />

                  <Route path="/clients" element={<Clients />} />
                  <Route path="/clients/:clientId/funnels" element={<Projects />} />
                  <Route path="/clients/:clientId/funnels/new" element={<SetupOperation />} />
                  <Route path="/clients/:clientId/integrations" element={<ClientIntegrations />} />
                  <Route path="/clients/:clientId/team" element={<ClientTeam />} />
                  <Route path="/clients/:clientId/settings" element={<ClientSettings />} />

                  <Route path="/organization/settings" element={<OrganizationGeneral />} />
                  <Route path="/organization/team" element={<OrganizationTeam />} />

                  <Route path="/health" element={<HealthOverview />} />
                  <Route
                    path="/funnels/:funnelId/activation"
                    element={<FunnelActivation />}
                  />
                  <Route
                    path="/funnels/:funnelId/sources"
                    element={<Connections mode="sources" />}
                  />
                  <Route path="/funnels/:funnelId/health" element={<Diagnostics />} />
                  <Route
                    path="/funnels/:funnelId/sharing"
                    element={<Connections mode="sharing" />}
                  />

                  <Route path="/dashboard" element={<Index />} />

                  <Route path="/projects" element={<Projects />} />
                  <Route path="/setup-operation" element={<SetupOperation />} />
                  <Route
                    path="/connections"
                    element={<LegacyFunnelRedirect destination="sources" />}
                  />
                  <Route
                    path="/diagnostics"
                    element={<LegacyFunnelRedirect destination="health" />}
                  />
                  <Route
                    path="/workspace-settings"
                    element={<LegacyClientRedirect destination="settings" />}
                  />
                  <Route
                    path="/organization-settings"
                    element={<LegacyOrganizationRedirect />}
                  />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </WorkspaceProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

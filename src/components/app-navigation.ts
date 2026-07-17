import {
  Activity,
  ArrowLeft,
  BarChart3,
  Building2,
  Cable,
  FileText,
  Gift,
  HeartPulse,
  Map,
  Megaphone,
  PlugZap,
  Radio,
  Settings,
  Share2,
  Sliders,
  Target,
  Users,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export type DashboardTab =
  | "geral"
  | "trafego"
  | "funil"
  | "bumps"
  | "anuncios"
  | "atribuicao"
  | "relatorio"
  | "diagnostico"
  | "simulador";

export type NavigationScope = "organization" | "client" | "dashboard" | "funnel";

export type NavigationSurface =
  | NavigationScope
  | "account-menu"
  | "command-palette";

export interface AppNavigationItem {
  id: string;
  scope: NavigationScope;
  surfaces: readonly NavigationSurface[];
  label: string;
  icon: LucideIcon;
  href: string;
  shortcut?: string;
  dashboardTab?: DashboardTab;
  activePaths?: string[];
  matchPrefix?: boolean;
}

export interface AppNavigationGroup {
  id: NavigationScope;
  label: string;
  items: AppNavigationItem[];
}

interface NavigationContext {
  clientId: string | null;
  funnelId: string | null;
  canManageOrganization: boolean;
  canManageClient: boolean;
  surface: NavigationSurface;
}

type DashboardNavigationDefinition = Pick<
  AppNavigationItem,
  "id" | "label" | "icon" | "dashboardTab" | "shortcut"
>;

const SCOPE_LABELS: Record<NavigationScope, string> = {
  organization: "Organização",
  client: "Cliente",
  dashboard: "Dashboard",
  funnel: "Funil",
};

export const DASHBOARD_NAVIGATION: readonly DashboardNavigationDefinition[] = [
  { id: "dashboard-overview", label: "Visão geral", icon: BarChart3, dashboardTab: "geral", shortcut: "1" },
  { id: "dashboard-traffic", label: "Tráfego", icon: Radio, dashboardTab: "trafego", shortcut: "2" },
  { id: "dashboard-funnel", label: "Funil VSL", icon: Target, dashboardTab: "funil", shortcut: "3" },
  { id: "dashboard-bumps", label: "Bumps & Upsell", icon: Gift, dashboardTab: "bumps", shortcut: "4" },
  { id: "dashboard-ads", label: "Anúncios", icon: Megaphone, dashboardTab: "anuncios", shortcut: "5" },
  { id: "dashboard-attribution", label: "Atribuição", icon: Map, dashboardTab: "atribuicao", shortcut: "6" },
  { id: "dashboard-report", label: "Relatório", icon: FileText, dashboardTab: "relatorio", shortcut: "7" },
  { id: "dashboard-alerts", label: "Alertas", icon: Activity, dashboardTab: "diagnostico", shortcut: "8" },
  { id: "dashboard-simulator", label: "Simulador", icon: Sliders, dashboardTab: "simulador", shortcut: "9" },
] as const;

function createNavigationRegistry({
  clientId,
  funnelId,
  canManageOrganization,
  canManageClient,
}: Omit<NavigationContext, "surface">): AppNavigationItem[] {
  const items: AppNavigationItem[] = [
    {
      id: "organization-clients",
      scope: "organization",
      surfaces: ["organization", "account-menu", "command-palette"],
      label: "Clientes",
      icon: Building2,
      href: "/clients",
    },
    {
      id: "organization-health",
      scope: "organization",
      surfaces: ["organization", "account-menu", "command-palette"],
      label: "Saúde global",
      icon: HeartPulse,
      href: "/health?client=all",
    },
  ];

  if (canManageOrganization) {
    items.push(
      {
        id: "organization-team",
        scope: "organization",
        surfaces: ["organization", "account-menu", "command-palette"],
        label: "Equipe da organização",
        icon: Users,
        href: "/organization/team",
        activePaths: ["/organization-settings"],
      },
      {
        id: "organization-settings",
        scope: "organization",
        surfaces: ["organization", "account-menu", "command-palette"],
        label: "Configurações gerais",
        icon: Settings,
        href: "/organization/settings",
        activePaths: ["/organization-settings"],
      },
    );
  }

  if (clientId) {
    items.push({
      id: "client-funnels",
      scope: "client",
      surfaces: ["client", "account-menu", "command-palette"],
      label: "Funis",
      icon: Waypoints,
      href: `/clients/${clientId}/funnels`,
      activePaths: ["/projects", "/setup-operation"],
      matchPrefix: true,
    });

    if (canManageClient) {
      items.push(
        {
          id: "client-integrations",
          scope: "client",
          surfaces: ["client", "account-menu", "command-palette"],
          label: "Integrações",
          icon: PlugZap,
          href: `/clients/${clientId}/integrations`,
        },
        {
          id: "client-team",
          scope: "client",
          surfaces: ["client", "account-menu", "command-palette"],
          label: "Equipe",
          icon: Users,
          href: `/clients/${clientId}/team`,
        },
        {
          id: "client-settings",
          scope: "client",
          surfaces: ["client", "account-menu", "command-palette"],
          label: "Configurações",
          icon: Settings,
          href: `/clients/${clientId}/settings`,
          activePaths: ["/workspace-settings"],
        },
      );
    }
  }

  if (funnelId) {
    items.push(
      ...DASHBOARD_NAVIGATION.map<AppNavigationItem>((item) => ({
        ...item,
        scope: "dashboard",
        surfaces: ["dashboard", "command-palette"],
        href: `/dashboard?project=${funnelId}&tab=${item.dashboardTab}`,
      })),
      ...(canManageClient
        ? [
            {
              id: "funnel-sources",
              scope: "funnel" as const,
              surfaces: ["funnel", "command-palette"] as const,
              label: "Fontes de dados",
              icon: Cable,
              href: `/funnels/${funnelId}/sources`,
              activePaths: ["/connections"],
            },
          ]
        : []),
      {
        id: "funnel-health",
        scope: "funnel",
        surfaces: ["funnel", "command-palette"],
        label: "Saúde",
        icon: HeartPulse,
        href: `/funnels/${funnelId}/health`,
        activePaths: ["/diagnostics"],
      },
      ...(canManageClient
        ? [
            {
              id: "funnel-sharing",
              scope: "funnel" as const,
              surfaces: ["funnel", "command-palette"] as const,
              label: "Compartilhamento",
              icon: Share2,
              href: `/funnels/${funnelId}/sharing`,
            },
          ]
        : []),
      {
        id: "funnel-dashboard",
        scope: "funnel",
        surfaces: ["funnel"],
        label: "Voltar ao Dashboard",
        icon: ArrowLeft,
        href: `/dashboard?project=${funnelId}`,
      },
    );
  }

  return items;
}

export function createAppNavigation({
  surface,
  ...context
}: NavigationContext): AppNavigationGroup[] {
  const items = createNavigationRegistry(context).filter((item) =>
    item.surfaces.includes(surface),
  );

  return (Object.keys(SCOPE_LABELS) as NavigationScope[])
    .map((scope) => ({
      id: scope,
      label: SCOPE_LABELS[scope],
      items: items.filter((item) => item.scope === scope),
    }))
    .filter((group) => group.items.length > 0);
}

export function getNavigationScope(pathname: string): NavigationScope {
  if (pathname === "/dashboard") return "dashboard";
  if (
    pathname.startsWith("/funnels/") ||
    pathname === "/connections" ||
    pathname === "/diagnostics"
  ) {
    return "funnel";
  }
  if (
    /^\/clients\/[^/]+/.test(pathname) ||
    pathname === "/projects" ||
    pathname === "/setup-operation" ||
    pathname === "/workspace-settings"
  ) {
    return "client";
  }
  return "organization";
}

export function isAppNavigationItemActive(
  item: AppNavigationItem,
  pathname: string,
  search: string,
): boolean {
  const target = new URL(item.href, "https://app.infiniteprofit.local");
  const currentSearch = new URLSearchParams(search);

  if (item.dashboardTab) {
    const currentTab = currentSearch.get("tab") ?? "geral";
    return pathname === "/dashboard" && currentTab === item.dashboardTab;
  }

  const matchesPath =
    pathname === target.pathname ||
    item.activePaths?.includes(pathname) ||
    (item.matchPrefix && pathname.startsWith(`${target.pathname}/`));

  if (!matchesPath) return false;

  for (const [key, value] of target.searchParams.entries()) {
    if (currentSearch.get(key) !== value) return false;
  }

  return true;
}

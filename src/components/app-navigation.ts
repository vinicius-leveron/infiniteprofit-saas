import {
  Activity,
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

export interface AppNavigationItem {
  id: string;
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
}

export const DASHBOARD_NAVIGATION: readonly Omit<AppNavigationItem, "href">[] = [
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

export function createAppNavigation({
  clientId,
  funnelId,
  canManageOrganization,
  canManageClient,
}: NavigationContext): AppNavigationGroup[] {
  const groups: AppNavigationGroup[] = [
    {
      id: "organization",
      label: "Organização",
      items: [
        {
          id: "organization-clients",
          label: "Clientes",
          icon: Building2,
          href: "/clients",
        },
        {
          id: "organization-health",
          label: "Saúde global",
          icon: HeartPulse,
          href: "/health?client=all",
        },
        ...(canManageOrganization
          ? [
              {
                id: "organization-team",
                label: "Equipe da organização",
                icon: Users,
                href: "/organization/team",
                activePaths: ["/organization-settings"],
              },
              {
                id: "organization-settings",
                label: "Configurações gerais",
                icon: Settings,
                href: "/organization/settings",
                activePaths: ["/organization-settings"],
              },
            ]
          : []),
      ],
    },
  ];

  if (clientId) {
    groups.push({
      id: "client",
      label: "Cliente",
      items: [
        {
          id: "client-funnels",
          label: "Funis",
          icon: Waypoints,
          href: `/clients/${clientId}/funnels`,
          activePaths: ["/projects", "/setup-operation"],
          matchPrefix: true,
        },
        ...(canManageClient
          ? [
              {
                id: "client-integrations",
                label: "Integrações",
                icon: PlugZap,
                href: `/clients/${clientId}/integrations`,
              },
              {
                id: "client-team",
                label: "Equipe",
                icon: Users,
                href: `/clients/${clientId}/team`,
              },
              {
                id: "client-settings",
                label: "Configurações",
                icon: Settings,
                href: `/clients/${clientId}/settings`,
                activePaths: ["/workspace-settings"],
              },
            ]
          : []),
      ],
    });
  }

  if (funnelId) {
    groups.push(
      {
        id: "dashboard",
        label: "Dashboard",
        items: DASHBOARD_NAVIGATION.map((item) => ({
          ...item,
          href: `/dashboard?project=${funnelId}&tab=${item.dashboardTab}`,
        })),
      },
      {
        id: "funnel",
        label: "Funil",
        items: [
          ...(canManageClient
            ? [
                {
                  id: "funnel-sources",
                  label: "Fontes de dados",
                  icon: Cable,
                  href: `/funnels/${funnelId}/sources`,
                  activePaths: ["/connections"],
                },
              ]
            : []),
          {
            id: "funnel-health",
            label: "Saúde",
            icon: HeartPulse,
            href: `/funnels/${funnelId}/health`,
            activePaths: ["/diagnostics"],
          },
          ...(canManageClient
            ? [
                {
                  id: "funnel-sharing",
                  label: "Compartilhamento",
                  icon: Share2,
                  href: `/funnels/${funnelId}/sharing`,
                },
              ]
            : []),
        ],
      },
    );
  }

  return groups.filter((group) => group.items.length > 0);
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

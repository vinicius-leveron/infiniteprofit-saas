import type { DashboardTab } from "@/components/app-navigation";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_PREFIX = "infiniteprofit.lastDashboard";

const VALID_DASHBOARD_TABS = new Set<DashboardTab>([
  "geral",
  "trafego",
  "funil",
  "bumps",
  "anuncios",
  "atribuicao",
  "relatorio",
  "diagnostico",
  "simulador",
]);

export interface LastDashboardPreference {
  userId: string;
  clientId: string;
  funnelId: string;
  dashboardTab: DashboardTab;
}

export interface DashboardFunnelOption {
  id: string;
  name: string;
  updated_at: string;
}

function storageKey(userId: string, clientId: string) {
  return `${STORAGE_PREFIX}.${userId}.${clientId}`;
}

export function readLastDashboardPreference(
  userId: string,
  clientId: string,
): LastDashboardPreference | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(storageKey(userId, clientId));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<LastDashboardPreference>;
    if (
      parsed.userId !== userId ||
      parsed.clientId !== clientId ||
      typeof parsed.funnelId !== "string" ||
      !VALID_DASHBOARD_TABS.has(parsed.dashboardTab as DashboardTab)
    ) {
      localStorage.removeItem(storageKey(userId, clientId));
      return null;
    }
    return parsed as LastDashboardPreference;
  } catch {
    localStorage.removeItem(storageKey(userId, clientId));
    return null;
  }
}

export function writeLastDashboardPreference(preference: LastDashboardPreference) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    storageKey(preference.userId, preference.clientId),
    JSON.stringify(preference),
  );
}

export function clearLastDashboardPreference(userId: string, clientId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(userId, clientId));
}

export function buildDashboardDestination(
  funnelId: string,
  tab: DashboardTab = "geral",
) {
  const search = new URLSearchParams({
    project: funnelId,
    tab,
  });
  return `/dashboard?${search.toString()}`;
}

export function selectClientLandingDestination({
  userId,
  clientId,
  funnels,
}: {
  userId: string;
  clientId: string;
  funnels: DashboardFunnelOption[];
}) {
  const preference = readLastDashboardPreference(userId, clientId);
  if (preference) {
    const preferredFunnel = funnels.find(
      (funnel) => funnel.id === preference.funnelId,
    );
    if (preferredFunnel) {
      return buildDashboardDestination(
        preferredFunnel.id,
        preference.dashboardTab,
      );
    }
    clearLastDashboardPreference(userId, clientId);
  }

  const mostRecentFunnel = funnels[0];
  return mostRecentFunnel
    ? buildDashboardDestination(mostRecentFunnel.id)
    : `/clients/${encodeURIComponent(clientId)}/funnels`;
}

export async function resolveClientLandingDestination(
  userId: string,
  clientId: string,
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, updated_at")
      .eq("workspace_id", clientId)
      .order("updated_at", { ascending: false })
      .abortSignal(controller.signal);

    if (error) {
      return `/clients/${encodeURIComponent(clientId)}/funnels`;
    }

    return selectClientLandingDestination({
      userId,
      clientId,
      funnels: (data ?? []) as DashboardFunnelOption[],
    });
  } catch {
    return `/clients/${encodeURIComponent(clientId)}/funnels`;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

import type { Period } from "@/components/PeriodFilter";

const DASHBOARD_FILTER_STORAGE_PREFIX = "infiniteprofit.dashboardFilters";
const PERIODS = new Set<Period>(["today", "yesterday", "7d", "15d", "30d", "all", "custom"]);

export type StoredDashboardFilters = {
  period?: Period;
  customFrom?: string;
  customTo?: string;
  accountFilter?: string;
};

export function dashboardFilterStorageKey(projectId: string) {
  return `${DASHBOARD_FILTER_STORAGE_PREFIX}.${projectId}`;
}

export function readStoredDashboardFilters(
  projectId: string,
  storage: Storage = window.localStorage,
): StoredDashboardFilters {
  try {
    const raw = storage.getItem(dashboardFilterStorageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredDashboardFilters;
    return {
      period: parsed.period && PERIODS.has(parsed.period) ? parsed.period : undefined,
      customFrom: typeof parsed.customFrom === "string" ? parsed.customFrom : undefined,
      customTo: typeof parsed.customTo === "string" ? parsed.customTo : undefined,
      accountFilter: typeof parsed.accountFilter === "string" ? parsed.accountFilter : undefined,
    };
  } catch {
    return {};
  }
}

export function writeStoredDashboardFilters(
  projectId: string,
  filters: StoredDashboardFilters,
  storage: Storage = window.localStorage,
) {
  try {
    storage.setItem(dashboardFilterStorageKey(projectId), JSON.stringify(filters));
  } catch {
    // localStorage can be unavailable in private contexts; filters just won't persist.
  }
}

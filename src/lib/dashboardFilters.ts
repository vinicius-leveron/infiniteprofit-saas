import type { Period } from "@/components/PeriodFilter";

const DASHBOARD_FILTER_STORAGE_PREFIX = "infiniteprofit.dashboardFilters";
const PERIODS = new Set<Period>([
  "today",
  "yesterday",
  "7d",
  "15d",
  "this_month",
  "last_month",
  "all",
  "custom",
]);

export type StoredDashboardFilters = {
  period?: Period;
  customFrom?: string;
  customTo?: string;
  accountIds?: string[];
  campaignIds?: string[];
  adsetIds?: string[];
  activity?: DashboardDimensionActivity;
  includeUnattributed?: boolean;
  /** Legacy single-account preference, migrated on read. */
  accountFilter?: string;
};

export type DashboardDimensionActivity = "spent_in_period" | "all";

export type DashboardFilterState = {
  accountIds: string[];
  campaignIds: string[];
  adsetIds: string[];
  activity: DashboardDimensionActivity;
  includeUnattributed: boolean;
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
    const storedPeriod = (parsed as { period?: string }).period;
    return {
      period:
        storedPeriod === "30d"
          ? "this_month"
          : storedPeriod && PERIODS.has(storedPeriod as Period)
            ? storedPeriod as Period
            : undefined,
      customFrom: typeof parsed.customFrom === "string" ? parsed.customFrom : undefined,
      customTo: typeof parsed.customTo === "string" ? parsed.customTo : undefined,
      accountIds: stringArray(parsed.accountIds)
        ?? (typeof parsed.accountFilter === "string" && parsed.accountFilter !== "all"
          ? [parsed.accountFilter]
          : undefined),
      campaignIds: stringArray(parsed.campaignIds),
      adsetIds: stringArray(parsed.adsetIds),
      activity: parsed.activity === "all" ? "all" : "spent_in_period",
      includeUnattributed: parsed.includeUnattributed === true,
      accountFilter: typeof parsed.accountFilter === "string" ? parsed.accountFilter : undefined,
    };
  } catch {
    return {};
  }
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
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

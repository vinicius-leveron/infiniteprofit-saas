export const WATCHDOG_TIME_ZONE = "America/Sao_Paulo";

export type WatchdogOptions = {
  recentDays: number;
  reprocessDays: number;
  metaStaleMinutes: number;
  vturbStaleMinutes: number;
  gatewayStaleHours: number;
  triggerSync: boolean;
  generateAlerts: boolean;
  dryRun: boolean;
  maxProjects: number;
};

export type WatchdogProjectStatus = {
  projectId: string;
  rawDates: string[];
  dailyDates: string[];
  metaAccounts: number;
  vturbPlayers: number;
  hasVturbKey: boolean;
  checkoutEnabled: boolean;
  latestMetaSyncAt: string | null;
  latestVturbSyncAt: string | null;
  latestGatewayEventAt: string | null;
};

export type WatchdogProjectPlan = {
  aggregateDates: string[];
  missingDailyDates: string[];
  orphanDailyDates: string[];
  triggerMetaSync: boolean;
  triggerVturbSync: boolean;
  gatewayNeedsAttention: boolean;
  generateAlerts: boolean;
};

export function parseWatchdogOptions(
  body: Record<string, unknown>,
): WatchdogOptions {
  return {
    recentDays: boundedInt(body.recent_days ?? body.recentDays, 3, 1, 30),
    reprocessDays: boundedInt(
      body.reprocess_days ?? body.reprocessDays,
      7,
      1,
      90,
    ),
    metaStaleMinutes: boundedInt(
      body.meta_stale_minutes ?? body.metaStaleMinutes,
      90,
      15,
      1440,
    ),
    vturbStaleMinutes: boundedInt(
      body.vturb_stale_minutes ?? body.vturbStaleMinutes,
      30,
      10,
      1440,
    ),
    gatewayStaleHours: boundedInt(
      body.gateway_stale_hours ?? body.gatewayStaleHours,
      24,
      1,
      168,
    ),
    triggerSync:
      body.trigger_sync !== false &&
      body.triggerSync !== false,
    generateAlerts:
      body.generate_alerts !== false &&
      body.generateAlerts !== false,
    dryRun: body.dry_run === true || body.dryRun === true,
    maxProjects: boundedInt(
      body.max_projects ?? body.maxProjects,
      50,
      1,
      500,
    ),
  };
}

export function buildWatchdogProjectPlan(
  status: WatchdogProjectStatus,
  options: WatchdogOptions,
  nowMs = Date.now(),
): WatchdogProjectPlan {
  const rawDates = uniqueSortedDates(status.rawDates);
  const dailyDates = uniqueSortedDates(status.dailyDates);
  const dailyDateSet = new Set(dailyDates);
  const rawDateSet = new Set(rawDates);
  const missingDailyDates = rawDates.filter(
    (date) => !dailyDateSet.has(date),
  );
  const orphanDailyDates = dailyDates.filter(
    (date) => !rawDateSet.has(date),
  );

  return {
    aggregateDates: rawDates,
    missingDailyDates,
    orphanDailyDates,
    triggerMetaSync:
      options.triggerSync &&
      status.metaAccounts > 0 &&
      isOlderThan(
        status.latestMetaSyncAt,
        options.metaStaleMinutes * 60_000,
        nowMs,
      ),
    triggerVturbSync:
      options.triggerSync &&
      status.vturbPlayers > 0 &&
      status.hasVturbKey &&
      isOlderThan(
        status.latestVturbSyncAt,
        options.vturbStaleMinutes * 60_000,
        nowMs,
      ),
    gatewayNeedsAttention:
      status.checkoutEnabled &&
      isOlderThan(
        status.latestGatewayEventAt,
        options.gatewayStaleHours * 60 * 60_000,
        nowMs,
      ),
    generateAlerts: options.generateAlerts,
  };
}

export function localDateWindow(
  days: number,
  now = new Date(),
  timeZone = WATCHDOG_TIME_ZONE,
) {
  const safeDays = Math.max(1, Math.floor(days || 1));
  const end = formatLocalYmd(now, timeZone);
  const start = addLocalDays(end, -(safeDays - 1), timeZone);
  return { start, end };
}

export function uniqueSortedDates(values: Iterable<unknown>) {
  return [
    ...new Set(
      [...values]
        .map((value) => String(value ?? "").slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  ].sort();
}

export function isOlderThan(
  timestamp: string | null | undefined,
  maxAgeMs: number,
  nowMs = Date.now(),
) {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return true;
  return nowMs - parsed > maxAgeMs;
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function addLocalDays(ymd: string, delta: number, timeZone: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return formatLocalYmd(date, timeZone);
}

function formatLocalYmd(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

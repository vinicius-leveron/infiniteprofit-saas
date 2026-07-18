export const SYNC_JOB_TIME_ZONE = "America/Sao_Paulo";

export type SyncJobSource = "meta" | "vturb" | "gateway" | "aggregate" | "creative";
export type SyncJobEntityType =
  | "meta_account"
  | "vturb_player"
  | "hubla_reconcile"
  | "aggregate_project_dates"
  | "creative_project";
export type SyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "dead_letter";

export type SyncJobInput = {
  workspaceId: string;
  projectId: string;
  source: SyncJobSource;
  entityType: SyncJobEntityType;
  entityId?: string | null;
  dateStart: string;
  dateEnd: string;
  priority?: number;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
};

export type SyncJobWindow = {
  dateStart: string;
  dateEnd: string;
  priority: number;
  staleMinutes: number;
  label: "recent" | "week" | "month";
};

export type ClaimedSyncJob = {
  id: string;
  workspace_id: string;
  project_id: string;
  source: SyncJobSource;
  entity_type: SyncJobEntityType;
  entity_id: string | null;
  date_start: string;
  date_end: string;
  priority: number;
  status: SyncJobStatus;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown> | null;
};

export function buildSyncJobDedupeKey(
  job: Pick<
    SyncJobInput,
    "source" | "entityType" | "projectId" | "entityId" | "dateStart" | "dateEnd"
  >,
) {
  const entityId = sanitizeDedupePart(job.entityId || job.projectId);
  return [
    "sync",
    sanitizeDedupePart(job.source),
    sanitizeDedupePart(job.entityType),
    sanitizeDedupePart(job.projectId),
    entityId,
    normalizeDate(job.dateStart),
    normalizeDate(job.dateEnd),
    "v1",
  ].join(":");
}

export function buildAggregateJobInput(args: {
  workspaceId: string;
  projectId: string;
  dates: Iterable<string>;
  priority?: number;
  sourceScope?: string | null;
}): SyncJobInput | null {
  const dates = uniqueSortedDates(args.dates);
  if (dates.length === 0) return null;
  const sourceScope = args.sourceScope ? String(args.sourceScope) : null;

  return {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    source: "aggregate",
    entityType: "aggregate_project_dates",
    entityId: sourceScope ? `${args.projectId}:${sourceScope}` : args.projectId,
    dateStart: dates[0],
    dateEnd: dates[dates.length - 1],
    priority: args.priority ?? 5,
    maxAttempts: 5,
    payload: sourceScope ? { dates, source_scope: sourceScope } : { dates },
  };
}

export function buildSyncWindows(options: {
  recentDays?: number;
  includeBackfill?: boolean;
  backfillDays?: number;
  now?: Date;
  timeZone?: string;
}): SyncJobWindow[] {
  const recentDays = boundedInt(options.recentDays, 3, 1, 30);
  const backfillDays = boundedInt(options.backfillDays, 30, 1, 90);
  const timeZone = options.timeZone ?? SYNC_JOB_TIME_ZONE;
  const now = options.now ?? new Date();
  const windows: SyncJobWindow[] = [
    {
      ...localDateWindow(recentDays, now, timeZone),
      priority: 10,
      staleMinutes: 15,
      label: "recent",
    },
  ];

  if (options.includeBackfill) {
    windows.push({
      ...localDateWindow(Math.max(7, recentDays), now, timeZone),
      priority: 50,
      staleMinutes: 12 * 60,
      label: "week",
    });
    windows.push({
      ...localDateWindow(Math.max(backfillDays, recentDays), now, timeZone),
      priority: 90,
      staleMinutes: 24 * 60,
      label: "month",
    });
  }

  return dedupeWindows(windows);
}

export function sourceSyncStaleMinutes(
  source: SyncJobSource,
  window: Pick<SyncJobWindow, "label" | "staleMinutes">,
) {
  if (window.label !== "recent") return window.staleMinutes;
  if (source === "meta") return Math.max(window.staleMinutes, 60);
  if (source === "creative") return Math.max(window.staleMinutes, 6 * 60);
  return window.staleMinutes;
}

export function localDateWindow(
  days: number,
  now = new Date(),
  timeZone = SYNC_JOB_TIME_ZONE,
) {
  const safeDays = boundedInt(days, 1, 1, 365);
  const dateEnd = formatLocalYmd(now, timeZone);
  const dateStart = addLocalDays(dateEnd, -(safeDays - 1), timeZone);
  return { dateStart, dateEnd };
}

export function dateRangeToDates(
  dateStart: string,
  dateEnd: string,
  timeZone = SYNC_JOB_TIME_ZONE,
) {
  const start = normalizeDate(dateStart);
  const end = normalizeDate(dateEnd);
  if (start > end) return [];

  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 366) {
    dates.push(cursor);
    cursor = addLocalDays(cursor, 1, timeZone);
  }
  return dates;
}

export function daysForDateRange(
  dateStart: string,
  dateEnd: string,
  timeZone = SYNC_JOB_TIME_ZONE,
) {
  const dates = dateRangeToDates(dateStart, dateEnd, timeZone);
  return Math.max(dates.length, 1);
}

export function parseSyncSchedulerOptions(body: Record<string, unknown>) {
  return {
    recentDays: boundedInt(body.recent_days ?? body.recentDays ?? body.days, 3, 1, 30),
    includeBackfill: body.include_backfill === true || body.includeBackfill === true,
    backfillDays: boundedInt(body.backfill_days ?? body.backfillDays, 30, 1, 90),
    maxProjects: boundedInt(body.max_projects ?? body.maxProjects, 100, 1, 1000),
    projectId: stringOrNull(body.project_id ?? body.projectId),
    source: sourceOrNull(body.source),
  };
}

export function parseSyncWorkerOptions(body: Record<string, unknown>) {
  return {
    batchSize: boundedInt(body.batch_size ?? body.batchSize, 4, 1, 50),
    maxRuntimeMs: boundedInt(
      body.max_runtime_ms ?? body.maxRuntimeMs,
      50_000,
      5_000,
      110_000,
    ),
    staleRunningMinutes: boundedInt(
      body.stale_running_minutes ?? body.staleRunningMinutes,
      15,
      1,
      1440,
    ),
  };
}

export function shouldStopWorkerLoop(args: {
  startedAtMs: number;
  nowMs: number;
  maxRuntimeMs: number;
  stopBufferMs?: number;
}) {
  const stopBufferMs = args.stopBufferMs ?? 8_000;
  return (
    args.nowMs - args.startedAtMs >=
    Math.max(0, args.maxRuntimeMs - stopBufferMs)
  );
}

export function workerJobTimeoutMs(args: {
  startedAtMs: number;
  nowMs: number;
  maxRuntimeMs: number;
  stopBufferMs?: number;
  minJobTimeoutMs?: number;
  maxJobTimeoutMs?: number;
}) {
  const stopBufferMs = args.stopBufferMs ?? 8_000;
  const minJobTimeoutMs = args.minJobTimeoutMs ?? 5_000;
  const maxJobTimeoutMs = args.maxJobTimeoutMs ?? 40_000;
  const remainingMs =
    args.maxRuntimeMs - (args.nowMs - args.startedAtMs) - stopBufferMs;

  return Math.min(
    Math.max(maxJobTimeoutMs, minJobTimeoutMs),
    Math.max(minJobTimeoutMs, remainingMs),
  );
}

export function hasWorkerJobBudget(
  timeoutMs: number,
  minimumBudgetMs = 12_000,
) {
  return timeoutMs >= minimumBudgetMs;
}

export function retryDelayMinutes(attemptCount: number) {
  if (attemptCount <= 1) return 5;
  if (attemptCount === 2) return 15;
  if (attemptCount === 3) return 60;
  return 360;
}

export function failureRetryPlan(
  job: Pick<ClaimedSyncJob, "attempt_count" | "max_attempts">,
  now = new Date(),
) {
  if (job.attempt_count >= job.max_attempts) {
    return {
      status: "dead_letter" as const,
      availableAt: now.toISOString(),
      finishedAt: now.toISOString(),
    };
  }

  const delayMinutes = retryDelayMinutes(job.attempt_count);
  return {
    status: "queued" as const,
    availableAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
    finishedAt: null,
  };
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

export function normalizeDate(value: string) {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Data inválida para sync job: ${value}`);
  }
  return date;
}

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

export function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function sourceOrNull(value: unknown): SyncJobSource | null {
  const source = stringOrNull(value);
  if (
    source === "meta" ||
    source === "vturb" ||
    source === "gateway" ||
    source === "aggregate" ||
    source === "creative"
  ) {
    return source;
  }
  return null;
}

function dedupeWindows(windows: SyncJobWindow[]) {
  const byRange = new Map<string, SyncJobWindow>();
  for (const window of windows) {
    const key = `${window.dateStart}:${window.dateEnd}`;
    const existing = byRange.get(key);
    if (!existing || window.priority < existing.priority) {
      byRange.set(key, window);
    }
  }
  return [...byRange.values()].sort(
    (left, right) => left.priority - right.priority,
  );
}

function sanitizeDedupePart(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/:/g, "_");
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

export const VTURB_DEFAULT_PLAYER_BATCH_SIZE = 10;
export const VTURB_MAX_PLAYER_BATCH_SIZE = 20;
export const VTURB_DEFAULT_MAX_RUNTIME_MS = 70_000;
export const VTURB_MAX_RUNTIME_MS = 90_000;
export const VTURB_RUNTIME_STOP_BUFFER_MS = 10_000;
export const VTURB_DEFAULT_MAX_PLAYERS = 50;
export const VTURB_HARD_MAX_PLAYERS = 200;

type SortableVturbPlayer = {
  id: string;
  player_id: string;
  last_synced_at?: string | null;
};

type SchedulableVturbProject = {
  id: string;
  workspace_id: string;
};

export type VturbBatchOptions = {
  batchCursor: number;
  batchSize: number;
  hasExplicitCursor: boolean;
};

export type VturbExecutionOptions = {
  maxRuntimeMs: number;
  maxPlayers: number;
};

export type NormalizedVturbTrafficOriginRow = {
  eventDate: string;
  externalId: string;
  payload: Record<string, unknown>;
};

export type VturbPlayerBatch<T> = {
  players: T[];
  totalPlayers: number;
  batchCursor: number;
  batchSize: number;
  playersProcessed: number;
  nextCursor: number | null;
  hasMore: boolean;
};

export type VturbPlayerSelection<T> = VturbPlayerBatch<T> & {
  selectionMode: "single_player" | "explicit_cursor" | "oldest_first";
  maxPlayers: number | null;
};

export function parseVturbBatchOptions(body: Record<string, unknown>): VturbBatchOptions {
  const hasExplicitCursor = body.batch_cursor !== undefined || body.cursor !== undefined;
  const rawCursor = body.batch_cursor ?? body.cursor ?? 0;
  const rawBatchSize = body.batch_size ?? body.max_players ?? VTURB_DEFAULT_PLAYER_BATCH_SIZE;
  const parsedCursor = Number(rawCursor);
  const parsedBatchSize = Number(rawBatchSize);

  return {
    batchCursor: Number.isFinite(parsedCursor) && parsedCursor > 0 ? Math.floor(parsedCursor) : 0,
    batchSize: Math.min(
      Math.max(
        Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
          ? Math.floor(parsedBatchSize)
          : VTURB_DEFAULT_PLAYER_BATCH_SIZE,
        1,
      ),
      VTURB_MAX_PLAYER_BATCH_SIZE,
    ),
    hasExplicitCursor,
  };
}

export function parseVturbExecutionOptions(body: Record<string, unknown>): VturbExecutionOptions {
  const rawRuntime = body.max_runtime_ms ?? body.maxRuntimeMs ?? VTURB_DEFAULT_MAX_RUNTIME_MS;
  const rawMaxPlayers = body.max_players ?? body.maxPlayers ?? VTURB_DEFAULT_MAX_PLAYERS;
  const parsedRuntime = Number(rawRuntime);
  const parsedMaxPlayers = Number(rawMaxPlayers);

  return {
    maxRuntimeMs: Math.min(
      Math.max(
        Number.isFinite(parsedRuntime) && parsedRuntime > 0
          ? Math.floor(parsedRuntime)
          : VTURB_DEFAULT_MAX_RUNTIME_MS,
        VTURB_RUNTIME_STOP_BUFFER_MS + 1,
      ),
      VTURB_MAX_RUNTIME_MS,
    ),
    maxPlayers: Math.min(
      Math.max(
        Number.isFinite(parsedMaxPlayers) && parsedMaxPlayers > 0
          ? Math.floor(parsedMaxPlayers)
          : VTURB_DEFAULT_MAX_PLAYERS,
        1,
      ),
      VTURB_HARD_MAX_PLAYERS,
    ),
  };
}

export function orderVturbPlayersForSync<T extends SortableVturbPlayer>(
  players: T[],
  stableCursorOrder: boolean,
) {
  return [...players].sort((left, right) => {
    if (!stableCursorOrder) {
      const leftSyncedAt = Date.parse(left.last_synced_at ?? "");
      const rightSyncedAt = Date.parse(right.last_synced_at ?? "");
      const leftOrder = Number.isFinite(leftSyncedAt) ? leftSyncedAt : 0;
      const rightOrder = Number.isFinite(rightSyncedAt) ? rightSyncedAt : 0;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }

    const byPlayerId = left.player_id.localeCompare(right.player_id);
    if (byPlayerId !== 0) return byPlayerId;
    return left.id.localeCompare(right.id);
  });
}

export function selectVturbPlayersForSync<T>(
  players: T[],
  options: {
    batchOptions: VturbBatchOptions;
    executionOptions: VturbExecutionOptions;
    targetPlayerId?: string | null;
  },
): VturbPlayerSelection<T> {
  const totalPlayers = players.length;
  if (options.targetPlayerId) {
    return {
      players,
      totalPlayers,
      batchCursor: 0,
      batchSize: totalPlayers,
      playersProcessed: players.length,
      nextCursor: null,
      hasMore: false,
      selectionMode: "single_player",
      maxPlayers: null,
    };
  }

  if (options.batchOptions.hasExplicitCursor) {
    return {
      ...selectVturbPlayerBatch(players, {
        batchCursor: options.batchOptions.batchCursor,
        batchSize: options.batchOptions.batchSize,
      }),
      selectionMode: "explicit_cursor",
      maxPlayers: null,
    };
  }

  const selectedPlayers = players.slice(0, options.executionOptions.maxPlayers);
  return {
    players: selectedPlayers,
    totalPlayers,
    batchCursor: 0,
    batchSize: selectedPlayers.length,
    playersProcessed: selectedPlayers.length,
    nextCursor: null,
    hasMore: selectedPlayers.length < totalPlayers,
    selectionMode: "oldest_first",
    maxPlayers: options.executionOptions.maxPlayers,
  };
}

export function shouldStopVturbPlayerLoop(args: {
  startedAtMs: number;
  nowMs: number;
  maxRuntimeMs: number;
  stopBufferMs?: number;
}) {
  const stopBufferMs = args.stopBufferMs ?? VTURB_RUNTIME_STOP_BUFFER_MS;
  return args.nowMs - args.startedAtMs >= Math.max(0, args.maxRuntimeMs - stopBufferMs);
}

export function filterSchedulableVturbProjects<T extends SchedulableVturbProject>(
  projects: T[],
  options: {
    projectIdsWithPlayers: Iterable<string>;
    workspaceIdsWithVturbKey: Iterable<string>;
    backoffProjectIds: Iterable<string>;
  },
) {
  const projectsWithPlayers = new Set(options.projectIdsWithPlayers);
  const workspacesWithVturbKey = new Set(options.workspaceIdsWithVturbKey);
  const backoffProjects = new Set(options.backoffProjectIds);

  return projects.filter((project) =>
    projectsWithPlayers.has(project.id)
    && workspacesWithVturbKey.has(project.workspace_id)
    && !backoffProjects.has(project.id)
  );
}

export function hasUsableVturbSessionStatsPayload(payload: Record<string, unknown>) {
  const viewed = firstPositiveNumber(payload, [
    "total_viewed_session_uniq",
    "total_viewed_device_uniq",
    "total_viewed",
  ]);
  const started = firstPositiveNumber(payload, [
    "total_started_session_uniq",
    "total_started_device_uniq",
    "total_started",
  ]);
  return viewed > 0 || started > 0;
}

export function hasUsableVturbSessionStats(rows: unknown[]) {
  return rows.some((row) =>
    row != null
    && typeof row === "object"
    && hasUsableVturbSessionStatsPayload(row as Record<string, unknown>)
  );
}

export function hasCompleteUsableVturbSessionStats(
  rows: unknown[],
  startDay: string,
  endDay: string,
) {
  const expectedDays = inclusiveDateKeys(startDay, endDay);
  if (expectedDays.length === 0) return false;

  const usableDays = new Set<string>();
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const day = String(record.date_key ?? record.day ?? "").slice(0, 10);
    if (!day || !hasUsableVturbSessionStatsPayload(record)) continue;
    usableDays.add(day);
  }

  return expectedDays.every((day) => usableDays.has(day));
}

export function summarizeVturbPlayerResults(results: Array<Record<string, unknown>>) {
  const failed = results.filter((result) => result.error);
  const hasSuccessfulPlayer = results.some((result) => !result.error);
  const errorMessage = failed
    .map((result) => String(result.error))
    .join(" | ")
    .slice(0, 2000);
  const status = failed.length > 0 && !hasSuccessfulPlayer ? "failed" : "succeeded";

  return {
    failed,
    hasSuccessfulPlayer,
    partialErrors: status === "succeeded" ? failed.length : 0,
    status,
    errorMessage: status === "failed" ? errorMessage : null,
  };
}

export function normalizeVturbTrafficOriginRows(
  data: unknown,
  playerId: string,
): NormalizedVturbTrafficOriginRow[] {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? (data as { data: unknown[] }).data
      : Array.isArray((data as { events_by_day?: unknown[] } | null)?.events_by_day)
        ? (data as { events_by_day: unknown[] }).events_by_day
        : [];

  return rows.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const eventDate = String(row.date_key ?? row.day ?? "").slice(0, 10);
    const queryKey = String(row.query_key ?? "utm_content").trim().toLowerCase();
    const groupedField = String(row.grouped_field ?? row.utm_content ?? "").trim();
    if (!eventDate || queryKey !== "utm_content" || !groupedField) return [];

    return [{
      eventDate,
      externalId: `${playerId}-traffic-${eventDate}-${stableCompactKey(groupedField)}`,
      payload: {
        ...row,
        player_id: playerId,
        query_key: "utm_content",
        utm_content: groupedField,
      },
    }];
  });
}

export function selectVturbPlayerBatch<T>(
  players: T[],
  options: {
    batchCursor: number;
    batchSize: number;
    targetPlayerId?: string | null;
  },
): VturbPlayerBatch<T> {
  const totalPlayers = players.length;
  if (options.targetPlayerId) {
    return {
      players,
      totalPlayers,
      batchCursor: 0,
      batchSize: totalPlayers,
      playersProcessed: players.length,
      nextCursor: null,
      hasMore: false,
    };
  }

  const batchCursor = Math.min(Math.max(options.batchCursor, 0), totalPlayers);
  const batchSize = Math.max(options.batchSize, 1);
  const selectedPlayers = players.slice(batchCursor, batchCursor + batchSize);
  const nextCursor = batchCursor + selectedPlayers.length < totalPlayers
    ? batchCursor + selectedPlayers.length
    : null;

  return {
    players: selectedPlayers,
    totalPlayers,
    batchCursor,
    batchSize,
    playersProcessed: selectedPlayers.length,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

function inclusiveDateKeys(startDay: string, endDay: string) {
  const start = parseDateKey(startDay);
  const end = parseDateKey(endDay);
  if (!start || !end || start > end) return [];

  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)) {
    days.push(cursor.toISOString().slice(0, 10));
  }
  return days;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function firstPositiveNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function stableCompactKey(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

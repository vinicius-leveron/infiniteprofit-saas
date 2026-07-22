import { describe, expect, it } from "vitest";
import {
  filterSchedulableVturbProjects,
  hasCompleteUsableVturbSessionStats,
  hasFreshVturbMetadata,
  hasUsableVturbSessionStats,
  hasUsableVturbSessionStatsPayload,
  normalizeVturbTrafficOriginRows,
  orderVturbPlayersForSync,
  parseVturbBatchOptions,
  parseVturbExecutionOptions,
  selectVturbPlayerBatch,
  selectVturbPlayersForSync,
  shouldStopVturbPlayerLoop,
  summarizeVturbPlayerResults,
  vturbResultError,
  VTURB_DEFAULT_MAX_PLAYERS,
  VTURB_DEFAULT_MAX_RUNTIME_MS,
  VTURB_DEFAULT_PLAYER_BATCH_SIZE,
  VTURB_HARD_MAX_PLAYERS,
  VTURB_MAX_RUNTIME_MS,
  VTURB_MAX_PLAYER_BATCH_SIZE,
} from "../../supabase/functions/vturb-pull/core";

describe("vturb pull batching", () => {
  it("uses a safe default batch size and explicit cursor flag", () => {
    expect(parseVturbBatchOptions({})).toEqual({
      batchCursor: 0,
      batchSize: VTURB_DEFAULT_PLAYER_BATCH_SIZE,
      hasExplicitCursor: false,
    });

    expect(parseVturbBatchOptions({ batch_cursor: 20, batch_size: 999 })).toEqual({
      batchCursor: 20,
      batchSize: VTURB_MAX_PLAYER_BATCH_SIZE,
      hasExplicitCursor: true,
    });
  });

  it("returns a bounded player slice with next cursor", () => {
    const batch = selectVturbPlayerBatch(["p1", "p2", "p3", "p4"], {
      batchCursor: 1,
      batchSize: 2,
    });

    expect(batch.players).toEqual(["p2", "p3"]);
    expect(batch.totalPlayers).toBe(4);
    expect(batch.playersProcessed).toBe(2);
    expect(batch.nextCursor).toBe(3);
    expect(batch.hasMore).toBe(true);
  });

  it("does not batch single-player syncs", () => {
    const batch = selectVturbPlayerBatch(["only-player"], {
      batchCursor: 10,
      batchSize: 2,
      targetPlayerId: "only-player",
    });

    expect(batch.players).toEqual(["only-player"]);
    expect(batch.nextCursor).toBeNull();
    expect(batch.hasMore).toBe(false);
  });

  it("parses dynamic runtime and player limits with safe clamps", () => {
    expect(parseVturbExecutionOptions({})).toEqual({
      maxRuntimeMs: VTURB_DEFAULT_MAX_RUNTIME_MS,
      maxPlayers: VTURB_DEFAULT_MAX_PLAYERS,
    });

    expect(parseVturbExecutionOptions({ max_runtime_ms: 999999, max_players: 999999 })).toEqual({
      maxRuntimeMs: VTURB_MAX_RUNTIME_MS,
      maxPlayers: VTURB_HARD_MAX_PLAYERS,
    });
  });

  it("orders players by oldest last sync when no explicit cursor is used", () => {
    const ordered = orderVturbPlayersForSync([
      { id: "row-3", player_id: "p3", last_synced_at: "2026-06-20T00:00:00Z" },
      { id: "row-1", player_id: "p1", last_synced_at: null },
      { id: "row-2", player_id: "p2", last_synced_at: "2026-06-10T00:00:00Z" },
    ], false);

    expect(ordered.map((player) => player.player_id)).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps stable cursor order for explicit batch syncs", () => {
    const ordered = orderVturbPlayersForSync([
      { id: "row-2", player_id: "p2", last_synced_at: "2026-06-10T00:00:00Z" },
      { id: "row-1", player_id: "p1", last_synced_at: null },
    ], true);

    expect(ordered.map((player) => player.player_id)).toEqual(["p1", "p2"]);
  });

  it("uses dynamic oldest-first selection when no cursor is supplied", () => {
    const selection = selectVturbPlayersForSync(["p1", "p2", "p3"], {
      batchOptions: parseVturbBatchOptions({}),
      executionOptions: parseVturbExecutionOptions({ max_players: 2 }),
    });

    expect(selection.players).toEqual(["p1", "p2"]);
    expect(selection.selectionMode).toBe("oldest_first");
    expect(selection.playersProcessed).toBe(2);
    expect(selection.hasMore).toBe(true);
    expect(selection.nextCursor).toBeNull();
  });

  it("preserves explicit cursor batching for existing manual sync callers", () => {
    const selection = selectVturbPlayersForSync(["p1", "p2", "p3"], {
      batchOptions: parseVturbBatchOptions({ batch_cursor: 1, batch_size: 1 }),
      executionOptions: parseVturbExecutionOptions({ max_players: 3 }),
    });

    expect(selection.players).toEqual(["p2"]);
    expect(selection.selectionMode).toBe("explicit_cursor");
    expect(selection.nextCursor).toBe(2);
    expect(selection.hasMore).toBe(true);
  });

  it("stops near the runtime budget", () => {
    expect(shouldStopVturbPlayerLoop({
      startedAtMs: 1_000,
      nowMs: 80_000,
      maxRuntimeMs: 90_000,
    })).toBe(false);

    expect(shouldStopVturbPlayerLoop({
      startedAtMs: 1_000,
      nowMs: 81_000,
      maxRuntimeMs: 90_000,
    })).toBe(true);
  });

  it("filters automatic projects without players, keys, or with suspended integrations", () => {
    const projects = [
      { id: "ready", workspace_id: "w1" },
      { id: "no-player", workspace_id: "w1" },
      { id: "no-key", workspace_id: "w2" },
      { id: "backoff", workspace_id: "w3" },
    ];

    expect(filterSchedulableVturbProjects(projects, {
      projectIdsWithPlayers: ["ready", "no-key", "backoff"],
      workspaceIdsWithVturbKey: ["w1", "w3"],
      suspendedWorkspaceIds: ["w3"],
    })).toEqual([{ id: "ready", workspace_id: "w1" }]);
  });

  it("treats zeroed sessions stats as unusable so conversions fallback can run", () => {
    const zeroedPayload = {
      total_viewed: 0,
      total_viewed_device_uniq: 0,
      total_viewed_session_uniq: 0,
      total_started: 0,
      total_started_device_uniq: 0,
      total_started_session_uniq: 0,
    };

    expect(hasUsableVturbSessionStatsPayload(zeroedPayload)).toBe(false);
    expect(hasUsableVturbSessionStats([zeroedPayload, { total_started: "0" }])).toBe(false);
  });

  it("treats sessions stats with views or starts as usable", () => {
    expect(hasUsableVturbSessionStats([{ total_viewed_session_uniq: 12 }])).toBe(true);
    expect(hasUsableVturbSessionStats([{ total_started: "5" }])).toBe(true);
  });

  it("requires usable sessions stats for every day before skipping the conversions fallback", () => {
    expect(hasCompleteUsableVturbSessionStats([
      { date_key: "2026-06-28", total_viewed_session_uniq: 10 },
      { date_key: "2026-06-29", total_viewed_session_uniq: 0, total_started_session_uniq: 0 },
    ], "2026-06-28", "2026-06-29")).toBe(false);

    expect(hasCompleteUsableVturbSessionStats([
      { date_key: "2026-06-28", total_viewed_session_uniq: 10 },
      { date_key: "2026-06-29", total_started_session_uniq: "7" },
    ], "2026-06-28", "2026-06-29")).toBe(true);
  });

  it("normalizes traffic origin rows into UTM-attributed raw events", () => {
    const rows = normalizeVturbTrafficOriginRows([
      {
        date_key: "2026-06-29",
        query_key: "utm_content",
        grouped_field: "campanha-ad-123-feed",
        total_viewed_session_uniq: 20,
        total_started_session_uniq: 12,
        total_over_pitch: 5,
      },
      { date_key: "2026-06-29", query_key: "utm_source", grouped_field: "facebook" },
    ], "player-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventDate: "2026-06-29",
      payload: {
        player_id: "player-1",
        query_key: "utm_content",
        utm_content: "campanha-ad-123-feed",
      },
    });
    expect(rows[0].externalId).toMatch(/^player-1-traffic-2026-06-29-/);
  });

  it("keeps a project sync succeeded when only some VTurb players fail", () => {
    const summary = summarizeVturbPlayerResults([
      { player_id: "ok-player", inserted: 4 },
      { player_id: "blocked-player", error: "company does not have access to public analytics API" },
    ]);

    expect(summary.status).toBe("succeeded");
    expect(summary.partialErrors).toBe(1);
    expect(summary.errorMessage).toBeNull();
  });

  it("fails a project sync when every selected VTurb player fails", () => {
    const summary = summarizeVturbPlayerResults([
      { player_id: "blocked-1", error: "company does not have access to public analytics API" },
      { player_id: "blocked-2", error: "rate limited" },
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.partialErrors).toBe(0);
    expect(summary.errorMessage).toContain("company does not have access");
    expect(summary.errorMessage).toContain("rate limited");
  });

  it("reuses fresh catalog metadata and refreshes stale entries", () => {
    const now = Date.parse("2026-07-18T01:00:00Z");
    expect(
      hasFreshVturbMetadata(
        [
          { metadata_synced_at: "2026-07-17T23:00:00Z" },
          { metadata_synced_at: "2026-07-17T22:00:00Z" },
        ],
        now,
      ),
    ).toBe(true);
    expect(
      hasFreshVturbMetadata(
        [{ metadata_synced_at: "2026-07-17T18:00:00Z" }],
        now,
      ),
    ).toBe(false);
  });

  it("turns nested provider errors and pure skips into worker retries", () => {
    expect(
      vturbResultError({ results: [{ error: "rate limited" }] }),
    ).toBe("rate limited");
    expect(
      vturbResultError({ results: [{ skipped: "sync já em andamento" }] }),
    ).toBe("sync já em andamento");
    expect(
      vturbResultError({
        results: [
          { player_id: "p1", inserted: 3 },
          { batch: { has_more: false } },
        ],
      }),
    ).toBeNull();
  });
});

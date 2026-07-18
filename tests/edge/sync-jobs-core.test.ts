import { describe, expect, it } from "vitest";
import {
  buildAggregateJobInput,
  buildSyncJobDedupeKey,
  buildSyncWindows,
  failureRetryPlan,
  hasWorkerJobBudget,
  parseSyncWorkerOptions,
  shouldStopWorkerLoop,
  sourceSyncStaleMinutes,
  workerJobTimeoutMs,
} from "../../supabase/functions/sync-jobs/core";

describe("sync jobs core", () => {
  it("creates a stable dedupe key for the same logical job", () => {
    const job = {
      source: "meta" as const,
      entityType: "meta_account" as const,
      projectId: "project-1",
      entityId: "act:123",
      dateStart: "2026-07-01",
      dateEnd: "2026-07-03",
    };

    expect(buildSyncJobDedupeKey(job)).toBe(
      "sync:meta:meta_account:project-1:act_123:2026-07-01:2026-07-03:v1",
    );
    expect(buildSyncJobDedupeKey(job)).toBe(buildSyncJobDedupeKey(job));
  });

  it("deduplicates aggregate dates and preserves the source scope", () => {
    expect(
      buildAggregateJobInput({
        workspaceId: "workspace-1",
        projectId: "project-1",
        dates: ["2026-07-03", "invalid", "2026-07-01", "2026-07-03"],
        sourceScope: "vturb",
      }),
    ).toMatchObject({
      source: "aggregate",
      entityType: "aggregate_project_dates",
      dateStart: "2026-07-01",
      dateEnd: "2026-07-03",
      payload: {
        dates: ["2026-07-01", "2026-07-03"],
        source_scope: "vturb",
      },
    });
  });

  it("bounds scheduler windows and worker budgets", () => {
    const windows = buildSyncWindows({
      recentDays: 999,
      includeBackfill: true,
      backfillDays: 999,
      now: new Date("2026-07-17T15:00:00Z"),
    });
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0].priority).toBe(10);

    expect(
      parseSyncWorkerOptions({
        batch_size: 999,
        max_runtime_ms: 999_999,
        stale_running_minutes: 0,
      }),
    ).toEqual({
      batchSize: 50,
      maxRuntimeMs: 110_000,
      staleRunningMinutes: 1,
    });

    expect(parseSyncWorkerOptions({})).toEqual({
      batchSize: 4,
      maxRuntimeMs: 50_000,
      staleRunningMinutes: 15,
    });
  });

  it("uses source-specific recent cadences without changing backfills", () => {
    const recent = {
      label: "recent" as const,
      staleMinutes: 15,
    };
    const backfill = {
      label: "week" as const,
      staleMinutes: 12 * 60,
    };

    expect(sourceSyncStaleMinutes("vturb", recent)).toBe(15);
    expect(sourceSyncStaleMinutes("meta", recent)).toBe(60);
    expect(sourceSyncStaleMinutes("creative", recent)).toBe(6 * 60);
    expect(sourceSyncStaleMinutes("meta", backfill)).toBe(12 * 60);
  });

  it("stops before the runtime limit and dead-letters exhausted jobs", () => {
    expect(
      shouldStopWorkerLoop({
        startedAtMs: 0,
        nowMs: 62_001,
        maxRuntimeMs: 70_000,
      }),
    ).toBe(true);

    const now = new Date("2026-07-17T20:00:00Z");
    expect(
      failureRetryPlan({ attempt_count: 5, max_attempts: 5 }, now),
    ).toEqual({
      status: "dead_letter",
      availableAt: now.toISOString(),
      finishedAt: now.toISOString(),
    });
  });

  it("caps each downstream call inside the worker runtime budget", () => {
    expect(
      workerJobTimeoutMs({
        startedAtMs: 0,
        nowMs: 1_000,
        maxRuntimeMs: 50_000,
      }),
    ).toBe(40_000);
    expect(
      workerJobTimeoutMs({
        startedAtMs: 0,
        nowMs: 38_000,
        maxRuntimeMs: 50_000,
      }),
    ).toBe(5_000);
    expect(hasWorkerJobBudget(11_999)).toBe(false);
    expect(hasWorkerJobBudget(12_000)).toBe(true);
  });
});

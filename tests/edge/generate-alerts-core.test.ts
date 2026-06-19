import { describe, expect, it } from "vitest";
import {
  creativeQueueAlerts,
  type CreativeJobRow,
  type CreativeWorkerHeartbeatRow,
} from "../../supabase/functions/generate-alerts/core";

const NOW = Date.parse("2026-06-18T12:00:00.000Z");

function job(overrides: Partial<CreativeJobRow>): CreativeJobRow {
  return {
    id: crypto.randomUUID(),
    status: "queued",
    attempt_count: 0,
    max_attempts: 3,
    available_at: "2026-06-18T12:00:00.000Z",
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: "2026-06-18T12:00:00.000Z",
    ...overrides,
  };
}

function heartbeat(overrides: Partial<CreativeWorkerHeartbeatRow>): CreativeWorkerHeartbeatRow {
  return {
    worker_id: "worker-a",
    status: "idle",
    active_job_id: null,
    last_seen_at: "2026-06-18T11:59:00.000Z",
    processed_count: 10,
    failed_count: 1,
    last_error: null,
    ...overrides,
  };
}

describe("creative queue alerts", () => {
  it("alerts when pending jobs exist and worker heartbeat is stale", () => {
    const alerts = creativeQueueAlerts(
      [job({ available_at: "2026-06-18T11:58:00.000Z" })],
      [heartbeat({ last_seen_at: "2026-06-18T11:40:00.000Z" })],
      NOW,
    );

    expect(alerts.map((alert) => alert.type)).toContain("worker_heartbeat_stale");
  });

  it("alerts on old available queue backlog", () => {
    const alerts = creativeQueueAlerts(
      [job({ available_at: "2026-06-18T10:45:00.000Z" })],
      [heartbeat({})],
      NOW,
    );

    const backlog = alerts.find((alert) => alert.type === "queue_backlog");
    expect(backlog?.severity).toBe("warning");
    expect(backlog?.details?.oldest_available_minutes).toBe(75);
  });

  it("escalates many failed jobs", () => {
    const failedJobs = Array.from({ length: 10 }, (_, index) =>
      job({
        id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
        status: "failed",
        last_error: `erro ${index}`,
      }),
    );

    const alerts = creativeQueueAlerts(failedJobs, [heartbeat({})], NOW);

    expect(alerts.find((alert) => alert.type === "failed_jobs")?.severity).toBe("critical");
  });

  it("alerts on stale running jobs", () => {
    const alerts = creativeQueueAlerts(
      [
        job({
          status: "running",
          locked_at: "2026-06-18T10:30:00.000Z",
          locked_by: "worker-a",
        }),
      ],
      [heartbeat({})],
      NOW,
    );

    expect(alerts.find((alert) => alert.type === "stale_running_job")?.details?.workers).toEqual(["worker-a"]);
  });
});

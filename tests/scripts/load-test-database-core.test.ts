import { describe, expect, it } from "vitest";
import { summarizeDatabaseSnapshots } from "../../scripts/load-test-database-core.mjs";

const healthy = [
  {
    observed_at: "2026-07-18T12:00:00Z",
    max_connections: 60,
    total_connections: 10,
    active_connections: 2,
    lock_waits: 0,
    expired_running_jobs: 0,
    unclassified_dead_letters: 0,
  },
  {
    observed_at: "2026-07-18T12:00:15Z",
    max_connections: 60,
    total_connections: 20,
    active_connections: 8,
    lock_waits: 0,
    expired_running_jobs: 0,
    unclassified_dead_letters: 0,
  },
];

describe("load-test database health", () => {
  it("summarizes healthy capacity throughout the load window", () => {
    expect(summarizeDatabaseSnapshots(healthy)).toMatchObject({
      ok: true,
      samples: 2,
      max_connection_utilization: 0.3333,
      max_total_connections: 20,
      max_active_connections: 8,
      max_lock_waits: 0,
      max_expired_running_jobs: 0,
      max_unclassified_dead_letters: 0,
    });
  });

  it("holds on connection pressure, locks, expired jobs, or DLQ", () => {
    const pressured = {
      ...healthy[1],
      total_connections: 45,
      lock_waits: 1,
      expired_running_jobs: 1,
      unclassified_dead_letters: 1,
    };
    expect(summarizeDatabaseSnapshots([healthy[0], pressured])).toMatchObject({
      ok: false,
      max_connection_utilization: 0.75,
      max_lock_waits: 1,
      max_expired_running_jobs: 1,
      max_unclassified_dead_letters: 1,
    });
    expect(summarizeDatabaseSnapshots([healthy[0]])).toMatchObject({
      ok: false,
      samples: 1,
    });
  });
});

export function summarizeDatabaseSnapshots(snapshots, {
  connectionUtilizationLimit = 0.7,
} = {}) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      ok: false,
      samples: Array.isArray(snapshots) ? snapshots.length : 0,
      failure: "at least two database snapshots are required",
    };
  }

  const normalized = snapshots.map((snapshot) => {
    const maxConnections = Number(snapshot.max_connections ?? 0);
    const totalConnections = Number(snapshot.total_connections ?? 0);
    return {
      observed_at: snapshot.observed_at ?? null,
      max_connections: maxConnections,
      total_connections: totalConnections,
      active_connections: Number(snapshot.active_connections ?? 0),
      lock_waits: Number(snapshot.lock_waits ?? 0),
      expired_running_jobs: Number(snapshot.expired_running_jobs ?? 0),
      unclassified_dead_letters: Number(
        snapshot.unclassified_dead_letters ?? 0,
      ),
      connection_utilization:
        maxConnections > 0 ? totalConnections / maxConnections : 1,
    };
  });

  const maximum = (key) =>
    Math.max(...normalized.map((snapshot) => Number(snapshot[key] ?? 0)));
  const maxConnectionUtilization = maximum("connection_utilization");
  const maxLockWaits = maximum("lock_waits");
  const maxExpiredRunningJobs = maximum("expired_running_jobs");
  const maxUnclassifiedDeadLetters = maximum("unclassified_dead_letters");

  return {
    ok:
      maxConnectionUtilization < connectionUtilizationLimit &&
      maxLockWaits === 0 &&
      maxExpiredRunningJobs === 0 &&
      maxUnclassifiedDeadLetters === 0,
    samples: normalized.length,
    max_connection_utilization: round(maxConnectionUtilization),
    max_total_connections: maximum("total_connections"),
    max_active_connections: maximum("active_connections"),
    max_lock_waits: maxLockWaits,
    max_expired_running_jobs: maxExpiredRunningJobs,
    max_unclassified_dead_letters: maxUnclassifiedDeadLetters,
    first_observed_at: normalized[0].observed_at,
    last_observed_at: normalized.at(-1).observed_at,
  };
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

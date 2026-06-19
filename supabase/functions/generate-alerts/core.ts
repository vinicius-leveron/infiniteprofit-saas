export interface AlertCandidate {
  source: "meta" | "vturb" | "gateway" | "coverage" | "funnel" | "creative";
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  dedupe_key: string;
  details?: Record<string, unknown>;
}

export interface CreativeJobRow {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempt_count: number | null;
  max_attempts: number | null;
  available_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
}

export interface CreativeWorkerHeartbeatRow {
  worker_id: string;
  status: string;
  active_job_id: string | null;
  last_seen_at: string;
  processed_count: number | null;
  failed_count: number | null;
  last_error: string | null;
}

export function creativeQueueAlerts(
  jobs: CreativeJobRow[],
  heartbeats: CreativeWorkerHeartbeatRow[],
  now = Date.now(),
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const queued = jobs.filter((job) => job.status === "queued" && timestampMs(job.available_at) <= now);
  const running = jobs.filter((job) => job.status === "running");
  const failed = jobs.filter((job) => job.status === "failed");
  const latestHeartbeat = heartbeats
    .map((heartbeat) => ({ ...heartbeat, seenAtMs: timestampMs(heartbeat.last_seen_at) }))
    .filter((heartbeat) => Number.isFinite(heartbeat.seenAtMs))
    .sort((left, right) => right.seenAtMs - left.seenAtMs)[0];
  const heartbeatAgeMinutes = latestHeartbeat
    ? Math.round((now - latestHeartbeat.seenAtMs) / 60_000)
    : null;

  if ((queued.length > 0 || running.length > 0) && (!latestHeartbeat || (heartbeatAgeMinutes ?? 0) > 10)) {
    alerts.push({
      source: "creative",
      type: "worker_heartbeat_stale",
      severity: "critical",
      title: "Worker de criativos sem heartbeat recente",
      message: latestHeartbeat
        ? `Há jobs de criativos pendentes, mas o último heartbeat do worker tem ${heartbeatAgeMinutes} min.`
        : "Há jobs de criativos pendentes, mas nenhum heartbeat de worker foi registrado.",
      dedupe_key: "creative_worker_heartbeat",
      details: {
        queued_jobs: queued.length,
        running_jobs: running.length,
        latest_worker_id: latestHeartbeat?.worker_id ?? null,
        latest_seen_at: latestHeartbeat?.last_seen_at ?? null,
      },
    });
  }

  const oldestQueued = queued
    .map((job) => timestampMs(job.available_at ?? job.created_at))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  if (oldestQueued && now - oldestQueued > 30 * 60_000) {
    const ageMinutes = Math.round((now - oldestQueued) / 60_000);
    alerts.push({
      source: "creative",
      type: "queue_backlog",
      severity: ageMinutes >= 180 || queued.length >= 20 ? "critical" : "warning",
      title: "Fila de criativos com backlog",
      message: `Existem ${queued.length} jobs disponíveis na fila; o mais antigo aguarda há ${ageMinutes} min.`,
      dedupe_key: "creative_queue_backlog",
      details: { queued_jobs: queued.length, oldest_available_minutes: ageMinutes },
    });
  }

  const staleRunning = running.filter((job) => now - timestampMs(job.locked_at) > 60 * 60_000);
  if (staleRunning.length > 0) {
    alerts.push({
      source: "creative",
      type: "stale_running_job",
      severity: "critical",
      title: "Jobs de criativos travados em running",
      message: `${staleRunning.length} job(s) estao travados em execução há mais de 60 min.`,
      dedupe_key: "creative_stale_running",
      details: {
        running_jobs: staleRunning.length,
        workers: [...new Set(staleRunning.map((job) => job.locked_by).filter(Boolean))],
      },
    });
  }

  if (failed.length > 0) {
    alerts.push({
      source: "creative",
      type: "failed_jobs",
      severity: failed.length >= 10 ? "critical" : "warning",
      title: "Jobs de criativos falharam",
      message: `${failed.length} job(s) de criativos estão em estado failed e precisam de triagem/reprocessamento.`,
      dedupe_key: "creative_failed_jobs",
      details: {
        failed_jobs: failed.length,
        sample_errors: failed.map((job) => job.last_error).filter(Boolean).slice(0, 3),
      },
    });
  }

  return alerts;
}

function timestampMs(timestamp: string | null | undefined) {
  if (!timestamp) return Number.NEGATIVE_INFINITY;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

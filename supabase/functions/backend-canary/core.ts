export type CanaryTarget = {
  name: "frontend" | "auth" | "postgrest";
  url: string;
  thresholdMs: number;
  init?: RequestInit;
};

export type CanaryTargetResult = {
  name: CanaryTarget["name"];
  ok: boolean;
  availability: number;
  p95_ms: number;
  threshold_ms: number;
  statuses: Record<string, number>;
};

export async function runBackendCanary({
  targets,
  fetcher = fetch,
  sampleCount = 3,
  timeoutMs = 5_000,
}: {
  targets: CanaryTarget[];
  fetcher?: typeof fetch;
  sampleCount?: number;
  timeoutMs?: number;
}) {
  const boundedSamples = Math.max(1, Math.min(Math.floor(sampleCount), 10));
  const startedAt = new Date();
  const results: CanaryTargetResult[] = [];

  for (const target of targets) {
    const samples = await Promise.all(
      Array.from(
        { length: boundedSamples },
        () => timedFetch(fetcher, target, timeoutMs),
      ),
    );
    const durations = samples
      .map((sample) => sample.duration_ms)
      .sort((left, right) => left - right);
    const successful = samples.filter((sample) => sample.ok).length;
    const availability = successful / samples.length;
    const p95 = percentile(durations, 0.95);

    results.push({
      name: target.name,
      ok: availability === 1 && p95 <= target.thresholdMs,
      availability,
      p95_ms: p95,
      threshold_ms: target.thresholdMs,
      statuses: samples.reduce<Record<string, number>>((statuses, sample) => {
        const key = String(sample.status);
        statuses[key] = (statuses[key] ?? 0) + 1;
        return statuses;
      }, {}),
    });
  }

  const finishedAt = new Date();
  return {
    schema_version: 1,
    status: results.every((result) => result.ok) ? "pass" : "fail",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    sample_count: boundedSamples,
    results,
  };
}

async function timedFetch(
  fetcher: typeof fetch,
  target: CanaryTarget,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetcher(target.url, {
      ...target.init,
      redirect: "follow",
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      duration_ms: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

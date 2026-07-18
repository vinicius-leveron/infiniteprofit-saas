#!/usr/bin/env node

const APP_URL =
  process.env.PROBE_APP_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  "https://infiniteprofit-saas.onrender.com";
const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://nztnctrkmfrgclrnflfa.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SAMPLE_COUNT = boundedInteger(process.env.PROBE_SAMPLES, 3, 1, 10);
const TIMEOUT_MS = boundedInteger(process.env.PROBE_TIMEOUT_MS, 8_000, 1_000, 30_000);
const APP_P95_MS = boundedInteger(process.env.PROBE_APP_P95_MS, 3_000, 100, 30_000);
const AUTH_P95_MS = boundedInteger(process.env.PROBE_AUTH_P95_MS, 2_000, 100, 30_000);
const REST_P95_MS = boundedInteger(process.env.PROBE_REST_P95_MS, 800, 100, 30_000);
const AUTH_EMAIL = process.env.PROBE_AUTH_EMAIL?.trim();
const AUTH_PASSWORD = process.env.PROBE_AUTH_PASSWORD;

if (!SUPABASE_KEY) {
  console.error(
    "VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY is required.",
  );
  process.exit(2);
}

const probes = [
  {
    name: "frontend",
    thresholdMs: APP_P95_MS,
    execute: () =>
      request(`${APP_URL.replace(/\/$/, "")}/`, {
        expectedStatuses: [200],
      }),
  },
  {
    name: "auth-health",
    thresholdMs: AUTH_P95_MS,
    execute: () =>
      request(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/health`, {
        headers: { apikey: SUPABASE_KEY },
        expectedStatuses: [200],
      }),
  },
  {
    name: "postgrest",
    thresholdMs: REST_P95_MS,
    execute: () =>
      request(
        `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/backend_healthcheck`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            "Content-Type": "application/json",
          },
          body: "{}",
          expectedStatuses: [200],
        },
      ),
  },
];

if (AUTH_EMAIL && AUTH_PASSWORD) {
  probes.push({
    name: "auth-login-and-health-contract",
    thresholdMs: AUTH_P95_MS + REST_P95_MS,
    execute: authenticatedHealthProbe,
  });
}

const startedAt = new Date().toISOString();
const results = [];

for (const probe of probes) {
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(await probe.execute());
  }

  const durations = samples.map((sample) => sample.durationMs).sort(
    (left, right) => left - right,
  );
  const p95Ms = percentile(durations, 0.95);
  const availability =
    samples.filter((sample) => sample.ok).length / samples.length;
  const ok = availability === 1 && p95Ms <= probe.thresholdMs;

  results.push({
    name: probe.name,
    ok,
    availability,
    p95_ms: p95Ms,
    threshold_ms: probe.thresholdMs,
    samples: samples.map((sample) => ({
      ok: sample.ok,
      status: sample.status,
      duration_ms: sample.durationMs,
      error: sample.error,
    })),
  });
}

const report = {
  event: "production_probe",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  sample_count: SAMPLE_COUNT,
  ok: results.every((result) => result.ok),
  results,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

async function authenticatedHealthProbe() {
  const login = await request(
    `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: AUTH_EMAIL,
        password: AUTH_PASSWORD,
      }),
      expectedStatuses: [200],
      readJson: true,
    },
  );
  if (!login.ok || !login.payload?.access_token) return login;

  const health = await request(
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/list_source_health_signals`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${login.payload.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _workspace_id: null }),
      expectedStatuses: [200],
    },
  );

  return {
    ...health,
    durationMs: login.durationMs + health.durationMs,
  };
}

async function request(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "follow",
      signal: controller.signal,
    });
    const payload = options.readJson
      ? await response.json().catch(() => null)
      : null;
    const durationMs = Math.round(performance.now() - started);
    return {
      ok: options.expectedStatuses.includes(response.status),
      status: response.status,
      durationMs,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Math.round(performance.now() - started),
      payload: null,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function percentile(sorted, percentileValue) {
  if (sorted.length === 0) return 0;
  const index = Math.max(
    0,
    Math.ceil(sorted.length * percentileValue) - 1,
  );
  return sorted[index];
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

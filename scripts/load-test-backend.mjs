#!/usr/bin/env node
import process from "node:process";
import { summarizeDatabaseSnapshots } from "./load-test-database-core.mjs";

const PRODUCTION_PROJECT_REF = "nztnctrkmfrgclrnflfa";
const mode = String(
  process.env.LOAD_TEST_MODE ?? "authenticated",
).trim().toLowerCase();
if (!["authenticated", "public_canary"].includes(mode)) {
  throw new Error(
    "LOAD_TEST_MODE must be authenticated or public_canary.",
  );
}
const url = required("LOAD_TEST_SUPABASE_URL").replace(/\/$/, "");
const anonKey = required("LOAD_TEST_ANON_KEY");
const email = mode === "authenticated" ? required("LOAD_TEST_EMAIL") : null;
const password =
  mode === "authenticated" ? required("LOAD_TEST_PASSWORD") : null;
const workspaceId =
  mode === "authenticated" ? required("LOAD_TEST_WORKSPACE_ID") : null;
const virtualUsers = boundedInt("LOAD_TEST_VUS", 5, 1, 50);
const durationSeconds = boundedInt("LOAD_TEST_DURATION_SECONDS", 60, 10, 900);
const thinkMs = boundedInt("LOAD_TEST_THINK_MS", 500, 50, 10_000);
const requestTimeoutMs = boundedInt(
  "LOAD_TEST_REQUEST_TIMEOUT_MS",
  8_000,
  1_000,
  30_000,
);
const requireDatabaseHealth =
  process.env.LOAD_TEST_REQUIRE_DATABASE_HEALTH === "true";
const databaseProjectRef = requireDatabaseHealth
  ? requiredFrom(
    ["LOAD_TEST_PROJECT_REF", "SUPABASE_PROJECT_REF"],
    "LOAD_TEST_PROJECT_REF or SUPABASE_PROJECT_REF",
  )
  : null;
const databaseAccessToken = requireDatabaseHealth
  ? required("SUPABASE_ACCESS_TOKEN")
  : null;
const databaseSampleIntervalMs = boundedInt(
  "LOAD_TEST_DATABASE_SAMPLE_INTERVAL_MS",
  15_000,
  5_000,
  60_000,
);
const productionTarget = url.includes(PRODUCTION_PROJECT_REF);

if (
  requireDatabaseHealth &&
  !url.includes(String(databaseProjectRef))
) {
  throw new Error(
    "LOAD_TEST_PROJECT_REF must match LOAD_TEST_SUPABASE_URL.",
  );
}

if (productionTarget) {
  if (process.env.LOAD_TEST_PRODUCTION_ACK !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Production load testing requires LOAD_TEST_PRODUCTION_ACK=${PRODUCTION_PROJECT_REF}`,
    );
  }
  if (virtualUsers > 10 || durationSeconds > 120) {
    throw new Error(
      "Production safety cap is 10 VUs for 120 seconds. Use staging for larger tests.",
    );
  }
}

const samples = {
  auth: [],
  rest: [],
  healthRpc: [],
};
const startedAt = Date.now();
const deadline = startedAt + durationSeconds * 1_000;
const databaseMonitor = requireDatabaseHealth
  ? createDatabaseMonitor()
  : null;
const databaseMonitorPromise = databaseMonitor?.run();

await Promise.all(
  Array.from({ length: virtualUsers }, (_, index) => runVirtualUser(index)),
);
const loadFinishedAt = Date.now();
databaseMonitor?.stop();
const databaseHealth = databaseMonitorPromise
  ? await databaseMonitorPromise
  : null;

const report = {
  schema_version: 1,
  target: new URL(url).host,
  production: productionTarget,
  mode,
  virtual_users: virtualUsers,
  configured_duration_seconds: durationSeconds,
  actual_duration_seconds: round((loadFinishedAt - startedAt) / 1_000),
  think_ms: thinkMs,
  scenarios: {
    auth: summarize(samples.auth),
    ...(mode === "authenticated"
      ? { rest: summarize(samples.rest) }
      : {}),
    health_rpc: summarize(samples.healthRpc),
  },
  ...(databaseHealth ? { database: databaseHealth } : {}),
};

const failures = [];
gate("auth", report.scenarios.auth, threshold("LOAD_TEST_AUTH_P95_MS", 2_000));
if (mode === "authenticated") {
  gate("rest", report.scenarios.rest, threshold("LOAD_TEST_REST_P95_MS", 800));
}
gate(
  "health_rpc",
  report.scenarios.health_rpc,
  threshold("LOAD_TEST_RPC_P95_MS", 800),
);
if (requireDatabaseHealth && !databaseHealth?.ok) {
  failures.push(
    `database health failed: connections=${
      databaseHealth?.max_connection_utilization ?? "missing"
    }, locks=${databaseHealth?.max_lock_waits ?? "missing"}, expired=${
      databaseHealth?.max_expired_running_jobs ?? "missing"
    }, dlq=${databaseHealth?.max_unclassified_dead_letters ?? "missing"}`,
  );
}

console.log(JSON.stringify({ ...report, ok: failures.length === 0, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

async function runVirtualUser(index) {
  await delay(index * Math.min(thinkMs, 250));
  if (mode === "public_canary") {
    return await runPublicCanaryVirtualUser();
  }

  const authResult = await timedRequest(
    "auth",
    `${url}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    },
  );
  if (!authResult.ok) return;

  const payload = await authResult.response.json().catch(() => ({}));
  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) {
    authResult.sample.ok = false;
    authResult.sample.reason = "missing_access_token";
    return;
  }

  let iteration = 0;
  while (Date.now() < deadline) {
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    };
    if (iteration % 2 === 0) {
      await timedRequest(
        "rest",
        `${url}/rest/v1/projects?select=id&limit=1`,
        { headers },
      );
    } else {
      await timedRequest(
        "healthRpc",
        `${url}/rest/v1/rpc/list_source_health_signals`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ _workspace_id: workspaceId }),
        },
      );
    }
    iteration += 1;
    await delay(thinkMs);
  }
}

async function runPublicCanaryVirtualUser() {
  let iteration = 0;
  while (Date.now() < deadline) {
    if (iteration % 2 === 0) {
      await timedRequest(
        "auth",
        `${url}/auth/v1/health`,
        { headers: { apikey: anonKey } },
      );
    } else {
      await timedRequest(
        "healthRpc",
        `${url}/rest/v1/rpc/backend_healthcheck`,
        {
          method: "POST",
          headers: {
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      );
    }
    iteration += 1;
    await delay(thinkMs);
  }
}

async function timedRequest(scenario, requestUrl, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  let response = null;
  let reason = null;
  try {
    response = await fetch(requestUrl, { ...init, signal: controller.signal });
    if (!response.ok) reason = `http_${response.status}`;
  } catch (error) {
    reason =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : "network_error";
  } finally {
    clearTimeout(timeout);
  }

  const sample = {
    duration_ms: round(performance.now() - started),
    ok: Boolean(response?.ok),
    status: response?.status ?? 0,
    reason,
  };
  samples[scenario].push(sample);
  return { ok: sample.ok, response, sample };
}

function createDatabaseMonitor() {
  let stopped = false;
  let releaseWait = () => {};
  const stopSignal = new Promise((resolve) => {
    releaseWait = resolve;
  });

  return {
    async run() {
      const snapshots = [await fetchDatabaseSnapshot()];
      while (!stopped) {
        await Promise.race([
          delay(databaseSampleIntervalMs),
          stopSignal,
        ]);
        if (!stopped) snapshots.push(await fetchDatabaseSnapshot());
      }
      snapshots.push(await fetchDatabaseSnapshot());
      return {
        ...summarizeDatabaseSnapshots(snapshots),
        project_ref: databaseProjectRef,
      };
    },
    stop() {
      stopped = true;
      releaseWait();
    },
  };
}

async function fetchDatabaseSnapshot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${databaseProjectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${databaseAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            select
              pg_catalog.now() as observed_at,
              current_setting('max_connections')::integer as max_connections,
              (
                select pg_catalog.count(*)::integer
                from pg_catalog.pg_stat_activity
                where datname = current_database()
              ) as total_connections,
              (
                select pg_catalog.count(*)::integer
                from pg_catalog.pg_stat_activity
                where datname = current_database() and state = 'active'
              ) as active_connections,
              (
                select pg_catalog.count(*)::integer
                from pg_catalog.pg_stat_activity
                where datname = current_database()
                  and wait_event_type = 'Lock'
              ) as lock_waits,
              (
                select pg_catalog.count(*)::integer
                from public.sync_jobs
                where status = 'running'
                  and locked_at < pg_catalog.now() - interval '5 minutes'
              ) as expired_running_jobs,
              (
                select pg_catalog.count(*)::integer
                from public.sync_jobs
                where status = 'dead_letter'
                  and coalesce(payload -> 'failure' ->> 'kind', '')
                    not in ('permanent', 'superseded')
              ) as unclassified_dead_letters
          `,
        }),
        signal: controller.signal,
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(body) || !body[0]) {
      throw new Error(
        `Database health snapshot failed (${response.status}): ${
          String(body?.message ?? body?.error ?? "invalid response").slice(
            0,
            300,
          )
        }`,
      );
    }
    return body[0];
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(entries) {
  const durations = entries
    .map((entry) => entry.duration_ms)
    .sort((left, right) => left - right);
  const errors = entries.filter((entry) => !entry.ok);
  const statuses = {};
  for (const entry of entries) {
    const key = String(entry.status || entry.reason || "unknown");
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    requests: entries.length,
    errors: errors.length,
    error_rate: entries.length ? round(errors.length / entries.length) : 1,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    p99_ms: percentile(durations, 0.99),
    max_ms: durations.at(-1) ?? 0,
    statuses,
  };
}

function gate(name, result, p95Limit) {
  const errorRateLimit = Number(
    process.env.LOAD_TEST_MAX_ERROR_RATE ?? "0.01",
  );
  if (result.requests === 0) {
    failures.push(`${name}: no requests completed`);
  }
  if (result.error_rate > errorRateLimit) {
    failures.push(
      `${name}: error rate ${result.error_rate} exceeded ${errorRateLimit}`,
    );
  }
  if (result.p95_ms > p95Limit) {
    failures.push(`${name}: p95 ${result.p95_ms}ms exceeded ${p95Limit}ms`);
  }
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function threshold(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInt(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredFrom(names, label) {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  throw new Error(`${label} is required.`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

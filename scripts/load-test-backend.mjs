#!/usr/bin/env node
import process from "node:process";

const PRODUCTION_PROJECT_REF = "nztnctrkmfrgclrnflfa";
const url = required("LOAD_TEST_SUPABASE_URL").replace(/\/$/, "");
const anonKey = required("LOAD_TEST_ANON_KEY");
const email = required("LOAD_TEST_EMAIL");
const password = required("LOAD_TEST_PASSWORD");
const workspaceId = required("LOAD_TEST_WORKSPACE_ID");
const virtualUsers = boundedInt("LOAD_TEST_VUS", 5, 1, 50);
const durationSeconds = boundedInt("LOAD_TEST_DURATION_SECONDS", 60, 10, 900);
const thinkMs = boundedInt("LOAD_TEST_THINK_MS", 500, 50, 10_000);
const requestTimeoutMs = boundedInt(
  "LOAD_TEST_REQUEST_TIMEOUT_MS",
  8_000,
  1_000,
  30_000,
);
const productionTarget = url.includes(PRODUCTION_PROJECT_REF);

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

await Promise.all(
  Array.from({ length: virtualUsers }, (_, index) => runVirtualUser(index)),
);

const report = {
  target: new URL(url).host,
  production: productionTarget,
  virtual_users: virtualUsers,
  configured_duration_seconds: durationSeconds,
  actual_duration_seconds: round((Date.now() - startedAt) / 1_000),
  think_ms: thinkMs,
  scenarios: {
    auth: summarize(samples.auth),
    rest: summarize(samples.rest),
    health_rpc: summarize(samples.healthRpc),
  },
};

const failures = [];
gate("auth", report.scenarios.auth, threshold("LOAD_TEST_AUTH_P95_MS", 2_000));
gate("rest", report.scenarios.rest, threshold("LOAD_TEST_REST_P95_MS", 800));
gate(
  "health_rpc",
  report.scenarios.health_rpc,
  threshold("LOAD_TEST_RPC_P95_MS", 800),
);

console.log(JSON.stringify({ ...report, ok: failures.length === 0, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;

async function runVirtualUser(index) {
  await delay(index * Math.min(thinkMs, 250));
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

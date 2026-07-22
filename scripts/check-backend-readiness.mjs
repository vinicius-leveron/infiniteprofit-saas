#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  GetQueueAttributesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  evaluateAuthEmailDelivery,
  evaluateExternalCanaryRuns,
  evaluateGatewayDrillReport,
  evaluateInternalCanaryRuns,
  evaluateLoadReport,
  evaluateOnboardingReport,
  evaluateProbe,
  evaluateRestoreReport,
  evaluateRlsReport,
  evaluateRuntime,
  evaluateSqsSnapshot,
  missingEvidenceCheck,
  readinessSummary,
} from "./backend-readiness-core.mjs";

await loadLocalEnv();

const productionProjectRef = "nztnctrkmfrgclrnflfa";
const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() || productionProjectRef;
const supabaseUrl = (
  process.env.READINESS_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  `https://${projectRef}.supabase.co`
).replace(/\/$/, "");
const anonKey =
  process.env.READINESS_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const appUrl = (
  process.env.READINESS_APP_URL ??
  process.env.PROBE_APP_URL ??
  "https://infiniteprofit-saas.onrender.com"
).replace(/\/$/, "");
const enforce = process.argv.includes("--enforce");
const now = new Date();

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readOptional(join(homedir(), ".supabase", "access-token")))?.trim();

if (!accessToken) {
  throw new Error(
    "SUPABASE_ACCESS_TOKEN ou ~/.supabase/access-token é obrigatório.",
  );
}
if (!anonKey) {
  throw new Error(
    "READINESS_ANON_KEY ou VITE_SUPABASE_PUBLISHABLE_KEY é obrigatório.",
  );
}

const [
  project,
  authConfig,
  databaseSnapshot,
  probeReport,
  canaryRuns,
  sqsSnapshot,
] =
  await Promise.all([
    getProject(accessToken, projectRef),
    getAuthConfig(accessToken, projectRef),
    getDatabaseSnapshot(accessToken, projectRef),
    runLiveProbe({ appUrl, supabaseUrl, anonKey }),
    getCanaryRuns(),
    getSqsSnapshot(),
  ]);

const runtimeChecks = evaluateRuntime({
  ...databaseSnapshot,
  project_status: project.status,
});
const checks = [
  ...runtimeChecks,
  evaluateProbe(probeReport),
  evaluateAuthEmailDelivery(authConfig, {
    minimumEmailsPerHour:
      positiveNumber(process.env.READINESS_MIN_AUTH_EMAILS_PER_HOUR) ?? 30,
  }),
  evaluateExternalCanaryRuns(canaryRuns, { now }),
  evaluateInternalCanaryRuns(databaseSnapshot.backend_canary_runs, { now }),
  evaluateSqsSnapshot({
    ...sqsSnapshot,
    consumer_status: databaseSnapshot.gateway_consumer_status,
    consumer_heartbeat_age_seconds:
      databaseSnapshot.gateway_consumer_heartbeat_age_seconds,
  }),
  evidenceCheck(
    "staging_load_2x",
    process.env.READINESS_LOAD_REPORT,
    (report) =>
      evaluateLoadReport(
        report,
        positiveNumber(process.env.READINESS_EXPECTED_PEAK_VUS),
      ),
  ),
  evidenceCheck(
    "restore_drill",
    process.env.READINESS_RESTORE_REPORT,
    (report) => evaluateRestoreReport(report, { now }),
  ),
  evidenceCheck(
    "gateway_db_outage_drill",
    process.env.READINESS_GATEWAY_DRILL_REPORT,
    (report) => evaluateGatewayDrillReport(report, { now }),
  ),
  evidenceCheck(
    "staging_onboarding",
    process.env.READINESS_ONBOARDING_REPORT,
    (report) => evaluateOnboardingReport(report, { now }),
  ),
  evidenceCheck(
    "rls_contracts",
    process.env.READINESS_RLS_REPORT,
    (report) => evaluateRlsReport(report, { now }),
  ),
];

const report = readinessSummary(checks, now);
console.log(JSON.stringify({
  ...report,
  target: {
    project_ref: projectRef,
    app_host: new URL(appUrl).host,
    supabase_host: new URL(supabaseUrl).host,
  },
  live_probe: probeReport,
}, null, 2));

if (enforce && report.decision !== "ready") {
  process.exitCode = 1;
}

async function getProject(token, ref) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Supabase project status ${response.status}: ${
        safeMessage(body?.message ?? body?.error ?? response.statusText)
      }`,
    );
  }
  return body ?? {};
}

async function getAuthConfig(token, ref) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Supabase Auth config ${response.status}: ${
        safeMessage(body?.message ?? body?.error ?? response.statusText)
      }`,
    );
  }
  return body ?? {};
}

async function getDatabaseSnapshot(token, ref) {
  const query = `
    with expected_cron(name) as (
      values
        ('sync-scheduler-projects'::text),
        ('sync-worker-projects'::text),
        ('sync-watchdog-projects'::text),
        ('backend-internal-canary'::text)
    ),
    legacy_cron(name) as (
      values
        ('sync-meta-projects'::text),
        ('sync-vturb-projects'::text),
        ('daily-meta-pull'::text),
        ('daily-creative-sync-morning'::text),
        ('daily-creative-sync-midday'::text),
        ('daily-creative-sync-evening'::text)
    ),
    critical_index(name) as (
      values
        ('idx_raw_events_project_received'::text),
        ('idx_raw_events_project_source_received'::text),
        ('idx_sync_runs_project_created'::text),
        ('idx_sync_runs_project_source_status_started'::text),
        ('idx_sync_jobs_terminal_finished'::text)
    )
    select
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
        where datname = current_database() and wait_event_type = 'Lock'
      ) as lock_waits,
      (
        select pg_catalog.count(*)::integer from expected_cron
      ) as expected_cron_jobs,
      (
        select pg_catalog.count(*)::integer
        from cron.job job join expected_cron expected on expected.name = job.jobname
        where job.active
      ) as active_expected_cron_jobs,
      (
        select pg_catalog.count(*)::integer
        from cron.job job join legacy_cron legacy on legacy.name = job.jobname
        where job.active
      ) as unexpected_legacy_cron_jobs,
      (
        select pg_catalog.count(*)::integer
        from public.sync_jobs
        where status = 'queued' and available_at <= pg_catalog.now()
      ) as ready_jobs,
      coalesce((
        select extract(
          epoch from pg_catalog.max(pg_catalog.now() - available_at)
        )::integer
        from public.sync_jobs
        where status = 'queued' and available_at <= pg_catalog.now()
      ), 0) as oldest_ready_age_seconds,
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
      ) as unclassified_dead_letters,
      (
        select pg_catalog.count(*)::integer
        from public.sync_jobs
        where status = 'dead_letter'
          and payload -> 'failure' ->> 'kind' = 'permanent'
      ) as permanent_dead_letters,
      (
        select pg_catalog.count(*)::integer
        from public.sync_jobs
        where status = 'dead_letter'
          and payload -> 'failure' ->> 'kind' = 'superseded'
      ) as superseded_dead_letters,
      (
        select pg_catalog.count(*)::integer
        from critical_index expected
        where not exists (
          select 1
          from pg_catalog.pg_index index
          join pg_catalog.pg_class class on class.oid = index.indexrelid
          join pg_catalog.pg_namespace namespace
            on namespace.oid = class.relnamespace
          where namespace.nspname = 'public'
            and class.relname = expected.name
            and index.indisvalid
            and index.indisready
        )
      ) as invalid_critical_indexes
      ,
      coalesce((
        select stats.n_live_tup::bigint
        from pg_catalog.pg_stat_user_tables stats
        where stats.schemaname = 'public'
          and stats.relname = 'raw_events'
      ), 0) as raw_events_live_tuples,
      coalesce((
        select stats.n_dead_tup::bigint
        from pg_catalog.pg_stat_user_tables stats
        where stats.schemaname = 'public'
          and stats.relname = 'raw_events'
      ), 0) as raw_events_dead_tuples,
      coalesce((
        select extract(
          epoch from pg_catalog.now() - stats.last_autovacuum
        )::integer
        from pg_catalog.pg_stat_user_tables stats
        where stats.schemaname = 'public'
          and stats.relname = 'raw_events'
      ), 2147483647) as raw_events_autovacuum_age_seconds,
      (
        select heartbeat.status
        from public.gateway_worker_heartbeats heartbeat
        order by heartbeat.last_seen_at desc
        limit 1
      ) as gateway_consumer_status,
      coalesce((
        select extract(
          epoch from pg_catalog.now() - pg_catalog.max(heartbeat.last_seen_at)
        )::integer
        from public.gateway_worker_heartbeats heartbeat
      ), 2147483647) as gateway_consumer_heartbeat_age_seconds,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'status', run.status,
            'created_at', run.created_at,
            'finished_at', run.finished_at
          )
          order by run.created_at
        )
        from public.backend_canary_runs run
        where run.created_at >= pg_catalog.now() - interval '24 hours'
      ), '[]'::jsonb) as backend_canary_runs
  `;
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Supabase readiness query ${response.status}: ${
        safeMessage(body?.message ?? body?.error ?? response.statusText)
      }`,
    );
  }
  return Array.isArray(body) ? body[0] ?? {} : {};
}

async function runLiveProbe({ appUrl: app, supabaseUrl: backend, anonKey: key }) {
  const definitions = [
    {
      name: "frontend",
      url: `${app}/`,
      init: {},
      threshold: 3_000,
    },
    {
      name: "auth-health",
      url: `${backend}/auth/v1/health`,
      init: { headers: { apikey: key } },
      threshold: 2_000,
    },
    {
      name: "postgrest",
      url: `${backend}/rest/v1/rpc/backend_healthcheck`,
      init: {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: "{}",
      },
      threshold: 800,
    },
  ];
  const results = [];

  for (const definition of definitions) {
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      samples.push(await timedFetch(definition.url, definition.init));
    }
    const durations = samples
      .map((sample) => sample.duration_ms)
      .sort((left, right) => left - right);
    const availability =
      samples.filter((sample) => sample.ok).length / samples.length;
    const p95 = percentile(durations, 0.95);
    results.push({
      name: definition.name,
      ok: availability === 1 && p95 <= definition.threshold,
      availability,
      p95_ms: p95,
      threshold_ms: definition.threshold,
      statuses: countStatuses(samples),
    });
  }

  return {
    ok: results.every((result) => result.ok),
    sample_count: 3,
    results,
  };
}

async function timedFetch(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      duration_ms: Math.round(performance.now() - started),
      error: error instanceof Error ? error.name : "request_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getCanaryRuns() {
  const token = githubToken();
  const repository =
    process.env.READINESS_GITHUB_REPOSITORY ??
    "vinicius-leveron/infiniteprofit-saas";
  const url = new URL(
    `https://api.github.com/repos/${repository}/actions/workflows/backend-canary.yml/runs`,
  );
  url.searchParams.set("per_page", "100");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "infiniteprofit-readiness-gate",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) return [];
  const body = await response.json().catch(() => ({}));
  return Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
}

async function getSqsSnapshot() {
  const queueUrl = process.env.GATEWAY_QUEUE_URL?.trim();
  const deadLetterQueueUrl = process.env.GATEWAY_DLQ_URL?.trim();
  if (!queueUrl || !deadLetterQueueUrl) {
    return { configured: false };
  }

  const region = process.env.AWS_REGION || "us-east-1";
  const sqs = new SQSClient({ region });
  const [queue, deadLetter] = await Promise.all([
    sqs.send(new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["ApproximateNumberOfMessages"],
    })),
    sqs.send(new GetQueueAttributesCommand({
      QueueUrl: deadLetterQueueUrl,
      AttributeNames: ["ApproximateNumberOfMessages"],
    })),
  ]);
  const visible = Number(
    queue.Attributes?.ApproximateNumberOfMessages ?? "0",
  );
  const deadLetters = Number(
    deadLetter.Attributes?.ApproximateNumberOfMessages ?? "0",
  );

  return {
    configured: true,
    visible_messages: visible,
    oldest_message_seconds:
      visible === 0 ? 0 : await getOldestQueueMessageAge(region, queueUrl),
    dead_letter_messages: deadLetters,
  };
}

async function getOldestQueueMessageAge(region, queueUrl) {
  const queueName = decodeURIComponent(new URL(queueUrl).pathname.split("/").at(-1));
  const cloudwatch = new CloudWatchClient({ region });
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 10 * 60 * 1_000);
  const result = await cloudwatch.send(new GetMetricStatisticsCommand({
    Namespace: "AWS/SQS",
    MetricName: "ApproximateAgeOfOldestMessage",
    Dimensions: [{ Name: "QueueName", Value: queueName }],
    StartTime: startTime,
    EndTime: endTime,
    Period: 60,
    Statistics: ["Maximum"],
  }));
  const datapoints = (result.Datapoints ?? []).sort(
    (left, right) =>
      Number(right.Timestamp?.getTime() ?? 0) -
      Number(left.Timestamp?.getTime() ?? 0),
  );
  return Number(datapoints[0]?.Maximum ?? Infinity);
}

function evidenceCheck(id, path, evaluate) {
  if (!path) return missingEvidenceCheck(id, path);
  try {
    return evaluate(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return missingEvidenceCheck(id, path);
  }
}

function githubToken() {
  const environmentToken =
    process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function loadLocalEnv() {
  if (!existsSync(".env")) return;
  const content = await readFile(".env", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function percentile(sorted, value) {
  if (sorted.length === 0) return Infinity;
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

function countStatuses(samples) {
  return samples.reduce((result, sample) => {
    const key = String(sample.status);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeMessage(value) {
  return String(value ?? "unknown")
    .replaceAll(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replaceAll(/sb[p_-][A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .slice(0, 300);
}

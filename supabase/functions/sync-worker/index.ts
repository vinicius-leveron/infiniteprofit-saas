/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAutomationHeaders,
  isAutomationRequest,
} from "../_shared/automation.ts";
import { enqueueSyncJob } from "../_shared/sync-jobs.ts";
import {
  buildAggregateJobInput,
  dateRangeToDates,
  daysForDateRange,
  failureRetryPlan,
  hasWorkerJobBudget,
  parseSyncWorkerOptions,
  shouldStopWorkerLoop,
  workerJobTimeoutMs,
  type ClaimedSyncJob,
} from "../sync-jobs/core.ts";
import { vturbResultError } from "../vturb-pull/core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_LEASE_NAME = "primary";
const WORKER_LEASE_SECONDS = 5 * 60;

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let leaseClient: SupabaseClientAny | null = null;
  let leaseHolder: string | null = null;

  try {
    if (!isAutomationRequest(req)) {
      return json({ error: "Unauthorized", trace_id: traceId }, 401, traceId);
    }

    const startedAtMs = Date.now();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const options = parseSyncWorkerOptions(body);
    const workerName = `sync-worker-${crypto.randomUUID()}`;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const leaseAcquired = await acquireWorkerLease(sb, workerName);

    if (!leaseAcquired) {
      console.log(JSON.stringify({
        event: "sync_worker_skipped",
        trace_id: traceId,
        worker: workerName,
        reason: "lease_held",
        duration_ms: Date.now() - startedAtMs,
      }));
      return json(
        {
          ok: true,
          trace_id: traceId,
          worker: workerName,
          claimed: 0,
          skipped: "lease_held",
        },
        200,
        traceId,
      );
    }

    leaseClient = sb;
    leaseHolder = workerName;

    const { error: requeueError } = await sb.rpc("requeue_stale_sync_jobs", {
      max_age_minutes: options.staleRunningMinutes,
    });
    if (requeueError) throw new Error(requeueError.message);

    const { data: claimedRows, error: claimError } = await sb.rpc(
      "claim_sync_jobs",
      {
        job_limit: options.batchSize,
        worker_name: workerName,
      },
    );
    if (claimError) throw new Error(claimError.message);

    const claimed = (claimedRows ?? []) as ClaimedSyncJob[];
    const results: Array<Record<string, unknown>> = [];

    for (const job of claimed) {
      if (
        shouldStopWorkerLoop({
          startedAtMs,
          nowMs: Date.now(),
          maxRuntimeMs: options.maxRuntimeMs,
        })
      ) {
        await requeueClaimedJob(
          sb,
          job,
          "Worker interrompeu antes do job por limite de tempo.",
        );
        results.push({ job_id: job.id, skipped: "runtime_budget" });
        continue;
      }

      const jobTimeoutMs = workerJobTimeoutMs({
        startedAtMs,
        nowMs: Date.now(),
        maxRuntimeMs: options.maxRuntimeMs,
      });
      if (!hasWorkerJobBudget(jobTimeoutMs)) {
        await requeueClaimedJob(
          sb,
          job,
          "Worker adiou o job por orçamento downstream insuficiente.",
        );
        results.push({ job_id: job.id, skipped: "downstream_budget" });
        continue;
      }

      try {
        const leaseRenewed = await renewWorkerLease(sb, workerName);
        if (!leaseRenewed) {
          throw new Error("Worker perdeu a lease exclusiva antes do job.");
        }
        const result = await processJob(sb, job, traceId, jobTimeoutMs);
        await markSucceeded(sb, job.id, job.payload ?? {}, result);
        results.push({
          job_id: job.id,
          source: job.source,
          entity_type: job.entity_type,
          ok: true,
          result,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro inesperado no job";
        await markFailedOrRetry(sb, job, message);
        results.push({
          job_id: job.id,
          source: job.source,
          entity_type: job.entity_type,
          error: message,
        });
      }
    }

    console.log(JSON.stringify({
      event: "sync_worker_completed",
      trace_id: traceId,
      worker: workerName,
      claimed: claimed.length,
      failed: results.filter((result) => result.error).length,
      duration_ms: Date.now() - startedAtMs,
    }));

    return json(
      {
        ok: true,
        trace_id: traceId,
        worker: workerName,
        claimed: claimed.length,
        results,
      },
      200,
      traceId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado";
    console.error(JSON.stringify({
      event: "sync_worker_failed",
      trace_id: traceId,
      error: message,
    }));
    return json({ error: message, trace_id: traceId }, 500, traceId);
  } finally {
    if (leaseClient && leaseHolder) {
      await releaseWorkerLease(leaseClient, leaseHolder);
    }
  }
});

async function processJob(
  sb: SupabaseClientAny,
  job: ClaimedSyncJob,
  traceId: string,
  timeoutMs: number,
) {
  if (
    job.source === "aggregate" &&
    job.entity_type === "aggregate_project_dates"
  ) {
    return await processAggregateJob(sb, job, traceId, timeoutMs);
  }

  if (job.source === "meta" && job.entity_type === "meta_account") {
    const accountId = String(
      job.payload?.account_id ?? job.entity_id ?? "",
    ).trim();
    if (!accountId) throw new Error("Job Meta sem account_id");
    const result = await callFunction(
      "meta-pull",
      {
        execute_inline: true,
        skip_aggregate: true,
        skip_creative: true,
        project_id: job.project_id,
        account_id: accountId,
        date_start: job.date_start,
        date_end: job.date_end,
      },
      traceId,
      timeoutMs,
    );
    const aggregate = await enqueueAggregateForJob(
      sb,
      job,
      extractDates(result, job),
    );
    return { source_result: compactResult(result), aggregate };
  }

  if (job.source === "vturb" && job.entity_type === "vturb_player") {
    const playerId = String(
      job.payload?.player_id ?? job.entity_id ?? "",
    ).trim();
    if (!playerId) throw new Error("Job VTurb sem player_id");
    const result = await callFunction(
      "vturb-pull",
      {
        execute_inline: true,
        skip_aggregate: true,
        project_id: job.project_id,
        player_id: playerId,
        date_start: job.date_start,
        date_end: job.date_end,
        max_runtime_ms: timeoutMs,
        max_players: 1,
      },
      traceId,
      timeoutMs,
    );
    const sourceError = vturbResultError(result);
    if (sourceError) throw new Error(sourceError);
    const aggregate = await enqueueAggregateForJob(
      sb,
      job,
      extractDates(result, job),
    );
    return { source_result: compactResult(result), aggregate };
  }

  if (job.source === "gateway" && job.entity_type === "hubla_reconcile") {
    throw new Error(
      "Reconciliação Hubla por API/export ainda não está configurada para worker automático.",
    );
  }

  if (job.source === "creative" && job.entity_type === "creative_project") {
    const days = daysForDateRange(job.date_start, job.date_end);
    const result = await callFunction(
      "creative-sync",
      {
        project_id: job.project_id,
        days,
        enqueue_analysis: false,
      },
      traceId,
      timeoutMs,
    );
    return { source_result: compactResult(result) };
  }

  throw new Error(
    `Tipo de job não suportado: ${job.source}/${job.entity_type}`,
  );
}

async function processAggregateJob(
  sb: SupabaseClientAny,
  job: ClaimedSyncJob,
  traceId: string,
  timeoutMs: number,
) {
  const dates = Array.isArray(job.payload?.dates)
    ? job.payload.dates.map((date) => String(date).slice(0, 10))
    : dateRangeToDates(job.date_start, job.date_end);

  const result = await callFunction(
    "aggregate-daily",
    {
      project_id: job.project_id,
      dates,
      ...(typeof job.payload?.source_scope === "string"
        ? { source_scope: job.payload.source_scope }
        : {}),
    },
    traceId,
    timeoutMs,
  );
  await assertDailyMetricsRows(sb, job.project_id, dates);

  return {
    ...result,
    verified_daily_dates: dates.length,
  };
}

async function enqueueAggregateForJob(
  sb: SupabaseClientAny,
  job: ClaimedSyncJob,
  dates: string[],
) {
  const aggregateJob = buildAggregateJobInput({
    workspaceId: job.workspace_id,
    projectId: job.project_id,
    dates,
    priority: Math.max(1, job.priority - 1),
    sourceScope: job.source === "vturb" ? "vturb" : null,
  });
  if (!aggregateJob) return null;

  return await enqueueSyncJob(sb, aggregateJob, {
    requeueSucceededAfterMinutes: 0,
    reviveDeadLetter: true,
  });
}

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  traceId: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1_000, timeoutMs),
  );

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        ...buildAutomationHeaders(),
        "x-request-id": traceId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(String(payload?.error ?? `HTTP ${response.status}`));
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Timeout ao executar ${name} após ${Math.round(timeoutMs)}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function acquireWorkerLease(
  sb: SupabaseClientAny,
  workerName: string,
) {
  const { data, error } = await sb.rpc("try_acquire_sync_worker_lease", {
    _lease_name: WORKER_LEASE_NAME,
    _holder: workerName,
    _lease_seconds: WORKER_LEASE_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function renewWorkerLease(
  sb: SupabaseClientAny,
  workerName: string,
) {
  const { data, error } = await sb.rpc("renew_sync_worker_lease", {
    _lease_name: WORKER_LEASE_NAME,
    _holder: workerName,
    _lease_seconds: WORKER_LEASE_SECONDS,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function releaseWorkerLease(
  sb: SupabaseClientAny,
  workerName: string,
) {
  const { error } = await sb.rpc("release_sync_worker_lease", {
    _lease_name: WORKER_LEASE_NAME,
    _holder: workerName,
  });
  if (error) {
    console.error(JSON.stringify({
      event: "sync_worker_lease_release_failed",
      worker: workerName,
      error: error.message,
    }));
  }
}

async function assertDailyMetricsRows(
  sb: SupabaseClientAny,
  projectId: string,
  dates: string[],
) {
  const expectedDates = [
    ...new Set(
      dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    ),
  ];
  if (expectedDates.length === 0) return;

  const { data, error } = await sb
    .from("daily_metrics")
    .select("event_date")
    .eq("project_id", projectId)
    .in("event_date", expectedDates);

  if (error) {
    throw new Error(`Falha ao validar daily_metrics: ${error.message}`);
  }

  const found = new Set(
    (data ?? []).map((row: { event_date: string }) =>
      String(row.event_date).slice(0, 10)
    ),
  );
  const missing = expectedDates.filter((date) => !found.has(date));
  if (missing.length > 0) {
    throw new Error(
      `aggregate-daily não gravou daily_metrics para: ${missing.join(", ")}`,
    );
  }
}

async function markSucceeded(
  sb: SupabaseClientAny,
  jobId: string,
  previousPayload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const { error } = await sb
    .from("sync_jobs")
    .update({
      status: "succeeded",
      locked_at: null,
      locked_by: null,
      last_error: null,
      finished_at: new Date().toISOString(),
      payload: {
        ...previousPayload,
        last_result: compactResult(result),
      },
    })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
}

async function markFailedOrRetry(
  sb: SupabaseClientAny,
  job: ClaimedSyncJob,
  message: string,
) {
  const plan = failureRetryPlan(job);
  const { error } = await sb
    .from("sync_jobs")
    .update({
      status: plan.status,
      available_at: plan.availableAt,
      locked_at: null,
      locked_by: null,
      last_error: message.slice(0, 2000),
      finished_at: plan.finishedAt,
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
}

async function requeueClaimedJob(
  sb: SupabaseClientAny,
  job: ClaimedSyncJob,
  message: string,
) {
  const { error } = await sb
    .from("sync_jobs")
    .update({
      status: "queued",
      attempt_count: Math.max(0, job.attempt_count - 1),
      available_at: new Date(Date.now() + 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: message,
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
}

function extractDates(payload: unknown, job: ClaimedSyncJob) {
  const dates = new Set<string>();
  collectDates(payload, dates);
  if (dates.size > 0) return [...dates].sort();
  return dateRangeToDates(job.date_start, job.date_end);
}

function collectDates(value: unknown, dates: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectDates(item, dates);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "date",
    "event_date",
    "date_start",
    "day",
    "date_key",
  ]) {
    const candidate = String(record[key] ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) dates.add(candidate);
  }
  if (Array.isArray(record.dates)) {
    for (const date of record.dates) {
      const candidate = String(date ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) dates.add(candidate);
    }
  }
  for (const nestedKey of ["results", "source_result"]) {
    collectDates(record[nestedKey], dates);
  }
}

function compactResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { value };
  const record = value as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify(record, (_key, raw) => {
      if (typeof raw === "string" && raw.length > 500) {
        return `${raw.slice(0, 500)}...`;
      }
      if (Array.isArray(raw) && raw.length > 20) return raw.slice(0, 20);
      return raw;
    }),
  );
}

function json(body: unknown, status: number, traceId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-request-id": traceId,
    },
  });
}

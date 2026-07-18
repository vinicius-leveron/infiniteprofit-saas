/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import {
  buildSyncJobDedupeKey,
  type SyncJobInput,
  type SyncJobStatus,
} from "../sync-jobs/core.ts";

type SupabaseLike = {
  from: (table: string) => any;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<any>;
};

export type EnqueueSyncJobOptions = {
  availableAt?: string;
  requeueSucceededAfterMinutes?: number | null;
  reviveDeadLetter?: boolean;
};

export type EnqueueSyncJobResult = {
  dedupe_key: string;
  status: "inserted" | "updated" | "skipped";
  job_id?: string | null;
  existing_status?: SyncJobStatus | null;
};

export type SyncJobBatchItem = {
  job: SyncJobInput;
  options?: EnqueueSyncJobOptions;
};

export async function enqueueSyncJob(
  sb: SupabaseLike,
  job: SyncJobInput,
  options: EnqueueSyncJobOptions = {},
): Promise<EnqueueSyncJobResult> {
  if (sb.rpc) {
    const [result] = await enqueueSyncJobBatch(sb, [{ job, options }]);
    if (!result) {
      throw new Error("enqueue_sync_jobs não retornou o job solicitado");
    }
    return result;
  }

  const dedupeKey = buildSyncJobDedupeKey(job);
  const availableAt = options.availableAt ?? new Date().toISOString();
  const priority = Math.max(0, Math.floor(job.priority ?? 100));
  const maxAttempts = Math.max(1, Math.floor(job.maxAttempts ?? 5));

  const { data: existing, error: existingError } = await sb
    .from("sync_jobs")
    .select("id, status, priority, finished_at")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  const row = {
    workspace_id: job.workspaceId,
    project_id: job.projectId,
    source: job.source,
    entity_type: job.entityType,
    entity_id: job.entityId ?? null,
    date_start: job.dateStart,
    date_end: job.dateEnd,
    priority,
    status: "queued",
    attempt_count: 0,
    max_attempts: maxAttempts,
    available_at: availableAt,
    locked_at: null,
    locked_by: null,
    dedupe_key: dedupeKey,
    payload: job.payload ?? {},
    last_error: null,
    finished_at: null,
  };

  if (!existing) {
    const { data, error } = await sb
      .from("sync_jobs")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      dedupe_key: dedupeKey,
      status: "inserted",
      job_id: data?.id ?? null,
    };
  }

  const existingStatus = existing.status as SyncJobStatus;
  if (existingStatus === "running") {
    return {
      dedupe_key: dedupeKey,
      status: "skipped",
      job_id: existing.id,
      existing_status: existingStatus,
    };
  }

  if (existingStatus === "succeeded") {
    const threshold = options.requeueSucceededAfterMinutes;
    if (
      threshold == null ||
      !isOlderThanMinutes(existing.finished_at, threshold)
    ) {
      return {
        dedupe_key: dedupeKey,
        status: "skipped",
        job_id: existing.id,
        existing_status: existingStatus,
      };
    }
  }

  if (existingStatus === "dead_letter" && !options.reviveDeadLetter) {
    return {
      dedupe_key: dedupeKey,
      status: "skipped",
      job_id: existing.id,
      existing_status: existingStatus,
    };
  }

  const { error } = await sb
    .from("sync_jobs")
    .update(row)
    .eq("id", existing.id);
  if (error) throw new Error(error.message);

  return {
    dedupe_key: dedupeKey,
    status: "updated",
    job_id: existing.id,
    existing_status: existingStatus,
  };
}

export async function enqueueSyncJobs(
  sb: SupabaseLike,
  jobs: SyncJobInput[],
  options: EnqueueSyncJobOptions = {},
) {
  const results = await enqueueSyncJobBatch(
    sb,
    jobs.map((job) => ({ job, options })),
  );
  return summarizeEnqueueResults(results);
}

export async function enqueueSyncJobBatch(
  sb: SupabaseLike,
  items: SyncJobBatchItem[],
): Promise<EnqueueSyncJobResult[]> {
  if (items.length === 0) return [];

  if (sb.rpc) {
    const { data, error } = await sb.rpc("enqueue_sync_jobs", {
      _jobs: items.map(({ job, options = {} }) => ({
        workspace_id: job.workspaceId,
        project_id: job.projectId,
        source: job.source,
        entity_type: job.entityType,
        entity_id: job.entityId ?? null,
        date_start: job.dateStart,
        date_end: job.dateEnd,
        priority: Math.max(0, Math.floor(job.priority ?? 100)),
        max_attempts: Math.max(1, Math.floor(job.maxAttempts ?? 5)),
        available_at: options.availableAt ?? new Date().toISOString(),
        dedupe_key: buildSyncJobDedupeKey(job),
        payload: job.payload ?? {},
        requeue_succeeded_after_minutes:
          options.requeueSucceededAfterMinutes ?? null,
        revive_dead_letter: options.reviveDeadLetter ?? false,
      })),
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data as EnqueueSyncJobResult[] : [];
  }

  const results: EnqueueSyncJobResult[] = [];
  for (const { job, options } of items) {
    results.push(await enqueueSyncJob(sb, job, options));
  }
  return results;
}

export async function enqueueSyncJobBatchChunked(
  sb: SupabaseLike,
  items: SyncJobBatchItem[],
  chunkSize = 500,
): Promise<EnqueueSyncJobResult[]> {
  if (items.length === 0) return [];
  const boundedChunkSize = Math.min(
    Math.max(Math.floor(chunkSize), 1),
    1000,
  );
  const results: EnqueueSyncJobResult[] = [];

  for (let offset = 0; offset < items.length; offset += boundedChunkSize) {
    const chunk = items.slice(offset, offset + boundedChunkSize);
    const chunkResults = await enqueueSyncJobBatch(sb, chunk);
    if (chunkResults.length !== chunk.length) {
      throw new Error(
        `enqueue_sync_jobs retornou ${chunkResults.length} de ${chunk.length} resultados`,
      );
    }
    results.push(...chunkResults);
  }

  return results;
}

export function summarizeEnqueueCounts(results: EnqueueSyncJobResult[]) {
  return {
    inserted: results.filter((result) => result.status === "inserted").length,
    updated: results.filter((result) => result.status === "updated").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    total: results.length,
  };
}

export function summarizeEnqueueResults(results: EnqueueSyncJobResult[]) {
  return {
    ...summarizeEnqueueCounts(results),
    results,
  };
}

function isOlderThanMinutes(
  timestamp: string | null | undefined,
  minutes: number,
) {
  if (minutes <= 0) return true;
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed >= minutes * 60_000;
}

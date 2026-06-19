export type CreativeJobAdminAction = "requeue" | "dead_letter";

export interface CreativeJobAdminRow {
  id: string;
  asset_id: string;
  project_id: string;
  workspace_id: string;
  status: string;
  attempt_count: number | null;
  max_attempts: number | null;
  last_error: string | null;
}

export interface CreativeJobTransitionInput {
  action: CreativeJobAdminAction;
  job: CreativeJobAdminRow;
  reason?: string | null;
  actorUserId: string;
  resetAttempts?: boolean;
  nowIso?: string;
}

export function buildCreativeJobAdminTransition(input: CreativeJobTransitionInput) {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const reason = normalizeReason(input.reason);
  const previousAttemptCount = Math.max(0, Number(input.job.attempt_count ?? 0));

  if (input.job.status === "succeeded") {
    throw new Error("Jobs succeeded nao podem ser alterados manualmente");
  }

  if (input.action === "requeue") {
    const nextAttemptCount = input.resetAttempts === false ? previousAttemptCount : 0;
    return {
      jobPatch: {
        status: "queued",
        attempt_count: nextAttemptCount,
        available_at: nowIso,
        locked_at: null,
        locked_by: null,
        finished_at: null,
        last_error: reason ? `Requeued manually: ${reason}` : null,
      },
      assetPatch: { analysis_status: "pending" },
      event: buildEvent(input, "queued", previousAttemptCount, nextAttemptCount, reason),
    };
  }

  if (input.action === "dead_letter") {
    return {
      jobPatch: {
        status: "dead_letter",
        available_at: nowIso,
        locked_at: null,
        locked_by: null,
        finished_at: nowIso,
        last_error: reason ? `Dead-lettered manually: ${reason}` : "Dead-lettered manually",
      },
      assetPatch: { analysis_status: "failed" },
      event: buildEvent(input, "dead_letter", previousAttemptCount, previousAttemptCount, reason),
    };
  }

  throw new Error("Acao invalida");
}

function buildEvent(
  input: CreativeJobTransitionInput,
  nextStatus: string,
  previousAttemptCount: number,
  nextAttemptCount: number,
  reason: string | null,
) {
  return {
    job_id: input.job.id,
    workspace_id: input.job.workspace_id,
    project_id: input.job.project_id,
    asset_id: input.job.asset_id,
    action: input.action,
    actor_user_id: input.actorUserId,
    reason,
    previous_status: input.job.status,
    next_status: nextStatus,
    previous_attempt_count: previousAttemptCount,
    next_attempt_count: nextAttemptCount,
    metadata: {
      reset_attempts: input.action === "requeue" ? input.resetAttempts !== false : null,
      previous_last_error: input.job.last_error,
    },
  };
}

function normalizeReason(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1000);
}

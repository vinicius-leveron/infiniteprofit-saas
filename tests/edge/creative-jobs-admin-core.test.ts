import { describe, expect, it } from "vitest";
import { buildCreativeJobAdminTransition, type CreativeJobAdminRow } from "../../supabase/functions/creative-jobs-admin/core";

const baseJob: CreativeJobAdminRow = {
  id: "00000000-0000-0000-0000-000000000001",
  asset_id: "00000000-0000-0000-0000-000000000002",
  project_id: "00000000-0000-0000-0000-000000000003",
  workspace_id: "00000000-0000-0000-0000-000000000004",
  status: "failed",
  attempt_count: 3,
  max_attempts: 3,
  last_error: "timeout",
};

describe("creative jobs admin transitions", () => {
  it("requeues a failed job and resets attempts by default", () => {
    const transition = buildCreativeJobAdminTransition({
      action: "requeue",
      job: baseJob,
      actorUserId: "00000000-0000-0000-0000-000000000005",
      reason: "retry after fixing media",
      nowIso: "2026-06-18T12:00:00.000Z",
    });

    expect(transition.jobPatch.status).toBe("queued");
    expect(transition.jobPatch.attempt_count).toBe(0);
    expect(transition.jobPatch.available_at).toBe("2026-06-18T12:00:00.000Z");
    expect(transition.assetPatch.analysis_status).toBe("pending");
    expect(transition.event.previous_status).toBe("failed");
    expect(transition.event.next_status).toBe("queued");
  });

  it("preserves attempts when resetAttempts is false", () => {
    const transition = buildCreativeJobAdminTransition({
      action: "requeue",
      job: baseJob,
      actorUserId: "00000000-0000-0000-0000-000000000005",
      resetAttempts: false,
    });

    expect(transition.jobPatch.attempt_count).toBe(3);
    expect(transition.event.next_attempt_count).toBe(3);
    expect(transition.event.metadata.reset_attempts).toBe(false);
  });

  it("dead-letters a job with a terminal status and audit event", () => {
    const transition = buildCreativeJobAdminTransition({
      action: "dead_letter",
      job: { ...baseJob, status: "running", attempt_count: 1 },
      actorUserId: "00000000-0000-0000-0000-000000000005",
      reason: "bad source media",
      nowIso: "2026-06-18T12:00:00.000Z",
    });

    expect(transition.jobPatch.status).toBe("dead_letter");
    expect(transition.jobPatch.finished_at).toBe("2026-06-18T12:00:00.000Z");
    expect(transition.assetPatch.analysis_status).toBe("failed");
    expect(transition.event.next_status).toBe("dead_letter");
    expect(transition.event.reason).toBe("bad source media");
  });

  it("does not alter succeeded jobs", () => {
    expect(() =>
      buildCreativeJobAdminTransition({
        action: "requeue",
        job: { ...baseJob, status: "succeeded" },
        actorUserId: "00000000-0000-0000-0000-000000000005",
      }),
    ).toThrow(/succeeded/i);
  });
});

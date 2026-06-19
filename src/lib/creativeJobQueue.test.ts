import { describe, expect, it } from "vitest";
import {
  canDeadLetterCreativeJob,
  canRequeueCreativeJob,
  getRecentActionableCreativeJobs,
  summarizeCreativeJobs,
  type CreativeJobQueueRow,
} from "./creativeJobQueue";

const baseJob: CreativeJobQueueRow = {
  id: "job-1",
  asset_id: "asset-1",
  status: "failed",
  attempt_count: 1,
  max_attempts: 3,
  last_error: null,
  created_at: "2026-06-18T10:00:00.000Z",
  updated_at: "2026-06-18T10:00:00.000Z",
  available_at: "2026-06-18T10:00:00.000Z",
  locked_at: null,
  locked_by: null,
  finished_at: null,
};

describe("creative job queue helpers", () => {
  it("summarizes known statuses including dead letter", () => {
    expect(
      summarizeCreativeJobs([
        { status: "queued" },
        { status: "running" },
        { status: "succeeded" },
        { status: "failed" },
        { status: "failed" },
        { status: "dead_letter" },
        { status: "unexpected" },
      ]),
    ).toEqual({
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 2,
      dead_letter: 1,
    });
  });

  it("returns recent actionable jobs without succeeded rows", () => {
    const rows: CreativeJobQueueRow[] = [
      { ...baseJob, id: "old-failed", status: "failed", updated_at: "2026-06-18T10:00:00.000Z" },
      { ...baseJob, id: "new-succeeded", status: "succeeded", updated_at: "2026-06-18T12:00:00.000Z" },
      { ...baseJob, id: "new-running", status: "running", updated_at: "2026-06-18T11:00:00.000Z" },
    ];

    expect(getRecentActionableCreativeJobs(rows).map((row) => row.id)).toEqual([
      "new-running",
      "old-failed",
    ]);
  });

  it("guards manual operations by status", () => {
    expect(canRequeueCreativeJob("failed")).toBe(true);
    expect(canRequeueCreativeJob("dead_letter")).toBe(true);
    expect(canRequeueCreativeJob("succeeded")).toBe(false);
    expect(canDeadLetterCreativeJob("running")).toBe(true);
    expect(canDeadLetterCreativeJob("dead_letter")).toBe(false);
    expect(canDeadLetterCreativeJob("succeeded")).toBe(false);
  });
});

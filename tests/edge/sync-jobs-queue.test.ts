import { describe, expect, it, vi } from "vitest";
import {
  enqueueSyncJobBatch,
  enqueueSyncJobBatchChunked,
  summarizeEnqueueCounts,
  type SyncJobBatchItem,
} from "../../supabase/functions/_shared/sync-jobs";

const item: SyncJobBatchItem = {
  job: {
    workspaceId: "workspace-1",
    projectId: "project-1",
    source: "meta",
    entityType: "meta_account",
    entityId: "act_1",
    dateStart: "2026-07-15",
    dateEnd: "2026-07-17",
    priority: 10,
    maxAttempts: 5,
    payload: { window: "recent" },
  },
  options: {
    requeueSucceededAfterMinutes: 15,
    reviveDeadLetter: false,
  },
};

describe("sync jobs queue adapter", () => {
  it("sends the whole batch through one atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          dedupe_key:
            "sync:meta:meta_account:project-1:act_1:2026-07-15:2026-07-17:v1",
          status: "inserted",
          job_id: "job-1",
        },
      ],
      error: null,
    });

    const result = await enqueueSyncJobBatch(
      { from: vi.fn(), rpc },
      [item],
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("enqueue_sync_jobs", {
      _jobs: [
        expect.objectContaining({
          workspace_id: "workspace-1",
          project_id: "project-1",
          requeue_succeeded_after_minutes: 15,
          dedupe_key:
            "sync:meta:meta_account:project-1:act_1:2026-07-15:2026-07-17:v1",
        }),
      ],
    });
    expect(result[0]).toMatchObject({
      status: "inserted",
      job_id: "job-1",
    });
  });

  it("surfaces RPC errors without falling back to non-atomic inserts", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(
      enqueueSyncJobBatch({ from: vi.fn(), rpc }, [item]),
    ).rejects.toThrow("database unavailable");
  });

  it("bounds atomic transactions by chunking large scheduler batches", async () => {
    const rpc = vi.fn().mockImplementation(
      async (_name: string, args: { _jobs: unknown[] }) => ({
        data: args._jobs.map((_, index) => ({
          dedupe_key: `job-${index}`,
          status: "inserted",
          job_id: `id-${index}`,
        })),
        error: null,
      }),
    );
    const items = Array.from({ length: 1_201 }, () => item);

    const results = await enqueueSyncJobBatchChunked(
      { from: vi.fn(), rpc },
      items,
      500,
    );

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[1]._jobs.length)).toEqual([
      500,
      500,
      201,
    ]);
    expect(summarizeEnqueueCounts(results)).toEqual({
      inserted: 1_201,
      updated: 0,
      skipped: 0,
      total: 1_201,
    });
  });

  it("rejects partial batch responses instead of silently losing jobs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });

    await expect(
      enqueueSyncJobBatchChunked({ from: vi.fn(), rpc }, [item]),
    ).rejects.toThrow("retornou 0 de 1 resultados");
  });
});

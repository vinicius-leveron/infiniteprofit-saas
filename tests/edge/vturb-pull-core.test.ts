import { describe, expect, it } from "vitest";
import {
  parseVturbBatchOptions,
  selectVturbPlayerBatch,
  VTURB_DEFAULT_PLAYER_BATCH_SIZE,
  VTURB_MAX_PLAYER_BATCH_SIZE,
} from "../../supabase/functions/vturb-pull/core";

describe("vturb pull batching", () => {
  it("uses a safe default batch size and explicit cursor flag", () => {
    expect(parseVturbBatchOptions({})).toEqual({
      batchCursor: 0,
      batchSize: VTURB_DEFAULT_PLAYER_BATCH_SIZE,
      hasExplicitCursor: false,
    });

    expect(parseVturbBatchOptions({ batch_cursor: 20, batch_size: 999 })).toEqual({
      batchCursor: 20,
      batchSize: VTURB_MAX_PLAYER_BATCH_SIZE,
      hasExplicitCursor: true,
    });
  });

  it("returns a bounded player slice with next cursor", () => {
    const batch = selectVturbPlayerBatch(["p1", "p2", "p3", "p4"], {
      batchCursor: 1,
      batchSize: 2,
    });

    expect(batch.players).toEqual(["p2", "p3"]);
    expect(batch.totalPlayers).toBe(4);
    expect(batch.playersProcessed).toBe(2);
    expect(batch.nextCursor).toBe(3);
    expect(batch.hasMore).toBe(true);
  });

  it("does not batch single-player syncs", () => {
    const batch = selectVturbPlayerBatch(["only-player"], {
      batchCursor: 10,
      batchSize: 2,
      targetPlayerId: "only-player",
    });

    expect(batch.players).toEqual(["only-player"]);
    expect(batch.nextCursor).toBeNull();
    expect(batch.hasMore).toBe(false);
  });
});

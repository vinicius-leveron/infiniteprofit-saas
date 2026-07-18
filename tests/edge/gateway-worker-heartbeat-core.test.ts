import { describe, expect, it } from "vitest";
import {
  normalizeGatewayWorkerHeartbeat,
} from "../../supabase/functions/gateway-worker-heartbeat/core";

describe("gateway worker heartbeat", () => {
  it("normalizes counters and keeps only operational metadata", () => {
    expect(
      normalizeGatewayWorkerHeartbeat({
        worker_id: "gateway-consumer-1",
        status: "healthy",
        processed_count: 12.8,
        failed_count: -1,
        last_error: "",
        metadata: {
          region: "us-east-1",
          batch_size: 5,
          secret: "must-not-persist",
        },
      }, new Date("2026-07-18T01:00:00Z")),
    ).toEqual({
      worker_id: "gateway-consumer-1",
      status: "healthy",
      last_seen_at: "2026-07-18T01:00:00.000Z",
      processed_count: 12,
      failed_count: 0,
      last_error: null,
      metadata: {
        region: "us-east-1",
        batch_size: 5,
      },
    });
  });

  it("rejects invalid worker identity and status", () => {
    expect(() =>
      normalizeGatewayWorkerHeartbeat({ worker_id: "", status: "healthy" })
    ).toThrow(/worker_id/);
    expect(() =>
      normalizeGatewayWorkerHeartbeat({
        worker_id: "worker",
        status: "unknown",
      })
    ).toThrow(/Unsupported/);
  });
});

import { describe, expect, it } from "vitest";
import {
  GATEWAY_QUEUE_MAX_BODY_BYTES,
  buildGatewayQueueEnvelope,
  parseGatewayQueueEnvelope,
  queueConsumerHeaders,
} from "../../supabase/functions/gateway-queue/core";

describe("gateway durable queue envelope", () => {
  it("captures only signature headers and produces a stable idempotency id", async () => {
    const headers = new Headers({
      "x-hubla-token": "gateway-secret",
      authorization: "must-not-be-forwarded",
      cookie: "must-not-be-forwarded",
    });
    const args = {
      provider: "hubla" as const,
      webhookToken: "webhook-token",
      headers,
      rawBody: JSON.stringify({ event: "invoice.paid", id: "sale-1" }),
      traceId: "trace-1",
      receivedAt: new Date("2026-07-17T20:00:00Z"),
    };

    const first = await buildGatewayQueueEnvelope(args);
    const second = await buildGatewayQueueEnvelope(args);

    expect(first.envelope_id).toBe(second.envelope_id);
    expect(first.signature_headers).toEqual({
      "x-hubla-token": "gateway-secret",
    });
    expect(first.signature_headers).not.toHaveProperty("authorization");
    expect(first.signature_headers).not.toHaveProperty("cookie");
  });

  it("round-trips a valid versioned envelope into consumer headers", async () => {
    const envelope = await buildGatewayQueueEnvelope({
      provider: "hotmart",
      webhookToken: "token-1",
      headers: new Headers({ "x-hotmart-hottok": "signature-1" }),
      rawBody: JSON.stringify({ event: "PURCHASE_APPROVED" }),
      traceId: "trace-1",
    });

    const parsed = parseGatewayQueueEnvelope(
      JSON.parse(JSON.stringify(envelope)),
    );

    expect(parsed).toEqual(envelope);
    expect(queueConsumerHeaders(parsed, "automation-key")).toMatchObject({
      apikey: "automation-key",
      "x-infiniteprofit-queue-consumer": "1",
      "x-request-id": "trace-1",
      "x-hotmart-hottok": "signature-1",
    });
  });

  it("rejects invalid JSON, unsupported versions, and oversized bodies", async () => {
    await expect(
      buildGatewayQueueEnvelope({
        provider: "kiwify",
        webhookToken: "token",
        headers: new Headers(),
        rawBody: "not-json",
      }),
    ).rejects.toThrow("valid JSON");

    expect(() =>
      parseGatewayQueueEnvelope({
        schema_version: 99,
      }),
    ).toThrow("Unsupported gateway queue schema version");

    await expect(
      buildGatewayQueueEnvelope({
        provider: "kiwify",
        webhookToken: "token",
        headers: new Headers(),
        rawBody: JSON.stringify({
          value: "x".repeat(GATEWAY_QUEUE_MAX_BODY_BYTES),
        }),
      }),
    ).rejects.toThrow("exceeds");
  });
});

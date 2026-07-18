import { describe, expect, it } from "vitest";
import {
  buildDeliveryRequest,
  parseQueueEnvelope,
  retryVisibilitySeconds,
  safeEnvelopeLog,
} from "../../workers/gateway-queue-consumer/core.mjs";

const envelope = {
  schema_version: 1,
  envelope_id: "envelope-1",
  trace_id: "trace-1",
  provider: "hubla",
  webhook_token: "private-token",
  signature_headers: {
    "x-hubla-token": "signature",
    authorization: "discard-me",
  },
  raw_body: JSON.stringify({ event: "invoice.paid" }),
  received_at: "2026-07-17T20:00:00Z",
};

describe("gateway queue consumer core", () => {
  it("validates the envelope and never forwards arbitrary headers", () => {
    const parsed = parseQueueEnvelope(JSON.stringify(envelope));
    expect(parsed.signature_headers).toEqual({
      "x-hubla-token": "signature",
    });

    const request = buildDeliveryRequest({
      supabaseUrl: "https://project.supabase.co/",
      automationKey: "automation-key",
      envelope: parsed,
    });
    expect(request.url).toBe(
      "https://project.supabase.co/functions/v1/webhook-gateway/hubla/private-token",
    );
    expect(request.init.headers).toMatchObject({
      apikey: "automation-key",
      "x-infiniteprofit-queue-consumer": "1",
      "x-request-id": "trace-1",
      "x-hubla-token": "signature",
    });
    expect(request.init.headers).not.toHaveProperty("authorization");
  });

  it("backs off retries and caps visibility at fifteen minutes", () => {
    expect(retryVisibilitySeconds(1)).toBeGreaterThanOrEqual(15);
    expect(retryVisibilitySeconds(5)).toBeGreaterThan(
      retryVisibilitySeconds(1),
    );
    expect(retryVisibilitySeconds(100)).toBeLessThanOrEqual(900);
  });

  it("never puts the webhook token or raw body in structured logs", () => {
    const parsed = parseQueueEnvelope(envelope);
    const safe = safeEnvelopeLog(parsed);
    expect(safe).not.toHaveProperty("webhook_token");
    expect(safe).not.toHaveProperty("raw_body");
    expect(safe).toMatchObject({
      envelope_id: "envelope-1",
      trace_id: "trace-1",
      provider: "hubla",
    });
  });
});

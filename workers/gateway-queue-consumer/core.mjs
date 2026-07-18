import crypto from "node:crypto";

const SUPPORTED_PROVIDERS = new Set(["hotmart", "hubla", "kiwify"]);
const SIGNATURE_HEADERS = new Set([
  "x-hotmart-hottok",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-hubla-token",
  "x-hubla-sandbox",
  "x-hubla-idempotency",
  "x-kiwify-signature",
  "x-signature",
]);

export function parseQueueEnvelope(messageBody) {
  const parsed =
    typeof messageBody === "string" ? JSON.parse(messageBody) : messageBody;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gateway queue envelope must be an object");
  }
  if (parsed.schema_version !== 1) {
    throw new Error("Unsupported gateway queue schema version");
  }

  const provider = required(parsed.provider, "provider");
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error("Unsupported gateway provider");
  }

  const rawBody = required(parsed.raw_body, "raw body");
  JSON.parse(rawBody);

  return {
    schema_version: 1,
    envelope_id: required(parsed.envelope_id, "envelope id"),
    trace_id: required(parsed.trace_id, "trace id"),
    provider,
    webhook_token: required(parsed.webhook_token, "webhook token"),
    signature_headers: signatureHeaders(parsed.signature_headers),
    raw_body: rawBody,
    received_at: validIso(parsed.received_at),
  };
}

export function buildDeliveryRequest({
  supabaseUrl,
  automationKey,
  envelope,
}) {
  const baseUrl = required(supabaseUrl, "Supabase URL").replace(/\/$/, "");
  return {
    url:
      `${baseUrl}/functions/v1/webhook-gateway/` +
      `${encodeURIComponent(envelope.provider)}/` +
      `${encodeURIComponent(envelope.webhook_token)}`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: required(automationKey, "automation key"),
        "x-infiniteprofit-queue-consumer": "1",
        "x-request-id": envelope.trace_id,
        ...envelope.signature_headers,
      },
      body: envelope.raw_body,
    },
  };
}

export function retryVisibilitySeconds(receiveCount) {
  const attempt = Math.max(1, Number(receiveCount) || 1);
  const base = Math.min(15 * 60, 15 * 2 ** Math.min(attempt - 1, 6));
  const jitter = deterministicJitter(attempt, Math.max(1, base * 0.15));
  return Math.max(15, Math.min(15 * 60, Math.round(base + jitter)));
}

export function safeEnvelopeLog(envelope) {
  return {
    envelope_id: envelope.envelope_id,
    trace_id: envelope.trace_id,
    provider: envelope.provider,
    received_at: envelope.received_at,
  };
}

function signatureHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const selected = {};
  for (const [name, raw] of Object.entries(value)) {
    const lower = name.toLowerCase();
    const normalized = String(raw ?? "").trim();
    if (SIGNATURE_HEADERS.has(lower) && normalized) {
      selected[lower] = normalized;
    }
  }
  return selected;
}

function validIso(value) {
  const normalized = required(value, "received at");
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error("Invalid received_at");
  return new Date(parsed).toISOString();
}

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing ${label}`);
  return normalized;
}

function deterministicJitter(seed, spread) {
  const digest = crypto
    .createHash("sha256")
    .update(String(seed))
    .digest()
    .readUInt32BE(0);
  return (digest / 0xffffffff) * spread * 2 - spread;
}

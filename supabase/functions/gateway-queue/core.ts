export const GATEWAY_QUEUE_SCHEMA_VERSION = 1;
export const GATEWAY_QUEUE_MAX_BODY_BYTES = 240 * 1024;

export type GatewayProvider = "hotmart" | "hubla" | "kiwify";

export type GatewayQueueEnvelope = {
  schema_version: typeof GATEWAY_QUEUE_SCHEMA_VERSION;
  envelope_id: string;
  trace_id: string;
  provider: GatewayProvider;
  webhook_token: string;
  signature_headers: Record<string, string>;
  raw_body: string;
  received_at: string;
};

const SIGNATURE_HEADERS = [
  "x-hotmart-hottok",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-hubla-token",
  "x-hubla-sandbox",
  "x-hubla-idempotency",
  "x-kiwify-signature",
  "x-signature",
] as const;

export async function buildGatewayQueueEnvelope(args: {
  provider: GatewayProvider;
  webhookToken: string;
  headers: Headers;
  rawBody: string;
  traceId?: string;
  receivedAt?: Date;
}): Promise<GatewayQueueEnvelope> {
  assertValidJsonBody(args.rawBody);
  assertBodySize(args.rawBody);

  const traceId = nonEmpty(args.traceId) ?? crypto.randomUUID();
  const receivedAt = args.receivedAt ?? new Date();
  const bodyFingerprint = await sha256Hex(
    `${args.provider}:${args.webhookToken}:${args.rawBody}`,
  );

  return {
    schema_version: GATEWAY_QUEUE_SCHEMA_VERSION,
    envelope_id: bodyFingerprint,
    trace_id: traceId,
    provider: args.provider,
    webhook_token: required(args.webhookToken, "webhook token"),
    signature_headers: pickSignatureHeaders(args.headers),
    raw_body: args.rawBody,
    received_at: receivedAt.toISOString(),
  };
}

export function parseGatewayQueueEnvelope(
  value: unknown,
): GatewayQueueEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gateway queue envelope must be an object");
  }

  const row = value as Record<string, unknown>;
  if (row.schema_version !== GATEWAY_QUEUE_SCHEMA_VERSION) {
    throw new Error("Unsupported gateway queue schema version");
  }

  const provider = String(row.provider ?? "");
  if (!isGatewayProvider(provider)) {
    throw new Error("Unsupported gateway provider");
  }

  const rawBody = required(row.raw_body, "raw body");
  assertValidJsonBody(rawBody);
  assertBodySize(rawBody);

  const signatureHeaders = normalizeSignatureHeaders(row.signature_headers);

  return {
    schema_version: GATEWAY_QUEUE_SCHEMA_VERSION,
    envelope_id: required(row.envelope_id, "envelope id"),
    trace_id: required(row.trace_id, "trace id"),
    provider,
    webhook_token: required(row.webhook_token, "webhook token"),
    signature_headers: signatureHeaders,
    raw_body: rawBody,
    received_at: validIsoTimestamp(row.received_at),
  };
}

export function queueConsumerHeaders(
  envelope: GatewayQueueEnvelope,
  automationKey: string,
) {
  return {
    "Content-Type": "application/json",
    apikey: required(automationKey, "automation key"),
    "x-infiniteprofit-queue-consumer": "1",
    "x-request-id": envelope.trace_id,
    ...envelope.signature_headers,
  };
}

export function isGatewayProvider(value: string): value is GatewayProvider {
  return value === "hotmart" || value === "hubla" || value === "kiwify";
}

function pickSignatureHeaders(headers: Headers) {
  const selected: Record<string, string> = {};
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value) selected[name] = value;
  }
  return selected;
}

function normalizeSignatureHeaders(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const selected: Record<string, string> = {};
  for (const name of SIGNATURE_HEADERS) {
    const headerValue = nonEmpty(input[name]);
    if (headerValue) selected[name] = headerValue;
  }
  return selected;
}

function assertValidJsonBody(rawBody: string) {
  try {
    JSON.parse(rawBody);
  } catch {
    throw new Error("Gateway webhook body must be valid JSON");
  }
}

function assertBodySize(rawBody: string) {
  const bodyBytes = new TextEncoder().encode(rawBody).byteLength;
  if (bodyBytes > GATEWAY_QUEUE_MAX_BODY_BYTES) {
    throw new Error(
      `Gateway webhook body exceeds ${GATEWAY_QUEUE_MAX_BODY_BYTES} bytes`,
    );
  }
}

function validIsoTimestamp(value: unknown) {
  const timestamp = required(value, "received at");
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error("Gateway queue received_at is invalid");
  }
  return new Date(parsed).toISOString();
}

function required(value: unknown, label: string) {
  const normalized = nonEmpty(value);
  if (!normalized) throw new Error(`Missing ${label}`);
  return normalized;
}

function nonEmpty(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

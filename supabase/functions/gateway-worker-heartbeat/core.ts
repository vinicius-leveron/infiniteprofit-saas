export type GatewayWorkerHeartbeatStatus =
  | "starting"
  | "healthy"
  | "error"
  | "stopping";

export type GatewayWorkerHeartbeat = {
  worker_id: string;
  status: GatewayWorkerHeartbeatStatus;
  last_seen_at: string;
  processed_count: number;
  failed_count: number;
  last_error: string | null;
  metadata: Record<string, string | number | boolean | null>;
};

const statuses = new Set<GatewayWorkerHeartbeatStatus>([
  "starting",
  "healthy",
  "error",
  "stopping",
]);

export function normalizeGatewayWorkerHeartbeat(
  value: unknown,
  now = new Date(),
): GatewayWorkerHeartbeat {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Heartbeat payload must be an object.");
  }
  const input = value as Record<string, unknown>;
  const workerId = String(input.worker_id ?? "").trim();
  if (!workerId || workerId.length > 120) {
    throw new Error("worker_id must contain 1-120 characters.");
  }
  const status = String(input.status ?? "") as GatewayWorkerHeartbeatStatus;
  if (!statuses.has(status)) {
    throw new Error("Unsupported gateway worker status.");
  }

  return {
    worker_id: workerId,
    status,
    last_seen_at: now.toISOString(),
    processed_count: nonNegativeInteger(input.processed_count),
    failed_count: nonNegativeInteger(input.failed_count),
    last_error: nullableText(input.last_error, 1_000),
    metadata: safeMetadata(input.metadata),
  };
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function nullableText(value: unknown, maximumLength: number) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function safeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowedKeys = [
    "region",
    "batch_size",
    "wait_time_seconds",
    "delivery_timeout_ms",
  ];
  return Object.fromEntries(
    allowedKeys.flatMap((key) => {
      const entry = input[key];
      return typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean" ||
          entry === null
        ? [[key, entry]]
        : [];
    }),
  );
}

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  buildDeliveryRequest,
  parseQueueEnvelope,
  retryVisibilitySeconds,
  safeEnvelopeLog,
} from "./core.mjs";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const AUTOMATION_KEY = requiredEnv("AUTOMATION_KEY");
const GATEWAY_QUEUE_URL = requiredEnv("GATEWAY_QUEUE_URL");
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const WAIT_TIME_SECONDS = boundedInteger(
  process.env.GATEWAY_QUEUE_WAIT_TIME_SECONDS,
  20,
  1,
  20,
);
const BATCH_SIZE = boundedInteger(
  process.env.GATEWAY_QUEUE_BATCH_SIZE,
  5,
  1,
  10,
);
const DELIVERY_TIMEOUT_MS = boundedInteger(
  process.env.GATEWAY_QUEUE_DELIVERY_TIMEOUT_MS,
  25_000,
  1_000,
  60_000,
);
const HEARTBEAT_INTERVAL_MS = boundedInteger(
  process.env.GATEWAY_QUEUE_HEARTBEAT_INTERVAL_MS,
  60_000,
  15_000,
  90_000,
);
const WORKER_ID =
  process.env.GATEWAY_QUEUE_WORKER_ID ||
  process.env.RENDER_SERVICE_NAME ||
  `gateway-consumer-${process.pid}`;

const sqs = new SQSClient({ region: AWS_REGION });
let stopping = false;
let processed = 0;
let failed = 0;
let lastHeartbeatAt = 0;

process.on("SIGTERM", () => {
  stopping = true;
  console.log(JSON.stringify({
    event: "gateway_queue_worker_stopping",
    worker_id: WORKER_ID,
    processed,
    failed,
  }));
});

main().catch((error) => {
  console.error(JSON.stringify({
    event: "gateway_queue_worker_fatal",
    worker_id: WORKER_ID,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});

async function main() {
  console.log(JSON.stringify({
    event: "gateway_queue_worker_started",
    worker_id: WORKER_ID,
    region: AWS_REGION,
    batch_size: BATCH_SIZE,
  }));

  await reportHeartbeat("starting", null, true);
  try {
    while (!stopping) {
      try {
        await reportHeartbeat("healthy");
        const response = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: GATEWAY_QUEUE_URL,
            MaxNumberOfMessages: BATCH_SIZE,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            AttributeNames: ["ApproximateReceiveCount", "SentTimestamp"],
            MessageAttributeNames: ["All"],
          }),
        );

        for (const message of response.Messages ?? []) {
          if (stopping) break;
          await processMessage(message);
          await reportHeartbeat("healthy");
        }
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({
          event: "gateway_queue_receive_failed",
          worker_id: WORKER_ID,
          error: message,
        }));
        await reportHeartbeat("error", message, true);
        await sleep(5_000);
      }
    }
  } finally {
    await reportHeartbeat("stopping", null, true);
  }
}

async function processMessage(message) {
  const receiveCount = Number(
    message.Attributes?.ApproximateReceiveCount ?? "1",
  );
  let envelope;

  try {
    envelope = parseQueueEnvelope(message.Body);
    const delivery = buildDeliveryRequest({
      supabaseUrl: SUPABASE_URL,
      automationKey: AUTOMATION_KEY,
      envelope,
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DELIVERY_TIMEOUT_MS,
    );

    let response;
    try {
      response = await fetch(delivery.url, {
        ...delivery.init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(
        String(payload?.error ?? `Gateway delivery HTTP ${response.status}`),
      );
    }

    await deleteMessage(message);
    processed += 1;
    console.log(JSON.stringify({
      event: "gateway_queue_message_processed",
      worker_id: WORKER_ID,
      ...safeEnvelopeLog(envelope),
      receive_count: receiveCount,
      processed,
      failed,
    }));
  } catch (error) {
    failed += 1;
    const visibilityTimeout = retryVisibilitySeconds(receiveCount);
    await postponeMessage(message, visibilityTimeout).catch(
      (visibilityError) => {
        console.error(JSON.stringify({
          event: "gateway_queue_visibility_failed",
          worker_id: WORKER_ID,
          message_id: message.MessageId ?? null,
          error:
            visibilityError instanceof Error
              ? visibilityError.message
              : String(visibilityError),
        }));
      },
    );
    console.error(JSON.stringify({
      event: "gateway_queue_message_failed",
      worker_id: WORKER_ID,
      ...(envelope
        ? safeEnvelopeLog(envelope)
        : { message_id: message.MessageId ?? null }),
      receive_count: receiveCount,
      retry_in_seconds: visibilityTimeout,
      error: error instanceof Error ? error.message : String(error),
      processed,
      failed,
    }));
  }
}

async function deleteMessage(message) {
  if (!message.ReceiptHandle) {
    throw new Error("SQS message has no receipt handle");
  }
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: GATEWAY_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
    }),
  );
}

async function postponeMessage(message, visibilityTimeout) {
  if (!message.ReceiptHandle) return;
  await sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: GATEWAY_QUEUE_URL,
      ReceiptHandle: message.ReceiptHandle,
      VisibilityTimeout: visibilityTimeout,
    }),
  );
}

async function reportHeartbeat(status, lastError = null, force = false) {
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeatAt = now;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/gateway-worker-heartbeat`,
      {
        method: "POST",
        headers: {
          apikey: AUTOMATION_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          worker_id: WORKER_ID,
          status,
          processed_count: processed,
          failed_count: failed,
          last_error: lastError,
          metadata: {
            region: AWS_REGION,
            batch_size: BATCH_SIZE,
            wait_time_seconds: WAIT_TIME_SECONDS,
            delivery_timeout_ms: DELIVERY_TIMEOUT_MS,
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      console.warn(JSON.stringify({
        event: "gateway_queue_heartbeat_failed",
        worker_id: WORKER_ID,
        status: response.status,
      }));
    }
  } catch (error) {
    console.warn(JSON.stringify({
      event: "gateway_queue_heartbeat_failed",
      worker_id: WORKER_ID,
      error: error instanceof Error ? error.name : "request_failed",
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

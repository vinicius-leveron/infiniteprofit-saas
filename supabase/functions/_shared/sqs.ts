import {
  SQSClient,
  SendMessageCommand,
} from "npm:@aws-sdk/client-sqs@3.854.0";
import type { GatewayQueueEnvelope } from "../gateway-queue/core.ts";

let client: SQSClient | null = null;

export function gatewayQueueUrl() {
  return Deno.env.get("GATEWAY_QUEUE_URL")?.trim() || null;
}

export async function sendGatewayQueueEnvelope(
  queueUrl: string,
  envelope: GatewayQueueEnvelope,
) {
  const sqs = client ??= new SQSClient({
    region: Deno.env.get("AWS_REGION")?.trim() || "us-east-1",
  });

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(envelope),
      MessageAttributes: {
        provider: {
          DataType: "String",
          StringValue: envelope.provider,
        },
        schema_version: {
          DataType: "Number",
          StringValue: String(envelope.schema_version),
        },
        trace_id: {
          DataType: "String",
          StringValue: envelope.trace_id,
        },
      },
    }),
  );

  if (!result.MessageId) {
    throw new Error("SQS did not return a message id");
  }

  return {
    messageId: result.MessageId,
    sequenceNumber: result.SequenceNumber ?? null,
  };
}

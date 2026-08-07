/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import {
  gatewayQueueUrl,
  sendGatewayQueueEnvelope,
} from "../_shared/sqs.ts";
import { enqueueSyncJob } from "../_shared/sync-jobs.ts";
import {
  buildGatewayQueueEnvelope,
  isGatewayProvider,
} from "../gateway-queue/core.ts";
import { buildAggregateJobInput } from "../sync-jobs/core.ts";
import { normalizeEvent, validateHotmartHottok } from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, x-infiniteprofit-queue-consumer, x-hotmart-hottok, x-hub-signature, x-hub-signature-256, x-hubla-token, x-hubla-sandbox, x-hubla-idempotency, x-kiwify-signature, x-signature",
};

const HUBLA_RULESET_VERSION = "hubla-subtotal-without-installment-fee-v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const { provider, token } = parsePath(req.url);
    if (!provider || !token) {
      return json({ error: "use /webhook-gateway/:provider/:token" }, 400);
    }

    if (req.method === "GET") {
      return json({ ok: true, message: `gateway webhook ready (${provider})`, ruleset: HUBLA_RULESET_VERSION });
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    const isQueueConsumer =
      req.headers.get("x-infiniteprofit-queue-consumer") === "1";
    if (isQueueConsumer && !isAutomationRequest(req)) {
      return json({ error: "unauthorized queue consumer" }, 401);
    }

    const queueUrl = gatewayQueueUrl();
    if (queueUrl && !isQueueConsumer) {
      const rawBody = await req.text();
      let envelope;
      try {
        envelope = await buildGatewayQueueEnvelope({
          provider,
          webhookToken: token,
          headers: req.headers,
          rawBody,
          traceId,
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "invalid gateway webhook",
          },
          400,
          traceId,
        );
      }

      try {
        const queued = await sendGatewayQueueEnvelope(queueUrl, envelope);
        console.log(JSON.stringify({
          event: "gateway_webhook_queued",
          trace_id: traceId,
          envelope_id: envelope.envelope_id,
          provider,
          sqs_message_id: queued.messageId,
          duration_ms: Date.now() - startedAt,
        }));
        return json(
          {
            ok: true,
            accepted: true,
            trace_id: traceId,
            envelope_id: envelope.envelope_id,
          },
          202,
          traceId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "queue unavailable";
        console.error(JSON.stringify({
          event: "gateway_webhook_queue_failed",
          trace_id: traceId,
          envelope_id: envelope.envelope_id,
          provider,
          error: message,
        }));
        return json(
          {
            error: "temporary queue failure",
            retryable: true,
            trace_id: traceId,
          },
          503,
          traceId,
        );
      }
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    let { data: binding, error: bindingError } = await sb
      .from("project_checkout_bindings")
      .select("project_id, webhook_token, enabled, checkout_integration_id")
      .eq("webhook_token", token)
      .maybeSingle();

    // A database timeout used to be returned as a 404 here. Hubla treats a
    // 404 as a permanent rejection and does not retry the sale, which can
    // make a transient Supabase incident look like missing revenue. Retry a
    // lookup once and explicitly ask the provider to retry on query errors.
    if (bindingError) {
      console.error("webhook-gateway binding lookup failed", safeLookupError(bindingError, provider));
      await wait(250);
      ({ data: binding, error: bindingError } = await sb
        .from("project_checkout_bindings")
        .select("project_id, webhook_token, enabled, checkout_integration_id")
        .eq("webhook_token", token)
        .maybeSingle());
    }
    if (bindingError) {
      console.error("webhook-gateway binding lookup retry failed", safeLookupError(bindingError, provider));
      return json({ error: "temporary binding lookup failure", retryable: true }, 503);
    }
    if (!binding?.project_id) {
      return json({ error: "binding not found" }, 404);
    }
    if (!binding.enabled) {
      return json({ error: "binding disabled" }, 410);
    }

    let { data: project, error: projectError } = await sb
      .from("projects")
      .select("id, user_id, workspace_id")
      .eq("id", binding.project_id)
      .maybeSingle();

    if (projectError) {
      console.error("webhook-gateway project lookup failed", safeLookupError(projectError, provider));
      await wait(250);
      ({ data: project, error: projectError } = await sb
        .from("projects")
        .select("id, user_id, workspace_id")
        .eq("id", binding.project_id)
        .maybeSingle());
    }
    if (projectError) {
      console.error("webhook-gateway project lookup retry failed", safeLookupError(projectError, provider));
      return json({ error: "temporary project lookup failure", retryable: true }, 503);
    }
    if (!project?.workspace_id) {
      return json({ error: "project not found" }, 404);
    }

    const integrationLookup = await loadCheckoutIntegration(sb, {
      integrationId: binding.checkout_integration_id,
      workspaceId: project.workspace_id,
    });
    if (integrationLookup.error) {
      console.error(
        "webhook-gateway integration lookup failed",
        safeLookupError(integrationLookup.error, provider),
      );
      return json({ error: "temporary integration lookup failure", retryable: true }, 503);
    }
    if (!integrationLookup.integration) {
      return json({ error: "checkout integration not found" }, 404);
    }
    if (!integrationLookup.secret) {
      return json({ error: "gateway secret not configured" }, 401);
    }
    if (
      integrationLookup.integration.provider
      && integrationLookup.integration.provider !== provider
    ) {
      return json({
        error:
          `checkout configured for ${integrationLookup.integration.provider}, not ${provider}`,
      }, 400);
    }

    const rawBody = await req.text();
    const valid = await validateSignature(
      provider,
      req.headers,
      rawBody,
      integrationLookup.secret,
    );
    if (!valid) {
      return json({ error: "invalid signature" }, 401);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const hotmartContext = provider === "hotmart"
      ? await loadHotmartNormalizationContext(
        sb,
        project.id,
        Boolean(binding.checkout_integration_id),
      )
      : undefined;
    const events = normalizeEvent(provider, payload, hotmartContext);
    if (events.length === 0) {
      console.warn("webhook-gateway ignored event", {
        provider,
        event_type: hublaDiagnosticValue(provider, payload, "event_type"),
        status: hublaDiagnosticValue(provider, payload, "status"),
      });
      return json({ ok: true, ignored: true });
    }

    const runId = await createSyncRun(sb, project.workspace_id, project.id);
    const datesTouched = new Set<string>();
    const hotmartEnrichmentDates = new Set<string>();
    let inserted = 0;

    try {
      for (const event of events) {
        const { error } = await sb.from("raw_events").upsert(
          {
            project_id: project.id,
            workspace_id: project.workspace_id,
            user_id: project.user_id,
            source: "gateway",
            event_type: event.event_type,
            event_date: event.event_date,
            event_occurred_at: event.event_occurred_at,
            external_id: event.external_id,
            payload: event.payload,
          },
          { onConflict: "project_id,source,event_type,external_id" },
        );

        if (error) {
          throw new Error(error.message);
        }

        inserted++;
        datesTouched.add(event.event_date);
        if (event.event_type === "purchase.approved" || event.event_type === "purchase.refused") {
          try {
            await persistPaymentAttemptShadow(sb, {
              projectId: project.id,
              workspaceId: project.workspace_id,
              provider,
              event,
            });
          } catch (shadowError) {
            console.error(JSON.stringify({
              event: "payment_attempt_shadow_failed",
              trace_id: traceId,
              project_id: project.id,
              provider,
              error: shadowError instanceof Error ? shadowError.message : "shadow write failed",
            }));
          }
        }
        if (
          provider === "hotmart"
          && binding.checkout_integration_id
          && (
            event.payload?.financial_metrics_ready === false
            || event.payload?.financial_exclusion_reason
              === "financial_enrichment_required"
          )
        ) {
          hotmartEnrichmentDates.add(event.event_date);
        }

        if (event.event_type === "purchase.approved" && Array.isArray(event.payload.items)) {
          for (const item of event.payload.items) {
            if (!item?.is_bump) continue;
            const externalId = String(item.external_id ?? item.name ?? "");
            if (!externalId) continue;

            await sb.from("bump_catalog").upsert(
              {
                project_id: project.id,
                workspace_id: project.workspace_id,
                user_id: project.user_id,
                external_id: externalId,
                name: String(item.name ?? externalId),
                kind: item.type ?? "orderbump",
                price: typeof item.price === "number" ? item.price : null,
              },
              { onConflict: "project_id,external_id" },
            );
          }
        }
      }

      const syncedAt = new Date().toISOString();
      await sb
        .from("workspace_integrations")
        .update({ gateway_last_event_at: syncedAt })
        .eq("workspace_id", project.workspace_id);

      if (binding.checkout_integration_id) {
        await sb
          .from("workspace_checkout_integrations")
          .update({
            last_event_at: syncedAt,
            status: "connected",
            last_error_code: null,
            last_error_message: null,
          })
          .eq("id", binding.checkout_integration_id);
      }

      await sb
        .from("projects")
        .update({ last_synced_at: syncedAt })
        .eq("id", project.id);

      for (const date of hotmartEnrichmentDates) {
        try {
          await enqueueSyncJob(sb, {
            workspaceId: project.workspace_id,
            projectId: project.id,
            source: "gateway",
            entityType: "hotmart_sales_backfill",
            entityId: binding.checkout_integration_id,
            dateStart: date,
            dateEnd: date,
            priority: 0,
            maxAttempts: 8,
            payload: {
              integration_id: binding.checkout_integration_id,
              reason: "financial_enrichment_required",
            },
          }, {
            requeueSucceededAfterMinutes: 0,
            reviveDeadLetter: true,
          });
        } catch (enrichmentError) {
          console.error(JSON.stringify({
            event: "hotmart_enrichment_enqueue_failed",
            trace_id: traceId,
            project_id: project.id,
            event_date: date,
            error:
              enrichmentError instanceof Error
                ? enrichmentError.message
                : "Falha ao enfileirar enriquecimento Hotmart",
          }));
        }
      }

      if (datesTouched.size > 0) {
        const aggregateJob = buildAggregateJobInput({
          workspaceId: project.workspace_id,
          projectId: project.id,
          dates: datesTouched,
          priority: 1,
        });
        if (aggregateJob) {
          try {
            await enqueueSyncJob(sb, aggregateJob, {
              requeueSucceededAfterMinutes: 0,
              reviveDeadLetter: true,
            });
          } catch (enqueueError) {
            // raw_events are already durable and idempotent at this point.
            // The watchdog will detect the missing aggregate date later, so
            // an enqueue failure must not make the provider resend the sale.
            console.error(JSON.stringify({
              event: "gateway_aggregate_enqueue_failed",
              trace_id: traceId,
              project_id: project.id,
              error:
                enqueueError instanceof Error
                  ? enqueueError.message
                  : "Falha ao enfileirar agregação",
            }));
          }
        }
      }

      await finishSyncRun(sb, runId, {
        status: "succeeded",
        details: {
          provider,
          inserted,
          dates: [...datesTouched],
          event_types: events.map((event) => event.event_type),
          trace_id: traceId,
        },
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao processar webhook";
      await finishSyncRun(sb, runId, {
        status: "failed",
        details: { provider, inserted, dates: [...datesTouched] },
        errorMessage: message,
      });
      throw error;
    }

    console.log(JSON.stringify({
      event: "gateway_webhook_ingested",
      trace_id: traceId,
      provider,
      project_id: project.id,
      inserted,
      duration_ms: Date.now() - startedAt,
    }));
    return json({ ok: true, inserted, trace_id: traceId }, 200, traceId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado";
    console.error(JSON.stringify({
      event: "gateway_webhook_failed",
      trace_id: traceId,
      error: message,
    }));
    return json({ error: message, trace_id: traceId }, 500, traceId);
  }
});

async function createSyncRun(
  sb: SupabaseClientAny,
  workspaceId: string,
  projectId: string,
) {
  const { data } = await sb
    .from("sync_runs")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      source: "gateway",
      status: "running",
      started_at: new Date().toISOString(),
      details: { mode: "webhook" },
    })
    .select("id")
    .maybeSingle();

  return data?.id as string | undefined;
}

async function finishSyncRun(
  sb: SupabaseClientAny,
  runId: string | undefined,
  args: {
    status: "succeeded" | "failed";
    details: Record<string, unknown>;
    errorMessage: string | null;
  },
) {
  if (!runId) return;

  await sb
    .from("sync_runs")
    .update({
      status: args.status,
      finished_at: new Date().toISOString(),
      details: args.details,
      error_message: args.errorMessage,
    })
    .eq("id", runId);
}

function parsePath(rawUrl: string) {
  const segments = new URL(rawUrl).pathname.split("/").filter(Boolean);
  const baseIndex = segments.lastIndexOf("webhook-gateway");
  const provider = segments[baseIndex + 1]?.toLowerCase() ?? null;
  const token = segments[baseIndex + 2] ?? null;
  return {
    provider: provider && isGatewayProvider(provider) ? provider : null,
    token,
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeLookupError(error: unknown, provider: string) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return {
    provider,
    code: typeof record.code === "string" ? record.code : null,
    message: typeof record.message === "string" ? record.message : "query failed",
  };
}

function hublaDiagnosticValue(provider: string, payload: unknown, field: "event_type" | "status") {
  if (provider !== "hubla") return null;
  const root = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, any> : {};
  const event = root.event && typeof root.event === "object" ? root.event as Record<string, any> : {};
  const invoice = [data.object, data.invoice, event.invoice, event.object, root.invoice, root.object]
    .find((value) => value && typeof value === "object" && !Array.isArray(value)) as Record<string, any> | undefined;
  const values = field === "event_type"
    ? [root.type, root.event_type, root.webhook_event_type, data.type, event.type, invoice?.event]
    : [invoice?.status, invoice?.payment_status, invoice?.invoice_status, event.status, root.status];
  return values.find((value) => typeof value === "string" && value.trim()) ?? null;
}

async function loadCheckoutIntegration(
  sb: SupabaseClientAny,
  args: { integrationId?: string | null; workspaceId: string },
): Promise<{
  integration: { id: string | null; provider: string | null } | null;
  secret: string | null;
  error: any;
}> {
  if (args.integrationId) {
    const { data: integration, error } = await sb
      .from("workspace_checkout_integrations")
      .select("id, workspace_id, provider, status")
      .eq("id", args.integrationId)
      .eq("workspace_id", args.workspaceId)
      .eq("status", "connected")
      .maybeSingle();
    if (error) return { integration: null, secret: null, error };
    if (!integration) return { integration: null, secret: null, error: null };

    const { data: secret, error: secretError } = await sb.rpc(
      "read_checkout_integration_secret",
      {
        _integration_id: integration.id,
        _kind: "webhook",
      },
    );
    return {
      integration: {
        id: integration.id,
        provider: String(integration.provider),
      },
      secret: typeof secret === "string" ? secret : null,
      error: secretError,
    };
  }

  // Dual-read fallback for bindings created before the expanded checkout
  // catalog migration.
  const { data: integration, error } = await sb
    .from("workspace_integrations")
    .select("workspace_id, gateway_provider, gateway_webhook_secret")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  return {
    integration: integration
      ? {
        id: null,
        provider: integration.gateway_provider
          ? String(integration.gateway_provider)
          : null,
      }
      : null,
    secret: integration?.gateway_webhook_secret ?? null,
    error,
  };
}

async function loadHotmartNormalizationContext(
  sb: SupabaseClientAny,
  projectId: string,
  requireProductBinding: boolean,
) {
  const { data: bindings, error } = await sb
    .from("project_checkout_products")
    .select("checkout_product_id, checkout_offer_id, role")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  const productIds = [...new Set(
    (bindings ?? []).map((row) => row.checkout_product_id).filter(Boolean),
  )];
  const offerIds = [...new Set(
    (bindings ?? []).map((row) => row.checkout_offer_id).filter(Boolean),
  )];
  const [{ data: products, error: productError }, { data: offers, error: offerError }] =
    await Promise.all([
      productIds.length > 0
        ? sb
          .from("workspace_checkout_products")
          .select("id, provider_product_id, product_ucode")
          .in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
      offerIds.length > 0
        ? sb
          .from("workspace_checkout_offers")
          .select("id, provider_offer_code")
          .in("id", offerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (productError) throw new Error(productError.message);
  if (offerError) throw new Error(offerError.message);

  const productById = new Map(
    (products ?? []).map((product) => [product.id, product]),
  );
  const offerById = new Map(
    (offers ?? []).map((offer) => [offer.id, offer]),
  );
  const productRoles: Record<string, "front" | "order_bump" | "upsell"> = {};
  const offerRoles: Record<string, "front" | "order_bump" | "upsell"> = {};
  for (const binding of bindings ?? []) {
    const role = binding.role as "front" | "order_bump" | "upsell";
    const product = productById.get(binding.checkout_product_id);
    if (product?.provider_product_id) {
      productRoles[String(product.provider_product_id)] = role;
    }
    if (product?.product_ucode) {
      productRoles[String(product.product_ucode)] = role;
    }
    const offer = binding.checkout_offer_id
      ? offerById.get(binding.checkout_offer_id)
      : null;
    if (offer?.provider_offer_code) {
      offerRoles[String(offer.provider_offer_code)] = role;
    }
  }

  return {
    productRoles,
    offerRoles,
    requireProductBinding,
    source: "webhook" as const,
  };
}

async function validateSignature(
  provider: string,
  headers: Headers,
  body: string,
  secret: string,
) {
  if (provider === "hotmart") {
    return validateHotmartHottok(
      headers.get("x-hotmart-hottok"),
      secret,
    );
  }

  if (provider === "hubla") {
    const token = headers.get("x-hubla-token") ?? "";
    if (safeEqual(token, secret)) return true;

    const signature =
      headers.get("x-hub-signature-256") ?? headers.get("x-hub-signature") ?? "";
    const expected = `sha256=${await hmacHex("SHA-256", secret, body)}`;
    return safeEqual(signature, expected);
  }

  if (provider === "kiwify") {
    const signature =
      headers.get("x-kiwify-signature") ?? headers.get("x-signature") ?? "";
    const expected = await hmacHex("SHA-1", secret, body);
    return safeEqual(signature, expected);
  }

  return false;
}

async function hmacHex(algo: "SHA-1" | "SHA-256", secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function persistPaymentAttemptShadow(
  sb: SupabaseClientAny,
  args: {
    projectId: string;
    workspaceId: string;
    provider: "hubla" | "hotmart" | "kiwify";
    event: {
      event_type: string;
      external_id: string;
      event_occurred_at: string;
      payload: Record<string, any>;
    };
  },
) {
  const method = normalizePaymentMethod(args.event.payload?.payment_method);
  if (!method) return;

  const providerId = stringValue(
    args.event.payload?.buyer_provider_id
      ?? args.event.payload?.buyer_id
      ?? args.event.payload?.customer_id,
  );
  const email = stringValue(args.event.payload?.buyer_email)?.toLowerCase();
  const orderId = stringValue(
    args.event.payload?.transaction_id ?? args.event.external_id,
  ) ?? args.event.external_id;
  const identitySource = providerId ? "provider_id" : email ? "email" : "invoice";
  const identityValue = providerId ?? email ?? orderId;
  const hashSecret = Deno.env.get("PAYMENT_ATTEMPT_HASH_SECRET")?.trim() || SERVICE_KEY;
  const buyerKey = await hmacHex(
    "SHA-256",
    hashSecret,
    `${args.workspaceId}:${args.projectId}:${args.provider}:${identitySource}:${identityValue}`,
  );

  const { error } = await sb.from("payment_attempt_signals").upsert({
    project_id: args.projectId,
    workspace_id: args.workspaceId,
    provider: args.provider,
    provider_event_key: `${args.event.event_type}:${args.event.external_id}`,
    buyer_key: buyerKey,
    identity_source: identitySource,
    order_id: orderId,
    front_product_id: stringValue(args.event.payload?.product_id),
    method,
    outcome: args.event.event_type === "purchase.approved" ? "approved" : "refused",
    occurred_at: args.event.event_occurred_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: "project_id,provider,provider_event_key" });
  if (error) throw new Error(error.message);
}

function normalizePaymentMethod(value: unknown): "card" | "pix" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("card") || normalized.includes("cart")) return "card";
  if (normalized.includes("pix")) return "pix";
  return null;
}

function stringValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function json(body: unknown, status = 200, traceId?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...(traceId ? { "x-request-id": traceId } : {}),
    },
  });
}

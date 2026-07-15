/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders } from "../_shared/automation.ts";
import { normalizeEvent } from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hotmart-hottok, x-hub-signature, x-hub-signature-256, x-hubla-token, x-hubla-sandbox, x-hubla-idempotency, x-kiwify-signature, x-signature",
};

const HUBLA_RULESET_VERSION = "hubla-subtotal-without-installment-fee-v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { provider, token } = parsePath(req.url);
    if (!provider || !token) {
      return json({ error: "use /webhook-gateway/:provider/:token" }, 400);
    }

    if (req.method === "GET") {
      return json({ ok: true, message: `gateway webhook ready (${provider})`, ruleset: HUBLA_RULESET_VERSION });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    let { data: binding, error: bindingError } = await sb
      .from("project_checkout_bindings")
      .select("project_id, webhook_token, enabled")
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
        .select("project_id, webhook_token, enabled")
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

    let { data: integration, error: integrationError } = await sb
      .from("workspace_integrations")
      .select("workspace_id, gateway_provider, gateway_webhook_secret")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();

    if (integrationError) {
      console.error("webhook-gateway integration lookup failed", safeLookupError(integrationError, provider));
      await wait(250);
      ({ data: integration, error: integrationError } = await sb
        .from("workspace_integrations")
        .select("workspace_id, gateway_provider, gateway_webhook_secret")
        .eq("workspace_id", project.workspace_id)
        .maybeSingle());
    }
    if (integrationError) {
      console.error("webhook-gateway integration lookup retry failed", safeLookupError(integrationError, provider));
      return json({ error: "temporary integration lookup failure", retryable: true }, 503);
    }
    if (!integration) {
      return json({ error: "workspace integration not found" }, 404);
    }
    if (!integration.gateway_webhook_secret) {
      return json({ error: "gateway secret not configured" }, 401);
    }
    if (integration.gateway_provider && integration.gateway_provider !== provider) {
      return json({ error: `workspace configured for ${integration.gateway_provider}, not ${provider}` }, 400);
    }

    const rawBody = await req.text();
    const valid = await validateSignature(
      provider,
      req.headers,
      rawBody,
      integration.gateway_webhook_secret,
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

    const events = normalizeEvent(provider, payload);
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

      await sb
        .from("projects")
        .update({ last_synced_at: syncedAt })
        .eq("id", project.id);

      if (datesTouched.size > 0) {
        await fetch(`${SUPABASE_URL}/functions/v1/aggregate-daily`, {
          method: "POST",
          headers: buildAutomationHeaders(),
          body: JSON.stringify({ project_id: project.id, dates: [...datesTouched] }),
        });
      }

      await finishSyncRun(sb, runId, {
        status: "succeeded",
        details: {
          provider,
          inserted,
          dates: [...datesTouched],
          event_types: events.map((event) => event.event_type),
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

    return json({ ok: true, inserted });
  } catch (error) {
    console.error("webhook-gateway error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function createSyncRun(
  sb: ReturnType<typeof createClient>,
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
  sb: ReturnType<typeof createClient>,
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
    provider:
      provider && ["hotmart", "hubla", "kiwify"].includes(provider) ? provider : null,
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

async function validateSignature(
  provider: string,
  headers: Headers,
  body: string,
  secret: string,
) {
  if (provider === "hotmart") {
    const token = headers.get("x-hotmart-hottok") ?? "";
    return safeEqual(token, secret);
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

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

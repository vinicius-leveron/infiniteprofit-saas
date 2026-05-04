/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders } from "../_shared/automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hotmart-hottok, x-hub-signature, x-hub-signature-256, x-kiwify-signature, x-signature",
};

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
      return json({ ok: true, message: `gateway webhook ready (${provider})` });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: binding, error: bindingError } = await sb
      .from("project_checkout_bindings")
      .select("project_id, webhook_token, enabled")
      .eq("webhook_token", token)
      .maybeSingle();

    if (bindingError || !binding?.project_id) {
      return json({ error: "binding not found" }, 404);
    }
    if (!binding.enabled) {
      return json({ error: "binding disabled" }, 410);
    }

    const { data: project, error: projectError } = await sb
      .from("projects")
      .select("id, user_id, workspace_id")
      .eq("id", binding.project_id)
      .maybeSingle();

    if (projectError || !project?.workspace_id) {
      return json({ error: "project not found" }, 404);
    }

    const { data: integration, error: integrationError } = await sb
      .from("workspace_integrations")
      .select("workspace_id, gateway_provider, gateway_webhook_secret")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();

    if (integrationError || !integration) {
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

type NormalizedEvent = {
  event_type:
    | "purchase.approved"
    | "purchase.refused"
    | "purchase.refunded"
    | "checkout_created";
  event_date: string;
  external_id: string;
  payload: any;
};

function normalizeEvent(provider: string, raw: any): NormalizedEvent[] {
  if (provider === "hotmart") return normalizeHotmart(raw);
  if (provider === "hubla") return normalizeHubla(raw);
  if (provider === "kiwify") return normalizeKiwify(raw);
  return [];
}

function normalizeHotmart(raw: any): NormalizedEvent[] {
  const event = String(raw?.event ?? "").toUpperCase();
  const data = raw?.data ?? {};
  const purchase = data?.purchase ?? data;
  const product = data?.product ?? {};
  const buyer = data?.buyer ?? {};
  const items: any[] = Array.isArray(purchase?.offer?.items)
    ? purchase.offer.items
    : Array.isArray(purchase?.items)
      ? purchase.items
      : [];
  const total = num(purchase?.price?.value ?? purchase?.full_price?.value ?? purchase?.total ?? 0);
  const net = num(
    purchase?.commission_as ?? purchase?.commission?.value ?? purchase?.producer?.value ?? total,
  );
  const method = String(
    purchase?.payment?.type ?? purchase?.payment_type ?? purchase?.payment?.method ?? "",
  ).toLowerCase();
  const tsRaw = purchase?.approved_date ?? purchase?.order_date ?? raw?.creation_date ?? Date.now();
  const ts = typeof tsRaw === "number" && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(
    purchase?.transaction ?? purchase?.transaction_id ?? raw?.id ?? `hot-${ts}`,
  );

  const mainProductId = String(product?.id ?? product?.ucode ?? "");
  const normalizedItems = items.map((item: any) => {
    const itemId = String(item?.id ?? item?.ucode ?? item?.product_id ?? "");
    const isBump = !!mainProductId && !!itemId && itemId !== mainProductId;
    return {
      external_id: itemId,
      name: item?.name ?? itemId,
      price: num(item?.price?.value ?? item?.value ?? item?.price ?? 0),
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE") type = "purchase.approved";
  else if (event === "PURCHASE_REFUNDED" || event === "PURCHASE_CHARGEBACK") type = "purchase.refunded";
  else if (event === "PURCHASE_CANCELED" || event === "PURCHASE_DECLINED" || event === "PURCHASE_EXPIRED") type = "purchase.refused";
  else if (event === "PURCHASE_BILLET_PRINTED" || event === "PURCHASE_OUT_OF_SHOPPING_CART") type = "checkout_created";
  if (!type) return [];

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: externalId,
    payload: {
      raw_event: event,
      total,
      net,
      payment_method: method,
      buyer_email: buyer?.email ?? null,
      product_id: mainProductId,
      items: normalizedItems,
      is_front: !purchase?.is_funnel && !purchase?.is_upsell,
    },
  }];
}

function normalizeHubla(raw: any): NormalizedEvent[] {
  const eventType = String(raw?.type ?? raw?.event_type ?? raw?.event ?? "").toLowerCase();
  const event = raw?.event ?? raw?.data ?? raw;
  const invoice = event?.invoice ?? event;
  const total = num(invoice?.amount ?? invoice?.total ?? invoice?.value ?? 0) /
    (invoice?.amount && invoice.amount > 1000 ? 100 : 1);
  const net = num(invoice?.net_amount ?? invoice?.net ?? total);
  const method = String(invoice?.payment_method ?? invoice?.method ?? "").toLowerCase();
  const tsRaw = invoice?.paid_at ?? invoice?.created_at ?? event?.created_at ?? Date.now();
  const ts = typeof tsRaw === "number" && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(invoice?.id ?? event?.id ?? raw?.id ?? `hub-${ts}`);

  const items: any[] = Array.isArray(invoice?.items)
    ? invoice.items
    : Array.isArray(invoice?.products)
      ? invoice.products
      : [];
  const mainProductId = String(invoice?.product_id ?? invoice?.product?.id ?? "");
  const normalizedItems = items.map((item: any) => {
    const itemId = String(item?.id ?? item?.product_id ?? "");
    const isBump = !!mainProductId && !!itemId && itemId !== mainProductId;
    return {
      external_id: itemId,
      name: item?.name ?? itemId,
      price: num(item?.amount ?? item?.price ?? 0),
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (eventType.includes("payment_succeeded") || eventType.includes("payment.succeeded") || eventType.includes("approved")) type = "purchase.approved";
  else if (eventType.includes("refunded") || eventType.includes("refund")) type = "purchase.refunded";
  else if (eventType.includes("payment_failed") || eventType.includes("failed") || eventType.includes("declined")) type = "purchase.refused";
  else if (eventType.includes("checkout.created") || eventType.includes("checkout_created")) type = "checkout_created";
  if (!type) return [];

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: externalId,
    payload: {
      raw_event: eventType,
      total,
      net,
      payment_method: method,
      product_id: mainProductId,
      items: normalizedItems,
      is_front: !invoice?.is_upsell && !invoice?.upsell_id,
    },
  }];
}

function normalizeKiwify(raw: any): NormalizedEvent[] {
  const eventType = String(raw?.webhook_event_type ?? raw?.event ?? raw?.order_status ?? "").toLowerCase();
  const status = String(raw?.order_status ?? "").toLowerCase();
  const total = num(raw?.Commissions?.charge_amount ?? raw?.charge_amount ?? raw?.total_value ?? raw?.amount ?? 0) / 100;
  const net = num(raw?.Commissions?.product_base_price ?? raw?.net_amount ?? total * 100) / 100;
  const method = String(raw?.payment_method ?? "").toLowerCase();
  const tsRaw = raw?.approved_date ?? raw?.created_at ?? raw?.updated_at ?? Date.now();
  const ts = typeof tsRaw === "number" && tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(raw?.order_id ?? raw?.id ?? `kw-${ts}`);

  const products: any[] = Array.isArray(raw?.Product?.products)
    ? raw.Product.products
    : Array.isArray(raw?.products)
      ? raw.products
      : raw?.Product
        ? [raw.Product]
        : [];
  const mainProductId = String(raw?.Product?.product_id ?? raw?.product_id ?? "");
  const normalizedItems = products.map((product: any) => {
    const productId = String(product?.product_id ?? product?.id ?? "");
    const isBump = !!mainProductId && !!productId && productId !== mainProductId;
    return {
      external_id: productId,
      name: product?.product_name ?? product?.name ?? productId,
      price: num(product?.price ?? product?.amount ?? 0) / 100,
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (eventType.includes("approved") || status === "paid" || status === "approved") type = "purchase.approved";
  else if (eventType.includes("refunded") || status === "refunded" || status === "chargedback") type = "purchase.refunded";
  else if (eventType.includes("refused") || status === "refused" || status === "canceled") type = "purchase.refused";
  else if (eventType.includes("billet_created") || eventType.includes("pix_created") || status === "waiting_payment") type = "checkout_created";
  if (!type) return [];

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: externalId,
    payload: {
      raw_event: eventType || status,
      total,
      net,
      payment_method: method,
      product_id: mainProductId,
      items: normalizedItems,
      is_front: !raw?.is_upsell && !raw?.upsell_order_id,
    },
  }];
}

function num(value: any) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ymdSaoPaulo(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(Number.isNaN(date.getTime()) ? new Date() : date);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

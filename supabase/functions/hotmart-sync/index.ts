/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import {
  HotmartApiError,
  hotmartAccessToken,
  hotmartApiJson,
} from "../_shared/hotmart.ts";
import { enqueueSyncJobBatch } from "../_shared/sync-jobs.ts";
import {
  normalizeHotmart,
  type CheckoutProductRole,
} from "../webhook-gateway/core.ts";
import {
  HOTMART_BACKFILL_STATUSES,
  boundedHotmartDateRange,
  hotmartEventForStatus,
  hotmartRangeEpoch,
  splitHotmartWindows,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PRODUCTS_URL =
  "https://developers.hotmart.com/products/api/v1/products";
const SALES_HISTORY_URL =
  "https://developers.hotmart.com/payments/api/v1/sales/history";
const SALES_PRICE_URL =
  "https://developers.hotmart.com/payments/api/v1/sales/price/details";
const SALES_COMMISSIONS_URL =
  "https://developers.hotmart.com/payments/api/v1/sales/commissions";
const MAX_PAGES = 100;

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let failureAdmin: SupabaseClientAny | null = null;
  let failureIntegrationId: string | null = null;
  try {
    const automation = isAutomationRequest(req);
    const caller = automation
      ? null
      : await resolveUser(req.headers.get("Authorization"));
    if (!automation && !caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const workspaceId = stringOrNull(body.workspace_id);
    const integrationId = stringOrNull(body.integration_id);
    if (!workspaceId || !integrationId) {
      return json({
        error: "workspace_id e integration_id obrigatorios",
      }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    failureAdmin = admin;
    failureIntegrationId = integrationId;
    if (!automation && caller) {
      await assertWorkspaceAdmin(admin, workspaceId, caller.userId);
    }
    await assertIntegration(admin, integrationId, workspaceId);

    if (action === "sync_catalog") {
      const result = await syncCatalog(admin, integrationId);
      return json({ ok: true, trace_id: traceId, ...result });
    }

    if (action === "enqueue_catalog") {
      const today = new Date().toISOString().slice(0, 10);
      const projectId = await catalogJobProjectId(admin, workspaceId);
      const results = await enqueueSyncJobBatch(admin, [{
        job: {
          workspaceId,
          projectId,
          source: "gateway",
          entityType: "hotmart_catalog",
          entityId: integrationId,
          dateStart: today,
          dateEnd: today,
          priority: 15,
          maxAttempts: 5,
          payload: { integration_id: integrationId },
        },
        options: {
          requeueSucceededAfterMinutes: 1,
          reviveDeadLetter: true,
        },
      }]);
      return json({ ok: true, jobs: results }, 202);
    }

    if (action === "enqueue_backfill") {
      const projectId = stringOrNull(body.project_id);
      if (!projectId) return json({ error: "project_id obrigatorio" }, 400);
      await assertProjectBinding(admin, {
        projectId,
        workspaceId,
        integrationId,
      });
      const range = boundedHotmartDateRange({
        startDate: body.start_date,
        endDate: body.end_date,
      });
      const windows = splitHotmartWindows(range.startDate, range.endDate);
      const jobs = windows.map((window, index) => ({
        job: {
          workspaceId,
          projectId,
          source: "gateway" as const,
          entityType: "hotmart_sales_backfill" as const,
          entityId: integrationId,
          dateStart: window.startDate,
          dateEnd: window.endDate,
          priority: 20 + index,
          maxAttempts: 6,
          payload: { integration_id: integrationId },
        },
        options: {
          requeueSucceededAfterMinutes: 0,
          reviveDeadLetter: true,
        },
      }));
      const results = await enqueueSyncJobBatch(admin, jobs);
      return json({
        ok: true,
        accepted: true,
        range,
        windows: windows.length,
        jobs: results,
      }, 202);
    }

    if (action === "execute_catalog") {
      if (!automation) {
        throw new HttpError(
          "Catálogo deve ser processado pelo worker.",
          403,
          "AUTOMATION_REQUIRED",
        );
      }
      const result = await syncCatalog(admin, integrationId);
      return json({ ok: true, trace_id: traceId, ...result });
    }

    if (action === "execute_backfill") {
      if (!automation) {
        throw new HttpError(
          "Histórico deve ser processado pelo worker.",
          403,
          "AUTOMATION_REQUIRED",
        );
      }
      const projectId = stringOrNull(body.project_id);
      if (!projectId) return json({ error: "project_id obrigatorio" }, 400);
      const range = boundedHotmartDateRange({
        startDate: body.start_date,
        endDate: body.end_date,
        defaultDays: 7,
        maxDays: 7,
      });
      const result = await executeBackfillWithSplit(admin, {
        integrationId,
        workspaceId,
        projectId,
        startDate: range.startDate,
        endDate: range.endDate,
      });
      return json({ ok: true, trace_id: traceId, ...result });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    const status = error instanceof HttpError
      ? error.status
      : error instanceof HotmartApiError
        ? error.status
        : 500;
    const code = error instanceof HttpError
      ? error.code
      : error instanceof HotmartApiError && error.status === 401
        ? "HOTMART_REAUTH_REQUIRED"
        : "HOTMART_SYNC_FAILED";
    if (failureAdmin && failureIntegrationId) {
      const requiresAction =
        error instanceof HotmartApiError
        && (error.status === 401 || error.status === 403);
      await failureAdmin
        .from("workspace_checkout_integrations")
        .update({
          ...(requiresAction ? { status: "requires_action" } : {}),
          last_error_code: code,
          last_error_message: (
            error instanceof Error ? error.message : "Erro inesperado"
          ).slice(0, 500),
        })
        .eq("id", failureIntegrationId);
    }
    console.error(JSON.stringify({
      event: "hotmart_sync_failed",
      trace_id: traceId,
      status,
      code,
      error: error instanceof Error ? error.message : "Erro inesperado",
    }));
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro inesperado",
      code,
      trace_id: traceId,
    }, status);
  }
});

async function executeBackfillWithSplit(
  admin: SupabaseClientAny,
  args: {
    integrationId: string;
    workspaceId: string;
    projectId: string;
    startDate: string;
    endDate: string;
  },
) {
  try {
    return await syncBackfill(admin, args);
  } catch (error) {
    if (
      !(error instanceof HotmartApiError)
      || error.status !== 502
      || args.startDate === args.endDate
    ) {
      throw error;
    }

    let imported = 0;
    let excluded = 0;
    let financialPending = 0;
    const dates = new Set<string>();
    for (const day of splitHotmartWindows(args.startDate, args.endDate, 1)) {
      const result = await syncBackfill(admin, {
        ...args,
        startDate: day.startDate,
        endDate: day.endDate,
      });
      imported += result.imported;
      excluded += result.excluded;
      financialPending += result.financial_pending;
      result.dates.forEach((date) => dates.add(date));
    }
    return {
      integration_id: args.integrationId,
      project_id: args.projectId,
      imported,
      excluded,
      financial_pending: financialPending,
      dates: [...dates].sort(),
      start_date: args.startDate,
      end_date: args.endDate,
      completed_at: new Date().toISOString(),
      split_to_daily_windows: true,
    };
  }
}

async function syncCatalog(
  admin: SupabaseClientAny,
  integrationId: string,
) {
  const syncStartedAt = new Date().toISOString();
  const products = await fetchAllPages<any>(admin, integrationId, PRODUCTS_URL);
  let offerCount = 0;
  for (const product of products) {
    const providerProductId = String(product?.id ?? "").trim();
    if (!providerProductId) continue;
    const { data: savedProduct, error } = await admin
      .from("workspace_checkout_products")
      .upsert({
        checkout_integration_id: integrationId,
        provider_product_id: providerProductId,
        product_ucode: stringOrNull(product?.ucode),
        name: stringOrNull(product?.name) ?? providerProductId,
        status: stringOrNull(product?.status) ?? "ACTIVE",
        format: stringOrNull(product?.format),
        is_subscription: product?.is_subscription === true,
      }, { onConflict: "checkout_integration_id,provider_product_id" })
      .select("id")
      .single();
    if (error || !savedProduct) {
      throw new Error(error?.message ?? "Falha ao salvar produto Hotmart");
    }

    const ucode = stringOrNull(product?.ucode);
    if (!ucode) continue;
    const offersUrl =
      `${PRODUCTS_URL}/${encodeURIComponent(ucode)}/offers`;
    const offers = await fetchAllPages<any>(
      admin,
      integrationId,
      offersUrl,
    );
    for (const offer of offers) {
      const offerCode = stringOrNull(offer?.code);
      if (!offerCode) continue;
      const { error: offerError } = await admin
        .from("workspace_checkout_offers")
        .upsert({
          checkout_integration_id: integrationId,
          checkout_product_id: savedProduct.id,
          provider_offer_code: offerCode,
          name: stringOrNull(offer?.name),
          status: "ACTIVE",
          price: finiteNumber(offer?.price?.value),
          currency_code: stringOrNull(offer?.price?.currency_code),
          payment_mode: stringOrNull(offer?.payment_mode),
          is_main_offer: offer?.is_main_offer === true,
        }, { onConflict: "checkout_integration_id,provider_offer_code" });
      if (offerError) throw new Error(offerError.message);
      offerCount++;
    }
  }

  // An item omitted by the latest complete catalog stays available for
  // diagnostics, but cannot be bound to a new funnel.
  const { error: staleProductError } = await admin
    .from("workspace_checkout_products")
    .update({ status: "UNAVAILABLE" })
    .eq("checkout_integration_id", integrationId)
    .lt("updated_at", syncStartedAt);
  if (staleProductError) throw new Error(staleProductError.message);
  const { error: staleOfferError } = await admin
    .from("workspace_checkout_offers")
    .update({ status: "UNAVAILABLE" })
    .eq("checkout_integration_id", integrationId)
    .lt("updated_at", syncStartedAt);
  if (staleOfferError) throw new Error(staleOfferError.message);

  const syncedAt = new Date().toISOString();
  const { error } = await admin
    .from("workspace_checkout_integrations")
    .update({
      status: "connected",
      catalog_synced_at: syncedAt,
      validated_at: syncedAt,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", integrationId);
  if (error) throw new Error(error.message);

  return {
    integration_id: integrationId,
    products: products.length,
    offers: offerCount,
    catalog_synced_at: syncedAt,
  };
}

async function syncBackfill(
  admin: SupabaseClientAny,
  args: {
    integrationId: string;
    workspaceId: string;
    projectId: string;
    startDate: string;
    endDate: string;
  },
) {
  const context = await loadProjectProductContext(admin, args.projectId);
  if (!Object.values(context.productRoles).includes("front")) {
    throw new HttpError(
      "Selecione um produto front antes de importar o histórico.",
      422,
      "HOTMART_FRONT_PRODUCT_REQUIRED",
    );
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, user_id")
    .eq("id", args.projectId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (projectError || !project) {
    throw new HttpError("Funil não encontrado.", 404, "PROJECT_NOT_FOUND");
  }

  let imported = 0;
  let excluded = 0;
  let financialPending = 0;
  const dates = new Set<string>();
  for (const status of HOTMART_BACKFILL_STATUSES) {
    const historyUrl = hotmartSalesUrl(
      SALES_HISTORY_URL,
      status,
      args.startDate,
      args.endDate,
    );
    const priceUrl = hotmartSalesUrl(
      SALES_PRICE_URL,
      status,
      args.startDate,
      args.endDate,
    );
    const commissionsUrl = hotmartSalesUrl(
      SALES_COMMISSIONS_URL,
      status,
      args.startDate,
      args.endDate,
    );
    const [sales, priceDetails, commissionDetails] = await Promise.all([
      fetchAllPages<any>(admin, args.integrationId, historyUrl),
      fetchAllPages<any>(admin, args.integrationId, priceUrl),
      fetchAllPages<any>(admin, args.integrationId, commissionsUrl),
    ]);
    const priceByTransaction = new Map(
      priceDetails
        .map((detail) => [String(detail?.transaction ?? ""), detail] as const)
        .filter(([transaction]) => transaction),
    );
    const commissionsByTransaction = new Map(
      commissionDetails
        .map((detail) => [String(detail?.transaction ?? ""), detail] as const)
        .filter(([transaction]) => transaction),
    );

    for (const sale of sales) {
      const purchaseStatus = sale?.purchase?.status ?? status;
      const hotmartEvent = hotmartEventForStatus(purchaseStatus);
      if (!hotmartEvent) continue;
      const transaction = String(sale?.purchase?.transaction ?? "");
      let commissionDetail = commissionsByTransaction.get(transaction);
      // Some Hotmart accounts omit isolated COMPLETE transactions from a
      // date-window commissions response even though sales/history returns
      // them. The official endpoint supports transaction lookup, so retry the
      // missing split narrowly before leaving the financial result pending.
      if (!Array.isArray(commissionDetail?.commissions) && transaction) {
        const targetedUrl = new URL(SALES_COMMISSIONS_URL);
        targetedUrl.searchParams.set("transaction", transaction);
        targetedUrl.searchParams.set(
          "transaction_status",
          String(purchaseStatus).toUpperCase(),
        );
        const targetedDetails = await fetchAllPages<any>(
          admin,
          args.integrationId,
          targetedUrl.toString(),
        );
        commissionDetail = targetedDetails.find(
          (detail) => String(detail?.transaction ?? "") === transaction,
        );
      }
      const authoritativeCommissions = Array.isArray(
        commissionDetail?.commissions,
      );
      const events = normalizeHotmart({
        id: `api-${transaction}-${purchaseStatus}`,
        event: hotmartEvent,
        creation_date:
          sale?.purchase?.approved_date
          ?? sale?.purchase?.order_date
          ?? Date.now(),
        data: {
          product: sale?.product,
          purchase: sale?.purchase,
          commissions:
            commissionDetail?.commissions
            ?? sale?.commissions,
        },
      }, {
        ...context,
        requireProductBinding: true,
        priceDetail: priceByTransaction.get(transaction) ?? null,
        source: "api",
        commissionsAuthoritative: authoritativeCommissions,
      });

      for (const event of events) {
        const metricsReady = event.payload?.metrics_ready !== false;
        if (event.payload?.financial_metrics_ready === false) {
          const { data: existing, error: existingError } = await admin
            .from("raw_events")
            .select("payload")
            .eq("project_id", args.projectId)
            .eq("source", "gateway")
            .eq("event_type", event.event_type)
            .eq("external_id", event.external_id)
            .maybeSingle();
          if (existingError) throw new Error(existingError.message);
          const existingPayload = existing?.payload as Record<string, any> | null;
          // Never downgrade a transaction already reconciled by an
          // authoritative API response or spreadsheet to a partial API row.
          if (
            existingPayload?.financial_metrics_ready === true
            || (
              existingPayload?.ingestion_source === "spreadsheet"
              && finiteNumber(existingPayload?.net) != null
            )
          ) {
            dates.add(event.event_date);
            if (metricsReady) imported++;
            else excluded++;
            continue;
          }
        }
        const { error } = await admin.from("raw_events").upsert({
          project_id: args.projectId,
          workspace_id: args.workspaceId,
          user_id: project.user_id,
          source: "gateway",
          account_id: `hotmart:${args.integrationId}`,
          event_type: event.event_type,
          event_date: event.event_date,
          event_occurred_at: event.event_occurred_at,
          external_id: event.external_id,
          payload: event.payload,
        }, { onConflict: "project_id,source,event_type,external_id" });
        if (error) throw new Error(error.message);
        dates.add(event.event_date);
        if (metricsReady) imported++;
        else excluded++;
        // Unsupported currencies and unbound products are intentionally
        // preserved outside dashboard metrics. They must not keep a backfill
        // retrying just because no BRL financial split is available.
        if (
          metricsReady
          && event.payload?.financial_metrics_ready === false
        ) {
          financialPending++;
        }
      }
    }
  }

  const completedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("workspace_checkout_integrations")
    .update({
      status: "connected",
      last_backfill_at: completedAt,
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", args.integrationId);
  if (updateError) throw new Error(updateError.message);

  return {
    integration_id: args.integrationId,
    project_id: args.projectId,
    imported,
    excluded,
    financial_pending: financialPending,
    dates: [...dates].sort(),
    start_date: args.startDate,
    end_date: args.endDate,
    completed_at: completedAt,
  };
}

async function fetchAllPages<T>(
  admin: SupabaseClientAny,
  integrationId: string,
  baseUrl: string,
) {
  const rows: T[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set("max_results", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const payload = await authorizedHotmartJson<{
      items?: T[];
      page_info?: { next_page_token?: string | null };
    }>(admin, integrationId, url);
    rows.push(...(payload.items ?? []));
    pageToken = stringOrNull(payload.page_info?.next_page_token);
    if (!pageToken) return rows;
  }
  throw new Error("A paginação Hotmart excedeu o limite de segurança.");
}

async function authorizedHotmartJson<T>(
  admin: SupabaseClientAny,
  integrationId: string,
  url: URL,
) {
  let token = await hotmartAccessToken(admin, integrationId);
  try {
    return (await hotmartApiJson<T>(url, token)).data;
  } catch (error) {
    if (!(error instanceof HotmartApiError) || error.status !== 401) throw error;
    token = await hotmartAccessToken(admin, integrationId, true);
    return (await hotmartApiJson<T>(url, token)).data;
  }
}

async function loadProjectProductContext(
  admin: SupabaseClientAny,
  projectId: string,
) {
  const { data: bindings, error } = await admin
    .from("project_checkout_products")
    .select("checkout_product_id, checkout_offer_id, role")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  const productIds = (bindings ?? []).map((row) => row.checkout_product_id);
  const offerIds = (bindings ?? [])
    .map((row) => row.checkout_offer_id)
    .filter(Boolean);
  const [{ data: products, error: productError }, { data: offers, error: offerError }] =
    await Promise.all([
      productIds.length > 0
        ? admin
          .from("workspace_checkout_products")
          .select("id, provider_product_id, product_ucode")
          .in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
      offerIds.length > 0
        ? admin
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
  const productRoles: Record<string, CheckoutProductRole> = {};
  const offerRoles: Record<string, CheckoutProductRole> = {};
  for (const binding of bindings ?? []) {
    const role = binding.role as CheckoutProductRole;
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
  return { productRoles, offerRoles };
}

function hotmartSalesUrl(
  baseUrl: string,
  status: string,
  startDate: string,
  endDate: string,
) {
  const range = hotmartRangeEpoch(startDate, endDate);
  const url = new URL(baseUrl);
  url.searchParams.set("transaction_status", status);
  url.searchParams.set("start_date", String(range.start));
  url.searchParams.set("end_date", String(range.end));
  return url.toString();
}

async function catalogJobProjectId(
  admin: SupabaseClientAny,
  workspaceId: string,
) {
  const { data, error } = await admin
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) {
    throw new HttpError(
      "Crie o primeiro funil antes de sincronizar o catálogo.",
      422,
      "FUNNEL_REQUIRED",
    );
  }
  return data.id;
}

async function assertProjectBinding(
  admin: SupabaseClientAny,
  args: {
    projectId: string;
    workspaceId: string;
    integrationId: string;
  },
) {
  const { data, error } = await admin
    .from("project_checkout_bindings")
    .select("project_id, projects!inner(workspace_id)")
    .eq("project_id", args.projectId)
    .eq("checkout_integration_id", args.integrationId)
    .eq("projects.workspace_id", args.workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new HttpError(
      "A Hotmart não está vinculada a este funil.",
      422,
      "HOTMART_BINDING_REQUIRED",
    );
  }
}

async function assertIntegration(
  admin: SupabaseClientAny,
  integrationId: string,
  workspaceId: string,
) {
  const { data, error } = await admin
    .from("workspace_checkout_integrations")
    .select("id")
    .eq("id", integrationId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "hotmart")
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new HttpError(
      "Integração Hotmart não encontrada.",
      404,
      "HOTMART_NOT_FOUND",
    );
  }
}

async function resolveUser(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}

async function assertWorkspaceAdmin(
  admin: SupabaseClientAny,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMember } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMember?.role === "owner" || workspaceMember?.role === "admin") {
    return;
  }
  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  const { data: orgMember } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();
  if (orgMember?.role === "owner" || orgMember?.role === "admin") return;
  throw new HttpError(
    "Sem permissão para sincronizar a Hotmart.",
    403,
    "FORBIDDEN",
  );
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders } from "../_shared/automation.ts";
import {
  parseDailyMetricsCsv,
  parseHotmartCsv,
  parseHublaCsv,
} from "./core.ts";
import type { CheckoutProductRole } from "../webhook-gateway/core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const user = await resolveUser(authHeader);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = stringOrNull(body.project_id ?? body.projectId);
    const csv = String(body.csv ?? "").trim();
    const dryRun = Boolean(body.dry_run ?? body.dryRun);
    const provider = String(body.provider ?? "hubla").trim().toLowerCase();

    if (!projectId) return json({ error: "project_id é obrigatório" }, 400);
    if (!csv) return json({ error: "csv é obrigatório" }, 400);
    if (new TextEncoder().encode(csv).byteLength > MAX_IMPORT_BYTES) {
      return json({ error: "A planilha excede o limite de 8 MB" }, 413);
    }
    if (provider !== "hubla" && provider !== "hotmart") {
      return json({ error: "provider deve ser hubla ou hotmart" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const project = await getProjectOrThrow(sb, projectId);
    await assertWorkspaceAdmin(sb, project.workspace_id, user.id);

    if (provider === "hotmart") {
      const context = await loadHotmartImportContext(sb, project);
      let parsed: ReturnType<typeof parseHotmartCsv>;
      try {
        parsed = parseHotmartCsv(csv, {
          productRoles: context.productRoles,
          offerRoles: context.offerRoles,
        });
      } catch (error) {
        return json({
          error: error instanceof Error
            ? error.message
            : "Planilha Hotmart inválida",
        }, 400);
      }

      const { events, warnings, dataRows, headers, imported, excluded } = parsed;
      if (events.length === 0) {
        return json({
          ok: true,
          kind: "hotmart_sales_export",
          dry_run: dryRun,
          imported: 0,
          excluded: 0,
          skipped: dataRows,
          headers,
          warnings: warnings.slice(0, 50),
          dates: [],
        });
      }

      const datesTouched = [...new Set(
        events.map((event) => event.event_date),
      )].sort();
      if (!dryRun) {
        const importedAt = new Date().toISOString();
        const payload = events.map((event) => ({
          project_id: project.id,
          workspace_id: project.workspace_id,
          user_id: project.user_id,
          source: "gateway",
          event_type: event.event_type,
          event_date: event.event_date,
          event_occurred_at: event.event_occurred_at,
          external_id: event.external_id,
          account_id: `hotmart:${context.integrationId}`,
          payload: {
            ...event.payload,
            import_source: "hotmart_spreadsheet",
            import_line: event.line,
            imported_at: importedAt,
          },
        }));

        const { error } = await sb
          .from("raw_events")
          .upsert(payload, {
            onConflict: "project_id,source,event_type,external_id",
          });
        if (error) throw new Error(error.message);

        const { error: integrationUpdateError } = await sb
          .from("workspace_checkout_integrations")
          .update({
            last_backfill_at: importedAt,
            last_error_code: null,
            last_error_message: null,
          })
          .eq("id", context.integrationId);
        if (integrationUpdateError) {
          throw new Error(integrationUpdateError.message);
        }

        await triggerAggregateDaily(project.id, datesTouched);
      }

      return json({
        ok: true,
        kind: "hotmart_sales_export",
        dry_run: dryRun,
        imported,
        excluded,
        skipped: Math.max(0, dataRows - events.length),
        headers,
        dates: datesTouched,
        warnings: warnings.slice(0, 50),
        preview: events.slice(0, 5).map((event) => ({
          line: event.line,
          type: event.event_type,
          date: event.event_date,
          external_id: event.external_id,
          total: event.payload.total,
          metrics_ready: event.payload.metrics_ready !== false,
        })),
      });
    }

    let parsedDailyMetrics: ReturnType<typeof parseDailyMetricsCsv>;
    try {
      parsedDailyMetrics = parseDailyMetricsCsv(csv);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "CSV inválido" }, 400);
    }

    if (parsedDailyMetrics.overrides.length > 0) {
      const { overrides, warnings, dataRows, headers } = parsedDailyMetrics;
      const datesTouched = [...new Set(overrides.map((override) => override.event_date))].sort();

      if (!dryRun) {
        const payload = overrides.map((override) => ({
          project_id: project.id,
          workspace_id: project.workspace_id,
          user_id: project.user_id,
          source: "sheet_override",
          event_type: "daily_metrics",
          event_date: override.event_date,
          external_id: `daily-metrics-sheet:${override.event_date}`,
          account_id: "daily_metrics_sheet",
          payload: {
            ...override.payload,
            import_line: override.line,
            imported_at: new Date().toISOString(),
          },
        }));

        const { error } = await sb
          .from("raw_events")
          .upsert(payload, { onConflict: "project_id,source,event_type,external_id" });
        if (error) throw new Error(error.message);

        await triggerAggregateDaily(project.id, datesTouched);
      }

      return json({
        ok: true,
        kind: "daily_metrics_sheet",
        dry_run: dryRun,
        imported: overrides.length,
        skipped: Math.max(0, dataRows - overrides.length),
        headers,
        dates: datesTouched,
        warnings: warnings.slice(0, 50),
        preview: overrides.slice(0, 5).map((override) => ({
          line: override.line,
          type: "daily_metrics",
          date: override.event_date,
          external_id: `daily-metrics-sheet:${override.event_date}`,
          total: override.payload.fat_bruto,
        })),
      });
    }

    let parsedCsv: ReturnType<typeof parseHublaCsv>;
    try {
      parsedCsv = parseHublaCsv(csv);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "CSV inválido" }, 400);
    }
    const { events, warnings, dataRows, headers } = parsedCsv;

    if (events.length === 0) {
      return json({
        ok: true,
        dry_run: dryRun,
        imported: 0,
        skipped: dataRows,
        headers,
        warnings: warnings.slice(0, 50),
        dates: [],
      });
    }

    const datesTouched = [...new Set(events.map((event) => event.event_date))].sort();
    if (!dryRun) {
      const payload = events.map((event) => ({
        project_id: project.id,
        workspace_id: project.workspace_id,
        user_id: project.user_id,
        source: "gateway",
        event_type: event.event_type,
        event_date: event.event_date,
        event_occurred_at: event.event_occurred_at,
        external_id: event.external_id,
        account_id: "hubla_csv",
        payload: {
          ...event.payload,
          import_source: "hubla_csv",
          import_line: event.line,
          imported_at: new Date().toISOString(),
        },
      }));

      const { error } = await sb
        .from("raw_events")
        .upsert(payload, { onConflict: "project_id,source,event_type,external_id" });
      if (error) throw new Error(error.message);

      await triggerAggregateDaily(project.id, datesTouched);
    }

    return json({
      ok: true,
      dry_run: dryRun,
      imported: events.length,
      skipped: Math.max(0, dataRows - events.length),
      headers,
      dates: datesTouched,
      warnings: warnings.slice(0, 50),
      preview: events.slice(0, 5).map((event) => ({
        line: event.line,
        type: event.event_type,
        date: event.event_date,
        external_id: event.external_id,
        total: event.payload.total,
      })),
    });
  } catch (error) {
    console.error("hubla-csv-import error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function resolveUser(authHeader: string) {
  if (!authHeader.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

async function getProjectOrThrow(sb: ReturnType<typeof createClient>, projectId: string): Promise<ProjectContext> {
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.workspace_id) throw new Error("Projeto não encontrado");
  return data as ProjectContext;
}

async function loadHotmartImportContext(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
) {
  const { data: binding, error: bindingError } = await sb
    .from("project_checkout_bindings")
    .select("checkout_integration_id, enabled")
    .eq("project_id", project.id)
    .eq("enabled", true)
    .maybeSingle();
  if (bindingError) throw new Error(bindingError.message);
  if (!binding?.checkout_integration_id) {
    throw new Error(
      "Vincule uma integração Hotmart a este funil antes de importar a planilha",
    );
  }
  const { data: integration, error: integrationError } = await sb
    .from("workspace_checkout_integrations")
    .select("id")
    .eq("id", binding.checkout_integration_id)
    .eq("workspace_id", project.workspace_id)
    .eq("provider", "hotmart")
    .maybeSingle();
  if (integrationError) throw new Error(integrationError.message);
  if (!integration) {
    throw new Error(
      "A integração vinculada a este funil não é uma conta Hotmart válida",
    );
  }

  const { data: productBindings, error: productBindingError } = await sb
    .from("project_checkout_products")
    .select("checkout_product_id, checkout_offer_id, role")
    .eq("project_id", project.id);
  if (productBindingError) throw new Error(productBindingError.message);

  const productIds = (productBindings ?? []).map(
    (item) => item.checkout_product_id,
  );
  const offerIds = (productBindings ?? [])
    .map((item) => item.checkout_offer_id)
    .filter(Boolean);
  const [{ data: products, error: productError }, {
    data: offers,
    error: offerError,
  }] = await Promise.all([
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
    (products ?? []).map((item) => [item.id, item]),
  );
  const offerById = new Map(
    (offers ?? []).map((item) => [item.id, item]),
  );
  const productRoles: Record<string, CheckoutProductRole> = {};
  const offerRoles: Record<string, CheckoutProductRole> = {};
  for (const bindingRow of productBindings ?? []) {
    const role = bindingRow.role as CheckoutProductRole;
    const product = productById.get(bindingRow.checkout_product_id);
    if (product?.provider_product_id) {
      productRoles[String(product.provider_product_id)] = role;
    }
    if (product?.product_ucode) {
      productRoles[String(product.product_ucode)] = role;
    }
    const offer = bindingRow.checkout_offer_id
      ? offerById.get(bindingRow.checkout_offer_id)
      : null;
    if (offer?.provider_offer_code) {
      offerRoles[String(offer.provider_offer_code)] = role;
    }
  }
  if (!Object.values(productRoles).includes("front")) {
    throw new Error(
      "Selecione exatamente um produto front da Hotmart antes da importação",
    );
  }

  return {
    integrationId: String(binding.checkout_integration_id),
    productRoles,
    offerRoles,
  };
}

async function assertWorkspaceAdmin(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMembership } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") return;

  const { data: workspace } = await sb
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace?.organization_id) throw new Error("Workspace não encontrado");

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") return;

  throw new Error("Sem permissão para importar vendas neste workspace");
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

async function triggerAggregateDaily(projectId: string, dates: string[]) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/aggregate-daily`, {
    method: "POST",
    headers: buildAutomationHeaders(),
    body: JSON.stringify({ project_id: projectId, dates }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Falha ao agregar vendas importadas: ${message || `HTTP ${response.status}`}`);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

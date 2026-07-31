#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "nztnctrkmfrgclrnflfa";
const DEFAULT_STATE_PATH = "/tmp/infiniteprofit-production-auth-qa.json";

export async function createProductionAuthQaFixture({
  statePath = process.env.E2E_PRODUCTION_FIXTURE_PATH ?? DEFAULT_STATE_PATH,
} = {}) {
  const config = productionConfig();
  const service = serviceClient(config);
  const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const password = `Qa-${randomBytes(18).toString("base64url")}!1a`;
  const roles = {
    owner: qaIdentity("owner", suffix, password),
    admin: qaIdentity("admin", suffix, password),
    organizationMember: qaIdentity("org-member", suffix, password),
    clientMember: qaIdentity("client-member", suffix, password),
  };
  const createdUserIds = [];
  let organizationId = null;

  try {
    for (const identity of Object.values(roles)) {
      const { data, error } = await service.auth.admin.createUser({
        email: identity.email,
        password: identity.password,
        email_confirm: true,
        user_metadata: { full_name: identity.fullName },
      });
      assertNoError(error, `create ${identity.label} user`);
      if (!data.user) throw new Error(`create ${identity.label} user returned no user`);
      identity.userId = data.user.id;
      createdUserIds.push(data.user.id);
    }

    const organization = await insertSingle(service, "organizations", {
      name: `QA Organization ${suffix}`,
      created_by: roles.owner.userId,
    });
    organizationId = organization.id;

    await insertRows(service, "organization_members", [
      {
        organization_id: organization.id,
        user_id: roles.owner.userId,
        role: "owner",
      },
      {
        organization_id: organization.id,
        user_id: roles.admin.userId,
        role: "admin",
      },
      {
        organization_id: organization.id,
        user_id: roles.organizationMember.userId,
        role: "member",
      },
    ]);

    const workspace = await insertSingle(service, "workspaces", {
      organization_id: organization.id,
      name: `QA Client ${suffix}`,
      created_by: roles.owner.userId,
    });
    await insertRows(service, "workspace_members", [
      {
        workspace_id: workspace.id,
        user_id: roles.clientMember.userId,
        role: "member",
      },
    ]);

    const project = await insertSingle(service, "projects", {
      workspace_id: workspace.id,
      user_id: roles.owner.userId,
      name: `QA Funnel ${suffix}`,
      source: "api",
      csv_content: null,
      first_trusted_signal_at: new Date().toISOString(),
    });
    const eventDate = saoPauloDateKey(new Date());
    await insertRows(service, "daily_metrics", [
      {
        project_id: project.id,
        workspace_id: workspace.id,
        user_id: roles.owner.userId,
        event_date: eventDate,
        investimento: 100,
        imposto_meta: 12.15,
        impressoes: 10_000,
        cliques: 500,
        landing_pageviews: 400,
        pageviews: 350,
        plays_unicos: 300,
        chegaram_pitch: 120,
        checkouts: 20,
        vendas_front: 2,
        vendas_totais: 3,
        fat_bruto: 1_000,
        fat_liquido: 900,
        lucro: 787.85,
        aov: 500,
        reembolsos: 0,
        valor_reembolsado: 0,
        order_bump_orders: 1,
        upsell_orders: 0,
        conv_geral_orderbump: 50,
        conv_geral_upsell: 0,
        bumps: [],
      },
    ]);
    await insertRows(service, "daily_ad_dimension_metrics", [
      dimensionRow({
        projectId: project.id,
        workspaceId: workspace.id,
        eventDate,
        accountId: "qa-account-1",
        campaignId: "qa-campaign-1",
        campaignName: "Campanha QA 1",
        adsetId: "qa-adset-1",
        adsetName: "Conjunto QA 1",
        adId: "qa-ad-1",
        adName: "Anúncio QA 1",
        spend: 60,
        impressions: 6_000,
        clicks: 300,
        sales: 1,
        revenue: 600,
        netRevenue: 540,
        bumpOrders: 1,
      }),
      dimensionRow({
        projectId: project.id,
        workspaceId: workspace.id,
        eventDate,
        accountId: "qa-account-2",
        campaignId: "qa-campaign-2",
        campaignName: "Campanha QA 2",
        adsetId: "qa-adset-2",
        adsetName: "Conjunto QA 2",
        adId: "qa-ad-2",
        adName: "Anúncio QA 2",
        spend: 40,
        impressions: 4_000,
        clicks: 200,
        sales: 1,
        revenue: 400,
        netRevenue: 360,
        bumpOrders: 0,
      }),
    ]);

    const state = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      projectRef: PRODUCTION_PROJECT_REF,
      publicUrl: "https://infiniteprofit.com.br",
      organizationId: organization.id,
      workspaceId: workspace.id,
      projectId: project.id,
      eventDate,
      roles,
    };
    await writeFile(statePath, JSON.stringify(state, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(statePath, 0o600);
    return { state, statePath };
  } catch (error) {
    await cleanupResources(service, {
      organizationId,
      userIds: createdUserIds,
    });
    await unlink(statePath).catch(() => {});
    throw error;
  }
}

export async function cleanupProductionAuthQaFixture({
  statePath = process.env.E2E_PRODUCTION_FIXTURE_PATH ?? DEFAULT_STATE_PATH,
  state: providedState,
} = {}) {
  const config = productionConfig();
  const service = serviceClient(config);
  const state = providedState ?? JSON.parse(await readFile(statePath, "utf8"));
  await cleanupResources(service, {
    organizationId: state.organizationId,
    userIds: Object.values(state.roles ?? {})
      .map((identity) => identity.userId)
      .filter(Boolean),
  });
  await unlink(statePath).catch(() => {});
}

function productionConfig() {
  const url = required("VITE_SUPABASE_URL");
  const projectRef = required("VITE_SUPABASE_PROJECT_ID");
  const acknowledgement = required("QA_PRODUCTION_FIXTURE_ACK");
  if (
    projectRef !== PRODUCTION_PROJECT_REF ||
    acknowledgement !== PRODUCTION_PROJECT_REF ||
    new URL(url).hostname !== `${PRODUCTION_PROJECT_REF}.supabase.co`
  ) {
    throw new Error(
      "Production QA fixture target or acknowledgement does not match the Infinite Profit production project.",
    );
  }
  return {
    url,
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function serviceClient({ url, serviceRoleKey }) {
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function qaIdentity(role, suffix, password) {
  return {
    label: role,
    email: `infiniteprofit-qa-${role}-${suffix}@example.com`,
    password,
    fullName: `QA ${role}`,
    userId: null,
  };
}

function dimensionRow({
  projectId,
  workspaceId,
  eventDate,
  accountId,
  campaignId,
  campaignName,
  adsetId,
  adsetName,
  adId,
  adName,
  spend,
  impressions,
  clicks,
  sales,
  revenue,
  netRevenue,
  bumpOrders,
}) {
  return {
    project_id: projectId,
    workspace_id: workspaceId,
    event_date: eventDate,
    account_id: accountId,
    campaign_id: campaignId,
    campaign_name: campaignName,
    adset_id: adsetId,
    adset_name: adsetName,
    ad_id: adId,
    ad_name: adName,
    investimento: spend,
    impressoes: impressions,
    cliques: clicks,
    hook_count: Math.round(impressions * 0.3),
    landing_pageviews: Math.round(clicks * 0.8),
    pageviews: Math.round(clicks * 0.7),
    plays_unicos: Math.round(clicks * 0.6),
    chegaram_pitch: Math.round(clicks * 0.24),
    checkouts: 10,
    vendas_front: sales,
    vendas_totais: sales + bumpOrders,
    fat_bruto: revenue,
    fat_liquido: netRevenue,
    reembolsos: 0,
    valor_reembolsado: 0,
    order_bump_orders: bumpOrders,
    upsell_orders: 0,
  };
}

async function insertSingle(service, table, row) {
  const { data, error } = await service
    .from(table)
    .insert(row)
    .select("id")
    .single();
  assertNoError(error, `insert ${table}`);
  if (!data) throw new Error(`insert ${table} returned no row`);
  return data;
}

async function insertRows(service, table, rows) {
  const { error } = await service.from(table).insert(rows);
  assertNoError(error, `insert ${table}`);
}

async function cleanupResources(service, { organizationId, userIds }) {
  if (organizationId) {
    const { error } = await service
      .from("organizations")
      .delete()
      .eq("id", organizationId);
    if (error) {
      throw new Error(`cleanup organization failed: ${error.message}`);
    }
  }
  for (const userId of userIds ?? []) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`cleanup QA user failed: ${error.message}`);
    }
  }
}

function saoPauloDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function assertNoError(error, operation) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required for production authenticated QA.`);
  return value;
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const mode = process.argv[2] ?? "create";
  if (mode === "create") {
    const { state, statePath } = await createProductionAuthQaFixture();
    console.log(JSON.stringify({
      statePath,
      organizationId: state.organizationId,
      workspaceId: state.workspaceId,
      projectId: state.projectId,
      users: Object.keys(state.roles),
    }, null, 2));
  } else if (mode === "cleanup") {
    await cleanupProductionAuthQaFixture();
    console.log(JSON.stringify({ cleaned: true }, null, 2));
  } else {
    throw new Error(`Unknown fixture mode: ${mode}`);
  }
}

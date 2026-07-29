#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

loadEnv();

const configuredBaseUrl = (
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const projectRef =
  process.env.SUPABASE_PROJECT_REF?.trim() ||
  (configuredBaseUrl ? new URL(configuredBaseUrl).hostname.split(".")[0] : "");
const baseUrl =
  configuredBaseUrl ||
  (projectRef ? `https://${projectRef}.supabase.co` : "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const automationKey =
  process.env.AUTOMATION_KEY ??
  process.env.QA_AUTOMATION_KEY ??
  serviceKey;
const managementToken =
  process.env.SUPABASE_ACCESS_TOKEN?.trim() ||
  readLocalAccessToken();
const execute = process.argv.includes("--execute");
const projectArg = uuidArgument("project");
const fromArg = dateArgument("from");
const toArg = dateArgument("to");

if (
  !projectRef ||
  (
    execute
      ? !baseUrl || !serviceKey || !automationKey
      : !serviceKey && !managementToken
  )
) {
  throw new Error(
    execute
      ? "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e AUTOMATION_KEY são obrigatórios para executar."
      : "SUPABASE_PROJECT_REF e SUPABASE_ACCESS_TOKEN (ou SUPABASE_SERVICE_ROLE_KEY) são obrigatórios para o dry-run.",
  );
}

if (
  execute &&
  process.env.FEEDBACK_METRICS_BACKFILL_ACK !== projectRef
) {
  throw new Error(
    `Defina FEEDBACK_METRICS_BACKFILL_ACK=${projectRef} para executar o backfill.`,
  );
}

const plan =
  !execute && !serviceKey
    ? await buildManagementPlan()
    : await buildRestPlan();

if (!execute) {
  console.log(JSON.stringify({
    mode: "dry_run",
    project_ref: projectRef,
    projects: plan.map(({ dates, ...item }) => ({
      ...item,
      date_count: dates.length,
      request_count: chunk(dates, 90).length,
    })),
  }, null, 2));
  process.exit(0);
}

const results = [];
for (const item of plan) {
  let processedDates = 0;
  for (const dates of chunk(item.dates, 90)) {
    await aggregateDates(item.project_id, dates);
    processedDates += dates.length;
  }
  const reconciliation = await reconcileProject(item.project_id);
  results.push({
    project_id: item.project_id,
    project_name: item.project_name,
    processed_dates: processedDates,
    reconciliation,
  });
}

const report = {
  mode: "execute",
  project_ref: projectRef,
  completed_at: new Date().toISOString(),
  results,
};
console.log(JSON.stringify(report, null, 2));
if (results.some((result) => !result.reconciliation.ok)) {
  process.exitCode = 1;
}

async function buildRestPlan() {
  const projects = await listProjects(projectArg);
  const plan = [];
  for (const project of projects) {
    const dates = await listRawEventDates(project.id);
    plan.push(toPlanItem(project.id, project.name, dates));
  }
  return plan;
}

async function buildManagementPlan() {
  const conditions = [
    projectArg ? `project.id = '${projectArg}'::uuid` : "true",
    fromArg ? `event.event_date >= '${fromArg}'::date` : "true",
    toArg ? `event.event_date <= '${toArg}'::date` : "true",
  ];
  const rows = await managementQuery(`
    select
      project.id as project_id,
      project.name as project_name,
      event.event_date
    from public.projects project
    left join (
      select distinct raw.project_id, raw.event_date
      from public.raw_events raw
    ) event on event.project_id = project.id
    where ${conditions.join(" and ")}
    order by project.created_at, event.event_date
  `);

  const grouped = new Map();
  for (const row of rows) {
    const id = String(row.project_id ?? "");
    if (!id) continue;
    const current = grouped.get(id) ?? {
      name: String(row.project_name ?? id),
      dates: [],
    };
    const date = String(row.event_date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) current.dates.push(date);
    grouped.set(id, current);
  }
  if (projectArg && !grouped.has(projectArg)) {
    throw new Error(`Funil ${projectArg} não encontrado.`);
  }
  return [...grouped.entries()].map(([id, item]) =>
    toPlanItem(id, item.name, [...new Set(item.dates)].sort())
  );
}

function toPlanItem(projectId, projectName, dates) {
  return {
    project_id: projectId,
    project_name: projectName,
    first_date: dates[0] ?? null,
    last_date: dates.at(-1) ?? null,
    dates,
  };
}

async function listProjects(projectId) {
  const params = new URLSearchParams({
    select: "id,name",
    order: "created_at.asc",
  });
  if (projectId) params.set("id", `eq.${projectId}`);
  const response = await rest(`projects?${params}`);
  if (projectId && response.length === 0) {
    throw new Error(`Funil ${projectId} não encontrado.`);
  }
  return response;
}

async function listRawEventDates(projectId) {
  const uniqueDates = new Set();
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const params = new URLSearchParams({
      select: "event_date",
      project_id: `eq.${projectId}`,
      order: "event_date.asc",
      limit: String(pageSize),
      offset: String(from),
    });
    if (fromArg) params.set("event_date", `gte.${fromArg}`);
    if (toArg) params.append("event_date", `lte.${toArg}`);
    const page = await rest(`raw_events?${params}`);
    for (const row of page) {
      const date = String(row.event_date ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) uniqueDates.add(date);
    }
    if (page.length < pageSize) break;
  }
  return [...uniqueDates].sort();
}

async function aggregateDates(projectId, dates) {
  const response = await fetch(`${baseUrl}/functions/v1/aggregate-daily`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: automationKey,
      Authorization: `Bearer ${automationKey}`,
    },
    body: JSON.stringify({ project_id: projectId, dates }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Backfill do funil ${projectId} falhou com HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
}

async function reconcileProject(projectId) {
  const params = new URLSearchParams({
    select: "event_date,vendas_front,fat_bruto,aov,conv_geral_orderbump,conv_geral_upsell",
    project_id: `eq.${projectId}`,
    order: "event_date.asc",
    limit: "10000",
  });
  if (fromArg) params.set("event_date", `gte.${fromArg}`);
  if (toArg) params.append("event_date", `lte.${toArg}`);
  const rows = await rest(`daily_metrics?${params}`);
  const aovMismatches = [];
  const conversionIntegrity = [];

  for (const row of rows) {
    const frontSales = finite(row.vendas_front);
    const grossRevenue = finite(row.fat_bruto);
    const actualAov = nullableFinite(row.aov);
    const expectedAov = frontSales > 0 ? grossRevenue / frontSales : null;
    if (
      expectedAov != null &&
      (
        actualAov == null ||
        Math.abs(actualAov - expectedAov) > 0.01
      )
    ) {
      aovMismatches.push(String(row.event_date));
    }

    const bump = finite(row.conv_geral_orderbump);
    const upsell = finite(row.conv_geral_upsell);
    if (bump > 100 || upsell > 100) {
      conversionIntegrity.push({
        event_date: String(row.event_date),
        order_bump_percent: bump,
        upsell_percent: upsell,
      });
    }
  }

  return {
    ok: aovMismatches.length === 0 && conversionIntegrity.length === 0,
    metric_rows: rows.length,
    aov_mismatches: aovMismatches,
    conversion_integrity_anomalies: conversionIntegrity,
  };
}

async function rest(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(`Consulta de backfill falhou com HTTP ${response.status}.`);
  }
  return body;
}

async function managementQuery(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${managementToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only: true }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(
      `Consulta de planejamento falhou com HTTP ${response.status}.`,
    );
  }
  return body;
}

function chunk(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function argument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function uuidArgument(name) {
  const value = argument(name);
  if (!value) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`--${name} deve ser um UUID válido.`);
  }
  return value;
}

function dateArgument(name) {
  const value = argument(name);
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--${name} deve usar YYYY-MM-DD.`);
  }
  return value;
}

function loadEnv() {
  for (const path of [".env", ".env.local"]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function readLocalAccessToken() {
  const path = join(homedir(), ".supabase", "access-token");
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

function finite(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function nullableFinite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

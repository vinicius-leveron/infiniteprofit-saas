#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

loadEnv();

const baseUrl = (
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const automationKey =
  process.env.AUTOMATION_KEY ??
  process.env.QA_AUTOMATION_KEY ??
  serviceKey;
const execute = process.argv.includes("--execute");
const projectArg = argument("project");
const fromArg = dateArgument("from");
const toArg = dateArgument("to");

if (!baseUrl || !serviceKey || !automationKey) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e AUTOMATION_KEY são obrigatórios.",
  );
}

const projectRef = new URL(baseUrl).hostname.split(".")[0];
if (
  execute &&
  process.env.FEEDBACK_METRICS_BACKFILL_ACK !== projectRef
) {
  throw new Error(
    `Defina FEEDBACK_METRICS_BACKFILL_ACK=${projectRef} para executar o backfill.`,
  );
}

const projects = await listProjects(projectArg);
const plan = [];
for (const project of projects) {
  const dates = await listRawEventDates(project.id);
  plan.push({
    project_id: project.id,
    project_name: project.name,
    first_date: dates[0] ?? null,
    last_date: dates.at(-1) ?? null,
    dates,
  });
}

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
  results.push({
    project_id: item.project_id,
    project_name: item.project_name,
    processed_dates: processedDates,
  });
}

console.log(JSON.stringify({
  mode: "execute",
  project_ref: projectRef,
  completed_at: new Date().toISOString(),
  results,
}, null, 2));

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

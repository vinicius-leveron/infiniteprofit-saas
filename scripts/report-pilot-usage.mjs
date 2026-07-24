#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

loadEnv();

const baseUrl = (
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const response = await fetch(
  `${baseUrl}/rest/v1/pilot_organization_usage?select=*&order=last_activity_at.desc`,
  {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  },
);
const organizations = await response.json().catch(() => []);
if (!response.ok) {
  throw new Error(`Falha ao consultar uso do piloto: HTTP ${response.status}`);
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  mode: "monitor_only",
  organization_count: organizations.length,
  totals: organizations.reduce(
    (summary, organization) => ({
      clients: summary.clients + Number(organization.client_count ?? 0),
      funnels: summary.funnels + Number(organization.funnel_count ?? 0),
      raw_events: summary.raw_events + Number(organization.raw_event_count ?? 0),
      sync_runs: summary.sync_runs + Number(organization.sync_run_count ?? 0),
      creative_jobs: summary.creative_jobs + Number(organization.creative_job_count ?? 0),
    }),
    { clients: 0, funnels: 0, raw_events: 0, sync_runs: 0, creative_jobs: 0 },
  ),
  organizations,
}, null, 2));

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

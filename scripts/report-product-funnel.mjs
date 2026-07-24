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
  `${baseUrl}/rest/v1/product_activation_funnel?select=*&order=funnel_created_at.asc`,
  {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  },
);
const rows = await response.json().catch(() => []);
if (!response.ok) {
  throw new Error(`Falha ao consultar funil de produto: HTTP ${response.status}`);
}

const total = rows.length;
const count = (field) => rows.filter((row) => Boolean(row[field])).length;
const durations = rows
  .map((row) => Number(row.seconds_to_first_signal))
  .filter((value) => Number.isFinite(value) && value >= 0)
  .sort((a, b) => a - b);
const conversion = (value) => total === 0 ? 0 : Number(((value / total) * 100).toFixed(1));

const cohorts = new Map();
for (const row of rows) {
  const cohort =
    String(row.setup_started_at ?? row.funnel_created_at ?? "").slice(0, 7) ||
    "unknown";
  const current = cohorts.get(cohort) ?? {
    cohort,
    setups: 0,
    funnels_created: 0,
    first_signal: 0,
    first_dashboard: 0,
  };
  current.setups += 1;
  if (row.project_id) current.funnels_created += 1;
  if (row.first_trusted_signal_at) current.first_signal += 1;
  if (row.first_dashboard_opened_at) current.first_dashboard += 1;
  cohorts.set(cohort, current);
}

const report = {
  generated_at: new Date().toISOString(),
  totals: {
    setups: total,
    funnels_created: count("project_id"),
    setup_started: count("setup_started_at"),
    source_prepared: count("source_prepared_at"),
    first_signal: count("first_trusted_signal_at"),
    activation_viewed: count("activation_viewed_at"),
    first_dashboard: count("first_dashboard_opened_at"),
  },
  conversion_percent: {
    funnel_created: conversion(count("project_id")),
    source_prepared: conversion(count("source_prepared_at")),
    first_signal: conversion(count("first_trusted_signal_at")),
    first_dashboard: conversion(count("first_dashboard_opened_at")),
  },
  abandonment: {
    before_funnel_created: rows.filter((row) => !row.project_id).length,
    before_source: rows.filter(
      (row) => row.project_id && !row.source_prepared_at,
    ).length,
    before_first_signal: rows.filter(
      (row) => row.source_prepared_at && !row.first_trusted_signal_at,
    ).length,
    before_dashboard: rows.filter(
      (row) => row.first_trusted_signal_at && !row.first_dashboard_opened_at,
    ).length,
  },
  seconds_to_first_signal: {
    samples: durations.length,
    average: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    median: durations.length ? durations[Math.floor(durations.length / 2)] : null,
  },
  cohorts: [...cohorts.values()].map((cohort) => ({
    ...cohort,
    funnel_created_conversion_percent:
      cohort.setups === 0
        ? 0
        : Number(((cohort.funnels_created / cohort.setups) * 100).toFixed(1)),
    first_signal_conversion_percent:
      cohort.setups === 0
        ? 0
        : Number(((cohort.first_signal / cohort.setups) * 100).toFixed(1)),
    first_dashboard_conversion_percent:
      cohort.setups === 0
        ? 0
        : Number(((cohort.first_dashboard / cohort.setups) * 100).toFixed(1)),
  })),
};

console.log(JSON.stringify(report, null, 2));

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

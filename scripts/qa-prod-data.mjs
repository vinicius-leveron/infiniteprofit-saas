#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { exitForResults, writeQaReport } from "./qa-common.mjs";

const rawDataSourcesSql = "'meta', 'vturb', 'gateway', 'sheet_override'";
const configuredProjectIds = process.env.QA_PROJECT_IDS?.trim();
const projectIds = configuredProjectIds
  ? configuredProjectIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : discoverProjectsWithData();
const shouldReprocess = process.argv.includes("--reprocess") || process.env.QA_REPROCESS === "1";
const forcedReprocessDates = parseDateList(process.env.QA_REPROCESS_DATES ?? "");
const results = [];
const projects = [];

for (const projectId of projectIds) {
  try {
    const summary = await auditProject(projectId);
    const reprocessDates = forcedReprocessDates.length > 0
      ? forcedReprocessDates
      : [...new Set([
          ...summary.missingDailyDates,
          ...summary.missingDimensionDates,
        ])].sort();
    if (shouldReprocess && reprocessDates.length > 0) {
      await reprocessProjectDates(projectId, reprocessDates);
      summary.afterReprocess = await auditProject(projectId);
    }
    projects.push(summary);
    results.push(...projectResults(summary.afterReprocess ?? summary));
  } catch (error) {
    results.push({
      name: `prod data audit ${projectId}`,
      status: "blocker",
      exitCode: 1,
      command: "supabase db query --linked",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stderr: error instanceof Error ? error.message : String(error),
    });
  }
}

try {
  const creative = runSql(`
    select status, count(*)::int as jobs
    from public.creative_asset_jobs
    where status in ('queued', 'running')
    group by status
    order by status;
  `);
  const running = creative.find((row) => row.status === "running");
  const queued = creative.find((row) => row.status === "queued");
  results.push({
    name: "creative transcription jobs are not running",
    status: Number(running?.jobs ?? 0) > 0 ? "blocker" : Number(queued?.jobs ?? 0) > 0 ? "warning" : "pass",
    exitCode: Number(running?.jobs ?? 0) > 0 ? 1 : 0,
    command: "select creative_asset_jobs queued/running",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    stdout: JSON.stringify({ queued: Number(queued?.jobs ?? 0), running: Number(running?.jobs ?? 0) }),
  });
} catch (error) {
  results.push({
    name: "creative transcription jobs are not running",
    status: "warning",
    exitCode: 0,
    command: "select creative_asset_jobs queued/running",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    stderr: error instanceof Error ? error.message : String(error),
  });
}

writeQaReport("qa-prod-data.json", {
  gate: "qa:prod:data",
  generatedAt: new Date().toISOString(),
  reprocess: shouldReprocess,
  reprocessDates: forcedReprocessDates,
  projectIds,
  projects,
  results,
});

exitForResults(results);

async function auditProject(projectId) {
  const [project] = runSql(`
    select id, name, source
    from public.projects
    where id = ${sqlString(projectId)}
    limit 1;
  `);
  if (!project) throw new Error(`Projeto ${projectId} não encontrado`);

  const rawBySource = runSql(`
    select source, count(*)::int as events, count(distinct event_date)::int as dates,
      min(event_date)::text as min_date, max(event_date)::text as max_date
    from public.raw_events
    where project_id = ${sqlString(projectId)}
      and source in (${rawDataSourcesSql})
    group by source
    order by source;
  `);
  const rawDates = runSql(`
    select distinct event_date::text as event_date
    from public.raw_events
    where project_id = ${sqlString(projectId)}
      and source in (${rawDataSourcesSql})
    order by event_date;
  `).map((row) => row.event_date);
  const dailyDates = runSql(`
    select event_date::text as event_date
    from public.daily_metrics
    where project_id = ${sqlString(projectId)}
    order by event_date;
  `).map((row) => row.event_date);
  const missingDailyDates = rawDates.filter((date) => !dailyDates.includes(date));
  const metaRawDates = runSql(`
    select distinct event_date::text as event_date
    from public.raw_events
    where project_id = ${sqlString(projectId)}
      and source = 'meta'
      and event_type = 'insight_ad'
      and nullif(payload ->> 'ad_id', '') is not null
    order by event_date;
  `).map((row) => row.event_date);
  const dimensionDates = runSql(`
    select distinct event_date::text as event_date
    from public.daily_ad_dimension_metrics
    where project_id = ${sqlString(projectId)}
    order by event_date;
  `).map((row) => row.event_date);
  const missingDimensionDates = metaRawDates.filter(
    (date) => !dimensionDates.includes(date),
  );
  const dimensionSummary = await waitForDimensionReconciliation(
    projectId,
    queryDimensionSummary(projectId),
  );
  const juneRows = runSql(`
    select event_date::text as event_date, investimento, imposto_meta, cliques, landing_pageviews, taxa_carreg,
      pageviews, views_unicas, chegaram_pitch, checkouts, vendas_totais, fat_bruto, fat_liquido, reembolsos
    from public.daily_metrics
    where project_id = ${sqlString(projectId)}
      and event_date between date '2026-06-01' and date '2026-06-30'
    order by event_date;
  `);
  const rawJuneDates = rawDates.filter((date) => date >= "2026-06-01" && date <= "2026-06-30");
  const day22 = juneRows.find((row) => row.event_date === "2026-06-22") ?? null;

  return {
    project,
    rawBySource,
    rawDates,
    dailyDates,
    missingDailyDates,
    metaRawDates,
    dimensionDates,
    missingDimensionDates,
    dimensionSummary,
    juneRows,
    rawJuneDates,
    day22,
  };
}

function queryDimensionSummary(projectId) {
  const [summary = {}] = runSql(`
    select
      pg_catalog.count(*)::int as rows,
      pg_catalog.count(distinct nullif(account_id, ''))::int as accounts,
      pg_catalog.count(distinct nullif(campaign_id, ''))::int as campaigns,
      pg_catalog.count(distinct nullif(adset_id, ''))::int as adsets,
      pg_catalog.count(distinct ad_id)::int as ads,
      coalesce(pg_catalog.sum(investimento), 0)::numeric as dimension_spend,
      coalesce((
        select pg_catalog.sum(
          coalesce(nullif(event.payload ->> 'spend', '')::numeric, 0)
        )
        from public.raw_events event
        where event.project_id = ${sqlString(projectId)}
          and event.source = 'meta'
          and event.event_type = 'insight_ad'
      ), 0)::numeric as raw_meta_spend
    from public.daily_ad_dimension_metrics
    where project_id = ${sqlString(projectId)};
  `);
  return summary;
}

async function waitForDimensionReconciliation(
  projectId,
  initialSummary,
  { attempts = 15, intervalMs = 2_000 } = {},
) {
  let summary = initialSummary;
  for (let attempt = 1; attempt < attempts && !spendMatches(summary); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    summary = queryDimensionSummary(projectId);
  }
  return summary;
}

function projectResults(summary) {
  const name = `${summary.project.name} (${summary.project.id})`;
  const output = JSON.stringify({
    rawSources: summary.rawBySource,
    rawDates: summary.rawDates.length,
    dailyDates: summary.dailyDates.length,
    missingDailyDates: summary.missingDailyDates,
    metaRawDates: summary.metaRawDates.length,
    dimensionDates: summary.dimensionDates.length,
    missingDimensionDates: summary.missingDimensionDates,
    dimensionSummary: summary.dimensionSummary,
    juneRows: summary.juneRows.length,
    day22: summary.day22,
  });
  const results = [
    {
      name: `${name}: raw_events have daily_metrics`,
      status: summary.missingDailyDates.length > 0 ? "blocker" : "pass",
      exitCode: summary.missingDailyDates.length > 0 ? 1 : 0,
      command: "raw date coverage",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: output,
    },
    {
      name: `${name}: Meta events have dashboard filter dimensions`,
      status: summary.missingDimensionDates.length > 0 ? "blocker" : "pass",
      exitCode: summary.missingDimensionDates.length > 0 ? 1 : 0,
      command: "Meta dimension date coverage",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: output,
    },
    {
      name: `${name}: dimensional spend reconciles with Meta events`,
      status: spendMatches(summary.dimensionSummary) ? "pass" : "blocker",
      exitCode: spendMatches(summary.dimensionSummary) ? 0 : 1,
      command: "Meta dimensional spend reconciliation",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: output,
    },
    {
      name: `${name}: June range is not collapsed to one day`,
      status: summary.rawJuneDates.length > 1 && summary.juneRows.length <= 1 ? "blocker" : "pass",
      exitCode: summary.rawJuneDates.length > 1 && summary.juneRows.length <= 1 ? 1 : 0,
      command: "June daily_metrics coverage",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: output,
    },
    {
      name: `${name}: 2026-06-22 appears when raw data exists`,
      status: summary.rawDates.includes("2026-06-22") && !summary.day22 ? "blocker" : "pass",
      exitCode: summary.rawDates.includes("2026-06-22") && !summary.day22 ? 1 : 0,
      command: "2026-06-22 daily row",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      stdout: output,
    },
  ];
  return results;
}

async function reprocessProjectDates(projectId, dates) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.QA_AUTOMATION_KEY || process.env.AUTOMATION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    await reprocessProjectDatesViaSql(projectId, dates);
    return;
  }
  const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/aggregate-daily`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ project_id: projectId, dates }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`aggregate-daily ${projectId} falhou: ${text || response.status}`);
  }
}

async function reprocessProjectDatesViaSql(projectId, dates) {
  const { aggregateOneDay } = await import("../supabase/functions/aggregate-daily/core.ts");
  const [project] = runSql(`
    select user_id, workspace_id
    from public.projects
    where id = ${sqlString(projectId)}
    limit 1;
  `);
  if (!project?.workspace_id) {
    throw new Error(`Projeto ${projectId} não encontrado para reprocessamento`);
  }

  const metricColumns = [
    "investimento",
    "imposto_meta",
    "impressoes",
    "cliques",
    "landing_pageviews",
    "cpm",
    "ctr",
    "cpc",
    "pageviews",
    "views_unicas",
    "play_rate",
    "ret_pitch",
    "chegaram_pitch",
    "checkouts",
    "custo_pageview",
    "custo_ic",
    "taxa_carreg",
    "pass_chk",
    "pitch_chk",
    "pitch_venda",
    "chk_venda",
    "vendas_front",
    "vendas_totais",
    "cpa_front",
    "cac",
    "aov",
    "roi",
    "lucro",
    "fat_bruto",
    "fat_liquido",
    "fat_front",
    "fat_orderbump",
    "fat_funil",
    "reembolsos",
    "taxa_reembolso",
    "valor_reembolsado",
    "aprov_cartao",
    "aprov_pix",
    "conv_geral_orderbump",
    "proporcao_funil_front",
    "bumps",
  ];
  const columns = ["project_id", "user_id", "workspace_id", "event_date", ...metricColumns];
  const rows = [];

  for (const date of dates) {
    const events = runSql(`
      select source, event_type, external_id, payload
      from public.raw_events
      where project_id = ${sqlString(projectId)}
        and event_date = date ${sqlString(date)}
        and source in (${rawDataSourcesSql})
      order by source, event_type, external_id;
    `);
    const metrics = aggregateOneDay(events);
    rows.push(`(${[
      `${sqlString(projectId)}::uuid`,
      `${sqlString(project.user_id)}::uuid`,
      `${sqlString(project.workspace_id)}::uuid`,
      `date ${sqlString(date)}`,
      ...metricColumns.map((column) => sqlMetricLiteral(metrics[column], column)),
    ].join(", ")})`);
  }

  if (rows.length === 0) return;

  const updates = metricColumns
    .map((column) => `${column} = excluded.${column}`)
    .concat("updated_at = now()")
    .join(",\n      ");
  runSql(`
    insert into public.daily_metrics (${columns.join(", ")})
    values
      ${rows.join(",\n      ")}
    on conflict (project_id, event_date) do update set
      ${updates};
  `);
  runSql(`
    select public.refresh_dashboard_ad_dimensions(
      ${sqlString(projectId)}::uuid,
      array[${dates.map((date) => `date ${sqlString(date)}`).join(", ")}]
    );
  `);
}

function spendMatches(summary) {
  const rawSpend = Number(summary?.raw_meta_spend ?? 0);
  const dimensionSpend = Number(summary?.dimension_spend ?? 0);
  return Number.isFinite(rawSpend)
    && Number.isFinite(dimensionSpend)
    && Math.abs(rawSpend - dimensionSpend) <= 0.01;
}

function runSql(sql) {
  const result = spawnSync("supabase", ["db", "query", "--linked", "-o", "json", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "supabase db query failed");
  }
  const jsonStart = Math.min(
    ...[result.stdout.indexOf("["), result.stdout.indexOf("{")].filter((index) => index >= 0),
  );
  if (!Number.isFinite(jsonStart)) return [];
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  return Array.isArray(parsed) ? parsed : parsed.rows ?? [];
}

function discoverProjectsWithData() {
  return runSql(`
    select project.id
    from public.projects project
    where exists (
      select 1
      from public.raw_events event
      where event.project_id = project.id
        and event.source in (${rawDataSourcesSql})
    )
    order by project.created_at;
  `).map((row) => row.id);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlMetricLiteral(value, column) {
  if (column === "bumps") {
    return `${sqlString(JSON.stringify(Array.isArray(value) ? value : []))}::jsonb`;
  }
  if (value === null || value === undefined || value === "") return "null";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "null";
  return String(numberValue);
}

function parseDateList(value) {
  if (!value.trim()) return [];
  return [...new Set(value
    .split(",")
    .flatMap((part) => expandDatePart(part.trim()))
    .filter(Boolean))]
    .sort();
}

function expandDatePart(value) {
  if (!value) return [];
  const rangeMatch = value.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (!rangeMatch) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? [value] : [];

  const [, start, end] = rangeMatch;
  const dates = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

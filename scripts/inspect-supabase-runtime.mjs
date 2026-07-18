import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectRef =
  process.env.SUPABASE_PROJECT_REF ?? "nztnctrkmfrgclrnflfa";
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();

async function runReadOnlyQuery(name, query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await response.json().catch(() => null);
  return {
    name,
    status: response.status,
    result: response.ok ? body : null,
    error: response.ok
      ? null
      : redact(body?.message ?? body?.error ?? response.statusText),
  };
}

const end = new Date();
const start = new Date(end.getTime() - 30 * 60 * 1000);
const query = `
  select timestamp, event_message, metadata
  from postgres_logs
  where regexp_contains(
    event_message,
    'connection|timeout|remaining connection|out of memory|terminating connection|FATAL|PANIC'
  )
  order by timestamp desc
  limit 12
`;

const url = new URL(
  `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all`,
);
url.searchParams.set("sql", query);
url.searchParams.set("iso_timestamp_start", start.toISOString());
url.searchParams.set("iso_timestamp_end", end.toISOString());

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const body = await response.json();
const rows = Array.isArray(body.result) ? body.result : [];
const redact = (value) =>
  String(value ?? "")
    .replaceAll(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replaceAll(/sb[p_-][A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replaceAll(/'[^']{8,}'/g, "'[REDACTED]'")
    .slice(0, 700);

const findField = (value, field) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findField(item, field);
      if (result !== undefined) return result;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    if (Object.hasOwn(value, field)) return value[field];
    for (const nested of Object.values(value)) {
      const result = findField(nested, field);
      if (result !== undefined) return result;
    }
  }
  return undefined;
};

const safeRows = rows.map((row) => ({
  timestamp: row.timestamp,
  event_message: redact(row.event_message),
  user_name: redact(findField(row.metadata, "user_name")),
  query: redact(findField(row.metadata, "query")),
  detail: redact(findField(row.metadata, "detail")),
  sql_state_code: redact(findField(row.metadata, "sql_state_code")),
}));

console.log(
  JSON.stringify(
    {
      status: response.status,
      error: body.error ?? null,
      count: safeRows.length,
      rows: safeRows,
    },
    null,
    2,
  ),
);

const databaseCheckDefinitions = [
  [
    "connections",
    `
      select
        current_setting('max_connections')::integer as max_connections,
        count(*) as total_connections,
        count(*) filter (where state = 'active') as active_connections,
        count(*) filter (where wait_event is not null) as waiting_connections
      from pg_catalog.pg_stat_activity
      where datname = current_database()
    `,
  ],
  [
    "cron_jobs",
    `
      select jobid, jobname, schedule, active
      from cron.job
      where jobid in (25, 26, 27)
      order by jobid
    `,
  ],
  [
    "critical_indexes",
    `
      select schemaname, tablename, indexname
      from pg_catalog.pg_indexes
      where schemaname = 'public'
        and tablename in ('raw_events', 'sync_runs')
      order by tablename, indexname
    `,
  ],
  [
    "wait_events",
    `
      select
        coalesce(wait_event_type, 'none') as wait_event_type,
        coalesce(wait_event, 'none') as wait_event,
        coalesce(state, 'none') as state,
        count(*) as connections
      from pg_catalog.pg_stat_activity
      where datname = current_database()
      group by wait_event_type, wait_event, state
      order by count(*) desc
    `,
  ],
  [
    "critical_index_health",
    `
      select
        table_class.relname as table_name,
        index_class.relname as index_name,
        index.indisvalid as is_valid,
        index.indisready as is_ready,
        pg_catalog.pg_get_indexdef(index.indexrelid) as definition
      from pg_catalog.pg_index as index
      join pg_catalog.pg_class as index_class
        on index_class.oid = index.indexrelid
      join pg_catalog.pg_class as table_class
        on table_class.oid = index.indrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = table_class.relnamespace
      where namespace.nspname = 'public'
        and table_class.relname in ('raw_events', 'sync_runs')
      order by table_class.relname, index_class.relname
    `,
  ],
  [
    "critical_table_stats",
    `
      select
        relname as table_name,
        n_live_tup as estimated_live_rows,
        n_dead_tup as estimated_dead_rows,
        seq_scan,
        idx_scan,
        last_analyze,
        last_autoanalyze,
        last_autovacuum
      from pg_catalog.pg_stat_user_tables
      where schemaname = 'public'
        and relname in ('raw_events', 'sync_runs', 'sync_jobs')
      order by relname
    `,
  ],
];

const databaseChecks = [];
for (const [name, queryText] of databaseCheckDefinitions) {
  databaseChecks.push(await runReadOnlyQuery(name, queryText));
}

console.log(JSON.stringify({ database_checks: databaseChecks }, null, 2));

if (!response.ok || databaseChecks.some((check) => check.status >= 400)) {
  process.exitCode = 1;
}

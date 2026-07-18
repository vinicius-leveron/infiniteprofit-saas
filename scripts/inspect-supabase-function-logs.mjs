import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectRef =
  process.env.SUPABASE_PROJECT_REF ?? "nztnctrkmfrgclrnflfa";
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();
const end = new Date();
const start = new Date(end.getTime() - 15 * 60 * 1000);
const query = `
  select timestamp, event_message
  from function_logs
  where regexp_contains(
    event_message,
    'sync_scheduler|sync_worker|sync_watchdog|gateway_webhook'
  )
  order by timestamp desc
  limit 30
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
const safeRows = rows.map((row) => ({
  timestamp: row.timestamp,
  event_message: String(row.event_message ?? "")
    .replaceAll(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replaceAll(/sb[p_-][A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .slice(0, 1_000),
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

if (!response.ok || body.error) {
  process.exitCode = 1;
}

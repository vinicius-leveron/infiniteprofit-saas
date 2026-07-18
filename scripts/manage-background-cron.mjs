import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const action = process.argv[2];
if (!["status", "pause", "resume"].includes(action)) {
  console.error("Uso: node scripts/manage-background-cron.mjs status|pause|resume");
  process.exit(2);
}

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!projectRef) {
  console.error("SUPABASE_PROJECT_REF é obrigatório.");
  process.exit(2);
}

if (
  action !== "status" &&
  process.env.BACKGROUND_CRON_PRODUCTION_ACK !== projectRef
) {
  console.error(
    "Defina BACKGROUND_CRON_PRODUCTION_ACK com o project ref para alterar produção.",
  );
  process.exit(2);
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();
const endpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const jobNames = [
  "sync-scheduler-projects",
  "sync-worker-projects",
  "sync-watchdog-projects",
];
const quotedJobNames = jobNames.map((name) => `'${name}'`).join(", ");

async function runQuery(query, readOnly) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message ?? body?.error ?? response.statusText;
    throw new Error(`Supabase ${response.status}: ${message}`);
  }
  return body;
}

async function getStatus() {
  return await runQuery(
    `
      select jobid, jobname, schedule, active
      from cron.job
      where jobname in (${quotedJobNames})
      order by jobname
    `,
    true,
  );
}

const before = await getStatus();
if (before.length !== jobNames.length) {
  throw new Error(
    `Esperava ${jobNames.length} jobs, encontrei ${before.length}. Nenhuma alteração foi feita.`,
  );
}

if (action !== "status") {
  const active = action === "resume";
  await runQuery(
    `
      select cron.alter_job(jobid, active := ${active})
      from cron.job
      where jobname in (${quotedJobNames})
    `,
    false,
  );
}

const after = action === "status" ? before : await getStatus();
const expectedActive = action === "pause" ? false : action === "resume" ? true : null;
const verified =
  expectedActive === null ||
  after.length === jobNames.length &&
    after.every((job) => job.active === expectedActive);

console.log(JSON.stringify({ action, verified, before, after }, null, 2));

if (!verified) {
  process.exitCode = 1;
}

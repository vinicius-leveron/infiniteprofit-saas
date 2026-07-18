#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const productionProjectRef = "nztnctrkmfrgclrnflfa";
const mode = process.argv[2];
if (!["capture-baseline", "verify"].includes(mode)) {
  console.error(
    "Uso: node scripts/verify-restore-drill.mjs capture-baseline|verify",
  );
  process.exit(2);
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();

if (mode === "capture-baseline") {
  const projectRef =
    process.env.SUPABASE_PROJECT_REF?.trim() || productionProjectRef;
  const snapshot = await getSnapshot(projectRef);
  console.log(JSON.stringify({
    schema_version: 1,
    kind: "restore_baseline",
    source_project_ref: projectRef,
    captured_at: new Date().toISOString(),
    ...snapshot,
  }, null, 2));
  process.exit(0);
}

const restoreProjectRef = required("RESTORE_PROJECT_REF");
if (restoreProjectRef === productionProjectRef) {
  throw new Error(
    "O restore drill recusa o project ref de produção. Use um projeto isolado.",
  );
}
const baselinePath = required("RESTORE_BASELINE_REPORT");
const artifactUrl = required("RESTORE_ARTIFACT_URL");
const startedAt = parseTimestamp(required("RESTORE_DRILL_STARTED_AT"));
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
if (
  baseline?.schema_version !== 1 ||
  baseline?.kind !== "restore_baseline"
) {
  throw new Error("RESTORE_BASELINE_REPORT não tem o contrato esperado.");
}

const restored = await getSnapshot(restoreProjectRef);
const countKeys = [
  "organizations",
  "workspaces",
  "projects",
  "raw_events",
  "daily_metrics",
  "sync_runs",
];
const bindingKeys = [
  "workspace_meta_accounts",
  "workspace_vturb_players",
  "project_meta_accounts",
  "project_vturb_players",
  "project_checkout_bindings",
];
const countDifferences = differences(
  baseline.counts,
  restored.counts,
  countKeys,
);
const bindingDifferences = differences(
  baseline.bindings,
  restored.bindings,
  bindingKeys,
);
const migrationsVerified =
  baseline.latest_migration === restored.latest_migration;

if (countDifferences.length > 0) {
  throw new Error(
    `Restore divergiu nas contagens: ${countDifferences.join(", ")}`,
  );
}
if (bindingDifferences.length > 0) {
  throw new Error(
    `Restore divergiu nos vínculos: ${bindingDifferences.join(", ")}`,
  );
}
if (!migrationsVerified) {
  throw new Error(
    `Migration divergiu: baseline=${baseline.latest_migration}, restore=${restored.latest_migration}`,
  );
}

await verifyRawEventIdempotency(restoreProjectRef);
const completedAt = new Date();
const rtoMinutes = Math.round(
  (completedAt.getTime() - startedAt.getTime()) / 60_000,
);

console.log(JSON.stringify({
  schema_version: 1,
  environment: "isolated_restore",
  source_project_ref: baseline.source_project_ref,
  restore_project_ref: restoreProjectRef,
  baseline_captured_at: baseline.captured_at,
  completed_at: completedAt.toISOString(),
  counts: restored.counts,
  bindings: restored.bindings,
  bindings_verified: true,
  migrations_verified: true,
  idempotency_verified: true,
  rto_minutes: rtoMinutes,
  artifact_url: artifactUrl,
}, null, 2));

async function getSnapshot(projectRef) {
  const rows = await runQuery(projectRef, `
    select pg_catalog.jsonb_build_object(
      'counts', pg_catalog.jsonb_build_object(
        'organizations', (select pg_catalog.count(*) from public.organizations),
        'workspaces', (select pg_catalog.count(*) from public.workspaces),
        'projects', (select pg_catalog.count(*) from public.projects),
        'raw_events', (select pg_catalog.count(*) from public.raw_events),
        'daily_metrics', (select pg_catalog.count(*) from public.daily_metrics),
        'sync_runs', (select pg_catalog.count(*) from public.sync_runs)
      ),
      'bindings', pg_catalog.jsonb_build_object(
        'workspace_meta_accounts',
          (select pg_catalog.count(*) from public.workspace_meta_accounts),
        'workspace_vturb_players',
          (select pg_catalog.count(*) from public.workspace_vturb_players),
        'project_meta_accounts',
          (select pg_catalog.count(*) from public.project_meta_accounts),
        'project_vturb_players',
          (select pg_catalog.count(*) from public.project_vturb_players),
        'project_checkout_bindings',
          (select pg_catalog.count(*) from public.project_checkout_bindings)
      ),
      'latest_migration', (
        select pg_catalog.max(version)
        from supabase_migrations.schema_migrations
      )
    ) as snapshot
  `, true);
  return rows[0]?.snapshot ?? {};
}

async function verifyRawEventIdempotency(projectRef) {
  await runQuery(projectRef, `
    begin;
    set local statement_timeout = '10s';
    do $drill$
    declare
      target_project record;
      test_external_id text := 'restore-drill-' || pg_catalog.gen_random_uuid()::text;
      matching_rows integer;
    begin
      select project.id, project.user_id, project.workspace_id
      into target_project
      from public.projects project
      where project.workspace_id is not null
      order by project.created_at
      limit 1;

      if target_project.id is null then
        raise exception 'Restore não contém projeto elegível para idempotência';
      end if;

      insert into public.raw_events (
        project_id,
        workspace_id,
        user_id,
        source,
        event_type,
        event_date,
        event_occurred_at,
        external_id,
        payload
      )
      values (
        target_project.id,
        target_project.workspace_id,
        target_project.user_id,
        'gateway',
        'restore.drill',
        current_date,
        pg_catalog.now(),
        test_external_id,
        '{"restore_drill": true}'::jsonb
      )
      on conflict (project_id, source, event_type, external_id)
      do update set payload = excluded.payload;

      insert into public.raw_events (
        project_id,
        workspace_id,
        user_id,
        source,
        event_type,
        event_date,
        event_occurred_at,
        external_id,
        payload
      )
      values (
        target_project.id,
        target_project.workspace_id,
        target_project.user_id,
        'gateway',
        'restore.drill',
        current_date,
        pg_catalog.now(),
        test_external_id,
        '{"restore_drill": true}'::jsonb
      )
      on conflict (project_id, source, event_type, external_id)
      do update set payload = excluded.payload;

      select pg_catalog.count(*)::integer
      into matching_rows
      from public.raw_events
      where project_id = target_project.id
        and source = 'gateway'
        and event_type = 'restore.drill'
        and external_id = test_external_id;

      if matching_rows <> 1 then
        raise exception 'Idempotência falhou: % linhas', matching_rows;
      end if;
    end
    $drill$;
    rollback;
  `, false);
}

async function runQuery(projectRef, query, readOnly) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query${
    readOnly ? "/read-only" : ""
  }`;
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
    throw new Error(
      `Supabase ${response.status}: ${
        String(body?.message ?? body?.error ?? response.statusText).slice(0, 500)
      }`,
    );
  }
  return Array.isArray(body) ? body : [];
}

function differences(expected, actual, keys) {
  return keys.flatMap((key) => {
    const before = Number(expected?.[key]);
    const after = Number(actual?.[key]);
    return Number.isFinite(before) && before === after
      ? []
      : [`${key}:${before}->${after}`];
  });
}

function parseTimestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("RESTORE_DRILL_STARTED_AT é inválido.");
  }
  return parsed;
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

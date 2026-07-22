#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectRef = required("SUPABASE_PROJECT_REF");
const execute = process.argv.includes("--execute");
if (
  execute &&
  process.env.VTURB_DLQ_RECOVERY_ACK !== projectRef
) {
  throw new Error(
    "Defina VTURB_DLQ_RECOVERY_ACK com o project ref para recuperar a DLQ.",
  );
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();
const readOnlyEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`;
const writeEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const staleWorkerError =
  "Job destravado automaticamente por timeout do worker.";

const auditRows = await runQuery(
  readOnlyEndpoint,
  auditSql(),
  true,
);
const audit = auditRows[0] ?? {};

if (!execute) {
  console.log(JSON.stringify({ mode: "dry_run", ...audit }, null, 2));
  process.exit(0);
}

if (Number(audit.unexpected_error_jobs ?? 0) > 0) {
  throw new Error(
    "A DLQ contém erros fora do incidente conhecido; recuperação cancelada.",
  );
}
if (Number(audit.orphaned_binding_jobs ?? 0) > 0) {
  throw new Error(
    "A DLQ contém bindings removidos; recuperação cancelada.",
  );
}

const recoveryRows = await runQuery(
  writeEndpoint,
  recoverySql(),
  false,
);
const recovery = recoveryRows[0] ?? {};

const verificationRows = await runQuery(
  readOnlyEndpoint,
  auditSql(),
  true,
);
const verification = verificationRows[0] ?? {};
const expectedRemaining =
  Number(audit.total_dead_letters ?? 0) -
  Number(recovery.requeued ?? 0) -
  Number(recovery.resolved_superseded ?? 0);

if (
  Number(verification.total_dead_letters ?? -1) !== expectedRemaining
) {
  throw new Error(
    "A contagem da DLQ após a recuperação não corresponde ao esperado.",
  );
}

console.log(
  JSON.stringify(
    {
      mode: "execute",
      before: audit,
      recovery,
      after: verification,
      verified: true,
    },
    null,
    2,
  ),
);

function auditSql() {
  return `
    with dead as (
      select job.*
      from public.sync_jobs job
      where job.status = 'dead_letter'
        and job.source = 'vturb'
    ),
    classified as (
      select
        dead.id,
        coalesce(
          dead.payload -> 'failure' ->> 'kind',
          ''
        ) as failure_kind,
        dead.last_error = ${sqlText(staleWorkerError)}
          and coalesce(
            dead.payload -> 'failure' ->> 'kind',
            ''
          ) not in ('permanent', 'superseded') as known_error,
        exists (
          select 1
          from public.workspace_vturb_players player
          where player.workspace_id = dead.workspace_id
            and player.player_id = dead.entity_id
        ) as binding_exists,
        exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = dead.project_id
            and newer.source = dead.source
            and newer.entity_type = dead.entity_type
            and newer.entity_id = dead.entity_id
            and newer.status = 'succeeded'
            and newer.date_end > dead.date_end
            and newer.finished_at > dead.updated_at
        ) as superseded,
        dead.date_end >= (
          pg_catalog.now() at time zone 'America/Sao_Paulo'
        )::date as current_window
      from dead
    )
    select
      (select pg_catalog.count(*) from dead)::bigint as total_dead_letters,
      pg_catalog.count(*) filter (
        where failure_kind = 'permanent'
      )::bigint as permanent_jobs,
      pg_catalog.count(*) filter (
        where failure_kind = 'superseded'
      )::bigint as classified_superseded_jobs,
      pg_catalog.count(*) filter (
        where known_error and binding_exists and superseded
      )::bigint as superseded_candidates,
      pg_catalog.count(*) filter (
        where known_error
          and binding_exists
          and not superseded
          and current_window
      )::bigint as requeue_candidates,
      pg_catalog.count(*) filter (
        where failure_kind not in ('permanent', 'superseded')
          and not known_error
      )::bigint as unexpected_error_jobs,
      pg_catalog.count(*) filter (
        where known_error and not binding_exists
      )::bigint as orphaned_binding_jobs,
      pg_catalog.count(*) filter (
        where known_error
          and binding_exists
          and not superseded
          and not current_window
      )::bigint as manual_review_jobs
    from classified
  `;
}

function recoverySql() {
  return `
    with superseded as (
      select dead.id
      from public.sync_jobs dead
      where dead.status = 'dead_letter'
        and dead.source = 'vturb'
        and dead.last_error = ${sqlText(staleWorkerError)}
        and exists (
          select 1
          from public.workspace_vturb_players player
          where player.workspace_id = dead.workspace_id
            and player.player_id = dead.entity_id
        )
        and exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = dead.project_id
            and newer.source = dead.source
            and newer.entity_type = dead.entity_type
            and newer.entity_id = dead.entity_id
            and newer.status = 'succeeded'
            and newer.date_end > dead.date_end
            and newer.finished_at > dead.updated_at
        )
      for update skip locked
    ),
    resolved as (
      update public.sync_jobs job
      set
        status = 'succeeded',
        locked_at = null,
        locked_by = null,
        last_error = null,
        finished_at = pg_catalog.now(),
        payload = job.payload || pg_catalog.jsonb_build_object(
          'recovery',
          pg_catalog.jsonb_build_object(
            'resolution', 'superseded_by_newer_window',
            'resolved_at', pg_catalog.now(),
            'previous_error', ${sqlText(staleWorkerError)}
          )
        )
      from superseded
      where job.id = superseded.id
      returning job.id
    ),
    recoverable_locked as (
      select
        dead.id,
        dead.priority,
        dead.date_end,
        dead.created_at
      from public.sync_jobs dead
      where dead.status = 'dead_letter'
        and dead.source = 'vturb'
        and dead.last_error = ${sqlText(staleWorkerError)}
        and dead.date_end >= (
          pg_catalog.now() at time zone 'America/Sao_Paulo'
        )::date
        and exists (
          select 1
          from public.workspace_vturb_players player
          where player.workspace_id = dead.workspace_id
            and player.player_id = dead.entity_id
        )
        and not exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = dead.project_id
            and newer.source = dead.source
            and newer.entity_type = dead.entity_type
            and newer.entity_id = dead.entity_id
            and newer.status = 'succeeded'
            and newer.date_end > dead.date_end
            and newer.finished_at > dead.updated_at
      )
      for update skip locked
    ),
    recoverable as (
      select
        locked.id,
        pg_catalog.row_number() over (
          order by
            locked.priority asc,
            locked.date_end desc,
            locked.created_at asc,
            locked.id asc
        ) as recovery_order
      from recoverable_locked locked
    ),
    requeued as (
      update public.sync_jobs job
      set
        status = 'queued',
        attempt_count = 0,
        available_at = pg_catalog.now() + pg_catalog.make_interval(
          mins => (
            ((recoverable.recovery_order - 1) / 4)::integer * 2
          )
        ),
        locked_at = null,
        locked_by = null,
        last_error = null,
        finished_at = null,
        payload = job.payload || pg_catalog.jsonb_build_object(
          'recovery',
          pg_catalog.jsonb_build_object(
            'resolution', 'requeued_after_singleton_rollout',
            'scheduled_at', pg_catalog.now(),
            'previous_error', ${sqlText(staleWorkerError)}
          )
        )
      from recoverable
      where job.id = recoverable.id
      returning job.available_at
    )
    select
      (select pg_catalog.count(*) from resolved)::bigint
        as resolved_superseded,
      (select pg_catalog.count(*) from requeued)::bigint
        as requeued,
      (select pg_catalog.min(available_at) from requeued)
        as first_available_at,
      (select pg_catalog.max(available_at) from requeued)
        as last_available_at
  `;
}

async function runQuery(endpoint, query, readOnly) {
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

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function required(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

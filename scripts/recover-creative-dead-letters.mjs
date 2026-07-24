#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const projectRef = required("SUPABASE_PROJECT_REF");
const execute = process.argv.includes("--execute");
if (execute && process.env.CREATIVE_DLQ_RECOVERY_ACK !== projectRef) {
  throw new Error(
    "Defina CREATIVE_DLQ_RECOVERY_ACK com o project ref para recuperar a DLQ.",
  );
}

const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ??
  (await readFile(join(homedir(), ".supabase", "access-token"), "utf8")).trim();
const readOnlyEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`;
const writeEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const before = (await runQuery(readOnlyEndpoint, auditSql()))[0] ?? {};
if (!execute) {
  console.log(JSON.stringify({ mode: "dry_run", ...before }, null, 2));
  process.exit(0);
}
if (Number(before.manual_review_jobs ?? 0) > 0) {
  throw new Error("Há jobs de criativos que exigem revisão manual; recuperação cancelada.");
}

const recovery = (await runQuery(writeEndpoint, recoverySql()))[0] ?? {};
const after = (await runQuery(readOnlyEndpoint, auditSql()))[0] ?? {};
if (Number(after.unclassified_jobs ?? -1) !== 0) {
  throw new Error("A recuperação terminou com jobs de criativos ainda não classificados.");
}

console.log(JSON.stringify({
  mode: "execute",
  before,
  recovery,
  after,
  verified: true,
}, null, 2));

function auditSql() {
  return `
    with dead as (
      select
        job.*,
        exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = job.project_id
            and newer.source = job.source
            and newer.entity_type = job.entity_type
            and newer.entity_id = job.entity_id
            and newer.id <> job.id
            and newer.status = 'succeeded'
            and newer.finished_at > job.updated_at
        ) as later_success,
        exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = job.project_id
            and newer.source = job.source
            and newer.entity_type = job.entity_type
            and newer.entity_id = job.entity_id
            and newer.id <> job.id
            and newer.status in ('queued', 'running')
        ) as active_replacement
      from public.sync_jobs job
      where job.status = 'dead_letter'
        and job.source = 'creative'
        and coalesce(job.payload -> 'failure' ->> 'kind', '') = 'retryable'
    )
    select
      pg_catalog.count(*)::bigint as unclassified_jobs,
      pg_catalog.count(*) filter (
        where later_success
      )::bigint as superseded_candidates,
      pg_catalog.count(*) filter (
        where not later_success
          and not active_replacement
          and date_end >= (
            pg_catalog.now() at time zone 'America/Sao_Paulo'
          )::date
      )::bigint as requeue_candidates,
      pg_catalog.count(*) filter (
        where not later_success
          and (
            active_replacement
            or date_end < (
              pg_catalog.now() at time zone 'America/Sao_Paulo'
            )::date
          )
      )::bigint as manual_review_jobs
    from dead;
  `;
}

function recoverySql() {
  return `
    with dead as (
      select job.*
      from public.sync_jobs job
      where job.status = 'dead_letter'
        and job.source = 'creative'
        and coalesce(job.payload -> 'failure' ->> 'kind', '') = 'retryable'
      for update skip locked
    ),
    superseded as (
      update public.sync_jobs job
      set payload = pg_catalog.jsonb_set(
        job.payload,
        '{failure,kind}',
        '"superseded"'::jsonb,
        true
      ) || pg_catalog.jsonb_build_object(
        'recovery',
        pg_catalog.jsonb_build_object(
          'resolution', 'superseded_by_later_success',
          'resolved_at', pg_catalog.now()
        )
      )
      from dead
      where job.id = dead.id
        and exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = dead.project_id
            and newer.source = dead.source
            and newer.entity_type = dead.entity_type
            and newer.entity_id = dead.entity_id
            and newer.id <> dead.id
            and newer.status = 'succeeded'
            and newer.finished_at > dead.updated_at
        )
      returning job.id
    ),
    requeued as (
      update public.sync_jobs job
      set
        status = 'queued',
        attempt_count = 0,
        available_at = pg_catalog.now(),
        locked_at = null,
        locked_by = null,
        finished_at = null,
        last_error = null,
        payload = (job.payload #- '{failure}') || pg_catalog.jsonb_build_object(
          'recovery',
          pg_catalog.jsonb_build_object(
            'resolution', 'retry_current_window_once',
            'requeued_at', pg_catalog.now()
          )
        )
      from dead
      where job.id = dead.id
        and not exists (select 1 from superseded where superseded.id = dead.id)
        and dead.date_end >= (
          pg_catalog.now() at time zone 'America/Sao_Paulo'
        )::date
        and not exists (
          select 1
          from public.sync_jobs newer
          where newer.project_id = dead.project_id
            and newer.source = dead.source
            and newer.entity_type = dead.entity_type
            and newer.entity_id = dead.entity_id
            and newer.id <> dead.id
            and newer.status in ('queued', 'running', 'succeeded')
            and (
              newer.status <> 'succeeded'
              or newer.finished_at > dead.updated_at
            )
        )
      returning job.id
    )
    select
      (select pg_catalog.count(*) from superseded)::bigint as classified_superseded,
      (select pg_catalog.count(*) from requeued)::bigint as requeued;
  `;
}

async function runQuery(endpoint, query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Supabase query failed with HTTP ${response.status}.`);
  }
  return Array.isArray(body) ? body : [];
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

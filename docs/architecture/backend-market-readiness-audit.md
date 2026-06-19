# InfiniteProfit Backend Market Readiness Audit

Data: 2026-06-18
Escopo: SaaS publico para ate 1.000 clientes/workspaces
Foco principal: confiabilidade de sync, seguranca multi-tenant e prontidao operacional

## 1. Executive summary

InfiniteProfit ja tem uma base real de SaaS: React/Vite no frontend, Supabase Auth, Postgres com RLS, Edge Functions, automacao via `pg_cron`/`pg_net`, worker Docker no Render e um modelo multi-tenant com `organizations`, `workspaces` e `projects`.

O sistema ainda nao esta pronto para abertura publica self-service. O bloqueador principal nao e a ausencia de funcionalidades, mas o hardening operacional: funcoes privilegiadas expostas no schema `public`, duplicidade de cron em producao, secrets operacionais legiveis pelo frontend para membros de workspace, fila de criativos com backlog/falhas, e drift entre o ambiente produtivo e o repositorio.

Recomendacao de decisao: nao abrir onboarding publico ate concluir os itens P0 e P1 deste documento. Para piloto controlado, seria possivel operar com usuarios selecionados desde que haja monitoramento manual diario e sem ampliar permissoes de membros nao-admin.

## 2. Architecture map

### Runtime and deployment

- Frontend: Vite + React + TypeScript, deploy statico no Render em `https://infiniteprofit-saas.onrender.com`.
- Backend principal: Supabase Auth, Postgres, RLS, Storage e Edge Functions.
- Automacao: `pg_cron` chama Edge Functions por HTTP via `pg_net`.
- Worker externo: `workers/creative-processor`, Docker no Render, usa `SUPABASE_SERVICE_ROLE_KEY`.
- Testes: Vitest, Playwright, testes de contrato contra Edge Functions, scripts auxiliares em `scripts/`.

### Tenancy and data model

- `organizations`: conta/agencia/empresa.
- `workspaces`: cliente ou operacao isolada dentro de uma organizacao.
- `projects`: funis/ofertas dentro do workspace.
- Tabelas operacionais centrais: `raw_events`, `daily_metrics`, `sync_runs`, `operational_alerts`.
- Integracoes por workspace: `workspace_integrations`, `workspace_meta_accounts`, `workspace_vturb_players`.
- Bindings por projeto: `project_meta_accounts`, `project_vturb_players`, `project_checkout_bindings`.
- Criativos: `creative_assets`, `creative_asset_ads`, `creative_asset_daily_metrics`, `creative_asset_analysis`, `creative_asset_jobs`.

### Main data flows

- Meta pull: cron/manual -> `meta-pull` -> Meta Graph API -> `raw_events` -> `aggregate-daily` -> `daily_metrics` -> `creative-sync`.
- VTurb pull: cron/manual -> `vturb-pull` -> VTurb Analytics API -> `raw_events` -> `aggregate-daily`.
- Checkout webhook: provider -> `webhook-gateway/:provider/:token` -> signature validation -> `raw_events` -> `aggregate-daily`.
- Creative pipeline: `creative-sync` resolves assets from Meta/raw events -> queues `creative_asset_jobs` -> Render worker processes media/transcription/analysis -> updates assets and analysis.
- Public share: `/share/:token` -> `public-share` function -> project metadata and `daily_metrics`.

## 3. Evidence baseline

### Local baseline

- `npm test`: passed, 22 test files, 66 tests. Positive contract tests for production were skipped when QA env vars were absent.
- `npm run lint`: passed with 0 errors and 16 warnings. Warnings are mostly React hook dependencies and Fast Refresh exports.
- `npm run build`: passed. Vite warned that the main JS chunk is about 2.1 MB minified and that Browserslist data is stale.
- `npm run e2e`: passed for available public-route smoke tests, 4 passed and 10 skipped because auth/project/public-share QA env vars were absent.
- Git/deploy state after the 2026-06-19 deployment pass: branch `main` was rebased onto `origin/main` and pushed through application commit `14431f8`. Supabase Edge Functions were deployed separately with `supabase functions deploy --use-api`. Database migrations were applied with `supabase db push --include-all`, and a post-deploy dry-run confirmed the remote database is up to date.

### Production baseline

Read-only production checks used the linked Supabase project `nztnctrkmfrgclrnflfa`, Postgres 17, region `us-west-2`.

- Edge Functions active in production: initial audit found `hubla-csv-import` deployed without local source; after integrating `origin/main` on 2026-06-19, it is present in the repo-managed function manifest. The latest drift check passed after deploying 17 repo-managed functions.
- Cron jobs active in production:
  - `sync-meta-projects`: `0 * * * *`
  - `sync-vturb-projects`: `*/30 * * * *`
  - `daily-meta-pull`: `0 6 * * *`
  - `daily-creative-sync-morning`: `30 6 * * *`
  - `daily-creative-sync-midday`: `0 12 * * *`
  - `daily-creative-sync-evening`: `0 18 * * *`
- Storage buckets: `creative-assets` exists and is public.
- Production table counts sampled:
  - `organizations`: 9
  - `workspaces`: 7
  - `projects`: 4
  - `raw_events`: 9060
  - `daily_metrics`: 216
  - `creative_assets`: 168
  - `creative_asset_jobs`: 346
- `sync_runs` sampled:
  - `meta`: 619 succeeded, 1678 failed
  - `vturb`: 1678 succeeded, 2356 failed
  - `gateway`: 1126 succeeded
  - `creative`: 46 succeeded, 68 failed
- `creative_asset_jobs` sampled:
  - `failed`: 291
  - `queued`: 39
  - `succeeded`: 16
- `creative_assets` storage coverage sampled on 2026-06-18:
  - total assets: 168
  - with `media_storage_path`: 13
  - with `poster_storage_path`: 99
  - with public `thumbnail_url` under `creative-assets`: 93
  - with public `source_media_url` under `creative-assets`: 54
- Supabase advisor summary:
  - `anon_security_definer_function_executable`: 8
  - `authenticated_security_definer_function_executable`: 8
  - `function_search_path_mutable`: 1
  - `auth_leaked_password_protection`: 1
  - `auth_rls_initplan`: 34
  - `unindexed_foreign_keys`: 14 in the initial audit sample; a refreshed performance advisor run on 2026-06-18 no longer returned this finding at warn level.
  - `unused_index`: 12
  - `multiple_permissive_policies`: 1
- Refreshed performance advisor summary on 2026-06-18:
  - `auth_rls_initplan`: 34
  - `multiple_permissive_policies`: 1
  - `unindexed_foreign_keys`: 0 returned in the current warn-level output.
- Post-migration advisor summary on 2026-06-19:
  - security: only `auth_leaked_password_protection` remains at warn level.
  - performance: no warn-level issues found.

## 4. Findings

### P0. Privileged RPCs are exposed through the public API

Evidence:
- Supabase advisors report `SECURITY DEFINER` functions executable by `anon` and `authenticated`.
- Affected functions include:
  - `public.claim_creative_asset_jobs`
  - `public.cron_meta_pull`
  - `public.cron_creative_sync`
  - `public.accept_organization_invite`
  - `public.accept_workspace_invite`
  - `public.get_my_ai_settings_safe`
  - `public.upsert_my_ai_settings`
  - `public.delete_my_ai_settings`
- `public.claim_creative_asset_jobs` also has mutable `search_path`.

Impact:
- `claim_creative_asset_jobs` can let an unauthenticated or signed-in client claim jobs from the shared creative queue.
- Public cron RPCs can trigger expensive sync flows and create cost/rate-limit exposure.
- Public `SECURITY DEFINER` in an exposed schema is against Supabase security guidance.

Required fix:
- Move internal privileged functions to `app_private` or another unexposed schema.
- Add explicit `set search_path = ''` or a minimal fixed path.
- Revoke `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` for internal functions.
- Grant execution only to the owning backend role or call them from service-role code.
- Replace worker RPC access with a private RPC plus service role, or an Edge Function restricted by an internal automation key.

Acceptance tests:
- `anon` cannot call `claim_creative_asset_jobs`, `cron_meta_pull`, or `cron_creative_sync`.
- `authenticated` users cannot call queue/cron internals.
- Render worker still claims jobs successfully.
- Supabase advisors no longer report `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`, or `function_search_path_mutable` for internal functions.

### P0. Production cron is duplicated and not controlled by one source of truth

Evidence:
- Production has both the Vault/app_private model and the `cron_config`/public RPC model active.
- Active jobs include hourly Meta, 30-minute VTurb, daily Meta, and three daily creative sync jobs.
- The repo has both `20260503014312_schedule_sync_jobs.sql` and `20260610120000_creative_cron_jobs.sql`.

Impact:
- Same source can sync multiple times with different windows and schedules.
- Cost, Meta/VTurb rate limits, and stale/failed `sync_runs` become harder to reason about.
- Incident response is harder because `cron.job_run_details` reports HTTP dispatch success, not business success.

Required fix:
- Choose one automation model: keep Vault + `app_private.install_sync_cron_jobs`.
- Remove or disable public `cron_meta_pull` and `cron_creative_sync`.
- Replace `cron_config` table with Vault secrets only, or make `cron_config` private and not API-exposed if it remains.
- Define schedules explicitly:
  - Meta: hourly or every 2 hours, depending on API limits.
  - VTurb: every 30 to 60 minutes with active run lock.
  - Creative sync: after successful Meta sync or scheduled off-peak, not both unless deduped.
- Add a daily cron audit check that alerts when unexpected jobs exist.

Acceptance tests:
- `cron.job` contains only expected jobs.
- One sync source cannot start overlapping runs for the same `project_id` and `source`.
- `sync_runs` status reflects business outcome, not only HTTP dispatch.

### P0. Operational secrets are readable by workspace members

Evidence:
- RLS policies allow workspace members to `SELECT` `workspace_integrations` and `workspace_meta_accounts`.
- Frontend selects `vturb_api_key`, `gateway_webhook_secret`, and Meta `access_token` in `Connections` and `WorkspaceSettings`.
- Password inputs hide display visually but the secret value is still delivered to the browser.

Impact:
- Any workspace member can potentially inspect tokens from browser devtools or API responses.
- A compromised member account can exfiltrate ad account tokens, VTurb API key, and checkout webhook secret.
- This blocks SaaS public readiness, especially with agencies inviting operators or clients.

Required fix:
- Split secrets from visible metadata:
  - `workspace_meta_accounts`: expose `id`, `account_id`, `label`, `last_synced_at`, token presence, token last updated.
  - secret value stored in a private table, Vault, or encrypted column only read by service role.
- Change UI to show masked values and "replace secret" flow.
- Move create/update/test of secrets into Edge Functions with JWT and admin authorization.
- Ensure non-admin members can view connection status but not secret material.

Acceptance tests:
- Workspace member cannot select any token or API key columns.
- Workspace admin cannot retrieve raw existing secret, only replace it.
- Sync functions still read secrets server-side.
- Connection tests still work through authenticated Edge Functions.

### P1. Creative job queue has backlog and weak recovery semantics

Evidence:
- Production has 291 failed creative jobs and 39 queued jobs, with only 16 succeeded sampled.
- `creative_asset_jobs` has `max_attempts`, `attempt_count`, `available_at`, `locked_at`, and `locked_by`, but the current claim path is exposed and there is no visible dead-letter policy in the app surface.

Impact:
- Creative analysis can silently stop delivering value.
- Jobs may pile up without user-visible diagnosis or operator alert.
- At 1.000 customers, polling plus media processing can create cost spikes and latency.

Required fix:
- Protect job claiming as described in P0.
- Add stale running recovery, retry backoff with jitter, and a `dead_letter` or terminal failure state.
- Add worker heartbeat table or status row per worker.
- Add alerts when queued jobs are older than threshold, failed ratio is high, or worker heartbeat is stale.
- Add requeue controls for admins/operators with audit log.

Acceptance tests:
- Failed jobs move to retry with bounded attempts.
- Poison jobs stop retrying and expose actionable error.
- Worker outage is detectable without inspecting Render manually.

### P1. Production is drifting from the repository

Evidence:
- Initial audit found Edge Function `hubla-csv-import` active in production and absent from the local source tree.
- Refreshed function inventory on 2026-06-18 showed repo-managed functions `accept-invite`, `creative-asset-urls`, `creative-jobs-admin`, and `workspace-credentials` expected locally but not active in production yet.
- On 2026-06-19, the local branch was rebased onto `origin/main`, function source drift was reconciled, and all 17 repo-managed Edge Functions were deployed.
- Function and migration drift were reconciled on 2026-06-19. A post-deploy `supabase db push --dry-run --include-all` returned "Remote database is up to date."
- Untracked local operator scripts remain intentionally outside version control and should not be deployed without secret review.

Impact:
- Reproducibility is weak: production cannot be rebuilt confidently from this checkout.
- Security review may miss deployed code.
- Rollback and incident fixes become risky.

Required fix:
- Decide the canonical branch and sync local with remote.
- Download or remove undocumented production Edge Functions.
- Add CI that fails when `supabase functions list` differs from expected deployed functions.
- Require migrations/functions changes through PR and deploy pipeline.

Acceptance tests:
- Production functions all exist in repo or are explicitly documented as external.
- CI can build/test the exact commit deployed.
- Release notes include DB migration and Edge Function versions.

Implemented locally on 2026-06-18:
- Added `supabase/functions/deploy-manifest.json` as the expected Edge Function inventory for production.
- Removed `hubla-csv-import` from external-drift status after integrating the repo-managed source from `origin/main`.
- Added `scripts/check-supabase-function-drift.mjs` and npm scripts `check:function-manifest` and `check:function-drift`.
- Added `.github/workflows/ci.yml` with build/lint/typecheck/test/build/E2E smoke and a manual/scheduled Supabase function drift job.

Deployment update on 2026-06-19:
- `supabase config push --project-ref nztnctrkmfrgclrnflfa --yes`: passed; remote config was already up to date.
- `supabase functions deploy --project-ref nztnctrkmfrgclrnflfa --use-api`: passed for all 17 repo-managed Edge Functions.
- `npm run check:function-drift`: passed after deploy and confirmed local manifest and remote function inventory match.
- `git push origin main`: passed through application commit `14431f8`.

### P1. Public creative storage needs an explicit product/security decision

Evidence:
- Bucket `creative-assets` is public.
- Creative sync uploads posters/images/media and stores public URLs.

Impact:
- Anyone with the URL can view creative assets.
- This may be acceptable for ad previews, but not for private client assets, internal creative analysis, or copyrighted media.

Required fix:
- Default recommendation for SaaS public: make bucket private and serve signed URLs from backend.
- If public bucket remains, document it as product behavior and avoid storing sensitive/generated analysis files there.
- Add lifecycle policy for large media and old previews.

Acceptance tests:
- Non-member cannot list or fetch private assets.
- Member can fetch signed URLs only for assets in their workspace.
- Public share behavior is explicit: either no creative media, or intentionally signed/public.

Implemented locally on 2026-06-18:
- Added migration `supabase/migrations/20260618162934_harden_creative_assets_storage_private.sql` to prepare `creative-assets` for private-bucket operation with a workspace-scoped `storage.objects` read policy.
- Kept the bucket public in this migration because production still has many legacy public URLs without matching storage paths. Flipping `storage.buckets.public = false` now would break existing creative previews before backfill.
- Added Edge Function `supabase/functions/creative-asset-urls` to issue short-lived signed URLs only after JWT auth and workspace membership checks.
- Updated `src/components/AdsPanel.tsx` to prefer signed media/poster URLs for assets with storage paths and fall back to legacy URLs when signing is unavailable.

Remaining storage gaps:
- Backfill legacy `thumbnail_url` and `source_media_url` rows into `media_storage_path`/`poster_storage_path`.
- Deploy `creative-asset-urls`, verify member/non-member access, then run a planned migration to make `creative-assets` private.
- Add lifecycle/retention policy for large creative media after confirming product retention requirements.

### P1. Auth and account security are not hardened enough for public SaaS

Evidence:
- Supabase advisor reports leaked password protection disabled.
- MFA TOTP appears enabled in config, but public readiness also needs policy and support flow.

Impact:
- Higher risk of compromised accounts.
- Public onboarding increases credential stuffing and weak-password exposure.

Required fix:
- Enable leaked password protection in Supabase Auth.
- Define session expiry policy for sensitive operations.
- Require MFA for owner/admin roles before GA, or at least for organization owners.
- Add account recovery/support runbook.

Acceptance tests:
- Advisor no longer reports leaked password protection disabled.
- Admin role can be required to enroll MFA before accessing secrets/billing/admin surfaces.

### P2. RLS policies will become expensive at scale

Evidence:
- Advisor reports 34 `auth_rls_initplan` findings.
- Advisor reports 1 multiple permissive policies finding.

Impact:
- Policies that re-evaluate `auth.uid()` and helper functions per row can become expensive as `raw_events`, `daily_metrics`, and creative tables grow.
- At 1.000 customers, dashboard and admin lists may degrade.

Required fix:
- Wrap stable auth calls as `(select auth.uid())` in policies.
- Keep membership helper functions in private schema with fixed `search_path`.
- Consolidate duplicate permissive policies where possible.
- Add load-test queries against large seed data for project dashboard, connections, diagnostics, and ads panel.

Acceptance tests:
- Advisor `auth_rls_initplan` count trends to zero for hot tables.
- Dashboard queries remain under agreed latency thresholds with representative data.

### P2. Index strategy still needs query-plan review

Evidence:
- Initial advisor sampling reported 14 unindexed foreign keys.
- A refreshed `supabase db advisors --linked --type performance --level warn -o json` run on 2026-06-18 no longer returned `unindexed_foreign_keys`.
- The post-migration performance advisor run on 2026-06-19 returned no warn-level issues.
- Advisor reports 12 unused indexes.

Impact:
- Deletes and joins can still degrade as tenants and event rows grow if future migrations add FKs without matching access-path indexes.
- Unused indexes add write overhead and storage cost.

Required fix:
- Do not add speculative FK indexes unless the current advisor or query plans identify the missing access path.
- Keep reviewing hot FKs, prioritizing creative tables and high-cardinality workflow tables.
- Do not remove "unused" indexes until production traffic has enough history and query plans are reviewed.
- Add query plan review for dashboard, diagnostics, public share, and sync loaders.

Acceptance tests:
- Advisor unindexed FK findings are zero or each remaining finding has an explicit accepted-risk note.
- No regression in insert/upsert throughput for raw event ingestion.

### P2. Observability is insufficient for public operations

Evidence:
- `sync_runs` exists and is useful, but many production failures are present.
- `cron.job_run_details` reports cron dispatch success even when business sync may fail.
- There is no CI or alerting configuration visible in the repo.

Impact:
- Operators may learn about broken sync from customers.
- Provider API issues and token expiration are not clearly separated.

Required fix:
- Standardize error taxonomy: auth/token, rate limit, provider schema, no binding, timeout, validation, internal.
- Add operational dashboards for source freshness, failure rates, queue age, worker heartbeat, and webhook volume.
- Add alert thresholds per workspace/project/source.
- Add runbook with first-response steps and escalation.

Acceptance tests:
- A stale Meta token creates a specific alert.
- A VTurb rate limit creates a warning and backs off.
- A worker outage creates a queue age/heartbeat alert.

### P2. Frontend bundle and route loading need optimization

Evidence:
- Build succeeded but main JS chunk is about 2.1 MB minified.
- Vite recommends code splitting.

Impact:
- Slower first load for public users.
- Larger bundle increases support burden on weaker networks.

Required fix:
- Code split dashboard-heavy panels, ads/creative analysis, PDF/export dependencies, and route pages.
- Lazy-load rarely used admin/settings flows.
- Track bundle size in CI.

Acceptance tests:
- Main initial chunk drops below an agreed threshold.
- Dashboard interaction remains smooth after lazy loading.

### P3. TypeScript strictness and lint hygiene are loose

Evidence:
- `strict` is disabled.
- `noImplicitAny`, `noUnusedLocals`, and `noUnusedParameters` are disabled.
- Lint passes with warnings.

Impact:
- Runtime bugs are easier to ship.
- Refactors around tenancy/secrets are riskier.

Required fix:
- Introduce stricter TS incrementally, starting with backend-adjacent libs and testable modules.
- Convert lint hook dependency warnings to errors after fixing current warnings.
- Keep generated Supabase types refreshed in CI.

Acceptance tests:
- New backend/domain modules compile with strict settings.
- No hook dependency warnings in app-owned code.

## 5. Roadmap

### Phase 0: Release freeze for public onboarding

Goal: avoid increasing blast radius while P0 findings are open.

- Freeze public/self-service onboarding.
- Keep pilot users controlled.
- Require manual daily check of `sync_runs`, `creative_asset_jobs`, and cron jobs.
- Confirm current production branch/commit after each deploy and keep `main` reconciled with the environment.

Exit criteria:
- P0 migration plan reviewed.
- Backup/rollback plan approved.
- QA workspace credentials available for positive tests.

### Phase 1: P0 hardening

Goal: remove direct public access to privileged internals.

- Move/revoke internal RPCs.
- Fix `search_path` for all privileged functions.
- Consolidate cron to Vault + private functions.
- Remove duplicate production cron jobs.
- Stop returning raw operational secrets to frontend.

Exit criteria:
- Supabase security advisors clear for exposed `SECURITY DEFINER` internals.
- Cron list contains only expected jobs.
- Member and admin secret access tests pass.
- Manual Meta/VTurb/creative sync still works in QA.

Implemented locally on 2026-06-18:
- Added migration `supabase/migrations/20260618150929_harden_internal_rpcs_and_cron.sql` to remove public cron RPCs, revoke internal RPC grants from `public`/`anon`/`authenticated`, grant required internals to `service_role`, fix `claim_creative_asset_jobs` `search_path`, and unschedule duplicated legacy cron entries when present.
- Added migration `supabase/migrations/20260618151441_restrict_workspace_secret_selects.sql` to revoke broad `SELECT` on integration tables and re-grant only non-secret columns to authenticated clients.
- Reintroduced local migration `supabase/migrations/20260617162842_manual_creative_jobs_only.sql` from `origin/main` so local migration history matches the already-applied remote migration before the hardening migrations. The hardening migration preserves its manual-only job claim filter.
- Added Edge Function `supabase/functions/accept-invite` and changed `src/pages/AcceptInvite.tsx` to accept invites through a JWT-validated function instead of public invite RPCs.
- Reworked `supabase/functions/ai-settings` to use service-role table access internally instead of public AI settings RPCs.
- Reworked `supabase/functions/meta-test` and `supabase/functions/vturb-test` so stored secrets are read server-side and only admins can test saved workspace credentials.
- Added Edge Function `supabase/functions/workspace-credentials` and migration `supabase/migrations/20260618153620_harden_secret_writes.sql` so workspace admins replace Meta/VTurb/Gateway secrets through a JWT-validated backend path instead of direct browser writes.
- Updated `src/pages/SetupOperation.tsx`, `src/pages/Connections.tsx`, and `src/pages/WorkspaceSettings.tsx` so browser queries no longer select `access_token`, `vturb_api_key`, or `gateway_webhook_secret`, and browser writes no longer target secret columns directly.

Deployment notes:
- Migrations `20260617155234`, `20260617170623`, `20260618150929`, `20260618151441`, `20260618153620`, `20260618154641`, `20260618155408`, `20260618155824`, `20260618161747`, and `20260618162934` were applied to production on 2026-06-19 with `supabase db push --include-all`.
- A post-deploy `supabase db push --dry-run --include-all` returned "Remote database is up to date."
- Edge Functions `accept-invite`, `ai-settings`, `meta-test`, `vturb-test`, `workspace-credentials`, `generate-alerts`, `creative-jobs-admin`, `creative-asset-urls`, and the remaining repo-managed functions were deployed on 2026-06-19.
- Post-deploy advisors: security has only `auth_leaked_password_protection`; performance returned no warn-level issues. Explicit member/admin secret workflow proof and manual Meta/VTurb/creative sync QA still need a configured QA account before reopening public onboarding.

### Phase 2: Sync reliability

Goal: make sync predictable and supportable at 1.000 customers.

- Add sync locks per `project_id` + `source`.
- Add retry/backoff taxonomy.
- Add worker heartbeat and queue age alerts.
- Add admin requeue/dead-letter workflow.
- Add dashboards/runbook for sync incidents.

Exit criteria:
- Queue has no unbounded stale backlog.
- Sync failures are categorized.
- Operator can diagnose a broken project without database spelunking.

Implemented locally on 2026-06-18:
- Added migration `supabase/migrations/20260618154641_creative_worker_heartbeat_alerts.sql` with `creative_worker_heartbeats`, RLS read access for workspace members tied to active jobs, service-only writes, and `operational_alerts.source = 'creative'`.
- Updated `workers/creative-processor/index.mjs` to report heartbeat/status, active job, counters, and last error without letting heartbeat failures stop processing.
- Updated `supabase/functions/generate-alerts` to generate creative alerts for stale worker heartbeat, queue backlog, stale running jobs, and terminal failed jobs.
- Added pure alert tests in `tests/edge/generate-alerts-core.test.ts`.
- Added migration `supabase/migrations/20260618155408_creative_queue_stale_recovery.sql` so `claim_creative_asset_jobs` recovers jobs stuck in `running` for more than 60 minutes before claiming new work.
- Added bounded exponential retry backoff with jitter in `workers/creative-processor/core.mjs` and switched worker failure retry scheduling to use it.
- Added migration `supabase/migrations/20260618155824_creative_job_admin_workflow.sql` with explicit `dead_letter` status, `creative_asset_job_events`, RLS member read access, explicit Data API grants, and service-role write access.
- Added Edge Function `supabase/functions/creative-jobs-admin` so workspace admins can requeue or dead-letter creative jobs through a JWT-validated backend path with audit events.
- Added pure transition tests in `tests/edge/creative-jobs-admin-core.test.ts`.
- Updated `src/pages/Diagnostics.tsx` with an admin-only creative job operations table, requeue/dead-letter controls, reason capture, reset-attempts option, and refresh after Edge Function success.
- Added `src/lib/creativeJobQueue.ts` and `src/lib/creativeJobQueue.test.ts` for queue summaries, actionable job filtering, and operation guards.

Remaining Phase 2 gaps:
- Positive QA validation still requires `E2E_AUTOMATION_KEY` and `E2E_PROJECT_ID`.

### Phase 3: Scale and SaaS maturity

Goal: prepare for public growth.

- Fix hot RLS initplan policies.
- Review FK/index strategy after query plan review; add indexes only when advisor or plans justify them.
- Add CI pipeline with build, test, lint, Playwright smoke, Supabase advisors, and function drift check.
- Add bundle budget and route-level code splitting.
- Define retention policy for raw provider payloads and PII.
- Add billing/plan/quota model before true self-service.

Exit criteria:
- CI blocks unsafe releases.
- Advisor findings are documented or reduced to accepted noise.
- Load and cost assumptions are documented for 1.000 customers.

Implemented locally on 2026-06-18:
- Added migration `supabase/migrations/20260618161747_optimize_rls_tenancy_helpers.sql` to rewrite tenancy helper functions with `(select auth.uid())`, fixed empty `search_path`, and explicit grants for `authenticated`/`service_role`.
- Rewrote direct `auth.uid()` usages in hot RLS policies to `(select auth.uid())`.
- Consolidated duplicate permissive organization SELECT policies into one `Authenticated users can view accessible organizations` policy.
- Did not add FK index migrations because the refreshed production performance advisor no longer returns `unindexed_foreign_keys`.
- Added `.github/workflows/ci.yml` for required app quality gates and a Supabase function drift job.
- Added `supabase/functions/deploy-manifest.json` plus `scripts/check-supabase-function-drift.mjs` so function inventory is reviewable in code.

## 6. Detailed implementation notes

### Private RPC hardening pattern

Use this pattern for functions that are implementation details:

```sql
create schema if not exists app_private;

create or replace function app_private.claim_creative_asset_jobs(
  job_limit integer,
  worker_name text
)
returns setof public.creative_asset_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- existing claim logic, fully schema-qualified
end;
$$;

revoke all on function app_private.claim_creative_asset_jobs(integer, text)
from public, anon, authenticated;
```

For any public RPC that must remain callable, prefer `SECURITY INVOKER` plus normal RLS. If `SECURITY DEFINER` is required, put it in a private schema and expose it only through a narrow Edge Function that validates JWT/role and input.

### Cron consolidation pattern

Keep:

- `app_private.get_vault_secret`
- `app_private.unschedule_job_by_name`
- `app_private.install_sync_cron_jobs`

Remove or retire:

- `public.cron_meta_pull`
- `public.cron_creative_sync`
- `public.cron_config` as an API-visible source of automation secrets

Expected production cron after consolidation should be documented in README and this audit should be updated with the final list.

### Secret access redesign

Minimum server-side contract:

- `GET /integrations/status`: returns provider, configured flags, labels, last sync timestamps, and masked values.
- `POST /integrations/meta-account`: admin-only, stores/replaces token.
- `POST /integrations/vturb`: admin-only, stores/replaces API key.
- `POST /integrations/gateway`: admin-only, stores/replaces webhook secret.
- `POST /integrations/test`: admin-only, tests without returning secret.

Frontend should never query raw secret columns directly.

### Sync run semantics

`sync_runs` should distinguish:

- `queued`: accepted for work
- `running`: actively processing
- `succeeded`: business success
- `partial`: at least one binding/player/account failed but useful data was written
- `failed`: no useful data written or internal failure
- `cancelled` or `stale_failed`: operator/system ended stale run

The current enum has `queued`, `running`, `succeeded`, `failed`. If `partial` is added, migration and UI handling are required.

## 7. Validation checklist

### Commands to run locally

```bash
npm test
npm run lint
npm run build
npm run e2e
```

Executed on 2026-06-18 and refreshed during deploy on 2026-06-19:
- `npm test`: passed, 22 files and 66 tests. Positive Edge contract tests that require QA variables were skipped.
- `npm run lint`: passed with 0 errors and 16 warnings.
- `npx tsc --noEmit`: passed.
- `node --check workers/creative-processor/index.mjs`: passed.
- `npx --yes deno check supabase/functions/workspace-credentials/index.ts supabase/functions/accept-invite/index.ts supabase/functions/ai-settings/index.ts supabase/functions/meta-test/index.ts supabase/functions/vturb-test/index.ts supabase/functions/generate-alerts/index.ts supabase/functions/generate-alerts/core.ts supabase/functions/creative-jobs-admin/index.ts supabase/functions/creative-jobs-admin/core.ts`: passed.
- `npx --yes deno check supabase/functions/creative-asset-urls/index.ts`: passed.
- `npm run build`: passed; Vite warned about a large main chunk and stale Browserslist data.
- `npm run e2e`: passed public-route smoke coverage, 4 passed and 10 skipped because QA auth/project/public-share variables were absent.
- `npm run qa:prod`: passed read-only public-route smoke coverage against production, 4 passed and 10 skipped because QA variables were absent.
- `supabase migration list`: before deploy, passed and showed pending local migrations `20260617155234`, `20260617170623`, `20260618150929`, `20260618151441`, `20260618153620`, `20260618154641`, `20260618155408`, `20260618155824`, `20260618161747`, and `20260618162934`.
- `supabase db push --dry-run`: pre-deploy check without `--include-all` was blocked because `20260617155234` would be inserted before the last remote migration.
- `supabase db push --dry-run --include-all`: pre-deploy dry-run passed and listed 10 migrations to apply.
- `supabase db push --include-all`: passed and applied all 10 pending migrations to production.
- `supabase db push --dry-run --include-all`: post-deploy dry-run passed and returned "Remote database is up to date."
- `supabase db advisors --linked --level warn --type security -o json`: post-deploy run passed with only `auth_leaked_password_protection`.
- `supabase db advisors --linked --level warn --type performance -o json`: post-deploy run passed with no issues found.
- Local SQL parser check with `pglast` parsed `20260618161747_optimize_rls_tenancy_helpers.sql` as 51 statements.
- `supabase status`: could not validate local DB because Docker daemon is not running.
- `npm run check:function-manifest`: passed and confirmed 17 repo-managed Edge Functions match the manifest.
- `node --check scripts/check-supabase-function-drift.mjs`: passed.
- `supabase config push --project-ref nztnctrkmfrgclrnflfa --yes`: passed; remote config was up to date.
- `supabase functions deploy --project-ref nztnctrkmfrgclrnflfa --use-api`: passed and deployed all 17 repo-managed Edge Functions.
- `npm run check:function-drift`: passed after the function deploy.
- `git push origin main`: passed through application commit `14431f8`; the audit report was then published in later documentation commits.

### Commands to run against production or QA

```bash
supabase db advisors --linked --level warn --type security -o json
supabase db advisors --linked --level warn --type performance -o json
supabase functions list --project-ref nztnctrkmfrgclrnflfa -o json
supabase db query --linked -o json "select jobid, jobname, schedule, active from cron.job order by jobname;"
```

If migration comparison is needed and the CLI asks for direct DB auth, set `SUPABASE_DB_PASSWORD` in the local shell for the session, then run:

```bash
supabase migration list --linked
```

### Security proof cases

- Anonymous user cannot execute internal queue or cron RPCs.
- Authenticated member cannot execute internal queue or cron RPCs.
- Authenticated member cannot read operational secret values.
- Workspace admin can replace but not retrieve existing secrets.
- Service-role automation can still sync.
- Webhook rejects invalid signature and accepts valid provider payload.

### Sync proof cases

- Meta manual sync for QA project writes `raw_events`, updates `sync_runs`, and triggers `aggregate-daily`.
- VTurb manual sync respects active-run lock and rate-limit backoff.
- Creative sync queues jobs once per input fingerprint.
- Worker processes a queued job and records heartbeat/status.
- Failed job reaches retry/dead-letter path with visible reason.

## 8. Open decisions

- Should `creative-assets` be private by default? Recommendation: yes for public SaaS.
- Should workspace `member` role see connection configuration at all? Recommendation: status only, no secrets and no raw webhook tokens.
- Should creative analysis run automatically for every Meta sync? Recommendation: only when asset fingerprint changes and queue budget allows.
- Should public share include only metrics or also creative previews? Recommendation: metrics only until storage privacy is redesigned.
- Should org/workspace invites remain anonymous RPCs? Recommendation: keep accept-by-token possible, but remove broad `SECURITY DEFINER` exposure from `public` and route through a narrow Edge Function.

## 9. References

- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API security: https://supabase.com/docs/guides/api/securing-your-api
- Supabase scheduled functions: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Vault: https://supabase.com/docs/guides/database/vault
- Supabase Storage buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase changelog, explicit Data API grants for new public tables: https://supabase.com/changelog

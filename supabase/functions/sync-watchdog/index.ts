/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAutomationHeaders,
  isAutomationRequest,
} from "../_shared/automation.ts";
import { enqueueSyncJob } from "../_shared/sync-jobs.ts";
import { buildAggregateJobInput } from "../sync-jobs/core.ts";
import {
  buildWatchdogProjectPlan,
  localDateWindow,
  parseWatchdogOptions,
  uniqueSortedDates,
  type WatchdogOptions,
  type WatchdogProjectStatus,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
};

type WatchdogStatusRow = {
  project_id: string;
  raw_dates: string[] | null;
  daily_dates: string[] | null;
  latest_gateway_event_at: string | null;
  meta_accounts: number;
  vturb_players: number;
  has_vturb_key: boolean;
  checkout_enabled: boolean;
  latest_meta_sync_at: string | null;
  latest_vturb_sync_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const startedAtMs = Date.now();

  try {
    if (!isAutomationRequest(req)) {
      return json({ error: "Unauthorized", trace_id: traceId }, 401, traceId);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const options = parseWatchdogOptions(body);
    const projectId = stringOrNull(body.project_id ?? body.projectId);
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const projects = await loadProjects(sb, projectId, options.maxProjects);
    const statuses = await loadProjectStatuses(sb, projects, options);
    const results = [];

    for (const project of projects) {
      const status = statuses.get(project.id);
      if (!status) {
        throw new Error(`Watchdog status ausente para o funil ${project.id}`);
      }
      const plan = buildWatchdogProjectPlan(status, options);
      const actions: Record<string, unknown> = {
        aggregate_dates: plan.aggregateDates,
        missing_daily_dates: plan.missingDailyDates,
        orphan_daily_dates: plan.orphanDailyDates,
        trigger_meta_sync: plan.triggerMetaSync,
        trigger_vturb_sync: plan.triggerVturbSync,
        gateway_needs_attention: plan.gatewayNeedsAttention,
      };

      if (!options.dryRun) {
        if (plan.orphanDailyDates.length > 0) {
          actions.delete_orphan_daily_metrics = {
            skipped: "disabled_to_preserve_dashboard_history",
            dates: plan.orphanDailyDates,
          };
        }

        if (plan.aggregateDates.length > 0) {
          actions.aggregate_job = await enqueueAggregateJob(
            sb,
            project,
            plan.aggregateDates,
          );
        }

        if (plan.triggerMetaSync) {
          actions.meta_jobs = await callFunction(
            "sync-scheduler",
            {
              project_id: project.id,
              source: "meta",
              recent_days: options.recentDays,
              include_backfill: false,
            },
            traceId,
          );
        }

        if (plan.triggerVturbSync) {
          actions.vturb_jobs = await callFunction(
            "sync-scheduler",
            {
              project_id: project.id,
              source: "vturb",
              recent_days: options.recentDays,
              include_backfill: false,
            },
            traceId,
          );
        }

        if (plan.generateAlerts) {
          actions.generate_alerts = await callFunction(
            "generate-alerts",
            { project_id: project.id },
            traceId,
          );
        }
      }

      results.push({
        project_id: project.id,
        workspace_id: project.workspace_id,
        status,
        plan,
        actions,
      });
    }

    console.log(JSON.stringify({
      event: "sync_watchdog_completed",
      trace_id: traceId,
      dry_run: options.dryRun,
      projects: results.length,
      duration_ms: Date.now() - startedAtMs,
    }));

    return json(
      {
        ok: true,
        trace_id: traceId,
        dry_run: options.dryRun,
        projects: results.length,
        results,
      },
      200,
      traceId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado";
    console.error(JSON.stringify({
      event: "sync_watchdog_failed",
      trace_id: traceId,
      error: message,
      duration_ms: Date.now() - startedAtMs,
    }));
    return json({ error: message, trace_id: traceId }, 500, traceId);
  }
});

async function loadProjects(
  sb: SupabaseClientAny,
  projectId: string | null,
  maxProjects: number,
): Promise<ProjectContext[]> {
  let query = sb
    .from("projects")
    .select("id, user_id, workspace_id, source")
    .eq("source", "api")
    .not("workspace_id", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(maxProjects);

  if (projectId) query = query.eq("id", projectId).limit(1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectContext[];
}

async function loadProjectStatuses(
  sb: SupabaseClientAny,
  projects: ProjectContext[],
  options: WatchdogOptions,
): Promise<Map<string, WatchdogProjectStatus>> {
  if (projects.length === 0) return new Map();

  const { start, end } = localDateWindow(options.reprocessDays);
  const { data, error } = await sb.rpc(
    "list_watchdog_project_statuses",
    {
      _project_ids: projects.map((project) => project.id),
      _date_start: start,
      _date_end: end,
    },
  );
  if (error) throw new Error(error.message);

  return new Map(
    ((data ?? []) as WatchdogStatusRow[]).map((row) => [
      row.project_id,
      {
        projectId: row.project_id,
        rawDates: uniqueSortedDates(row.raw_dates ?? []),
        dailyDates: uniqueSortedDates(row.daily_dates ?? []),
        metaAccounts: Number(row.meta_accounts) || 0,
        vturbPlayers: Number(row.vturb_players) || 0,
        hasVturbKey: Boolean(row.has_vturb_key),
        checkoutEnabled: Boolean(row.checkout_enabled),
        latestMetaSyncAt: row.latest_meta_sync_at,
        latestVturbSyncAt: row.latest_vturb_sync_at,
        latestGatewayEventAt: row.latest_gateway_event_at,
      },
    ]),
  );
}

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  traceId: string,
) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        ...buildAutomationHeaders(),
        "x-request-id": traceId,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true, status: response.status, payload }
      : {
          ok: false,
          status: response.status,
          error: String(
            (payload as any)?.error ?? response.statusText,
          ),
        };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Erro ao chamar função",
    };
  }
}

async function enqueueAggregateJob(
  sb: SupabaseClientAny,
  project: ProjectContext,
  dates: string[],
) {
  const job = buildAggregateJobInput({
    workspaceId: project.workspace_id,
    projectId: project.id,
    dates,
    priority: 2,
  });
  if (!job) return { skipped: "no_dates" };

  return await enqueueSyncJob(sb, job, {
    requeueSucceededAfterMinutes: 0,
    reviveDeadLetter: true,
  });
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function json(body: unknown, status: number, traceId: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-request-id": traceId,
    },
  });
}

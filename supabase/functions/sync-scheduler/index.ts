/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import {
  enqueueSyncJobBatchChunked,
  summarizeEnqueueCounts,
  type EnqueueSyncJobResult,
  type SyncJobBatchItem,
} from "../_shared/sync-jobs.ts";
import {
  buildSyncWindows,
  parseSyncSchedulerOptions,
  type SyncJobInput,
  type SyncJobSource,
  type SyncJobWindow,
} from "../sync-jobs/core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VTURB_NO_ACCESS_BACKOFF_MS = 60 * 60 * 1000;
const MAX_SCHEDULED_JOBS_PER_RUN = 5_000;

type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
  last_synced_at?: string | null;
};

type MetaAccountRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  label: string | null;
};

type VturbPlayerRow = {
  id: string;
  workspace_id: string;
  player_id: string;
  label: string | null;
  last_synced_at: string | null;
};

type SchedulerCatalog = {
  metaAccountsByProject: Map<string, MetaAccountRow[]>;
  vturbPlayersByProject: Map<string, VturbPlayerRow[]>;
  workspacesWithVturbKey: Set<string>;
  vturbBackoffProjectIds: Set<string>;
};

type ScheduledSource = "meta" | "vturb" | "creative";

type ScheduledJob = {
  projectId: string;
  source: ScheduledSource;
  item: SyncJobBatchItem;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const traceId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    if (!isAutomationRequest(req)) {
      return json({ error: "Unauthorized", trace_id: traceId }, 401, traceId);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const options = parseSyncSchedulerOptions(body);
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const projects = await loadSchedulableProjects(
      sb,
      options.projectId,
      options.maxProjects,
    );
    const windows = buildSyncWindows({
      recentDays: options.recentDays,
      includeBackfill: options.includeBackfill,
      backfillDays: options.backfillDays,
    });
    const catalog = await loadSchedulerCatalog(sb, projects);

    const projectResults: Array<Record<string, unknown>> = projects.map(
      (project) => ({
        project_id: project.id,
        workspace_id: project.workspace_id,
      }),
    );
    const resultByProjectId = new Map(
      projectResults.map((result) => [String(result.project_id), result]),
    );
    const scheduledJobs: ScheduledJob[] = [];
    const scheduledSources = new Set<string>();
    const truncatedBySource = new Map<string, number>();

    const schedule = (
      projectId: string,
      source: ScheduledSource,
      items: SyncJobBatchItem[],
    ) => {
      const key = sourceKey(projectId, source);
      scheduledSources.add(key);
      const remaining = Math.max(
        MAX_SCHEDULED_JOBS_PER_RUN - scheduledJobs.length,
        0,
      );
      const accepted = items.slice(0, remaining);
      scheduledJobs.push(
        ...accepted.map((item) => ({ projectId, source, item })),
      );
      if (accepted.length < items.length) {
        truncatedBySource.set(key, items.length - accepted.length);
      }
    };

    for (const project of projects) {
      const result = resultByProjectId.get(project.id)!;

      if (!options.source || options.source === "meta") {
        schedule(
          project.id,
          "meta",
          buildMetaJobs(
            project,
            windows,
            catalog.metaAccountsByProject.get(project.id) ?? [],
          ),
        );
      }

      if (!options.source || options.source === "vturb") {
        if (catalog.vturbBackoffProjectIds.has(project.id)) {
          result.vturb = { skipped: "backoff_public_analytics_api" };
        } else {
          schedule(
            project.id,
            "vturb",
            buildVturbJobs(
              project,
              windows,
              catalog.vturbPlayersByProject.get(project.id) ?? [],
              catalog.workspacesWithVturbKey.has(project.workspace_id),
            ),
          );
        }
      }

      if (!options.source || options.source === "creative") {
        schedule(
          project.id,
          "creative",
          buildCreativeJobs(
            project,
            windows,
            catalog.metaAccountsByProject.get(project.id) ?? [],
          ),
        );
      }
    }

    const enqueueResults = await enqueueSyncJobBatchChunked(
      sb,
      scheduledJobs.map((job) => job.item),
      500,
    );
    const resultsBySource = new Map<string, EnqueueSyncJobResult[]>();
    for (let index = 0; index < scheduledJobs.length; index += 1) {
      const job = scheduledJobs[index];
      const key = sourceKey(job.projectId, job.source);
      const sourceResults = resultsBySource.get(key) ?? [];
      sourceResults.push(enqueueResults[index]);
      resultsBySource.set(key, sourceResults);
    }

    for (const key of scheduledSources) {
      const [projectId, source] = key.split(":") as [
        string,
        ScheduledSource,
      ];
      const result = resultByProjectId.get(projectId);
      if (!result) continue;
      const truncated = truncatedBySource.get(key) ?? 0;
      result[source] = {
        ...summarizeEnqueueCounts(resultsBySource.get(key) ?? []),
        ...(truncated > 0 ? { truncated_by_job_budget: truncated } : {}),
      };
    }

    const queueSummary = summarizeEnqueueCounts(enqueueResults);
    const truncatedJobs = [...truncatedBySource.values()].reduce(
      (total, count) => total + count,
      0,
    );
    console.log(JSON.stringify({
      event: "sync_scheduler_completed",
      trace_id: traceId,
      projects: projectResults.length,
      queue: queueSummary,
      truncated_jobs: truncatedJobs,
    }));

    return json(
      {
        ok: true,
        trace_id: traceId,
        projects: projectResults.length,
        windows,
        queue: queueSummary,
        truncated_jobs: truncatedJobs,
        results: projectResults,
      },
      200,
      traceId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado";
    console.error(JSON.stringify({
      event: "sync_scheduler_failed",
      trace_id: traceId,
      error: message,
    }));
    return json({ error: message, trace_id: traceId }, 500, traceId);
  }
});

function buildMetaJobs(
  project: ProjectContext,
  windows: SyncJobWindow[],
  accounts: MetaAccountRow[],
) {
  const jobs: SyncJobBatchItem[] = [];
  for (const account of accounts) {
    for (const window of windows) {
      jobs.push({
        job:
          buildSourceJob(project, {
            source: "meta",
            entityType: "meta_account",
            entityId: normalizeMetaAccountId(account.account_id),
            window,
            payload: {
              workspace_meta_account_id: account.id,
              account_id: normalizeMetaAccountId(account.account_id),
              label: account.label,
              window: window.label,
            },
          }),
        options: { requeueSucceededAfterMinutes: window.staleMinutes },
      });
    }
  }
  return jobs;
}

function buildVturbJobs(
  project: ProjectContext,
  windows: SyncJobWindow[],
  players: VturbPlayerRow[],
  hasVturbKey: boolean,
) {
  if (!hasVturbKey) return [];
  const orderedPlayers = [...players].sort((left, right) => {
    const leftTime = Date.parse(left.last_synced_at ?? "");
    const rightTime = Date.parse(right.last_synced_at ?? "");
    const leftOrder = Number.isFinite(leftTime) ? leftTime : 0;
    const rightOrder = Number.isFinite(rightTime) ? rightTime : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.player_id.localeCompare(right.player_id);
  });

  const jobs: SyncJobBatchItem[] = [];
  for (const player of orderedPlayers) {
    for (const window of windows) {
      jobs.push({
        job:
          buildSourceJob(project, {
            source: "vturb",
            entityType: "vturb_player",
            entityId: player.player_id,
            window,
            payload: {
              workspace_vturb_player_id: player.id,
              player_id: player.player_id,
              label: player.label,
              window: window.label,
            },
          }),
        options: { requeueSucceededAfterMinutes: window.staleMinutes },
      });
    }
  }
  return jobs;
}

function buildCreativeJobs(
  project: ProjectContext,
  windows: SyncJobWindow[],
  accounts: MetaAccountRow[],
) {
  if (accounts.length === 0) return [];

  const jobs: SyncJobBatchItem[] = [];
  for (const window of windows) {
    const jobWindow: SyncJobWindow = {
      ...window,
      priority: window.priority + 20,
      staleMinutes: Math.max(window.staleMinutes, 15),
    };
    jobs.push({
      job:
        buildSourceJob(project, {
          source: "creative",
          entityType: "creative_project",
          entityId: project.id,
          window: jobWindow,
          payload: {
            window: window.label,
            enqueue_analysis: false,
          },
        }),
      options: { requeueSucceededAfterMinutes: jobWindow.staleMinutes },
    });
  }
  return jobs;
}

function sourceKey(projectId: string, source: ScheduledSource) {
  return `${projectId}:${source}`;
}

function buildSourceJob(
  project: ProjectContext,
  args: {
    source: Extract<SyncJobSource, "meta" | "vturb" | "creative">;
    entityType: "meta_account" | "vturb_player" | "creative_project";
    entityId: string;
    window: SyncJobWindow;
    payload: Record<string, unknown>;
  },
): SyncJobInput {
  return {
    workspaceId: project.workspace_id,
    projectId: project.id,
    source: args.source,
    entityType: args.entityType,
    entityId: args.entityId,
    dateStart: args.window.dateStart,
    dateEnd: args.window.dateEnd,
    priority: args.window.priority,
    maxAttempts:
      args.source === "vturb" ? 4 : args.source === "creative" ? 3 : 5,
    payload: {
      scheduler: true,
      date_start: args.window.dateStart,
      date_end: args.window.dateEnd,
      ...args.payload,
    },
  };
}

async function loadSchedulableProjects(
  sb: SupabaseClientAny,
  projectId: string | null,
  maxProjects: number,
): Promise<ProjectContext[]> {
  let query = sb
    .from("projects")
    .select("id, user_id, workspace_id, source, last_synced_at")
    .eq("source", "api")
    .not("workspace_id", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(maxProjects);

  if (projectId) query = query.eq("id", projectId).limit(1);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectContext[];
}

async function loadSchedulerCatalog(
  sb: SupabaseClientAny,
  projects: ProjectContext[],
): Promise<SchedulerCatalog> {
  if (projects.length === 0) {
    return {
      metaAccountsByProject: new Map(),
      vturbPlayersByProject: new Map(),
      workspacesWithVturbKey: new Set(),
      vturbBackoffProjectIds: new Set(),
    };
  }

  const projectIds = projects.map((project) => project.id);
  const workspaceIds = [
    ...new Set(projects.map((project) => project.workspace_id)),
  ];
  const [
    metaBindingsResult,
    metaAccountsResult,
    vturbBindingsResult,
    vturbPlayersResult,
    integrationsResult,
    backoffResult,
  ] = await Promise.all([
    sb
      .from("project_meta_accounts")
      .select("project_id, meta_account_id")
      .in("project_id", projectIds),
    sb
      .from("workspace_meta_accounts")
      .select("id, workspace_id, account_id, label")
      .in("workspace_id", workspaceIds),
    sb
      .from("project_vturb_players")
      .select("project_id, vturb_player_id")
      .in("project_id", projectIds),
    sb
      .from("workspace_vturb_players")
      .select("id, workspace_id, player_id, label, last_synced_at")
      .in("workspace_id", workspaceIds),
    sb
      .from("workspace_integrations")
      .select("workspace_id, vturb_api_key")
      .in("workspace_id", workspaceIds),
    sb
      .from("sync_runs")
      .select("project_id")
      .in("project_id", projectIds)
      .eq("source", "vturb")
      .eq("status", "failed")
      .gte(
        "started_at",
        new Date(Date.now() - VTURB_NO_ACCESS_BACKOFF_MS).toISOString(),
      )
      .ilike("error_message", "%public analytics API%"),
  ]);

  for (const result of [
    metaBindingsResult,
    metaAccountsResult,
    vturbBindingsResult,
    vturbPlayersResult,
    integrationsResult,
    backoffResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  const metaAccountsById = new Map(
    ((metaAccountsResult.data ?? []) as MetaAccountRow[]).map((account) => [
      account.id,
      account,
    ]),
  );
  const vturbPlayersById = new Map(
    ((vturbPlayersResult.data ?? []) as VturbPlayerRow[]).map((player) => [
      player.id,
      player,
    ]),
  );

  return {
    metaAccountsByProject: groupBoundResources(
      metaBindingsResult.data ?? [],
      "meta_account_id",
      metaAccountsById,
    ),
    vturbPlayersByProject: groupBoundResources(
      vturbBindingsResult.data ?? [],
      "vturb_player_id",
      vturbPlayersById,
    ),
    workspacesWithVturbKey: new Set(
      (integrationsResult.data ?? [])
        .filter((row: any) => Boolean(String(row.vturb_api_key ?? "").trim()))
        .map((row: any) => String(row.workspace_id)),
    ),
    vturbBackoffProjectIds: new Set(
      (backoffResult.data ?? [])
        .map((row: any) => String(row.project_id ?? ""))
        .filter(Boolean),
    ),
  };
}

function groupBoundResources<T>(
  bindings: any[],
  resourceKey: string,
  resourcesById: Map<string, T>,
) {
  const grouped = new Map<string, T[]>();
  for (const binding of bindings) {
    const projectId = String(binding.project_id ?? "");
    const resource = resourcesById.get(String(binding[resourceKey] ?? ""));
    if (!projectId || !resource) continue;
    const resources = grouped.get(projectId) ?? [];
    resources.push(resource);
    grouped.set(projectId, resources);
  }
  return grouped;
}

function normalizeMetaAccountId(accountId: string) {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
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

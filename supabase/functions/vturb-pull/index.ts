/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders, isAutomationRequest } from "../_shared/automation.ts";
import {
  filterSchedulableVturbProjects,
  hasCompleteUsableVturbSessionStats,
  hasFreshVturbMetadata,
  normalizeVturbTrafficOriginRows,
  orderVturbPlayersForSync,
  parseVturbBatchOptions,
  parseVturbExecutionOptions,
  selectVturbPlayersForSync,
  shouldStopVturbPlayerLoop,
  summarizeVturbPlayerResults,
} from "./core.ts";
import { isPermanentSyncJobFailure } from "../sync-jobs/core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VTURB_BASE = "https://analytics.vturb.net";
const TZ = "America/Sao_Paulo";
const VTURB_MIN_REQUEST_INTERVAL_MS = 1050;
const VTURB_MAX_RATE_LIMIT_RETRIES = 3;
const VTURB_DEFAULT_RETRY_AFTER_MS = 5000;
const VTURB_MAX_RETRY_AFTER_MS = 60000;
const VTURB_RUNNING_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const VTURB_AUTOMATIC_MIN_PROJECT_BUDGET_MS = 20 * 1000;
const VTURB_REQUEST_TIMEOUT_MS = 8 * 1000;
const VTURB_PROVIDER_STOP_BUFFER_MS = 5 * 1000;

type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string };

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
  last_synced_at?: string | null;
};

type WorkspaceIntegration = {
  workspace_id: string;
  vturb_api_key: string | null;
};

type PlayerBinding = {
  id: string;
  player_id: string;
  label: string | null;
  last_synced_at?: string | null;
  video_duration?: number | null;
  pitch_time?: number | null;
  metadata_synced_at?: string | null;
};

type VturbPath =
  | "/sessions/stats_by_day"
  | "/conversions/stats_by_day"
  | "/traffic_origin/stats_by_day";

type PlayerMetadata = {
  name: string | null;
  duration: number | null;
  pitchTime: number | null;
};

type VturbRuntime = {
  lastRequestAt: number;
  nextRequestAt: number;
  deadlineAt: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const caller = await resolveCaller(req);
    if (!caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetProjectId = stringOrNull(body.project_id);
    const targetPlayerId = stringOrNull(body.player_id);
    const days = Math.min(Math.max(Number(body.days) || 30, 1), 90);
    const skipAggregate = caller.kind === "service" && body.skip_aggregate === true;
    const batchOptions = parseVturbBatchOptions(body);
    const executionOptions = parseVturbExecutionOptions(body);
    const invocationStartedAt = Date.now();
    const isAutomaticGlobalSync = caller.kind === "service"
      && !targetProjectId
      && !targetPlayerId
      && !batchOptions.hasExplicitCursor;

    if (caller.kind === "user" && !targetProjectId) {
      return json({ error: "project_id é obrigatório para sync manual" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const projects = targetProjectId
      ? [await getProjectOrThrow(sb, targetProjectId)]
      : await loadSchedulableProjects(sb);

    const results: Array<Record<string, unknown>> = [];

    for (const project of projects) {
      if (
        isAutomaticGlobalSync
        && (
          shouldStopVturbPlayerLoop({
            startedAtMs: invocationStartedAt,
            nowMs: Date.now(),
            maxRuntimeMs: executionOptions.maxRuntimeMs,
          })
          || remainingRuntimeMs(invocationStartedAt, executionOptions.maxRuntimeMs) < VTURB_AUTOMATIC_MIN_PROJECT_BUDGET_MS
        )
      ) {
        results.push({
          project_id: project.id,
          skipped: "Sync VTurb adiado: orçamento de tempo da execução atingido.",
        });
        break;
      }

      if (
        !targetProjectId
        && !isAutomaticGlobalSync
        && shouldStopVturbPlayerLoop({
          startedAtMs: invocationStartedAt,
          nowMs: Date.now(),
          maxRuntimeMs: executionOptions.maxRuntimeMs,
        })
      ) {
        results.push({
          project_id: project.id,
          skipped: "Sync VTurb adiado: orçamento de tempo da execução atingido.",
        });
        break;
      }

      if (caller.kind === "user") {
        await assertWorkspaceAdmin(sb, project.workspace_id, caller.userId);
      }

      await failStaleRunningSyncRuns(sb, project.id);
      const activeRun = await findActiveSyncRun(sb, project.id);
      if (activeRun) {
        results.push({
          project_id: project.id,
          skipped: `Sync VTurb já em andamento desde ${activeRun.started_at}`,
        });
        continue;
      }

      const runId = await createSyncRun(sb, {
        workspaceId: project.workspace_id,
        projectId: project.id,
        source: "vturb",
        initiatedBy: caller.kind === "user" ? caller.userId : null,
        details: {
          days,
          player_filter: targetPlayerId,
          batch_cursor: targetPlayerId ? null : batchOptions.batchCursor,
          batch_size: targetPlayerId ? null : batchOptions.batchSize,
          selection_mode: targetPlayerId
            ? "single_player"
            : batchOptions.hasExplicitCursor
              ? "explicit_cursor"
              : "oldest_first",
          max_runtime_ms: batchOptions.hasExplicitCursor || targetPlayerId ? null : executionOptions.maxRuntimeMs,
          max_players: batchOptions.hasExplicitCursor || targetPlayerId ? null : executionOptions.maxPlayers,
        },
      });

      try {
        const integration = await getWorkspaceIntegrationOrThrow(sb, project.workspace_id);
        const apiKey = integration.vturb_api_key?.trim();
        if (!apiKey) {
          throw new Error("API key da VTurb não configurada no workspace");
        }

        const players = await loadProjectPlayers(sb, project, targetPlayerId);
        if (players.length === 0) {
          throw new Error("Nenhum player VTurb vinculado a este projeto");
        }

        const orderedPlayers = orderVturbPlayersForSync(players, batchOptions.hasExplicitCursor);
        const playerBatch = selectVturbPlayersForSync(orderedPlayers, {
          batchOptions,
          executionOptions,
          targetPlayerId,
        });
        if (playerBatch.players.length === 0) {
          throw new Error("Nenhum player VTurb encontrado neste lote");
        }

        const { startDay, endDay } = inclusiveLocalDateRange(days);
        const startStr = `${startDay} 00:00:00 -0300`;
        const endStr = `${endDay} 23:59:59 -0300`;
        const projectResults: Array<Record<string, unknown>> = [];
        const projectDatesTouched = new Set<string>();
        let projectSyncedAt: string | null = null;
        let stoppedReason: string | null = null;
        let playersAttempted = 0;
        const vturbRuntime = createVturbRuntime(
          invocationStartedAt +
            executionOptions.maxRuntimeMs -
            VTURB_PROVIDER_STOP_BUFFER_MS,
        );
        let playerMetadata = cachedPlayerMetadataMap(players);
        if (!hasFreshVturbMetadata(players)) {
          const refreshedMetadata = await loadPlayerMetadataMap(
            apiKey,
            vturbRuntime,
          );
          if (refreshedMetadata.size > 0) {
            await refreshWorkspacePlayerMetadata(
              sb,
              project.workspace_id,
              refreshedMetadata,
            );
            playerMetadata = mergePlayerMetadata(
              playerMetadata,
              refreshedMetadata,
            );
            refreshPlayerLabelsInMemory(players, refreshedMetadata);
          }
        }

        for (const player of playerBatch.players) {
          if (
            playerBatch.selectionMode === "oldest_first"
            && shouldStopVturbPlayerLoop({
              startedAtMs: invocationStartedAt,
              nowMs: Date.now(),
              maxRuntimeMs: executionOptions.maxRuntimeMs,
            })
          ) {
            stoppedReason = "runtime_budget";
            break;
          }

          playersAttempted += 1;
          try {
            const result = await pullOnePlayer(sb, {
              vturbRuntime,
              playerMetadata: playerMetadata.get(player.player_id) ?? null,
              apiKey,
              project,
              playerId: player.player_id,
              playerRowId: player.id,
              playerLabel: player.label,
              startStr,
              endStr,
              startDay,
              endDay,
            });
            projectResults.push({
              project_id: project.id,
              player_id: player.player_id,
              inserted: result.inserted,
              ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
            });
            for (const date of result.datesTouched) {
              projectDatesTouched.add(date);
            }
            results.push({
              project_id: project.id,
              player_id: player.player_id,
              inserted: result.inserted,
              ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
            });
            projectSyncedAt = new Date().toISOString();
          } catch (error) {
            const message = error instanceof Error ? error.message : "Erro ao sincronizar VTurb";
            projectResults.push({
              project_id: project.id,
              player_id: player.player_id,
              error: message,
            });
            results.push({
              project_id: project.id,
              player_id: player.player_id,
              error: message,
            });
          }
        }

        const resultSummary = summarizeVturbPlayerResults(projectResults);
        const permanentError = resultSummary.failed
          .map((result) => String(result.error ?? ""))
          .find((message) => isPermanentSyncJobFailure(message));

        if (projectSyncedAt) {
          const integrationPatch: Record<string, unknown> = {
            vturb_last_event_at: projectSyncedAt,
          };
          if (!permanentError) {
            integrationPatch.vturb_validated_at = projectSyncedAt;
            integrationPatch.vturb_sync_suspended_at = null;
            integrationPatch.vturb_sync_suspension_reason = null;
          }
          await sb
            .from("workspace_integrations")
            .update(integrationPatch)
            .eq("workspace_id", project.workspace_id);

          await sb
            .from("projects")
            .update({ last_synced_at: projectSyncedAt })
            .eq("id", project.id);
        }

        if (permanentError) {
          await suspendWorkspaceVturbSync(
            sb,
            project.workspace_id,
            permanentError,
          );
        }

        if (projectDatesTouched.size > 0 && !skipAggregate) {
          await triggerAggregateDaily(project.id, [...projectDatesTouched]);
        }

        const batchDetails = {
          player_filter: targetPlayerId,
          selection_mode: playerBatch.selectionMode,
          batch_cursor: playerBatch.batchCursor,
          batch_size: playerBatch.batchSize,
          max_runtime_ms: playerBatch.selectionMode === "oldest_first" ? executionOptions.maxRuntimeMs : null,
          max_players: playerBatch.maxPlayers,
          players_total: playerBatch.totalPlayers,
          players_selected: playerBatch.playersProcessed,
          players_processed: playersAttempted,
          partial_errors: resultSummary.partialErrors,
          next_cursor: playerBatch.nextCursor,
          has_more: playerBatch.hasMore || stoppedReason === "runtime_budget",
          stopped_reason: stoppedReason,
        };
        results.push({
          project_id: project.id,
          batch: batchDetails,
        });
        await finishSyncRun(sb, runId, {
          status: resultSummary.status,
          details: {
            days,
            ...batchDetails,
            results: projectResults,
          },
          errorMessage: resultSummary.errorMessage,
        });

        if (
          isAutomaticGlobalSync
          && shouldStopVturbPlayerLoop({
            startedAtMs: invocationStartedAt,
            nowMs: Date.now(),
            maxRuntimeMs: executionOptions.maxRuntimeMs,
          })
        ) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao sincronizar VTurb";
        if (isPermanentSyncJobFailure(message)) {
          await suspendWorkspaceVturbSync(sb, project.workspace_id, message);
        }
        results.push({ project_id: project.id, error: message });
        await finishSyncRun(sb, runId, {
          status: "failed",
          details: {
            days,
            player_filter: targetPlayerId,
            batch_cursor: targetPlayerId ? null : batchOptions.batchCursor,
            batch_size: targetPlayerId ? null : batchOptions.batchSize,
            max_runtime_ms: batchOptions.hasExplicitCursor || targetPlayerId ? null : executionOptions.maxRuntimeMs,
            max_players: batchOptions.hasExplicitCursor || targetPlayerId ? null : executionOptions.maxPlayers,
          },
          errorMessage: message,
        });
      }
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error("vturb-pull error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function pullOnePlayer(
  sb: ReturnType<typeof createClient>,
  args: {
    vturbRuntime: VturbRuntime;
    playerMetadata: PlayerMetadata | null;
    apiKey: string;
    project: ProjectContext;
    playerId: string;
    playerRowId: string;
    playerLabel: string | null;
    startStr: string;
    endStr: string;
    startDay: string;
    endDay: string;
  },
) {
  const { vturbRuntime, playerMetadata, apiKey, project, playerId, playerRowId, playerLabel, startStr, endStr, startDay, endDay } = args;

  const sessionStatsResult = await safeVturbPost(vturbRuntime, apiKey, "/sessions/stats_by_day", buildSessionStatsBody({
    player_id: playerId,
    start_date: startStr,
    end_date: endStr,
    timezone: TZ,
    duration: playerMetadata?.duration ?? null,
    pitchTime: playerMetadata?.pitchTime ?? null,
  }));
  const sessionStatsByDay = normalizeSessionStatsByDay(sessionStatsResult.data);
  const hasCompleteUsableSessionStats = hasCompleteUsableVturbSessionStats(sessionStatsByDay, startDay, endDay);
  const statsResult = !hasCompleteUsableSessionStats
    ? await safeVturbPost(vturbRuntime, apiKey, "/conversions/stats_by_day", {
      player_id: playerId,
      start_date: startStr,
      end_date: endStr,
      timezone: TZ,
    })
    : { data: null, error: null, skipped: "Conversões VTurb puladas porque sessions/stats_by_day cobriu o range com métricas úteis." };
  const trafficResult = playerMetadata?.duration
    ? await safeVturbPost(vturbRuntime, apiKey, "/traffic_origin/stats_by_day", {
      player_id: playerId,
      start_date: startStr,
      end_date: endStr,
      query_keys: ["utm_content"],
      video_duration: playerMetadata.duration,
      timezone: TZ,
      ...(playerMetadata.pitchTime ? { pitch_time: playerMetadata.pitchTime } : {}),
    })
    : { data: null, error: null, skipped: "Tráfego por UTM pulado porque a duração do player não está disponível." };

  const warnings = [
    sessionStatsResult.error ? `sessions_stats_by_day: ${sessionStatsResult.error}` : null,
    statsResult.error ? `stats_by_day: ${statsResult.error}` : null,
    trafficResult.error ? `traffic_by_source: ${trafficResult.error}` : null,
  ].filter(Boolean) as string[];

  if (!sessionStatsResult.data && !statsResult.data && !trafficResult.data) {
    throw new Error(warnings.join(" | ") || "Nenhum endpoint VTurb retornou dados");
  }

  const datesTouched = new Set<string>();
  let inserted = 0;

  for (const dayEntry of sessionStatsByDay) {
    const day = String(dayEntry?.date_key ?? dayEntry?.day ?? "").slice(0, 10);
    if (!day) continue;

    const { error } = await sb.from("raw_events").upsert(
      {
        project_id: project.id,
        workspace_id: project.workspace_id,
        user_id: project.user_id,
        source: "vturb",
        event_type: "sessions_stats_by_day",
        event_date: day,
        external_id: `${playerId}-sessions-${day}`,
        account_id: playerId,
        payload: dayEntry,
      },
      { onConflict: "project_id,source,event_type,external_id" },
    );

    if (!error) {
      inserted++;
      datesTouched.add(day);
    }
  }

  const eventsByDay = (statsResult.data as any)?.events_by_day ?? [];
  for (const dayEntry of eventsByDay) {
    const day = String(dayEntry?.day ?? "").slice(0, 10);
    if (!day) continue;

    const { error } = await sb.from("raw_events").upsert(
      {
        project_id: project.id,
        workspace_id: project.workspace_id,
        user_id: project.user_id,
        source: "vturb",
        event_type: "stats_by_day",
        event_date: day,
        external_id: `${playerId}-stats-${day}`,
        account_id: playerId,
        payload: dayEntry,
      },
      { onConflict: "project_id,source,event_type,external_id" },
    );

    if (!error) {
      inserted++;
      datesTouched.add(day);
    }
  }

  for (const trafficEntry of normalizeVturbTrafficOriginRows(trafficResult.data, playerId)) {
    const { error } = await sb.from("raw_events").upsert(
      {
        project_id: project.id,
        workspace_id: project.workspace_id,
        user_id: project.user_id,
        source: "vturb",
        event_type: "traffic_by_source",
        event_date: trafficEntry.eventDate,
        external_id: trafficEntry.externalId,
        account_id: playerId,
        payload: trafficEntry.payload,
      },
      { onConflict: "project_id,source,event_type,external_id" },
    );

    if (!error) {
      inserted++;
      datesTouched.add(trafficEntry.eventDate);
    }
  }

  const syncedAt = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { last_synced_at: syncedAt };
  if (playerMetadata?.name && (!playerLabel || playerLabel === playerId)) {
    updatePayload.label = playerMetadata.name;
  }

  await sb
    .from("workspace_vturb_players")
    .update(updatePayload)
    .eq("id", playerRowId);

  return { inserted, warnings, datesTouched: [...datesTouched] };
}

async function safeVturbPost(
  runtime: VturbRuntime,
  apiKey: string,
  path: VturbPath,
  body: unknown,
) : Promise<{ data: unknown | null; error: string | null; skipped?: string | null }> {
  try {
    return { data: await vturbPost(runtime, apiKey, path, body), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : `VTurb ${path}: erro inesperado`;
    return {
      data: null,
      error: message,
    };
  }
}

async function vturbPost(runtime: VturbRuntime, apiKey: string, path: VturbPath, body: unknown): Promise<unknown> {
  for (let attempt = 0; attempt <= VTURB_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await waitForVturbSlot(runtime);

    const response = await vturbFetch(runtime, `${VTURB_BASE}${path}`, {
      method: "POST",
      headers: {
        "X-Api-Token": apiKey,
        "X-Api-Version": "v1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data: any = await response.json().catch(() => ({}));
    if (response.ok) {
      return data;
    }

    const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
    if (isRateLimitError(response.status, message)) {
      const waitMs = retryAfterMs(response.headers.get("retry-after"), message, attempt);
      runtime.nextRequestAt = Math.max(runtime.nextRequestAt, Date.now() + waitMs);
      if (attempt < VTURB_MAX_RATE_LIMIT_RETRIES) {
        continue;
      }
    }

    throw new Error(`VTurb ${path}: ${message}`);
  }

  throw new Error(`VTurb ${path}: erro inesperado`);
}

async function loadPlayerMetadataMap(apiKey: string, runtime: VturbRuntime) {
  try {
    const data = await vturbGetPlayers(runtime, apiKey);
    const players = Array.isArray(data)
      ? data
      : Array.isArray((data as any)?.players)
        ? (data as any).players
        : Array.isArray((data as any)?.data)
          ? (data as any).data
          : [];

    return new Map<string, PlayerMetadata>(
      players
        .map((player: any) => {
          const id = String(player?.id ?? "").trim();
          if (!id) return null;
          return [
            id,
            {
              name: stringOrNull(player?.name) ??
                stringOrNull(player?.title) ??
                stringOrNull(player?.video_name) ??
                stringOrNull(player?.label) ??
                stringOrNull(player?.player_name),
              duration: positiveNumber(player?.duration),
              pitchTime: positiveNumber(player?.pitch_time),
            },
          ] as const;
        })
        .filter((entry): entry is readonly [string, PlayerMetadata] => Boolean(entry)),
    );
  } catch (error) {
    console.warn("vturb players/list metadata unavailable", error);
    return new Map<string, PlayerMetadata>();
  }
}

async function refreshWorkspacePlayerMetadata(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  playerMetadata: Map<string, PlayerMetadata>,
) {
  const payload = [...playerMetadata.entries()].map(([id, metadata]) => ({
    id,
    name: metadata.name,
    duration: metadata.duration,
    pitch_time: metadata.pitchTime,
  }));
  const { error } = await sb.rpc("refresh_workspace_vturb_metadata", {
    _workspace_id: workspaceId,
    _players: payload,
  });
  if (error) {
    throw new Error(`Falha ao salvar catálogo VTurb: ${error.message}`);
  }
}

async function vturbGetPlayers(runtime: VturbRuntime, apiKey: string): Promise<unknown> {
  for (let attempt = 0; attempt <= VTURB_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await waitForVturbSlot(runtime);

    const response = await vturbFetch(runtime, `${VTURB_BASE}/players/list`, {
      method: "GET",
      headers: {
        "X-Api-Token": apiKey,
        "X-Api-Version": "v1",
        "Content-Type": "application/json",
      },
    });

    const data: any = await response.json().catch(() => ({}));
    if (response.ok) {
      return data;
    }

    const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
    if (isRateLimitError(response.status, message)) {
      const waitMs = retryAfterMs(response.headers.get("retry-after"), message, attempt);
      runtime.nextRequestAt = Math.max(runtime.nextRequestAt, Date.now() + waitMs);
      if (attempt < VTURB_MAX_RATE_LIMIT_RETRIES) {
        continue;
      }
    }

    throw new Error(`VTurb /players/list: ${message}`);
  }

  throw new Error("VTurb /players/list: erro inesperado");
}

async function resolveCaller(req: Request): Promise<Caller | null> {
  if (isAutomationRequest(req)) {
    return { kind: "service" };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user?.id) return null;

  return { kind: "user", userId: data.user.id };
}

async function getProjectOrThrow(
  sb: ReturnType<typeof createClient>,
  projectId: string,
): Promise<ProjectContext> {
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id, source, last_synced_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data?.workspace_id) {
    throw new Error("Projeto não encontrado");
  }

  return data as ProjectContext;
}

async function loadSchedulableProjects(
  sb: ReturnType<typeof createClient>,
): Promise<ProjectContext[]> {
  const [
    projectsResult,
    playerBindingsResult,
    integrationsResult,
  ] = await Promise.all([
    sb
      .from("projects")
      .select("id, user_id, workspace_id, source, last_synced_at")
      .eq("source", "api")
      .not("workspace_id", "is", null),
    sb
      .from("project_vturb_players")
      .select("project_id"),
    sb
      .from("workspace_integrations")
      .select("workspace_id, vturb_api_key, vturb_sync_suspended_at"),
  ]);

  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (playerBindingsResult.error) throw new Error(playerBindingsResult.error.message);
  if (integrationsResult.error) throw new Error(integrationsResult.error.message);

  return filterSchedulableVturbProjects((projectsResult.data ?? []) as ProjectContext[], {
    projectIdsWithPlayers: (playerBindingsResult.data ?? [])
      .map((binding: any) => String(binding.project_id ?? "").trim())
      .filter(Boolean),
    workspaceIdsWithVturbKey: (integrationsResult.data ?? [])
      .filter((integration: any) => String(integration.vturb_api_key ?? "").trim())
      .map((integration: any) => String(integration.workspace_id ?? "").trim())
      .filter(Boolean),
    suspendedWorkspaceIds: (integrationsResult.data ?? [])
      .filter((integration: any) => Boolean(integration.vturb_sync_suspended_at))
      .map((integration: any) => String(integration.workspace_id ?? "").trim())
      .filter(Boolean),
  }).sort((left, right) => {
    const leftSyncedAt = Date.parse(left.last_synced_at ?? "");
    const rightSyncedAt = Date.parse(right.last_synced_at ?? "");
    const leftOrder = Number.isFinite(leftSyncedAt) ? leftSyncedAt : 0;
    const rightOrder = Number.isFinite(rightSyncedAt) ? rightSyncedAt : 0;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

async function suspendWorkspaceVturbSync(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  reason: string,
) {
  const { error } = await sb.rpc("suspend_workspace_vturb_sync", {
    _workspace_id: workspaceId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

async function getWorkspaceIntegrationOrThrow(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<WorkspaceIntegration> {
  const { data, error } = await sb
    .from("workspace_integrations")
    .select("workspace_id, vturb_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Integração do workspace não encontrada");
  }

  return data as WorkspaceIntegration;
}

async function loadProjectPlayers(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  targetPlayerId: string | null,
): Promise<PlayerBinding[]> {
  const { data: bindings, error: bindingsError } = await sb
    .from("project_vturb_players")
    .select("vturb_player_id")
    .eq("project_id", project.id);

  if (bindingsError) throw new Error(bindingsError.message);

  const ids = (bindings ?? []).map((binding: any) => binding.vturb_player_id as string);
  if (ids.length === 0) return [];

  const { data: playerRows, error: playersError } = await sb
    .from("workspace_vturb_players")
    .select(
      "id, player_id, label, last_synced_at, video_duration, pitch_time, metadata_synced_at",
    )
    .eq("workspace_id", project.workspace_id)
    .in("id", ids);

  if (playersError) throw new Error(playersError.message);

  const players = (playerRows ?? []) as PlayerBinding[];
  if (!targetPlayerId) return players;
  return players.filter((player) => player.player_id === targetPlayerId);
}

async function assertWorkspaceAdmin(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMembership } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") {
    return;
  }

  const { data: workspace } = await sb
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (!workspace?.organization_id) {
    throw new Error("Workspace não encontrado");
  }

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") {
    return;
  }

  throw new Error("Sem permissão para sincronizar este workspace");
}

async function createSyncRun(
  sb: ReturnType<typeof createClient>,
  args: {
    workspaceId: string;
    projectId: string;
    source: "vturb";
    initiatedBy: string | null;
    details: Record<string, unknown>;
  },
) {
  const { data } = await sb
    .from("sync_runs")
    .insert({
      workspace_id: args.workspaceId,
      project_id: args.projectId,
      source: args.source,
      status: "running",
      initiated_by: args.initiatedBy,
      started_at: new Date().toISOString(),
      details: args.details,
    })
    .select("id")
    .maybeSingle();

  return data?.id as string | undefined;
}

async function failStaleRunningSyncRuns(
  sb: ReturnType<typeof createClient>,
  projectId: string,
) {
  const cutoff = new Date(Date.now() - VTURB_RUNNING_SYNC_TIMEOUT_MS).toISOString();

  await sb
    .from("sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: "Encerrado automaticamente após exceder o tempo limite do sync VTurb.",
    })
    .eq("project_id", projectId)
    .eq("source", "vturb")
    .eq("status", "running")
    .lt("started_at", cutoff);
}

async function findActiveSyncRun(
  sb: ReturnType<typeof createClient>,
  projectId: string,
) {
  const cutoff = new Date(Date.now() - VTURB_RUNNING_SYNC_TIMEOUT_MS).toISOString();
  const { data } = await sb
    .from("sync_runs")
    .select("id, started_at")
    .eq("project_id", projectId)
    .eq("source", "vturb")
    .eq("status", "running")
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as { id: string; started_at: string } | null;
}

async function finishSyncRun(
  sb: ReturnType<typeof createClient>,
  runId: string | undefined,
  args: {
    status: "succeeded" | "failed";
    details: Record<string, unknown>;
    errorMessage: string | null;
  },
) {
  if (!runId) return;

  await sb
    .from("sync_runs")
    .update({
      status: args.status,
      finished_at: new Date().toISOString(),
      details: args.details,
      error_message: args.errorMessage,
    })
    .eq("id", runId);
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildSessionStatsBody(args: {
  player_id: string;
  start_date: string;
  end_date: string;
  timezone: string;
  duration: number | null;
  pitchTime: number | null;
}) {
  return {
    player_id: args.player_id,
    start_date: args.start_date,
    end_date: args.end_date,
    timezone: args.timezone,
    ...(args.duration ? { video_duration: args.duration } : {}),
    ...(args.pitchTime ? { pitch_time: args.pitchTime } : {}),
  };
}

function normalizeSessionStatsByDay(data: unknown) {
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any)?.data)) return (data as any).data;
  if (Array.isArray((data as any)?.stats_by_day)) return (data as any).stats_by_day;
  return [];
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function createVturbRuntime(deadlineAt: number): VturbRuntime {
  return {
    lastRequestAt: 0,
    nextRequestAt: 0,
    deadlineAt,
  };
}

function remainingRuntimeMs(startedAtMs: number, maxRuntimeMs: number) {
  return Math.max(0, maxRuntimeMs - (Date.now() - startedAtMs));
}

async function waitForVturbSlot(runtime: VturbRuntime) {
  const now = Date.now();
  const waitMs = Math.max(
    0,
    runtime.nextRequestAt - now,
    runtime.lastRequestAt + VTURB_MIN_REQUEST_INTERVAL_MS - now,
  );

  if (waitMs > 0) {
    if (now + waitMs >= runtime.deadlineAt) {
      throw new Error(
        "VTurb adiou a requisição porque o orçamento de tempo foi atingido.",
      );
    }
    await sleep(waitMs);
  }

  runtime.lastRequestAt = Date.now();
}

async function vturbFetch(
  runtime: VturbRuntime,
  url: string,
  init: RequestInit,
) {
  const remainingMs = runtime.deadlineAt - Date.now();
  if (remainingMs <= 1_000) {
    throw new Error(
      "VTurb adiou a requisição porque o orçamento de tempo foi atingido.",
    );
  }

  const timeoutMs = Math.min(VTURB_REQUEST_TIMEOUT_MS, remainingMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `VTurb não respondeu em ${Math.round(timeoutMs)}ms.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function cachedPlayerMetadataMap(players: PlayerBinding[]) {
  return new Map<string, PlayerMetadata>(
    players.map((player) => [
      player.player_id,
      {
        name: stringOrNull(player.label),
        duration: positiveNumber(player.video_duration),
        pitchTime: positiveNumber(player.pitch_time),
      },
    ]),
  );
}

function mergePlayerMetadata(
  cached: Map<string, PlayerMetadata>,
  refreshed: Map<string, PlayerMetadata>,
) {
  return new Map([...cached, ...refreshed]);
}

function refreshPlayerLabelsInMemory(
  players: PlayerBinding[],
  metadata: Map<string, PlayerMetadata>,
) {
  for (const player of players) {
    const name = metadata.get(player.player_id)?.name;
    if (!name) continue;
    const currentLabel = stringOrNull(player.label);
    if (!currentLabel || currentLabel === player.player_id) {
      player.label = name;
    }
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(status: number, message: string) {
  return status === 429 || message.toLowerCase().includes("rate limit exceeded");
}

function retryAfterMs(headerValue: string | null, message: string, attempt: number) {
  const fromHeader = parseRetryAfterValue(headerValue);
  if (fromHeader != null) {
    return clampRetryDelay(fromHeader);
  }

  const matchMs = /retry after\s+(\d+)\s*ms/i.exec(message);
  if (matchMs) {
    return clampRetryDelay(Number(matchMs[1]));
  }

  const matchSeconds = /retry after\s+(\d+)\s*s/i.exec(message);
  if (matchSeconds) {
    return clampRetryDelay(Number(matchSeconds[1]) * 1000);
  }

  return clampRetryDelay(VTURB_DEFAULT_RETRY_AFTER_MS * (attempt + 1));
}

function parseRetryAfterValue(headerValue: string | null) {
  if (!headerValue) return null;
  const numeric = Number(headerValue);
  if (Number.isFinite(numeric)) {
    return headerValue.includes(".") ? Math.round(numeric * 1000) : Math.round(numeric * 1000);
  }

  const dateValue = Date.parse(headerValue);
  if (Number.isFinite(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return null;
}

function clampRetryDelay(ms: number) {
  return Math.min(Math.max(ms + 150, VTURB_DEFAULT_RETRY_AFTER_MS), VTURB_MAX_RETRY_AFTER_MS);
}

function inclusiveLocalDateRange(days: number) {
  const safeDays = Math.max(1, Math.floor(days || 1));
  const endDay = formatLocalYmd(new Date());
  const startDay = addLocalDays(endDay, -(safeDays - 1));
  return { startDay, endDay };
}

function addLocalDays(ymd: string, delta: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return formatLocalYmd(date);
}

function formatLocalYmd(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function triggerAggregateDaily(projectId: string, dates: string[]) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/aggregate-daily`, {
    method: "POST",
    headers: buildAutomationHeaders(),
    body: JSON.stringify({ project_id: projectId, dates }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Falha ao agregar métricas VTurb: ${message || `HTTP ${response.status}`}`);
  }
}

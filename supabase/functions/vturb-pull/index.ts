/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders, isAutomationRequest } from "../_shared/automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VTURB_BASE = "https://analytics.vturb.net";
const TZ = "America/Sao_Paulo";

type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string };

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
};

type WorkspaceIntegration = {
  workspace_id: string;
  vturb_api_key: string | null;
};

type PlayerBinding = {
  id: string;
  player_id: string;
  label: string | null;
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

    if (caller.kind === "user" && !targetProjectId) {
      return json({ error: "project_id é obrigatório para sync manual" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const projects = targetProjectId
      ? [await getProjectOrThrow(sb, targetProjectId)]
      : await loadSchedulableProjects(sb);

    const results: Array<Record<string, unknown>> = [];

    for (const project of projects) {
      if (caller.kind === "user") {
        await assertWorkspaceAdmin(sb, project.workspace_id, caller.userId);
      }

      const runId = await createSyncRun(sb, {
        workspaceId: project.workspace_id,
        projectId: project.id,
        source: "vturb",
        initiatedBy: caller.kind === "user" ? caller.userId : null,
        details: { days, player_filter: targetPlayerId },
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

        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
        const startDay = startDate.toISOString().slice(0, 10);
        const endDay = endDate.toISOString().slice(0, 10);
        const startStr = `${startDay} 00:00:00 -0300`;
        const endStr = `${endDay} 23:59:59 -0300`;
        const projectResults: Array<Record<string, unknown>> = [];
        let projectSyncedAt: string | null = null;

        for (const player of players) {
          try {
            const result = await pullOnePlayer(sb, {
              apiKey,
              project,
              playerId: player.player_id,
              playerRowId: player.id,
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

        if (projectSyncedAt) {
          await sb
            .from("workspace_integrations")
            .update({ vturb_last_event_at: projectSyncedAt })
            .eq("workspace_id", project.workspace_id);

          await sb
            .from("projects")
            .update({ last_synced_at: projectSyncedAt })
            .eq("id", project.id);
        }

        const failed = projectResults.filter((result) => result.error);
        await finishSyncRun(sb, runId, {
          status: failed.length > 0 ? "failed" : "succeeded",
          details: {
            days,
            player_filter: targetPlayerId,
            results: projectResults,
          },
          errorMessage: failed.length
            ? failed.map((result) => String(result.error)).join(" | ").slice(0, 2000)
            : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao sincronizar VTurb";
        results.push({ project_id: project.id, error: message });
        await finishSyncRun(sb, runId, {
          status: "failed",
          details: { days, player_filter: targetPlayerId },
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
    apiKey: string;
    project: ProjectContext;
    playerId: string;
    playerRowId: string;
    startStr: string;
    endStr: string;
    startDay: string;
    endDay: string;
  },
) {
  const { apiKey, project, playerId, playerRowId, startStr, endStr, startDay, endDay } = args;

  const [eventsResult, statsResult, timedResult] = await Promise.all([
    safeVturbPost(apiKey, "/events/total_by_company_players", {
      events: ["started", "viewed", "finished"],
      start_date: startStr,
      end_date: endStr,
      timezone: TZ,
      players_start_date: [{ player_id: playerId, start_date: startStr }],
    }),
    safeVturbPost(apiKey, "/conversions/stats_by_day", {
      player_id: playerId,
      start_date: startStr,
      end_date: endStr,
      timezone: TZ,
    }),
    safeVturbPost(apiKey, "/conversions/video_timed", {
      player_id: playerId,
      start_date: startStr,
      end_date: endStr,
      timezone: TZ,
    }),
  ]);

  const warnings = [
    eventsResult.error ? `total_by_company_players: ${eventsResult.error}` : null,
    statsResult.error ? `stats_by_day: ${statsResult.error}` : null,
    timedResult.error ? `video_timed: ${timedResult.error}` : null,
  ].filter(Boolean) as string[];

  if (!eventsResult.data && !statsResult.data && !timedResult.data) {
    throw new Error(warnings.join(" | ") || "Nenhum endpoint VTurb retornou dados");
  }

  const datesTouched = new Set<string>();
  let inserted = 0;

  if (Array.isArray(eventsResult.data)) {
    for (const event of eventsResult.data) {
      const eventName = String(event?.event ?? "").trim();
      if (!eventName) continue;

      const { error } = await sb.from("raw_events").upsert(
        {
          project_id: project.id,
          workspace_id: project.workspace_id,
          user_id: project.user_id,
          source: "vturb",
          event_type: `${eventName}_total`,
          event_date: endDay,
          external_id: `${playerId}-${eventName}-${startDay}-${endDay}`,
          account_id: playerId,
          payload: event,
        },
        { onConflict: "project_id,source,event_type,external_id" },
      );

      if (!error) {
        inserted++;
        datesTouched.add(endDay);
      }
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

  const groupedTimed = (timedResult.data as any)?.grouped_timed ?? [];
  if (Array.isArray(groupedTimed) && groupedTimed.length > 0) {
    const { error } = await sb.from("raw_events").upsert(
      {
        project_id: project.id,
        workspace_id: project.workspace_id,
        user_id: project.user_id,
        source: "vturb",
        event_type: "retention_curve",
        event_date: endDay,
        external_id: `${playerId}-retention-${startDay}-${endDay}`,
        account_id: playerId,
        payload: { grouped_timed: groupedTimed, range: { start_date: startStr, end_date: endStr } },
      },
      { onConflict: "project_id,source,event_type,external_id" },
    );

    if (!error) {
      inserted++;
      datesTouched.add(endDay);
    }
  }

  const syncedAt = new Date().toISOString();
  await sb
    .from("workspace_vturb_players")
    .update({ last_synced_at: syncedAt })
    .eq("id", playerRowId);

  if (datesTouched.size > 0) {
    await fetch(`${SUPABASE_URL}/functions/v1/aggregate-daily`, {
      method: "POST",
      headers: buildAutomationHeaders(),
      body: JSON.stringify({ project_id: project.id, dates: [...datesTouched] }),
    });
  }

  return { inserted, warnings };
}

async function safeVturbPost(
  apiKey: string,
  path: string,
  body: unknown,
): Promise<{ data: unknown | null; error: string | null }> {
  try {
    return { data: await vturbPost(apiKey, path, body), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : `VTurb ${path}: erro inesperado`,
    };
  }
}

async function vturbPost(apiKey: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${VTURB_BASE}${path}`, {
    method: "POST",
    headers: {
      "X-Api-Token": apiKey,
      "X-Api-Version": "v1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message ?? data?.error ?? `HTTP ${response.status}`;
    throw new Error(`VTurb ${path}: ${message}`);
  }

  return data;
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
    .select("id, user_id, workspace_id, source")
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
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id, source")
    .eq("source", "api")
    .not("workspace_id", "is", null);

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectContext[];
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
    .select("id, player_id, label")
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

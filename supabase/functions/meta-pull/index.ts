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
const META_DATE_TIME_ZONE = "America/Sao_Paulo";

type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string };

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
};

type MetaAccountBinding = {
  id: string;
  account_id: string;
  access_token: string;
  label: string | null;
};

type MetaInsightLevel = "account" | "campaign" | "adset" | "ad";

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
    const targetAccountId = normalizeMetaAccountId(stringOrNull(body.account_id));
    const days = Math.min(Math.max(Number(body.days) || 7, 1), 90);

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
        source: "meta",
        initiatedBy: caller.kind === "user" ? caller.userId : null,
        details: { days, account_filter: targetAccountId },
      });

      try {
        const accounts = await loadProjectAccounts(sb, project, targetAccountId);
        if (accounts.length === 0) {
          throw new Error("Nenhuma conta Meta vinculada a este projeto");
        }

        const projectResults: Array<Record<string, unknown>> = [];
        let latestProjectSync: string | null = null;

        for (const account of accounts) {
          try {
            const pulled = await pullForAccount(sb, project, account, days);
            latestProjectSync = new Date().toISOString();
            projectResults.push({
              project_id: project.id,
              account_id: normalizeMetaAccountId(account.account_id),
              ...pulled,
            });
            results.push({
              project_id: project.id,
              account_id: normalizeMetaAccountId(account.account_id),
              ...pulled,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Erro ao sincronizar Meta";
            projectResults.push({
              project_id: project.id,
              account_id: normalizeMetaAccountId(account.account_id),
              error: message,
            });
            results.push({
              project_id: project.id,
              account_id: normalizeMetaAccountId(account.account_id),
              error: message,
            });
          }
        }

        if (latestProjectSync) {
          await sb
            .from("projects")
            .update({ last_synced_at: latestProjectSync })
            .eq("id", project.id);

          const creativeTrigger = await triggerCreativeSync(project.id, days, targetAccountId);
          if (creativeTrigger) {
            projectResults.push({
              project_id: project.id,
              creative_sync: creativeTrigger,
            });
          }
        }

        const failed = projectResults.filter((result) => result.error);
        await finishSyncRun(sb, runId, {
          status: failed.length > 0 ? "failed" : "succeeded",
          details: {
            days,
            account_filter: targetAccountId,
            results: projectResults,
          },
          errorMessage: failed.length
            ? failed.map((result) => String(result.error)).join(" | ").slice(0, 2000)
            : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao sincronizar Meta";
        results.push({ project_id: project.id, error: message });
        await finishSyncRun(sb, runId, {
          status: "failed",
          details: { days, account_filter: targetAccountId },
          errorMessage: message,
        });
      }
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error("meta-pull error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function pullForAccount(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  account: MetaAccountBinding,
  days: number,
) {
  const { sinceStr, untilStr } = inclusiveLocalDateRange(days);
  const accountId = normalizeMetaAccountId(account.account_id);

  const dates = new Set<string>();
  const insertedByLevel: Record<MetaInsightLevel | "legacy", number> = {
    account: 0,
    campaign: 0,
    adset: 0,
    ad: 0,
    legacy: 0,
  };

  for (const level of ["account", "campaign", "adset", "ad"] as MetaInsightLevel[]) {
    const insights = await fetchInsights(accountId, account.access_token, level, sinceStr, untilStr);
    if (level === "ad" && insights.length > 0) {
      const creativeIdByAdId = await fetchCreativeIdsForAds(account.access_token, insights.map((insight) => String(insight?.ad_id ?? "")));
      for (const insight of insights) {
        const adId = String(insight?.ad_id ?? "");
        const creativeId = creativeIdByAdId.get(adId);
        if (creativeId) {
          insight.creative_id = creativeId;
        }
      }
    }
    insertedByLevel[level] = insights.length;

    for (const insight of insights) {
      const dateStr = String(insight?.date_start ?? "").slice(0, 10);
      if (!dateStr) continue;
      dates.add(dateStr);
      await upsertMetaInsight(sb, project, accountId, level, insight, dateStr);

      if (level === "account") {
        await upsertLegacyAccountInsight(sb, project, accountId, insight, dateStr);
        insertedByLevel.legacy += 1;
      }
    }
  }

  const syncedAt = new Date().toISOString();
  await sb
    .from("workspace_meta_accounts")
    .update({ last_synced_at: syncedAt })
    .eq("id", account.id);

  if (dates.size > 0) {
    await fetch(`${SUPABASE_URL}/functions/v1/aggregate-daily`, {
      method: "POST",
      headers: buildAutomationHeaders(),
      body: JSON.stringify({ project_id: project.id, dates: [...dates] }),
    });
  }

  return { inserted: insertedByLevel.legacy, inserted_by_level: insertedByLevel, dates: [...dates] };
}

async function fetchInsights(
  accountId: string,
  accessToken: string,
  level: MetaInsightLevel,
  sinceStr: string,
  untilStr: string,
) {
  const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/insights`);
  url.searchParams.set("level", level);
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: sinceStr, until: untilStr }));
  url.searchParams.set("fields", fieldsForLevel(level, true));
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "500");

  const insights: any[] = [];
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const text = await response.text();
      if (level === "ad" && nextUrl === url.toString()) {
        return await fetchInsightsFallback(accountId, accessToken, level, sinceStr, untilStr);
      }
      throw new Error(`Meta API ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    if (Array.isArray(data?.data)) insights.push(...data.data);
    nextUrl = typeof data?.paging?.next === "string" ? data.paging.next : null;
  }
  return insights;
}

async function fetchInsightsFallback(
  accountId: string,
  accessToken: string,
  level: MetaInsightLevel,
  sinceStr: string,
  untilStr: string,
) {
  const url = new URL(`https://graph.facebook.com/v21.0/${accountId}/insights`);
  url.searchParams.set("level", level);
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since: sinceStr, until: untilStr }));
  url.searchParams.set("fields", fieldsForLevel(level, false));
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "500");

  const insights: any[] = [];
  let nextUrl: string | null = url.toString();
  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meta API ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    if (Array.isArray(data?.data)) insights.push(...data.data);
    nextUrl = typeof data?.paging?.next === "string" ? data.paging.next : null;
  }
  return insights;
}

async function upsertMetaInsight(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  accountId: string,
  level: MetaInsightLevel,
  insight: any,
  dateStr: string,
) {
  const entityId = entityIdForLevel(level, insight) ?? accountId;
  const { error } = await sb.from("raw_events").upsert(
    {
      project_id: project.id,
      workspace_id: project.workspace_id,
      user_id: project.user_id,
      source: "meta",
      event_type: `insight_${level}`,
      event_date: dateStr,
      external_id: `${level}-${accountId}-${entityId}-${dateStr}`,
      account_id: accountId,
      payload: insight,
    },
    { onConflict: "project_id,source,event_type,external_id" },
  );
  if (error) throw new Error(error.message);
}

async function upsertLegacyAccountInsight(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  accountId: string,
  insight: any,
  dateStr: string,
) {
  const { error } = await sb.from("raw_events").upsert(
    {
      project_id: project.id,
      workspace_id: project.workspace_id,
      user_id: project.user_id,
      source: "meta",
      event_type: "insight",
      event_date: dateStr,
      external_id: `${accountId}-${dateStr}`,
      account_id: accountId,
      payload: insight,
    },
    { onConflict: "project_id,source,event_type,external_id" },
  );
  if (error) throw new Error(error.message);
}

function fieldsForLevel(level: MetaInsightLevel, includeCreativeSignals: boolean) {
  const creativeSignals = includeCreativeSignals
    ? ",outbound_clicks,video_play_actions,video_p25_watched_actions,video_thruplay_watched_actions"
    : "";
  const base = `spend,impressions,clicks,cpm,ctr,cpc,date_start,actions,action_values,cost_per_action_type,website_purchase_roas${creativeSignals}`;
  if (level === "campaign") return `${base},campaign_id,campaign_name`;
  if (level === "adset") return `${base},campaign_id,campaign_name,adset_id,adset_name`;
  if (level === "ad") return `${base},campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name`;
  return base;
}

async function fetchCreativeIdsForAds(accessToken: string, adIds: string[]) {
  const uniqueIds = [...new Set(adIds.filter(Boolean))];
  const results = new Map<string, string>();
  for (let index = 0; index < uniqueIds.length; index += 25) {
    const batch = uniqueIds.slice(index, index + 25);
    const url = new URL("https://graph.facebook.com/v21.0/");
    url.searchParams.set("ids", batch.join(","));
    url.searchParams.set("fields", "id,creative{id}");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url);
    if (!response.ok) {
      continue;
    }
    const payload = await response.json();
    for (const adId of batch) {
      const creativeId = stringOrNull(payload?.[adId]?.creative?.id);
      if (creativeId) {
        results.set(adId, creativeId);
      }
    }
  }
  return results;
}

async function triggerCreativeSync(
  projectId: string,
  days: number,
  accountId: string | null,
) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/creative-sync`, {
      method: "POST",
      headers: buildAutomationHeaders(),
      body: JSON.stringify({
        project_id: projectId,
        days,
        ...(accountId ? { account_id: accountId } : {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: String(payload?.error ?? `HTTP ${response.status}`) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erro ao disparar creative-sync" };
  }
}

function entityIdForLevel(level: MetaInsightLevel, insight: any) {
  if (level === "campaign") return stringOrNull(insight?.campaign_id);
  if (level === "adset") return stringOrNull(insight?.adset_id);
  if (level === "ad") return stringOrNull(insight?.ad_id);
  return null;
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

async function loadProjectAccounts(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  targetAccountId: string | null,
): Promise<MetaAccountBinding[]> {
  const { data: bindings, error: bindingsError } = await sb
    .from("project_meta_accounts")
    .select("meta_account_id")
    .eq("project_id", project.id);

  if (bindingsError) throw new Error(bindingsError.message);

  const ids = (bindings ?? []).map((binding: any) => binding.meta_account_id as string);
  if (ids.length === 0) return [];

  const { data: accountRows, error: accountsError } = await sb
    .from("workspace_meta_accounts")
    .select("id, account_id, access_token, label")
    .eq("workspace_id", project.workspace_id)
    .in("id", ids);

  if (accountsError) throw new Error(accountsError.message);

  const accounts = (accountRows ?? []) as MetaAccountBinding[];
  if (!targetAccountId) return accounts;

  return accounts.filter((account) => normalizeMetaAccountId(account.account_id) === targetAccountId);
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
    source: "meta";
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

function normalizeMetaAccountId(accountId: string | null) {
  if (!accountId) return null;
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function inclusiveLocalDateRange(days: number) {
  const safeDays = Math.max(1, Math.floor(days || 1));
  const untilStr = formatLocalYmd(new Date());
  const sinceStr = addLocalDays(untilStr, -(safeDays - 1));
  return { sinceStr, untilStr };
}

function addLocalDays(ymd: string, delta: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return formatLocalYmd(date);
}

function formatLocalYmd(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: META_DATE_TIME_ZONE,
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

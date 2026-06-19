/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildCreativeJobAdminTransition,
  type CreativeJobAdminAction,
  type CreativeJobAdminRow,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const caller = await resolveUser(req.headers.get("Authorization"));
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = normalizeAction(body.action);
    const jobId = stringOrNull(body.job_id);
    if (!action || !jobId) {
      return json({ error: "action e job_id sao obrigatorios" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const job = await loadJob(admin, jobId);
    await assertWorkspaceAdmin(admin, job.workspace_id, caller.userId);

    const transition = buildCreativeJobAdminTransition({
      action,
      job,
      reason: stringOrNull(body.reason),
      actorUserId: caller.userId,
      resetAttempts: body.reset_attempts !== false,
    });

    const { data: updatedJob, error: updateError } = await admin
      .from("creative_asset_jobs")
      .update(transition.jobPatch)
      .eq("id", job.id)
      .select("id, status, attempt_count, available_at, finished_at")
      .single();
    if (updateError) throw new Error(updateError.message);

    const { error: assetError } = await admin
      .from("creative_assets")
      .update(transition.assetPatch)
      .eq("id", job.asset_id);
    if (assetError) throw new Error(assetError.message);

    const { error: eventError } = await admin
      .from("creative_asset_job_events")
      .insert(transition.event);
    if (eventError) throw new Error(eventError.message);

    return json({ ok: true, job: updatedJob, event: transition.event });
  } catch (error) {
    console.error("creative-jobs-admin error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function loadJob(admin: SupabaseClientAny, jobId: string): Promise<CreativeJobAdminRow> {
  const { data, error } = await admin
    .from("creative_asset_jobs")
    .select("id, asset_id, project_id, workspace_id, status, attempt_count, max_attempts, last_error")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id || !data.workspace_id) throw new Error("Job nao encontrado");
  return data as CreativeJobAdminRow;
}

async function resolveUser(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}

async function assertWorkspaceAdmin(admin: SupabaseClientAny, workspaceId: string, userId: string) {
  const { data: workspaceMembership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") return;

  const { data: workspace } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  const { data: orgMembership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") return;

  throw new Error("Sem permissao para administrar jobs deste workspace");
}

function normalizeAction(value: unknown): CreativeJobAdminAction | null {
  return value === "requeue" || value === "dead_letter" ? value : null;
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

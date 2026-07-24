/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

const EVENT_PROPERTIES: Record<string, Set<string>> = {
  account_bootstrapped: new Set(["entry_point"]),
  funnel_setup_started: new Set(["entry_point", "setup_session_id"]),
  source_prepared: new Set(["source", "method", "setup_session_id"]),
  funnel_created: new Set([
    "source_count",
    "has_hubla_history",
    "setup_session_id",
  ]),
  activation_viewed: new Set(["state"]),
  first_dashboard_opened: new Set(["source", "has_data"]),
  share_created: new Set(["has_expiration"]),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await resolveUser(req.headers.get("Authorization"));
    if (!user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const eventName = String(body.event_name ?? "");
    const allowlist = EVENT_PROPERTIES[eventName];
    if (!allowlist) return json({ error: "Unknown event_name" }, 400);
    const properties = sanitizeProperties(body.properties, allowlist);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const scope = await resolveScope(admin, body);
    await assertScopeAccess(admin, user.id, scope.organizationId, scope.workspaceId);

    const { error } = await admin.from("product_events").insert({
      event_name: eventName,
      organization_id: scope.organizationId,
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      user_id: user.id,
      properties,
    });
    if (error) throw new Error(error.message);
    if (eventName === "first_dashboard_opened" && scope.projectId) {
      await admin
        .from("projects")
        .update({ first_dashboard_opened_at: new Date().toISOString() })
        .eq("id", scope.projectId)
        .is("first_dashboard_opened_at", null);
    }
    return json({ ok: true }, 202);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});

async function resolveScope(admin: SupabaseClientAny, body: Record<string, unknown>) {
  const projectId = uuidOrNull(body.project_id);
  const requestedWorkspaceId = uuidOrNull(body.workspace_id);
  const requestedOrganizationId = uuidOrNull(body.organization_id);
  let workspaceId = requestedWorkspaceId;
  let organizationId = requestedOrganizationId;

  if (projectId) {
    const { data, error } = await admin
      .from("projects")
      .select("workspace_id")
      .eq("id", projectId)
      .maybeSingle();
    if (error || !data?.workspace_id) throw new Error("Project not found");
    if (workspaceId && workspaceId !== data.workspace_id) throw new Error("Scope mismatch");
    workspaceId = data.workspace_id;
  }
  if (workspaceId) {
    const { data, error } = await admin
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error || !data?.organization_id) throw new Error("Workspace not found");
    if (organizationId && organizationId !== data.organization_id) throw new Error("Scope mismatch");
    organizationId = data.organization_id;
  }
  if (!organizationId && !workspaceId && !projectId) throw new Error("Missing event scope");
  return { organizationId, workspaceId, projectId };
}

async function assertScopeAccess(
  admin: SupabaseClientAny,
  userId: string,
  organizationId: string | null,
  workspaceId: string | null,
) {
  if (workspaceId) {
    const [{ data: direct }, { data: workspace }] = await Promise.all([
      admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin.from("workspaces").select("organization_id").eq("id", workspaceId).single(),
    ]);
    const { data: inherited } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", workspace?.organization_id ?? "")
      .eq("user_id", userId)
      .maybeSingle();
    if (direct || inherited) return;
  } else if (organizationId) {
    const { data } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return;
  }
  throw new Error("Scope access denied");
}

async function resolveUser(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

function sanitizeProperties(value: unknown, allowlist: Set<string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowlist.has(key)) continue;
    if (
      raw === null ||
      typeof raw === "boolean" ||
      (typeof raw === "number" && Number.isFinite(raw)) ||
      (typeof raw === "string" && raw.length <= 100)
    ) {
      result[key] = raw as string | number | boolean | null;
    }
  }
  return result;
}

function uuidOrNull(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) throw new Error("Invalid scope id");
  return normalized;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VTURB_REQUEST_TIMEOUT_MS = 10_000;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

/**
 * Tests VTurb Analytics access.
 * Body, unsaved setup mode: { api_key: string }
 * Body, stored workspace mode: { workspace_id: uuid }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const workspaceId = stringOrNull(body.workspace_id);
    let apiKey = stringOrNull(body.api_key);
    let storedWorkspaceClient: SupabaseClientAny | null = null;

    if (workspaceId) {
      const authHeader = req.headers.get("Authorization");
      const caller = await resolveUser(authHeader);
      if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);

      const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false },
      });
      storedWorkspaceClient = sb;
      await assertWorkspaceAdmin(sb, workspaceId, caller.userId);

      const { data: integration, error } = await sb
        .from("workspace_integrations")
        .select("vturb_api_key")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      apiKey = stringOrNull(integration?.vturb_api_key);
    }

    if (!apiKey) return json({ ok: false, error: "api_key obrigatoria" }, 400);

    const today = new Date();
    const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = `${past.toISOString().slice(0, 10)} 00:00:00 -0300`;

    const response = await fetchWithTimeout("https://analytics.vturb.net/conversions/active_platforms", {
      method: "POST",
      headers: {
        "X-Api-Token": apiKey,
        "X-Api-Version": "v1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ start_date: startDate, timezone: "America/Sao_Paulo" }),
    });

    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json({
        ok: false,
        error: data?.message ?? data?.error ?? `HTTP ${response.status}`,
      });
    }

    const players = await fetchPlayers(apiKey);

    if (workspaceId && storedWorkspaceClient) {
      const validatedAt = new Date().toISOString();
      const { error: validationError } = await storedWorkspaceClient
        .from("workspace_integrations")
        .update({
          vturb_validated_at: validatedAt,
          vturb_sync_suspended_at: null,
          vturb_sync_suspension_reason: null,
        })
        .eq("workspace_id", workspaceId);
      if (validationError) throw new Error(validationError.message);
    }

    return json({
      ok: true,
      platforms: Array.isArray(data) ? data : [],
      players,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function fetchPlayers(apiKey: string) {
  const response = await fetchWithTimeout("https://analytics.vturb.net/players/list", {
    method: "GET",
    headers: {
      "X-Api-Token": apiKey,
      "X-Api-Version": "v1",
      "Content-Type": "application/json",
    },
  });

  const data: any = await response.json().catch(() => []);
  const players = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.players)
        ? data.players
        : [];
  if (!response.ok || !Array.isArray(players)) return [];

  return players.map((player: any) => ({
    id: String(player?.id ?? ""),
    name: typeof player?.name === "string" ? player.name : null,
    duration: typeof player?.duration === "number" ? player.duration : null,
    pitch_time: typeof player?.pitch_time === "number" ? player.pitch_time : null,
    created_at: typeof player?.created_at === "string" ? player.created_at : null,
  })).filter((player) => player.id);
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    VTURB_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("A VTurb não respondeu em 10 segundos.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

async function assertWorkspaceAdmin(
  sb: SupabaseClientAny,
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

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace?.organization_id ?? "")
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") {
    return;
  }

  throw new Error("Sem permissao para testar esta chave VTurb");
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

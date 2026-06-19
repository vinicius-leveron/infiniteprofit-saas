/* eslint-disable @typescript-eslint/no-explicit-any */
// Edge function: manages user AI settings without exposing raw API keys.
// GET returns safe metadata only. POST/DELETE mutate via service role after
// validating the caller's JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const VALID_PROVIDERS = ["lovable", "openai", "anthropic", "openrouter"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
type SupabaseClientAny = ReturnType<typeof createClient<any, "public", any>>;

interface UpsertBody {
  provider: string;
  api_key?: string | null;
  model?: string | null;
  skill_text?: string | null;
  skill_file_name?: string | null;
  clear_api_key?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData.user;
    if (userErr || !user?.id) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    if (req.method === "GET") {
      const row = await loadSettings(admin, user.id);
      return jsonResponse({
        settings: row ? safeSettings(row) : defaultSettings(),
      });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as UpsertBody;

      if (!VALID_PROVIDERS.includes(body.provider)) {
        return jsonResponse({ error: "Invalid provider" }, 400);
      }
      if (body.skill_text && body.skill_text.length > 10000) {
        return jsonResponse({ error: "Skill text > 10000 chars" }, 400);
      }
      if (body.api_key && body.api_key.length > 500) {
        return jsonResponse({ error: "API key too long" }, 400);
      }

      const existing = await loadSettings(admin, user.id);
      const nextApiKey = body.clear_api_key
        ? null
        : stringOrNull(body.api_key) ?? existing?.api_key ?? null;

      const { error } = await admin.from("ai_settings").upsert({
        user_id: user.id,
        provider: body.provider,
        api_key: nextApiKey,
        model: stringOrNull(body.model),
        skill_text: stringOrNull(body.skill_text),
        skill_file_name: stringOrNull(body.skill_file_name),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error("ai settings upsert error", error);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ ok: true });
    }

    if (req.method === "DELETE") {
      const { error } = await admin.from("ai_settings").delete().eq("user_id", user.id);
      if (error) {
        console.error("ai settings delete error", error);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("ai-settings error", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown" },
      500,
    );
  }
});

async function loadSettings(admin: SupabaseClientAny, userId: string) {
  const { data, error } = await admin
    .from("ai_settings")
    .select("provider, api_key, model, skill_text, skill_file_name, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    provider: string;
    api_key: string | null;
    model: string | null;
    skill_text: string | null;
    skill_file_name: string | null;
    updated_at: string | null;
  } | null;
}

function safeSettings(row: NonNullable<Awaited<ReturnType<typeof loadSettings>>>) {
  const apiKey = row.api_key ?? "";
  return {
    provider: row.provider,
    model: row.model,
    skill_text: row.skill_text,
    skill_file_name: row.skill_file_name,
    has_api_key: apiKey.length > 0,
    api_key_last4: apiKey.length >= 4 ? apiKey.slice(-4) : null,
    updated_at: row.updated_at,
  };
}

function defaultSettings() {
  return {
    provider: "lovable",
    model: null,
    skill_text: null,
    skill_file_name: null,
    has_api_key: false,
    api_key_last4: null,
    updated_at: null,
  };
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

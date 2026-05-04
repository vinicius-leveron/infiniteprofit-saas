// Edge function: gerencia configurações de IA do usuário (provider, key, modelo, skill)
// GET → retorna config segura (sem key crua)
// POST → upsert (preserva key se não enviada)
// DELETE → remove tudo (reseta para Lovable AI default)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

const VALID_PROVIDERS = ["lovable", "openai", "anthropic", "openrouter"];

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    // Cliente com o JWT do usuário → respeita RLS e auth.uid()
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    if (req.method === "GET") {
      const { data, error } = await supabase.rpc("get_my_ai_settings_safe");
      if (error) {
        console.error("rpc get error", error);
        return jsonResponse({ error: error.message }, 500);
      }
      const row = Array.isArray(data) && data.length ? data[0] : null;
      return jsonResponse({
        settings: row ?? {
          provider: "lovable",
          model: null,
          skill_text: null,
          skill_file_name: null,
          has_api_key: false,
          api_key_last4: null,
          updated_at: null,
        },
      });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as UpsertBody;

      if (!VALID_PROVIDERS.includes(body.provider)) {
        return jsonResponse({ error: "Invalid provider" }, 400);
      }
      if (body.skill_text && body.skill_text.length > 10000) {
        return jsonResponse({ error: "Skill text > 10000 chars" }, 400);
      }
      if (body.api_key && body.api_key.length > 500) {
        return jsonResponse({ error: "API key too long" }, 400);
      }

      const { error } = await supabase.rpc("upsert_my_ai_settings", {
        _provider: body.provider,
        _api_key: body.api_key ?? null,
        _model: body.model ?? null,
        _skill_text: body.skill_text ?? null,
        _skill_file_name: body.skill_file_name ?? null,
        _clear_api_key: body.clear_api_key ?? false,
      });
      if (error) {
        console.error("rpc upsert error", error);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ ok: true });
    }

    if (req.method === "DELETE") {
      const { error } = await supabase.rpc("delete_my_ai_settings");
      if (error) {
        console.error("rpc delete error", error);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("ai-settings error", e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : "Unknown" },
      500,
    );
  }
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

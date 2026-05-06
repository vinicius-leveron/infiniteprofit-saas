// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const token = stringOrNull(body.token);
    if (!token) return json({ error: "Token obrigatório" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: link, error: linkError } = await sb
      .from("project_public_links")
      .select("id, project_id, enabled, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkError) throw new Error(linkError.message);
    if (!link?.enabled) return json({ error: "Link inválido ou desativado" }, 404);
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return json({ error: "Link expirado" }, 410);
    }

    const [{ data: project, error: projectError }, { data: metrics, error: metricsError }] = await Promise.all([
      sb
        .from("projects")
        .select("id, name, source, updated_at")
        .eq("id", link.project_id)
        .maybeSingle(),
      sb
        .from("daily_metrics")
        .select("*")
        .eq("project_id", link.project_id)
        .order("event_date", { ascending: true }),
    ]);

    if (projectError) throw new Error(projectError.message);
    if (metricsError) throw new Error(metricsError.message);
    if (!project) return json({ error: "Projeto não encontrado" }, 404);

    await sb
      .from("project_public_links")
      .update({ last_accessed_at: new Date().toISOString() })
      .eq("id", link.id);

    return json({
      ok: true,
      project,
      metrics: metrics ?? [],
    });
  } catch (error) {
    console.error("public-share error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

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

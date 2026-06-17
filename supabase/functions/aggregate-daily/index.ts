/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";
import { aggregateOneDay } from "./core.ts";

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
    if (!isAutomationRequest(req)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { project_id, dates } = await req.json().catch(() => ({}));
    if (!project_id || !Array.isArray(dates) || dates.length === 0) {
      return json({ error: "project_id and dates[] required" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: project, error: projectError } = await sb
      .from("projects")
      .select("user_id, workspace_id")
      .eq("id", project_id)
      .maybeSingle();

    if (projectError || !project?.workspace_id) {
      return json({ error: "project not found" }, 404);
    }

    let processed = 0;

    for (const date of dates) {
      const { data: events, error: eventsError } = await sb
        .from("raw_events")
        .select("source, event_type, external_id, payload")
        .eq("project_id", project_id)
        .eq("event_date", date);

      if (eventsError) {
        console.error("aggregate-daily events error", date, eventsError);
        continue;
      }

      const metrics = aggregateOneDay((events ?? []) as Array<{ source: string; event_type: string; external_id?: string | null; payload: any }>);

      const { error: upsertError } = await sb
        .from("daily_metrics")
        .upsert(
          {
            project_id,
            user_id: project.user_id,
            workspace_id: project.workspace_id,
            event_date: date,
            ...metrics,
          },
          { onConflict: "project_id,event_date" },
        );

      if (upsertError) {
        console.error("aggregate-daily upsert error", date, upsertError);
        continue;
      }

      processed++;
    }

    return json({ ok: true, processed });
  } catch (error) {
    console.error("aggregate-daily error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

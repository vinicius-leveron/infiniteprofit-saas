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
const RAW_EVENT_PAGE_SIZE = 1_000;
const MAX_DATES_PER_REQUEST = 90;
const MAX_EVENTS_PER_REQUEST = 100_000;

type RawEventRow = {
  id: string;
  event_date: string;
  source: string;
  event_type: string;
  external_id?: string | null;
  payload: any;
};

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
    const normalizedDates = [
      ...new Set(
        dates
          .map((date) => String(date ?? "").slice(0, 10))
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ].sort();
    if (normalizedDates.length === 0) {
      return json({ error: "dates[] must contain valid YYYY-MM-DD values" }, 400);
    }
    if (normalizedDates.length > MAX_DATES_PER_REQUEST) {
      return json(
        { error: `dates[] supports at most ${MAX_DATES_PER_REQUEST} values` },
        400,
      );
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

    const events = await loadRawEvents(sb, project_id, normalizedDates);
    const eventsByDate = new Map<string, RawEventRow[]>();
    for (const event of events) {
      const date = String(event.event_date).slice(0, 10);
      const rows = eventsByDate.get(date) ?? [];
      rows.push(event);
      eventsByDate.set(date, rows);
    }

    const rows = normalizedDates.map((date) => ({
      project_id,
      user_id: project.user_id,
      workspace_id: project.workspace_id,
      event_date: date,
      ...aggregateOneDay(eventsByDate.get(date) ?? []),
    }));
    const { error: upsertError } = await sb
      .from("daily_metrics")
      .upsert(rows, { onConflict: "project_id,event_date" });
    if (upsertError) throw new Error(upsertError.message);

    return json({
      ok: true,
      processed: rows.length,
      raw_events: events.length,
      read_pages: Math.max(1, Math.ceil(events.length / RAW_EVENT_PAGE_SIZE)),
    });
  } catch (error) {
    console.error("aggregate-daily error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function loadRawEvents(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  dates: string[],
) {
  const rows: RawEventRow[] = [];
  for (let from = 0; from < MAX_EVENTS_PER_REQUEST; from += RAW_EVENT_PAGE_SIZE) {
    const { data, error } = await sb
      .from("raw_events")
      .select("id, event_date, source, event_type, external_id, payload")
      .eq("project_id", projectId)
      .in("event_date", dates)
      .order("event_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + RAW_EVENT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as RawEventRow[];
    rows.push(...page);
    if (page.length < RAW_EVENT_PAGE_SIZE) return rows;
  }

  throw new Error(
    `Aggregation exceeds ${MAX_EVENTS_PER_REQUEST} raw events; split the date range`,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

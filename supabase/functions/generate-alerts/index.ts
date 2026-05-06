// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isAutomationRequest } from "../_shared/automation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Caller = { kind: "service" } | { kind: "user"; userId: string };

interface ProjectContext {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
}

interface AlertCandidate {
  source: "meta" | "vturb" | "gateway" | "coverage" | "funnel";
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  dedupe_key: string;
  details?: Record<string, unknown>;
}

interface ExistingAlertRow {
  id: string;
  type: string;
  dedupe_key: string;
}

interface RawEventRow {
  source: string;
  event_type: string;
  received_at: string;
  event_date: string;
}

interface MetricRow {
  event_date: string;
  investimento: number | null;
  pageviews: number | null;
  checkouts: number | null;
  vendas_totais: number | null;
  fat_liquido: number | null;
  roi: number | null;
  cliques: number | null;
  chegaram_pitch: number | null;
}

interface SyncRunRow {
  source: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const caller = await resolveCaller(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const projectId = stringOrNull(body.project_id);
    if (!projectId) return json({ error: "project_id obrigatório" }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const project = await getProjectOrThrow(sb, projectId);
    if (caller.kind === "user") await assertWorkspaceMember(sb, project.workspace_id, caller.userId);

    const alerts = dedupeAlerts(await buildAlerts(sb, project));
    const now = new Date().toISOString();

    for (const alert of alerts) {
      const { error } = await sb.from("operational_alerts").upsert(
        {
          workspace_id: project.workspace_id,
          project_id: project.id,
          source: alert.source,
          type: alert.type,
          severity: alert.severity,
          status: "active",
          title: alert.title,
          message: alert.message,
          dedupe_key: alert.dedupe_key,
          details: alert.details ?? {},
          last_seen_at: now,
          resolved_at: null,
        },
        { onConflict: "project_id,type,dedupe_key" },
      );
      if (error) throw new Error(error.message);
    }

    const activeKeys = alerts.map((alert) => `${alert.type}:${alert.dedupe_key}`);
    const { data: existing } = await sb
      .from("operational_alerts")
      .select("id, type, dedupe_key")
      .eq("project_id", project.id)
      .eq("status", "active");

    const staleIds = ((existing ?? []) as ExistingAlertRow[])
      .filter((row) => !activeKeys.includes(`${row.type}:${row.dedupe_key}`))
      .map((row) => row.id);

    if (staleIds.length > 0) {
      const { error } = await sb
        .from("operational_alerts")
        .update({ status: "resolved", resolved_at: now })
        .in("id", staleIds);
      if (error) throw new Error(error.message);
    }

    const { data: activeAlerts, error: activeError } = await sb
      .from("operational_alerts")
      .select("*")
      .eq("project_id", project.id)
      .eq("status", "active")
      .order("severity", { ascending: true })
      .order("last_seen_at", { ascending: false });

    if (activeError) throw new Error(activeError.message);

    return json({ ok: true, generated: alerts.length, resolved: staleIds.length, alerts: activeAlerts ?? [] });
  } catch (error) {
    console.error("generate-alerts error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function buildAlerts(sb: ReturnType<typeof createClient>, project: ProjectContext): Promise<AlertCandidate[]> {
  const [{ data: events }, { data: metrics }, { data: metaBindings }, { data: playerBindings }, { data: checkout }, { data: syncRuns }] =
    await Promise.all([
      sb
        .from("raw_events")
        .select("source, event_type, received_at, event_date")
        .eq("project_id", project.id)
        .order("received_at", { ascending: false })
        .limit(5000),
      sb
        .from("daily_metrics")
        .select("event_date, investimento, pageviews, checkouts, vendas_totais, fat_liquido, roi, cliques, chegaram_pitch")
        .eq("project_id", project.id)
        .order("event_date", { ascending: false })
        .limit(30),
      sb.from("project_meta_accounts").select("meta_account_id").eq("project_id", project.id),
      sb.from("project_vturb_players").select("vturb_player_id").eq("project_id", project.id),
      sb.from("project_checkout_bindings").select("enabled").eq("project_id", project.id).maybeSingle(),
      sb
        .from("sync_runs")
        .select("source, status, error_message, created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const alerts: AlertCandidate[] = [];
  const rows = (metrics ?? []) as MetricRow[];
  const rawEvents = (events ?? []) as RawEventRow[];
  const metaCount = (metaBindings ?? []).length;
  const playerCount = (playerBindings ?? []).length;

  if (metaCount === 0) {
    alerts.push({
      source: "meta",
      type: "missing_binding",
      severity: "critical",
      title: "Meta sem conta vinculada",
      message: "Este projeto não tem conta Meta vinculada. O dashboard não vai preencher gasto, impressões e cliques.",
      dedupe_key: "meta_binding",
    });
  }
  if (playerCount === 0) {
    alerts.push({
      source: "vturb",
      type: "missing_binding",
      severity: "critical",
      title: "VTurb sem player vinculado",
      message: "Este projeto não tem player VTurb vinculado. Métricas de VSL ficam ausentes.",
      dedupe_key: "vturb_binding",
    });
  }
  if (!checkout?.enabled) {
    alerts.push({
      source: "gateway",
      type: "missing_binding",
      severity: "critical",
      title: "Hubla sem webhook ativo",
      message: "O projeto não tem webhook de checkout ativo. Vendas, faturamento e reembolsos não entram automaticamente.",
      dedupe_key: "checkout_binding",
    });
  }

  const latestMeta = latest(rawEvents, "meta");
  const latestVturb = latest(rawEvents, "vturb");
  const latestGateway = latest(rawEvents, "gateway");
  if (metaCount > 0 && isOlderThan(latestMeta, 36)) {
    alerts.push({
      source: "meta",
      type: "stale_source",
      severity: "warning",
      title: "Meta sem insight recente",
      message: "Não há insight Meta recente recebido. Sincronize a fonte ou revise o token.",
      dedupe_key: "meta_stale",
      details: { last_received_at: latestMeta },
    });
  }
  if (playerCount > 0 && isOlderThan(latestVturb, 24)) {
    alerts.push({
      source: "vturb",
      type: "stale_source",
      severity: "warning",
      title: "VTurb sem eventos nas últimas 24h",
      message: "Os players vinculados não enviaram eventos recentes. Verifique API key, player IDs e sync.",
      dedupe_key: "vturb_stale",
      details: { last_received_at: latestVturb },
    });
  }
  if (checkout?.enabled && isOlderThan(latestGateway, 24)) {
    alerts.push({
      source: "gateway",
      type: "stale_source",
      severity: "warning",
      title: "Hubla sem evento recente",
      message: "O webhook está ativo, mas não recebeu eventos nas últimas 24h.",
      dedupe_key: "gateway_stale",
      details: { last_received_at: latestGateway },
    });
  }

  for (const run of (syncRuns ?? []) as SyncRunRow[]) {
    if (run.status !== "failed") continue;
    alerts.push({
      source: String(run.source) === "meta" ? "meta" : String(run.source) === "vturb" ? "vturb" : "coverage",
      type: "sync_failed",
      severity: "critical",
      title: `Sync ${run.source} falhou`,
      message: String(run.error_message ?? "Última sincronização falhou."),
      dedupe_key: `${run.source}_failed`,
      details: { created_at: run.created_at },
    });
  }

  const recent = rows.slice(0, 7);
  if (recent.some((row) => num(row.investimento) > 0 && num(row.pageviews) === 0)) {
    alerts.push({
      source: "funnel",
      type: "funnel_gap",
      severity: "critical",
      title: "Gasto sem pageview",
      message: "Há dia recente com investimento Meta, mas sem pageview VTurb.",
      dedupe_key: "spend_no_pageview",
    });
  }
  if (recent.some((row) => num(row.pageviews) > 0 && num(row.checkouts) === 0)) {
    alerts.push({
      source: "funnel",
      type: "funnel_gap",
      severity: "warning",
      title: "Pageview sem checkout",
      message: "Há tráfego chegando na VSL, mas sem checkout no agregado diário.",
      dedupe_key: "pageview_no_checkout",
    });
  }
  if (recent.some((row) => num(row.checkouts) > 0 && num(row.vendas_totais) === 0)) {
    alerts.push({
      source: "funnel",
      type: "funnel_gap",
      severity: "critical",
      title: "Checkout sem venda",
      message: "Há checkout recente sem venda aprovada. Revise oferta, checkout e pagamentos recusados.",
      dedupe_key: "checkout_no_sale",
    });
  }

  const last3 = rows.slice(0, 3);
  if (last3.length > 0 && last3.every((row) => num(row.roi) < 1 && num(row.investimento) > 0)) {
    alerts.push({
      source: "funnel",
      type: "business_metric",
      severity: "warning",
      title: "ROI abaixo de 1 nos dias recentes",
      message: "O ROI dos últimos dias com investimento está abaixo do ponto de equilíbrio.",
      dedupe_key: "roi_below_one",
    });
  }

  const missingCoverage = coverageGaps(rows, rawEvents);
  alerts.push(...missingCoverage);

  return alerts;
}

function coverageGaps(rows: MetricRow[], events: RawEventRow[]): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const hasMetaRaw = events.some((event) => event.source === "meta");
  const hasVturbRaw = events.some((event) => event.source === "vturb");
  const hasGatewayRaw = events.some((event) => event.source === "gateway");
  const hasMetaMetrics = rows.some((row) => num(row.investimento) > 0 || num(row.cliques) > 0);
  const hasVturbMetrics = rows.some((row) => num(row.pageviews) > 0);
  const hasGatewayMetrics = rows.some((row) => num(row.vendas_totais) > 0 || num(row.fat_liquido) > 0);

  if (hasMetaRaw && !hasMetaMetrics) {
    alerts.push({
      source: "coverage",
      type: "coverage_missing",
      severity: "critical",
      title: "Meta chegou, mas daily_metrics não preencheu",
      message: "Existem raw_events Meta, mas gasto/cliques continuam ausentes nos agregados recentes.",
      dedupe_key: "meta_daily_missing",
    });
  }
  if (hasVturbRaw && !hasVturbMetrics) {
    alerts.push({
      source: "coverage",
      type: "coverage_missing",
      severity: "warning",
      title: "VTurb chegou, mas VSL não preencheu",
      message: "Existem eventos VTurb, mas pageviews não aparecem em daily_metrics.",
      dedupe_key: "vturb_daily_missing",
    });
  }
  if (hasGatewayRaw && !hasGatewayMetrics) {
    alerts.push({
      source: "coverage",
      type: "coverage_missing",
      severity: "critical",
      title: "Checkout chegou, mas vendas/faturamento não preencheram",
      message: "Existem eventos do gateway, mas vendas ou faturamento não aparecem nos agregados recentes.",
      dedupe_key: "gateway_daily_missing",
    });
  }
  return alerts;
}

function dedupeAlerts(alerts: AlertCandidate[]) {
  const map = new Map<string, AlertCandidate>();
  for (const alert of alerts) {
    const key = `${alert.type}:${alert.dedupe_key}`;
    const existing = map.get(key);
    if (!existing || severityRank(alert.severity) > severityRank(existing.severity)) {
      map.set(key, alert);
    }
  }
  return [...map.values()];
}

function severityRank(severity: AlertCandidate["severity"]) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

async function resolveCaller(req: Request): Promise<Caller | null> {
  if (isAutomationRequest(req)) return { kind: "service" };

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

async function getProjectOrThrow(sb: ReturnType<typeof createClient>, projectId: string): Promise<ProjectContext> {
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id, source")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data?.workspace_id) throw new Error("Projeto não encontrado");
  return data as ProjectContext;
}

async function assertWorkspaceMember(sb: ReturnType<typeof createClient>, workspaceId: string, userId: string) {
  const { data: workspaceMembership } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (workspaceMembership) return;

  const { data: workspace } = await sb.from("workspaces").select("organization_id").eq("id", workspaceId).maybeSingle();
  if (!workspace?.organization_id) throw new Error("Workspace não encontrado");

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (orgMembership) return;
  throw new Error("Sem permissão para acessar este workspace");
}

function latest(events: RawEventRow[], source: string) {
  return events.find((event) => event.source === source)?.received_at ?? null;
}

function isOlderThan(timestamp: string | null, hours: number) {
  if (!timestamp) return true;
  return Date.now() - new Date(timestamp).getTime() > hours * 60 * 60 * 1000;
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

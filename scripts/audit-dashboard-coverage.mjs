#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const PROJECT_ID = process.argv[2] || process.env.PROJECT_ID;
const OUTPUT_JSON = process.argv.includes("--json");

if (!PROJECT_ID) {
  console.error("Usage: npm run audit:coverage -- <project_id> [--json]");
  process.exit(1);
}

const KPI_GROUPS = [
  {
    source: "meta",
    label: "Meta Ads",
    rawEventTypes: ["insight"],
    metrics: [
      ["Investimento", "investimento", "OK", "Meta insight.spend"],
      ["Impressões", "impressoes", "OK", "Meta insight.impressions"],
      ["Cliques", "cliques", "OK", "Meta insight.clicks"],
      ["CPM", "cpm", "OK", "Derivado de investimento/impressões"],
      ["CTR", "ctr", "OK", "Derivado de cliques/impressões"],
      ["CPC", "cpc", "OK", "Derivado de investimento/cliques"],
    ],
  },
  {
    source: "vturb",
    label: "VTurb",
    rawEventTypes: ["stats_by_day", "pageview", "play", "pitch_reached", "retention_curve"],
    metrics: [
      ["Pageviews", "pageviews", "Parcial", "Depende dos campos enviados pela VTurb"],
      ["Visualizações únicas", "views_unicas", "Parcial", "Depende de unique/session/device no payload"],
      ["Play Rate", "play_rate", "Parcial", "Derivado de plays/pageviews; pode ser proxy em stats_by_day"],
      ["Retenção Pitch", "ret_pitch", "Parcial", "Derivado de chegaram no pitch/plays"],
      ["Chegaram no Pitch", "chegaram_pitch", "Parcial", "Depende de pitch explícito ou curva de retenção"],
    ],
  },
  {
    source: "gateway",
    label: "Hubla/Checkout",
    rawEventTypes: ["purchase.approved", "purchase.refused", "purchase.refunded", "checkout_created"],
    metrics: [
      ["Vendas Front", "vendas_front", "OK", "Eventos purchase.approved"],
      ["Vendas Totais", "vendas_totais", "OK", "Eventos purchase.approved"],
      ["Faturamento Bruto", "fat_bruto", "OK", "payload.total"],
      ["Faturamento Líquido", "fat_liquido", "Parcial", "Depende de payload.net confiável do gateway"],
      ["Reembolsos", "reembolsos", "OK", "Eventos purchase.refunded"],
      ["Valor Reembolsado", "valor_reembolsado", "Parcial", "Depende de valor no payload de reembolso"],
      ["Aprovação Cartão", "aprov_cartao", "Parcial", "Depende do método de pagamento em aprovados/recusados"],
      ["Aprovação PIX", "aprov_pix", "Parcial", "Depende do método de pagamento em aprovados/recusados"],
      ["Orderbump", "fat_orderbump", "Parcial", "Depende de itens marcados como bump/upsell"],
      ["Funil/Upsell", "fat_funil", "Parcial", "Depende de is_front/is_upsell no payload"],
    ],
  },
  {
    source: "derived",
    label: "Derivados de Funil",
    rawEventTypes: [],
    metrics: [
      ["Taxa de Carregamento", "taxa_carreg", "Parcial", "Derivado de pageviews/cliques"],
      ["Passagem para Checkout", "pass_chk", "Parcial", "Derivado de checkouts/pageviews"],
      ["Pitch -> Checkout", "pitch_chk", "Parcial", "Derivado diário, sem atribuição por sessão"],
      ["Pitch -> Venda", "pitch_venda", "Parcial", "Derivado diário, sem atribuição por sessão"],
      ["Checkout -> Venda", "chk_venda", "Parcial", "Derivado diário, sem atribuição por sessão"],
    ],
  },
];

const DAILY_COLUMNS = [...new Set(KPI_GROUPS.flatMap((group) => group.metrics.map(([, column]) => column)))];

function runSql(sql) {
  const args = ["db", "query", "--linked", "-o", "json", sql];
  const result = spawnSync("supabase", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "supabase db query failed");
  }

  const jsonStart = result.stdout.indexOf("{");
  if (jsonStart === -1) return [];
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  return parsed.rows ?? [];
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const rawRows = runSql(`
  select source, event_type, count(*)::int as events
  from public.raw_events
  where project_id = ${sqlString(PROJECT_ID)}
  group by source, event_type
  order by source, event_type;
`);

const metricRows = runSql(`
  select
    count(*)::int as daily_rows,
    ${DAILY_COLUMNS.map((column) => `count(${column})::int as ${column}_filled`).join(",\n    ")}
  from public.daily_metrics
  where project_id = ${sqlString(PROJECT_ID)};
`);

const rawCounts = new Map(rawRows.map((row) => [`${row.source}:${row.event_type}`, Number(row.events) || 0]));
const metricCounts = metricRows[0] ?? {};

function rawCountFor(group) {
  if (group.source === "derived") {
    return rawRows.reduce((sum, row) => sum + (Number(row.events) || 0), 0);
  }
  return group.rawEventTypes.reduce((sum, eventType) => sum + (rawCounts.get(`${group.source}:${eventType}`) ?? 0), 0);
}

const rows = [];
for (const group of KPI_GROUPS) {
  const rawEvents = rawCountFor(group);
  for (const [kpi, column, defaultStatus, reason] of group.metrics) {
    const filled = Number(metricCounts[`${column}_filled`] ?? 0);
    let status = "Faltando";
    let motivo = "Sem raw_events da fonte e sem daily_metrics preenchido";

    if (rawEvents > 0 && filled > 0) {
      status = defaultStatus;
      motivo = reason;
    } else if (rawEvents > 0 && filled === 0) {
      status = group.source === "derived" ? "Parcial" : "Faltando";
      motivo = `Há ${rawEvents} raw_events relacionados, mas ${column} não foi preenchido`;
    } else if (rawEvents === 0 && filled > 0) {
      status = "Parcial";
      motivo = "daily_metrics preenchido sem raw_events atuais na fonte esperada";
    }

    rows.push({
      kpi,
      source: group.label,
      raw_events: rawEvents,
      daily_metrics_filled: filled,
      status,
      motivo,
    });
  }
}

if (OUTPUT_JSON) {
  console.log(JSON.stringify({ project_id: PROJECT_ID, rows }, null, 2));
} else {
  console.table(rows);
}

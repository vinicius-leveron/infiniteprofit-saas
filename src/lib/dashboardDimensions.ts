import { supabase } from "@/integrations/supabase/client";
import type { DailyRow } from "@/lib/csv";
import type { DashboardFilterState } from "@/lib/dashboardFilters";
import { META_TAX_RATE } from "@/lib/metrics";

export type DashboardAdDimension = {
  account_id: string | null;
  account_label: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
};

export type DashboardDimensionMetricRow = {
  event_date: string;
  investimento: number | null;
  impressoes: number | null;
  cliques: number | null;
  landing_pageviews: number | null;
  pageviews: number | null;
  plays_unicos: number | null;
  chegaram_pitch: number | null;
  checkouts: number | null;
  vendas_front: number | null;
  vendas_totais: number | null;
  fat_bruto: number | null;
  fat_liquido: number | null;
  reembolsos: number | null;
  valor_reembolsado: number | null;
  order_bump_orders: number | null;
  upsell_orders: number | null;
};

export type DashboardAttributionCoverage = {
  frontSalesPercent: number;
  revenuePercent: number;
  vslPercent: number;
};

export async function listDashboardAdDimensions(projectId: string) {
  const { data, error } = await supabase.rpc(
    "list_dashboard_ad_dimensions",
    { _project_id: projectId },
  );
  if (error) throw error;
  return (data ?? []) satisfies DashboardAdDimension[];
}

export async function getDashboardDimensionMetrics(
  projectId: string,
  filters: DashboardFilterState,
) {
  const { data, error } = await supabase.rpc(
    "get_dashboard_dimension_metrics",
    {
      _project_id: projectId,
      _from: null,
      _to: null,
      _account_ids: filters.accountIds,
      _campaign_ids: filters.campaignIds,
      _adset_ids: filters.adsetIds,
    },
  );
  if (error) throw error;
  return (data ?? []) satisfies DashboardDimensionMetricRow[];
}

export function hasDashboardMediaFilters(filters: DashboardFilterState) {
  return filters.accountIds.length > 0 || filters.campaignIds.length > 0 || filters.adsetIds.length > 0;
}

export function filterDashboardAdDimensions(
  dimensions: DashboardAdDimension[],
  filters: DashboardFilterState,
) {
  return dimensions.filter((dimension) =>
    (
      filters.accountIds.length === 0 ||
      Boolean(dimension.account_id && filters.accountIds.includes(dimension.account_id))
    ) &&
    (
      filters.campaignIds.length === 0 ||
      Boolean(dimension.campaign_id && filters.campaignIds.includes(dimension.campaign_id))
    ) &&
    (
      filters.adsetIds.length === 0 ||
      Boolean(dimension.adset_id && filters.adsetIds.includes(dimension.adset_id))
    )
  );
}

export function applyDashboardDimensionMetrics(
  baseRows: DailyRow[],
  metrics: DashboardDimensionMetricRow[],
) {
  const meaningful = metrics.some((row) =>
    number(row.investimento) > 0 ||
    number(row.impressoes) > 0 ||
    number(row.pageviews) > 0 ||
    number(row.vendas_front) > 0 ||
    number(row.fat_bruto) > 0
  );
  if (!meaningful) return [] as DailyRow[];

  const byDate = new Map(metrics.map((row) => [row.event_date, row]));
  return baseRows
    .map((base) => {
      if (!base.date) return null;
      const key = dateKey(base.date);
      const metric = byDate.get(key);
      if (!metric) return null;

      const investimento = number(metric.investimento);
      const impressoes = number(metric.impressoes);
      const cliques = number(metric.cliques);
      const landingPageviews = number(metric.landing_pageviews);
      const pageviews = number(metric.pageviews);
      const playsUnicos = number(metric.plays_unicos);
      const chegaramPitch = number(metric.chegaram_pitch);
      const checkouts = number(metric.checkouts);
      const vendasFront = number(metric.vendas_front);
      const vendasTotais = number(metric.vendas_totais);
      const fatBruto = number(metric.fat_bruto);
      const fatLiquido = number(metric.fat_liquido);
      const reembolsos = number(metric.reembolsos);
      const valorReembolsado = number(metric.valor_reembolsado);
      const orderBumpOrders = number(metric.order_bump_orders);
      const upsellOrders = number(metric.upsell_orders);
      const impostoMeta = investimento * META_TAX_RATE;

      return {
        ...base,
        investimento,
        impressoes,
        cliques,
        landingPageviews,
        pageviews,
        playsUnicos,
        chegaramPitch,
        checkouts,
        vendasFront,
        vendasTotais,
        fatBruto,
        fatLiquido,
        impostoMeta,
        lucro: fatLiquido - investimento - impostoMeta,
        reembolsos,
        valorReembolsado,
        taxaReembolso: ratio(reembolsos, vendasFront),
        cpm: impressoes > 0 ? (investimento / impressoes) * 1000 : null,
        ctr: ratio(cliques, impressoes),
        cpc: cliques > 0 ? investimento / cliques : null,
        custoPageview: landingPageviews > 0 ? investimento / landingPageviews : null,
        custoIC: checkouts > 0 ? investimento / checkouts : null,
        taxaCarreg: ratio(landingPageviews, cliques),
        passChk: ratio(checkouts, pageviews),
        playRate: ratio(playsUnicos, pageviews),
        retPitch: ratio(chegaramPitch, playsUnicos),
        pitchChk: ratio(checkouts, chegaramPitch),
        pitchVenda: ratio(vendasFront, chegaramPitch),
        chkVenda: ratio(vendasFront, checkouts),
        cpaFront: vendasFront > 0 ? investimento / vendasFront : null,
        cac: vendasTotais > 0 ? investimento / vendasTotais : null,
        aov: vendasFront > 0 ? fatBruto / vendasFront : null,
        roi: investimento > 0 ? (fatLiquido - impostoMeta) / investimento : null,
        orderBumpOrders,
        upsellOrders,
        convGeralOrderbump: ratio(orderBumpOrders, vendasFront),
        convGeralUpsell: ratio(upsellOrders, vendasFront),
        bumps: [
          { name: "Order bump", type: "orderbump" as const, count: orderBumpOrders, revenue: null, rate: ratio(orderBumpOrders, vendasFront) },
          { name: "Upsell", type: "upsell" as const, count: upsellOrders, revenue: null, rate: ratio(upsellOrders, vendasFront) },
        ],
      } satisfies DailyRow;
    })
    .filter((row): row is DailyRow => row != null);
}

export function calculateAttributionCoverage(
  baseRows: DailyRow[],
  attributedRows: DashboardDimensionMetricRow[],
): DashboardAttributionCoverage {
  return {
    frontSalesPercent: coverage(sumDaily(baseRows, "vendasFront"), sumMetric(attributedRows, "vendas_front")),
    revenuePercent: coverage(sumDaily(baseRows, "fatBruto"), sumMetric(attributedRows, "fat_bruto")),
    vslPercent: coverage(sumDaily(baseRows, "pageviews"), sumMetric(attributedRows, "pageviews")),
  };
}

function number(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function coverage(total: number, attributed: number) {
  if (total <= 0) return attributed > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (attributed / total) * 100));
}

function sumDaily(rows: DailyRow[], key: keyof DailyRow) {
  return rows.reduce((sum, row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
}

function sumMetric(rows: DashboardDimensionMetricRow[], key: keyof DashboardDimensionMetricRow) {
  return rows.reduce((sum, row) => sum + number(row[key] as number | null), 0);
}

function dateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

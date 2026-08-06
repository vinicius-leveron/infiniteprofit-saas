import { describe, expect, it } from "vitest";
import type { DailyRow } from "@/lib/csv";
import {
  applyDashboardDimensionMetrics,
  calculateAttributionCoverage,
  filterDashboardAdDimensions,
  reconcileDashboardMediaFilters,
  type DashboardAdDimension,
  type DashboardDimensionMetricRow,
} from "./dashboardDimensions";

const dimensions: DashboardAdDimension[] = [
  {
    account_id: "account-1",
    account_label: "Conta 1",
    campaign_id: "campaign-a",
    campaign_name: "Campanha A",
    adset_id: "adset-x",
    adset_name: "Conjunto X",
    ad_id: "ad-1",
    ad_name: "Anúncio 1",
  },
  {
    account_id: "account-2",
    account_label: "Conta 2",
    campaign_id: "campaign-a",
    campaign_name: "Campanha A",
    adset_id: "adset-y",
    adset_name: "Conjunto Y",
    ad_id: "ad-2",
    ad_name: "Anúncio 2",
  },
  {
    account_id: "account-2",
    account_label: "Conta 2",
    campaign_id: "campaign-b",
    campaign_name: "Campanha B",
    adset_id: "adset-z",
    adset_name: "Conjunto Z",
    ad_id: "ad-3",
    ad_name: "Anúncio 3",
  },
];

describe("dashboard dimension filters", () => {
  it("uses OR within a dimension and AND between dimensions", () => {
    expect(filterDashboardAdDimensions(dimensions, {
      accountIds: ["account-1", "account-2"],
      campaignIds: ["campaign-a"],
      adsetIds: ["adset-y"],
      activity: "spent_in_period",
      includeUnattributed: false,
    }).map((row) => row.ad_id)).toEqual(["ad-2"]);
  });

  it("removes persisted selections that no longer exist in the current funnel", () => {
    expect(reconcileDashboardMediaFilters(dimensions, {
      accountIds: ["account-deleted", "account-2"],
      campaignIds: ["campaign-a", "campaign-deleted"],
      adsetIds: ["adset-x", "adset-y", "adset-deleted"],
      activity: "spent_in_period",
      includeUnattributed: true,
    })).toEqual({
      accountIds: ["account-2"],
      campaignIds: ["campaign-a"],
      adsetIds: ["adset-y"],
      activity: "spent_in_period",
      includeUnattributed: true,
    });
  });

  it("preserves the same filter object when every persisted selection is valid", () => {
    const filters = {
      accountIds: ["account-2"],
      campaignIds: ["campaign-b"],
      adsetIds: ["adset-z"],
      activity: "all" as const,
      includeUnattributed: false,
    };

    expect(reconcileDashboardMediaFilters(dimensions, filters)).toBe(filters);
  });

  it("recalculates AOV and unique offer conversion from attributed data", () => {
    const rows = applyDashboardDimensionMetrics(
      [baseRow()],
      [metricRow()],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].aov).toBe(1_000);
    expect(rows[0].convGeralOrderbump).toBe(20);
    expect(rows[0].convGeralUpsell).toBe(10);
    expect(rows[0].lucro).toBeCloseTo(7_878.5);
  });

  it("reports coverage against the unfiltered dashboard totals", () => {
    expect(calculateAttributionCoverage(
      [{ ...baseRow(), vendasFront: 20, fatBruto: 20_000, pageviews: 200 }],
      [metricRow()],
    )).toEqual({
      frontSalesPercent: 50,
      revenuePercent: 50,
      vslPercent: 50,
    });
  });

  it("returns an explanatory empty state instead of synthetic zero rows", () => {
    expect(applyDashboardDimensionMetrics([baseRow()], [{
      ...metricRow(),
      investimento: 0,
      impressoes: 0,
      pageviews: 0,
      vendas_front: 0,
      fat_bruto: 0,
    }])).toEqual([]);
  });
});

function baseRow(): DailyRow {
  return {
    data: "10/07/2026",
    date: new Date(2026, 6, 10),
    diaSemana: "sexta",
    investimento: 0,
    vendasFront: 0,
    vendasTotais: 0,
    fatBruto: 0,
    fatLiquido: 0,
    pageviews: 0,
    bumps: [],
  } as DailyRow;
}

function metricRow(): DashboardDimensionMetricRow {
  return {
    event_date: "2026-07-10",
    investimento: 1_000,
    impressoes: 100_000,
    cliques: 2_000,
    landing_pageviews: 1_500,
    pageviews: 100,
    plays_unicos: 50,
    chegaram_pitch: 25,
    checkouts: 20,
    vendas_front: 10,
    vendas_totais: 13,
    fat_bruto: 10_000,
    fat_liquido: 9_000,
    reembolsos: 1,
    valor_reembolsado: 500,
    order_bump_orders: 2,
    upsell_orders: 1,
  };
}

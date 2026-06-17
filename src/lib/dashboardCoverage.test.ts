import { describe, expect, it } from "vitest";
import { buildCoverageRows, summarizeCoverage } from "./dashboardCoverage";

describe("dashboard coverage contract", () => {
  it("marks absent raw and absent metrics as Faltando", () => {
    const rows = buildCoverageRows({
      rawBySource: {},
      rawByType: {},
      metricFilled: {},
      totalMetricDays: 0,
    });

    expect(rows.every((row) => row.status === "Faltando")).toBe(true);
    expect(summarizeCoverage(rows).Faltando).toBe(rows.length);
  });

  it("marks raw events without daily metrics as Parcial", () => {
    const rows = buildCoverageRows({
      rawBySource: { meta: 3 },
      rawByType: { insight: 3 },
      metricFilled: {},
      totalMetricDays: 0,
    });

    const metaRows = rows.filter((row) => row.group === "Tráfego Meta");
    expect(metaRows).toHaveLength(2);
    expect(metaRows.every((row) => row.status === "Parcial")).toBe(true);
  });

  it("marks real source and filled daily metrics as OK when KPI is not inherently partial", () => {
    const rows = buildCoverageRows({
      rawBySource: { meta: 3 },
      rawByType: { insight: 3 },
      metricFilled: {
        investimento: 3,
        impressoes: 3,
        cliques: 3,
        landing_pageviews: 3,
        cpm: 3,
        ctr: 3,
        cpc: 3,
      },
      totalMetricDays: 3,
    });

    const metaRows = rows.filter((row) => row.group === "Tráfego Meta");
    expect(metaRows.every((row) => row.status === "OK")).toBe(true);
  });

  it("keeps VTurb and cross-source funnel KPIs partial even when filled", () => {
    const rows = buildCoverageRows({
      rawBySource: { vturb: 5, gateway: 2, meta: 2 },
      rawByType: { stats_by_day: 5, insight: 2 },
      metricFilled: {
        pageviews: 5,
        views_unicas: 5,
        play_rate: 5,
        ret_pitch: 5,
        chegaram_pitch: 5,
        pitch_chk: 3,
        pitch_venda: 3,
        chk_venda: 3,
      },
      totalMetricDays: 5,
    });

    expect(rows.filter((row) => row.group === "VSL VTurb").every((row) => row.status === "Parcial")).toBe(true);
    expect(rows.filter((row) => row.group === "Derivados de funil").every((row) => row.status === "Parcial")).toBe(true);
  });
});

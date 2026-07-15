import { describe, expect, it } from "vitest";
import { dailyMetricsToDailyRows } from "./dailyMetrics";
import { computeTotals } from "./metrics";
import type { DailyRow } from "./csv";

describe("traffic metric mapping", () => {
  it("maps landing_pageviews from daily_metrics to DailyRow", () => {
    const [row] = dailyMetricsToDailyRows([
      {
        event_date: "2026-06-15",
        investimento: 120,
        impressoes: 1000,
        cliques: 200,
        landing_pageviews: 160,
        cpm: null,
        ctr: null,
        cpc: null,
        pageviews: 45,
        views_unicas: null,
        play_rate: null,
        ret_pitch: null,
        chegaram_pitch: null,
        checkouts: null,
        custo_pageview: null,
        custo_ic: null,
        taxa_carreg: null,
        pass_chk: null,
        pitch_chk: null,
        pitch_venda: null,
        chk_venda: null,
        vendas_front: null,
        vendas_totais: null,
        cpa_front: null,
        cac: null,
        aov: null,
        roi: null,
        lucro: null,
        imposto_meta: null,
        fat_bruto: null,
        fat_liquido: null,
        fat_front: null,
        fat_orderbump: null,
        fat_funil: null,
        reembolsos: null,
        taxa_reembolso: null,
        valor_reembolsado: null,
        aprov_cartao: null,
        aprov_pix: null,
        conv_geral_orderbump: null,
        proporcao_funil_front: null,
        obs: null,
        bumps: null,
      },
    ]);

    expect(row.landingPageviews).toBe(160);
    expect(row.pageviews).toBe(45);
  });

  it("uses landingPageviews for Meta traffic costs and preserves VSL pageviews", () => {
    const totals = computeTotals([
      {
        investimento: 120,
        impressoes: 1000,
        cliques: 200,
        landingPageviews: 160,
        pageviews: 40,
        checkouts: 4,
      } as DailyRow,
    ]);

    expect(totals.landingPageviews).toBe(160);
    expect(totals.pageviews).toBe(40);
    expect(totals.ctr).toBe(20);
    expect(totals.cpc).toBe(0.6);
    expect(totals.taxaCarreg).toBe(80);
    expect(totals.custoPageview).toBe(0.75);
    expect(totals.custoIC).toBe(30);
    expect(totals.passChk).toBe(10);
  });

  it("computes Meta tax, profit and ROI with the approved spreadsheet formula", () => {
    const totals = computeTotals([
      {
        investimento: 100,
        fatBruto: 1200,
        fatLiquido: 1000,
        impostoMeta: 12.15,
        lucro: 887.85,
      } as DailyRow,
    ]);

    expect(totals.impostoMeta).toBeCloseTo(12.15);
    expect(totals.lucro).toBeCloseTo(887.85);
    expect(totals.roas).toBeCloseTo(12);
    expect(totals.roi).toBeCloseTo(9.8785);
  });

  it("computes refund rate over approved front sales instead of funnel items", () => {
    const totals = computeTotals([
      {
        vendasFront: 20,
        vendasTotais: 36,
        reembolsos: 4,
      } as DailyRow,
    ]);

    expect(totals.taxaReembolso).toBeCloseTo(20);
  });

  it("computes funnel period rates from summed denominators instead of averaging daily percentages", () => {
    const totals = computeTotals([
      {
        pageviews: 100,
        playRate: 50,
        chegaramPitch: 10,
        checkouts: 5,
        vendasFront: 2,
        pitchChk: 50,
      } as DailyRow,
      {
        pageviews: 100,
        playRate: 50,
        chegaramPitch: 1,
        checkouts: 10,
        vendasFront: 1,
        pitchChk: 1000,
      } as DailyRow,
    ]);

    expect(totals.avgPlayRate).toBeCloseTo(50);
    expect(totals.avgRetPitch).toBeCloseTo(11);
    expect(totals.avgPitchChk).toBeCloseTo((15 / 11) * 100);
    expect(totals.avgPitchVenda).toBeCloseTo((3 / 11) * 100);
    expect(totals.avgChkVenda).toBeCloseTo(20);
  });
});

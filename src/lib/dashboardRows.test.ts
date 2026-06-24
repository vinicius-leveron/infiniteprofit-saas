import { describe, expect, it } from "vitest";
import type { DailyRow } from "./csv";
import { getDashboardPeriodRows, hasDashboardSignal } from "./dashboardRows";

function row(day: string, patch: Partial<DailyRow>): DailyRow {
  const [year, month, date] = day.split("-").map(Number);
  return {
    data: `${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`,
    date: new Date(year, month - 1, date),
    diaSemana: "",
    investimento: null,
    vendasFront: null,
    vendasTotais: null,
    cpaFront: null,
    fatBruto: null,
    fatLiquido: null,
    impostoMeta: null,
    roi: null,
    lucro: null,
    cac: null,
    aov: null,
    fatFront: null,
    fatOrderbump: null,
    fatFunil: null,
    reembolsos: null,
    taxaReembolso: null,
    valorReembolsado: null,
    aprovCartao: null,
    aprovPix: null,
    impressoes: null,
    cliques: null,
    landingPageviews: null,
    pageviews: null,
    checkouts: null,
    cpm: null,
    ctr: null,
    cpc: null,
    custoPageview: null,
    custoIC: null,
    taxaCarreg: null,
    passChk: null,
    playRate: null,
    retPitch: null,
    viewsUnicas: null,
    chegaramPitch: null,
    pitchChk: null,
    pitchVenda: null,
    chkVenda: null,
    obs: "",
    convGeralOrderbump: null,
    proporcaoFunilFront: null,
    bumps: [],
    ...patch,
  };
}

describe("dashboardRows", () => {
  it("keeps days with VTurb or Hubla signals even without spend or sales", () => {
    expect(hasDashboardSignal(row("2026-06-20", { pageviews: 10 }))).toBe(true);
    expect(hasDashboardSignal(row("2026-06-21", { checkouts: 2 }))).toBe(true);
    expect(hasDashboardSignal(row("2026-06-22", { reembolsos: 1 }))).toBe(true);
    expect(hasDashboardSignal(row("2026-06-23", {}))).toBe(false);
  });

  it("builds monthly ranges from every active source instead of only sales/spend days", () => {
    const rows = [
      row("2026-06-16", { pageviews: 10 }),
      row("2026-06-17", { checkouts: 1 }),
      row("2026-06-18", {}),
      row("2026-06-22", { investimento: 909 }),
    ];

    const { current } = getDashboardPeriodRows(rows, "30d");

    expect(current.map((item) => item.data)).toEqual(["16/06/2026", "17/06/2026", "22/06/2026"]);
  });

  it("filters custom dates using local yyyy-mm-dd keys to avoid timezone shifts", () => {
    const rows = [
      row("2026-05-31", { investimento: 1 }),
      row("2026-06-01", { pageviews: 10 }),
      row("2026-06-22", { landingPageviews: 50 }),
      row("2026-06-23", { checkouts: 1 }),
    ];

    const { current, previous } = getDashboardPeriodRows(rows, "custom", "2026-06-01", "2026-06-22");

    expect(current.map((item) => item.data)).toEqual(["01/06/2026", "22/06/2026"]);
    expect(previous.map((item) => item.data)).toEqual(["31/05/2026"]);
  });
});

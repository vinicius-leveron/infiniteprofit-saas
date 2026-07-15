import { describe, expect, it } from "vitest";
import type { DailyRow } from "./csv";
import { buildPositiveHighlights } from "./diagnostics";

describe("positive diagnostic highlights", () => {
  it("keeps only favorable changes of at least fifteen percent", () => {
    const previous = [{
      investimento: 100,
      fatBruto: 200,
      fatLiquido: 180,
      vendasFront: 10,
      vendasTotais: 10,
      reembolsos: 2,
    }] as DailyRow[];
    const current = [{
      investimento: 100,
      fatBruto: 240,
      fatLiquido: 216,
      vendasFront: 12,
      vendasTotais: 12,
      reembolsos: 1,
    }] as DailyRow[];

    const highlights = buildPositiveHighlights(current, previous);

    expect(highlights.find((item) => item.metric === "ROAS")?.changePct).toBeCloseTo(20);
    expect(highlights.some((item) => item.metric === "Taxa de Reembolso" && item.changePct < 0)).toBe(true);
    expect(highlights.every((item) => Math.abs(item.changePct) >= 15)).toBe(true);
  });
});

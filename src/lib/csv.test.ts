import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("daily spreadsheet parsing", () => {
  it("reconciles grouped order bump sales with front sales", () => {
    const csv = [
      "Data;Investimento;Vendas Front;Vendas Totais do Funil;Vendas Orderbump;Faturamento Líquido",
      "15/07/2026;100;22;26;11;1000",
    ].join("\n");

    const result = parseCsv(csv);

    expect(result.rows[0]?.vendasFront).toBe(22);
    expect(result.rows[0]?.vendasTotais).toBe(33);
  });
});

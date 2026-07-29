import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  hotmartSheetsToCsv,
  repairBrokenXlsxDimensions,
  sanitizeHotmartCsv,
} from "./hotmartImportFile";

const headers = [
  "Código da transação",
  "Status da transação",
  "Data da transação",
  "Código do produto",
  "Produto",
  "Faturamento bruto (sem impostos)",
  "Faturamento líquido",
  "Código SRC",
  "Ferramenta de Venda",
  "Transação do Produto Principal",
  "Comprador(a)",
  "Email do(a) Comprador(a)",
  "Telefone",
  "Documento",
  "Endereço",
];

describe("Hotmart import file", () => {
  it("selects the Hotmart report sheet and removes buyer PII", () => {
    const result = hotmartSheetsToCsv([
      {
        sheet: "Resumo",
        data: [["Métrica", "Valor"], ["Vendas", 1]],
      },
      {
        sheet: "Report",
        data: [
          headers,
          [
            "HP-1",
            "Aprovado",
            new Date(2026, 6, 29, 7, 36, 0),
            "prod-1",
            "Produto",
            297,
            243.04,
            "ad-1",
            "Produto principal",
            "(none)",
            "Pessoa",
            "pessoa@example.com",
            "11999999999",
            "00000000000",
            "Rua privada",
          ],
        ],
      },
    ]);

    expect(result.sheetName).toBe("Report");
    expect(result.discardedColumns).toBe(5);
    expect(result.csv).toContain("HP-1;Aprovado;29/07/2026 07:36:00");
    expect(result.csv).toContain("Código SRC");
    expect(result.csv).not.toContain("pessoa@example.com");
    expect(result.csv).not.toContain("11999999999");
    expect(result.csv).not.toContain("Rua privada");
  });

  it("sanitizes CSV exports before sending them to the backend", () => {
    const csv = [
      headers.join(";"),
      [
        "HP-1",
        "Aprovado",
        "29/07/2026 07:36:00",
        "prod-1",
        "Produto",
        "297",
        "243,04",
        "ad-1",
        "Produto principal",
        "(none)",
        "Pessoa",
        "pessoa@example.com",
        "11999999999",
        "00000000000",
        "Rua privada",
      ].join(";"),
    ].join("\n");
    const result = sanitizeHotmartCsv(csv);

    expect(result.discardedColumns).toBe(5);
    expect(result.csv).not.toContain("pessoa@example.com");
    expect(result.csv).not.toContain("00000000000");
    expect(result.csv).toContain("HP-1");
  });

  it("rejects generic spreadsheets", () => {
    expect(() =>
      hotmartSheetsToCsv([{
        sheet: "Dashboard",
        data: [["Data", "Vendas"], ["29/07/2026", 10]],
      }])
    ).toThrow("não parece ser");
  });

  it("repairs Hotmart exports whose OOXML dimension incorrectly says A1", async () => {
    const source = zipSync({
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><dimension ref="A1"/><sheetData>'
        + '<row r="1"><c r="A1" t="inlineStr"><is><t>Código</t></is></c></row>'
        + '<row r="33"><c r="BK33" t="inlineStr"><is><t>Fim</t></is></c></row>'
        + "</sheetData></worksheet>",
      ),
    });
    const input = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;
    const repaired = await repairBrokenXlsxDimensions(input);
    const archive = unzipSync(new Uint8Array(repaired as ArrayBuffer));
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);

    expect(sheet).toContain('<dimension ref="A1:BK33"/>');
  });
});

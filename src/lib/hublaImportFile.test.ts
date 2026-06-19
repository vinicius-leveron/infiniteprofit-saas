import { describe, expect, it } from "vitest";
import { hublaSheetsToCsv } from "./hublaImportFile";

describe("hublaImportFile", () => {
  it("converts Hubla workbook sheets to CSV using the invoice sheet instead of receiver splits", () => {
    const result = hublaSheetsToCsv([
      {
        sheet: "Recebedores",
        data: [
          ["ID da fatura", "Data de pagamento", "Participação", "ID do produto", "Nome do produto", "Valor da comissão"],
          ["fat-receiver", "01/06/2026 10:00", "Produtor", "prod-front", "Produto Front", "R$ 20,00"],
        ],
      },
      {
        sheet: "Vendas individuais",
        data: [
          ["ID da fatura", "Status da fatura", "Data de pagamento", "Valor total", "Email do cliente"],
          ["fat-1", "Aprovada", "01/06/2026 10:00", "R$ 241,42", "buyer@example.com"],
        ],
      },
    ]);

    expect(result.sheetName).toBe("Vendas individuais");
    expect(result.csv).toContain("ID da fatura;Status da fatura;Data de pagamento;Valor total;Email do cliente");
    expect(result.csv).toContain("fat-1;Aprovada;01/06/2026 10:00;R$ 241,42;buyer@example.com");
    expect(result.csv).not.toContain("fat-receiver");
  });

  it("formats Date cells as Brazilian dates before sending CSV to the importer", () => {
    const result = hublaSheetsToCsv([
      {
        sheet: "Faturas",
        data: [
          ["ID da fatura", "Status da fatura", "Data de pagamento", "Valor total"],
          ["fat-1", "Aprovada", new Date(2026, 5, 1, 10, 30, 0), "R$ 241,42"],
        ],
      },
    ]);

    expect(result.csv).toContain("fat-1;Aprovada;01/06/2026 10:30:00;R$ 241,42");
  });
});

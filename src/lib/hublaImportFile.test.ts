import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { hublaWorkbookArrayBufferToCsv } from "./hublaImportFile";

describe("hublaImportFile", () => {
  it("converts Hubla XLSX to CSV using the invoice sheet instead of receiver splits", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["ID da fatura", "Data de pagamento", "Participação", "ID do produto", "Nome do produto", "Valor da comissão"],
        ["fat-receiver", "01/06/2026 10:00", "Produtor", "prod-front", "Produto Front", "R$ 20,00"],
      ]),
      "Recebedores",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["ID da fatura", "Status da fatura", "Data de pagamento", "Valor total", "Email do cliente"],
        ["fat-1", "Aprovada", "01/06/2026 10:00", "R$ 241,42", "buyer@example.com"],
      ]),
      "Vendas individuais",
    );

    const written = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const buffer = written instanceof ArrayBuffer
      ? written
      : written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);

    const result = await hublaWorkbookArrayBufferToCsv(buffer);

    expect(result.sheetName).toBe("Vendas individuais");
    expect(result.csv).toContain("ID da fatura;Status da fatura;Data de pagamento;Valor total;Email do cliente");
    expect(result.csv).toContain("fat-1;Aprovada;01/06/2026 10:00;R$ 241,42;buyer@example.com");
    expect(result.csv).not.toContain("fat-receiver");
  });
});

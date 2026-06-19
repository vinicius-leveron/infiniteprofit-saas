import type { WorkBook, WorkSheet } from "xlsx";

export type HublaImportFileResult = {
  csv: string;
  kind: "csv" | "xlsx";
  sheetName?: string;
};

const EXCEL_FILE_PATTERN = /\.(xlsx|xls)$/i;
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export async function readHublaImportFile(file: File): Promise<HublaImportFileResult> {
  if (isExcelFile(file)) {
    const buffer = await file.arrayBuffer();
    const converted = await hublaWorkbookArrayBufferToCsv(buffer);
    return { ...converted, kind: "xlsx" };
  }

  return {
    csv: await file.text(),
    kind: "csv",
  };
}

type XlsxRuntime = typeof import("xlsx");

export async function hublaWorkbookArrayBufferToCsv(buffer: ArrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = pickHublaWorksheet(workbook, XLSX);
  const worksheet = workbook.Sheets[sheetName];
  const rows = worksheetToRows(worksheet, XLSX);

  if (rows.length === 0) {
    throw new Error("XLSX vazio ou sem linhas reconhecíveis");
  }

  return {
    sheetName,
    csv: rowsToCsv(rows),
  };
}

function isExcelFile(file: File) {
  return EXCEL_FILE_PATTERN.test(file.name) || EXCEL_MIME_TYPES.has(file.type);
}

function pickHublaWorksheet(workbook: WorkBook, XLSX: XlsxRuntime) {
  const ranked = workbook.SheetNames
    .map((name, index) => ({
      name,
      index,
      score: scoreWorksheet(workbook.Sheets[name], XLSX),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = ranked[0];
  if (!best || best.score < 8) {
    throw new Error("XLSX não parece ser um export de faturas/vendas da Hubla");
  }

  return best.name;
}

function scoreWorksheet(worksheet: WorkSheet, XLSX: XlsxRuntime) {
  const headers = firstHeaderRow(worksheet, XLSX);
  const hasAny = (aliases: string[]) => aliases.some((alias) => headers.has(alias));
  let score = 0;

  if (hasAny(["id_da_fatura", "transacao", "transacao_id", "transaction", "transaction_id", "id", "pedido", "order_id", "invoice_id"])) score += 4;
  if (hasAny(["status_da_fatura", "status", "situacao", "situacao_da_compra", "order_status", "payment_status"])) score += 4;
  if (hasAny(["valor_total", "valor", "total", "amount", "amount_paid", "preco", "price", "receita"])) score += 3;
  if (hasAny(["data_de_pagamento", "data_pagamento", "data_aprovacao", "paid_at", "approved_at", "data", "created_at", "criado_em"])) score += 2;
  if (hasAny(["metodo_de_pagamento", "metodo_pagamento", "forma_pagamento", "payment_method", "method"])) score += 1;
  if (hasAny(["nome_do_produto", "produto", "produto_nome", "product", "product_name", "nome_da_oferta", "oferta", "offer"])) score += 1;
  if (hasAny(["utm_origem", "utm_source", "source"])) score += 1;

  return score;
}

function firstHeaderRow(worksheet: WorkSheet, XLSX: XlsxRuntime) {
  const rows = worksheetToRows(worksheet, XLSX);
  const row = rows.find((item) => item.some((cell) => String(cell ?? "").trim())) ?? [];
  return new Set(row.map(normalizeHeader).filter(Boolean));
}

function worksheetToRows(worksheet: WorkSheet, XLSX: XlsxRuntime) {
  const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  return rows
    .map((row) => trimTrailingEmptyCells(row.map((cell) => String(cell ?? "").trim())))
    .filter((row) => row.some((cell) => cell));
}

function trimTrailingEmptyCells(row: string[]) {
  let end = row.length;
  while (end > 0 && !row[end - 1]) end -= 1;
  return row.slice(0, end);
}

function rowsToCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(";")).join("\n");
}

function csvCell(value: string) {
  if (!/[;"\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function normalizeHeader(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

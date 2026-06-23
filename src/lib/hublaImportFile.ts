export type HublaImportFileResult = {
  csv: string;
  kind: "csv" | "xlsx";
  sheetName?: string;
};

type HublaSheet = {
  sheet: string;
  data: ReadonlyArray<ReadonlyArray<unknown>>;
};

const EXCEL_FILE_PATTERN = /\.(xlsx|xls)$/i;
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export async function readHublaImportFile(file: File): Promise<HublaImportFileResult> {
  if (isExcelFile(file)) {
    const converted = await hublaWorkbookFileToCsv(file);
    return { ...converted, kind: "xlsx" };
  }

  return {
    csv: await file.text(),
    kind: "csv",
  };
}

export async function hublaWorkbookFileToCsv(file: File | Blob | ArrayBuffer) {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return hublaSheetsToCsv(sheets);
}

export function hublaSheetsToCsv(sheets: HublaSheet[]) {
  const sheet = pickHublaSheet(sheets);
  const rows = sheetDataToRows(sheet.data);

  if (rows.length === 0) {
    throw new Error("XLSX vazio ou sem linhas reconhecíveis");
  }
  if (rows.length < 2) {
    throw new Error("XLSX Hubla sem linhas de venda. Exporte faturas/vendas com pelo menos uma linha além do cabeçalho.");
  }

  return {
    sheetName: sheet.sheet,
    csv: rowsToCsv(rows),
  };
}

function isExcelFile(file: File) {
  return EXCEL_FILE_PATTERN.test(file.name) || EXCEL_MIME_TYPES.has(file.type);
}

function pickHublaSheet(sheets: HublaSheet[]) {
  const ranked = sheets
    .map((sheet, index) => ({
      sheet,
      index,
      score: scoreSheet(sheet),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = ranked[0];
  if (!best || best.score < 8) {
    throw new Error("XLSX não parece ser um export de faturas/vendas da Hubla");
  }

  return best.sheet;
}

function scoreSheet(sheet: HublaSheet) {
  const headers = firstHeaderRow(sheet);
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

function firstHeaderRow(sheet: HublaSheet) {
  const rows = sheetDataToRows(sheet.data);
  const row = rows.find((item) => item.some((cell) => cell.trim())) ?? [];
  return new Set(row.map(normalizeHeader).filter(Boolean));
}

function sheetDataToRows(data: HublaSheet["data"]) {
  return data
    .map((row) => trimTrailingEmptyCells(row.map(formatCell)))
    .filter((row) => row.some((cell) => cell));
}

function formatCell(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return formatDateCell(value);
  return String(value).trim();
}

function formatDateCell(value: Date) {
  const day = String(value.getDate()).padStart(2, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const year = value.getFullYear();
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  const hasTime = value.getHours() || value.getMinutes() || value.getSeconds();
  return hasTime ? `${day}/${month}/${year} ${hour}:${minute}:${second}` : `${day}/${month}/${year}`;
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

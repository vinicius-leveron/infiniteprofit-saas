import Papa from "papaparse";

export type HotmartImportFileResult = {
  csv: string;
  kind: "csv" | "xlsx";
  sheetName?: string;
  discardedColumns: number;
};

type HotmartSheet = {
  sheet: string;
  data: ReadonlyArray<ReadonlyArray<unknown>>;
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const EXCEL_FILE_PATTERN = /\.(xlsx|xls)$/i;
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const SAFE_HOTMART_HEADERS = new Set([
  "codigo_da_transacao",
  "status_da_transacao",
  "data_da_transacao",
  "confirmacao_do_pagamento",
  "codigo_do_produto",
  "produto",
  "codigo_do_preco",
  "nome_deste_preco",
  "moeda_de_compra",
  "valor_de_compra_sem_impostos",
  "moeda_de_recebimento",
  "faturamento_bruto_sem_impostos",
  "faturamento_liquido",
  "venda_feita_como",
  "faturamento_liquido_do_a_produtor_a",
  "comissao_do_a_afiliado_a",
  "faturamento_do_a_coprodutor_a",
  "moeda_das_taxas",
  "taxa_de_processamento",
  "taxa_de_streaming",
  "outras_taxas",
  "codigo_src",
  "codigo_sck",
  "metodo_de_pagamento",
  "quantidade_de_itens",
  "ferramenta_de_venda",
  "transacao_do_produto_principal",
  "imposto_sobre_servico_hotmart",
  "impostos_locais",
  "taxa_de_parcelamento",
]);

export async function readHotmartImportFile(
  file: File,
): Promise<HotmartImportFileResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("A planilha excede o limite de 8 MB.");
  }
  if (isExcelFile(file)) {
    const converted = await hotmartWorkbookFileToCsv(file);
    return { ...converted, kind: "xlsx" };
  }
  return {
    ...sanitizeHotmartCsv(await file.text()),
    kind: "csv",
  };
}

export async function hotmartWorkbookFileToCsv(
  file: File | Blob | ArrayBuffer,
) {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const repaired = await repairBrokenXlsxDimensions(file);
  const sheets = await readXlsxFile(repaired);
  return hotmartSheetsToCsv(sheets);
}

export async function repairBrokenXlsxDimensions(
  file: File | Blob | ArrayBuffer,
) {
  const { strFromU8, strToU8, unzipSync, zipSync } = await import("fflate");
  const isArrayBuffer =
    file instanceof ArrayBuffer
    || Object.prototype.toString.call(file) === "[object ArrayBuffer]";
  const buffer = isArrayBuffer
    ? file as ArrayBuffer
    : await (file as File | Blob).arrayBuffer();
  const archive = unzipSync(new Uint8Array(buffer));
  const uncompressedBytes = Object.values(archive).reduce(
    (total, entry) => total + entry.byteLength,
    0,
  );
  if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new Error("A planilha expandida excede o limite seguro de 64 MB.");
  }
  let repaired = false;

  for (const [path, bytes] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(path)) continue;
    const xml = strFromU8(bytes);
    const currentDimension =
      /<dimension\b[^>]*\bref="([^"]+)"[^>]*\/?>/i.exec(xml)?.[1];
    const actualDimension = worksheetDimension(xml);
    if (
      !actualDimension
      || currentDimension === actualDimension
      || currentDimension === `A1:${actualDimension}`
    ) {
      continue;
    }
    archive[path] = strToU8(
      /<dimension\b[^>]*\bref="[^"]+"[^>]*\/?>/i.test(xml)
        ? xml.replace(
          /<dimension\b[^>]*\bref="[^"]+"[^>]*\/?>/i,
          `<dimension ref="A1:${actualDimension}"/>`,
        )
        : xml.replace(
          /<worksheet\b[^>]*>/i,
          (opening) =>
            `${opening}<dimension ref="A1:${actualDimension}"/>`,
        ),
    );
    repaired = true;
  }

  if (!repaired) {
    return isArrayBuffer
      ? file as ArrayBuffer
      : file;
  }
  const repairedArchive = zipSync(archive);
  if (isArrayBuffer) {
    return repairedArchive.buffer.slice(
      repairedArchive.byteOffset,
      repairedArchive.byteOffset + repairedArchive.byteLength,
    ) as ArrayBuffer;
  }
  return new Blob([repairedArchive], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function hotmartSheetsToCsv(sheets: HotmartSheet[]) {
  const ranked = sheets
    .map((sheet, index) => ({ sheet, index, score: scoreSheet(sheet) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ranked[0];
  if (!selected || selected.score < 14) {
    throw new Error(
      "XLS/XLSX não parece ser o relatório de vendas exportado pela Hotmart.",
    );
  }

  const rows = sheetDataToRows(selected.sheet.data);
  if (rows.length < 2) {
    throw new Error(
      "Planilha Hotmart sem vendas. Exporte o relatório com pelo menos uma linha.",
    );
  }
  return {
    sheetName: selected.sheet.sheet,
    ...sanitizeRows(rows),
  };
}

export function sanitizeHotmartCsv(csv: string) {
  const parsed = Papa.parse<string[]>(csv, {
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length > 0 && parsed.data.length < 2) {
    throw new Error("Não foi possível interpretar o CSV da Hotmart.");
  }
  const rows = parsed.data.map((row) => row.map(formatCell));
  if (rows.length < 2) {
    throw new Error("CSV Hotmart sem linhas de venda.");
  }
  return sanitizeRows(rows);
}

function sanitizeRows(rows: string[][]) {
  const headers = rows[0];
  const normalized = headers.map(normalizeHeader);
  const required = [
    "codigo_da_transacao",
    "status_da_transacao",
    "data_da_transacao",
    "codigo_do_produto",
    "faturamento_bruto_sem_impostos",
  ];
  const missing = required.filter((header) => !normalized.includes(header));
  if (missing.length > 0) {
    throw new Error(
      "Arquivo não parece ser o relatório de vendas da Hotmart.",
    );
  }

  const keptIndexes = normalized.flatMap((header, index) =>
    SAFE_HOTMART_HEADERS.has(header) ? [index] : []
  );
  const safeRows = rows
    .map((row) => keptIndexes.map((index) => row[index] ?? ""))
    .filter((row, index) => index === 0 || row.some(Boolean));
  return {
    csv: rowsToCsv(safeRows),
    discardedColumns: Math.max(0, headers.length - keptIndexes.length),
  };
}

function scoreSheet(sheet: HotmartSheet) {
  const rows = sheetDataToRows(sheet.data);
  const headers = new Set((rows[0] ?? []).map(normalizeHeader));
  let score = 0;
  if (headers.has("codigo_da_transacao")) score += 4;
  if (headers.has("status_da_transacao")) score += 4;
  if (headers.has("data_da_transacao")) score += 3;
  if (headers.has("codigo_do_produto") && headers.has("produto")) score += 3;
  if (headers.has("faturamento_bruto_sem_impostos")) score += 3;
  if (headers.has("faturamento_liquido")) score += 2;
  if (headers.has("ferramenta_de_venda")) score += 1;
  if (headers.has("transacao_do_produto_principal")) score += 2;
  return score;
}

function worksheetDimension(xml: string) {
  let maxColumn = 0;
  let maxRow = 0;
  for (const match of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/gi)) {
    maxColumn = Math.max(maxColumn, columnNumber(match[1]));
    maxRow = Math.max(maxRow, Number(match[2]));
  }
  if (maxColumn === 0 || maxRow === 0) return "";
  return `${columnName(maxColumn)}${maxRow}`;
}

function columnNumber(name: string) {
  return name.toUpperCase().split("").reduce(
    (total, char) => total * 26 + char.charCodeAt(0) - 64,
    0,
  );
}

function columnName(number: number) {
  let current = number;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result;
}

function isExcelFile(file: File) {
  return EXCEL_FILE_PATTERN.test(file.name) || EXCEL_MIME_TYPES.has(file.type);
}

function sheetDataToRows(data: HotmartSheet["data"]) {
  return data
    .map((row) => trimTrailingEmptyCells(row.map(formatCell)))
    .filter((row) => row.some(Boolean));
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
  return hasTime
    ? `${day}/${month}/${year} ${hour}:${minute}:${second}`
    : `${day}/${month}/${year}`;
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

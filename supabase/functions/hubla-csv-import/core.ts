import { normalizeEvent, type NormalizedEvent } from "../webhook-gateway/core.ts";

export type HublaCsvEvent = NormalizedEvent & { line: number };

export type HublaCsvParseResult = {
  events: HublaCsvEvent[];
  warnings: string[];
  dataRows: number;
  headers: string[];
};

type RowConversion =
  | { raw: unknown; line: number; warning?: never; reason?: never }
  | { raw: null; line: number; warning: string; reason: string };

export function parseHublaCsv(csv: string): HublaCsvParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("CSV sem linhas suficientes");
  }

  const headers = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
  const normalized = dataRows.map((row, index) => rowToHublaRaw(headers, row, index + 2));
  const warnings: string[] = [];
  const events: HublaCsvEvent[] = [];

  for (const item of normalized) {
    if (!item.raw) {
      warnings.push(item.warning);
      continue;
    }
    const parsed = normalizeEvent("hubla", item.raw);
    if (parsed.length === 0) {
      warnings.push(`Linha ${item.line}: evento ignorado (${item.reason ?? "status/valor não reconhecido"})`);
      continue;
    }
    for (const event of parsed) {
      events.push({ ...event, line: item.line });
    }
  }

  return { events, warnings, dataRows: dataRows.length, headers };
}

function rowToHublaRaw(headers: string[], row: string[], line: number): RowConversion {
  const record = new Map(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = record.get(key);
      if (value) return value;
    }
    return "";
  };

  const status = get("status_da_fatura", "status", "situacao", "situacao_da_compra", "order_status", "payment_status");
  const type = eventTypeFromStatus(status || get("evento", "event", "tipo"));
  if (!type) {
    return { raw: null, line, warning: `Linha ${line}: status não reconhecido (${status || "vazio"})`, reason: "status" };
  }

  const transaction = get("id_da_fatura", "fatura_id", "fatura", "transacao", "transacao_id", "transaction", "transaction_id", "id", "pedido", "order_id", "invoice_id");
  if (!transaction) {
    return { raw: null, line, warning: `Linha ${line}: transação/id ausente`, reason: "external_id" };
  }

  const total = parseMoney(get("valor_total", "valor", "total", "amount", "amount_paid", "preco", "price", "receita"));
  const productTotal = parseMoney(get("valor_do_produto", "valor_produto", "product_amount", "product_value"));
  const net = parseMoney(get("valor_liquido", "valor_liquido_da_fatura", "liquido", "net", "net_amount")) || total;
  const paidDate = get("data_de_pagamento", "data_pagamento", "data_aprovacao", "paid_at", "approved_at");
  const createdDate = get("data_de_criacao", "data_criacao", "created_at", "criado_em", "data");
  const refundedDate = get("data_de_reembolso", "data_reembolso", "refunded_at");
  const date = parseDate(type === "invoice.refunded" ? (refundedDate || paidDate || createdDate) : (paidDate || createdDate));

  const productName = get("nome_do_produto", "produto", "produto_nome", "product", "product_name", "nome_da_oferta", "oferta", "offer");
  const productId = get("id_do_produto", "produto_id", "product_id", "offer_id");
  const orderBumpProductId = get("id_do_produto_de_orderbump", "produto_orderbump_id", "orderbump_product_id", "bump_product_id");
  const orderBumpProductName = get("nome_do_produto_de_orderbump", "produto_orderbump", "orderbump_product_name", "bump_product_name");
  const itemType = get("tipo_de_fatura", "detalhamento_da_fatura", "tipo_produto", "tipo_oferta", "item_type", "offer_type", "tipo").toLowerCase();
  const isBump = itemType.includes("bump") || itemType.includes("upsell") || itemType.includes("order");
  const offerType = itemType.includes("upsell") ? "upsell" : "orderbump";
  const hasOrderBump = Boolean(orderBumpProductId || orderBumpProductName);
  const mainItemIsOffer = isBump && !hasOrderBump;
  const mainItemPrice = hasOrderBump && productTotal > 0 ? productTotal : total;
  const orderBumpPrice = hasOrderBump && productTotal > 0 ? Math.max(0, total - productTotal) : 0;
  const items = [
    ...(productName || productId
      ? [{
        id: productId || transaction,
        name: productName || productId || transaction,
        price: mainItemPrice,
        type: mainItemIsOffer ? offerType : "main",
        is_bump: mainItemIsOffer,
      }]
      : []),
    ...(hasOrderBump
      ? [{
        id: orderBumpProductId || `${transaction}-orderbump`,
        name: orderBumpProductName || orderBumpProductId || "Order bump",
        price: orderBumpPrice,
        type: offerType,
        is_bump: true,
      }]
      : []),
  ];

  return {
    line,
    raw: {
      type,
      data: {
        object: {
          id: transaction,
          amount_paid: Math.round(total * 100),
          net_amount: net,
          payment_method: get("metodo_de_pagamento", "metodo_pagamento", "forma_pagamento", "payment_method", "method"),
          customer_email: get("email_do_cliente", "email", "comprador_email", "buyer_email", "customer_email"),
          product_id: productId,
          product: { id: productId, name: productName },
          paid_at: date,
          created_at: date,
          is_offer: mainItemIsOffer,
          items,
          metadata: {
            utm_source: get("utm_origem", "utm_source", "source"),
            utm_medium: get("utm_midia", "utm_medium", "medium"),
            utm_campaign: get("utm_campanha", "utm_campaign", "campaign"),
            utm_content: get("utm_conteudo", "utm_content", "content", "ad_id"),
            utm_term: get("utm_termo", "utm_term", "term"),
          },
        },
      },
      import_source: "hubla_csv",
      raw_row: Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
    },
  };
}

function eventTypeFromStatus(status: string) {
  const value = normalizeHeader(status);
  if (!value) return "";
  if (/(aprov|paid|pag[ao]|complete|conclu|success|succeeded)/.test(value)) return "invoice.payment_succeeded";
  if (/(refund|reemb|chargeback|estorn)/.test(value)) return "invoice.refunded";
  if (/(recus|refus|declin|failed|falh|cancel|expir|canceled|cancelled)/.test(value)) return "invoice.payment_failed";
  if (/(checkout|aband|pend|aguard|waiting|created|pix|boleto)/.test(value)) return "checkout.created";
  return "";
}

function parseCsv(csv: string) {
  const delimiter = detectDelimiter(csv);
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(current);
      current = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    current += char;
  }
  row.push(current);
  rows.push(row);
  return rows.filter((item) => item.some((cell) => cell.trim()));
}

function detectDelimiter(csv: string) {
  const firstLine = csv.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function parseMoney(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");
  if (!normalized) return 0;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    const commaIndex = normalized.lastIndexOf(",");
    const dotIndex = normalized.lastIndexOf(".");
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return Number(normalized.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".")) || 0;
  }
  if (hasComma) return Number(normalized.replace(",", ".")) || 0;
  return Number(normalized) || 0;
}

function parseDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return new Date().toISOString();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    const hour = br[4]?.padStart(2, "0") ?? "12";
    const minute = br[5] ?? "00";
    const second = br[6] ?? "00";
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${hour}:${minute}:${second}-03:00`;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
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

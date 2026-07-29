import {
  normalizeEvent,
  type CheckoutProductRole,
  type NormalizedEvent,
} from "../webhook-gateway/core.ts";

export type HublaCsvEvent = NormalizedEvent & { line: number };

export type HublaCsvParseResult = {
  events: HublaCsvEvent[];
  warnings: string[];
  dataRows: number;
  headers: string[];
};

export type HotmartCsvEvent = NormalizedEvent & { line: number };

export type HotmartCsvParseContext = {
  productRoles: Record<string, CheckoutProductRole>;
  offerRoles: Record<string, CheckoutProductRole>;
};

export type HotmartCsvParseResult = {
  events: HotmartCsvEvent[];
  warnings: string[];
  dataRows: number;
  headers: string[];
  imported: number;
  excluded: number;
};

export type DailyMetricsCsvOverride = {
  event_date: string;
  payload: Record<string, unknown>;
  line: number;
};

export type DailyMetricsCsvParseResult = {
  overrides: DailyMetricsCsvOverride[];
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

export function parseHotmartCsv(
  csv: string,
  context: HotmartCsvParseContext,
): HotmartCsvParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("Planilha Hotmart sem linhas de venda");
  }

  const headers = rows[0].map(normalizeHeader);
  assertHotmartHeaders(headers);
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
  const warnings: string[] = [];
  const eventByKey = new Map<string, HotmartCsvEvent>();

  for (const [index, row] of dataRows.entries()) {
    const line = index + 2;
    const converted = rowToHotmartRaw(headers, row, line, context);
    if (!converted.raw) {
      warnings.push(converted.warning);
      continue;
    }

    const normalized = normalizeEvent("hotmart", converted.raw, {
      productRoles: context.productRoles,
      offerRoles: context.offerRoles,
      requireProductBinding: true,
      source: "spreadsheet",
    });
    if (normalized.length === 0) {
      warnings.push(
        `Linha ${line}: status ou valores da Hotmart não reconhecidos`,
      );
      continue;
    }

    for (const event of normalized) {
      const payload = {
        ...event.payload,
        transaction_id:
          event.event_type === "purchase.approved" && converted.parentTransaction
            ? converted.parentTransaction
            : event.payload?.transaction_id || converted.transaction,
        parent_transaction_id: converted.parentTransaction || null,
        spreadsheet_sale_tool: converted.saleTool || null,
      };

      if (converted.roleMismatch) {
        payload.metrics_ready = false;
        payload.exclusion_reason = "product_role_mismatch";
        warnings.push(
          `Linha ${line}: o papel de “${converted.productName}” na planilha não `
          + "confere com o vínculo do funil; a linha foi preservada sem afetar métricas",
        );
      } else if (
        event.payload?.product_role !== "front"
        && !converted.parentTransaction
      ) {
        payload.metrics_ready = false;
        payload.exclusion_reason = "missing_parent_transaction";
        warnings.push(
          `Linha ${line}: oferta sem “Transação do Produto Principal”; `
          + "a linha foi preservada sem afetar métricas",
        );
      }

      if (payload.metrics_ready === false) {
        const reason = String(payload.exclusion_reason ?? "");
        if (reason === "unbound_product") {
          warnings.push(
            `Linha ${line}: produto “${converted.productName}” não está vinculado `
            + "a este funil e não entrará nas métricas",
          );
        } else if (reason === "unsupported_currency") {
          warnings.push(
            `Linha ${line}: moeda sem conversão autoritativa para BRL; `
            + "a venda foi preservada sem entrar no financeiro",
          );
        }
      }

      const importedEvent: HotmartCsvEvent = {
        ...event,
        payload,
        line,
      };
      const key = `${event.event_type}:${event.external_id}`;
      if (eventByKey.has(key)) {
        warnings.push(
          `Linha ${line}: transação duplicada no arquivo; mantida somente uma ocorrência`,
        );
      }
      eventByKey.set(key, importedEvent);
    }
  }

  const events = [...eventByKey.values()];
  const imported = events.filter(
    (event) => event.payload?.metrics_ready !== false,
  ).length;
  return {
    events,
    warnings: uniqueStrings(warnings),
    dataRows: dataRows.length,
    headers,
    imported,
    excluded: events.length - imported,
  };
}

type HotmartRowConversion =
  | {
    raw: Record<string, unknown>;
    line: number;
    transaction: string;
    parentTransaction: string;
    productName: string;
    saleTool: string;
    roleMismatch: boolean;
  }
  | {
    raw: null;
    line: number;
    warning: string;
  };

function rowToHotmartRaw(
  headers: string[],
  row: string[],
  line: number,
  context: HotmartCsvParseContext,
): HotmartRowConversion {
  const record = new Map(headers.map((header, index) => [
    header,
    cleanSpreadsheetValue(row[index]),
  ]));
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = record.get(key);
      if (value) return value;
    }
    return "";
  };

  const transaction = get("codigo_da_transacao", "transacao");
  if (!transaction) {
    return { raw: null, line, warning: `Linha ${line}: código da transação ausente` };
  }
  const event = hotmartSpreadsheetEvent(get("status_da_transacao", "status"));
  if (!event) {
    return {
      raw: null,
      line,
      warning: `Linha ${line}: status Hotmart não reconhecido`,
    };
  }

  const productId = get("codigo_do_produto", "produto_id");
  const productName = get("produto", "nome_do_produto") || productId;
  if (!productId) {
    return { raw: null, line, warning: `Linha ${line}: código do produto ausente` };
  }

  const occurredAt = parseDateStrict(
    event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE"
      ? get("confirmacao_do_pagamento", "data_da_transacao")
      : get("data_da_transacao", "confirmacao_do_pagamento"),
  );
  if (!occurredAt) {
    return { raw: null, line, warning: `Linha ${line}: data da transação inválida` };
  }

  const currency = get(
    "moeda_de_recebimento",
    "moeda_de_compra",
  ).toUpperCase();
  const gross = positiveMoney(get(
    "faturamento_bruto_sem_impostos",
    "valor_de_compra_sem_impostos",
  ));
  const producerNet = positiveMoney(get(
    "faturamento_liquido_do_a_produtor_a",
    "faturamento_liquido",
  ));
  const affiliateNet = positiveMoney(get("comissao_do_a_afiliado_a"));
  const coproducerNet = positiveMoney(get("faturamento_do_a_coprodutor_a"));
  const payoutNet = roundMoney(producerNet + affiliateNet + coproducerNet);
  const processingFee = positiveMoney(get("taxa_de_processamento"));
  const streamingFee = positiveMoney(get("taxa_de_streaming"));
  const otherFees = positiveMoney(get("outras_taxas"));
  const serviceTax = positiveMoney(get("imposto_sobre_servico_hotmart"));
  const platformFee = roundMoney(
    processingFee + streamingFee + otherFees + serviceTax,
  );
  const fallbackNet = positiveMoney(get("faturamento_liquido"));
  const canonicalNet = roundMoney(
    payoutNet || fallbackNet || Math.max(0, gross - platformFee),
  );

  if (
    (event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE")
    && gross <= 0
  ) {
    return {
      raw: null,
      line,
      warning: `Linha ${line}: faturamento bruto inválido`,
    };
  }

  const offerCode = get("codigo_do_preco", "codigo_da_oferta");
  const boundRole = context.offerRoles[offerCode]
    ?? context.productRoles[productId]
    ?? null;
  const saleTool = get("ferramenta_de_venda");
  const spreadsheetRole = hotmartSpreadsheetRole(saleTool);
  const roleMismatch = Boolean(
    boundRole && spreadsheetRole && boundRole !== spreadsheetRole,
  );
  const parentTransaction = get("transacao_do_produto_principal");
  const src = get("codigo_src");
  const sck = get("codigo_sck");

  return {
    line,
    transaction,
    parentTransaction,
    productName,
    saleTool,
    roleMismatch,
    raw: {
      id: `spreadsheet-${transaction}-${event}`,
      event,
      creation_date: occurredAt,
      data: {
        product: {
          id: productId,
          name: productName,
        },
        purchase: {
          transaction,
          status: get("status_da_transacao", "status"),
          order_date: parseDateStrict(get("data_da_transacao")) ?? occurredAt,
          approved_date: parseDateStrict(
            get("confirmacao_do_pagamento"),
          ) ?? occurredAt,
          full_price: {
            value: gross,
            currency_value: currency,
          },
          hotmart_fee: {
            total: platformFee,
            currency_value: currency,
          },
          offer: { code: offerCode },
          payment: {
            type: get("metodo_de_pagamento"),
          },
          refund_value: event === "PURCHASE_PARTIALLY_REFUNDED"
            ? { value: gross, currency_value: currency }
            : undefined,
          origin: {
            src,
            sck,
          },
        },
        commissions: canonicalNet > 0
          ? [{
            source: "PRODUCER",
            commission: {
              value: canonicalNet,
              currency_value: currency,
            },
          }]
          : [],
      },
    },
  };
}

function assertHotmartHeaders(headers: string[]) {
  const set = new Set(headers);
  const required = [
    ["codigo_da_transacao", "Código da transação"],
    ["status_da_transacao", "Status da transação"],
    ["data_da_transacao", "Data da transação"],
    ["codigo_do_produto", "Código do produto"],
    ["faturamento_bruto_sem_impostos", "Faturamento bruto (sem impostos)"],
  ] as const;
  const missing = required
    .filter(([key]) => !set.has(key))
    .map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(
      `Planilha Hotmart inválida. Colunas ausentes: ${missing.join(", ")}`,
    );
  }
}

function hotmartSpreadsheetEvent(status: string) {
  const value = normalizeHeader(status);
  if (/(aprov|complet|conclu)/.test(value)) return "PURCHASE_APPROVED";
  if (/reemb.*parcial|parcial.*reemb/.test(value)) {
    return "PURCHASE_PARTIALLY_REFUNDED";
  }
  if (/(reemb|chargeback|estorn)/.test(value)) return "PURCHASE_REFUNDED";
  if (/(cancel|recus|declin|expir|atras|protest)/.test(value)) {
    return "PURCHASE_CANCELED";
  }
  if (/(boleto|pix_gerado|aguardando_pagamento|pendente)/.test(value)) {
    return "PURCHASE_BILLET_PRINTED";
  }
  return "";
}

function hotmartSpreadsheetRole(value: string): CheckoutProductRole | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (normalized.includes("upsell")) return "upsell";
  if (normalized.includes("order_bump") || normalized.includes("orderbump")) {
    return "order_bump";
  }
  if (normalized.includes("principal") || normalized.includes("front")) {
    return "front";
  }
  return null;
}

function cleanSpreadsheetValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || /^\((none|empty)\)$/i.test(text)) return "";
  return text;
}

function positiveMoney(value: string) {
  return Math.abs(parseMoney(value));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDateStrict(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const br =
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
      .exec(trimmed);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    const hour = br[4]?.padStart(2, "0") ?? "12";
    const minute = br[5] ?? "00";
    const second = br[6] ?? "00";
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T${hour}:${minute}:${second}-03:00`;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function parseDailyMetricsCsv(csv: string): DailyMetricsCsvParseResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    throw new Error("CSV sem linhas suficientes");
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map(normalizeHeader);
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
  const warnings: string[] = [];
  const overrides: DailyMetricsCsvOverride[] = [];

  if (!looksLikeDailyMetricsSheet(headers)) {
    return { overrides: [], warnings: ["Arquivo não parece ser planilha diária de acompanhamento"], dataRows: dataRows.length, headers };
  }

  const headerKeys = headers.map(dailyMetricKeysForHeader);
  const dataColumn = headers.findIndex((header) => header === "data");
  const bumpDefs = detectDailyBumps(rawHeaders);
  const bumpAggregateCols = detectDailyBumpAggregateColumns(rawHeaders);

  for (const [index, row] of dataRows.entries()) {
    const line = index + 2;
    const date = parseDailyMetricDate(row[dataColumn] ?? "");
    if (!date) {
      warnings.push(`Linha ${line}: data inválida ou linha de resumo ignorada`);
      continue;
    }

    const payload: Record<string, unknown> = {};
    for (const [columnIndex, keys] of headerKeys.entries()) {
      for (const key of keys) {
        const value = parseMetricNumber(row[columnIndex] ?? "");
        if (value != null) payload[key] = value;
      }
    }

    const bumps = bumpDefs.map((bump) => ({
      name: bump.name,
      type: bump.type,
      count: parseMetricNumber(row[bump.countCol] ?? ""),
      revenue: parseMetricNumber(row[bump.revCol] ?? ""),
      rate: parseMetricNumber(row[bump.rateCol] ?? ""),
    }));
    if (bumps.length > 0) payload.bumps = bumps;

    const funnelCorrection = correctDailyFunnelSales(
      payload,
      bumps,
      bumpAggregateCols.map((column) => parseMetricNumber(row[column] ?? "")),
    );
    if (funnelCorrection) {
      warnings.push(
        `Linha ${line}: vendas totais ajustadas de ${formatMetricNumber(funnelCorrection.provided)} `
        + `para ${formatMetricNumber(funnelCorrection.corrected)} `
        + `(${formatMetricNumber(funnelCorrection.front)} front + ${formatMetricNumber(funnelCorrection.offers)} ofertas agrupadas)`,
      );
    }

    if (!hasDailyMetricSignal(payload)) {
      warnings.push(`Linha ${line}: sem métricas úteis, ignorada`);
      continue;
    }

    payload.import_source = "daily_metrics_sheet";
    // This file is the operator's daily source of truth. Keep Meta/VTurb
    // traffic from their live integrations, but let the imported sales and
    // funnel columns replace partial webhook coverage for the same date.
    payload.import_authoritative = true;
    overrides.push({ event_date: date, payload, line });
  }

  return { overrides, warnings, dataRows: dataRows.length, headers };
}

function looksLikeDailyMetricsSheet(headers: string[]) {
  const set = new Set(headers);
  return set.has("data")
    && set.has("investimento")
    && (set.has("vendas_front") || set.has("vendas_totais_do_funil"))
    && Array.from(set).some((header) => header.startsWith("faturamento_liquido"));
}

function dailyMetricKeysForHeader(header: string): string[] {
  const map: Record<string, string[]> = {
    investimento: ["investimento"],
    vendas_front: ["vendas_front"],
    vendas_totais_do_funil: ["vendas_totais"],
    vendas_totais_funil_todo: ["vendas_totais"],
    vendas_totais: ["vendas_totais"],
    cpa_front: ["cpa_front"],
    faturamento_bruto_total_do_funil: ["fat_bruto"],
    faturamento_bruto: ["fat_bruto"],
    faturamento_liquido_total_do_funil_taxas_plataforma: ["fat_liquido"],
    faturamento_liquido_total_do_funil_taxas_e_imposto_meta: ["fat_liquido"],
    faturamento_liquido: ["fat_liquido"],
    imposto_meta: ["imposto_meta"],
    roi_fat_liquido_imposto_meta: ["roi"],
    roi: ["roi"],
    lucro: ["lucro"],
    cac: ["cac"],
    aov: ["aov"],
    faturamento_front: ["fat_front"],
    faturamento_total_orderbump: ["fat_orderbump"],
    faturamento_total_funil: ["fat_funil"],
    faturamento_funil: ["fat_funil"],
    reembolsos: ["reembolsos"],
    taxa_de_reembolso: ["taxa_reembolso"],
    valor_reembolsado: ["valor_reembolsado"],
    aprovacao_cartao: ["aprov_cartao"],
    aprovacao_pix: ["aprov_pix"],
    impressoes: ["impressoes"],
    cliques: ["cliques"],
    cliques_no_link: ["cliques"],
    pageviews: ["pageviews"],
    landing_page_views: ["landing_pageviews"],
    lp_views: ["landing_pageviews"],
    checkouts: ["checkouts"],
    cpm: ["cpm"],
    ctr: ["ctr"],
    cpc: ["cpc"],
    custo_por_pageview: ["custo_pageview"],
    custo_por_i_c: ["custo_ic"],
    taxa_de_carregamento: ["taxa_carreg"],
    passagem_para_o_checkout: ["pass_chk"],
    play_rate: ["play_rate"],
    retencao_pitch: ["ret_pitch"],
    visualizacoes_unicas: ["views_unicas"],
    plays_unicos: ["plays_unicos"],
    plays_unicos_vturb: ["plays_unicos"],
    chegaram_no_pitch: ["chegaram_pitch"],
    pitch_checkout: ["pitch_chk"],
    pitch_venda: ["pitch_venda"],
    checkout_venda_front: ["chk_venda"],
    checkout_venda: ["chk_venda"],
    conversao_geral_orderbump: ["conv_geral_orderbump"],
    proporcao_faturamento_front_x_funil: ["proporcao_funil_front"],
    proporcao_front_x_funil: ["proporcao_funil_front"],
  };
  return map[header] ?? [];
}

function parseDailyMetricDate(value: string) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  return parsed.slice(0, 10);
}

function parseMetricNumber(value: string) {
  let normalized = String(value ?? "")
    .trim()
    .replace(/R\$/gi, "")
    .replace(/%$/, "")
    .replace(/\s|\u00a0/g, "");
  if (!normalized || normalized === "-" || normalized === "#DIV/0!" || normalized === "#N/A") return null;
  const isNegative = normalized.startsWith("-") || /^\(.*\)$/.test(normalized);
  normalized = normalized.replace(/^\((.*)\)$/, "$1").replace(/^-/, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  } else if (normalized.includes(".")) {
    const parts = normalized.split(".");
    if (parts.length > 1 && parts.slice(1).every((part) => part.length === 3)) {
      normalized = normalized.replace(/\./g, "");
    }
  }
  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

function splitHublaList(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text
    .split(/\s*[,;\n]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasDailyMetricSignal(payload: Record<string, unknown>) {
  return [
    "investimento",
    "vendas_totais",
    "fat_bruto",
    "fat_liquido",
    "impressoes",
    "cliques",
    "landing_pageviews",
    "views_unicas",
    "plays_unicos",
    "chegaram_pitch",
  ].some((key) => {
    const value = payload[key];
    return typeof value === "number" && Math.abs(value) > 0.000001;
  });
}

function correctDailyFunnelSales(
  payload: Record<string, unknown>,
  bumps: Array<{ count: number | null }>,
  aggregateCounts: Array<number | null> = [],
) {
  const front = metricNumber(payload.vendas_front);
  if (front == null) return null;

  const groupedOffers = bumps.reduce((sum, bump) => sum + Math.max(0, bump.count ?? 0), 0);
  const aggregateOffers = aggregateCounts.reduce((max, count) => Math.max(max, count ?? 0), 0);
  const offers = Math.max(groupedOffers, aggregateOffers);
  if (offers <= 0) return null;

  const provided = metricNumber(payload.vendas_totais);
  const corrected = front + offers;
  if (provided != null && provided >= corrected) return null;

  payload.vendas_totais = corrected;
  return {
    provided: provided ?? 0,
    corrected,
    front,
    offers,
  };
}

function detectDailyBumpAggregateColumns(headers: string[]) {
  return headers.flatMap((raw, index) => {
    const slug = normalizeHeader(raw);
    if (!slug.includes("orderbump") && !slug.includes("upsell")) return [];
    if (/(faturamento|receita|conversao|taxa|percent|porcentagem)/.test(slug)) return [];
    if (!/(^|_)(vendas|quantidade|qtd|count|total)(_|$)/.test(slug) && slug !== "orderbump" && slug !== "upsell") {
      return [];
    }
    return [index];
  });
}

function metricNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMetricNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
}

function detectDailyBumps(headers: string[]) {
  const out: Array<{ name: string; type: "orderbump" | "upsell"; countCol: number; revCol: number; rateCol: number }> = [];
  for (let index = 0; index < headers.length; index += 1) {
    const raw = headers[index] ?? "";
    const slug = normalizeHeader(raw);
    const isOrderbump = slug.startsWith("orderbump_") && !slug.startsWith("orderbump_total");
    const isUpsell = slug === "upsell" || slug.startsWith("upsell_");
    if ((!isOrderbump && !isUpsell) || slug.includes("faturamento") || slug.includes("conversao")) continue;

    let revCol = -1;
    let rateCol = -1;
    for (let next = index + 1; next < Math.min(index + 5, headers.length); next += 1) {
      const nextSlug = normalizeHeader(headers[next] ?? "");
      if (revCol < 0 && (nextSlug.startsWith("faturamento_") || nextSlug.startsWith("receita_"))) revCol = next;
      if (rateCol < 0 && (nextSlug.startsWith("conversao_") || nextSlug === "tx" || nextSlug.startsWith("tx_"))) rateCol = next;
    }
    if (revCol < 0 && index + 1 < headers.length) revCol = index + 1;
    if (rateCol < 0 && index + 2 < headers.length) rateCol = index + 2;

    const type = isUpsell ? "upsell" : "orderbump";
    const name = raw
      .replace(/\n/g, " ")
      .replace(/^(orderbump|upsell)\s*-?\s*/i, "")
      .trim() || (type === "upsell" ? "Upsell" : "Orderbump");
    out.push({ name, type, countCol: index, revCol, rateCol });
  }
  return out;
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

  const offerName = get("nome_da_oferta", "oferta", "offer");
  const productName = get("nome_do_produto", "produto", "produto_nome", "product", "product_name", "nome_da_oferta", "oferta", "offer");
  const productId = get("id_do_produto", "produto_id", "product_id", "offer_id");
  const orderBumpProductId = get("id_do_produto_de_orderbump", "produto_orderbump_id", "orderbump_product_id", "bump_product_id");
  const orderBumpProductName = get("nome_do_produto_de_orderbump", "produto_orderbump", "orderbump_product_name", "bump_product_name");
  const itemType = get("tipo_de_fatura", "detalhamento_da_fatura", "tipo_produto", "tipo_oferta", "item_type", "offer_type", "tipo").toLowerCase();
  const offerDescriptor = `${itemType} ${offerName}`.toLowerCase();
  const isUpsellOffer = /upsell/.test(offerDescriptor);
  const isBump = itemType.includes("bump") || itemType.includes("upsell") || itemType.includes("order") || isUpsellOffer;
  const offerType = isUpsellOffer || itemType.includes("upsell") ? "upsell" : "orderbump";
  const orderBumpIds = splitHublaList(orderBumpProductId);
  const invoiceItemCount = parseMetricNumber(get("itens_na_fatura", "itens_fatura", "item_count", "items_count"));
  const expectedBumpCount = invoiceItemCount != null ? Math.max(0, Math.round(invoiceItemCount) - 1) : 0;
  const orderBumpNames = orderBumpIds.length > 1 || expectedBumpCount > 1 || !orderBumpIds.length && /[,;\n]/.test(orderBumpProductName)
    ? splitHublaList(orderBumpProductName)
    : orderBumpProductName.trim()
    ? [orderBumpProductName.trim()]
    : [];
  const hasOrderBump = orderBumpIds.length > 0 || orderBumpNames.length > 0;
  const bumpCount = hasOrderBump ? Math.max(orderBumpIds.length, orderBumpNames.length, expectedBumpCount) : 0;
  const mainItemIsOffer = isBump && !hasOrderBump;
  const mainItemPrice = hasOrderBump && productTotal > 0 ? productTotal : total;
  const orderBumpRevenue = hasOrderBump && productTotal > 0 ? Math.max(0, total - productTotal) : 0;
  const orderBumpPrice = bumpCount > 0 ? orderBumpRevenue / bumpCount : 0;
  const orderBumpItems = Array.from({ length: bumpCount }, (_, index) => ({
    id: orderBumpIds[index] || `${transaction}-orderbump-${index + 1}`,
    name: orderBumpNames[index] || orderBumpIds[index] || `Order bump ${index + 1}`,
    price: orderBumpPrice,
    type: offerType,
    is_bump: true,
    count_as_sale: true,
  }));
  const items = [
    ...(productName || productId
      ? [{
        id: productId || transaction,
        name: productName || productId || transaction,
        price: mainItemPrice,
        type: mainItemIsOffer ? offerType : "main",
        is_bump: mainItemIsOffer,
        ...(mainItemIsOffer ? { count_as_sale: true } : {}),
      }]
      : []),
    ...orderBumpItems,
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
          is_upsell: mainItemIsOffer && offerType === "upsell",
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

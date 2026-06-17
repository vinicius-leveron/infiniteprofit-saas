/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

export type NormalizedEvent = {
  event_type:
    | "purchase.approved"
    | "purchase.refused"
    | "purchase.refunded"
    | "checkout_created";
  event_date: string;
  external_id: string;
  payload: any;
};

type MoneyPath = {
  path: string;
  cents?: boolean;
  autoCents?: boolean;
};

export function normalizeEvent(provider: string, raw: any): NormalizedEvent[] {
  if (provider === "hotmart") return normalizeHotmart(raw);
  if (provider === "hubla") return normalizeHubla(raw);
  if (provider === "kiwify") return normalizeKiwify(raw);
  return [];
}

function normalizeHotmart(raw: any): NormalizedEvent[] {
  const event = String(raw?.event ?? "").toUpperCase();
  const data = raw?.data ?? {};
  const purchase = data?.purchase ?? data;
  const product = data?.product ?? {};
  const buyer = data?.buyer ?? {};
  const items: any[] = Array.isArray(purchase?.offer?.items)
    ? purchase.offer.items
    : Array.isArray(purchase?.items)
      ? purchase.items
      : [];
  const total = num(purchase?.price?.value ?? purchase?.full_price?.value ?? purchase?.total ?? 0);
  const net = num(
    purchase?.commission_as ?? purchase?.commission?.value ?? purchase?.producer?.value ?? total,
  );
  const method = String(
    purchase?.payment?.type ?? purchase?.payment_type ?? purchase?.payment?.method ?? "",
  ).toLowerCase();
  const tsRaw = purchase?.approved_date ?? purchase?.order_date ?? raw?.creation_date ?? Date.now();
  const ts = timestampValue(tsRaw);
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(
    purchase?.transaction ?? purchase?.transaction_id ?? raw?.id ?? `hot-${ts}`,
  );

  const mainProductId = String(product?.id ?? product?.ucode ?? "");
  const normalizedItems = items.map((item: any) => {
    const itemId = String(item?.id ?? item?.ucode ?? item?.product_id ?? "");
    const isBump = !!mainProductId && !!itemId && itemId !== mainProductId;
    return {
      external_id: itemId,
      name: item?.name ?? itemId,
      price: num(item?.price?.value ?? item?.value ?? item?.price ?? 0),
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });

  const tracking = purchase?.tracking ?? data?.tracking ?? raw?.tracking ?? {};
  const utm = extractUtmParams({
    ...tracking,
    ...purchase,
    ...data,
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE") type = "purchase.approved";
  else if (event === "PURCHASE_REFUNDED" || event === "PURCHASE_CHARGEBACK") type = "purchase.refunded";
  else if (event === "PURCHASE_CANCELED" || event === "PURCHASE_DECLINED" || event === "PURCHASE_EXPIRED") type = "purchase.refused";
  else if (event === "PURCHASE_BILLET_PRINTED" || event === "PURCHASE_OUT_OF_SHOPPING_CART") type = "checkout_created";
  if (!type) return [];

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: externalId,
    payload: {
      raw_event: event,
      total,
      net,
      payment_method: method,
      buyer_email: buyer?.email ?? null,
      product_id: mainProductId,
      items: normalizedItems,
      is_front: !purchase?.is_funnel && !purchase?.is_upsell,
      transaction_id: stripOfferSuffix(externalId),
      is_offer_event: isOfferExternalId(externalId),
      raw_payload: raw,
      ...utm,
    },
  }];
}

export function normalizeHubla(raw: any): NormalizedEvent[] {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  const eventRecord = asRecord(root.event);
  const object = firstRecord([
    data.object,
    data.invoice,
    eventRecord.invoice,
    eventRecord.object,
    root.invoice,
    root.object,
    root,
  ]);

  const eventType = firstString([
    root.type,
    root.event_type,
    root.event,
    root.webhook_event_type,
    data.type,
    eventRecord.type,
    object.type,
    object.event,
    object.status,
  ]).toLowerCase();

  let type: NormalizedEvent["event_type"] | null = null;
  if (
    eventType.includes("payment_succeeded")
    || eventType.includes("payment.succeeded")
    || eventType.includes("invoice.paid")
    || eventType.includes("approved")
    || eventType === "paid"
    || eventType === "succeeded"
  ) {
    type = "purchase.approved";
  } else if (eventType.includes("refunded") || eventType.includes("refund") || eventType.includes("chargeback")) {
    type = "purchase.refunded";
  } else if (
    eventType.includes("payment_failed")
    || eventType.includes("failed")
    || eventType.includes("declined")
    || eventType.includes("refused")
    || eventType.includes("canceled")
    || eventType.includes("cancelled")
    || eventType.includes("expired")
  ) {
    type = "purchase.refused";
  } else if (
    eventType.includes("checkout.created")
    || eventType.includes("checkout_created")
    || eventType.includes("invoice.created")
    || eventType.includes("waiting_payment")
    || eventType.includes("payment_pending")
  ) {
    type = "checkout_created";
  }
  if (!type) return [];

  const items = normalizeHublaItems(object);
  const total = firstMoney(object, [
    { path: "amount_paid", cents: true },
    { path: "amount_total", cents: true },
    { path: "amount_due", cents: true },
    { path: "amount_received", cents: true },
    { path: "paid_amount", autoCents: true },
    { path: "charge_amount", autoCents: true },
    { path: "total_amount", autoCents: true },
    { path: "total", autoCents: true },
    { path: "amount", autoCents: true },
    { path: "value", autoCents: true },
    { path: "price", autoCents: true },
    { path: "subscription.plan.amount", cents: true },
    { path: "plan.amount", cents: true },
  ]) || sumItemPrices(items);

  const net = firstMoney(object, [
    { path: "net_amount", autoCents: true },
    { path: "net", autoCents: true },
    { path: "amount_received", cents: true },
    { path: "amount_paid", cents: true },
  ]) || total;

  if (type === "purchase.approved" && total <= 0) {
    return [];
  }

  const tsRaw = firstDefined([
    getPath(object, "status_transitions.paid_at"),
    object.paid_at,
    object.approved_at,
    object.approved_date,
    object.created_at,
    object.created,
    eventRecord.created_at,
    eventRecord.created,
    root.created_at,
    root.created,
    Date.now(),
  ]);
  const ts = timestampValue(tsRaw);
  const eventDate = ymdSaoPaulo(new Date(ts));

  const originalExternalId = firstString([
    object.id,
    object.invoice_id,
    object.transaction_id,
    object.payment_id,
    object.payment_intent,
    object.charge,
    object.subscription,
    eventRecord.id,
    root.id,
    `hub-${ts}`,
  ]);
  const transactionId = stripOfferSuffix(originalExternalId);
  const isOfferEvent = isOfferExternalId(originalExternalId) || Boolean(object.is_offer || object.offer_id || object.parent_transaction_id);

  let normalizedItems = items;
  if (isOfferEvent && normalizedItems.length === 0) {
    normalizedItems = [{
      external_id: originalExternalId,
      name: firstString([object.description, object.name, object.title, originalExternalId]),
      price: total,
      type: "orderbump",
      is_bump: true,
    }];
  }

  const checkout = asRecord(object.checkout ?? eventRecord.checkout);
  const metadata = asRecord(object.metadata ?? eventRecord.metadata);
  const tracking = asRecord(object.tracking ?? eventRecord.tracking);
  const customer = asRecord(object.customer);
  const product = asRecord(object.product);
  const utm = extractUtmParams({
    ...metadata,
    ...checkout,
    ...tracking,
    ...object,
    ...eventRecord,
  });

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: originalExternalId,
    payload: {
      raw_event: eventType,
      total,
      net,
      payment_method: firstString([
        object.payment_method,
        getPath(object, "payment_method_details.type"),
        Array.isArray(object.payment_method_types) ? object.payment_method_types[0] : null,
        object.method,
        object.billing_reason,
      ]).toLowerCase(),
      buyer_email: firstString([object.customer_email, customer.email, object.email]) || null,
      product_id: firstString([object.product_id, product.id, getPath(object, "plan.product")]),
      items: normalizedItems,
      is_front: !isOfferEvent && !object.is_upsell && !object.upsell_id,
      transaction_id: transactionId,
      is_offer_event: isOfferEvent,
      raw_payload: raw,
      ...utm,
    },
  }];
}

function normalizeKiwify(raw: any): NormalizedEvent[] {
  const eventType = String(raw?.webhook_event_type ?? raw?.event ?? raw?.order_status ?? "").toLowerCase();
  const status = String(raw?.order_status ?? "").toLowerCase();
  const total = num(raw?.Commissions?.charge_amount ?? raw?.charge_amount ?? raw?.total_value ?? raw?.amount ?? 0) / 100;
  const net = num(raw?.Commissions?.product_base_price ?? raw?.net_amount ?? total * 100) / 100;
  const method = String(raw?.payment_method ?? "").toLowerCase();
  const tsRaw = raw?.approved_date ?? raw?.created_at ?? raw?.updated_at ?? Date.now();
  const ts = timestampValue(tsRaw);
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(raw?.order_id ?? raw?.id ?? `kw-${ts}`);

  const products: any[] = Array.isArray(raw?.Product?.products)
    ? raw.Product.products
    : Array.isArray(raw?.products)
      ? raw.products
      : raw?.Product
        ? [raw.Product]
        : [];
  const mainProductId = String(raw?.Product?.product_id ?? raw?.product_id ?? "");
  const normalizedItems = products.map((product: any) => {
    const productId = String(product?.product_id ?? product?.id ?? "");
    const isBump = !!mainProductId && !!productId && productId !== mainProductId;
    return {
      external_id: productId,
      name: product?.product_name ?? product?.name ?? productId,
      price: num(product?.price ?? product?.amount ?? 0) / 100,
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });

  const tracking = raw?.TrackingParameters ?? raw?.tracking ?? {};
  const utm = extractUtmParams({
    ...tracking,
    ...raw,
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (eventType.includes("approved") || status === "paid" || status === "approved") type = "purchase.approved";
  else if (eventType.includes("refunded") || status === "refunded" || status === "chargedback") type = "purchase.refunded";
  else if (eventType.includes("refused") || status === "refused" || status === "canceled") type = "purchase.refused";
  else if (eventType.includes("billet_created") || eventType.includes("pix_created") || status === "waiting_payment") type = "checkout_created";
  if (!type) return [];

  return [{
    event_type: type,
    event_date: eventDate,
    external_id: externalId,
    payload: {
      raw_event: eventType || status,
      total,
      net,
      payment_method: method,
      product_id: mainProductId,
      items: normalizedItems,
      is_front: !raw?.is_upsell && !raw?.upsell_order_id,
      transaction_id: stripOfferSuffix(externalId),
      is_offer_event: isOfferExternalId(externalId),
      raw_payload: raw,
      ...utm,
    },
  }];
}

function normalizeHublaItems(invoice: Record<string, any>) {
  const items = firstArray([
    invoice.items,
    invoice.products,
    invoice.offers,
    getPath(invoice, "lines.data"),
    invoice.lines,
  ]);
  const mainProductId = firstString([
    invoice.product_id,
    getPath(invoice, "product.id"),
    getPath(invoice, "plan.product"),
  ]);

  return items.map((item: any, index: number) => {
    const itemRecord = asRecord(item);
    const itemId = firstString([
      itemRecord.id,
      itemRecord.product_id,
      getPath(itemRecord, "price.product"),
      itemRecord.offer_id,
      `item-${index + 1}`,
    ]);
    const itemType = firstString([itemRecord.type, itemRecord.kind, itemRecord.offer_type]).toLowerCase();
    const isBump = Boolean(itemRecord.is_bump)
      || itemType.includes("bump")
      || itemType.includes("upsell")
      || isOfferExternalId(itemId)
      || (!!mainProductId && !!itemId && itemId !== mainProductId);

    return {
      external_id: itemId,
      name: firstString([
        itemRecord.name,
        itemRecord.description,
        getPath(itemRecord, "price.nickname"),
        itemId,
      ]),
      price: firstMoney(itemRecord, [
        { path: "amount", autoCents: true },
        { path: "amount_total", cents: true },
        { path: "price", autoCents: true },
        { path: "value", autoCents: true },
        { path: "unit_amount", cents: true },
        { path: "price.unit_amount", cents: true },
      ]),
      type: isBump ? "orderbump" : "main",
      is_bump: isBump,
    };
  });
}

function extractUtmParams(obj: any): Record<string, string | null> {
  const result: Record<string, string | null> = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
  };

  if (!obj || typeof obj !== "object") return result;

  const utmFields = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  for (const field of utmFields) {
    const val = obj[field] ?? obj[field.replace("utm_", "")] ?? null;
    if (val && typeof val === "string" && val.trim()) {
      result[field] = val.trim().toLowerCase();
    }
  }

  if (obj.src && typeof obj.src === "string" && obj.src.trim()) {
    result.utm_source = result.utm_source ?? obj.src.trim().toLowerCase();
  }
  if (obj.sck && typeof obj.sck === "string" && obj.sck.trim()) {
    result.utm_content = result.utm_content ?? obj.sck.trim();
  }

  if (obj.tracking && typeof obj.tracking === "object") {
    const nested = extractUtmParams(obj.tracking);
    for (const field of utmFields) {
      result[field] = result[field] ?? nested[field];
    }
  }

  if (!result.utm_source) {
    const ref = obj.ref ?? obj.referrer ?? obj.source ?? null;
    if (ref && typeof ref === "string" && ref.trim()) {
      result.utm_source = ref.trim().toLowerCase();
    }
  }

  const filtered: Record<string, string | null> = {};
  let hasAny = false;
  for (const [key, val] of Object.entries(result)) {
    if (val) {
      filtered[key] = val;
      hasAny = true;
    }
  }

  return hasAny ? filtered : {};
}

function firstMoney(record: Record<string, any>, paths: MoneyPath[]) {
  for (const path of paths) {
    const raw = getPath(record, path.path);
    if (raw == null || raw === "") continue;
    const parsed = parseMoney(raw, path);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function parseMoney(value: any, path: MoneyPath = { path: "" }) {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  if (path.cents) return parsed / 100;
  if (path.autoCents && Number.isInteger(parsed) && Math.abs(parsed) >= 10000) {
    return parsed / 100;
  }
  return parsed;
}

function parseNumber(value: any) {
  if (typeof value === "number") return value;
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
    return Number(normalized.replaceAll(thousandsSeparator, "").replace(decimalSeparator, "."));
  }
  if (hasComma) return Number(normalized.replace(",", "."));
  return Number(normalized);
}

function sumItemPrices(items: Array<{ price: number }>) {
  return items.reduce((sum, item) => sum + num(item.price), 0);
}

function firstArray(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstRecord(values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstDefined(values: unknown[]) {
  for (const value of values) {
    if (value != null && value !== "") return value;
  }
  return null;
}

function getPath(record: Record<string, any>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, record);
}

function stripOfferSuffix(value: string) {
  return value.replace(/-offer-\d+$/i, "");
}

function isOfferExternalId(value: string) {
  return /-offer-\d+$/i.test(value);
}

function timestampValue(value: unknown) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const number = Number(value);
    return number < 1e12 ? number * 1000 : number;
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function num(value: any) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ymdSaoPaulo(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(Number.isNaN(date.getTime()) ? new Date() : date);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

export type NormalizedEvent = {
  event_type:
    | "purchase.approved"
    | "purchase.refused"
    | "purchase.refunded"
    | "checkout_created"
    | "checkout.abandoned";
  event_date: string;
  event_occurred_at: string;
  external_id: string;
  payload: any;
};

export type CheckoutProductRole = "front" | "order_bump" | "upsell";

export type HotmartNormalizationContext = {
  productRoles?: Record<string, CheckoutProductRole>;
  offerRoles?: Record<string, CheckoutProductRole>;
  requireProductBinding?: boolean;
  priceDetail?: Record<string, any> | null;
  source?: "webhook" | "api" | "spreadsheet";
  /**
   * True only when the Hotmart commissions endpoint returned the complete
   * receiver split for this transaction. Sales-history values alone are not
   * authoritative because they can contain only the producer's share.
   */
  commissionsAuthoritative?: boolean;
};

type MoneyPath = {
  path: string;
  cents?: boolean;
  autoCents?: boolean;
};

export function normalizeEvent(
  provider: string,
  raw: any,
  context?: HotmartNormalizationContext,
): NormalizedEvent[] {
  if (provider === "hotmart") return normalizeHotmart(raw, context);
  if (provider === "hubla") return normalizeHubla(raw);
  if (provider === "kiwify") return normalizeKiwify(raw);
  return [];
}

export function validateHotmartHottok(
  received: string | null | undefined,
  expected: string,
) {
  const actual = received ?? "";
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function normalizeHotmart(
  raw: any,
  context: HotmartNormalizationContext = {},
): NormalizedEvent[] {
  const event = String(raw?.event ?? "").toUpperCase();
  const data = raw?.data ?? {};
  const purchase = data?.purchase ?? data;
  const product = data?.product ?? {};
  const priceDetail = context.priceDetail ?? {};
  const total = firstPositive([
    purchase?.full_price?.value,
    purchase?.price?.value,
    priceDetail?.total?.value,
    purchase?.total,
  ]);
  const currency = firstString([
    purchase?.full_price?.currency_value,
    purchase?.full_price?.currency_code,
    purchase?.price?.currency_value,
    purchase?.price?.currency_code,
    priceDetail?.total?.currency_code,
    "BRL",
  ]).toUpperCase();
  const reportedPlatformFee = hotmartPlatformFee(purchase, priceDetail, currency);
  const commissionAmounts = hotmartCommissionAmounts(
    data?.commissions,
    currency,
  );
  const source = context.source ?? "webhook";
  const isAuthoritativeCommissionSource =
    source === "spreadsheet"
    || (source === "api" && context.commissionsAuthoritative === true);
  // For Hotmart, gross - a fee reported by sales/history is only a fallback
  // estimate. The economic result of the operation is the complete receiver
  // split: producer + affiliate + every coproducer/other non-Hotmart receiver.
  const nativeNet = isAuthoritativeCommissionSource
    ? commissionAmounts.nativeNet
    : null;
  const method = String(
    purchase?.payment?.type ?? purchase?.payment_type ?? purchase?.payment?.method ?? "",
  ).toLowerCase();
  const isRefund =
    event === "PURCHASE_REFUNDED"
    || event === "PURCHASE_CHARGEBACK"
    || event === "PURCHASE_PARTIALLY_REFUNDED";
  const tsRaw = isRefund
    ? raw?.creation_date ?? purchase?.approved_date ?? purchase?.order_date
    : purchase?.approved_date ?? purchase?.order_date ?? raw?.creation_date;
  const ts = timestampValue(tsRaw);
  const eventDate = ymdSaoPaulo(new Date(ts));
  const externalId = String(
    purchase?.transaction ?? purchase?.transaction_id ?? raw?.id ?? `hot-${ts}`,
  );

  const productId = String(product?.id ?? "");
  const productUcode = String(product?.ucode ?? "");
  const offerCode = String(purchase?.offer?.code ?? data?.offer?.code ?? "");
  const role = resolveHotmartRole(
    context,
    [productId, productUcode],
    offerCode,
  );
  const productIsBound = role != null || context.requireProductBinding !== true;
  const effectiveRole = role ?? "front";
  const explicitRefund = firstPositive([
    purchase?.refund_value?.value,
    purchase?.refunded_value?.value,
    purchase?.refund_amount,
    data?.refund?.value,
  ]);
  const isPartialRefund = event === "PURCHASE_PARTIALLY_REFUNDED";
  const eventTotal = isPartialRefund ? explicitRefund : total;
  const eventNativeNet = isPartialRefund && total > 0 && nativeNet != null
    ? eventTotal * (nativeNet / total)
    : nativeNet;

  const origin = purchase?.origin ?? data?.origin ?? {};
  const tracking = purchase?.tracking ?? data?.tracking ?? raw?.tracking ?? {};
  const utm = extractUtmParams({
    ...origin,
    ...tracking,
    ...purchase,
    ...data,
    utm_source: tracking?.utm_source ?? origin?.src ?? tracking?.source,
    utm_content: tracking?.utm_content ?? origin?.sck ?? tracking?.external_code,
    utm_term: tracking?.utm_term ?? origin?.xcode,
  });

  let type: NormalizedEvent["event_type"] | null = null;
  if (event === "PURCHASE_APPROVED" || event === "PURCHASE_COMPLETE") type = "purchase.approved";
  else if (
    event === "PURCHASE_REFUNDED"
    || event === "PURCHASE_CHARGEBACK"
    || event === "PURCHASE_PARTIALLY_REFUNDED"
  ) type = "purchase.refunded";
  else if (
    event === "PURCHASE_CANCELED"
    || event === "PURCHASE_DECLINED"
    || event === "PURCHASE_EXPIRED"
    || event === "PURCHASE_DELAYED"
    || event === "PURCHASE_PROTEST"
  ) type = "purchase.refused";
  else if (event === "PURCHASE_BILLET_PRINTED") type = "checkout_created";
  else if (event === "PURCHASE_OUT_OF_SHOPPING_CART") type = "checkout.abandoned";
  if (!type) return [];

  const isFinancialEvent =
    type === "purchase.approved" || type === "purchase.refunded";
  const hasReliableFinancials = !isFinancialEvent
    ? true
    : eventTotal > 0
      && eventNativeNet != null
      && (!isPartialRefund || explicitRefund > 0);
  const conversionRate = commissionAmounts.brlRate;
  const convertedCurrency = currency === "BRL" || (
    conversionRate != null
    && (
      commissionAmounts.brlNet != null
    )
  );
  const metricsReady =
    type !== "checkout.abandoned"
    && productIsBound
    && convertedCurrency;
  const canonicalTotal = currency !== "BRL" && convertedCurrency
    ? eventTotal * (conversionRate ?? 0)
    : eventTotal;
  const fullConvertedNet = currency !== "BRL" && convertedCurrency
    ? commissionAmounts.brlNet
      ?? (nativeNet != null ? nativeNet * (conversionRate ?? 0) : null)
    : nativeNet;
  const canonicalNetRaw =
    isPartialRefund && total > 0 && fullConvertedNet != null
      ? fullConvertedNet * (eventTotal / total)
      : fullConvertedNet;
  const canonicalNet = canonicalNetRaw == null
    ? null
    : roundMoneyValue(canonicalNetRaw);
  const canonicalPlatformFee = canonicalNet != null
    ? roundMoneyValue(Math.max(0, canonicalTotal - canonicalNet))
    : null;
  const originalPlatformFee = commissionAmounts.platformNative
    ?? reportedPlatformFee;
  const financialMetricsReady = !isFinancialEvent || hasReliableFinancials;
  const scale = isPartialRefund && total > 0 ? eventTotal / total : 1;
  const receiverAmounts = canonicalReceiverAmounts(
    commissionAmounts,
    currency,
    convertedCurrency,
    conversionRate,
    scale,
  );
  const providerTransactionId = `hotmart:${externalId}`;
  const hotmartBuyer = asRecord(data?.buyer ?? purchase?.buyer);

  return [{
    event_type: type,
    event_date: eventDate,
    event_occurred_at: new Date(ts).toISOString(),
    external_id: type === "checkout.abandoned"
      ? `hotmart:${String(raw?.id ?? externalId)}`
      : providerTransactionId,
    payload: {
      provider: "hotmart",
      provider_event_id: String(raw?.id ?? ""),
      raw_event: event,
      status: String(purchase?.status ?? event),
      gross: canonicalTotal,
      total: canonicalTotal,
      platform_fee: canonicalPlatformFee,
      net: canonicalNet,
      producer_net: financialMetricsReady ? receiverAmounts.producer : null,
      affiliate_net: financialMetricsReady ? receiverAmounts.affiliate : null,
      coproducer_net: financialMetricsReady ? receiverAmounts.coproducer : null,
      other_receiver_net: financialMetricsReady ? receiverAmounts.other : null,
      consolidated_net: canonicalNet,
      original_platform_fee: originalPlatformFee,
      original_currency: currency,
      currency: convertedCurrency ? "BRL" : currency,
      metrics_ready: metricsReady,
      financial_metrics_ready: financialMetricsReady,
      financial_state: financialMetricsReady ? "ready" : "pending",
      financial_exclusion_reason:
        isFinancialEvent && !financialMetricsReady
          ? "financial_enrichment_required"
          : null,
      exclusion_reason: !productIsBound
        ? "unbound_product"
        : !convertedCurrency
          ? "unsupported_currency"
          : type === "checkout.abandoned"
            ? "cart_abandonment_is_operational"
            : null,
      payment_method: method,
      buyer_provider_id: firstString([hotmartBuyer.id, hotmartBuyer.ucode]) || null,
      buyer_email: firstString([hotmartBuyer.email]) || null,
      recurrence_number:
        Number.isFinite(Number(purchase?.recurrence_number))
          ? Number(purchase.recurrence_number)
          : null,
      product_id: productId || productUcode,
      product_ucode: productUcode || null,
      product_name: firstString([product?.name, productId, productUcode])
        || null,
      offer_code: offerCode || null,
      product_role: effectiveRole,
      items: [{
        external_id: productId || productUcode,
        name: product?.name ?? productId ?? productUcode,
        price: canonicalTotal,
        type: effectiveRole === "front" ? "main" : effectiveRole,
        is_bump: effectiveRole !== "front",
      }],
      is_front: effectiveRole === "front",
      is_upsell: effectiveRole === "upsell",
      transaction_id: externalId,
      is_offer_event: effectiveRole !== "front",
      ingestion_source: source,
      ...utm,
    },
  }];
}

function resolveHotmartRole(
  context: HotmartNormalizationContext,
  productKeys: string[],
  offerCode: string,
) {
  if (offerCode && context.offerRoles?.[offerCode]) {
    return context.offerRoles[offerCode];
  }
  for (const key of productKeys) {
    if (key && context.productRoles?.[key]) return context.productRoles[key];
  }
  return null;
}

function hotmartPlatformFee(
  purchase: Record<string, any>,
  priceDetail: Record<string, any>,
  currency: string,
) {
  const feeCurrency = firstString([
    purchase?.hotmart_fee?.currency_code,
    purchase?.hotmart_fee?.currency_value,
    priceDetail?.fee?.currency_code,
    currency,
  ]).toUpperCase();
  const value = firstPositive([
    purchase?.hotmart_fee?.total,
    purchase?.hotmart_fee?.value,
    priceDetail?.fee?.value,
  ]);
  if (value <= 0 || feeCurrency !== currency) return null;
  return value;
}

function hotmartCommissionAmounts(
  commissions: unknown,
  originalCurrency: string,
) {
  if (!Array.isArray(commissions) || commissions.length === 0) {
    return {
      nativeNet: null,
      brlNet: null,
      brlRate: null,
      platformNative: null,
      platformBrl: null,
      nativeBreakdown: emptyReceiverBreakdown(),
      brlBreakdown: emptyReceiverBreakdown(),
    };
  }
  let nativeNet = 0;
  let nativeMatched = false;
  let brlNet = 0;
  let brlMatched = false;
  let brlRate: number | null = null;
  let platformNative = 0;
  let platformNativeMatched = false;
  let platformBrl = 0;
  let platformBrlMatched = false;
  const nativeBreakdown = emptyReceiverBreakdown();
  const brlBreakdown = emptyReceiverBreakdown();
  for (const commission of commissions) {
    const source = String(
      commission?.source ?? commission?.commission?.source ?? "",
    ).toUpperCase();
    const amount = commission?.commission ?? commission;
    const value = amount?.value;
    const valueCurrency = firstString([
      amount?.currency_value,
      amount?.currency_code,
    ]).toUpperCase();
    const conversion =
      amount?.currency_conversion
      ?? commission?.currency_conversion
      ?? {};
    const numericValue = num(value);
    const isPlatformCommission = isHotmartPlatformCommission(source);
    if (valueCurrency === originalCurrency && numericValue > 0) {
      if (isPlatformCommission) {
        platformNative += numericValue;
        platformNativeMatched = true;
      } else {
        nativeNet += numericValue;
        nativeMatched = true;
        addReceiverAmount(nativeBreakdown, source, numericValue);
      }
    }
    if (
      String(conversion?.converted_to_currency ?? "").toUpperCase() === "BRL"
      && num(conversion?.converted_value) > 0
    ) {
      const convertedValue = num(conversion.converted_value);
      if (isPlatformCommission) {
        platformBrl += convertedValue;
        platformBrlMatched = true;
      } else {
        brlNet += convertedValue;
        brlMatched = true;
        addReceiverAmount(brlBreakdown, source, convertedValue);
      }
      const providerRate = num(conversion?.conversion_rate);
      const inferredRate = numericValue > 0
        ? convertedValue / numericValue
        : 0;
      if (providerRate > 0) brlRate = providerRate;
      else if (inferredRate > 0 && brlRate == null) brlRate = inferredRate;
    }
  }
  return {
    nativeNet: nativeMatched ? nativeNet : null,
    brlNet: brlMatched ? brlNet : null,
    brlRate,
    platformNative: platformNativeMatched ? platformNative : null,
    platformBrl: platformBrlMatched ? platformBrl : null,
    nativeBreakdown,
    brlBreakdown,
  };
}

type ReceiverBreakdown = {
  producer: number;
  affiliate: number;
  coproducer: number;
  other: number;
};

function emptyReceiverBreakdown(): ReceiverBreakdown {
  return { producer: 0, affiliate: 0, coproducer: 0, other: 0 };
}

function isHotmartPlatformCommission(source: string) {
  const normalized = source.replace(/[^A-Z0-9]+/g, "_");
  return normalized.includes("HOTMART")
    || normalized.includes("MARKETPLACE")
    || normalized.includes("MARKET_PLACE")
    // Hotmart reports ADDON beside participant commissions, but it is not
    // part of the producer/affiliate/coproducer settlement exported in the
    // authoritative financial report. Keep it with the provider fees so API
    // and spreadsheet reconciliation produce the same consolidated net.
    || normalized === "ADDON"
    || normalized === "PLATFORM"
    || normalized === "PLATFORM_FEE";
}

function addReceiverAmount(
  breakdown: ReceiverBreakdown,
  source: string,
  value: number,
) {
  const normalized = source.replace(/[^A-Z0-9]+/g, "_");
  if (normalized.includes("AFFILIATE") || normalized.includes("AFILIAD")) {
    breakdown.affiliate += value;
  } else if (
    normalized.includes("COPRODUCER")
    || normalized.includes("CO_PRODUCER")
    || normalized.includes("COPRODUTOR")
    || normalized.includes("CO_PRODUTOR")
  ) {
    breakdown.coproducer += value;
  } else if (normalized.includes("PRODUCER") || normalized.includes("PRODUTOR")) {
    breakdown.producer += value;
  } else {
    // Hotmart can introduce receiver labels without changing the economic
    // rule. Every non-platform receiver remains part of consolidated net.
    breakdown.other += value;
  }
}

function canonicalReceiverAmounts(
  amounts: ReturnType<typeof hotmartCommissionAmounts>,
  originalCurrency: string,
  convertedCurrency: boolean,
  conversionRate: number | null,
  scale: number,
) {
  const source = originalCurrency === "BRL"
    ? amounts.nativeBreakdown
    : amounts.brlNet != null
      ? amounts.brlBreakdown
      : amounts.nativeBreakdown;
  const fallbackScale = originalCurrency !== "BRL"
      && convertedCurrency
      && amounts.brlNet == null
      && conversionRate != null
    ? conversionRate
    : 1;
  return {
    producer: roundMoneyValue(source.producer * fallbackScale * scale),
    affiliate: roundMoneyValue(source.affiliate * fallbackScale * scale),
    coproducer: roundMoneyValue(source.coproducer * fallbackScale * scale),
    other: roundMoneyValue(source.other * fallbackScale * scale),
  };
}

function roundMoneyValue(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function firstPositive(values: unknown[]) {
  for (const value of values) {
    const parsed = num(value);
    if (parsed > 0) return parsed;
  }
  return 0;
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
    data.event_type,
    eventRecord.type,
    eventRecord.event_type,
    object.event,
    object.event_type,
  ]).toLowerCase();
  const status = firstString([
    object.status,
    object.payment_status,
    object.invoice_status,
    object.paymentStatus,
    object.invoiceStatus,
    object.state,
    eventRecord.status,
    eventRecord.payment_status,
    eventRecord.state,
    root.status,
  ]).toLowerCase();
  const normalizedStatus = normalizeToken(status);
  const classifier = `${eventType} ${status}`.trim();
  const isInvoiceCreated =
    eventType.includes("checkout.created")
    || eventType.includes("checkout_created")
    || eventType.includes("invoice.created");

  let type: NormalizedEvent["event_type"] | null = null;
  if (
    classifier.includes("refunded")
    || classifier.includes("refund")
    || classifier.includes("chargeback")
  ) {
    type = "purchase.refunded";
  } else if (
    classifier.includes("payment_failed")
    || classifier.includes("failed")
    || classifier.includes("declined")
    || classifier.includes("refused")
    || classifier.includes("rejected")
    || classifier.includes("denied")
    || classifier.includes("canceled")
    || classifier.includes("cancelled")
    || classifier.includes("expired")
    || classifier.includes("overdue")
    || normalizedStatus === "reversed"
    || normalizedStatus === "voided"
  ) {
    type = "purchase.refused";
  } else if (
    classifier.includes("payment_succeeded")
    || classifier.includes("payment.succeeded")
    || classifier.includes("payment_success")
    || classifier.includes("payment.success")
    || classifier.includes("invoice.paid")
    || classifier.includes("invoice.completed")
    || classifier.includes("invoice.settled")
    || classifier.includes("approved")
    || classifier.includes("completed")
    || classifier.includes("settled")
    || classifier.includes("confirmed")
    || classifier.includes("captured")
    || status === "paid"
    || status === "succeeded"
    || normalizedStatus === "success"
    || normalizedStatus === "successful"
    || normalizedStatus === "completed"
    || normalizedStatus === "complete"
    || normalizedStatus === "settled"
    || normalizedStatus === "confirmed"
    || normalizedStatus === "confirmado"
    || normalizedStatus === "confirmada"
    || normalizedStatus === "concluido"
    || normalizedStatus === "concluida"
    || normalizedStatus === "capturado"
    || normalizedStatus === "capturada"
    || normalizedStatus === "liquidado"
    || normalizedStatus === "liquidada"
    || normalizedStatus === "paga"
    || normalizedStatus === "pago"
    || normalizedStatus === "aprovada"
    || normalizedStatus === "aprovado"
  ) {
    type = "purchase.approved";
  } else if (
    isInvoiceCreated
    || classifier.includes("waiting_payment")
    || classifier.includes("payment_pending")
    || classifier.includes("unpaid")
    || normalizedStatus === "waiting"
    || normalizedStatus === "created"
    || normalizedStatus === "processing"
    || classifier.includes("pending")
  ) {
    type = "checkout_created";
  }
  if (!type) return [];

  const items = normalizeHublaItems(object);
  const subtotal = firstMoney(object, [
    { path: "amount.subtotalCents", cents: true },
    { path: "subtotalCents", cents: true },
    { path: "amount.subtotal", autoCents: true },
    { path: "subtotal", autoCents: true },
  ]);
  const total = firstMoney(object, [
    { path: "gross_amount", autoCents: true },
    { path: "amount_paid", cents: true },
    { path: "amount_total", cents: true },
    { path: "amount_due", cents: true },
    { path: "amount_received", cents: true },
    { path: "amount.totalCents", cents: true },
    { path: "amount.total", autoCents: true },
    { path: "totalCents", cents: true },
    { path: "paidAmountCents", cents: true },
    { path: "priceCents", cents: true },
    { path: "paid_amount", autoCents: true },
    { path: "charge_amount", autoCents: true },
    { path: "total_amount", autoCents: true },
    { path: "total", autoCents: true },
    { path: "amount", autoCents: true },
    { path: "value", autoCents: true },
    { path: "price", autoCents: true },
    { path: "subscription.plan.amount", cents: true },
    { path: "plan.amount", cents: true },
  ]) || subtotal || sumItemPrices(items);

  const explicitNet = firstMoney(object, [
    { path: "net_amount", autoCents: true },
    { path: "net", autoCents: true },
    { path: "netCents", cents: true },
    { path: "amount.netCents", cents: true },
  ]);
  const receiverBreakdown = hublaReceiverBreakdown(object);
  // Hubla's platform receiver is the only fee that must be removed from the
  // consolidated product revenue. The seller receiver can already be net of
  // coproduction, so using it alone under-reports projects with partners.
  const receiverNet = receiverBreakdown.accountNet
    + receiverBreakdown.coproducerAmount
    + receiverBreakdown.otherReceiverAmount;
  const netBeforeCoproduction = receiverBreakdown.platformFee > 0 && total > receiverBreakdown.platformFee
    ? total - receiverBreakdown.platformFee
    : receiverNet;
  const net = netBeforeCoproduction || explicitNet || total;

  if (type === "purchase.approved" && total <= 0 && !isInvoiceCreated) {
    return [];
  }

  const tsRaw = firstDefined([
    getPath(object, "status_transitions.paid_at"),
    object.paid_at,
    object.approved_at,
    object.approved_date,
    object.saleDate,
    object.sale_date,
    object.created_at,
    object.createdAt,
    object.created,
    object.modifiedAt,
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

  const checkout = asRecord(object.checkout ?? eventRecord.checkout);
  const metadata = asRecord(object.metadata ?? eventRecord.metadata);
  const tracking = asRecord(object.tracking ?? eventRecord.tracking);
  const paymentSession = asRecord(object.paymentSession ?? object.payment_session);
  const paymentSessionUtm = asRecord(paymentSession.utm);
  const paymentSessionParams = asRecord(paymentSession.params);
  const paymentSessionUrl = firstString([paymentSession.url, object.url, checkout.url]).toLowerCase();
  const customer = asRecord(object.customer);
  const payer = asRecord(object.payer);
  const user = asRecord(eventRecord.user);
  const product = firstRecord([
    object.product,
    eventRecord.product,
    firstArray([eventRecord.products])[0],
  ]);
  const utm = extractUtmParams({
    ...paymentSessionParams,
    ...paymentSessionUtm,
    ...metadata,
    ...checkout,
    ...tracking,
    ...paymentSession,
    ...object,
    ...eventRecord,
  });

  let normalizedItems = items.length > 0
    ? items
    : normalizeHublaProductItems(eventRecord, subtotal || total);
  if (isOfferEvent) {
    normalizedItems = normalizedItems.length > 0
      ? normalizedItems.map((item) => ({
        ...item,
        price: item.price > 0 ? item.price : total,
        type: String(item.type ?? "").toLowerCase().includes("upsell") ? "upsell" : "orderbump",
        is_bump: true,
      }))
      : [{
        external_id: originalExternalId,
        name: firstString([object.description, object.name, object.title, product.name, originalExternalId]),
        price: total,
        type: "orderbump",
        is_bump: true,
      }];
  }

  const payload = {
    raw_event: eventType,
    status: status || null,
    total,
    gross: total,
    subtotal: subtotal || null,
    net,
    net_before_coproduction: netBeforeCoproduction || null,
    account_net: receiverBreakdown.accountNet || null,
    coproducer_amount: receiverBreakdown.coproducerAmount || null,
    coproduction_rate: receiverBreakdown.coproducerAmount > 0
      && receiverBreakdown.accountNet + receiverBreakdown.coproducerAmount > 0
      ? (receiverBreakdown.coproducerAmount / (receiverBreakdown.accountNet + receiverBreakdown.coproducerAmount)) * 100
      : null,
    platform_fee: receiverBreakdown.platformFee || null,
    payment_method: firstString([
      object.payment_method,
      object.paymentMethod,
      getPath(object, "payment_method_details.type"),
      Array.isArray(object.payment_method_types) ? object.payment_method_types[0] : null,
      object.method,
      object.billing_reason,
    ]).toLowerCase(),
    buyer_email: firstString([object.customer_email, customer.email, payer.email, object.email, user.email]) || null,
    buyer_provider_id: firstString([
      object.payer_id,
      object.payerId,
      payer.id,
      user.id,
      eventRecord.user_id,
    ]) || null,
    product_id: firstString([object.product_id, product.id, getPath(object, "plan.product")]),
    items: normalizedItems,
    is_front: !isOfferEvent && !object.is_upsell && !object.upsell_id && !paymentSessionUrl.includes("/upsell"),
    transaction_id: transactionId,
    is_offer_event: isOfferEvent,
    raw_payload: raw,
    ...utm,
  };

  const events: NormalizedEvent[] = [];
  if (isInvoiceCreated) {
    events.push({
      event_type: "checkout_created",
      event_date: eventDate,
      event_occurred_at: new Date(ts).toISOString(),
      external_id: originalExternalId,
      payload,
    });
  }

  if (type !== "checkout_created" && (type !== "purchase.approved" || total > 0)) {
    events.push({
      event_type: type,
      event_date: eventDate,
      event_occurred_at: new Date(ts).toISOString(),
      external_id: originalExternalId,
      payload,
    });
  } else if (type === "checkout_created" && !isInvoiceCreated) {
    events.push({
      event_type: type,
      event_date: eventDate,
      event_occurred_at: new Date(ts).toISOString(),
      external_id: originalExternalId,
      payload,
    });
  }

  return events;
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
    event_occurred_at: new Date(ts).toISOString(),
    external_id: externalId,
    payload: {
      raw_event: eventType || status,
      total,
      net,
      payment_method: method,
      buyer_provider_id: String(raw?.Customer?.id ?? raw?.customer_id ?? "") || null,
      buyer_email: String(raw?.Customer?.email ?? raw?.customer_email ?? raw?.email ?? "") || null,
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
      type: isBump ? (itemType.includes("upsell") ? "upsell" : "orderbump") : "main",
      is_bump: isBump,
      ...(itemRecord.count_as_sale === true ? { count_as_sale: true } : {}),
    };
  });
}

function normalizeHublaProductItems(eventRecord: Record<string, any>, fallbackPrice: number) {
  const products = firstArray([
    eventRecord.products,
    eventRecord.product ? [eventRecord.product] : null,
  ]);
  const mainOfferId = firstString([getPath(eventRecord, "product.id")]);

  return products.flatMap((product: any, index: number) => {
    const productRecord = asRecord(product);
    const productId = firstString([productRecord.id, productRecord.product_id, `product-${index + 1}`]);
    const offers = firstNonEmptyArray([productRecord.offers]);
    if (offers.length === 0) {
      const isBump = index > 0 && Boolean(mainOfferId && productId !== mainOfferId);
      return [{
        external_id: productId,
        product_id: productId,
        name: firstString([productRecord.name, productRecord.title, productId]),
        price: firstMoney(productRecord, [
          { path: "amount", autoCents: true },
          { path: "amountCents", cents: true },
          { path: "price", autoCents: true },
          { path: "priceCents", cents: true },
          { path: "value", autoCents: true },
        ]) || (index === 0 ? fallbackPrice : 0),
        type: isBump ? "orderbump" : "main",
        is_bump: isBump,
      }];
    }

    return offers.map((offer: any, offerIndex: number) => {
      const offerRecord = asRecord(offer);
      const offerId = firstString([
        offerRecord.id,
        offerRecord.offer_id,
        `${productId}-offer-${offerIndex + 1}`,
      ]);
      const explicitBump = typeof offerRecord.isOrderBump === "boolean"
        ? offerRecord.isOrderBump
        : typeof offerRecord.is_order_bump === "boolean"
          ? offerRecord.is_order_bump
          : null;
      const isBump = explicitBump ?? (Boolean(mainOfferId) && offerId !== mainOfferId);
      return {
        external_id: offerId,
        product_id: productId,
        name: firstString([
          productRecord.name,
          productRecord.title,
          offerRecord.name,
          offerId,
        ]),
        price: firstMoney(offerRecord, [
          { path: "amountCents", cents: true },
          { path: "amount", autoCents: true },
          { path: "priceCents", cents: true },
          { path: "price", autoCents: true },
          { path: "value", autoCents: true },
        ]) || (!isBump && index === 0 && offerIndex === 0 ? fallbackPrice : 0),
        type: isBump ? "orderbump" : "main",
        is_bump: isBump,
      };
    });
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

function hublaReceiverBreakdown(invoice: Record<string, any>) {
  const receivers = firstNonEmptyArray([invoice.receivers, getPath(invoice, "payment.receivers")]);
  const sellerId = firstString([invoice.sellerId, getPath(invoice, "seller.id")]);
  return receivers.reduce((totals, receiver) => {
    const record = asRecord(receiver);
    const role = normalizeHublaRole(firstString([record.role, record.type, record.kind]));
    const receiverId = firstString([record.id, record.userId, record.accountId]);
    const amount = firstMoney(record, [
      { path: "netCents", cents: true },
      { path: "net_amount", autoCents: true },
      { path: "totalCents", cents: true },
      { path: "total", autoCents: true },
      { path: "amountCents", cents: true },
      { path: "amount", autoCents: true },
    ]);
    if (role === "platform" || receiverId === "platform-identity") totals.platformFee += amount;
    else if (["partner", "coproducer", "coprodutor", "coproductor", "coproducao"].includes(role)
      || (sellerId && receiverId && receiverId !== sellerId && ["seller", "producer", "merchant", "produtor", "vendedor"].includes(role))) {
      totals.coproducerAmount += amount;
    } else if (!role || ["seller", "producer", "merchant", "produtor", "vendedor"].includes(role)) {
      totals.accountNet += amount;
    } else {
      // Keep other non-platform recipients (for example, an affiliate) in
      // consolidated net revenue without pretending they are coproducers.
      totals.otherReceiverAmount += amount;
    }
    return totals;
  }, { accountNet: 0, coproducerAmount: 0, platformFee: 0, otherReceiverAmount: 0 });
}

function firstNonEmptyArray(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function firstArray(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeHublaRole(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
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

function normalizeToken(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

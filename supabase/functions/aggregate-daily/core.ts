/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

type RawEvent = {
  source: string;
  event_type: string;
  external_id?: string | null;
  payload: any;
};

const META_TAX_RATE = 0.1215;

export function aggregateOneDay(events: RawEvent[]) {
  let dailyMetricsOverride: Record<string, unknown> | null = null;
  const hasSessionStatsByDay = events.some((event) =>
    event.source === "vturb"
    && event.event_type === "sessions_stats_by_day"
    && hasUsableSessionStatsPayload(event.payload),
  );

  let investimento = 0;
  let impressoes = 0;
  let cliques = 0;
  let landingPageviews = 0;

  let pageviews = 0;
  let viewsUnicas = 0;
  let plays = 0;
  let chegaramPitch = 0;
  let vturbPitchClicks = 0;
  let vturbPitchConversions = 0;
  let hasVturbSessionPitchData = false;

  let vendasFront = 0;
  let vendasTotais = 0;
  let fatBruto = 0;
  let fatLiquido = 0;
  let fatFront = 0;
  let fatOrderbump = 0;
  let fatFunil = 0;
  let reembolsos = 0;
  let valorReembolsado = 0;
  let cardApproved = 0;
  let cardTotal = 0;
  let pixApproved = 0;
  let pixTotal = 0;
  const checkoutEvents: RawEvent[] = [];
  const checkoutKeys = new Set<string>();
  let checkoutFallbackIndex = 0;
  const bumpAgg = new Map<string, { name: string; type: string; count: number; revenue: number }>();
  const approvedGatewayEvents: RawEvent[] = [];

  for (const event of events) {
    const payload = event.payload || {};

    if (event.source === "sheet_override" && event.event_type === "daily_metrics") {
      dailyMetricsOverride = { ...(dailyMetricsOverride ?? {}), ...payload };
      continue;
    }

    if (event.source === "meta" && event.event_type === "insight") {
      const meta = extractMetaTrafficMetrics(payload);
      investimento += meta.spend;
      impressoes += meta.impressions;
      cliques += meta.linkClicks;
      landingPageviews += meta.landingPageviews;
      continue;
    }

    if (event.source === "vturb") {
      if (hasSessionStatsByDay && event.event_type === "stats_by_day") {
        continue;
      }
      const vturb = extractVturbMetrics(event.event_type, payload);
      pageviews += vturb.pageviews;
      viewsUnicas += vturb.viewsUnicas;
      plays += vturb.plays;
      chegaramPitch += vturb.chegaramPitch;
      vturbPitchClicks += vturb.pitchClicks;
      vturbPitchConversions += vturb.pitchConversions;
      hasVturbSessionPitchData = hasVturbSessionPitchData || vturb.hasSessionPitchData;
      continue;
    }

    if (event.source !== "gateway") {
      continue;
    }

    if (event.event_type === "checkout_created") {
      checkoutEvents.push(event);
      continue;
    }

    if (event.event_type === "purchase.approved") {
      if (hasPositivePurchaseValue(event)) {
        approvedGatewayEvents.push(event);
      }
      continue;
    }

    if (event.event_type === "purchase.refused") {
      const method = String(payload.payment_method ?? "").toLowerCase();
      if (method.includes("card") || method.includes("cart")) cardTotal++;
      else if (method.includes("pix")) pixTotal++;
      continue;
    }

    if (event.event_type === "purchase.refunded") {
      reembolsos++;
      valorReembolsado += num(payload.total);
    }
  }

  const frontIdentity = inferFrontIdentity([...approvedGatewayEvents, ...checkoutEvents]);
  for (const event of checkoutEvents) {
    if (isOfferEvent(event) || !isUnpaidCheckout(event)) continue;
    if (frontIdentity && eventHasProductIdentity(event) && !eventMatchesFrontFamily(event, frontIdentity)) continue;
    const key = transactionKey(event) || `checkout-${checkoutFallbackIndex++}`;
    checkoutKeys.add(key);
  }

  for (const group of groupApprovedPurchases(approvedGatewayEvents)) {
    const revenue = purchaseGroupRevenue(group);
    const isFront = purchaseGroupIsFront(group, frontIdentity);
    const realBumpItems = realBumpItemsForGroup(group, frontIdentity);
    const realOfferFallbacks = realOfferFallbacksForGroup(group, frontIdentity);
    const realBumpRevenue = Array.from(realBumpItems).reduce((sum, item) => sum + num(item?.price), 0)
      + realOfferFallbacks.reduce((sum, item) => sum + item.price, 0);
    let groupFunnelSales = 0;

    fatBruto += revenue.total;
    fatLiquido += revenue.net;
    if (isFront) {
      vendasFront++;
      fatFront += Math.max(0, revenue.total - realBumpRevenue);
    } else {
      fatFunil += revenue.total;
      groupFunnelSales++;
    }
    if (realBumpRevenue > 0) {
      fatFunil += realBumpRevenue;
    }

    const itemSeen = new Set<string>();
    for (const event of group) {
      const items: any[] = Array.isArray(event.payload?.items) ? event.payload.items : [];
      for (const item of items) {
        if (!item?.is_bump) continue;
        if (!realBumpItems.has(item)) continue;
        const key = String(item.external_id ?? item.name ?? "");
        if (!key) continue;
        const price = num(item.price);
        const itemDedupKey = `${key}:${price}`;
        if (itemSeen.has(itemDedupKey)) continue;
        itemSeen.add(itemDedupKey);

        const current = bumpAgg.get(key) ?? {
          name: String(item.name ?? key),
          type: String(item.type ?? "orderbump"),
          count: 0,
          revenue: 0,
        };
        current.count += 1;
        current.revenue += price;
        fatOrderbump += price;
        groupFunnelSales++;
        bumpAgg.set(key, current);
      }
    }

    for (const item of realOfferFallbacks) {
      const current = bumpAgg.get(item.key) ?? {
        name: item.name,
        type: item.type,
        count: 0,
        revenue: 0,
      };
      current.count += 1;
      current.revenue += item.price;
      fatOrderbump += item.price;
      groupFunnelSales++;
      bumpAgg.set(item.key, current);
    }

    if (!isFront) {
      const main = group.find((event) => !isOfferEvent(event)) ?? group[0];
      const mainItem = firstMainItem(main);
      const key = String(mainItem?.external_id ?? main.payload?.product_id ?? main.external_id ?? mainItem?.name ?? "");
      if (key) {
        const price = revenue.mainTotal || revenue.total;
        const current = bumpAgg.get(key) ?? {
          name: String(mainItem?.name ?? main.payload?.product_id ?? key),
          type: eventLooksUpsell(main) ? "upsell" : "orderbump",
          count: 0,
          revenue: 0,
        };
        current.count += 1;
        current.revenue += price;
        fatOrderbump += price;
        bumpAgg.set(key, current);
      }
    }

    vendasTotais += (isFront ? 1 : 0) + groupFunnelSales;

    const method = String(group.find((event) => !isOfferEvent(event))?.payload?.payment_method ?? group[0]?.payload?.payment_method ?? "").toLowerCase();
    if (method.includes("card") || method.includes("cart")) {
      cardApproved++;
      cardTotal++;
    } else if (method.includes("pix")) {
      pixApproved++;
      pixTotal++;
    }
  }

  const cpm = impressoes > 0 ? (investimento / impressoes) * 1000 : null;
  const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : null;
  const cpc = cliques > 0 ? investimento / cliques : null;
  const playRate = pageviews > 0 ? (plays / pageviews) * 100 : null;
  const retPitch = plays > 0 ? (chegaramPitch / plays) * 100 : null;
  const checkouts = checkoutKeys.size;
  const passChk = pageviews > 0 ? (checkouts / pageviews) * 100 : null;
  const taxaCarreg = cliques > 0 ? (landingPageviews / cliques) * 100 : null;
  const pitchChk = chegaramPitch > 0 ? (checkouts / chegaramPitch) * 100 : null;
  const pitchVenda = chegaramPitch > 0 ? (vendasFront / chegaramPitch) * 100 : null;
  const chkVenda = checkouts > 0 ? (vendasFront / checkouts) * 100 : null;
  const custoPageview = landingPageviews > 0 ? investimento / landingPageviews : null;
  const custoIC = checkouts > 0 ? investimento / checkouts : null;
  const cpaFront = vendasFront > 0 ? investimento / vendasFront : null;
  const cac = vendasTotais > 0 ? investimento / vendasTotais : null;
  const aov = vendasTotais > 0 ? fatBruto / vendasTotais : null;
  const impostoMeta = investimento * META_TAX_RATE;
  const lucro = fatLiquido - investimento - impostoMeta;
  const roi = investimento > 0 ? (fatLiquido - impostoMeta) / investimento : null;
  const taxaReembolso = vendasTotais > 0 ? (reembolsos / vendasTotais) * 100 : null;
  const aprovCartao = cardTotal > 0 ? (cardApproved / cardTotal) * 100 : null;
  const aprovPix = pixTotal > 0 ? (pixApproved / pixTotal) * 100 : null;
  const bumpCount = Array.from(bumpAgg.values()).reduce((sum, bump) => sum + bump.count, 0);
  const convGeralOrderbump = vendasFront > 0 ? (bumpCount / vendasFront) * 100 : null;
  const proporcaoFunilFront = fatFront > 0 ? fatFunil / fatFront : null;

  const bumps = Array.from(bumpAgg.values()).map((bump) => ({
    name: bump.name,
    type: bump.type,
    count: bump.count,
    revenue: bump.revenue,
    rate: vendasFront > 0 ? (bump.count / vendasFront) * 100 : null,
  }));

  const metrics = {
    investimento: orNull(investimento),
    impressoes: orNull(impressoes),
    cliques: orNull(cliques),
    landing_pageviews: orNull(landingPageviews),
    cpm,
    ctr,
    cpc,
    pageviews: orNull(pageviews),
    views_unicas: orNull(viewsUnicas),
    play_rate: playRate,
    ret_pitch: retPitch,
    chegaram_pitch: orNull(chegaramPitch),
    checkouts: orNull(checkouts),
    custo_pageview: custoPageview,
    custo_ic: custoIC,
    taxa_carreg: taxaCarreg,
    pass_chk: passChk,
    pitch_chk: pitchChk,
    pitch_venda: pitchVenda,
    chk_venda: chkVenda,
    vendas_front: orNull(vendasFront),
    vendas_totais: orNull(vendasTotais),
    cpa_front: cpaFront,
    cac,
    aov,
    roi,
    lucro: orNull(lucro),
    imposto_meta: orNull(impostoMeta),
    fat_bruto: orNull(fatBruto),
    fat_liquido: orNull(fatLiquido),
    fat_front: orNull(fatFront),
    fat_orderbump: orNull(fatOrderbump),
    fat_funil: orNull(fatFunil),
    reembolsos: orNull(reembolsos),
    taxa_reembolso: taxaReembolso,
    valor_reembolsado: orNull(valorReembolsado),
    aprov_cartao: aprovCartao,
    aprov_pix: aprovPix,
    conv_geral_orderbump: convGeralOrderbump,
    proporcao_funil_front: proporcaoFunilFront,
    bumps,
  };

  return applyDailyMetricsOverride(metrics, dailyMetricsOverride);
}

const DAILY_METRIC_OVERRIDE_KEYS = [
  "investimento",
  "impressoes",
  "cliques",
  "landing_pageviews",
  "cpm",
  "ctr",
  "cpc",
  "pageviews",
  "views_unicas",
  "play_rate",
  "ret_pitch",
  "chegaram_pitch",
  "checkouts",
  "custo_pageview",
  "custo_ic",
  "taxa_carreg",
  "pass_chk",
  "pitch_chk",
  "pitch_venda",
  "chk_venda",
  "vendas_front",
  "vendas_totais",
  "cpa_front",
  "cac",
  "aov",
  "roi",
  "lucro",
  "imposto_meta",
  "fat_bruto",
  "fat_liquido",
  "fat_front",
  "fat_orderbump",
  "fat_funil",
  "reembolsos",
  "taxa_reembolso",
  "valor_reembolsado",
  "aprov_cartao",
  "aprov_pix",
  "conv_geral_orderbump",
  "proporcao_funil_front",
] as const;

function applyDailyMetricsOverride<T extends Record<string, unknown>>(
  metrics: T,
  override: Record<string, unknown> | null,
) {
  if (!override) return metrics;
  const out = { ...metrics };

  for (const key of DAILY_METRIC_OVERRIDE_KEYS) {
    if (!(key in override)) continue;
    out[key] = overrideNumber(override[key]);
  }

  if (Array.isArray(override.bumps)) {
    out.bumps = override.bumps;
  }

  return out;
}

function extractMetaTrafficMetrics(payload: any) {
  const linkClicks =
    firstActionNumber(payload.actions, ["link_click"])
    ?? firstActionNumber(payload.actions, ["omni_link_click"])
    ?? firstActionNumber(payload.outbound_clicks, ["outbound_click", "link_click"])
    ?? num(payload.clicks);
  const landingPageviews =
    firstActionNumber(payload.actions, ["landing_page_view"])
    ?? firstActionNumber(payload.actions, ["omni_landing_page_view"])
    ?? 0;

  return {
    spend: num(payload.spend),
    impressions: num(payload.impressions),
    linkClicks,
    landingPageviews,
  };
}

function firstActionNumber(actions: unknown, actionTypes: string[]) {
  if (!Array.isArray(actions)) {
    return null;
  }

  for (const actionType of actionTypes) {
    let found = false;
    let total = 0;
    for (const action of actions) {
      const item = action as any;
      if (String(item?.action_type ?? "").toLowerCase() !== actionType) continue;
      found = true;
      total += num(item?.value);
    }
    if (found) return total;
  }

  return null;
}

function groupApprovedPurchases(events: RawEvent[]) {
  const groups = new Map<string, RawEvent[]>();
  events.forEach((event, index) => {
    const key = transactionKey(event) || `event-${index}`;
    const current = groups.get(key) ?? [];
    current.push(event);
    groups.set(key, current);
  });
  return Array.from(groups.values());
}

function hasPositivePurchaseValue(event: RawEvent) {
  const payload = event.payload || {};
  if (num(payload.total) > 0 || num(payload.net) > 0) return true;
  const items: any[] = Array.isArray(payload.items) ? payload.items : [];
  return items.some((item) => num(item?.price) > 0);
}

function transactionKey(event: RawEvent) {
  const payload = event.payload || {};
  return String(
    payload.transaction_id
      ?? stripOfferSuffix(String(event.external_id ?? payload.external_id ?? "")),
  );
}

function isOfferEvent(event: RawEvent) {
  const payload = event.payload || {};
  const externalId = String(event.external_id ?? payload.external_id ?? "");
  return Boolean(payload.is_offer_event) || /-offer-\d+$/i.test(externalId);
}

function purchaseGroupRevenue(group: RawEvent[]) {
  const mainTotals = group
    .filter((event) => !isOfferEvent(event))
    .map((event) => num(event.payload?.total))
    .filter((value) => value > 0);
  const mainNets = group
    .filter((event) => !isOfferEvent(event))
    .map(eventNet)
    .filter((value) => value > 0);
  const mainHasBumpItems = group.some((event) =>
    !isOfferEvent(event)
    && Array.isArray(event.payload?.items)
    && event.payload.items.some((item: any) => item?.is_bump),
  );
  const mainIncludesChildren = mainInvoiceIncludesOfferChildren(group);
  const offerTotal = mainHasBumpItems || mainIncludesChildren
    ? 0
    : group
      .filter((event) => isOfferEvent(event) && !isDuplicateMainOffer(event, group))
      .reduce((sum, event) => sum + num(event.payload?.total), 0);
  const offerNet = mainHasBumpItems || mainIncludesChildren
    ? 0
    : group
      .filter((event) => isOfferEvent(event) && !isDuplicateMainOffer(event, group))
      .reduce((sum, event) => sum + eventNet(event), 0);

  const mainTotal = mainTotals.length > 0 ? Math.max(...mainTotals) : 0;
  const mainNet = mainNets.length > 0 ? Math.max(...mainNets) : mainTotal;
  const fallbackTotal = group.reduce((sum, event) => sum + num(event.payload?.total), 0);
  const fallbackNet = group.reduce((sum, event) => sum + eventNet(event), 0);

  if (mainTotal > 0) {
    return {
      mainTotal,
      total: mainTotal + offerTotal,
      net: mainNet + offerNet,
    };
  }

  return {
    mainTotal: 0,
    total: fallbackTotal,
    net: fallbackNet > 0 ? fallbackNet : fallbackTotal,
  };
}

function eventNet(event: RawEvent) {
  const payloadNet = num(event.payload?.net);
  const payloadTotal = num(event.payload?.total);
  const sellerNet = sellerReceiverTotal(event.payload?.raw_payload ?? {});
  if (sellerNet > 0 && (!payloadNet || Math.abs(payloadNet - payloadTotal) < 0.0001)) return sellerNet;
  return payloadNet > 0 ? payloadNet : payloadTotal;
}

function sellerReceiverTotal(rawPayload: Record<string, any>) {
  const receivers = firstArray([
    getPath(rawPayload, "event.invoice.receivers"),
    getPath(rawPayload, "data.object.receivers"),
    getPath(rawPayload, "invoice.receivers"),
    rawPayload.receivers,
  ]);
  return receivers.reduce((sum, receiver) => {
    if (!receiver || typeof receiver !== "object") return sum;
    const record = receiver as Record<string, unknown>;
    const role = String(record.role ?? record.type ?? record.kind ?? "").toLowerCase();
    if (role && !["seller", "producer", "merchant"].includes(role)) return sum;
    if (role === "platform" || role === "affiliate" || role === "coproducer") return sum;
    const cents = firstNumber(record, ["netCents", "totalCents", "amountCents"]);
    if (cents > 0) return sum + cents / 100;
    return sum + firstNumber(record, ["net_amount", "total", "amount"]);
  }, 0);
}

function firstArray(values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function purchaseGroupIsFront(group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  const main = group.find((event) => !isOfferEvent(event));
  if (main) {
    if (eventLooksUpsell(main)) return false;
    if (frontIdentity) return eventMatchesFrontFamily(main, frontIdentity);
    return main.payload?.is_front ?? true;
  }
  return false;
}

function realBumpItemsForGroup(group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  const result = new Set<any>();
  for (const event of group) {
    const items: any[] = Array.isArray(event.payload?.items) ? event.payload.items : [];
    for (const item of items) {
      if (!item?.is_bump) continue;
      if (isOfferEvent(event) && isDuplicateMainOffer(event, group, frontIdentity)) continue;
      result.add(item);
    }
  }
  return result;
}

function realOfferFallbacksForGroup(group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  return group
    .filter((event) => {
      if (!isOfferEvent(event) || isDuplicateMainOffer(event, group, frontIdentity)) return false;
      const items: any[] = Array.isArray(event.payload?.items) ? event.payload.items : [];
      return !items.some((item) => item?.is_bump);
    })
    .map((event) => {
      const key = String(event.external_id ?? event.payload?.product_id ?? event.payload?.transaction_id ?? "");
      return {
        key,
        name: String(event.payload?.product_name ?? event.payload?.product_id ?? key ?? "Oferta"),
        type: eventLooksUpsell(event) ? "upsell" : "orderbump",
        price: num(event.payload?.total),
      };
    })
    .filter((item) => item.key && item.price > 0);
}

type ProductIdentity = { id: string; name: string };

function isDuplicateMainOffer(event: RawEvent, group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  if (!isOfferEvent(event)) return false;
  const offerItem = firstMainOrBumpItem(event);
  if (!offerItem) return false;
  const offerId = normalizeIdentity(offerItem.external_id);
  const offerName = normalizeIdentity(offerItem.name);
  if (!offerId && !offerName) return false;
  if (frontIdentity && ((offerId && offerId === frontIdentity.id) || (offerName && offerName === frontIdentity.name))) {
    return true;
  }

  return group
    .filter((candidate) => !isOfferEvent(candidate))
    .some((candidate) => {
      const mainItem = firstMainItem(candidate);
      const mainId = normalizeIdentity(mainItem?.external_id ?? candidate.payload?.product_id);
      const mainName = normalizeIdentity(mainItem?.name);
      return Boolean((offerId && offerId === mainId) || (offerName && offerName === mainName));
    });
}

function inferFrontIdentity(events: RawEvent[]): ProductIdentity | null {
  const counts = new Map<string, { identity: ProductIdentity; count: number }>();
  for (const event of events) {
    if (isOfferEvent(event) || eventLooksUpsell(event)) continue;
    const item = firstMainItem(event);
    const id = normalizeIdentity(item?.external_id ?? event.payload?.product_id);
    const name = normalizeIdentity(item?.name);
    if (!id && !name) continue;
    const key = id || name;
    const current = counts.get(key) ?? { identity: { id, name }, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0]?.identity ?? null;
}

function eventMatchesFrontFamily(event: RawEvent, frontIdentity: ProductIdentity) {
  const item = firstMainItem(event);
  const id = normalizeIdentity(item?.external_id ?? event.payload?.product_id);
  const name = normalizeIdentity(item?.name);
  if (frontIdentity.id && id === frontIdentity.id) return true;
  if (!frontIdentity.name || !name) return false;
  return name === frontIdentity.name || name.startsWith(`${frontIdentity.name} `);
}

function eventHasProductIdentity(event: RawEvent) {
  const item = firstMainItem(event);
  return Boolean(normalizeIdentity(item?.external_id ?? event.payload?.product_id) || normalizeIdentity(item?.name));
}

function isUnpaidCheckout(event: RawEvent) {
  const status = normalizeIdentity(event.payload?.status ?? getPath(event.payload?.raw_payload ?? {}, "event.invoice.status"));
  if (!status) return true;
  return !["paid", "pago", "paga", "succeeded", "approved", "aprovado", "aprovada"].includes(status);
}

function mainInvoiceIncludesOfferChildren(group: RawEvent[]) {
  return group
    .filter((event) => !isOfferEvent(event))
    .some((event) => {
      const childInvoiceIds = getPath(event.payload?.raw_payload ?? {}, "event.invoice.childInvoiceIds");
      return Array.isArray(childInvoiceIds) && childInvoiceIds.length > 0;
    });
}

function firstMainItem(event: RawEvent | undefined) {
  const items: any[] = Array.isArray(event?.payload?.items) ? event?.payload.items : [];
  return items.find((item) => !item?.is_bump) ?? items[0] ?? null;
}

function firstMainOrBumpItem(event: RawEvent | undefined) {
  const items: any[] = Array.isArray(event?.payload?.items) ? event?.payload.items : [];
  return items[0] ?? null;
}

function eventLooksUpsell(event: RawEvent | undefined) {
  const payload = event?.payload ?? {};
  if (payload.is_upsell || payload.upsell_id) return true;
  const raw = payload.raw_payload ?? {};
  const url = String(
    getPath(raw, "event.invoice.paymentSession.url")
      ?? getPath(raw, "data.object.paymentSession.url")
      ?? getPath(raw, "paymentSession.url")
      ?? "",
  ).toLowerCase();
  return url.includes("/upsell");
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function stripOfferSuffix(value: string) {
  return value.replace(/-offer-\d+$/i, "");
}

function extractVturbMetrics(eventType: string, payload: any) {
  if (eventType === "pageview") {
    return { pageviews: 1, viewsUnicas: 0, plays: 0, chegaramPitch: 0, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
  }
  if (eventType === "play") {
    return { pageviews: 0, viewsUnicas: 1, plays: 1, chegaramPitch: 0, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
  }
  if (eventType === "pitch_reached") {
    return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 1, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
  }
  if (eventType === "sessions_stats_by_day") {
    const pageviews = firstNumber(payload, [
      "total_viewed_session_uniq",
      "total_viewed",
      "views",
      "pageviews",
    ]);
    const viewsUnicas = firstNumber(payload, [
      "total_viewed_device_uniq",
      "total_viewed_session_uniq",
      "unique_views",
      "views_unicas",
    ]) || pageviews;
    const plays = firstNumber(payload, [
      "total_started_session_uniq",
      "total_started",
      "plays",
      "started",
    ]);
    const chegaramPitch = firstNumber(payload, [
      "total_over_pitch",
      "pitch_reached",
      "reached_pitch",
      "pitch",
    ]);
    const pitchClicks = firstNumber(payload, [
      "total_clicked_session_uniq",
      "total_clicked_device_uniq",
      "total_clicked",
    ]);
    const pitchConversions = firstNumber(payload, [
      "total_conversions",
      "conversions",
    ]);
    if (!hasUsableSessionStatsPayload(payload)) {
      return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 0, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
    }
    return { pageviews, viewsUnicas, plays, chegaramPitch, pitchClicks, pitchConversions, hasSessionPitchData: true };
  }
  if (eventType === "stats_by_day") {
    const pageviews = firstNumber(payload, [
      "pageviews",
      "page_views",
      "page_views_count",
      "landing_page_views",
      "visits",
      "total",
    ]);
    const plays = firstNumber(payload, [
      "plays",
      "play",
      "started",
      "video_starts",
      "video_started",
      "viewed",
      "total_uniq_sessions",
      "total_uniq_device",
      "total",
    ]);
    const viewsUnicas = firstNumber(payload, [
      "views_unicas",
      "unique_views",
      "unique_viewers",
      "visitors",
      "total_uniq_sessions",
      "total_uniq_device",
    ]) || plays;
    const chegaramPitch = firstNumber(payload, [
      "pitch_reached",
      "reached_pitch",
      "sales_page_viewers",
      "pitch",
    ]);
    return { pageviews, viewsUnicas, plays, chegaramPitch, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
  }
  if (eventType === "retention_curve") {
    return {
      pageviews: 0,
      viewsUnicas: 0,
      plays: 0,
      chegaramPitch: estimatePitchReached(payload),
      pitchClicks: 0,
      pitchConversions: 0,
      hasSessionPitchData: false,
    };
  }

  return { pageviews: 0, viewsUnicas: 0, plays: 0, chegaramPitch: 0, pitchClicks: 0, pitchConversions: 0, hasSessionPitchData: false };
}

function estimatePitchReached(payload: any) {
  const grouped = Array.isArray(payload?.grouped_timed) ? payload.grouped_timed : [];
  if (grouped.length === 0) return 0;

  for (const point of grouped) {
    const serialized = JSON.stringify(point).toLowerCase();
    if (!serialized.includes("pitch")) continue;
    const direct = firstNumber(point, ["count", "value", "views", "viewers", "users", "started"]);
    if (direct > 0) return direct;
  }

  const points = grouped
    .map((point: any, index: number) => ({
      time: firstNumber(point, ["second", "seconds", "time", "position", "x"]) || index,
      value: firstNumber(point, ["count", "value", "views", "viewers", "users", "started"]),
    }))
    .filter((point) => point.value > 0)
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return 0;
  const pivot = points[Math.floor((points.length - 1) * 0.75)] ?? points[points.length - 1];
  return pivot?.value ?? 0;
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = num(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function getPath(record: Record<string, any>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, record);
}

function hasUsableSessionStatsPayload(payload: Record<string, unknown>) {
  const viewed = firstNumber(payload, [
    "total_viewed_session_uniq",
    "total_viewed_device_uniq",
    "total_viewed",
  ]);
  const started = firstNumber(payload, [
    "total_started_session_uniq",
    "total_started_device_uniq",
    "total_started",
  ]);
  return viewed > 0 || started > 0;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function overrideNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = String(value)
    .trim()
    .replace(/R\$/gi, "")
    .replace(/%$/, "")
    .replace(/\s|\u00a0/g, "");
  if (!normalized) return null;
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

function orNull(value: number) {
  return value === 0 ? null : value;
}

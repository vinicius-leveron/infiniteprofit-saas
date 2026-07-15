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
  let hasMetaRaw = false;
  let hasVturbRaw = false;
  let hasGatewayRaw = false;

  let investimento = 0;
  let impressoes = 0;
  let cliques = 0;
  let landingPageviews = 0;
  let metaCheckouts: number | null = null;

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
  let valorReembolsadoLiquido = 0;
  const refundKeys = new Set<string>();
  let refundFallbackIndex = 0;
  const cardApprovedKeys = new Set<string>();
  const cardAttemptKeys = new Set<string>();
  const pixApprovedKeys = new Set<string>();
  const pixAttemptKeys = new Set<string>();
  const checkoutEvents: RawEvent[] = [];
  const checkoutKeys = new Set<string>();
  let checkoutFallbackIndex = 0;
  let refusedFallbackIndex = 0;
  const bumpAgg = new Map<string, { name: string; type: string; count: number; revenue: number }>();
  const approvedGatewayEvents: RawEvent[] = [];
  const refusedGatewayEvents: RawEvent[] = [];

  for (const event of events) {
    const payload = event.payload || {};

    if (event.source === "sheet_override" && event.event_type === "daily_metrics") {
      dailyMetricsOverride = { ...(dailyMetricsOverride ?? {}), ...payload };
      continue;
    }

    if (event.source === "meta" && event.event_type === "insight") {
      hasMetaRaw = true;
      const meta = extractMetaTrafficMetrics(payload);
      investimento += meta.spend;
      impressoes += meta.impressions;
      cliques += meta.linkClicks;
      landingPageviews += meta.landingPageviews;
      if (meta.initiateCheckouts != null) {
        metaCheckouts = (metaCheckouts ?? 0) + meta.initiateCheckouts;
      }
      continue;
    }

    if (event.source === "vturb") {
      hasVturbRaw = true;
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
    hasGatewayRaw = true;

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
      refusedGatewayEvents.push(event);
      continue;
    }

    if (event.event_type === "purchase.refunded") {
      const refundKey = transactionKey(event) || `refund-${refundFallbackIndex++}`;
      if (refundKeys.has(refundKey)) continue;
      refundKeys.add(refundKey);
      const refundGross = Math.abs(eventGross(event));
      const refundNet = Math.abs(eventNet(event) || refundGross);
      reembolsos++;
      valorReembolsado += refundGross;
      valorReembolsadoLiquido += refundNet;
    }
  }

  const frontIdentity = inferFrontIdentity([...approvedGatewayEvents, ...checkoutEvents]);
  for (const event of checkoutEvents) {
    if (isOfferEvent(event) || !isUnpaidCheckout(event)) continue;
    if (frontIdentity && event.payload?.is_front !== true && eventHasProductIdentity(event) && !eventMatchesFrontFamily(event, frontIdentity)) continue;
    const key = transactionKey(event) || `checkout-${checkoutFallbackIndex++}`;
    checkoutKeys.add(key);
    addPaymentAttempt(event, key, cardAttemptKeys, pixAttemptKeys);
  }

  for (const event of refusedGatewayEvents) {
    if (isOfferEvent(event)) continue;
    if (frontIdentity && event.payload?.is_front !== true && eventHasProductIdentity(event) && !eventMatchesFrontFamily(event, frontIdentity)) continue;
    const key = transactionKey(event) || `refused-${refusedFallbackIndex++}`;
    addPaymentAttempt(event, key, cardAttemptKeys, pixAttemptKeys);
  }

  const purchaseGroups = groupApprovedPurchases(approvedGatewayEvents);
  for (const [groupIndex, group] of purchaseGroups.entries()) {
    const revenue = purchaseGroupRevenue(group);
    const isFront = purchaseGroupIsFront(group, frontIdentity);
    const countStandaloneFunnelMain = !isFront && shouldCountStandaloneFunnelMain(group);
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
    } else if (countStandaloneFunnelMain) {
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
        if (price <= 0) continue;
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

    if (countStandaloneFunnelMain) {
      const main = group.find((event) => !isOfferEvent(event)) ?? group[0];
      const mainItem = firstMainItem(main);
      const key = String(mainItem?.external_id ?? main.payload?.product_id ?? main.external_id ?? mainItem?.name ?? "");
      if (key) {
        const price = revenue.mainTotal || revenue.total;
        if (price > 0) {
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
    }

    vendasTotais += (isFront ? 1 : 0) + groupFunnelSales;

    const mainPaymentEvent = group.find((event) => !isOfferEvent(event)) ?? group[0];
    const paymentKey = transactionKey(mainPaymentEvent) || `approved-${groupIndex}`;
    const method = paymentMethodKind(mainPaymentEvent?.payload?.payment_method);
    if (method === "card") {
      cardApprovedKeys.add(paymentKey);
      cardAttemptKeys.add(paymentKey);
    } else if (method === "pix") {
      pixApprovedKeys.add(paymentKey);
      pixAttemptKeys.add(paymentKey);
    }
  }

  const adjustedFatLiquido = Math.max(0, fatLiquido - valorReembolsadoLiquido);
  const cpm = impressoes > 0 ? (investimento / impressoes) * 1000 : null;
  const ctr = impressoes > 0 ? (cliques / impressoes) * 100 : null;
  const cpc = cliques > 0 ? investimento / cliques : null;
  const playRate = pageviews > 0 ? (plays / pageviews) * 100 : null;
  const retPitch = plays > 0 ? (chegaramPitch / plays) * 100 : null;
  const checkouts = metaCheckouts ?? checkoutKeys.size;
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
  const lucro = adjustedFatLiquido - investimento - impostoMeta;
  const roi = investimento > 0 ? (adjustedFatLiquido - impostoMeta) / investimento : null;
  const taxaReembolso = vendasFront > 0 ? (reembolsos / vendasFront) * 100 : null;
  const cardApproved = cardApprovedKeys.size;
  const cardTotal = cardAttemptKeys.size;
  const pixApproved = pixApprovedKeys.size;
  const pixTotal = pixAttemptKeys.size;
  const aprovCartao = cardTotal > 0 ? (cardApproved / cardTotal) * 100 : null;
  const aprovPix = pixTotal > 0 ? (pixApproved / pixTotal) * 100 : null;
  // "Conversão geral de order bump" is specifically the share of front
  // buyers who accepted an order bump. Upsell purchases are tracked in the
  // same `bumps` array but must not inflate this KPI.
  const bumpCount = Array.from(bumpAgg.values())
    .filter((bump) => bump.type === "orderbump")
    .reduce((sum, bump) => sum + bump.count, 0);
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
    plays_unicos: orNull(plays),
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
    fat_liquido: adjustedFatLiquido === 0 && (fatBruto > 0 || reembolsos > 0) ? 0 : orNull(adjustedFatLiquido),
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

  return applyDailyMetricsOverride(metrics, dailyMetricsOverride, {
    meta: hasMetaRaw,
    vturb: hasVturbRaw,
    gateway: hasGatewayRaw,
  });
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
  "plays_unicos",
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

type SourceCoverage = {
  meta: boolean;
  vturb: boolean;
  gateway: boolean;
};

const META_OWNED_KEYS = new Set<string>([
  "investimento",
  "impressoes",
  "cliques",
  "landing_pageviews",
  "checkouts",
  "cpm",
  "ctr",
  "cpc",
  "taxa_carreg",
  "custo_pageview",
  "imposto_meta",
]);

const VTURB_OWNED_KEYS = new Set<string>([
  "pageviews",
  "views_unicas",
  "plays_unicos",
  "play_rate",
  "ret_pitch",
  "chegaram_pitch",
]);

const GATEWAY_OWNED_KEYS = new Set<string>([
  "checkouts",
  "vendas_front",
  "vendas_totais",
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
]);

function applyDailyMetricsOverride<T extends Record<string, unknown>>(
  metrics: T,
  override: Record<string, unknown> | null,
  coverage: SourceCoverage,
) {
  if (!override) return recomputeDerivedMetrics(metrics);
  const out = { ...metrics };
  const authoritativeGatewayOverride = isAuthoritativeDailyImport(override);

  for (const key of DAILY_METRIC_OVERRIDE_KEYS) {
    if (!(key in override)) continue;
    if (shouldKeepRawMetric(key, coverage, out, authoritativeGatewayOverride)) continue;
    out[key] = overrideNumber(override[key]);
  }

  if ((authoritativeGatewayOverride || !coverage.gateway) && Array.isArray(override.bumps)) {
    out.bumps = override.bumps;
  }

  return recomputeDerivedMetrics(out);
}

function shouldKeepRawMetric(
  key: string,
  coverage: SourceCoverage,
  metrics: Record<string, unknown>,
  authoritativeGatewayOverride = false,
) {
  if (!hasMetricValue(metrics[key])) return false;
  if (
    authoritativeGatewayOverride
    && GATEWAY_OWNED_KEYS.has(key)
    && !(coverage.meta && META_OWNED_KEYS.has(key))
  ) return false;
  if (coverage.meta && META_OWNED_KEYS.has(key)) return true;
  if (coverage.vturb && VTURB_OWNED_KEYS.has(key)) return true;
  if (coverage.gateway && GATEWAY_OWNED_KEYS.has(key)) return true;
  return false;
}

function isAuthoritativeDailyImport(override: Record<string, unknown>) {
  return override.import_authoritative === true
    || override.import_source === "daily_metrics_sheet"
    || override.import_source === "denise_tracking_sheet";
}

function hasMetricValue(value: unknown) {
  return value != null && value !== "";
}

function recomputeDerivedMetrics<T extends Record<string, unknown>>(metrics: T) {
  const out = { ...metrics };
  const investimento = metricNumber(out.investimento);
  const impressoes = metricNumber(out.impressoes);
  const cliques = metricNumber(out.cliques);
  const landingPageviews = metricNumber(out.landing_pageviews);
  const pageviews = metricNumber(out.pageviews);
  const chegaramPitch = metricNumber(out.chegaram_pitch);
  const checkouts = metricNumber(out.checkouts);
  const vendasFront = metricNumber(out.vendas_front);
  const vendasTotais = metricNumber(out.vendas_totais);
  const fatBruto = metricNumber(out.fat_bruto);
  const fatLiquido = metricNumber(out.fat_liquido);
  const fatFront = metricNumber(out.fat_front);
  const fatFunil = metricNumber(out.fat_funil);
  const reembolsos = metricNumber(out.reembolsos);
  const valorReembolsado = metricNumber(out.valor_reembolsado);
  const storedPlays = metricNumber(out.plays_unicos);
  const plays = storedPlays != null
    ? storedPlays
    : pageviews && metricNumber(out.play_rate) != null
    ? (pageviews * metricNumber(out.play_rate)!) / 100
    : null;

  out.cpm = investimento != null && impressoes && impressoes > 0 ? (investimento / impressoes) * 1000 : null;
  out.ctr = cliques != null && impressoes && impressoes > 0 ? (cliques / impressoes) * 100 : null;
  out.cpc = investimento != null && cliques && cliques > 0 ? investimento / cliques : null;
  out.taxa_carreg = landingPageviews != null && cliques && cliques > 0 ? (landingPageviews / cliques) * 100 : null;
  out.custo_pageview = investimento != null && landingPageviews && landingPageviews > 0 ? investimento / landingPageviews : null;
  out.custo_ic = investimento != null && checkouts && checkouts > 0 ? investimento / checkouts : null;
  out.cpa_front = investimento != null && vendasFront && vendasFront > 0 ? investimento / vendasFront : null;
  out.cac = investimento != null && vendasTotais && vendasTotais > 0 ? investimento / vendasTotais : null;
  out.aov = fatBruto != null && vendasTotais && vendasTotais > 0 ? fatBruto / vendasTotais : null;
  out.pass_chk = pageviews && pageviews > 0 && checkouts != null ? (checkouts / pageviews) * 100 : null;
  out.pitch_chk = chegaramPitch && chegaramPitch > 0 && checkouts != null ? (checkouts / chegaramPitch) * 100 : null;
  out.pitch_venda = chegaramPitch && chegaramPitch > 0 && vendasFront != null ? (vendasFront / chegaramPitch) * 100 : null;
  out.chk_venda = checkouts && checkouts > 0 && vendasFront != null ? (vendasFront / checkouts) * 100 : null;
  out.plays_unicos = plays != null && plays !== 0 ? plays : null;
  out.play_rate = pageviews && pageviews > 0 && plays != null ? (plays / pageviews) * 100 : out.play_rate;
  out.ret_pitch = plays && plays > 0 && chegaramPitch != null ? (chegaramPitch / plays) * 100 : out.ret_pitch;
  out.taxa_reembolso = vendasFront && vendasFront > 0 && reembolsos != null ? (reembolsos / vendasFront) * 100 : null;
  out.valor_reembolsado = valorReembolsado ?? null;

  const impostoMeta = investimento != null ? investimento * META_TAX_RATE : null;
  out.imposto_meta = impostoMeta != null && impostoMeta !== 0 ? impostoMeta : null;
  out.lucro = fatLiquido != null ? fatLiquido - (investimento ?? 0) - (impostoMeta ?? 0) : null;
  out.roi = investimento && investimento > 0 && fatLiquido != null
    ? (fatLiquido - (impostoMeta ?? 0)) / investimento
    : null;

  const bumpCount = Array.isArray(out.bumps)
    ? out.bumps
      .filter((bump: any) => String(bump?.type ?? "orderbump") === "orderbump")
      .reduce((sum, bump: any) => sum + num(bump?.count), 0)
    : 0;
  out.conv_geral_orderbump = vendasFront && vendasFront > 0 ? (bumpCount / vendasFront) * 100 : null;
  out.proporcao_funil_front = fatFront && fatFront > 0 && fatFunil != null ? fatFunil / fatFront : null;

  return out;
}

function metricNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = num(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const initiateCheckouts =
    firstActionNumber(payload.actions, ["initiate_checkout"])
    ?? firstActionNumber(payload.actions, ["offsite_conversion.fb_pixel_initiate_checkout"])
    ?? firstActionNumber(payload.actions, ["omni_initiated_checkout", "omni_initiate_checkout"])
    ?? firstActionNumber(payload.actions, ["onsite_web_initiate_checkout", "onsite_web_app_initiate_checkout"]);

  return {
    spend: num(payload.spend),
    impressions: num(payload.impressions),
    linkClicks,
    landingPageviews,
    initiateCheckouts,
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
  if (eventGross(event) > 0 || num(payload.net) > 0) return true;
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

function addPaymentAttempt(
  event: RawEvent,
  key: string,
  cardAttemptKeys: Set<string>,
  pixAttemptKeys: Set<string>,
) {
  const method = paymentMethodKind(event.payload?.payment_method);
  if (method === "card") {
    cardAttemptKeys.add(key);
  } else if (method === "pix") {
    pixAttemptKeys.add(key);
  }
}

function paymentMethodKind(value: unknown): "card" | "pix" | null {
  const method = String(value ?? "").toLowerCase();
  if (method.includes("card") || method.includes("cart")) return "card";
  if (method.includes("pix")) return "pix";
  return null;
}

function isOfferEvent(event: RawEvent) {
  const payload = event.payload || {};
  const externalId = String(event.external_id ?? payload.external_id ?? "");
  return Boolean(payload.is_offer_event) || /-offer-\d+$/i.test(externalId);
}

function purchaseGroupRevenue(group: RawEvent[]) {
  const mainTotals = group
    .filter((event) => !isOfferEvent(event))
    .map(eventGross)
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
      .reduce((sum, event) => sum + eventGross(event), 0);
  const offerNet = mainHasBumpItems || mainIncludesChildren
    ? 0
    : group
      .filter((event) => isOfferEvent(event) && !isDuplicateMainOffer(event, group))
      .reduce((sum, event) => sum + eventNet(event), 0);

  const mainTotal = mainTotals.length > 0 ? Math.max(...mainTotals) : 0;
  const mainNet = mainNets.length > 0 ? Math.max(...mainNets) : mainTotal;
  const fallbackTotal = group.reduce((sum, event) => sum + eventGross(event), 0);
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

function eventGross(event: RawEvent) {
  const payload = event.payload || {};
  const explicitGross = firstPositiveMoney([
    payload.gross,
    payload.gross_amount,
    payload.total_gross,
    payload.amount_paid,
    payload.amount_total,
  ]);
  if (explicitGross > 0) return explicitGross;

  const rawPayload = payload.raw_payload ?? {};
  const rawGross = firstMoneyPath(rawPayload, [
    { path: "data.object.gross_amount", autoCents: true },
    { path: "data.object.amount_paid", cents: true },
    { path: "data.object.amount_total", cents: true },
    { path: "data.object.amount_due", cents: true },
    { path: "data.object.total", autoCents: true },
    { path: "data.object.total_amount", autoCents: true },
    { path: "data.object.amount.totalCents", cents: true },
    { path: "data.object.amount.total", autoCents: true },
    { path: "event.invoice.gross_amount", autoCents: true },
    { path: "event.invoice.amount_paid", cents: true },
    { path: "event.invoice.amount_total", cents: true },
    { path: "event.invoice.amount_due", cents: true },
    { path: "event.invoice.total", autoCents: true },
    { path: "event.invoice.total_amount", autoCents: true },
    { path: "event.invoice.amount.totalCents", cents: true },
    { path: "event.invoice.amount.total", autoCents: true },
    { path: "invoice.gross_amount", autoCents: true },
    { path: "invoice.amount_paid", cents: true },
    { path: "invoice.amount_total", cents: true },
    { path: "invoice.amount_due", cents: true },
    { path: "invoice.total", autoCents: true },
    { path: "amount_paid", cents: true },
    { path: "amount_total", cents: true },
    { path: "amount_due", cents: true },
    { path: "total", autoCents: true },
    { path: "total_amount", autoCents: true },
  ]);
  if (rawGross > 0) return rawGross;

  const payloadTotal = num(payload.total);
  if (payloadTotal > 0) return payloadTotal;

  const items: any[] = Array.isArray(payload.items) ? payload.items : [];
  return items.reduce((sum, item) => sum + num(item?.price), 0);
}

function eventNet(event: RawEvent) {
  const payloadNet = num(event.payload?.net);
  const payloadTotal = eventGross(event);
  const receiverNet = hublaReceiverNetBeforeCoproduction(event.payload?.raw_payload ?? {}, payloadTotal);
  if (receiverNet > 0) return receiverNet;
  return payloadNet > 0 ? payloadNet : payloadTotal;
}

function hublaReceiverNetBeforeCoproduction(rawPayload: Record<string, any>, gross: number) {
  const receivers = firstNonEmptyArray([
    getPath(rawPayload, "event.invoice.receivers"),
    getPath(rawPayload, "data.object.receivers"),
    getPath(rawPayload, "invoice.receivers"),
    rawPayload.receivers,
  ]);
  let nonPlatform = 0;
  let platformFee = 0;
  for (const receiver of receivers) {
    if (!receiver || typeof receiver !== "object") continue;
    const record = receiver as Record<string, unknown>;
    const role = normalizeHublaRole(record.role ?? record.type ?? record.kind);
    const receiverId = String(record.id ?? record.userId ?? record.accountId ?? "");
    const cents = firstNumber(record, ["netCents", "totalCents", "amountCents"]);
    const amount = cents > 0 ? cents / 100 : firstNumber(record, ["net_amount", "total", "amount"]);
    if (role === "platform" || receiverId === "platform-identity") platformFee += amount;
    else nonPlatform += amount;
  }

  // If Hubla only sends the webhook owner's seller share, gross minus the
  // platform receiver still recovers the consolidated net before copro.
  if (platformFee > 0 && gross > platformFee) return gross - platformFee;
  return nonPlatform;
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

function purchaseGroupIsFront(group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  const main = group.find((event) => !isOfferEvent(event));
  if (main) {
    if (eventLooksUpsell(main)) return false;
    if (mainInvoiceIncludesOfferChildren(group) && frontIdentity) {
      return group.some((event) => eventMatchesFrontFamily(event, frontIdentity));
    }
    if (main.payload?.is_front === true) return true;
    if (main.payload?.is_front === false) return false;
    if (frontIdentity) return eventMatchesFrontFamily(main, frontIdentity);
    return true;
  }
  return false;
}

function realBumpItemsForGroup(group: RawEvent[], frontIdentity: ProductIdentity | null = null) {
  const result = new Set<any>();
  for (const event of group) {
    const items: any[] = Array.isArray(event.payload?.items) ? event.payload.items : [];
    for (const item of items) {
      if (!item?.is_bump) continue;
      if (num(item?.price) <= 0) continue;
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
      const bumpItems = items.filter((item) => item?.is_bump);
      return bumpItems.length === 0 || bumpItems.every((item) => num(item?.price) <= 0);
    })
    .map((event) => {
      const key = String(event.external_id ?? event.payload?.product_id ?? event.payload?.transaction_id ?? "");
      return {
        key,
        name: String(event.payload?.product_name ?? event.payload?.product_id ?? key ?? "Oferta"),
        type: eventLooksUpsell(event) ? "upsell" : "orderbump",
        price: eventGross(event),
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

  // Hubla explicitly links child invoices from the parent invoice. Every
  // linked offer is a real funnel sale, even when it reuses the front
  // product id (a common setup for access/order-bump offers). Only apply the
  // legacy product-identity de-duplication when that relationship is absent.
  if (mainInvoiceIncludesOfferChildren(group)) return false;

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
    if (event.payload?.is_front === false) continue;
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
  return name === frontIdentity.name;
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

function shouldCountStandaloneFunnelMain(group: RawEvent[]) {
  if (mainInvoiceIncludesOfferChildren(group)) return false;
  if (group.some((event) => isOfferEvent(event))) return false;
  return true;
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

function firstPositiveMoney(values: unknown[]) {
  for (const value of values) {
    const parsed = parseMoneyLike(value);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function firstMoneyPath(record: Record<string, any>, paths: Array<{ path: string; cents?: boolean; autoCents?: boolean }>) {
  for (const path of paths) {
    const value = getPath(record, path.path);
    const parsed = parseMoneyLike(value);
    if (parsed <= 0) continue;
    if (path.cents) return parsed / 100;
    if (path.autoCents && Number.isInteger(parsed) && Math.abs(parsed) >= 10000) return parsed / 100;
    return parsed;
  }
  return 0;
}

function parseMoneyLike(value: unknown) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let normalized = String(value)
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s|\u00a0/g, "");
  if (!normalized) return 0;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
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

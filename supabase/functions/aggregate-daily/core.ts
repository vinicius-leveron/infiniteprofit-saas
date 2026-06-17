/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any

type RawEvent = {
  source: string;
  event_type: string;
  external_id?: string | null;
  payload: any;
};

export function aggregateOneDay(events: RawEvent[]) {
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
  let checkouts = 0;
  const bumpAgg = new Map<string, { name: string; type: string; count: number; revenue: number }>();
  const approvedGatewayEvents: RawEvent[] = [];

  for (const event of events) {
    const payload = event.payload || {};

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
      checkouts++;
      continue;
    }

    if (event.event_type === "purchase.approved") {
      approvedGatewayEvents.push(event);
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

  for (const group of groupApprovedPurchases(approvedGatewayEvents)) {
    vendasTotais++;

    const revenue = purchaseGroupRevenue(group);
    const isFront = purchaseGroupIsFront(group);

    fatBruto += revenue.total;
    fatLiquido += revenue.net;
    if (isFront) {
      vendasFront++;
      fatFront += revenue.mainTotal || revenue.total;
    } else {
      fatFunil += revenue.mainTotal || revenue.total;
    }

    const itemSeen = new Set<string>();
    for (const event of group) {
      const items: any[] = Array.isArray(event.payload?.items) ? event.payload.items : [];
      for (const item of items) {
        if (!item?.is_bump) continue;
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
        bumpAgg.set(key, current);
      }
    }

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
  const passChk = pageviews > 0 ? (checkouts / pageviews) * 100 : null;
  const taxaCarreg = cliques > 0 ? (landingPageviews / cliques) * 100 : null;
  const pitchChk = chegaramPitch > 0
    ? ((hasVturbSessionPitchData ? vturbPitchClicks : checkouts) / chegaramPitch) * 100
    : null;
  const pitchVenda = chegaramPitch > 0
    ? ((hasVturbSessionPitchData ? vturbPitchConversions : vendasFront) / chegaramPitch) * 100
    : null;
  const chkVenda = checkouts > 0 ? (vendasFront / checkouts) * 100 : null;
  const custoPageview = landingPageviews > 0 ? investimento / landingPageviews : null;
  const custoIC = checkouts > 0 ? investimento / checkouts : null;
  const cpaFront = vendasFront > 0 ? investimento / vendasFront : null;
  const cac = vendasTotais > 0 ? investimento / vendasTotais : null;
  const aov = vendasTotais > 0 ? fatBruto / vendasTotais : null;
  const lucro = fatLiquido - investimento;
  const roi = investimento > 0 ? lucro / investimento : null;
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

  return {
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
    .map((event) => num(event.payload?.net ?? event.payload?.total))
    .filter((value) => value > 0);
  const mainHasBumpItems = group.some((event) =>
    !isOfferEvent(event)
    && Array.isArray(event.payload?.items)
    && event.payload.items.some((item: any) => item?.is_bump),
  );
  const offerTotal = mainHasBumpItems
    ? 0
    : group
      .filter(isOfferEvent)
      .reduce((sum, event) => sum + num(event.payload?.total), 0);
  const offerNet = mainHasBumpItems
    ? 0
    : group
      .filter(isOfferEvent)
      .reduce((sum, event) => sum + num(event.payload?.net ?? event.payload?.total), 0);

  const mainTotal = mainTotals.length > 0 ? Math.max(...mainTotals) : 0;
  const mainNet = mainNets.length > 0 ? Math.max(...mainNets) : mainTotal;
  const fallbackTotal = group.reduce((sum, event) => sum + num(event.payload?.total), 0);
  const fallbackNet = group.reduce((sum, event) => sum + num(event.payload?.net ?? event.payload?.total), 0);

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

function purchaseGroupIsFront(group: RawEvent[]) {
  const main = group.find((event) => !isOfferEvent(event));
  if (main) return main.payload?.is_front ?? true;
  return true;
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

function orNull(value: number) {
  return value === 0 ? null : value;
}

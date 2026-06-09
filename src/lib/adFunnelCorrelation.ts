/**
 * Modulo de correlacao de funil por anuncio
 * Correlaciona dados Meta Ads com VTurb e Gateway usando utm_content = ad_id
 */

// ============================================================================
// INTERFACES
// ============================================================================

export interface RawMetaPayload {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  creative_id?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  outbound_clicks?: Array<{ action_type: string; value: string | number }> | string | number;
  actions?: Array<{ action_type: string; value: string | number }>;
  action_values?: Array<{ action_type: string; value: string | number }>;
  website_purchase_roas?: Array<{ action_type: string; value: string | number }>;
  video_play_actions?: Array<{ action_type: string; value: string | number }>;
  video_p25_watched_actions?: Array<{ action_type: string; value: string | number }>;
  video_thruplay_watched_actions?: Array<{ action_type: string; value: string | number }>;
}

export interface RawVturbPayload {
  utm_source?: string;
  utm_campaign?: string;
  utm_content?: string;
  sessions?: number;
  views?: number;
  unique_views?: number;
  pitch_reached?: number;
  conversions?: number;
}

export interface RawGatewayPayload {
  utm_source?: string;
  utm_campaign?: string;
  utm_content?: string;
  total?: number;
  net?: number;
}

export interface FunnelMetrics {
  // Meta Ads
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number | null;
  ctr: number | null;

  // Pixel Meta
  pixel_checkouts: number;
  pixel_purchases: number;
  pixel_purchase_value: number;
  pixel_roas: number | null;

  // VTurb (correlacionado)
  vturb_views: number;
  vturb_pitch_reached: number;
  has_vturb_data: boolean;

  // Gateway (correlacionado)
  gateway_checkouts: number;
  gateway_purchases: number;
  gateway_revenue: number;
  has_gateway_data: boolean;

  // Metricas Derivadas
  real_roas: number | null;
  real_cpa: number | null;

  // Taxas de Conversao
  click_to_view: number | null;
  view_to_pitch: number | null;
  pitch_to_checkout: number | null;
  checkout_to_purchase: number | null;

  // Status
  correlation_status: "full" | "partial" | "none";
}

export interface AdFunnelMetric extends FunnelMetrics {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
}

export interface AdsetFunnelMetric extends FunnelMetrics {
  id: string;
  name: string;
  campaign_id: string;
  campaign_name: string;
  ads: AdFunnelMetric[];
  ads_with_data: number;
  total_ads: number;
}

export interface CampaignFunnelMetric extends FunnelMetrics {
  id: string;
  name: string;
  adsets: AdsetFunnelMetric[];
  ads_with_data: number;
  total_ads: number;
}

// ============================================================================
// HELPERS
// ============================================================================

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createEmptyFunnelMetrics(): FunnelMetrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    cpc: null,
    ctr: null,
    pixel_checkouts: 0,
    pixel_purchases: 0,
    pixel_purchase_value: 0,
    pixel_roas: null,
    vturb_views: 0,
    vturb_pitch_reached: 0,
    has_vturb_data: false,
    gateway_checkouts: 0,
    gateway_purchases: 0,
    gateway_revenue: 0,
    has_gateway_data: false,
    real_roas: null,
    real_cpa: null,
    click_to_view: null,
    view_to_pitch: null,
    pitch_to_checkout: null,
    checkout_to_purchase: null,
    correlation_status: "none",
  };
}

function calculateDerivedMetrics(metrics: FunnelMetrics): void {
  // CPC e CTR
  metrics.cpc = metrics.clicks > 0 ? metrics.spend / metrics.clicks : null;
  metrics.ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : null;

  // Pixel ROAS
  if (metrics.spend > 0 && metrics.pixel_purchase_value > 0) {
    metrics.pixel_roas = metrics.pixel_purchase_value / metrics.spend;
  }

  // Real ROAS (gateway)
  if (metrics.spend > 0 && metrics.gateway_revenue > 0) {
    metrics.real_roas = metrics.gateway_revenue / metrics.spend;
  }

  // Real CPA (gateway)
  if (metrics.spend > 0 && metrics.gateway_purchases > 0) {
    metrics.real_cpa = metrics.spend / metrics.gateway_purchases;
  }

  // Taxas de conversao
  if (metrics.clicks > 0 && metrics.vturb_views > 0) {
    metrics.click_to_view = (metrics.vturb_views / metrics.clicks) * 100;
  }
  if (metrics.vturb_views > 0 && metrics.vturb_pitch_reached > 0) {
    metrics.view_to_pitch = (metrics.vturb_pitch_reached / metrics.vturb_views) * 100;
  }
  if (metrics.vturb_pitch_reached > 0 && metrics.gateway_checkouts > 0) {
    metrics.pitch_to_checkout = (metrics.gateway_checkouts / metrics.vturb_pitch_reached) * 100;
  }
  if (metrics.gateway_checkouts > 0 && metrics.gateway_purchases > 0) {
    metrics.checkout_to_purchase = (metrics.gateway_purchases / metrics.gateway_checkouts) * 100;
  }

  // Status de correlacao
  if (metrics.has_vturb_data && metrics.has_gateway_data) {
    metrics.correlation_status = "full";
  } else if (metrics.has_vturb_data || metrics.has_gateway_data) {
    metrics.correlation_status = "partial";
  } else {
    metrics.correlation_status = "none";
  }
}

function aggregateMetrics(target: FunnelMetrics, source: FunnelMetrics): void {
  target.spend += source.spend;
  target.impressions += source.impressions;
  target.clicks += source.clicks;
  target.pixel_checkouts += source.pixel_checkouts;
  target.pixel_purchases += source.pixel_purchases;
  target.pixel_purchase_value += source.pixel_purchase_value;
  target.vturb_views += source.vturb_views;
  target.vturb_pitch_reached += source.vturb_pitch_reached;
  target.gateway_checkouts += source.gateway_checkouts;
  target.gateway_purchases += source.gateway_purchases;
  target.gateway_revenue += source.gateway_revenue;

  if (source.has_vturb_data) target.has_vturb_data = true;
  if (source.has_gateway_data) target.has_gateway_data = true;
}

// ============================================================================
// MAIN CORRELATION FUNCTION
// ============================================================================

export interface CorrelationInput {
  metaEvents: Array<{ payload: RawMetaPayload | null }>;
  vturbEvents: Array<{ payload: RawVturbPayload | null }>;
  gatewayEvents: Array<{ event_type: string; payload: RawGatewayPayload | null }>;
}

export interface CorrelationResult {
  ads: AdFunnelMetric[];
  campaigns: CampaignFunnelMetric[];
}

export function correlateAdFunnel(input: CorrelationInput): CorrelationResult {
  const { metaEvents, vturbEvents, gatewayEvents } = input;

  // 1. Agregar Meta por ad_id
  const adMap = new Map<string, AdFunnelMetric>();

  for (const event of metaEvents) {
    const payload = event.payload ?? {};
    const adId = String(payload.ad_id ?? "");
    if (!adId) continue;

    const existing = adMap.get(adId);
    const ad: AdFunnelMetric = existing ?? {
      ...createEmptyFunnelMetrics(),
      id: adId,
      name: String(payload.ad_name ?? adId),
      campaign_id: String(payload.campaign_id ?? "sem-campaign"),
      campaign_name: String(payload.campaign_name ?? "Sem Campanha"),
      adset_id: String(payload.adset_id ?? "sem-adset"),
      adset_name: String(payload.adset_name ?? "Sem Adset"),
    };

    ad.spend += toNumber(payload.spend);
    ad.impressions += toNumber(payload.impressions);
    ad.clicks += toNumber(payload.clicks);

    // Extrair conversoes do pixel
    const actions = payload.actions ?? [];
    const actionValues = payload.action_values ?? [];

    for (const action of actions) {
      const type = String(action.action_type ?? "").toLowerCase();
      const val = toNumber(action.value);
      if (type.includes("initiate_checkout") || type === "omni_initiated_checkout") {
        ad.pixel_checkouts += val;
      }
      if (type.includes("purchase") || type === "omni_purchase") {
        ad.pixel_purchases += val;
      }
    }

    for (const av of actionValues) {
      const type = String(av.action_type ?? "").toLowerCase();
      const val = toNumber(av.value);
      if (type.includes("purchase") || type === "omni_purchase") {
        ad.pixel_purchase_value += val;
      }
    }

    // ROAS do pixel (se disponivel)
    const roasArray = payload.website_purchase_roas ?? [];
    for (const r of roasArray) {
      const val = toNumber(r.value);
      if (val > 0) {
        ad.pixel_roas = val;
      }
    }

    adMap.set(adId, ad);
  }

  // 2. Criar mapa VTurb por utm_content
  const vturbByContent = new Map<string, { views: number; pitch_reached: number }>();

  for (const event of vturbEvents) {
    const payload = event.payload ?? {};
    const utmContent = payload.utm_content ? String(payload.utm_content) : null;
    if (!utmContent) continue;

    const existing = vturbByContent.get(utmContent) ?? { views: 0, pitch_reached: 0 };
    existing.views += toNumber(payload.sessions ?? payload.views ?? payload.unique_views);
    existing.pitch_reached += toNumber(payload.pitch_reached ?? payload.conversions);
    vturbByContent.set(utmContent, existing);
  }

  // 3. Criar mapa Gateway por utm_content
  const gatewayByContent = new Map<string, { checkouts: number; purchases: number; revenue: number }>();

  for (const event of gatewayEvents) {
    const payload = event.payload ?? {};
    const utmContent = payload.utm_content ? String(payload.utm_content) : null;
    if (!utmContent) continue;

    const existing = gatewayByContent.get(utmContent) ?? { checkouts: 0, purchases: 0, revenue: 0 };

    if (event.event_type === "checkout_created") {
      existing.checkouts += 1;
    } else if (event.event_type === "purchase.approved") {
      existing.purchases += 1;
      existing.revenue += toNumber(payload.total ?? payload.net ?? 0);
    }

    gatewayByContent.set(utmContent, existing);
  }

  // 4. Correlacionar: para cada ad, buscar utm_content = ad_id
  for (const [adId, ad] of adMap) {
    const vturb = vturbByContent.get(adId);
    if (vturb) {
      ad.vturb_views = vturb.views;
      ad.vturb_pitch_reached = vturb.pitch_reached;
      ad.has_vturb_data = true;
    }

    const gateway = gatewayByContent.get(adId);
    if (gateway) {
      ad.gateway_checkouts = gateway.checkouts;
      ad.gateway_purchases = gateway.purchases;
      ad.gateway_revenue = gateway.revenue;
      ad.has_gateway_data = true;
    }

    calculateDerivedMetrics(ad);
  }

  // 5. Converter para array ordenado
  const ads = [...adMap.values()];

  // 6. Agregar para hierarquia (Campanha > Adset > Ad)
  const campaignMap = new Map<string, CampaignFunnelMetric>();

  for (const ad of ads) {
    // Campanha
    let campaign = campaignMap.get(ad.campaign_id);
    if (!campaign) {
      campaign = {
        ...createEmptyFunnelMetrics(),
        id: ad.campaign_id,
        name: ad.campaign_name,
        adsets: [],
        ads_with_data: 0,
        total_ads: 0,
      };
      campaignMap.set(ad.campaign_id, campaign);
    }

    // Adset dentro da campanha
    let adset = campaign.adsets.find((a) => a.id === ad.adset_id);
    if (!adset) {
      adset = {
        ...createEmptyFunnelMetrics(),
        id: ad.adset_id,
        name: ad.adset_name,
        campaign_id: ad.campaign_id,
        campaign_name: ad.campaign_name,
        ads: [],
        ads_with_data: 0,
        total_ads: 0,
      };
      campaign.adsets.push(adset);
    }

    // Adicionar ad ao adset
    adset.ads.push(ad);
    adset.total_ads++;
    if (ad.has_vturb_data || ad.has_gateway_data) {
      adset.ads_with_data++;
    }

    // Agregar metricas para adset
    aggregateMetrics(adset, ad);

    // Agregar metricas para campanha
    aggregateMetrics(campaign, ad);
    campaign.total_ads++;
    if (ad.has_vturb_data || ad.has_gateway_data) {
      campaign.ads_with_data++;
    }
  }

  // 7. Calcular metricas derivadas para adsets e campanhas
  for (const campaign of campaignMap.values()) {
    for (const adset of campaign.adsets) {
      calculateDerivedMetrics(adset);
    }
    calculateDerivedMetrics(campaign);
  }

  return {
    ads,
    campaigns: [...campaignMap.values()],
  };
}

// ============================================================================
// SORT HELPERS
// ============================================================================

export type FunnelSortKey =
  | "spend"
  | "clicks"
  | "roas"
  | "cpa"
  | "real_roas"
  | "real_cpa"
  | "revenue"
  | "purchases";

export function valueForFunnelSort(item: FunnelMetrics, key: FunnelSortKey): number {
  switch (key) {
    case "spend":
      return item.spend;
    case "clicks":
      return item.clicks;
    case "roas":
      return item.pixel_roas ?? -1;
    case "cpa":
      return item.real_cpa ? -item.real_cpa : -Infinity; // Lower is better
    case "real_roas":
      return item.real_roas ?? -1;
    case "real_cpa":
      return item.real_cpa ? -item.real_cpa : -Infinity; // Lower is better
    case "revenue":
      return item.gateway_revenue;
    case "purchases":
      return item.gateway_purchases;
    default:
      return item.spend;
  }
}

export function sortFunnelItems<T extends FunnelMetrics>(items: T[], key: FunnelSortKey): T[] {
  return [...items].sort((a, b) => valueForFunnelSort(b, key) - valueForFunnelSort(a, key));
}

export function labelForFunnelSort(key: FunnelSortKey): string {
  switch (key) {
    case "spend":
      return "Gasto";
    case "clicks":
      return "Cliques";
    case "roas":
      return "ROAS Pixel";
    case "cpa":
      return "CPA";
    case "real_roas":
      return "ROAS Real";
    case "real_cpa":
      return "CPA Real";
    case "revenue":
      return "Receita";
    case "purchases":
      return "Vendas";
    default:
      return "Gasto";
  }
}

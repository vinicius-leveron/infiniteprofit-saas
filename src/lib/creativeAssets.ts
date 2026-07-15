export type CreativeMediaType = "video" | "image" | "unknown";
export type CreativeAnalysisStatus = "pending" | "processing" | "ready" | "failed" | "missing_media";
export type CreativeTranscriptStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "not_applicable"
  | "missing_media"
  | "oversized_queued";
export type CreativeAnalysisCoverage = "pending" | "full" | "partial" | "failed" | "not_applicable";
export type CreativePipelineStatus =
  | "pending"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "failed"
  | "missing_media"
  | "missing_transcript"
  | "oversized_queued";
export type CreativeSortKey = "purchases" | "roas" | "hook_rate" | "ctr" | "cpm" | "spend";
export type CreativeGroupBy = "none" | "campaign" | "adset" | "media_type";
export type FixedCreativeGroupKey = "all" | "best-hooks" | "best-roas";

export interface CreativeGroupRules {
  mediaType?: CreativeMediaType | "all";
  analysisStatus?: CreativeAnalysisStatus | "all";
  pipelineStatus?: CreativePipelineStatus | "all";
  transcriptStatus?: CreativeTranscriptStatus | "all";
  analysisCoverage?: CreativeAnalysisCoverage | "all";
  campaignQuery?: string;
  adsetQuery?: string;
  minHookRate?: number | null;
  minRoas?: number | null;
  minCtr?: number | null;
  maxCpm?: number | null;
  minSpend?: number | null;
}

export interface CreativeAssetRow {
  id: string;
  creative_id: string;
  asset_key: string;
  media_type: CreativeMediaType;
  thumbnail_url: string | null;
  media_storage_path: string | null;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  landing_url: string | null;
  post_url: string | null;
  facebook_post_url?: string | null;
  instagram_post_url?: string | null;
  analysis_status: CreativeAnalysisStatus;
  last_meta_synced_at: string | null;
  source_media_url: string | null;
  source_fetched_at: string | null;
  media_bytes: number | null;
  media_duration_ms: number | null;
  media_fingerprint: string | null;
  poster_storage_path: string | null;
  last_processed_at: string | null;
  processing_version: string | null;
}

export interface CreativeAssetAdRow {
  asset_id: string;
  ad_id: string;
  ad_created_time?: string | null;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
}

export interface CreativeAssetMetricRow {
  asset_id: string;
  event_date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  outbound_clicks: number | null;
  ctr: number | null;
  link_ctr: number | null;
  cpm: number | null;
  purchases: number | null;
  revenue: number | null;
  refunds: number | null;
  refund_value?: number | null;
  order_bump_purchases?: number | null;
  order_bump_revenue?: number | null;
  upsell_purchases?: number | null;
  upsell_revenue?: number | null;
  refund_rate: number | null;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  has_meta_data?: boolean | null;
  has_gateway_data?: boolean | null;
}

export interface CreativeTranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface CreativeHookTimestamp {
  start_ms: number;
  end_ms: number;
  label: string;
  reason: string;
}

export interface CreativeVisualEvidence {
  timestamp_ms: number;
  observation: string;
}

export interface CreativeAssetAnalysisRow {
  asset_id: string;
  status: CreativeAnalysisStatus;
  transcript_status: CreativeTranscriptStatus;
  transcript: string | null;
  transcript_segments: unknown;
  transcript_language: string | null;
  transcript_provider: string | null;
  transcript_model: string | null;
  transcript_error_message: string | null;
  summary: string | null;
  hook: string | null;
  hook_timestamps: unknown;
  angle: string | null;
  copy: string | null;
  cta: string | null;
  visual: string | null;
  visual_evidence: unknown;
  tags: unknown;
  scores: unknown;
  analysis_coverage: CreativeAnalysisCoverage;
  analysis_error_message: string | null;
  error_message: string | null;
  processed_at: string | null;
}

export interface CreativeAssetJobRow {
  asset_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
}

export interface CreativeGroupRow {
  id: string;
  name: string;
  rules: unknown;
  sort_key: string | null;
}

export interface CreativeAssetCard {
  id: string;
  creativeId: string;
  assetKey: string;
  mediaType: CreativeMediaType;
  mediaUrl: string | null;
  sourceMediaUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  cta: string | null;
  landingUrl: string | null;
  postUrl: string | null;
  facebookPostUrl: string | null;
  instagramPostUrl: string | null;
  analysisStatus: CreativeAnalysisStatus;
  transcriptStatus: CreativeTranscriptStatus;
  analysisCoverage: CreativeAnalysisCoverage;
  activeJobStatus: CreativeAssetJobRow["status"] | null;
  pipelineStatus: CreativePipelineStatus;
  transcript: string | null;
  transcriptSegments: CreativeTranscriptSegment[];
  transcriptLanguage: string | null;
  summary: string | null;
  hook: string | null;
  hookTimestamps: CreativeHookTimestamp[];
  angle: string | null;
  copy: string | null;
  visual: string | null;
  visualEvidence: CreativeVisualEvidence[];
  tags: string[];
  scores: Record<string, number>;
  errorMessage: string | null;
  transcriptErrorMessage: string | null;
  analysisErrorMessage: string | null;
  processedAt: string | null;
  lastMetaSyncedAt: string | null;
  firstAdCreatedAt: string | null;
  adIds: string[];
  adNames: string[];
  campaignNames: string[];
  adsetNames: string[];
  adsCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number;
  purchases: number;
  revenue: number;
  refunds: number;
  refundValue: number;
  refundRate: number | null;
  orderBumpPurchases: number;
  orderBumpRevenue: number;
  upsellPurchases: number;
  upsellRevenue: number;
  aov: number | null;
  ctr: number | null;
  linkCtr: number | null;
  cpm: number | null;
  roas: number | null;
  cpa: number | null;
  hookRate: number | null;
  hasMetaData: boolean;
  hasGatewayData: boolean;
  mediaDurationMs: number | null;
  mediaBytes: number | null;
  searchText: string;
}

export const FIXED_CREATIVE_GROUPS: Array<{ key: FixedCreativeGroupKey; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "best-hooks", label: "Melhores ganchos" },
  { key: "best-roas", label: "Maiores ROAS" },
];

export function buildCreativeAssetCards(input: {
  assets: CreativeAssetRow[];
  ads: CreativeAssetAdRow[];
  metrics: CreativeAssetMetricRow[];
  analyses: CreativeAssetAnalysisRow[];
  jobs?: CreativeAssetJobRow[];
}): CreativeAssetCard[] {
  const analysisByAsset = new Map(input.analyses.map((analysis) => [analysis.asset_id, analysis]));
  const activeJobByAsset = new Map(
    (input.jobs ?? [])
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => [job.asset_id, job.status]),
  );
  const adsByAsset = groupBy(input.ads, (row) => row.asset_id);
  const metricsByAsset = groupBy(input.metrics, (row) => row.asset_id);

  return input.assets.map((asset) => {
    const assetAds = adsByAsset.get(asset.id) ?? [];
    const assetMetrics = metricsByAsset.get(asset.id) ?? [];
    const analysis = analysisByAsset.get(asset.id) ?? null;

    const metricTotals = aggregateMetrics(assetMetrics);
    const adIds = unique(assetAds.map((row) => row.ad_id));
    const firstAdCreatedAt = earliestIso(assetAds.map((row) => row.ad_created_time).filter(Boolean) as string[]);
    const adNames = unique(assetAds.map((row) => row.ad_name).filter(Boolean) as string[]);
    const campaignNames = unique(assetAds.map((row) => row.campaign_name).filter(Boolean) as string[]);
    const adsetNames = unique(assetAds.map((row) => row.adset_name).filter(Boolean) as string[]);
    const transcriptSegments = normalizeTranscriptSegments(analysis?.transcript_segments);
    const hookTimestamps = normalizeHookTimestamps(analysis?.hook_timestamps);
    const visualEvidence = normalizeVisualEvidence(analysis?.visual_evidence);
    const transcriptStatus = normalizeTranscriptStatus(analysis?.transcript_status, asset.media_type);
    const analysisCoverage = normalizeAnalysisCoverage(analysis?.analysis_coverage, asset.media_type);
    const analysisStatus = normalizeAnalysisStatus(analysis?.status ?? asset.analysis_status);
    const activeJobStatus = activeJobByAsset.get(asset.id) ?? null;

    const searchParts = [
      asset.headline,
      asset.primary_text,
      asset.cta,
      asset.landing_url,
      asset.post_url,
      asset.facebook_post_url,
      asset.instagram_post_url,
      analysis?.summary,
      analysis?.hook,
      analysis?.angle,
      analysis?.copy,
      ...adNames,
      ...campaignNames,
      ...adsetNames,
      ...(analysis ? normalizeTagList(analysis.tags) : []),
    ];

    const card: CreativeAssetCard = {
      id: asset.id,
      creativeId: asset.creative_id,
      assetKey: asset.asset_key,
      mediaType: asset.media_type,
      mediaUrl: asset.thumbnail_url ?? null,
      sourceMediaUrl: asset.source_media_url ?? null,
      headline: asset.headline,
      primaryText: asset.primary_text,
      cta: asset.cta,
      landingUrl: asset.landing_url,
      postUrl: asset.post_url,
      facebookPostUrl: asset.facebook_post_url ?? facebookUrlFallback(asset.post_url),
      instagramPostUrl: asset.instagram_post_url ?? instagramUrlFallback(asset.post_url),
      analysisStatus,
      transcriptStatus,
      analysisCoverage,
      activeJobStatus,
      pipelineStatus: "pending",
      transcript: analysis?.transcript ?? null,
      transcriptSegments,
      transcriptLanguage: analysis?.transcript_language ?? null,
      summary: analysis?.summary ?? null,
      hook: analysis?.hook ?? null,
      hookTimestamps,
      angle: analysis?.angle ?? null,
      copy: analysis?.copy ?? null,
      visual: analysis?.visual ?? null,
      visualEvidence,
      tags: analysis ? normalizeTagList(analysis.tags) : [],
      scores: analysis ? normalizeScoreMap(analysis.scores) : {},
      errorMessage: analysis?.error_message ?? null,
      transcriptErrorMessage: analysis?.transcript_error_message ?? null,
      analysisErrorMessage: analysis?.analysis_error_message ?? null,
      processedAt: analysis?.processed_at ?? null,
      lastMetaSyncedAt: asset.last_meta_synced_at,
      firstAdCreatedAt,
      adIds,
      adNames,
      campaignNames,
      adsetNames,
      adsCount: adIds.length,
      ...metricTotals,
      mediaDurationMs: asset.media_duration_ms,
      mediaBytes: asset.media_bytes,
      searchText: searchParts.filter(Boolean).join(" ").toLowerCase(),
    };

    card.pipelineStatus = derivePipelineStatus(card);
    return card;
  });
}

function earliestIso(values: string[]) {
  let winner: string | null = null;
  let winnerTs = Infinity;
  for (const value of values) {
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts) || ts >= winnerTs) continue;
    winner = value;
    winnerTs = ts;
  }
  return winner;
}

export function applyCreativeFilters(
  cards: CreativeAssetCard[],
  args: {
    search: string;
    rules?: CreativeGroupRules | null;
  },
) {
  const search = args.search.trim().toLowerCase();
  return cards.filter((card) => {
    if (search && !card.searchText.includes(search)) return false;
    if (!args.rules) return true;
    return matchesCreativeGroupRules(card, args.rules);
  });
}

export function matchesCreativeGroupRules(card: CreativeAssetCard, rules: CreativeGroupRules) {
  if (rules.mediaType && rules.mediaType !== "all" && card.mediaType !== rules.mediaType) return false;
  if (rules.analysisStatus && rules.analysisStatus !== "all" && card.analysisStatus !== rules.analysisStatus) return false;
  if (rules.pipelineStatus && rules.pipelineStatus !== "all" && card.pipelineStatus !== rules.pipelineStatus) return false;
  if (rules.transcriptStatus && rules.transcriptStatus !== "all" && card.transcriptStatus !== rules.transcriptStatus) return false;
  if (rules.analysisCoverage && rules.analysisCoverage !== "all" && card.analysisCoverage !== rules.analysisCoverage) return false;
  if (rules.campaignQuery && !matchesAny(card.campaignNames, rules.campaignQuery)) return false;
  if (rules.adsetQuery && !matchesAny(card.adsetNames, rules.adsetQuery)) return false;
  if (rules.minHookRate != null && (card.hookRate ?? -Infinity) < rules.minHookRate) return false;
  if (rules.minRoas != null && (card.roas ?? -Infinity) < rules.minRoas) return false;
  if (rules.minCtr != null && (card.ctr ?? -Infinity) < rules.minCtr) return false;
  if (rules.maxCpm != null && (card.cpm ?? Infinity) > rules.maxCpm) return false;
  if (rules.minSpend != null && card.spend < rules.minSpend) return false;
  return true;
}

export function sortCreativeCards(cards: CreativeAssetCard[], sortKey: CreativeSortKey) {
  return [...cards].sort((left, right) => valueForCreativeSort(right, sortKey) - valueForCreativeSort(left, sortKey));
}

export function groupCreativeCards(cards: CreativeAssetCard[], groupByKey: CreativeGroupBy) {
  if (groupByKey === "none") {
    return [{ key: "all", label: "Todos", cards }];
  }

  const map = new Map<string, CreativeAssetCard[]>();
  for (const card of cards) {
    const values =
      groupByKey === "campaign"
        ? card.campaignNames
        : groupByKey === "adset"
          ? card.adsetNames
          : [labelForMediaType(card.mediaType)];
    const bucketValues = values.length > 0 ? values : ["Sem grupo"];
    for (const value of bucketValues) {
      const key = value || "Sem grupo";
      map.set(key, [...(map.get(key) ?? []), card]);
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([key, groupedCards]) => ({ key, label: key, cards: groupedCards }));
}

export function resolveSortKey(
  activeFixedGroup: FixedCreativeGroupKey,
  selectedSortKey: CreativeSortKey,
  customGroupSortKey?: string | null,
): CreativeSortKey {
  if (activeFixedGroup === "best-hooks") return "hook_rate";
  if (activeFixedGroup === "best-roas") return "roas";
  if (customGroupSortKey && isCreativeSortKey(customGroupSortKey)) return customGroupSortKey;
  return selectedSortKey;
}

export function parseCreativeGroupRules(value: unknown): CreativeGroupRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return {
    mediaType: isMediaType(source.mediaType) || source.mediaType === "all" ? (source.mediaType as CreativeGroupRules["mediaType"]) : undefined,
    analysisStatus:
      isAnalysisStatus(source.analysisStatus) || source.analysisStatus === "all"
        ? (source.analysisStatus as CreativeGroupRules["analysisStatus"])
        : undefined,
    pipelineStatus:
      isPipelineStatus(source.pipelineStatus) || source.pipelineStatus === "all"
        ? (source.pipelineStatus as CreativeGroupRules["pipelineStatus"])
        : undefined,
    transcriptStatus:
      isTranscriptStatus(source.transcriptStatus) || source.transcriptStatus === "all"
        ? (source.transcriptStatus as CreativeGroupRules["transcriptStatus"])
        : undefined,
    analysisCoverage:
      isAnalysisCoverage(source.analysisCoverage) || source.analysisCoverage === "all"
        ? (source.analysisCoverage as CreativeGroupRules["analysisCoverage"])
        : undefined,
    campaignQuery: parseString(source.campaignQuery),
    adsetQuery: parseString(source.adsetQuery),
    minHookRate: parseNumber(source.minHookRate),
    minRoas: parseNumber(source.minRoas),
    minCtr: parseNumber(source.minCtr),
    maxCpm: parseNumber(source.maxCpm),
    minSpend: parseNumber(source.minSpend),
  };
}

export function derivePipelineStatus(card: Pick<CreativeAssetCard, "mediaType" | "analysisStatus" | "transcriptStatus" | "analysisCoverage" | "activeJobStatus" | "transcript" | "analysisErrorMessage" | "transcriptErrorMessage">): CreativePipelineStatus {
  if (card.analysisStatus === "missing_media" || card.transcriptStatus === "missing_media" || card.mediaType === "unknown") {
    return "missing_media";
  }
  if (card.transcriptStatus === "oversized_queued") return "oversized_queued";
  if ((card.activeJobStatus === "queued" || card.activeJobStatus === "running") && card.mediaType === "video" && card.transcriptStatus !== "ready") return "transcribing";
  if ((card.activeJobStatus === "queued" || card.activeJobStatus === "running") && (card.transcriptStatus === "ready" || card.transcriptStatus === "not_applicable" || card.mediaType === "image")) return "analyzing";
  if (card.mediaType === "video" && card.transcriptStatus === "failed" && !card.transcript) return "missing_transcript";
  if (card.analysisStatus === "failed" || card.analysisCoverage === "failed") return "failed";
  if (card.analysisStatus === "ready" && (card.analysisCoverage === "full" || card.analysisCoverage === "not_applicable")) return "ready";
  if (card.analysisStatus === "ready") return "ready";
  return "pending";
}

export function labelForMediaType(mediaType: CreativeMediaType) {
  if (mediaType === "video") return "Vídeo";
  if (mediaType === "image") return "Imagem";
  return "Criativo";
}

export function labelForAnalysisStatus(status: CreativeAnalysisStatus) {
  switch (status) {
    case "ready":
      return "Pronto";
    case "processing":
      return "Processando";
    case "failed":
      return "Falhou";
    case "missing_media":
      return "Sem mídia";
    default:
      return "Pendente";
  }
}

export function labelForPipelineStatus(status: CreativePipelineStatus) {
  switch (status) {
    case "transcribing":
      return "Transcrevendo";
    case "analyzing":
      return "Analisando";
    case "ready":
      return "Pronto";
    case "missing_media":
      return "Sem mídia";
    case "missing_transcript":
      return "Sem transcript";
    case "oversized_queued":
      return "Vídeo grande em fila";
    case "failed":
      return "Falhou";
    default:
      return "Pendente";
  }
}

function aggregateMetrics(metrics: CreativeAssetMetricRow[]) {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let outboundClicks = 0;
  let purchases = 0;
  let revenue = 0;
  let refunds = 0;
  let refundValue = 0;
  let orderBumpPurchases = 0;
  let orderBumpRevenue = 0;
  let upsellPurchases = 0;
  let upsellRevenue = 0;
  let hookWeight = 0;
  let hookWeightedSum = 0;
  let hasMetaData = false;
  let hasGatewayData = false;

  for (const row of metrics) {
    const rowSpend = numberOrZero(row.spend);
    const rowImpressions = numberOrZero(row.impressions);
    const rowClicks = numberOrZero(row.clicks);
    const rowOutboundClicks = numberOrZero(row.outbound_clicks);
    const rowLinkClicks = rowOutboundClicks || rowClicks;
    const rowPurchases = numberOrZero(row.purchases);
    const rowRevenue = numberOrZero(row.revenue);
    const rowRefunds = numberOrZero(row.refunds);
    // Refund providers differ on sign; cards always display the refunded
    // amount as a positive loss value.
    const rowRefundValue = Math.abs(numberOrZero(row.refund_value));
    const rowHookRate = parseNumber(row.hook_rate);

    spend += rowSpend;
    impressions += rowImpressions;
    clicks += rowLinkClicks;
    outboundClicks += rowOutboundClicks;
    purchases += rowPurchases;
    revenue += rowRevenue;
    refunds += rowRefunds;
    refundValue += rowRefundValue;
    orderBumpPurchases += numberOrZero(row.order_bump_purchases);
    orderBumpRevenue += numberOrZero(row.order_bump_revenue);
    upsellPurchases += numberOrZero(row.upsell_purchases);
    upsellRevenue += numberOrZero(row.upsell_revenue);
    hasMetaData ||= Boolean(row.has_meta_data);
    hasGatewayData ||= Boolean(row.has_gateway_data);

    if (rowHookRate != null) {
      const weight = rowImpressions > 0 ? rowImpressions : 1;
      hookWeight += weight;
      hookWeightedSum += rowHookRate * weight;
    }
  }

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  const linkCtr = impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpm = impressions > 0 && spend > 0 ? (spend / impressions) * 1000 : null;
  const roas = spend > 0 && revenue > 0 ? revenue / spend : null;
  const cpa = spend > 0 && purchases > 0 ? spend / purchases : null;
  const refundRate = purchases > 0 ? (refunds / purchases) * 100 : null;
  const aov = purchases > 0 ? revenue / purchases : null;
  const hookRate = hookWeight > 0 ? hookWeightedSum / hookWeight : null;

  return {
    spend,
    impressions,
    clicks,
    outboundClicks,
    purchases,
    revenue,
    refunds,
    refundValue,
    refundRate,
    orderBumpPurchases,
    orderBumpRevenue,
    upsellPurchases,
    upsellRevenue,
    aov,
    ctr,
    linkCtr,
    cpm,
    roas,
    cpa,
    hookRate,
    hasMetaData,
    hasGatewayData,
  };
}

function facebookUrlFallback(value: string | null) {
  return value && /(?:facebook|fb)\.com/i.test(value) ? value : null;
}

function instagramUrlFallback(value: string | null) {
  return value && /instagram\.com/i.test(value) ? value : null;
}

function valueForCreativeSort(card: CreativeAssetCard, sortKey: CreativeSortKey) {
  switch (sortKey) {
    case "spend":
      return card.spend;
    case "roas":
      return card.roas ?? -1;
    case "hook_rate":
      return card.hookRate ?? -1;
    case "ctr":
      return card.ctr ?? -1;
    case "cpm":
      return card.cpm != null ? -card.cpm : -Infinity;
    case "purchases":
    default:
      return card.purchases;
  }
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function normalizeTagList(value: unknown) {
  if (Array.isArray(value)) {
    return unique(value.map((entry) => parseString(entry)).filter(Boolean) as string[]);
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const tags = Object.values(objectValue)
      .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .map((entry) => parseString(entry))
      .filter(Boolean) as string[];
    return unique(tags);
  }
  return [];
}

function normalizeScoreMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const scores: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const parsed = parseNumber(rawValue);
    if (parsed == null) continue;
    scores[key] = parsed;
    const normalizedKey = normalizeScoreKey(key);
    if (normalizedKey && scores[normalizedKey] == null) {
      scores[normalizedKey] = parsed;
    }
  }
  return scores;
}

function normalizeScoreKey(key: string) {
  const normalized = key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized === "hook" || normalized === "hook_score" || normalized === "hookscore" || normalized === "score_hook" || normalized === "scorehook") return "hook";
  if (
    normalized === "clareza" ||
    normalized === "clareza_score" ||
    normalized === "clarezascore" ||
    normalized === "clarity" ||
    normalized === "clarity_score" ||
    normalized === "clarityscore" ||
    normalized === "clareza_da_copy" ||
    normalized === "clarezadacopy" ||
    normalized === "copy_clarity" ||
    normalized === "copyclarity"
  ) {
    return "clareza";
  }
  if (
    normalized === "escala" ||
    normalized === "escala_score" ||
    normalized === "escalascore" ||
    normalized === "scale" ||
    normalized === "scale_score" ||
    normalized === "scalescore" ||
    normalized === "potencial_escala" ||
    normalized === "potencialescala" ||
    normalized === "potencial_de_escala" ||
    normalized === "potencialdeescala" ||
    normalized === "scalability"
  ) {
    return "potencial_de_escala";
  }
  return null;
}

function normalizeTranscriptSegments(value: unknown): CreativeTranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const startMs = parseNumber(item.start_ms);
      const endMs = parseNumber(item.end_ms);
      const text = parseString(item.text);
      if (startMs == null || endMs == null || !text) return null;
      return {
        start_ms: Math.round(startMs),
        end_ms: Math.max(Math.round(startMs), Math.round(endMs)),
        text,
      };
    })
    .filter(Boolean) as CreativeTranscriptSegment[];
}

function normalizeHookTimestamps(value: unknown): CreativeHookTimestamp[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const startMs = parseNumber(item.start_ms);
      const endMs = parseNumber(item.end_ms);
      const label = parseString(item.label);
      const reason = parseString(item.reason);
      if (startMs == null || endMs == null || !label || !reason) return null;
      return {
        start_ms: Math.round(startMs),
        end_ms: Math.max(Math.round(startMs), Math.round(endMs)),
        label,
        reason,
      };
    })
    .filter(Boolean) as CreativeHookTimestamp[];
}

function normalizeVisualEvidence(value: unknown): CreativeVisualEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const item = entry as Record<string, unknown>;
      const timestampMs = parseNumber(item.timestamp_ms);
      const observation = parseString(item.observation);
      if (timestampMs == null || !observation) return null;
      return {
        timestamp_ms: Math.round(timestampMs),
        observation,
      };
    })
    .filter(Boolean) as CreativeVisualEvidence[];
}

function normalizeAnalysisStatus(value: unknown): CreativeAnalysisStatus {
  return value === "processing" || value === "ready" || value === "failed" || value === "missing_media" ? value : "pending";
}

function normalizeTranscriptStatus(value: unknown, mediaType: CreativeMediaType): CreativeTranscriptStatus {
  if (value === "processing" || value === "ready" || value === "failed" || value === "missing_media" || value === "oversized_queued") return value;
  if (value === "not_applicable" || mediaType === "image") return "not_applicable";
  return "pending";
}

function normalizeAnalysisCoverage(value: unknown, mediaType: CreativeMediaType): CreativeAnalysisCoverage {
  if (value === "full" || value === "partial" || value === "failed" || value === "not_applicable") return value;
  return mediaType === "image" ? "not_applicable" : "pending";
}

function matchesAny(values: string[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value.toLowerCase().includes(normalizedQuery));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function numberOrZero(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function isMediaType(value: unknown): value is CreativeMediaType {
  return value === "video" || value === "image" || value === "unknown";
}

function isAnalysisStatus(value: unknown): value is CreativeAnalysisStatus {
  return value === "pending" || value === "processing" || value === "ready" || value === "failed" || value === "missing_media";
}

function isTranscriptStatus(value: unknown): value is CreativeTranscriptStatus {
  return value === "pending" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed" ||
    value === "not_applicable" ||
    value === "missing_media" ||
    value === "oversized_queued";
}

function isAnalysisCoverage(value: unknown): value is CreativeAnalysisCoverage {
  return value === "pending" || value === "full" || value === "partial" || value === "failed" || value === "not_applicable";
}

function isPipelineStatus(value: unknown): value is CreativePipelineStatus {
  return value === "pending" ||
    value === "transcribing" ||
    value === "analyzing" ||
    value === "ready" ||
    value === "failed" ||
    value === "missing_media" ||
    value === "missing_transcript" ||
    value === "oversized_queued";
}

function isCreativeSortKey(value: unknown): value is CreativeSortKey {
  return value === "purchases" || value === "roas" || value === "hook_rate" || value === "ctr" || value === "cpm" || value === "spend";
}

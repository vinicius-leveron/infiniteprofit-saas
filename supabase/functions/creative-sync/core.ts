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

export interface RawMetaPayload {
  ad_id?: string;
  ad_name?: string;
  creative_id?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  ctr?: string | number;
  cpm?: string | number;
  outbound_clicks?: Array<{ action_type?: string; value?: string | number }> | number | string;
  actions?: Array<{ action_type?: string; value?: string | number }>;
  video_play_actions?: Array<{ action_type?: string; value?: string | number }>;
  video_p25_watched_actions?: Array<{ action_type?: string; value?: string | number }>;
  video_thruplay_watched_actions?: Array<{ action_type?: string; value?: string | number }>;
}

export interface RawGatewayPayload {
  utm_content?: string;
  total?: number | string | null;
  net?: number | string | null;
}

export interface MetaAdCreativeRecord {
  id?: string;
  name?: string;
  body?: string;
  title?: string;
  image_url?: string;
  thumbnail_url?: string;
  link_url?: string;
  object_type?: string;
  call_to_action_type?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  permalink_url?: string;
  object_story_spec?: Record<string, unknown> | null;
}

export interface MetaAdDetailsRecord {
  id?: string;
  name?: string;
  created_time?: string;
  creative?: MetaAdCreativeRecord | null;
}

export interface DerivedCreativeAsset {
  creativeId: string;
  assetKey: string;
  mediaType: CreativeMediaType;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  headline: string | null;
  primaryText: string | null;
  cta: string | null;
  landingUrl: string | null;
  postUrl: string | null;
  videoId: string | null;
}

export interface CreativeMetricInputRow {
  event_date: string;
  payload: RawMetaPayload | null;
}

export interface CreativeGatewayInputRow {
  event_date: string;
  event_type: string;
  payload: RawGatewayPayload | null;
}

export interface CreativeMetricUpsertRow {
  asset_id: string;
  event_date: string;
  spend: number;
  impressions: number;
  clicks: number;
  outbound_clicks: number;
  ctr: number | null;
  link_ctr: number | null;
  cpm: number | null;
  purchases: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  has_meta_data: boolean;
  has_gateway_data: boolean;
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

export interface CreativeAnalysisResult {
  status: CreativeAnalysisStatus;
  transcriptStatus: CreativeTranscriptStatus;
  transcript: string | null;
  transcriptSegments: CreativeTranscriptSegment[];
  transcriptLanguage: string | null;
  transcriptProvider: string | null;
  transcriptModel: string | null;
  transcriptErrorMessage: string | null;
  summary: string | null;
  hook: string | null;
  hookTimestamps: CreativeHookTimestamp[];
  angle: string | null;
  copy: string | null;
  cta: string | null;
  visual: string | null;
  visualEvidence: CreativeVisualEvidence[];
  tags: string[];
  scores: Record<string, number>;
  analysisCoverage: CreativeAnalysisCoverage;
  analysisErrorMessage: string | null;
  errorMessage: string | null;
}

export function deriveCreativeAsset(record: MetaAdDetailsRecord): DerivedCreativeAsset {
  const creative = record.creative ?? {};
  const spec = asObject(creative.object_story_spec);
  const videoData = asObject(spec.video_data);
  const linkData = asObject(spec.link_data);
  const photoData = asObject(spec.photo_data);

  const videoId = stringOrNull(videoData.video_id) ?? stringOrNull(spec.video_id);
  const headline =
    stringOrNull(creative.title) ??
    stringOrNull(linkData.name) ??
    stringOrNull(videoData.title) ??
    stringOrNull(photoData.caption) ??
    null;
  const primaryText =
    stringOrNull(creative.body) ??
    stringOrNull(linkData.message) ??
    stringOrNull(videoData.message) ??
    stringOrNull(photoData.message) ??
    null;
  const cta =
    stringOrNull(creative.call_to_action_type) ??
    stringOrNull(asObject(videoData.call_to_action).type) ??
    stringOrNull(asObject(linkData.call_to_action).type) ??
    null;
  const landingUrl =
    stringOrNull(creative.link_url) ??
    stringOrNull(asObject(asObject(videoData.call_to_action).value).link) ??
    stringOrNull(asObject(asObject(linkData.call_to_action).value).link) ??
    stringOrNull(linkData.link) ??
    null;
  const storyId =
    stringOrNull(creative.effective_object_story_id) ??
    stringOrNull(creative.object_story_id) ??
    null;
  const postUrl =
    stringOrNull(creative.instagram_permalink_url) ??
    stringOrNull(creative.permalink_url) ??
    buildFacebookPostUrl(storyId);
  const imageUrl =
    stringOrNull(creative.image_url) ??
    stringOrNull(linkData.picture) ??
    stringOrNull(photoData.url) ??
    null;
  const thumbnailUrl =
    stringOrNull(creative.thumbnail_url) ??
    imageUrl ??
    null;

  const mediaType: CreativeMediaType =
    videoId || /video/i.test(String(creative.object_type ?? ""))
      ? "video"
      : imageUrl || thumbnailUrl
        ? "image"
        : "unknown";
  const creativeId =
    stringOrNull(creative.id) ??
    stringOrNull((record as Record<string, unknown>).creative_id) ??
    stringOrNull(record.id) ??
    "unknown";
  const assetKey = deriveAssetKey({
    mediaType,
    creativeId,
    videoId,
    imageUrl,
    thumbnailUrl,
    landingUrl,
  });

  return {
    creativeId,
    assetKey,
    mediaType,
    thumbnailUrl,
    mediaUrl: mediaType === "image" ? imageUrl ?? thumbnailUrl : null,
    headline,
    primaryText,
    cta,
    landingUrl,
    postUrl,
    videoId,
  };
}

export function buildCreativeDailyMetrics(args: {
  metaRows: CreativeMetricInputRow[];
  gatewayRows: CreativeGatewayInputRow[];
  assetIdByAdId: Map<string, string>;
  mediaTypeByAssetId: Map<string, CreativeMediaType>;
}) {
  const aggregate = new Map<string, CreativeMetricAccumulator>();

  for (const row of args.metaRows) {
    const payload = row.payload ?? {};
    const adId = stringOrNull(payload.ad_id);
    if (!adId) continue;
    const assetId = args.assetIdByAdId.get(adId);
    if (!assetId) continue;

    const key = `${assetId}:${row.event_date}`;
    const target = aggregate.get(key) ?? createAccumulator(assetId, row.event_date);
    const spend = numberOrZero(payload.spend);
    const impressions = numberOrZero(payload.impressions);
    const clicks = numberOrZero(payload.clicks);
    const outboundClicks = readOutboundClicks(payload);
    const mediaType = args.mediaTypeByAssetId.get(assetId) ?? "unknown";
    const hookCount = mediaType === "video" ? readVideoAttentionCount(payload) : outboundClicks || clicks;

    target.spend += spend;
    target.impressions += impressions;
    target.clicks += clicks;
    target.outbound_clicks += outboundClicks;
    target.has_meta_data = target.has_meta_data || spend > 0 || impressions > 0 || clicks > 0;
    if (hookCount > 0) {
      target.hook_numerator += hookCount;
      target.hook_denominator += impressions > 0 ? impressions : clicks || 1;
    }
    aggregate.set(key, target);
  }

  for (const row of args.gatewayRows) {
    if (row.event_type !== "purchase.approved") continue;
    const payload = row.payload ?? {};
    const adId = resolveGatewayAdId(payload, args.assetIdByAdId);
    if (!adId) continue;
    const assetId = args.assetIdByAdId.get(adId);
    if (!assetId) continue;

    const key = `${assetId}:${row.event_date}`;
    const target = aggregate.get(key) ?? createAccumulator(assetId, row.event_date);
    target.purchases += 1;
    target.revenue += numberOrZero(payload.total) || numberOrZero(payload.net);
    target.has_gateway_data = true;
    aggregate.set(key, target);
  }

  return [...aggregate.values()].map((row) => finalizeAccumulator(row));
}

function resolveGatewayAdId(payload: RawGatewayPayload, assetIdByAdId: Map<string, string>) {
  const candidates = [
    payload.utm_content,
    (payload as Record<string, unknown>).ad_id,
    (payload as Record<string, unknown>).fb_ad_id,
    (payload as Record<string, unknown>).facebook_ad_id,
  ].map((value) => stringOrNull(value));
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (assetIdByAdId.has(candidate)) return candidate;
    for (const adId of assetIdByAdId.keys()) {
      if (candidate.includes(adId)) return adId;
    }
  }
  return null;
}

export function normalizeCreativeAnalysisResult(payload: unknown): CreativeAnalysisResult {
  const objectValue = asObject(payload);
  const transcriptStatus = normalizeTranscriptStatus(objectValue.transcriptStatus ?? objectValue.transcript_status);
  const analysisCoverage = normalizeAnalysisCoverage(objectValue.analysisCoverage ?? objectValue.analysis_coverage);

  return {
    status: normalizeAnalysisStatus(objectValue.status),
    transcriptStatus,
    transcript: stringOrNull(objectValue.transcript),
    transcriptSegments: normalizeTranscriptSegments(objectValue.transcriptSegments ?? objectValue.transcript_segments),
    transcriptLanguage: stringOrNull(objectValue.transcriptLanguage ?? objectValue.transcript_language),
    transcriptProvider: stringOrNull(objectValue.transcriptProvider ?? objectValue.transcript_provider),
    transcriptModel: stringOrNull(objectValue.transcriptModel ?? objectValue.transcript_model),
    transcriptErrorMessage: stringOrNull(objectValue.transcriptErrorMessage ?? objectValue.transcript_error_message),
    summary: stringOrNull(objectValue.summary),
    hook: stringOrNull(objectValue.hook),
    hookTimestamps: normalizeHookTimestamps(objectValue.hookTimestamps ?? objectValue.hook_timestamps),
    angle: stringOrNull(objectValue.angle),
    copy: stringOrNull(objectValue.copy),
    cta: stringOrNull(objectValue.cta),
    visual: stringOrNull(objectValue.visual),
    visualEvidence: normalizeVisualEvidence(objectValue.visualEvidence ?? objectValue.visual_evidence),
    tags: normalizeTagList(objectValue.tags),
    scores: normalizeScoreMap(objectValue.scores),
    analysisCoverage,
    analysisErrorMessage: stringOrNull(objectValue.analysisErrorMessage ?? objectValue.analysis_error_message),
    errorMessage: stringOrNull(objectValue.errorMessage ?? objectValue.error_message),
  };
}

export function buildCreativeAnalysisFallback(args: {
  mediaType: CreativeMediaType;
  transcript?: string | null;
  transcriptStatus?: CreativeTranscriptStatus;
  transcriptSegments?: CreativeTranscriptSegment[];
  transcriptLanguage?: string | null;
  transcriptProvider?: string | null;
  transcriptModel?: string | null;
  primaryText?: string | null;
  headline?: string | null;
  cta?: string | null;
  summary?: string | null;
  analysisCoverage?: CreativeAnalysisCoverage;
  analysisStatus?: CreativeAnalysisStatus;
  transcriptErrorMessage?: string | null;
  analysisErrorMessage?: string | null;
  errorMessage?: string | null;
}): CreativeAnalysisResult {
  const transcriptStatus =
    args.transcriptStatus ??
    (args.mediaType === "image" ? "not_applicable" : args.mediaType === "unknown" ? "missing_media" : "pending");
  const summary =
    args.summary ??
    ([args.headline, args.primaryText].filter(Boolean).join(" — ") || "Criativo aguardando processamento.");
  const status =
    args.analysisStatus ??
    (args.mediaType === "unknown"
      ? "missing_media"
      : args.analysisErrorMessage || args.errorMessage || args.transcriptErrorMessage
        ? "failed"
        : transcriptStatus === "ready" || transcriptStatus === "not_applicable"
          ? "processing"
          : "pending");
  const analysisCoverage =
    args.analysisCoverage ??
    (args.mediaType === "image" ? "pending" : transcriptStatus === "ready" ? "partial" : "pending");

  return {
    status,
    transcriptStatus,
    transcript: args.transcript ?? null,
    transcriptSegments: args.transcriptSegments ?? [],
    transcriptLanguage: args.transcriptLanguage ?? null,
    transcriptProvider: args.transcriptProvider ?? null,
    transcriptModel: args.transcriptModel ?? null,
    transcriptErrorMessage: args.transcriptErrorMessage ?? null,
    summary,
    hook: args.headline ?? null,
    hookTimestamps: [],
    angle: args.primaryText ?? null,
    copy: args.primaryText ?? null,
    cta: args.cta ?? null,
    visual: args.mediaType === "image" ? "Criativo estático" : args.mediaType === "video" ? "Vídeo" : null,
    visualEvidence: [],
    tags: normalizeTagList([args.mediaType, args.cta]),
    scores: {},
    analysisCoverage,
    analysisErrorMessage: args.analysisErrorMessage ?? null,
    errorMessage: args.errorMessage ?? args.analysisErrorMessage ?? args.transcriptErrorMessage ?? null,
  };
}

export async function buildCreativeInputFingerprint(parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? "")).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function deriveAssetKey(args: {
  mediaType: CreativeMediaType;
  creativeId: string;
  videoId: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  landingUrl: string | null;
}) {
  if (args.videoId) return `video:${args.videoId}`;
  if (args.imageUrl) return `image:${stripQuery(args.imageUrl)}`;
  if (args.thumbnailUrl) return `thumb:${stripQuery(args.thumbnailUrl)}`;
  if (args.landingUrl) return `${args.mediaType}:${stripQuery(args.landingUrl)}`;
  return `${args.mediaType}:${args.creativeId}`;
}

function readOutboundClicks(payload: RawMetaPayload) {
  const direct = actionValueFromUnknown(payload.outbound_clicks, ["outbound_click"]);
  if (direct > 0) return direct;
  return actionValueFromUnknown(payload.actions, ["outbound_click", "link_click"]);
}

function readVideoAttentionCount(payload: RawMetaPayload) {
  const p25 = actionValueFromUnknown(payload.video_p25_watched_actions, ["video_p25_watched_actions", "video_view"]);
  if (p25 > 0) return p25;
  const play = actionValueFromUnknown(payload.video_play_actions, ["video_play"]);
  if (play > 0) return play;
  const thruplay = actionValueFromUnknown(payload.video_thruplay_watched_actions, ["video_thruplay_watched_actions", "thruplay"]);
  if (thruplay > 0) return thruplay;
  return actionValueFromUnknown(payload.actions, [
    "video_view",
    "video_play",
    "video_p25_watched_actions",
    "thruplay",
    "outbound_click",
    "link_click",
  ]);
}

function actionValueFromUnknown(
  value: Array<{ action_type?: string; value?: string | number }> | number | string | undefined,
  actionTypes: string[],
) {
  if (typeof value === "number" || typeof value === "string") {
    return numberOrZero(value);
  }
  if (!Array.isArray(value)) return 0;
  const normalizedTypes = actionTypes.map((entry) => entry.toLowerCase());
  return value.reduce((sum, entry) => {
    const actionType = String(entry.action_type ?? "").toLowerCase();
    if (!normalizedTypes.includes(actionType)) return sum;
    return sum + numberOrZero(entry.value);
  }, 0);
}

function finalizeAccumulator(row: CreativeMetricAccumulator): CreativeMetricUpsertRow {
  const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null;
  const linkCtr = row.impressions > 0 && row.outbound_clicks > 0 ? (row.outbound_clicks / row.impressions) * 100 : null;
  const cpm = row.impressions > 0 && row.spend > 0 ? (row.spend / row.impressions) * 1000 : null;
  const roas = row.spend > 0 && row.revenue > 0 ? row.revenue / row.spend : null;
  const cpa = row.spend > 0 && row.purchases > 0 ? row.spend / row.purchases : null;
  const hookRate =
    row.hook_denominator > 0
      ? (row.hook_numerator / row.hook_denominator) * 100
      : linkCtr ?? ctr;

  return {
    asset_id: row.asset_id,
    event_date: row.event_date,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    outbound_clicks: row.outbound_clicks,
    ctr,
    link_ctr: linkCtr,
    cpm,
    purchases: row.purchases,
    revenue: row.revenue,
    roas,
    cpa,
    hook_rate: hookRate,
    has_meta_data: row.has_meta_data,
    has_gateway_data: row.has_gateway_data,
  };
}

function createAccumulator(assetId: string, eventDate: string): CreativeMetricAccumulator {
  return {
    asset_id: assetId,
    event_date: eventDate,
    spend: 0,
    impressions: 0,
    clicks: 0,
    outbound_clicks: 0,
    purchases: 0,
    revenue: 0,
    hook_numerator: 0,
    hook_denominator: 0,
    has_meta_data: false,
    has_gateway_data: false,
  };
}

function normalizeAnalysisStatus(value: unknown): CreativeAnalysisStatus {
  return value === "processing" || value === "ready" || value === "failed" || value === "missing_media"
    ? value
    : "pending";
}

function normalizeTranscriptStatus(value: unknown): CreativeTranscriptStatus {
  return value === "processing" ||
      value === "ready" ||
      value === "failed" ||
      value === "not_applicable" ||
      value === "missing_media" ||
      value === "oversized_queued"
    ? value
    : "pending";
}

function normalizeAnalysisCoverage(value: unknown): CreativeAnalysisCoverage {
  return value === "full" || value === "partial" || value === "failed" || value === "not_applicable"
    ? value
    : "pending";
}

function normalizeTagList(value: unknown) {
  if (Array.isArray(value)) {
    return unique(value.map((entry) => stringOrNull(entry)).filter(Boolean) as string[]);
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const tags = Object.values(objectValue)
      .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .map((entry) => stringOrNull(entry))
      .filter(Boolean) as string[];
    return unique(tags);
  }
  return [];
}

function normalizeScoreMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, rawValue]) => [key, parseNumber(rawValue)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] != null);
  return Object.fromEntries(entries);
}

function normalizeTranscriptSegments(value: unknown): CreativeTranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  const segments: CreativeTranscriptSegment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const segment = entry as Record<string, unknown>;
    const text = stringOrNull(segment.text);
    const startMs = parseNumber(segment.start_ms ?? segment.startMs ?? secondsToMs(segment.start));
    const endMs = parseNumber(segment.end_ms ?? segment.endMs ?? secondsToMs(segment.end));
    if (!text || startMs == null || endMs == null) continue;
    segments.push({
      start_ms: Math.max(0, Math.round(startMs)),
      end_ms: Math.max(Math.round(startMs), Math.round(endMs)),
      text,
    });
  }
  return segments;
}

function normalizeHookTimestamps(value: unknown): CreativeHookTimestamp[] {
  if (!Array.isArray(value)) return [];
  const timestamps: CreativeHookTimestamp[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const label = stringOrNull(item.label);
    const reason = stringOrNull(item.reason);
    const startMs = parseNumber(item.start_ms ?? item.startMs ?? secondsToMs(item.start));
    const endMs = parseNumber(item.end_ms ?? item.endMs ?? secondsToMs(item.end));
    if (!label || !reason || startMs == null || endMs == null) continue;
    timestamps.push({
      start_ms: Math.max(0, Math.round(startMs)),
      end_ms: Math.max(Math.round(startMs), Math.round(endMs)),
      label,
      reason,
    });
  }
  return timestamps;
}

function normalizeVisualEvidence(value: unknown): CreativeVisualEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: CreativeVisualEvidence[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const observation = stringOrNull(item.observation);
    const timestampMs = parseNumber(item.timestamp_ms ?? item.timestampMs ?? secondsToMs(item.timestamp));
    if (!observation || timestampMs == null) continue;
    evidence.push({
      timestamp_ms: Math.max(0, Math.round(timestampMs)),
      observation,
    });
  }
  return evidence;
}

function secondsToMs(value: unknown) {
  const seconds = parseNumber(value);
  return seconds == null ? null : seconds * 1000;
}

function stripQuery(value: string) {
  return value.split("?")[0] ?? value;
}

function buildFacebookPostUrl(storyId: string | null) {
  if (!storyId) return null;
  if (/^https?:\/\//i.test(storyId)) return storyId;
  const match = /^(\d+)_(\d+)$/.exec(storyId);
  if (match) return `https://www.facebook.com/${match[1]}/posts/${match[2]}`;
  return `https://www.facebook.com/${storyId}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function numberOrZero(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type CreativeMetricAccumulator = {
  asset_id: string;
  event_date: string;
  spend: number;
  impressions: number;
  clicks: number;
  outbound_clicks: number;
  purchases: number;
  revenue: number;
  hook_numerator: number;
  hook_denominator: number;
  has_meta_data: boolean;
  has_gateway_data: boolean;
};

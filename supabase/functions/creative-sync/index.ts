/* eslint-disable @typescript-eslint/no-explicit-any */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildAutomationHeaders, isAutomationRequest } from "../_shared/automation.ts";
import {
  buildCreativeAnalysisFallback,
  buildCreativeDailyMetrics,
  buildCreativeInputFingerprint,
  deriveCreativeAsset,
  type CreativeAnalysisCoverage,
  type CreativeAnalysisStatus,
  type CreativeGatewayInputRow,
  type CreativeMediaType,
  type CreativeMetricInputRow,
  type CreativeTranscriptStatus,
  type MetaAdDetailsRecord,
  type RawGatewayPayload,
  type RawMetaPayload,
} from "./core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CREATIVE_BUCKET = "creative-assets";
const CREATIVE_RUNNING_SYNC_TIMEOUT_MS = 30 * 60 * 1000;
const ANALYSIS_PROVIDER = Deno.env.get("CREATIVE_ANALYSIS_PROVIDER")?.trim() || "lovable";
const ANALYSIS_MODEL = Deno.env.get("CREATIVE_ANALYSIS_MODEL")?.trim() || "google/gemini-3-flash-preview";
const TRANSCRIPTION_PROVIDER = Deno.env.get("CREATIVE_TRANSCRIPTION_PROVIDER")?.trim() || "openai";
const TRANSCRIPTION_MODEL = Deno.env.get("CREATIVE_TRANSCRIPTION_MODEL")?.trim() || "gpt-4o-mini-transcribe";
const PROMPT_VERSION = Deno.env.get("CREATIVE_ANALYSIS_PROMPT_VERSION")?.trim() || "creative-sync-v2";
const PROCESSING_VERSION =
  `${TRANSCRIPTION_PROVIDER}:${TRANSCRIPTION_MODEL}|${ANALYSIS_PROVIDER}:${ANALYSIS_MODEL}|${PROMPT_VERSION}`;

type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string };

type ReprocessScope = "all" | "media" | "transcript" | "analysis";

type ProjectContext = {
  id: string;
  user_id: string;
  workspace_id: string;
  source: string | null;
};

type MetaAccountBinding = {
  id: string;
  account_id: string;
  access_token: string;
  label: string | null;
};

type RawMetaEventRow = {
  event_date: string;
  account_id: string | null;
  payload: RawMetaPayload | null;
};

type RawGatewayEventRow = {
  event_date: string;
  event_type: string;
  payload: RawGatewayPayload | null;
};

type ExistingAssetRow = {
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
  analysis_status: CreativeAnalysisStatus;
  source_media_url: string | null;
  source_fetched_at: string | null;
  media_bytes: number | null;
  media_duration_ms: number | null;
  media_fingerprint: string | null;
  poster_storage_path: string | null;
  last_processed_at: string | null;
  processing_version: string | null;
};

type AssetUpsertPayload = {
  project_id: string;
  workspace_id: string;
  user_id: string;
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
  analysis_status: CreativeAnalysisStatus;
  last_meta_synced_at: string;
  source_media_url: string | null;
  source_fetched_at: string | null;
  media_bytes: number | null;
  media_duration_ms: number | null;
  media_fingerprint: string | null;
  poster_storage_path: string | null;
  last_processed_at: string | null;
  processing_version: string | null;
};

type UpsertedAssetRow = ExistingAssetRow;

type ExistingAnalysisRow = {
  asset_id: string;
  status: CreativeAnalysisStatus;
  transcript: string | null;
  transcript_status: CreativeTranscriptStatus;
  transcript_segments: unknown;
  transcript_language: string | null;
  transcript_provider: string | null;
  transcript_model: string | null;
  summary: string | null;
  hook: string | null;
  angle: string | null;
  copy: string | null;
  cta: string | null;
  visual: string | null;
  tags: unknown;
  scores: unknown;
  hook_timestamps: unknown;
  visual_evidence: unknown;
  analysis_coverage: CreativeAnalysisCoverage;
  error_message: string | null;
  transcript_error_message: string | null;
  analysis_error_message: string | null;
  model: string | null;
  prompt_version: string | null;
  processed_at: string | null;
};

type ExistingJobRow = {
  id: string;
  asset_id: string;
  input_fingerprint: string;
  status: "queued" | "running" | "succeeded" | "failed";
};

type AdResolution = {
  detailsByAdId: Map<string, MetaAdDetailsRecord>;
  bindingByAdId: Map<string, MetaAccountBinding>;
};

type AssetCandidate = {
  derived: ReturnType<typeof deriveCreativeAsset>;
  details: MetaAdDetailsRecord;
  binding: MetaAccountBinding | null;
  latestEventDate: string;
};

type ResolvedMediaReference = {
  sourceMediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaDurationMs: number | null;
};

type CreativeJobPayload = {
  asset_id: string;
  project_id: string;
  workspace_id: string;
  user_id: string;
  creative_id: string;
  asset_key: string;
  media_type: CreativeMediaType;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  landing_url: string | null;
  post_url: string | null;
  thumbnail_url: string | null;
  source_media_url: string | null;
  media_storage_path: string | null;
  poster_storage_path: string | null;
  media_duration_ms: number | null;
  media_fingerprint: string | null;
  processing_version: string;
  analysis_provider: string;
  analysis_model: string;
  transcription_provider: string;
  transcription_model: string;
  prompt_version: string;
  analysis_mode: "video_keyframes" | "image";
  reprocess_scope: ReprocessScope;
  meta_account_binding_id: string | null;
  meta_account_id: string | null;
  video_id: string | null;
  job_trigger: "manual" | "auto";
};

type JobHint = {
  metaAccountBindingId: string | null;
  metaAccountId: string | null;
  videoId: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const caller = await resolveCaller(req);
    if (!caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetProjectId = stringOrNull(body.project_id);
    const targetAccountId = normalizeMetaAccountId(stringOrNull(body.account_id));
    const targetAssetId = stringOrNull(body.asset_id);
    const reprocess = Boolean(body.reprocess);
    const reprocessScope = normalizeReprocessScope(body.reprocess_scope);
    const enqueueAnalysis =
      Boolean(body.enqueue_analysis) ||
      Boolean(body.run_analysis) ||
      Boolean(targetAssetId && reprocess && (reprocessScope === "analysis" || reprocessScope === "transcript"));
    const days = Math.min(Math.max(Number(body.days) || 30, 1), 90);

    if (caller.kind === "user" && !targetProjectId) {
      return json({ error: "project_id é obrigatório para sync manual" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    await failStaleRunningSyncRuns(sb);
    const projects = targetProjectId
      ? [await getProjectOrThrow(sb, targetProjectId)]
      : await loadSchedulableProjects(sb);

    const results: Array<Record<string, unknown>> = [];

    for (const project of projects) {
      if (caller.kind === "user") {
        await assertWorkspaceAdmin(sb, project.workspace_id, caller.userId);
      }

      const activeRun = await findActiveSyncRun(sb, project.id);
      if (activeRun) {
        results.push({
          project_id: project.id,
          skipped: `Sync de criativos já em andamento desde ${activeRun.started_at}`,
        });
        continue;
      }

      const runId = await createSyncRun(sb, {
        workspaceId: project.workspace_id,
        projectId: project.id,
        source: "creative",
        initiatedBy: caller.kind === "user" ? caller.userId : null,
        details: {
          days,
          account_filter: targetAccountId,
          reprocess,
          reprocess_scope: reprocessScope,
          asset_id: targetAssetId,
          enqueue_analysis: enqueueAnalysis,
        },
      });

      try {
        const quickReprocess =
          targetAssetId &&
          (reprocessScope === "analysis" || reprocessScope === "transcript") &&
          !targetAccountId;

        const result = quickReprocess
          ? await requeueExistingAsset(sb, {
            project,
            assetId: targetAssetId,
            reprocessScope,
          })
          : await syncProjectAssets(sb, {
            project,
            days,
            targetAccountId,
            targetAssetId,
            reprocess,
            reprocessScope,
            enqueueAnalysis,
          });

        results.push(result);

        await finishSyncRun(sb, runId, {
          status: "succeeded",
          details: {
            days,
            account_filter: targetAccountId,
            reprocess,
            reprocess_scope: reprocessScope,
            asset_id: targetAssetId,
            enqueue_analysis: enqueueAnalysis,
            result,
          },
          errorMessage: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro ao sincronizar criativos";
        results.push({ project_id: project.id, error: message });
        await finishSyncRun(sb, runId, {
          status: "failed",
          details: {
            days,
            account_filter: targetAccountId,
            reprocess,
            reprocess_scope: reprocessScope,
            asset_id: targetAssetId,
            enqueue_analysis: enqueueAnalysis,
          },
          errorMessage: message,
        });
      }
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error("creative-sync error", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado" }, 500);
  }
});

async function syncProjectAssets(
  sb: ReturnType<typeof createClient>,
  args: {
    project: ProjectContext;
    days: number;
    targetAccountId: string | null;
    targetAssetId: string | null;
    reprocess: boolean;
    reprocessScope: ReprocessScope;
    enqueueAnalysis: boolean;
  },
) {
  const accounts = await loadProjectAccounts(sb, args.project, args.targetAccountId);
  if (accounts.length === 0) {
    throw new Error("Nenhuma conta Meta vinculada a este projeto");
  }

  const { metaRows, gatewayRows } = await loadRawInputs(sb, args.project.id, args.days, args.targetAccountId);
  if (metaRows.length === 0) {
    throw new Error("Nenhum insight Meta por anúncio encontrado no período");
  }

  const resolution = await loadCreativeDetails(accounts, metaRows);
  const latestSync = new Date().toISOString();
  const { assets: assetPayloads, assetKeyByAdId, jobHintsByAssetKey } = await buildAssetPayloads(sb, {
    project: args.project,
    metaRows,
    resolution,
    latestSync,
  });
  const narrowedAssetPayloads = args.targetAssetId
    ? assetPayloads.filter((asset) => asset.asset_key && asset.asset_key.length > 0)
    : assetPayloads;

  const assetRows = await upsertCreativeAssets(sb, narrowedAssetPayloads);
  const mediaTypeByAssetId = new Map(assetRows.map((row) => [String(row.id), String(row.media_type ?? "unknown") as CreativeMediaType]));
  const assetIdByKey = new Map(assetRows.map((row) => [String(row.asset_key), String(row.id)]));
  const assetIdByAdId = await upsertCreativeAssetAds(sb, {
    project: args.project,
    metaRows,
    assetKeyByAdId,
    assetIdByKey,
  });

  const metrics = buildCreativeDailyMetrics({
    metaRows: metaRows.map((row) => ({ event_date: row.event_date, payload: row.payload })) as CreativeMetricInputRow[],
    gatewayRows: gatewayRows.map((row) => ({ event_date: row.event_date, event_type: row.event_type, payload: row.payload })) as CreativeGatewayInputRow[],
    assetIdByAdId,
    mediaTypeByAssetId,
  });
  await upsertCreativeMetrics(sb, args.project, metrics);

  const targetAssetRowIds = args.targetAssetId
    ? new Set([args.targetAssetId])
    : null;
  const queueTargets = args.targetAssetId
    ? assetRows.filter((row) => row.id === args.targetAssetId)
    : assetRows;

  if (!args.enqueueAnalysis) {
    return {
      project_id: args.project.id,
      assets: assetRows.length,
      metrics: metrics.length,
      jobs_enqueued: 0,
      jobs_skipped: 0,
      jobs_already_running: 0,
      missing_media: 0,
      analysis_enqueue_skipped: true,
    };
  }

  const analysisMap = await loadExistingAnalyses(sb, queueTargets.map((row) => String(row.id)));
  const jobMap = await loadExistingJobs(sb, queueTargets.map((row) => String(row.id)));
  const enqueueOutcome = await enqueueCreativeJobs(sb, {
    project: args.project,
    assetPayloads: narrowedAssetPayloads,
    queueTargets,
    existingAnalyses: analysisMap,
    existingJobs: jobMap,
    jobHintsByAssetKey,
    reprocess: args.reprocess,
    reprocessScope: args.reprocessScope,
    targetAssetRowIds,
  });

  return {
    project_id: args.project.id,
    assets: assetRows.length,
    metrics: metrics.length,
    jobs_enqueued: enqueueOutcome.enqueued,
    jobs_skipped: enqueueOutcome.skipped,
    jobs_already_running: enqueueOutcome.alreadyRunning,
    missing_media: enqueueOutcome.missingMedia,
  };
}

async function requeueExistingAsset(
  sb: ReturnType<typeof createClient>,
  args: {
    project: ProjectContext;
    assetId: string;
    reprocessScope: ReprocessScope;
  },
) {
  const { data: assetRow, error: assetError } = await sb
    .from("creative_assets")
    .select([
      "id",
      "creative_id",
      "asset_key",
      "media_type",
      "thumbnail_url",
      "media_storage_path",
      "headline",
      "primary_text",
      "cta",
      "landing_url",
      "post_url",
      "analysis_status",
      "last_meta_synced_at",
      "source_media_url",
      "source_fetched_at",
      "media_bytes",
      "media_duration_ms",
      "media_fingerprint",
      "poster_storage_path",
      "last_processed_at",
      "processing_version",
    ].join(","))
    .eq("project_id", args.project.id)
    .eq("id", args.assetId)
    .maybeSingle();

  if (assetError || !assetRow) {
    throw new Error("Asset não encontrado para reprocessamento");
  }

  const asset = assetRow as ExistingAssetRow;
  const analysisMap = await loadExistingAnalyses(sb, [asset.id]);
  const jobMap = await loadExistingJobs(sb, [asset.id]);
  const payload: AssetUpsertPayload = {
    project_id: args.project.id,
    workspace_id: args.project.workspace_id,
    user_id: args.project.user_id,
    creative_id: asset.creative_id,
    asset_key: asset.asset_key,
    media_type: asset.media_type,
    thumbnail_url: asset.thumbnail_url,
    media_storage_path: asset.media_storage_path,
    headline: asset.headline,
    primary_text: asset.primary_text,
    cta: asset.cta,
    landing_url: asset.landing_url,
    post_url: asset.post_url,
    analysis_status: asset.analysis_status,
    last_meta_synced_at: new Date().toISOString(),
    source_media_url: asset.source_media_url,
    source_fetched_at: asset.source_fetched_at,
    media_bytes: asset.media_bytes,
    media_duration_ms: asset.media_duration_ms,
    media_fingerprint: asset.media_fingerprint,
    poster_storage_path: asset.poster_storage_path,
    last_processed_at: asset.last_processed_at,
    processing_version: asset.processing_version,
  };

  const outcome = await enqueueCreativeJobs(sb, {
    project: args.project,
    assetPayloads: [payload],
    queueTargets: [asset],
    existingAnalyses: analysisMap,
    existingJobs: jobMap,
    jobHintsByAssetKey: new Map([[asset.asset_key, {
      metaAccountBindingId: null,
      metaAccountId: null,
      videoId: asset.asset_key.startsWith("video:") ? asset.asset_key.replace(/^video:/, "") : null,
    } satisfies JobHint]]),
    reprocess: true,
    reprocessScope: args.reprocessScope,
    targetAssetRowIds: new Set([asset.id]),
  });

  return {
    project_id: args.project.id,
    assets: 1,
    metrics: 0,
    jobs_enqueued: outcome.enqueued,
    jobs_skipped: outcome.skipped,
    jobs_already_running: outcome.alreadyRunning,
    missing_media: outcome.missingMedia,
  };
}

async function buildAssetPayloads(
  sb: ReturnType<typeof createClient>,
  args: {
    project: ProjectContext;
    metaRows: RawMetaEventRow[];
    resolution: AdResolution;
    latestSync: string;
  },
) {
  const byAssetKey = new Map<string, AssetCandidate>();
  const assetKeyByAdId = new Map<string, string>();
  const jobHintsByAssetKey = new Map<string, JobHint>();

  for (const row of args.metaRows) {
    const payload = row.payload ?? {};
    const adId = stringOrNull(payload.ad_id);
    if (!adId) continue;

    const details = args.resolution.detailsByAdId.get(adId) ?? {
      id: adId,
      name: payload.ad_name ?? adId,
      creative: payload.creative_id ? { id: payload.creative_id } : null,
    };
    const derived = deriveCreativeAsset(details);
    assetKeyByAdId.set(adId, derived.assetKey);

    const current = byAssetKey.get(derived.assetKey);
    if (!current || current.latestEventDate < row.event_date) {
      byAssetKey.set(derived.assetKey, {
        derived,
        details,
        binding: args.resolution.bindingByAdId.get(adId) ?? null,
        latestEventDate: row.event_date,
      });
    }
    const binding = args.resolution.bindingByAdId.get(adId) ?? null;
    jobHintsByAssetKey.set(derived.assetKey, {
      metaAccountBindingId: binding?.id ?? null,
      metaAccountId: normalizeMetaAccountId(binding?.account_id ?? null),
      videoId: derived.videoId,
    });
  }

  const existingAssets = await loadExistingAssetsByKey(sb, args.project.id, [...byAssetKey.keys()]);
  const assets: AssetUpsertPayload[] = [];

  for (const [assetKey, candidate] of byAssetKey.entries()) {
    const current = existingAssets.get(assetKey);
    const resolved = await resolveMediaReference(candidate);
    const preview = await cacheAssetPreview(sb, {
      projectId: args.project.id,
      assetKey,
      mediaType: candidate.derived.mediaType,
      previewUrl: resolved.thumbnailUrl ?? candidate.derived.thumbnailUrl ?? candidate.derived.mediaUrl,
      currentThumbnailUrl: current?.thumbnail_url ?? null,
      currentPosterStoragePath: current?.poster_storage_path ?? null,
      currentMediaStoragePath: current?.media_storage_path ?? null,
    });

    const mediaFingerprint = await buildCreativeInputFingerprint([
      candidate.derived.assetKey,
      candidate.derived.creativeId,
      resolved.sourceMediaUrl ?? candidate.derived.mediaUrl ?? preview.publicUrl ?? "",
      resolved.thumbnailUrl ?? preview.publicUrl ?? "",
      resolved.mediaDurationMs ?? "",
    ]);

    const hasUsableMedia = Boolean(
      resolved.sourceMediaUrl ||
      preview.publicUrl ||
      candidate.derived.thumbnailUrl ||
      candidate.derived.mediaUrl ||
      candidate.derived.primaryText ||
      candidate.derived.headline,
    );
    const needsProcessing =
      current?.media_fingerprint !== mediaFingerprint ||
      current?.processing_version !== PROCESSING_VERSION ||
      !current?.last_processed_at;

    const analysisStatus: CreativeAnalysisStatus =
      candidate.derived.mediaType === "unknown" || !hasUsableMedia
        ? "missing_media"
        : needsProcessing
          ? "processing"
          : current?.analysis_status ?? "pending";

    const isImage = candidate.derived.mediaType === "image";
    const mediaStoragePath = isImage
      ? preview.storagePath ?? current?.media_storage_path ?? null
      : current?.media_storage_path ?? null;
    const posterStoragePath = candidate.derived.mediaType === "video"
      ? preview.storagePath ?? current?.poster_storage_path ?? null
      : current?.poster_storage_path ?? null;
    const thumbnailUrl = preview.publicUrl ?? current?.thumbnail_url ?? candidate.derived.thumbnailUrl;
    const sourceMediaUrl = resolved.sourceMediaUrl ?? current?.source_media_url ?? candidate.derived.mediaUrl ?? thumbnailUrl;

    assets.push({
      project_id: args.project.id,
      workspace_id: args.project.workspace_id,
      user_id: args.project.user_id,
      creative_id: candidate.derived.creativeId,
      asset_key: candidate.derived.assetKey,
      media_type: candidate.derived.mediaType,
      thumbnail_url: thumbnailUrl,
      media_storage_path: mediaStoragePath,
      headline: candidate.derived.headline ?? current?.headline ?? null,
      primary_text: candidate.derived.primaryText ?? current?.primary_text ?? null,
      cta: candidate.derived.cta ?? current?.cta ?? null,
      landing_url: candidate.derived.landingUrl ?? current?.landing_url ?? null,
      post_url: candidate.derived.postUrl ?? current?.post_url ?? null,
      analysis_status: analysisStatus,
      last_meta_synced_at: args.latestSync,
      source_media_url: sourceMediaUrl,
      source_fetched_at: sourceMediaUrl ? args.latestSync : current?.source_fetched_at ?? null,
      media_bytes: current?.media_bytes ?? null,
      media_duration_ms: resolved.mediaDurationMs ?? current?.media_duration_ms ?? null,
      media_fingerprint: mediaFingerprint,
      poster_storage_path: posterStoragePath,
      last_processed_at: current?.last_processed_at ?? null,
      processing_version: current?.processing_version ?? null,
    });
  }

  return { assets, assetKeyByAdId, jobHintsByAssetKey };
}

async function loadCreativeDetails(
  accounts: MetaAccountBinding[],
  metaRows: RawMetaEventRow[],
): Promise<AdResolution> {
  const detailsByAdId = new Map<string, MetaAdDetailsRecord>();
  const bindingByAdId = new Map<string, MetaAccountBinding>();
  const adIdsByAccount = new Map<string, string[]>();

  for (const row of metaRows) {
    const adId = stringOrNull(row.payload?.ad_id);
    const accountId = normalizeMetaAccountId(row.account_id);
    if (!adId || !accountId) continue;
    adIdsByAccount.set(accountId, [...(adIdsByAccount.get(accountId) ?? []), adId]);
  }

  for (const account of accounts) {
    const normalizedAccountId = normalizeMetaAccountId(account.account_id);
    if (!normalizedAccountId) continue;
    const adIds = [...new Set(adIdsByAccount.get(normalizedAccountId) ?? [])];
    if (adIds.length === 0) continue;
    const accountDetails = await fetchAdDetails(account.access_token, adIds);
    for (const [adId, details] of accountDetails.entries()) {
      detailsByAdId.set(adId, details);
      bindingByAdId.set(adId, account);
    }
  }

  return { detailsByAdId, bindingByAdId };
}

async function fetchAdDetails(accessToken: string, adIds: string[]) {
  const results = new Map<string, MetaAdDetailsRecord>();
  for (const batch of chunk(adIds, 25)) {
    const batchResult = await fetchAdDetailsBatch(accessToken, batch);
    for (const [adId, details] of batchResult.entries()) {
      results.set(adId, details);
    }
  }
  return results;
}

async function fetchAdDetailsBatch(accessToken: string, adIds: string[]) {
  const url = new URL("https://graph.facebook.com/v21.0/");
  url.searchParams.set("ids", adIds.join(","));
  url.searchParams.set(
    "fields",
    "id,name,creative{id,name,body,title,image_url,thumbnail_url,link_url,object_type,call_to_action_type,object_story_id,effective_object_story_id,object_story_spec}",
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  if (!response.ok) {
    const fallback = new Map<string, MetaAdDetailsRecord>();
    for (const adId of adIds) {
      fallback.set(adId, await fetchAdDetailsOne(accessToken, adId));
    }
    return fallback;
  }

  const payload = await response.json();
  const result = new Map<string, MetaAdDetailsRecord>();
  for (const adId of adIds) {
    const record = payload?.[adId];
    if (record) {
      result.set(adId, record as MetaAdDetailsRecord);
    }
  }
  return result;
}

async function fetchAdDetailsOne(accessToken: string, adId: string) {
  const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
  url.searchParams.set(
    "fields",
    "id,name,creative{id,name,body,title,image_url,thumbnail_url,link_url,object_type,call_to_action_type,object_story_id,effective_object_story_id,object_story_spec}",
  );
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta API ${response.status}: ${text.slice(0, 300)}`);
  }
  return await response.json() as MetaAdDetailsRecord;
}

async function resolveMediaReference(candidate: AssetCandidate): Promise<ResolvedMediaReference> {
  if (candidate.derived.mediaType !== "video" || !candidate.derived.videoId || !candidate.binding?.access_token) {
    return {
      sourceMediaUrl: candidate.derived.mediaUrl ?? candidate.derived.thumbnailUrl,
      thumbnailUrl: candidate.derived.thumbnailUrl ?? candidate.derived.mediaUrl,
      mediaDurationMs: null,
    };
  }

  try {
    return await fetchVideoAsset(candidate.binding.access_token, candidate.derived.videoId, candidate.derived.thumbnailUrl);
  } catch (error) {
    console.warn("creative-sync video resolve failed", candidate.derived.videoId, error);
    return {
      sourceMediaUrl: null,
      thumbnailUrl: candidate.derived.thumbnailUrl,
      mediaDurationMs: null,
    };
  }
}

async function fetchVideoAsset(accessToken: string, videoId: string, fallbackThumbnail: string | null): Promise<ResolvedMediaReference> {
  const url = new URL(`https://graph.facebook.com/v21.0/${videoId}`);
  url.searchParams.set("fields", "source,length,picture,thumbnails");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta video ${response.status}: ${text.slice(0, 200)}`);
  }
  const payload = await response.json();
  const thumbnails = Array.isArray(payload?.thumbnails?.data) ? payload.thumbnails.data : [];
  const thumbnail =
    stringOrNull(thumbnails.find((entry: any) => Boolean(stringOrNull(entry?.uri)))?.uri) ??
    stringOrNull(payload?.picture) ??
    fallbackThumbnail;
  const lengthSeconds = Number(payload?.length);
  return {
    sourceMediaUrl: stringOrNull(payload?.source),
    thumbnailUrl: thumbnail,
    mediaDurationMs: Number.isFinite(lengthSeconds) ? Math.round(lengthSeconds * 1000) : null,
  };
}

async function cacheAssetPreview(
  sb: ReturnType<typeof createClient>,
  args: {
    projectId: string;
    assetKey: string;
    mediaType: CreativeMediaType;
    previewUrl: string | null;
    currentThumbnailUrl: string | null;
    currentPosterStoragePath: string | null;
    currentMediaStoragePath: string | null;
  },
) {
  if (args.currentThumbnailUrl && (args.currentPosterStoragePath || args.mediaType === "image")) {
    return {
      publicUrl: args.currentThumbnailUrl,
      storagePath: args.currentPosterStoragePath ?? args.currentMediaStoragePath ?? null,
    };
  }

  if (!args.previewUrl) {
    return { publicUrl: args.currentThumbnailUrl, storagePath: args.currentPosterStoragePath ?? null };
  }

  try {
    const response = await fetch(args.previewUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || guessContentType(args.previewUrl, "image");
    const ext = extensionForContentType(contentType, args.previewUrl, "image");
    const path =
      args.mediaType === "image"
        ? `${args.projectId}/media/${sanitizePathSegment(args.assetKey)}.${ext}`
        : `${args.projectId}/poster/${sanitizePathSegment(args.assetKey)}.${ext}`;
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await sb.storage.from(CREATIVE_BUCKET).upload(path, arrayBuffer, {
      contentType,
      upsert: true,
    });
    if (error) throw new Error(error.message);
    const { data } = sb.storage.from(CREATIVE_BUCKET).getPublicUrl(path);
    return { publicUrl: data.publicUrl, storagePath: path };
  } catch (error) {
    console.warn("creative preview cache failed", args.previewUrl, error);
    return { publicUrl: args.currentThumbnailUrl ?? args.previewUrl, storagePath: args.currentPosterStoragePath ?? null };
  }
}

async function upsertCreativeAssets(
  sb: ReturnType<typeof createClient>,
  assets: AssetUpsertPayload[],
): Promise<UpsertedAssetRow[]> {
  if (assets.length === 0) return [];
  const { data, error } = await sb
    .from("creative_assets")
    .upsert(assets, { onConflict: "project_id,asset_key" })
    .select([
      "id",
      "creative_id",
      "asset_key",
      "media_type",
      "thumbnail_url",
      "media_storage_path",
      "headline",
      "primary_text",
      "cta",
      "landing_url",
      "post_url",
      "analysis_status",
      "source_media_url",
      "source_fetched_at",
      "media_bytes",
      "media_duration_ms",
      "media_fingerprint",
      "poster_storage_path",
      "last_processed_at",
      "processing_version",
    ].join(","));
  if (error) throw new Error(error.message);
  return (data ?? []) as UpsertedAssetRow[];
}

async function upsertCreativeAssetAds(
  sb: ReturnType<typeof createClient>,
  args: {
    project: ProjectContext;
    metaRows: RawMetaEventRow[];
    assetKeyByAdId: Map<string, string>;
    assetIdByKey: Map<string, string>;
  },
) {
  const latestByAdId = new Map<string, RawMetaEventRow>();
  for (const row of args.metaRows) {
    const adId = stringOrNull(row.payload?.ad_id);
    if (!adId) continue;
    const current = latestByAdId.get(adId);
    if (!current || current.event_date < row.event_date) {
      latestByAdId.set(adId, row);
    }
  }
  const rows: any[] = [];
  const assetIdByAdId = new Map<string, string>();
  for (const [adId, row] of latestByAdId.entries()) {
    const payload = row.payload ?? {};
    const assetKey = args.assetKeyByAdId.get(adId);
    const assetId = assetKey ? args.assetIdByKey.get(assetKey) : null;
    if (!assetId) continue;
    assetIdByAdId.set(adId, assetId);
    rows.push({
      asset_id: assetId,
      project_id: args.project.id,
      workspace_id: args.project.workspace_id,
      user_id: args.project.user_id,
      creative_id: stringOrNull(payload.creative_id) ?? adId,
      ad_id: adId,
      ad_name: stringOrNull(payload.ad_name),
      adset_id: stringOrNull((payload as any).adset_id),
      adset_name: stringOrNull((payload as any).adset_name),
      campaign_id: stringOrNull((payload as any).campaign_id),
      campaign_name: stringOrNull((payload as any).campaign_name),
      first_seen_at: row.event_date,
      last_seen_at: row.event_date,
    });
  }

  if (rows.length > 0) {
    const { error } = await sb
      .from("creative_asset_ads")
      .upsert(rows, { onConflict: "project_id,asset_id,ad_id" });
    if (error) throw new Error(error.message);
  }

  return assetIdByAdId;
}

async function upsertCreativeMetrics(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  metrics: ReturnType<typeof buildCreativeDailyMetrics>,
) {
  if (metrics.length === 0) return;
  const payload = metrics.map((row) => ({
    ...row,
    project_id: project.id,
    workspace_id: project.workspace_id,
    user_id: project.user_id,
  }));
  const { error } = await sb
    .from("creative_asset_daily_metrics")
    .upsert(payload, { onConflict: "asset_id,event_date" });
  if (error) throw new Error(error.message);
}

async function enqueueCreativeJobs(
  sb: ReturnType<typeof createClient>,
  args: {
    project: ProjectContext;
    assetPayloads: AssetUpsertPayload[];
    queueTargets: UpsertedAssetRow[];
    existingAnalyses: Map<string, ExistingAnalysisRow>;
    existingJobs: Map<string, ExistingJobRow>;
    jobHintsByAssetKey: Map<string, JobHint>;
    reprocess: boolean;
    reprocessScope: ReprocessScope;
    targetAssetRowIds: Set<string> | null;
  },
) {
  const upserts: Record<string, unknown>[] = [];
  const analysisUpserts: Record<string, unknown>[] = [];
  const assetStatusUpdates: Array<{ id: string; analysis_status: CreativeAnalysisStatus }> = [];
  const payloadByKey = new Map(args.assetPayloads.map((asset) => [asset.asset_key, asset]));
  let enqueued = 0;
  let skipped = 0;
  let alreadyRunning = 0;
  let missingMedia = 0;

  for (const row of args.queueTargets) {
    if (args.targetAssetRowIds && !args.targetAssetRowIds.has(row.id)) continue;
    const assetPayload = payloadByKey.get(row.asset_key);
    if (!assetPayload) continue;

    const existingAnalysis = args.existingAnalyses.get(row.id) ?? null;
    const jobHint = args.jobHintsByAssetKey.get(row.asset_key) ?? {
      metaAccountBindingId: null,
      metaAccountId: null,
      videoId: row.asset_key.startsWith("video:") ? row.asset_key.replace(/^video:/, "") : null,
    };
    const inputFingerprint = await buildCreativeInputFingerprint([
      assetPayload.media_fingerprint,
      PROCESSING_VERSION,
      args.reprocessScope,
      row.media_type === "video" ? "video_keyframes" : "image",
    ]);
    const existingJob = args.existingJobs.get(`${row.id}:${inputFingerprint}`) ?? null;

    if (assetPayload.analysis_status === "missing_media" || row.media_type === "unknown") {
      missingMedia += 1;
      analysisUpserts.push(buildAnalysisUpsert({
        row,
        assetPayload,
        existingAnalysis,
        reprocessScope: args.reprocessScope,
        transcriptStatus: "missing_media",
        analysisStatus: "missing_media",
        analysisCoverage: row.media_type === "image" ? "not_applicable" : "failed",
      }));
      continue;
    }

    const isCurrentVersion = row.processing_version === PROCESSING_VERSION;
    const isCurrentMedia = row.media_fingerprint === assetPayload.media_fingerprint;
    const hasReadyOutput =
      existingAnalysis?.status === "ready" &&
      (row.media_type === "image" ||
        existingAnalysis.transcript_status === "ready" ||
        existingAnalysis.transcript_status === "not_applicable");

    if (!args.reprocess && existingJob?.status === "queued") {
      alreadyRunning += 1;
      assetStatusUpdates.push({ id: row.id, analysis_status: "processing" });
      continue;
    }

    if (!args.reprocess && existingJob?.status === "running") {
      alreadyRunning += 1;
      assetStatusUpdates.push({ id: row.id, analysis_status: "processing" });
      continue;
    }

    if (!args.reprocess && existingJob?.status === "failed" && isCurrentVersion && isCurrentMedia) {
      skipped += 1;
      continue;
    }

    if (!args.reprocess && existingJob?.status === "succeeded" && isCurrentVersion && isCurrentMedia && hasReadyOutput) {
      skipped += 1;
      continue;
    }

    if (!args.reprocess && !existingJob && isCurrentVersion && isCurrentMedia && hasReadyOutput) {
      skipped += 1;
      continue;
    }

    const jobPayload: CreativeJobPayload = {
      asset_id: row.id,
      project_id: args.project.id,
      workspace_id: args.project.workspace_id,
      user_id: args.project.user_id,
      creative_id: row.creative_id,
      asset_key: row.asset_key,
      media_type: row.media_type,
      headline: assetPayload.headline,
      primary_text: assetPayload.primary_text,
      cta: assetPayload.cta,
      landing_url: assetPayload.landing_url,
      post_url: assetPayload.post_url,
      thumbnail_url: assetPayload.thumbnail_url,
      source_media_url: assetPayload.source_media_url,
      media_storage_path: assetPayload.media_storage_path,
      poster_storage_path: assetPayload.poster_storage_path,
      media_duration_ms: assetPayload.media_duration_ms,
      media_fingerprint: assetPayload.media_fingerprint,
      processing_version: PROCESSING_VERSION,
      analysis_provider: ANALYSIS_PROVIDER,
      analysis_model: ANALYSIS_MODEL,
      transcription_provider: TRANSCRIPTION_PROVIDER,
      transcription_model: TRANSCRIPTION_MODEL,
      prompt_version: PROMPT_VERSION,
      analysis_mode: row.media_type === "video" ? "video_keyframes" : "image",
      reprocess_scope: args.reprocessScope,
      meta_account_binding_id: jobHint.metaAccountBindingId,
      meta_account_id: jobHint.metaAccountId,
      video_id: jobHint.videoId,
      job_trigger: "manual",
    };

    upserts.push({
      asset_id: row.id,
      project_id: args.project.id,
      workspace_id: args.project.workspace_id,
      user_id: args.project.user_id,
      status: "queued",
      attempt_count: 0,
      max_attempts: 3,
      available_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      input_fingerprint: inputFingerprint,
      payload: jobPayload,
      last_error: null,
      finished_at: null,
    });
    analysisUpserts.push(buildAnalysisUpsert({
      row,
      assetPayload,
      existingAnalysis,
      reprocessScope: args.reprocessScope,
      transcriptStatus:
        row.media_type === "image"
          ? "not_applicable"
          : args.reprocessScope === "analysis" && existingAnalysis?.transcript_status === "ready"
            ? "ready"
            : "pending",
      analysisStatus: "processing",
      analysisCoverage:
        row.media_type === "image"
          ? "pending"
          : args.reprocessScope === "analysis" && existingAnalysis?.transcript_status === "ready"
            ? "partial"
            : "pending",
    }));
    assetStatusUpdates.push({ id: row.id, analysis_status: "processing" });
    enqueued += 1;
  }

  if (upserts.length > 0) {
    const { error } = await sb
      .from("creative_asset_jobs")
      .upsert(upserts, { onConflict: "asset_id,input_fingerprint" });
    if (error) throw new Error(error.message);
  }

  if (analysisUpserts.length > 0) {
    const { error } = await sb
      .from("creative_asset_analysis")
      .upsert(analysisUpserts, { onConflict: "asset_id" });
    if (error) throw new Error(error.message);
  }

  for (const update of assetStatusUpdates) {
    const { error } = await sb
      .from("creative_assets")
      .update({ analysis_status: update.analysis_status })
      .eq("id", update.id);
    if (error) throw new Error(error.message);
  }

  return { enqueued, skipped, alreadyRunning, missingMedia };
}

function buildAnalysisUpsert(args: {
  row: UpsertedAssetRow;
  assetPayload: AssetUpsertPayload;
  existingAnalysis: ExistingAnalysisRow | null;
  reprocessScope: ReprocessScope;
  transcriptStatus: CreativeTranscriptStatus;
  analysisStatus: CreativeAnalysisStatus;
  analysisCoverage: CreativeAnalysisCoverage;
}) {
  const keepTranscript = args.reprocessScope === "analysis" && args.existingAnalysis?.transcript_status === "ready";
  const fallback = buildCreativeAnalysisFallback({
    mediaType: args.row.media_type,
    transcript: keepTranscript ? args.existingAnalysis?.transcript : null,
    transcriptStatus: args.transcriptStatus,
    transcriptSegments: keepTranscript ? normalizeSegments(args.existingAnalysis?.transcript_segments) : [],
    transcriptLanguage: keepTranscript ? args.existingAnalysis?.transcript_language : null,
    transcriptProvider: keepTranscript ? args.existingAnalysis?.transcript_provider : null,
    transcriptModel: keepTranscript ? args.existingAnalysis?.transcript_model : null,
    primaryText: args.assetPayload.primary_text,
    headline: args.assetPayload.headline,
    cta: args.assetPayload.cta,
    analysisCoverage: args.analysisCoverage,
    analysisStatus: args.analysisStatus,
    transcriptErrorMessage: null,
    analysisErrorMessage: null,
  });

  return {
    asset_id: args.row.id,
    project_id: args.assetPayload.project_id,
    workspace_id: args.assetPayload.workspace_id,
    user_id: args.assetPayload.user_id,
    status: fallback.status,
    transcript_status: fallback.transcriptStatus,
    transcript: fallback.transcript,
    transcript_segments: fallback.transcriptSegments,
    transcript_language: fallback.transcriptLanguage,
    transcript_provider: fallback.transcriptProvider,
    transcript_model: fallback.transcriptModel,
    transcript_error_message: fallback.transcriptErrorMessage,
    summary: fallback.summary,
    hook: fallback.hook,
    hook_timestamps: fallback.hookTimestamps,
    angle: fallback.angle,
    copy: fallback.copy,
    cta: fallback.cta,
    visual: fallback.visual,
    visual_evidence: fallback.visualEvidence,
    tags: fallback.tags,
    scores: fallback.scores,
    analysis_coverage: fallback.analysisCoverage,
    provider: ANALYSIS_PROVIDER,
    model: ANALYSIS_MODEL,
    prompt_version: PROMPT_VERSION,
    error_message: null,
    analysis_error_message: null,
    processed_at: keepTranscript ? args.existingAnalysis?.processed_at ?? null : null,
  };
}

function normalizeSegments(value: unknown) {
  return Array.isArray(value) ? value as any[] : [];
}

async function loadRawInputs(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  days: number,
  targetAccountId: string | null,
) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = ymd(since);

  let metaQuery = sb
    .from("raw_events")
    .select("event_date, account_id, payload")
    .eq("project_id", projectId)
    .eq("source", "meta")
    .eq("event_type", "insight_ad")
    .gte("event_date", sinceStr)
    .limit(10000);

  if (targetAccountId) {
    metaQuery = metaQuery.eq("account_id", targetAccountId);
  }

  const [metaResponse, gatewayResponse] = await Promise.all([
    metaQuery,
    sb
      .from("raw_events")
      .select("event_date, event_type, payload")
      .eq("project_id", projectId)
      .eq("source", "gateway")
      .in("event_type", ["purchase.approved"])
      .gte("event_date", sinceStr)
      .limit(10000),
  ]);

  if (metaResponse.error) throw new Error(metaResponse.error.message);
  if (gatewayResponse.error) throw new Error(gatewayResponse.error.message);

  return {
    metaRows: (metaResponse.data ?? []) as RawMetaEventRow[],
    gatewayRows: (gatewayResponse.data ?? []) as RawGatewayEventRow[],
  };
}

async function loadExistingAssetsByKey(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  assetKeys: string[],
) {
  if (assetKeys.length === 0) return new Map<string, ExistingAssetRow>();
  const { data, error } = await sb
    .from("creative_assets")
    .select([
      "id",
      "creative_id",
      "asset_key",
      "media_type",
      "thumbnail_url",
      "media_storage_path",
      "headline",
      "primary_text",
      "cta",
      "landing_url",
      "post_url",
      "analysis_status",
      "source_media_url",
      "source_fetched_at",
      "media_bytes",
      "media_duration_ms",
      "media_fingerprint",
      "poster_storage_path",
      "last_processed_at",
      "processing_version",
    ].join(","))
    .eq("project_id", projectId)
    .in("asset_key", assetKeys);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [String(row.asset_key), row as ExistingAssetRow]));
}

async function loadExistingAnalyses(
  sb: ReturnType<typeof createClient>,
  assetIds: string[],
) {
  if (assetIds.length === 0) return new Map<string, ExistingAnalysisRow>();
  const { data, error } = await sb
    .from("creative_asset_analysis")
    .select([
      "asset_id",
      "status",
      "transcript",
      "transcript_status",
      "transcript_segments",
      "transcript_language",
      "transcript_provider",
      "transcript_model",
      "summary",
      "hook",
      "angle",
      "copy",
      "cta",
      "visual",
      "tags",
      "scores",
      "hook_timestamps",
      "visual_evidence",
      "analysis_coverage",
      "error_message",
      "transcript_error_message",
      "analysis_error_message",
      "model",
      "prompt_version",
      "processed_at",
    ].join(","))
    .in("asset_id", assetIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [String(row.asset_id), row as ExistingAnalysisRow]));
}

async function loadExistingJobs(
  sb: ReturnType<typeof createClient>,
  assetIds: string[],
) {
  if (assetIds.length === 0) return new Map<string, ExistingJobRow>();
  const { data, error } = await sb
    .from("creative_asset_jobs")
    .select("id, asset_id, input_fingerprint, status")
    .in("asset_id", assetIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row: any) => [`${row.asset_id}:${row.input_fingerprint}`, row as ExistingJobRow]));
}

async function resolveCaller(req: Request): Promise<Caller | null> {
  if (isAutomationRequest(req)) {
    return { kind: "service" };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user?.id) return null;

  return { kind: "user", userId: data.user.id };
}

async function getProjectOrThrow(
  sb: ReturnType<typeof createClient>,
  projectId: string,
): Promise<ProjectContext> {
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id, source")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data?.workspace_id) {
    throw new Error("Projeto não encontrado");
  }

  return data as ProjectContext;
}

async function loadSchedulableProjects(
  sb: ReturnType<typeof createClient>,
): Promise<ProjectContext[]> {
  const { data, error } = await sb
    .from("projects")
    .select("id, user_id, workspace_id, source")
    .eq("source", "api")
    .not("workspace_id", "is", null);

  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectContext[];
}

async function loadProjectAccounts(
  sb: ReturnType<typeof createClient>,
  project: ProjectContext,
  targetAccountId: string | null,
): Promise<MetaAccountBinding[]> {
  const { data: bindings, error: bindingsError } = await sb
    .from("project_meta_accounts")
    .select("meta_account_id")
    .eq("project_id", project.id);

  if (bindingsError) throw new Error(bindingsError.message);

  const ids = (bindings ?? []).map((binding: any) => binding.meta_account_id as string);
  if (ids.length === 0) return [];

  const { data: accountRows, error: accountsError } = await sb
    .from("workspace_meta_accounts")
    .select("id, account_id, access_token, label")
    .eq("workspace_id", project.workspace_id)
    .in("id", ids);

  if (accountsError) throw new Error(accountsError.message);

  const accounts = (accountRows ?? []) as MetaAccountBinding[];
  if (!targetAccountId) return accounts;

  return accounts.filter((account) => normalizeMetaAccountId(account.account_id) === targetAccountId);
}

async function assertWorkspaceAdmin(
  sb: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
) {
  const { data: workspaceMembership } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (workspaceMembership?.role === "owner" || workspaceMembership?.role === "admin") {
    return;
  }

  const { data: workspace } = await sb
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (!workspace?.organization_id) {
    throw new Error("Workspace não encontrado");
  }

  const { data: orgMembership } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", workspace.organization_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (orgMembership?.role === "owner" || orgMembership?.role === "admin") {
    return;
  }

  throw new Error("Sem permissão para sincronizar este workspace");
}

async function failStaleRunningSyncRuns(sb: ReturnType<typeof createClient>) {
  const threshold = new Date(Date.now() - CREATIVE_RUNNING_SYNC_TIMEOUT_MS).toISOString();
  const { data, error } = await sb
    .from("sync_runs")
    .select("id")
    .eq("source", "creative")
    .eq("status", "running")
    .lt("created_at", threshold);
  if (error || !data?.length) return;

  const ids = data.map((row: any) => row.id).filter(Boolean);
  if (ids.length === 0) return;

  await sb
    .from("sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: "Sync de criativos marcado como falho por timeout automático",
    })
    .in("id", ids);
}

async function findActiveSyncRun(
  sb: ReturnType<typeof createClient>,
  projectId: string,
) {
  const { data, error } = await sb
    .from("sync_runs")
    .select("id, started_at")
    .eq("project_id", projectId)
    .eq("source", "creative")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function createSyncRun(
  sb: ReturnType<typeof createClient>,
  args: {
    workspaceId: string;
    projectId: string;
    source: "creative";
    initiatedBy: string | null;
    details: Record<string, unknown>;
  },
) {
  const { data } = await sb
    .from("sync_runs")
    .insert({
      workspace_id: args.workspaceId,
      project_id: args.projectId,
      source: args.source,
      status: "running",
      initiated_by: args.initiatedBy,
      started_at: new Date().toISOString(),
      details: args.details,
    })
    .select("id")
    .maybeSingle();

  return data?.id as string | undefined;
}

async function finishSyncRun(
  sb: ReturnType<typeof createClient>,
  runId: string | undefined,
  args: {
    status: "succeeded" | "failed";
    details: Record<string, unknown>;
    errorMessage: string | null;
  },
) {
  if (!runId) return;

  await sb
    .from("sync_runs")
    .update({
      status: args.status,
      finished_at: new Date().toISOString(),
      details: args.details,
      error_message: args.errorMessage,
    })
    .eq("id", runId);
}

function normalizeMetaAccountId(accountId: string | null) {
  if (!accountId) return null;
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function normalizeReprocessScope(value: unknown): ReprocessScope {
  return value === "media" || value === "transcript" || value === "analysis" ? value : "all";
}

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function guessContentType(url: string, mediaType: "image" | "video") {
  const lower = url.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (mediaType === "video") return "video/mp4";
  return "image/jpeg";
}

function extensionForContentType(contentType: string, url: string, mediaType: "image" | "video") {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("mp4") || contentType.includes("video")) return "mp4";
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url);
  if (match) return match[1].toLowerCase();
  return mediaType === "video" ? "mp4" : "jpg";
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function ymd(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

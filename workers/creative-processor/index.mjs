import { createClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  buildKeyframeTimestamps,
  computeAudioChunkPlan,
  formatTimestamp,
  mergeTranscriptChunks,
  normalizeAnalysisResponse,
} from "./core.mjs";

const SUPABASE_URL = requiredEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const CREATIVE_BUCKET = process.env.CREATIVE_BUCKET || "creative-assets";
const TRANSCRIPTION_PROVIDER = process.env.CREATIVE_TRANSCRIPTION_PROVIDER || "openai";
const TRANSCRIPTION_MODEL = process.env.CREATIVE_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const ANALYSIS_PROVIDER = process.env.CREATIVE_ANALYSIS_PROVIDER || "lovable";
const ANALYSIS_MODEL = process.env.CREATIVE_ANALYSIS_MODEL || "google/gemini-3-flash-preview";
const PROMPT_VERSION = process.env.CREATIVE_ANALYSIS_PROMPT_VERSION || "creative-sync-v2";
const POLL_INTERVAL_MS = Number(process.env.CREATIVE_WORKER_POLL_INTERVAL_MS || "5000");
const BATCH_SIZE = Number(process.env.CREATIVE_WORKER_BATCH_SIZE || "2");
const WORKER_ID = process.env.CREATIVE_WORKER_ID || process.env.RENDER_SERVICE_NAME || os.hostname();
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";
const FFPROBE_BIN = process.env.FFPROBE_PATH || ffprobeStatic.path || "ffprobe";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

main().catch((error) => {
  console.error("creative worker fatal error", error);
  process.exitCode = 1;
});

async function main() {
  console.log(`creative worker started as ${WORKER_ID}`);
  while (true) {
    try {
      const jobs = await claimJobs(BATCH_SIZE);
      if (jobs.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      for (const job of jobs) {
        await processJob(job);
      }
    } catch (error) {
      console.error("creative worker loop error", error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function claimJobs(limit) {
  const { data, error } = await supabase.rpc("claim_creative_asset_jobs", {
    job_limit: limit,
    worker_name: WORKER_ID,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function processJob(job) {
  const payload = normalizeJobPayload(job.payload);
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "creative-worker-"));

  try {
    await markAssetProcessing(payload.asset_id, payload.media_type);

    const asset = await loadAsset(payload.asset_id);
    const mediaSource = await resolveMediaSource(payload, asset);
    if (!mediaSource.url) {
      throw new Error("Mídia indisponível para processamento");
    }

    const mediaExt = payload.media_type === "video" ? "mp4" : extensionFromUrl(mediaSource.url, "jpg");
    const sourceFile = path.join(tempDir, `source.${mediaExt}`);
    await downloadFile(mediaSource.url, sourceFile);
    const mediaBytes = await fileSize(sourceFile);
    const mediaFingerprint = await sha256File(sourceFile);

    if (payload.media_type === "image") {
      // Pular analise de imagens - marcar como not_applicable
      const storedImage = await uploadToStorage({
        localPath: sourceFile,
        storagePath: payload.media_storage_path || `${payload.project_id}/media/${sanitizePathSegment(payload.asset_key)}.${mediaExt}`,
        contentType: guessContentType(sourceFile, "image"),
      });
      await persistSuccess({
        job,
        payload,
        transcript: null,
        transcriptSegments: [],
        transcriptLanguage: null,
        transcriptStatus: "not_applicable",
        posterPath: asset.poster_storage_path ?? payload.poster_storage_path,
        posterUrl: payload.thumbnail_url,
        mediaStoragePath: storedImage.storagePath,
        mediaBytes,
        mediaDurationMs: null,
        mediaFingerprint,
        analysis: {
          summary: null,
          hook: null,
          hook_timestamps: [],
          angle: null,
          copy: null,
          cta: null,
          visual: null,
          visual_evidence: [],
          tags: [],
          scores: {},
          analysis_coverage: "not_applicable",
          errorMessage: null,
        },
      });
      await completeJob(job.id);
      return;
    }

    const probe = await probeMedia(sourceFile);
    const durationMs = Math.max(
      1000,
      payload.media_duration_ms || Math.round(Number(probe.format?.duration || 0) * 1000) || 1000,
    );
    const storedVideo = await uploadToStorage({
      localPath: sourceFile,
      storagePath: payload.media_storage_path || `${payload.project_id}/source/${sanitizePathSegment(payload.asset_key)}.mp4`,
      contentType: "video/mp4",
    });

    const posterPath = path.join(tempDir, "poster.jpg");
    await generatePoster(sourceFile, posterPath);
    const posterStored = await uploadToStorage({
      localPath: posterPath,
      storagePath: `${payload.project_id}/poster/${sanitizePathSegment(payload.asset_key)}.jpg`,
      contentType: "image/jpeg",
    });

    const keyframeTimestamps = buildKeyframeTimestamps(durationMs);
    const keyframeUrls = [];
    for (const timestampMs of keyframeTimestamps) {
      const frameLocalPath = path.join(tempDir, `frame-${timestampMs}.jpg`);
      await generateFrame(sourceFile, frameLocalPath, timestampMs);
      const uploaded = await uploadToStorage({
        localPath: frameLocalPath,
        storagePath: `${payload.project_id}/keyframes/${sanitizePathSegment(payload.asset_key)}-${timestampMs}.jpg`,
        contentType: "image/jpeg",
      });
      keyframeUrls.push({ url: uploaded.publicUrl, timestampMs });
    }

    const audioPath = path.join(tempDir, "audio.m4a");
    await extractAudio(sourceFile, audioPath);
    const audioBytes = await fileSize(audioPath);

    let transcriptStatus = "processing";
    let transcript = null;
    let transcriptSegments = [];
    let transcriptLanguage = null;

    await updateAnalysisStage(payload.asset_id, {
      status: "processing",
      transcript_status: transcriptStatus,
      analysis_coverage: "pending",
    });

    if (audioBytes > 20 * 1024 * 1024) {
      transcriptStatus = "oversized_queued";
      await updateAnalysisStage(payload.asset_id, {
        status: "processing",
        transcript_status: transcriptStatus,
        analysis_coverage: "pending",
      });
      const chunkPlan = computeAudioChunkPlan({ fileSizeBytes: audioBytes, durationMs });
      const transcriptParts = [];
      for (let index = 0; index < chunkPlan.length; index += 1) {
        const chunk = chunkPlan[index];
        const chunkPath = path.join(tempDir, `chunk-${index}.m4a`);
        await extractAudioChunk(audioPath, chunkPath, chunk.startMs, chunk.endMs);
        const part = await transcribeFile(chunkPath);
        transcriptParts.push({
          offsetMs: chunk.startMs,
          segments: part.segments,
        });
      }
      const merged = mergeTranscriptChunks(transcriptParts);
      transcript = merged.text;
      transcriptSegments = merged.segments;
      transcriptLanguage = "pt";
      transcriptStatus = "ready";
    } else {
      const transcribed = await transcribeFile(audioPath);
      transcript = transcribed.text;
      transcriptSegments = transcribed.segments;
      transcriptLanguage = transcribed.language;
      transcriptStatus = "ready";
    }

    await updateAnalysisStage(payload.asset_id, {
      status: "processing",
      transcript_status: transcriptStatus,
      transcript,
      transcript_segments: transcriptSegments,
      transcript_language: transcriptLanguage,
      transcript_provider: TRANSCRIPTION_PROVIDER,
      transcript_model: TRANSCRIPTION_MODEL,
      analysis_coverage: "partial",
    });

    const analysis = await analyzeVideoCreative({
      payload,
      transcript,
      transcriptSegments,
    });

    await persistSuccess({
      job,
      payload,
      transcript,
      transcriptSegments,
      transcriptLanguage,
      transcriptStatus,
      posterPath: posterStored.storagePath,
      posterUrl: posterStored.publicUrl,
      mediaStoragePath: storedVideo.storagePath,
      mediaBytes,
      mediaDurationMs: durationMs,
      mediaFingerprint,
      analysis,
    });
    await completeJob(job.id);
  } catch (error) {
    console.error(`creative worker job ${job.id} failed`, error);
    await persistFailure(job, normalizeJobPayload(job.payload), error);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveMediaSource(payload, asset) {
  const candidates = [payload.source_media_url, asset?.source_media_url, payload.thumbnail_url, asset?.thumbnail_url].filter(Boolean);
  for (const url of candidates) {
    if (await canFetch(url)) {
      return { url };
    }
  }

  if (payload.video_id && payload.meta_account_binding_id) {
    const refreshed = await refreshVideoSource(payload.meta_account_binding_id, payload.video_id);
    if (refreshed.sourceMediaUrl) {
      await supabase
        .from("creative_assets")
        .update({
          source_media_url: refreshed.sourceMediaUrl,
          source_fetched_at: new Date().toISOString(),
          media_duration_ms: refreshed.mediaDurationMs,
          thumbnail_url: refreshed.thumbnailUrl || asset?.thumbnail_url || payload.thumbnail_url,
        })
        .eq("id", payload.asset_id);
      return { url: refreshed.sourceMediaUrl };
    }
  }

  return { url: candidates[0] || null };
}

async function refreshVideoSource(bindingId, videoId) {
  const { data: binding, error } = await supabase
    .from("workspace_meta_accounts")
    .select("access_token")
    .eq("id", bindingId)
    .maybeSingle();
  if (error || !binding?.access_token) {
    throw error || new Error("Conta Meta indisponível para refresh da mídia");
  }
  const url = new URL(`https://graph.facebook.com/v21.0/${videoId}`);
  url.searchParams.set("fields", "source,length,picture,thumbnails");
  url.searchParams.set("access_token", binding.access_token);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao renovar mídia Meta [${response.status}]`);
  }
  const payload = await response.json();
  const thumbnails = Array.isArray(payload?.thumbnails?.data) ? payload.thumbnails.data : [];
  return {
    sourceMediaUrl: String(payload?.source || "").trim() || null,
    thumbnailUrl: String(thumbnails.find((entry) => entry?.uri)?.uri || payload?.picture || "").trim() || null,
    mediaDurationMs: Number.isFinite(Number(payload?.length)) ? Math.round(Number(payload.length) * 1000) : null,
  };
}

async function analyzeVideoCreative({ payload, transcript, transcriptSegments }) {
  return analyzeCreative({
    mediaType: "video",
    payload,
    transcript,
    transcriptSegments,
  });
}

async function analyzeCreative({ mediaType, payload, transcript, transcriptSegments }) {
  const apiKey = resolveAnalysisApiKey();
  const endpoint = resolveAnalysisApiUrl();
  const transcriptExcerpt = transcriptSegments.length > 0
    ? transcriptSegments
      .slice(0, 40)
      .map((segment) => `[${formatTimestamp(segment.start_ms)}-${formatTimestamp(segment.end_ms)}] ${segment.text}`)
      .join("\n")
    : transcript || "—";

  const prompt = [
    "Analise a transcrição do criativo de anúncio e responda somente JSON válido.",
    "Campos obrigatórios: summary, hook, hook_timestamps, angle, copy, cta, tags, scores, analysis_coverage, errorMessage.",
    "Use PT-BR, direto e concreto.",
    "scores deve conter no mínimo hook, clareza e potencial_de_escala com notas de 0 a 100.",
    "hook_timestamps deve ser um array com { start_ms, end_ms, label, reason } indicando os momentos de gancho.",
    "analysis_coverage deve ser full se a análise estiver completa.",
    "",
    `Tipo: ${mediaType}`,
    `Headline: ${payload.headline ?? "—"}`,
    `Texto principal: ${payload.primary_text ?? "—"}`,
    `CTA: ${payload.cta ?? "—"}`,
    `Landing URL: ${payload.landing_url ?? "—"}`,
    "",
    "Transcrição completa:",
    transcriptExcerpt,
  ].join("\n");

  let contentText;

  if (ANALYSIS_PROVIDER === "anthropic") {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        system: "Você é um analista de criativos de anúncios. Retorne apenas JSON válido, sem markdown ou explicações.",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha na análise Claude [${response.status}]: ${text.slice(0, 200)}`);
    }

    const result = await response.json();
    contentText = result?.content?.[0]?.text;
  } else {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: "system", content: "Você retorna apenas JSON válido." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Falha na análise IA [${response.status}]: ${text.slice(0, 200)}`);
    }

    const payloadJson = await response.json();
    contentText = payloadJson?.choices?.[0]?.message?.content;
  }

  if (typeof contentText !== "string") {
    throw new Error("Provider de análise retornou conteúdo vazio");
  }

  // Remove markdown code blocks if present
  const jsonMatch = contentText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cleanJson = jsonMatch ? jsonMatch[1] : contentText;

  return normalizeAnalysisResponse(JSON.parse(cleanJson.trim()));
}

async function transcribeFile(filePath) {
  if (TRANSCRIPTION_PROVIDER !== "openai") {
    throw new Error(`Provider de transcrição não suportado: ${TRANSCRIPTION_PROVIDER}`);
  }

  const apiKey = requiredEnv("OPENAI_API_KEY");
  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.set("file", new Blob([fileBuffer]), path.basename(filePath));
  form.set("model", TRANSCRIPTION_MODEL);
  form.set("response_format", "verbose_json");
  form.set("timestamp_granularities[]", "segment");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha na transcrição [${response.status}]: ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const segments = Array.isArray(payload?.segments)
    ? payload.segments.map((segment) => ({
      start_ms: Math.round(Number(segment.start || 0) * 1000),
      end_ms: Math.round(Number(segment.end || 0) * 1000),
      text: String(segment.text || "").trim(),
    })).filter((segment) => segment.text)
    : [];

  return {
    text: String(payload?.text || "").trim(),
    language: String(payload?.language || "").trim() || null,
    segments,
  };
}

async function persistSuccess({
  job,
  payload,
  transcript,
  transcriptSegments,
  transcriptLanguage,
  transcriptStatus,
  posterPath,
  posterUrl,
  mediaStoragePath,
  mediaBytes,
  mediaDurationMs,
  mediaFingerprint,
  analysis,
}) {
  const now = new Date().toISOString();
  const analysisCoverage = analysis.analysis_coverage || "full";
  const status = analysisCoverage === "partial" ? "failed" : "ready";

  await supabase
    .from("creative_asset_analysis")
    .upsert({
      asset_id: payload.asset_id,
      project_id: payload.project_id || job.project_id,
      workspace_id: payload.workspace_id || job.workspace_id,
      user_id: job.user_id,
      status,
      transcript_status: transcriptStatus,
      transcript,
      transcript_segments: transcriptSegments,
      transcript_language: transcriptLanguage,
      transcript_provider: TRANSCRIPTION_PROVIDER,
      transcript_model: TRANSCRIPTION_MODEL,
      transcript_error_message: null,
      summary: analysis.summary,
      hook: analysis.hook,
      hook_timestamps: analysis.hook_timestamps,
      angle: analysis.angle,
      copy: analysis.copy,
      cta: analysis.cta,
      visual: analysis.visual,
      visual_evidence: analysis.visual_evidence,
      tags: analysis.tags,
      scores: analysis.scores,
      analysis_coverage: analysisCoverage,
      provider: ANALYSIS_PROVIDER,
      model: ANALYSIS_MODEL,
      prompt_version: PROMPT_VERSION,
      error_message: analysis.errorMessage,
      analysis_error_message: analysis.errorMessage,
      processed_at: now,
    }, { onConflict: "asset_id" });

  await supabase
    .from("creative_assets")
    .update({
      analysis_status: status,
      thumbnail_url: posterUrl || payload.thumbnail_url,
      poster_storage_path: posterPath,
      media_storage_path: mediaStoragePath,
      media_bytes: mediaBytes,
      media_duration_ms: mediaDurationMs,
      media_fingerprint: mediaFingerprint,
      last_processed_at: now,
      processing_version: payload.processing_version,
      source_fetched_at: now,
    })
    .eq("id", payload.asset_id);
}

async function persistFailure(job, payload, error) {
  const message = error instanceof Error ? error.message : "Falha ao processar criativo";
  const { data: analysis } = await supabase
    .from("creative_asset_analysis")
    .select("transcript_status, transcript, transcript_segments, transcript_language")
    .eq("asset_id", payload.asset_id)
    .maybeSingle();

  const transcriptStatus =
    analysis?.transcript_status === "ready"
      ? "ready"
      : analysis?.transcript_status === "oversized_queued"
        ? "oversized_queued"
        : "failed";
  const analysisCoverage = analysis?.transcript ? "partial" : "failed";
  const assetStatus = analysisCoverage === "partial" ? "failed" : payload.media_type === "unknown" ? "missing_media" : "failed";

  await supabase
    .from("creative_asset_analysis")
    .upsert({
      asset_id: payload.asset_id,
      project_id: payload.project_id || job.project_id,
      workspace_id: payload.workspace_id || job.workspace_id,
      user_id: job.user_id,
      status: assetStatus,
      transcript_status: transcriptStatus,
      transcript_error_message: transcriptStatus === "failed" ? message : null,
      analysis_coverage: analysisCoverage,
      analysis_error_message: message,
      error_message: message,
    }, { onConflict: "asset_id" });

  await supabase
    .from("creative_assets")
    .update({
      analysis_status: assetStatus,
      processing_version: payload.processing_version,
      last_processed_at: new Date().toISOString(),
    })
    .eq("id", payload.asset_id);

  const nextStatus = job.attempt_count >= job.max_attempts ? "failed" : "queued";
  const availableAt = nextStatus === "queued"
    ? new Date(Date.now() + Math.min(60_000, 5_000 * Math.max(job.attempt_count, 1))).toISOString()
    : new Date().toISOString();

  await supabase
    .from("creative_asset_jobs")
    .update({
      status: nextStatus,
      available_at: availableAt,
      locked_at: null,
      locked_by: null,
      last_error: message,
      finished_at: nextStatus === "failed" ? new Date().toISOString() : null,
    })
    .eq("id", job.id);
}

async function completeJob(jobId) {
  await supabase
    .from("creative_asset_jobs")
    .update({
      status: "succeeded",
      locked_at: null,
      locked_by: null,
      last_error: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function markAssetProcessing(assetId, mediaType) {
  await supabase
    .from("creative_assets")
    .update({ analysis_status: mediaType === "unknown" ? "missing_media" : "processing" })
    .eq("id", assetId);
}

async function updateAnalysisStage(assetId, patch) {
  await supabase
    .from("creative_asset_analysis")
    .update(patch)
    .eq("asset_id", assetId);
}

async function loadAsset(assetId) {
  const { data, error } = await supabase
    .from("creative_assets")
    .select("id, source_media_url, thumbnail_url, media_storage_path, poster_storage_path")
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia [${response.status}]`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

async function canFetch(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function probeMedia(filePath) {
  const { stdout } = await runCommand(FFPROBE_BIN, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  return JSON.parse(stdout || "{}");
}

async function generatePoster(inputPath, outputPath) {
  await runCommand(FFMPEG_BIN, ["-y", "-ss", "0", "-i", inputPath, "-frames:v", "1", "-q:v", "2", outputPath]);
}

async function generateFrame(inputPath, outputPath, timestampMs) {
  await runCommand(FFMPEG_BIN, [
    "-y",
    "-ss",
    String(timestampMs / 1000),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}

async function extractAudio(inputPath, outputPath) {
  await runCommand(FFMPEG_BIN, [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    outputPath,
  ]);
}

async function extractAudioChunk(inputPath, outputPath, startMs, endMs) {
  const durationSeconds = Math.max(1, (endMs - startMs) / 1000);
  await runCommand(FFMPEG_BIN, [
    "-y",
    "-ss",
    String(startMs / 1000),
    "-t",
    String(durationSeconds),
    "-i",
    inputPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    outputPath,
  ]);
}

async function uploadToStorage({ localPath, storagePath, contentType }) {
  const fileBuffer = await fs.readFile(localPath);
  const { error } = await supabase.storage.from(CREATIVE_BUCKET).upload(storagePath, fileBuffer, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(CREATIVE_BUCKET).getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}

async function runCommand(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function fileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

function normalizeJobPayload(payload) {
  return {
    ...payload,
    media_type: payload?.media_type || "unknown",
    analysis_mode: payload?.analysis_mode || "image",
    processing_version: payload?.processing_version || `${TRANSCRIPTION_PROVIDER}:${TRANSCRIPTION_MODEL}|${ANALYSIS_PROVIDER}:${ANALYSIS_MODEL}|${PROMPT_VERSION}`,
  };
}

function resolveAnalysisApiKey() {
  if (ANALYSIS_PROVIDER === "anthropic") return requiredEnv("ANTHROPIC_API_KEY");
  if (ANALYSIS_PROVIDER === "openai") return requiredEnv("OPENAI_API_KEY");
  if (ANALYSIS_PROVIDER === "openrouter") return requiredEnv("OPENROUTER_API_KEY");
  return requiredEnv("LOVABLE_API_KEY");
}

function resolveAnalysisApiUrl() {
  if (ANALYSIS_PROVIDER === "anthropic") return "https://api.anthropic.com/v1/messages";
  if (ANALYSIS_PROVIDER === "openai") return "https://api.openai.com/v1/chat/completions";
  if (ANALYSIS_PROVIDER === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  return "https://ai.gateway.lovable.dev/v1/chat/completions";
}

function extensionFromUrl(url, fallback) {
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url || "");
  return match?.[1]?.toLowerCase() || fallback;
}

function guessContentType(filePath, mediaType) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return mediaType === "video" ? "video/mp4" : "image/jpeg";
}

function sanitizePathSegment(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

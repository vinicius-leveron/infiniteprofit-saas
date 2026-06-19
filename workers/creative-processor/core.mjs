import crypto from "node:crypto";

export function buildKeyframeTimestamps(durationMs) {
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 3000;
  const raw = [0, 500, 1000, 2000, 3000, Math.min(8000, safeDuration * 0.25)];
  return [...new Set(raw.map((value) => clamp(Math.round(value), 0, safeDuration)))].sort((left, right) => left - right);
}

export function computeAudioChunkPlan({ fileSizeBytes, durationMs, targetBytes = 20 * 1024 * 1024, overlapMs = 1000 }) {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= targetBytes) {
    return [{ startMs: 0, endMs: durationMs, overlapMs: 0 }];
  }

  const safeDuration = Math.max(durationMs, 1000);
  const ratio = targetBytes / fileSizeBytes;
  const chunkDurationMs = Math.max(15_000, Math.floor(safeDuration * ratio * 0.85));
  const plan = [];
  let cursor = 0;

  while (cursor < safeDuration) {
    const startMs = cursor === 0 ? 0 : Math.max(0, cursor - overlapMs);
    const endMs = Math.min(safeDuration, cursor + chunkDurationMs);
    plan.push({ startMs, endMs, overlapMs: cursor === 0 ? 0 : overlapMs });
    if (endMs >= safeDuration) break;
    cursor = endMs;
  }

  return plan;
}

export function mergeTranscriptChunks(chunks) {
  const mergedSegments = [];
  const mergedText = [];

  for (const chunk of chunks) {
    const offsetMs = Number(chunk.offsetMs) || 0;
    for (const segment of chunk.segments ?? []) {
      const startMs = Math.max(0, Math.round(Number(segment.start_ms ?? 0) + offsetMs));
      const endMs = Math.max(startMs, Math.round(Number(segment.end_ms ?? startMs) + offsetMs));
      const text = String(segment.text ?? "").trim();
      if (!text) continue;

      const last = mergedSegments[mergedSegments.length - 1];
      if (last && last.text === text && Math.abs(last.start_ms - startMs) <= 1000) {
        last.end_ms = Math.max(last.end_ms, endMs);
        continue;
      }

      mergedSegments.push({ start_ms: startMs, end_ms: endMs, text });
      mergedText.push(text);
    }
  }

  return {
    text: mergedText.join(" ").trim(),
    segments: mergedSegments,
  };
}

export function normalizeAnalysisResponse(payload) {
  const objectValue = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const tags = Array.isArray(objectValue.tags)
    ? [...new Set(objectValue.tags.map((entry) => String(entry ?? "").trim()).filter(Boolean))]
    : [];
  const scores = normalizeScoreMap(objectValue.scores);

  return {
    summary: stringOrNull(objectValue.summary),
    hook: stringOrNull(objectValue.hook),
    hook_timestamps: normalizeHookTimestamps(objectValue.hook_timestamps ?? objectValue.hookTimestamps),
    angle: stringOrNull(objectValue.angle),
    copy: stringOrNull(objectValue.copy),
    cta: stringOrNull(objectValue.cta),
    visual: stringOrNull(objectValue.visual),
    visual_evidence: normalizeVisualEvidence(objectValue.visual_evidence ?? objectValue.visualEvidence),
    tags,
    scores,
    analysis_coverage: normalizeAnalysisCoverage(objectValue.analysis_coverage ?? objectValue.analysisCoverage),
    errorMessage: stringOrNull(objectValue.errorMessage ?? objectValue.error_message),
  };
}

export function buildProcessingFingerprint(parts) {
  return crypto.createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex");
}

export function computeRetryDelayMs({
  attemptCount,
  baseMs = 10_000,
  maxMs = 15 * 60_000,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  const safeAttempt = Math.max(1, Math.floor(Number(attemptCount) || 1));
  const cappedExponent = Math.min(safeAttempt - 1, 7);
  const exponentialMs = Math.min(maxMs, baseMs * 2 ** cappedExponent);
  const safeJitterRatio = Math.max(0, Math.min(Number(jitterRatio) || 0, 1));
  const jitterWindow = exponentialMs * safeJitterRatio;
  const jitter = jitterWindow === 0 ? 0 : (Number(random()) - 0.5) * 2 * jitterWindow;
  return Math.max(baseMs, Math.min(maxMs, Math.round(exponentialMs + jitter)));
}

export function formatTimestamp(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeHookTimestamps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const startMs = parseMs(entry?.start_ms ?? entry?.startMs ?? entry?.start);
      const endMs = parseMs(entry?.end_ms ?? entry?.endMs ?? entry?.end);
      const label = stringOrNull(entry?.label);
      const reason = stringOrNull(entry?.reason);
      if (startMs == null || endMs == null || !label || !reason) return null;
      return {
        start_ms: startMs,
        end_ms: Math.max(startMs, endMs),
        label,
        reason,
      };
    })
    .filter(Boolean);
}

function normalizeVisualEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const timestampMs = parseMs(entry?.timestamp_ms ?? entry?.timestampMs ?? entry?.timestamp);
      const observation = stringOrNull(entry?.observation);
      if (timestampMs == null || !observation) return null;
      return { timestamp_ms: timestampMs, observation };
    })
    .filter(Boolean);
}

function normalizeScoreMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, score]) => [key, Number(score)])
      .filter((entry) => Number.isFinite(entry[1])),
  );
}

function normalizeAnalysisCoverage(value) {
  return value === "full" || value === "partial" || value === "failed" || value === "not_applicable"
    ? value
    : "full";
}

function parseMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1000 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function stringOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

import { describe, expect, it } from "vitest";
import {
  buildKeyframeTimestamps,
  computeAudioChunkPlan,
  computeRetryDelayMs,
  mergeTranscriptChunks,
  normalizeAnalysisResponse,
} from "../../workers/creative-processor/core.mjs";

describe("creative worker core", () => {
  it("builds deterministic keyframe timestamps with clamping", () => {
    expect(buildKeyframeTimestamps(2400)).toEqual([0, 500, 600, 1000, 2000, 2400]);
    expect(buildKeyframeTimestamps(12000)).toEqual([0, 500, 1000, 2000, 3000]);
  });

  it("creates chunk plan only when audio is oversized", () => {
    expect(computeAudioChunkPlan({ fileSizeBytes: 10 * 1024 * 1024, durationMs: 60_000 })).toEqual([
      { startMs: 0, endMs: 60_000, overlapMs: 0 },
    ]);

    const plan = computeAudioChunkPlan({ fileSizeBytes: 60 * 1024 * 1024, durationMs: 180_000 });
    expect(plan.length).toBeGreaterThan(1);
    expect(plan[1].startMs).toBeLessThan(plan[1].endMs);
  });

  it("merges transcript chunks and removes overlapping duplicates", () => {
    const merged = mergeTranscriptChunks([
      {
        offsetMs: 0,
        segments: [
          { start_ms: 0, end_ms: 1000, text: "primeiro bloco" },
          { start_ms: 1000, end_ms: 2000, text: "segundo bloco" },
        ],
      },
      {
        offsetMs: 1000,
        segments: [
          { start_ms: 0, end_ms: 1000, text: "segundo bloco" },
          { start_ms: 1000, end_ms: 2000, text: "terceiro bloco" },
        ],
      },
    ]);

    expect(merged.segments).toHaveLength(3);
    expect(merged.text).toContain("terceiro bloco");
  });

  it("normalizes multimodal analysis JSON shape", () => {
    const normalized = normalizeAnalysisResponse({
      summary: "Resumo",
      hook: "Gancho",
      hook_timestamps: [{ start_ms: 0, end_ms: 1200, label: "Abertura", reason: "Promessa" }],
      visual_evidence: [{ timestamp_ms: 0, observation: "Close no rosto" }],
      tags: ["hook", "escala"],
      scores: { hook: 90, clareza: 84 },
      analysis_coverage: "full",
    });

    expect(normalized.hook).toBe("Gancho");
    expect(normalized.hook_timestamps).toHaveLength(1);
    expect(normalized.visual_evidence).toHaveLength(1);
    expect(normalized.scores.hook).toBe(90);
  });

  it("computes bounded exponential retry delays with deterministic jitter", () => {
    expect(computeRetryDelayMs({ attemptCount: 1, jitterRatio: 0, baseMs: 10_000 })).toBe(10_000);
    expect(computeRetryDelayMs({ attemptCount: 4, jitterRatio: 0, baseMs: 10_000 })).toBe(80_000);
    expect(computeRetryDelayMs({ attemptCount: 99, jitterRatio: 0, baseMs: 10_000, maxMs: 900_000 })).toBe(900_000);
    expect(computeRetryDelayMs({ attemptCount: 2, jitterRatio: 0.2, random: () => 1 })).toBe(24_000);
  });
});

import { supabase } from "@/integrations/supabase/client";

const VTURB_SYNC_BATCH_SIZE = 10;
const VTURB_SYNC_MAX_BATCHES = 20;

export type VturbSyncResult = {
  errors: string[];
  batches: number;
  playersProcessed: number;
  playersTotal: number | null;
};

type VturbPullPayload = {
  error?: unknown;
  results?: Array<{
    error?: unknown;
    batch?: {
      players_total?: unknown;
      players_processed?: unknown;
      next_cursor?: unknown;
      has_more?: unknown;
    };
  }>;
};

export async function syncVturbUntilDone(args: {
  projectId: string;
  days?: number;
  playerId?: string;
}): Promise<VturbSyncResult> {
  const errors: string[] = [];
  let batchCursor = 0;
  let hasMore = true;
  let batches = 0;
  let playersProcessed = 0;
  let playersTotal: number | null = null;

  while (hasMore) {
    if (batches >= VTURB_SYNC_MAX_BATCHES) {
      throw new Error("Sync VTurb interrompido: limite de lotes atingido");
    }

    const { data, error } = await supabase.functions.invoke("vturb-pull", {
      body: {
        project_id: args.projectId,
        days: args.days ?? 30,
        ...(args.playerId
          ? { player_id: args.playerId }
          : { batch_cursor: batchCursor, batch_size: VTURB_SYNC_BATCH_SIZE }),
      },
    });

    const payload = data as VturbPullPayload | null;
    if (error?.message) errors.push(error.message);
    errors.push(...extractVturbSyncErrors(payload));
    batches += 1;

    const batch = extractVturbBatch(payload);
    playersProcessed += batch?.playersProcessed ?? 0;
    playersTotal = batch?.playersTotal ?? playersTotal;
    hasMore = !args.playerId && Boolean(batch?.hasMore && batch.nextCursor !== null);
    batchCursor = batch?.nextCursor ?? 0;

    if (errors.length > 0) break;
  }

  return {
    errors: [...new Set(errors)],
    batches,
    playersProcessed,
    playersTotal,
  };
}

export function extractVturbSyncErrors(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const errors: string[] = [];
  const record = payload as VturbPullPayload;
  if (typeof record.error === "string" && record.error.trim()) {
    errors.push(record.error.trim());
  }

  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const message = result.error;
      if (typeof message === "string" && message.trim()) {
        errors.push(message.trim());
      }
    }
  }

  return [...new Set(errors)];
}

function extractVturbBatch(payload: VturbPullPayload | null) {
  const batch = payload?.results?.find((result) => result.batch)?.batch;
  if (!batch) return null;

  const playersTotal = numericOrNull(batch.players_total);
  const playersProcessed = numericOrNull(batch.players_processed) ?? 0;
  const nextCursor = numericOrNull(batch.next_cursor);

  return {
    playersTotal,
    playersProcessed,
    nextCursor,
    hasMore: batch.has_more === true,
  };
}

function numericOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

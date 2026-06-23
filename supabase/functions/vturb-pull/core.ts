export const VTURB_DEFAULT_PLAYER_BATCH_SIZE = 10;
export const VTURB_MAX_PLAYER_BATCH_SIZE = 20;

export type VturbBatchOptions = {
  batchCursor: number;
  batchSize: number;
  hasExplicitCursor: boolean;
};

export type VturbPlayerBatch<T> = {
  players: T[];
  totalPlayers: number;
  batchCursor: number;
  batchSize: number;
  playersProcessed: number;
  nextCursor: number | null;
  hasMore: boolean;
};

export function parseVturbBatchOptions(body: Record<string, unknown>): VturbBatchOptions {
  const hasExplicitCursor = body.batch_cursor !== undefined || body.cursor !== undefined;
  const rawCursor = body.batch_cursor ?? body.cursor ?? 0;
  const rawBatchSize = body.batch_size ?? body.max_players ?? VTURB_DEFAULT_PLAYER_BATCH_SIZE;
  const parsedCursor = Number(rawCursor);
  const parsedBatchSize = Number(rawBatchSize);

  return {
    batchCursor: Number.isFinite(parsedCursor) && parsedCursor > 0 ? Math.floor(parsedCursor) : 0,
    batchSize: Math.min(
      Math.max(
        Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
          ? Math.floor(parsedBatchSize)
          : VTURB_DEFAULT_PLAYER_BATCH_SIZE,
        1,
      ),
      VTURB_MAX_PLAYER_BATCH_SIZE,
    ),
    hasExplicitCursor,
  };
}

export function selectVturbPlayerBatch<T>(
  players: T[],
  options: {
    batchCursor: number;
    batchSize: number;
    targetPlayerId?: string | null;
  },
): VturbPlayerBatch<T> {
  const totalPlayers = players.length;
  if (options.targetPlayerId) {
    return {
      players,
      totalPlayers,
      batchCursor: 0,
      batchSize: totalPlayers,
      playersProcessed: players.length,
      nextCursor: null,
      hasMore: false,
    };
  }

  const batchCursor = Math.min(Math.max(options.batchCursor, 0), totalPlayers);
  const batchSize = Math.max(options.batchSize, 1);
  const selectedPlayers = players.slice(batchCursor, batchCursor + batchSize);
  const nextCursor = batchCursor + selectedPlayers.length < totalPlayers
    ? batchCursor + selectedPlayers.length
    : null;

  return {
    players: selectedPlayers,
    totalPlayers,
    batchCursor,
    batchSize,
    playersProcessed: selectedPlayers.length,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

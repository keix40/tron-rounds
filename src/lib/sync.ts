import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { firstRow } from "@/db/rows";
import { rounds, type NewRound } from "@/db/schema";
import { deriveRoundOutcome } from "@/lib/digit";
import {
  anchorDateForRound,
  enumerateRoundKeys,
  nextRoundKey,
  syncableRoundAnchor,
  previousRoundKey,
  roundMetaFromUtcDate,
  targetTimestampSecond54,
  formatRoundId,
} from "@/lib/round";
import {
  TronRpcClient,
  blockTimestampSeconds,
  findBlockAtOrAfterSecond54,
} from "@/lib/tron-rpc";

const SYNC_LOCK_KEY = 894_032_117;
const completedAnchorNow = () => syncableRoundAnchor();

export type SyncOptions = {
  maxRounds?: number;
  timeBudgetMs?: number;
  rpc?: TronRpcClient;
};

export type SyncResult = {
  inserted: number;
  skipped: number;
  lastRoundId: string | null;
  stale: boolean;
};

function blockToRound(row: {
  utcDate: string;
  roundNumber: number;
  blockNumber: number;
  blockHash: string;
  blockTimeUtc: Date;
}): NewRound {
  const outcome = deriveRoundOutcome(row.blockHash);
  return {
    utcDate: row.utcDate,
    roundNumber: row.roundNumber,
    roundId: formatRoundId(row.roundNumber),
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    hashTail: outcome.hashTail,
    resultDigit: outcome.resultDigit,
    side: outcome.side,
    parity: outcome.parity,
    blockTimeUtc: row.blockTimeUtc,
  };
}

export async function syncRounds(options: SyncOptions = {}): Promise<SyncResult> {
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 30, 500));
  // Bound work per request so serverless functions stay well under their time limit.
  const deadline = Date.now() + (options.timeBudgetMs ?? 7000);
  const rpc = options.rpc ?? new TronRpcClient();
  const db = getDb();

  // Transaction-scoped advisory lock: safe behind Neon's transaction-mode pooler and a
  // multi-connection client (a session lock could be taken and released on different
  // connections and leak forever). Auto-released on commit/rollback.
  return db.transaction(async (tx) => {
    const lockRows = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS locked`,
    );
    if (!firstRow<{ locked: boolean }>(lockRows)?.locked) {
      return { inserted: 0, skipped: 0, lastRoundId: null, stale: true };
    }

    const latestRows = await tx
      .select()
      .from(rounds)
      .orderBy(desc(rounds.blockTimeUtc))
      .limit(1);

    const endAnchor = completedAnchorNow();
    const endMeta = roundMetaFromUtcDate(endAnchor);

    let startKey: { utcDate: string; roundNumber: number };
    let startBlockHint: number;

    if (latestRows.length === 0) {
      const bootstrapAnchor = new Date(endAnchor);
      bootstrapAnchor.setUTCMinutes(bootstrapAnchor.getUTCMinutes() - (maxRounds - 1));
      startKey = roundMetaFromUtcDate(bootstrapAnchor);
      const latestBn = await rpc.getLatestBlockNumber();
      startBlockHint = latestBn - 20 * maxRounds;
    } else {
      const last = latestRows[0]!;
      startKey = nextRoundKey(last.utcDate, last.roundNumber);
      startBlockHint = last.blockNumber + 20;
    }

    const lastKnown = latestRows[0]
      ? `${latestRows[0].utcDate}:${latestRows[0].roundNumber}`
      : null;
    const endKey = `${endMeta.utcDate}:${endMeta.roundNumber}`;
    if (lastKnown === endKey) {
      return { inserted: 0, skipped: 0, lastRoundId: latestRows[0]!.roundId, stale: false };
    }

    const keys = enumerateRoundKeys(startKey, endMeta).slice(0, maxRounds);
    let inserted = 0;
    let skipped = 0;
    let hint = startBlockHint;
    let lastDone: { utcDate: string; roundNumber: number } | null = null;

    for (const key of keys) {
      if (Date.now() > deadline) break;
      const anchor = anchorDateForRound(key.utcDate, key.roundNumber);
      const targetTs = targetTimestampSecond54(anchor);
      let found: Awaited<ReturnType<typeof findBlockAtOrAfterSecond54>>;
      try {
        found = await findBlockAtOrAfterSecond54(rpc, targetTs, hint);
      } catch {
        // e.g. hint past chain head or TronGrid hiccup: stop here, the next sync resumes.
        break;
      }
      const { block, blockNumber } = found;
      hint = blockNumber + 20;
      const ts = blockTimestampSeconds(block);

      const row = blockToRound({
        utcDate: key.utcDate,
        roundNumber: key.roundNumber,
        blockNumber,
        blockHash: block.hash,
        blockTimeUtc: new Date(ts * 1000),
      });

      const res = await tx.insert(rounds).values(row).onConflictDoNothing().returning();
      if (res.length > 0) inserted += 1;
      else skipped += 1;
      lastDone = key;
    }

    const stillBehind =
      !lastDone || lastDone.utcDate !== endMeta.utcDate || lastDone.roundNumber !== endMeta.roundNumber;

    return {
      inserted,
      skipped,
      lastRoundId: lastDone ? formatRoundId(lastDone.roundNumber) : null,
      stale: stillBehind,
    };
  });
}

/** For backfill: fetch a single round with hint block. */
export async function fetchAndStoreRound(
  utcDate: string,
  roundNumber: number,
  startBlockHint: number,
  rpc: TronRpcClient,
): Promise<{ blockNumber: number; inserted: boolean }> {
  const db = getDb();
  const existing = await db
    .select({ blockNumber: rounds.blockNumber })
    .from(rounds)
    .where(and(eq(rounds.utcDate, utcDate), eq(rounds.roundNumber, roundNumber)))
    .limit(1);
  if (existing.length > 0) {
    return { blockNumber: existing[0]!.blockNumber, inserted: false };
  }

  const anchor = anchorDateForRound(utcDate, roundNumber);
  const targetTs = targetTimestampSecond54(anchor);
  const { block, blockNumber } = await findBlockAtOrAfterSecond54(rpc, targetTs, startBlockHint);
  const ts = blockTimestampSeconds(block);
  const row = blockToRound({
    utcDate,
    roundNumber,
    blockNumber,
    blockHash: block.hash,
    blockTimeUtc: new Date(ts * 1000),
  });
  await db.insert(rounds).values(row).onConflictDoNothing();
  return { blockNumber, inserted: true };
}

export async function getSyncStatus(): Promise<{
  lastRound: (typeof rounds.$inferSelect) | null;
  latestCompleted: ReturnType<typeof roundMetaFromUtcDate>;
  isStale: boolean;
}> {
  const db = getDb();
  const latestRows = await db.select().from(rounds).orderBy(desc(rounds.blockTimeUtc)).limit(1);
  const endAnchor = completedAnchorNow();
  const latestCompleted = roundMetaFromUtcDate(endAnchor);
  const last = latestRows[0] ?? null;
  let isStale = true;
  if (last) {
    isStale =
      last.utcDate !== latestCompleted.utcDate ||
      last.roundNumber !== latestCompleted.roundNumber;
  }
  return { lastRound: last, latestCompleted, isStale };
}

export { previousRoundKey };

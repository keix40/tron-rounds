import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rounds, type NewRound } from "@/db/schema";
import { deriveRoundOutcome } from "@/lib/digit";
import {
  anchorDateForRound,
  enumerateRoundKeys,
  latestCompletedRoundAnchor,
  nextRoundKey,
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

export type SyncOptions = {
  maxRounds?: number;
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

async function tryAdvisoryLock(): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_lock(${SYNC_LOCK_KEY}) AS locked`,
  );
  const locked = rows[0]?.locked;
  return Boolean(locked);
}

async function releaseAdvisoryLock(): Promise<void> {
  const db = getDb();
  await db.execute(sql`SELECT pg_advisory_unlock(${SYNC_LOCK_KEY})`);
}

export async function syncRounds(options: SyncOptions = {}): Promise<SyncResult> {
  const maxRounds = options.maxRounds ?? 30;
  const rpc = options.rpc ?? new TronRpcClient();
  const db = getDb();

  const locked = await tryAdvisoryLock();
  if (!locked) {
    return { inserted: 0, skipped: 0, lastRoundId: null, stale: true };
  }

  try {
    const latestRows = await db
      .select()
      .from(rounds)
      .orderBy(desc(rounds.blockTimeUtc))
      .limit(1);

    const endAnchor = latestCompletedRoundAnchor();
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

    const keys = enumerateRoundKeys(startKey, endMeta).slice(0, maxRounds);
    if (keys.length === 0) {
      return {
        inserted: 0,
        skipped: 0,
        lastRoundId: latestRows[0]?.roundId ?? null,
        stale: false,
      };
    }

    let inserted = 0;
    let skipped = 0;
    let hint = startBlockHint;

    for (const key of keys) {
      const anchor = anchorDateForRound(key.utcDate, key.roundNumber);
      const targetTs = targetTimestampSecond54(anchor);
      const { block, blockNumber } = await findBlockAtOrAfterSecond54(rpc, targetTs, hint);
      hint = blockNumber + 20;
      const ts = blockTimestampSeconds(block);
      const blockTimeUtc = new Date(ts * 1000);

      const row = blockToRound({
        utcDate: key.utcDate,
        roundNumber: key.roundNumber,
        blockNumber,
        blockHash: block.hash,
        blockTimeUtc,
      });

      try {
        await db.insert(rounds).values(row).onConflictDoNothing();
        inserted += 1;
      } catch {
        skipped += 1;
      }
    }

    const lastKey = keys[keys.length - 1]!;
    const stillBehind =
      lastKey.utcDate !== endMeta.utcDate || lastKey.roundNumber !== endMeta.roundNumber;

    return {
      inserted,
      skipped,
      lastRoundId: formatRoundId(lastKey.roundNumber),
      stale: stillBehind,
    };
  } finally {
    await releaseAdvisoryLock();
  }
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
  const endAnchor = latestCompletedRoundAnchor();
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

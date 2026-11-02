import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { firstRow } from "@/db/rows";
import { rounds, type NewRound } from "@/db/schema";
import { deriveRoundOutcome } from "@/lib/digit";
import {
  anchorDateForRound,
  collectMissingRoundKeysNewestFirst,
  previousRoundKey,
  roundMetaFromUtcDate,
  syncableRoundAnchor,
  targetTimestampSecond54,
  formatRoundId,
  type RoundKey,
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

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function roundExists(tx: DbTx, key: RoundKey): Promise<boolean> {
  const rows = await tx
    .select({ n: rounds.roundNumber })
    .from(rounds)
    .where(and(eq(rounds.utcDate, key.utcDate), eq(rounds.roundNumber, key.roundNumber)))
    .limit(1);
  return rows.length > 0;
}

/** Load which keys in the candidate list are missing (for async DB). */
export async function planMissingRoundKeysNewestFirst(
  end: RoundKey,
  exists: (key: RoundKey) => Promise<boolean>,
  maxRounds: number,
): Promise<RoundKey[]> {
  const out: RoundKey[] = [];
  let cur: RoundKey = { ...end };
  for (let i = 0; i < maxRounds; i++) {
    if (await exists(cur)) break;
    out.push({ ...cur });
    cur = previousRoundKey(cur.utcDate, cur.roundNumber);
  }
  return out;
}

export const GAP_LOOKBACK_HOURS = 48;

/** Missing round keys in the lookback window ending at `end`, newest first. */
async function findMissingRoundKeysNewestFirst(
  tx: DbTx,
  end: Date,
  limit: number,
): Promise<RoundKey[]> {
  const endIso = end.toISOString();
  const res = await tx.execute<{ utc_date: string; round_number: number }>(sql`
    SELECT to_char(gs AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS utc_date,
           (extract(hour FROM gs AT TIME ZONE 'UTC') * 60
             + extract(minute FROM gs AT TIME ZONE 'UTC') + 1)::int AS round_number
    FROM generate_series(
      ${endIso}::timestamptz - make_interval(hours => ${GAP_LOOKBACK_HOURS}),
      ${endIso}::timestamptz,
      interval '1 minute'
    ) AS gs
    WHERE NOT EXISTS (
      SELECT 1 FROM rounds r
      WHERE r.utc_date = to_char(gs AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        AND r.round_number = (extract(hour FROM gs AT TIME ZONE 'UTC') * 60
             + extract(minute FROM gs AT TIME ZONE 'UTC') + 1)::int
    )
    ORDER BY gs DESC
    LIMIT ${limit}
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<{
    utc_date: string;
    round_number: number;
  }>;
  return rows.map((r) => ({ utcDate: r.utc_date, roundNumber: Number(r.round_number) }));
}

export async function syncRounds(options: SyncOptions = {}): Promise<SyncResult> {
  const maxRounds = Math.max(1, Math.min(options.maxRounds ?? 30, 500));
  const deadline = Date.now() + (options.timeBudgetMs ?? 7000);
  const rpc = options.rpc ?? new TronRpcClient();
  const db = getDb();

  return db.transaction(async (tx) => {
    const lockRows = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS locked`,
    );
    if (!firstRow<{ locked: boolean }>(lockRows)?.locked) {
      return { inserted: 0, skipped: 0, lastRoundId: null, stale: true };
    }

    const endAnchor = completedAnchorNow();
    const endMeta = roundMetaFromUtcDate(endAnchor);
    const endKey: RoundKey = { utcDate: endMeta.utcDate, roundNumber: endMeta.roundNumber };

    // Tip-first walk, then any older holes in the lookback window. A plain
    // tip walk stops at the first stored round, so gaps left by slow or
    // skipped cron runs were never filled.
    const tipRun = await planMissingRoundKeysNewestFirst(endKey, (key) => roundExists(tx, key), maxRounds);
    const toSync = [...tipRun];
    if (toSync.length < maxRounds) {
      const seen = new Set(toSync.map((k) => `${k.utcDate}:${k.roundNumber}`));
      const holes = await findMissingRoundKeysNewestFirst(tx, endAnchor, maxRounds);
      for (const k of holes) {
        if (toSync.length >= maxRounds) break;
        if (!seen.has(`${k.utcDate}:${k.roundNumber}`)) toSync.push(k);
      }
    }

    if (toSync.length === 0) {
      const tipRows = await tx
        .select({ roundId: rounds.roundId })
        .from(rounds)
        .where(and(eq(rounds.utcDate, endKey.utcDate), eq(rounds.roundNumber, endKey.roundNumber)))
        .limit(1);
      return {
        inserted: 0,
        skipped: 0,
        lastRoundId: tipRows[0]?.roundId ?? null,
        stale: false,
      };
    }

    // Newest-first: start from chain head; each older round uses the prior block hint.
    let hint = (await rpc.getLatestBlockNumber()) - 20;

    let inserted = 0;
    let skipped = 0;
    let lastDone: RoundKey | null = null;

    for (const key of toSync) {
      if (Date.now() > deadline) break;
      const anchor = anchorDateForRound(key.utcDate, key.roundNumber);
      const targetTs = targetTimestampSecond54(anchor);
      let found: Awaited<ReturnType<typeof findBlockAtOrAfterSecond54>>;
      try {
        found = await findBlockAtOrAfterSecond54(rpc, targetTs, hint);
      } catch {
        break;
      }
      const { block, blockNumber } = found;
      hint = blockNumber - 20;
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

    const tipStored = await roundExists(tx, endKey);

    return {
      inserted,
      skipped,
      lastRoundId: lastDone ? formatRoundId(lastDone.roundNumber) : null,
      stale: !tipStored,
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

  const tipRows = await db
    .select({ roundNumber: rounds.roundNumber })
    .from(rounds)
    .where(
      and(
        eq(rounds.utcDate, latestCompleted.utcDate),
        eq(rounds.roundNumber, latestCompleted.roundNumber),
      ),
    )
    .limit(1);

  return { lastRound: last, latestCompleted, isStale: tipRows.length === 0 };
}

export { previousRoundKey, collectMissingRoundKeysNewestFirst };

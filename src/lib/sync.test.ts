import { afterEach, describe, expect, it, vi } from "vitest";
import { desc } from "drizzle-orm";
import { getDb, closeDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { anchorDateForRound, syncableRoundAnchor, SYNC_FINALITY_LAG_MS } from "@/lib/round";
import { syncRounds } from "@/lib/sync";
import * as tronRpc from "@/lib/tron-rpc";
import { TronRpcClient } from "@/lib/tron-rpc";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("syncableRoundAnchor (:54 grace)", () => {
  it("keeps previous minute until ~3.5s after :54", () => {
    const at554 = new Date("2026-10-05T07:10:54.000Z");
    expect(syncableRoundAnchor(at554).toISOString()).toBe("2026-10-05T07:09:00.000Z");

    const at557 = new Date("2026-10-05T07:10:57.499Z");
    expect(syncableRoundAnchor(at557).toISOString()).toBe("2026-10-05T07:09:00.000Z");
  });

  it("includes current minute once :54 is 3.5s in the past", () => {
    const at5575 = new Date("2026-10-05T07:10:57.500Z");
    expect(syncableRoundAnchor(at5575).toISOString()).toBe("2026-10-05T07:10:00.000Z");

    const at600 = new Date("2026-10-05T07:11:00.000Z");
    expect(syncableRoundAnchor(at600).toISOString()).toBe("2026-10-05T07:10:00.000Z");
  });

  it("uses SYNC_FINALITY_LAG_MS constant (~3.5s)", () => {
    expect(SYNC_FINALITY_LAG_MS).toBe(3500);
  });
});

function installDelayedBlockLookup(perCallMs: number, blockNumberBase = 90_000_000): TronRpcClient {
  const rpc = new TronRpcClient({ minIntervalMs: 0 });
  vi.spyOn(rpc, "getLatestBlockNumber").mockResolvedValue(blockNumberBase + 5000);
  let seq = 0;
  vi.spyOn(tronRpc, "findBlockAtOrAfterSecond54").mockImplementation(async (_rpc, targetTs, hint) => {
    await new Promise((r) => setTimeout(r, perCallMs));
    seq += 1;
    const blockNumber = hint + seq;
    return {
      blockNumber,
      block: {
        number: `0x${blockNumber.toString(16)}`,
        hash: `0x${"a".repeat(63)}3`,
        timestamp: `0x${targetTs.toString(16)}`,
      },
    };
  });
  return rpc;
}

describe.skipIf(!hasDb)("syncRounds integration", () => {
  afterEach(async () => {
    await closeDb();
    vi.restoreAllMocks();
  });

  it("bounds work by timeBudgetMs", async () => {
    const db = getDb();
    await db.delete(rounds);

    const endAnchor = syncableRoundAnchor();
    const endRound =
      endAnchor.getUTCHours() * 60 + endAnchor.getUTCMinutes() + 1;
    const utcDate = endAnchor.toISOString().slice(0, 10);
    await db.insert(rounds).values({
      utcDate,
      roundNumber: endRound - 80,
      roundId: `202**${String(endRound - 80).padStart(4, "0")}`,
      blockNumber: 87_000_000,
      blockHash: `0x${"d".repeat(63)}2`,
      hashTail: "0002",
      resultDigit: 2,
      side: "S",
      parity: "Even",
      blockTimeUtc: new Date(endAnchor.getTime() - 80 * 60_000),
    });

    const rpc = installDelayedBlockLookup(400);
    const started = Date.now();
    const result = await syncRounds({
      rpc,
      maxRounds: 500,
      timeBudgetMs: 1200,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(4000);
    expect(result.inserted).toBeGreaterThan(0);
    expect(result.inserted).toBeLessThan(10);
    expect(result.inserted).toBeLessThan(80);
  }, 15000);

  it("prioritizes newest missing rounds when older history exists", async () => {
    const db = getDb();
    await db.delete(rounds);

    const endAnchor = syncableRoundAnchor();
    const endMeta = {
      utcDate: endAnchor.toISOString().slice(0, 10),
      roundNumber: endAnchor.getUTCHours() * 60 + endAnchor.getUTCMinutes() + 1,
    };
    const staleAnchor = anchorDateForRound(endMeta.utcDate, endMeta.roundNumber - 50);
    await db.insert(rounds).values({
      utcDate: endMeta.utcDate,
      roundNumber: endMeta.roundNumber - 50,
      roundId: `202**${String(endMeta.roundNumber - 50).padStart(4, "0")}`,
      blockNumber: 88_000_000,
      blockHash: `0x${"c".repeat(63)}4`,
      hashTail: "0004",
      resultDigit: 4,
      side: "S",
      parity: "Even",
      blockTimeUtc: staleAnchor,
    });

    const rpc = installDelayedBlockLookup(50);
    const result = await syncRounds({ rpc, maxRounds: 5, timeBudgetMs: 8000 });
    expect(result.inserted).toBe(5);

    const rows = await db
      .select({ roundNumber: rounds.roundNumber })
      .from(rounds)
      .orderBy(desc(rounds.roundNumber))
      .limit(5);
    expect(rows[0]!.roundNumber).toBe(endMeta.roundNumber);
    expect(rows.map((r) => r.roundNumber)).toEqual([
      endMeta.roundNumber,
      endMeta.roundNumber - 1,
      endMeta.roundNumber - 2,
      endMeta.roundNumber - 3,
      endMeta.roundNumber - 4,
    ]);
  }, 20000);

  it("serializes concurrent syncs with xact advisory lock", async () => {
    const db = getDb();
    await db.delete(rounds);

    const rpc = installDelayedBlockLookup(250);
    const [a, b] = await Promise.all([
      syncRounds({ rpc, maxRounds: 12, timeBudgetMs: 8000 }),
      syncRounds({ rpc, maxRounds: 12, timeBudgetMs: 8000 }),
    ]);

    const totalInserted = a.inserted + b.inserted;
    expect(totalInserted).toBeGreaterThan(0);
    expect(totalInserted).toBeLessThanOrEqual(12);

    const blocked = [a, b].filter((r) => r.inserted === 0 && r.stale);
    expect(blocked.length).toBe(1);

    const after = await syncRounds({ rpc, maxRounds: 2, timeBudgetMs: 8000 });
    expect(after.inserted + after.skipped).toBeGreaterThanOrEqual(0);
  }, 20000);
});

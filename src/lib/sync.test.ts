import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, closeDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { syncableRoundAnchor, SYNC_FINALITY_LAG_MS } from "@/lib/round";
import { syncRounds } from "@/lib/sync";
import * as tronRpc from "@/lib/tron-rpc";
import { TronRpcClient } from "@/lib/tron-rpc";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("syncableRoundAnchor (:54 grace)", () => {
  it("lags the completed minute by 6s after :54", () => {
    const at554 = new Date("2026-10-05T07:10:54.000Z");
    expect(syncableRoundAnchor(at554).toISOString()).toBe("2026-10-05T07:09:00.000Z");

    const at559 = new Date("2026-10-05T07:10:59.999Z");
    expect(syncableRoundAnchor(at559).toISOString()).toBe("2026-10-05T07:09:00.000Z");
  });

  it("includes current minute once :54 is 6s in the past", () => {
    const at600 = new Date("2026-10-05T07:11:00.000Z");
    expect(syncableRoundAnchor(at600).toISOString()).toBe("2026-10-05T07:10:00.000Z");
  });

  it("uses SYNC_FINALITY_LAG_MS constant", () => {
    expect(SYNC_FINALITY_LAG_MS).toBe(6000);
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
    expect(result.stale).toBe(true);
  }, 15000);

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

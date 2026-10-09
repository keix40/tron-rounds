import { desc } from "drizzle-orm";
import { getDb, closeDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { enumerateRoundKeys, roundMetaFromUtcDate } from "@/lib/round";
import { fetchAndStoreRound } from "@/lib/sync";
import { TronRpcClient } from "@/lib/tron-rpc";

function parseArgs(): { days: number } {
  const args = process.argv.slice(2);
  let days = 14;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = Number(args[i + 1]);
      i += 1;
    }
  }
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("Invalid --days");
  }
  return { days };
}

async function main() {
  const { days } = parseArgs();
  const rpc = new TronRpcClient({ minIntervalMs: 100 });
  const db = getDb();

  const endAnchor = new Date();
  endAnchor.setUTCSeconds(0, 0);
  if (endAnchor.getUTCSeconds() < 54) {
    endAnchor.setUTCMinutes(endAnchor.getUTCMinutes() - 1);
  }
  const endMeta = roundMetaFromUtcDate(endAnchor);

  const startDate = new Date(endAnchor);
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const startMeta = roundMetaFromUtcDate(startDate);

  const keys = enumerateRoundKeys(startMeta, endMeta);
  console.log(`Backfill ${keys.length} rounds (~${days} days)`);

  let hint: number;
  const latest = await db.select().from(rounds).orderBy(desc(rounds.blockNumber)).limit(1);
  if (latest.length > 0) {
    hint = latest[0]!.blockNumber - 20 * 60 * days;
  } else {
    hint = (await rpc.getLatestBlockNumber()) - 20 * 60 * 24 * days;
  }

  const started = Date.now();
  let inserted = 0;
  let processed = 0;

  for (const key of keys) {
    const prevHint = hint;
    const result = await fetchAndStoreRound(key.utcDate, key.roundNumber, hint, rpc);
    hint = result.blockNumber + 20;
    if (result.inserted) inserted += 1;
    processed += 1;
    if (processed % 100 === 0) {
      const elapsedMin = (Date.now() - started) / 60000;
      const rpm = elapsedMin > 0 ? (processed / elapsedMin).toFixed(1) : "—";
      console.log(`Progress ${processed}/${keys.length} inserted=${inserted} ~${rpm} rounds/min hint=${prevHint}`);
    }
  }

  const elapsedMin = (Date.now() - started) / 60000;
  console.log(
    `Done. Processed ${processed}, inserted ${inserted}, ${(processed / Math.max(elapsedMin, 0.01)).toFixed(1)} rounds/min`,
  );
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});

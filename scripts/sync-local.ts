import { count, desc } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { syncRounds } from "@/lib/sync";

async function main() {
  const max = Number(process.argv[2] ?? 30);
  let result = await syncRounds({ maxRounds: max });
  console.log(result);
  while (result.stale && result.inserted > 0) {
    result = await syncRounds({ maxRounds: max });
    console.log(result);
  }
  const db = getDb();
  const total = await db.select({ c: count() }).from(rounds);
  const latest = await db.select().from(rounds).orderBy(desc(rounds.blockTimeUtc)).limit(5);
  console.log("total", total[0]?.c);
  console.log(
    "latest",
    latest.map((r) => `${r.roundId} block=${r.blockNumber} ${r.side}`),
  );
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});

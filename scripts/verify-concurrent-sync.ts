/**
 * Manual verification: transaction advisory lock + time budget against real Postgres.
 */
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { firstRow } from "@/db/rows";
import { rounds } from "@/db/schema";
import { syncRounds } from "@/lib/sync";
import { TronRpcClient } from "@/lib/tron-rpc";

async function main() {
  const db = getDb();
  const locks = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory'`,
  );
  console.log("advisory locks before", firstRow<{ count: string }>(locks)?.count);

  await db.delete(rounds);

  const rpc = new TronRpcClient({ minIntervalMs: 80 });
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    syncRounds({ rpc, maxRounds: 15, timeBudgetMs: 7000 }),
    syncRounds({ rpc, maxRounds: 15, timeBudgetMs: 7000 }),
  ]);
  console.log("concurrent results", { a, b, ms: Date.now() - t0 });

  const locksAfter = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory'`,
  );
  console.log("advisory locks after", firstRow<{ count: string }>(locksAfter)?.count);

  const budget = await syncRounds({ rpc, maxRounds: 500, timeBudgetMs: 2000 });
  console.log("time-budget run", budget);

  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});

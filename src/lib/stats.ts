import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rounds } from "@/db/schema";
import type { StatsQuery } from "@/lib/query-params";
import { buildRoundFilters } from "@/lib/filters";

export type DescriptiveStats = {
  total: number;
  bySide: { S: number; B: number };
  byParity: { Odd: number; Even: number };
  byDigit: Record<string, number>;
};

export async function computeStats(q: StatsQuery): Promise<DescriptiveStats> {
  const db = getDb();
  const where = buildRoundFilters(q);

  const totalRows = await db
    .select({ c: count() })
    .from(rounds)
    .where(where);
  const total = Number(totalRows[0]?.c ?? 0);

  const sideRows = await db
    .select({ side: rounds.side, c: count() })
    .from(rounds)
    .where(where)
    .groupBy(rounds.side);
  const bySide = { S: 0, B: 0 };
  for (const row of sideRows) {
    if (row.side === "S" || row.side === "B") {
      bySide[row.side] = Number(row.c);
    }
  }

  const parityRows = await db
    .select({ parity: rounds.parity, c: count() })
    .from(rounds)
    .where(where)
    .groupBy(rounds.parity);
  const byParity = { Odd: 0, Even: 0 };
  for (const row of parityRows) {
    if (row.parity === "Odd" || row.parity === "Even") {
      byParity[row.parity] = Number(row.c);
    }
  }

  const digitRows = await db
    .select({ digit: rounds.resultDigit, c: count() })
    .from(rounds)
    .where(where)
    .groupBy(rounds.resultDigit);

  const byDigit: Record<string, number> = {};
  for (let d = 0; d <= 9; d++) byDigit[String(d)] = 0;
  for (const row of digitRows) {
    byDigit[String(row.digit)] = Number(row.c);
  }

  return { total, bySide, byParity, byDigit };
}

import { and, asc, desc, eq, gte, lte, SQL } from "drizzle-orm";
import { rounds } from "@/db/schema";
import type { RoundsQuery, SortColumn } from "@/lib/query-params";
import { parseFilterDate } from "@/lib/query-params";

const sortColumnMap: Record<SortColumn, (typeof rounds)[SortColumn]> = {
  roundId: rounds.roundId,
  blockNumber: rounds.blockNumber,
  blockHash: rounds.blockHash,
  hashTail: rounds.hashTail,
  resultDigit: rounds.resultDigit,
  side: rounds.side,
  parity: rounds.parity,
  blockTimeUtc: rounds.blockTimeUtc,
};

export function buildRoundFilters(q: Pick<RoundsQuery, "side" | "parity" | "digit" | "dateFrom" | "dateTo" | "tz">): SQL | undefined {
  const parts: SQL[] = [];
  if (q.side) parts.push(eq(rounds.side, q.side));
  if (q.parity) parts.push(eq(rounds.parity, q.parity));
  if (q.digit !== undefined) parts.push(eq(rounds.resultDigit, q.digit));
  if (q.dateFrom) {
    parts.push(gte(rounds.blockTimeUtc, parseFilterDate(q.dateFrom, q.tz, false)));
  }
  if (q.dateTo) {
    parts.push(lte(rounds.blockTimeUtc, parseFilterDate(q.dateTo, q.tz, true)));
  }
  if (parts.length === 0) return undefined;
  return and(...parts);
}

export function buildOrderBy(q: Pick<RoundsQuery, "sort" | "order">) {
  const col = sortColumnMap[q.sort];
  return q.order === "asc" ? asc(col) : desc(col);
}

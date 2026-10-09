import { count } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { buildOrderBy, buildRoundFilters } from "@/lib/filters";
import { parseRoundsQuery } from "@/lib/query-params";
import { syncRounds, getSyncStatus } from "@/lib/sync";
import { formatMmt, formatUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const STALE_SYNC_MAX = 1;

export async function GET(request: NextRequest) {
  try {
    const q = parseRoundsQuery(request.nextUrl.searchParams);
    let status = await getSyncStatus();
    if (status.isStale) {
      try {
        // Tip-only, newest-first. Lock miss returns immediately with existing rows.
        await syncRounds({ maxRounds: STALE_SYNC_MAX, timeBudgetMs: 3500 });
        status = await getSyncStatus();
      } catch (err) {
        // A failed on-demand sync must not break reads.
        console.error("on-demand sync failed", err);
      }
    }

    const db = getDb();
    const where = buildRoundFilters(q);
    const orderBy = buildOrderBy(q);
    const offset = (q.page - 1) * q.pageSize;

    const [rows, totalRows] = await Promise.all([
      db.select().from(rounds).where(where).orderBy(orderBy).limit(q.pageSize).offset(offset),
      db.select({ c: count() }).from(rounds).where(where),
    ]);
    const refreshed = status;

    const total = Number(totalRows[0]?.c ?? 0);

    return NextResponse.json({
      data: rows.map((r) => ({
        ...r,
        blockTimeUtcLabel: formatUtc(r.blockTimeUtc),
        blockTimeMmtLabel: formatMmt(r.blockTimeUtc),
      })),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.ceil(total / q.pageSize),
      },
      meta: {
        lastUpdated: refreshed.lastRound?.blockTimeUtc?.toISOString() ?? null,
        isStale: refreshed.isStale,
        latestCompletedRoundId: refreshed.latestCompleted.roundId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

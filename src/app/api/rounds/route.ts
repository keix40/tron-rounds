import { count } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { buildOrderBy, buildRoundFilters } from "@/lib/filters";
import { parseRoundsQuery } from "@/lib/query-params";
import { syncRounds, getSyncStatus } from "@/lib/sync";
import { formatMmt, formatUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const STALE_SYNC_MAX = 30;

export async function GET(request: NextRequest) {
  try {
    const q = parseRoundsQuery(request.nextUrl.searchParams);
    const status = await getSyncStatus();
    if (status.isStale) {
      await syncRounds({ maxRounds: STALE_SYNC_MAX });
    }

    const db = getDb();
    const where = buildRoundFilters(q);
    const orderBy = buildOrderBy(q);
    const offset = (q.page - 1) * q.pageSize;

    const [rows, totalRows, refreshed] = await Promise.all([
      db.select().from(rounds).where(where).orderBy(orderBy).limit(q.pageSize).offset(offset),
      db.select({ c: count() }).from(rounds).where(where),
      getSyncStatus(),
    ]);

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

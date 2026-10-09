import { asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { rounds } from "@/db/schema";
import { roundsToXlsxBuffer } from "@/lib/export-xlsx";
import { buildRoundFilters } from "@/lib/filters";
import { EXPORT_ROW_CAP, parseRoundsQuery } from "@/lib/query-params";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const q = parseRoundsQuery(request.nextUrl.searchParams);
    const db = getDb();
    const where = buildRoundFilters(q);
    const rows = await db
      .select()
      .from(rounds)
      .where(where)
      .orderBy(asc(rounds.blockTimeUtc))
      .limit(EXPORT_ROW_CAP);

    const buffer = await roundsToXlsxBuffer(rows);
    const filename = `tron-rounds-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

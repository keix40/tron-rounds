import { NextRequest, NextResponse } from "next/server";
import { parseStatsQuery } from "@/lib/query-params";
import { computeStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const q = parseStatsQuery(request.nextUrl.searchParams);
    const stats = await computeStats(q);
    return NextResponse.json(stats);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

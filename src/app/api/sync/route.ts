import { NextRequest, NextResponse } from "next/server";
import { syncRounds, getSyncStatus } from "@/lib/sync";

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 120;

export async function POST(request: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SYNC_SECRET not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlMax = request.nextUrl.searchParams.get("max");
  const maxRounds = urlMax ? Math.min(Number(urlMax), 500) : MAX_PER_REQUEST;

  try {
    const before = await getSyncStatus();
    const result = await syncRounds({ maxRounds: Number.isFinite(maxRounds) ? maxRounds : MAX_PER_REQUEST });
    const after = await getSyncStatus();
    return NextResponse.json({ ...result, before, after });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

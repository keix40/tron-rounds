import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { syncRounds, getSyncStatus } from "@/lib/sync";

export const dynamic = "force-dynamic";

const MAX_PER_REQUEST = 120;

function digest(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

/** Constant-time bearer token check (hash first so lengths always match). */
function isAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

export async function POST(request: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SYNC_SECRET not configured" }, { status: 503 });
  }
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlMax = request.nextUrl.searchParams.get("max");
  const parsedMax = urlMax ? Math.trunc(Number(urlMax)) : MAX_PER_REQUEST;
  const maxRounds = Math.max(1, Math.min(Number.isFinite(parsedMax) ? parsedMax : MAX_PER_REQUEST, 500));

  try {
    const before = await getSyncStatus();
    const result = await syncRounds({ maxRounds });
    const after = await getSyncStatus();
    return NextResponse.json({ ...result, before, after });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

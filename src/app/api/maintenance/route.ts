import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { asc, inArray, min } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { publishScheduledPredictions, settleNewsPredictions } from "@/lib/news-predictions";
import { OPEN_SIGNAL_STATUSES } from "@/lib/signal-policy";
import { scanWorkspaceSignals } from "@/lib/signal-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.FREYR_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const workspaces = await db.select({ id: signals.userId }).from(signals).where(inArray(signals.status, [...OPEN_SIGNAL_STATUSES]))
      .groupBy(signals.userId).orderBy(asc(min(signals.publishedAt))).limit(75);
    const batches = await Promise.allSettled([
      publishScheduledPredictions().then(() => settleNewsPredictions()),
      ...workspaces.map((workspace) => scanWorkspaceSignals(workspace.id)),
    ]);
    const failures = batches.filter((item) => item.status === "rejected").length;
    if (failures > 0) console.warn("FREYR maintenance had incomplete work", { failures });
    return NextResponse.json({ ok: failures === 0, monitored: workspaces.length }, { status: failures ? 503 : 200 });
  } catch (err) {
    console.error("Maintenance failed:", err);
    return NextResponse.json({ error: "Maintenance pass failed" }, { status: 500 });
  }
}

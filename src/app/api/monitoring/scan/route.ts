import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, count, max } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { scanWorkspaceSignals } from "@/lib/signal-monitor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const since = Number(request.nextUrl.searchParams.get("after"));
    const cursor = request.nextUrl.searchParams.has("after") && Number.isSafeInteger(since) && since >= 0 && since < 2_147_483_647 ? since : null;
    const result = await scanWorkspaceSignals(user.id);
    const [[state], [latest]] = await Promise.all([
      db.select({ unread: count() }).from(alerts).where(and(eq(alerts.userId, user.id), eq(alerts.isRead, false))),
      db.select({ id: max(alerts.id) }).from(alerts).where(eq(alerts.userId, user.id)),
    ]);
    const newAlerts = cursor === null ? [] : await db.select({ id: alerts.id, title: alerts.title, message: alerts.message, category: alerts.category })
      .from(alerts).where(and(eq(alerts.userId, user.id), gt(alerts.id, cursor), eq(alerts.isRead, false)))
      .orderBy(desc(alerts.id)).limit(8);
    return NextResponse.json({ ...result, newestAlertId: latest?.id ?? 0, unreadCount: state?.unread ?? 0, newAlerts, browserEnabled: user.notificationPrefs.browserEnabled });
  } catch (err) {
    console.error("Monitoring pass failed:", err);
    return NextResponse.json({ error: "Monitoring pass failed" }, { status: 500 });
  }
}

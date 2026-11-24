import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { alerts, signalEvents, signals } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { signalResponse, withSignalWorkspace } from "@/lib/signal-cooldown";
import { isOpenSignal, nextSignalStatuses, SIGNAL_STATUSES, statusLabel } from "@/lib/signal-policy";

export const dynamic = "force-dynamic";
const UpdateSchema = z.object({ status: z.enum(SIGNAL_STATUSES), observedPrice: z.number().positive().optional(), note: z.string().trim().min(2).max(400) }).strict();

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await getActiveUser();
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    const body = await req.json().catch(() => null);
    if (body && ["entryPrice", "stopLoss", "takeProfit", "legacyPartialTarget", "takeProfit1", "takeProfit2", "symbol", "direction", "publishedAt", "expiresAt"].some((key) => Object.hasOwn(body, key))) {
      return NextResponse.json({ error: "Published levels and deadlines cannot be edited." }, { status: 409 });
    }
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid status and a short audit note." }, { status: 400 });
    const { status, observedPrice, note } = parsed.data;

    return await withSignalWorkspace(user.id, async ({ tx, now, prefs }) => {
      const [row] = await tx.select().from(signals).where(and(eq(signals.id, id), eq(signals.userId, user.id))).limit(1);
      if (!row) return NextResponse.json({ error: "Signal not found" }, { status: 404 });
      const changed = status !== row.status;
      if (changed && !nextSignalStatuses(row.status).includes(status)) return NextResponse.json({ error: "That signal cannot be reopened or moved to this status." }, { status: 409 });
      const [updated] = changed
        ? await tx.update(signals).set({ status, closedAt: isOpenSignal(status) ? null : now }).where(eq(signals.id, id)).returning()
        : [row];
      const eventType = !changed ? "NOTE" : status === "SL_HIT" ? "STOP_HIT" : status.startsWith("TP") ? "TARGET_HIT" : status === "ACTIVE" ? "TRIGGERED" : status;
      await tx.insert(signalEvents).values({ signalId: id, eventType, previousStatus: row.status, newStatus: status, observedPrice: observedPrice ?? null, note });
      const category = status === "ACTIVE" ? "ENTRY_ZONE" : status === "INVALIDATED" ? "INVALIDATION" : status === "EXPIRED" ? "SIGNAL_EXPIRED" : "SL_TP";
      const enabled = category === "ENTRY_ZONE" ? prefs.entryZone : category === "INVALIDATION" ? prefs.invalidations : prefs.slTpHits;
      if (changed && enabled) await tx.insert(alerts).values({ userId: user.id, symbol: row.symbol, category,
        severity: status === "SL_HIT" || status === "INVALIDATED" ? "WARNING" : "INFO", title: `${row.symbol} · ${statusLabel[status]}`, message: note,
      });
      const events = await tx.select().from(signalEvents).where(eq(signalEvents.signalId, id)).orderBy(desc(signalEvents.createdAt), desc(signalEvents.id));
      return NextResponse.json({ signal: { ...signalResponse(updated), currentPrice: null, events } });
    });
  } catch (err) {
    console.error("Signal update failed:", err);
    return NextResponse.json({ error: "Unable to record the update" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alerts, signals } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import {
  classifyVolatility,
  computeAtr,
  fetchCandles,
  fetchEconomicCalendar,
  getFeedHealth,
} from "@/lib/market-data";
import { analyzeLiquidityAndStructure } from "@/lib/engines/liquidity";
import { expireDueSignals } from "@/lib/signal-cooldown";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getActiveUser();
    const list = await db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, user.id))
      .orderBy(desc(alerts.createdAt))
      .limit(60);

    const [unread] = await db.select({ value: count() }).from(alerts).where(and(eq(alerts.userId, user.id), eq(alerts.isRead, false)));
    const unreadCount = unread.value;
    return NextResponse.json({
      alerts: list,
      unreadCount,
      preferences: user.notificationPrefs,
    });
  } catch (err) {
    console.error("Alerts GET error:", err);
    return NextResponse.json({ error: "Unable to load alerts" }, { status: 500 });
  }
}

const PatchSchema = z.object({
  action: z.enum(["mark_read", "mark_all_read", "scan_live", "clear_read"]),
  id: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid alert action" }, { status: 400 });
    }

    const { action, id } = parsed.data;
    if (action === "mark_read" && id) {
      await db
        .update(alerts)
        .set({ isRead: true })
        .where(and(eq(alerts.id, id), eq(alerts.userId, user.id)));
      return NextResponse.json({ ok: true });
    }

    if (action === "mark_all_read") {
      await db.update(alerts).set({ isRead: true }).where(eq(alerts.userId, user.id));
      return NextResponse.json({ ok: true });
    }

    if (action === "clear_read") {
      await db
        .delete(alerts)
        .where(and(eq(alerts.userId, user.id), eq(alerts.isRead, true)));
      return NextResponse.json({ ok: true });
    }

    await expireDueSignals(user.id);
    const generated: (typeof alerts.$inferInsert)[] = [];
    const [m15, cal, openSigs] = await Promise.all([
      fetchCandles("XAUUSD", "15m"),
      fetchEconomicCalendar(),
      db.select().from(signals).where(eq(signals.userId, user.id)),
    ]);

    if (m15.status === "UNAVAILABLE") {
      generated.push({
        userId: user.id,
        category: "FEED",
        severity: "CRITICAL",
        symbol: "XAUUSD",
        title: "Gold Data Feed Interruption Detected",
        message: `Hyperliquid XAUUSD feed returned unavailable (${m15.error ?? "network error"}). Signal execution paused until restored.`,
      });
    } else if (m15.candles.length >= 15) {
      const liq = analyzeLiquidityAndStructure({
        symbol: "XAUUSD",
        timeframe: "15m",
        candles: m15.candles,
      });
      const lastPrice = m15.candles[m15.candles.length - 1].close;
      const ev = liq.lastStructureEvent;
      if (ev) {
        const isSweep = ev.type === "SWEEP" || ev.type === "STOP_HUNT";
        generated.push({
          userId: user.id,
          category: isSweep ? "LIQUIDITY_SWEEP" : "STRUCTURE",
          severity: isSweep ? "WARNING" : "INFO",
          symbol: "XAUUSD",
          title: `${ev.label} at $${ev.price.toFixed(2)}`,
          message: `${ev.detail} XAU/USD quote $${lastPrice.toFixed(2)}.`,
        });
      }

      const atr = computeAtr(m15.candles, 14);
      const vol = classifyVolatility(atr, lastPrice);
      if (vol.state === "ELEVATED" || vol.state === "HIGH") {
        generated.push({
          userId: user.id,
          category: "VOLATILITY",
          severity: "WARNING",
          symbol: "XAUUSD",
          title: `${vol.state} Volatility Detected on XAUUSD`,
          message: `M15 ATR(14) at $${atr?.toFixed(2)} (${vol.pct?.toFixed(2)}% of spot). Size positions strictly inside risk limit.`,
        });
      }

      // Check approaching pending signals
      for (const s of openSigs.filter((x) => x.symbol === "XAUUSD" && x.status === "PENDING")) {
        const dist = Math.abs(lastPrice - s.entryPrice);
        if (atr && dist <= atr * 1.5) {
          generated.push({
            userId: user.id,
            category: "ENTRY_ZONE",
            severity: "WARNING",
            symbol: "XAUUSD",
            title: `XAU/USD approaching entry ($${s.entryPrice.toFixed(2)})`,
            message: `Spot $${lastPrice.toFixed(2)} is within $${dist.toFixed(2)} of pending ${s.direction} trigger.`,
          });
        }
      }
    }

    // Check high impact economic events in next 12h
    const now = Date.now();
    const soon = cal.events.find(
      (e) => e.impact === "High" && e.isGoldSensitive && e.timestamp > now && e.timestamp <= now + 12 * 3600_000
    );
    if (soon) {
      const hrs = Math.max(0.1, (soon.timestamp - now) / 3600_000).toFixed(1);
      generated.push({
        userId: user.id,
        category: "ECONOMIC",
        severity: "WARNING",
        symbol: "XAUUSD",
        title: `Upcoming High-Impact Release: ${soon.currency} ${soon.title}`,
        message: `Scheduled in ${hrs}h · Forecast ${soon.forecast} vs Prior ${soon.previous}. Guard gold positions for release volatility.`,
      });
    }

    // Check feed outages
    for (const h of getFeedHealth()) {
      if (h.status === "UNAVAILABLE") {
        generated.push({
          userId: user.id,
          category: "FEED",
          severity: "CRITICAL",
          symbol: "SYSTEM",
          title: `Data Feed Interrupted: ${h.name}`,
          message: h.lastError ?? "Upstream feed temporarily unreachable.",
        });
      }
    }

    const prefs = user.notificationPrefs;
    const enabled: Record<string, boolean> = { FEED: prefs.systemErrors, STRUCTURE: prefs.bosChoch, LIQUIDITY_SWEEP: prefs.liquiditySweeps, VOLATILITY: prefs.volatility, ENTRY_ZONE: prefs.entryZone, ECONOMIC: prefs.economicEvents };
    const candidates = generated.filter((row) => enabled[row.category]);
    const existing = candidates.length ? await db.select({ title: alerts.title }).from(alerts).where(and(eq(alerts.userId, user.id), inArray(alerts.title, candidates.map((row) => row.title)), gte(alerts.createdAt, new Date(Date.now() - 60 * 60_000)))) : [];
    const alreadyShown = new Set(existing.map((row) => row.title));
    const additions = candidates.filter((row) => !alreadyShown.has(row.title)).slice(0, 4);
    if (additions.length) await db.insert(alerts).values(additions);

    const updated = await db
      .select()
      .from(alerts)
      .where(eq(alerts.userId, user.id))
      .orderBy(desc(alerts.createdAt))
      .limit(60);

    return NextResponse.json({
      created: additions.length,
      alerts: updated,
      unreadCount: updated.filter((a) => !a.isRead).length,
    });
  } catch (err) {
    console.error("Alerts POST error:", err);
    return NextResponse.json({ error: "Unable to process alert scan" }, { status: 500 });
  }
}

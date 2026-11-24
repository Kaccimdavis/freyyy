import { NextRequest, NextResponse } from "next/server";
import { clearMarketCache, fetchEconomicCalendar, fetchFallbackCalendar, isCalendarRelease, type EconomicEvent } from "@/lib/market-data";
import { db } from "@/db";
import { systemState } from "@/db/schema";
import { eq } from "drizzle-orm";

const SNAPSHOT_KEY = "economic_calendar_snapshot";

async function readSnapshot() {
  try {
    const [row] = await db.select().from(systemState).where(eq(systemState.key, SNAPSHOT_KEY)).limit(1);
    const value = row?.value as { events?: unknown; fetchedAt?: unknown } | undefined;
    const events = Array.isArray(value?.events) ? (value.events as EconomicEvent[]) : [];
    return events.length ? { events, fetchedAt: typeof value?.fetchedAt === "string" ? value.fetchedAt : new Date().toISOString() } : null;
  } catch { return null; }
}

async function writeSnapshot(events: EconomicEvent[]) {
  if (!events.length) return;
  try {
    await db.insert(systemState).values({ key: SNAPSHOT_KEY, value: { events, fetchedAt: new Date().toISOString() } })
      .onConflictDoUpdate({ target: systemState.key, set: { value: { events, fetchedAt: new Date().toISOString() }, updatedAt: new Date() } });
  } catch { /* Snapshot persistence is best-effort. */ }
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get("refresh") === "1") {
      clearMarketCache();
    }
    const feed = await fetchEconomicCalendar();
    // The calendar intentionally shows only tradable-impact releases and bank holidays.
    let cal = { ...feed, events: feed.events.filter((event) => isCalendarRelease(event.impact)) };
    if (cal.events.length > 0) await writeSnapshot(cal.events);
    else {
      const snapshot = await readSnapshot();
      if (snapshot) cal = { ...cal, events: snapshot.events, status: "CACHED", fetchedAt: snapshot.fetchedAt,
        error: "Showing the last saved schedule while the provider recovers." };
      else {
        const secondary = await fetchFallbackCalendar();
        cal = { ...secondary, events: secondary.events.filter((event) => isCalendarRelease(event.impact)) };
      }
    }
    const now = Date.now();
    const highCount = cal.events.filter((e) => e.impact === "High").length;
    const goldCount = cal.events.filter((e) => e.isGoldSensitive).length;
    const nextHigh =
      cal.events.find((e) => e.timestamp >= now && e.impact === "High" && e.isGoldSensitive) ??
      cal.events.find((e) => e.timestamp >= now && e.impact === "High") ??
      null;

    return NextResponse.json({
      ...cal,
      stats: {
        total: cal.events.length,
        mediumImpact: cal.events.filter((e) => e.impact === "Medium").length,
        bankHolidays: cal.events.filter((e) => e.impact === "Holiday").length,
        highImpact: highCount,
        goldSensitive: goldCount,
        nextHighImpact: nextHigh,
      },
    });
  } catch (err) {
    console.error("Calendar API error:", err);
    return NextResponse.json(
      {
        events: [],
        source: "Forex Factory Weekly Feed",
        status: "UNAVAILABLE",
        fetchedAt: new Date().toISOString(),
        cacheAgeSec: 0,
        error: "Failed to load economic calendar",
      },
      { status: 500 }
    );
  }
}

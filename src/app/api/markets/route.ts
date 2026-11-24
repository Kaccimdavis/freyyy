import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { watchlistItems } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import {
  clearMarketCache,
  fetchAllQuotes,
  fetchCandles,
  fetchOrderBook,
  getActiveSessions,
  getInstrument,
  INSTRUMENTS,
  type Timeframe,
} from "@/lib/market-data";
import { analyzeLiquidityAndStructure } from "@/lib/engines/liquidity";

export const dynamic = "force-dynamic";

const VALID_TF: Timeframe[] = ["3m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") ?? "XAUUSD").toUpperCase();
    const rawTf = (searchParams.get("tf") ?? "15m") as Timeframe;
    const timeframe: Timeframe = VALID_TF.includes(rawTf) ? rawTf : "15m";
    const refresh = searchParams.get("refresh") === "1";

    if (refresh) {
      clearMarketCache();
    }

    const inst = getInstrument(symbol);
    const [quotesRes, series, daily, hourly, book, watchlist] = await Promise.all([
      fetchAllQuotes(),
      fetchCandles(inst.symbol, timeframe),
      fetchCandles(inst.symbol, "1d"),
      timeframe === "1h" ? Promise.resolve(null) : fetchCandles(inst.symbol, "1h"),
      inst.supportsOrderBook ? fetchOrderBook(inst.symbol) : Promise.resolve(null),
      db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, user.id))
        .orderBy(asc(watchlistItems.sortOrder)),
    ]);

    const h1Candles = hourly ? hourly.candles : series.candles;
    const structure = analyzeLiquidityAndStructure({
      symbol: inst.symbol,
      timeframe,
      candles: series.candles,
      dailyCandles: daily.candles,
      hourlyCandles: h1Candles,
    });

    const quote = quotesRes.quotes.find((q) => q.symbol === inst.symbol) ?? null;
    const candles = series.candles;
    const rangeHigh = candles.length ? Math.max(...candles.map((c) => c.high)) : null;
    const rangeLow = candles.length ? Math.min(...candles.map((c) => c.low)) : null;

    return NextResponse.json({
      instrument: inst,
      quote,
      quotes: quotesRes.quotes,
      watchlist: watchlist.map((w) => w.symbol),
      timeframe,
      candles: candles.slice(-140),
      rangeHigh,
      rangeLow,
      source: series.source,
      status: series.status,
      fetchedAt: series.fetchedAt,
      cacheAgeSec: series.cacheAgeSec,
      error: series.error ?? null,
      orderBook: book,
      overlays: {
        levels: structure.levels,
        zones: structure.zones,
        events: structure.events.slice(-10),
        sessions: structure.sessions,
        pdh: structure.pdh,
        pdl: structure.pdl,
        pwh: structure.pwh,
        pwl: structure.pwl,
      },
      sessions: getActiveSessions(),
    });
  } catch (err) {
    console.error("Markets API error:", err);
    return NextResponse.json({ error: "Failed to fetch markets" }, { status: 500 });
  }
}

const WatchSchema = z.object({
  symbol: z.string().min(2).max(12),
  action: z.enum(["add", "remove", "toggle"]).default("toggle"),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = WatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid watchlist symbol" }, { status: 400 });
    }
    const sym = parsed.data.symbol.toUpperCase();
    const inst = INSTRUMENTS.find((i) => i.symbol === sym);
    if (!inst) {
      return NextResponse.json({ error: "Unsupported symbol" }, { status: 400 });
    }

    const existing = await db
      .select()
      .from(watchlistItems)
      .where(and(eq(watchlistItems.userId, user.id), eq(watchlistItems.symbol, sym)))
      .limit(1);

    if (existing[0] && (parsed.data.action === "remove" || parsed.data.action === "toggle")) {
      await db.delete(watchlistItems).where(eq(watchlistItems.id, existing[0].id));
    } else if (!existing[0] && (parsed.data.action === "add" || parsed.data.action === "toggle")) {
      const current = await db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, user.id));
      await db.insert(watchlistItems).values({
        userId: user.id,
        symbol: sym,
        category: inst.category,
        sortOrder: current.length,
      });
    }

    const updated = await db
      .select()
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, user.id))
      .orderBy(asc(watchlistItems.sortOrder));

    return NextResponse.json({ watchlist: updated.map((w) => w.symbol) });
  } catch (err) {
    console.error("Watchlist update error:", err);
    return NextResponse.json({ error: "Unable to update watchlist" }, { status: 500 });
  }
}

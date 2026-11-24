import { NextRequest, NextResponse } from "next/server";
import { fetchCandles, fetchHyperliquidMids, INSTRUMENTS } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "XAUUSD").toUpperCase();
  const market = INSTRUMENTS.find((item) => item.symbol === symbol && item.provider === "hyperliquid");
  if (!market) return NextResponse.json({ error: "This market is not available for preview." }, { status: 400 });
  const [snapshot, series] = await Promise.all([fetchHyperliquidMids(), fetchCandles(symbol, "15m")]);
  const price = snapshot.mids[symbol] ?? null;
  const asOf = price === null ? Date.now() : Date.parse(snapshot.fetchedAt);
  const interval = 15 * 60_000;
  const cutoff = asOf - 24 * 60 * 60_000;
  const bars = series.candles.filter((bar) => bar.time >= cutoff && bar.time <= asOf);
  const previous = series.candles.findLast((bar) => bar.time + interval <= cutoff);
  const changePct = price !== null && previous && previous.close > 0 && cutoff - previous.time - interval < 2 * interval
    ? (price - previous.close) / previous.close * 100 : null;
  const points = bars.filter((_, index) => index % 3 === 0 || index === bars.length - 1).map((bar) => bar.close);
  return NextResponse.json({ symbol, decimals: market.decimals, price, changePct, points, status: price === null ? "UNAVAILABLE" : snapshot.status,
    rangeStatus: series.status,
    low: bars.length ? Math.min(...bars.map((bar) => bar.low)) : null,
    high: bars.length ? Math.max(...bars.map((bar) => bar.high)) : null,
  });
}

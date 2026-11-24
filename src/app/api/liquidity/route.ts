import { NextRequest, NextResponse } from "next/server";
import { fetchCandles, getActiveSessions, getInstrument, type Timeframe } from "@/lib/market-data";
import { analyzeLiquidityAndStructure } from "@/lib/engines/liquidity";

export const dynamic = "force-dynamic";

const VALID_TF: Timeframe[] = ["3m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") ?? "XAUUSD").toUpperCase();
    const rawTf = (searchParams.get("tf") ?? "15m") as Timeframe;
    const timeframe: Timeframe = VALID_TF.includes(rawTf) ? rawTf : "15m";
    const inst = getInstrument(symbol);

    const [primary, daily, hourly] = await Promise.all([
      fetchCandles(inst.symbol, timeframe),
      fetchCandles(inst.symbol, "1d"),
      timeframe === "1h" ? Promise.resolve(null) : fetchCandles(inst.symbol, "1h"),
    ]);

    const analysis = analyzeLiquidityAndStructure({
      symbol: inst.symbol,
      timeframe,
      candles: primary.candles,
      dailyCandles: daily.candles,
      hourlyCandles: hourly ? hourly.candles : primary.candles,
    });

    return NextResponse.json({
      instrument: inst,
      timeframe,
      source: primary.source,
      status: primary.status,
      fetchedAt: primary.fetchedAt,
      candles: primary.candles.slice(-120),
      analysis,
      activeSessions: getActiveSessions(),
    });
  } catch (err) {
    console.error("Liquidity API error:", err);
    return NextResponse.json({ error: "Liquidity intelligence computation failed" }, { status: 500 });
  }
}

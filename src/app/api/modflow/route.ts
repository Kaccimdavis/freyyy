import { NextRequest, NextResponse } from "next/server";
import { fetchCandles, fetchOrderBook, getInstrument, type Timeframe } from "@/lib/market-data";
import { runModFlowAnalysis } from "@/lib/engines/modflow";

export const dynamic = "force-dynamic";

const VALID_TF: Timeframe[] = ["3m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") ?? "XAUUSD").toUpperCase();
    const rawTf = (searchParams.get("tf") ?? "15m") as Timeframe;
    const timeframe: Timeframe = VALID_TF.includes(rawTf) ? rawTf : "15m";
    const inst = getInstrument(symbol);

    const [candleRes, orderBook] = await Promise.all([
      fetchCandles(inst.symbol, timeframe),
      fetchOrderBook(inst.symbol),
    ]);

    const analysis = runModFlowAnalysis({
      symbol: inst.symbol,
      timeframe,
      candles: candleRes.candles,
      candleStatus: candleRes.status,
      candleSource: candleRes.source,
      orderBook,
    });

    return NextResponse.json({
      instrument: inst,
      candles: candleRes.candles.slice(-96),
      analysis,
      cacheAgeSec: candleRes.cacheAgeSec,
    });
  } catch (err) {
    console.error("ModFlow API error:", err);
    return NextResponse.json({ error: "ModFlow engine failed to compute analysis" }, { status: 500 });
  }
}

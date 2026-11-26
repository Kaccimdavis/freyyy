import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { backtestRuns } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { fetchCandles, getInstrument, type Timeframe } from "@/lib/market-data";
import { runReverseStrategyResearch } from "@/lib/engines/reverse-strategy";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  backtestRunId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "A valid backtestRunId is required." }, { status: 400 });
    }

    const [run] = await db.select().from(backtestRuns).where(
      and(eq(backtestRuns.id, parsed.data.backtestRunId), eq(backtestRuns.userId, user.id))
    ).limit(1);

    if (!run) return NextResponse.json({ error: "Backtest run not found." }, { status: 404 });
    if (!run.trades.length) return NextResponse.json({ error: "This run contains no saved trade records." }, { status: 422 });

    const instrument = getInstrument(run.symbol);
    const startMs = Date.parse(`${run.startDate}T00:00:00Z`);
    const endMs = Date.parse(`${run.endDate}T23:59:59Z`);
    const series = await fetchCandles(instrument.symbol, run.timeframe as Timeframe, startMs, endMs);
    if (series.candles.length < 30) {
      return NextResponse.json({ error: "Insufficient historical candles to replay this run. No reverse results were generated." }, { status: 422 });
    }

    const result = runReverseStrategyResearch({
      trades: run.trades,
      candles: series.candles,
      initialBalance: run.initialBalance,
      riskPercent: run.riskPercent,
      spreadPoints: run.spreadPoints,
      pipSize: instrument.pipSize,
      commissionPerLot: run.commissionPerLot,
      contractSize: instrument.contractSize,
    });

    return NextResponse.json({
      sourceRun: { id: run.id, strategyName: run.strategyName, symbol: run.symbol, timeframe: run.timeframe, startDate: run.startDate, endDate: run.endDate },
      result,
      disclaimer: "RESEARCH-ONLY COUNTERFACTUAL SIMULATION. This engine does not generate, alter, or publish live signals.",
    });
  } catch (error) {
    console.error("Reverse Strategy Engine error:", error);
    return NextResponse.json({ error: "Reverse strategy research failed." }, { status: 500 });
  }
}

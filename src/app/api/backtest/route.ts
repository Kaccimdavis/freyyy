import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { backtestRuns, strategies, type StrategyRuleSet } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { fetchCandles, getInstrument, type Timeframe } from "@/lib/market-data";
import { runHistoricalBacktest } from "@/lib/engines/backtester";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getActiveUser();
    const [runs, strats] = await Promise.all([
      db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.userId, user.id))
        .orderBy(desc(backtestRuns.createdAt))
        .limit(20),
      db.select().from(strategies).where(eq(strategies.userId, user.id)),
    ]);
    return NextResponse.json({ runs, strategies: strats });
  } catch (err) {
    console.error("Backtest GET error:", err);
    return NextResponse.json({ error: "Failed to load backtest records" }, { status: 500 });
  }
}

const RunSchema = z.object({
  strategyId: z.number().int().positive().optional(),
  strategyName: z.string().min(2).max(120).optional(),
  logicType: z
    .enum([
      "liquidity_sweep_bos",
      "ob_cvd_confluence",
      "session_range_reversal",
      "fvg_absorption_pullback",
      "custom_structure",
    ])
    .optional(),
  symbol: z.string().min(2).max(12).default("XAUUSD"),
  timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).default("1h"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  initialBalance: z.number().min(1000).max(50_000_000).default(100000),
  riskPercent: z.number().min(0.1).max(5).default(0.75),
  slAtrMultiple: z.number().min(0.5).max(5).default(1.4),
  tpRiskMultiple: z.number().min(1.0).max(6).default(2.2),
  spreadPoints: z.number().min(0).max(20).default(2.5),
  commissionPerLot: z.number().min(0).max(50).default(7.0),
  sessionFilter: z.enum(["ALL", "Asian", "London", "New York", "London+NY"]).default("ALL"),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = RunSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid backtest settings" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const inst = getInstrument(d.symbol);
    let strategyId: number | null = null;
    let strategyName = d.strategyName ?? "London Sweep & BOS Continuation";\n    const isAsianReversal = d.logicType === "asian_session_liquidity_reversal";\n    if (isAsianReversal && (d.symbol !== "XAUUSD" || d.timeframe !== "5m")) {\n      return NextResponse.json({ error: "Asian Session Liquidity Reversal is restricted to XAUUSD M5." }, { status: 400 });\n    }\n    if (isAsianReversal) strategyName = "Asian Session Liquidity Reversal (Experimental)";
    let logicType: StrategyRuleSet["logicType"] = d.logicType ?? "liquidity_sweep_bos";
    let emaFast = 12;
    let emaSlow = 30;

    if (d.strategyId) {
      const found = await db
        .select()
        .from(strategies)
        .where(and(eq(strategies.id, d.strategyId), eq(strategies.userId, user.id)))
        .limit(1);
      if (found[0]) {
        strategyId = found[0].id;
        strategyName = found[0].name;
        logicType = found[0].rules.logicType;
        emaFast = found[0].rules.emaFast ?? 12;
        emaSlow = found[0].rules.emaSlow ?? 30;
      }
    }

    const endMs = d.endDate ? Math.min(Date.now(), Date.parse(`${d.endDate}T23:59:59Z`)) : Date.now();
    const defaultSpanDays =
      d.timeframe === "5m" ? 3 : d.timeframe === "15m" ? 10 : d.timeframe === "1h" ? 30 : d.timeframe === "4h" ? 60 : 180;
    const startMs = d.startDate
      ? Date.parse(`${d.startDate}T00:00:00Z`)
      : endMs - defaultSpanDays * 24 * 3600 * 1000;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return NextResponse.json({ error: "Start date must be earlier than end date." }, { status: 400 });
    }

    let series = await fetchCandles(inst.symbol, d.timeframe as Timeframe, startMs, endMs);
    if (series.candles.length < 30) {
      // Retry wider default historical fetch when selected range is tighter than provider granularity
      series = await fetchCandles(inst.symbol, d.timeframe as Timeframe);
    }

    if (series.candles.length < 30) {
      return NextResponse.json(
        {
          error: `Insufficient verified historical candles returned for ${inst.symbol} (${d.timeframe}). Found ${series.candles.length} bars; at least 30 required.`,
        },
        { status: 422 }
      );
    }

    const result = runHistoricalBacktest({
      symbol: inst.symbol,
      timeframe: d.timeframe,
      strategyName,
      logicType,
      candles: series.candles,
      initialBalance: d.initialBalance,
      riskPercent: d.riskPercent,
      slAtrMultiple: d.slAtrMultiple,
      tpRiskMultiple: d.tpRiskMultiple,
      spreadPoints: d.spreadPoints,
      commissionPerLot: d.commissionPerLot,
      sessionFilter: isAsianReversal ? "Asian" : d.sessionFilter,
      emaFast,
      emaSlow,
    });

    const actualStart = new Date(series.candles[0].time).toISOString().slice(0, 10);
    const actualEnd = new Date(series.candles[series.candles.length - 1].time).toISOString().slice(0, 10);

    const [saved] = await db
      .insert(backtestRuns)
      .values({
        userId: user.id,
        strategyId,
        strategyName,
        symbol: inst.symbol,
        timeframe: d.timeframe,
        startDate: actualStart,
        endDate: actualEnd,
        initialBalance: d.initialBalance,
        riskPercent: d.riskPercent,
        slAtrMultiple: d.slAtrMultiple,
        tpRiskMultiple: d.tpRiskMultiple,
        spreadPoints: d.spreadPoints,
        commissionPerLot: d.commissionPerLot,
        sessionFilter: d.sessionFilter,
        dataSource: `${series.source} · ${series.candles.length} historical bars`,
        isSimulated: true,
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        maxDrawdownPct: result.maxDrawdownPct,
        netProfit: result.netProfit,
        avgRiskReward: result.avgRiskReward,
        expectedValue: result.expectedValue,
        maxConsecutiveWins: result.maxConsecutiveWins,
        maxConsecutiveLosses: result.maxConsecutiveLosses,
        equityCurve: result.equityCurve,
        trades: result.trades.slice(0, 150),
      })
      .returning();

    // Update strategy test validation record so strategies reflect genuine backtest status
    if (strategyId && result.totalTrades > 0) {
      await db
        .update(strategies)
        .set({
          isTested: true,
          lastBacktestWinRate: result.winRate,
          lastBacktestProfitFactor: result.profitFactor,
          updatedAt: new Date(),
        })
        .where(eq(strategies.id, strategyId));
    }

    return NextResponse.json(
      {
        run: saved,
        barsEvaluated: series.candles.length,
        disclaimer: "SIMULATED HISTORICAL PERFORMANCE — Not indicative of future results or broker performance.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Backtest POST error:", err);
    return NextResponse.json({ error: "Historical backtest execution failed" }, { status: 500 });
  }
}

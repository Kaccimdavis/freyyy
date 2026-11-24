import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, journalEntries, riskConfigs, signals } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import {
  computeAtr,
  classifyVolatility,
  fetchAllQuotes,
  fetchCandles,
  fetchEconomicCalendar,
  fetchOrderBook,
  getActiveSessions,
  getFeedHealth,
} from "@/lib/market-data";
import { runModFlowAnalysis } from "@/lib/engines/modflow";
import { analyzeLiquidityAndStructure } from "@/lib/engines/liquidity";
import { runMultiEngineAnalysis } from "@/lib/engines/ai-analyst";
import { expireDueSignals, signalResponse, workspaceOpen } from "@/lib/signal-cooldown";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getActiveUser();
    await expireDueSignals(user.id);

    const [
      quotesRes,
      goldM15,
      goldH1,
      goldD1,
      goldBook,
      calendarRes,
      activeSignals,
      recentAlerts,
      riskRows,
      journals,
    ] = await Promise.all([
      fetchAllQuotes(),
      fetchCandles("XAUUSD", "15m"),
      fetchCandles("XAUUSD", "1h"),
      fetchCandles("XAUUSD", "1d"),
      fetchOrderBook("XAUUSD"),
      fetchEconomicCalendar(),
      db
        .select()
        .from(signals)
        .where(workspaceOpen(user.id))
        .orderBy(desc(signals.publishedAt))
        .limit(1),
      db
        .select()
        .from(alerts)
        .where(eq(alerts.userId, user.id))
        .orderBy(desc(alerts.createdAt))
        .limit(8),
      db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1),
      db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.userId, user.id))
        .orderBy(desc(journalEntries.tradedAt))
        .limit(50),
    ]);

    const goldQuote = quotesRes.quotes.find((q) => q.symbol === "XAUUSD") ?? quotesRes.quotes[0];
    const modflow = runModFlowAnalysis({
      symbol: "XAUUSD",
      timeframe: "15m",
      candles: goldM15.candles,
      candleStatus: goldM15.status,
      candleSource: goldM15.source,
      orderBook: goldBook,
    });
    const liquidity = analyzeLiquidityAndStructure({
      symbol: "XAUUSD",
      timeframe: "15m",
      candles: goldM15.candles,
      dailyCandles: goldD1.candles,
      hourlyCandles: goldH1.candles,
    });
    const aiBrief = await runMultiEngineAnalysis({
      symbol: "XAUUSD",
      confidenceThreshold: 62,
      minRiskReward: riskRows[0]?.minRiskReward ?? 2.0,
    });

    const atr15 = computeAtr(goldM15.candles, 14);
    const vol = classifyVolatility(atr15, goldQuote?.price ?? modflow.currentPrice);
    const sessions = getActiveSessions();

    // Upcoming high-impact / gold-sensitive economic events (next upcoming first)
    const now = Date.now();
    const upcomingEvents = calendarRes.events
      .filter((e) => e.timestamp >= now - 30 * 60_000 && (e.impact === "High" || (e.isGoldSensitive && e.impact === "Medium")))
      .slice(0, 6);

    // Real trading stats derived directly from journalEntries
    const totalTrades = journals.length;
    const wins = journals.filter((j) => j.outcome === "WIN");
    const losses = journals.filter((j) => j.outcome === "LOSS");
    const winRate = totalTrades > 0 ? Number(((wins.length / totalTrades) * 100).toFixed(1)) : 0;
    const netPnl = Number(journals.reduce((a, b) => a + b.pnlAmount, 0).toFixed(2));
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayEntries = journals.filter((j) => new Date(j.tradedAt).toISOString().slice(0, 10) === todayIso);
    const todayPnl = Number(todayEntries.reduce((a, b) => a + b.pnlAmount, 0).toFixed(2));

    const risk = riskRows[0] ?? null;
    const liveBalance = risk?.accountBalance ?? user.accountBalance;
    const liveEquity = Number((liveBalance + netPnl).toFixed(2));

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      gold: {
        quote: goldQuote,
        candles: goldM15.candles.slice(-80),
        candlesStatus: goldM15.status,
        candlesSource: goldM15.source,
        atr15: atr15 !== null ? Number(atr15.toFixed(2)) : null,
        volatilityPct: vol.pct !== null ? Number(vol.pct.toFixed(3)) : null,
        volatilityState: vol.state,
        spread: goldBook.spread,
        spreadBps: Number(goldBook.spreadBps.toFixed(2)),
        bookStatus: goldBook.status,
      },
      ticker: quotesRes.quotes.filter((q) =>
        ["XAUUSD", "DXY", "EURUSD", "US500", "NAS100", "BTCUSD"].includes(q.symbol)
      ),
      sessions,
      ai: {
        direction: aiBrief.direction,
        setupState: aiBrief.setupState,
        confidenceScore: aiBrief.confidenceScore,
        briefing: aiBrief.briefing,
        setupExplanation: aiBrief.setupExplanation,
        h1Bias: aiBrief.h1Bias,
        m15Structure: aiBrief.m15Structure,
        m5Execution: aiBrief.m5Execution,
        confirmationsCount: aiBrief.confirmationsCount,
        entryPrice: aiBrief.entryPrice,
        stopLoss: aiBrief.stopLoss,
        takeProfit: aiBrief.takeProfit,
        riskReward: aiBrief.riskReward,
        dataStatus: aiBrief.dataStatus,
      },
      modflow: {
        bias: modflow.summary.bias,
        setupConfirmation: modflow.summary.setupConfirmation,
        confirmationText: modflow.summary.confirmationText,
        sessionDelta: modflow.summary.sessionDelta,
        cvdSlope: modflow.summary.cvdSlope,
        cvdDivergence: modflow.summary.cvdDivergence,
        bidPressurePct: modflow.summary.bidPressurePct,
        askPressurePct: modflow.summary.askPressurePct,
        aggressiveBuyPct: modflow.summary.aggressiveBuyPct,
        aggressiveSellPct: modflow.summary.aggressiveSellPct,
        institutionalScore: modflow.summary.institutionalScore,
        institutionalActivity: modflow.summary.institutionalActivity,
        poc: modflow.volumeProfile.poc,
        vah: modflow.volumeProfile.vah,
        val: modflow.volumeProfile.val,
        absorptionCount: modflow.summary.absorptionCount,
        exhaustionCount: modflow.summary.exhaustionCount,
        status: modflow.status,
        orderBookStatus: modflow.orderBookStatus,
      },
      liquidity: {
        trend: liquidity.trend,
        condition: liquidity.liquidityCondition,
        structureBias: liquidity.structureBias,
        nearestBsl: liquidity.nearestBsl,
        nearestSsl: liquidity.nearestSsl,
        pdh: liquidity.pdh,
        pdl: liquidity.pdl,
        sessions: liquidity.sessions,
        lastEvent: liquidity.lastStructureEvent,
        counts: liquidity.counts,
        keyLevels: liquidity.levels.slice(0, 8),
        zones: liquidity.zones.slice(0, 6),
      },
      signals: activeSignals.map(signalResponse),
      calendar: {
        events: upcomingEvents,
        status: calendarRes.status,
        source: calendarRes.source,
        fetchedAt: calendarRes.fetchedAt,
        error: calendarRes.error ?? null,
      },
      account: {
        balance: liveBalance,
        equity: liveEquity,
        netPnl,
        todayPnl,
        todayTrades: todayEntries.length,
        totalTrades,
        wins: wins.length,
        losses: losses.length,
        winRate,
        riskPerTradePct: risk?.riskPerTradePct ?? 0.75,
        maxDailyLossPct: risk?.maxDailyLossPct ?? 2.0,
        maxDrawdownPct: risk?.maxDrawdownPct ?? 6.0,
        openExposurePct: risk?.openExposurePct ?? 0.75,
        brokerConfigured: Boolean(user.brokerConfig?.connected),
        brokerProvider: user.brokerConfig?.provider ?? "Manual only",
      },
      alerts: recentAlerts,
      widgets: user.dashboardWidgets,
      timezone: user.timezone,
      feeds: getFeedHealth(),
    });
  } catch (err) {
    console.error("Overview API error:", err);
    return NextResponse.json(
      { error: "Unable to load command center overview" },
      { status: 500 }
    );
  }
}

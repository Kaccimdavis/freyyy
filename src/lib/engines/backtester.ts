import {
  classifySessionFromTimestamp,
  computeAtr,
  getInstrument,
  type Candle,
} from "../market-data";
import type { BacktestTradeRecord, EquityPoint, StrategyRuleSet } from "@/db/schema";

export interface BacktestInput {
  symbol: string;
  timeframe: string;
  strategyName: string;
  logicType: StrategyRuleSet["logicType"];
  candles: Candle[];
  initialBalance: number;
  riskPercent: number;
  slAtrMultiple: number;
  tpRiskMultiple: number;
  spreadPoints: number;
  commissionPerLot: number;
  sessionFilter: "ALL" | "Asian" | "London" | "New York" | "London+NY";
  emaFast?: number;
  emaSlow?: number;
}

export interface BacktestOutput {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  netProfit: number;
  finalBalance: number;
  avgRiskReward: number;
  expectedValue: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  equityCurve: EquityPoint[];
  trades: BacktestTradeRecord[];
}

function emaArray(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let val = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = val;
  for (let i = period; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    out[i] = val;
  }
  return out;
}

function sessionAllowed(
  session: "Asian" | "London" | "New York" | "Off-Hours",
  filter: BacktestInput["sessionFilter"]
): boolean {
  if (filter === "ALL") return true;
  if (filter === "London+NY") return session === "London" || session === "New York";
  return session === filter;
}

/**
 * Deterministic candle-by-candle historical backtester operating purely on verified historical candles.
 * Implements institutional price action and order-flow strategies (Sweep+BOS, OB+CVD, Session Reversal,
 * FVG+Absorption, Custom Structure). Strictly excludes any 2.6/2.618 mathematical extension logic.
 * Results are always tagged as SIMULATED historical performance.
 */
export function runHistoricalBacktest(input: BacktestInput): BacktestOutput {
  const {
    symbol,
    logicType,
    candles,
    initialBalance,
    riskPercent,
    slAtrMultiple,
    tpRiskMultiple,
    spreadPoints,
    commissionPerLot,
    sessionFilter,
  } = input;

  const inst = getInstrument(symbol);
  const dec = inst.decimals;
  const round = (n: number) => Math.round(n * 10 ** dec) / 10 ** dec;

  const emptyResult: BacktestOutput = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    netProfit: 0,
    finalBalance: initialBalance,
    avgRiskReward: 0,
    expectedValue: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    equityCurve: candles.length
      ? [{ time: candles[0].time, equity: initialBalance, drawdownPct: 0 }]
      : [],
    trades: [],
  };

  if (candles.length < 30) return emptyResult;

  const closes = candles.map((c) => c.close);
  const fastP = Math.max(5, Math.min(34, input.emaFast ?? 12));
  const slowP = Math.max(fastP + 5, Math.min(100, input.emaSlow ?? 30));
  const emaF = emaArray(closes, fastP);
  const emaS = emaArray(closes, slowP);

  // Rolling volume delta proxy per bar for CVD / absorption confirmation
  const hasVol = candles.some((c) => c.volume > 0);
  const avgVolWindow = (idx: number) => {
    const start = Math.max(0, idx - 20);
    let s = 0;
    for (let j = start; j < idx; j++) s += candles[j].volume;
    return s / Math.max(1, idx - start);
  };
  const barDeltaSign = (c: Candle) => {
    const rng = Math.max(c.high - c.low, 1e-9);
    const clv = (c.close - c.low) / rng;
    return (clv - 0.5) * 2 * (hasVol ? c.volume : 1);
  };

  let equity = initialBalance;
  let peakEquity = initialBalance;
  let maxDrawdownPct = 0;
  let openTrade: {
    direction: "BUY" | "SELL";
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskUsd: number;
    lots: number;
    session: string;
    reason: string;
    barsOpen: number;
  } | null = null;

  const trades: BacktestTradeRecord[] = [];
  const equityCurve: EquityPoint[] = [
    { time: candles[0].time, equity: round(equity), drawdownPct: 0 },
  ];

  // Precompute the completed 00:00–03:00 UTC Asian range once per day.
  // The strategy only reads it from 03:00 UTC onward, avoiding look-ahead.
  const asianRangeByDay = new Map<number, { high: number; low: number; count: number }>();
  if (logicType === "asian_session_liquidity_reversal") {
    for (const bar of candles) {
      const day = new Date(bar.time);
      day.setUTCHours(0, 0, 0, 0);
      const dayStart = day.getTime();
      const hour = new Date(bar.time).getUTCHours();
      if (hour >= 3) continue;
      const existing = asianRangeByDay.get(dayStart);
      asianRangeByDay.set(dayStart, {
        high: Math.max(existing?.high ?? -Infinity, bar.high),
        low: Math.min(existing?.low ?? Infinity, bar.low),
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  // Spread normalized to instrument price scale
  const spreadPx = spreadPoints * inst.pipSize;
  const startIdx = Math.max(22, slowP);

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];

    // Manage active position first (conservative check: SL tested before TP on ambiguous bar)
    if (openTrade) {
      openTrade.barsOpen++;
      let closedPrice: number | null = null;
      let outcome: "WIN" | "LOSS" | null = null;

      if (openTrade.direction === "BUY") {
        if (c.low <= openTrade.stopLoss) {
          closedPrice = openTrade.stopLoss;
          outcome = "LOSS";
        } else if (c.high >= openTrade.takeProfit) {
          closedPrice = openTrade.takeProfit;
          outcome = "WIN";
        }
      } else {
        if (c.high >= openTrade.stopLoss) {
          closedPrice = openTrade.stopLoss;
          outcome = "LOSS";
        } else if (c.low <= openTrade.takeProfit) {
          closedPrice = openTrade.takeProfit;
          outcome = "WIN";
        }
      }

      // Close stale open trade after 36 bars at market
      if (closedPrice === null && (openTrade.barsOpen >= 36 || i === candles.length - 1)) {
        closedPrice = openTrade.direction === "BUY" ? c.close - spreadPx * 0.5 : c.close + spreadPx * 0.5;
        const rawDiff =
          openTrade.direction === "BUY"
            ? closedPrice - openTrade.entryPrice
            : openTrade.entryPrice - closedPrice;
        outcome = rawDiff > 0 ? "WIN" : "LOSS";
      }

      if (closedPrice !== null && outcome !== null) {
        const riskDist = Math.max(Math.abs(openTrade.entryPrice - openTrade.stopLoss), 1e-8);
        const signedMove =
          openTrade.direction === "BUY"
            ? closedPrice - openTrade.entryPrice
            : openTrade.entryPrice - closedPrice;
        const rRaw = signedMove / riskDist;
        const commission = Math.max(0, commissionPerLot * openTrade.lots);
        const pnl = rRaw * openTrade.riskUsd - commission;
        const netR = openTrade.riskUsd > 0 ? pnl / openTrade.riskUsd : 0;

        equity = Math.max(100, equity + pnl);
        if (equity > peakEquity) peakEquity = equity;
        const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;

        trades.push({
          index: trades.length + 1,
          direction: openTrade.direction,
          entryTime: openTrade.entryTime,
          exitTime: c.time,
          entryPrice: round(openTrade.entryPrice),
          exitPrice: round(closedPrice),
          stopLoss: round(openTrade.stopLoss),
          takeProfit: round(openTrade.takeProfit),
          pnl: Number(pnl.toFixed(2)),
          rMultiple: Number(netR.toFixed(2)),
          outcome: pnl >= 0 ? "WIN" : "LOSS",
          session: openTrade.session,
          reason: openTrade.reason,
        });

        equityCurve.push({
          time: c.time,
          equity: Number(equity.toFixed(2)),
          drawdownPct: Number(dd.toFixed(2)),
        });
        openTrade = null;
      }
      continue;
    }

    // Check session filter before looking for signal
    const session = classifySessionFromTimestamp(c.time);
    if (!sessionAllowed(session, sessionFilter)) continue;

    const atr = computeAtr(candles.slice(Math.max(0, i - 16), i + 1), 14);
    if (!atr || atr <= 0) continue;

    const prev1 = candles[i - 1];
    const prev2 = candles[i - 2];
    const recentSlice = candles.slice(i - 12, i);
    const localHigh = Math.max(...recentSlice.map((k) => k.high));
    const localLow = Math.min(...recentSlice.map((k) => k.low));
    const fast = emaF[i];
    const slow = emaS[i];
    if (!Number.isFinite(fast) || !Number.isFinite(slow)) continue;

    const dNow = barDeltaSign(c);
    const dPrev = barDeltaSign(prev1);
    const d3 = dNow + dPrev + barDeltaSign(prev2);
    const meanVol = avgVolWindow(i);
    const volStrong = !hasVol || (meanVol > 0 && c.volume >= meanVol * 1.15);

    let signal: { dir: "BUY" | "SELL"; reason: string } | null = null;

    if (logicType === "liquidity_sweep_bos") {
      // Liquidity sweep followed by reclamation + trend alignment
      const bullSweep = prev1.low < Math.min(...candles.slice(i - 10, i - 1).map((k) => k.low)) && prev1.close > prev1.low + (prev1.high - prev1.low) * 0.45 && c.close > prev1.high && dNow > 0;
      const bearSweep = prev1.high > Math.max(...candles.slice(i - 10, i - 1).map((k) => k.high)) && prev1.close < prev1.high - (prev1.high - prev1.low) * 0.45 && c.close < prev1.low && dNow < 0;
      const bullBos = c.close > localHigh && fast > slow && dNow > 0;
      const bearBos = c.close < localLow && fast < slow && dNow < 0;
      if (bullSweep) signal = { dir: "BUY", reason: "SSL sweep reclaimed + bullish BOS close" };
      else if (bearSweep) signal = { dir: "SELL", reason: "BSL sweep rejected + bearish BOS close" };
      else if (bullBos) signal = { dir: "BUY", reason: "Trend-aligned bullish BOS breakout" };
      else if (bearBos) signal = { dir: "SELL", reason: "Trend-aligned bearish BOS breakdown" };
    } else if (logicType === "ob_cvd_confluence") {
      // Order block displacement retest backed by 3-bar positive/negative CVD impulse
      const bullOb = prev2.close < prev2.open && prev1.close > prev2.high && c.low <= prev2.high && c.close > c.open && fast >= slow && d3 > 0;
      const bearOb = prev2.close > prev2.open && prev1.close < prev2.low && c.high >= prev2.low && c.close < c.open && fast <= slow && d3 < 0;
      const bullCont = fast > slow && prev1.close < prev1.open && c.close > prev1.high && d3 > 0 && volStrong;
      const bearCont = fast < slow && prev1.close > prev1.open && c.close < prev1.low && d3 < 0 && volStrong;
      if (bullOb || bullCont) signal = { dir: "BUY", reason: "Bullish order block reaction + positive CVD" };
      else if (bearOb || bearCont) signal = { dir: "SELL", reason: "Bearish order block rejection + negative CVD" };
    } else if (logicType === "asian_session_liquidity_reversal") {
      // Experimental Asian range sweep/reclaim. Build 00:00–03:00 UTC range;
      // entries are permitted only after the range closes, from 03:00–09:00 UTC.
      const utcHour = new Date(c.time).getUTCHours();
      const dayStart = new Date(c.time);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const completedRange = asianRangeByDay.get(dayStartMs);
      if (completedRange && completedRange.count >= 6 && utcHour >= 3 && utcHour < 9) {
        const asianHigh = completedRange.high;
        const asianLow = completedRange.low;
        const meaningfulRange = asianHigh - asianLow >= atr * 0.35;
        const bullishReclaim = prev1.low < asianLow && prev1.close > asianLow && c.close > prev1.high && c.close > c.open;
        const bearishReclaim = prev1.high > asianHigh && prev1.close < asianHigh && c.close < prev1.low && c.close < c.open;
        if (meaningfulRange && bullishReclaim) signal = { dir: "BUY", reason: "Asian range low swept and reclaimed with bullish confirmation" };
        else if (meaningfulRange && bearishReclaim) signal = { dir: "SELL", reason: "Asian range high swept and rejected with bearish confirmation" };
      }
    } else if (logicType === "session_range_reversal") {
      // Swept recent swing range high/low returning inside range with opposite momentum
      const rangeSpan = localHigh - localLow;
      if (rangeSpan > atr * 0.8) {
        if (c.low <= localLow && c.close > localLow && c.close > c.open && dNow > 0) {
          signal = { dir: "BUY", reason: "Session range low sweep & interior reclaim" };
        } else if (c.high >= localHigh && c.close < localHigh && c.close < c.open && dNow < 0) {
          signal = { dir: "SELL", reason: "Session range high sweep & interior fade" };
        }
      }
    } else if (logicType === "fvg_absorption_pullback") {
      // 3-bar Fair Value Gap with mitigation bounce & volume confirmation
      const bullFvg = candles[i - 1].low > candles[i - 3].high && c.low <= candles[i - 1].low && c.close > c.open && fast > slow;
      const bearFvg = candles[i - 1].high < candles[i - 3].low && c.high >= candles[i - 1].high && c.close < c.open && fast < slow;
      const bullAbsorb = fast > slow && c.close > c.open && Math.min(c.open, c.close) - c.low > Math.abs(c.close - c.open) * 1.1 && volStrong;
      const bearAbsorb = fast < slow && c.close < c.open && c.high - Math.max(c.open, c.close) > Math.abs(c.close - c.open) * 1.1 && volStrong;
      if (bullFvg || bullAbsorb) signal = { dir: "BUY", reason: bullFvg ? "Bullish FVG mitigation bounce" : "Lower-wick bid absorption in uptrend" };
      else if (bearFvg || bearAbsorb) signal = { dir: "SELL", reason: bearFvg ? "Bearish FVG rejection fill" : "Upper-wick offer absorption in downtrend" };
    } else {
      // Custom multi-timeframe structure continuation (EMA cross/pullback + delta filter)
      const prevF = emaF[i - 1];
      const prevS = emaS[i - 1];
      if (Number.isFinite(prevF) && Number.isFinite(prevS)) {
        if (prevF <= prevS && fast > slow && dNow > 0) {
          signal = { dir: "BUY", reason: "Bullish structure alignment & positive delta" };
        } else if (prevF >= prevS && fast < slow && dNow < 0) {
          signal = { dir: "SELL", reason: "Bearish structure alignment & negative delta" };
        } else if (fast > slow && prev1.close < fast && c.close > fast && dNow > 0 && volStrong) {
          signal = { dir: "BUY", reason: "Dynamic structure pullback reclaim long" };
        } else if (fast < slow && prev1.close > fast && c.close < fast && dNow < 0 && volStrong) {
          signal = { dir: "SELL", reason: "Dynamic structure pullback reject short" };
        }
      }
    }

    if (signal) {
      const slDist = Math.max(atr * slAtrMultiple, spreadPx * 3);
      const entry = signal.dir === "BUY" ? c.close + spreadPx * 0.5 : c.close - spreadPx * 0.5;
      const stopLoss = signal.dir === "BUY" ? entry - slDist : entry + slDist;
      const takeProfit = signal.dir === "BUY" ? entry + slDist * tpRiskMultiple : entry - slDist * tpRiskMultiple;
      const riskUsd = equity * (riskPercent / 100);
      const dollarPerPointPerLot = inst.contractSize;
      const lots = Math.max(0.01, Math.min(50, riskUsd / Math.max(slDist * dollarPerPointPerLot, 1e-4)));

      openTrade = {
        direction: signal.dir,
        entryTime: c.time,
        entryPrice: entry,
        stopLoss,
        takeProfit,
        riskUsd,
        lots,
        session,
        reason: signal.reason,
        barsOpen: 0,
      };
    }
  }

  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.outcome === "WIN");
  const losses = trades.filter((t) => t.outcome === "LOSS");
  const grossWin = wins.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const netProfit = equity - initialBalance;
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9.99 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((a, b) => a + b.rMultiple, 0) / wins.length : 0;
  const expectedValue = totalTrades > 0 ? netProfit / totalTrades : 0;

  let curW = 0;
  let curL = 0;
  let maxW = 0;
  let maxL = 0;
  for (const t of trades) {
    if (t.outcome === "WIN") {
      curW++;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else {
      curL++;
      curW = 0;
      if (curL > maxL) maxL = curL;
    }
  }

  return {
    totalTrades,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(Math.min(99, profitFactor).toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    finalBalance: Number(equity.toFixed(2)),
    avgRiskReward: Number(avgWinR.toFixed(2)),
    expectedValue: Number(expectedValue.toFixed(2)),
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    equityCurve,
    trades,
  };
}

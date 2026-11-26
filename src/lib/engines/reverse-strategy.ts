import type { BacktestTradeRecord } from "@/db/schema";
import type { Candle } from "../market-data";

export interface ReverseStrategyInput {
  selection?: "ALL" | "LOSERS_ONLY" | "WINNERS_ONLY";
  trades: BacktestTradeRecord[];
  candles: Candle[];
  initialBalance: number;
  riskPercent: number;
  spreadPoints: number;
  pipSize: number;
  commissionPerLot: number;
  contractSize: number;
}

export interface ReverseTradeResult {
  sourceTradeIndex: number;
  originalDirection: "BUY" | "SELL";
  direction: "BUY" | "SELL";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  pnl: number;
  rMultiple: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "TIME_EXIT" | "NO_FUTURE_DATA";
}

export interface ReverseStrategyResult {
  engine: "REVERSE_STRATEGY_ENGINE";
  mode: "ALL_REVERSED" | "LOSERS_ONLY_REVERSED" | "WINNERS_ONLY_REVERSED";
  sourceTradeCount: number;
  skippedTrades: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netProfit: number;
  finalBalance: number;
  maxDrawdownPct: number;
  expectedValue: number;
  trades: ReverseTradeResult[];
  limitations: string[];
}

/**
 * Replays the opposite side of each recorded original trade against the same candle stream.
 * It mirrors the original risk/reward distances around the original entry, preserving chronology.
 * This is a counterfactual research run, never a live signal generator.
 */
export function runReverseStrategyResearch(input: ReverseStrategyInput): ReverseStrategyResult {
  const { trades, candles, initialBalance, riskPercent, spreadPoints, pipSize, commissionPerLot, contractSize } = input;
  const selection = input.selection ?? "ALL";
  const selectedTrades = trades.filter((trade) => selection === "ALL" || (selection === "LOSERS_ONLY" ? trade.outcome === "LOSS" : trade.outcome === "WIN"));
  const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
  const candleIndex = new Map<number, number>();
  sortedCandles.forEach((c, i) => candleIndex.set(c.time, i));

  let equity = initialBalance;
  let peak = initialBalance;
  let maxDrawdownPct = 0;
  const results: ReverseTradeResult[] = [];
  const spread = Math.max(0, spreadPoints * pipSize);

  for (const original of [...selectedTrades].sort((a, b) => a.entryTime - b.entryTime)) {
    const start = candleIndex.get(original.entryTime);
    if (start === undefined || start >= sortedCandles.length - 1) continue;

    const direction = original.direction === "BUY" ? "SELL" : "BUY";
    const riskDistance = Math.abs(original.entryPrice - original.stopLoss);
    const rewardDistance = Math.abs(original.takeProfit - original.entryPrice);
    if (!(riskDistance > 0) || !(rewardDistance > 0)) continue;

    const entryPrice = original.entryPrice + (direction === "BUY" ? spread / 2 : -spread / 2);
    const stopLoss = direction === "BUY" ? entryPrice - riskDistance : entryPrice + riskDistance;
    const takeProfit = direction === "BUY" ? entryPrice + rewardDistance : entryPrice - rewardDistance;
    const riskUsd = equity * (riskPercent / 100);
    const lots = Math.max(0.01, Math.min(50, riskUsd / Math.max(riskDistance * contractSize, 1e-8)));
    const commission = Math.max(0, commissionPerLot * lots);

    // Match the original trade's holding period, with a 36-bar safety ceiling.
    const originalExitIndex = candleIndex.get(original.exitTime);
    const originalDuration = originalExitIndex === undefined ? 36 : Math.max(1, originalExitIndex - start);
    const maxBars = Math.min(36, originalDuration);
    let exitPrice = entryPrice;
    let exitTime = sortedCandles[start + 1].time;
    let exitReason: ReverseTradeResult["exitReason"] = "NO_FUTURE_DATA";
    let closed = false;

    for (let j = start + 1; j < Math.min(sortedCandles.length, start + maxBars + 1); j++) {
      const candle = sortedCandles[j];
      exitTime = candle.time;
      if (direction === "BUY") {
        if (candle.low <= stopLoss) { exitPrice = stopLoss; exitReason = "STOP_LOSS"; closed = true; break; }
        if (candle.high >= takeProfit) { exitPrice = takeProfit; exitReason = "TAKE_PROFIT"; closed = true; break; }
      } else {
        if (candle.high >= stopLoss) { exitPrice = stopLoss; exitReason = "STOP_LOSS"; closed = true; break; }
        if (candle.low <= takeProfit) { exitPrice = takeProfit; exitReason = "TAKE_PROFIT"; closed = true; break; }
      }
      exitPrice = candle.close;
      exitReason = "TIME_EXIT";
      closed = true;
    }
    if (!closed) continue;

    const signedMove = direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
    const grossR = signedMove / riskDistance;
    const pnl = grossR * riskUsd - commission;
    const rMultiple = riskUsd > 0 ? pnl / riskUsd : 0;
    const outcome = pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BREAKEVEN";
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);

    results.push({
      sourceTradeIndex: original.index,
      originalDirection: original.direction,
      direction,
      entryTime: original.entryTime,
      exitTime,
      entryPrice,
      stopLoss,
      takeProfit,
      exitPrice,
      outcome,
      pnl: Number(pnl.toFixed(2)),
      rMultiple: Number(rMultiple.toFixed(3)),
      exitReason,
    });
  }

  const wins = results.filter(t => t.outcome === "WIN");
  const losses = results.filter(t => t.outcome === "LOSS");
  const grossWins = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netProfit = equity - initialBalance;

  return {
    engine: "REVERSE_STRATEGY_ENGINE",
    mode: selection === "ALL" ? "ALL_REVERSED" : selection === "LOSERS_ONLY" ? "LOSERS_ONLY_REVERSED" : "WINNERS_ONLY_REVERSED",
    sourceTradeCount: selectedTrades.length,
    skippedTrades: Math.max(0, selectedTrades.length - results.length),
    totalTrades: results.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: results.length ? Number((wins.length / results.length * 100).toFixed(2)) : 0,
    profitFactor: grossLosses ? Number((grossWins / grossLosses).toFixed(3)) : grossWins > 0 ? 99 : 0,
    netProfit: Number(netProfit.toFixed(2)),
    finalBalance: Number(equity.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    expectedValue: results.length ? Number((netProfit / results.length).toFixed(2)) : 0,
    trades: results,
    limitations: [
      "Counterfactual replay only: opposite trades are evaluated at the original entry timestamps.",
      "The reverse trade mirrors the original stop distance and target distance; it does not invent a new signal or optimize levels.",
      "Candle data cannot reveal intrabar price ordering. When stop-loss and take-profit are both touched in one candle, stop-loss is conservatively assumed first.",
      "Only saved trade records are eligible; runs persist at most 150 trade records.",
      selection === "LOSERS_ONLY" ? "Losers-only mode reverses only trades marked LOSS by the source backtest; it is not a new entry model." : selection === "WINNERS_ONLY" ? "Winners-only mode reverses only trades marked WIN by the source backtest; it is a diagnostic control." : "All-trades mode reverses every saved source trade.",
      "Results are research-only and must not publish or execute live signals.",
    ],
  };
}

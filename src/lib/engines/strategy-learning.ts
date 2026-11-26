import type { BacktestTradeRecord } from "@/db/schema";
import type { Candle } from "../market-data";

export type ResearchOutcome = "WIN" | "LOSS" | "BREAKEVEN";
export type TrendState = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface ReverseOutcomeRecord {
  sourceTradeIndex: number;
  outcome: ResearchOutcome;
}

export interface StrategyLearningFeatures {
  trend: TrendState;
  emaSpreadAtr: number;
  atrPercent: number;
  momentum3Atr: number;
  candleBodyToRange: number;
  upperWickToRange: number;
  lowerWickToRange: number;
  rangeExpansion: number;
  closeLocation: number;
  distanceTo20BarHighAtr: number;
  distanceTo20BarLowAtr: number;
}

export interface StrategyLearningRow {
  sourceTradeIndex: number;
  entryTime: number;
  originalDirection: "BUY" | "SELL";
  originalOutcome: ResearchOutcome;
  reverseOutcome: ResearchOutcome | null;
  session: string;
  features: StrategyLearningFeatures;
}

export interface FeatureSeparation {
  feature: keyof StrategyLearningFeatures;
  originalWinnerMedian: number;
  originalLoserMedian: number;
  reverseWinnerMedian: number | null;
  reverseLoserMedian: number | null;
  originalSampleSizes: { winners: number; losers: number };
  reverseSampleSizes: { winners: number; losers: number };
  interpretation: "WINNERS_HIGHER" | "LOSERS_HIGHER" | "NO_CLEAR_SEPARATION";
}

export interface StrategyLearningReport {
  engine: "FREYR_STRATEGY_LEARNING_RESEARCH";
  rows: StrategyLearningRow[];
  skipped: { tradeIndex: number; reason: string }[];
  featureSeparation: FeatureSeparation[];
  limitations: string[];
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function snapshot(candles: Candle[]): StrategyLearningFeatures | null {
  // The caller supplies only candles timestamped strictly before the trade entry.
  if (candles.length < 30) return null;
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const closes = candles.map((c) => c.close);
  const fast = ema(closes.slice(-40), 12);
  const slow = ema(closes.slice(-60), 30);
  if (fast === null || slow === null) return null;

  const atrWindow = candles.slice(-15);
  const atrStart = candles.length - atrWindow.length;
  const trValues = atrWindow.map((c, index) => {
    const priorClose = candles[Math.max(0, atrStart + index - 1)].close;
    return Math.max(c.high - c.low, Math.abs(c.high - priorClose), Math.abs(c.low - priorClose));
  });
  const atr = trValues.reduce((sum, n) => sum + n, 0) / trValues.length;
  if (!(atr > 0)) return null;

  const range = Math.max(current.high - current.low, 1e-9);
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const prior20 = candles.slice(-21, -1);
  if (prior20.length < 10) return null;
  const priorRangeMedian = median(prior20.map((c) => c.high - c.low)) ?? atr;
  const high20 = Math.max(...prior20.map((c) => c.high));
  const low20 = Math.min(...prior20.map((c) => c.low));
  const momentumBase = candles[Math.max(0, candles.length - 4)].close;
  const emaSpread = (fast - slow) / atr;

  return {
    trend: emaSpread > 0.08 ? "BULLISH" : emaSpread < -0.08 ? "BEARISH" : "NEUTRAL",
    emaSpreadAtr: Number(emaSpread.toFixed(4)),
    atrPercent: Number((atr / current.close * 100).toFixed(5)),
    momentum3Atr: Number(((current.close - momentumBase) / atr).toFixed(4)),
    candleBodyToRange: Number((body / range).toFixed(4)),
    upperWickToRange: Number((upperWick / range).toFixed(4)),
    lowerWickToRange: Number((lowerWick / range).toFixed(4)),
    rangeExpansion: Number((range / Math.max(priorRangeMedian, 1e-9)).toFixed(4)),
    closeLocation: Number(((current.close - current.low) / range).toFixed(4)),
    distanceTo20BarHighAtr: Number(((high20 - current.close) / atr).toFixed(4)),
    distanceTo20BarLowAtr: Number(((current.close - low20) / atr).toFixed(4)),
  };
}

function buildSeparation(rows: StrategyLearningRow[]): FeatureSeparation[] {
  const keys: (keyof StrategyLearningFeatures)[] = [
    "emaSpreadAtr", "atrPercent", "momentum3Atr", "candleBodyToRange",
    "upperWickToRange", "lowerWickToRange", "rangeExpansion", "closeLocation",
    "distanceTo20BarHighAtr", "distanceTo20BarLowAtr",
  ];

  return keys.map((feature) => {
    const originalWinners = rows.filter((r) => r.originalOutcome === "WIN").map((r) => r.features[feature]);
    const originalLosers = rows.filter((r) => r.originalOutcome === "LOSS").map((r) => r.features[feature]);
    const reverseWinners = rows.filter((r) => r.reverseOutcome === "WIN").map((r) => r.features[feature]);
    const reverseLosers = rows.filter((r) => r.reverseOutcome === "LOSS").map((r) => r.features[feature]);
    const ow = median(originalWinners);
    const ol = median(originalLosers);
    const rw = median(reverseWinners);
    const rl = median(reverseLosers);
    const originalDiff = ow === null || ol === null ? 0 : ow - ol;
    const reverseDiff = rw === null || rl === null ? 0 : rw - rl;
    const combined = originalDiff + reverseDiff;
    return {
      feature,
      originalWinnerMedian: ow ?? 0,
      originalLoserMedian: ol ?? 0,
      reverseWinnerMedian: rw,
      reverseLoserMedian: rl,
      originalSampleSizes: { winners: originalWinners.length, losers: originalLosers.length },
      reverseSampleSizes: { winners: reverseWinners.length, losers: reverseLosers.length },
      interpretation: Math.abs(combined) < 0.05 ? "NO_CLEAR_SEPARATION" : combined > 0 ? "WINNERS_HIGHER" : "LOSERS_HIGHER",
    };
  });
}

/**
 * Compares conditions present before each original entry with the eventual original
 * and counterfactual reverse outcomes. This is diagnostic feature research only:
 * it does not fit a live model, alter the existing strategy, or publish signals.
 */
export function buildStrategyLearningReport(input: {
  trades: BacktestTradeRecord[];
  candles: Candle[];
  reverseOutcomes?: ReverseOutcomeRecord[];
}): StrategyLearningReport {
  const candles = [...input.candles].sort((a, b) => a.time - b.time);
  const reverseByTrade = new Map((input.reverseOutcomes ?? []).map((r) => [r.sourceTradeIndex, r.outcome]));
  const rows: StrategyLearningRow[] = [];
  const skipped: StrategyLearningReport["skipped"] = [];

  for (const trade of [...input.trades].sort((a, b) => a.entryTime - b.entryTime)) {
    // Binary search the final candle strictly before entry to avoid scanning the full
    // historical series once per trade.
    let lo = 0;
    let hi = candles.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candles[mid].time < trade.entryTime) lo = mid + 1;
      else hi = mid;
    }
    const prior = candles.slice(Math.max(0, lo - 60), lo);
    const features = snapshot(prior);
    if (!features) {
      skipped.push({ tradeIndex: trade.index, reason: "Fewer than 30 complete pre-entry candles or invalid ATR." });
      continue;
    }
    rows.push({
      sourceTradeIndex: trade.index,
      entryTime: trade.entryTime,
      originalDirection: trade.direction,
      originalOutcome: trade.outcome,
      reverseOutcome: reverseByTrade.get(trade.index) ?? null,
      session: trade.session,
      features,
    });
  }

  return {
    engine: "FREYR_STRATEGY_LEARNING_RESEARCH",
    rows,
    skipped,
    featureSeparation: buildSeparation(rows),
    limitations: [
      "Research-only. This module does not change live Freyr signal generation or publication.",
      "Features use only candles timestamped strictly before each recorded entry; the signal candle is excluded conservatively.",
      "Original and reverse outcomes are labels for analysis, not inputs available before entry. Never use final outcomes as live filters.",
      "Reverse outcomes are counterfactual results at the original trade timestamps, not independently discovered reverse entries.",
      "Median separation is descriptive, not proof of predictive power. Any candidate rule must be tested chronologically out of sample.",
      "The input candle source, timestamp convention, spread, commission and slippage must be verified before interpreting results.",
    ],
  };
}

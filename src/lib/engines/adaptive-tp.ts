export interface AdaptiveTakeProfitInput {
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  atr: number;
  momentumScore: number; // directional strength, 0..100
  volatilityPct: number; // ATR as percentage of price
  opposingLiquidity?: number | null;
  minRiskReward?: number;
}
export interface AdaptiveTakeProfitResult {
  takeProfit: number;
  riskReward: number;
  atrMultiple: number;
  momentum: "WEAK" | "MODERATE" | "STRONG" | "EXTREME";
  volatility: "LOW" | "NORMAL" | "HIGH";
  constrainedByLiquidity: boolean;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export function calculateAdaptiveTakeProfit(input: AdaptiveTakeProfitInput): AdaptiveTakeProfitResult | null {
  const { side, entry, stopLoss, atr } = input;
  if (![entry, stopLoss, atr, input.momentumScore, input.volatilityPct].every(Number.isFinite) || entry <= 0 || atr <= 0) return null;
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0 || (side === "BUY" ? stopLoss >= entry : stopLoss <= entry)) return null;
  const minR = Math.max(0.1, input.minRiskReward ?? 1.5);
  const momentumScore = clamp(input.momentumScore, 0, 100);
  const momentumFactor = 1 + (momentumScore / 100) * 0.9;
  // Normalize volatility around 0.25% ATR/price; dampen extremes rather than rewarding volatility blindly.
  const volRatio = input.volatilityPct / 0.25;
  const volatilityFactor = clamp(0.85 + volRatio * 0.15, 0.85, 1.2);
  const atrMultiple = clamp(1.6 * momentumFactor * volatilityFactor, 1.5, 4.5);
  const minDistance = risk * minR;
  let distance = Math.max(atr * atrMultiple, minDistance);
  let constrainedByLiquidity = false;
  const pool = input.opposingLiquidity;
  if (typeof pool === "number" && Number.isFinite(pool)) {
    const poolDistance = side === "BUY" ? pool - entry : entry - pool;
    // Only use a real opposing pool when it is in front of price and still offers the configured minimum R.
    if (poolDistance >= minDistance && poolDistance < distance) {
      distance = poolDistance;
      constrainedByLiquidity = true;
    }
  }
  const takeProfit = side === "BUY" ? entry + distance : entry - distance;
  const momentum = momentumScore >= 85 ? "EXTREME" : momentumScore >= 65 ? "STRONG" : momentumScore >= 40 ? "MODERATE" : "WEAK";
  const volatility = input.volatilityPct >= 0.5 ? "HIGH" : input.volatilityPct <= 0.15 ? "LOW" : "NORMAL";
  return {
    takeProfit,
    riskReward: Number((distance / risk).toFixed(2)),
    atrMultiple: Number(atrMultiple.toFixed(2)),
    momentum,
    volatility,
    constrainedByLiquidity,
  };
}

import type { Candle, EconomicEvent } from "@/lib/market-data";

export const REACTION_WINDOW_MS = 2 * 60 * 60_000;
export const REACTION_BAR_MS = 5 * 60_000;
export const FLAT_THRESHOLD_PCT = 0.06;

function comparable(raw: string) {
  const match = raw.trim().replace(/[−–]/g, "-").replaceAll(",", "").match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([%KMBT])?$/i);
  if (!match) return null;
  const unit = match[2]?.toUpperCase() ?? "";
  const multiplier: Record<string, number> = { K: 1000, M: 1e6, B: 1e9, T: 1e12 };
  const value = Number(match[1]) * (multiplier[unit] ?? 1);
  return Number.isFinite(value) ? { value, percent: unit === "%" } : null;
}

/** Make a conditional directional call only for comparable, supported USD data. */
export function predictionFor(event: EconomicEvent): "BUY" | "SELL" | null {
  if (event.currency !== "USD" || (event.impact !== "High" && event.impact !== "Medium")) return null;
  const title = event.title.toLowerCase();
  const family = event.category;
  if (!(family === "Inflation" || family === "Employment" || family === "Growth" || /consumer confidence/.test(title))) return null;
  // Exclude balances and mixed releases where a larger figure is not a reliable directional input.
  if (/(trade balance|inventor|deficit|import prices|export prices)/.test(title)) return null;
  const forecast = comparable(event.forecast);
  const prior = comparable(event.previous);
  if (!forecast || !prior || forecast.percent !== prior.percent) return null;
  const diff = forecast.value - prior.value;
  if (Math.abs(diff) < 1e-9) return null;
  const inverse = /(unemployment|jobless|claims)/.test(title);
  const usdSupportive = inverse ? diff < 0 : diff > 0;
  return usdSupportive ? "SELL" : "BUY";
}

export function hasActualPrint(event: EconomicEvent) {
  const value = event.actual.trim();
  return value !== "" && !/^(?:—|–|-|pending|n\/a|na)$/i.test(value);
}

/** Compare the same two completed five-minute closes for every prediction; never substitute a current quote. */
export function scoreNewsReaction(candles: ReadonlyMap<number, Candle>, releaseAt: number, direction: "BUY" | "SELL", now: number) {
  const end = releaseAt + REACTION_WINDOW_MS;
  if (now < end) return null;
  const closeAtOrBefore = (timestamp: number) => candles.get(Math.floor(timestamp / REACTION_BAR_MS) * REACTION_BAR_MS - REACTION_BAR_MS)?.close;
  const before = closeAtOrBefore(releaseAt);
  const after = closeAtOrBefore(end);
  if (before === undefined || after === undefined || !Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return null;
  const movePct = ((after - before) / before) * 100;
  const outcome = Math.abs(movePct) <= FLAT_THRESHOLD_PCT ? "FLAT" : ((direction === "BUY") === (movePct > 0) ? "MATCHED" : "OPPOSITE");
  return { outcome, movePct } as const;
}

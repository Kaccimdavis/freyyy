import test from "node:test";
import assert from "node:assert/strict";
import { isOpenSignal, isTargetHit, signalPriceOutcome, nextSignalStatuses, publishingGate, SIGNAL_COOLDOWN_MS, SIGNAL_MAX_AGE_MS, signalDeadline, validSignalLevels } from "../src/lib/signal-policy.ts";
import { hasActualPrint, predictionFor, REACTION_BAR_MS, REACTION_WINDOW_MS, scoreNewsReaction } from "../src/lib/news-rules.ts";

const start = new Date("2026-11-24T10:00:00Z");

test("the deadline is three hours from publication, including after a first target", () => {
  assert.equal(SIGNAL_MAX_AGE_MS, 180 * 60_000);
  assert.equal(signalDeadline(start).toISOString(), "2026-11-24T13:00:00.000Z");
  assert.equal(isOpenSignal("TP1_REACHED"), true);
  assert.deepEqual(nextSignalStatuses("EXPIRED"), []);
  assert.equal(nextSignalStatuses("TP1_REACHED").includes("ACTIVE"), false);
});

test("the cooldown runs from resolution and is exact to the boundary", () => {
  const closed = signalDeadline(start);
  assert.equal(publishingGate(true, start, null, start.getTime() + SIGNAL_COOLDOWN_MS).hasOpen, true);
  assert.equal(publishingGate(false, start, closed, closed.getTime() + SIGNAL_COOLDOWN_MS - 1).remainingMs, 1);
  assert.equal(publishingGate(false, start, closed, closed.getTime() + SIGNAL_COOLDOWN_MS).remainingMs, 0);
  assert.equal(publishingGate(false, null, null).nextAvailableAt, null);
  assert.equal(validSignalLevels("SELL", 3700, 3720, 3660), true);
  assert.equal(validSignalLevels("BUY", 3700, 3720, 3660), false);
});

test("new signals have a single terminal take profit while old checkpoints remain archival", () => {
  const buy = { direction: "BUY", stopLoss: 3680, takeProfit: 3725, status: "ACTIVE" };
  assert.equal(signalPriceOutcome(buy, 3724), null);
  assert.equal(signalPriceOutcome(buy, 3725), "TP_HIT");
  assert.equal(signalPriceOutcome(buy, 3680), "SL_HIT");
  assert.equal(signalPriceOutcome({ ...buy, status: "PENDING" }, 3725), null);
  assert.equal(signalPriceOutcome({ ...buy, legacyPartialTarget: 3710 }, 3710), "TP1_REACHED");
  assert.equal(signalPriceOutcome({ ...buy, legacyPartialTarget: 3710 }, 3750), "TP_HIT");
  assert.equal(signalPriceOutcome({ ...buy, legacyPartialTarget: 3725 }, 3725), "TP_HIT");
  assert.equal(signalPriceOutcome({ direction: "SELL", stopLoss: 3710, takeProfit: 3670, status: "ACTIVE" }, 3670), "TP_HIT");
  assert.ok(nextSignalStatuses("ACTIVE").includes("TP_HIT"));
  assert.ok(!nextSignalStatuses("ACTIVE").includes("TP1_REACHED"));
  assert.ok(isTargetHit("TP2_REACHED"));
  assert.ok(!isOpenSignal("TP_HIT"));
});

const data = { title: "Core PCE Price Index m/m", currency: "USD", impact: "High", category: "Inflation", forecast: "0.3%", previous: "0.2%", actual: "Pending" };
test("only comparable directional inputs qualify for a call", () => {
  assert.equal(predictionFor(data), "SELL");
  assert.equal(predictionFor({ ...data, category: "Rates" }), null);
  assert.equal(predictionFor({ ...data, previous: "—" }), null);
  assert.equal(predictionFor({ ...data, previous: "245K" }), null);
  assert.equal(predictionFor({ ...data, title: "Unemployment Claims", category: "Employment", forecast: "245K", previous: "225K" }), "BUY");
  assert.equal(hasActualPrint(data), false);
  assert.equal(hasActualPrint({ ...data, actual: "0.2%" }), true);
});

test("news outcomes use the completed closes at both boundaries", () => {
  const release = start.getTime();
  const end = release + REACTION_WINDOW_MS;
  const bars = new Map([[release - REACTION_BAR_MS, { close: 3700 }], [end - REACTION_BAR_MS, { close: 3675 }], [end, { close: 3900 }]]);
  assert.equal(scoreNewsReaction(bars, release, "SELL", end - 1), null);
  assert.equal(scoreNewsReaction(bars, release, "SELL", end).outcome, "MATCHED");
  assert.equal(scoreNewsReaction(bars, release, "BUY", end).outcome, "OPPOSITE");
  bars.delete(end - REACTION_BAR_MS);
  assert.equal(scoreNewsReaction(bars, release, "BUY", end), null);
  bars.set(end - REACTION_BAR_MS, { close: 3701 });
  assert.equal(scoreNewsReaction(bars, release, "BUY", end).outcome, "FLAT");
});

import { calculateAdaptiveTakeProfit } from "../src/lib/engines/adaptive-tp.ts";

test("adaptive TP expands with momentum while respecting minimum R and liquidity", () => {
  const weak = calculateAdaptiveTakeProfit({ side: "BUY", entry: 4000, stopLoss: 3990, atr: 10, momentumScore: 30, volatilityPct: 0.25, minRiskReward: 1.5 });
  const strong = calculateAdaptiveTakeProfit({ side: "BUY", entry: 4000, stopLoss: 3990, atr: 10, momentumScore: 90, volatilityPct: 0.25, minRiskReward: 1.5 });
  assert.ok(weak && strong);
  assert.ok(strong.takeProfit > weak.takeProfit);
  assert.ok(weak.riskReward >= 1.5);
  const capped = calculateAdaptiveTakeProfit({ side: "BUY", entry: 4000, stopLoss: 3990, atr: 10, momentumScore: 90, volatilityPct: 0.25, opposingLiquidity: 4040, minRiskReward: 1.5 });
  assert.equal(capped?.takeProfit, 4040);
  assert.equal(capped?.constrainedByLiquidity, true);
});
test("adaptive TP validates direction and supports sell targets", () => {
  const sell = calculateAdaptiveTakeProfit({ side: "SELL", entry: 4000, stopLoss: 4010, atr: 10, momentumScore: 80, volatilityPct: 0.3, minRiskReward: 1.5 });
  assert.ok(sell && sell.takeProfit < 4000);
  assert.equal(calculateAdaptiveTakeProfit({ side: "BUY", entry: 4000, stopLoss: 4010, atr: 10, momentumScore: 80, volatilityPct: 0.3 }), null);
});

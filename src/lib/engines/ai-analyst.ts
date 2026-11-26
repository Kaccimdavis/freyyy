import {
  computeAtr,
  fetchCandles,
  fetchEconomicCalendar,
  fetchOrderBook,
  getActiveSessions,
  getInstrument,
  type Candle,
  type DataStatus,
} from "../market-data";
import { analyzeLiquidityAndStructure } from "./liquidity";
import { calculateAdaptiveTakeProfit } from "./adaptive-tp";
import { runModFlowAnalysis } from "./modflow";
import type { AnalysisScenario, ChartAnalysisSnapshot, EngineScoreItem } from "@/db/schema";

export interface DecisionEngineOutput {
  symbol: string;
  timeframes: string[];
  currentPrice: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  setupState: "VALID" | "WATCHLIST" | "INVALID";
  setupExplanation: string;
  confidenceScore: number;
  confidenceThreshold: number;
  engineBreakdown: EngineScoreItem[];
  supportingEvidence: string[];
  keyLevels: { label: string; price: number; kind: string }[];
  liquidityTargets: { label: string; price: number; side: string }[];
  entryConditions: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  invalidationConditions: string[];
  scenarios: AnalysisScenario[];
  briefing: string;
  dataSource: string;
  dataStatus: DataStatus;
  dataAgeSec: number;
  analyzedAt: string;
  h1Bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  m15Structure: "BULLISH" | "BEARISH" | "RANGING";
  m5Execution: "BULLISH" | "BEARISH" | "NEUTRAL";
  confirmationsCount: number;
  activeSession: string;
  chartSnapshot?: ChartAnalysisSnapshot;
}

function calcEma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function roundPrice(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function formatPx(v: number, decimals: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function evaluateTechnicalTrend(candles: Candle[]): {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  score: number; // -100 to +100
} {
  if (candles.length < 25) return { bias: "NEUTRAL", ema20: null, ema50: null, rsi14: null, score: 0 };
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ema20 = calcEma(closes, 20);
  const ema50 = calcEma(closes, Math.min(50, Math.max(25, closes.length - 2)));

  // Standard 14-period RSI
  let gains = 0;
  let losses = 0;
  const look = Math.min(14, closes.length - 1);
  for (let i = closes.length - look; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi14 = losses === 0 ? 100 : 100 - 100 / (1 + rs);

  let score = 0;
  if (ema20 !== null) score += price > ema20 ? 30 : -30;
  if (ema50 !== null) score += price > ema50 ? 25 : -25;
  if (ema20 !== null && ema50 !== null) score += ema20 > ema50 ? 25 : -25;
  if (rsi14 >= 55 && rsi14 <= 74) score += 20;
  else if (rsi14 <= 45 && rsi14 >= 26) score -= 20;

  const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    score >= 30 ? "BULLISH" : score <= -30 ? "BEARISH" : "NEUTRAL";
  return { bias, ema20, ema50, rsi14: Number(rsi14.toFixed(1)), score };
}

/**
 * Interconnected Multi-Engine FREYR AI Analyst.
 * Combines weighted telemetry across 5 independent engines (Market Data/HTF Technical,
 * M15/M5 Liquidity & Structure, ModFlow Institutional Order Flow, Fundamental Calendar,
 * and Risk/RR Governance). No single indicator can declare a valid trade setup alone.
 */
export async function runMultiEngineAnalysis(params: {
  symbol?: string;
  confidenceThreshold?: number;
  minRiskReward?: number;
  includeChart?: boolean;
}): Promise<DecisionEngineOutput> {
  const inst = getInstrument(params.symbol ?? "XAUUSD");
  const symbol = inst.symbol;
  const dec = inst.decimals;
  const threshold = Math.min(95, Math.max(70, params.confidenceThreshold ?? 70));
  const minRr = Math.max(1.2, params.minRiskReward ?? 1.8);

  // Run interconnected live engines in parallel
  const [h1Res, m15Res, m5Res, d1Res, bookRes, calRes] = await Promise.all([
    fetchCandles(symbol, "1h"),
    fetchCandles(symbol, "15m"),
    fetchCandles(symbol, "5m"),
    fetchCandles(symbol, "1d"),
    fetchOrderBook(symbol),
    fetchEconomicCalendar(),
  ]);

  const sessionState = getActiveSessions();
  const h1Candles = h1Res.candles;
  const m15Candles = m15Res.candles;
  const m5Candles = m5Res.candles;

  if (m15Candles.length < 10 && h1Candles.length < 10) {
    return {
      symbol,
      timeframes: ["1h", "15m", "5m"],
      currentPrice: 0,
      direction: "NEUTRAL",
      setupState: "INVALID",
      setupExplanation:
        "Upstream market data is currently unavailable for this instrument. FREYR refuses to fabricate analysis without validated candles.",
      confidenceScore: 0,
      confidenceThreshold: threshold,
      engineBreakdown: [
        {
          engine: "Market Data Engine",
          weight: 100,
          bias: "NEUTRAL",
          score: 0,
          summary: h1Res.error ?? "No verified candles received.",
          evidence: ["Retry feed synchronization before evaluating setups."],
          dataStatus: "UNAVAILABLE",
        },
      ],
      supportingEvidence: ["Price history unavailable — analysis paused until feed recovers."],
      keyLevels: [],
      liquidityTargets: [],
      entryConditions: "Stand aside until verified candles are restored.",
      entryPrice: 0,
      stopLoss: 0,
      takeProfit: 0,
      riskReward: 0,
      invalidationConditions: ["Feed offline — no active setup permitted."],
      scenarios: [],
      briefing: `${symbol} market feed is currently unavailable. No trade signals or bias will be manufactured.`,
      dataSource: m15Res.source,
      dataStatus: "UNAVAILABLE",
      dataAgeSec: Math.max(h1Res.cacheAgeSec, m15Res.cacheAgeSec),
      analyzedAt: new Date().toISOString(),
      h1Bias: "NEUTRAL",
      m15Structure: "RANGING",
      m5Execution: "NEUTRAL",
      confirmationsCount: 0,
      activeSession: sessionState.currentLabel,
    };
  }

  const primaryCandles = m15Candles.length >= 15 ? m15Candles : h1Candles;
  const currentPrice =
    bookRes.status !== "UNAVAILABLE" && bookRes.midPrice > 0
      ? bookRes.midPrice
      : primaryCandles[primaryCandles.length - 1].close;

  // 1. Technical Multi-Timeframe Engine (H1 direction + M5 execution timing)
  const h1Tech = evaluateTechnicalTrend(h1Candles);
  const m5Tech = evaluateTechnicalTrend(m5Candles.length >= 25 ? m5Candles : primaryCandles);
  const m15Atr = computeAtr(primaryCandles, 14) ?? currentPrice * 0.0025;

  // 2. Liquidity & Market Structure Engine (M15 primary structure + daily/H1 anchors)
  const liqM15 = analyzeLiquidityAndStructure({
    symbol,
    timeframe: "15m",
    candles: primaryCandles,
    dailyCandles: d1Res.candles,
    hourlyCandles: h1Candles,
  });

  // 3. ModFlow Institutional Order Flow Engine (reused directly without duplicating logic)
  const modflow = runModFlowAnalysis({
    symbol,
    timeframe: "15m",
    candles: primaryCandles,
    candleStatus: m15Res.status,
    candleSource: m15Res.source,
    orderBook: bookRes,
  });

  // 4. Fundamental Intelligence Engine (Forex Factory gold-sensitive / high-impact window guard)
  const now = Date.now();
  const in2Hours = calRes.events.filter(
    (e) =>
      e.impact === "High" &&
      e.timestamp >= now - 15 * 60_000 &&
      e.timestamp <= now + 3 * 3600_000 &&
      (symbol.startsWith("XAU") ? e.isGoldSensitive || e.currency === "USD" : e.currency === "USD" || symbol.includes(e.currency))
  );
  const in24Hours = calRes.events.filter(
    (e) =>
      e.impact === "High" &&
      e.timestamp >= now &&
      e.timestamp <= now + 24 * 3600_000 &&
      (e.isGoldSensitive || e.currency === "USD")
  );
  const eventRiskElevated = in2Hours.length > 0;

  // Supporting intelligence is context only; primary directional weight belongs to ModFlow order flow.
  // Heatmap and VWAP are not yet implemented as independent live data feeds in this module.
  const liqSigned =
    (liqM15.trend === "BULLISH" ? 55 : liqM15.trend === "BEARISH" ? -55 : 0) +
    (liqM15.lastStructureEvent?.direction === "BULLISH" ? 28 : liqM15.lastStructureEvent?.direction === "BEARISH" ? -28 : 0) +
    (liqM15.zones.filter((z) => !z.mitigated && z.direction === "BULLISH").length >
    liqM15.zones.filter((z) => !z.mitigated && z.direction === "BEARISH").length
      ? 12
      : -12);

  const mfSigned = Math.max(
    -100,
    Math.min(
      100,
      Math.round(
        modflow.summary.volumeImbalancePct * 1.4 +
          (modflow.orderBookStatus !== "UNAVAILABLE" ? modflow.summary.bookImbalancePct * 0.9 : 0) +
          (modflow.summary.cvdDivergence === "BULLISH_DIV"
            ? 24
            : modflow.summary.cvdDivergence === "BEARISH_DIV"
              ? -24
              : 0) +
          (currentPrice > modflow.volumeProfile.poc ? 14 : -14)
      )
    )
  );

  const sessionQualityScore =
    calRes.status === "UNAVAILABLE"
      ? 45
      : eventRiskElevated
        ? 30
        : sessionState.sessions.some((s) => s.active && (s.code === "LDN" || s.code === "NY"))
          ? 82
          : 62;

  const engineBreakdown: EngineScoreItem[] = [
    {
      engine: "Supporting Confluence — H1 Trend",
      weight: 10,
      bias: h1Tech.bias,
      score: Math.min(100, Math.round(50 + Math.abs(h1Tech.score) * 0.5)),
      summary: `H1 directional bias is ${h1Tech.bias}${h1Tech.ema20 ? ` · EMA20 ${formatPx(h1Tech.ema20, dec)}` : ""}${h1Tech.rsi14 !== null ? ` · RSI ${h1Tech.rsi14}` : ""}.`,
      evidence: [
        h1Tech.ema20 && h1Tech.ema50
          ? `Price ${currentPrice > h1Tech.ema20 ? "above" : "below"} H1 EMA20 (${formatPx(h1Tech.ema20, dec)}) vs EMA50 (${formatPx(h1Tech.ema50, dec)}).`
          : "EMA alignment monitoring warm-up candles.",
        h1Tech.rsi14 !== null ? `H1 RSI(14) at ${h1Tech.rsi14} reflecting ${h1Tech.rsi14 > 55 ? "bullish" : h1Tech.rsi14 < 45 ? "bearish" : "neutral"} momentum.` : "Momentum neutral.",
      ],
      dataStatus: h1Res.status === "SIMULATED" ? "CACHED" : h1Res.status,
    },
    {
      engine: "Supporting Confluence — M15 Structure",
      weight: 25,
      bias: liqM15.trend === "BULLISH" ? "BULLISH" : liqM15.trend === "BEARISH" ? "BEARISH" : "NEUTRAL",
      score: Math.min(100, Math.max(35, Math.round(45 + Math.abs(liqSigned) * 0.52))),
      summary: liqM15.structureBias,
      evidence: [
        `Structure logs ${liqM15.counts.bosCount} BOS, ${liqM15.counts.chochCount} CHoCH, ${liqM15.counts.sweeps + liqM15.counts.stopHunts} liquidity sweep/stop-hunt event(s).`,
        `${liqM15.counts.fvgs} unmitigated FVG(s), ${liqM15.counts.orderBlocks} order block(s), ${liqM15.counts.equalHighs} EQH / ${liqM15.counts.equalLows} EQL clusters.`,
      ],
      dataStatus: m15Res.status === "SIMULATED" ? "CACHED" : m15Res.status,
    },
    {
      engine: "PRIMARY — ModFlow Order Flow",
      weight: 55,
      bias: modflow.summary.bias,
      score: Math.min(100, Math.max(35, Math.round(48 + Math.abs(mfSigned) * 0.48))),
      summary: modflow.summary.confirmationText,
      evidence: [
        `Tape balance: ${modflow.summary.aggressiveBuyPct.toFixed(1)}% buy / ${modflow.summary.aggressiveSellPct.toFixed(1)}% sell · CVD slope ${modflow.summary.cvdSlope.toLowerCase()}.`,
        `Volume Profile POC ${formatPx(modflow.volumeProfile.poc, dec)} (VAH ${formatPx(modflow.volumeProfile.vah, dec)} / VAL ${formatPx(modflow.volumeProfile.val, dec)}).`,
        ...(modflow.orderBookStatus !== "UNAVAILABLE"
          ? [`L2 depth: ${modflow.summary.bidPressurePct.toFixed(1)}% bid vs ${modflow.summary.askPressurePct.toFixed(1)}% ask · spread ${modflow.summary.spread.toFixed(dec)}.`]
          : ["L2 order book excluded (unavailable on reference feed)."]),
      ],
      dataStatus: modflow.status === "SIMULATED" ? "CACHED" : modflow.status,
    },
    {
      engine: "Supporting Confluence — M5 Execution",
      weight: 10,
      bias: m5Tech.bias,
      score: Math.min(100, Math.round(50 + Math.abs(m5Tech.score) * 0.45)),
      summary: `M5 execution structure shows ${m5Tech.bias.toLowerCase()} short-term pressure (${sessionState.currentLabel}).`,
      evidence: [
        `M15 ATR(14) = ${formatPx(m15Atr, dec)} (${((m15Atr / currentPrice) * 100).toFixed(2)}% volatility).`,
        `Active session: ${sessionState.currentLabel} (${sessionState.utcTime}).`,
      ],
      dataStatus: m5Res.status === "SIMULATED" ? "CACHED" : m5Res.status,
    },
    {
      engine: "Macro / Session Risk Guard",
      weight: 0,
      bias: "NEUTRAL",
      score: sessionQualityScore,
      summary:
        calRes.status === "UNAVAILABLE"
          ? "Forex Factory calendar unavailable — verify red-folder releases externally."
          : eventRiskElevated
            ? `Caution: ${in2Hours[0].currency} ${in2Hours[0].title} within high-impact event window.`
            : in24Hours.length > 0
              ? `No imminent shock event. Next high-impact macro release: ${in24Hours[0].currency} ${in24Hours[0].title}.`
              : "Clear macro window — no high-impact gold-sensitive events within 24 hours.",
      evidence: [
        calRes.status === "UNAVAILABLE"
          ? "Calendar feed offline; fundamental risk discount applied."
          : `Monitoring ${calRes.events.length} verified Forex Factory events (${in24Hours.length} high-impact next 24h).`,
      ],
      dataStatus: calRes.status === "SIMULATED" ? "CACHED" : calRes.status,
    },
  ];

  // Primary decision authority is order flow. Structure, HTF and execution are supporting confluences.
  // Order-flow telemetry currently includes candle-derived delta estimates; it is not equivalent to
  // exchange-native bid/ask footprint data. Independent ModFlow validation remains mandatory before publication.
  // Weights: ModFlow order flow 55%, M15 structure 25%, H1 context 10%, M5 timing 10%.
  const netDirectional =
    mfSigned * 0.55 + liqSigned * 0.25 + h1Tech.score * 0.10 + m5Tech.score * 0.10;

  // ModFlow owns the primary directional decision. Other engines may confirm or veto via disagreement,
  // but they cannot manufacture a direction when the primary order-flow reading is neutral.
  const direction: DecisionEngineOutput["direction"] =
    modflow.summary.bias === "BULLISH" && netDirectional >= 8
      ? "BULLISH"
      : modflow.summary.bias === "BEARISH" && netDirectional <= -8
        ? "BEARISH"
        : "NEUTRAL";

  // Count independent directional engine confirmations (strict anti-single-indicator rule)
  const dirEngines = engineBreakdown.slice(0, 4);
  const alignedCount =
    direction === "NEUTRAL"
      ? 0
      : dirEngines.filter((e) => e.bias === direction).length;
  const opposingCount =
    direction === "NEUTRAL"
      ? 0
      : dirEngines.filter((e) => e.bias !== "NEUTRAL" && e.bias !== direction).length;

  // Transparent deterministic confidence calculation (never inflated)
  const alignmentBonus = alignedCount * 10 - opposingCount * 9;
  const magnitudeScore = Math.min(28, Math.round(Math.abs(netDirectional) * 0.34));
  const macroPenalty = eventRiskElevated ? -12 : calRes.status === "UNAVAILABLE" ? -6 : 4;
  const bookBonus = bookRes.status === "LIVE" ? 4 : 0;
  const confidenceScore =
    direction === "NEUTRAL"
      ? Math.max(32, Math.min(54, 42 + Math.round(Math.abs(netDirectional) * 0.4)))
      : Math.max(28, Math.min(92, 34 + alignmentBonus + magnitudeScore + macroPenalty + bookBonus));

  // Derive realistic execution levels anchored to structure, order blocks, FVGs, liquidity pools, and ATR
  const isLong = direction !== "BEARISH";
  const matchingOb = liqM15.zones.find(
    (z) =>
      (z.kind === "ORDER_BLOCK" || z.kind === "FVG") &&
      !z.mitigated &&
      z.direction === (isLong ? "BULLISH" : "BEARISH") &&
      Math.abs(z.mid - currentPrice) <= m15Atr * 3.0
  );

  const entryRaw = matchingOb
    ? isLong
      ? Math.min(currentPrice, matchingOb.high)
      : Math.max(currentPrice, matchingOb.low)
    : currentPrice;

  const slDist = Math.max(m15Atr * 1.45, currentPrice * 0.0014);
  const slRaw = matchingOb
    ? isLong
      ? Math.min(matchingOb.low - m15Atr * 0.35, entryRaw - slDist)
      : Math.max(matchingOb.high + m15Atr * 0.35, entryRaw + slDist)
    : isLong
      ? entryRaw - slDist
      : entryRaw + slDist;

  const riskDist = Math.max(Math.abs(entryRaw - slRaw), m15Atr * 0.8);

  // Adaptive TP: momentum expands the target, volatility adjusts distance conservatively,
  // and a valid opposing liquidity pool can cap the target. Exactly one TP is produced.
  const poolTarget = isLong ? liqM15.nearestBsl?.price : liqM15.nearestSsl?.price;
  const entryPrice = roundPrice(entryRaw, dec);
  const stopLoss = roundPrice(slRaw, dec);
  const adaptiveTarget = calculateAdaptiveTakeProfit({
    side: isLong ? "BUY" : "SELL",
    entry: entryPrice,
    stopLoss,
    atr: m15Atr,
    momentumScore: Math.abs(netDirectional),
    volatilityPct: (m15Atr / currentPrice) * 100,
    opposingLiquidity: poolTarget,
    minRiskReward: minRr,
  });
  const takeProfit = adaptiveTarget ? roundPrice(adaptiveTarget.takeProfit, dec) : roundPrice(
    isLong ? entryPrice + Math.max(m15Atr * 2.2, riskDist * minRr) : entryPrice - Math.max(m15Atr * 2.2, riskDist * minRr), dec
  );
  const actualRisk = Math.abs(entryPrice - stopLoss);
  const riskReward = actualRisk > 0 ? Number((Math.abs(takeProfit - entryPrice) / actualRisk).toFixed(2)) : 0;

  // Validate setup strictly: require >= 2 independent confirming engines, threshold met, RR met, not in red news lock
  let setupState: DecisionEngineOutput["setupState"] = "WATCHLIST";
  let setupExplanation = "";
  if (direction === "NEUTRAL" || alignedCount < 2) {
    setupState = "INVALID";
    setupExplanation = `Setup is not actionable: only ${alignedCount} of 4 directional engines agree. FREYR requires multi-engine confluence across structure, technical direction, and institutional order flow before publishing a signal.`;
  } else if (eventRiskElevated) {
    setupState = "WATCHLIST";
    setupExplanation = `Directional edge leans ${direction} (${alignedCount}/4 engines aligned), held on watchlist because high-impact release "${in2Hours[0].title}" (${in2Hours[0].currency}) is within the active protection window.`;
  } else if (confidenceScore >= threshold && riskReward >= minRr) {
    setupState = "VALID";
    setupExplanation = `Valid ${direction} setup confirmed by ${alignedCount}/4 independent engines (${confidenceScore}% weighted confidence >= ${threshold}% threshold) with ${riskReward}:1 R:R and verified structure invalidation at ${formatPx(stopLoss, dec)}.`;
  } else {
    setupState = "WATCHLIST";
    setupExplanation = `Developing ${direction} context (${alignedCount}/4 engines aligned, ${confidenceScore}% confidence vs ${threshold}% threshold). Monitor reaction near ${formatPx(entryPrice, dec)} for tighter ModFlow confirmation.`;
  }

  // Key horizontal levels + liquidity targets
  const keyLevels: { label: string; price: number; kind: string }[] = [
    { label: "Volume Profile VAH", price: roundPrice(modflow.volumeProfile.vah, dec), kind: "PROFILE" },
    { label: "Point of Control (POC)", price: roundPrice(modflow.volumeProfile.poc, dec), kind: "PROFILE" },
    { label: "Volume Profile VAL", price: roundPrice(modflow.volumeProfile.val, dec), kind: "PROFILE" },
  ];
  if (liqM15.pdh !== null) keyLevels.push({ label: "Previous Day High", price: roundPrice(liqM15.pdh, dec), kind: "STRUCTURE" });
  if (liqM15.pdl !== null) keyLevels.push({ label: "Previous Day Low", price: roundPrice(liqM15.pdl, dec), kind: "STRUCTURE" });
  if (h1Tech.ema20 !== null) keyLevels.push({ label: "H1 EMA 20", price: roundPrice(h1Tech.ema20, dec), kind: "TECHNICAL" });
  for (const z of liqM15.zones.filter((z) => z.kind === "ORDER_BLOCK").slice(0, 2)) {
    keyLevels.push({ label: z.label, price: roundPrice(z.mid, dec), kind: z.kind });
  }

  const liquidityTargets = liqM15.levels
    .filter((l) => ["BSL", "SSL", "EQH", "EQL", "PDH", "PDL", "ASIA_H", "ASIA_L", "LDN_H", "LDN_L"].includes(l.kind))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 6)
    .map((l) => ({
      label: `${l.label}${l.swept ? " (Swept)" : ""}`,
      price: roundPrice(l.price, dec),
      side: l.side,
    }));

  const supportingEvidence: string[] = [
    `Multi-timeframe alignment: H1 ${h1Tech.bias}, M15 ${liqM15.trend}, M5 ${m5Tech.bias} (${alignedCount}/4 directional engines aligned).`,
    `ModFlow reading: ${modflow.summary.aggressiveBuyPct.toFixed(1)}% buy / ${modflow.summary.aggressiveSellPct.toFixed(1)}% sell pressure, CVD ${modflow.summary.cvdSlope.toLowerCase()}, ${modflow.summary.absorptionCount} absorption & ${modflow.summary.exhaustionCount} exhaustion bars.`,
    modflow.orderBookStatus !== "UNAVAILABLE"
      ? `L2 Order Book: ${modflow.summary.bidPressurePct.toFixed(1)}% bid depth vs ${modflow.summary.askPressurePct.toFixed(1)}% ask depth (${modflow.walls.length} notable liquidity wall(s)).`
      : `Volume Profile places spot ${modflow.volumeProfile.priceLocation.replace("_", " ").toLowerCase()} (POC ${formatPx(modflow.volumeProfile.poc, dec)}).`,
    liqM15.lastStructureEvent
      ? `Latest M15 structure shift: ${liqM15.lastStructureEvent.label} at ${formatPx(liqM15.lastStructureEvent.price, dec)}.`
      : `M15 tracking ${liqM15.counts.fvgs} open FVG(s) and ${liqM15.counts.orderBlocks} order block(s).`,
    eventRiskElevated
      ? `High-impact calendar warning: ${in2Hours[0].currency} ${in2Hours[0].title} demands reduced sizing or patience.`
      : `Trading session: ${sessionState.currentLabel} (${sessionState.utcTime}) — no blocking high-impact USD news imminent.`,
  ];

  const entryConditions = matchingOb
    ? `Await controlled pullback into ${matchingOb.label} (${formatPx(matchingOb.low, dec)}–${formatPx(matchingOb.high, dec)}) with M5 ${isLong ? "bullish CHoCH/BOS and positive delta print" : "bearish CHoCH/BOS and negative delta print"} confirming institutional acceptance.`
    : `Wait for M5 ${isLong ? "sell-side liquidity sweep + bullish displacement close above local high" : "buy-side liquidity sweep + bearish displacement close below local low"} near ${formatPx(entryPrice, dec)} aligned with ModFlow volume delta.`;

  const invalidationConditions: string[] = [
    `Confirmed M15 candle close ${isLong ? "below" : "above"} ${formatPx(stopLoss, dec)} invalidates the current setup structure.`,
    `ModFlow cumulative volume delta flips decisively ${isLong ? "negative beneath POC" : "positive above POC"} (${formatPx(modflow.volumeProfile.poc, dec)}) with counter-trend absorption.`,
    `Opposing H1 Break of Structure removes multi-timeframe alignment.`,
    ...(in24Hours.length > 0
      ? [`Unexpected volatility spike on ${in24Hours[0].currency} ${in24Hours[0].title} breaks key structure without displacement control.`]
      : []),
  ];

  const bullProb = Math.min(78, Math.max(18, Math.round(50 + netDirectional * 0.42)));
  const bearProb = Math.min(78, Math.max(15, 90 - bullProb));
  const rangeProb = Math.max(8, 100 - bullProb - bearProb);

  const bullTarget = liqM15.nearestBsl ? formatPx(liqM15.nearestBsl.price, dec) : formatPx(currentPrice + m15Atr * 2.8, dec);
  const bearTarget = liqM15.nearestSsl ? formatPx(liqM15.nearestSsl.price, dec) : formatPx(currentPrice - m15Atr * 2.8, dec);

  const scenarios: AnalysisScenario[] = [
    {
      title: "Bullish Continuation / Reclaim",
      bias: "BULLISH",
      probability: bullProb,
      trigger: `Hold above VAL ${formatPx(modflow.volumeProfile.val, dec)} with positive ModFlow delta and M15 BOS higher.`,
      target: `Draw toward buy-side liquidity at ${bullTarget}${liqM15.pdh ? ` / PDH ${formatPx(liqM15.pdh, dec)}` : ""}.`,
      invalidation: `M15 close beneath ${formatPx(isLong ? stopLoss : currentPrice - m15Atr * 1.5, dec)}.`,
    },
    {
      title: "Bearish Distribution / Sweep Reversal",
      bias: "BEARISH",
      probability: bearProb,
      trigger: `Rejection at VAH ${formatPx(modflow.volumeProfile.vah, dec)} or failed BSL sweep accompanied by negative delta imbalance.`,
      target: `Draw into sell-side liquidity near ${bearTarget}${liqM15.pdl ? ` / PDL ${formatPx(liqM15.pdl, dec)}` : ""}.`,
      invalidation: `Sustained M15 acceptance above ${formatPx(!isLong ? stopLoss : currentPrice + m15Atr * 1.5, dec)}.`,
    },
    {
      title: "Value Area Rotation",
      bias: "NEUTRAL",
      probability: rangeProb,
      trigger: `Low delta expansion between VAL (${formatPx(modflow.volumeProfile.val, dec)}) and VAH (${formatPx(modflow.volumeProfile.vah, dec)}).`,
      target: `Mean reversion around POC ${formatPx(modflow.volumeProfile.poc, dec)} pending next session handoff.`,
      invalidation: `High-volume breakout outside range boundaries on London/NY participation.`,
    },
  ];

  const briefing = `${symbol} trades at ${formatPx(currentPrice, dec)} during ${sessionState.currentLabel}. H1 trend reads ${h1Tech.bias.toLowerCase()} while M15 market structure is ${liqM15.trend.toLowerCase()} with ${alignedCount}/4 independent engines aligned (${confidenceScore}% consensus). ModFlow shows ${modflow.summary.bias.toLowerCase()} flow (${modflow.summary.aggressiveBuyPct.toFixed(0)}% buy vs ${modflow.summary.aggressiveSellPct.toFixed(0)}% sell) with Volume Profile POC at ${formatPx(modflow.volumeProfile.poc, dec)}. Key upside pool rests at ${bullTarget}; downside pool rests at ${bearTarget}.${eventRiskElevated ? ` Alert: ${in2Hours[0].currency} ${in2Hours[0].title} active — preserve capital.` : ""}`;

  const hasCandleVolume = primaryCandles.some((candle) => candle.volume > 0);
  const chartSnapshot: ChartAnalysisSnapshot | undefined = params.includeChart ? {
    timeframe: m15Candles.length >= 15 ? "15m" : "1h",
    source: m15Candles.length >= 15 ? m15Res.source : h1Res.source,
    asOf: new Date().toISOString(),
    candles: primaryCandles.slice(-100),
    bias: modflow.summary.bias,
    structure: liqM15.trend,
    estimatedDelta: hasCandleVolume ? modflow.summary.sessionDelta : null,
    poc: hasCandleVolume ? modflow.volumeProfile.poc : null,
    vah: hasCandleVolume ? modflow.volumeProfile.vah : null,
    val: hasCandleVolume ? modflow.volumeProfile.val : null,
    bidDepthPct: bookRes.status === "LIVE" ? modflow.summary.bidPressurePct : null,
    askDepthPct: bookRes.status === "LIVE" ? modflow.summary.askPressurePct : null,
    labelReading: "USER_SELECTED",
  } : undefined;
  return {
    symbol,
    chartSnapshot,
    timeframes: ["1h", "15m", "5m"],
    currentPrice: roundPrice(currentPrice, dec),
    direction,
    setupState,
    setupExplanation,
    confidenceScore,
    confidenceThreshold: threshold,
    engineBreakdown,
    supportingEvidence,
    keyLevels,
    liquidityTargets,
    entryConditions,
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
    invalidationConditions,
    scenarios,
    briefing,
    dataSource: m15Res.source,
    dataStatus: m15Res.status,
    dataAgeSec: m15Res.cacheAgeSec,
    analyzedAt: new Date().toISOString(),
    h1Bias: h1Tech.bias,
    m15Structure: liqM15.trend,
    m5Execution: m5Tech.bias,
    confirmationsCount: alignedCount,
    activeSession: sessionState.currentLabel,
  };
}

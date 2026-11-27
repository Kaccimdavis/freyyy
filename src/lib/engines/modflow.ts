import type { Candle, DataStatus, OrderBookSnapshot } from "../market-data";

export interface DeltaBar {
  time: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cvd: number;
  totalVolume: number;
  imbalancePct: number;
  close: number;
  high: number;
  low: number;
  absorption: "BULL_ABSORPTION" | "BEAR_ABSORPTION" | null;
  exhaustion: "BUY_EXHAUSTION" | "SELL_EXHAUSTION" | null;
}

export interface VolumeProfileBucket {
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  isPoc: boolean;
  inValueArea: boolean;
}

export interface OrderFlowEvent {
  time: number;
  price: number;
  type: "ABSORPTION" | "EXHAUSTION" | "AGGRESSIVE_BUY" | "AGGRESSIVE_SELL" | "IMBALANCE";
  side: "BULLISH" | "BEARISH";
  intensity: number; // volume vs mean multiple
  detail: string;
}

export interface OrderBookWall {
  side: "BID" | "ASK";
  price: number;
  size: number;
  notional: number;
  multipleOfAvg: number;
}

export interface ModFlowAnalysis {
  symbol: string;
  timeframe: string;
  status: DataStatus;
  source: string;
  orderBookStatus: DataStatus;
  validatedBars: number;
  fetchedAt: string;
  currentPrice: number;
  rollingVwap: number | null;
  vwapDeviationPct: number | null;
  summary: {
    bias: "BULLISH" | "BEARISH" | "NEUTRAL";
    setupConfirmation: "CONFIRMED_BUY" | "CONFIRMED_SELL" | "NEUTRAL" | "DIVERGENT";
    confirmationText: string;
    latestDelta: number;
    sessionDelta: number;
    cvdEnd: number;
    cvdSlope: "RISING" | "FALLING" | "FLAT";
    cvdDivergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE";
    bidPressurePct: number;
    askPressurePct: number;
    bookImbalancePct: number; // positive = bid dominant
    volumeImbalancePct: number; // recent bars buy vs sell
    aggressiveBuyPct: number;
    aggressiveSellPct: number;
    institutionalScore: number; // 0-100 derived deterministically
    institutionalActivity: "LOW" | "MODERATE" | "ELEVATED" | "HIGH";
    absorptionCount: number;
    exhaustionCount: number;
    spread: number;
    spreadBps: number;
    totalBidLiquidity: number;
    totalAskLiquidity: number;
  };
  volumeProfile: {
    poc: number;
    vah: number;
    val: number;
    totalVolume: number;
    priceLocation: "ABOVE_VAH" | "INSIDE_VA" | "BELOW_VAL";
    buckets: VolumeProfileBucket[];
  };
  deltaBars: DeltaBar[];
  events: OrderFlowEvent[];
  walls: OrderBookWall[];
  orderBook: OrderBookSnapshot;
  validationNotes: string[];
}

function validateCandles(candles: Candle[]): { valid: Candle[]; rejected: number } {
  const valid: Candle[] = [];
  let rejected = 0;
  for (const c of candles) {
    if (
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume) &&
      c.open > 0 &&
      c.high >= c.low &&
      c.volume >= 0
    ) {
      valid.push(c);
    } else {
      rejected++;
    }
  }
  return { valid, rejected };
}

/**
 * Reusable ModFlow Institutional Order Flow Suite core.
 * Validates incoming market candles + L2 book before producing deterministic delta, CVD,
 * absorption/exhaustion, imbalance, resting wall, and Volume Profile (POC/VAH/VAL) analytics.
 */
export function runModFlowAnalysis(params: {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  candleStatus: DataStatus;
  candleSource: string;
  orderBook: OrderBookSnapshot;
}): ModFlowAnalysis {
  const { symbol, timeframe, candleStatus, candleSource, orderBook } = params;
  const { valid, rejected } = validateCandles(params.candles);
  const bars = valid.slice(-96);
  const validationNotes: string[] = [];

  if (rejected > 0) {
    validationNotes.push(`Excluded ${rejected} malformed candle(s) during payload validation.`);
  }
  if (bars.length === 0) {
    validationNotes.push("No validated candle volume data available for this period.");
  }

  const hasVolume = bars.some((b) => b.volume > 0);
  if (hasVolume) {
    validationNotes.push("Delta/CVD buy-sell splits are estimated from candle OHLC position and total candle volume; they are not exchange-native bid/ask footprint prints.");
  }
  if (!hasVolume && bars.length > 0) {
    validationNotes.push(
      "Reference venue reports zero volume on FX/index feed; directional pressure estimated from candle close position and explicitly constrained."
    );
  }
  if (orderBook.status === "UNAVAILABLE") {
    validationNotes.push("L2 order book unavailable for this instrument; book pressure excluded from weighting.");
  } else if (orderBook.status === "CACHED") {
    validationNotes.push("Order book using recently cached Hyperliquid L2 snapshot due to temporary upstream delay.");
  }

  const avgVol =
    bars.length > 0 ? bars.reduce((a, b) => a + (b.volume > 0 ? b.volume : 0), 0) / bars.length : 0;
  const avgRange =
    bars.length > 0 ? bars.reduce((a, b) => a + Math.max(b.high - b.low, 1e-8), 0) / bars.length : 1;

  let cvd = 0;
  const deltaBars: DeltaBar[] = [];
  const events: OrderFlowEvent[] = [];

  for (let i = 0; i < bars.length; i++) {
    const c = bars[i];
    const range = Math.max(c.high - c.low, 1e-9);
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // Inter-bar buy ratio using Close Location Value (CLV) weighted by candle polarity
    const clv = (c.close - c.low) / range; // 0..1
    const bodyDir = c.close >= c.open ? 0.5 + Math.min(0.42, (body / range) * 0.42) : 0.5 - Math.min(0.42, (body / range) * 0.42);
    const buyShare = Math.min(0.95, Math.max(0.05, clv * 0.65 + bodyDir * 0.35));

    const effectiveVol = hasVolume ? c.volume : 0;
    const buyVolume = effectiveVol * buyShare;
    const sellVolume = effectiveVol * (1 - buyShare);
    const delta = buyVolume - sellVolume;
    cvd += delta;
    const imbalancePct = effectiveVol > 0 ? (delta / effectiveVol) * 100 : (buyShare - 0.5) * 200;

    let absorption: DeltaBar["absorption"] = null;
    let exhaustion: DeltaBar["exhaustion"] = null;

    const volRatio = avgVol > 0 ? effectiveVol / avgVol : 0;
    const bodyCompression = body / range;

    // Absorption: High volume (>1.55x avg) but compact body / strong opposing wick rejecting continuation
    if (hasVolume && volRatio >= 1.55 && bodyCompression <= 0.42) {
      if (lowerWick > upperWick * 1.25 && c.close >= c.low + range * 0.52) {
        absorption = "BULL_ABSORPTION";
        events.push({
          time: c.time,
          price: c.low,
          type: "ABSORPTION",
          side: "BULLISH",
          intensity: Number(volRatio.toFixed(2)),
          detail: `Passive bids absorbed aggressive sells (${volRatio.toFixed(1)}× avg vol, lower wick defended).`,
        });
      } else if (upperWick > lowerWick * 1.25 && c.close <= c.high - range * 0.52) {
        absorption = "BEAR_ABSORPTION";
        events.push({
          time: c.time,
          price: c.high,
          type: "ABSORPTION",
          side: "BEARISH",
          intensity: Number(volRatio.toFixed(2)),
          detail: `Passive offers absorbed aggressive buys (${volRatio.toFixed(1)}× avg vol, upper wick rejected).`,
        });
      }
    }

    // Exhaustion: Very wide impulse range + climax volume (>1.9x) + reversal tail
    if (hasVolume && volRatio >= 1.85 && range >= avgRange * 1.35) {
      if (upperWick >= range * 0.38 && c.close < c.high - range * 0.35) {
        exhaustion = "BUY_EXHAUSTION";
        events.push({
          time: c.time,
          price: c.high,
          type: "EXHAUSTION",
          side: "BEARISH",
          intensity: Number(volRatio.toFixed(2)),
          detail: `Buying climax rejected near bar high (${volRatio.toFixed(1)}× avg vol, failed continuation).`,
        });
      } else if (lowerWick >= range * 0.38 && c.close > c.low + range * 0.35) {
        exhaustion = "SELL_EXHAUSTION";
        events.push({
          time: c.time,
          price: c.low,
          type: "EXHAUSTION",
          side: "BULLISH",
          intensity: Number(volRatio.toFixed(2)),
          detail: `Selling climax absorbed near bar low (${volRatio.toFixed(1)}× avg vol, sharp bid response).`,
        });
      }
    }

    // Aggressive expansion imbalance
    if (hasVolume && volRatio >= 2.1 && bodyCompression >= 0.62 && Math.abs(imbalancePct) >= 42) {
      const bull = delta > 0;
      events.push({
        time: c.time,
        price: c.close,
        type: bull ? "AGGRESSIVE_BUY" : "AGGRESSIVE_SELL",
        side: bull ? "BULLISH" : "BEARISH",
        intensity: Number(volRatio.toFixed(2)),
        detail: `${bull ? "Aggressive market buying" : "Aggressive market selling"} (${imbalancePct >= 0 ? "+" : ""}${imbalancePct.toFixed(0)}% delta imbalance, ${volRatio.toFixed(1)}× avg vol).`,
      });
    }

    deltaBars.push({
      time: c.time,
      buyVolume: Number(buyVolume.toFixed(4)),
      sellVolume: Number(sellVolume.toFixed(4)),
      delta: Number(delta.toFixed(4)),
      cvd: Number(cvd.toFixed(4)),
      totalVolume: Number(effectiveVol.toFixed(4)),
      imbalancePct: Number(imbalancePct.toFixed(1)),
      close: c.close,
      high: c.high,
      low: c.low,
      absorption,
      exhaustion,
    });
  }

  // Build real Volume Profile (28 vertical bins across displayed range) with exact POC, 70% VAH/VAL
  const currentPrice =
    orderBook.status !== "UNAVAILABLE" && orderBook.midPrice > 0
      ? orderBook.midPrice
      : bars[bars.length - 1]?.close ?? 0;

  const vwapVolume = bars.reduce((sum, bar) => sum + bar.volume, 0);
  const rollingVwap = vwapVolume > 0
    ? bars.reduce((sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * bar.volume, 0) / vwapVolume
    : null;
  const vwapDeviationPct = rollingVwap !== null && rollingVwap > 0
    ? ((currentPrice - rollingVwap) / rollingVwap) * 100
    : null;

  let poc = currentPrice;
  let vah = currentPrice;
  let val = currentPrice;
  let totalProfileVol = 0;
  const buckets: VolumeProfileBucket[] = [];

  if (bars.length > 0) {
    const minP = Math.min(...bars.map((b) => b.low));
    const maxP = Math.max(...bars.map((b) => b.high));
    const span = Math.max(maxP - minP, 1e-6);
    const binCount = 24;
    const step = span / binCount;

    const rawBins = Array.from({ length: binCount }, (_, idx) => ({
      priceLow: minP + idx * step,
      priceHigh: minP + (idx + 1) * step,
      priceMid: minP + (idx + 0.5) * step,
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      delta: 0,
    }));

    for (let i = 0; i < bars.length; i++) {
      const c = bars[i];
      const db = deltaBars[i];
      const weight = hasVolume ? c.volume : 1; // fallback TPO distribution if reference lacks volume
      const startBin = Math.max(0, Math.min(binCount - 1, Math.floor((c.low - minP) / step)));
      const endBin = Math.max(0, Math.min(binCount - 1, Math.floor((c.high - minP) / step)));
      const touched = Math.max(1, endBin - startBin + 1);
      const buyRatio = db.totalVolume > 0 ? db.buyVolume / db.totalVolume : c.close >= c.open ? 0.6 : 0.4;
      for (let b = startBin; b <= endBin; b++) {
        const share = weight / touched;
        rawBins[b].totalVolume += share;
        rawBins[b].buyVolume += share * buyRatio;
        rawBins[b].sellVolume += share * (1 - buyRatio);
        rawBins[b].delta += share * (2 * buyRatio - 1);
        totalProfileVol += share;
      }
    }

    let pocIdx = 0;
    for (let i = 1; i < rawBins.length; i++) {
      if (rawBins[i].totalVolume > rawBins[pocIdx].totalVolume) pocIdx = i;
    }

    // Standard Market Profile 70% Value Area expansion around POC
    const targetVol = totalProfileVol * 0.7;
    let vaVol = rawBins[pocIdx].totalVolume;
    let lo = pocIdx;
    let hi = pocIdx;
    while (vaVol < targetVol && (lo > 0 || hi < binCount - 1)) {
      const below = lo > 0 ? rawBins[lo - 1].totalVolume : -1;
      const above = hi < binCount - 1 ? rawBins[hi + 1].totalVolume : -1;
      if (above >= below && hi < binCount - 1) {
        hi++;
        vaVol += rawBins[hi].totalVolume;
      } else if (lo > 0) {
        lo--;
        vaVol += rawBins[lo].totalVolume;
      } else {
        break;
      }
    }

    poc = rawBins[pocIdx].priceMid;
    val = rawBins[lo].priceLow;
    vah = rawBins[hi].priceHigh;

    for (let i = 0; i < rawBins.length; i++) {
      buckets.push({
        ...rawBins[i],
        totalVolume: Number(rawBins[i].totalVolume.toFixed(4)),
        buyVolume: Number(rawBins[i].buyVolume.toFixed(4)),
        sellVolume: Number(rawBins[i].sellVolume.toFixed(4)),
        delta: Number(rawBins[i].delta.toFixed(4)),
        isPoc: i === pocIdx,
        inValueArea: i >= lo && i <= hi,
      });
    }
  }

  // Order book analysis & significant institutional walls (>= 2.1× level average)
  const walls: OrderBookWall[] = [];
  let bidPressurePct = 50;
  let askPressurePct = 50;
  let bookImbalancePct = 0;
  if (orderBook.status !== "UNAVAILABLE" && orderBook.totalBidVolume + orderBook.totalAskVolume > 0) {
    const totalBook = orderBook.totalBidVolume + orderBook.totalAskVolume;
    bidPressurePct = (orderBook.totalBidVolume / totalBook) * 100;
    askPressurePct = (orderBook.totalAskVolume / totalBook) * 100;
    bookImbalancePct = bidPressurePct - askPressurePct;

    const avgBid = orderBook.totalBidVolume / Math.max(1, orderBook.bids.length);
    const avgAsk = orderBook.totalAskVolume / Math.max(1, orderBook.asks.length);
    for (const lv of orderBook.bids) {
      if (avgBid > 0 && lv.size >= avgBid * 1.9) {
        walls.push({
          side: "BID",
          price: lv.price,
          size: lv.size,
          notional: lv.notional,
          multipleOfAvg: Number((lv.size / avgBid).toFixed(2)),
        });
      }
    }
    for (const lv of orderBook.asks) {
      if (avgAsk > 0 && lv.size >= avgAsk * 1.9) {
        walls.push({
          side: "ASK",
          price: lv.price,
          size: lv.size,
          notional: lv.notional,
          multipleOfAvg: Number((lv.size / avgAsk).toFixed(2)),
        });
      }
    }
    walls.sort((a, b) => b.multipleOfAvg - a.multipleOfAvg);
  }

  // Recent volume window (last 20 bars) for CVD trend, divergence, & aggressive buy/sell %
  const recent = deltaBars.slice(-20);
  const recentBuy = recent.reduce((a, b) => a + b.buyVolume, 0);
  const recentSell = recent.reduce((a, b) => a + b.sellVolume, 0);
  const recentTotal = recentBuy + recentSell;
  const sessionDelta = recentBuy - recentSell;
  const aggressiveBuyPct = recentTotal > 0 ? (recentBuy / recentTotal) * 100 : 50;
  const aggressiveSellPct = recentTotal > 0 ? (recentSell / recentTotal) * 100 : 50;
  const volumeImbalancePct = aggressiveBuyPct - aggressiveSellPct;

  const cvdChange =
    recent.length >= 2 ? recent[recent.length - 1].cvd - recent[0].cvd : 0;
  const priceChange =
    recent.length >= 2 ? recent[recent.length - 1].close - recent[0].close : 0;

  const cvdSlope: "RISING" | "FALLING" | "FLAT" =
    Math.abs(volumeImbalancePct) < 4
      ? "FLAT"
      : cvdChange > 0
        ? "RISING"
        : cvdChange < 0
          ? "FALLING"
          : "FLAT";

  let cvdDivergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE" = "NONE";
  if (hasVolume && recent.length >= 8) {
    if (priceChange < 0 && cvdChange > 0 && volumeImbalancePct > 5) {
      cvdDivergence = "BULLISH_DIV";
    } else if (priceChange > 0 && cvdChange < 0 && volumeImbalancePct < -5) {
      cvdDivergence = "BEARISH_DIV";
    }
  }

  const absorptionCount = deltaBars.filter((d) => d.absorption !== null).length;
  const exhaustionCount = deltaBars.filter((d) => d.exhaustion !== null).length;
  const recentEvents = events.slice(-14).reverse();

  // Institutional activity index (0-100) directly reflecting anomaly count, volume imbalance, and book walls
  const rawScore = Math.min(
    100,
    Math.round(
      Math.min(35, Math.abs(volumeImbalancePct) * 1.1) +
        Math.min(25, Math.abs(bookImbalancePct) * 0.7) +
        Math.min(24, (absorptionCount + exhaustionCount) * 4) +
        Math.min(16, walls.length * 4)
    )
  );
  const institutionalActivity: ModFlowAnalysis["summary"]["institutionalActivity"] =
    rawScore >= 70 ? "HIGH" : rawScore >= 48 ? "ELEVATED" : rawScore >= 25 ? "MODERATE" : "LOW";

  // Combined weighted order flow bias
  const combinedScore =
    volumeImbalancePct * 0.55 +
    (orderBook.status !== "UNAVAILABLE" ? bookImbalancePct * 0.35 : 0) +
    (currentPrice > poc ? 8 : currentPrice < poc ? -8 : 0);

  const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
    combinedScore >= 8 ? "BULLISH" : combinedScore <= -8 ? "BEARISH" : "NEUTRAL";

  let setupConfirmation: ModFlowAnalysis["summary"]["setupConfirmation"] = "NEUTRAL";
  let confirmationText = "Balanced two-sided institutional flow inside fair value; wait for delta shift before entry.";

  if (cvdDivergence === "BULLISH_DIV" && bias !== "BEARISH") {
    setupConfirmation = "DIVERGENT";
    confirmationText = "Bullish CVD divergence detected: price pushed lower while net delta accumulated positive bid support.";
  } else if (cvdDivergence === "BEARISH_DIV" && bias !== "BULLISH") {
    setupConfirmation = "DIVERGENT";
    confirmationText = "Bearish CVD divergence detected: price moved higher on weakening cumulative delta and passive sell resistance.";
  } else if (bias === "BULLISH") {
    setupConfirmation = "CONFIRMED_BUY";
    confirmationText = `Estimated candle-volume buying pressure is ${aggressiveBuyPct.toFixed(1)}%${orderBook.status !== "UNAVAILABLE" ? ` with ${bidPressurePct.toFixed(1)}% L2 bid depth` : ""}; confirm with independent trade-level order flow before execution.`;
  } else if (bias === "BEARISH") {
    setupConfirmation = "CONFIRMED_SELL";
    confirmationText = `Estimated candle-volume selling pressure is ${aggressiveSellPct.toFixed(1)}%${orderBook.status !== "UNAVAILABLE" ? ` with ${askPressurePct.toFixed(1)}% L2 ask depth` : ""}; confirm with independent trade-level order flow before execution.`;
  }

  const priceLocation: ModFlowAnalysis["volumeProfile"]["priceLocation"] =
    currentPrice > vah ? "ABOVE_VAH" : currentPrice < val ? "BELOW_VAL" : "INSIDE_VA";

  return {
    symbol,
    timeframe,
    status: candleStatus,
    source: candleSource,
    orderBookStatus: orderBook.status,
    validatedBars: bars.length,
    fetchedAt: new Date().toISOString(),
    currentPrice,
    rollingVwap: rollingVwap !== null ? Number(rollingVwap.toFixed(6)) : null,
    vwapDeviationPct: vwapDeviationPct !== null ? Number(vwapDeviationPct.toFixed(4)) : null,
    summary: {
      bias,
      setupConfirmation,
      confirmationText,
      latestDelta: deltaBars[deltaBars.length - 1]?.delta ?? 0,
      sessionDelta: Number(sessionDelta.toFixed(4)),
      cvdEnd: Number(cvd.toFixed(4)),
      cvdSlope,
      cvdDivergence,
      bidPressurePct: Number(bidPressurePct.toFixed(1)),
      askPressurePct: Number(askPressurePct.toFixed(1)),
      bookImbalancePct: Number(bookImbalancePct.toFixed(1)),
      volumeImbalancePct: Number(volumeImbalancePct.toFixed(1)),
      aggressiveBuyPct: Number(aggressiveBuyPct.toFixed(1)),
      aggressiveSellPct: Number(aggressiveSellPct.toFixed(1)),
      institutionalScore: rawScore,
      institutionalActivity,
      absorptionCount,
      exhaustionCount,
      spread: orderBook.spread,
      spreadBps: Number(orderBook.spreadBps.toFixed(2)),
      totalBidLiquidity: orderBook.totalBidVolume,
      totalAskLiquidity: orderBook.totalAskVolume,
    },
    volumeProfile: {
      poc,
      vah,
      val,
      totalVolume: Number(totalProfileVol.toFixed(3)),
      priceLocation,
      buckets,
    },
    deltaBars,
    events: recentEvents,
    walls: walls.slice(0, 8),
    orderBook,
    validationNotes,
  };
}

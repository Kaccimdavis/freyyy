import type { Candle } from "../market-data";
import { computeAtr } from "../market-data";

export interface LiquidityLevel {
  id: string;
  kind:
    | "BSL"
    | "SSL"
    | "EQH"
    | "EQL"
    | "PDH"
    | "PDL"
    | "PWH"
    | "PWL"
    | "ASIA_H"
    | "ASIA_L"
    | "LDN_H"
    | "LDN_L"
    | "NY_H"
    | "NY_L"
    | "IDM"
    | "RESISTANCE"
    | "SUPPORT";
  label: string;
  shortLabel: string;
  price: number;
  side: "BUY_SIDE" | "SELL_SIDE" | "NEUTRAL";
  swept: boolean;
  time: number;
  distancePct: number;
  priority: "HIGH" | "MEDIUM";
}

export interface StructureEvent {
  id: string;
  type: "BOS" | "CHOCH" | "SWEEP" | "STOP_HUNT" | "INDUCEMENT";
  direction: "BULLISH" | "BEARISH";
  price: number;
  time: number;
  label: string;
  detail: string;
}

export interface ZoneBlock {
  id: string;
  kind: "FVG" | "ORDER_BLOCK" | "BREAKER_BLOCK" | "MITIGATION_BLOCK" | "SUPPLY" | "DEMAND";
  direction: "BULLISH" | "BEARISH";
  high: number;
  low: number;
  mid: number;
  startTime: number;
  mitigated: boolean;
  strength: "STRONG" | "MODERATE";
  label: string;
}

export interface SessionRangeSummary {
  session: "Asian" | "London" | "New York";
  high: number | null;
  low: number | null;
  range: number | null;
  sweptHigh: boolean;
  sweptLow: boolean;
  candleCount: number;
}

export interface LiquidityAnalysis {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  trend: "BULLISH" | "BEARISH" | "RANGING";
  structureBias: string;
  lastStructureEvent: StructureEvent | null;
  levels: LiquidityLevel[];
  events: StructureEvent[];
  zones: ZoneBlock[];
  sessions: SessionRangeSummary[];
  pdh: number | null;
  pdl: number | null;
  pwh: number | null;
  pwl: number | null;
  nearestBsl: LiquidityLevel | null;
  nearestSsl: LiquidityLevel | null;
  liquidityCondition: "CLEAN_POOLS" | "SWEEP_ACTIVE" | "COMPRESSED" | "BALANCED";
  counts: {
    bsl: number;
    ssl: number;
    equalHighs: number;
    equalLows: number;
    sweeps: number;
    stopHunts: number;
    fvgs: number;
    orderBlocks: number;
    breakerBlocks: number;
    mitigationBlocks: number;
    bosCount: number;
    chochCount: number;
  };
}

interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: "HIGH" | "LOW";
}

function findSwings(candles: Candle[], left = 3, right = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    const h = candles[i].high;
    const l = candles[i].low;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= h) isHigh = false;
      if (candles[j].low <= l) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: candles[i].time, price: h, type: "HIGH" });
    if (isLow) swings.push({ index: i, time: candles[i].time, price: l, type: "LOW" });
  }
  return swings;
}

function computeSessionRange(
  candles: Candle[],
  session: "Asian" | "London" | "New York",
  startHour: number,
  endHour: number,
  currentLatestTime: number
): SessionRangeSummary {
  // Prefer most recent completed or active session within last 36 hours
  const cutoff = currentLatestTime - 36 * 3600 * 1000;
  const recent = candles.filter((c) => c.time >= cutoff);
  const matching = recent.filter((c) => {
    const h = new Date(c.time).getUTCHours();
    return h >= startHour && h < endHour;
  });
  if (matching.length === 0) {
    return { session, high: null, low: null, range: null, sweptHigh: false, sweptLow: false, candleCount: 0 };
  }
  // Keep latest contiguous session day
  const latestDay = new Date(matching[matching.length - 1].time).toISOString().slice(0, 10);
  const dayBars = matching.filter((c) => new Date(c.time).toISOString().slice(0, 10) === latestDay);
  const high = Math.max(...dayBars.map((c) => c.high));
  const low = Math.min(...dayBars.map((c) => c.low));
  const lastEnd = dayBars[dayBars.length - 1].time;
  const after = candles.filter((c) => c.time > lastEnd);
  const sweptHigh = after.some((c) => c.high > high);
  const sweptLow = after.some((c) => c.low < low);
  return {
    session,
    high,
    low,
    range: high - low,
    sweptHigh,
    sweptLow,
    candleCount: dayBars.length,
  };
}

export function analyzeLiquidityAndStructure(params: {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  dailyCandles?: Candle[];
  hourlyCandles?: Candle[];
}): LiquidityAnalysis {
  const { symbol, timeframe, candles, dailyCandles = [], hourlyCandles = [] } = params;

  if (candles.length < 10) {
    return {
      symbol,
      timeframe,
      currentPrice: candles[candles.length - 1]?.close ?? 0,
      trend: "RANGING",
      structureBias: "Insufficient historical candles to derive verified market structure.",
      lastStructureEvent: null,
      levels: [],
      events: [],
      zones: [],
      sessions: [
        { session: "Asian", high: null, low: null, range: null, sweptHigh: false, sweptLow: false, candleCount: 0 },
        { session: "London", high: null, low: null, range: null, sweptHigh: false, sweptLow: false, candleCount: 0 },
        { session: "New York", high: null, low: null, range: null, sweptHigh: false, sweptLow: false, candleCount: 0 },
      ],
      pdh: null,
      pdl: null,
      pwh: null,
      pwl: null,
      nearestBsl: null,
      nearestSsl: null,
      liquidityCondition: "BALANCED",
      counts: {
        bsl: 0,
        ssl: 0,
        equalHighs: 0,
        equalLows: 0,
        sweeps: 0,
        stopHunts: 0,
        fvgs: 0,
        orderBlocks: 0,
        breakerBlocks: 0,
        mitigationBlocks: 0,
        bosCount: 0,
        chochCount: 0,
      },
    };
  }

  const work = candles.slice(-140);
  const last = work[work.length - 1];
  const currentPrice = last.close;
  const atr = computeAtr(work, 14) ?? Math.max(currentPrice * 0.002, 1e-5);
  const eqTolerance = Math.max(atr * 0.22, currentPrice * 0.00055);
  const distPct = (p: number) => Number((((p - currentPrice) / currentPrice) * 100).toFixed(3));

  const swings = findSwings(work, 3, 3);
  const swingHighs = swings.filter((s) => s.type === "HIGH");
  const swingLows = swings.filter((s) => s.type === "LOW");

  const levels: LiquidityLevel[] = [];
  const events: StructureEvent[] = [];
  const zones: ZoneBlock[] = [];

  // 1. Previous Day High/Low & Previous Week High/Low from daily candles
  let pdh: number | null = null;
  let pdl: number | null = null;
  let pwh: number | null = null;
  let pwl: number | null = null;

  if (dailyCandles.length >= 2) {
    const prevDay = dailyCandles[dailyCandles.length - 2];
    pdh = prevDay.high;
    pdl = prevDay.low;
    levels.push(
      {
        id: "pdh",
        kind: "PDH",
        label: "Previous Day High",
        shortLabel: "PDH",
        price: pdh,
        side: "BUY_SIDE",
        swept: currentPrice > pdh || work.slice(-12).some((c) => c.high > pdh!),
        time: prevDay.time,
        distancePct: distPct(pdh),
        priority: "HIGH",
      },
      {
        id: "pdl",
        kind: "PDL",
        label: "Previous Day Low",
        shortLabel: "PDL",
        price: pdl,
        side: "SELL_SIDE",
        swept: currentPrice < pdl || work.slice(-12).some((c) => c.low < pdl!),
        time: prevDay.time,
        distancePct: distPct(pdl),
        priority: "HIGH",
      }
    );
  }
  if (dailyCandles.length >= 8) {
    const prevWeek = dailyCandles.slice(-9, -2);
    pwh = Math.max(...prevWeek.map((c) => c.high));
    pwl = Math.min(...prevWeek.map((c) => c.low));
    levels.push(
      {
        id: "pwh",
        kind: "PWH",
        label: "Previous Week High",
        shortLabel: "PWH",
        price: pwh,
        side: "BUY_SIDE",
        swept: work.slice(-24).some((c) => c.high > pwh!),
        time: prevWeek[prevWeek.length - 1].time,
        distancePct: distPct(pwh),
        priority: "HIGH",
      },
      {
        id: "pwl",
        kind: "PWL",
        label: "Previous Week Low",
        shortLabel: "PWL",
        price: pwl,
        side: "SELL_SIDE",
        swept: work.slice(-24).some((c) => c.low < pwl!),
        time: prevWeek[prevWeek.length - 1].time,
        distancePct: distPct(pwl),
        priority: "HIGH",
      }
    );
  }

  // 2. Asian / London / New York session ranges (use hourly candles when finer bars don't span 24h)
  const sessionSrc = hourlyCandles.length >= 24 ? hourlyCandles : work;
  const sessionLatest = sessionSrc[sessionSrc.length - 1].time;
  const asia = computeSessionRange(sessionSrc, "Asian", 0, 9, sessionLatest);
  const london = computeSessionRange(sessionSrc, "London", 7, 16, sessionLatest);
  const ny = computeSessionRange(sessionSrc, "New York", 12, 21, sessionLatest);
  const sessions = [asia, london, ny];

  const pushSessionLevels = (
    s: SessionRangeSummary,
    hKind: LiquidityLevel["kind"],
    lKind: LiquidityLevel["kind"],
    prefix: string
  ) => {
    if (s.high !== null && s.low !== null) {
      levels.push(
        {
          id: `${prefix}-h`,
          kind: hKind,
          label: `${s.session} Session High`,
          shortLabel: `${prefix} H`,
          price: s.high,
          side: "BUY_SIDE",
          swept: s.sweptHigh,
          time: last.time,
          distancePct: distPct(s.high),
          priority: "MEDIUM",
        },
        {
          id: `${prefix}-l`,
          kind: lKind,
          label: `${s.session} Session Low`,
          shortLabel: `${prefix} L`,
          price: s.low,
          side: "SELL_SIDE",
          swept: s.sweptLow,
          time: last.time,
          distancePct: distPct(s.low),
          priority: "MEDIUM",
        }
      );
    }
  };
  pushSessionLevels(asia, "ASIA_H", "ASIA_L", "ASIA");
  pushSessionLevels(london, "LDN_H", "LDN_L", "LDN");
  pushSessionLevels(ny, "NY_H", "NY_L", "NY");

  // 3. Untouched Buy-Side & Sell-Side Liquidity pools (key un-swept swings)
  const recentHighs = swingHighs.slice(-6);
  const recentLows = swingLows.slice(-6);
  let bslCount = 0;
  let sslCount = 0;

  for (const sh of recentHighs) {
    const sweptLater = work.slice(sh.index + 1).some((c) => c.high > sh.price);
    if (!sweptLater && sh.price > currentPrice) {
      bslCount++;
      levels.push({
        id: `bsl-${sh.index}`,
        kind: "BSL",
        label: "Buy-Side Liquidity Pool",
        shortLabel: "BSL",
        price: sh.price,
        side: "BUY_SIDE",
        swept: false,
        time: sh.time,
        distancePct: distPct(sh.price),
        priority: "HIGH",
      });
    }
  }
  for (const sl of recentLows) {
    const sweptLater = work.slice(sl.index + 1).some((c) => c.low < sl.price);
    if (!sweptLater && sl.price < currentPrice) {
      sslCount++;
      levels.push({
        id: `ssl-${sl.index}`,
        kind: "SSL",
        label: "Sell-Side Liquidity Pool",
        shortLabel: "SSL",
        price: sl.price,
        side: "SELL_SIDE",
        swept: false,
        time: sl.time,
        distancePct: distPct(sl.price),
        priority: "HIGH",
      });
    }
  }

  // 4. Equal Highs (EQH) & Equal Lows (EQL) resting stop clusters
  let eqhCount = 0;
  let eqlCount = 0;
  const usedHigh = new Set<number>();
  for (let i = 0; i < swingHighs.length; i++) {
    if (usedHigh.has(i)) continue;
    for (let j = i + 1; j < swingHighs.length; j++) {
      if (Math.abs(swingHighs[i].price - swingHighs[j].price) <= eqTolerance && j - i >= 1) {
        const avg = (swingHighs[i].price + swingHighs[j].price) / 2;
        const swept = work.slice(swingHighs[j].index + 1).some((c) => c.high > avg + eqTolerance * 0.35);
        usedHigh.add(i);
        usedHigh.add(j);
        eqhCount++;
        levels.push({
          id: `eqh-${swingHighs[i].index}-${swingHighs[j].index}`,
          kind: "EQH",
          label: "Equal Highs (Resting Stops)",
          shortLabel: "EQH",
          price: avg,
          side: "BUY_SIDE",
          swept,
          time: swingHighs[j].time,
          distancePct: distPct(avg),
          priority: "HIGH",
        });
        break;
      }
    }
  }
  const usedLow = new Set<number>();
  for (let i = 0; i < swingLows.length; i++) {
    if (usedLow.has(i)) continue;
    for (let j = i + 1; j < swingLows.length; j++) {
      if (Math.abs(swingLows[i].price - swingLows[j].price) <= eqTolerance && j - i >= 1) {
        const avg = (swingLows[i].price + swingLows[j].price) / 2;
        const swept = work.slice(swingLows[j].index + 1).some((c) => c.low < avg - eqTolerance * 0.35);
        usedLow.add(i);
        usedLow.add(j);
        eqlCount++;
        levels.push({
          id: `eql-${swingLows[i].index}-${swingLows[j].index}`,
          kind: "EQL",
          label: "Equal Lows (Resting Stops)",
          shortLabel: "EQL",
          price: avg,
          side: "SELL_SIDE",
          swept,
          time: swingLows[j].time,
          distancePct: distPct(avg),
          priority: "HIGH",
        });
        break;
      }
    }
  }

  // 5. Liquidity Sweeps, Stop Hunts, BOS & CHOCH sequence
  let runningTrend: "BULLISH" | "BEARISH" | null = null;
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;
  let bosCount = 0;
  let chochCount = 0;
  let sweepCount = 0;
  let stopHuntCount = 0;

  const swingMap = new Map<number, SwingPoint[]>();
  for (const s of swings) {
    const arr = swingMap.get(s.index) ?? [];
    arr.push(s);
    swingMap.set(s.index, arr);
  }

  for (let i = 0; i < work.length; i++) {
    const c = work[i];
    const registerIdx = i - 3;
    if (registerIdx >= 0 && swingMap.has(registerIdx)) {
      for (const sp of swingMap.get(registerIdx)!) {
        if (sp.type === "HIGH") lastSwingHigh = sp;
        else lastSwingLow = sp;
      }
    }

    // Check swing high sweep vs decisive close break
    if (lastSwingHigh && i > lastSwingHigh.index + 2) {
      if (c.close > lastSwingHigh.price) {
        const isChoch = runningTrend === "BEARISH";
        if (isChoch) chochCount++;
        else bosCount++;
        events.push({
          id: `${isChoch ? "choch" : "bos"}-bull-${i}`,
          type: isChoch ? "CHOCH" : "BOS",
          direction: "BULLISH",
          price: lastSwingHigh.price,
          time: c.time,
          label: isChoch ? "Bullish CHoCH" : "Bullish BOS",
          detail: isChoch
            ? `Change of character confirmed with close above prior swing high.`
            : `Structure continuation confirmed with candle close above swing high.`,
        });
        runningTrend = "BULLISH";
        lastSwingHigh = null;
      } else if (c.high > lastSwingHigh.price && c.close < lastSwingHigh.price) {
        const wickRatio = (c.high - Math.max(c.open, c.close)) / Math.max(c.high - c.low, 1e-8);
        const isHunt = wickRatio >= 0.45 && c.close < c.open;
        if (isHunt) stopHuntCount++;
        else sweepCount++;
        events.push({
          id: `${isHunt ? "hunt" : "sweep"}-bsl-${i}`,
          type: isHunt ? "STOP_HUNT" : "SWEEP",
          direction: "BEARISH",
          price: lastSwingHigh.price,
          time: c.time,
          label: isHunt ? "BSL Stop Hunt" : "BSL Sweep",
          detail: isHunt
            ? `Aggressive spike raided buy-side stops then closed sharply lower (wick ${(wickRatio * 100).toFixed(0)}%).`
            : `Wick tagged buy-side liquidity above swing high without body acceptance.`,
        });
        lastSwingHigh = null;
      }
    }

    // Check swing low sweep vs decisive close break
    if (lastSwingLow && i > lastSwingLow.index + 2) {
      if (c.close < lastSwingLow.price) {
        const isChoch = runningTrend === "BULLISH";
        if (isChoch) chochCount++;
        else bosCount++;
        events.push({
          id: `${isChoch ? "choch" : "bos"}-bear-${i}`,
          type: isChoch ? "CHOCH" : "BOS",
          direction: "BEARISH",
          price: lastSwingLow.price,
          time: c.time,
          label: isChoch ? "Bearish CHoCH" : "Bearish BOS",
          detail: isChoch
            ? `Change of character confirmed with close below prior swing low.`
            : `Downside break of structure with confirmed close beneath prior low.`,
        });
        runningTrend = "BEARISH";
        lastSwingLow = null;
      } else if (c.low < lastSwingLow.price && c.close > lastSwingLow.price) {
        const wickRatio = (Math.min(c.open, c.close) - c.low) / Math.max(c.high - c.low, 1e-8);
        const isHunt = wickRatio >= 0.45 && c.close > c.open;
        if (isHunt) stopHuntCount++;
        else sweepCount++;
        events.push({
          id: `${isHunt ? "hunt" : "sweep"}-ssl-${i}`,
          type: isHunt ? "STOP_HUNT" : "SWEEP",
          direction: "BULLISH",
          price: lastSwingLow.price,
          time: c.time,
          label: isHunt ? "SSL Stop Hunt" : "SSL Sweep",
          detail: isHunt
            ? `Stop hunt swept sell-side stops below prior low and reclaimed cleanly (wick ${(wickRatio * 100).toFixed(0)}%).`
            : `Sell-side liquidity probed beneath swing low with immediate close recovery.`,
        });
        lastSwingLow = null;
      }
    }
  }

  // 6. Inducement (IDM) — nearest minor internal pullback pivot before extreme swing
  const activeTrend: LiquidityAnalysis["trend"] = runningTrend ?? "RANGING";
  if (activeTrend === "BULLISH" && swingLows.length >= 1) {
    const idm = swingLows[swingLows.length - 1];
    levels.push({
      id: `idm-bull-${idm.index}`,
      kind: "IDM",
      label: "Bullish Inducement (IDM)",
      shortLabel: "IDM",
      price: idm.price,
      side: "SELL_SIDE",
      swept: work.slice(idm.index + 1).some((c) => c.low < idm.price),
      time: idm.time,
      distancePct: distPct(idm.price),
      priority: "MEDIUM",
    });
  } else if (activeTrend === "BEARISH" && swingHighs.length >= 1) {
    const idm = swingHighs[swingHighs.length - 1];
    levels.push({
      id: `idm-bear-${idm.index}`,
      kind: "IDM",
      label: "Bearish Inducement (IDM)",
      shortLabel: "IDM",
      price: idm.price,
      side: "BUY_SIDE",
      swept: work.slice(idm.index + 1).some((c) => c.high > idm.price),
      time: idm.time,
      distancePct: distPct(idm.price),
      priority: "MEDIUM",
    });
  }

  // 7. Fair Value Gaps (FVG: 3-candle displacement imbalance)
  let fvgCount = 0;
  for (let i = 2; i < work.length; i++) {
    const a = work[i - 2];
    const b = work[i - 1];
    const c = work[i];
    const minGap = atr * 0.25;
    if (c.low - a.high >= minGap && b.close > b.open) {
      const low = a.high;
      const high = c.low;
      const mitigated = work.slice(i + 1).some((k) => k.low <= (low + high) / 2);
      zones.push({
        id: `fvg-bull-${i}`,
        kind: "FVG",
        direction: "BULLISH",
        high,
        low,
        mid: (high + low) / 2,
        startTime: b.time,
        mitigated,
        strength: high - low > atr * 0.65 ? "STRONG" : "MODERATE",
        label: "Bullish FVG",
      });
      fvgCount++;
    } else if (a.low - c.high >= minGap && b.close < b.open) {
      const high = a.low;
      const low = c.high;
      const mitigated = work.slice(i + 1).some((k) => k.high >= (low + high) / 2);
      zones.push({
        id: `fvg-bear-${i}`,
        kind: "FVG",
        direction: "BEARISH",
        high,
        low,
        mid: (high + low) / 2,
        startTime: b.time,
        mitigated,
        strength: high - low > atr * 0.65 ? "STRONG" : "MODERATE",
        label: "Bearish FVG",
      });
      fvgCount++;
    }
  }

  // 8. Order Blocks (OB), Breaker Blocks (failed OB reversed), & Mitigation Blocks (retested OB)
  let obCount = 0;
  let bbCount = 0;
  let mbCount = 0;
  for (let i = 3; i < work.length - 2; i++) {
    const prev = work[i];
    const next1 = work[i + 1];
    const next2 = work[i + 2];
    const impulseUp = next1.close - prev.open > atr * 1.15 && next2.close > prev.high;
    const impulseDown = prev.open - next1.close > atr * 1.15 && next2.close < prev.low;

    if (prev.close < prev.open && impulseUp) {
      const future = work.slice(i + 3);
      const broken = future.some((k) => k.close < prev.low);
      const tapped = !broken && future.some((k) => k.low <= prev.high && k.close >= prev.low);
      if (broken) {
        bbCount++;
        zones.push({
          id: `bb-bear-${i}`,
          kind: "BREAKER_BLOCK",
          direction: "BEARISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: false,
          strength: "STRONG",
          label: "Bearish Breaker",
        });
      } else if (tapped) {
        mbCount++;
        zones.push({
          id: `mb-bull-${i}`,
          kind: "MITIGATION_BLOCK",
          direction: "BULLISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: true,
          strength: "MODERATE",
          label: "Bullish Mitigation",
        });
      } else {
        obCount++;
        zones.push({
          id: `ob-bull-${i}`,
          kind: "ORDER_BLOCK",
          direction: "BULLISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: false,
          strength: "STRONG",
          label: "Bullish OB / Demand",
        });
      }
    } else if (prev.close > prev.open && impulseDown) {
      const future = work.slice(i + 3);
      const broken = future.some((k) => k.close > prev.high);
      const tapped = !broken && future.some((k) => k.high >= prev.low && k.close <= prev.high);
      if (broken) {
        bbCount++;
        zones.push({
          id: `bb-bull-${i}`,
          kind: "BREAKER_BLOCK",
          direction: "BULLISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: false,
          strength: "STRONG",
          label: "Bullish Breaker",
        });
      } else if (tapped) {
        mbCount++;
        zones.push({
          id: `mb-bear-${i}`,
          kind: "MITIGATION_BLOCK",
          direction: "BEARISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: true,
          strength: "MODERATE",
          label: "Bearish Mitigation",
        });
      } else {
        obCount++;
        zones.push({
          id: `ob-bear-${i}`,
          kind: "ORDER_BLOCK",
          direction: "BEARISH",
          high: prev.high,
          low: prev.low,
          mid: (prev.high + prev.low) / 2,
          startTime: prev.time,
          mitigated: false,
          strength: "STRONG",
          label: "Bearish OB / Supply",
        });
      }
    }
  }

  // Keep freshest relevant zones (prefer unmitigated, latest first)
  const freshZones = [
    ...zones.filter((z) => z.kind === "FVG" && !z.mitigated).slice(-4),
    ...zones.filter((z) => z.kind === "ORDER_BLOCK").slice(-4),
    ...zones.filter((z) => z.kind === "BREAKER_BLOCK").slice(-3),
    ...zones.filter((z) => z.kind === "MITIGATION_BLOCK").slice(-3),
  ];

  // Nearest buy-side above price and sell-side below price
  const unsweptAbove = levels
    .filter((l) => l.price > currentPrice && !l.swept && l.side === "BUY_SIDE")
    .sort((a, b) => a.price - b.price);
  const unsweptBelow = levels
    .filter((l) => l.price < currentPrice && !l.swept && l.side === "SELL_SIDE")
    .sort((a, b) => b.price - a.price);

  const nearestBsl = unsweptAbove[0] ?? levels.filter((l) => l.price > currentPrice).sort((a, b) => a.price - b.price)[0] ?? null;
  const nearestSsl = unsweptBelow[0] ?? levels.filter((l) => l.price < currentPrice).sort((a, b) => b.price - a.price)[0] ?? null;

  const recentEvents = events.slice(-16);
  const lastStructureEvent = recentEvents[recentEvents.length - 1] ?? null;
  const recentSweep = events.slice(-4).some((e) => e.type === "SWEEP" || e.type === "STOP_HUNT");
  const liquidityCondition: LiquidityAnalysis["liquidityCondition"] = recentSweep
    ? "SWEEP_ACTIVE"
    : eqhCount + eqlCount >= 2
      ? "CLEAN_POOLS"
      : asia.range !== null && asia.range < atr * 1.8
        ? "COMPRESSED"
        : "BALANCED";

  const structureBias =
    activeTrend === "BULLISH"
      ? `Bullish structure intact (${bosCount} BOS, ${chochCount} CHoCH). Price holding constructive highs${nearestBsl ? ` targeting ${nearestBsl.shortLabel}` : ""}.`
      : activeTrend === "BEARISH"
        ? `Bearish structure controlling delivery (${bosCount} BOS, ${chochCount} CHoCH). Draws lean toward resting sell-side liquidity${nearestSsl ? ` near ${nearestSsl.shortLabel}` : ""}.`
        : "Balanced rotational structure; awaiting clean BOS or session liquidity sweep before directional commitment.";

  return {
    symbol,
    timeframe,
    currentPrice,
    trend: activeTrend,
    structureBias,
    lastStructureEvent,
    levels,
    events: recentEvents,
    zones: freshZones,
    sessions,
    pdh,
    pdl,
    pwh,
    pwl,
    nearestBsl,
    nearestSsl,
    liquidityCondition,
    counts: {
      bsl: bslCount,
      ssl: sslCount,
      equalHighs: eqhCount,
      equalLows: eqlCount,
      sweeps: sweepCount,
      stopHunts: stopHuntCount,
      fvgs: zones.filter((z) => z.kind === "FVG" && !z.mitigated).length,
      orderBlocks: obCount,
      breakerBlocks: bbCount,
      mitigationBlocks: mbCount,
      bosCount,
      chochCount,
    },
  };
}

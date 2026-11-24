export type DataStatus = "LIVE" | "DELAYED" | "CACHED" | "SIMULATED" | "UNAVAILABLE";

export type MarketCategory = "GOLD" | "FOREX" | "INDICES" | "CRYPTO";

export type Timeframe = "3m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface InstrumentDef {
  symbol: string;
  name: string;
  category: MarketCategory;
  decimals: number;
  provider: "hyperliquid" | "yahoo";
  providerSymbol: string;
  pipSize: number;
  contractSize: number; // units per standard lot
  isPrimary?: boolean;
  supportsOrderBook: boolean;
}

export interface Candle {
  time: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  orders: number;
  cumulative: number;
  notional: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  providerSymbol: string;
  source: string;
  status: DataStatus;
  timestamp: number;
  fetchedAt: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  totalBidVolume: number;
  totalAskVolume: number;
  error?: string;
}

export interface MarketQuote {
  symbol: string;
  name: string;
  category: MarketCategory;
  decimals: number;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  atr14: number | null;
  volatilityPct: number | null;
  volatilityState: "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "UNAVAILABLE";
  source: string;
  providerSymbol: string;
  status: DataStatus;
  fetchedAt: string;
  supportsOrderBook: boolean;
  isPrimary?: boolean;
}

export interface CandleSeriesResult {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  source: string;
  providerSymbol: string;
  status: DataStatus;
  fetchedAt: string;
  cacheAgeSec: number;
  error?: string;
}

export const CALENDAR_IMPACTS = ["High", "Medium", "Holiday"] as const;
export const isCalendarRelease = (impact: string) => (CALENDAR_IMPACTS as readonly string[]).includes(impact);

export interface EconomicEvent {
  id: string;
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  dateIso: string;
  timestamp: number;
  forecast: string;
  previous: string;
  actual: string;
  isGoldSensitive: boolean;
  category: "Central Bank" | "Inflation" | "Employment" | "Rates" | "Growth" | "Sentiment" | "General";
}

export interface EconomicCalendarResult {
  events: EconomicEvent[];
  source: string;
  status: DataStatus;
  fetchedAt: string;
  cacheAgeSec: number;
  error?: string;
}

export interface FeedHealthRecord {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  status: DataStatus;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  cachedKeys: number;
}

export interface TradingSessionInfo {
  name: "Asian" | "London" | "New York";
  code: "ASIA" | "LDN" | "NY";
  active: boolean;
  openUtc: string;
  closeUtc: string;
  minutesRemaining: number;
  liquidityNote: string;
}

// Primary Gold feed anchored to Hyperliquid PAXG perpetual/spot reference (mapped as XAUUSD)
export const INSTRUMENTS: InstrumentDef[] = [
  {
    symbol: "XAUUSD",
    name: "Gold / US Dollar (Hyperliquid PAXG)",
    category: "GOLD",
    decimals: 2,
    provider: "hyperliquid",
    providerSymbol: "PAXG",
    pipSize: 0.1,
    contractSize: 100,
    isPrimary: true,
    supportsOrderBook: true,
  },
  {
    symbol: "XAUFUT",
    name: "COMEX Gold Futures Ref",
    category: "GOLD",
    decimals: 2,
    provider: "yahoo",
    providerSymbol: "GC=F",
    pipSize: 0.1,
    contractSize: 100,
    supportsOrderBook: false,
  },
  {
    symbol: "EURUSD",
    name: "Euro / US Dollar",
    category: "FOREX",
    decimals: 5,
    provider: "yahoo",
    providerSymbol: "EURUSD=X",
    pipSize: 0.0001,
    contractSize: 100000,
    supportsOrderBook: false,
  },
  {
    symbol: "GBPUSD",
    name: "British Pound / US Dollar",
    category: "FOREX",
    decimals: 5,
    provider: "yahoo",
    providerSymbol: "GBPUSD=X",
    pipSize: 0.0001,
    contractSize: 100000,
    supportsOrderBook: false,
  },
  {
    symbol: "USDJPY",
    name: "US Dollar / Japanese Yen",
    category: "FOREX",
    decimals: 3,
    provider: "yahoo",
    providerSymbol: "JPY=X",
    pipSize: 0.01,
    contractSize: 100000,
    supportsOrderBook: false,
  },
  {
    symbol: "DXY",
    name: "US Dollar Index",
    category: "FOREX",
    decimals: 3,
    provider: "yahoo",
    providerSymbol: "DX-Y.NYB",
    pipSize: 0.01,
    contractSize: 1000,
    supportsOrderBook: false,
  },
  {
    symbol: "US500",
    name: "S&P 500 Index",
    category: "INDICES",
    decimals: 2,
    provider: "yahoo",
    providerSymbol: "^GSPC",
    pipSize: 0.25,
    contractSize: 50,
    supportsOrderBook: false,
  },
  {
    symbol: "NAS100",
    name: "Nasdaq 100 Index",
    category: "INDICES",
    decimals: 2,
    provider: "yahoo",
    providerSymbol: "^NDX",
    pipSize: 0.25,
    contractSize: 20,
    supportsOrderBook: false,
  },
  {
    symbol: "US30",
    name: "Dow Jones Industrial 30",
    category: "INDICES",
    decimals: 2,
    provider: "yahoo",
    providerSymbol: "^DJI",
    pipSize: 1.0,
    contractSize: 5,
    supportsOrderBook: false,
  },
  {
    symbol: "BTCUSD",
    name: "Bitcoin / USD (Hyperliquid)",
    category: "CRYPTO",
    decimals: 1,
    provider: "hyperliquid",
    providerSymbol: "BTC",
    pipSize: 1,
    contractSize: 1,
    supportsOrderBook: true,
  },
  {
    symbol: "ETHUSD",
    name: "Ethereum / USD (Hyperliquid)",
    category: "CRYPTO",
    decimals: 2,
    provider: "hyperliquid",
    providerSymbol: "ETH",
    pipSize: 0.1,
    contractSize: 1,
    supportsOrderBook: true,
  },
  {
    symbol: "SOLUSD",
    name: "Solana / USD (Hyperliquid)",
    category: "CRYPTO",
    decimals: 2,
    provider: "hyperliquid",
    providerSymbol: "SOL",
    pipSize: 0.01,
    contractSize: 1,
    supportsOrderBook: true,
  },
  {
    symbol: "XRPUSD",
    name: "XRP / USD (Hyperliquid)",
    category: "CRYPTO",
    decimals: 4,
    provider: "hyperliquid",
    providerSymbol: "XRP",
    pipSize: 0.0001,
    contractSize: 1,
    supportsOrderBook: true,
  },
];

export function getInstrument(symbol: string): InstrumentDef {
  const upper = symbol.toUpperCase();
  return INSTRUMENTS.find((i) => i.symbol === upper) ?? INSTRUMENTS[0];
}

// Server-side in-memory TTL cache + health monitor
interface CacheEntry<T> {
  value: T;
  fetchedAtMs: number;
  ttlMs: number;
}

const g = globalThis as typeof globalThis & {
  __freyrCache?: Map<string, CacheEntry<unknown>>;
  __freyrHealth?: Map<string, FeedHealthRecord>;
  __freyrLastCalendar?: { events: EconomicEvent[]; fetchedAt: string };
};

const cache: Map<string, CacheEntry<unknown>> = (g.__freyrCache ??= new Map());
const feedHealth: Map<string, FeedHealthRecord> = (g.__freyrHealth ??= new Map([
  [
    "hyperliquid",
    {
      id: "hyperliquid",
      name: "Gold and perpetuals (Hyperliquid)",
      provider: "Hyperliquid Info API",
      endpoint: "api.hyperliquid.xyz/info",
      status: "LIVE",
      latencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      cachedKeys: 0,
    },
  ],
  [
    "yahoo",
    {
      id: "yahoo",
      name: "Forex, Indices & Futures Reference",
      provider: "Yahoo Finance Chart API",
      endpoint: "query1.finance.yahoo.com",
      status: "DELAYED",
      latencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      cachedKeys: 0,
    },
  ],
  [
    "forexfactory",
    {
      id: "forexfactory",
      name: "Economic Calendar (Forex Factory)",
      provider: "Forex Factory Feed",
      endpoint: "nfs.faireconomy.media",
      status: "LIVE",
      latencyMs: null,
      lastSuccessAt: null,
      lastError: null,
      cachedKeys: 0,
    },
  ],
  [
    "modflow",
    {
      id: "modflow",
      name: "ModFlow Institutional Order Flow Engine",
      provider: "FREYR ModFlow Suite v2",
      endpoint: "/api/modflow",
      status: "LIVE",
      latencyMs: 0,
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      cachedKeys: 0,
    },
  ],
]));

function updateHealth(id: string, patch: Partial<FeedHealthRecord>) {
  const existing = feedHealth.get(id);
  if (existing) {
    feedHealth.set(id, { ...existing, ...patch });
  }
}

export function getFeedHealth(): FeedHealthRecord[] {
  const counts: Record<string, number> = {};
  for (const key of cache.keys()) {
    const prefix = key.split(":")[0];
    counts[prefix] = (counts[prefix] ?? 0) + 1;
  }
  return Array.from(feedHealth.values()).map((r) => ({
    ...r,
    cachedKeys: counts[r.id] ?? 0,
  }));
}

export function clearMarketCache(): number {
  const count = cache.size;
  cache.clear();
  return count;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
  timeoutMs = 7000
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 220 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network request failed");
}

function getCached<T>(key: string): { value: T; fresh: boolean; ageSec: number; fetchedAt: string } | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  const ageMs = Date.now() - entry.fetchedAtMs;
  return {
    value: entry.value,
    fresh: ageMs < entry.ttlMs,
    ageSec: Math.max(0, Math.round(ageMs / 1000)),
    fetchedAt: new Date(entry.fetchedAtMs).toISOString(),
  };
}

function setCached<T>(key: string, value: T, ttlMs: number) {
  cache.set(key, { value, fetchedAtMs: Date.now(), ttlMs });
}

export function computeAtr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function classifyVolatility(atr: number | null, price: number | null): {
  pct: number | null;
  state: MarketQuote["volatilityState"];
} {
  if (atr === null || price === null || price <= 0) return { pct: null, state: "UNAVAILABLE" };
  const pct = (atr / price) * 100;
  if (pct < 0.15) return { pct, state: "LOW" };
  if (pct < 0.4) return { pct, state: "MODERATE" };
  if (pct < 0.85) return { pct, state: "ELEVATED" };
  return { pct, state: "HIGH" };
}

export function getActiveSessions(nowMs = Date.now()): {
  sessions: TradingSessionInfo[];
  currentLabel: string;
  isOverlap: boolean;
  utcTime: string;
} {
  const d = new Date(nowMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const inRange = (startH: number, endH: number) => {
    const s = startH * 60;
    const e = endH * 60;
    return mins >= s && mins < e;
  };
  const rem = (endH: number) => {
    const e = endH * 60;
    return mins < e ? e - mins : 24 * 60 - mins + e;
  };

  // Asian 00:00–09:00 UTC, London 07:00–16:00 UTC, New York 12:00–21:00 UTC
  const asiaActive = inRange(0, 9);
  const londonActive = inRange(7, 16);
  const nyActive = inRange(12, 21);

  const sessions: TradingSessionInfo[] = [
    {
      name: "Asian",
      code: "ASIA",
      active: asiaActive,
      openUtc: "00:00",
      closeUtc: "09:00",
      minutesRemaining: asiaActive ? rem(9) : 0,
      liquidityNote: "Range establishment & accumulation window",
    },
    {
      name: "London",
      code: "LDN",
      active: londonActive,
      openUtc: "07:00",
      closeUtc: "16:00",
      minutesRemaining: londonActive ? rem(16) : 0,
      liquidityNote: "Peak XAUUSD sweep & trend expansion window",
    },
    {
      name: "New York",
      code: "NY",
      active: nyActive,
      openUtc: "12:00",
      closeUtc: "21:00",
      minutesRemaining: nyActive ? rem(21) : 0,
      liquidityNote: "Primary USD macro & institutional continuation",
    },
  ];

  const activeNames = sessions.filter((s) => s.active).map((s) => s.name);
  const isOverlap = activeNames.length > 1;
  const currentLabel =
    activeNames.length === 0
      ? "Off-Hours (Rollover)"
      : isOverlap
        ? `${activeNames.join(" / ")} Overlap`
        : `${activeNames[0]} Session`;

  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return { sessions, currentLabel, isOverlap, utcTime: `${hh}:${mm} UTC` };
}

export function classifySessionFromTimestamp(ms: number): "Asian" | "London" | "New York" | "Off-Hours" {
  const h = new Date(ms).getUTCHours();
  if (h >= 12 && h < 21) return "New York";
  if (h >= 7 && h < 16) return "London";
  if (h >= 0 && h < 9) return "Asian";
  return "Off-Hours";
}

// Fetch Hyperliquid allMids
export async function fetchHyperliquidMids(): Promise<{
  mids: Record<string, number>;
  status: DataStatus;
  fetchedAt: string;
}> {
  const key = "hyperliquid:allMids";
  const hit = getCached<Record<string, number>>(key);
  if (hit && hit.fresh) {
    return { mids: hit.value, status: "LIVE", fetchedAt: hit.fetchedAt };
  }
  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      "https://api.hyperliquid.xyz/info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
      },
      2,
      6000
    );
    const raw = (await res.json()) as Record<string, string>;
    const mids: Record<string, number> = {};
    for (const inst of INSTRUMENTS.filter((i) => i.provider === "hyperliquid")) {
      const val = Number(raw[inst.providerSymbol]);
      if (Number.isFinite(val) && val > 0) mids[inst.symbol] = val;
    }
    const latency = Date.now() - t0;
    const nowIso = new Date().toISOString();
    setCached(key, mids, 8_000);
    updateHealth("hyperliquid", {
      status: "LIVE",
      latencyMs: latency,
      lastSuccessAt: nowIso,
      lastError: null,
    });
    return { mids, status: "LIVE", fetchedAt: nowIso };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load Hyperliquid mids";
    updateHealth("hyperliquid", {
      status: hit ? "CACHED" : "UNAVAILABLE",
      lastError: msg,
    });
    if (hit) {
      return { mids: hit.value, status: "CACHED", fetchedAt: hit.fetchedAt };
    }
    return { mids: {}, status: "UNAVAILABLE", fetchedAt: new Date().toISOString() };
  }
}

// Fetch live L2 order book for Hyperliquid markets (XAUUSD/PAXG, BTC, ETH, SOL, XRP)
export async function fetchOrderBook(symbol = "XAUUSD"): Promise<OrderBookSnapshot> {
  const inst = getInstrument(symbol);
  if (inst.provider !== "hyperliquid") {
    return {
      symbol: inst.symbol,
      providerSymbol: inst.providerSymbol,
      source: "Unavailable (OTC / Reference Index)",
      status: "UNAVAILABLE",
      timestamp: Date.now(),
      fetchedAt: new Date().toISOString(),
      midPrice: 0,
      bestBid: 0,
      bestAsk: 0,
      spread: 0,
      spreadBps: 0,
      bids: [],
      asks: [],
      totalBidVolume: 0,
      totalAskVolume: 0,
      error: `L2 order book is supported for Hyperliquid gold (XAUUSD) and crypto instruments. ${inst.symbol} provides reference price data only.`,
    };
  }

  const key = `hyperliquid:l2:${inst.providerSymbol}`;
  const hit = getCached<OrderBookSnapshot>(key);
  if (hit && hit.fresh) {
    return hit.value;
  }

  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      "https://api.hyperliquid.xyz/info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "l2Book", coin: inst.providerSymbol }),
      },
      2,
      6000
    );
    const json = (await res.json()) as {
      coin?: string;
      time?: number;
      levels?: [
        Array<{ px: string; sz: string; n: number }>,
        Array<{ px: string; sz: string; n: number }>,
      ];
    };
    const rawBids = json?.levels?.[0] ?? [];
    const rawAsks = json?.levels?.[1] ?? [];
    if (!rawBids.length || !rawAsks.length) {
      throw new Error("Empty order book response");
    }

    let cumBid = 0;
    const bids: OrderBookLevel[] = rawBids
      .map((l) => {
        const price = Number(l.px);
        const size = Number(l.sz);
        const orders = Number(l.n) || 1;
        if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size < 0) return null;
        cumBid += size;
        return {
          price,
          size,
          orders,
          cumulative: Number(cumBid.toFixed(4)),
          notional: Number((price * size).toFixed(2)),
        };
      })
      .filter((x): x is OrderBookLevel => x !== null);

    let cumAsk = 0;
    const asks: OrderBookLevel[] = rawAsks
      .map((l) => {
        const price = Number(l.px);
        const size = Number(l.sz);
        const orders = Number(l.n) || 1;
        if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size < 0) return null;
        cumAsk += size;
        return {
          price,
          size,
          orders,
          cumulative: Number(cumAsk.toFixed(4)),
          notional: Number((price * size).toFixed(2)),
        };
      })
      .filter((x): x is OrderBookLevel => x !== null);

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const midPrice = bestBid && bestAsk ? Number(((bestBid + bestAsk) / 2).toFixed(inst.decimals + 1)) : bestBid || bestAsk;
    const spread = Number(Math.max(0, bestAsk - bestBid).toFixed(inst.decimals + 1));
    const spreadBps = midPrice > 0 ? Number(((spread / midPrice) * 10000).toFixed(2)) : 0;
    const nowIso = new Date().toISOString();
    const latency = Date.now() - t0;

    const snap: OrderBookSnapshot = {
      symbol: inst.symbol,
      providerSymbol: inst.providerSymbol,
      source: `Hyperliquid L2 (${inst.providerSymbol})`,
      status: "LIVE",
      timestamp: json.time ?? Date.now(),
      fetchedAt: nowIso,
      midPrice,
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      bids,
      asks,
      totalBidVolume: Number(cumBid.toFixed(4)),
      totalAskVolume: Number(cumAsk.toFixed(4)),
    };

    setCached(key, snap, 6_000);
    updateHealth("hyperliquid", {
      status: "LIVE",
      latencyMs: latency,
      lastSuccessAt: nowIso,
      lastError: null,
    });
    return snap;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Order book fetch error";
    updateHealth("hyperliquid", {
      status: hit ? "CACHED" : "UNAVAILABLE",
      lastError: msg,
    });
    if (hit) {
      return { ...hit.value, status: "CACHED" };
    }
    return {
      symbol: inst.symbol,
      providerSymbol: inst.providerSymbol,
      source: `Hyperliquid L2 (${inst.providerSymbol})`,
      status: "UNAVAILABLE",
      timestamp: Date.now(),
      fetchedAt: new Date().toISOString(),
      midPrice: 0,
      bestBid: 0,
      bestAsk: 0,
      spread: 0,
      spreadBps: 0,
      bids: [],
      asks: [],
      totalBidVolume: 0,
      totalAskVolume: 0,
      error: msg,
    };
  }
}

const HL_LOOKBACK_MS: Record<Timeframe, number> = {
  "3m": 12 * 3600 * 1000,
  "5m": 20 * 3600 * 1000,
  "15m": 60 * 3600 * 1000,
  "1h": 10 * 24 * 3600 * 1000,
  "4h": 32 * 24 * 3600 * 1000,
  "1d": 180 * 24 * 3600 * 1000,
};

const YAHOO_MAP: Record<Timeframe, { interval: string; range: string }> = {
  "3m": { interval: "5m", range: "2d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "5d" },
  "1h": { interval: "60m", range: "1mo" },
  "4h": { interval: "60m", range: "1mo" },
  "1d": { interval: "1d", range: "6mo" },
};

function aggregateTo4h(hourly: Candle[]): Candle[] {
  const grouped: Candle[] = [];
  const bucketMs = 4 * 3600 * 1000;
  for (const c of hourly) {
    const key = Math.floor(c.time / bucketMs) * bucketMs;
    const last = grouped[grouped.length - 1];
    if (last && last.time === key) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      grouped.push({ ...c, time: key });
    }
  }
  return grouped;
}

export async function fetchCandles(
  symbol: string,
  timeframe: Timeframe = "15m",
  customStartMs?: number,
  customEndMs?: number
): Promise<CandleSeriesResult> {
  const inst = getInstrument(symbol);
  const hasRange = typeof customStartMs === "number" && typeof customEndMs === "number";
  const cacheKey = hasRange
    ? `${inst.provider}:candles:${inst.symbol}:${timeframe}:${Math.floor(customStartMs! / 60000)}:${Math.floor(customEndMs! / 60000)}`
    : `${inst.provider}:candles:${inst.symbol}:${timeframe}`;

  const hit = getCached<CandleSeriesResult>(cacheKey);
  if (hit && hit.fresh) {
    return { ...hit.value, cacheAgeSec: hit.ageSec };
  }

  const t0 = Date.now();
  if (inst.provider === "hyperliquid") {
    try {
      const endTime = customEndMs ?? Date.now();
      const startTime = customStartMs ?? endTime - HL_LOOKBACK_MS[timeframe];
      const res = await fetchWithRetry(
        "https://api.hyperliquid.xyz/info",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: {
              coin: inst.providerSymbol,
              interval: timeframe,
              startTime,
              endTime,
            },
          }),
        },
        2,
        8000
      );
      const raw = (await res.json()) as Array<{
        t: number;
        o: string;
        h: string;
        l: string;
        c: string;
        v: string;
        n?: number;
      }>;
      if (!Array.isArray(raw)) throw new Error("Invalid candle payload");
      const candles: Candle[] = raw
        .map((r) => ({
          time: Number(r.t),
          open: Number(r.o),
          high: Number(r.h),
          low: Number(r.l),
          close: Number(r.c),
          volume: Number(r.v),
          trades: r.n ?? 0,
        }))
        .filter(
          (c) =>
            Number.isFinite(c.time) &&
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            c.high >= c.low &&
            c.open > 0
        )
        .sort((a, b) => a.time - b.time);

      const nowIso = new Date().toISOString();
      const result: CandleSeriesResult = {
        symbol: inst.symbol,
        timeframe,
        candles,
        source: `Hyperliquid (${inst.providerSymbol})`,
        providerSymbol: inst.providerSymbol,
        status: "LIVE",
        fetchedAt: nowIso,
        cacheAgeSec: 0,
      };
      const ttl = timeframe === "3m" || timeframe === "5m" ? 12_000 : timeframe === "15m" ? 20_000 : 45_000;
      setCached(cacheKey, result, hasRange ? 120_000 : ttl);
      updateHealth("hyperliquid", {
        status: "LIVE",
        latencyMs: Date.now() - t0,
        lastSuccessAt: nowIso,
        lastError: null,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Candle request failed";
      updateHealth("hyperliquid", {
        status: hit ? "CACHED" : "UNAVAILABLE",
        lastError: msg,
      });
      if (hit) return { ...hit.value, status: "CACHED", cacheAgeSec: hit.ageSec };
      return {
        symbol: inst.symbol,
        timeframe,
        candles: [],
        source: `Hyperliquid (${inst.providerSymbol})`,
        providerSymbol: inst.providerSymbol,
        status: "UNAVAILABLE",
        fetchedAt: new Date().toISOString(),
        cacheAgeSec: 0,
        error: msg,
      };
    }
  }

  // Yahoo Finance for Forex, Indices, DXY, COMEX Gold futures reference
  try {
    const spec = YAHOO_MAP[timeframe];
    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.providerSymbol)}?interval=${spec.interval}`;
    if (hasRange && customStartMs && customEndMs) {
      const p1 = Math.floor(customStartMs / 1000);
      const p2 = Math.floor(customEndMs / 1000);
      url += `&period1=${p1}&period2=${p2}`;
    } else {
      url += `&range=${spec.range}`;
    }
    const res = await fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FREYR-Terminal/1.0)",
          Accept: "application/json",
        },
      },
      2,
      8000
    );
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };
    const r = json?.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const q = r?.indicators?.quote?.[0];
    let candles: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q?.open?.[i];
      const h = q?.high?.[i];
      const l = q?.low?.[i];
      const c = q?.close?.[i];
      const v = q?.volume?.[i] ?? 0;
      if (
        typeof o === "number" &&
        typeof h === "number" &&
        typeof l === "number" &&
        typeof c === "number" &&
        Number.isFinite(o) &&
        Number.isFinite(c) &&
        o > 0 &&
        h >= l
      ) {
        candles.push({
          time: ts[i] * 1000,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: typeof v === "number" && Number.isFinite(v) ? v : 0,
        });
      }
    }
    if (timeframe === "4h") {
      candles = aggregateTo4h(candles);
    }
    const nowIso = new Date().toISOString();
    const result: CandleSeriesResult = {
      symbol: inst.symbol,
      timeframe,
      candles,
      source: `Yahoo Finance (${inst.providerSymbol})`,
      providerSymbol: inst.providerSymbol,
      status: "DELAYED",
      fetchedAt: nowIso,
      cacheAgeSec: 0,
    };
    setCached(cacheKey, result, 45_000);
    updateHealth("yahoo", {
      status: "DELAYED",
      latencyMs: Date.now() - t0,
      lastSuccessAt: nowIso,
      lastError: null,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reference candle error";
    updateHealth("yahoo", {
      status: hit ? "CACHED" : "UNAVAILABLE",
      lastError: msg,
    });
    if (hit) return { ...hit.value, status: "CACHED", cacheAgeSec: hit.ageSec };
    return {
      symbol: inst.symbol,
      timeframe,
      candles: [],
      source: `Yahoo Finance (${inst.providerSymbol})`,
      providerSymbol: inst.providerSymbol,
      status: "UNAVAILABLE",
      fetchedAt: new Date().toISOString(),
      cacheAgeSec: 0,
      error: msg,
    };
  }
}

export async function fetchAllQuotes(): Promise<{
  quotes: MarketQuote[];
  fetchedAt: string;
}> {
  const key = "quotes:all";
  const hit = getCached<MarketQuote[]>(key);
  if (hit && hit.fresh) {
    return { quotes: hit.value, fetchedAt: hit.fetchedAt };
  }

  const hlMids = await fetchHyperliquidMids();

  const quotePromises = INSTRUMENTS.map(async (inst): Promise<MarketQuote> => {
    try {
      const series = await fetchCandles(inst.symbol, "1h");
      const candles = series.candles;
      const liveMid = inst.provider === "hyperliquid" ? hlMids.mids[inst.symbol] : undefined;
      const last = candles[candles.length - 1];
      const price = liveMid ?? last?.close ?? null;

      // 24h window for change, high, low, volume
      const slice24 = candles.slice(-24);
      const refOpen = slice24.length > 0 ? slice24[0].open : null;
      const change = price !== null && refOpen !== null ? price - refOpen : null;
      const changePct = change !== null && refOpen && refOpen > 0 ? (change / refOpen) * 100 : null;
      const high24h = slice24.length > 0 ? Math.max(...slice24.map((c) => c.high), price ?? -Infinity) : null;
      const low24h = slice24.length > 0 ? Math.min(...slice24.map((c) => c.low), price ?? Infinity) : null;
      const volume24h = slice24.length > 0 ? slice24.reduce((acc, c) => acc + c.volume, 0) : null;
      const atr14 = computeAtr(candles, 14);
      const vol = classifyVolatility(atr14, price);

      const status: DataStatus =
        price === null
          ? "UNAVAILABLE"
          : inst.provider === "hyperliquid"
            ? hlMids.status === "LIVE"
              ? "LIVE"
              : series.status
            : series.status;

      return {
        symbol: inst.symbol,
        name: inst.name,
        category: inst.category,
        decimals: inst.decimals,
        price,
        prevClose: refOpen,
        change,
        changePct,
        high24h: high24h !== null && Number.isFinite(high24h) ? high24h : null,
        low24h: low24h !== null && Number.isFinite(low24h) ? low24h : null,
        volume24h,
        atr14,
        volatilityPct: vol.pct,
        volatilityState: vol.state,
        source: inst.provider === "hyperliquid" ? `Hyperliquid (${inst.providerSymbol})` : `Yahoo (${inst.providerSymbol})`,
        providerSymbol: inst.providerSymbol,
        status,
        fetchedAt: series.fetchedAt,
        supportsOrderBook: inst.supportsOrderBook,
        isPrimary: inst.isPrimary,
      };
    } catch {
      return {
        symbol: inst.symbol,
        name: inst.name,
        category: inst.category,
        decimals: inst.decimals,
        price: null,
        prevClose: null,
        change: null,
        changePct: null,
        high24h: null,
        low24h: null,
        volume24h: null,
        atr14: null,
        volatilityPct: null,
        volatilityState: "UNAVAILABLE",
        source: inst.provider === "hyperliquid" ? "Hyperliquid" : "Yahoo Finance",
        providerSymbol: inst.providerSymbol,
        status: "UNAVAILABLE",
        fetchedAt: new Date().toISOString(),
        supportsOrderBook: inst.supportsOrderBook,
        isPrimary: inst.isPrimary,
      };
    }
  });

  const quotes = await Promise.all(quotePromises);
  const nowIso = new Date().toISOString();
  setCached(key, quotes, 15_000);
  return { quotes, fetchedAt: nowIso };
}

function classifyCalendarEvent(title: string, currency: string): {
  category: EconomicEvent["category"];
  isGoldSensitive: boolean;
} {
  const t = title.toLowerCase();
  let category: EconomicEvent["category"] = "General";
  if (/(fomc|fed |ecb|boe|boj|rba|rbnz|boc|snb|central bank|powell|lagarde|monetary policy|minutes)/.test(t)) {
    category = "Central Bank";
  } else if (/(interest rate|cash rate|rate statement|official bank rate|funds rate)/.test(t)) {
    category = "Rates";
  } else if (/(cpi|ppi|pce|inflation|price index)/.test(t)) {
    category = "Inflation";
  } else if (/(non-farm|nfp|payroll|unemployment|employment|jobless|claims|adp|jolts|earnings)/.test(t)) {
    category = "Employment";
  } else if (/(gdp|retail sales|pmi|ism|manufacturing|services|industrial|durable|trade balance)/.test(t)) {
    category = "Growth";
  } else if (/(confidence|sentiment|consumer|housing|home sales)/.test(t)) {
    category = "Sentiment";
  }

  const usdMacro =
    currency === "USD" &&
    ["Central Bank", "Rates", "Inflation", "Employment", "Growth"].includes(category);
  const majorCb = ["Central Bank", "Rates", "Inflation"].includes(category) && ["EUR", "GBP", "JPY", "CHF"].includes(currency);
  return { category, isGoldSensitive: usdMacro || majorCb };
}

export async function fetchEconomicCalendar(): Promise<EconomicCalendarResult> {
  const key = "forexfactory:thisweek";
  const hit = getCached<EconomicEvent[]>(key);
  if (hit && hit.fresh) {
    return {
      events: hit.value,
      source: "Forex Factory Weekly Feed",
      status: "LIVE",
      fetchedAt: hit.fetchedAt,
      cacheAgeSec: hit.ageSec,
    };
  }

  const t0 = Date.now();
  try {
    const res = await fetchWithRetry(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FREYR-Terminal/1.0)",
          Accept: "application/json",
        },
      },
      2,
      8000
    );
    const raw = (await res.json()) as Array<{
      title?: string;
      country?: string;
      date?: string;
      impact?: string;
      forecast?: string;
      previous?: string;
      actual?: string;
    }>;
    if (!Array.isArray(raw)) throw new Error("Malformed Forex Factory calendar payload");

    const events: EconomicEvent[] = raw
      .map((item, idx) => {
        const title = String(item.title ?? "").trim();
        const currency = String(item.country ?? "USD").toUpperCase();
        const dateIso = String(item.date ?? "");
        const ts = Date.parse(dateIso);
        if (!title || !Number.isFinite(ts)) return null;
        const impactRaw = String(item.impact ?? "Low");
        const impact: EconomicEvent["impact"] =
          impactRaw === "High" || impactRaw === "Medium" || impactRaw === "Holiday"
            ? impactRaw
            : "Low";
        const meta = classifyCalendarEvent(title, currency);
        return {
          id: `ff-${idx}-${currency}-${ts}`,
          title,
          currency,
          impact,
          dateIso,
          timestamp: ts,
          forecast: item.forecast?.trim() || "—",
          previous: item.previous?.trim() || "—",
          actual: item.actual?.trim() || "Pending",
          isGoldSensitive: meta.isGoldSensitive || (currency === "USD" && impact === "High"),
          category: meta.category,
        };
      })
      .filter((e): e is EconomicEvent => e !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    const nowIso = new Date().toISOString();
    setCached(key, events, 5 * 60_000);
    if (events.length > 0) g.__freyrLastCalendar = { events, fetchedAt: nowIso };
    updateHealth("forexfactory", {
      status: "LIVE",
      latencyMs: Date.now() - t0,
      lastSuccessAt: nowIso,
      lastError: null,
    });
    return {
      events,
      source: "Forex Factory Weekly Feed",
      status: "LIVE",
      fetchedAt: nowIso,
      cacheAgeSec: 0,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    const msg = /429/.test(raw)
      ? "Calendar provider is rate-limiting requests. Retrying automatically."
      : /50\d/.test(raw)
        ? "The calendar provider is temporarily unavailable."
        : raw || "Economic calendar temporarily unavailable";
    updateHealth("forexfactory", {
      status: hit ? "CACHED" : "UNAVAILABLE",
      lastError: msg,
    });
    if (hit) {
      return {
        events: hit.value,
        source: "Forex Factory Weekly Feed",
        status: "CACHED",
        fetchedAt: hit.fetchedAt,
        cacheAgeSec: hit.ageSec,
        error: `Displaying cached feed (${msg})`,
      };
    }
    // Keep the last verified schedule visible when the upstream feed is briefly unreachable.
    const lastGood = g.__freyrLastCalendar;
    if (lastGood?.events.length) {
      return {
        events: lastGood.events,
        source: "Forex Factory Weekly Feed",
        status: "CACHED",
        fetchedAt: lastGood.fetchedAt,
        cacheAgeSec: Math.max(0, Math.round((Date.now() - Date.parse(lastGood.fetchedAt)) / 1000)),
        error: "Showing the last cached schedule while the feed recovers.",
      };
    }
    return {
      events: [],
      source: "Forex Factory Weekly Feed",
      status: "UNAVAILABLE",
      fetchedAt: new Date().toISOString(),
      cacheAgeSec: 0,
      error: msg,
    };
  }
}

/**
 * Secondary calendar used only when Forex Factory is unavailable.
 * Importance is normalized to the same High/Medium scale; the response always names the source.
 */
export async function fetchFallbackCalendar(): Promise<EconomicCalendarResult> {
  const key = "tradingview:calendar";
  const hit = getCached<EconomicEvent[]>(key);
  if (hit && hit.fresh) {
    return { events: hit.value, source: "TradingView economic calendar (Forex Factory unavailable)", status: "CACHED", fetchedAt: hit.fetchedAt, cacheAgeSec: hit.ageSec };
  }
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
  try {
    const response = await fetchWithRetry(`https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US,EU,GB,JP,CA,AU,CH,NZ,CN`, {
      headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    }, 1, 8000);
    const payload = (await response.json()) as { result?: Array<{ id?: string; title?: string; currency?: string; date?: string; importance?: number; forecast?: number | null; previous?: number | null; actual?: number | null }> };
    const formatValue = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? String(value) : "—");
    const events: EconomicEvent[] = (payload.result ?? [])
      .filter((item) => item.importance !== -1 && item.title && item.date && item.currency)
      .map((item) => {
        const timestamp = Date.parse(String(item.date));
        const currency = String(item.currency ?? "").toUpperCase();
        const meta = classifyCalendarEvent(String(item.title), currency);
        return {
          id: `tv-${item.id ?? `${currency}-${timestamp}`}`, title: String(item.title).trim(), currency,
          impact: item.importance === 1 ? "High" : "Medium", dateIso: String(item.date), timestamp,
          forecast: formatValue(item.forecast), previous: formatValue(item.previous), actual: formatValue(item.actual),
          isGoldSensitive: meta.isGoldSensitive || currency === "USD", category: meta.category,
        } satisfies EconomicEvent;
      })
      .filter((event) => Number.isFinite(event.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (!events.length) throw new Error("Empty secondary calendar");
    const nowIso = new Date().toISOString();
    setCached(key, events, 10 * 60_000);
    return { events, source: "TradingView economic calendar (Forex Factory unavailable)", status: "DELAYED", fetchedAt: nowIso, cacheAgeSec: 0,
      error: "Forex Factory is rate-limiting requests; showing the secondary calendar." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Secondary calendar unavailable";
    if (hit) return { events: hit.value, source: "TradingView economic calendar", status: "CACHED", fetchedAt: hit.fetchedAt, cacheAgeSec: hit.ageSec, error: msg };
    return { events: [], source: "Calendar feeds", status: "UNAVAILABLE", fetchedAt: new Date().toISOString(), cacheAgeSec: 0, error: msg };
  }
}

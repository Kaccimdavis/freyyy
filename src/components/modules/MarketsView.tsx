"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Star } from "lucide-react";
import type { Candle, MarketQuote, OrderBookSnapshot, Timeframe } from "@/lib/market-data";
import type { LiquidityLevel, StructureEvent, ZoneBlock } from "@/lib/engines/liquidity";
import {
  Button,
  DataStatusBadge,
  ErrorBanner,
  Panel,
  PanelSkeleton,
  SegmentedControl,
  cn,
  formatDateTime,
  formatDataStatus,
  formatPct,
  formatPrice,
} from "@/components/ui/primitives";
import { CandlestickChart } from "@/components/charts/CandlestickChart";

interface MarketsPayload {
  instrument: { symbol: string; name: string; category: string; decimals: number; supportsOrderBook: boolean };
  quote: MarketQuote | null;
  quotes: MarketQuote[];
  watchlist: string[];
  timeframe: Timeframe;
  candles: Candle[];
  rangeHigh: number | null;
  rangeLow: number | null;
  source: string;
  status: string;
  fetchedAt: string;
  cacheAgeSec: number;
  error: string | null;
  orderBook: OrderBookSnapshot | null;
  overlays: {
    levels: LiquidityLevel[];
    zones: ZoneBlock[];
    events: StructureEvent[];
    pdh: number | null;
    pdl: number | null;
    pwh: number | null;
    pwl: number | null;
  };
  sessions: { currentLabel: string; utcTime: string };
}

type CategoryFilter = "WATCHLIST" | "ALL" | "GOLD" | "FOREX" | "INDICES" | "CRYPTO";

const TFS: Array<{ value: Timeframe; label: string }> = [
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

export function MarketsView({
  selectedSymbol,
  onSelectSymbol,
  timezone,
  defaultTimeframe,
  hollowCandles,
}: {
  selectedSymbol: string;
  onSelectSymbol: (sym: string) => void;
  timezone: string;
  defaultTimeframe: Timeframe;
  hollowCandles: boolean;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe || "15m");
  const [cat, setCat] = useState<CategoryFilter>("ALL");
  const [data, setData] = useState<MarketsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEma, setShowEma] = useState(true);
  const [showLiquidity, setShowLiquidity] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      try {
        setLoading((prev) => prev || !data);
        const res = await fetch(
          `/api/markets?symbol=${encodeURIComponent(selectedSymbol)}&tf=${timeframe}${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MarketsPayload = await res.json();
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load markets");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSymbol, timeframe]
  );

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(false), 18_000);
    return () => clearInterval(id);
  }, [load]);

  const toggleWatch = async (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, action: "toggle" }),
    });
    if (res.ok) {
      const j = await res.json();
      setData((prev) => (prev ? { ...prev, watchlist: j.watchlist } : prev));
    }
  };

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4"><PanelSkeleton rows={8} /></div>
        <div className="lg:col-span-8"><PanelSkeleton rows={8} height="h-[460px]" /></div>
      </div>
    );
  }
  if (error && !data) return <ErrorBanner message={error} onRetry={() => load(true)} />;
  if (!data) return null;

  const filteredQuotes = data.quotes.filter((q) => {
    if (cat === "WATCHLIST") return data.watchlist.includes(q.symbol);
    if (cat === "ALL") return true;
    return q.category === cat;
  });

  const dec = data.instrument.decimals;
  const q = data.quote;
  const isUp = (q?.changePct ?? 0) >= 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left: Market Watchlist (Gold pinned first) */}
      <div className="lg:col-span-4">
        <Panel
          title="Markets"
          subtitle={`${data.sessions.currentLabel} · ${data.sessions.utcTime}`}
          action={
            <button
              type="button"
              onClick={() => load(true)}
              aria-label="Refresh feeds"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/[0.08] bg-elevated text-ink-secondary hover:text-ink cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          }
          noPadding
        >
          <div className="flex flex-wrap gap-1 border-b border-ink/[0.06] px-3 py-2.5">
            {(["ALL", "WATCHLIST", "GOLD", "FOREX", "INDICES", "CRYPTO"] as CategoryFilter[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className="freyr-selectable rounded-md bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-secondary cursor-pointer"
              >
                {c === "WATCHLIST" ? "Watchlist" : c.charAt(0) + c.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="max-h-[560px] divide-y divide-ink/[0.04] overflow-y-auto">
            {filteredQuotes.length === 0 ? (
              <p className="p-6 text-center text-[12px] text-ink-secondary">
                Star any market to pin it to your watchlist.
              </p>
            ) : (
              filteredQuotes.map((item) => {
                const active = item.symbol === selectedSymbol;
                const watched = data.watchlist.includes(item.symbol);
                const pos = (item.changePct ?? 0) >= 0;
                return (
                  <div
                    key={item.symbol}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSymbol(item.symbol)}
                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelectSymbol(item.symbol); } }}
                    aria-pressed={active}
                    className="freyr-selectable mx-1 my-1 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2.5 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => toggleWatch(item.symbol, e)}
                        aria-label={`Toggle ${item.symbol} watchlist`}
                        aria-pressed={watched}
                        className="shrink-0 text-ink-tertiary cursor-pointer hover:text-ink"
                      >
                        <Star
                          className={cn(
                            "h-3.5 w-3.5",
                            watched && "fill-current text-ink"
                          )}
                        />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-[12.5px] font-medium",
                              item.isPrimary ? "text-ink-secondary" : "text-ink"
                            )}
                          >
                            {item.symbol}
                          </span>
                          {item.isPrimary && (
                            <span className="rounded bg-inset px-1 py-[1px] text-[9px] font-medium text-ink-secondary">
                              PRIMARY
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[10.5px] text-ink-tertiary">
                          {item.category} · {formatDataStatus(item.status)}
                        </p>
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      <div className="text-[12.5px] font-medium text-ink">
                        {formatPrice(item.price, item.decimals)}
                      </div>
                      <div
                        className={cn(
                          "text-[10.5px]",
                          item.changePct === null
                            ? "text-ink-secondary"
                            : pos
                              ? "text-bull"
                              : "text-bear"
                        )}
                      >
                        {item.changePct === null ? "—" : formatPct(item.changePct)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>
      </div>

      {/* Right: Interactive Candlestick Chart + Context Stats */}
      <div className="space-y-4 lg:col-span-8">
        <Panel noPadding>
          {/* Instrument header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/[0.06] px-4 py-3.5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  {data.instrument.symbol}
                </h2>
                <span className="text-[12px] text-ink-secondary">{data.instrument.name}</span>
                <DataStatusBadge status={data.status} />
              </div>
              <div className="mt-1 flex items-baseline gap-2.5 font-mono tabular-nums">
                <span className="text-[24px] font-semibold tracking-[-0.02em] text-ink">
                  {formatPrice(q?.price, dec)}
                </span>
                {q?.change !== null && q?.change !== undefined && (
                  <span className={cn("text-[12.5px] font-medium", isUp ? "text-bull" : "text-bear")}>
                    {q.change >= 0 ? "+" : ""}
                    {formatPrice(q.change, dec)} ({formatPct(q.changePct)})
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl options={TFS} value={timeframe} onChange={setTimeframe} ariaLabel="Chart timeframe" />
            </div>
          </div>

          {/* Subtle overlay toggle strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/[0.05] bg-surface px-4 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: "EMA 20/50", on: showEma, set: setShowEma },
                { label: "Liquidity Levels", on: showLiquidity, set: setShowLiquidity },
                { label: "FVG / OB Zones", on: showZones, set: setShowZones },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => t.set(!t.on)}
                  aria-pressed={t.on}
                  className="freyr-selectable rounded-md bg-surface px-2 py-1 text-[11.5px] text-ink-secondary cursor-pointer"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="text-[10.5px] text-ink-tertiary">
              Source: {data.source} · {data.candles.length} bars
            </div>
          </div>

          {data.error && (
            <div className="p-3">
              <ErrorBanner message={data.error} onRetry={() => load(true)} />
            </div>
          )}

          <CandlestickChart
            symbol={data.instrument.symbol}
            timeframe={timeframe}
            candles={data.candles}
            decimals={dec}
            height={380}
            timezone={timezone}
            showVolume
            showEma={showEma}
            hollowCandles={hollowCandles}
            levels={showLiquidity ? data.overlays.levels.slice(0, 10) : []}
            zones={showZones ? data.overlays.zones : []}
            events={showLiquidity ? data.overlays.events : []}
          />

          {/* Summary metric bar */}
          <div className="grid grid-cols-2 gap-px border-t border-ink/[0.06] bg-ink/[0.05] sm:grid-cols-4 font-mono text-[11.5px] tabular-nums">
            <div className="bg-surface px-4 py-2.5">
              <div className="font-sans text-[10px] text-ink-tertiary uppercase">24h High / Low</div>
              <div className="mt-0.5 text-ink">
                {formatPrice(q?.high24h, dec)} / {formatPrice(q?.low24h, dec)}
              </div>
            </div>
            <div className="bg-surface px-4 py-2.5">
              <div className="font-sans text-[10px] text-ink-tertiary uppercase">PDH / PDL</div>
              <div className="mt-0.5 text-ink-secondary">
                {formatPrice(data.overlays.pdh, dec)} / {formatPrice(data.overlays.pdl, dec)}
              </div>
            </div>
            <div className="bg-surface px-4 py-2.5">
              <div className="font-sans text-[10px] text-ink-tertiary uppercase">Volatility (ATR14)</div>
              <div className="mt-0.5 text-ink">
                {formatPrice(q?.atr14, dec)} · {q?.volatilityState ?? "—"}
              </div>
            </div>
            <div className="bg-surface px-4 py-2.5">
              <div className="font-sans text-[10px] text-ink-tertiary uppercase">24h Volume</div>
              <div className="mt-0.5 text-ink">
                {q?.volume24h && q.volume24h > 0
                  ? q.volume24h >= 1000
                    ? `${(q.volume24h / 1000).toFixed(2)}k`
                    : q.volume24h.toFixed(2)
                  : "Ref N/A"}
              </div>
            </div>
          </div>
        </Panel>

        {/* Bottom row: L2 top-of-book or historical OHLCV table */}
        <Panel
          title={showHistory ? `Historical OHLCV (${selectedSymbol} · ${timeframe.toUpperCase()})` : "Session Ranges & Historical Data"}
          subtitle={
            data.orderBook && data.orderBook.status !== "UNAVAILABLE"
              ? `Bid ${formatPrice(data.orderBook.bestBid, dec)} / Ask ${formatPrice(data.orderBook.bestAsk, dec)} · Spread ${data.orderBook.spread.toFixed(dec)}`
              : `Fetched ${formatDateTime(data.fetchedAt, timezone, { short: true })}`
          }
          action={
            <Button variant="secondary" size="sm" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide Candle Table" : "Historical Candles"}
            </Button>
          }
        >
          {showHistory ? (
            <div className="max-h-[260px] overflow-auto">
              <table className="w-full text-left font-mono text-[11px] tabular-nums">
                <thead className="sticky top-0 bg-surface text-[10px] font-sans text-ink-tertiary uppercase border-b border-ink/[0.06]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Time ({timezone})</th>
                    <th className="py-2 px-2 font-medium text-right">Open</th>
                    <th className="py-2 px-2 font-medium text-right">High</th>
                    <th className="py-2 px-2 font-medium text-right">Low</th>
                    <th className="py-2 px-2 font-medium text-right">Close</th>
                    <th className="py-2 pl-2 font-medium text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/[0.04]">
                  {[...data.candles].reverse().slice(0, 30).map((c) => (
                    <tr key={c.time} className="hover:bg-ink/[0.02]">
                      <td className="py-1.5 pr-3 text-ink-secondary">{formatDateTime(c.time, timezone, { short: true })}</td>
                      <td className="py-1.5 px-2 text-right text-ink">{formatPrice(c.open, dec)}</td>
                      <td className="py-1.5 px-2 text-right text-ink">{formatPrice(c.high, dec)}</td>
                      <td className="py-1.5 px-2 text-right text-ink">{formatPrice(c.low, dec)}</td>
                      <td className={cn("py-1.5 px-2 text-right font-medium", c.close >= c.open ? "text-bull" : "text-bear")}>
                        {formatPrice(c.close, dec)}
                      </td>
                      <td className="py-1.5 pl-2 text-right text-ink-secondary">{c.volume > 0 ? c.volume.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 font-mono text-[11.5px] tabular-nums">
              <div className="freyr-card px-3.5 py-2.5">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Visible Range High</div>
                <div className="mt-1 text-[14px] text-ink">{formatPrice(data.rangeHigh, dec)}</div>
              </div>
              <div className="freyr-card px-3.5 py-2.5">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Visible Range Low</div>
                <div className="mt-1 text-[14px] text-ink">{formatPrice(data.rangeLow, dec)}</div>
              </div>
              <div className="freyr-card px-3.5 py-2.5">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Prev Week High / Low</div>
                <div className="mt-1 text-[13px] text-ink-secondary">
                  {formatPrice(data.overlays.pwh, dec)} / {formatPrice(data.overlays.pwl, dec)}
                </div>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

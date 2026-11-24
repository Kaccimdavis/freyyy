"use client";

import { useEffect, useRef, useState } from "react";
import { DataStatusBadge, cn, formatPct, formatPrice } from "@/components/ui/primitives";

const MARKETS = [
  { symbol: "BTCUSD", label: "BTC/USD" },
  { symbol: "ETHUSD", label: "ETH/USD" },
  { symbol: "SOLUSD", label: "SOL/USD" },
  { symbol: "XRPUSD", label: "XRP/USD" },
  { symbol: "XAUUSD", label: "XAU/USD" },
] as const;

export interface MarketPulse {
  symbol: string;
  price: number | null;
  status: string;
  points: number[];
  low: number | null;
  high: number | null;
  decimals: number;
  changePct: number | null;
  rangeStatus?: string;
}

export function MarketWatch({ gold, revision, onOpen }: { gold: MarketPulse; revision: number; onOpen: (symbol: string) => void }) {
  const [position, setPosition] = useState(0);
  const [readings, setReadings] = useState<Record<string, MarketPulse | undefined>>({});
  const startX = useRef<number | null>(null);
  const ignoreClick = useRef(false);
  const { symbol, label } = MARKETS[position];

  useEffect(() => {
    if (symbol === "XAUUSD" && revision === 0) return;
    const controller = new AbortController();
    let fetching = false;
    async function load() {
      if (fetching || document.hidden) return;
      fetching = true;
      try {
        const response = await fetch(`/api/market-pulse?symbol=${symbol}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Market preview unavailable");
        const reading: MarketPulse = await response.json();
        if (!controller.signal.aborted) setReadings((prior) => ({ ...prior, [symbol]: reading }));
      } catch {
        if (!controller.signal.aborted) setReadings((prior) => ({ ...prior, [symbol]: { symbol, price: null, status: "UNAVAILABLE", points: [], low: null, high: null, decimals: 2, changePct: null } }));
      } finally { fetching = false; }
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [symbol, revision]);

  const quote = readings[symbol] ?? (symbol === "XAUUSD" ? gold : undefined);
  const points = quote?.points.filter(Number.isFinite) ?? [];
  const low = points.length ? Math.min(...points) : 0;
  const high = points.length ? Math.max(...points) : 0;
  const change = quote?.changePct ?? null;
  const rising = change === null ? points.at(-1)! >= points[0] : change >= 0;
  const line = points.map((value, index) => `${(3 + index * 115 / Math.max(1, points.length - 1)).toFixed(1)},${high === low ? 18 : (35 - (value - low) / (high - low) * 30).toFixed(1)}`).join(" ");
  const digits = Math.min(5, Math.max(2, quote?.decimals ?? 2));

  return <section className="freyr-panel p-3.5 sm:p-5" aria-label="Market watch" aria-roledescription="carousel" onKeyDown={(event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setPosition((index) => (index + (event.key === "ArrowRight" ? 1 : MARKETS.length - 1)) % MARKETS.length);
  }}>
    <button type="button" className="block w-full touch-pan-y rounded-lg text-left" aria-label={`Open ${label} in Markets`}
      onPointerDown={(event) => { startX.current = event.pointerType === "touch" ? event.clientX : null; ignoreClick.current = false; }}
      onPointerUp={(event) => {
        if (startX.current === null) return;
        const shift = event.clientX - startX.current;
        startX.current = null;
        if (Math.abs(shift) < 33) return;
        ignoreClick.current = true;
        setPosition((index) => (index + (shift < 0 ? 1 : MARKETS.length - 1)) % MARKETS.length);
      }}
      onPointerCancel={() => { startX.current = null; }}
      onClick={() => { if (!ignoreClick.current) onOpen(symbol); ignoreClick.current = false; }}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-bold tracking-tight text-ink sm:text-[16px]">{label}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {quote ? <DataStatusBadge status={quote.status} /> : <span className="text-[10px] text-ink-secondary">Loading quote…</span>}
          {change !== null && <span className={cn("rounded-full border px-2 py-[2px] text-[11px] font-semibold tabular-nums", rising ? "border-bull/30 bg-bull/8 text-bull" : "border-bear/30 bg-bear/8 text-bear")} title="24-hour change">{formatPct(change)}</span>}
        </span>
      </span>
      <span className="mt-2.5 flex items-end justify-between gap-2">
        <span className="whitespace-nowrap text-[clamp(20px,6vw,31px)] font-semibold leading-tight tracking-[-0.04em] tabular-nums text-ink">{formatPrice(quote?.price, digits)}</span>
        {points.length > 1 && <svg viewBox="0 0 121 39" className="freyr-sparkline h-9 w-[34%] max-w-40" role="img" aria-label={`Recent ${label} prices`}><polyline points={line} fill="none" stroke={rising ? "var(--freyr-positive)" : "var(--freyr-negative)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>}
      </span>
      <span className="mt-1.5 flex justify-between gap-2 text-[10.5px] tabular-nums text-ink-secondary sm:text-[12px]" aria-label="24-hour low and high"><span><span className="text-ink-tertiary">L</span> {formatPrice(quote?.low, digits)}</span><span><span className="text-ink-tertiary">H</span> {formatPrice(quote?.high, digits)}</span></span>
    </button>
    <div className="mt-1.5 flex items-center justify-center" aria-label="Preview a market">
      {MARKETS.map((market, index) => <button type="button" key={market.symbol} aria-label={`Preview ${market.label}`} aria-pressed={position === index} onClick={() => setPosition(index)} className="grid h-6 w-7 place-items-center rounded-md">
        <span className={cn("h-[5px] rounded-full", position === index ? "w-4 freyr-selection-dot" : "w-[5px] bg-outline")} />
      </button>)}
    </div>
  </section>;
}

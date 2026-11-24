"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ModFlowAnalysis } from "@/lib/engines/modflow";
import type { Candle, Timeframe } from "@/lib/market-data";
import {
  Button,
  DataStatusBadge,
  DirectionBadge,
  ErrorBanner,
  INPUT_CLS,
  KpiStat,
  Panel,
  PanelSkeleton,
  SegmentedControl,
  cn,
  formatDateTime,
  formatPrice,
} from "@/components/ui/primitives";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { DeltaCvdChart, VolumeProfileBars } from "@/components/charts/AnalyticsCharts";

interface ModFlowPayload {
  instrument: { symbol: string; name: string; decimals: number };
  candles: Candle[];
  analysis: ModFlowAnalysis;
  cacheAgeSec: number;
}

const FLOW_SYMBOLS = ["XAUUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
const FLOW_TFS: Array<{ value: Timeframe; label: string }> = [
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
];

export function ModFlowView({ timezone }: { timezone: string }) {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [tf, setTf] = useState<Timeframe>("15m");
  const [data, setData] = useState<ModFlowPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/modflow?symbol=${symbol}&tf=${tf}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ModFlow suite");
    } finally {
      setLoading(false);
    }
  }, [symbol, tf]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) return <PanelSkeleton rows={8} height="h-[460px]" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return null;

  const { analysis, instrument, candles } = data;
  const s = analysis.summary;
  const vp = analysis.volumeProfile;
  const ob = analysis.orderBook;
  const dec = instrument.decimals;

  const maxDepth = Math.max(
    ...ob.bids.slice(0, 12).map((b) => b.cumulative),
    ...ob.asks.slice(0, 12).map((a) => a.cumulative),
    1e-6
  );

  return (
    <div className="space-y-4">
      {/* Control Strip */}
      <Panel bodyClassName="py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Order flow instrument"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className={cn(INPUT_CLS, "h-8 w-36 font-mono")}
            >
              {FLOW_SYMBOLS.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}{sym === "XAUUSD" ? " (Gold)" : ""}
                </option>
              ))}
            </select>
            <SegmentedControl options={FLOW_TFS} value={tf} onChange={setTf} ariaLabel="ModFlow timeframe" />
            <DataStatusBadge status={analysis.status} label={`${analysis.status} · Tape`} />
            <DataStatusBadge status={analysis.orderBookStatus} label={`${analysis.orderBookStatus} · L2 Book`} />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-ink-secondary">{analysis.validatedBars} validated bars</span>
            <Button variant="secondary" size="sm" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
      </Panel>

      {/* Top Institutional Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiStat
          label="ModFlow Conf."
          value={s.setupConfirmation.replace("_", " ")}
          sub={`Bias: ${s.bias}`}
          tone={s.bias === "BULLISH" ? "bull" : s.bias === "BEARISH" ? "bear" : "gold"}
        />
        <KpiStat
          label="Session Delta"
          value={`${s.sessionDelta >= 0 ? "+" : ""}${s.sessionDelta.toFixed(2)}`}
          sub={`Imb ${s.volumeImbalancePct >= 0 ? "+" : ""}${s.volumeImbalancePct}%`}
          tone={s.sessionDelta >= 0 ? "bull" : "bear"}
        />
        <KpiStat
          label="CVD State"
          value={s.cvdSlope}
          sub={s.cvdDivergence === "NONE" ? `Cum ${s.cvdEnd.toFixed(1)}` : s.cvdDivergence.replace("_", " ")}
          tone={s.cvdDivergence !== "NONE" ? "gold" : s.cvdSlope === "RISING" ? "bull" : s.cvdSlope === "FALLING" ? "bear" : "neutral"}
        />
        <KpiStat
          label="Bid / Ask Book"
          value={ob.status !== "UNAVAILABLE" ? `${s.bidPressurePct}% / ${s.askPressurePct}%` : "N/A"}
          sub={ob.status !== "UNAVAILABLE" ? `Spread ${s.spread.toFixed(dec)}` : "Book offline"}
          tone={s.bookImbalancePct >= 6 ? "bull" : s.bookImbalancePct <= -6 ? "bear" : "neutral"}
        />
        <KpiStat
          label="Point of Control"
          value={formatPrice(vp.poc, dec)}
          sub={`VA ${formatPrice(vp.val, dec)}–${formatPrice(vp.vah, dec)}`}
          tone="gold"
        />
        <KpiStat
          label="Inst. Activity"
          value={`${s.institutionalScore}/100`}
          sub={`${s.absorptionCount} abs · ${s.exhaustionCount} exh`}
          tone={s.institutionalScore >= 65 ? "gold" : "neutral"}
        />
      </div>

      {/* Confirmation callout */}
      <div className="freyr-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <DirectionBadge direction={s.setupConfirmation} />
          <p className="text-[12.5px] text-ink">{s.confirmationText}</p>
        </div>
        <span className="font-mono text-[11px] text-ink-secondary tabular-nums">
          Location: {vp.priceLocation.replace(/_/g, " ")}
        </span>
      </div>

      {/* Main Layout: Price + Embedded Volume Profile + CVD / Right: L2 Order Book */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <Panel
            title={`${symbol} Price Action + Volume Profile (POC / VAH / VAL)`}
            subtitle={`VAH ${formatPrice(vp.vah, dec)} · POC ${formatPrice(vp.poc, dec)} · VAL ${formatPrice(vp.val, dec)}`}
            noPadding
          >
            <CandlestickChart
              symbol={symbol}
              timeframe={tf}
              candles={candles}
              decimals={dec}
              height={320}
              timezone={timezone}
              showVolume={false}
              volumeProfile={{
                buckets: vp.buckets,
                poc: vp.poc,
                vah: vp.vah,
                val: vp.val,
              }}
            />
          </Panel>

          <Panel
            title="Volume Delta & Cumulative Volume Delta (CVD)"
            subtitle="Gold markers pinpoint absorption and exhaustion footprints directly from validated candles"
          >
            <DeltaCvdChart bars={analysis.deltaBars} timezone={timezone} height={190} />
          </Panel>
        </div>

        {/* Right: Hyperliquid L2 Order Book + Aggression Balance */}
        <div className="space-y-4 lg:col-span-4">
          <Panel
            title="Order Book (L2 Depth)"
            subtitle={
              ob.status !== "UNAVAILABLE"
                ? `${ob.source} · Mid ${formatPrice(ob.midPrice, dec)}`
                : "Depth unavailable"
            }
          >
            {/* Aggression pressure meter */}
            <div className="mb-3 space-y-2">
              <div>
                <div className="mb-1 flex justify-between font-mono text-[10.5px] tabular-nums">
                  <span className="text-bull">Aggr. Buy {s.aggressiveBuyPct}%</span>
                  <span className="text-bear">Aggr. Sell {s.aggressiveSellPct}%</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div className="bg-bull" style={{ width: `${s.aggressiveBuyPct}%` }} />
                  <div className="bg-bear" style={{ width: `${s.aggressiveSellPct}%` }} />
                </div>
              </div>
              {ob.status !== "UNAVAILABLE" && (
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[10.5px] tabular-nums">
                    <span className="text-bull">Bid Vol {s.totalBidLiquidity.toFixed(2)}</span>
                    <span className="text-bear">Ask Vol {s.totalAskLiquidity.toFixed(2)}</span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className="bg-bull/75" style={{ width: `${s.bidPressurePct}%` }} />
                    <div className="bg-bear/75" style={{ width: `${s.askPressurePct}%` }} />
                  </div>
                </div>
              )}
            </div>

            {ob.status === "UNAVAILABLE" ? (
              <p className="py-8 text-center text-[12px] text-ink-secondary">{ob.error}</p>
            ) : (
              <div className="font-mono text-[11px] tabular-nums">
                <div className="grid grid-cols-3 border-b border-ink/[0.06] pb-1 font-sans text-[10px] text-ink-tertiary uppercase">
                  <span>Price</span>
                  <span className="text-right">Size</span>
                  <span className="text-right">Total</span>
                </div>

                {/* Asks (reverse so lowest ask meets spread) */}
                <div className="space-y-0.5 py-1">
                  {[...ob.asks.slice(0, 10)].reverse().map((a, idx) => (
                    <div key={`a-${idx}`} className="relative grid grid-cols-3 px-1 py-[2px] rounded-xs overflow-hidden">
                      <div
                        className="absolute inset-y-0 right-0 bg-bear/[0.11]"
                        style={{ width: `${(a.cumulative / maxDepth) * 100}%` }}
                      />
                      <span className="relative text-bear">{formatPrice(a.price, dec)}</span>
                      <span className="relative text-right text-ink">{a.size.toFixed(3)}</span>
                      <span className="relative text-right text-ink-secondary">{a.cumulative.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Spread bar */}
                <div className="my-1 flex items-center justify-between rounded bg-ink/[0.04] px-2 py-1 text-[10.5px]">
                  <span className="font-semibold text-ink-secondary">{formatPrice(ob.midPrice, dec)}</span>
                  <span className="text-ink-secondary">Spread {ob.spread.toFixed(dec)} ({ob.spreadBps.toFixed(2)} bps)</span>
                </div>

                {/* Bids */}
                <div className="space-y-0.5 py-1">
                  {ob.bids.slice(0, 10).map((b, idx) => (
                    <div key={`b-${idx}`} className="relative grid grid-cols-3 px-1 py-[2px] rounded-xs overflow-hidden">
                      <div
                        className="absolute inset-y-0 right-0 bg-bull/[0.11]"
                        style={{ width: `${(b.cumulative / maxDepth) * 100}%` }}
                      />
                      <span className="relative text-bull">{formatPrice(b.price, dec)}</span>
                      <span className="relative text-right text-ink">{b.size.toFixed(3)}</span>
                      <span className="relative text-right text-ink-secondary">{b.cumulative.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Bottom Row: Standalone Volume Profile + Absorption/Exhaustion Tape Events + Institutional Walls */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Panel
            title="Volume Profile Distribution"
            subtitle="70% Value Area expanded symmetrically from POC"
          >
            <VolumeProfileBars buckets={vp.buckets} decimals={dec} currentPrice={analysis.currentPrice} />
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-7">
          <Panel
            title="Absorption, Exhaustion & Aggressive Flow Log"
            subtitle="Automated footprint detection across validated candles"
          >
            {analysis.events.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-secondary">
                No exceptional absorption or exhaustion imbalance detected in current window.
              </p>
            ) : (
              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                {analysis.events.slice(0, 10).map((ev, i) => (
                  <div key={i} className="freyr-card flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <DirectionBadge direction={ev.side} />
                        <span className="text-[11.5px] font-medium text-ink">
                          {ev.type.replace(/_/g, " ")}
                        </span>
                        <span className="font-mono text-[11px] text-ink-secondary">
                          @{formatPrice(ev.price, dec)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-secondary">{ev.detail}</p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-ink-secondary">
                      {formatDateTime(ev.time, timezone, { timeOnly: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {analysis.walls.length > 0 && (
            <Panel title="Notable L2 Resting Liquidity Walls" subtitle="Orders ≥ 1.9× average level size">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-[11px] tabular-nums">
                {analysis.walls.slice(0, 4).map((w, i) => (
                  <div key={i} className="freyr-card px-2.5 py-2">
                    <div className={cn("text-[10px] font-medium", w.side === "BID" ? "text-bull" : "text-bear")}>
                      {w.side} WALL · {w.multipleOfAvg}×
                    </div>
                    <div className="mt-0.5 text-ink">{formatPrice(w.price, dec)}</div>
                    <div className="text-[10px] text-ink-secondary">Sz {w.size.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>

      {analysis.validationNotes.length > 0 && (
        <div className="rounded-xl border border-ink/[0.06] bg-surface px-4 py-2.5 text-[11px] text-ink-secondary">
          {analysis.validationNotes.join(" ")}
        </div>
      )}
    </div>
  );
}

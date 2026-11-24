"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { LiquidityAnalysis } from "@/lib/engines/liquidity";
import type { Candle, Timeframe } from "@/lib/market-data";
import {
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
  formatPct,
  formatPrice,
} from "@/components/ui/primitives";
import { CandlestickChart } from "@/components/charts/CandlestickChart";

interface LiquidityPayload {
  instrument: { symbol: string; name: string; decimals: number };
  timeframe: Timeframe;
  source: string;
  status: string;
  fetchedAt: string;
  candles: Candle[];
  analysis: LiquidityAnalysis;
}

const SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "US500", "NAS100", "BTCUSD", "ETHUSD", "SOLUSD"];
const TFS: Array<{ value: Timeframe; label: string }> = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
];

export function LiquidityView({ timezone }: { timezone: string }) {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [tf, setTf] = useState<Timeframe>("15m");
  const [data, setData] = useState<LiquidityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [layers, setLayers] = useState({
    pools: true,     // BSL, SSL, EQH, EQL, IDM
    daily: true,     // PDH/PDL, PWH/PWL
    sessions: true,  // Asian/London/NY H/L
    fvg: true,       // Fair Value Gaps
    blocks: true,    // Order, Breaker, Mitigation blocks
    events: true,    // BOS, CHoCH, Sweeps, Stop Hunts
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/liquidity?symbol=${symbol}&tf=${tf}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to map market liquidity");
    } finally {
      setLoading(false);
    }
  }, [symbol, tf]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading && !data) return <PanelSkeleton rows={8} height="h-[460px]" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return null;

  const { analysis, instrument, candles } = data;
  const dec = instrument.decimals;

  const visibleLevels = analysis.levels.filter((l) => {
    if (["BSL", "SSL", "EQH", "EQL", "IDM"].includes(l.kind)) return layers.pools;
    if (["PDH", "PDL", "PWH", "PWL"].includes(l.kind)) return layers.daily;
    if (l.kind.startsWith("ASIA_") || l.kind.startsWith("LDN_") || l.kind.startsWith("NY_")) return layers.sessions;
    return true;
  });

  const visibleZones = analysis.zones.filter((z) => {
    if (z.kind === "FVG") return layers.fvg;
    return layers.blocks;
  });

  const toggle = (k: keyof typeof layers) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="space-y-4">
      {/* Control strip */}
      <Panel bodyClassName="py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Liquidity instrument"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className={cn(INPUT_CLS, "h-8 w-36 font-mono")}
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}{s === "XAUUSD" ? " (Gold)" : ""}</option>
              ))}
            </select>
            <SegmentedControl options={TFS} value={tf} onChange={setTf} ariaLabel="Liquidity timeframe" />
            <DirectionBadge direction={analysis.trend} />
            <DataStatusBadge status={data.status} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["pools", "BSL/SSL/EQ"],
                ["daily", "PDH/PWH"],
                ["sessions", "Sessions"],
                ["fvg", "FVG"],
                ["blocks", "OB/Breaker"],
                ["events", "BOS/Sweep"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                aria-pressed={layers[k]}
                className="freyr-selectable rounded-md bg-surface px-2 py-1 text-[11.5px] font-medium text-ink-secondary cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiStat
          label="BSL / EQH"
          value={`${analysis.counts.bsl} / ${analysis.counts.equalHighs}`}
          sub={analysis.nearestBsl ? `Next ${formatPrice(analysis.nearestBsl.price, dec)}` : "Clear above"}
          tone="bear"
        />
        <KpiStat
          label="SSL / EQL"
          value={`${analysis.counts.ssl} / ${analysis.counts.equalLows}`}
          sub={analysis.nearestSsl ? `Next ${formatPrice(analysis.nearestSsl.price, dec)}` : "Clear below"}
          tone="bull"
        />
        <KpiStat
          label="Sweeps / Hunts"
          value={`${analysis.counts.sweeps} / ${analysis.counts.stopHunts}`}
          sub={analysis.liquidityCondition.replace("_", " ")}
          tone="gold"
        />
        <KpiStat
          label="BOS / CHoCH"
          value={`${analysis.counts.bosCount} / ${analysis.counts.chochCount}`}
          sub={`Bias: ${analysis.trend}`}
        />
        <KpiStat
          label="Open FVGs"
          value={analysis.counts.fvgs}
          sub="Unmitigated imbalances"
        />
        <KpiStat
          label="OB / BB / MB"
          value={`${analysis.counts.orderBlocks} / ${analysis.counts.breakerBlocks} / ${analysis.counts.mitigationBlocks}`}
          sub="Institutional blocks"
        />
      </div>

      {/* Main Annotated Liquidity Chart */}
      <Panel
        title={`${symbol} Institutional Liquidity Map (${tf.toUpperCase()})`}
        subtitle={analysis.structureBias}
        noPadding
      >
        <CandlestickChart
          symbol={symbol}
          timeframe={tf}
          candles={candles}
          decimals={dec}
          height={420}
          timezone={timezone}
          showVolume={false}
          levels={visibleLevels}
          zones={visibleZones}
          events={layers.events ? analysis.events : []}
        />
      </Panel>

      {/* Session Ranges (Asian / London / NY) + Reference Anchors */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Panel title="Session & Key Period Ranges" subtitle="PDH/PDL, PWH/PWL and intraday liquidity boxes">
            <div className="space-y-2 font-mono text-[11.5px] tabular-nums">
              <div className="freyr-card flex items-center justify-between px-3 py-2">
                <span className="font-sans text-ink-secondary">Previous Day (PDH / PDL)</span>
                <span className="text-ink-secondary">
                  {formatPrice(analysis.pdh, dec)} / {formatPrice(analysis.pdl, dec)}
                </span>
              </div>
              <div className="freyr-card flex items-center justify-between px-3 py-2">
                <span className="font-sans text-ink-secondary">Previous Week (PWH / PWL)</span>
                <span className="text-ink-secondary">
                  {formatPrice(analysis.pwh, dec)} / {formatPrice(analysis.pwl, dec)}
                </span>
              </div>
              {analysis.sessions.map((s) => (
                <div key={s.session} className="freyr-card px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-sans text-[12px] font-medium text-ink">{s.session} Session</span>
                    <span className="text-[10.5px] text-ink-secondary">
                      {s.range !== null ? `Rng ${formatPrice(s.range, dec)}` : "Pending"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className={s.sweptHigh ? "text-ink-secondary line-through" : "text-bear"}>
                      H: {formatPrice(s.high, dec)} {s.sweptHigh ? "(Swept)" : ""}
                    </span>
                    <span className={s.sweptLow ? "text-ink-secondary line-through" : "text-bull"}>
                      L: {formatPrice(s.low, dec)} {s.sweptLow ? "(Swept)" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="lg:col-span-7">
          <Panel title="Active Zones, Blocks & Recent Structure Events" subtitle="Fair Value Gaps, Order Blocks, Breaker & Mitigation Blocks">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-[10.5px] font-medium text-ink-secondary uppercase">Institutional Blocks & FVGs</div>
                <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1">
                  {analysis.zones.length === 0 ? (
                    <p className="py-4 text-[11.5px] text-ink-secondary">No clear unmitigated zones on current lookback.</p>
                  ) : (
                    analysis.zones.map((z) => (
                      <div key={z.id} className="freyr-card px-2.5 py-2 text-[11px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium text-ink">{z.label}</span>
                          <DirectionBadge direction={z.direction} />
                        </div>
                        <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] text-ink-secondary tabular-nums">
                          <span>
                            {formatPrice(z.low, dec)} – {formatPrice(z.high, dec)}
                          </span>
                          <span>{z.mitigated ? "Mitigated" : "Open"}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[10.5px] font-medium text-ink-secondary uppercase">Liquidity Events & Shifts</div>
                <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1">
                  {[...analysis.events].reverse().slice(0, 10).map((ev) => (
                    <div key={ev.id} className="freyr-card px-2.5 py-2 text-[11px]">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "font-medium",
                            ev.type === "SWEEP" || ev.type === "STOP_HUNT"
                              ? "text-ink-secondary"
                              : ev.direction === "BULLISH"
                                ? "text-bull"
                                : "text-bear"
                          )}
                        >
                          {ev.label}
                        </span>
                        <span className="font-mono text-[10px] text-ink-secondary">
                          {formatPrice(ev.price, dec)} · {formatDateTime(ev.time, timezone, { timeOnly: true })}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-ink-secondary line-clamp-2">{ev.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Complete Liquidity Level Table */}
      <Panel title="Detected Liquidity Levels Radar" subtitle="Sorted by proximity to spot price">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-[11.5px] tabular-nums">
            <thead className="border-b border-ink/[0.06] font-sans text-[10px] text-ink-tertiary uppercase">
              <tr>
                <th className="py-2 pr-3">Tag</th>
                <th className="py-2 px-2">Level Description</th>
                <th className="py-2 px-2">Side</th>
                <th className="py-2 px-2 text-right">Price</th>
                <th className="py-2 px-2 text-right">Distance</th>
                <th className="py-2 pl-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.04]">
              {[...analysis.levels]
                .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
                .slice(0, 14)
                .map((lv) => (
                  <tr key={lv.id} className="hover:bg-ink/[0.02]">
                    <td className="py-2 pr-3 font-semibold text-ink-secondary">{lv.shortLabel}</td>
                    <td className="py-2 px-2 font-sans text-ink">{lv.label}</td>
                    <td className={cn("py-2 px-2 text-[10.5px]", lv.side === "BUY_SIDE" ? "text-bear" : "text-bull")}>
                      {lv.side.replace("_", " ")}
                    </td>
                    <td className="py-2 px-2 text-right text-ink">{formatPrice(lv.price, dec)}</td>
                    <td className={cn("py-2 px-2 text-right", lv.distancePct >= 0 ? "text-ink-secondary" : "text-ink-secondary")}>
                      {formatPct(lv.distancePct, 2)}
                    </td>
                    <td className="py-2 pl-2 text-right font-sans text-[10.5px]">
                      <span className={lv.swept ? "text-ink-secondary" : "text-bull"}>
                        {lv.swept ? "Swept" : "Intact Pool"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

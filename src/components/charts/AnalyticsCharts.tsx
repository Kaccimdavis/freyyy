"use client";

import React, { useState } from "react";
import type { DeltaBar, VolumeProfileBucket } from "@/lib/engines/modflow";
import { formatCurrency, formatDateTime, formatPrice } from "@/components/ui/primitives";

/** Clean interactive Volume Delta + Cumulative Volume Delta (CVD) visualization for ModFlow */
export function DeltaCvdChart({
  bars,
  timezone = "UTC",
  height = 200,
}: {
  bars: DeltaBar[];
  timezone?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const data = bars.slice(-64);
  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[12px] text-ink-secondary">
        No validated order flow delta bars available.
      </div>
    );
  }

  const W = 720;
  const H = height;
  const padL = 10;
  const padR = 54;
  const padT = 14;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const midY = padT + plotH * 0.55;

  const maxAbsD = Math.max(...data.map((d) => Math.abs(d.delta)), 1e-6);
  const cvds = data.map((d) => d.cvd);
  const minCvd = Math.min(...cvds);
  const maxCvd = Math.max(...cvds);
  const cvdRange = Math.max(maxCvd - minCvd, 1e-6);

  const step = plotW / data.length;
  const cvdPts = data
    .map((d, i) => {
      const x = padL + (i + 0.5) * step;
      const y = padT + ((maxCvd - d.cvd) / cvdRange) * (plotH - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const active = hover !== null ? data[hover] : data[data.length - 1];

  return (
    <div className="relative">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
        <div className="flex items-center gap-3 text-ink-secondary">
          <span>{formatDateTime(active.time, timezone, { short: true })}</span>
          <span>
            Delta{" "}
            <span className={active.delta >= 0 ? "text-bull" : "text-bear"}>
              {active.delta >= 0 ? "+" : ""}
              {active.delta.toFixed(2)}
            </span>
          </span>
          <span>
            CVD <span className="text-ink-secondary">{active.cvd >= 0 ? "+" : ""}{active.cvd.toFixed(2)}</span>
          </span>
          <span>
            Imb <span className="text-ink">{active.imbalancePct > 0 ? "+" : ""}{active.imbalancePct}%</span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-ink-secondary">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-bull/70" /> +Delta
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-xs bg-bear/70" /> −Delta
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 bg-ink-secondary" /> CVD
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full overflow-visible"
        style={{ height }}
        role="img"
        aria-label="Volume Delta histogram and Cumulative Volume Delta line chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.floor((x - padL) / step);
          if (idx >= 0 && idx < data.length) setHover(idx);
        }}
      >
        {/* Zero line */}
        <line x1={padL} x2={padL + plotW} y1={midY} y2={midY} stroke="var(--freyr-line)" strokeDasharray="3 3" />

        {/* Delta bars */}
        {data.map((d, i) => {
          const x = padL + i * step + step * 0.16;
          const bw = Math.max(1.8, step * 0.68);
          const bh = (Math.abs(d.delta) / maxAbsD) * (plotH * 0.42);
          const y = d.delta >= 0 ? midY - bh : midY;
          const isHov = hover === i;
          return (
            <g key={d.time}>
              <rect
                x={x}
                y={y}
                width={bw}
                height={Math.max(1, bh)}
                rx={1}
                fill={d.delta >= 0 ? (isHov ? "var(--freyr-positive)" : "rgba(48,209,88,0.52)") : isHov ? "var(--freyr-negative)" : "rgba(255,69,58,0.52)"}
              />
              {(d.absorption || d.exhaustion) && (
                <circle
                  cx={x + bw / 2}
                  cy={d.delta >= 0 ? Math.max(padT + 3, y - 5) : Math.min(H - padB - 3, y + bh + 5)}
                  r={2.5}
                  fill="var(--freyr-muted)"
                />
              )}
            </g>
          );
        })}

        {/* CVD curve */}
        <polyline
          fill="none"
          stroke="var(--freyr-muted)"
          strokeWidth={1.7}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={cvdPts}
        />

        {/* Right CVD bounds */}
        <text x={padL + plotW + 6} y={padT + 8} fill="var(--freyr-muted)" fontSize="9.5" fontFamily="monospace">
          {maxCvd >= 0 ? "+" : ""}
          {maxCvd.toFixed(1)}
        </text>
        <text x={padL + plotW + 6} y={midY + 3} fill="var(--freyr-quiet)" fontSize="9.5" fontFamily="monospace">
          0.0
        </text>
        <text x={padL + plotW + 6} y={H - padB} fill="var(--freyr-muted)" fontSize="9.5" fontFamily="monospace">
          {minCvd >= 0 ? "+" : ""}
          {minCvd.toFixed(1)}
        </text>
      </svg>
    </div>
  );
}

/** Horizontal Volume Profile ladder displaying POC, VAH, VAL, and Buy vs Sell stack */
export function VolumeProfileBars({
  buckets,
  decimals = 2,
  currentPrice,
}: {
  buckets: VolumeProfileBucket[];
  decimals?: number;
  currentPrice: number;
}) {
  if (!buckets.length) {
    return <p className="py-6 text-center text-[12px] text-ink-secondary">Volume profile unavailable.</p>;
  }
  const ordered = [...buckets].reverse(); // Highest price top -> lowest bottom
  const maxV = Math.max(...ordered.map((b) => b.totalVolume), 1e-9);

  return (
    <div className="space-y-1 font-mono text-[10.5px] tabular-nums" role="img" aria-label="Volume profile distribution with Point of Control and Value Area">
      {ordered.map((b, i) => {
        const buyW = (b.buyVolume / maxV) * 100;
        const sellW = (b.sellVolume / maxV) * 100;
        const nearSpot = currentPrice >= b.priceLow && currentPrice <= b.priceHigh;
        return (
          <div
            key={i}
            className={`flex items-center gap-2 rounded px-1.5 py-[2px] ${
              b.isPoc
                ? "bg-inset ring-1 ring-outline"
                : nearSpot
                  ? "bg-ink/[0.06]"
                  : ""
            }`}
          >
            <span
              className={`w-[68px] shrink-0 text-right ${
                b.isPoc ? "font-semibold text-ink-secondary" : b.inValueArea ? "text-ink-secondary" : "text-ink-tertiary"
              }`}
            >
              {formatPrice(b.priceMid, decimals)}
            </span>
            <div className="flex h-[10px] flex-1 items-center overflow-hidden rounded-[2px] bg-ink/[0.03]">
              <div
                style={{ width: `${buyW}%` }}
                className={`h-full ${b.isPoc ? "bg-ink-secondary" : b.inValueArea ? "bg-bull/62" : "bg-bull/28"}`}
              />
              <div
                style={{ width: `${sellW}%` }}
                className={`h-full ${b.isPoc ? "bg-inset" : b.inValueArea ? "bg-bear/56" : "bg-bear/25"}`}
              />
            </div>
            <span className="w-[40px] shrink-0 text-right text-[9.5px] text-ink-tertiary">
              {b.isPoc ? "POC" : b.delta >= 0 ? `+${b.delta.toFixed(1)}` : b.delta.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Interactive monochrome/semantic Apple-style Equity Curve + Drawdown SVG chart */
export function EquityCurveChart({
  points,
  mode = "equity",
  height = 220,
}: {
  points: Array<{ time: number; label?: string; equity: number; drawdownPct: number }>;
  mode?: "equity" | "drawdown";
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-[12px] text-ink-secondary">
        Execute or record at least two trades to display curve progression.
      </div>
    );
  }

  const W = 720;
  const H = height;
  const padL = 12;
  const padR = 72;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const vals = points.map((p) => (mode === "equity" ? p.equity : -p.drawdownPct));
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const pad = Math.max((rawMax - rawMin) * 0.1, mode === "drawdown" ? 0.5 : 100);
  const minV = mode === "drawdown" ? Math.min(rawMin - pad * 0.4, -0.5) : rawMin - pad;
  const maxV = mode === "drawdown" ? 0 : rawMax + pad;
  const range = Math.max(maxV - minV, 1e-6);

  const coords = vals.map((v, i) => ({
    x: padL + (i / (vals.length - 1)) * plotW,
    y: padT + ((maxV - v) / range) * plotH,
  }));
  const lineD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const baselineY = mode === "drawdown" ? padT : padT + plotH;
  const areaD = `${lineD} L${coords[coords.length - 1].x.toFixed(1)},${baselineY} L${coords[0].x.toFixed(1)},${baselineY} Z`;

  const netPositive = mode === "equity" && points[points.length - 1].equity >= points[0].equity;
  const stroke = mode === "drawdown" ? "var(--freyr-negative)" : netPositive ? "var(--freyr-positive)" : "var(--freyr-negative)";
  const gradId = `freyr-grad-${mode}-${points.length}`;
  const active = hover !== null ? points[hover] : points[points.length - 1];
  const activeCoord = hover !== null ? coords[hover] : coords[coords.length - 1];

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-ink-secondary">
        <span>
          {active.label ?? new Date(active.time).toISOString().slice(0, 10)}
        </span>
        <span className={mode === "drawdown" ? "text-bear" : netPositive ? "text-bull" : "text-bear"}>
          {mode === "equity" ? formatCurrency(active.equity) : `-${active.drawdownPct.toFixed(2)}% DD`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={mode === "equity" ? "Account equity curve chart" : "Account drawdown chart"}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - rect.left) / rect.width;
          const x = rel * W;
          const idx = Math.round(((x - padL) / plotW) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={mode === "drawdown" ? "0.06" : "0.22"} />
            <stop offset="100%" stopColor={stroke} stopOpacity={mode === "drawdown" ? "0.24" : "0.0"} />
          </linearGradient>
        </defs>
        {[0, 0.33, 0.66, 1].map((r, i) => {
          const y = padT + r * plotH;
          const v = maxV - r * range;
          return (
            <g key={i}>
              <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke="var(--freyr-line)" />
              <text x={padL + plotW + 6} y={y + 3} fill="var(--freyr-muted)" fontSize="9.5" fontFamily="monospace">
                {mode === "equity" ? `$${Math.round(v).toLocaleString()}` : `${v.toFixed(1)}%`}
              </text>
            </g>
          );
        })}
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={lineD} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
        {hover !== null && (
          <>
            <line
              x1={activeCoord.x}
              x2={activeCoord.x}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--freyr-quiet)"
              strokeDasharray="3 3"
            />
            <circle cx={activeCoord.x} cy={activeCoord.y} r={3.8} fill={stroke} stroke="var(--freyr-surface)" strokeWidth={1.5} />
          </>
        )}
      </svg>
    </div>
  );
}

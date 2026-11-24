"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import type { Candle } from "@/lib/market-data";
import type { LiquidityLevel, StructureEvent, ZoneBlock } from "@/lib/engines/liquidity";
import type { VolumeProfileBucket } from "@/lib/engines/modflow";
import { formatDateTime, formatPrice } from "@/components/ui/primitives";

export interface SignalGuideLines {
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  direction?: "BUY" | "SELL";
}

interface CandlestickChartProps {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  decimals?: number;
  height?: number;
  timezone?: string;
  showVolume?: boolean;
  showEma?: boolean;
  hollowCandles?: boolean;
  levels?: LiquidityLevel[];
  zones?: ZoneBlock[];
  events?: StructureEvent[];
  volumeProfile?: {
    buckets: VolumeProfileBucket[];
    poc: number;
    vah: number;
    val: number;
  };
  signalLines?: SignalGuideLines;
  expandable?: boolean;
}

function alpha(color: string, opacity: number) {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${Math.round(opacity * 255).toString(16).padStart(2, "0")}` : color;
}

function plotWidth(width: number, decimals: number) {
  const axis = width < 275 ? (decimals >= 4 ? 62 : 55) : (decimals >= 4 ? 76 : 70);
  return { axis, size: Math.max(28, width - axis - 10) };
}

function calcEmaSeries(candles: Candle[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  if (candles.length === 0) return out;
  const k = 2 / (period + 1);
  let ema: number | null = null;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    if (i < period - 1) {
      sum += c;
      out.push(null);
    } else if (i === period - 1) {
      sum += c;
      ema = sum / period;
      out.push(ema);
    } else {
      ema = c * k + (ema ?? c) * (1 - k);
      out.push(ema);
    }
  }
  return out;
}

export function CandlestickChart({
  symbol,
  timeframe,
  candles,
  decimals = 2,
  height = 360,
  timezone = "UTC",
  showVolume = true,
  showEma = false,
  hollowCandles = false,
  levels = [],
  zones = [],
  events = [],
  volumeProfile,
  signalLines,
  expandable = true,
}: CandlestickChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 720, height });
  const [expanded, setExpanded] = useState(false);
  const [appearance, setAppearance] = useState("dark");
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setAppearance(root.dataset.theme ?? "dark");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const [visibleCount, setVisibleCount] = useState(76);
  const [offsetRight, setOffsetRight] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startOffset: number }>({
    active: false,
    startX: 0,
    startOffset: 0,
  });

  const activeHeight = expanded ? 560 : height;

  useEffect(() => {
    setOffsetRight(0);
    setVisibleCount(Math.min(Math.max(40, candles.length), 84));
  }, [symbol, timeframe, candles.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 80) setSize({ width: Math.floor(w), height: activeHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeHeight]);

  const ema20 = useMemo(() => (showEma ? calcEmaSeries(candles, 20) : []), [candles, showEma]);
  const ema50 = useMemo(() => (showEma ? calcEmaSeries(candles, 50) : []), [candles, showEma]);

  const view = useMemo(() => {
    const total = candles.length;
    if (total === 0) return { slice: [] as Candle[], start: 0, end: 0 };
    const count = Math.min(total, Math.max(18, visibleCount));
    const maxOff = Math.max(0, total - count);
    const off = Math.min(maxOff, Math.max(0, offsetRight));
    const end = total - off;
    const start = Math.max(0, end - count);
    return { slice: candles.slice(start, end), start, end };
  }, [candles, visibleCount, offsetRight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size.width;
    const H = activeHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const tokens = getComputedStyle(document.documentElement);
    const token = (name: string) => tokens.getPropertyValue(`--freyr-${name}`).trim();
    const palette = { surface: token("surface"), inset: token("inset"), ink: token("ink"), quiet: token("quiet"), muted: token("muted"), line: token("line"), bull: token("positive"), bear: token("negative") };
    const onMarket = appearance === "light" ? "#fff" : "#09090a";
    ctx.fillStyle = palette.surface;
    ctx.fillRect(0, 0, W, H);

    const bars = view.slice;
    if (bars.length === 0) return;

    const geometry = plotWidth(W, decimals);
    const axisRightW = geometry.axis;
    const axisBottomH = 26;
    const padTop = 14;
    const padLeft = 10;
    const volH = showVolume && bars.some((b) => b.volume > 0) ? Math.min(54, H * 0.16) : 0;
    const plotW = geometry.size;
    const plotH = Math.max(80, H - axisBottomH - padTop - volH - (volH > 0 ? 8 : 0));

    // Calculate visible Y range including tight signal guides
    let minP = Infinity;
    let maxP = -Infinity;
    for (const b of bars) {
      if (b.low < minP) minP = b.low;
      if (b.high > maxP) maxP = b.high;
    }
    if (signalLines) {
      for (const v of [signalLines.entry, signalLines.stopLoss, signalLines.takeProfit]) {
        if (typeof v === "number" && Number.isFinite(v) && Math.abs(v - bars[bars.length - 1].close) < (maxP - minP) * 2.5) {
          minP = Math.min(minP, v);
          maxP = Math.max(maxP, v);
        }
      }
    }
    const span = Math.max(maxP - minP, minP * 0.0005, 1e-6);
    const pLow = minP - span * 0.08;
    const pHigh = maxP + span * 0.08;
    const pRange = pHigh - pLow;

    const yOf = (price: number) => padTop + ((pHigh - price) / pRange) * plotH;
    const stepX = plotW / bars.length;
    const xOf = (idx: number) => padLeft + (idx + 0.5) * stepX;

    // 1. Subtle hairline horizontal gridlines
    const gridRows = H <= 155 ? 3 : 5;
    ctx.font = '500 10.5px "SF Mono", ui-monospace, monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= gridRows; i++) {
      const ratio = i / gridRows;
      const y = Math.round(padTop + ratio * plotH) + 0.5;
      const price = pHigh - ratio * pRange;
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = palette.muted;
      ctx.fillText(formatPrice(price, decimals), padLeft + plotW + 7, y);
    }

    // Divider line for right price axis
    ctx.strokeStyle = palette.line;
    ctx.beginPath();
    ctx.moveTo(padLeft + plotW + 0.5, 0);
    ctx.lineTo(padLeft + plotW + 0.5, H - axisBottomH);
    ctx.stroke();

    // 2. Optional integrated Volume Profile histogram on left edge
    if (volumeProfile && volumeProfile.buckets.length > 0) {
      const maxBucketVol = Math.max(...volumeProfile.buckets.map((b) => b.totalVolume), 1e-9);
      const maxBarW = Math.min(plotW * 0.22, 115);

      // Value area shaded background band
      const yVah = Math.max(padTop, Math.min(padTop + plotH, yOf(volumeProfile.vah)));
      const yVal = Math.max(padTop, Math.min(padTop + plotH, yOf(volumeProfile.val)));
      ctx.fillStyle = alpha(palette.ink, 0.035);
      ctx.fillRect(padLeft, Math.min(yVah, yVal), plotW, Math.abs(yVal - yVah));

      for (const b of volumeProfile.buckets) {
        if (b.priceHigh < pLow || b.priceLow > pHigh) continue;
        const y1 = Math.max(padTop, yOf(b.priceHigh));
        const y2 = Math.min(padTop + plotH, yOf(b.priceLow));
        const bh = Math.max(1.5, y2 - y1 - 1);
        const bw = (b.totalVolume / maxBucketVol) * maxBarW;
        ctx.fillStyle = b.isPoc
          ? alpha(palette.ink, 0.42)
          : b.inValueArea
            ? alpha(palette.ink, 0.12)
            : alpha(palette.ink, 0.05);
        ctx.fillRect(padLeft, y1, bw, bh);
      }

      // POC dashed gold line
      if (volumeProfile.poc >= pLow && volumeProfile.poc <= pHigh) {
        const py = Math.round(yOf(volumeProfile.poc)) + 0.5;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = alpha(palette.ink, 0.72);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, py);
        ctx.lineTo(padLeft + plotW, py);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = palette.ink;
        ctx.font = '600 9.5px "SF Mono", monospace';
        ctx.fillText(`POC`, padLeft + 6, py - 7);
      }
    }

    // 3. Liquidity & Structure Zones (FVGs, Order Blocks, Breaker Blocks, Mitigation Blocks)
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, plotW, plotH);
    ctx.clip();

    for (const z of zones) {
      if (z.high < pLow || z.low > pHigh) continue;
      const yTop = yOf(z.high);
      const yBot = yOf(z.low);
      const zh = Math.max(3, yBot - yTop);
      const startIdx = bars.findIndex((b) => b.time >= z.startTime);
      const sx = startIdx >= 0 ? Math.max(padLeft, xOf(startIdx)) : padLeft;
      const isBull = z.direction === "BULLISH";
      const isFvg = z.kind === "FVG";
      const isBreaker = z.kind === "BREAKER_BLOCK";

      ctx.fillStyle = isBreaker
        ? alpha(palette.ink, 0.09)
        : isBull
          ? isFvg
            ? alpha(palette.bull, 0.085)
            : alpha(palette.bull, 0.12)
          : isFvg
            ? alpha(palette.bear, 0.085)
            : alpha(palette.bear, 0.12);
      ctx.fillRect(sx, yTop, padLeft + plotW - sx, zh);

      ctx.strokeStyle = isBreaker
        ? alpha(palette.ink, 0.32)
        : isBull
          ? alpha(palette.bull, 0.30)
          : alpha(palette.bear, 0.30);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(sx + 0.5, yTop + 0.5, padLeft + plotW - sx - 1, Math.max(2, zh - 1));

      if (zh >= 9) {
        ctx.font = '500 9px system-ui, sans-serif';
        ctx.fillStyle = isBreaker ? alpha(palette.ink, 0.8) : isBull ? alpha(palette.bull, 0.8) : alpha(palette.bear, 0.82);
        ctx.textAlign = "right";
        ctx.fillText(z.label.toUpperCase(), padLeft + plotW - 6, yTop + Math.min(zh / 2, 10));
        ctx.textAlign = "left";
      }
    }

    // 4. Horizontal Liquidity Price Levels (BSL/SSL/EQH/EQL/PDH/PDL/Sessions/IDM)
    const placedLabelsY: number[] = [];
    for (const lv of levels) {
      if (lv.price < pLow || lv.price > pHigh) continue;
      const y = Math.round(yOf(lv.price)) + 0.5;
      const color =
        lv.kind === "PDH" || lv.kind === "PDL" || lv.kind === "PWH" || lv.kind === "PWL"
          ? alpha(palette.ink, 0.62)
          : lv.side === "BUY_SIDE"
            ? alpha(palette.bear, 0.45)
            : alpha(palette.bull, 0.45);
      ctx.save();
      ctx.setLineDash(lv.priority === "HIGH" ? [5, 4] : [2, 4]);
      ctx.strokeStyle = lv.swept ? alpha(palette.ink, 0.18) : color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.restore();

      // Avoid overlapping micro badges
      if (!placedLabelsY.some((py) => Math.abs(py - y) < 13)) {
        placedLabelsY.push(y);
        const tag = `${lv.shortLabel} ${formatPrice(lv.price, decimals)}`;
        ctx.font = '500 9.5px "SF Mono", monospace';
        const tw = ctx.measureText(tag).width + 8;
        ctx.fillStyle = alpha(palette.surface, 0.88);
        ctx.fillRect(padLeft + 6, y - 8, tw, 15);
        ctx.fillStyle = lv.swept
          ? palette.quiet
          : lv.kind === "PDH" || lv.kind === "PDL" || lv.kind === "PWH" || lv.kind === "PWL"
            ? palette.ink
            : lv.side === "BUY_SIDE"
              ? palette.bear
              : palette.bull;
        ctx.fillText(tag, padLeft + 10, y);
      }
    }

    // 5. Optional EMA20 / EMA50 overlays
    const drawLine = (series: Array<number | null>, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < bars.length; i++) {
        const val = series[view.start + i];
        if (val === null || val === undefined) continue;
        const x = xOf(i);
        const y = yOf(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };
    if (showEma && ema20.length) {
      drawLine(ema20, alpha(palette.ink, 0.78));
      drawLine(ema50, alpha(palette.ink, 0.36));
    }

    // 6. Optional Signal Levels (Entry / SL / TP)
    if (signalLines) {
      const guides: Array<{ p?: number; label: string; color: string }> = [
        { p: signalLines.entry, label: "ENTRY", color: palette.ink },
        { p: signalLines.stopLoss, label: "SL", color: palette.bear },
        { p: signalLines.takeProfit, label: "TP", color: palette.bull },
      ];
      for (const g of guides) {
        if (typeof g.p !== "number" || g.p < pLow || g.p > pHigh) continue;
        const y = Math.round(yOf(g.p)) + 0.5;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = g.color;
        ctx.font = '600 9.5px "SF Mono", monospace';
        ctx.fillText(`${g.label} ${formatPrice(g.p, decimals)}`, padLeft + plotW - 110, y - 7);
      }
    }

    // 7. Candlesticks (Apple dark precision green/red)
    const bodyW = Math.max(2, Math.min(11, stepX * 0.64));
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const bull = b.close >= b.open;
      const color = bull ? palette.bull : palette.bear;
      const cx = Math.round(xOf(i)) + 0.5;
      const yH = yOf(b.high);
      const yL = yOf(b.low);
      const yO = yOf(b.open);
      const yC = yOf(b.close);
      const top = Math.min(yO, yC);
      const bh = Math.max(1.5, Math.abs(yC - yO));

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yH);
      ctx.lineTo(cx, yL);
      ctx.stroke();

      // Body
      const bx = Math.round(xOf(i) - bodyW / 2);
      if (hollowCandles && bull) {
        ctx.fillStyle = palette.surface;
        ctx.fillRect(bx, top, bodyW, bh);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1;
        ctx.strokeRect(bx + 0.5, top + 0.5, Math.max(1, bodyW - 1), Math.max(1, bh - 1));
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(bx, top, bodyW, bh);
      }
    }

    // 8. Structure markers (BOS / CHOCH / SWEEP / STOP_HUNT)
    for (const ev of events) {
      const idx = bars.findIndex((b) => Math.abs(b.time - ev.time) < 60_000 || b.time >= ev.time);
      if (idx < 0 || idx >= bars.length) continue;
      if (ev.price < pLow || ev.price > pHigh) continue;
      const x = xOf(idx);
      const isBull = ev.direction === "BULLISH";
      const y = isBull ? Math.min(padTop + plotH - 8, yOf(bars[idx].low) + 12) : Math.max(padTop + 10, yOf(bars[idx].high) - 12);
      const txt =
        ev.type === "CHOCH"
          ? "CHoCH"
          : ev.type === "BOS"
            ? "BOS"
            : ev.type === "STOP_HUNT"
              ? "HUNT"
              : "SWP";
      ctx.font = '600 8.5px system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 6;
      const bg =
        ev.type === "SWEEP" || ev.type === "STOP_HUNT"
          ? alpha(palette.ink, 0.22)
          : isBull
            ? alpha(palette.bull, 0.18)
            : alpha(palette.bear, 0.18);
      const fg =
        ev.type === "SWEEP" || ev.type === "STOP_HUNT"
          ? palette.ink
          : isBull
            ? palette.bull
            : palette.bear;
      ctx.fillStyle = bg;
      ctx.fillRect(x - w / 2, y - 6, w, 12);
      ctx.fillStyle = fg;
      ctx.textAlign = "center";
      ctx.fillText(txt, x, y);
      ctx.textAlign = "left";
    }

    ctx.restore();

    // 9. Volume histogram subplot
    if (volH > 0) {
      const volTop = padTop + plotH + 8;
      const maxVol = Math.max(...bars.map((b) => b.volume), 1e-9);
      ctx.strokeStyle = palette.line;
      ctx.beginPath();
      ctx.moveTo(padLeft, volTop - 3.5);
      ctx.lineTo(padLeft + plotW, volTop - 3.5);
      ctx.stroke();

      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const vh = Math.max(1, (b.volume / maxVol) * (volH - 4));
        const bull = b.close >= b.open;
        ctx.fillStyle = bull ? alpha(palette.bull, 0.32) : alpha(palette.bear, 0.32);
        ctx.fillRect(Math.round(xOf(i) - bodyW / 2), volTop + volH - vh, bodyW, vh);
      }
    }

    // 10. Current last-price badge on right price axis
    const last = bars[bars.length - 1];
    if (last && last.close >= pLow && last.close <= pHigh) {
      const ly = Math.round(yOf(last.close)) + 0.5;
      const up = last.close >= last.open;
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = up ? alpha(palette.bull, 0.55) : alpha(palette.bear, 0.55);
      ctx.beginPath();
      ctx.moveTo(padLeft, ly);
      ctx.lineTo(padLeft + plotW, ly);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = up ? palette.bull : palette.bear;
      const pillY = Math.max(padTop, Math.min(padTop + plotH - 18, ly - 9));
      ctx.beginPath();
      ctx.roundRect(padLeft + plotW + 3, pillY, axisRightW - 6, 18, 4);
      ctx.fill();
      ctx.fillStyle = onMarket;
      ctx.font = '600 10px "SF Mono", monospace';
      ctx.fillText(formatPrice(last.close, decimals), padLeft + plotW + 7, pillY + 9.5);
    }

    // 11. Time axis labels
    const labelCount = Math.max(3, Math.min(7, Math.floor(plotW / 110)));
    ctx.fillStyle = palette.quiet;
    ctx.font = '400 10px "SF Mono", monospace';
    ctx.textAlign = "center";
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.min(bars.length - 1, Math.round((i / Math.max(1, labelCount - 1)) * (bars.length - 1)));
      const x = xOf(idx);
      const lbl =
        timeframe === "1d"
          ? formatDateTime(bars[idx].time, timezone, { short: true }).split(",")[0]
          : formatDateTime(bars[idx].time, timezone, { timeOnly: true });
      ctx.fillText(lbl, x, H - 11);
    }
    ctx.textAlign = "left";

    // 12. Interactive crosshair
    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < bars.length) {
      const hx = Math.round(xOf(hoverIdx)) + 0.5;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = alpha(palette.ink, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, padTop + plotH + volH);
      ctx.stroke();

      if (hoverY !== null && hoverY >= padTop && hoverY <= padTop + plotH) {
        const hy = Math.round(hoverY) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padLeft, hy);
        ctx.lineTo(padLeft + plotW, hy);
        ctx.stroke();

        const hp = pHigh - ((hy - padTop) / plotH) * pRange;
        ctx.fillStyle = palette.inset;
        ctx.beginPath();
        ctx.roundRect(padLeft + plotW + 3, hy - 9, axisRightW - 6, 18, 4);
        ctx.fill();
        ctx.fillStyle = palette.ink;
        ctx.font = '500 10px "SF Mono", monospace';
        ctx.fillText(formatPrice(hp, decimals), padLeft + plotW + 7, hy + 0.5);
      }
      ctx.restore();
    }
  }, [
    size,
    appearance,
    activeHeight,
    view,
    decimals,
    showVolume,
    showEma,
    hollowCandles,
    ema20,
    ema50,
    levels,
    zones,
    events,
    volumeProfile,
    signalLines,
    hoverIdx,
    hoverY,
    timeframe,
    timezone,
  ]);

  const hoveredCandle =
    hoverIdx !== null && view.slice[hoverIdx] ? view.slice[hoverIdx] : view.slice[view.slice.length - 1];

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (dragRef.current.active && view.slice.length > 0) {
      const dx = e.clientX - dragRef.current.startX;
      const barsPerPx = view.slice.length / plotWidth(rect.width, decimals).size;
      const next = Math.round(dragRef.current.startOffset + dx * barsPerPx);
      const maxOff = Math.max(0, candles.length - visibleCount);
      setOffsetRight(Math.max(0, Math.min(maxOff, next)));
      return;
    }

    const plotW = plotWidth(rect.width, decimals).size;
    const rel = (x - 10) / plotW;
    if (rel >= 0 && rel <= 1 && view.slice.length > 0) {
      const idx = Math.min(view.slice.length - 1, Math.max(0, Math.floor(rel * view.slice.length)));
      setHoverIdx(idx);
      setHoverY(y);
    } else {
      setHoverIdx(null);
      setHoverY(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (candles.length < 20) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 8 : -8;
    setVisibleCount((prev) => Math.max(20, Math.min(candles.length, prev + delta)));
  };

  const chartBody = (
    <div ref={wrapRef} className="freyr-plot relative w-full select-none">
      {/* Compact translucent OHLC readout strip */}
      <div className="pointer-events-none absolute top-2 left-3 right-22 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono tabular-nums">
        {hoveredCandle && size.width >= 280 && (
          <>
            <span className="text-ink-secondary">{formatDateTime(hoveredCandle.time, timezone, { short: true })}</span>
            <span className="text-ink-secondary">
              O <span className="text-ink">{formatPrice(hoveredCandle.open, decimals)}</span>
            </span>
            <span className="text-ink-secondary">
              H <span className="text-ink">{formatPrice(hoveredCandle.high, decimals)}</span>
            </span>
            <span className="text-ink-secondary">
              L <span className="text-ink">{formatPrice(hoveredCandle.low, decimals)}</span>
            </span>
            <span className="text-ink-secondary">
              C{" "}
              <span className={hoveredCandle.close >= hoveredCandle.open ? "text-bull" : "text-bear"}>
                {formatPrice(hoveredCandle.close, decimals)}
              </span>
            </span>
            {hoveredCandle.volume > 0 && (
              <span className="text-ink-tertiary">
                V {hoveredCandle.volume >= 1000 ? `${(hoveredCandle.volume / 1000).toFixed(1)}k` : hoveredCandle.volume.toFixed(2)}
              </span>
            )}
          </>
        )}
      </div>

      {/* Discrete zoom reset + expand control */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1">
        {offsetRight > 0 && (
          <button
            type="button"
            title="Reset chart view"
            aria-label="Reset chart view"
            onClick={() => {
              setOffsetRight(0);
              setVisibleCount(Math.min(candles.length, 84));
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-ink/10 bg-elevated/90 text-ink-secondary hover:text-ink cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        {expandable && (
          <button
            type="button"
            title={expanded ? "Collapse chart" : "Expand chart"}
            aria-label={expanded ? "Collapse chart" : "Expand chart"}
            onClick={() => setExpanded((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-ink/10 bg-elevated/90 text-ink-secondary hover:text-ink cursor-pointer"
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        )}
      </div>

      {candles.length === 0 ? (
        <div
          style={{ height: activeHeight }}
          className="flex items-center justify-center bg-surface text-[12px] text-ink-secondary"
        >
          No verified price candles available for {symbol} ({timeframe}).
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Interactive candlestick chart for ${symbol} ${timeframe} timeframe showing ${candles.length} candles, last close ${formatPrice(candles[candles.length - 1]?.close, decimals)}`}
          style={{ width: "100%", height: activeHeight, display: "block" }}
          className="cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            setHoverIdx(null);
            setHoverY(null);
            dragRef.current.active = false;
          }}
          onMouseDown={(e) => {
            dragRef.current = { active: true, startX: e.clientX, startOffset: offsetRight };
          }}
          onMouseUp={() => {
            dragRef.current.active = false;
          }}
          onWheel={handleWheel}
        />
      )}
    </div>
  );

  if (expanded) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        onClick={() => setExpanded(false)}
      >
        <div
          className="freyr-panel w-full max-w-6xl overflow-hidden shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-ink/[0.08] px-4 py-2.5">
            <span className="text-[13px] font-medium text-ink">
              {symbol} · {timeframe.toUpperCase()} Expanded View
            </span>
            <span className="text-[11px] text-ink-secondary">Scroll to zoom · Drag to pan</span>
          </div>
          {chartBody}
        </div>
      </div>
    );
  }

  return chartBody;
}

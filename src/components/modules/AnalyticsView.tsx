"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronsUpDown, Minus } from "lucide-react";
import { Button, EmptyState, ErrorBanner, INPUT_CLS, KpiStat, PageHero, PanelSkeleton, SectionLabel, SegmentedControl, cn, formatCurrency, formatDateTime, formatMonthLabel, formatTimeAgo } from "@/components/ui/primitives";
import { calendarDay, mondayOf, summarizePerformance, weekLabel, type PerformanceEntry } from "@/lib/performance";

type Period = "months" | "weeks" | "custom";
type Point = { time: string | null; value: number };
const PERIODS: Array<{ value: Period; label: string }> = [{ value: "months", label: "Months" }, { value: "weeks", label: "Weeks" }, { value: "custom", label: "Custom" }];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pips: Record<string, number> = { XAUUSD: .1, XAUFUT: .1, BTCUSD: 1, ETHUSD: .1, SOLUSD: .01, XRPUSD: .0001, EURUSD: .0001, GBPUSD: .0001, USDJPY: .01, US500: .25, NAS100: .25, US30: 1, DXY: .01 };
const instrument = (symbol: string) => /^[A-Z]{6}$/.test(symbol) ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
const signedUsd = (value: number) => Math.abs(value) < 10_000 ? formatCurrency(value, true).replace(/\.00$/, "") : `${value < 0 ? "−" : "+"}$${compact.format(Math.abs(value))}`;

function Curve({ points, timezone }: { points: Point[]; timezone: string }) {
  const gradient = useId();
  const [focus, setFocus] = useState<number>();
  const total = points.at(-1)?.value ?? 0;
  const tone = total === 0 ? "var(--freyr-muted)" : total < 0 ? "var(--freyr-negative)" : "var(--freyr-positive)";
  const W = 410, H = 219, left = 55, right = 14, top = 14, bottom = 14;
  let lowest = 0, highest = 0;
  for (const point of points) { lowest = Math.min(lowest, point.value); highest = Math.max(highest, point.value); }
  const rawStep = Math.max((highest - lowest) / 4, .25);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((tick) => tick * magnitude >= rawStep) ?? 10) * magnitude;
  const low = highest === lowest ? -2 * step : Math.floor(lowest / step) * step;
  const high = highest === lowest ? 2 * step : Math.ceil(highest / step) * step;
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => high - index * step);
  const graphW = W - left - right, graphH = H - top - bottom;
  const x = (index: number) => left + index / Math.max(1, points.length - 1) * graphW;
  const y = (value: number) => top + (high - value) / (high - low) * graphH;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
  const last = points.length - 1;
  const selected = focus === undefined ? undefined : points[Math.min(focus, last)];
  const selectedIndex = Math.min(focus ?? last, last);
  const axisText = (value: number) => Math.abs(value) >= 1000 ? compact.format(value) : step < 1 ? Number(value.toFixed(2)).toString() : integer.format(value);

  return <section className="freyr-panel px-3.5 pt-3.5 pb-3 sm:px-5 sm:pt-4.5" aria-label="Profit and loss">
    <div className="freyr-section-caption"><SectionLabel>P&L curve · USD</SectionLabel><span className="text-[14px] font-semibold tabular-nums" style={{ color: tone }}>{last > 0 ? signedUsd(selected?.value ?? total) : "—"}</span></div>
    {last < 1 ? <div className="flex min-h-[162px] items-center justify-center px-5 text-center text-[12px] text-ink-secondary">Record a trade to start the curve.</div> : <div className="mt-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full touch-pan-y rounded-lg" role="img" tabIndex={0} aria-label={`Cumulative journal profit and loss in US dollars, ending at ${formatCurrency(total, true)}. Use left and right arrows to inspect points.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const relative = (event.clientX - bounds.left) / bounds.width;
          setFocus(Math.max(0, Math.min(last, Math.round((relative * W - left) * last / graphW))));
        }} onPointerLeave={() => setFocus(undefined)} onBlur={() => setFocus(undefined)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault(); setFocus((prior) => Math.max(0, Math.min(last, (prior ?? last) + (event.key === "ArrowRight" ? 1 : -1))));
        }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tone} stopOpacity=".27" /><stop offset="1" stopColor={tone} stopOpacity=".015" /></linearGradient></defs>
        {ticks.map((tick) => <g key={tick}><line x1={left} y1={y(tick)} x2={W - right} y2={y(tick)} stroke="var(--freyr-line)" strokeDasharray="4 5" /><text x={left - 8} y={y(tick) + 3.8} fontSize={12} textAnchor="end" fill="var(--freyr-quiet)" className="tabular-nums">{axisText(tick)}</text></g>)}
        <path d={`${line} L${x(last)} ${y(low)} L${x(0)} ${y(low)} Z`} fill={`url(#${gradient})`} />
        <path d={line} stroke={tone} fill="none" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.length <= 65 && points.slice(0, -1).map((point, index) => <circle key={index} cx={x(index)} cy={y(point.value)} r="2.6" fill={tone} />)}
        <circle cx={x(last)} cy={y(total)} r="4.1" fill={tone} />
        {selected && <><line x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={H - bottom} stroke="var(--freyr-muted)" opacity="0.62" strokeDasharray="3 4" /><circle cx={x(selectedIndex)} cy={y(selected.value)} r="4.5" fill={tone} stroke="var(--freyr-surface)" strokeWidth="1.5" /></>}
      </svg>
      <p className="min-h-4 px-0.5 text-[10.5px] text-ink-tertiary" aria-live="polite">{selected ? selected.time ? `${formatDateTime(selected.time, timezone, { short: true })} · ${formatCurrency(selected.value, true)}` : "Period opening · $0.00" : "Cumulative journal P&L"}</p>
    </div>}
  </section>;
}

export function AnalyticsView({ timezone, navigation, onJournal }: { timezone: string; navigation?: ReactNode; onJournal: () => void }) {
  const [entries, setEntries] = useState<PerformanceEntry[]>();
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Period>("months");
  const [month, setMonth] = useState("");
  const [week, setWeek] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const response = await fetch("/api/journal?view=performance", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Couldn’t load your journal.");
      const data: { entries: PerformanceEntry[] } = await response.json();
      if (!signal?.aborted) setEntries(data.entries);
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : "Couldn’t load your journal."); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const dated = useMemo(() => (entries ?? []).map((entry) => ({ entry, day: calendarDay(entry.tradedAt, timezone) })).filter(({ day }) => !!day), [entries, timezone]);
  const today = calendarDay(Date.now(), timezone);
  const months = [...new Set([today.slice(0, 7), ...dated.map(({ day }) => day.slice(0, 7))])].sort().reverse();
  const weeks = [...new Set([mondayOf(today), ...dated.map(({ day }) => mondayOf(day))])].sort().reverse();
  const monthValue = months.includes(month) ? month : dated[0]?.day.slice(0, 7) ?? months[0];
  const weekValue = weeks.includes(week) ? week : dated[0] ? mondayOf(dated[0].day) : weeks[0];
  const invalidRange = mode === "custom" && !!from && !!to && from > to;
  const filtered = useMemo(() => invalidRange ? [] : dated.filter(({ day }) => mode === "months" ? day.startsWith(monthValue) : mode === "weeks" ? mondayOf(day) === weekValue : (!from || day >= from) && (!to || day <= to)).map(({ entry }) => entry), [dated, invalidRange, mode, monthValue, weekValue, from, to]);
  const summary = useMemo(() => summarizePerformance(filtered), [filtered]);
  const points = useMemo(() => {
    let accumulated = 0;
    return [{ time: null, value: 0 }, ...[...filtered].reverse().map((entry) => ({ time: entry.tradedAt, value: accumulated += entry.pnlAmount }))];
  }, [filtered]);

  return <div className="freyr-primary-view">
    <PageHero title="History" description="Journal performance by month, week or custom range." actions={navigation} />
    <SegmentedControl options={PERIODS} value={mode} onChange={(value) => { setMode(value); setShowAll(false); }} ariaLabel="History filter mode" />
    {mode === "custom" ? <div className="grid grid-cols-2 gap-4">
      <label className="min-w-0"><span className="freyr-label">From</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setShowAll(false); }} className={`${INPUT_CLS} block w-full min-w-0`} /></label>
      <label className="min-w-0"><span className="freyr-label">To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setShowAll(false); }} className={`${INPUT_CLS} block w-full min-w-0`} /></label>
    </div> : <label className="block">
      <span className="freyr-label">{mode === "months" ? "Select month" : "Select week"}</span>
      <span className="relative block"><select aria-label={mode === "months" ? "Select month" : "Select week"} className="freyr-reference-select font-semibold" value={mode === "months" ? monthValue : weekValue} onChange={(event) => { (mode === "months" ? setMonth : setWeek)(event.target.value); setShowAll(false); }}>
        {(mode === "months" ? months : weeks).map((value) => <option value={value} key={value}>{mode === "months" ? formatMonthLabel(value) : weekLabel(value)}</option>)}
      </select><ChevronsUpDown className="freyr-select-icon" size={16} aria-hidden="true" /></span>
    </label>}
    {error && <ErrorBanner message={error} onRetry={() => void load()} />}
    {!entries && !error ? <PanelSkeleton rows={6} /> : invalidRange ? <ErrorBanner message="The end date must be on or after the start date." /> : entries && <>
      <section className="space-y-2.5" aria-label="Period performance">
        <SectionLabel>{mode === "months" ? formatMonthLabel(monthValue) : mode === "weeks" ? weekLabel(weekValue) : "Custom period"}</SectionLabel>
        <div className="grid grid-cols-3 gap-2"><KpiStat label="Win rate" value={summary.winRate === null ? "—" : `${summary.winRate}%`} tone="accent" featured /><KpiStat label="Net P&L" value={signedUsd(summary.net)} tone={summary.net < 0 ? "bear" : summary.net > 0 ? "bull" : "neutral"} featured /><KpiStat label="Trades" value={summary.trades} featured /></div>
      </section>
      <Curve key={`${mode}-${monthValue}-${weekValue}-${from}-${to}`} points={points} timezone={timezone} />
      <section className="space-y-2.5" aria-label="Journal trades">
        <SectionLabel>Trades</SectionLabel>
        {filtered.length === 0 ? <EmptyState title="No trades in this period" description="Trades recorded in the Journal appear here." action={<Button variant="secondary" size="sm" onClick={onJournal}>Open Journal</Button>} /> : <>
          <ul className="space-y-2">{(showAll ? filtered : filtered.slice(0, 12)).map((entry) => {
            const move = pips[entry.symbol] ? ((entry.direction === "SELL" ? -1 : 1) * (entry.exitPrice - entry.entryPrice)) / pips[entry.symbol] : null;
            const positive = entry.pnlAmount > 0, negative = entry.pnlAmount < 0;
            const Glyph = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
            return <li key={entry.id} className="freyr-row flex items-start justify-between gap-2 p-3.5 sm:gap-3.5 sm:p-4">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border sm:size-10", positive ? "border-bull/30 bg-bull/8 text-bull" : negative ? "border-bear/30 bg-bear/8 text-bear" : "border-outline text-ink-secondary")}><Glyph size={16} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]"><strong className={cn("font-semibold text-[14px] tabular-nums", positive ? "text-bull" : negative ? "text-bear" : "text-ink")}>{move === null ? signedUsd(entry.pnlAmount) : `${move > 0 ? "+" : ""}${integer.format(move)} pips`}</strong><span className="tabular-nums text-ink-secondary">{entry.pnlR > 0 ? "+" : ""}{entry.pnlR.toFixed(1)}R</span></p>
                <p className="mt-0.5 truncate text-[11px] text-ink-secondary" title={`${instrument(entry.symbol)} · ${entry.strategyName}`}>{instrument(entry.symbol)} · {entry.strategyName}</p>
              </div>
              <div className="shrink-0 text-right"><time className="text-[11px] text-ink-secondary" dateTime={entry.tradedAt} title={formatDateTime(entry.tradedAt, timezone)}>{formatTimeAgo(entry.tradedAt)}</time>{move !== null && <p className="text-[10.5px] font-medium tabular-nums text-ink-tertiary">{signedUsd(entry.pnlAmount)}</p>}</div>
            </li>;
          })}</ul>
          {filtered.length > 12 && !showAll && <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>Show all trades</Button>}
        </>}
      </section>
    </>}
  </div>;
}

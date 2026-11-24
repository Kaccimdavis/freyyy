"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button, cleanCopy, DirectionBadge, ErrorBanner, INPUT_CLS, KpiStat, LABEL_CLS, ModalSheet, PageHero, SectionLabel, SegmentedControl, SignalStatusBadge, cn, formatCurrency, formatDataStatus, formatDateTime, formatMonthLabel, formatPrice, formatTimeAgo } from "@/components/ui/primitives";
import { isOpenSignal, isTargetHit, nextSignalStatuses, statusLabel, type SignalStatus } from "@/lib/signal-policy";
import { calendarDay, summarizePerformance, type PerformanceEntry } from "@/lib/performance";
import { MarketWatch, type MarketPulse } from "./MarketWatch";

interface AuditEvent { id: number; eventType: string; newStatus: string; observedPrice: number | null; note: string; createdAt: string }
interface Signal {
  id: number; symbol: string; direction: "BUY" | "SELL"; entryPrice: number; stopLoss: number; takeProfit: number;
  riskReward: number; confidence: number; timeframe: string; strategyName: string; marketConditions: string; confirmations: string[];
  invalidationRule: string; status: SignalStatus; dataStatus: string; publishedAt: string; closedAt: string | null; expiresAt: string;
  currentPrice: number | null; quoteObservedAt?: string | null; example: boolean; events: AuditEvent[];
}
interface SignalData {
  signals: Signal[];
  cooldown: { hasOpen: boolean; remainingMs: number; nextAvailableAt: string | null };
}

const MARKET_META: Record<string, [string, string, number]> = {
  XAUUSD: ["XAU/USD", "Gold / US dollar", 2], XAUFUT: ["XAU futures", "COMEX gold", 2], BTCUSD: ["BTC/USD", "Bitcoin / US dollar", 1],
  ETHUSD: ["ETH/USD", "Ether / US dollar", 2], SOLUSD: ["SOL/USD", "Solana / US dollar", 2], XRPUSD: ["XRP/USD", "XRP / US dollar", 4],
  EURUSD: ["EUR/USD", "Euro / US dollar", 5], GBPUSD: ["GBP/USD", "Pound / US dollar", 5], USDJPY: ["USD/JPY", "US dollar / yen", 3],
  US500: ["US500", "S&P 500", 2], NAS100: ["NAS100", "Nasdaq 100", 2], US30: ["US30", "Dow Jones", 2], DXY: ["DXY", "US dollar index", 3],
};
const marketName = (symbol: string) => MARKET_META[symbol] ?? ([symbol, "", 2] as const);
const compactUsd = (value: number) => Math.abs(value) < 10_000
  ? formatCurrency(value, true).replace(/\.00$/, "")
  : `${value < 0 ? "-" : "+"}$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(value))}`;
const countdown = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function insight(signal: Signal, multiple: number | null) {
  if (signal.status === "EXPIRED") return ["Time limit reached", "The tracking window has ended. A disciplined exit from a setup is part of the plan."];
  if (signal.status === "INVALIDATED") return ["Setup invalidated", "The original idea no longer applies. Let the next setup earn your attention."];
  if (signal.status === "SL_HIT") return ["Stop threshold reached", "An individual loss doesn’t define the process. Review your journal before the next decision."];
  if (isTargetHit(signal.status)) return ["Take profit reached", "The published target was reached. Keep the process consistent rather than chasing the last result."];
  if (signal.status === "TP1_REACHED") return ["Partial milestone observed", "The original take profit and stop remain in effect for this earlier signal."];
  if (signal.status === "PENDING") return ["Waiting for entry", "Price hasn’t reached the published zone. Waiting for confirmation is part of the plan."];
  if (multiple === null) return ["Awaiting a fresh quote", "The original levels still apply. No progress is estimated without a verified quote."];
  if (multiple >= 1) return ["One risk unit reached", "Price has moved at least +1R from entry. Review your original risk plan; no levels have changed."];
  if (multiple <= -0.75) return ["Near the published stop", "Most of the original risk distance has been used. Focus on the plan, not the last tick."];
  if (multiple < 0) return ["Below entry in risk terms", "Price is moving against the setup. Follow your plan rather than reacting to every tick."];
  return ["Hold to your process", "Price is on the favorable side of entry. Keep the next decision tied to your original plan."];
}

function PriceLevels({ signal }: { signal: Signal }) {
  const precision = marketName(signal.symbol)[2];
  return <dl className="grid grid-cols-3 gap-2.5">
    {[{ name: "Entry", price: signal.entryPrice, tone: "text-ink" }, { name: "Stop loss", price: signal.stopLoss, tone: "text-bear" }, { name: "Take profit", price: signal.takeProfit, tone: "text-bull" }].map((level) => (
      <div key={level.name} className="freyr-inset flex min-h-[55px] min-w-0 flex-col justify-center px-1 py-2.5 text-center sm:min-h-[65px] sm:px-2">
        <dt className="freyr-eyebrow text-[9px] sm:text-[10px]">{level.name}</dt>
        <dd className={cn("mt-1 break-words text-[clamp(14px,4vw,21px)] font-semibold leading-tight tracking-tight tabular-nums", level.price === undefined ? "text-ink-tertiary" : level.tone)}>{formatPrice(level.price, precision)}</dd>
      </div>
    ))}
  </dl>;
}

function CurrentSignal({ signal, now, onOpen, timezone }: { signal: Signal; now: number; onOpen: () => void; timezone: string }) {
  const [name, subtitle, precision] = marketName(signal.symbol);
  const remaining = new Date(signal.expiresAt).getTime() - now;
  const active = isOpenSignal(signal.status) && remaining > 0;
  const side = signal.direction === "BUY" ? 1 : -1;
  const risk = Math.abs(signal.entryPrice - signal.stopLoss);
  const span = side * (signal.takeProfit - signal.stopLoss);
  const price = signal.currentPrice;
  const multiple = active && signal.status !== "PENDING" && price !== null && risk > 0 ? side * (price - signal.entryPrice) / risk : null;
  const [heading, coaching] = insight(signal, multiple);
  const progress = span > 0 && price !== null ? Math.max(0, Math.min(100, side * (price - signal.stopLoss) / span * 100)) : null;
  const entryPct = span > 0 ? Math.max(0, Math.min(100, risk / span * 100)) : 0;
  return <article className="freyr-panel space-y-3.5 p-3.5 sm:space-y-4 sm:p-5">
    <div className="flex items-start justify-between gap-2.5">
      <div><h2 className="text-[19px] font-bold leading-tight tracking-tight text-ink sm:text-[22px]">{name}</h2><p className="mt-0.5 text-[13px] text-ink-secondary">{subtitle}</p></div>
      <DirectionBadge direction={signal.direction} />
    </div>
    <PriceLevels signal={signal} />
    <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-secondary">
      <span>Risk : reward <strong className="ml-1 font-medium tabular-nums text-ink">1:{signal.riskReward}</strong></span>
      <div className="flex flex-wrap items-center gap-1.5"><SignalStatusBadge status={signal.status} /></div>
    </div>
    {active && progress !== null && <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-[11.5px] text-ink-secondary"><span>{signal.status === "PENDING" ? "Feed quote" : "Indicative move"}</span><span className="font-medium tabular-nums text-ink">{formatPrice(price, precision)}{multiple !== null && ` · ${multiple > 0 ? "+" : ""}${multiple.toFixed(2)}R`}</span></div>
      <div className="freyr-progress relative mx-1 h-1.5 rounded-full bg-outline" aria-label="Price from stop to target">
        <div className="absolute inset-y-0 rounded-full bg-ink/35" style={{ left: `${Math.min(entryPct, progress)}%`, width: `${Math.abs(progress - entryPct)}%` }} />
        <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink/60" style={{ left: `${entryPct}%` }} />
        <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-secondary" style={{ left: `${progress}%` }} />
      </div>
    </div>}
    <div className="freyr-inset px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-secondary sm:px-3.5 sm:py-3">
      <p><strong className="font-semibold text-ink">Posted {formatTimeAgo(signal.publishedAt).toLowerCase()}.</strong> {heading}. {coaching}</p>
      <div className="mt-0.5 flex min-h-8 flex-wrap items-center justify-between gap-1.5 text-[11px]">
        <span>{active ? <span className="tabular-nums" title={formatDateTime(signal.expiresAt, timezone)}>Expires in {countdown(remaining)}</span> : <time dateTime={signal.publishedAt}>{formatDateTime(signal.publishedAt, timezone, { short: true })}</time>}</span>
        <button type="button" className="inline-flex min-h-8 items-center gap-1 rounded-md pl-2 font-semibold text-ink-secondary hover:underline" onClick={onOpen}>Details <ArrowUpRight size={12} aria-hidden="true" /></button>
      </div>
    </div>
  </article>;
}

export function SignalsView({ timezone, monitorTick, gold, onMarkets, navigation }: { timezone: string; monitorTick: number; gold: MarketPulse; onMarkets: (symbol: string) => void; navigation?: ReactNode }) {
  const [data, setData] = useState<SignalData>();
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [manual, setManual] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [auditError, setAuditError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [manualError, setManualError] = useState("");
  const [journal, setJournal] = useState<{ entries: PerformanceEntry[]; desk: boolean }>();
  const [performanceError, setPerformanceError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/journal?view=performance", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result: { entries: PerformanceEntry[]; desk: boolean } = await response.json();
      if (!controller.signal.aborted) { setJournal(result); setPerformanceError(false); }
    }).catch(() => { if (!controller.signal.aborted) setPerformanceError(true); });
    return () => controller.abort();
  }, [revision]);
  const today = calendarDay(now, timezone);
  const month = today.slice(0, 7);
  const performance = useMemo(() => journal ? summarizePerformance(journal.entries.filter((trade) => {
    const day = calendarDay(trade.tradedAt, timezone);
    return day.startsWith(month) && day <= today;
  })) : undefined, [journal, month, today, timezone]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/signals", { cache: "no-store", signal });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Unable to load signals.");
      if (!signal?.aborted) { setData(payload); setLoadError(""); }
    } catch (err) {
      if (!signal?.aborted) setLoadError(err instanceof Error ? err.message : "Unable to load signals.");
    }
  }, []);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, monitorTick]);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const open = data?.signals.find((item) => isOpenSignal(item.status) && new Date(item.expiresAt).getTime() > now);
  const archived = data?.signals.filter((item) => !isOpenSignal(item.status)) ?? [];
  const selected = data?.signals.find((item) => item.id === selectedId) ?? null;
  const expiry = data?.signals.find((item) => isOpenSignal(item.status))?.expiresAt;
  useEffect(() => {
    if (!expiry) return;
    const timer = window.setTimeout(() => void load(), Math.max(0, Date.parse(expiry) - Date.now()) + 75);
    return () => window.clearTimeout(timer);
  }, [expiry, load]);
  const remaining = data?.cooldown.nextAvailableAt ? Math.max(0, Date.parse(data.cooldown.nextAvailableAt) - now) : 0;
  const unavailable = !data || Boolean(open) || data.cooldown.hasOpen || remaining > 0;
  const row = tab === "active" ? open : undefined;

  async function publish(body: Record<string, unknown>, inForm = false) {
    setPublishing(true);
    setNotice("");
    setManualError("");
    try {
      const res = await fetch("/api/signals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) { if (res.status === 409 || res.status === 429) await load(); throw new Error(result.error ?? "Couldn’t publish the signal."); }
      setManual(false);
      setTab("active");
      setNotice("Signal published. Original levels are locked.");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn’t publish the signal.";
      if (inForm) setManualError(message); else setNotice(message);
    } finally { setPublishing(false); }
  }

  async function handleManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    await publish({ mode: "manual", symbol: text("symbol"), direction: text("direction"), timeframe: text("timeframe"),
      entryPrice: Number(text("entry")), stopLoss: Number(text("stop")), takeProfit: Number(text("target")),
      confidence: Number(text("confidence")), strategyName: text("strategy"), marketConditions: text("context"), confirmations: text("evidence").split("\n").map((item) => item.trim()).filter(Boolean), invalidationRule: text("invalidation"), initialStatus: "PENDING" }, true);
  }

  async function recordUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setUpdating(true); setAuditError("");
    try {
      const res = await fetch(`/api/signals/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: form.get("status"), note: form.get("note") }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn’t record the update.");
      element.reset();
      await load();
    } catch (err) { setAuditError(err instanceof Error ? err.message : "Couldn’t record the update."); }
    finally { setUpdating(false); }
  }

  async function refresh() {
    setRefreshing(true);
    setRevision((value) => value + 1);
    try { await load(); } finally { setRefreshing(false); }
  }

  return <div className="freyr-primary-view">
    <PageHero title="Freyr" actions={<>
      <span title="Gold reference feed" className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.08em] uppercase whitespace-nowrap sm:text-[10px]", gold.status === "UNAVAILABLE" || !gold.status ? "border-bear/30 bg-bear/8 text-bear" : "border-outline bg-elevated text-ink-secondary")}>
        <span className="size-[5px] shrink-0 rounded-full bg-current" aria-hidden="true" />{formatDataStatus(gold.status)}
      </span>
      <button type="button" className="freyr-icon-button" aria-label="Refresh signals" title="Refresh signals and market cards" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={18} aria-hidden="true" /></button>
      {navigation}
    </>} />
    <section className="space-y-2.5" aria-label="Monthly journal performance">
      <div className="freyr-section-caption"><SectionLabel>{formatMonthLabel(month)}</SectionLabel><SectionLabel>Performance</SectionLabel><SectionLabel>Month to date</SectionLabel></div>
      <div className="grid grid-cols-3 gap-2">
        <KpiStat label="Win rate" value={performance?.winRate != null ? `${performance.winRate}%` : "—"} tone="accent" featured />
        <KpiStat label="Net P&L" value={performance ? compactUsd(performance.net) : "—"} tone={performance?.net ? performance.net > 0 ? "bull" : "bear" : "neutral"} featured />
        <KpiStat label="Trades" value={performance?.trades ?? "—"} featured />
      </div>
      {performanceError && <p className="text-[11.5px] text-ink-secondary">Journal totals are unavailable.</p>}
    </section>
    <SegmentedControl options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }]} value={tab} onChange={setTab} ariaLabel="Signal views" />
    {loadError && <ErrorBanner message={loadError} onRetry={() => void refresh()} />}
    {row && <CurrentSignal signal={row} now={now} timezone={timezone} onOpen={() => { setAuditError(""); setSelectedId(row.id); }} />}
    {!row && !loadError && <section className="freyr-signal-empty" aria-label={tab === "active" ? "Signal availability" : "Signal archive"}>
      {!data ? <p role="status">Checking signals…</p> : tab === "closed" ? <p>No closed signals yet.</p> : <>
        <p><strong className="font-semibold text-ink">No active signal.</strong>{remaining > 0 && <> Next evaluation in <span className="font-medium tabular-nums text-ink">{countdown(remaining)}</span>.</>}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={unavailable || publishing} onClick={() => void publish({ mode: "ai", symbol: "XAUUSD" })}>{publishing ? "Checking setup…" : "Evaluate gold setup"}</Button>
          <Button variant="ghost" size="sm" disabled={unavailable || publishing} onClick={() => { setManualError(""); setManual(true); }}>Publish manually</Button>
        </div>
      </>}
    </section>}
    {tab === "closed" && archived.length > 0 && <ol className="freyr-history-scroll space-y-1.5" aria-label="Closed signal history">
      {archived.map((item) => {
        const [, , precision] = marketName(item.symbol);
        const hit = isTargetHit(item.status);
        return <li key={item.id}>
          <button type="button" onClick={() => { setAuditError(""); setSelectedId(item.id); }} className="freyr-selectable freyr-history-row w-full cursor-pointer" aria-label={`Open ${marketName(item.symbol)[0]} closed signal`}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-ink">{marketName(item.symbol)[0]}</span>
                <DirectionBadge direction={item.direction} className="shrink-0 px-1.5 py-0.5 text-[9px]" />
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] tabular-nums text-ink-tertiary">E {formatPrice(item.entryPrice, precision)} · TP {formatPrice(item.takeProfit, precision)}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("block text-[11px] font-semibold", hit ? "text-bull" : item.status === "SL_HIT" ? "text-bear" : "text-ink-secondary")}>{hit ? "Target" : item.status === "SL_HIT" ? "Stopped" : "Expired"}</span>
              <time className="mt-0.5 block text-[9.5px] text-ink-tertiary" dateTime={item.publishedAt}>{formatTimeAgo(item.publishedAt)}</time>
            </span>
          </button>
        </li>;
      })}
    </ol>}
    {notice && tab === "active" && <p role="status" className="text-[12px] leading-relaxed text-ink-secondary">{notice}</p>}
    <p className="text-[12px] leading-relaxed text-ink-secondary">Performance from your journal. Tracking only — no broker orders are placed.</p>
    <MarketWatch gold={gold} revision={revision} onOpen={onMarkets} />

    <ModalSheet open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected ? marketName(selected.symbol)[0] : "Signal details"} subtitle={selected ? marketName(selected.symbol)[1] : undefined}>
      {selected && <div className="space-y-4">
        <div className="flex items-center justify-between gap-2"><SignalStatusBadge status={selected.status} /><DirectionBadge direction={selected.direction} /></div>
        <PriceLevels signal={selected} />
        <dl className="divide-y divide-ink/[0.07] text-[12.5px]">
          {[ ["Published", formatDateTime(selected.publishedAt, timezone)], ["Tracking deadline", formatDateTime(selected.expiresAt, timezone)], ["Strategy", selected.strategyName] ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 py-2"><dt className="text-ink-secondary">{label}</dt><dd className="text-right tabular-nums text-ink">{value}</dd></div>
          ))}
        </dl>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{cleanCopy(selected.marketConditions)}</p>
        {selected.invalidationRule && <p className="text-[12px] text-ink-secondary"><strong className="text-ink">Invalidation:</strong> {selected.invalidationRule}</p>}
        {selected.confirmations.length > 0 && <details className="freyr-inset p-3 text-[12px] text-ink-secondary"><summary className="cursor-pointer font-medium text-ink">Confirmations</summary><ul className="mt-2 list-disc space-y-1 pl-4">{selected.confirmations.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></details>}
        <div className="space-y-2"><SectionLabel>Audit trail</SectionLabel>{selected.events.map((item) => <div key={item.id} className="freyr-inset px-3 py-2.5 text-[12px] text-ink-secondary"><div className="mb-1 flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-ink">{item.eventType === "MILESTONE" ? "Milestone" : statusLabel[item.newStatus as SignalStatus] ?? "Update"}</span><time dateTime={item.createdAt}>{formatDateTime(item.createdAt, timezone, { short: true })}</time></div>{cleanCopy(item.note)}</div>)}</div>
        {isOpenSignal(selected.status) && <details className="freyr-inset p-3">
          <summary className="cursor-pointer text-[12.5px] font-medium">Record an update</summary>
          <form onSubmit={recordUpdate} className="mt-3 space-y-3">
            {auditError && <ErrorBanner message={auditError} />}
            <label className="block"><span className={LABEL_CLS}>Status</span><select name="status" className={INPUT_CLS} defaultValue={selected.status}>{[selected.status, ...nextSignalStatuses(selected.status)].map((value) => <option key={value} value={value}>{statusLabel[value]}</option>)}</select></label>
            <label className="block"><span className={LABEL_CLS}>Note</span><textarea required minLength={2} maxLength={400} name="note" className={cn(INPUT_CLS, "min-h-16 py-2")} /></label>
            <Button type="submit" variant="primary" disabled={updating}>{updating ? "Recording…" : "Save update"}</Button>
          </form>
        </details>}
      </div>}
    </ModalSheet>
    <ModalSheet open={manual} onClose={() => setManual(false)} title="Publish a signal" subtitle="Original levels lock when published. Tracking stops at three hours.">
      <form onSubmit={handleManual} className="space-y-3.5">
        {manualError && <ErrorBanner message={manualError} />}
        <div className="grid grid-cols-3 gap-2">
          <label><span className={LABEL_CLS}>Market</span><select className={INPUT_CLS} name="symbol" defaultValue="XAUUSD">{Object.keys(MARKET_META).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className={LABEL_CLS}>Direction</span><select name="direction" className={INPUT_CLS}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label>
          <label><span className={LABEL_CLS}>Timeframe</span><select name="timeframe" className={INPUT_CLS} defaultValue="15m">{["3m", "5m", "15m", "1h", "4h", "1d"].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[["entry", "Entry"], ["stop", "Stop loss"], ["target", "Take profit"]].map(([name, label]) => <label key={name}><span className={LABEL_CLS}>{label}</span><input required name={name} type="number" step="any" min="0.00000001" className={INPUT_CLS} /></label>)}
          <label><span className={LABEL_CLS}>Strategy</span><input name="strategy" required minLength={2} maxLength={120} className={INPUT_CLS} /></label>
          <label><span className={LABEL_CLS}>Confidence (%)</span><input name="confidence" required type="number" min="30" max="95" className={INPUT_CLS} /></label>
        </div>
        <label className="block"><span className={LABEL_CLS}>Market context</span><input name="context" required minLength={4} maxLength={500} className={INPUT_CLS} /></label>
        <label className="block"><span className={LABEL_CLS}>Confirmations · at least two, one per line</span><textarea name="evidence" required rows={2} className={cn(INPUT_CLS, "h-auto py-2")} /></label>
        <label className="block"><span className={LABEL_CLS}>Invalidation rule</span><input name="invalidation" required minLength={4} maxLength={300} className={INPUT_CLS} /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setManual(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={publishing || unavailable}>{publishing ? "Publishing…" : "Publish"}</Button></div>
      </form>
    </ModalSheet>
  </div>;
}

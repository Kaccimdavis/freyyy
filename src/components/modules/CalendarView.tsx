"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw, Share2 } from "lucide-react";
import { type EconomicEvent } from "@/lib/market-data";
import { Chip, DataStatusBadge, DirectionBadge, EmptyState, ErrorBanner, PageHero, PanelSkeleton, SectionLabel, SegmentedControl, cn, formatClock, formatDateTime, formatDayHeading, formatPct } from "@/components/ui/primitives";

type Tab = "predictions" | "calendar" | "history";
type Prediction = { eventKey: string; title: string; releaseAt: string; direction: "BUY" | "SELL" };
type HistoryItem = Prediction & { impact: string; forecast: string; previous: string; publishedAt: string; outcome: "PENDING" | "MATCHED" | "OPPOSITE" | "FLAT" | "UNAVAILABLE"; movePct: number | null };
type CalendarData = { events: EconomicEvent[]; status: string; error?: string; fetchedAt: string };
type NewsData = { predictions?: Prediction[]; history?: HistoryItem[]; events?: EconomicEvent[]; status?: string; error?: string; fetchedAt?: string };

const SECTIONS: Array<{ value: Tab; label: string }> = [{ value: "predictions", label: "Predictions" }, { value: "calendar", label: "Calendar" }, { value: "history", label: "History" }];
const OUTCOMES = {
  MATCHED: { label: "As predicted", tone: "bull" }, OPPOSITE: { label: "Opposite", tone: "bear" },
  FLAT: { label: "Flat", tone: "neutral" }, PENDING: { label: "Awaiting result", tone: "neutral" },
  UNAVAILABLE: { label: "Data unavailable", tone: "neutral" },
} as const;

function groupByDay<T>(items: T[], time: (item: T) => string | number, timezone: string) {
  const days = new Map<string, T[]>();
  for (const item of items) {
    const label = formatDayHeading(time(item), timezone);
    const list = days.get(label) ?? [];
    list.push(item);
    days.set(label, list);
  }
  return [...days];
}

function ReleaseCard({ title, timestamp, timezone, badge, detailLine, children, past = false }: { title: string; timestamp: string | number; timezone: string; badge: React.ReactNode; detailLine?: React.ReactNode; children?: React.ReactNode; past?: boolean }) {
  const content = (
    <div className={`news-card-grid${past ? " news-past" : ""}`} data-past={past ? "true" : undefined}>
      <time className="news-time" dateTime={new Date(timestamp).toISOString()}>{formatClock(timestamp, timezone)}</time>
      <div className="min-w-0">
        <div className="news-card-title">{title}</div>
        {detailLine && <div className="news-card-meta">{detailLine}</div>}
      </div>
      <div className="news-card-badge">{badge}{children && <ChevronDown aria-hidden="true" className="news-disclosure" size={15} />}</div>
    </div>
  );
  const tone = past ? "news-card news-card-past" : "news-card";
  if (!children) return <article className={tone}>{content}</article>;
  return <details className={tone}><summary>{content}</summary><div className="news-card-details">{children}</div></details>;
}

function Figures({ forecast, previous, actual }: { forecast: string; previous: string; actual?: string }) {
  return <dl className={cn("grid gap-2", actual === undefined ? "grid-cols-2" : "grid-cols-3")}>
    {[...(actual === undefined ? [] : [["Actual", actual]]), ["Forecast", forecast], ["Previous", previous]].map(([name, value]) => (
      <div key={name} className="min-w-0"><dt className="text-[11px] text-ink-secondary">{name}</dt><dd className="mt-0.5 break-words font-medium tabular-nums text-ink">{value || "—"}</dd></div>
    ))}
  </dl>;
}

export function CalendarView({ timezone, navigation }: { timezone: string; navigation?: ReactNode }) {
  const [tab, setTab] = useState<Tab>("predictions");
  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash === "calendar" || hash === "predictions" || hash === "history" || hash === "news") setTab(hash === "news" ? "predictions" : hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const [data, setData] = useState<Partial<Record<Tab, NewsData>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    const fetchSection = async (showLoading = true) => {
      if (showLoading) { setLoading(true); setError(undefined); }
      try {
        const url = tab === "calendar" ? "/api/calendar" : `/api/news?view=${tab}`;
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const payload: NewsData = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "This section is temporarily unavailable.");
        if (!controller.signal.aborted) {
          setData((previous) => ({ ...previous, [tab]: payload }));
          setError(payload.error);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Couldn’t load News.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void fetchSection();
    const timer = window.setInterval(() => { if (!document.hidden) void fetchSection(false); }, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [tab, revision]);

  const predictions = useMemo(() => groupByDay(data.predictions?.predictions ?? [], (item) => item.releaseAt, timezone), [data.predictions, timezone]);
  const history = useMemo(() => groupByDay(data.history?.history ?? [], (item) => item.releaseAt, timezone), [data.history, timezone]);
  const calendar: CalendarData | undefined = data.calendar?.events ? { events: data.calendar.events, status: data.calendar.status ?? "UNAVAILABLE", fetchedAt: data.calendar.fetchedAt ?? "", error: data.calendar.error } : undefined;
  const scheduleEvents = useMemo(() => (calendar?.events ?? []).filter((event) => event.impact === "High"), [calendar]);
  const schedule = groupByDay(scheduleEvents, (item) => item.timestamp, timezone);
  const uninitialized = loading && !data[tab];

  async function share() {
    const url = new URL("/#calendar", window.location.origin).href;
    setNotice("");
    try {
      if (navigator.share) await navigator.share({ title: "Freyr · News", url });
      else { await navigator.clipboard.writeText(url); setNotice("News link copied."); }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setNotice("Link sharing wasn’t available on this device.");
    }
  }

  return (
    <div className="freyr-primary-view">
      <PageHero title="News" description="Gold calls and market-moving releases." actions={navigation} />
      <SegmentedControl options={SECTIONS} value={tab} onChange={(value) => { setTab(value); setNotice(""); }} ariaLabel="News sections" />
      <div className="freyr-section-caption">
        <SectionLabel>{tab === "predictions" ? "XAU/USD · Gold calls" : tab === "calendar" ? "High-impact releases" : "XAU/USD · Prediction history"}</SectionLabel>
        <div className="flex shrink-0 items-center gap-0.5">
          {tab === "predictions" && <button type="button" className="freyr-icon-button" title="Share News" aria-label="Share News" onClick={() => void share()}><Share2 size={17} aria-hidden="true" /></button>}
          {tab === "calendar" && calendar && <DataStatusBadge status={calendar.status} />}
          <button type="button" className="freyr-icon-button" onClick={refresh} title="Refresh news" aria-label="Refresh news" disabled={loading}><RefreshCw size={18} aria-hidden="true" /></button>
        </div>
      </div>
      {notice && <p role="status" className="text-[12px] text-ink-secondary">{notice}</p>}
      {error && tab !== "calendar" && <ErrorBanner message={error} onRetry={refresh} />}
      {tab === "calendar" && calendar?.error && (calendar.events.length > 0 || calendar.status === "UNAVAILABLE") && (
        <div className="freyr-notice" role="status">
          <span>{calendar.error}</span>
          <button type="button" onClick={refresh}>Retry</button>
        </div>
      )}
      {uninitialized ? <PanelSkeleton rows={5} /> : tab === "predictions" ? (
        <section aria-label="Upcoming gold predictions" className="space-y-5 sm:space-y-6">
          {predictions.length === 0 ? <EmptyState title="No upcoming predictions" description="New gold calls appear here when upcoming USD releases meet the prediction rules." /> : predictions.map(([day, list]) => (
            <section key={day} className="space-y-2.5">
              <SectionLabel>{day}</SectionLabel>
              {list.map((item) => <ReleaseCard key={item.eventKey} title={item.title} timestamp={item.releaseAt} timezone={timezone} badge={<DirectionBadge direction={item.direction} className="px-3" />} />)}
            </section>
          ))}
        </section>
      ) : tab === "calendar" ? (
        <section aria-label="Forex Factory calendar" className="space-y-5 sm:space-y-6">
          {schedule.length === 0 ? (calendar && calendar.status === "UNAVAILABLE" ? (
            <div className="freyr-notice" role="status">
              <span>Calendar feed is temporarily unavailable.</span>
              <button type="button" onClick={refresh}>Retry</button>
            </div>
          ) : <EmptyState title="No releases scheduled" description="No high-impact releases scheduled in this week’s feed." />) : schedule.map(([day, list]) => (
            <section key={day} className="space-y-2.5">
              <SectionLabel>{day}</SectionLabel>
              {list.map((event) => {
                const past = event.timestamp < Date.now();
                return <ReleaseCard key={event.id} title={event.title} timestamp={event.timestamp} timezone={timezone} past={past}
                  badge={<>{past && <span className="released-tag">Released</span>}<Chip tone={event.impact === "High" ? "bear" : "neutral"}>{event.impact === "Holiday" ? "Bank holiday" : event.impact}</Chip></>}
                  detailLine={<>{event.currency}<span aria-hidden="true">·</span>{event.category}</>}>
                  <Figures forecast={event.forecast} previous={event.previous} actual={event.actual === "Pending" ? "Not reported" : event.actual} />
                </ReleaseCard>;
              })}
            </section>
          ))}
          <p className="news-note">Times shown in {timezone.replaceAll("_", " ")}. Released events are dimmed; actual figures appear when reported.</p>
        </section>
      ) : (
        <section aria-label="Prediction history" className="space-y-5 sm:space-y-6">
          {history.length === 0 ? <EmptyState title="No prediction outcomes yet" description="Only predictions published before their release enter this history. Older events are not backfilled." /> : history.map(([day, list]) => (
            <section key={day} className="space-y-2.5">
              <SectionLabel>{day}</SectionLabel>
              {list.map((item) => {
                const outcome = OUTCOMES[item.outcome];
                return <ReleaseCard key={item.eventKey} title={item.title} timestamp={item.releaseAt} timezone={timezone}
                  badge={<Chip tone={outcome.tone}>{outcome.label}</Chip>}
                  detailLine={<>Gold {item.direction.toLowerCase()}{item.movePct !== null && <><span aria-hidden="true">·</span><span className="tabular-nums">{formatPct(item.movePct)} move</span></>}</>}>
                  <Figures forecast={item.forecast} previous={item.previous} />
                  <p className="mt-3 text-ink-secondary">Published {formatDateTime(item.publishedAt, timezone, { short: true })}. {item.outcome === "PENDING" ? "The two-hour reaction window hasn’t closed yet." : item.outcome === "UNAVAILABLE" ? "Gold candles for this window aren’t available yet." : "Compared completed Hyperliquid gold candles before the release and two hours after."}</p>
                </ReleaseCard>;
              })}
            </section>
          ))}
          {history.length > 0 && <p className="news-note">Moves within ±0.06% are marked flat. These are market reactions, not trade results.</p>}
        </section>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronsUpDown, ChevronRight, History, Upload, X } from "lucide-react";
import type { aiAnalyses, ChartAnalysisSnapshot } from "@/db/schema";
import type { Candle, Timeframe } from "@/lib/market-data";
import type { DecisionEngineOutput } from "@/lib/engines/ai-analyst";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { Button, Chip, DataStatusBadge, DirectionBadge, EmptyState, ErrorBanner, INPUT_CLS, LABEL_CLS, ModalSheet, PageHero, PanelSkeleton, SectionLabel, cn, formatDateTime, formatPct, formatPrice, type NavTab } from "@/components/ui/primitives";

const MARKETS: Record<string, [string, number]> = { XAUUSD: ["XAU/USD — Gold", 2], BTCUSD: ["BTC/USD — Bitcoin", 1], ETHUSD: ["ETH/USD — Ether", 2], SOLUSD: ["SOL/USD — Solana", 2], EURUSD: ["EUR/USD — Euro", 5], GBPUSD: ["GBP/USD — Pound", 5], US500: ["US500 — S&P 500", 2], NAS100: ["NAS100 — Nasdaq 100", 2] };
const FRAMES: Timeframe[] = ["4h", "1h", "15m", "5m", "3m", "1d"];
const panes = ["4h", "1h", "15m", "5m"] as const;
const MARKET_GROUP: Record<string, string> = { XAUUSD: "Gold", BTCUSD: "Crypto", ETHUSD: "Crypto", SOLUSD: "Crypto", EURUSD: "Forex", GBPUSD: "Forex", US500: "Index", NAS100: "Index" };
type ArchiveRow = { id: number; symbol: string; timeframes: string[]; direction: string; setupState: string; confidenceScore: number; createdAt: string };
type ArchiveRecord = Omit<typeof aiAnalyses.$inferSelect, "createdAt"> & { createdAt: string };
type Review = { market: string; snapshot: ChartAnalysisSnapshot; explanation: string; saved: { id: number } | null };
interface ChartSlot {
  candles?: Candle[];
  status?: string;
  busy?: boolean;
  error?: string;
  image?: { name: string; data: string };
  review?: Review;
  captured?: string;
}
const priceDecimals = (market: string) => MARKETS[market]?.[1] ?? 2;
const shortMarket = (market: string) => MARKETS[market]?.[0].split(" — ")[0] ?? market;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json;
}

function Snapshot({ value, symbol, timezone, guide }: { value: ChartAnalysisSnapshot; symbol: string; timezone: string; guide?: { entry: number; stopLoss: number; takeProfit: number } }) {
  const decimals = priceDecimals(symbol);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-secondary"><span>{value.source} · {value.timeframe.toUpperCase()}</span><time dateTime={value.asOf}>As of {formatDateTime(value.asOf, timezone, { short: true })}</time></div>
    <div className="overflow-hidden rounded-xl border border-ink/[0.08]">
      <CandlestickChart symbol={symbol} timeframe={value.timeframe} candles={value.candles} decimals={decimals} height={245} timezone={timezone} showVolume={false} expandable={false} signalLines={guide} />
    </div>
  </>;
}

function FlowSummary({ value, symbol }: { value: ChartAnalysisSnapshot; symbol: string }) {
  const decimals = priceDecimals(symbol);
  const fields = [["Flow bias", value.bias === "UNAVAILABLE" ? "Unavailable" : value.bias.toLowerCase()], ["Structure", value.structure.toLowerCase()], ["Estimated delta", formatPrice(value.estimatedDelta, 2)], ["Point of control", formatPrice(value.poc, decimals)], ["Value area", value.val === null || value.vah === null ? "Unavailable" : `${formatPrice(value.val, decimals)} – ${formatPrice(value.vah, decimals)}`], ["Bid / ask depth", value.bidDepthPct === null || value.askDepthPct === null ? "Unavailable" : `${formatPct(value.bidDepthPct, 1, false)} / ${formatPct(value.askDepthPct, 1, false)}`]];
  return <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{fields.map(([label, result]) => <div key={label} className="freyr-inset min-w-0 p-2.5"><dt className="text-[10.5px] text-ink-secondary">{label}</dt><dd className="mt-0.5 break-words text-[12.5px] font-medium capitalize tabular-nums text-ink">{result}</dd></div>)}</dl>;
}

function PricePlan({ result, symbol }: { result: { entryPrice: number; stopLoss: number; takeProfit: number }; symbol: string }) {
  const decimals = priceDecimals(symbol);
  return <div className="grid grid-cols-3 gap-2.5">{[["Entry", result.entryPrice, "text-ink"], ["Stop", result.stopLoss, "text-bear"], ["Take profit", result.takeProfit, "text-bull"]].map(([label, price, tone]) => <div key={label} className="freyr-inset px-1.5 py-2.5 text-center"><SectionLabel>{label}</SectionLabel><p className={cn("mt-1 text-[14px] font-semibold tabular-nums", String(tone))}>{formatPrice(Number(price), decimals)}</p></div>)}</div>;
}

export function AiAnalystView({ timezone, onNavigate, navigation }: { timezone: string; onNavigate: (tab: NavTab) => void; navigation?: ReactNode }) {
  const [view, setView] = useState<"analyze" | "history">("analyze");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [threshold, setThreshold] = useState(62);
  const [analysis, setAnalysis] = useState<DecisionEngineOutput>();
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [notice, setNotice] = useState("");
  const [runError, setRunError] = useState("");
  const [frames, setFrames] = useState<Timeframe[]>([...panes]);
  const [slots, setSlots] = useState<Partial<Record<Timeframe, ChartSlot>>>({});
  const marketRef = useRef(symbol);

  const [reviewFrame, setReviewFrame] = useState<Timeframe>();
  const [config, setConfig] = useState<{ canSave: boolean; visionAvailable: boolean }>();
  const [captured, setCaptured] = useState("");
  const [readLabels, setReadLabels] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const [history, setHistory] = useState<ArchiveRow[]>();
  const [historyError, setHistoryError] = useState("");
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<ArchiveRow>();
  const [record, setRecord] = useState<ArchiveRecord>();
  const [detailError, setDetailError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryError("");
    try { const result = await request<{ history: ArchiveRow[] }>("/api/analyst?current=0&historyLimit=60", { signal }); if (!signal?.aborted) setHistory(result.history); }
    catch (err) { if (!signal?.aborted) setHistoryError(err instanceof Error ? err.message : "Couldn’t load the archive."); }
  }, []);
  useEffect(() => { if (view !== "history") return; const controller = new AbortController(); void loadHistory(controller.signal); return () => controller.abort(); }, [view, loadHistory]);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    request<{ analysis: ArchiveRecord }>(`/api/analyst/${selection.id}`, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setRecord(result.analysis); }).catch((err) => { if (!controller.signal.aborted) setDetailError(err.message); });
    return () => controller.abort();
  }, [selection]);

  function changeMarket(newSymbol: string) {
    marketRef.current = newSymbol;
    setSymbol(newSymbol); setSlots({}); setAnalysis(undefined); setReviewFrame(undefined); setRunError(""); setNotice(""); setPublished(false);
  }

  async function loadChart(timeframe: Timeframe) {
    const market = symbol;
    const setSlot = (patch: Partial<ChartSlot>) => {
      if (marketRef.current === market) setSlots((previous) => ({ ...previous, [timeframe]: { ...previous[timeframe], ...patch } }));
    };
    setSlot({ busy: true, error: undefined });
    try {
      const result = await request<{ candles: Candle[]; status: string }>(`/api/markets?symbol=${encodeURIComponent(market)}&tf=${timeframe}`);
      if (!result.candles?.length) throw new Error("No candles available.");
      setSlot({ candles: result.candles.slice(-35), status: result.status, busy: false });
    } catch (err) { setSlot({ busy: false, error: err instanceof Error ? err.message : "Chart unavailable." }); }
  }

  function openReview(timeframe: Timeframe, timestamp?: string) {
    setReviewFrame(timeframe);
    setCaptured(timestamp ?? "");
    setReadLabels(false);
    setPhotoError("");
    if (!config) request<{ canSave: boolean; visionAvailable: boolean }>("/api/analyst/screenshot").then(setConfig).catch(() => undefined);
  }

  function selectImage(timeframe: Timeframe, file?: File) {
    if (!file) return;
    const market = symbol;
    const update = (patch: Partial<ChartSlot>) => {
      if (marketRef.current === market) setSlots((previous) => ({ ...previous, [timeframe]: { ...previous[timeframe], ...patch } }));
    };
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 3_300_000) { update({ error: "Use PNG, JPEG or WebP under 3.3 MB." }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (marketRef.current !== market || typeof reader.result !== "string") return;
      update({ image: { name: file.name, data: reader.result }, review: undefined, captured: undefined, error: undefined });
      openReview(timeframe);
    };
    reader.onerror = () => update({ error: "Couldn’t read that image." });
    reader.readAsDataURL(file);
  }

  async function reviewPhoto(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewFrame) return;
    const timeframe = reviewFrame;
    const image = slots[timeframe]?.image;
    if (!image) return;
    setReviewing(true); setPhotoError("");
    try {
      const result = await request<Review>("/api/analyst/screenshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, timeframe, capturedAt: captured ? new Date(captured).toISOString() : undefined, imageDataUrl: image.data, readLabels }) });
      setSlots((previous) => ({ ...previous, [timeframe]: { ...previous[timeframe], review: result, captured } }));
    } catch (err) { setPhotoError(err instanceof Error ? err.message : "Couldn’t review the chart."); }
    finally { setReviewing(false); }
  }

  async function run() {
    setBusy(true); setRunError(""); setNotice(""); setPublished(false);
    try {
      const result = await request<{ analysis: DecisionEngineOutput }>("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, confidenceThreshold: threshold }) });
      setAnalysis(result.analysis); setNotice("Analysis saved to History.");
    } catch (err) { setRunError(err instanceof Error ? err.message : "Couldn’t run the analysis."); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!analysis) return;
    setPublishing(true); setNotice(""); setRunError("");
    try {
      await request("/api/signals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ai", symbol: analysis.symbol, confidenceThreshold: analysis.confidenceThreshold }) });
      setPublished(true); setNotice("Signal published.");
    } catch (err) { setRunError(err instanceof Error ? err.message : "Couldn’t publish the signal."); }
    finally { setPublishing(false); }
  }

  async function remove() {
    if (!selection) return;
    setRemoving(true); setDetailError("");
    try { await request(`/api/analyst/${selection.id}`, { method: "DELETE" }); setSelection(undefined); setRecord(undefined); await loadHistory(); }
    catch (err) { setDetailError(err instanceof Error ? err.message : "Couldn’t remove the record."); }
    finally { setRemoving(false); }
  }

  const visible = history?.filter((item) => `${item.symbol} ${shortMarket(item.symbol)} ${item.direction}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const locked = busy || reviewing || publishing;
  const reviewSlot = reviewFrame ? slots[reviewFrame] : undefined;
  const hasDepth = MARKET_GROUP[symbol] === "Gold" || MARKET_GROUP[symbol] === "Crypto";
  return <div className="freyr-primary-view">
    <PageHero title={view === "analyze" ? "Chart Analysis" : "Analysis history"} description={view === "analyze" ? "Choose a market and add a chart per timeframe for a top-down read." : "Saved chart reviews and analyses."} actions={<>
      <button type="button" className="freyr-icon-button sm:w-auto sm:px-3" onClick={() => setView(view === "analyze" ? "history" : "analyze")} aria-label={view === "analyze" ? "Analysis history" : "Back to Analyze"} title={view === "analyze" ? "Analysis history" : "Back to Analyze"}>
        {view === "analyze" ? <History size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
      </button>
      {navigation}
    </>} />
    {view === "analyze" ? <>
      <div className="space-y-2.5">
        <label className="block">
          <span className="freyr-label">Market</span>
          <span className="relative block"><select aria-label="Market" className="freyr-reference-select" value={symbol} onChange={(event) => changeMarket(event.target.value)} disabled={locked}>
            {Object.entries(MARKETS).map(([key, [label]]) => <option key={key} value={key}>{label}{key === "XAUUSD" ? " · Hyperliquid" : ""}</option>)}
          </select><ChevronsUpDown size={16} className="freyr-select-icon" aria-hidden="true" /></span>
        </label>
        <div className="flex flex-wrap gap-1.5"><Chip className="tracking-[0.07em] uppercase">{MARKET_GROUP[symbol]}</Chip><Chip className="tracking-[0.07em] uppercase">{hasDepth ? "Order book · L2" : "Reference feed"}</Chip></div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5" aria-label="Chart timeframe slots">
        {frames.map((timeframe, index) => {
          const slot = slots[timeframe];
          const tf = timeframe.toUpperCase();
          return <div key={index} className="min-w-0 space-y-1.5">
            <label className="relative block">
              <select aria-label={`Timeframe for ${tf} slot`} className="freyr-reference-select" value={timeframe} disabled={locked || slot?.busy} onChange={(event) => {
                const frame = event.target.value as Timeframe;
                setFrames((previous) => previous.map((selected, position) => position === index ? frame : selected));
              }}>
                {FRAMES.map((frame) => <option value={frame} key={frame} disabled={frame !== timeframe && frames.includes(frame)}>{frame.toUpperCase()}</option>)}
              </select><ChevronsUpDown size={15} className="freyr-select-icon" aria-hidden="true" />
            </label>
            {slot?.image ? <div className="freyr-panel relative overflow-hidden">
              <button type="button" className="group relative block aspect-[1.32] max-h-[190px] min-h-[114px] w-full overflow-hidden bg-canvas text-left" aria-label={`Review ${tf} chart`} onClick={() => openReview(timeframe, slot.captured)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slot.image.data} alt={`${tf} screenshot preview`} className="absolute inset-0 h-full w-full object-contain" />
                <span className="liquid-glass absolute inset-x-0 bottom-0 px-2.5 py-2 text-[11px] font-semibold text-ink">{slot.review ? "Open review" : `Review ${tf}`}</span>
              </button>
              <button type="button" className="liquid-glass absolute top-2 right-2 grid size-8 place-items-center rounded-full text-ink" aria-label={`Remove ${tf} screenshot`} disabled={locked} onClick={() => setSlots((previous) => ({ ...previous, [timeframe]: { candles: slot.candles, status: slot.status } }))}><X size={14} aria-hidden="true" /></button>
            </div> : slot?.candles ? <div className="freyr-panel overflow-hidden">
              <CandlestickChart symbol={symbol} candles={slot.candles} timeframe={timeframe} height={130} decimals={priceDecimals(symbol)} timezone={timezone} showVolume={false} />
              <div className="flex items-center justify-between gap-1 border-t border-outline px-2.5 py-1"><span className="text-[10px] text-ink-secondary">Feed chart</span><label className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] font-semibold text-ink-secondary focus-within:outline-2 focus-within:outline-accent">Attach image<input className="sr-only" type="file" aria-label={`Attach image for ${tf}`} accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(event) => { selectImage(timeframe, event.target.files?.[0]); event.target.value = ""; }} /></label></div>
            </div> : <label className="freyr-analysis-tile">
              <span className="freyr-upload-glyph"><Upload size={19} strokeWidth={1.8} aria-hidden="true" /></span>
              <span>{slot?.busy ? "Loading chart…" : `Add ${tf}`}</span>
              <input className="sr-only" type="file" aria-label={`Add ${tf} chart`} accept="image/png,image/jpeg,image/webp" disabled={locked || slot?.busy} onChange={(event) => { selectImage(timeframe, event.target.files?.[0]); event.target.value = ""; }} />
            </label>}
            {slot?.error && <p className="px-1 text-[11px] text-bear" role="alert">{slot.error}</p>}
          </div>;
        })}
      </div>
      <div className="freyr-section-caption flex-wrap">
        <p className="max-w-[44ch] text-[12px] leading-relaxed text-ink-secondary">Tip: review the highest timeframe first. More timeframes give a clearer top-down read.</p>
        <button type="button" className="min-h-8 rounded-md text-[12px] font-semibold text-ink-secondary hover:underline disabled:opacity-50" disabled={locked || frames.some((frame) => slots[frame]?.busy) || frames.every((frame) => slots[frame]?.candles || slots[frame]?.image)} onClick={() => { for (const frame of frames) if (!slots[frame]?.candles && !slots[frame]?.image) void loadChart(frame); }}>Load market charts</button>
      </div>
      <section className="freyr-panel space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-[16px] font-semibold">Top-down analysis</h2><p className="mt-0.5 text-[12px] text-ink-secondary">Direction, structure and entry context.</p></div><Button variant="primary" onClick={() => void run()} disabled={locked}>{busy ? "Analyzing…" : "Run analysis"}</Button></div>
        <label className="flex flex-wrap items-center gap-3 text-[12px] text-ink-secondary">Minimum confidence <input min={50} max={85} type="range" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="freyr-range min-w-16 flex-1" /><span className="tabular-nums">{threshold}%</span></label>
        {runError && <ErrorBanner message={runError} />}{notice && <p role="status" className="text-[12px] text-ink-secondary">{notice}</p>}
        {analysis && <div className="space-y-3.5 border-t border-ink/[0.08] pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2"><DirectionBadge direction={analysis.direction} /><DataStatusBadge status={analysis.dataStatus} /></div>
          <p className="text-[13px] leading-relaxed text-ink-secondary">{analysis.setupExplanation}</p>
          {analysis.direction !== "NEUTRAL" && analysis.entryPrice > 0 && <PricePlan result={analysis} symbol={symbol} />}
          <details className="freyr-inset p-3 text-[12px] text-ink-secondary"><summary className="cursor-pointer font-medium text-ink">Evidence and invalidation</summary><p className="mt-2">{analysis.entryConditions}</p><ul className="mt-2 list-disc space-y-1.5 pl-4">{[...analysis.supportingEvidence, ...analysis.invalidationConditions].map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></details>
          {analysis.setupState === "VALID" && (published ? <Button variant="secondary" onClick={() => onNavigate("signals")}>Open Signals</Button> : <Button variant="secondary" onClick={() => void publish()} disabled={locked}>Evaluate and publish signal</Button>)}
        </div>}
      </section>
    </> : <section aria-label="Analysis history" className="space-y-3.5">
      <label className="block"><span className={LABEL_CLS}>Search archive</span><input value={filter} onChange={(event) => setFilter(event.target.value)} className={INPUT_CLS} type="search" placeholder="Market or direction" /></label>
      {historyError && <ErrorBanner message={historyError} onRetry={() => void loadHistory()} />}
      {!history && !historyError ? <PanelSkeleton rows={4} /> : visible?.length ? <div className="space-y-2">{visible.map((item) => <button type="button" key={item.id} onClick={() => { setRecord(undefined); setDetailError(""); setConfirmRemove(false); setSelection(item); }} className="freyr-row flex w-full items-center justify-between gap-2 p-3.5 text-left">
        <div className="min-w-0"><span className="block text-[14px] font-semibold text-ink">{shortMarket(item.symbol)}</span><span className="text-[11.5px] text-ink-secondary">{formatDateTime(item.createdAt, timezone, { short: true })} · {item.setupState === "REVIEW" ? "Screenshot review" : "Market analysis"}</span></div><div className="flex items-center gap-1.5"><Chip>{item.timeframes.map((timeframe) => timeframe.toUpperCase()).join(" · ")}</Chip><ChevronRight className="text-ink-secondary" size={15} aria-hidden="true" /></div>
      </button>)}</div> : !historyError && <EmptyState title={filter ? "No matching analyses" : "No saved analyses yet"} description={filter ? "Search by market or direction." : "Run a market analysis or save a screenshot review to see it here."} />}
    </section>}
    <ModalSheet open={Boolean(reviewFrame && reviewSlot?.image)} onClose={() => setReviewFrame(undefined)} title={reviewFrame ? `${reviewFrame.toUpperCase()} screenshot review` : "Screenshot review"} subtitle={`${shortMarket(symbol)} · ModFlow`} maxWidth="max-w-2xl">
      {reviewFrame && reviewSlot?.image && <div className="space-y-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={reviewSlot.image.data} alt="Chart screenshot selected for order-flow review" className="max-h-52 w-full rounded-xl bg-black object-contain" />
        <form onSubmit={reviewPhoto} className="space-y-3">
          <label className="block"><span className={LABEL_CLS}>Chart time · optional</span><input className={INPUT_CLS} type="datetime-local" value={captured} disabled={reviewing} onChange={(event) => setCaptured(event.target.value)} /></label>
          <p className="text-[11.5px] leading-relaxed text-ink-secondary">Use your device’s timezone. Leave the time blank for a current-market review. ModFlow uses the selected timeframe and the corresponding market data.</p>
          {config?.visionAvailable && <label className="flex items-start gap-2 text-[12px] text-ink-secondary"><input type="checkbox" checked={readLabels} onChange={(event) => setReadLabels(event.target.checked)} disabled={reviewing} className="mt-0.5 accent-ink-secondary" /> Read chart labels with OpenAI. This sends the image to the configured provider.</label>}
          {photoError && <ErrorBanner message={photoError} />}
          <div className="flex flex-wrap items-center gap-2.5"><Button type="submit" variant="primary" disabled={reviewing}>{reviewing ? "Reviewing…" : "Review with ModFlow"}</Button>{config && !config.canSave && <Button variant="ghost" size="sm" onClick={() => onNavigate("settings")}>Sign in to save</Button>}</div>
        </form>
        {reviewSlot.review && <div className="space-y-3 border-t border-outline pt-3.5" aria-label="Order-flow review"><SectionLabel>Order-flow review</SectionLabel><Snapshot value={reviewSlot.review.snapshot} symbol={reviewSlot.review.market} timezone={timezone} /><FlowSummary value={reviewSlot.review.snapshot} symbol={reviewSlot.review.market} /><p className="text-[12px] leading-relaxed text-ink-secondary">{reviewSlot.review.explanation}</p>{reviewSlot.review.saved && <Button variant="secondary" onClick={() => { setReviewFrame(undefined); setView("history"); }}>Open history</Button>}</div>}
      </div>}
    </ModalSheet>
    <ModalSheet open={Boolean(selection)} onClose={() => setSelection(undefined)} title={selection ? `${shortMarket(selection.symbol)} analysis` : "Analysis"} subtitle={selection ? formatDateTime(selection.createdAt, timezone) : undefined} maxWidth="max-w-2xl">
      <div className="space-y-3.5">
        {detailError && <ErrorBanner message={detailError} />}
        {!record && !detailError && <PanelSkeleton rows={5} />}
        {record && <>
          {record.chartScreenshot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={record.chartScreenshot} alt="Original trader-uploaded chart" className="max-h-52 w-full rounded-xl bg-black object-contain" />
          )}
          {record.chartSnapshot ? <Snapshot value={record.chartSnapshot} symbol={record.symbol} timezone={timezone} guide={record.setupState !== "REVIEW" && record.direction !== "NEUTRAL" && record.entryPrice > 0 ? { entry: record.entryPrice, stopLoss: record.stopLoss, takeProfit: record.takeProfit } : undefined} /> : <p className="freyr-inset p-3 text-[12px] text-ink-secondary">This report predates saved chart data. Its original findings are shown below.</p>}
          {record.setupState === "REVIEW" && record.chartSnapshot ? <FlowSummary value={record.chartSnapshot} symbol={record.symbol} /> : record.direction !== "NEUTRAL" && record.entryPrice > 0 && <PricePlan result={record} symbol={record.symbol} />}
          <p className="text-[12.5px] leading-relaxed text-ink-secondary">{record.setupExplanation}</p>
          {record.supportingEvidence.length > 0 && <details className="freyr-inset p-3 text-[12px] text-ink-secondary"><summary className="cursor-pointer font-medium text-ink">Saved evidence</summary><ul className="mt-2 list-disc space-y-1.5 pl-4">{[...record.supportingEvidence, ...record.invalidationConditions].map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></details>}
          {confirmRemove ? <div className="flex flex-wrap items-center gap-2"><span className="text-[12px] text-ink-secondary">Remove this analysis and any attached chart?</span><Button variant="danger" size="sm" disabled={removing} onClick={() => void remove()}>Remove</Button><Button variant="ghost" size="sm" disabled={removing} onClick={() => setConfirmRemove(false)}>Cancel</Button></div> : <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>Remove from history</Button>}
        </>}
      </div>
    </ModalSheet>
  </div>;
}

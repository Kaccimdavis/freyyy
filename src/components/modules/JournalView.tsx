"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import {
  Button,
  DirectionBadge,
  EmptyState,
  ErrorBanner,
  INPUT_CLS,
  KpiStat,
  LABEL_CLS,
  ModalSheet,
  Panel,
  PanelSkeleton,
  cn,
  formatCurrency,
  formatDateTime,
  cleanCopy,
  formatPrice,
} from "@/components/ui/primitives";

interface JournalEntry {
  id: number;
  symbol: string;
  direction: "BUY" | "SELL";
  session: string;
  strategyName: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  riskPercent: number;
  pnlAmount: number;
  pnlR: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  screenshotUrl: string | null;
  notes: string;
  mistakeTag: string;
  lessonLearned: string;
  tradedAt: string;
}

interface JournalSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  netPnl: number;
  profitFactor: number;
  bestSession: string;
  bestStrategy: string;
  topMistake: string;
}

const MISTAKE_TAGS = [
  "None",
  "Early Entry",
  "Chased Move",
  "Off-Session Trade",
  "Ignored News Event",
  "Oversized Position",
  "Moved Stop Loss",
  "Exited Too Early",
  "Counter Order Flow",
  "Revenge Trade",
];

export function JournalView({ timezone }: { timezone: string }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [byMonth, setByMonth] = useState<Array<{ name: string; trades: number; winRate: number; pnl: number }>>([]);
  const [mistakes, setMistakes] = useState<Array<{ tag: string; count: number; totalImpact: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [filterOutcome, setFilterOutcome] = useState<string>("ALL");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    symbol: "XAUUSD",
    direction: "BUY" as "BUY" | "SELL",
    session: "London" as "Asian" | "London" | "New York",
    strategyName: "London Sweep & BOS Continuation",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    takeProfit: "",
    lotSize: "0.75",
    riskPercent: "0.75",
    pnlAmount: "",
    screenshotUrl: "",
    mistakeTag: "None",
    notes: "",
    lessonLearned: "",
    tradedAt: new Date().toISOString().slice(0, 16),
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/journal", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setEntries(j.entries ?? []);
      setSummary(j.analytics?.summary ?? null);
      setByMonth(j.analytics?.byMonth ?? []);
      setMistakes(j.analytics?.mistakes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load journal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.size > 350_000) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setForm((p) => ({ ...p, screenshotUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol,
          direction: form.direction,
          session: form.session,
          strategyName: form.strategyName,
          entryPrice: Number(form.entryPrice),
          exitPrice: Number(form.exitPrice),
          stopLoss: Number(form.stopLoss),
          takeProfit: Number(form.takeProfit),
          lotSize: Number(form.lotSize),
          riskPercent: Number(form.riskPercent),
          pnlAmount: Number(form.pnlAmount),
          screenshotUrl: form.screenshotUrl || null,
          mistakeTag: form.mistakeTag,
          notes: form.notes,
          lessonLearned: form.lessonLearned,
          tradedAt: form.tradedAt ? new Date(form.tradedAt).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error || "Failed to log trade");
        return;
      }
      setModalOpen(false);
      setForm((p) => ({
        ...p,
        entryPrice: "",
        exitPrice: "",
        stopLoss: "",
        takeProfit: "",
        pnlAmount: "",
        screenshotUrl: "",
        notes: "",
        lessonLearned: "",
      }));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  if (loading && !summary) return <PanelSkeleton rows={7} />;

  const visible = filterOutcome === "ALL" ? entries : entries.filter((e) => e.outcome === filterOutcome);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={load} />}

      {/* Auto-calculated journal stats */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiStat
            label="Win Rate"
            value={`${summary.winRate}%`}
            sub={`${summary.wins}W / ${summary.losses}L`}
            tone={summary.winRate >= 50 ? "bull" : "neutral"}
          />
          <KpiStat
            label="Net P&L"
            value={formatCurrency(summary.netPnl, true)}
            sub={`${summary.totalTrades} trades`}
            tone={summary.netPnl >= 0 ? "bull" : "bear"}
          />
          <KpiStat label="Profit Factor" value={summary.profitFactor.toFixed(2)} sub="Gross W / L" tone="gold" />
          <KpiStat label="Avg Profit" value={formatCurrency(summary.avgProfit)} sub="Winning mean" tone="bull" />
          <KpiStat label="Avg Loss" value={`-${formatCurrency(summary.avgLoss)}`} sub="Losing mean" tone="bear" />
          <KpiStat label="Best Session" value={summary.bestSession} sub="Highest net P&L" />
          <KpiStat label="Top Mistake" value={summary.topMistake} sub={summary.bestStrategy} />
        </div>
      )}

      {/* Compact insights bar: Mistakes + Monthly Breakdown */}
      {(mistakes.length > 0 || byMonth.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Monthly Performance" subtitle="Auto-aggregated from logged fills">
            {byMonth.length === 0 ? (
              <p className="text-[12px] text-ink-secondary">No monthly data yet.</p>
            ) : (
              <div className="space-y-2 font-mono text-[11.5px] tabular-nums">
                {byMonth.map((m) => (
                  <div key={m.name} className="freyr-card flex items-center justify-between px-3 py-2">
                    <span className="text-ink">{m.name}</span>
                    <span className="text-ink-secondary">{m.trades} trades · {m.winRate}% WR</span>
                    <span className={m.pnl >= 0 ? "text-bull font-medium" : "text-bear font-medium"}>
                      {formatCurrency(m.pnl, true)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Most Common Mistakes" subtitle="Quantified cost of behavioral deviations">
            {mistakes.length === 0 ? (
              <p className="text-[12px] text-bull">Zero recurring execution mistakes logged.</p>
            ) : (
              <div className="space-y-2 text-[12px]">
                {mistakes.map((m) => (
                  <div key={m.tag} className="freyr-card flex items-center justify-between px-3 py-2">
                    <span className="text-ink">{m.tag}</span>
                    <div className="flex items-center gap-3 font-mono text-[11.5px] tabular-nums">
                      <span className="text-ink-secondary">{m.count}×</span>
                      <span className={m.totalImpact >= 0 ? "text-bull" : "text-bear"}>
                        {formatCurrency(m.totalImpact, true)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {["ALL", "WIN", "LOSS", "BREAKEVEN"].map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setFilterOutcome(o)}
              aria-pressed={filterOutcome === o}
              className="freyr-selectable rounded-lg bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-ink-secondary cursor-pointer"
            >
              {o === "ALL" ? `All (${entries.length})` : o}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Log Trade
        </Button>
      </div>

      {/* Trade Entries */}
      {visible.length === 0 ? (
        <EmptyState
          title="No trades match this filter"
          description="Record executions with entry, stop, target, strategy, mistake tag, screenshot, and lessons learned."
          action={<Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>Log Trade</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((e) => (
            <Panel key={e.id} bodyClassName="p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DirectionBadge direction={e.direction} />
                    <span className="text-[13.5px] font-semibold text-ink">{e.symbol}</span>
                    <span className="rounded bg-ink/[0.05] px-1.5 py-0.5 text-[10px] text-ink-secondary">{e.session}</span>
                    <span className="text-[11.5px] text-ink-secondary">{e.strategyName}</span>
                    {e.mistakeTag && e.mistakeTag !== "None" && (
                      <span className="rounded bg-bear/12 px-1.5 py-0.5 text-[10px] text-bear">
                        {e.mistakeTag}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-secondary tabular-nums">
                    <span>E {formatPrice(e.entryPrice)} → X {formatPrice(e.exitPrice)}</span>
                    <span>SL {formatPrice(e.stopLoss)}</span>
                    <span>TP {formatPrice(e.takeProfit)}</span>
                    <span>{e.lotSize} lot · {e.riskPercent}% risk</span>
                    <span className="text-ink-secondary">{formatDateTime(e.tradedAt, timezone, { short: true })}</span>
                  </div>
                  {e.notes && <p className="mt-1.5 text-[12px] text-ink">{cleanCopy(e.notes)}</p>}
                  {e.lessonLearned && (
                    <p className="mt-1 text-[11px] text-ink-secondary">
                      <span className="text-ink-secondary">Lesson:</span> {cleanCopy(e.lessonLearned)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {e.screenshotUrl && (
                    <button
                      type="button"
                      onClick={() => setPreviewImg(e.screenshotUrl)}
                      aria-label="Preview trade screenshot"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/[0.1] bg-elevated text-ink-secondary hover:bg-ink/[0.08] cursor-pointer"
                    >
                      <ImageIcon className="h-4 w-4" />
                    </button>
                  )}
                  <div className="text-right font-mono tabular-nums">
                    <div
                      className={cn(
                        "text-[15px] font-semibold",
                        e.pnlAmount > 0 ? "text-bull" : e.pnlAmount < 0 ? "text-bear" : "text-ink-secondary"
                      )}
                    >
                      {formatCurrency(e.pnlAmount, true)}
                    </div>
                    <div className="text-[10.5px] text-ink-secondary">
                      {e.pnlR >= 0 ? "+" : ""}{e.pnlR.toFixed(2)}R · {e.outcome}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(e.id)}
                    aria-label="Delete trade entry"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-tertiary hover:bg-bear/10 hover:text-bear cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* New Trade Entry Modal */}
      <ModalSheet
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Log Completed Trade"
        subtitle="Automatically recalculates performance analytics, profit factor, session edge, and journal streaks."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div>
              <label className={LABEL_CLS}>Instrument</label>
              <select value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className={INPUT_CLS}>
                {["XAUUSD", "EURUSD", "GBPUSD", "US500", "NAS100", "BTCUSD", "ETHUSD", "SOLUSD"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Direction</label>
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "BUY" | "SELL" })} className={INPUT_CLS}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Session</label>
              <select value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value as "Asian" | "London" | "New York" })} className={INPUT_CLS}>
                <option value="London">London</option>
                <option value="New York">New York</option>
                <option value="Asian">Asian</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Trade Date</label>
              <input type="datetime-local" value={form.tradedAt} onChange={(e) => setForm({ ...form, tradedAt: e.target.value })} className={cn(INPUT_CLS, "font-mono text-[11px]")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div>
              <label className={LABEL_CLS}>Entry Price</label>
              <input required type="number" step="any" value={form.entryPrice} onChange={(e) => setForm({ ...form, entryPrice: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Exit Price</label>
              <input required type="number" step="any" value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Stop Loss</label>
              <input required type="number" step="any" value={form.stopLoss} onChange={(e) => setForm({ ...form, stopLoss: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Take Profit</label>
              <input required type="number" step="any" value={form.takeProfit} onChange={(e) => setForm({ ...form, takeProfit: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Strategy Used</label>
              <input required value={form.strategyName} onChange={(e) => setForm({ ...form, strategyName: e.target.value })} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Risk % / Lots</label>
              <div className="flex gap-1.5">
                <input type="number" step="0.05" value={form.riskPercent} onChange={(e) => setForm({ ...form, riskPercent: e.target.value })} className={cn(INPUT_CLS, "font-mono")} title="Risk %" />
                <input type="number" step="0.01" value={form.lotSize} onChange={(e) => setForm({ ...form, lotSize: e.target.value })} className={cn(INPUT_CLS, "font-mono")} title="Lot size" />
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Net P&L ($)</label>
              <input required type="number" step="any" value={form.pnlAmount} onChange={(e) => setForm({ ...form, pnlAmount: e.target.value })} placeholder="e.g. 1250 or -650" className={cn(INPUT_CLS, "font-mono")} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>Mistake Categorization</label>
              <select value={form.mistakeTag} onChange={(e) => setForm({ ...form, mistakeTag: e.target.value })} className={INPUT_CLS}>
                {MISTAKE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Chart Screenshot (URL or upload &lt;350KB)</label>
              <div className="flex gap-1.5">
                <input value={form.screenshotUrl} onChange={(e) => setForm({ ...form, screenshotUrl: e.target.value })} placeholder="https://… or pick image" className={INPUT_CLS} />
                <label className="flex h-9 shrink-0 items-center rounded-lg border border-ink/[0.1] bg-elevated px-2.5 text-[11px] text-ink hover:bg-ink/[0.08] cursor-pointer">
                  File
                  <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Execution Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Market context, liquidity confirmation, ModFlow read" className={cn(INPUT_CLS, "h-auto py-2")} />
          </div>

          <div>
            <label className={LABEL_CLS}>Lesson Learned</label>
            <input value={form.lessonLearned} onChange={(e) => setForm({ ...form, lessonLearned: e.target.value })} placeholder="Key repeatable rule reinforced by this trade" className={INPUT_CLS} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save Entry"}</Button>
          </div>
        </form>
      </ModalSheet>

      {/* Screenshot Preview Modal */}
      <ModalSheet open={Boolean(previewImg)} onClose={() => setPreviewImg(null)} title="Trade Screenshot" maxWidth="max-w-3xl">
        {previewImg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewImg} alt="Logged trade chart" className="max-h-[65vh] w-full rounded-lg object-contain bg-black" />
        )}
      </ModalSheet>
    </div>
  );
}

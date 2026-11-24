"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Plus, Trash2 } from "lucide-react";
import type { StrategyRuleSet } from "@/db/schema";
import {
  Button,
  EmptyState,
  ErrorBanner,
  INPUT_CLS,
  LABEL_CLS,
  ModalSheet,
  Panel,
  PanelSkeleton,
  Switch,
  cn,
  formatCurrency,
  type NavTab,
} from "@/components/ui/primitives";

interface StrategyRecord {
  id: number;
  name: string;
  description: string;
  instrument: string;
  htfTimeframe: string;
  ltfTimeframe: string;
  executionTimeframe: string;
  directionBias: string;
  indicators: string[];
  rules: StrategyRuleSet;
  confirmationsRequired: number;
  minConfidence: number;
  minRiskReward: number;
  sessionFilters: string[];
  isActive: boolean;
  isTested: boolean;
  lastBacktestWinRate: number | null;
  lastBacktestProfitFactor: number | null;
  performance: {
    journalTrades: number;
    winRate: number | null;
    netPnl: number;
    signalCount: number;
  };
}

const INDICATOR_OPTIONS = [
  "Market Structure (BOS/CHoCH)",
  "Liquidity Sweep",
  "Order Blocks",
  "Fair Value Gaps",
  "ModFlow Volume Delta",
  "ModFlow CVD",
  "ModFlow Absorption",
  "Volume Profile POC/VA",
  "EMA 20/50",
  "Session High/Low",
  "ATR Volatility",
  "L2 Book Imbalance",
];

const LOGIC_OPTIONS: Array<{ value: StrategyRuleSet["logicType"]; label: string }> = [
  { value: "liquidity_sweep_bos", label: "Liquidity Sweep & BOS Continuation" },
  { value: "ob_cvd_confluence", label: "Order Block + CVD Confluence" },
  { value: "fvg_absorption_pullback", label: "FVG + ModFlow Absorption Pullback" },
  { value: "session_range_reversal", label: "Session Range Liquidity Reversal" },
  { value: "custom_structure", label: "Multi-Timeframe Structure Pullback" },
];

export function StrategiesView({
  onBacktestStrategy,
}: {
  onBacktestStrategy: (strategyId: number, symbol: string) => void;
  onNavigate?: (tab: NavTab) => void;
}) {
  const [list, setList] = useState<StrategyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    instrument: "XAUUSD",
    htfTimeframe: "1h",
    ltfTimeframe: "15m",
    executionTimeframe: "5m",
    directionBias: "BOTH",
    logicType: "liquidity_sweep_bos" as StrategyRuleSet["logicType"],
    indicators: ["Market Structure (BOS/CHoCH)", "ModFlow Volume Delta", "Liquidity Sweep"],
    confirmationsRequired: 3,
    minConfidence: 68,
    minRiskReward: 2.2,
    slAtrMultiple: 1.4,
    tpRiskMultiple: 2.3,
    sessionFilters: ["London", "New York"] as string[],
    entryConditions: "Wait for liquidity sweep beyond session range followed by decisive M15 BOS\nEnter pullback into unmitigated OB or FVG with aligned ModFlow delta",
    exitConditions: "Set one take profit at the opposing liquidity pool.",
    confirmations: "H1 directional alignment\nModFlow positive/negative CVD agreement\nClear USD news schedule",
    invalidationConditions: "M15 candle close beyond structural stop price",
    requireOrderFlow: true,
    requireLiquiditySweep: true,
    requireStructureShift: true,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/strategies", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setList(j.strategies ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load strategies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (st: StrategyRecord, next: boolean) => {
    setList((prev) => prev.map((x) => (x.id === st.id ? { ...x, isActive: next } : x)));
    await fetch(`/api/strategies/${st.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    if (res.ok) setList((prev) => prev.filter((x) => x.id !== id));
  };

  const toggleArr = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(null);
    setSubmitting(true);
    const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          instrument: form.instrument,
          htfTimeframe: form.htfTimeframe,
          ltfTimeframe: form.ltfTimeframe,
          executionTimeframe: form.executionTimeframe,
          directionBias: form.directionBias,
          indicators: form.indicators,
          confirmationsRequired: Number(form.confirmationsRequired),
          minConfidence: Number(form.minConfidence),
          minRiskReward: Number(form.minRiskReward),
          sessionFilters: form.sessionFilters,
          isActive: false, // encourage backtesting before activation
          rules: {
            entryConditions: lines(form.entryConditions),
            exitConditions: lines(form.exitConditions),
            confirmations: lines(form.confirmations),
            invalidationConditions: lines(form.invalidationConditions),
            logicType: form.logicType,
            slAtrMultiple: Number(form.slAtrMultiple),
            tpRiskMultiple: Number(form.tpRiskMultiple),
            emaFast: 12,
            emaSlow: 30,
            requireOrderFlow: form.requireOrderFlow,
            requireLiquiditySweep: form.requireLiquiditySweep,
            requireStructureShift: form.requireStructureShift,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setFormErr(j.error || "Unable to save strategy");
        return;
      }
      setBuilderOpen(false);
      setForm((p) => ({ ...p, name: "", description: "" }));
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PanelSkeleton rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[12px] text-ink-secondary">
            Institutional price-action, liquidity, and ModFlow strategies. Backtest every new framework prior to enabling signal publishing.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setBuilderOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New Strategy
        </Button>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {list.length === 0 ? (
        <EmptyState
          title="No trading strategies configured"
          description="Create a structured multi-timeframe strategy with explicit confirmation rules, session filters, and risk parameters."
          action={<Button variant="primary" size="sm" onClick={() => setBuilderOpen(true)}>Create Strategy</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((st) => (
            <Panel key={st.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-ink">{st.name}</h3>
                      <span className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary">
                        {st.instrument}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-ink-secondary">
                      <span>{st.htfTimeframe.toUpperCase()} → {st.ltfTimeframe.toUpperCase()} → {st.executionTimeframe.toUpperCase()}</span>
                      <span>·</span>
                      <span>Min {st.minRiskReward}:1 R:R</span>
                      <span>·</span>
                      <span>≥{st.minConfidence}% conf</span>
                      <span>·</span>
                      <span>{st.confirmationsRequired} confirms</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10.5px]", st.isActive ? "text-bull" : "text-ink-tertiary")}>
                      {st.isActive ? "Active" : "Paused"}
                    </span>
                    <Switch checked={st.isActive} onChange={(v) => toggleActive(st, v)} label={`Toggle ${st.name}`} />
                  </div>
                </div>

                <p className="mt-2.5 text-[12px] leading-relaxed text-ink-secondary">{st.description}</p>

                {/* Sessions + Tested status */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {st.sessionFilters.map((sess) => (
                    <span key={sess} className="rounded-md border border-ink/[0.08] bg-elevated px-2 py-0.5 text-[10px] text-ink">
                      {sess}
                    </span>
                  ))}
                  {st.isTested ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-bull/25 bg-bull/[0.08] px-2 py-0.5 text-[10px] text-bull">
                      <CheckCircle2 className="h-3 w-3" /> Backtested
                      {st.lastBacktestWinRate !== null ? ` (${st.lastBacktestWinRate}% sim WR)` : ""}
                    </span>
                  ) : (
                    <span className="rounded-md border border-outline bg-inset px-2 py-0.5 text-[10px] text-ink-secondary">
                      Untested — Run Backtest
                    </span>
                  )}
                </div>

                {/* Rule details */}
                <div className="mt-3 rounded-lg border border-ink/[0.06] bg-inset p-3 text-[11px] space-y-1.5">
                  <div className="text-[10px] font-medium text-ink-tertiary uppercase">Entry & Confirmation Logic</div>
                  {st.rules.entryConditions.slice(0, 2).map((r, i) => (
                    <p key={i} className="text-ink-secondary">• {r}</p>
                  ))}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {st.indicators.map((ind) => (
                      <span key={ind} className="rounded bg-ink/[0.05] px-1.5 py-0.5 text-[9.5px] text-ink-secondary">
                        {ind}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Performance + Footer */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink/[0.06] pt-3">
                <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-ink-secondary">
                  <span>
                    Win:{" "}
                    <strong className="text-ink">
                      {st.performance.winRate !== null ? `${st.performance.winRate}%` : "—"}
                    </strong>
                  </span>
                  <span>
                    Journal:{" "}
                    <strong className={st.performance.netPnl >= 0 ? "text-bull" : "text-bear"}>
                      {st.performance.journalTrades > 0 ? formatCurrency(st.performance.netPnl, true) : "0 trades"}
                    </strong>
                  </span>
                  <span>Signals: {st.performance.signalCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onBacktestStrategy(st.id, st.instrument)}
                  >
                    <FlaskConical className="h-3.5 w-3.5 text-ink-secondary" /> Test
                  </Button>
                  <button
                    type="button"
                    onClick={() => remove(st.id)}
                    aria-label={`Delete ${st.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/[0.08] text-ink-secondary hover:border-bear/35 hover:text-bear cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* Strategy Builder Modal */}
      <ModalSheet
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title="Build Institutional Strategy"
        subtitle="New strategies initialize paused so you can run a historical backtest before enabling signal publishing."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreate} className="space-y-3.5">
          {formErr && <ErrorBanner message={formErr} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={LABEL_CLS}>Strategy Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. London PDH Sweep + Order Block"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Primary Instrument</label>
              <select value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} className={INPUT_CLS}>
                {["XAUUSD", "EURUSD", "GBPUSD", "US500", "NAS100", "BTCUSD", "ETHUSD", "SOLUSD"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Strategy Thesis & Objective</label>
            <input
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Concise institutional thesis combining structure, liquidity, and order flow"
              className={INPUT_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div>
              <label className={LABEL_CLS}>Backtest Engine Logic</label>
              <select
                value={form.logicType}
                onChange={(e) => setForm({ ...form, logicType: e.target.value as StrategyRuleSet["logicType"] })}
                className={INPUT_CLS}
              >
                {LOGIC_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>HTF Bias</label>
              <select value={form.htfTimeframe} onChange={(e) => setForm({ ...form, htfTimeframe: e.target.value })} className={INPUT_CLS}>
                {["1h", "4h", "1d", "15m"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Structure TF</label>
              <select value={form.ltfTimeframe} onChange={(e) => setForm({ ...form, ltfTimeframe: e.target.value })} className={INPUT_CLS}>
                {["15m", "5m", "1h"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Execution TF</label>
              <select value={form.executionTimeframe} onChange={(e) => setForm({ ...form, executionTimeframe: e.target.value })} className={INPUT_CLS}>
                {["3m", "5m", "15m"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className={LABEL_CLS}>Min Confirmations</label>
              <input type="number" min={2} max={6} value={form.confirmationsRequired} onChange={(e) => setForm({ ...form, confirmationsRequired: Number(e.target.value) })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Min Confidence %</label>
              <input type="number" min={50} max={92} value={form.minConfidence} onChange={(e) => setForm({ ...form, minConfidence: Number(e.target.value) })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Min R:R Target</label>
              <input type="number" step="0.1" min={1.2} max={6} value={form.minRiskReward} onChange={(e) => setForm({ ...form, minRiskReward: Number(e.target.value) })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Allowed Trading Sessions</label>
            <div className="flex flex-wrap gap-2">
              {["Asian", "London", "New York"].map((sess) => {
                const on = form.sessionFilters.includes(sess);
                return (
                  <button
                    key={sess}
                    type="button"
                    onClick={() => {
                      const next = toggleArr(form.sessionFilters, sess);
                      if (next.length > 0) setForm({ ...form, sessionFilters: next });
                    }}
                    aria-pressed={on}
                    className="freyr-selectable rounded-lg bg-inset px-3 py-1.5 text-[12px] text-ink-secondary cursor-pointer"
                  >
                    {sess}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Required Indicators & Tools</label>
            <div className="flex flex-wrap gap-1.5">
              {INDICATOR_OPTIONS.map((ind) => {
                const on = form.indicators.includes(ind);
                return (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => {
                      const next = toggleArr(form.indicators, ind);
                      if (next.length > 0) setForm({ ...form, indicators: next });
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[10.5px] cursor-pointer",
                      on
                        ? "border-ink/25 bg-ink/[0.1] text-ink"
                        : "border-ink/[0.06] text-ink-tertiary hover:text-ink-secondary"
                    )}
                  >
                    {ind}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>Entry Rules (one per line)</label>
              <textarea rows={3} value={form.entryConditions} onChange={(e) => setForm({ ...form, entryConditions: e.target.value })} className={cn(INPUT_CLS, "h-auto py-2")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Exit & Invalidation Rules</label>
              <textarea rows={3} value={form.exitConditions} onChange={(e) => setForm({ ...form, exitConditions: e.target.value })} className={cn(INPUT_CLS, "h-auto py-2")} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setBuilderOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save Strategy"}
            </Button>
          </div>
        </form>
      </ModalSheet>
    </div>
  );
}

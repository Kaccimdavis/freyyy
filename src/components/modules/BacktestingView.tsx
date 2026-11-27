"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, FlaskConical, Play } from "lucide-react";
import type { BacktestTradeRecord, EquityPoint } from "@/db/schema";
import {
  Button,
  DataStatusBadge,
  DirectionBadge,
  EmptyState,
  ErrorBanner,
  INPUT_CLS,
  KpiStat,
  LABEL_CLS,
  Panel,
  SegmentedControl,
  cn,
  formatCurrency,
  formatDateTime,
  formatPrice,
} from "@/components/ui/primitives";
import { EquityCurveChart } from "@/components/charts/AnalyticsCharts";

interface BacktestRun {
  id: number;
  strategyId: number | null;
  strategyName: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  riskPercent: number;
  slAtrMultiple: number;
  tpRiskMultiple: number;
  spreadPoints: number;
  commissionPerLot: number;
  sessionFilter: string;
  dataSource: string;
  isSimulated: boolean;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  netProfit: number;
  avgRiskReward: number;
  expectedValue: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  equityCurve: EquityPoint[];
  trades: BacktestTradeRecord[];
  createdAt: string;
}

interface StrategyOpt {
  id: number;
  name: string;
  instrument: string;
}

export function BacktestingView({
  initialStrategyId,
  initialSymbol,
  timezone,
}: {
  initialStrategyId: number | null;
  initialSymbol?: string;
  timezone: string;
}) {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [strategies, setStrategies] = useState<StrategyOpt[]>([]);
  const [activeRun, setActiveRun] = useState<BacktestRun | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [curveMode, setCurveMode] = useState<"equity" | "drawdown">("equity");
  const [running, setRunning] = useState(false);
  const [reverseRunning, setReverseRunning] = useState(false);
  const [reverseResult, setReverseResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [cfg, setCfg] = useState({
    strategyId: initialStrategyId ? String(initialStrategyId) : "",
    symbol: initialSymbol || "XAUUSD",
    timeframe: "1h",
    startDate: monthAgo,
    endDate: today,
    initialBalance: "100000",
    riskPercent: "0.75",
    slAtrMultiple: "1.4",
    tpRiskMultiple: "2.2",
    spreadPoints: "2.5",
    commissionPerLot: "7",
    sessionFilter: "ALL",
  });

  useEffect(() => {
    if (initialStrategyId) {
      setCfg((p) => ({ ...p, strategyId: String(initialStrategyId), symbol: initialSymbol || p.symbol }));
    }
  }, [initialStrategyId, initialSymbol]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/backtest", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setRuns(j.runs ?? []);
      setStrategies(j.strategies ?? []);
      if (j.runs?.[0] && !activeRun) setActiveRun(j.runs[0]);
      if (!cfg.strategyId && j.strategies?.[0]) {
        setCfg((p) => ({ ...p, strategyId: String(j.strategies[0].id) }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load backtesting archive");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const execute = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: cfg.strategyId && cfg.strategyId !== "asian_session_liquidity_reversal" ? Number(cfg.strategyId) : undefined,
          ...(cfg.strategyId === "asian_session_liquidity_reversal" ? { strategyName: "Asian Session Liquidity Reversal (Experimental)", logicType: "asian_session_liquidity_reversal" } : {}),
          symbol: cfg.symbol,
          timeframe: cfg.timeframe,
          startDate: cfg.startDate,
          endDate: cfg.endDate,
          initialBalance: Number(cfg.initialBalance),
          riskPercent: Number(cfg.riskPercent),
          slAtrMultiple: Number(cfg.slAtrMultiple),
          tpRiskMultiple: Number(cfg.tpRiskMultiple),
          spreadPoints: Number(cfg.spreadPoints),
          commissionPerLot: Number(cfg.commissionPerLot),
          sessionFilter: cfg.sessionFilter,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Backtest execution failed");
        return;
      }
      setActiveRun(j.run);
      setReverseResult(null);
      setRuns((prev) => [j.run, ...prev]);
    } finally {
      setRunning(false);
    }
  };

  const runReverseResearch = async () => {
    if (!activeRun) return;
    setReverseRunning(true);
    setError(null);
    setReverseResult(null);
    try {
      const res = await fetch("/api/research/reverse-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backtestRunId: activeRun.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Reverse research failed");
      setReverseResult(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reverse research failed");
    } finally {
      setReverseRunning(false);
    }
  };

  const compareRun = compareId ? runs.find((r) => r.id === compareId) ?? null : null;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-[11.5px] text-ink-secondary">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Historical simulation on recorded candles · modelled spread and fees.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Backtest Parameters */}
        <div className="lg:col-span-4">
          <Panel title="Test Parameters" subtitle="Validated historical market feed">
            <form onSubmit={execute} className="space-y-3">
              <div>
                <label className={LABEL_CLS}>Strategy</label>
                <select value={cfg.strategyId} onChange={(e) => { const value = e.target.value; setCfg({ ...cfg, strategyId: value, ...(value === "asian_session_liquidity_reversal" ? { symbol: "XAUUSD", timeframe: "5m", riskPercent: "2", slAtrMultiple: "2", tpRiskMultiple: "4", commissionPerLot: "3", sessionFilter: "Asian" } : {}) }); }} className={INPUT_CLS}>
                  <option value="asian_session_liquidity_reversal">Asian Session Liquidity Reversal · Experimental</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Instrument</label>
                  <select value={cfg.symbol} onChange={(e) => setCfg({ ...cfg, symbol: e.target.value })} className={INPUT_CLS}>
                    {["XAUUSD", "BTCUSD", "ETHUSD", "SOLUSD", "EURUSD", "GBPUSD", "US500", "NAS100"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Timeframe</label>
                  <select value={cfg.timeframe} onChange={(e) => setCfg({ ...cfg, timeframe: e.target.value })} className={INPUT_CLS}>
                    {["5m", "15m", "1h", "4h", "1d"].map((t) => (
                      <option key={t} value={t}>{t.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Start Date</label>
                  <input type="date" value={cfg.startDate} onChange={(e) => setCfg({ ...cfg, startDate: e.target.value })} className={cn(INPUT_CLS, "font-mono text-[11.5px]")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>End Date</label>
                  <input type="date" value={cfg.endDate} onChange={(e) => setCfg({ ...cfg, endDate: e.target.value })} className={cn(INPUT_CLS, "font-mono text-[11.5px]")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Initial Capital ($)</label>
                  <input type="number" min={1000} step={1000} value={cfg.initialBalance} onChange={(e) => setCfg({ ...cfg, initialBalance: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Risk / Trade (%)</label>
                  <input type="number" min={0.01} max={5} step={0.01} value={cfg.riskPercent} onChange={(e) => setCfg({ ...cfg, riskPercent: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Stop Loss (× ATR)</label>
                  <input type="number" min={0.1} step={0.1} value={cfg.slAtrMultiple} onChange={(e) => setCfg({ ...cfg, slAtrMultiple: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Take Profit (× Risk)</label>
                  <input type="number" min={0.1} step={0.1} value={cfg.tpRiskMultiple} onChange={(e) => setCfg({ ...cfg, tpRiskMultiple: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Spread (pips/pts)</label>
                  <input type="number" min={0} step={0.1} value={cfg.spreadPoints} onChange={(e) => setCfg({ ...cfg, spreadPoints: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Commission ($/lot)</label>
                  <input type="number" min={0} step={0.1} value={cfg.commissionPerLot} onChange={(e) => setCfg({ ...cfg, commissionPerLot: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Trading Session Filter</label>
                <select value={cfg.strategyId === "asian_session_liquidity_reversal" ? "Asian" : cfg.sessionFilter} disabled={cfg.strategyId === "asian_session_liquidity_reversal"} onChange={(e) => setCfg({ ...cfg, sessionFilter: e.target.value })} className={INPUT_CLS}>
                  <option value="ALL">All Sessions (24h)</option>
                  <option value="London+NY">London + New York Only</option>
                  <option value="London">London Session (07–16 UTC)</option>
                  <option value="New York">New York Session (12–21 UTC)</option>
                  <option value="Asian">Asian Session (00–09 UTC)</option>
                </select>
              </div>
              <Button type="submit" variant="primary" className="w-full" disabled={running}>
                <Play className="h-3.5 w-3.5" />
                {running ? "Running Simulation…" : "Run Historical Backtest"}
              </Button>
            </form>
          </Panel>

          {/* Saved runs history */}
          {runs.length > 0 && (
            <Panel title="Saved Runs" subtitle="Click to inspect or compare" className="mt-4">
              <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveRun(r)}
                    aria-pressed={activeRun?.id === r.id}
                    className="freyr-selectable w-full rounded-lg bg-elevated px-3 py-2 text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="truncate font-medium text-ink pr-2">{r.strategyName}</span>
                      <span className={cn("font-mono tabular-nums", r.netProfit >= 0 ? "text-bull" : "text-bear")}>
                        {formatCurrency(r.netProfit, true)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-ink-secondary">
                      <span>{r.symbol} · {r.timeframe} · {r.totalTrades}T</span>
                      <span>WR {r.winRate}% · PF {r.profitFactor}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* Right: Report, Equity Curve, Comparison, Trades */}
        <div className="space-y-4 lg:col-span-8">
          {error && <ErrorBanner message={error} />}

          {!activeRun ? (
            <EmptyState
              title="Ready to backtest a strategy"
              description="Select a verified institutional strategy, instrument, timeframe, risk parameters, spread, and commission, then click Run Historical Backtest to evaluate simulated results on real market candles."
            />
          ) : (
            <>
              {/* Independent Reverse Strategy Research */}
              <Panel
                title={<span className="inline-flex items-center gap-2"><ArrowLeftRight className="h-3.5 w-3.5" /> Reverse Strategy Engine</span>}
                subtitle="Research-only counterfactual replay of this saved backtest"
                action={
                  <Button type="button" variant="secondary" className="h-8" onClick={runReverseResearch} disabled={reverseRunning || activeRun.trades.length === 0}>
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    {reverseRunning ? "Replaying…" : "Run Reverse Test"}
                  </Button>
                }
              >
                {!reverseResult ? (
                  <p className="text-[11.5px] text-ink-secondary">
                    Runs three controlled experiments against the same saved trades and historical candles: reverse every trade, reverse only original losers, and reverse only original winners. No live signals or orders are affected.
                  </p>
                ) : (
                  <>
                    <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      <KpiStat label="Source Win Rate" value={`${reverseResult.sourceRun.winRate}%`} sub={`${reverseResult.sourceRun.winningTrades}W / ${reverseResult.sourceRun.losingTrades}L`} />
                      <KpiStat label="All Reversed" value={`${reverseResult.experiments.allReversed.winRate}%`} sub={formatCurrency(reverseResult.experiments.allReversed.netProfit, true)} tone={reverseResult.experiments.allReversed.netProfit >= 0 ? "bull" : "bear"} />
                      <KpiStat label="Losers Only" value={`${reverseResult.experiments.losersOnly.winRate}%`} sub={formatCurrency(reverseResult.experiments.losersOnly.netProfit, true)} tone={reverseResult.experiments.losersOnly.netProfit >= 0 ? "bull" : "bear"} />
                      <KpiStat label="Winners Only" value={`${reverseResult.experiments.winnersOnly.winRate}%`} sub={formatCurrency(reverseResult.experiments.winnersOnly.netProfit, true)} tone={reverseResult.experiments.winnersOnly.netProfit >= 0 ? "bull" : "bear"} />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[540px] text-left font-mono text-[10.5px] tabular-nums">
                        <thead className="border-b border-ink/[0.06] font-sans text-[9px] uppercase text-ink-tertiary">
                          <tr><th className="py-2">Experiment</th><th>Trades</th><th>Win rate</th><th>Profit factor</th><th>Net P&amp;L</th><th>Max DD</th><th>EV / trade</th></tr>
                        </thead>
                        <tbody className="divide-y divide-ink/[0.04]">
                          <tr>
                            <td className="py-2 pr-2 font-sans">Original</td><td>{reverseResult.sourceRun.totalTrades}</td><td>{reverseResult.sourceRun.winRate}%</td><td>{Number(reverseResult.sourceRun.profitFactor).toFixed(2)}</td><td>{formatCurrency(reverseResult.sourceRun.netProfit, true)}</td><td>{reverseResult.sourceRun.maxDrawdownPct}%</td><td>{formatCurrency(reverseResult.sourceRun.expectedValue, true)}</td>
                          </tr>
                          {([
                            ["All reversed", reverseResult.experiments.allReversed],
                            ["Losers only reversed", reverseResult.experiments.losersOnly],
                            ["Winners only reversed (control)", reverseResult.experiments.winnersOnly],
                          ] as [string, any][]).map(([label, result]) => (
                            <tr key={label}>
                              <td className="py-2 pr-2 font-sans">{label}</td><td>{result.totalTrades}</td><td>{result.winRate}%</td><td>{Number(result.profitFactor).toFixed(2)}</td>
                              <td className={result.netProfit >= 0 ? "text-bull" : "text-bear"}>{formatCurrency(result.netProfit, true)}</td><td>{result.maxDrawdownPct}%</td><td>{formatCurrency(result.expectedValue, true)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-ink-secondary">
                      <span>{reverseResult.data.candleCount.toLocaleString()} candles · {reverseResult.data.source}</span><span>Losers-only: {reverseResult.experiments.losersOnly.totalTrades}/{reverseResult.experiments.losersOnly.sourceTradeCount} replayed · {reverseResult.experiments.losersOnly.skippedTrades} skipped</span>
                      <span>{reverseResult.sourceRun.symbol} · {reverseResult.sourceRun.timeframe.toUpperCase()} · same source run</span>
                    </div>
                    <div className="mt-3 max-h-[190px] overflow-auto">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">Losers-only reversed trade ledger</p>
                      <table className="w-full text-left font-mono text-[10px] tabular-nums">
                        <thead className="sticky top-0 bg-surface text-[9px] uppercase text-ink-tertiary">
                          <tr><th className="py-2">Source #</th><th>Side</th><th>Entry</th><th>Exit</th><th>Result</th><th className="text-right">P&amp;L</th></tr>
                        </thead>
                        <tbody className="divide-y divide-ink/[0.04]">
                          {reverseResult.experiments.losersOnly.trades.map((trade: any) => (
                            <tr key={trade.sourceTradeIndex}>
                              <td className="py-1.5">{trade.sourceTradeIndex}</td>
                              <td className={trade.direction === "BUY" ? "text-bull" : "text-bear"}>{trade.direction}</td>
                              <td>{formatPrice(trade.entryPrice)}</td><td>{formatPrice(trade.exitPrice)}</td>
                              <td>{trade.outcome} · {trade.exitReason}</td>
                              <td className={cn("text-right", trade.pnl >= 0 ? "text-bull" : "text-bear")}>{formatCurrency(trade.pnl, true)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-[10px] leading-relaxed text-ink-tertiary">
                      Counterfactual research only. Losers-only reverses only source trades labelled LOSS; it does not create independent entries. Replayed candle ordering is ambiguous when SL and TP are both touched, so SL is assumed first. The candle feed is fetched again and may differ from the original run snapshot. Validate on unseen data with realistic execution costs before considering any live use.
                    </p>
                  </>
                )}
              </Panel>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <KpiStat
                  label="Sim. Net Profit"
                  value={formatCurrency(activeRun.netProfit, true)}
                  sub={`From ${formatCurrency(activeRun.initialBalance)}`}
                  tone={activeRun.netProfit >= 0 ? "bull" : "bear"}
                />
                <KpiStat
                  label="Win Rate"
                  value={`${activeRun.winRate}%`}
                  sub={`${activeRun.winningTrades}W / ${activeRun.losingTrades}L (${activeRun.totalTrades})`}
                  tone={activeRun.winRate >= 45 ? "bull" : "neutral"}
                />
                <KpiStat
                  label="Profit Factor"
                  value={activeRun.profitFactor.toFixed(2)}
                  sub={`Avg Win ${activeRun.avgRiskReward}R`}
                  tone={activeRun.profitFactor >= 1.2 ? "gold" : "bear"}
                />
                <KpiStat
                  label="Max Drawdown"
                  value={`-${activeRun.maxDrawdownPct}%`}
                  sub={`EV ${formatCurrency(activeRun.expectedValue, true)}/tr`}
                  tone={activeRun.maxDrawdownPct <= 6 ? "neutral" : "bear"}
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5 font-mono text-[11.5px] tabular-nums">
                <div className="freyr-card px-3.5 py-2.5 flex items-center justify-between">
                  <span className="font-sans text-ink-secondary">Expected Value</span>
                  <span className={activeRun.expectedValue >= 0 ? "text-bull" : "text-bear"}>
                    {formatCurrency(activeRun.expectedValue, true)}
                  </span>
                </div>
                <div className="freyr-card px-3.5 py-2.5 flex items-center justify-between">
                  <span className="font-sans text-ink-secondary">Max Win Streak</span>
                  <span className="text-bull">{activeRun.maxConsecutiveWins}</span>
                </div>
                <div className="freyr-card px-3.5 py-2.5 flex items-center justify-between">
                  <span className="font-sans text-ink-secondary">Max Loss Streak</span>
                  <span className="text-bear">{activeRun.maxConsecutiveLosses}</span>
                </div>
              </div>

              {/* Equity / Drawdown curve */}
              <Panel
                title={
                  <span className="inline-flex items-center gap-2">
                    {activeRun.strategyName} · {activeRun.symbol} ({activeRun.timeframe.toUpperCase()})
                    <DataStatusBadge status="SIMULATED" label="Historical" />
                  </span>
                }
                subtitle={`${activeRun.startDate} to ${activeRun.endDate} · Session: ${activeRun.sessionFilter} · ${activeRun.dataSource}`}
                action={
                  <SegmentedControl
                    options={[
                      { value: "equity", label: "Equity" },
                      { value: "drawdown", label: "Drawdown" },
                    ]}
                    value={curveMode}
                    onChange={setCurveMode}
                    size="xs"
                  />
                }
              >
                <EquityCurveChart points={activeRun.equityCurve} mode={curveMode} height={230} />
              </Panel>

              {/* Side-by-side Strategy Comparison */}
              {runs.length >= 2 && (
                <Panel
                  title="Strategy comparison"
                  action={
                    <select
                      aria-label="Compare against run"
                      value={compareId ?? ""}
                      onChange={(e) => setCompareId(e.target.value ? Number(e.target.value) : null)}
                      className={cn(INPUT_CLS, "h-7 w-56 text-[11px]")}
                    >
                      <option value="">Select run to compare…</option>
                      {runs
                        .filter((r) => r.id !== activeRun.id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.strategyName} ({r.symbol} {r.timeframe}) · {r.startDate}
                          </option>
                        ))}
                    </select>
                  }
                >
                  {compareRun ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-[11.5px] tabular-nums">
                        <thead className="border-b border-ink/[0.06] font-sans text-[10px] text-ink-secondary uppercase">
                          <tr>
                            <th className="py-2 pr-3">Metric</th>
                            <th className="py-2 px-3">{activeRun.strategyName} ({activeRun.symbol})</th>
                            <th className="py-2 pl-3">{compareRun.strategyName} ({compareRun.symbol})</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink/[0.04]">
                          {[
                            ["Trades", `${activeRun.totalTrades}`, `${compareRun.totalTrades}`],
                            ["Win Rate", `${activeRun.winRate}%`, `${compareRun.winRate}%`],
                            ["Profit Factor", `${activeRun.profitFactor}`, `${compareRun.profitFactor}`],
                            ["Net Profit (Sim)", formatCurrency(activeRun.netProfit, true), formatCurrency(compareRun.netProfit, true)],
                            ["Max Drawdown", `-${activeRun.maxDrawdownPct}%`, `-${compareRun.maxDrawdownPct}%`],
                            ["Expected Value", formatCurrency(activeRun.expectedValue, true), formatCurrency(compareRun.expectedValue, true)],
                            ["Streaks (W / L)", `${activeRun.maxConsecutiveWins} / ${activeRun.maxConsecutiveLosses}`, `${compareRun.maxConsecutiveWins} / ${compareRun.maxConsecutiveLosses}`],
                          ].map(([k, a, b]) => (
                            <tr key={k}>
                              <td className="py-1.5 pr-3 font-sans text-ink-secondary">{k}</td>
                              <td className="py-1.5 px-3 text-ink">{a}</td>
                              <td className="py-1.5 pl-3 text-ink">{b}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-ink-secondary">
                      Pick another completed backtest run from the selector to benchmark performance side by side.
                    </p>
                  )}
                </Panel>
              )}

              {/* Simulated Trade Ledger */}
              <Panel title={`Simulated Trades (${activeRun.trades.length})`} subtitle="Spread and per-lot commission deducted from each trade">
                {activeRun.trades.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-ink-secondary">
                    No entries satisfied every strategy condition inside the selected session filter and window. Try widening the date range or switching session filter to All.
                  </p>
                ) : (
                  <div className="max-h-[260px] overflow-auto">
                    <table className="w-full text-left font-mono text-[11px] tabular-nums">
                      <thead className="sticky top-0 bg-surface border-b border-ink/[0.06] font-sans text-[10px] text-ink-tertiary uppercase">
                        <tr>
                          <th className="py-2 px-2">Side</th>
                          <th className="py-2 px-2">Entry Time</th>
                          <th className="py-2 px-2">Session</th>
                          <th className="py-2 px-2 text-right">Entry</th>
                          <th className="py-2 px-2 text-right">Exit</th>
                          <th className="py-2 px-2 text-right">R</th>
                          <th className="py-2 pl-2 text-right">Net P&L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink/[0.04]">
                        {activeRun.trades.map((t) => (
                          <tr key={t.index} className="hover:bg-ink/[0.02]">
                            <td className="py-1.5 pr-2 text-ink-secondary">{t.index}</td>
                            <td className="py-1.5 px-2"><DirectionBadge direction={t.direction} /></td>
                            <td className="py-1.5 px-2 text-ink-secondary">{formatDateTime(t.entryTime, timezone, { short: true })}</td>
                            <td className="py-1.5 px-2 font-sans text-ink-secondary">{t.session}</td>
                            <td className="py-1.5 px-2 text-right">{formatPrice(t.entryPrice)}</td>
                            <td className="py-1.5 px-2 text-right">{formatPrice(t.exitPrice)}</td>
                            <td className={cn("py-1.5 px-2 text-right", t.rMultiple >= 0 ? "text-bull" : "text-bear")}>
                              {t.rMultiple >= 0 ? "+" : ""}{t.rMultiple.toFixed(2)}R
                            </td>
                            <td className={cn("py-1.5 pl-2 text-right font-medium", t.pnl >= 0 ? "text-bull" : "text-bear")}>
                              {formatCurrency(t.pnl, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

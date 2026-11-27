"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import {
  Button,
  ErrorBanner,
  INPUT_CLS,
  KpiStat,
  LABEL_CLS,
  Panel,
  PanelSkeleton,
  cn,
  formatCurrency,
  formatPrice,
} from "@/components/ui/primitives";

interface RiskPayload {
  config: {
    accountBalance: number;
    accountEquity: number;
    peakEquity: number;
    riskPerTradePct: number;
    maxDailyLossPct: number;
    maxDrawdownPct: number;
    maxDailyTrades: number;
    maxOpenExposurePct: number;
    minRiskReward: number;
    currentDrawdownPct: number;
    dailyLossPct: number;
    todayTrades: number;
    openSignalsCount: number;
    openExposurePct: number;
  };
  warnings: Array<{ level: "CRITICAL" | "WARNING" | "OK"; title: string; detail: string }>;
  livePrices: Record<string, number>;
}

const CONTRACT_SPECS: Record<string, { contractSize: number; unit: string; decimals: number; defaultStop: number; defaultTp: number }> = {
  XAUUSD: { contractSize: 100, unit: "100 oz/lot", decimals: 2, defaultStop: 12, defaultTp: 28 },
  EURUSD: { contractSize: 100000, unit: "100k units/lot", decimals: 5, defaultStop: 0.0025, defaultTp: 0.006 },
  GBPUSD: { contractSize: 100000, unit: "100k units/lot", decimals: 5, defaultStop: 0.003, defaultTp: 0.007 },
  US500: { contractSize: 50, unit: "$50/pt contract", decimals: 2, defaultStop: 18, defaultTp: 42 },
  NAS100: { contractSize: 20, unit: "$20/pt contract", decimals: 2, defaultStop: 65, defaultTp: 150 },
  BTCUSD: { contractSize: 1, unit: "1 BTC/unit", decimals: 1, defaultStop: 850, defaultTp: 2100 },
  ETHUSD: { contractSize: 1, unit: "1 ETH/unit", decimals: 2, defaultStop: 32, defaultTp: 80 },
};

export function RiskView() {
  const [data, setData] = useState<RiskPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actualBalance, setActualBalance] = useState("");

  // Editable persisted policy state
  const [policy, setPolicy] = useState({
    accountBalance: "100000",
    riskPerTradePct: "0.75",
    maxDailyLossPct: "2.0",
    maxDrawdownPct: "6.0",
    maxDailyTrades: "4",
    maxOpenExposurePct: "2.25",
    minRiskReward: "2.0",
  });

  // Position-sizing & R:R calculator
  const [calc, setCalc] = useState({
    symbol: "XAUUSD",
    direction: "BUY" as "BUY" | "SELL",
    entry: "3624",
    stopLoss: "3612",
    takeProfit: "3652",
    riskPct: "0.75",
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/risk", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: RiskPayload = await res.json();
      setData(j);
      const savedActualBalance = typeof window !== "undefined" ? window.localStorage.getItem("freyr-calculator-actual-balance") : null;
      setActualBalance(savedActualBalance && Number(savedActualBalance) > 0 ? savedActualBalance : String(j.config.accountEquity));
      setPolicy({
        accountBalance: String(j.config.accountBalance),
        riskPerTradePct: String(j.config.riskPerTradePct),
        maxDailyLossPct: String(j.config.maxDailyLossPct),
        maxDrawdownPct: String(j.config.maxDrawdownPct),
        maxDailyTrades: String(j.config.maxDailyTrades),
        maxOpenExposurePct: String(j.config.maxOpenExposurePct),
        minRiskReward: String(j.config.minRiskReward),
      });
      const liveXau = j.livePrices?.XAUUSD;
      if (liveXau && liveXau > 0) {
        setCalc((p) => ({
          ...p,
          entry: liveXau.toFixed(2),
          stopLoss: (liveXau - 12).toFixed(2),
          takeProfit: (liveXau + 28).toFixed(2),
          riskPct: String(j.config.riskPerTradePct),
        }));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load risk engine");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applySymbol = (sym: string) => {
    const spec = CONTRACT_SPECS[sym] ?? CONTRACT_SPECS.XAUUSD;
    const base =
      data?.livePrices?.[sym] ??
      (sym === "EURUSD" ? 1.091 : sym === "GBPUSD" ? 1.304 : sym === "US500" ? 7235 : sym === "NAS100" ? 26740 : 3624);
    const isBuy = calc.direction === "BUY";
    setCalc({
      ...calc,
      symbol: sym,
      entry: base.toFixed(spec.decimals),
      stopLoss: (isBuy ? base - spec.defaultStop : base + spec.defaultStop).toFixed(spec.decimals),
      takeProfit: (isBuy ? base + spec.defaultTp : base - spec.defaultTp).toFixed(spec.decimals),
    });
  };

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch("/api/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountBalance: Number(policy.accountBalance),
          riskPerTradePct: Number(policy.riskPerTradePct),
          maxDailyLossPct: Number(policy.maxDailyLossPct),
          maxDrawdownPct: Number(policy.maxDrawdownPct),
          maxDailyTrades: Number(policy.maxDailyTrades),
          maxOpenExposurePct: Number(policy.maxOpenExposurePct),
          minRiskReward: Number(policy.minRiskReward),
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error || "Failed to update settings");
        return;
      }
      setSavedMsg("Risk parameters saved to capital protection ledger.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <PanelSkeleton rows={7} />;
  if (error && !data) return <ErrorBanner message={error} onRetry={load} />;
  if (!data) return null;

  const c = data.config;
  const spec = CONTRACT_SPECS[calc.symbol] ?? CONTRACT_SPECS.XAUUSD;
  const entry = Number(calc.entry) || 0;
  const sl = Number(calc.stopLoss) || 0;
  const tp = Number(calc.takeProfit) || 0;
  const rPct = Math.max(0.05, Number(calc.riskPct) || c.riskPerTradePct);
  const stopDist = Math.abs(entry - sl);
  const rewardDist = Math.abs(tp - entry);
  const validGeom =
    entry > 0 &&
    stopDist > 0 &&
    (calc.direction === "BUY" ? sl < entry && tp > entry : sl > entry && tp < entry);
  const calculatorBalance = Number(actualBalance) > 0 ? Number(actualBalance) : c.accountEquity;
  const riskUsd = calculatorBalance * (rPct / 100);
  const positionLots = validGeom ? riskUsd / (stopDist * spec.contractSize) : 0;
  const positionUnits = positionLots * spec.contractSize;
  const rr = validGeom ? rewardDist / stopDist : 0;
  const rewardUsd = riskUsd * rr;
  const breachDaily = rPct > c.maxDailyLossPct - c.dailyLossPct;
  const belowMinRr = validGeom && rr < c.minRiskReward;

  const Meter = ({ label, current, limit, unit = "%" }: { label: string; current: number; limit: number; unit?: string }) => {
    const pct = Math.min(100, limit > 0 ? (current / limit) * 100 : 0);
    const barColor = pct >= 90 ? "bg-bear" : pct >= 65 ? "bg-ink-secondary" : "bg-bull";
    return (
      <div>
        <div className="mb-1 flex justify-between text-[11.5px] font-mono tabular-nums">
          <span className="font-sans text-ink-secondary">{label}</span>
          <span className="text-ink">
            {current}{unit} <span className="text-ink-secondary">/ {limit}{unit}</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
          <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Equity / Protection KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiStat label="Account Balance" value={formatCurrency(c.accountBalance)} sub="Starting capital" />
        <KpiStat
          label="Equity"
          value={formatCurrency(c.accountEquity)}
          sub={`Peak ${formatCurrency(c.peakEquity)}`}
          tone={c.accountEquity >= c.accountBalance ? "bull" : "bear"}
        />
        <KpiStat label="Risk / Trade" value={`${c.riskPerTradePct}%`} sub={formatCurrency(c.accountEquity * (c.riskPerTradePct / 100))} tone="gold" />
        <KpiStat
          label="Daily Loss Used"
          value={`${c.dailyLossPct}%`}
          sub={`Max ${c.maxDailyLossPct}% (${formatCurrency(c.accountBalance * (c.maxDailyLossPct / 100))})`}
          tone={c.dailyLossPct >= c.maxDailyLossPct * 0.7 ? "bear" : "neutral"}
        />
        <KpiStat
          label="Current Drawdown"
          value={`${c.currentDrawdownPct}%`}
          sub={`Ceiling ${c.maxDrawdownPct}%`}
          tone={c.currentDrawdownPct >= c.maxDrawdownPct * 0.65 ? "bear" : "neutral"}
        />
        <KpiStat
          label="Active Exposure"
          value={`${c.openExposurePct}%`}
          sub={`${c.openSignalsCount} open · ${c.todayTrades}/${c.maxDailyTrades} today`}
          tone={c.openExposurePct > c.maxOpenExposurePct ? "bear" : "bull"}
        />
      </div>

      {/* Capital Protection Alerts */}
      <div className="space-y-2">
        {data.warnings.map((w, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[12px]",
              w.level === "CRITICAL"
                ? "border-bear/35 bg-bear/[0.09] text-bear"
                : w.level === "WARNING"
                  ? "border-outline bg-inset text-ink-secondary"
                  : "border-bull/22 bg-bull/[0.06] text-bull"
            )}
          >
            {w.level === "OK" ? (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-bull" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <span className="font-medium">{w.title}: </span>
              <span className="opacity-90">{w.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Position Sizing & Risk-Reward Calculator + Policy Form */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <Panel title="Position Sizing, Lot Size & R:R Calculator" subtitle={`Contract size: ${spec.unit} · Uses your manually entered account balance`}>
            <div className="mb-3 rounded-xl border border-outline bg-inset/60 p-3">
              <label className={LABEL_CLS}>Your Actual Account Balance (USD)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={actualBalance}
                onChange={(e) => {
                  setActualBalance(e.target.value);
                  if (typeof window !== "undefined") window.localStorage.setItem("freyr-calculator-actual-balance", e.target.value);
                }}
                placeholder="Enter your current real balance"
                className={cn(INPUT_CLS, "font-mono text-base")}
              />
              <p className="mt-1.5 text-[10.5px] text-ink-secondary">This balance controls the calculator’s position size and estimated risk/reward. It does not change your saved risk-governance balance or live account data.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={LABEL_CLS}>Instrument</label>
                <select value={calc.symbol} onChange={(e) => applySymbol(e.target.value)} className={INPUT_CLS}>
                  {Object.keys(CONTRACT_SPECS).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Direction</label>
                <select
                  value={calc.direction}
                  onChange={(e) => {
                    const dir = e.target.value as "BUY" | "SELL";
                    const p = Number(calc.entry) || 3624;
                    setCalc({
                      ...calc,
                      direction: dir,
                      stopLoss: (dir === "BUY" ? p - spec.defaultStop : p + spec.defaultStop).toFixed(spec.decimals),
                      takeProfit: (dir === "BUY" ? p + spec.defaultTp : p - spec.defaultTp).toFixed(spec.decimals),
                    });
                  }}
                  className={INPUT_CLS}
                >
                  <option value="BUY">BUY (Long)</option>
                  <option value="SELL">SELL (Short)</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Risk % of Equity</label>
                <input type="number" step="0.05" min="0.05" max="5" value={calc.riskPct} onChange={(e) => setCalc({ ...calc, riskPct: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
              </div>
              <div>
                <label className={LABEL_CLS}>Entry Price</label>
                <input type="number" step="any" value={calc.entry} onChange={(e) => setCalc({ ...calc, entry: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
              </div>
              <div>
                <label className={LABEL_CLS}>Stop Loss</label>
                <input type="number" step="any" value={calc.stopLoss} onChange={(e) => setCalc({ ...calc, stopLoss: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
              </div>
              <div>
                <label className={LABEL_CLS}>Take Profit</label>
                <input type="number" step="any" value={calc.takeProfit} onChange={(e) => setCalc({ ...calc, takeProfit: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 font-mono tabular-nums">
              <div className="freyr-card px-3 py-3">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Lot Size</div>
                <div className="mt-1 text-[20px] font-semibold text-ink-secondary">
                  {validGeom ? positionLots.toFixed(2) : "—"}
                </div>
                <div className="text-[10px] text-ink-secondary">
                  {validGeom ? `${positionUnits.toFixed(1)} units` : "Check SL/TP"}
                </div>
              </div>
              <div className="freyr-card px-3 py-3">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Capital at Risk</div>
                <div className="mt-1 text-[17px] font-semibold text-bear">{formatCurrency(riskUsd)}</div>
                <div className="text-[10px] text-ink-secondary">SL dist {formatPrice(stopDist, spec.decimals)}</div>
              </div>
              <div className="freyr-card px-3 py-3">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Projected Reward</div>
                <div className="mt-1 text-[17px] font-semibold text-bull">
                  {validGeom ? formatCurrency(rewardUsd, true) : "—"}
                </div>
                <div className="text-[10px] text-ink-secondary">TP dist {formatPrice(rewardDist, spec.decimals)}</div>
              </div>
              <div className="freyr-card px-3 py-3">
                <div className="font-sans text-[10px] text-ink-secondary uppercase">Risk : Reward</div>
                <div className={cn("mt-1 text-[18px] font-semibold", belowMinRr ? "text-bear" : "text-ink")}>
                  {validGeom ? `1 : ${rr.toFixed(2)}` : "—"}
                </div>
                <div className="text-[10px] text-ink-secondary">Min 1:{c.minRiskReward}</div>
              </div>
            </div>

            {(belowMinRr || breachDaily || !validGeom) && (
              <div className="mt-3 rounded-lg border border-bear/25 bg-bear/[0.07] px-3 py-2 text-[11.5px] text-bear">
                {!validGeom
                  ? `Invalid stop/target coordinates for a ${calc.direction} trade.`
                  : breachDaily
                    ? `Trade risk (${rPct}%) exceeds remaining daily loss budget (${(c.maxDailyLossPct - c.dailyLossPct).toFixed(2)}%).`
                    : `R:R of 1:${rr.toFixed(2)} is below your disciplined minimum 1:${c.minRiskReward}. Capital preservation recommends skipping this setup.`}
              </div>
            )}
          </Panel>

          <Panel title="Exposure & Capital Threshold Meters">
            <div className="space-y-3.5">
              <Meter label="Daily Loss Limit" current={c.dailyLossPct} limit={c.maxDailyLossPct} />
              <Meter label="Maximum Total Drawdown" current={c.currentDrawdownPct} limit={c.maxDrawdownPct} />
              <Meter label="Open Portfolio Exposure" current={c.openExposurePct} limit={c.maxOpenExposurePct} />
              <Meter label="Daily Execution Quota" current={c.todayTrades} limit={c.maxDailyTrades} unit=" trades" />
            </div>
          </Panel>
        </div>

        {/* Right: Editable Capital Protection Rules */}
        <div className="lg:col-span-5">
          <Panel title="Risk Governance Parameters" subtitle="Prioritizes capital preservation over trade frequency">
            {savedMsg && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-bull/25 bg-bull/[0.08] px-3 py-2 text-[11.5px] text-bull">
                <CheckCircle2 className="h-3.5 w-3.5" /> {savedMsg}
              </div>
            )}
            <form onSubmit={savePolicy} className="space-y-3">
              <div>
                <label className={LABEL_CLS}>Account Capital Balance ($)</label>
                <input type="number" step="100" min="500" value={policy.accountBalance} onChange={(e) => setPolicy({ ...policy, accountBalance: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className={LABEL_CLS}>Default Risk / Trade (%)</label>
                  <input type="number" step="0.05" min="0.1" max="5" value={policy.riskPerTradePct} onChange={(e) => setPolicy({ ...policy, riskPerTradePct: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Max Daily Loss (%)</label>
                  <input type="number" step="0.25" min="0.5" max="15" value={policy.maxDailyLossPct} onChange={(e) => setPolicy({ ...policy, maxDailyLossPct: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Max Total Drawdown (%)</label>
                  <input type="number" step="0.5" min="1" max="30" value={policy.maxDrawdownPct} onChange={(e) => setPolicy({ ...policy, maxDrawdownPct: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Max Open Exposure (%)</label>
                  <input type="number" step="0.25" min="0.25" max="15" value={policy.maxOpenExposurePct} onChange={(e) => setPolicy({ ...policy, maxOpenExposurePct: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Max Daily Trades</label>
                  <input type="number" min="1" max="20" value={policy.maxDailyTrades} onChange={(e) => setPolicy({ ...policy, maxDailyTrades: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Minimum R:R Floor</label>
                  <input type="number" step="0.1" min="1" max="6" value={policy.minRiskReward} onChange={(e) => setPolicy({ ...policy, minRiskReward: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
                </div>
              </div>
              <Button type="submit" variant="primary" className="w-full" disabled={saving}>
                {saving ? "Saving…" : "Save Risk Policy"}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

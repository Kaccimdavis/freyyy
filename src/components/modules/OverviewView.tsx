"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Clock,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { DashboardWidgetConfig } from "@/db/schema";
import type { Candle } from "@/lib/market-data";
import {
  Button,
  DataStatusBadge,
  DirectionBadge,
  ErrorBanner,
  ModalSheet,
  Panel,
  PanelSkeleton,
  SignalStatusBadge,
  Switch,
  cn,
  formatCountdown,
  cleanCopy,
  formatCurrency,
  formatDateTime,
  formatPct,
  formatPrice,
  type NavTab,
} from "@/components/ui/primitives";
import { CandlestickChart } from "@/components/charts/CandlestickChart";

interface OverviewData {
  timestamp: string;
  gold: {
    quote: {
      price: number | null;
      change: number | null;
      changePct: number | null;
      high24h: number | null;
      low24h: number | null;
      volume24h: number | null;
      source: string;
      status: string;
    };
    candles: Candle[];
    candlesStatus: string;
    candlesSource: string;
    atr15: number | null;
    volatilityPct: number | null;
    volatilityState: string;
    spread: number;
    spreadBps: number;
    bookStatus: string;
  };
  ticker: Array<{
    symbol: string;
    price: number | null;
    changePct: number | null;
    decimals: number;
    status: string;
  }>;
  sessions: {
    currentLabel: string;
    isOverlap: boolean;
    utcTime: string;
    sessions: Array<{
      name: string;
      code: string;
      active: boolean;
      openUtc: string;
      closeUtc: string;
      minutesRemaining: number;
    }>;
  };
  ai: {
    direction: string;
    setupState: string;
    confidenceScore: number;
    briefing: string;
    setupExplanation: string;
    h1Bias: string;
    m15Structure: string;
    m5Execution: string;
    confirmationsCount: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    dataStatus: string;
  };
  modflow: {
    bias: string;
    setupConfirmation: string;
    confirmationText: string;
    sessionDelta: number;
    cvdSlope: string;
    cvdDivergence: string;
    bidPressurePct: number;
    askPressurePct: number;
    aggressiveBuyPct: number;
    aggressiveSellPct: number;
    institutionalScore: number;
    institutionalActivity: string;
    poc: number;
    vah: number;
    val: number;
    absorptionCount: number;
    exhaustionCount: number;
    status: string;
    orderBookStatus: string;
  };
  liquidity: {
    trend: string;
    condition: string;
    structureBias: string;
    nearestBsl: { shortLabel: string; price: number; distancePct: number } | null;
    nearestSsl: { shortLabel: string; price: number; distancePct: number } | null;
    pdh: number | null;
    pdl: number | null;
    lastEvent: { label: string; price: number; type: string } | null;
    counts: {
      fvgs: number;
      orderBlocks: number;
      sweeps: number;
      stopHunts: number;
      equalHighs: number;
      equalLows: number;
    };
  };
  signals: Array<{
    id: number;
    symbol: string;
    direction: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskReward: number;
    confidence: number;
    timeframe: string;
    strategyName: string;
    status: string;
  }>;
  calendar: {
    events: Array<{
      id: string;
      title: string;
      currency: string;
      impact: string;
      timestamp: number;
      forecast: string;
      previous: string;
      isGoldSensitive: boolean;
    }>;
    status: string;
    error: string | null;
  };
  account: {
    balance: number;
    equity: number;
    netPnl: number;
    todayPnl: number;
    todayTrades: number;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    riskPerTradePct: number;
    maxDailyLossPct: number;
    openExposurePct: number;
    brokerConfigured: boolean;
    brokerProvider: string;
  };
  alerts: Array<{
    id: number;
    category: string;
    severity: string;
    symbol: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
  }>;
  widgets: DashboardWidgetConfig[];
}

export function OverviewView({
  onNavigate,
  timezone,
  onSelectMarket,
}: {
  onNavigate: (tab: NavTab) => void;
  timezone: string;
  onSelectMarket: (symbol: string) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidgetConfig[]>([]);
  const [savingWidgets, setSavingWidgets] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const res = await fetch("/api/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OverviewData = await res.json();
      setData(json);
      setWidgets([...json.widgets].sort((a, b) => a.order - b.order));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the overview");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    const poll = setInterval(() => load(true), 25_000);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const saveWidgetConfig = async (next: DashboardWidgetConfig[]) => {
    setSavingWidgets(true);
    const normalized = next.map((w, i) => ({ ...w, order: i }));
    setWidgets(normalized);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardWidgets: normalized }),
      });
    } finally {
      setSavingWidgets(false);
    }
  };

  const moveWidget = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= widgets.length) return;
    const copy = [...widgets];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    saveWidgetConfig(copy);
  };

  const toggleWidget = (id: string, visible: boolean) => {
    const next = widgets.map((w) => (w.id === id ? { ...w, visible } : w));
    saveWidgetConfig(next);
  };

  const isVisible = (id: string) => widgets.find((w) => w.id === id)?.visible ?? true;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PanelSkeleton rows={5} height="h-[340px]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
          <PanelSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <ErrorBanner message={error} onRetry={() => load(false)} />;
  }
  if (!data) return null;

  const gold = data.gold;
  const gPrice = gold.quote?.price;
  const gChg = gold.quote?.changePct;
  const up = (gChg ?? 0) >= 0;

  const spanMap: Record<string, string> = {
    gold_hero: "lg:col-span-12",
    ai_briefing: "lg:col-span-6",
    active_signals: "lg:col-span-6",
    order_flow: "lg:col-span-4",
    liquidity_sessions: "lg:col-span-4",
    account_stats: "lg:col-span-4",
    economic_events: "lg:col-span-6",
    alerts_feed: "lg:col-span-6",
  };

  const renderWidget = (id: string) => {
    switch (id) {
      case "gold_hero":
        return (
          <Panel className="overflow-hidden" noPadding>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink/[0.06] px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-[0.06em] text-ink-secondary uppercase">
                    Primary Market · XAUUSD
                  </span>
                  <DataStatusBadge status={gold.quote?.status ?? gold.candlesStatus} label="Hyperliquid" />
                  <DirectionBadge direction={data.ai.direction} />
                </div>
                <div className="mt-1.5 flex items-baseline gap-3">
                  <span className="font-mono text-[30px] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
                    {gPrice !== null ? `$${formatPrice(gPrice, 2)}` : "Unavailable"}
                  </span>
                  {gChg !== null && (
                    <span
                      className={cn(
                        "font-mono text-[13px] font-medium tabular-nums",
                        up ? "text-bull" : "text-bear"
                      )}
                    >
                      {gold.quote.change !== null && `${gold.quote.change >= 0 ? "+" : ""}${formatPrice(gold.quote.change, 2)} `}
                      ({formatPct(gChg)})
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-ink-tertiary">
                  M15 Execution View · {data.sessions.currentLabel} · H1 {data.ai.h1Bias} · M15 {data.ai.m15Structure} · M5 {data.ai.m5Execution}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-4 font-mono tabular-nums">
                <div>
                  <div className="text-[10px] font-sans text-ink-secondary uppercase">24h High / Low</div>
                  <div className="mt-0.5 text-ink">
                    {formatPrice(gold.quote.high24h, 2)} / {formatPrice(gold.quote.low24h, 2)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-ink-secondary uppercase">M15 ATR / Vol</div>
                  <div className="mt-0.5 text-ink">
                    {gold.atr15 !== null ? `$${gold.atr15.toFixed(2)}` : "—"} · {gold.volatilityState}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-ink-secondary uppercase">L2 Spread</div>
                  <div className="mt-0.5 text-ink">
                    {gold.bookStatus !== "UNAVAILABLE" ? `$${gold.spread.toFixed(2)} (${gold.spreadBps} bps)` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-sans text-ink-secondary uppercase">Consensus</div>
                  <div className="mt-0.5 text-ink-secondary">
                    {data.ai.confidenceScore}% ({data.ai.confirmationsCount}/4 engines)
                  </div>
                </div>
              </div>
            </div>

            <div className="border-b border-ink/[0.06]">
              <CandlestickChart
                symbol="XAUUSD"
                timeframe="15m"
                candles={gold.candles}
                decimals={2}
                height={300}
                timezone={timezone}
                showEma
                showVolume
              />
            </div>

            {/* Compact macro reference ticker */}
            <div className="grid grid-cols-2 divide-x divide-ink/[0.05] sm:grid-cols-3 lg:grid-cols-6">
              {data.ticker.map((t) => {
                const pos = (t.changePct ?? 0) >= 0;
                return (
                  <button
                    key={t.symbol}
                    type="button"
                    onClick={() => {
                      onSelectMarket(t.symbol);
                      onNavigate("markets");
                    }}
                    className="flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-ink/[0.03] cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn("text-[11px] font-medium", t.symbol === "XAUUSD" ? "text-ink-secondary" : "text-ink")}>
                          {t.symbol}
                        </span>
                      </div>
                      <div className="font-mono text-[12px] text-ink tabular-nums">
                        {formatPrice(t.price, t.decimals)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-[10.5px] tabular-nums",
                        t.changePct === null ? "text-ink-tertiary" : pos ? "text-bull" : "text-bear"
                      )}
                    >
                      {formatPct(t.changePct, 2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
        );

      case "ai_briefing":
        return (
          <Panel
            title={
              <span className="inline-flex items-center gap-1.5"> FREYR AI Market Briefing
              </span>
            }
            subtitle="Multi-engine consensus across Technical, Liquidity, ModFlow & Macro"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("analyst")}>
                Full Analysis <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <DirectionBadge direction={data.ai.direction} />
              <span className="rounded-md border border-ink/[0.08] bg-ink/[0.03] px-2 py-0.5 text-[10.5px] text-ink">
                Setup: {data.ai.setupState}
              </span>
              <span className="font-mono text-[11px] text-ink-secondary tabular-nums">
                {data.ai.confidenceScore}% confidence
              </span>
              <span className="text-[11px] text-ink-secondary">· {data.ai.confirmationsCount}/4 aligned</span>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-ink">{cleanCopy(data.ai.briefing)}</p>
            <div className="mt-4 grid grid-cols-4 gap-2 font-mono text-[11px] tabular-nums">
              <div className="freyr-card px-2.5 py-2">
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Entry Ref</div>
                <div className="mt-0.5 text-ink">{formatPrice(data.ai.entryPrice)}</div>
              </div>
              <div className="freyr-card px-2.5 py-2">
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Stop Loss</div>
                <div className="mt-0.5 text-bear">{formatPrice(data.ai.stopLoss)}</div>
              </div>
              <div className="freyr-card px-2.5 py-2">
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Take profit</div>
                <div className="mt-0.5 text-bull">{formatPrice(data.ai.takeProfit)}</div>
              </div>
              <div className="freyr-card px-2.5 py-2">
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">R:R</div>
                <div className="mt-0.5 text-ink-secondary">{data.ai.riskReward}:1</div>
              </div>
            </div>
          </Panel>
        );

      case "active_signals":
        return (
          <Panel
            title="Active & Recent Trading Signals"
            subtitle="Published entry, stop loss & take profit levels are permanently locked"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("signals")}>
                Signals <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {(() => {
              const openSignals = data.signals.filter((s) => s.status === "ACTIVE" || s.status === "PENDING" || s.status === "TP1_REACHED");
              const s = openSignals[0];
              if (!s) {
                return (
                  <p className="py-6 text-center text-[12px] text-ink-secondary">
                    No open signal. New setups must pass the publication rules and cooldown.
                  </p>
                );
              }
              return (
                <div className="freyr-card flex items-center justify-between gap-2.5 px-3 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <DirectionBadge direction={s.direction} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                        <span>{s.symbol.replace("XAUUSD", "XAU/USD")}</span>
                        <span className="text-[10px] text-ink-secondary">{s.timeframe}</span>
                        <span className="font-mono text-[10px] text-ink-secondary">{s.confidence}%</span>
                      </div>
                      <p className="truncate font-mono text-[10px] text-ink-secondary">
                        E {formatPrice(s.entryPrice)} · SL {formatPrice(s.stopLoss)} · TP {formatPrice(s.takeProfit)}
                      </p>
                    </div>
                  </div>
                  <SignalStatusBadge status={s.status} />
                </div>
              );
            })()}
          </Panel>
        );

      case "order_flow":
        return (
          <Panel
            title="ModFlow Order Flow"
            subtitle={`Institutional activity · ${data.modflow.institutionalActivity}`}
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("modflow")}>
                Suite <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="flex items-center justify-between">
              <DirectionBadge direction={data.modflow.setupConfirmation} />
              <span className="font-mono text-[11px] text-ink-secondary tabular-nums">
                Score {data.modflow.institutionalScore}/100
              </span>
            </div>

            <div className="mt-3.5 space-y-2.5">
              <div>
                <div className="mb-1 flex justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-bull">Buy {data.modflow.aggressiveBuyPct.toFixed(1)}%</span>
                  <span className="text-ink-secondary">Tape Flow</span>
                  <span className="text-bear">Sell {data.modflow.aggressiveSellPct.toFixed(1)}%</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                  <div className="bg-bull" style={{ width: `${data.modflow.aggressiveBuyPct}%` }} />
                  <div className="bg-bear" style={{ width: `${data.modflow.aggressiveSellPct}%` }} />
                </div>
              </div>

              {data.modflow.orderBookStatus !== "UNAVAILABLE" && (
                <div>
                  <div className="mb-1 flex justify-between text-[11px] font-mono tabular-nums">
                    <span className="text-bull">Bid {data.modflow.bidPressurePct.toFixed(1)}%</span>
                    <span className="text-ink-secondary">L2 Book</span>
                    <span className="text-bear">Ask {data.modflow.askPressurePct.toFixed(1)}%</span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]">
                    <div className="bg-bull/80" style={{ width: `${data.modflow.bidPressurePct}%` }} />
                    <div className="bg-bear/80" style={{ width: `${data.modflow.askPressurePct}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-ink/[0.06] pt-3 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-[9.5px] font-sans text-ink-secondary uppercase">POC</div>
                <div className="text-ink-secondary">{formatPrice(data.modflow.poc)}</div>
              </div>
              <div>
                <div className="text-[9.5px] font-sans text-ink-secondary uppercase">VAH / VAL</div>
                <div className="text-ink">
                  {formatPrice(data.modflow.vah, 0)}/{formatPrice(data.modflow.val, 0)}
                </div>
              </div>
              <div>
                <div className="text-[9.5px] font-sans text-ink-secondary uppercase">CVD</div>
                <div className="text-ink">{data.modflow.cvdSlope}</div>
              </div>
            </div>
          </Panel>
        );

      case "liquidity_sessions":
        return (
          <Panel
            title="Liquidity & Sessions"
            subtitle={data.sessions.utcTime}
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("liquidity")}>
                Map <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="flex items-center gap-1.5">
              {data.sessions.sessions.map((s) => (
                <div
                  key={s.code}
                  className={cn(
                    "flex-1 rounded-lg border px-2.5 py-2 text-center",
                    s.active
                      ? "border-bull/30 bg-bull/[0.08]"
                      : "border-ink/[0.06] bg-elevated"
                  )}
                >
                  <div className="flex items-center justify-center gap-1 text-[10.5px] font-medium">
                    <span className={cn("h-1.5 w-1.5 rounded-full", s.active ? "bg-bull" : "bg-outline")} />
                    <span className={s.active ? "text-ink" : "text-ink-secondary"}>{s.code}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-ink-secondary">
                    {s.active ? `${Math.floor(s.minutesRemaining / 60)}h${s.minutesRemaining % 60}m` : s.openUtc}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5 font-mono text-[11.5px] tabular-nums">
              <div className="flex items-center justify-between">
                <span className="font-sans text-ink-secondary">Nearest Buy-Side</span>
                <span className="text-bear">
                  {data.liquidity.nearestBsl
                    ? `${data.liquidity.nearestBsl.shortLabel} $${formatPrice(data.liquidity.nearestBsl.price)}`
                    : "None above"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-ink-secondary">Nearest Sell-Side</span>
                <span className="text-bull">
                  {data.liquidity.nearestSsl
                    ? `${data.liquidity.nearestSsl.shortLabel} $${formatPrice(data.liquidity.nearestSsl.price)}`
                    : "None below"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-ink-secondary">Open FVGs / OBs</span>
                <span className="text-ink">
                  {data.liquidity.counts.fvgs} FVG · {data.liquidity.counts.orderBlocks} OB ·{" "}
                  {data.liquidity.counts.sweeps + data.liquidity.counts.stopHunts} Swp
                </span>
              </div>
              {data.liquidity.lastEvent && (
                <div className="flex items-center justify-between border-t border-ink/[0.06] pt-2 text-[11px]">
                  <span className="font-sans text-ink-secondary">Last Shift</span>
                  <span className="text-ink-secondary">
                    {data.liquidity.lastEvent.label} ({formatPrice(data.liquidity.lastEvent.price)})
                  </span>
                </div>
              )}
            </div>
          </Panel>
        );

      case "account_stats":
        return (
          <Panel
            title="Account & Daily Stats"
            subtitle={data.account.brokerConfigured ? data.account.brokerProvider : "Desk ledger"}
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("risk")}>
                Risk <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-[10.5px] text-ink-secondary uppercase">Equity</div>
                <div className="font-mono text-[22px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
                  {formatCurrency(data.account.equity)}
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-[10.5px] font-sans text-ink-secondary uppercase">Cumulative</div>
                <div className={cn("text-[13px] font-medium", data.account.netPnl >= 0 ? "text-bull" : "text-bear")}>
                  {formatCurrency(data.account.netPnl, true)}
                </div>
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-ink/[0.06] pt-3 font-mono text-[11.5px] tabular-nums">
              <div>
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Win Rate</div>
                <div className="text-ink">{data.account.winRate}%</div>
                <div className="text-[10px] text-ink-secondary">
                  {data.account.wins}W / {data.account.losses}L
                </div>
              </div>
              <div>
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Today P&L</div>
                <div className={data.account.todayPnl >= 0 ? "text-bull" : "text-bear"}>
                  {formatCurrency(data.account.todayPnl, true)}
                </div>
                <div className="text-[10px] text-ink-secondary">{data.account.todayTrades} trade(s)</div>
              </div>
              <div>
                <div className="text-[9.5px] font-sans text-ink-tertiary uppercase">Risk/Trade</div>
                <div className="text-ink-secondary">{data.account.riskPerTradePct}%</div>
                <div className="text-[10px] text-ink-secondary">Max {data.account.maxDailyLossPct}%/d</div>
              </div>
            </div>
          </Panel>
        );

      case "economic_events":
        return (
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                High-Impact Economic Events
                <DataStatusBadge status={data.calendar.status} />
              </span>
            }
            subtitle="Forex Factory weekly schedule (gold-sensitive highlighted)"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("calendar")}>
                Calendar <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {data.calendar.events.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-ink-secondary">
                {data.calendar.error ?? "No remaining high-impact events scheduled this week."}
              </p>
            ) : (
              <div className="divide-y divide-ink/[0.05]">
                {data.calendar.events.slice(0, 5).map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          ev.impact === "High" ? "bg-bear" : "bg-ink-secondary"
                        )}
                      />
                      <span className="w-8 shrink-0 font-mono text-[11px] font-medium text-ink">
                        {ev.currency}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink">{ev.title}</p>
                        <p className="font-mono text-[10px] text-ink-tertiary">
                          {formatDateTime(ev.timestamp, timezone, { short: true })} · F: {ev.forecast} · P: {ev.previous}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-ink-secondary tabular-nums">
                      <Clock className="h-3 w-3 text-ink-secondary" />
                      {formatCountdown(ev.timestamp, nowMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );

      case "alerts_feed":
        return (
          <Panel
            title={
              <span className="inline-flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5 text-ink-secondary" /> Recent Alerts
              </span>
            }
            subtitle="Signals, liquidity sweeps, invalidations & feed health"
            action={
              <Button variant="ghost" size="sm" onClick={() => onNavigate("alerts")}>
                All Alerts <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            }
          >
            {data.alerts.length === 0 ? (
              <p className="py-5 text-center text-[12px] text-ink-secondary">No notifications logged.</p>
            ) : (
              <div className="space-y-2">
                {data.alerts.slice(0, 4).map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      a.severity === "CRITICAL"
                        ? "border-bear/25 bg-bear/[0.06]"
                        : a.severity === "WARNING"
                          ? "border-outline bg-inset"
                          : "border-ink/[0.06] bg-elevated"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium text-ink">{cleanCopy(a.title)}</span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-tertiary">
                        {formatDateTime(a.createdAt, timezone, { timeOnly: true })}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-ink-secondary">{cleanCopy(a.message)}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact workstation control row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11.5px] text-ink-secondary">
          <span>Updated {formatDateTime(data.timestamp, timezone, { timeOnly: true })}</span>
          <span>·</span>
          <span>Timezone {timezone}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCustomizeOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
          </Button>
          <Button variant="secondary" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "")} /> Sync
          </Button>
        </div>
      </div>

      {/* Customizable 12-col editorial grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {widgets
          .filter((w) => w.visible)
          .map((w) => (
            <div key={w.id} className={spanMap[w.id] ?? "lg:col-span-6"}>
              {renderWidget(w.id)}
            </div>
          ))}
      </div>

      {/* Customize widgets Liquid Glass modal */}
      <ModalSheet
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title="Customize Overview Layout"
        subtitle="Toggle visibility and adjust panel order. Saved directly to your workspace."
      >
        <div className="space-y-2">
          {widgets.map((w, idx) => (
            <div
              key={w.id}
              className="freyr-card flex items-center justify-between gap-3 px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0 || savingWidgets}
                    onClick={() => moveWidget(idx, -1)}
                    aria-label={`Move ${w.label} up`}
                    className="flex h-6 w-6 items-center justify-center rounded border border-ink/[0.08] text-ink-secondary hover:text-ink disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === widgets.length - 1 || savingWidgets}
                    onClick={() => moveWidget(idx, 1)}
                    aria-label={`Move ${w.label} down`}
                    className="flex h-6 w-6 items-center justify-center rounded border border-ink/[0.08] text-ink-secondary hover:text-ink disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <span className={cn("truncate text-[12.5px]", isVisible(w.id) ? "text-ink" : "text-ink-tertiary")}>
                  {w.label}
                </span>
              </div>
              <Switch
                checked={w.visible}
                onChange={(v) => toggleWidget(w.id, v)}
                disabled={savingWidgets}
                label={`Toggle ${w.label}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => saveWidgetConfig(widgets.map((w) => ({ ...w, visible: true })))}
          >
            Show All Widgets
          </Button>
          <Button variant="primary" size="sm" onClick={() => setCustomizeOpen(false)}>
            Done
          </Button>
        </div>
      </ModalSheet>
    </div>
  );
}

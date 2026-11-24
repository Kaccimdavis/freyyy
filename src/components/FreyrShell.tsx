"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  CandlestickChart as CandleIcon,
  Compass,
  Ellipsis,
  FlaskConical,
  History,
  Layers,
  LayoutGrid,
  Menu,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  User,
} from "lucide-react";
import type { Timeframe } from "@/lib/market-data";
import type { AppearanceMode } from "@/db/schema";
import { cn, formatPrice, formatDataStatus, cleanCopy, ModalSheet, type NavTab } from "@/components/ui/primitives";
import { OverviewView } from "@/components/modules/OverviewView";
import { MarketsView } from "@/components/modules/MarketsView";
import { AiAnalystView } from "@/components/modules/AiAnalystView";
import { SignalsView } from "@/components/modules/SignalsView";
import type { MarketPulse } from "@/components/modules/MarketWatch";
import { ModFlowView } from "@/components/modules/ModFlowView";
import { LiquidityView } from "@/components/modules/LiquidityView";
import { StrategiesView } from "@/components/modules/StrategiesView";
import { BacktestingView } from "@/components/modules/BacktestingView";
import { RiskView } from "@/components/modules/RiskView";
import { CalendarView } from "@/components/modules/CalendarView";
import { JournalView } from "@/components/modules/JournalView";
import { AnalyticsView } from "@/components/modules/AnalyticsView";
import { AlertsView } from "@/components/modules/AlertsView";
import { AutomationView } from "@/components/modules/AutomationView";
import { SettingsView } from "@/components/modules/SettingsView";

interface NavItem {
  id: NavTab;
  label: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Command",
    items: [
      { id: "overview", label: "Overview", title: "Overview", subtitle: "Gold-first trading command center", icon: LayoutGrid },
      { id: "markets", label: "Markets", title: "Markets", subtitle: "XAU/USD, Forex, Indices & Crypto", icon: CandleIcon },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "signals", label: "Signals", title: "Signals", subtitle: "One call at a time, locked at publication", icon: Radio },
      { id: "analyst", label: "Analyze", title: "Chart Analysis", subtitle: "Top-down read with entry, stop and targets", icon: TrendingUp },
      { id: "calendar", label: "News", title: "News", subtitle: "Gold calls and the Forex Factory calendar", icon: Newspaper },
      { id: "modflow", label: "ModFlow", title: "ModFlow", subtitle: "Order flow, volume delta, CVD & L2 depth", icon: Activity },
      { id: "liquidity", label: "Liquidity", title: "Liquidity", subtitle: "Pools, session ranges, FVGs & blocks", icon: Layers },
    ],
  },
  {
    label: "Systems",
    items: [
      { id: "strategies", label: "Strategies", title: "Strategies", subtitle: "Rule builder & multi-timeframe models", icon: Compass },
      { id: "backtesting", label: "Backtesting", title: "Backtesting", subtitle: "Simulated historical strategy engine", icon: FlaskConical },
      { id: "risk", label: "Risk", title: "Risk Management", subtitle: "Capital protection & position sizing", icon: Shield },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "analytics", label: "History", title: "History", subtitle: "Journal performance and trade history", icon: History },
      { id: "journal", label: "Journal", title: "Journal", subtitle: "Execution review, mistakes & lessons", icon: BookOpen },
      { id: "alerts", label: "Alerts", title: "Alerts", subtitle: "Signals, milestones and SL/TP notifications", icon: Bell },
      { id: "automation", label: "Automation", title: "Automation", subtitle: "Safety-locked monitors & emergency stop", icon: SlidersHorizontal },
      { id: "settings", label: "Settings", title: "Settings", subtitle: "Profile, security and legal", icon: Settings },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const DOCK: Array<{ id: NavTab; label: string; icon: NavItem["icon"] }> = [
  { id: "signals", label: "Signals", icon: Radio },
  { id: "analyst", label: "Analyze", icon: TrendingUp },
  { id: "calendar", label: "News", icon: Newspaper },
  { id: "analytics", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

function FreyrMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-ink">
      <path
        d="M3.2 16.6 8.4 9.1c.5-.7 1.6-.7 2.1 0l2.7 3.8 2.6-3.4c.5-.6 1.4-.6 1.9 0l3.1 4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20.4" cy="6" r="1.9" fill="currentColor" />
    </svg>
  );
}

function applyAppearanceToDocument(mode: AppearanceMode) {
  if (typeof document === "undefined") return;
  const resolved =
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : mode;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

export interface InitialShellProps {
  initialTimezone: string;
  initialSymbol: string;
  initialTimeframe: Timeframe;
  initialHollowCandles: boolean;
  initialUserName: string;
  initialUnreadAlerts: number;
  initialGoldPrice: number | null;
  initialGoldStatus: string;
  initialAppearance: AppearanceMode;
  useDeviceAppearance?: boolean;
}

export function FreyrShell({
  initialTimezone,
  initialSymbol,
  initialTimeframe,
  initialHollowCandles,
  initialUserName,
  initialUnreadAlerts,
  initialGoldPrice,
  initialGoldStatus,
  initialAppearance,
  useDeviceAppearance = false,
}: InitialShellProps) {
  const [tab, setTab] = useState<NavTab>("signals");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [timezone, setTimezone] = useState(initialTimezone || "UTC");
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol || "XAUUSD");
  const [defaultTf, setDefaultTf] = useState<Timeframe>(initialTimeframe || "15m");
  const [hollowCandles, setHollowCandles] = useState(initialHollowCandles);
  const [userName, setUserName] = useState(initialUserName);
  const [unread, setUnread] = useState(initialUnreadAlerts);
  const [gold, setGold] = useState<MarketPulse>({
    symbol: "XAUUSD", price: initialGoldPrice, status: initialGoldStatus, points: [], low: null, high: null, decimals: 2, changePct: null,
  });
  const [appearance, setAppearance] = useState<AppearanceMode>(initialAppearance);
  const appliedInitialAppearance = useRef(false);
  const [monitorTick, setMonitorTick] = useState(0);
  const [backtestTarget, setBacktestTarget] = useState<{ strategyId: number | null; symbol?: string }>({
    strategyId: null,
  });

  // Apply and follow the selected appearance
  useEffect(() => {
    if (!appliedInitialAppearance.current) {
      appliedInitialAppearance.current = true;
      if (useDeviceAppearance) {
        try {
          const saved = window.localStorage.getItem("freyr-appearance");
          if ((saved === "system" || saved === "light" || saved === "dark") && saved !== appearance) { setAppearance(saved); return; }
        } catch { /* Use the initial document appearance. */ }
      }
    }
    applyAppearanceToDocument(appearance);
    try {
      window.localStorage.setItem("freyr-appearance", appearance);
    } catch {
      /* private mode */
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (appearance === "system") applyAppearanceToDocument("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance, useDeviceAppearance]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as NavTab;
    if (hash && ALL_ITEMS.some((i) => i.id === hash)) setTab(hash);
    const onHash = () => {
      const next = window.location.hash.replace("#", "") as NavTab;
      if (next && ALL_ITEMS.some((i) => i.id === next)) setTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    async function refreshGold() {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const response = await fetch("/api/market-pulse", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const reading = await response.json();
        if (!controller.signal.aborted) setGold(reading);
      } catch {
        if (!controller.signal.aborted) setGold((previous) => ({ ...previous, price: null, status: "UNAVAILABLE" }));
      } finally { polling = false; }
    }
    void refreshGold();
    const timer = window.setInterval(refreshGold, 25_000);
    document.addEventListener("visibilitychange", refreshGold);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshGold); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cursor: number | null = null;
    let polling = false;
    async function scan() {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch(`/api/monitoring/scan${cursor === null ? "" : `?after=${cursor}`}`, { method: "POST", signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { newestAlertId: number; unreadCount: number; browserEnabled: boolean; newAlerts: Array<{ id: number; title: string; message: string }> };
        if (controller.signal.aborted) return;
        setUnread(data.unreadCount);
        setMonitorTick((value) => value + 1);
        cursor = Math.max(cursor ?? 0, data.newestAlertId);
        if (data.browserEnabled && "Notification" in window && Notification.permission === "granted") {
          for (const alert of data.newAlerts.reverse()) {
            try { new Notification(cleanCopy(alert.title), { body: cleanCopy(alert.message), tag: `freyr-alert-${alert.id}` }); }
            catch { /* The in-app alert remains available on browsers that don't support this constructor. */ }
          }
        }
      } catch { /* Feed status can still be inspected separately. */ }
      finally { polling = false; }
    }
    void scan();
    const timer = window.setInterval(scan, 25_000);
    const resume = () => { if (!document.hidden) void scan(); };
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, []);

  const navigate = useCallback((next: NavTab) => {
    setTab(next);
    setMobileMenu(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
      window.scrollTo({ top: 0 });
    }
  }, []);

  const activeMeta = ALL_ITEMS.find((i) => i.id === tab) ?? ALL_ITEMS[0];
  const primaryView = DOCK.some((item) => item.id === tab);
  const navigation = <span className="lg:hidden"><button type="button" aria-label="Open navigation" title="Workspace menu" onClick={() => setMobileMenu(true)} className="freyr-icon-button">
    <Ellipsis size={21} strokeWidth={1.8} aria-hidden="true" />
    {unread > 0 && <span aria-hidden="true" className="absolute top-2 right-2 size-1.5 rounded-full freyr-selection-dot" />}
  </button></span>;

  const handleBacktestStrategy = (strategyId: number, symbol: string) => {
    setBacktestTarget({ strategyId, symbol });
    navigate("backtesting");
  };

  const statusDot =
    gold.status === "UNAVAILABLE" ? "bg-bear" : "bg-ink-secondary";

  const renderNavList = (isCollapsed: boolean) => (
    <nav aria-label="Primary sections" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          {!isCollapsed && (
            <div className="mb-1 px-2.5 text-[10px] font-bold tracking-[0.12em] text-ink-tertiary uppercase">
              {group.label}
            </div>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  title={isCollapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "freyr-nav-item group relative flex w-full items-center gap-2.5 rounded-xl text-[13px] cursor-pointer",
                    isCollapsed ? "justify-center px-0 py-2" : "px-2.5 py-2",
                    active
                      ? "font-semibold"
                      : "text-ink-secondary hover:bg-hover hover:text-ink"
                  )}
                >
                  <Icon
                    className={cn(
                      "freyr-nav-icon h-4 w-4 shrink-0 text-ink-tertiary group-hover:text-ink-secondary"
                    )}
                    strokeWidth={active ? 2 : 1.7}
                  />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                  {item.id === "alerts" && unread > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5",
                        isCollapsed ? "absolute top-0.5 right-0.5 px-1 text-[8px]" : "ml-auto py-0.5"
                      )}
                    >
                      <span aria-hidden="true" className="freyr-selection-dot block size-1.5 rounded-full" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "liquid-glass fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-ink/[0.07] lg:flex",
          collapsed ? "w-[64px]" : "w-[226px]"
        )}
      >
        <div className="flex h-[52px] items-center justify-between border-b border-ink/[0.06] px-3.5">
          <button type="button" onClick={() => navigate("signals")} className="flex min-w-0 items-center gap-2 cursor-pointer">
            <FreyrMark />
            {!collapsed && <span className="text-[15px] font-bold tracking-[-0.01em]">Freyr</span>}
          </button>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {renderNavList(collapsed)}

        <div className="border-t border-ink/[0.06] px-2.5 py-2.5">
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.06] cursor-pointer"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("settings")}
              className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-ink/[0.05] cursor-pointer"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-inset text-ink-secondary">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-semibold text-ink">{userName}</span>
                <span className="block truncate font-mono text-[9.5px] text-ink-tertiary">{timezone}</span>
              </span>
            </button>
          )}
        </div>
      </aside>

      <ModalSheet open={mobileMenu} onClose={() => setMobileMenu(false)} title="Workspace" maxWidth="max-w-md">
        {renderNavList(false)}
      </ModalSheet>

      {/* Workspace */}
      <div
        className={cn(
          "freyr-workspace flex min-h-screen flex-col",
          collapsed ? "lg:pl-[64px]" : "lg:pl-[226px]"
        )}
      >
        <header className={cn("liquid-glass sticky top-0 z-20 h-[52px] items-center justify-between gap-2 border-b px-4 lg:px-6", primaryView ? "hidden lg:flex" : "flex")}>
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenu(true)}
              aria-label="Open navigation"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/[0.08] bg-ink/[0.04] text-ink lg:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 lg:hidden">
              <FreyrMark />
              <span className="text-[14px] font-bold">Freyr</span>
            </div>
            <span className="hidden truncate text-[13px] font-semibold text-ink lg:block">{activeMeta.title}</span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedSymbol("XAUUSD");
                navigate("markets");
              }}
              className="flex items-center gap-1.5 rounded-full border border-ink/[0.09] bg-ink/[0.04] py-1 pr-2.5 pl-2 text-[11px] cursor-pointer"
              title={`XAU/USD · ${formatDataStatus(gold.status)}`}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
              <span className="font-semibold tabular-nums text-ink">{gold.price !== null ? formatPrice(gold.price, 2) : "—"}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("alerts")}
              aria-label="Notifications"
              className="relative flex h-8 w-8 items-center justify-center rounded-full border border-ink/[0.08] bg-ink/[0.04] text-ink-secondary hover:text-ink cursor-pointer"
            >
              <Bell className="h-4 w-4" strokeWidth={1.7} />
              {unread > 0 && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 freyr-selection-dot rounded-full ring-2 ring-canvas" />
              )}
            </button>
          </div>
        </header>

        <main className={cn("freyr-main mx-auto w-full max-w-[1160px] flex-1", primaryView && "freyr-main-primary")}>
          <div key={tab}>
            {tab === "overview" && (
              <OverviewView onNavigate={navigate} timezone={timezone} onSelectMarket={setSelectedSymbol} />
            )}
            {tab === "markets" && (
              <MarketsView
                selectedSymbol={selectedSymbol}
                onSelectSymbol={setSelectedSymbol}
                timezone={timezone}
                defaultTimeframe={defaultTf}
                hollowCandles={hollowCandles}
              />
            )}
            {tab === "analyst" && <AiAnalystView timezone={timezone} onNavigate={navigate} navigation={navigation} />}
            {tab === "signals" && <SignalsView timezone={timezone} monitorTick={monitorTick} gold={gold} navigation={navigation} onMarkets={(symbol) => { setSelectedSymbol(symbol); navigate("markets"); }} />}
            {tab === "modflow" && <ModFlowView timezone={timezone} />}
            {tab === "liquidity" && <LiquidityView timezone={timezone} />}
            {tab === "strategies" && <StrategiesView onBacktestStrategy={handleBacktestStrategy} onNavigate={navigate} />}
            {tab === "backtesting" && (
              <BacktestingView
                initialStrategyId={backtestTarget.strategyId}
                initialSymbol={backtestTarget.symbol}
                timezone={timezone}
              />
            )}
            {tab === "risk" && <RiskView />}
            {tab === "calendar" && <CalendarView timezone={timezone} navigation={navigation} />}
            {tab === "journal" && <JournalView timezone={timezone} />}
            {tab === "analytics" && <AnalyticsView timezone={timezone} navigation={navigation} onJournal={() => navigate("journal")} />}
            {tab === "alerts" && <AlertsView timezone={timezone} onUnreadChange={setUnread} monitorTick={monitorTick} />}
            {tab === "automation" && <AutomationView timezone={timezone} onNavigate={navigate} />}
            {tab === "settings" && (
              <SettingsView
                navigation={navigation}
                appearance={appearance}
                onAppearanceChange={setAppearance}
                onPrefsChanged={(patch) => {
                  if (patch.timezone) setTimezone(patch.timezone);
                  if (patch.defaultSymbol) setSelectedSymbol(patch.defaultSymbol);
                  if (patch.defaultTimeframe) setDefaultTf(patch.defaultTimeframe);
                  if (patch.hollowCandles !== undefined) setHollowCandles(patch.hollowCandles);
                  if (patch.userName) setUserName(patch.userName);
                }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Floating dock */}
      <nav aria-label="Primary tabs" className="freyr-dock fixed z-30 mx-auto max-w-[480px] lg:hidden">
        <div className="liquid-glass freyr-dock-surface flex items-stretch justify-between gap-0.5 rounded-[25px] border p-1.5">
          {DOCK.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id)}
                aria-current={active ? "page" : undefined}
                className="freyr-dock-item"
              >
                <Icon className="freyr-nav-icon h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.65} />
                <span className={active ? "font-semibold" : "font-medium"}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

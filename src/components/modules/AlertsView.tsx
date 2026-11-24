"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, Check, CheckCheck, Radar, Trash2 } from "lucide-react";
import type { NotificationPreferences } from "@/db/schema";
import {
  Button,
  EmptyState,
  ErrorBanner,
  Panel,
  PanelSkeleton,
  Switch,
  cn,
  formatDateTime,
  cleanCopy,
} from "@/components/ui/primitives";

interface AlertItem {
  id: number;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  symbol: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "SIGNAL", label: "Signals" },
  { key: "ENTRY_ZONE", label: "Entry Zone" },
  { key: "LIQUIDITY_SWEEP", label: "Sweeps" },
  { key: "STRUCTURE", label: "BOS/CHoCH" },
  { key: "ECONOMIC", label: "Economic" },
  { key: "SL_TP", label: "Stops & targets" },
  { key: "MILESTONE", label: "Milestones" },
  { key: "SIGNAL_EXPIRED", label: "Expiry" },
  { key: "VOLATILITY", label: "Volatility" },
  { key: "INVALIDATION", label: "Invalidated" },
  { key: "FEED", label: "Feed/System" },
];

export function AlertsView({
  timezone,
  onUnreadChange,
  monitorTick,
}: {
  timezone: string;
  onUnreadChange: (count: number) => void;
  monitorTick?: number;
}) {
  const [list, setList] = useState<AlertItem[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [cat, setCat] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<string>("default");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setList(j.alerts ?? []);
      setPrefs(j.preferences ?? null);
      onUnreadChange(j.unreadCount ?? 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    load();
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPerm(Notification.permission);
    }
  }, [load, monitorTick]);

  const act = async (action: "mark_read" | "mark_all_read" | "scan_live" | "clear_read", id?: number) => {
    if (action === "scan_live") setScanning(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn’t update alerts.");
      if (action === "scan_live" && j.alerts) {
        setList(j.alerts);
        onUnreadChange(j.unreadCount ?? 0);
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t update alerts.");
    } finally {
      setScanning(false);
    }
  };

  const togglePref = async (key: keyof NotificationPreferences, val: boolean) => {
    if (!prefs) return;
    if (key === "browserEnabled" && val && typeof window !== "undefined" && "Notification" in window) {
      const p = await Notification.requestPermission();
      setBrowserPerm(p);
      if (p !== "granted") return;
    }
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationPrefs: next }),
    });
  };

  if (loading) return <PanelSkeleton rows={6} />;

  const filtered = list.filter((a) => {
    if (cat === "ALL") return true;
    if (cat === "FEED") return a.category === "FEED" || a.category === "SYSTEM";
    return a.category === cat;
  });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCat(c.key)}
                aria-pressed={cat === c.key}
                className="freyr-selectable rounded-lg bg-surface px-2.5 py-1 text-[11px] font-medium text-ink-secondary cursor-pointer"
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="gold" size="sm" onClick={() => act("scan_live")} disabled={scanning}>
              <Radar className={cn("h-3.5 w-3.5", scanning && "")} />
              {scanning ? "Scanning…" : "Scan market"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => act("mark_all_read")}>
              <CheckCheck className="h-3.5 w-3.5" /> Read All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => act("clear_read")} aria-label="Clear read alerts">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}

        {filtered.length === 0 ? (
          <EmptyState
            title="No alerts in this category"
            description="Run a market scan to inspect XAUUSD liquidity sweeps, structure shifts, volatility spikes, calendar alerts, and data feed health."
            action={
              <Button variant="secondary" size="sm" onClick={() => act("scan_live")}>
                Scan markets
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => (
              <div
                key={a.id}
                className={cn(
                  "freyr-panel flex items-start justify-between gap-3 px-4 py-3 transition-opacity",
                  a.isRead && "opacity-65",
                  a.severity === "CRITICAL" && "border-bear/30",
                  a.severity === "WARNING" && !a.isRead && "border-outline"
                )}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      a.severity === "CRITICAL"
                        ? "bg-bear"
                        : a.severity === "WARNING"
                          ? "bg-ink-secondary"
                          : "bg-bull"
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{cleanCopy(a.title)}</span>
                      <span className="rounded bg-ink/[0.05] px-1.5 py-[1px] font-mono text-[9.5px] text-ink-secondary">
                        {CATEGORIES.find((entry) => entry.key === a.category)?.label ?? "System"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-ink-secondary">{cleanCopy(a.message)}</p>
                    <span className="mt-1 block font-mono text-[10px] text-ink-tertiary">
                      {a.symbol} · {formatDateTime(a.createdAt, timezone, { short: true })}
                    </span>
                  </div>
                </div>
                {!a.isRead && (
                  <button
                    type="button"
                    onClick={() => act("mark_read", a.id)}
                    aria-label="Mark read"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ink/[0.08] text-ink-secondary hover:text-ink cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Configurable Preferences */}
      <div className="lg:col-span-4">
        <Panel
          title={
            <span className="inline-flex items-center gap-1.5">
              {prefs?.browserEnabled ? <BellRing className="h-3.5 w-3.5 text-bull" /> : <Bell className="h-3.5 w-3.5 text-ink-secondary" />}
              Alert Preferences
            </span>
          }
          subtitle={`Browser permission: ${browserPerm}`}
        >
          {prefs && (
            <div className="space-y-2.5 text-[12px]">
              {(
                [
                  ["browserEnabled", "Browser notifications"],
                  ["newSignals", "New Trading Signals"],
                  ["entryZone", "Approaching Entry Zones"],
                  ["liquiditySweeps", "Liquidity Sweeps"],
                  ["bosChoch", "BOS & CHoCH Shifts"],
                  ["economicEvents", "High-Impact Calendar Events"],
                  ["slTpHits", "Milestones, stops and targets"],
                  ["volatility", "Market Volatility Spikes"],
                  ["invalidations", "Invalidated Setups"],
                  ["systemErrors", "System & Data Feed Errors"],
                ] as Array<[keyof NotificationPreferences, string]>
              ).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between py-0.5">
                  <span className={k === "browserEnabled" ? "font-medium text-ink" : "text-ink-secondary"}>
                    {label}
                  </span>
                  <Switch checked={prefs[k]} onChange={(v) => togglePref(k, v)} label={label} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

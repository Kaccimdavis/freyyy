"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Lock, OctagonAlert, Plus, RotateCcw, ShieldOff } from "lucide-react";
import type { BrokerConfig } from "@/db/schema";
import {
  Button,
  ErrorBanner,
  INPUT_CLS,
  LABEL_CLS,
  ModalSheet,
  Panel,
  PanelSkeleton,
  Switch,
  cn,
  formatDateTime,
  cleanCopy,
  type NavTab,
} from "@/components/ui/primitives";

interface AutoRule {
  id: number;
  name: string;
  symbol: string;
  mode: string;
  isEnabled: boolean;
  allowedSessions: string[];
  minConfidence: number;
  maxDailyTriggers: number;
  stopOnDailyLoss: boolean;
  pauseBeforeHighImpactMins: number;
}

interface AutoLog {
  id: number;
  action: string;
  status: string;
  symbol: string;
  detail: string;
  createdAt: string;
}

interface AutoPayload {
  master: {
    masterEnabled: boolean;
    emergencyStopped: boolean;
    executionAuthorized: boolean;
    lastToggledAt: string;
    reason: string;
  };
  broker: BrokerConfig;
  rules: AutoRule[];
  logs: AutoLog[];
  strategies: Array<{ id: number; name: string }>;
}

export function AutomationView({
  timezone,
  onNavigate,
}: {
  timezone: string;
  onNavigate: (tab: NavTab) => void;
}) {
  const [data, setData] = useState<AutoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "warn" | "ok"; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    symbol: "XAUUSD",
    strategyId: "",
    allowedSessions: ["London", "New York"],
    minConfidence: "72",
    maxDailyTriggers: "2",
    pauseBeforeHighImpactMins: "30",
    stopOnDailyLoss: true,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/automation", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (payload: Record<string, unknown>) => {
    setNotice(null);
    const res = await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok) {
      setNotice({ tone: "warn", text: j.error || "Action blocked by safety controls" });
    } else if (payload.action === "emergency_stop") {
      setNotice({ tone: "warn", text: "Emergency Stop engaged. Every monitor and execution switch halted immediately." });
    } else {
      setNotice({ tone: "ok", text: "Automation governance state saved." });
    }
    await load();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await send({
      action: "create_rule",
      name: form.name,
      symbol: form.symbol,
      strategyId: form.strategyId ? Number(form.strategyId) : undefined,
      allowedSessions: form.allowedSessions,
      minConfidence: Number(form.minConfidence),
      maxDailyTriggers: Number(form.maxDailyTriggers),
      pauseBeforeHighImpactMins: Number(form.pauseBeforeHighImpactMins),
      stopOnDailyLoss: form.stopOnDailyLoss,
    });
    setCreateOpen(false);
    setForm((p) => ({ ...p, name: "" }));
  };

  if (loading || !data) return <PanelSkeleton rows={7} />;

  const { master, broker, rules, logs } = data;
  // This repository currently has no MT5/broker order-placement adapter. UI authorization must stay locked.
  const brokerAuthorized = false;

  return (
    <div className="space-y-4">
      {/* Safety Governance Hero + Prominent Emergency Stop */}
      <Panel
        className={cn(
          master.emergencyStopped
            ? "border-bear/40"
            : !brokerAuthorized
              ? "border-ink/[0.1]"
              : "border-bull/25"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              {master.emergencyStopped ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-bear/40 bg-bear/15 px-2.5 py-0.5 text-[10.5px] font-semibold text-bear uppercase">
                  <ShieldOff className="h-3 w-3" /> Emergency Stop Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-ink/[0.05] px-2.5 py-0.5 text-[10.5px] font-medium text-ink">
                  <Lock className="h-3 w-3 text-ink-secondary" />
                  Auto-Execution: {master.executionAuthorized ? "Authorized" : "Disabled (Safe Default)"}
                </span>
              )}
              <span className="font-mono text-[10.5px] text-ink-secondary">
                Monitoring: {master.masterEnabled ? "ACTIVE" : "OFF"}
              </span>
            </div>
            <p className="mt-2 text-[12.5px] text-ink-secondary">{cleanCopy(master.reason)}</p>
            <p className="mt-1 text-[11px] text-ink-tertiary">
              Broker: {broker.provider} · Updated {formatDateTime(master.lastToggledAt, timezone, { short: true })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {master.emergencyStopped ? (
              <Button variant="secondary" onClick={() => send({ action: "reset_emergency" })}>
                <RotateCcw className="h-3.5 w-3.5" /> Clear Kill Switch
              </Button>
            ) : (
              <Button variant="danger" onClick={() => send({ action: "emergency_stop" })}>
                <OctagonAlert className="h-4 w-4" /> Emergency Stop
              </Button>
            )}
          </div>
        </div>

        {/* Dual distinct controls: Signal Monitoring vs Trade Execution */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-ink/[0.06] pt-4 md:grid-cols-2">
          <div className="freyr-card flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-[12.5px] font-medium text-ink">Automated Signal Monitoring</div>
              <p className="text-[11px] text-ink-secondary">Read-only setup evaluation & notifications. Places zero trades.</p>
            </div>
            <Switch
              checked={master.masterEnabled}
              disabled={master.emergencyStopped}
              onChange={(v) => send({ action: "toggle_monitoring", enabled: v })}
              label="Toggle automated signal monitoring"
            />
          </div>

          <div className="freyr-card flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                Broker Execution
                {!brokerAuthorized && <Lock className="h-3 w-3 text-ink-secondary" />}
              </div>
              <p className="text-[11px] text-ink-secondary">
                {brokerAuthorized
                  ? `Execution adapter verified via ${broker.provider}.`
                  : "Not available: no MT5 order-placement bridge is installed. This control cannot place trades."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!brokerAuthorized && (
                <Button variant="ghost" size="sm" onClick={() => onNavigate("settings")}>
                  Broker
                </Button>
              )}
              <Switch
                checked={false}
                disabled
                onChange={() => undefined}
                label="MT5 auto-execution unavailable until an execution bridge is installed"
              />
            </div>
          </div>
        </div>
      </Panel>

      {notice && (
        notice.tone === "warn" ? (
          <ErrorBanner message={notice.text} />
        ) : (
          <div className="rounded-xl border border-bull/25 bg-bull/[0.08] px-4 py-2.5 text-[12px] text-bull">
            {notice.text}
          </div>
        )
      )}

      {/* Automation Rules */}
      <Panel
        title="Session & Strategy Automation Rules"
        subtitle="Enforces daily loss lockouts, confidence gates, and high-impact economic news pauses"
        action={
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Rule
          </Button>
        }
      >
        <div className="space-y-2.5">
          {rules.map((r) => (
            <div key={r.id} className="freyr-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{r.name}</span>
                  <span className="font-mono text-[10.5px] text-ink-secondary">{r.symbol}</span>
                  <span className="rounded bg-ink/[0.05] px-1.5 py-[1px] text-[10px] text-ink-secondary">
                    {r.mode === "EXECUTION_LOCKED" ? "Execution Locked" : "Monitor Only"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10.5px] text-ink-secondary">
                  Sessions: {r.allowedSessions.join(", ")} · Min conf {r.minConfidence}% · Cap {r.maxDailyTriggers}/day · News pause {r.pauseBeforeHighImpactMins}m
                  {r.stopOnDailyLoss ? " · Daily loss stop ON" : ""}
                </p>
              </div>
              <Switch
                checked={r.isEnabled}
                disabled={master.emergencyStopped}
                onChange={(v) => send({ action: "toggle_rule", ruleId: r.id, isEnabled: v })}
                label={`Toggle ${r.name}`}
              />
            </div>
          ))}
        </div>
      </Panel>

      {/* Execution & Governance Audit Log */}
      <Panel title="Automation & Execution History" subtitle="Every authorization check, pause, block, and emergency stop logged immutably">
        <div className="max-h-[260px] divide-y divide-ink/[0.05] overflow-y-auto text-[11.5px]">
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-[1px] font-mono text-[10px] font-medium",
                      l.status === "HALTED" || l.status === "BLOCKED"
                        ? "bg-bear/14 text-bear"
                        : l.status === "MONITORED"
                          ? "bg-bull/14 text-bull"
                          : "bg-ink/[0.06] text-ink-secondary"
                    )}
                  >
                    {l.status}
                  </span>
                  <span className="font-mono text-[11px] text-ink">{l.action}</span>
                  <span className="font-mono text-[10.5px] text-ink-secondary">{l.symbol}</span>
                </div>
                <p className="mt-0.5 text-ink-secondary">{cleanCopy(l.detail)}</p>
              </div>
              <span className="font-mono text-[10px] text-ink-tertiary">
                {formatDateTime(l.createdAt, timezone, { short: true })}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Add Rule Modal */}
      <ModalSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Monitoring Rule"
        subtitle="Starts disabled in read-only monitoring mode. Trades are never executed without explicit broker authorization."
      >
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label className={LABEL_CLS}>Rule Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. XAUUSD London Overlap Monitor" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Symbol</label>
              <select value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className={INPUT_CLS}>
                {["XAUUSD", "EURUSD", "GBPUSD", "US500", "BTCUSD", "ETHUSD"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>Linked Strategy</label>
            <select value={form.strategyId} onChange={(e) => setForm({ ...form, strategyId: e.target.value })} className={INPUT_CLS}>
              <option value="">Any Active Strategy</option>
              {data.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Session Window</label>
            <div className="flex gap-2">
              {["Asian", "London", "New York"].map((sess) => {
                const on = form.allowedSessions.includes(sess);
                return (
                  <button
                    key={sess}
                    type="button"
                    onClick={() => {
                      const next = on ? form.allowedSessions.filter((x) => x !== sess) : [...form.allowedSessions, sess];
                      if (next.length) setForm({ ...form, allowedSessions: next });
                    }}
                    aria-pressed={on}
                    className="freyr-selectable rounded-lg bg-surface px-3 py-1.5 text-[12px] text-ink-secondary cursor-pointer"
                  >
                    {sess}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className={LABEL_CLS}>Min Conf %</label>
              <input type="number" min={55} max={95} value={form.minConfidence} onChange={(e) => setForm({ ...form, minConfidence: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>Daily Limit</label>
              <input type="number" min={1} max={10} value={form.maxDailyTriggers} onChange={(e) => setForm({ ...form, maxDailyTriggers: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
            <div>
              <label className={LABEL_CLS}>News Pause (min)</label>
              <input type="number" min={0} max={120} value={form.pauseBeforeHighImpactMins} onChange={(e) => setForm({ ...form, pauseBeforeHighImpactMins: e.target.value })} className={cn(INPUT_CLS, "font-mono")} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Create Rule (Disabled)</Button>
          </div>
        </form>
      </ModalSheet>
    </div>
  );
}

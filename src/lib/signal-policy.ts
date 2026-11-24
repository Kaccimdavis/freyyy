export const SIGNAL_MAX_AGE_MS = 3 * 60 * 60_000;
export const SIGNAL_COOLDOWN_MS = 15 * 60_000;
// The partial-target state is retained for previously published signals only.
export const OPEN_SIGNAL_STATUSES = ["PENDING", "ACTIVE", "TP1_REACHED"] as const;
export const SIGNAL_STATUSES = [...OPEN_SIGNAL_STATUSES, "TP_HIT", "TP2_REACHED", "SL_HIT", "INVALIDATED", "EXPIRED"] as const;
export type SignalStatus = typeof SIGNAL_STATUSES[number];

export function isOpenSignal(status: string) {
  return (OPEN_SIGNAL_STATUSES as readonly string[]).includes(status);
}

export function isTargetHit(status: string) {
  return status === "TP_HIT" || status === "TP2_REACHED";
}

export function signalDeadline(publishedAt: Date | string): Date {
  return new Date(new Date(publishedAt).getTime() + SIGNAL_MAX_AGE_MS);
}

const NEXT: Partial<Record<SignalStatus, readonly SignalStatus[]>> = {
  PENDING: ["ACTIVE", "EXPIRED", "INVALIDATED"],
  ACTIVE: ["TP_HIT", "SL_HIT", "EXPIRED", "INVALIDATED"],
  TP1_REACHED: ["TP_HIT", "SL_HIT", "EXPIRED", "INVALIDATED"],
};

export function nextSignalStatuses(status: string): readonly SignalStatus[] {
  return NEXT[status as SignalStatus] ?? [];
}

export function publishingGate(open: boolean, lastPublishedAt: Date | null, lastClosedAt: Date | null, now = Date.now()) {
  const lastActivity = Math.max(lastPublishedAt?.getTime() ?? 0, lastClosedAt?.getTime() ?? 0);
  const remainingMs = lastActivity > 0 ? Math.max(0, lastActivity + SIGNAL_COOLDOWN_MS - now) : 0;
  return { hasOpen: open, remainingMs, nextAvailableAt: remainingMs > 0 ? new Date(lastActivity + SIGNAL_COOLDOWN_MS).toISOString() : null };
}

export function validSignalLevels(side: "BUY" | "SELL", entry: number, stop: number, target: number) {
  if (![entry, stop, target].every((n) => Number.isFinite(n) && n > 0)) return false;
  return side === "BUY" ? stop < entry && entry < target : stop > entry && entry > target;
}

/** A terminal outcome wins over an intermediate checkpoint if both are crossed by the same quote. */
export function signalPriceOutcome(signal: { direction: string; stopLoss: number; takeProfit: number; legacyPartialTarget?: number | null; status: string }, quote: number): "SL_HIT" | "TP_HIT" | "TP1_REACHED" | null {
  if (!Number.isFinite(quote) || quote <= 0 || (signal.status !== "ACTIVE" && signal.status !== "TP1_REACHED")) return null;
  const side = signal.direction === "SELL" ? -1 : 1;
  if (side * (quote - signal.stopLoss) <= 0) return "SL_HIT";
  if (side * (quote - signal.takeProfit) >= 0) return "TP_HIT";
  const legacy = signal.legacyPartialTarget;
  if (signal.status === "ACTIVE" && typeof legacy === "number" && side * (signal.takeProfit - legacy) > 0 && side * (quote - legacy) >= 0) return "TP1_REACHED";
  return null;
}

export const statusLabel: Record<SignalStatus, string> = {
  PENDING: "Pending", ACTIVE: "Active", TP1_REACHED: "Partial milestone", TP2_REACHED: "Take profit reached", TP_HIT: "Take profit reached",
  SL_HIT: "Stop loss reached", INVALIDATED: "Invalidated", EXPIRED: "Expired",
};

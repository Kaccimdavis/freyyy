import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, signalEvents, signals } from "@/db/schema";
import { expireDueSignals, isExampleSignal, withSignalWorkspace, workspaceOpen } from "./signal-cooldown";
import { isOpenSignal, signalDeadline, signalPriceOutcome, type SignalStatus } from "./signal-policy";
import { fetchSignalQuotes } from "./signal-quotes";

export async function scanWorkspaceSignals(userId: number) {
  const expiredBeforeFetch = await expireDueSignals(userId);
  const initial = (await db.select().from(signals).where(workspaceOpen(userId))).filter((signal) => !isExampleSignal(signal));
  if (!initial.length) return { checked: 0, updated: expiredBeforeFetch };
  const quotes = await fetchSignalQuotes([...new Set(initial.map((signal) => signal.symbol))]);
  return withSignalWorkspace(userId, async ({ tx, now, prefs, expired }) => {
    const open = (await tx.select().from(signals).where(workspaceOpen(userId))).filter((signal) => !isExampleSignal(signal));
    let updated = expired + expiredBeforeFetch;

    for (const sig of open) {
      const quote = quotes.get(sig.symbol);
      if (!quote || quote.observedAt < sig.publishedAt.getTime() || quote.observedAt >= signalDeadline(sig.publishedAt).getTime()) continue;
      const price = quote.price;
      const precision = sig.symbol === "EURUSD" || sig.symbol === "GBPUSD" ? 5 : 2;
      const display = price.toLocaleString("en-US", { maximumFractionDigits: precision, minimumFractionDigits: precision });
      const sourceLabel = quote.reference ? "Reference candle" : "Feed price";
      const side = sig.direction === "SELL" ? -1 : 1;
      const stopReached = side * (price - sig.stopLoss) <= 0;
      const reward = side * (price - sig.entryPrice);
      const risk = Math.abs(sig.stopLoss - sig.entryPrice);
      const outcome = signalPriceOutcome(sig, price);
      let status = sig.status as SignalStatus;
      let changed = false;

      const record = async (eventType: string, next: SignalStatus, category: string, title: string, detail: string, enabled: boolean, severity: "INFO" | "WARNING" = "INFO") => {
        const message = `${detail} ${sourceLabel}: ${display}. No broker fill is inferred.`;
        await tx.insert(signalEvents).values({ signalId: sig.id, eventType, previousStatus: status, newStatus: next, observedPrice: price, note: message });
        if (enabled) await tx.insert(alerts).values({ userId, symbol: sig.symbol, category, severity, title: `${sig.symbol} · ${title}`, message });
        status = next;
        changed = true;
      };

      if (status === "PENDING") {
        if (stopReached) await record("INVALIDATED", "INVALIDATED", "INVALIDATION", "Setup invalidated", "The quote passed the stop before a valid entry was observed.", prefs.invalidations, "WARNING");
        else if (reward <= 0) await record("TRIGGERED", "ACTIVE", "ENTRY_ZONE", "Entry zone reached", "Price entered the published zone.", prefs.entryZone);
      } else if (outcome === "SL_HIT") {
        await record("STOP_HIT", "SL_HIT", "SL_TP", "Stop reached", "Price reached or passed the published stop.", prefs.slTpHits, "WARNING");
      } else {
        if (status === "ACTIVE" && risk > 0 && reward >= risk) {
          const [milestone] = await tx.select({ id: signalEvents.id }).from(signalEvents).where(and(eq(signalEvents.signalId, sig.id), eq(signalEvents.eventType, "MILESTONE"))).limit(1);
          if (!milestone) await record("MILESTONE", status, "MILESTONE", "One risk unit reached", "The indicative move reached at least +1R. Original levels remain in place.", prefs.slTpHits);
        }
        if (outcome === "TP_HIT") {
          await record("TARGET_HIT", "TP_HIT", "SL_TP", "Take profit reached", "Price reached or passed the published take profit.", prefs.slTpHits);
        } else if (outcome === "TP1_REACHED") {
          await record("TARGET_HIT", "TP1_REACHED", "SL_TP", "Archived partial milestone reached", "Price reached the original partial checkpoint for this earlier signal.", prefs.slTpHits);
        }
      }
      if (status !== sig.status) await tx.update(signals).set({ status, closedAt: isOpenSignal(status) ? null : now }).where(eq(signals.id, sig.id));
      if (changed) updated++;
    }
    return { checked: open.length, updated };
  });
}

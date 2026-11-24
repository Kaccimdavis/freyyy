import { and, desc, eq, inArray, lte, max } from "drizzle-orm";
import { db } from "@/db";
import { alerts, signalEvents, signals, users, type NotificationPreferences } from "@/db/schema";
import { OPEN_SIGNAL_STATUSES, SIGNAL_MAX_AGE_MS, publishingGate, signalDeadline } from "./signal-policy";

type SignalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SignalRow = typeof signals.$inferSelect;

export const workspaceOpen = (userId: number) => and(eq(signals.userId, userId), inArray(signals.status, [...OPEN_SIGNAL_STATUSES]));
export const isExampleSignal = (signal: Pick<SignalRow, "fingerprint" | "dataStatus">) => signal.dataStatus === "SIMULATED" || signal.fingerprint.startsWith("seed-");

export async function expireWorkspaceSignals(tx: SignalTx, userId: number, now: Date, prefs: NotificationPreferences) {
  const stale = await tx.select().from(signals).where(and(workspaceOpen(userId), lte(signals.publishedAt, new Date(now.getTime() - SIGNAL_MAX_AGE_MS))));
  for (const row of stale) {
    const deadline = signalDeadline(row.publishedAt);
    const note = "The three-hour signal window ended. Tracking stopped; no fill or price outcome is assumed.";
    await tx.update(signals).set({ status: "EXPIRED", closedAt: deadline }).where(eq(signals.id, row.id));
    await tx.insert(signalEvents).values({ signalId: row.id, eventType: "EXPIRED", previousStatus: row.status, newStatus: "EXPIRED", note });
    if (prefs.slTpHits && !isExampleSignal(row)) {
      await tx.insert(alerts).values({ userId, category: "SIGNAL_EXPIRED", severity: "INFO", symbol: row.symbol, title: `${row.symbol} signal expired`, message: note });
    }
  }
  return stale.length;
}

/** Lock the same workspace for publishing, settling and manual edits, including across requests and processes. */
export async function withSignalWorkspace<T>(userId: number, action: (context: { tx: SignalTx; now: Date; prefs: NotificationPreferences; expired: number }) => Promise<T>) {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId)).for("update");
    if (!owner) throw new Error("Signal workspace not found");
    const now = new Date();
    const expired = await expireWorkspaceSignals(tx, userId, now, owner.prefs);
    return action({ tx, now, prefs: owner.prefs, expired });
  });
}

export async function expireDueSignals(userId: number) {
  const [due] = await db.select({ id: signals.id }).from(signals)
    .where(and(workspaceOpen(userId), lte(signals.publishedAt, new Date(Date.now() - SIGNAL_MAX_AGE_MS)))).limit(1);
  if (due) return withSignalWorkspace(userId, async ({ expired }) => expired);
  return 0;
}

export async function readSignalGate(tx: SignalTx, userId: number, now: Date) {
  const [open] = await tx.select({ id: signals.id }).from(signals).where(workspaceOpen(userId)).orderBy(desc(signals.publishedAt)).limit(1);
  const [latest] = await tx.select({ lastPublishedAt: max(signals.publishedAt), lastClosedAt: max(signals.closedAt) })
    .from(signals).where(eq(signals.userId, userId));
  return publishingGate(Boolean(open), latest?.lastPublishedAt ?? null, latest?.lastClosedAt ?? null, now.getTime());
}

export function signalResponse(row: SignalRow) {
  const example = isExampleSignal(row);
  const { legacyPartialTarget: _archived, ...published } = row;
  return { ...published, expiresAt: signalDeadline(row.publishedAt).toISOString(), immutableLocked: true, example };
}

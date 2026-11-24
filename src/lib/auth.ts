import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { eq, gt, and } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, users, type DashboardWidgetConfig, type ChartPreferences, type NotificationPreferences, type BrokerConfig } from "@/db/schema";

export const SESSION_COOKIE = "freyr_session";
export const DEFAULT_OPERATOR_EMAIL = "desk@freyr.terminal";

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidgetConfig[] = [
  { id: "gold_hero", label: "Gold (XAUUSD) Terminal & Chart", visible: true, order: 0, span: "full" },
  { id: "ai_briefing", label: "FREYR AI Market Briefing", visible: true, order: 1, span: "half" },
  { id: "active_signals", label: "Active AI Trading Signals", visible: true, order: 2, span: "half" },
  { id: "order_flow", label: "ModFlow Order Flow Summary", visible: true, order: 3, span: "third" },
  { id: "liquidity_sessions", label: "Liquidity & Active Sessions", visible: true, order: 4, span: "third" },
  { id: "account_stats", label: "Account Balance & Daily Stats", visible: true, order: 5, span: "third" },
  { id: "economic_events", label: "Upcoming High-Impact Events", visible: true, order: 6, span: "half" },
  { id: "alerts_feed", label: "Important Alerts & Signals Feed", visible: true, order: 7, span: "half" },
];

export const DEFAULT_CHART_PREFS: ChartPreferences = {
  showVolume: true,
  showSessions: true,
  showLiquidity: true,
  showFvg: true,
  showOrderBlocks: true,
  showEma: true,
  candleStyle: "candles",
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  browserEnabled: false,
  newSignals: true,
  entryZone: true,
  liquiditySweeps: true,
  bosChoch: true,
  economicEvents: true,
  slTpHits: true,
  volatility: true,
  invalidations: true,
  systemErrors: true,
  promos: false,
};

export const DEFAULT_BROKER_CONFIG: BrokerConfig = {
  provider: "Manual only",
  accountId: "",
  environment: "demo",
  connected: false,
  verified: false,
  authorizedForAuto: false,
  lastCheckedAt: null,
};

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  await db.insert(authSessions).values({ userId, tokenHash, expiresAt });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(raw)));
  }
  store.delete(SESSION_COOKIE);
}

export function sanitizeUser<T extends { passwordHash?: string }>(u: T): Omit<T, "passwordHash"> {
  const copy = { ...u };
  delete copy.passwordHash;
  return copy;
}

/**
 * Returns the authenticated user from the HTTP-only session cookie, or seamlessly resolves
 * the seeded default FREYR operator workspace (after running idempotent seed) so first-time
 * visitors can immediately operate the full institutional platform without a blocking gate.
 */
export async function getActiveUser() {
  try {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    if (raw) {
      const hashed = hashToken(raw);
      const found = await db
        .select({ user: users })
        .from(authSessions)
        .innerJoin(users, eq(authSessions.userId, users.id))
        .where(and(eq(authSessions.tokenHash, hashed), gt(authSessions.expiresAt, new Date())))
        .limit(1);
      if (found[0]?.user) {
        return { user: found[0].user, isAuthenticated: true };
      }
    }
  } catch {
    // Fallback to default operator workspace during edge/static calls
  }

  const { ensureSeeded } = await import("@/db/seed");
  const seeded = await ensureSeeded();
  // Bootstrap is cached, not the mutable profile. Read notification and theme changes on every request.
  const [defaultUser] = await db.select().from(users).where(eq(users.id, seeded.id)).limit(1);
  if (!defaultUser) throw new Error("Desk workspace unavailable");
  return { user: defaultUser, isAuthenticated: false };
}

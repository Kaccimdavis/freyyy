import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { riskConfigs, users, watchlistItems } from "@/db/schema";
import {
  clearSessionCookie,
  createSession,
  DEFAULT_BROKER_CONFIG,
  DEFAULT_CHART_PREFS,
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_OPERATOR_EMAIL,
  DEFAULT_NOTIFICATION_PREFS,
  getActiveUser,
  hashPassword,
  sanitizeUser,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const AuthSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("login"),
    email: z.string().email(),
    password: z.string().min(6),
  }),
  z.object({
    action: z.literal("register"),
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(120),
  }),
  z.object({
    action: z.literal("change_password"),
    currentPassword: z.string().min(6),
    newPassword: z.string().min(8).max(120),
  }),
  z.object({
    action: z.literal("logout"),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const parsed = AuthSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid authentication input" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    if (d.action === "logout") {
      await clearSessionCookie();
      return NextResponse.json({ ok: true });
    }

    if (d.action === "login") {
      const email = d.email.trim().toLowerCase();
      const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (email === DEFAULT_OPERATOR_EMAIL || !found[0] || !(await verifyPassword(d.password, found[0].passwordHash))) {
        return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
      }
      const { token, expiresAt } = await createSession(found[0].id);
      await setSessionCookie(token, expiresAt);
      return NextResponse.json({ user: sanitizeUser(found[0]), isAuthenticated: true });
    }

    if (d.action === "register") {
      const email = d.email.trim().toLowerCase();
      const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing[0]) {
        return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
      }
      const passwordHash = await hashPassword(d.password);
      const [created] = await db
        .insert(users)
        .values({
          email,
          name: d.name.trim(),
          passwordHash,
          role: "trader",
          timezone: "UTC",
          defaultSymbol: "XAUUSD",
          defaultTimeframe: "15m",
          accountBalance: 100000,
          accountEquity: 100000,
          subscriptionTier: "Pro Terminal",
          chartPrefs: DEFAULT_CHART_PREFS,
          dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
          notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
          brokerConfig: DEFAULT_BROKER_CONFIG,
        })
        .returning();

      await db.insert(riskConfigs).values({ userId: created.id });
      await db.insert(watchlistItems).values([
        { userId: created.id, symbol: "XAUUSD", category: "GOLD", sortOrder: 0 },
        { userId: created.id, symbol: "EURUSD", category: "FOREX", sortOrder: 1 },
        { userId: created.id, symbol: "US500", category: "INDICES", sortOrder: 2 },
        { userId: created.id, symbol: "BTCUSD", category: "CRYPTO", sortOrder: 3 },
      ]);

      const { token, expiresAt } = await createSession(created.id);
      await setSessionCookie(token, expiresAt);
      return NextResponse.json({ user: sanitizeUser(created), isAuthenticated: true }, { status: 201 });
    }

    // change_password
    const { user, isAuthenticated } = await getActiveUser();
    if (!isAuthenticated) return NextResponse.json({ error: "Sign in to change your password." }, { status: 401 });
    const ok = await verifyPassword(d.currentPassword, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
    const nextHash = await hashPassword(d.newPassword);
    await db
      .update(users)
      .set({ passwordHash: nextHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return NextResponse.json({ ok: true, message: "Password updated securely." });
  } catch (err) {
    console.error("Auth POST error:", err);
    return NextResponse.json({ error: "Authentication error" }, { status: 500 });
  }
}

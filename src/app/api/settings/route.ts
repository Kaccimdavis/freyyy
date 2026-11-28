import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { riskConfigs, users } from "@/db/schema";
import { getActiveUser, sanitizeUser } from "@/lib/auth";
import { clearMarketCache, getFeedHealth } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user, isAuthenticated } = await getActiveUser();
    const riskRows = await db
      .select()
      .from(riskConfigs)
      .where(eq(riskConfigs.userId, user.id))
      .limit(1);

    return NextResponse.json({
      user: sanitizeUser(user),
      isAuthenticated,
      riskConfig: riskRows[0] ?? null,
      feeds: getFeedHealth(),
    });
  } catch (err) {
    console.error("Settings GET error:", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

const UpdateSettingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  timezone: z.string().min(2).max(60).optional(),
  defaultSymbol: z.string().min(2).max(12).optional(),
  defaultTimeframe: z.enum(["3m", "5m", "15m", "1h", "4h", "1d"]).optional(),
  dashboardWidgets: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        visible: z.boolean(),
        order: z.number().int().min(0),
        span: z.enum(["full", "half", "third"]).optional(),
      })
    )
    .optional(),
  chartPrefs: z
    .object({
      showVolume: z.boolean(),
      showSessions: z.boolean(),
      showLiquidity: z.boolean(),
      showFvg: z.boolean(),
      showOrderBlocks: z.boolean(),
      showEma: z.boolean(),
      candleStyle: z.enum(["candles", "hollow"]),
      footprintConfluences: z.object({
        deltaFlip: z.boolean(),
        deltaSurge: z.boolean(),
        deltaTransition: z.boolean(),
        deltaAbsorption: z.boolean(),
        cumulativeDelta: z.boolean(),
      }).optional(),
    })
    .optional(),
  notificationPrefs: z
    .object({
      browserEnabled: z.boolean(),
      newSignals: z.boolean(),
      entryZone: z.boolean(),
      liquiditySweeps: z.boolean(),
      bosChoch: z.boolean(),
      economicEvents: z.boolean(),
      slTpHits: z.boolean(),
      volatility: z.boolean(),
      invalidations: z.boolean(),
      systemErrors: z.boolean(),
      promos: z.boolean().optional().default(false),
    })
    .optional()
    .transform((v) => (v ? { ...v, promos: v.promos ?? false } : v)),
  appearance: z.enum(["system", "light", "dark"]).optional(),
  brokerConfig: z
    .object({
      provider: z.string().max(80),
      accountId: z.string().max(80),
      environment: z.enum(["demo", "live"]),
      connected: z.boolean(),
      verified: z.boolean(),
      authorizedForAuto: z.boolean(),
      lastCheckedAt: z.string().nullable(),
    })
    .optional(),
  flushCache: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = UpdateSettingsSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid settings payload" },
        { status: 400 }
      );
    }

    const { flushCache, ...fields } = parsed.data;
    let clearedEntries = 0;
    if (flushCache) {
      clearedEntries = clearMarketCache();
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({
        user: sanitizeUser(user),
        clearedEntries,
        feeds: getFeedHealth(),
      });
    }

    const [updated] = await db
      .update(users)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    return NextResponse.json({
      user: sanitizeUser(updated),
      clearedEntries,
      feeds: getFeedHealth(),
    });
  } catch (err) {
    console.error("Settings PATCH error:", err);
    return NextResponse.json({ error: "Unable to save settings" }, { status: 500 });
  }
}

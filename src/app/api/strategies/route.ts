import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalEntries, signals, strategies } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DISALLOWED_PATTERN = /\b(2\.618|2\.6\s*math|2\.6\s*fib|2\.6\s*strat|fib\s*2\.6)/i;

const CreateStrategySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(6).max(600),
  instrument: z.string().min(2).max(12).default("XAUUSD"),
  htfTimeframe: z.enum(["15m", "1h", "4h", "1d"]).default("1h"),
  ltfTimeframe: z.enum(["5m", "15m", "1h"]).default("15m"),
  executionTimeframe: z.enum(["3m", "5m", "15m"]).default("5m"),
  directionBias: z.enum(["BOTH", "BUY_ONLY", "SELL_ONLY"]).default("BOTH"),
  indicators: z.array(z.string().min(1)).min(1).max(10),
  confirmationsRequired: z.number().int().min(2).max(6).default(3),
  minConfidence: z.number().int().min(50).max(92).default(65),
  minRiskReward: z.number().min(1.2).max(8).default(2.0),
  sessionFilters: z.array(z.enum(["Asian", "London", "New York"])).min(1),
  isActive: z.boolean().default(false), // safest default: test strategy before signal publishing
  rules: z.object({
    entryConditions: z.array(z.string().min(2)).min(1),
    exitConditions: z.array(z.string().min(2)).min(1),
    confirmations: z.array(z.string().min(2)).min(1),
    invalidationConditions: z.array(z.string().min(2)).min(1),
    logicType: z
      .enum([
        "liquidity_sweep_bos",
        "ob_cvd_confluence",
        "session_range_reversal",
        "fvg_absorption_pullback",
        "custom_structure",
      ])
      .default("custom_structure"),
    slAtrMultiple: z.number().min(0.5).max(5).default(1.4),
    tpRiskMultiple: z.number().min(1.2).max(6).default(2.2),
    emaFast: z.number().int().min(5).max(34).default(12),
    emaSlow: z.number().int().min(15).max(100).default(30),
    requireOrderFlow: z.boolean().default(true),
    requireLiquiditySweep: z.boolean().default(false),
    requireStructureShift: z.boolean().default(true),
  }),
});

export async function GET() {
  try {
    const { user } = await getActiveUser();
    const [list, journal, sigs] = await Promise.all([
      db
        .select()
        .from(strategies)
        .where(eq(strategies.userId, user.id))
        .orderBy(desc(strategies.isActive), desc(strategies.updatedAt)),
      db.select().from(journalEntries).where(eq(journalEntries.userId, user.id)),
      db.select().from(signals).where(eq(signals.userId, user.id)),
    ]);

    const enriched = list.map((st) => {
      const trades = journal.filter((j) => j.strategyId === st.id || j.strategyName === st.name);
      const wins = trades.filter((t) => t.outcome === "WIN");
      const netPnl = trades.reduce((a, b) => a + b.pnlAmount, 0);
      const stratSignals = sigs.filter((s) => s.strategyId === st.id || s.strategyName === st.name);
      return {
        ...st,
        performance: {
          journalTrades: trades.length,
          winRate: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(1)) : null,
          netPnl: Number(netPnl.toFixed(2)),
          signalCount: stratSignals.length,
        },
      };
    });

    return NextResponse.json({ strategies: enriched });
  } catch (err) {
    console.error("Strategies GET error:", err);
    return NextResponse.json({ error: "Failed to load strategies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const raw = await req.json();
    const parsed = CreateStrategySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid strategy definition" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const blob = `${d.name} ${d.description} ${d.indicators.join(" ")} ${d.rules.entryConditions.join(" ")}`;
    if (DISALLOWED_PATTERN.test(blob)) {
      return NextResponse.json(
        { error: "2.6 / 2.618 mathematical extension logic has been permanently removed from FREYR." },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(strategies)
      .values({
        userId: user.id,
        name: d.name.trim(),
        description: d.description.trim(),
        instrument: d.instrument.toUpperCase(),
        htfTimeframe: d.htfTimeframe,
        ltfTimeframe: d.ltfTimeframe,
        executionTimeframe: d.executionTimeframe,
        directionBias: d.directionBias,
        indicators: d.indicators,
        rules: d.rules,
        confirmationsRequired: d.confirmationsRequired,
        minConfidence: d.minConfidence,
        minRiskReward: d.minRiskReward,
        sessionFilters: d.sessionFilters,
        isActive: d.isActive,
        isTested: false,
      })
      .returning();

    return NextResponse.json({ strategy: created }, { status: 201 });
  } catch (err) {
    console.error("Strategies POST error:", err);
    return NextResponse.json({ error: "Unable to create strategy" }, { status: 500 });
  }
}

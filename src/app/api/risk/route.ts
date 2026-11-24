import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalEntries, riskConfigs, signals, users } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { expireDueSignals } from "@/lib/signal-cooldown";
import { fetchHyperliquidMids } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getActiveUser();
    await expireDueSignals(user.id);
    const [rows, activeSignals, journal, hlMids] = await Promise.all([
      db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1),
      db.select().from(signals).where(eq(signals.userId, user.id)),
      db.select().from(journalEntries).where(eq(journalEntries.userId, user.id)),
      fetchHyperliquidMids(),
    ]);

    let config = rows[0];
    if (!config) {
      const [created] = await db.insert(riskConfigs).values({ userId: user.id }).returning();
      config = created;
    }

    const totalNetPnl = journal.reduce((a, b) => a + b.pnlAmount, 0);
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayJournal = journal.filter((j) => new Date(j.tradedAt).toISOString().slice(0, 10) === todayIso);
    const todayPnl = todayJournal.reduce((a, b) => a + b.pnlAmount, 0);
    const computedEquity = Number((config.accountBalance + totalNetPnl).toFixed(2));
    const peak = Math.max(config.peakEquity, computedEquity, config.accountBalance);
    const currentDrawdownPct = peak > 0 ? Number((((peak - computedEquity) / peak) * 100).toFixed(2)) : 0;
    const dailyLossPct =
      todayPnl < 0 && config.accountBalance > 0
        ? Number(((Math.abs(todayPnl) / config.accountBalance) * 100).toFixed(2))
        : 0;
    const openSignalsCount = activeSignals.filter((s) => s.status === "ACTIVE" || s.status === "TP1_REACHED").length;
    const estimatedOpenExposurePct = Number((openSignalsCount * config.riskPerTradePct).toFixed(2));

    const warnings: { level: "CRITICAL" | "WARNING" | "OK"; title: string; detail: string }[] = [];
    if (dailyLossPct >= config.maxDailyLossPct) {
      warnings.push({
        level: "CRITICAL",
        title: "Daily Loss Ceiling Reached",
        detail: `Current daily loss (${dailyLossPct}%) has hit the ${config.maxDailyLossPct}% limit. Halt new trading entries for today.`,
      });
    } else if (dailyLossPct >= config.maxDailyLossPct * 0.7) {
      warnings.push({
        level: "WARNING",
        title: "Approaching Max Daily Loss",
        detail: `${dailyLossPct}% of your ${config.maxDailyLossPct}% daily loss limit has been consumed. Reduce risk per trade.`,
      });
    }

    if (currentDrawdownPct >= config.maxDrawdownPct) {
      warnings.push({
        level: "CRITICAL",
        title: "Maximum Drawdown Breached",
        detail: `Equity drawdown is ${currentDrawdownPct}% vs max policy ${config.maxDrawdownPct}%. Mandatory capital protection pause advised.`,
      });
    } else if (currentDrawdownPct >= config.maxDrawdownPct * 0.65) {
      warnings.push({
        level: "WARNING",
        title: "Drawdown Buffer Narrowing",
        detail: `Account is ${currentDrawdownPct}% off high-water mark (${config.maxDrawdownPct}% allowed).`,
      });
    }

    if (config.riskPerTradePct > 2.0) {
      warnings.push({
        level: "WARNING",
        title: "Elevated Per-Trade Risk",
        detail: `Configured risk of ${config.riskPerTradePct}% exceeds standard institutional threshold (0.5%–1.5%).`,
      });
    }

    if (estimatedOpenExposurePct > config.maxOpenExposurePct) {
      warnings.push({
        level: "WARNING",
        title: "Total Open Exposure Exceeds Limit",
        detail: `Open risk exposure (${estimatedOpenExposurePct}%) surpasses cap (${config.maxOpenExposurePct}%).`,
      });
    }

    if (todayJournal.length >= config.maxDailyTrades) {
      warnings.push({
        level: "WARNING",
        title: "Daily Trade Limit Reached",
        detail: `${todayJournal.length}/${config.maxDailyTrades} daily executions completed — protect gains and avoid overtrading.`,
      });
    }

    if (warnings.length === 0) {
      warnings.push({
        level: "OK",
        title: "All Capital Protection Guardrails Green",
        detail: `Within institutional thresholds: ${config.riskPerTradePct}%/trade risk, ${currentDrawdownPct}% drawdown, ${estimatedOpenExposurePct}% active exposure.`,
      });
    }

    return NextResponse.json({
      config: {
        ...config,
        accountEquity: computedEquity,
        peakEquity: peak,
        currentDrawdownPct,
        dailyLossPct,
        todayTrades: todayJournal.length,
        openSignalsCount,
        openExposurePct: estimatedOpenExposurePct,
      },
      warnings,
      livePrices: hlMids.mids,
      priceStatus: hlMids.status,
    });
  } catch (err) {
    console.error("Risk GET error:", err);
    return NextResponse.json({ error: "Failed to fetch risk configuration" }, { status: 500 });
  }
}

const UpdateRiskSchema = z.object({
  accountBalance: z.number().min(500).max(100_000_000).optional(),
  riskPerTradePct: z.number().min(0.1).max(5).optional(),
  maxDailyLossPct: z.number().min(0.5).max(15).optional(),
  maxDrawdownPct: z.number().min(1).max(30).optional(),
  maxDailyTrades: z.number().int().min(1).max(20).optional(),
  maxOpenExposurePct: z.number().min(0.25).max(15).optional(),
  minRiskReward: z.number().min(1).max(6).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = UpdateRiskSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid risk settings" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(riskConfigs)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(riskConfigs.userId, user.id))
      .returning();

    if (parsed.data.accountBalance !== undefined) {
      await db
        .update(users)
        .set({ accountBalance: parsed.data.accountBalance, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    return NextResponse.json({ config: updated });
  } catch (err) {
    console.error("Risk PATCH error:", err);
    return NextResponse.json({ error: "Unable to save risk parameters" }, { status: 500 });
  }
}

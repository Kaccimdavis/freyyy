import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { journalEntries, riskConfigs } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function computePerformanceAnalytics(
  entries: (typeof journalEntries.$inferSelect)[],
  initialBalance: number
) {
  const sortedAsc = [...entries].sort(
    (a, b) => new Date(a.tradedAt).getTime() - new Date(b.tradedAt).getTime()
  );

  const totalTrades = sortedAsc.length;
  const wins = sortedAsc.filter((e) => e.outcome === "WIN");
  const losses = sortedAsc.filter((e) => e.outcome === "LOSS");
  const breakeven = sortedAsc.filter((e) => e.outcome === "BREAKEVEN");

  const grossProfit = wins.reduce((a, b) => a + Math.max(0, b.pnlAmount), 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + Math.min(0, b.pnlAmount), 0));
  const netPnl = sortedAsc.reduce((a, b) => a + b.pnlAmount, 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const avgProfit = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9.99 : 0;
  const avgR = totalTrades > 0 ? sortedAsc.reduce((a, b) => a + b.pnlR, 0) / totalTrades : 0;
  const expectancy = totalTrades > 0 ? netPnl / totalTrades : 0;

  // Equity curve & drawdown
  let eq = initialBalance;
  let peak = initialBalance;
  let maxDdPct = 0;
  const equityCurve: { time: number; label: string; equity: number; drawdownPct: number; pnl: number }[] = [
    {
      time: sortedAsc[0] ? new Date(sortedAsc[0].tradedAt).getTime() - 86400000 : Date.now(),
      label: "Start",
      equity: Number(initialBalance.toFixed(2)),
      drawdownPct: 0,
      pnl: 0,
    },
  ];

  for (const e of sortedAsc) {
    eq += e.pnlAmount;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDdPct) maxDdPct = dd;
    const dt = new Date(e.tradedAt);
    equityCurve.push({
      time: dt.getTime(),
      label: dt.toISOString().slice(5, 10),
      equity: Number(eq.toFixed(2)),
      drawdownPct: Number(dd.toFixed(2)),
      pnl: Number(e.pnlAmount.toFixed(2)),
    });
  }

  // Group helper
  const groupStats = (keyFn: (e: typeof journalEntries.$inferSelect) => string) => {
    const map = new Map<string, { name: string; trades: number; wins: number; losses: number; pnl: number; totalR: number }>();
    for (const e of sortedAsc) {
      const k = keyFn(e);
      const cur = map.get(k) ?? { name: k, trades: 0, wins: 0, losses: 0, pnl: 0, totalR: 0 };
      cur.trades++;
      if (e.outcome === "WIN") cur.wins++;
      if (e.outcome === "LOSS") cur.losses++;
      cur.pnl += e.pnlAmount;
      cur.totalR += e.pnlR;
      map.set(k, cur);
    }
    return Array.from(map.values())
      .map((g) => ({
        ...g,
        pnl: Number(g.pnl.toFixed(2)),
        winRate: g.trades > 0 ? Number(((g.wins / g.trades) * 100).toFixed(1)) : 0,
        avgR: g.trades > 0 ? Number((g.totalR / g.trades).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl);
  };

  const bySession = groupStats((e) => e.session);
  const byStrategy = groupStats((e) => e.strategyName);
  const byInstrument = groupStats((e) => e.symbol);
  const byDay = groupStats((e) => new Date(e.tradedAt).toISOString().slice(0, 10)).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const byMonth = groupStats((e) => new Date(e.tradedAt).toISOString().slice(0, 7)).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const byWeek = groupStats((e) => {
    const d = new Date(e.tradedAt);
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getUTCDay() + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Common mistakes (excluding None)
  const mistakeMap = new Map<string, { tag: string; count: number; totalImpact: number }>();
  for (const e of sortedAsc) {
    const tag = (e.mistakeTag || "None").trim();
    if (!tag || tag.toLowerCase() === "none") continue;
    const cur = mistakeMap.get(tag) ?? { tag, count: 0, totalImpact: 0 };
    cur.count++;
    cur.totalImpact += e.pnlAmount;
    mistakeMap.set(tag, cur);
  }
  const mistakes = Array.from(mistakeMap.values())
    .map((m) => ({ ...m, totalImpact: Number(m.totalImpact.toFixed(2)) }))
    .sort((a, b) => b.count - a.count);

  const bestSession = bySession[0]?.name ?? "—";
  const bestStrategy = byStrategy[0]?.name ?? "—";
  const topMistake = mistakes[0]?.tag ?? "None Logged";

  // Trading consistency index (0-100) reflecting positive PF, disciplined risk sizing variance, clean mistake ratio
  const cleanTrades = sortedAsc.filter((e) => !e.mistakeTag || e.mistakeTag === "None").length;
  const disciplineRatio = totalTrades > 0 ? cleanTrades / totalTrades : 0;
  const avgRisk = totalTrades > 0 ? sortedAsc.reduce((a, b) => a + b.riskPercent, 0) / totalTrades : 0;
  const riskStd =
    totalTrades > 1
      ? Math.sqrt(sortedAsc.reduce((a, b) => a + (b.riskPercent - avgRisk) ** 2, 0) / totalTrades)
      : 0;
  const consistencyScore =
    totalTrades === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              disciplineRatio * 45 +
                Math.min(30, profitFactor * 12) +
                Math.max(0, 25 - riskStd * 20)
            )
          )
        );

  // Actionable, evidence-backed insights derived strictly from recorded trades
  const insights: { title: string; tone: "positive" | "warning" | "neutral"; detail: string }[] = [];
  if (totalTrades === 0) {
    insights.push({
      title: "Log your first trade to unlock analytical insights",
      tone: "neutral",
      detail: "FREYR calculates edges strictly from your logged journal executions without inventing baseline figures.",
    });
  } else {
    if (bySession[0] && bySession[0].pnl > 0) {
      insights.push({
        title: `${bySession[0].name} session carries your strongest edge`,
        tone: "positive",
        detail: `${bySession[0].name} generated $${bySession[0].pnl.toLocaleString()} across ${bySession[0].trades} trades (${bySession[0].winRate}% win rate, ${bySession[0].avgR}R avg). Concentrate gold volume here.`,
      });
    }
    const worstSession = bySession[bySession.length - 1];
    if (worstSession && worstSession.pnl < 0 && bySession.length > 1) {
      insights.push({
        title: `Negative expectancy in ${worstSession.name} session`,
        tone: "warning",
        detail: `${worstSession.name} returned $${worstSession.pnl.toLocaleString()} (${worstSession.winRate}% win rate). Consider toggling your strategy filter off during ${worstSession.name}.`,
      });
    }
    if (mistakes[0]) {
      insights.push({
        title: `Primary execution leak: ${mistakes[0].tag}`,
        tone: "warning",
        detail: `Appeared ${mistakes[0].count} time(s) with $${mistakes[0].totalImpact.toLocaleString()} impact. Eliminating this habit alone would swing net P&L by $${Math.abs(mistakes[0].totalImpact).toLocaleString()}.`,
      });
    }
    if (byStrategy[0]) {
      insights.push({
        title: `Leading playbook: ${byStrategy[0].name}`,
        tone: byStrategy[0].pnl >= 0 ? "positive" : "neutral",
        detail: `${byStrategy[0].trades} trade(s), ${byStrategy[0].winRate}% win rate, net ${byStrategy[0].pnl >= 0 ? "+" : ""}$${byStrategy[0].pnl.toLocaleString()}.`,
      });
    }
    insights.push({
      title: `Risk uniformity: ${avgRisk.toFixed(2)}% avg size (±${riskStd.toFixed(2)}%)`,
      tone: riskStd <= 0.25 ? "positive" : "warning",
      detail: `Expectancy averages ${expectancy >= 0 ? "+" : ""}$${expectancy.toFixed(0)}/trade (${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R) with max equity drawdown of ${maxDdPct.toFixed(2)}%.`,
    });
  }

  return {
    summary: {
      totalTrades,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      winRate: Number(winRate.toFixed(1)),
      avgProfit: Number(avgProfit.toFixed(2)),
      avgLoss: Number(avgLoss.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      netPnl: Number(netPnl.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      avgR: Number(avgR.toFixed(2)),
      expectancy: Number(expectancy.toFixed(2)),
      maxDrawdownPct: Number(maxDdPct.toFixed(2)),
      avgRiskPct: Number(avgRisk.toFixed(2)),
      currentEquity: Number(eq.toFixed(2)),
      initialBalance,
      bestSession,
      bestStrategy,
      topMistake,
      consistencyScore,
      disciplinePct: Number((disciplineRatio * 100).toFixed(1)),
    },
    equityCurve,
    bySession,
    byStrategy,
    byInstrument,
    byDay,
    byWeek,
    byMonth,
    mistakes,
    insights,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user, isAuthenticated } = await getActiveUser();
    if (request.nextUrl.searchParams.get("view") === "performance") {
      const { id, symbol, direction, session, strategyName, entryPrice, exitPrice, pnlAmount, pnlR, outcome, mistakeTag, tradedAt } = journalEntries;
      const entries = await db.select({ id, symbol, direction, session, strategyName, entryPrice, exitPrice, pnlAmount, pnlR, outcome, mistakeTag, tradedAt })
        .from(journalEntries).where(eq(journalEntries.userId, user.id)).orderBy(desc(tradedAt), desc(id));
      return NextResponse.json({ entries, desk: !isAuthenticated }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [entries, riskRows] = await Promise.all([
      db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.userId, user.id))
        .orderBy(desc(journalEntries.tradedAt)),
      db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1),
    ]);

    const balance = riskRows[0]?.accountBalance ?? user.accountBalance ?? 100000;
    const analytics = computePerformanceAnalytics(entries, balance);

    return NextResponse.json({ entries, analytics });
  } catch (err) {
    console.error("Journal GET error:", err);
    return NextResponse.json({ error: "Failed to load journal data" }, { status: 500 });
  }
}

const EntrySchema = z.object({
  symbol: z.string().min(2).max(12).default("XAUUSD"),
  direction: z.enum(["BUY", "SELL"]),
  session: z.enum(["Asian", "London", "New York"]).default("London"),
  strategyId: z.number().int().positive().optional(),
  strategyName: z.string().min(2).max(120),
  entryPrice: z.number().positive(),
  exitPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  takeProfit: z.number().positive(),
  lotSize: z.number().positive().max(200).default(0.5),
  riskPercent: z.number().min(0.05).max(10).default(0.75),
  pnlAmount: z.number(),
  outcome: z.enum(["WIN", "LOSS", "BREAKEVEN"]).optional(),
  screenshotUrl: z.string().max(500_000).optional().nullable(),
  notes: z.string().max(2000).default(""),
  mistakeTag: z.string().max(80).default("None"),
  lessonLearned: z.string().max(1000).default(""),
  tradedAt: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = EntrySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid journal entry" },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const riskDist = Math.abs(d.entryPrice - d.stopLoss);
    const move = d.direction === "BUY" ? d.exitPrice - d.entryPrice : d.entryPrice - d.exitPrice;
    const pnlR = riskDist > 0 ? Number((move / riskDist).toFixed(2)) : 0;
    const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
      d.outcome ?? (d.pnlAmount > 1 ? "WIN" : d.pnlAmount < -1 ? "LOSS" : "BREAKEVEN");

    const tradedAt = d.tradedAt && Number.isFinite(Date.parse(d.tradedAt)) ? new Date(d.tradedAt) : new Date();

    const [created] = await db
      .insert(journalEntries)
      .values({
        userId: user.id,
        strategyId: d.strategyId ?? null,
        symbol: d.symbol.toUpperCase(),
        direction: d.direction,
        session: d.session,
        strategyName: d.strategyName,
        entryPrice: d.entryPrice,
        exitPrice: d.exitPrice,
        stopLoss: d.stopLoss,
        takeProfit: d.takeProfit,
        lotSize: d.lotSize,
        riskPercent: d.riskPercent,
        pnlAmount: Number(d.pnlAmount.toFixed(2)),
        pnlR,
        outcome,
        screenshotUrl: d.screenshotUrl || null,
        notes: d.notes,
        mistakeTag: d.mistakeTag || "None",
        lessonLearned: d.lessonLearned,
        tradedAt,
      })
      .returning();

    return NextResponse.json({ entry: created }, { status: 201 });
  } catch (err) {
    console.error("Journal POST error:", err);
    return NextResponse.json({ error: "Failed to save journal entry" }, { status: 500 });
  }
}

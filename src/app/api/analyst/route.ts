import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiAnalyses, riskConfigs } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { runMultiEngineAnalysis } from "@/lib/engines/ai-analyst";
import { getInstrument, INSTRUMENTS } from "@/lib/market-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { user, isAuthenticated } = await getActiveUser();
    const params = req.nextUrl.searchParams;
    const symbol = (params.get("symbol") ?? "XAUUSD").toUpperCase();
    const threshold = Number(params.get("threshold") ?? "62");
    const includeCurrent = (params.get("current") ?? params.get("live")) !== "0";
    const requestedLimit = Number(params.get("historyLimit") ?? "30");
    const historyLimit = Number.isSafeInteger(requestedLimit) ? Math.min(60, Math.max(5, requestedLimit)) : 30;
    const historySymbol = (params.get("historySymbol") ?? "ALL").toUpperCase();
    const scope = and(eq(aiAnalyses.userId, user.id), isAuthenticated ? undefined : isNull(aiAnalyses.chartScreenshot));
    const where = and(scope, historySymbol !== "ALL" ? eq(aiAnalyses.symbol, historySymbol) : undefined);
    const [history, [total], current] = await Promise.all([
      db.select({ id: aiAnalyses.id, symbol: aiAnalyses.symbol, timeframes: aiAnalyses.timeframes, direction: aiAnalyses.direction, setupState: aiAnalyses.setupState,
        confidenceScore: aiAnalyses.confidenceScore, createdAt: aiAnalyses.createdAt }).from(aiAnalyses).where(where).orderBy(desc(aiAnalyses.createdAt), desc(aiAnalyses.id)).limit(historyLimit),
      db.select({ value: count() }).from(aiAnalyses).where(scope),
      includeCurrent ? db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1).then(([risk]) => runMultiEngineAnalysis({ symbol, confidenceThreshold: Number.isFinite(threshold) ? threshold : 62, minRiskReward: risk?.minRiskReward })) : null,
    ]);
    return NextResponse.json({ instrument: getInstrument(symbol), current, live: current, history, historyTotal: total.value }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Analysis archive failed:", err);
    return NextResponse.json({ error: "Unable to load analyses." }, { status: 500 });
  }
}

const Analyze = z.object({ symbol: z.string().trim().toUpperCase().default("XAUUSD"), confidenceThreshold: z.number().min(45).max(90).default(62) });

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const input = Analyze.safeParse(await req.json().catch(() => null));
    if (!input.success || !INSTRUMENTS.some((item) => item.symbol === input.data.symbol)) return NextResponse.json({ error: "Choose a supported market and confidence threshold." }, { status: 400 });
    const [risk] = await db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1);
    const result = await runMultiEngineAnalysis({ ...input.data, minRiskReward: risk?.minRiskReward, includeChart: true });
    if (result.dataStatus === "UNAVAILABLE" || !result.chartSnapshot) return NextResponse.json({ error: "The market feed did not return enough verified data. Nothing was saved." }, { status: 503 });
    const [saved] = await db.insert(aiAnalyses).values({
      userId: user.id, symbol: result.symbol, timeframes: result.timeframes, currentPrice: result.currentPrice, direction: result.direction,
      setupState: result.setupState, setupExplanation: result.setupExplanation, engineBreakdown: result.engineBreakdown,
      supportingEvidence: result.supportingEvidence, keyLevels: result.keyLevels, liquidityTargets: result.liquidityTargets, entryConditions: result.entryConditions,
      entryPrice: result.entryPrice, stopLoss: result.stopLoss, takeProfit: result.takeProfit, riskReward: result.riskReward,
      confidenceScore: result.confidenceScore, confidenceThreshold: result.confidenceThreshold, invalidationConditions: result.invalidationConditions,
      scenarios: result.scenarios, chartSnapshot: result.chartSnapshot, dataSource: result.dataSource, dataStatus: result.dataStatus,
    }).returning({ id: aiAnalyses.id });
    return NextResponse.json({ analysis: result, saved }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Analysis could not be saved:", err);
    return NextResponse.json({ error: "Unable to run the analysis." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alerts, riskConfigs, signalEvents, signals, strategies } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { runMultiEngineAnalysis } from "@/lib/engines/ai-analyst";
import { INSTRUMENTS } from "@/lib/market-data";
import { isExampleSignal, readSignalGate, signalResponse, withSignalWorkspace } from "@/lib/signal-cooldown";
import { isOpenSignal, isTargetHit, SIGNAL_COOLDOWN_MS, validSignalLevels } from "@/lib/signal-policy";
import { fetchSignalQuotes } from "@/lib/signal-quotes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await getActiveUser();
    const { rows, events, gate } = await withSignalWorkspace(user.id, async ({ tx, now }) => {
      const gate = await readSignalGate(tx, user.id, now);
      const rows = await tx.select().from(signals).where(eq(signals.userId, user.id)).orderBy(desc(signals.publishedAt), desc(signals.id));
      const events = rows.length ? await tx.select().from(signalEvents).where(inArray(signalEvents.signalId, rows.map((row) => row.id)))
        .orderBy(desc(signalEvents.createdAt), desc(signalEvents.id)) : [];
      return { rows, events, gate };
    });
    const active = rows.filter((row) => isOpenSignal(row.status));
    const quotes = await fetchSignalQuotes([...new Set(active.map((row) => row.symbol))]);
    const eventMap = new Map<number, typeof events>();
    for (const event of events) {
      const list = eventMap.get(event.signalId) ?? [];
      list.push(event);
      eventMap.set(event.signalId, list);
    }
    const list = rows.filter((row) => !isExampleSignal(row));
    const wins = list.filter((row) => isTargetHit(row.status)).length;
    const losses = list.filter((row) => row.status === "SL_HIT").length;
    return NextResponse.json({
      signals: rows.map((row) => {
        const quote = !isExampleSignal(row) && isOpenSignal(row.status) ? quotes.get(row.symbol) : undefined;
        return { ...signalResponse(row), currentPrice: quote?.price ?? null, quoteObservedAt: quote ? new Date(quote.observedAt).toISOString() : null, events: eventMap.get(row.id) ?? [] };
      }),
      currentPrices: Object.fromEntries([...quotes].map(([symbol, quote]) => [symbol, quote.price])),
      cooldown: { ...gate, cooldownMs: SIGNAL_COOLDOWN_MS },
      stats: {
        total: list.length,
        activeCount: active.filter((row) => !isExampleSignal(row)).length,
        wins,
        losses,
        winRate: wins + losses > 0 ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null,
      },
    });
  } catch (err) {
    console.error("Signals read failed:", err);
    return NextResponse.json({ error: "Unable to load signals" }, { status: 500 });
  }
}

const SymbolSchema = z.string().trim().toUpperCase().refine((symbol) => INSTRUMENTS.some((item) => item.symbol === symbol), "Unsupported market");
const FrameSchema = z.enum(["3m", "5m", "15m", "1h", "4h", "1d"]);
const RequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("manual"), symbol: SymbolSchema.default("XAUUSD"), direction: z.enum(["BUY", "SELL"]),
    entryPrice: z.number().positive(), stopLoss: z.number().positive(), takeProfit: z.number().positive(),
    confidence: z.number().int().min(30).max(95), timeframe: FrameSchema.default("15m"), strategyName: z.string().trim().min(2).max(120),
    marketConditions: z.string().trim().min(4).max(500), confirmations: z.array(z.string().trim().min(2).max(200)).min(2).max(10),
    invalidationRule: z.string().trim().min(4).max(300), initialStatus: z.enum(["PENDING", "ACTIVE"]).default("PENDING"), strategyId: z.number().int().positive().optional(),
  }).strict(),
  z.object({ mode: z.literal("ai"), symbol: SymbolSchema.default("XAUUSD"), timeframe: FrameSchema.default("15m"), confidenceThreshold: z.number().min(50).max(90).default(62), strategyId: z.number().int().positive().optional() }),
]);

function gateResponse(gate: { hasOpen: boolean; remainingMs: number; nextAvailableAt: string | null }) {
  if (gate.remainingMs > 0) {
    const retryAfterSec = Math.ceil(gate.remainingMs / 1000);
    return NextResponse.json({ error: "Publishing is paused during the cooldown.", ...gate, retryAfterSec }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
  }
  if (gate.hasOpen) return NextResponse.json({ error: "Finish the open signal before publishing another.", ...gate }, { status: 409 });
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid signal" }, { status: 400 });
    const input = parsed.data;
    const earlyGate = await withSignalWorkspace(user.id, ({ tx, now }) => readSignalGate(tx, user.id, now));
    const blocked = gateResponse(earlyGate);
    if (blocked) return blocked;

    const instrument = INSTRUMENTS.find((item) => item.symbol === input.symbol)!;
    const strategy = input.strategyId ? (await db.select().from(strategies).where(and(eq(strategies.id, input.strategyId), eq(strategies.userId, user.id))).limit(1))[0] : undefined;
    if (input.strategyId && !strategy) return NextResponse.json({ error: "Strategy not found in this workspace" }, { status: 404 });

    let candidate: Omit<typeof signals.$inferInsert, "userId" | "fingerprint">;
    let observedPrice: number | null = null;
    if (input.mode === "ai") {
      const [risk] = await db.select().from(riskConfigs).where(eq(riskConfigs.userId, user.id)).limit(1);
      const analysis = await runMultiEngineAnalysis({ symbol: instrument.symbol, confidenceThreshold: input.confidenceThreshold, minRiskReward: risk?.minRiskReward ?? 1.8 });
      if (analysis.dataStatus !== "LIVE" && analysis.dataStatus !== "DELAYED") return NextResponse.json({ error: "Verified market data is unavailable. No signal was published." }, { status: 503 });
      if (analysis.setupState !== "VALID" || analysis.direction === "NEUTRAL" || analysis.confirmationsCount < 2) {
        return NextResponse.json({ error: "No setup currently meets the publication rules." }, { status: 422 });
      }
      candidate = {
        symbol: instrument.symbol, direction: analysis.direction === "BULLISH" ? "BUY" : "SELL", timeframe: "15m",
        entryPrice: analysis.entryPrice, stopLoss: analysis.stopLoss, takeProfit: analysis.takeProfit,
        riskReward: analysis.riskReward, confidence: analysis.confidenceScore, strategyId: strategy?.id,
        strategyName: strategy?.name ?? "FREYR confluence", marketConditions: analysis.setupExplanation, confirmations: analysis.supportingEvidence,
        invalidationRule: analysis.invalidationConditions[0] ?? "A move beyond the original stop invalidates the setup.",
        dataSource: analysis.dataSource, dataStatus: analysis.dataStatus, status: "PENDING",
      };
      observedPrice = analysis.currentPrice > 0 ? analysis.currentPrice : null;
    } else {
      if (/\b2\.6(18)?\b/i.test(`${input.strategyName} ${input.marketConditions}`)) {
        return NextResponse.json({ error: "That strategy is not supported." }, { status: 400 });
      }
      const { entryPrice, stopLoss, takeProfit } = input;
      candidate = {
        symbol: instrument.symbol, direction: input.direction, timeframe: input.timeframe, entryPrice, stopLoss, takeProfit,
        riskReward: Number((Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss)).toFixed(2)),
        confidence: input.confidence, strategyId: strategy?.id, strategyName: strategy?.name ?? input.strategyName,
        marketConditions: input.marketConditions, confirmations: input.confirmations, invalidationRule: input.invalidationRule,
        dataSource: "User-published", dataStatus: "MANUAL", status: input.initialStatus,
      };
    }
    if (!validSignalLevels(candidate.direction === "BUY" ? "BUY" : "SELL", candidate.entryPrice, candidate.stopLoss, candidate.takeProfit) || !Number.isFinite(candidate.riskReward)) {
      return NextResponse.json({ error: "Stop loss and take profit must be on opposite sides of the entry." }, { status: input.mode === "ai" ? 422 : 400 });
    }

    // Run the final check under the lock, after slower market analysis has finished.
    return await withSignalWorkspace(user.id, async ({ tx, now, prefs }) => {
      const gate = await readSignalGate(tx, user.id, now);
      const busy = gateResponse(gate);
      if (busy) return busy;
      const [created] = await tx.insert(signals).values({ ...candidate, userId: user.id, publishedAt: now,
        fingerprint: `${candidate.symbol}:${candidate.direction}:${candidate.timeframe}:${Math.round(candidate.entryPrice)}`,
      }).returning();
      const [event] = await tx.insert(signalEvents).values({ signalId: created.id, eventType: "PUBLISHED", newStatus: created.status, observedPrice,
        note: "Original levels locked. This signal is eligible for tracking for up to three hours.",
      }).returning();
      if (prefs.newSignals) await tx.insert(alerts).values({ userId: user.id, category: "SIGNAL", severity: "INFO", symbol: created.symbol,
        title: `New ${created.symbol} ${created.direction.toLowerCase()} signal`, message: "Published levels and expiry are available in Signals.",
      });
      return NextResponse.json({ signal: { ...signalResponse(created), currentPrice: observedPrice, events: [event] } }, { status: 201 });
    });
  } catch (err) {
    console.error("Signal publication failed:", err);
    return NextResponse.json({ error: "Unable to publish the signal" }, { status: 500 });
  }
}

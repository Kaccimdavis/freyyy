import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { newsPredictions } from "@/db/schema";
import { fetchCandles, fetchEconomicCalendar } from "./market-data";
import { hasActualPrint, predictionFor, REACTION_BAR_MS, REACTION_WINDOW_MS, scoreNewsReaction } from "./news-rules";

const LOOKBACK_MS = 15 * 86_400_000; // below the provider's 5,000-bar limit
const RETRY_MS = 5 * 60_000;

export async function publishScheduledPredictions() {
  const feed = await fetchEconomicCalendar();
  const now = new Date();
  if (feed.status === "LIVE") {
    const rows = feed.events.flatMap((event): Array<typeof newsPredictions.$inferInsert> => {
      if (event.timestamp <= now.getTime() || hasActualPrint(event)) return [];
      const direction = predictionFor(event);
      if (!direction) return [];
      // The upstream index can change on refresh. Use the release's identity instead.
      const eventKey = `${event.currency}:${event.dateIso.slice(0, 10)}:${event.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
      return [{ eventKey, title: event.title, currency: event.currency, impact: event.impact, direction,
        forecast: event.forecast, previous: event.previous, releaseAt: new Date(event.timestamp), publishedAt: now,
      }];
    });
    if (rows.length > 0) await db.insert(newsPredictions).values(rows).onConflictDoNothing();
  }
  return feed;
}

export async function getUpcomingPredictions() {
  const feed = await publishScheduledPredictions();
  const rows = await db.select().from(newsPredictions)
    .where(and(gt(newsPredictions.releaseAt, new Date()), lt(newsPredictions.publishedAt, newsPredictions.releaseAt)))
    .orderBy(asc(newsPredictions.releaseAt)).limit(100);
  return { predictions: rows.map(({ eventKey, title, releaseAt, direction }) => ({ eventKey, title, releaseAt, direction })), source: feed.source, status: feed.status, error: feed.error };
}

export async function settleNewsPredictions(now = Date.now()) {
  const matureAt = new Date(now - REACTION_WINDOW_MS);
  // An old prediction without retrievable intraday candles is never counted as correct or opposite.
  await db.update(newsPredictions).set({ outcome: "UNAVAILABLE", assessedAt: new Date(now) })
    .where(and(eq(newsPredictions.outcome, "PENDING"), lt(newsPredictions.releaseAt, new Date(now - LOOKBACK_MS))));
  const due = await db.select().from(newsPredictions).where(and(
    inArray(newsPredictions.outcome, ["PENDING", "UNAVAILABLE"]), gt(newsPredictions.releaseAt, new Date(now - LOOKBACK_MS)),
    lte(newsPredictions.releaseAt, matureAt), lt(newsPredictions.publishedAt, newsPredictions.releaseAt),
    or(isNull(newsPredictions.assessedAt), lt(newsPredictions.assessedAt, new Date(now - RETRY_MS))),
  )).orderBy(asc(newsPredictions.releaseAt)).limit(120);
  if (!due.length) return;
  const chartStart = Math.floor(due[0].releaseAt.getTime() / REACTION_BAR_MS) * REACTION_BAR_MS - REACTION_BAR_MS;
  const chartEnd = Math.floor((due[due.length - 1].releaseAt.getTime() + REACTION_WINDOW_MS) / REACTION_BAR_MS) * REACTION_BAR_MS;
  const series = await fetchCandles("XAUUSD", "5m", chartStart, chartEnd);
  const candlesByTime = new Map(series.candles.map((candle) => [candle.time, candle]));
  await db.transaction(async (tx) => {
    for (const row of due) {
      const result = scoreNewsReaction(candlesByTime, row.releaseAt.getTime(), row.direction, now);
      await tx.update(newsPredictions).set({ outcome: result?.outcome ?? "UNAVAILABLE", movePct: result?.movePct ?? null, assessedAt: new Date(now) })
        .where(and(eq(newsPredictions.eventKey, row.eventKey), inArray(newsPredictions.outcome, ["PENDING", "UNAVAILABLE"])));
    }
  });
}

export async function getPredictionHistory() {
  await settleNewsPredictions();
  return db.select().from(newsPredictions)
    .where(and(lte(newsPredictions.releaseAt, new Date()), lt(newsPredictions.publishedAt, newsPredictions.releaseAt)))
    .orderBy(desc(newsPredictions.releaseAt), asc(newsPredictions.title)).limit(150);
}

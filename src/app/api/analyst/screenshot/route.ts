import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { db } from "@/db";
import { aiAnalyses, type ChartAnalysisSnapshot } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { chartVisionConfigured, readChartLabels } from "@/lib/chart-vision";
import { runModFlowAnalysis } from "@/lib/engines/modflow";
import { analyzeLiquidityAndStructure } from "@/lib/engines/liquidity";
import { fetchCandles, fetchOrderBook, INSTRUMENTS, type OrderBookSnapshot } from "@/lib/market-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

const FRAME = { "3m": 180_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const MAX_BYTES = 3_300_000;
const Payload = z.object({ symbol: z.string().trim().toUpperCase().max(12).default("XAUUSD"), timeframe: z.enum(["3m", "5m", "15m", "1h", "4h", "1d"]).default("15m"),
  capturedAt: z.iso.datetime({ offset: true }).optional(), imageDataUrl: z.string().max(4_400_035), readLabels: z.boolean().default(false),
});
const visionRequests = new Map<number, number>();

export async function GET() {
  const { isAuthenticated } = await getActiveUser();
  return NextResponse.json({ canSave: isAuthenticated, visionAvailable: isAuthenticated && chartVisionConfigured() });
}

export async function POST(req: NextRequest) {
  try {
    if (Number(req.headers.get("content-length")) > 4_405_000) return NextResponse.json({ error: "Image must be under 3.3 MB." }, { status: 413 });
    const { user, isAuthenticated } = await getActiveUser();
    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose a market and attach a PNG, JPEG or WebP under 3.3 MB." }, { status: 400 });
    const input = parsed.data;
    const market = INSTRUMENTS.find((item) => item.symbol === input.symbol);
    if (!market) return NextResponse.json({ error: "This market isn’t supported." }, { status: 400 });
    if (market.provider === "yahoo" && input.timeframe === "3m") return NextResponse.json({ error: "The reference feed doesn’t provide 3-minute candles. Choose 5 minutes or longer." }, { status: 422 });
    const raster = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageDataUrl);
    if (!raster) return NextResponse.json({ error: "Attach a PNG, JPEG or WebP chart image." }, { status: 400 });
    const pixels = Buffer.from(raster[2], "base64");
    if (pixels.length > MAX_BYTES) return NextResponse.json({ error: "Image must be under 3.3 MB." }, { status: 413 });
    let clean: string;
    try {
      const isPng = pixels.length >= 8 && pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = pixels[0] === 255 && pixels[1] === 216 && pixels[2] === 255;
      const isWebp = pixels.toString("ascii", 0, 4) === "RIFF" && pixels.toString("ascii", 8, 12) === "WEBP";
      if (!(raster[1] === "png" ? isPng : raster[1] === "jpeg" ? isJpeg : isWebp)) throw new Error("Not a supported raster");
      const image = sharp(pixels, { limitInputPixels: 16_000_000, failOn: "error" });
      const metadata = await image.metadata();
      if (metadata.width < 80 || metadata.height < 60 || (metadata.pages ?? 1) > 1) throw new Error("Invalid chart dimensions");
      const sanitized = await image.autoOrient().resize({ width: 1920, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      clean = `data:image/webp;base64,${sanitized.toString("base64")}`;
    } catch {
      return NextResponse.json({ error: "The image couldn’t be opened. Upload a readable chart screenshot." }, { status: 400 });
    }

    let capturedAt = input.capturedAt;
    let labelReading: ChartAnalysisSnapshot["labelReading"] = "USER_SELECTED";
    if (input.readLabels) {
      if (!isAuthenticated) return NextResponse.json({ error: "Sign in to use chart label reading." }, { status: 401 });
      if (!chartVisionConfigured()) return NextResponse.json({ error: "Chart label reading is not configured. Use the chart details above." }, { status: 503 });
      const stamp = Date.now();
      for (const [id, previous] of visionRequests) if (stamp - previous > 30_000) visionRequests.delete(id);
      if (visionRequests.has(user.id)) return NextResponse.json({ error: "Please wait before reading another chart image." }, { status: 429 });
      visionRequests.set(user.id, stamp);
      try {
        const labels = await readChartLabels(clean);
        const displayed = labels.symbol?.toUpperCase().split(":").pop()?.replace(/[^A-Z0-9]/g, "");
        const known = displayed ? INSTRUMENTS.find((item) => item.symbol === displayed || item.providerSymbol.toUpperCase() === displayed) : undefined;
        if (known && known.symbol !== market.symbol) return NextResponse.json({ error: `The image appears to show ${known.symbol}. Confirm the market before reviewing.` }, { status: 422 });
        if (labels.timeframe && labels.timeframe !== input.timeframe) return NextResponse.json({ error: `The image appears to show ${labels.timeframe} candles. Confirm the timeframe before reviewing.` }, { status: 422 });
        capturedAt ??= labels.capturedAt ?? undefined;
        if (known || labels.timeframe || labels.capturedAt) labelReading = "IMAGE_ASSISTED";
      } catch {
        return NextResponse.json({ error: "Chart labels couldn’t be read. Turn off label reading and enter the chart details manually." }, { status: 503 });
      }
    }
    const now = Date.now();
    const end = capturedAt ? Date.parse(capturedAt) : now;
    if (!Number.isFinite(end) || end > now || end < now - 5 * 365 * 86_400_000) return NextResponse.json({ error: "Choose a chart time in the past." }, { status: 400 });
    const frame = FRAME[input.timeframe];
    const start = Math.floor(end / frame) * frame - 122 * frame;
    const [series, book] = await Promise.all([
      fetchCandles(market.symbol, input.timeframe, start, end),
      !capturedAt && market.supportsOrderBook ? fetchOrderBook(market.symbol) : Promise.resolve(null),
    ]);
    const bars = series.candles.filter((candle) => candle.time >= start && candle.time + frame <= end).slice(-100);
    const last = bars.at(-1);
    if (!last || bars.length < 15 || end - (last.time + frame) > (market.provider === "hyperliquid" ? 2 * frame : Math.max(2 * frame, 72 * 3600_000))) {
      return NextResponse.json({ error: "Not enough verified candles near that chart time. Try a more recent date or a longer timeframe." }, { status: 422 });
    }
    const emptyBook: OrderBookSnapshot = { symbol: market.symbol, providerSymbol: market.providerSymbol, source: "Not available for this chart window", status: "UNAVAILABLE", timestamp: end,
      fetchedAt: series.fetchedAt, bestBid: 0, bestAsk: 0, midPrice: 0, spread: 0, spreadBps: 0, bids: [], asks: [], totalBidVolume: 0, totalAskVolume: 0,
    };
    const depth = book?.status === "LIVE" && Math.abs(now - book.timestamp) < 60_000 ? book : emptyBook;
    const flow = runModFlowAnalysis({ symbol: market.symbol, timeframe: input.timeframe, candles: bars, candleStatus: series.status, candleSource: series.source, orderBook: depth });
    const structure = analyzeLiquidityAndStructure({ symbol: market.symbol, timeframe: input.timeframe, candles: bars });
    const hasVolume = bars.some((bar) => Number.isFinite(bar.volume) && bar.volume > 0);
    const snapshot: ChartAnalysisSnapshot = { timeframe: input.timeframe, source: series.source, asOf: new Date(end).toISOString(), candles: bars,
      bias: hasVolume || depth.status === "LIVE" ? flow.summary.bias : "UNAVAILABLE", structure: structure.trend,
      estimatedDelta: hasVolume ? flow.summary.sessionDelta : null, poc: hasVolume ? flow.volumeProfile.poc : null, vah: hasVolume ? flow.volumeProfile.vah : null, val: hasVolume ? flow.volumeProfile.val : null,
      bidDepthPct: depth.status === "LIVE" ? flow.summary.bidPressurePct : null, askDepthPct: depth.status === "LIVE" ? flow.summary.askPressurePct : null, labelReading,
    };
    const explanation = `ModFlow and market structure evaluated ${bars.length} completed ${input.timeframe} candles from ${series.source}. Delta and volume profile are estimates from candle data; prices and volume were not read from the image. ${capturedAt ? "Historical order-book depth is not available." : "Depth is shown only when a current snapshot is available."}`;
    let saved = null;
    if (isAuthenticated) {
      [saved] = await db.insert(aiAnalyses).values({ userId: user.id, symbol: market.symbol, timeframes: [input.timeframe], currentPrice: last.close,
        direction: snapshot.bias === "UNAVAILABLE" ? "NEUTRAL" : snapshot.bias, setupState: "REVIEW", setupExplanation: explanation,
        engineBreakdown: [], supportingEvidence: [structure.structureBias], keyLevels: [], liquidityTargets: [], entryConditions: "This is an order-flow review, not a signal.",
        entryPrice: 0, stopLoss: 0, takeProfit: 0, riskReward: 0, confidenceScore: 0, confidenceThreshold: 0,
        invalidationConditions: [], scenarios: [], dataSource: snapshot.source, dataStatus: capturedAt ? "HISTORICAL" : series.status, chartScreenshot: clean, chartSnapshot: snapshot,
      }).returning({ id: aiAnalyses.id });
    }
    return NextResponse.json({ snapshot, market: market.symbol, explanation, saved }, { status: saved ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Chart review failed:", err);
    return NextResponse.json({ error: "Couldn’t review the chart right now." }, { status: 500 });
  }
}

import { fetchCandles, fetchHyperliquidMids, INSTRUMENTS } from "./market-data";

export interface SignalQuote { price: number; observedAt: number; reference: boolean }

export async function fetchSignalQuotes(symbols: string[]) {
  const selected = INSTRUMENTS.filter((instrument) => symbols.includes(instrument.symbol));
  const quotes = new Map<string, SignalQuote>();
  const hyper = selected.filter((instrument) => instrument.provider === "hyperliquid");
  await Promise.all([
    ...(hyper.length ? [fetchHyperliquidMids().then((snapshot) => {
      const observedAt = Date.parse(snapshot.fetchedAt);
      if (snapshot.status !== "LIVE" || !Number.isFinite(observedAt) || Date.now() - observedAt > 45_000) return;
      for (const instrument of hyper) {
        const price = snapshot.mids[instrument.symbol];
        if (Number.isFinite(price) && price > 0) quotes.set(instrument.symbol, { price, observedAt, reference: false });
      }
    })] : []),
    ...selected.filter((instrument) => instrument.provider === "yahoo").map(async (instrument) => {
      const series = await fetchCandles(instrument.symbol, "5m");
      if (series.status !== "DELAYED") return;
      const now = Date.now();
      const bar = series.candles.findLast((candle) => candle.time + 300_000 <= now);
      if (!bar || now - (bar.time + 300_000) > 30 * 60_000 || !Number.isFinite(bar.close) || bar.close <= 0) return;
      quotes.set(instrument.symbol, { price: bar.close, observedAt: bar.time + 300_000, reference: true });
    }),
  ]);
  return quotes;
}

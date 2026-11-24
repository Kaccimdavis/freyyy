export interface PerformanceEntry {
  id: number;
  symbol: string;
  direction: string;
  session: string;
  strategyName: string;
  entryPrice: number;
  exitPrice: number;
  pnlAmount: number;
  pnlR: number;
  outcome: string;
  mistakeTag: string;
  tradedAt: string;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dayMs = 86_400_000;

/** Calendar dates for history are evaluated in the workspace display timezone. */
export function calendarDay(value: string | number | Date, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    let formatter = dateFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone === "LOCAL" ? undefined : timezone, year: "numeric", month: "2-digit", day: "2-digit" });
      if (dateFormatters.size < 32) dateFormatters.set(timezone, formatter);
    }
    const parts = new Map(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function mondayOf(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function weekLabel(monday: string) {
  const start = Date.parse(`${monday}T00:00:00Z`);
  if (!Number.isFinite(start)) return "";
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const end = start + 6 * dayMs;
  return `${date.format(start)} – ${date.format(end)}, ${new Date(end).getUTCFullYear()}`;
}

export function summarizePerformance(entries: PerformanceEntry[]) {
  const wins = entries.filter((trade) => trade.outcome === "WIN").length;
  const losses = entries.filter((trade) => trade.outcome === "LOSS").length;
  const net = entries.reduce((total, trade) => total + trade.pnlAmount, 0);
  return { wins, losses, net, trades: entries.length, winRate: wins + losses > 0 ? Math.round(100 * wins / (wins + losses)) : null };
}

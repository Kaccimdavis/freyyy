import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";
import { fetchHyperliquidMids, type Timeframe } from "@/lib/market-data";
import type { AppearanceMode } from "@/db/schema";
import { FreyrShell } from "@/components/FreyrShell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let timezone = "UTC";
  let defaultSymbol = "XAUUSD";
  let defaultTimeframe: Timeframe = "15m";
  let hollowCandles = false;
  let userName = "Freyr Principal Desk";
  let unreadAlerts = 0;
  let goldPrice: number | null = null;
  let goldStatus = "";
  let appearance: AppearanceMode = "dark";
  let useDeviceAppearance = true;

  try {
    const [{ user, isAuthenticated }, midsRes] = await Promise.all([getActiveUser(), fetchHyperliquidMids()]);
    timezone = user.timezone || "UTC";
    defaultSymbol = user.defaultSymbol || "XAUUSD";
    defaultTimeframe = (user.defaultTimeframe as Timeframe) || "15m";
    hollowCandles = user.chartPrefs?.candleStyle === "hollow";
    userName = user.name || "Freyr Principal Desk";
    goldPrice = midsRes.mids.XAUUSD ?? null;
    goldStatus = midsRes.status;
    useDeviceAppearance = !isAuthenticated;
    if (isAuthenticated && (user.appearance === "light" || user.appearance === "system")) appearance = user.appearance;

    const unreadRows = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.userId, user.id), eq(alerts.isRead, false)));
    unreadAlerts = unreadRows.length;
  } catch (err) {
    console.error("Initial page bootstrap warning:", err);
  }

  return (
    <FreyrShell
      initialTimezone={timezone}
      initialSymbol={defaultSymbol}
      initialTimeframe={defaultTimeframe}
      initialHollowCandles={hollowCandles}
      initialUserName={userName}
      initialUnreadAlerts={unreadAlerts}
      initialGoldPrice={goldPrice}
      initialGoldStatus={goldStatus}
      initialAppearance={appearance}
      useDeviceAppearance={useDeviceAppearance}
    />
  );
}

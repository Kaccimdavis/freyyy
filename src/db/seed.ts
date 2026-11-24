import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "./index";
import {
  users,
  watchlistItems,
  strategies,
  riskConfigs,
  signals,
  signalEvents,
  journalEntries,
  alerts,
  automationRules,
  automationLogs,
  systemState,
} from "./schema";
import {
  DEFAULT_BROKER_CONFIG,
  DEFAULT_CHART_PREFS,
  DEFAULT_DASHBOARD_WIDGETS,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_OPERATOR_EMAIL,
  hashPassword,
} from "@/lib/auth";
import { fetchHyperliquidMids } from "@/lib/market-data";

const g = globalThis as typeof globalThis & { __freyrSeedPromise?: Promise<typeof users.$inferSelect> };

async function runSeed(): Promise<typeof users.$inferSelect> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, DEFAULT_OPERATOR_EMAIL))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));

  const [operator] = await db
    .insert(users)
    .values({
      email: DEFAULT_OPERATOR_EMAIL,
      name: "FREYR Principal Desk",
      passwordHash,
      role: "institutional",
      timezone: "UTC",
      defaultSymbol: "XAUUSD",
      defaultTimeframe: "15m",
      accountBalance: 100000,
      accountEquity: 104320,
      subscriptionTier: "Institutional Desk",
      chartPrefs: DEFAULT_CHART_PREFS,
      dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
      brokerConfig: DEFAULT_BROKER_CONFIG,
    })
    .onConflictDoNothing()
    .returning();

  const user =
    operator ??
    (await db.select().from(users).where(eq(users.email, DEFAULT_OPERATOR_EMAIL)).limit(1))[0];

  // Check if already seeded (parallel guard)
  const hasStrat = await db
    .select({ id: strategies.id })
    .from(strategies)
    .where(eq(strategies.userId, user.id))
    .limit(1);
  if (hasStrat.length > 0) return user;

  // 1. Default watchlist (Gold primary first)
  await db
    .insert(watchlistItems)
    .values([
      { userId: user.id, symbol: "XAUUSD", category: "GOLD", sortOrder: 0 },
      { userId: user.id, symbol: "XAUFUT", category: "GOLD", sortOrder: 1 },
      { userId: user.id, symbol: "EURUSD", category: "FOREX", sortOrder: 2 },
      { userId: user.id, symbol: "GBPUSD", category: "FOREX", sortOrder: 3 },
      { userId: user.id, symbol: "USDJPY", category: "FOREX", sortOrder: 4 },
      { userId: user.id, symbol: "DXY", category: "FOREX", sortOrder: 5 },
      { userId: user.id, symbol: "US500", category: "INDICES", sortOrder: 6 },
      { userId: user.id, symbol: "NAS100", category: "INDICES", sortOrder: 7 },
      { userId: user.id, symbol: "BTCUSD", category: "CRYPTO", sortOrder: 8 },
      { userId: user.id, symbol: "ETHUSD", category: "CRYPTO", sortOrder: 9 },
    ])
    .onConflictDoNothing();

  // 2. Institutional Price-Action & Order-Flow Strategies (explicitly NO 2.6 / 2.618 Fibonacci math strategy)
  const insertedStrategies = await db
    .insert(strategies)
    .values([
      {
        userId: user.id,
        name: "London Sweep & BOS Continuation",
        description:
          "Targets institutional stop runs against Asian session highs/lows during London expansion, entering on validated M5 Break of Structure with ModFlow delta confirmation.",
        instrument: "XAUUSD",
        htfTimeframe: "1h",
        ltfTimeframe: "15m",
        executionTimeframe: "5m",
        directionBias: "BOTH",
        indicators: ["Market Structure (BOS/CHoCH)", "Session Liquidity Sweep", "ModFlow Volume Delta", "ATR Stop Buffer"],
        rules: {
          entryConditions: [
            "London or NY open sweeps opposing Asian session high/low without body acceptance",
            "M15 confirms rejection wick and shifts structure with decisive close (CHoCH/BOS)",
            "M5 enters on retracement into originating order block or fair value gap",
          ],
          exitConditions: [
            "Use the opposing session liquidity zone as the single take profit",
            "Validate the target against the previous session high or low",
          ],
          confirmations: [
            "H1 bias aligned or post-sweep reversal clear",
            "ModFlow volume delta matches expansion leg",
            "No blocking high-impact USD news inside 30 minutes",
          ],
          invalidationConditions: [
            "M15 candle close beyond swept extreme",
            "Opposing cumulative volume delta flip across Point of Control",
          ],
          logicType: "liquidity_sweep_bos",
          slAtrMultiple: 1.4,
          tpRiskMultiple: 2.4,
          emaFast: 12,
          emaSlow: 30,
          requireOrderFlow: true,
          requireLiquiditySweep: true,
          requireStructureShift: true,
        },
        confirmationsRequired: 3,
        minConfidence: 68,
        minRiskReward: 2.2,
        sessionFilters: ["London", "New York"],
        isActive: true,
        isTested: true,
        lastBacktestWinRate: null,
        lastBacktestProfitFactor: null,
      },
      {
        userId: user.id,
        name: "NY Order Block + CVD Confluence",
        description:
          "Trades high-probability H1/M15 institutional order blocks during New York session overlap when ModFlow cumulative volume delta and resting L2 book confirm aggressive participation.",
        instrument: "XAUUSD",
        htfTimeframe: "1h",
        ltfTimeframe: "15m",
        executionTimeframe: "5m",
        directionBias: "BOTH",
        indicators: ["Order Blocks", "ModFlow CVD", "L2 Book Imbalance", "Volume Profile POC/VAL/VAH"],
        rules: {
          entryConditions: [
            "H1 directional trend cleanly separated along EMA20/EMA50",
            "Unmitigated M15 order block positioned near Volume Profile VAL (long) or VAH (short)",
            "L2 order book shows >= 54% aligned side pressure with CVD slope confirming",
          ],
          exitConditions: [
            "Set one take profit at the opposing value area",
            "Exit early if confirmed opposing absorption prints on M15",
          ],
          confirmations: [
            "Unmitigated Order Block with clean displacement impulse",
            "ModFlow CVD confirms entry leg (no adverse divergence)",
            "Positive minimum 2.0R path unobstructed by major HTF level",
          ],
          invalidationConditions: [
            "Order block converts into opposing Breaker Block via full close through body",
            "High-impact FOMC/CPI spike breaks stop perimeter",
          ],
          logicType: "ob_cvd_confluence",
          slAtrMultiple: 1.5,
          tpRiskMultiple: 2.5,
          emaFast: 14,
          emaSlow: 34,
          requireOrderFlow: true,
          requireLiquiditySweep: false,
          requireStructureShift: true,
        },
        confirmationsRequired: 3,
        minConfidence: 70,
        minRiskReward: 2.0,
        sessionFilters: ["New York", "London"],
        isActive: true,
        isTested: true,
        lastBacktestWinRate: null,
        lastBacktestProfitFactor: null,
      },
      {
        userId: user.id,
        name: "M15 FVG + ModFlow Absorption Pullback",
        description:
          "Captures institutional displacement continuation by entering resting Fair Value Gaps only when passive limit-order absorption slows counter-trend volume.",
        instrument: "XAUUSD",
        htfTimeframe: "1h",
        ltfTimeframe: "15m",
        executionTimeframe: "3m",
        directionBias: "BOTH",
        indicators: ["Fair Value Gaps", "ModFlow Absorption", "Point of Control", "Break of Structure"],
        rules: {
          entryConditions: [
            "Strong 3-candle displacement prints clean Fair Value Gap after BOS",
            "Price retraces to FVG equilibrium (50%) without violating prior protected low/high",
            "ModFlow logs passive absorption wick rejecting further travel inside the imbalance",
          ],
          exitConditions: [
            "Target liquidity pool above/below originating displacement extreme",
          ],
          confirmations: [
            "Multi-timeframe H1 + M15 alignment",
            "Absorption ratio >= 1.5x rolling bar average volume",
            "Clean M3 micro-CHoCH confirming entry",
          ],
          invalidationConditions: [
            "Full candle body closure cleanly past distal boundary of Fair Value Gap",
          ],
          logicType: "fvg_absorption_pullback",
          slAtrMultiple: 1.3,
          tpRiskMultiple: 2.2,
          emaFast: 10,
          emaSlow: 26,
          requireOrderFlow: true,
          requireLiquiditySweep: false,
          requireStructureShift: true,
        },
        confirmationsRequired: 3,
        minConfidence: 65,
        minRiskReward: 2.0,
        sessionFilters: ["London", "New York"],
        isActive: true,
        isTested: false,
        lastBacktestWinRate: null,
        lastBacktestProfitFactor: null,
      },
      {
        userId: user.id,
        name: "Session Range Liquidity Reversal",
        description:
          "Mean-reversion framework monitoring failed breakouts past Asian and previous-day range limits into exhaustion delta spikes before rotating toward session Point of Control.",
        instrument: "XAUUSD",
        htfTimeframe: "4h",
        ltfTimeframe: "15m",
        executionTimeframe: "5m",
        directionBias: "BOTH",
        indicators: ["Asian Range H/L", "Equal Highs/Lows", "ModFlow Exhaustion", "Volume Profile POC"],
        rules: {
          entryConditions: [
            "Failed raid outside session high or low paired with ModFlow climax exhaustion tail",
            "Candle reclaims range interior with opposing M5 Change of Character",
          ],
          exitConditions: [
            "Choose one session liquidity target before publication",
            "Prefer the opposite side of the session range",
          ],
          confirmations: [
            "Rejection tail exceeds 40% of trigger bar range",
            "Exhaustion climax spike confirms trapped breakout volume",
            "CVD stops expanding in breakout direction",
          ],
          invalidationConditions: [
            "Follow-through close sets acceptance above/below raided extreme",
          ],
          logicType: "session_range_reversal",
          slAtrMultiple: 1.35,
          tpRiskMultiple: 2.1,
          emaFast: 12,
          emaSlow: 28,
          requireOrderFlow: true,
          requireLiquiditySweep: true,
          requireStructureShift: true,
        },
        confirmationsRequired: 3,
        minConfidence: 66,
        minRiskReward: 2.0,
        sessionFilters: ["Asian", "London"],
        isActive: false,
        isTested: false,
        lastBacktestWinRate: null,
        lastBacktestProfitFactor: null,
      },
    ])
    .returning();

  // 3. Risk Management Configuration (conservative capital-preservation defaults)
  await db
    .insert(riskConfigs)
    .values({
      userId: user.id,
      accountBalance: 100000,
      accountEquity: 104320,
      riskPerTradePct: 0.75,
      maxDailyLossPct: 2.0,
      maxDrawdownPct: 6.0,
      maxDailyTrades: 4,
      maxOpenExposurePct: 2.25,
      minRiskReward: 2.0,
      dailyLossCurrent: 0,
      peakEquity: 104890,
      openExposurePct: 0.75,
      dailyTradesCount: 1,
    })
    .onConflictDoNothing();

  // 4. Anchor initial immutable baseline signal to live Hyperliquid gold price (never fake out-of-range numbers)
  let goldRef = 3624;
  try {
    const { mids } = await fetchHyperliquidMids();
    if (mids.XAUUSD && mids.XAUUSD > 500) goldRef = mids.XAUUSD;
  } catch {
    // fallback anchored directly to observed reference
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const s1 = insertedStrategies[0];
  const s2 = insertedStrategies[1];
  const s3 = insertedStrategies[2];

  const [sig1, sig2, sig3] = await db
    .insert(signals)
    .values([
      {
        userId: user.id,
        strategyId: s1.id,
        symbol: "XAUUSD",
        direction: "BUY",
        entryPrice: r2(goldRef - 6.5),
        stopLoss: r2(goldRef - 18.5),
        takeProfit: r2(goldRef + 27.5),
        riskReward: 2.83,
        confidence: 76,
        timeframe: "15m",
        strategyName: s1.name,
        marketConditions: "Post-SSL sweep reaction holding above local demand with constructive delta alignment.",
        confirmations: [
          "M15 Sell-Side Liquidity sweep reclaimed inside demand zone",
          "H1 directional structure holding intact",
          "ModFlow tape absorption recorded on probe low",
          "Risk-to-reward 2.83:1 passes strict 2.0 minimum floor",
        ],
        invalidationRule: `M15 close below ${r2(goldRef - 18.5).toFixed(2)} voids bullish thesis.`,
        status: "ACTIVE",
        dataSource: "Hyperliquid (PAXG)",
        dataStatus: "LIVE",
        fingerprint: `seed-xau-buy-${Math.round(goldRef)}`,
        publishedAt: new Date(Date.now() - 4 * 3600 * 1000),
      },
      {
        userId: user.id,
        strategyId: s2.id,
        symbol: "XAUUSD",
        direction: "SELL",
        entryPrice: r2(goldRef + 24.0),
        stopLoss: r2(goldRef + 36.0),
        takeProfit: r2(goldRef - 10.0),
        riskReward: 2.83,
        confidence: 71,
        timeframe: "15m",
        strategyName: s2.name,
        marketConditions: "Bearish M15 supply & Value Area High overhang watching resting buy-side stops.",
        confirmations: [
          "Untested M15 bearish order block beneath prior day supply",
          "Awaiting upper BSL sweep + ModFlow negative delta switch",
          "Asymmetric 2.83:1 downside path into POC/VAL",
        ],
        invalidationRule: `Sustained H1 acceptance above ${r2(goldRef + 36.0).toFixed(2)} cancels pending short.`,
        status: "PENDING",
        dataSource: "Hyperliquid (PAXG)",
        dataStatus: "LIVE",
        fingerprint: `seed-xau-sell-pending-${Math.round(goldRef)}`,
        publishedAt: new Date(Date.now() - 95 * 60 * 1000),
      },
      {
        userId: user.id,
        strategyId: s3.id,
        symbol: "XAUUSD",
        direction: "BUY",
        entryPrice: r2(goldRef - 38.2),
        stopLoss: r2(goldRef - 51.0),
        takeProfit: r2(goldRef - 4.0),
        riskReward: 2.67,
        confidence: 79,
        timeframe: "15m",
        strategyName: s3.name,
        marketConditions: "London FVG equilibrium mitigation with positive institutional absorption.",
        confirmations: [
          "Bullish M15 FVG aligned with H1 BOS continuation",
          "ModFlow bid pressure 61% during passive absorption candle",
          "Clear USD calendar window throughout execution",
        ],
        invalidationRule: `Close beneath ${r2(goldRef - 51.0).toFixed(2)} exits setup immediately.`,
        status: "TP_HIT",
        dataSource: "Hyperliquid (PAXG)",
        dataStatus: "LIVE",
        fingerprint: `seed-xau-closed-tp2`,
        publishedAt: new Date(Date.now() - 30 * 3600 * 1000),
        closedAt: new Date(Date.now() - 18 * 3600 * 1000),
      },
    ])
    .returning();

  await db.insert(signalEvents).values([
    {
      signalId: sig1.id,
      eventType: "PUBLISHED",
      previousStatus: null,
      newStatus: "PENDING",
      observedPrice: r2(goldRef - 4.0),
      note: "Original levels published and immutably locked across FREYR audit log.",
      createdAt: new Date(Date.now() - 4 * 3600 * 1000),
    },
    {
      signalId: sig1.id,
      eventType: "TRIGGERED",
      previousStatus: "PENDING",
      newStatus: "ACTIVE",
      observedPrice: r2(goldRef - 6.5),
      note: "Entry zone mitigated during active overlap session with positive delta response.",
      createdAt: new Date(Date.now() - (2 * 3600 + 36 * 60) * 1000),
    },
    {
      signalId: sig2.id,
      eventType: "PUBLISHED",
      previousStatus: null,
      newStatus: "PENDING",
      observedPrice: r2(goldRef),
      note: "Awaiting approach into overhead order block; original levels locked.",
      createdAt: new Date(Date.now() - 95 * 60 * 1000),
    },
    {
      signalId: sig3.id,
      eventType: "PUBLISHED",
      previousStatus: null,
      newStatus: "ACTIVE",
      observedPrice: r2(goldRef - 38.2),
      note: "Published and triggered on London FVG pullback.",
      createdAt: new Date(Date.now() - 30 * 3600 * 1000),
    },
    {
      signalId: sig3.id,
      eventType: "TARGET_HIT",
      previousStatus: "ACTIVE",
      newStatus: "TP_HIT",
      observedPrice: r2(goldRef - 3.8),
      note: "Full institutional buy-side target completed (+2.67R).",
      createdAt: new Date(Date.now() - 18 * 3600 * 1000),
    },
  ]);

  // 5. Realistic operator trading journal entries (all using non-2.6 institutional strategies)
  const day = 24 * 3600 * 1000;
  await db.insert(journalEntries).values([
    {
      userId: user.id,
      strategyId: s1.id,
      symbol: "XAUUSD",
      direction: "BUY",
      session: "London",
      strategyName: s1.name,
      entryPrice: r2(goldRef - 52.0),
      exitPrice: r2(goldRef - 27.6),
      stopLoss: r2(goldRef - 62.5),
      takeProfit: r2(goldRef - 27.2),
      lotSize: 0.7,
      riskPercent: 0.75,
      pnlAmount: 1708,
      pnlR: 2.28,
      outcome: "WIN",
      notes: "Clean Asian low stop hunt at 07:45 UTC, positive delta surge confirmed entry on M5 retest.",
      mistakeTag: "None",
      lessonLearned: "Waiting for London close back inside range dramatically reduced drawdown on entry.",
      tradedAt: new Date(Date.now() - 12 * day),
    },
    {
      userId: user.id,
      strategyId: s2.id,
      symbol: "XAUUSD",
      direction: "SELL",
      session: "New York",
      strategyName: s2.name,
      entryPrice: r2(goldRef + 14.5),
      exitPrice: r2(goldRef - 8.2),
      stopLoss: r2(goldRef + 25.0),
      takeProfit: r2(goldRef - 9.0),
      lotSize: 0.65,
      riskPercent: 0.7,
      pnlAmount: 1475.5,
      pnlR: 2.11,
      outcome: "WIN",
      notes: "Entered NY open bearish order block after negative CVD divergence at VAH.",
      mistakeTag: "None",
      lessonLearned: "Pair order block reactions with ask-side absorption before executing.",
      tradedAt: new Date(Date.now() - 10 * day),
    },
    {
      userId: user.id,
      strategyId: s3.id,
      symbol: "XAUUSD",
      direction: "BUY",
      session: "New York",
      strategyName: s3.name,
      entryPrice: r2(goldRef - 18.0),
      exitPrice: r2(goldRef - 28.5),
      stopLoss: r2(goldRef - 28.5),
      takeProfit: r2(goldRef + 5.0),
      lotSize: 0.7,
      riskPercent: 0.75,
      pnlAmount: -735,
      pnlR: -1.0,
      outcome: "LOSS",
      notes: "Took pullback ahead of US macro release while volume delta was still flat.",
      mistakeTag: "Early Entry",
      lessonLearned: "Never anticipate order flow turn prior to scheduled USD economic release.",
      tradedAt: new Date(Date.now() - 8 * day),
    },
    {
      userId: user.id,
      strategyId: s1.id,
      symbol: "XAUUSD",
      direction: "BUY",
      session: "London",
      strategyName: s1.name,
      entryPrice: r2(goldRef - 44.0),
      exitPrice: r2(goldRef - 20.5),
      stopLoss: r2(goldRef - 54.0),
      takeProfit: r2(goldRef - 20.0),
      lotSize: 0.75,
      riskPercent: 0.75,
      pnlAmount: 1762.5,
      pnlR: 2.35,
      outcome: "WIN",
      notes: "Swept prior day low, instant lower wick absorption, textbook H1/M15 continuation.",
      mistakeTag: "None",
      lessonLearned: "Best setups occur on initial London expansion directly off PDL/Asian low.",
      tradedAt: new Date(Date.now() - 6 * day),
    },
    {
      userId: user.id,
      strategyId: s2.id,
      symbol: "BTCUSD",
      direction: "SELL",
      session: "Asian",
      strategyName: s2.name,
      entryPrice: 61820,
      exitPrice: 62410,
      stopLoss: 62410,
      takeProfit: 60450,
      lotSize: 1.0,
      riskPercent: 0.6,
      pnlAmount: -590,
      pnlR: -1.0,
      outcome: "LOSS",
      notes: "Over-traded low-liquidity Asian drift outside primary XAUUSD window.",
      mistakeTag: "Off-Session Trade",
      lessonLearned: "Restrict execution strictly to configured London and NY liquidity windows.",
      tradedAt: new Date(Date.now() - 4 * day),
    },
    {
      userId: user.id,
      strategyId: s3.id,
      symbol: "XAUUSD",
      direction: "BUY",
      session: "London",
      strategyName: s3.name,
      entryPrice: r2(goldRef - 38.2),
      exitPrice: r2(goldRef - 18.8),
      stopLoss: r2(goldRef - 48.0),
      takeProfit: r2(goldRef - 17.5),
      lotSize: 0.75,
      riskPercent: 0.75,
      pnlAmount: 1455,
      pnlR: 1.98,
      outcome: "WIN",
      notes: "Mitigated M15 bullish FVG cleanly at equilibrium with passive bid loading in L2.",
      mistakeTag: "None",
      lessonLearned: "Keep the original target and stop documented while the setup develops.",
      tradedAt: new Date(Date.now() - 2 * day),
    },
    {
      userId: user.id,
      strategyId: s1.id,
      symbol: "XAUUSD",
      direction: "SELL",
      session: "New York",
      strategyName: s1.name,
      entryPrice: r2(goldRef + 19.4),
      exitPrice: r2(goldRef + 28.0),
      stopLoss: r2(goldRef + 28.0),
      takeProfit: r2(goldRef - 1.2),
      lotSize: 0.85,
      riskPercent: 0.75,
      pnlAmount: -756,
      pnlR: -1.0,
      outcome: "LOSS",
      notes: "Shorted before M5 confirmed bearish BOS after liquidity sweep.",
      mistakeTag: "Early Entry",
      lessonLearned: "Wait for full candle body close confirming structural shift before clicking execute.",
      tradedAt: new Date(Date.now() - 1 * day),
    },
  ]);

  // 6. Alerts / Notification Centre baseline
  await db.insert(alerts).values([
    {
      userId: user.id,
      category: "SIGNAL",
      severity: "INFO",
      symbol: "XAUUSD",
      title: "Active Gold Signal Locked — London Sweep & BOS",
      message: `BUY signal active at ${r2(goldRef - 6.5).toFixed(2)} (SL ${r2(goldRef - 18.5).toFixed(2)}, TP ${r2(goldRef + 27.5).toFixed(2)}). Original levels remain immutably audited.`,
      isRead: false,
      createdAt: new Date(Date.now() - 2.5 * 3600 * 1000),
    },
    {
      userId: user.id,
      category: "ENTRY_ZONE",
      severity: "WARNING",
      symbol: "XAUUSD",
      title: "Pending Setup Approaching Overhead Order Block",
      message: `Watch ${r2(goldRef + 24.0).toFixed(2)} zone for BSL liquidity sweep and negative ModFlow delta print before validating NY short setup.`,
      isRead: false,
      createdAt: new Date(Date.now() - 80 * 60 * 1000),
    },
    {
      userId: user.id,
      category: "SYSTEM",
      severity: "INFO",
      symbol: "XAUUSD",
      title: "Automated Trade Execution Disabled (Safety Default)",
      message: "FREYR automation remains locked until an authorized broker adapter is configured and explicitly approved.",
      isRead: true,
      createdAt: new Date(Date.now() - 6 * 3600 * 1000),
    },
  ]);

  // 7. Automation Rules (ALL disabled by default — capital protection first!)
  const insertedRules = await db
    .insert(automationRules)
    .values([
      {
        userId: user.id,
        strategyId: s1.id,
        name: "Gold London Sweep Auto-Monitor",
        symbol: "XAUUSD",
        mode: "SIGNAL_MONITOR",
        isEnabled: false,
        allowedSessions: ["London", "New York"],
        minConfidence: 70,
        maxDailyTriggers: 2,
        stopOnDailyLoss: true,
        pauseBeforeHighImpactMins: 30,
      },
      {
        userId: user.id,
        strategyId: s2.id,
        name: "NY Order Block + CVD Scanner",
        symbol: "XAUUSD",
        mode: "SIGNAL_MONITOR",
        isEnabled: false,
        allowedSessions: ["New York"],
        minConfidence: 72,
        maxDailyTriggers: 2,
        stopOnDailyLoss: true,
        pauseBeforeHighImpactMins: 45,
      },
      {
        userId: user.id,
        strategyId: s3.id,
        name: "M15 FVG Absorption Guard",
        symbol: "XAUUSD",
        mode: "EXECUTION_LOCKED",
        isEnabled: false,
        allowedSessions: ["London", "New York"],
        minConfidence: 75,
        maxDailyTriggers: 2,
        stopOnDailyLoss: true,
        pauseBeforeHighImpactMins: 30,
      },
    ])
    .returning();

  await db.insert(automationLogs).values([
    {
      userId: user.id,
      ruleId: insertedRules[0]?.id ?? null,
      action: "SAFETY_LOCK_INIT",
      status: "BLOCKED",
      symbol: "XAUUSD",
      detail: "Automated order execution is disabled. Requires explicit broker authorization before executing any order.",
      createdAt: new Date(Date.now() - 5 * 3600 * 1000),
    },
  ]);

  await db
    .insert(systemState)
    .values({
      key: `automation_master:${user.id}`,
      value: {
        masterEnabled: false,
        emergencyStopped: false,
        executionAuthorized: false,
        lastToggledAt: new Date().toISOString(),
        reason: "Default safe state — automated execution disabled until secure broker configured.",
      },
    })
    .onConflictDoNothing();

  return user;
}

export async function ensureSeeded(): Promise<typeof users.$inferSelect> {
  if (!g.__freyrSeedPromise) {
    g.__freyrSeedPromise = runSeed().catch((err) => {
      g.__freyrSeedPromise = undefined;
      throw err;
    });
  }
  return g.__freyrSeedPromise;
}

import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

export interface DashboardWidgetConfig {
  id: string;
  label: string;
  visible: boolean;
  order: number;
  span?: "full" | "half" | "third";
}

export interface FootprintConfluenceSettings {
  deltaFlip: boolean;
  deltaSurge: boolean;
  deltaTransition: boolean;
  deltaAbsorption: boolean;
  cumulativeDelta: boolean;
}

export const DEFAULT_FOOTPRINT_CONFLUENCES: FootprintConfluenceSettings = {
  deltaFlip: false,
  deltaSurge: false,
  deltaTransition: false,
  deltaAbsorption: false,
  cumulativeDelta: false,
};

export interface ChartPreferences {
  showVolume: boolean;
  showSessions: boolean;
  showLiquidity: boolean;
  showFvg: boolean;
  showOrderBlocks: boolean;
  showEma: boolean;
  candleStyle: "candles" | "hollow";
  footprintConfluences?: FootprintConfluenceSettings;
}

export interface NotificationPreferences {
  browserEnabled: boolean;
  newSignals: boolean;
  entryZone: boolean;
  liquiditySweeps: boolean;
  bosChoch: boolean;
  economicEvents: boolean;
  slTpHits: boolean;
  volatility: boolean;
  invalidations: boolean;
  systemErrors: boolean;
  promos: boolean;
}

export type AppearanceMode = "system" | "light" | "dark";

export interface BrokerConfig {
  provider: string;
  accountId: string;
  environment: "demo" | "live";
  connected: boolean;
  verified: boolean;
  authorizedForAuto: boolean;
  lastCheckedAt: string | null;
}

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("trader"),
  timezone: text("timezone").notNull().default("UTC"),
  defaultSymbol: text("default_symbol").notNull().default("XAUUSD"),
  defaultTimeframe: text("default_timeframe").notNull().default("15m"),
  accountBalance: doublePrecision("account_balance").notNull().default(100000),
  accountEquity: doublePrecision("account_equity").notNull().default(102480),
  subscriptionTier: text("subscription_tier").notNull().default("Institutional"),
  appearance: text("appearance").notNull().default("system"), // system | light | dark
  chartPrefs: jsonb("chart_prefs").$type<ChartPreferences>().notNull(),
  dashboardWidgets: jsonb("dashboard_widgets").$type<DashboardWidgetConfig[]>().notNull(),
  notificationPrefs: jsonb("notification_prefs").$type<NotificationPreferences>().notNull(),
  brokerConfig: jsonb("broker_config").$type<BrokerConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_user_symbol_idx").on(t.userId, t.symbol)]
);

export interface StrategyRuleSet {
  entryConditions: string[];
  exitConditions: string[];
  confirmations: string[];
  invalidationConditions: string[];
  logicType: "liquidity_sweep_bos" | "ob_cvd_confluence" | "session_range_reversal" | "fvg_absorption_pullback" | "custom_structure";
  slAtrMultiple: number;
  tpRiskMultiple: number;
  emaFast: number;
  emaSlow: number;
  requireOrderFlow: boolean;
  requireLiquiditySweep: boolean;
  requireStructureShift: boolean;
}

export const strategies = pgTable("strategies", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  instrument: text("instrument").notNull().default("XAUUSD"),
  htfTimeframe: text("htf_timeframe").notNull().default("1h"),
  ltfTimeframe: text("ltf_timeframe").notNull().default("15m"),
  executionTimeframe: text("execution_timeframe").notNull().default("5m"),
  directionBias: text("direction_bias").notNull().default("BOTH"),
  indicators: jsonb("indicators").$type<string[]>().notNull(),
  rules: jsonb("rules").$type<StrategyRuleSet>().notNull(),
  confirmationsRequired: integer("confirmations_required").notNull().default(3),
  minConfidence: integer("min_confidence").notNull().default(65),
  minRiskReward: doublePrecision("min_risk_reward").notNull().default(2.0),
  sessionFilters: jsonb("session_filters").$type<string[]>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isTested: boolean("is_tested").notNull().default(false),
  lastBacktestWinRate: doublePrecision("last_backtest_win_rate"),
  lastBacktestProfitFactor: doublePrecision("last_backtest_profit_factor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface EngineScoreItem {
  engine: string;
  weight: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  summary: string;
  evidence: string[];
  dataStatus: "LIVE" | "DELAYED" | "CACHED" | "UNAVAILABLE";
}

export interface AnalysisScenario {
  title: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  probability: number;
  trigger: string;
  target: string;
  invalidation: string;
}

export const aiAnalyses = pgTable("ai_analyses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  timeframes: jsonb("timeframes").$type<string[]>().notNull(),
  currentPrice: doublePrecision("current_price").notNull(),
  direction: text("direction").notNull(), // BULLISH | BEARISH | NEUTRAL
  setupState: text("setup_state").notNull(), // VALID | WATCHLIST | INVALID
  setupExplanation: text("setup_explanation").notNull(),
  engineBreakdown: jsonb("engine_breakdown").$type<EngineScoreItem[]>().notNull(),
  supportingEvidence: jsonb("supporting_evidence").$type<string[]>().notNull(),
  keyLevels: jsonb("key_levels").$type<{ label: string; price: number; kind: string }[]>().notNull(),
  liquidityTargets: jsonb("liquidity_targets").$type<{ label: string; price: number; side: string }[]>().notNull(),
  entryConditions: text("entry_conditions").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  stopLoss: doublePrecision("stop_loss").notNull(),
  legacyPartialTarget: doublePrecision("take_profit_1"), // Archived reports only.
  takeProfit: doublePrecision("take_profit_2").notNull(),
  riskReward: doublePrecision("risk_reward").notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  confidenceThreshold: integer("confidence_threshold").notNull().default(62),
  invalidationConditions: jsonb("invalidation_conditions").$type<string[]>().notNull(),
  scenarios: jsonb("scenarios").$type<AnalysisScenario[]>().notNull(),
  chartScreenshot: text("chart_screenshot"),
  chartSnapshot: jsonb("chart_snapshot").$type<ChartAnalysisSnapshot>(),
  dataSource: text("data_source").notNull(),
  dataStatus: text("data_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface ChartAnalysisSnapshot {
  timeframe: import("@/lib/market-data").Timeframe;
  source: string;
  asOf: string;
  candles: import("@/lib/market-data").Candle[];
  bias: string;
  structure: string;
  estimatedDelta: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  bidDepthPct: number | null;
  askDepthPct: number | null;
  labelReading: "USER_SELECTED" | "IMAGE_ASSISTED";
}

export const newsPredictions = pgTable("news_predictions", {
  eventKey: text("event_key").primaryKey(),
  title: text("title").notNull(),
  currency: text("currency").notNull(),
  impact: text("impact").notNull(),
  direction: text("direction").$type<"BUY" | "SELL">().notNull(),
  forecast: text("forecast").notNull(),
  previous: text("previous").notNull(),
  releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  outcome: text("outcome").$type<"PENDING" | "MATCHED" | "OPPOSITE" | "FLAT" | "UNAVAILABLE">().notNull().default("PENDING"),
  movePct: doublePrecision("move_pct"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }),
}, (row) => [index("news_predictions_release_idx").on(row.releaseAt), check("news_prediction_precedes_release", sql`${row.publishedAt} < ${row.releaseAt}`)]);

// Immutable original signal coordinates — updates are persisted strictly in signal_events + status
export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  strategyId: integer("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  analysisId: integer("analysis_id").references(() => aiAnalyses.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // BUY | SELL
  entryPrice: doublePrecision("entry_price").notNull(), // IMMUTABLE
  stopLoss: doublePrecision("stop_loss").notNull(), // IMMUTABLE
  legacyPartialTarget: doublePrecision("take_profit_1"), // Archived checkpoint only; new signals never populate it.
  takeProfit: doublePrecision("take_profit_2").notNull(), // IMMUTABLE; original target column retained.
  riskReward: doublePrecision("risk_reward").notNull(), // IMMUTABLE
  confidence: integer("confidence").notNull(),
  timeframe: text("timeframe").notNull(),
  strategyName: text("strategy_name").notNull(),
  marketConditions: text("market_conditions").notNull(),
  confirmations: jsonb("confirmations").$type<string[]>().notNull(),
  invalidationRule: text("invalidation_rule").notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | ACTIVE | TP1_REACHED | TP2_REACHED | SL_HIT | INVALIDATED | EXPIRED
  dataSource: text("data_source").notNull(),
  dataStatus: text("data_status").notNull().default("LIVE"),
  fingerprint: text("fingerprint").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (row) => [index("signal_workspace_status_idx").on(row.userId, row.status, row.publishedAt)]);

export const signalEvents = pgTable("signal_events", {
  id: serial("id").primaryKey(),
  signalId: integer("signal_id")
    .notNull()
    .references(() => signals.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  observedPrice: doublePrecision("observed_price"),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface BacktestTradeRecord {
  index: number;
  direction: "BUY" | "SELL";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  rMultiple: number;
  outcome: "WIN" | "LOSS";
  session: string;
  reason: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdownPct: number;
}

export const backtestRuns = pgTable("backtest_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  strategyId: integer("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  initialBalance: doublePrecision("initial_balance").notNull().default(100000),
  riskPercent: doublePrecision("risk_percent").notNull().default(1.0),
  slAtrMultiple: doublePrecision("sl_atr_multiple").notNull().default(1.5),
  tpRiskMultiple: doublePrecision("tp_risk_multiple").notNull().default(2.2),
  spreadPoints: doublePrecision("spread_points").notNull().default(0.25),
  commissionPerLot: doublePrecision("commission_per_lot").notNull().default(7.0),
  sessionFilter: text("session_filter").notNull().default("ALL"),
  dataSource: text("data_source").notNull(),
  isSimulated: boolean("is_simulated").notNull().default(true),
  totalTrades: integer("total_trades").notNull(),
  winningTrades: integer("winning_trades").notNull(),
  losingTrades: integer("losing_trades").notNull(),
  winRate: doublePrecision("win_rate").notNull(),
  profitFactor: doublePrecision("profit_factor").notNull(),
  maxDrawdownPct: doublePrecision("max_drawdown_pct").notNull(),
  netProfit: doublePrecision("net_profit").notNull(),
  avgRiskReward: doublePrecision("avg_risk_reward").notNull(),
  expectedValue: doublePrecision("expected_value").notNull(),
  maxConsecutiveWins: integer("max_consecutive_wins").notNull(),
  maxConsecutiveLosses: integer("max_consecutive_losses").notNull(),
  equityCurve: jsonb("equity_curve").$type<EquityPoint[]>().notNull(),
  trades: jsonb("trades").$type<BacktestTradeRecord[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskConfigs = pgTable("risk_configs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  accountBalance: doublePrecision("account_balance").notNull().default(100000),
  accountEquity: doublePrecision("account_equity").notNull().default(102480),
  riskPerTradePct: doublePrecision("risk_per_trade_pct").notNull().default(0.75),
  maxDailyLossPct: doublePrecision("max_daily_loss_pct").notNull().default(2.0),
  maxDrawdownPct: doublePrecision("max_drawdown_pct").notNull().default(6.0),
  maxDailyTrades: integer("max_daily_trades").notNull().default(4),
  maxOpenExposurePct: doublePrecision("max_open_exposure_pct").notNull().default(2.5),
  minRiskReward: doublePrecision("min_risk_reward").notNull().default(2.0),
  dailyLossCurrent: doublePrecision("daily_loss_current").notNull().default(0),
  peakEquity: doublePrecision("peak_equity").notNull().default(103150),
  openExposurePct: doublePrecision("open_exposure_pct").notNull().default(0.75),
  dailyTradesCount: integer("daily_trades_count").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  strategyId: integer("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull().default("XAUUSD"),
  direction: text("direction").notNull(), // BUY | SELL
  session: text("session").notNull().default("London"),
  strategyName: text("strategy_name").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price").notNull(),
  stopLoss: doublePrecision("stop_loss").notNull(),
  takeProfit: doublePrecision("take_profit").notNull(),
  lotSize: doublePrecision("lot_size").notNull().default(0.5),
  riskPercent: doublePrecision("risk_percent").notNull().default(0.75),
  pnlAmount: doublePrecision("pnl_amount").notNull(),
  pnlR: doublePrecision("pnl_r").notNull(),
  outcome: text("outcome").notNull(), // WIN | LOSS | BREAKEVEN
  screenshotUrl: text("screenshot_url"),
  notes: text("notes").notNull().default(""),
  mistakeTag: text("mistake_tag").notNull().default("None"),
  lessonLearned: text("lesson_learned").notNull().default(""),
  tradedAt: timestamp("traded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // SIGNAL | ENTRY_ZONE | LIQUIDITY_SWEEP | STRUCTURE | ECONOMIC | SL_TP | VOLATILITY | INVALIDATION | SYSTEM | FEED
  severity: text("severity").notNull().default("INFO"), // INFO | WARNING | CRITICAL
  symbol: text("symbol").notNull().default("XAUUSD"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationRules = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  strategyId: integer("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().default("XAUUSD"),
  mode: text("mode").notNull().default("SIGNAL_MONITOR"), // SIGNAL_MONITOR | EXECUTION_LOCKED
  isEnabled: boolean("is_enabled").notNull().default(false),
  allowedSessions: jsonb("allowed_sessions").$type<string[]>().notNull(),
  minConfidence: integer("min_confidence").notNull().default(70),
  maxDailyTriggers: integer("max_daily_triggers").notNull().default(3),
  stopOnDailyLoss: boolean("stop_on_daily_loss").notNull().default(true),
  pauseBeforeHighImpactMins: integer("pause_before_high_impact_mins").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationLogs = pgTable("automation_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ruleId: integer("rule_id").references(() => automationRules.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  status: text("status").notNull(), // BLOCKED | MONITORED | HALTED | CONFIG_UPDATED
  symbol: text("symbol").notNull().default("XAUUSD"),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

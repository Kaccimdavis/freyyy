import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { automationLogs, automationRules, strategies, systemState } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface MasterState {
  masterEnabled: boolean;
  emergencyStopped: boolean;
  executionAuthorized: boolean;
  lastToggledAt: string;
  reason: string;
}

async function getMasterState(userId: number): Promise<MasterState> {
  const key = `automation_master:${userId}`;
  const row = await db.select().from(systemState).where(eq(systemState.key, key)).limit(1);
  if (row[0]) {
    const v = row[0].value;
    return {
      masterEnabled: Boolean(v.masterEnabled),
      emergencyStopped: Boolean(v.emergencyStopped),
      executionAuthorized: Boolean(v.executionAuthorized),
      lastToggledAt: String(v.lastToggledAt ?? new Date().toISOString()),
      reason: String(v.reason ?? ""),
    };
  }
  return {
    masterEnabled: false,
    emergencyStopped: false,
    executionAuthorized: false,
    lastToggledAt: new Date().toISOString(),
    reason: "Automated trade execution disabled by default until verified broker integration is authorized.",
  };
}

async function setMasterState(userId: number, state: MasterState) {
  const key = `automation_master:${userId}`;
  await db
    .insert(systemState)
    .values({ key, value: state as unknown as Record<string, unknown>, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: state as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
}

export async function GET() {
  try {
    const { user } = await getActiveUser();
    const [rules, logs, strats, master] = await Promise.all([
      db
        .select()
        .from(automationRules)
        .where(eq(automationRules.userId, user.id))
        .orderBy(desc(automationRules.updatedAt)),
      db
        .select()
        .from(automationLogs)
        .where(eq(automationLogs.userId, user.id))
        .orderBy(desc(automationLogs.createdAt))
        .limit(30),
      db.select().from(strategies).where(eq(strategies.userId, user.id)),
      getMasterState(user.id),
    ]);

    return NextResponse.json({
      master,
      broker: user.brokerConfig,
      rules,
      logs,
      strategies: strats,
    });
  } catch (err) {
    console.error("Automation GET error:", err);
    return NextResponse.json({ error: "Failed to load automation console" }, { status: 500 });
  }
}

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("emergency_stop"),
  }),
  z.object({
    action: z.literal("reset_emergency"),
  }),
  z.object({
    action: z.literal("toggle_monitoring"),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("attempt_live_execution"),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("toggle_rule"),
    ruleId: z.number().int().positive(),
    isEnabled: z.boolean(),
  }),
  z.object({
    action: z.literal("create_rule"),
    name: z.string().min(3).max(100),
    symbol: z.string().min(2).max(12).default("XAUUSD"),
    strategyId: z.number().int().positive().optional(),
    allowedSessions: z.array(z.enum(["Asian", "London", "New York"])).min(1),
    minConfidence: z.number().int().min(55).max(95).default(70),
    maxDailyTriggers: z.number().int().min(1).max(10).default(2),
    stopOnDailyLoss: z.boolean().default(true),
    pauseBeforeHighImpactMins: z.number().int().min(0).max(120).default(30),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const { user } = await getActiveUser();
    const parsed = ActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid automation action" },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const brokerReady = Boolean(
      user.brokerConfig?.connected && user.brokerConfig?.verified && user.brokerConfig?.authorizedForAuto
    );
    const cur = await getMasterState(user.id);

    if (d.action === "emergency_stop") {
      // Disable ALL rules & lock system immediately
      await db
        .update(automationRules)
        .set({ isEnabled: false, updatedAt: new Date() })
        .where(eq(automationRules.userId, user.id));

      const next: MasterState = {
        masterEnabled: false,
        emergencyStopped: true,
        executionAuthorized: false,
        lastToggledAt: new Date().toISOString(),
        reason: "EMERGENCY STOP triggered — all automated monitors & execution paths halted immediately.",
      };
      await setMasterState(user.id, next);
      await db.insert(automationLogs).values({
        userId: user.id,
        action: "EMERGENCY_STOP",
        status: "HALTED",
        symbol: "ALL",
        detail: "Operator engaged emergency kill switch. All active rules suspended and execution forcibly revoked.",
      });
      return NextResponse.json({ master: next });
    }

    if (d.action === "reset_emergency") {
      const next: MasterState = {
        masterEnabled: false,
        emergencyStopped: false,
        executionAuthorized: false,
        lastToggledAt: new Date().toISOString(),
        reason: "Emergency latch cleared. Automation remains safely disabled until explicitly turned on.",
      };
      await setMasterState(user.id, next);
      await db.insert(automationLogs).values({
        userId: user.id,
        action: "EMERGENCY_CLEARED",
        status: "CONFIG_UPDATED",
        symbol: "ALL",
        detail: "Emergency latch cleared. Automated monitoring remains OFF pending operator decision.",
      });
      return NextResponse.json({ master: next });
    }

    if (d.action === "toggle_monitoring") {
      if (cur.emergencyStopped && d.enabled) {
        return NextResponse.json(
          { error: "Clear Emergency Stop before enabling automated signal monitoring." },
          { status: 409 }
        );
      }
      const next: MasterState = {
        ...cur,
        masterEnabled: d.enabled,
        executionAuthorized: false, // signal monitoring NEVER implies auto order execution
        lastToggledAt: new Date().toISOString(),
        reason: d.enabled
          ? "Signal monitoring active (read-only alerts only — zero broker trades placed automatically)."
          : "Automated signal monitoring disabled.",
      };
      await setMasterState(user.id, next);
      await db.insert(automationLogs).values({
        userId: user.id,
        action: d.enabled ? "MONITORING_ENABLED" : "MONITORING_DISABLED",
        status: d.enabled ? "MONITORED" : "CONFIG_UPDATED",
        symbol: "XAUUSD",
        detail: next.reason,
      });
      return NextResponse.json({ master: next });
    }

    if (d.action === "attempt_live_execution") {
      if (d.enabled && !brokerReady) {
        await db.insert(automationLogs).values({
          userId: user.id,
          action: "AUTO_EXECUTION_BLOCKED",
          status: "BLOCKED",
          symbol: "ALL",
          detail:
            "Refused: no verified, explicitly authorized broker is configured.",
        });
        return NextResponse.json(
          {
            error:
              "Automated execution is locked. Verify and explicitly authorize a tested broker under Settings first.",
          },
          { status: 403 }
        );
      }
      const next: MasterState = {
        ...cur,
        executionAuthorized: d.enabled && brokerReady,
        lastToggledAt: new Date().toISOString(),
        reason: d.enabled
          ? `Authorized execution connected via ${user.brokerConfig.provider} (${user.brokerConfig.environment === "demo" ? "Demo" : "Real"}).`
          : "Execution switched off by operator.",
      };
      await setMasterState(user.id, next);
      await db.insert(automationLogs).values({
        userId: user.id,
        action: d.enabled ? "EXECUTION_AUTHORIZED" : "EXECUTION_DISABLED",
        status: "CONFIG_UPDATED",
        symbol: "ALL",
        detail: next.reason,
      });
      return NextResponse.json({ master: next });
    }

    if (d.action === "toggle_rule") {
      if (cur.emergencyStopped && d.isEnabled) {
        return NextResponse.json({ error: "Cannot enable rules while Emergency Stop is engaged." }, { status: 409 });
      }
      const existing = await db
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.id, d.ruleId), eq(automationRules.userId, user.id)))
        .limit(1);
      if (!existing[0]) {
        return NextResponse.json({ error: "Rule not found" }, { status: 404 });
      }
      if (existing[0].mode === "EXECUTION_LOCKED" && d.isEnabled && !brokerReady) {
        return NextResponse.json(
          { error: "This rule requires a verified, authorized broker before activation." },
          { status: 403 }
        );
      }
      const [updated] = await db
        .update(automationRules)
        .set({ isEnabled: d.isEnabled, updatedAt: new Date() })
        .where(eq(automationRules.id, d.ruleId))
        .returning();
      await db.insert(automationLogs).values({
        userId: user.id,
        ruleId: updated.id,
        action: d.isEnabled ? "RULE_ENABLED" : "RULE_PAUSED",
        status: d.isEnabled ? "MONITORED" : "CONFIG_UPDATED",
        symbol: updated.symbol,
        detail: `${updated.name} set to ${d.isEnabled ? "monitoring (no auto-execution)" : "disabled"}.`,
      });
      return NextResponse.json({ rule: updated });
    }

    // create_rule — always defaults to disabled SIGNAL_MONITOR
    const [created] = await db
      .insert(automationRules)
      .values({
        userId: user.id,
        strategyId: d.strategyId ?? null,
        name: d.name.trim(),
        symbol: d.symbol.toUpperCase(),
        mode: "SIGNAL_MONITOR",
        isEnabled: false,
        allowedSessions: d.allowedSessions,
        minConfidence: d.minConfidence,
        maxDailyTriggers: d.maxDailyTriggers,
        stopOnDailyLoss: d.stopOnDailyLoss,
        pauseBeforeHighImpactMins: d.pauseBeforeHighImpactMins,
      })
      .returning();

    await db.insert(automationLogs).values({
      userId: user.id,
      ruleId: created.id,
      action: "RULE_CREATED",
      status: "CONFIG_UPDATED",
      symbol: created.symbol,
      detail: `Created monitor rule "${created.name}" (disabled by default; manual signal monitoring only).`,
    });

    return NextResponse.json({ rule: created }, { status: 201 });
  } catch (err) {
    console.error("Automation POST error:", err);
    return NextResponse.json({ error: "Automation update failed" }, { status: 500 });
  }
}

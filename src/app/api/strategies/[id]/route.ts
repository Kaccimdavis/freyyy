import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  isActive: z.boolean().optional(),
  name: z.string().min(3).max(100).optional(),
  description: z.string().min(6).max(600).optional(),
  minConfidence: z.number().int().min(50).max(95).optional(),
  minRiskReward: z.number().min(1.2).max(8).optional(),
  confirmationsRequired: z.number().int().min(2).max(6).optional(),
  sessionFilters: z.array(z.enum(["Asian", "London", "New York"])).min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await getActiveUser();
    const { id } = await context.params;
    const stratId = Number(id);
    if (!Number.isInteger(stratId) || stratId <= 0) {
      return NextResponse.json({ error: "Invalid strategy ID" }, { status: 400 });
    }
    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
    }
    if (
      parsed.data.name &&
      /\b(2\.618|2\.6\s*math|2\.6\s*fib)/i.test(`${parsed.data.name} ${parsed.data.description ?? ""}`)
    ) {
      return NextResponse.json({ error: "2.6 math logic is retired and not allowed." }, { status: 400 });
    }

    const [updated] = await db
      .update(strategies)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(strategies.id, stratId), eq(strategies.userId, user.id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    return NextResponse.json({ strategy: updated });
  } catch (err) {
    console.error("Strategy PATCH error:", err);
    return NextResponse.json({ error: "Failed to update strategy" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await getActiveUser();
    const { id } = await context.params;
    const stratId = Number(id);
    if (!Number.isInteger(stratId) || stratId <= 0) {
      return NextResponse.json({ error: "Invalid strategy ID" }, { status: 400 });
    }
    const deleted = await db
      .delete(strategies)
      .where(and(eq(strategies.id, stratId), eq(strategies.userId, user.id)))
      .returning({ id: strategies.id });

    if (!deleted[0]) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }
    return NextResponse.json({ deletedId: deleted[0].id });
  } catch (err) {
    console.error("Strategy DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete strategy" }, { status: 500 });
  }
}

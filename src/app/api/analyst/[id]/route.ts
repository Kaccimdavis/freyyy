import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiAnalyses } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647;

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { user, isAuthenticated } = await getActiveUser();
    const id = Number((await params).id);
    if (!validId(id)) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    const [analysis] = await db.select().from(aiAnalyses).where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.userId, user.id), isAuthenticated ? undefined : isNull(aiAnalyses.chartScreenshot))).limit(1);
    if (!analysis) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    return NextResponse.json({ analysis }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("Archive record failed:", err);
    return NextResponse.json({ error: "Unable to open the analysis." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { user, isAuthenticated } = await getActiveUser();
    const id = Number((await params).id);
    if (!validId(id)) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    const [record] = await db.delete(aiAnalyses).where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.userId, user.id), isAuthenticated ? undefined : isNull(aiAnalyses.chartScreenshot))).returning({ id: aiAnalyses.id });
    if (!record) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
    return NextResponse.json({ deletedId: record.id });
  } catch (err) {
    console.error("Archive removal failed:", err);
    return NextResponse.json({ error: "Unable to remove the analysis." }, { status: 500 });
  }
}

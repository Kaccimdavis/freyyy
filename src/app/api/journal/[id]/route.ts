import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { getActiveUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await getActiveUser();
    const { id } = await context.params;
    const entryId = Number(id);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return NextResponse.json({ error: "Invalid entry ID" }, { status: 400 });
    }
    const deleted = await db
      .delete(journalEntries)
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.userId, user.id)))
      .returning({ id: journalEntries.id });
    if (!deleted[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    return NextResponse.json({ deletedId: deleted[0].id });
  } catch (err) {
    console.error("Journal DELETE error:", err);
    return NextResponse.json({ error: "Unable to delete entry" }, { status: 500 });
  }
}

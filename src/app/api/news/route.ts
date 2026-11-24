import { NextRequest, NextResponse } from "next/server";
import { getPredictionHistory, getUpcomingPredictions } from "@/lib/news-predictions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("view") === "history") return NextResponse.json({ history: await getPredictionHistory() });
    return NextResponse.json(await getUpcomingPredictions());
  } catch (err) {
    console.error("News archive could not load:", err);
    return NextResponse.json({ error: "Couldn’t load this section. Please try again." }, { status: 503 });
  }
}

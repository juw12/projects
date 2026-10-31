import { NextRequest, NextResponse } from "next/server";
import { repurposeContent } from "@/lib/anthropic";
import { canUse, recordUse } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const access = await canUse();
  if (!access.allowed) {
    return NextResponse.json(
      {
        error: "free_tier_exceeded",
        message:
          "You've used all 3 free repurposes this month. Upgrade to Pro for $19/mo and get 50/month.",
      },
      { status: 402 }
    );
  }

  let body: { source?: unknown; tone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (source.length < 100) {
    return NextResponse.json(
      { error: "source_too_short", message: "Paste at least 100 characters of source content." },
      { status: 400 }
    );
  }
  if (source.length > 20000) {
    return NextResponse.json(
      { error: "source_too_long", message: "Source must be under 20,000 characters." },
      { status: 400 }
    );
  }

  try {
    const result = await repurposeContent(source);
    await recordUse();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Repurpose error:", message);
    return NextResponse.json(
      { error: "generation_failed", message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createCheckoutUrl } from "@/lib/lemonsqueezy";
import { getOrCreateUserId } from "@/lib/usage";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const plan = req.nextUrl.searchParams.get("plan");
  const variantId =
    plan === "pro"
      ? process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY
      : plan === "power"
      ? process.env.LEMONSQUEEZY_VARIANT_POWER_MONTHLY
      : undefined;

  if (!variantId) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const userId = await getOrCreateUserId();
  try {
    const url = await createCheckoutUrl({
      variantId,
      userId,
    });
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "checkout_failed", message }, { status: 500 });
  }
}

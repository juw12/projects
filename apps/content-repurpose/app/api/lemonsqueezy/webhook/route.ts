import { NextRequest, NextResponse } from "next/server";
import { tierFromVariantId, verifyWebhookSignature } from "@/lib/lemonsqueezy";
import { clearUserTier, setUserTier } from "@/lib/store";

export const runtime = "nodejs";

interface LSWebhookPayload {
  meta: {
    event_name: string;
    test_mode?: boolean;
  };
  data: {
    id: string;
    attributes: {
      status: string;
      variant_id?: number | string;
      custom?: { user_id?: string };
    };
  };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: LSWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = payload.meta.event_name;
  const userId = payload.data.attributes.custom?.user_id;

  if (!userId) {
    return NextResponse.json({ error: "missing_user_id" }, { status: 400 });
  }

  const isActiveEvent = [
    "subscription_created",
    "subscription_updated",
    "subscription_resumed",
  ].includes(event);

  const isCancelledEvent = [
    "subscription_cancelled",
    "subscription_expired",
  ].includes(event);

  if (isActiveEvent) {
    const tier = tierFromVariantId(String(payload.data.attributes.variant_id ?? ""));
    if (tier) {
      await setUserTier(userId, tier);
      return NextResponse.json({ ok: true, upgraded: tier, userId });
    }
    return NextResponse.json({ ok: true, ignored: "unknown_variant" });
  }

  if (isCancelledEvent) {
    await clearUserTier(userId);
    return NextResponse.json({ ok: true, downgraded: true, userId });
  }

  return NextResponse.json({ ok: true, ignored: event });
}

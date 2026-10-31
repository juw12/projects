// Lemon Squeezy integration for Taiwan-friendly payments.
// Docs: https://docs.lemonsqueezy.com/api

const API_BASE = "https://api.lemonsqueezy.com/v1";

function headers() {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
  };
}

export interface CheckoutOptions {
  variantId: string;
  userId: string;
  email?: string;
}

export async function createCheckoutUrl({
  variantId,
  userId,
  email,
}: CheckoutOptions): Promise<string> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId) throw new Error("LEMONSQUEEZY_STORE_ID not configured");

  const res = await fetch(`${API_BASE}/checkouts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            custom: { user_id: userId },
            ...(email ? { email } : {}),
          },
        },
        relationships: {
          store: { data: { type: "stores", id: storeId } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lemon Squeezy checkout failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    data: { attributes: { url: string } };
  };
  return json.data.attributes.url;
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!signature || !process.env.LEMONSQUEEZY_WEBHOOK_SECRET) return false;
  const crypto = require("crypto") as typeof import("crypto");
  const hmac = crypto.createHmac("sha256", process.env.LEMONSQUEEZY_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const digest = hmac.digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signature)
  );
}

export function tierFromVariantId(variantId: string | undefined): "pro" | "power" | null {
  if (!variantId) return null;
  if (variantId === process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY) return "pro";
  if (variantId === process.env.LEMONSQUEEZY_VARIANT_POWER_MONTHLY) return "power";
  return null;
}

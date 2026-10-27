// Glow Pro plans: tells GlowLead what is on sale and checks Lemon Squeezy license keys.
// Lemon Squeezy's License API needs no secret key, and nothing is stored here, so this stays on the free plan.
// Settings (wrangler.toml [vars]): PRO_STORE_ID and PRO_CHECKOUT_URL put Pro on sale; PRO_PRODUCT_ID (optional)
// limits keys to one product; PRO_PRICE_LABEL is shown on the plans card.
const LICENSE_API = "https://api.lemonsqueezy.com/v1/licenses/";
const ACTIONS = new Set(["activate", "validate", "deactivate"]);
const KEY_PATTERN = /^[0-9A-Za-z-]{8,100}$/;
const ENDED = new Set(["expired", "disabled"]);

const clip = (value, size) => String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, size);

export function plansInfo(env) {
  const onSale = Boolean(env.PRO_STORE_ID && /^https:\/\//.test(env.PRO_CHECKOUT_URL || ""));
  return {
    ok: true,
    onSale,
    checkoutUrl: onSale ? env.PRO_CHECKOUT_URL : "",
    priceLabel: clip(env.PRO_PRICE_LABEL, 40),
    manageUrl: "https://app.lemonsqueezy.com/my-orders",
  };
}

function friendlyError(message, code) {
  const text = String(message || "");
  if (/activation limit/i.test(text)) return "This key is already used on the most devices allowed. Turn Pro off on another device first.";
  if (/not found|invalid/i.test(text) || code === 404) return "That license key wasn't found. Check it in your purchase email.";
  if (/expired|disabled/i.test(text)) return "This Glow Pro subscription has ended. Renew it to use Pro again.";
  return "The license couldn't be checked (" + (clip(text, 80) || "error " + code) + ").";
}

export async function handleLicense(body, env, fetchImpl = fetch) {
  if (!env.PRO_STORE_ID) return { status: 503, error: "Glow Pro isn't on sale yet. Everything in Glow Free keeps working." };
  const action = String((body && body.action) || "");
  if (!ACTIONS.has(action)) return { status: 400, error: "Unknown license action." };
  const key = clip(body.licenseKey, 120);
  if (!KEY_PATTERN.test(key)) return { status: 400, error: "That doesn't look like a Glow Pro license key." };
  const form = new URLSearchParams({ license_key: key });
  const instanceId = clip(body.instanceId, 100);
  if (action === "activate") form.set("instance_name", clip(body.device, 60) || "Glow");
  else if (instanceId) form.set("instance_id", instanceId);
  else if (action === "deactivate") return { status: 400, error: "This device has no Glow Pro activation to remove." };

  let response;
  let data;
  try {
    response = await fetchImpl(LICENSE_API + action, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    data = await response.json();
  } catch (error) {
    return { status: 502, error: "Couldn't reach the license service. Try again in a minute." };
  }
  const meta = (data && data.meta) || {};
  const sameStore = String(meta.store_id || "") === String(env.PRO_STORE_ID);
  const sameProduct = !env.PRO_PRODUCT_ID || String(meta.product_id || "") === String(env.PRO_PRODUCT_ID);
  if (data && data.error && !meta.store_id) return { status: 200, pro: false, error: friendlyError(data.error, response.status) };
  if (!sameStore || !sameProduct) return { status: 200, pro: false, error: "This key is not for Glow Pro." };

  if (action === "deactivate") return { status: 200, pro: false, deactivated: Boolean(data.deactivated) };
  const license = data.license_key || {};
  const passed = action === "activate" ? Boolean(data.activated) : Boolean(data.valid);
  const status = clip(license.status, 20);
  if (!passed || ENDED.has(status)) {
    return { status: 200, pro: false, licenseStatus: status, error: friendlyError(data.error || status, response.status) };
  }
  return {
    status: 200,
    pro: true,
    licenseStatus: status,
    instanceId: clip((data.instance && data.instance.id) || instanceId, 100),
    expiresAt: license.expires_at || null,
    customer: clip(meta.customer_name, 60),
  };
}

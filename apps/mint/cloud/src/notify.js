/*
 * Notifications: Web Push (RFC 8030/8291/8292 — VAPID + aes128gcm, no third-party service)
 * and optional email through Resend (only when RESEND_API_KEY and MAIL_FROM are set).
 */

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = "";
  new Uint8Array(bytes).forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text) {
  const s = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export function pushEnabled(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** RFC 8291 aes128gcm body for one subscription. */
export async function encryptPayload(subscription, payloadBytes) {
  const uaPublic = b64urlDecode(subscription.p256dh);
  const authSecret = b64urlDecode(subscription.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payloadBytes, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plaintext));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096-byte record size
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

let vapidKeyCache = null;

async function vapidSigningKey(env) {
  if (vapidKeyCache && vapidKeyCache.pub === env.VAPID_PUBLIC_KEY) {
    return vapidKeyCache.key;
  }
  const pub = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  vapidKeyCache = { pub: env.VAPID_PUBLIC_KEY, key };
  return key;
}

export async function vapidHeader(env, endpoint) {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "https://juw12.github.io/projects/mint/",
  })));
  const unsigned = header + "." + claims;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidSigningKey(env), enc.encode(unsigned));
  return "vapid t=" + unsigned + "." + b64urlEncode(signature) + ", k=" + env.VAPID_PUBLIC_KEY;
}

/** Sends one push. Returns the push service's HTTP status (404/410 mean the subscription is gone). */
export async function sendPush(env, subscription, message) {
  const body = await encryptPayload(subscription, enc.encode(JSON.stringify(message)));
  try {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(env, subscription.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "normal",
      },
      body,
    });
    return res.status;
  } catch (err) {
    return 0;
  }
}

export function validSubscription(sub, env) {
  if (!sub || typeof sub !== "object" || !sub.keys) {
    return null;
  }
  const endpoint = String(sub.endpoint || "");
  let url;
  try {
    url = new URL(endpoint);
  } catch (err) {
    return null;
  }
  const allowHttp = env.PUSH_ALLOW_HTTP === "1";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    return null;
  }
  const p256dh = String(sub.keys.p256dh || "");
  const auth = String(sub.keys.auth || "");
  if (endpoint.length > 800 || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
    return null;
  }
  if (b64urlDecode(p256dh).length !== 65 || b64urlDecode(auth).length !== 16) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

// ---- email (Resend)
export function emailEnabled(env) {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendEmail(env, to, message) {
  if (!emailEnabled(env) || !to || to.endsWith(".invalid") || to.endsWith(".local")) {
    return 0;
  }
  const link = message.url ? "\n\n" + message.url : "";
  const html = "<div style=\"font-family:system-ui,sans-serif;font-size:15px;line-height:1.5\"><p><strong>" + escapeHtml(message.title) +
    "</strong></p><p>" + escapeHtml(message.body) + "</p>" +
    (message.url ? "<p><a href=\"" + escapeHtml(message.url) + "\">Open Mint</a></p>" : "") +
    "<p style=\"color:#667\">You get this because of activity on your Mint account. Turn emails off in Mint → Account.</p></div>";
  try {
    const res = await fetch((env.RESEND_API_BASE || "https://api.resend.com") + "/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: message.title, text: message.body + link, html }),
    });
    return res.status;
  } catch (err) {
    return 0;
  }
}

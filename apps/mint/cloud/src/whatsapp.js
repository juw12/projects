/*
 * WhatsApp → Mint: log expenses by chatting with Mint's WhatsApp number (WhatsApp Cloud API).
 *
 * Privacy model (same promise as sync: the server never stores budget data it can read):
 *  - Each account has an "inbox key", a P-256 ECDH key pair made in the browser. The server keeps only the
 *    public half plus the private half sealed with the account's sync key (which the server never sees).
 *  - When a message arrives, the worker seals it to that public key at once (ECIES: ephemeral ECDH + HKDF-SHA256
 *    + AES-256-GCM) and stores only the ciphertext. Mint on any signed-in device opens it, files it into the
 *    budget with its own parser and category history, and acknowledges it, which deletes it here.
 *  - Phone numbers are stored as an HMAC (plus the last 4 digits to show in Settings).
 *  WhatsApp itself (Meta) and this worker necessarily see the message text in transit to answer it.
 *
 * Wire format of a sealed inbox item: "e1.<ephemeral public key, raw>.<iv>.<ciphertext>" (base64url parts).
 */
import { b64urlEncode, b64urlDecode } from "./notify.js";

const enc = new TextEncoder();
const INBOX_INFO = enc.encode("mint-wa-inbox-v1");
const INBOX_AAD = enc.encode("mint-wa-inbox");
const GRAPH_DEFAULT = "https://graph.facebook.com/v24.0";

export function enabled(env) {
  return Boolean(
    env.WHATSAPP_TOKEN && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_NUMBER,
  );
}

/** The number people message, digits only (for wa.me links). */
export function displayNumber(env) {
  return String(env.WHATSAPP_NUMBER || "").replace(/\D/g, "");
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, typeof data === "string" ? enc.encode(data) : data));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Meta signs every webhook POST: X-Hub-Signature-256: sha256=HMAC(app secret, raw body). */
export async function verifySignature(env, rawBody, header) {
  const given = String(header || "");
  if (!given.startsWith("sha256=") || !env.WHATSAPP_APP_SECRET) {
    return false;
  }
  const expected = "sha256=" + (await hmacHex(env.WHATSAPP_APP_SECRET, rawBody));
  return safeEqual(given.toLowerCase(), expected);
}

/** Stable, non-reversible id for a phone number (digits only). Keep WHATSAPP_HASH_SECRET stable. */
export function phoneHash(env, phone) {
  const secret = env.WHATSAPP_HASH_SECRET || env.WHATSAPP_VERIFY_TOKEN || "mint-wa";
  return hmacHex(secret, "wa-phone:" + String(phone || "").replace(/\D/g, ""));
}

export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return "•••" + digits.slice(-4);
}

/** Pull the user messages out of a webhook payload (statuses and other changes are ignored). */
export function messagesFrom(payload) {
  const out = [];
  const entries = payload && Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change && change.value;
      if (!value || !Array.isArray(value.messages)) {
        continue;
      }
      if (value.metadata && value.metadata.phone_number_id && change.field && change.field !== "messages") {
        continue;
      }
      for (const m of value.messages) {
        if (!m || !m.id || !m.from) {
          continue;
        }
        let textBody = "";
        if (m.type === "text" && m.text) {
          textBody = String(m.text.body || "");
        } else if (m.type === "interactive" && m.interactive) {
          const r = m.interactive.button_reply || m.interactive.list_reply || {};
          textBody = String(r.title || "");
        } else if (m.type === "button" && m.button) {
          textBody = String(m.button.text || "");
        }
        out.push({
          id: String(m.id).slice(0, 200),
          from: String(m.from).replace(/\D/g, "").slice(0, 20),
          type: String(m.type || ""),
          text: textBody.slice(0, 2000),
          at: parseInt(m.timestamp, 10) || Math.floor(Date.now() / 1000),
          phoneNumberId: value.metadata ? String(value.metadata.phone_number_id || "") : "",
        });
      }
    }
  }
  return out;
}

/** A browser-made P-256 public key in JWK form. */
export function cleanPublicJwk(jwk) {
  if (!jwk || typeof jwk !== "object" || jwk.kty !== "EC" || jwk.crv !== "P-256") {
    return null;
  }
  const part = /^[A-Za-z0-9_-]{43}$/;
  if (!part.test(String(jwk.x || "")) || !part.test(String(jwk.y || "")) || jwk.d) {
    return null;
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

async function inboxAesKey(sharedBits, epkRaw, usage) {
  const ikm = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epkRaw, info: INBOX_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** Seal a JSON value so only the holder of the inbox private key can read it. */
export async function sealForInbox(publicJwk, value) {
  const recipient = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const epkRaw = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: recipient }, eph.privateKey, 256);
  const key = await inboxAesKey(shared, epkRaw, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: INBOX_AAD }, key, enc.encode(JSON.stringify(value)));
  return "e1." + b64urlEncode(epkRaw) + "." + b64urlEncode(iv) + "." + b64urlEncode(ct);
}

/** The inverse of sealForInbox (the browser has its own copy in web/budget/js/whatsapp.js; tests use this one). */
export async function openFromInbox(privateJwk, blob) {
  const parts = String(blob || "").split(".");
  if (parts.length !== 4 || parts[0] !== "e1") {
    throw new Error("Unknown inbox item format");
  }
  const priv = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const epkRaw = b64urlDecode(parts[1]);
  const epk = await crypto.subtle.importKey("raw", epkRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256);
  const key = await inboxAesKey(shared, epkRaw, "decrypt");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64urlDecode(parts[2]), additionalData: INBOX_AAD }, key, b64urlDecode(parts[3]));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Free-form reply. Always inside the 24-hour window the user's own message opened, so no template is needed. */
export async function sendText(env, to, body) {
  const base = (env.WHATSAPP_GRAPH_BASE || GRAPH_DEFAULT).replace(/\/+$/, "");
  try {
    const res = await fetch(base + "/" + encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID) + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.WHATSAPP_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: String(body).slice(0, 4000) },
      }),
    });
    if (!res.ok) {
      console.error("whatsapp send failed", res.status, (await res.text()).slice(0, 300));
    }
    return res.ok;
  } catch (err) {
    console.error("whatsapp send error", err && err.message);
    return false;
  }
}

// ------------------------------------------------------------------ conversation
export const COMMANDS = {
  help: /^(help|bantuan|tolong|menu|ayuda|帮助|\?)$/i,
  undo: /^(undo|batal|batalkan|hapus|deshacer|撤销)$/i,
  stop: /^(stop|unlink|disconnect|putus|berhenti|parar|停止)$/i,
  totals: /^(total|totals|balance|saldo|summary|ringkasan|sisa|resumen|余额|总计)$/i,
  link: /^(?:link|connect|hubungkan|vincular|绑定)\s*:?\s*(?:mint-)?([A-Za-z0-9]{6})$/i,
};

export const HELP_TEXT =
  "🌿 *Mint on WhatsApp*\n" +
  "Send what you spent and Mint adds it to your budget:\n" +
  "• coffee 25k\n" +
  "• grab 18rb\n" +
  "• lunch 12.50 usd yesterday\n" +
  "• +5jt salary  (a + means income)\n" +
  "One per line to send several at once.\n\n" +
  "*undo* removes your last WhatsApp entry · *stop* unlinks this number · *help* shows this.";

export function money(Budget, amount, cur) {
  try {
    return Budget.fmt(amount, cur || "IDR");
  } catch (err) {
    return String(amount);
  }
}

/** The reply to a message of entries, built with the same parser the app uses. */
export function entryReply(Budget, lines, currency) {
  const good = lines.filter((l) => l.parsed);
  const bad = lines.filter((l) => !l.parsed);
  if (!good.length) {
    return "🤔 I couldn't find an amount in that. Try *coffee 25k* or *lunch 12.50*.\nSend *help* for more.";
  }
  const rows = good.map((l) => {
    const p = l.parsed;
    const sign = p.type === "income" ? "+" : "";
    const when = p.dayOffset === -1 ? " (yesterday)" : "";
    return "• " + sign + money(Budget, p.amount, p.cur || currency) + (p.desc ? " · " + p.desc : "") + when;
  });
  let out = "✅ Saved for Mint:\n" + rows.join("\n");
  if (bad.length) {
    out += "\n\n⚠️ Skipped (no amount): " + bad.map((l) => "“" + l.line.slice(0, 40) + "”").join(", ");
  }
  return out + "\n\nIt appears in your budget the next time Mint is open.";
}

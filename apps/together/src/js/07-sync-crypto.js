/* ----------------------------------------------- sync: end-to-end encryption */
const b64u = {
  encode(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text) {
    const normal = String(text).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normal + "===".slice((normal.length + 3) % 4);
    return Uint8Array.from(atob(padded), ch => ch.charCodeAt(0));
  },
};
const textBytes = text => new TextEncoder().encode(text);

const PASSPHRASE_ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
/** Stretch an optional shared passphrase (PBKDF2, salted with the link secret). Returns "" when none. */
async function stretchPassphrase(passphrase, secretText) {
  const normalized = String(passphrase || "").normalize("NFKC").trim();
  if (!normalized) return "";
  const material = await crypto.subtle.importKey("raw", textBytes(normalized), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array([...textBytes("together-pass-v1:"), ...b64u.decode(secretText)]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSPHRASE_ITERATIONS }, material, 256);
  return b64u.encode(new Uint8Array(bits));
}
/**
 * From the link secret (+ the stretched passphrase, if the couple set one) derive an AES-GCM key that
 * never leaves the device and a separate write-auth token. With a passphrase, the link alone can
 * neither read nor overwrite the plan.
 */
async function deriveSyncKeys(secretText, stretched = "") {
  const secret = b64u.decode(secretText);
  const keyMaterial = stretched ? new Uint8Array([...secret, ...b64u.decode(stretched)]) : secret;
  const material = await crypto.subtle.importKey("raw", keyMaterial, "HKDF", false, ["deriveKey", "deriveBits"]);
  const salt = textBytes(stretched ? "together-sync-v2" : "together-sync-v1");
  const encKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: textBytes("encrypt") },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const authBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: textBytes("auth") }, material, 256);
  return { encKey, auth: b64u.encode(new Uint8Array(authBits)) };
}
async function pipeBytes(bytes, transform) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
}
async function sealPlan(plan, encKey) {
  let bytes = textBytes(JSON.stringify(plan));
  let format = "j";
  if (typeof CompressionStream === "function") {
    bytes = await pipeBytes(bytes, new CompressionStream("gzip"));
    format = "g";
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: textBytes("together:" + format) }, encKey, bytes);
  return `t1.${format}.${b64u.encode(iv)}.${b64u.encode(new Uint8Array(cipher))}`;
}
async function openPlan(text, encKey) {
  const [tag, format, ivText, cipherText] = String(text).split(".");
  if (tag !== "t1" || !ivText || !cipherText) throw new Error("Unknown sync format");
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64u.decode(ivText), additionalData: textBytes("together:" + format) }, encKey, b64u.decode(cipherText)));
  const bytes = format === "g" ? await pipeBytes(plain, new DecompressionStream("gzip")) : plain;
  return JSON.parse(new TextDecoder().decode(bytes));
}


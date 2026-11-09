// apps/airiz-motor/tools/sign-manifest.ts
//
// AIRIZ Motor Console — Unified Release Manifest Signer
//
// Reads a build-artifact manifest (JSON), produces a signed manifest
// conforming to airiz-release.v1 schema. Ed25519 over the canonical JSON body
// (excluding the `signatures[]` field). Node 18+.
//
// Usage:
//   node --experimental-strip-types sign-manifest.ts \
//     --input build/artifacts.json \
//     --key airiz-signing-private.pem \
//     --output release-manifest.json \
//     --key-id airiz-prod-2026 \
//     --channel production \
//     --staged-rollout 10
//
// Input format (build/artifacts.json):
//   {
//     "schema_version": 1,
//     "app_id": "airiz-motor-console",
//     "target_versions": {
//       "electron": "1.7.3",
//       "capacitor_ios": "1.7.3",
//       "capacitor_android": "1.7.3",
//       "pwa": "1.7.3",
//       "worker": "1.7.3"
//     },
//     "artifacts": {
//       "electron": {
//         "url": "https://releases.airiz.example/airiz-1.7.3.exe",
//         "sha512": "<hex>",
//         "size": 72345678,
//         "blockmap_url": "https://releases.airiz.example/airiz-1.7.3.exe.blockmap"
//       },
//       "capacitor_android": {
//         "url": "https://releases.airiz.example/airiz-1.7.3.zip",
//         "sha256": "<hex>"
//       },
//       "pwa":    { "url": "https://releases.airiz.example/web/1.7.3/" },
//       "worker": { "url": "https://releases.airiz.example/worker/1.7.3.js" }
//     }
//   }

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ----- args parsing -------------------------------------------------------

interface Args {
  input: string;
  key: string;
  output: string;
  keyId: string;
  channel: string;
  stagedRollout: number;
  releasedAt: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback?: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const input = get("--input");
  const key = get("--key");
  const output = get("--output");
  if (!input || !key || !output) {
    process.stderr.write(
      "Usage: sign-manifest --input <artifacts.json> --key <private.pem> " +
        "--output <manifest.json> [--key-id <id>] [--channel <c>] " +
        "[--staged-rollout <0-100>] [--released-at <iso8601>]\n",
    );
    process.exit(2);
  }
  return {
    input,
    key,
    output,
    keyId: get("--key-id", "airiz-prod-2026")!,
    channel: get("--channel", "production")!,
    stagedRollout: parseInt(get("--staged-rollout", "100")!, 10),
    releasedAt: get("--released-at", new Date().toISOString())!,
  };
}

// ----- canonical JSON -----------------------------------------------------

// RFC 8785 / JSON Canonicalization Scheme (subset sufficient for our schema).
// Sort object keys recursively. Arrays preserve order. No whitespace.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

// ----- sign ---------------------------------------------------------------

function signManifest(
  body: Record<string, unknown>,
  privateKeyPem: string,
  keyId: string,
): string {
  // Remove signatures[] before signing.
  const bodyForSigning: Record<string, unknown> = { ...body };
  delete bodyForSigning.signatures;

  const canonical = canonicalJson(bodyForSigning);
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey);
  const signatureB64 = signature.toString("base64");

  body.signatures = [
    {
      key_id: keyId,
      alg: "ed25519",
      value: signatureB64,
    },
  ];
  return signatureB64;
}

// ----- verify (used by the CI smoke-test, also serves as documentation) ----

function verifyManifest(
  body: Record<string, unknown>,
  publicKeyPem: string,
): boolean {
  const signatures = body.signatures as
    | Array<{ key_id: string; alg: string; value: string }>
    | undefined;
  if (!signatures || signatures.length === 0) return false;
  // Iterate every ed25519 signature and accept if ANY one verifies against
  // the supplied pubkey. Mirrors the Worker's verifyAny() and is required for
  // the key-rotation window: a manifest may carry both the old key's sig
  // (so clients that haven't yet rotated still update) and the new key's sig
  // (so freshly-deployed clients update immediately). The order of signatures
  // is therefore not significant — we accept whichever one verifies.
  const ed25519Sigs = signatures.filter((s) => s.alg === "ed25519");
  if (ed25519Sigs.length === 0) return false;

  const bodyForSigning: Record<string, unknown> = { ...body };
  delete bodyForSigning.signatures;
  const canonical = canonicalJson(bodyForSigning);

  const publicKey = crypto.createPublicKey(publicKeyPem);
  for (const sig of ed25519Sigs) {
    const ok = crypto.verify(
      null,
      Buffer.from(canonical, "utf8"),
      publicKey,
      Buffer.from(sig.value, "base64"),
    );
    if (ok) return true;
  }
  return false;
}

// ----- main ---------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const inputBody = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const privateKeyPem = fs.readFileSync(args.key, "utf8");

  // Build the full body.
  const body: Record<string, unknown> = {
    schema_version: inputBody.schema_version ?? 1,
    app_id: inputBody.app_id ?? "airiz-motor-console",
    channel: args.channel,
    released_at: args.releasedAt,
    staged_rollout: args.stagedRollout,
    target_versions: inputBody.target_versions,
    artifacts: inputBody.artifacts,
  };

  signManifest(body, privateKeyPem, args.keyId);

  // Ensure output dir exists.
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(body, null, 2) + "\n", "utf8");

  // Local self-verify so CI fails fast on key/script regressions.
  // We re-derive the public key from the private key (Node supports this).
  const publicKeyPem = crypto
    .createPublicKey(privateKeyPem)
    .export({ format: "pem", type: "spki" }) as string;
  const ok = verifyManifest(body, publicKeyPem);
  if (!ok) {
    process.stderr.write("FATAL: signature did not verify against derived public key\n");
    process.exit(1);
  }

  process.stdout.write(
    `Signed manifest written to ${args.output} (channel=${args.channel}, ` +
      `rollout=${args.stagedRollout}%, key_id=${args.keyId})\n`,
  );
}

// Export for unit tests / reuse by the electron-updater adapter.
export { canonicalJson, signManifest, verifyManifest };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

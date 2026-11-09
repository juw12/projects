// apps/airiz-motor/tools/keygen.ts
//
// AIRIZ Motor Console — Ed25519 signing keypair generator
//
// Generates an ed25519 keypair for the unified release manifest. Outputs
// the private key (PEM, PKCS8) and public key (PEM, SPKI) to two separate
// files. The PRIVATE key MUST NEVER be committed; store it in your CI
// secret manager (e.g. GitHub Actions encrypted secret).
//
// Usage:
//   node --experimental-strip-types keygen.ts \
//     --private-out secrets/airiz-signing-private.pem \
//     --public-out secrets/airiz-signing-public.pem
//
// Then in CI:
//   - AIRIZ_SIGNING_PRIVATE_KEY_PEM  (cat $private_out)  -- secret
//   - AIRIZ_SIGNING_PUBLIC_KEY_PEM   (cat $public_out)   -- secret or repo file
//
// The PUBLIC key is what you embed in:
//   - app-update.yml: `updateManifestPublicKey: <base64 of SPKI DER>`
//   - capawesome config: switch from RSA to ed25519 (or keep RSA for now)
//   - Workbox precache manifest: signed at build time

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv: string[]): { privateOut: string; publicOut: string } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const privateOut = get("--private-out");
  const publicOut = get("--public-out");
  if (!privateOut || !publicOut) {
    process.stderr.write(
      "Usage: keygen --private-out <path.pem> --public-out <path.pem>\n",
    );
    process.exit(2);
  }
  return { privateOut, publicOut };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

  const privatePem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;
  const publicPem = publicKey.export({
    format: "pem",
    type: "spki",
  }) as string;

  fs.mkdirSync(path.dirname(args.privateOut), { recursive: true });
  fs.mkdirSync(path.dirname(args.publicOut), { recursive: true });

  fs.writeFileSync(args.privateOut, privatePem, { mode: 0o600 });
  fs.writeFileSync(args.publicOut, publicPem, { mode: 0o644 });

  // electron-updater's app-update.yml expects the public key as a
  // base64-encoded SPKI DER (NOT the PEM with header/footer). Compute and
  // print so the user can paste it into app-update.yml:
  //   updateManifestPublicKey: <base64 SPKI DER>
  const spkiDer = publicKey.export({ format: "der", type: "spki" });
  const base64Spki = Buffer.from(spkiDer).toString("base64");

  process.stdout.write(
    "Ed25519 keypair written.\n" +
      `  private: ${args.privateOut}\n` +
      `  public:  ${args.publicOut}\n` +
      "\n" +
      "For app-update.yml, use the following as `updateManifestPublicKey`:\n" +
      `  updateManifestPublicKey: "${base64Spki}"\n` +
      "\n" +
      "Public-key SHA-256 fingerprint (for key-rotation audits):\n" +
      `  ${crypto.createHash("sha256").update(spkiDer).digest("hex")}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

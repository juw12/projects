// apps/airiz-motor/tools/manifest-to-electron-yml.ts
//
// AIRIZ Motor Console — Adapter: unified manifest → electron-updater latest.yml
//
// electron-updater (electron-builder v27+) parses latest.yml / latest-mac.yml /
// latest-linux.yml via js-yaml. v27 also enforces Ed25519 manifest signing via
// the `updateManifestPublicKey` field in `app-update.yml`. We translate the
// unified manifest's `artifacts.electron` block into that schema and write
// latest.yml (Windows) and latest-mac.yml (macOS) side-by-side.
//
// Channel: per-channel file naming follows the electron-updater convention
// (`latest.yml` for default, `latest-beta.yml` for beta, etc.). The CI workflow
// writes one set per channel into the same R2 prefix.
//
// Usage:
//   node --experimental-strip-types manifest-to-electron-yml.ts \
//     --input release-manifest.json \
//     --output-dir release/electron \
//     [--channel production]
//
// Inputs: a signed airiz-release.v1 manifest (output of sign-manifest.ts).
// Outputs (per channel): latest.yml, latest-mac.yml, latest-linux.yml,
//                        latest.yml.sig (or .sig arrays) for the v27 verifier.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, verifyManifest } from "./sign-manifest.ts";

interface ElectronArtifact {
  url: string;
  sha512?: string;
  size?: number;
  blockmap_url?: string;
}

interface UnifiedManifest {
  schema_version: number;
  app_id: string;
  channel: string;
  released_at: string;
  staged_rollout: number;
  target_versions: Record<string, string>;
  artifacts: {
    electron?: ElectronArtifact;
    capacitor_ios?: { url: string };
    capacitor_android?: { url: string; sha256?: string };
    pwa?: { url: string };
    worker?: { url: string };
  };
  signatures?: Array<{ key_id: string; alg: string; value: string }>;
}

function parseArgs(argv: string[]): { input: string; outputDir: string; channel: string; publicKey?: string } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--input");
  const outputDir = get("--output-dir");
  if (!input || !outputDir) {
    process.stderr.write(
      "Usage: manifest-to-electron-yml --input <manifest.json> " +
        "--output-dir <dir> [--channel production] [--public-key <pem>]\n",
    );
    process.exit(2);
  }
  return {
    input,
    outputDir,
    channel: get("--channel") ?? "production",
    publicKey: get("--public-key"),
  };
}

// electron-updater's latest.yml schema (verified from
// electron-builder-update-checker / builder-util-runtime UpdateInfo type,
// ref: https://github.com/electron-userland/electron-builder — v27+).
// Required: version, files[]. Required within each file: url, sha512, size.
// Ed25519 manifest signing adds `signature` + `signatures[]` (v27).
interface ElectronLatestYml {
  version: string;
  files: Array<{ url: string; sha512: string; size: number; blockMapSize?: number }>;
  path: string;
  sha512: string;
  size: number;
  releaseDate: string;
  stagingPercentage: number;
  signature?: string;
  signatures?: Array<{ keyId: string; signature: string }>;
}

function buildLatestYml(
  artifact: ElectronArtifact,
  version: string,
  releasedAt: string,
  stagedRollout: number,
  signatures: Array<{ key_id: string; alg: string; value: string }>,
): ElectronLatestYml {
  if (!artifact.sha512 || artifact.size === undefined) {
    throw new Error(
      "electron-updater v27 requires sha512 + size on every file; " +
        "ensure build/artifacts.json populates them for `artifacts.electron`",
    );
  }
  const filename = path.posix.basename(new URL(artifact.url).pathname);
  const doc: ElectronLatestYml = {
    version,
    files: [
      {
        url: artifact.url,
        sha512: artifact.sha512,
        size: artifact.size,
      },
    ],
    path: artifact.url,
    sha512: artifact.sha512,
    size: artifact.size,
    releaseDate: releasedAt,
    stagingPercentage: stagedRollout,
  };
  // Map Ed25519 signature(s) onto electron-updater's expected fields.
  // v27: `signature` (legacy) + `signatures[]` (array of {keyId, signature}).
  // We use the array form (Tauri-style key rotation friendly).
  if (signatures.length > 0) {
    doc.signatures = signatures.map((s) => ({
      keyId: s.key_id,
      signature: s.value,
    }));
  }
  return doc;
}

// ----- main ---------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const manifest = JSON.parse(fs.readFileSync(args.input, "utf8")) as UnifiedManifest;

  // Defense-in-depth: if a public key is provided, re-verify the signature
  // before we emit anything. CI sets AIRIZ_PUBLIC_KEY_PEM for this.
  if (args.publicKey) {
    const ok = verifyManifest(manifest, args.publicKey);
    if (!ok) {
      process.stderr.write("FATAL: signature did not verify against provided public key\n");
      process.exit(1);
    }
  }

  if (!manifest.artifacts.electron) {
    process.stderr.write("WARN: artifacts.electron missing — skipping electron-updater emit\n");
    return;
  }
  const version = manifest.target_versions.electron;
  if (!version) {
    throw new Error("target_versions.electron missing");
  }

  const doc = buildLatestYml(
    manifest.artifacts.electron,
    version,
    manifest.released_at,
    manifest.staged_rollout,
    manifest.signatures ?? [],
  );

  fs.mkdirSync(args.outputDir, { recursive: true });

  // electron-updater channel naming: latest.yml (default), latest-beta.yml, etc.
  // For the production channel this is just `latest.yml`.
  const baseName = args.channel === "production" ? "latest" : `latest-${args.channel}`;

  // We emit one file; CI uploads the right one per platform target.
  // (Windows uses `latest.yml`, macOS uses `latest-mac.yml`, Linux uses
  // `latest-linux.yml` — same JSON body; the file suffix is what tells
  // electron-updater which platform.)
  for (const suffix of ["latest.yml", "latest-mac.yml", "latest-linux.yml"]) {
    // Per-platform files only differ in name; the contents are identical
    // because `path` and `files[].url` carry the full URL.
    const outPath = path.join(
      args.outputDir,
      suffix.replace(/^latest/, baseName),
    );
    fs.writeFileSync(outPath, toYaml(doc) + "\n", "utf8");
  }

  // Surface the canonical JSON body + signature for downstream verification
  // (e.g. the Cloudflare Worker that serves it to mobile/PWA surfaces).
  // Destructure-omit (not `{ ...manifest, signatures: undefined }`) so the
  // `signatures` key is removed entirely — matches what signManifest signs
  // over, what the Worker's verifyAny recomputes, and what the PWA SW + mobile
  // live-update expect to canonicalize.
  const { signatures: _omit, ...bodyForCanonical } = manifest;
  fs.writeFileSync(
    path.join(args.outputDir, "manifest.canonical.json"),
    canonicalJson(bodyForCanonical) + "\n",
    "utf8",
  );

  process.stdout.write(
    `Wrote electron-updater artifacts (channel=${args.channel}) to ${args.outputDir}\n`,
  );
}

// Minimal YAML emitter sufficient for the electron-updater latest.yml schema.
// No deps. Strings are JSON-quoted (handles Unicode + control chars safely).
function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return jsonQuoteString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const head = `${pad}- `;
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) return `${head}{}`.trimEnd();
          const [firstKey, firstVal] = entries[0];
          return (
            head +
            `${firstKey}: ${renderScalar(firstVal)}\n` +
            entries
              .slice(1)
              .map(([k, v]) => `${pad}  ${k}: ${renderScalar(v) ?? toYaml(v, indent + 2)}`)
              .join("\n")
          );
        }
        return head + renderScalar(item) ?? toYaml(item, indent + 2);
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const rendered = renderScalar(v);
        if (rendered !== null) return `${pad}${k}: ${rendered}`;
        if (Array.isArray(v) && v.length === 0) return `${pad}${k}: []`;
        if (v !== null && typeof v === "object" && Object.keys(v).length === 0)
          return `${pad}${k}: {}`;
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`;
      })
      .join("\n");
  }
  return String(value);
}

function renderScalar(v: unknown): string | null {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return jsonQuoteString(v);
  return null;
}

function jsonQuoteString(s: string): string {
  // Quote as JSON string (YAML accepts JSON-style quoted scalars).
  return JSON.stringify(s);
}

export { buildLatestYml, toYaml };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

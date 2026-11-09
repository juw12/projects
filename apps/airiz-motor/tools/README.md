# AIRIZ Motor Console — Unified Release Tools

These four TypeScript files implement the unified release protocol that all
five AIRIZ surfaces consume from a single signed manifest on Cloudflare R2.
They run on Node 18+ (uses `crypto.generateKeyPairSync("ed25519")`) and use
no external dependencies — just the Node stdlib.

## Files

| File | Purpose |
|------|---------|
| `keygen.ts` | Generate the Ed25519 signing keypair. Run once. Store the private key in CI secrets. |
| `sign-manifest.ts` | Take a per-build artifacts JSON, produce the signed `airiz-release.json`. |
| `sign-manifest.test.ts` | Unit tests for the signer + canonical-JSON body, including the key-rotation invariant. |
| `manifest-to-electron-yml.ts` | Translate the signed manifest into electron-updater's `latest.yml` (per platform suffix). |
| `manifest-to-electron-yml.test.mjs` | End-to-end regression test: runs `sign-manifest` + `manifest-to-electron-yml` as subprocesses and asserts (a) the generated `manifest.canonical.json` omits the `signatures` key entirely (catches the spread-with-undefined bug), (b) all 3 platform sidecars carry the `signatures[]` array form, and (c) a dual-signature (rotation window) manifest produces a sidecar with both keyIds. |
| `.github/workflows/airiz-unified-release.yml` | Orchestrate: build 5 surfaces → sign → upload to R2 → wrangler version → crash-monitor. |

## First-time setup

1. **Generate the signing keypair:**
   ```bash
   node --experimental-strip-types tools/keygen.ts \
     --private-out secrets/airiz-signing-private.pem \
     --public-out  secrets/airiz-signing-public.pem
   ```
   The script prints the `updateManifestPublicKey` value to paste into
   `apps/airiz-motor-desktop/resources/app-update.yml` (electron-updater v27+
   uses this for mandatory Ed25519 manifest signature verification).

2. **Store secrets:**
   - `AIRIZ_SIGNING_PRIVATE_KEY_PEM` — in GitHub Actions → Settings → Secrets.
     Multi-line: paste the contents of `secrets/airiz-signing-private.pem`.
   - `AIRIZ_SIGNING_PUBLIC_KEY_PEM` — same location. Used by CI to re-verify
     signatures before emitting `latest.yml`.

3. **Provision Cloudflare R2:**
   - Create bucket `airiz-releases` (region: auto).
   - Create an R2 API token with `Object Read & Write` scoped to that bucket.
   - Add the access key id / secret as GitHub secrets `R2_ACCESS_KEY_ID`
     and `R2_SECRET_ACCESS_KEY`. Add the S3 endpoint URL (`https://<acct>.r2.cloudflarestorage.com`) as `R2_ENDPOINT` in vars.

4. **One-time push of the public key into `app-update.yml`** (electron-updater side):
   ```yaml
   # apps/airiz-motor-desktop/resources/app-update.yml
   provider: generic
   url: https://releases.airiz.example
   channel: production
   updateManifestPublicKey: "<base64 SPKI DER from keygen>"
   ```
   Then **delete** the `secrets/airiz-signing-private.pem` file from your
   workstation; it must live only in CI.

## Per-release flow (what `.github/workflows/airiz-unified-release.yml` does)

```
tag push v1.7.3
   │
   ├── build matrix (electron, capacitor-android, capacitor-ios, pwa, worker)
   │     └─ emits per-surface hash JSON + upload-artifact
   │
   ├── sign
   │     ├─ merge hashes → build/manifest-input.json
   │     ├─ sign with AIRIZ_SIGNING_PRIVATE_KEY_PEM → release/airiz-release.json
   │     ├─ emit release/electron/latest.yml + latest-mac.yml + latest-linux.yml
   │     ├─ re-verify signed manifest against AIRIZ_SIGNING_PUBLIC_KEY_PEM
   │     ├─ aws s3 sync per-surface artifacts to s3://airiz-releases/<surface>/<version>/
   │     ├─ aws s3 cp latest.yml to s3://airiz-releases/electron/<version>/
   │     └─ aws s3 cp airiz-release.json to s3://airiz-releases/production/manifest.json
   │
   ├── worker rollout
   │     └─ wrangler versions upload && wrangler versions deploy --percentage 10
   │
   └── monitor (24h)
         ├─ poll Sentry release health for `crash_free_sessions`
         ├─ if < 0.995 → bump staged_rollout=0, re-sign, re-upload; wrangler rollback
         └─ if ≥ 0.995 → bump staged_rollout=100, re-sign, re-upload; wrangler versions deploy --percentage 100
```

## Local dry-run

To test the signing pipeline without a tag push:

```bash
# 1. Generate test keypair (do not use your prod keys locally).
node --experimental-strip-types tools/keygen.ts \
  --private-out /tmp/airiz-test.pem \
  --public-out  /tmp/airiz-test.pub

# 2. Create a sample input.
cat > /tmp/airiz-artifacts.json <<'JSON'
{
  "schema_version": 1,
  "app_id": "airiz-motor-console",
  "target_versions": {
    "electron": "1.7.3",
    "capacitor_ios": "1.7.3",
    "capacitor_android": "1.7.3",
    "pwa": "1.7.3",
    "worker": "1.7.3"
  },
  "artifacts": {
    "electron": {
      "url": "https://releases.airiz.example/electron/1.7.3/airiz-1.7.3.exe",
      "sha512": "REPLACE_WITH_ACTUAL_SHA512",
      "size": 72345678
    },
    "capacitor_android": {
      "url": "https://releases.airiz.example/capacitor-android/1.7.3/airiz-1.7.3.zip",
      "sha256": "REPLACE_WITH_ACTUAL_SHA256"
    },
    "pwa":    { "url": "https://releases.airiz.example/web/1.7.3/" },
    "worker": { "url": "https://releases.airiz.example/worker/1.7.3.js" }
  }
}
JSON

# 3. Sign.
node --experimental-strip-types tools/sign-manifest.ts \
  --input  /tmp/airiz-artifacts.json \
  --key    /tmp/airiz-test.pem \
  --output /tmp/airiz-release.json \
  --key-id airiz-test \
  --channel production \
  --staged-rollout 100

# 4. Emit electron-updater sidecar (re-verifies the signature).
AIRIZ_PUBLIC_KEY_PEM="$(cat /tmp/airiz-test.pub)" \
node --experimental-strip-types tools/manifest-to-electron-yml.ts \
  --input /tmp/airiz-release.json \
  --output-dir /tmp/electron-out \
  --public-key "$AIRIZ_PUBLIC_KEY_PEM"

# 5. Inspect.
cat /tmp/airiz-release.json | jq '.signatures'
cat /tmp/electron-out/latest.yml
```

The signer **re-verifies its own output** against the public key derived
from the private key (Node supports `crypto.createPublicKey(pem)` to recover
the public key), so a broken signature fails the script with a non-zero exit
status before any artifact is uploaded.

## Schema notes

- **Channel**: file prefix `airiz-releases/<channel>/manifest.json`. Production
  channel lives at `airiz-releases/production/manifest.json`. Beta at
  `airiz-releases/beta/manifest.json`. The electron-updater sidecar follows
  the same convention (`latest.yml` for production, `latest-beta.yml` for
  beta, etc.).
- **Staged rollout**: integer 0–100. The `staged_rollout` value is consumed by:
  - electron-updater's `stagingPercentage` field in `latest.yml` (AppUpdater.ts:682-703).
  - Capacitor iOS/Android: server-side gating in `release-relay/` via
    `withinRollout()` — SHA-256(deviceId + channel) bucket compares against
    the percentage, returning 404 to out-of-rollout devices. The mobile
    client (`apps/airiz-motor/mobile/src/live-update.mjs`) verifies the
    manifest's Ed25519 signature itself; @capawesome/capacitor-live-update
    v8.x's built-in `publicKey` field hard-requires PEM-encoded RSA, so
    AIRIZ verifies manually to keep one signing scheme across all 5 surfaces.
    Capawesome is still depended on for its state-management primitives
    (`setNextBundle`, channel state, `autoBlockRolledBackBundles`).
  - Cloudflare Workers Gradual Deployments uses `wrangler versions deploy
    --percentage N` (NOT the manifest field — CF controls the split
    server-side via the version router).
  - PWA / Workbox: not honored (the SW activates atomically on first visit).
- **Signing**: Ed25519 over a deterministic canonical-JSON form of the
  manifest (RFC 8785 subset — recursive key sort, no whitespace). The
  `signatures[]` field is excluded from the signed payload (matches the
  electron-updater v27 pattern: signature over manifest-with-signatures-removed).
- **Key rotation**: `signatures[]` is an array; CI can emit multiple
  signatures with different `key_id`s. electron-updater v27 supports this via
  `signatures[]` in `latest.yml`. The Cloudflare Worker should accept
  multiple public keys in `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` (semicolon-separated)
  during the rotation window.

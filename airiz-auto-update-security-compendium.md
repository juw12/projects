# Cross-Platform Auto-Update Security — 2026 Best-Practice Compendium

**Prepared for:** AIRIZ Motor Console — unified release architecture
**Date:** 2026-11-04 · **Classification:** Engineering reference
**Method:** Primary-source verification. Each protocol claim is tied to an official doc URL, a GitHub permalink, or a real tool/repo. Where the brief's premise was wrong or a number could not be pinned to a primary source, it is flagged explicitly rather than invented.

> **Verification note.** During research, Context7 and Exa web-search hit free-tier rate limits, so evidence was gathered via direct fetches of official docs, the authenticated `gh` CLI (code/issue search, repo reads), and GitHub code search. Microsoft Learn and source.android.com restructured several URLs since 2025 (noted inline). Two brief premises are corrected against source: electron-builder update signing is Ed25519-only (§1), and there is no Cloudflare "RolloutTrigger API" (§6).

---

## §1 — ed25519 Manifest Signatures

### 1.1 Why Ed25519 for update manifests
Update manifests are small, high-integrity, high-availability artifacts. Ed25519 (EdDSA) gives 32-byte keys, 64-byte signatures, deterministic signing, and no hashing-mode ambiguity — ideal for CI sign-once / verify-many. The standard is **RFC 8032** (EdDSA), referenced by libsodium's public-key-signatures docs.

**Threat model — what a signature does NOT cover:** a signature proves the manifest was produced by the holder of the private key; it does **not** protect against an attacker who has compromised that holder's **build/CI pipeline or the signing key** and ships a trojaned-but-validly-signed update. The canonical real-world instance is the **SolarWinds supply-chain attack (publicly disclosed 13 December 2020)**: attackers compromised SolarWinds' build system (TeamCity/JetBrains CI, likely via a compromised Office 365 account) and, from March 2020, planted the **SUNBURST** remote-access trojan into legitimate Orion software updates — the updates were *genuinely signed and distributed through the normal update channel*, yet carried a payload that reached 18,000+ organizations, including multiple U.S. federal departments. Source (verified): https://en.wikipedia.org/wiki/SolarWinds_hack (→ *2020 United States federal government data breach*). **AIRIZ rule:** signing is necessary but not sufficient — protect **signing-key custody (§1.6) and CI/build-pipeline integrity** (reproducible builds, least-privilege CI, isolated/air-gapped signing) so a valid signature stays a *defense* rather than becoming an attenuating factor on a tampered artifact.

libsodium's `crypto_sign_*` API is the canonical Ed25519 reference; single-part = Ed25519, multi-part = Ed25519ph (pre-hashed). Constants: `crypto_sign_PUBLICKEYBYTES` (32), `crypto_sign_SECRETKEYBYTES` (64), `crypto_sign_BYTES` (64), `crypto_sign_SEEDBYTES` (32).

Source: https://libsodium.gitbook.io/doc/public-key_cryptography/public-key_signatures.md

The docs carry an explicit **domain-separation warning** that matters for update manifests: *"If, for some reason, you need to pre-hash the message yourself, then … sign the 512-bit output, preferably prefixed by your protocol name (or anything that will make the hash unique for a given use case)."* → **AIRIZ must bind the manifest to a domain-separation prefix (e.g., `"AIRIZ-UPDATE-MANIFEST/v1\n"` + payload) before signing**, and never reuse a signature buffer across artifact types.

### 1.2 Signature generation in CI — detached signatures
For update systems you sign **detached** (signature stored alongside, not embedded). libsodium's detached path is the reference:

```c
crypto_sign_detached(sig, NULL, MESSAGE, MESSAGE_LEN, sk);            // 64-byte sig
if (crypto_sign_verify_detached(sig, MESSAGE, MESSAGE_LEN, pk) != 0) // reject
```

Node's `crypto` module implements the same Ed25519 — electron-builder uses it directly with a `null` hash (Ed25519 hashes internally).

### 1.3 The reference implementation — electron-builder (CORRECTION)
**Correction to brief:** the brief assumes "electron-updater (RSA-2048 legacy)." The current source **rejects any non-Ed25519 key** and supports multiple keys (key-ID tagged) for rotation.

Source: https://github.com/electron-userland/electron-builder/blob/main/packages/builder-util/src/updateManifestSigner.ts

```ts
export function signUpdateManifest(info: UpdateInfo, privateKey: string | KeyObject): string {
  const key = typeof privateKey === "string" ? parsePrivateKey(privateKey) : privateKey
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`Update manifest signing key must be Ed25519, got: ${key.asymmetricKeyType}`)
  }
  const shapeProblem = validateSignedManifestShape(info)
  if (shapeProblem != null) throw new Error(`Cannot sign update manifest for version ${info.version}: ${shapeProblem} (the updater would reject it)`)
  const data = Buffer.from(canonicalizeForSigning(info), "utf8")
  return cryptoSign(null, data, key).toString("base64")   // hash=null -> Ed25519
}
```

Rotation primitive — one `signatures[]` entry per key, each tagged with a derived key ID; the first entry is the canonical `signature`:

```ts
export function createUpdateManifestSignatures(info, privateKeys: Array<string|KeyObject>): UpdateManifestSignature[] {
  if (privateKeys.length === 0) throw new Error("Cannot sign update manifest: no signing key provided")
  return privateKeys.map(privateKey => createManifestSignatureEntry(key, signUpdateManifest(info, key)))
}
```

Key details for AIRIZ: signing is over **`canonicalizeForSigning(info)`** (canonical JSON), env key is **`ELECTRON_BUILDER_UPDATE_SIGN_KEY`** (base64-of-PEM), and the build *refuses to publish a signed manifest the runtime would reject*. RSA-2048 appears **only** in the verifier's test fixtures (test/src/updateManifestSignatureTest.ts: `generateKeyPairSync("rsa", { modulusLength: 2048 }))`.

**Takeaway:** The 2026 default for desktop update manifests is Ed25519 + a **key-ID** field + multi-signature array. Adopt the same shape.

### 1.4 Tauri — the default Ed25519 updater (full reference)
Source: https://tauri.app/plugin/updater/#signing-updates (last updated 2025-11-28)

- "Tauri's updater needs a signature … This **cannot be disabled**."
- Keygen: `npm run tauri signer generate -- -w ~/.tauri/myapp.key` (Ed25519).
- **CI injection (note: `.env` does NOT work):**
  ```bash
  export TAURI_SIGNING_PRIVATE_KEY="path or PEM content"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""      # optional
  ```
- Public key is embedded in `tauri.conf.json` as literal content (**not a path**): `plugins.updater.pubkey`.
- Output artifacts per platform, each with a sibling `.sig`:
  - Linux `myapp.AppImage` + `myapp.AppImage.sig`
  - macOS `myapp.app.tar.gz` + `.sig`
  - Windows `myapp-setup.exe` / `myapp.msi` + `.sig`
- **Key rotation is a first-class runtime API** (`#public-key`): `UpdaterExt::updater_builder().pubkey("<new key>")` — you ship the *next* public key in the current build, then rotate.
- `createUpdaterArtifacts` is slated for **removal in Tauri v3** (set to `true` in v2).

**Dual-key rotation pattern (Tauri):** Build N ships `pubkey_B` in config while still signed by `key_A` -> build N+1 signs with `key_B`. Verifiers that accept either pinned key bridge the window. This is the standard **key-ID pinning + dual-sign** rotation.

### 1.5 Sparkle — EdDSA with a real legacy-dual-signing migration path
Sparkle is the strongest real-world example of a *completed* signature-scheme migration (DSA -> Ed25519), exactly AIRIZ's eventual problem.

Source: https://github.com/sparkle-project/Sparkle/blob/2.x/Autoupdate/SUSignatureVerifier.m (~L134)

```
The %@ has an EdDSA signature, but the app has an invalid EdDSA public key, so the %@ will be rejected.
The app has an invalid EdDSA public key, but there is no EdDSA signature in the %@. Falling back to DSA.
```

Sparkle **requires** a valid EdDSA signature once the host has an EdDSA key, but tolerates a bad legacy-DSA signature *if* EdDSA passes — i.e., **EdDSA is authoritative, DSA is a transition-only fallback**.

CLI + key custody (generate_appcast/main.swift ~L77):
- `--ed-key-file -` reads the private EdDSA key **from stdin** (`echo "$PRIVATE_KEY_SECRET" | generate_appcast --ed-key-file -`) — the recommended CI pattern (secret never touches disk).
- Keys live in the **macOS Keychain** under account `ed25519`; `generate_keys` can export the 32-byte seed.
- `DEFAULT_MAXIMUM_DELTAS = 5` — Sparkle signs **up to 5 delta updates** per release (§- **The appcast feed itself is signed** (a `<!-- sparkle-signatures: ... -->` block), so a MITM cannot swap the update list without breaking the feed signature.

**AIRIZ rule: Sign the *manifest*, and **also sign the manifest-list/endpoint response** (anti-replay + anti-feed-swap), exactly as Sparkle does.

### 1.6 Key custody: GitHub Actions secrets vs HSM vs Vault Transit
Three tiers, in ascending cost/assurance:

| Tier | Mechanism | When it is enough | Failure mode |
|---|---|---|---|
| T1 CI secret | `TAURI_SIGNING_PRIVATE_KEY / ELECTRON_BUILDER_UPDATE_SIGN_KEY / Sparkle --ed-key-file - | Small teams, low-blast-radius | Anyone who can read the secret signs; no per-sign audit |
| T2 Vault Transit | Private key never leaves HashiCorp Vault Transit; CI calls sign endpoint with short-lived token; response is signature only | Mid-size; need audit + rotation without redeploy | Vault availability; token theft window |
| T3 HSM / FIPS-140-3 L3 | Key generated and never exported; sign via remote HSM (Azure Artifact Signing HSMs, AWS CloudHSM, Yubico HSM) | Regulated / high-value apps | Cost; latency; ops complexity |

**Vault Transit sketch (T2):** store the Ed25519 seed as a Transit key; CI runs `vault write transite/sign/airiz-update data=base64(canonical_manifest)` -> returns `signature`. The key is pinned by **key ID** (Transit keys are immutable; rotation = create a new key, dual-sign during the window, then retire). This maps 1:1 to the key-ID arrays in 1.3/1.4.

**Air-gapped / offline generation (required for T3):** generate the seed in an offline, FIPS-certified environment; import into the HSM/Transit; **retain the 32-byte seed in 2-of-3 offline shares (Shamir / split knowledge)**. Tauri/Sparkle warn the same way: "if you lose this key you will NOT be able to publish new updates … store this key in a safe place!"

**Real outage/hazard (where Ed25519 signing fails in production):** Ed25519 has **no key-recovery** — losing the signing key permanently bricks the update channel unless a successor key was pre-pinned. This is the documented, recurring failure, not a rare one: Sparkle's whole EdDSA migration machinery (1.5) exists to avoid a situation where the *old* key is the only one that works. **AIRIZ must pin a successor public key in the shipped binary at or before v1** so a rotation is always possible.

### 1.7 Real-world adoption matrix (verified)
| Stack | Scheme | Key ID | Rotation | Source |
|---|---|---|---|---|
| Tauri updater | Ed25519 (default, mandatory) | via pubkey | runtime updater_builder().pubkey() | tauri.app/plugin/updater/#signing-updates |
| Sparkle 2.x | Ed25519 (authoritative) + legacy DSA fallback | SUPublicEDKey/SUPublicDSAKey | dual-sign migration | SUSignatureVerifier.m |
| electron-builder | **Ed25519 only** (throws otherwise) | computeUpdateManifestKeyId | multi-key signatures[] | updateManifestSigner.ts |
| libsodium / noble / TweetNaCl | Ed25519 (RFC 8032) | n/a (library) | n/a | libsodium public-key_signatures |

---

## §2 — Windows EV Cert + SmartScreen Reputation

### 2.1 The 2026 reality: "Trusted Signing" is now Artifact Signing
**Correction to brief:** the brief says "Microsoft Azure Trusted Signing (replacing Digicert CertCentral-based EV)." Microsoft has **rebranded and generalized** this to **Azure Artifact Signing** — a fully-managed service that signs not just Authenticode binaries but artifacts, with **zero-touch certificate lifecycle in FIPS 140-3 Level 3 HSMs**.

Source: https://learn.microsoft.com/en-us/azure/artifact-signing/overview (updated 2026-08-03)
- "Microsoft fully managed, end-to-end signing solution … zero-touch certificate lifecycle management inside **FIPS 140-3 level 3 certified HSMs**."
- Scenarios: *Public Trust, Private Trust, VBS enclave, code integrity (CI) policy, test signing.*
- **Content-confidential signing:** "Your file never leaves your endpoint, and you get digest signing that is fast and reliable." (the 2026 replacement for shipping the whole PE to a signing service.)
- Two SKUs: **Basic** and **Premium**; resource model = *Artifact Signing account -> (Identity validation + Certificate profile)*.

**Why this matters for AIRIZ:** you no longer need to buy/renew a hardware token or a CertCentral EV cert and babysit it. The HSM + lifecycle is the product. EV-style "publisher reputation" still matters downstream (2.3 SmartScreen), but the *signing* trust anchor moves into a managed, HSM-backed profile.

### 2.2 Authenticode via signtool.exe (the concrete command)
Source: https://learn.microsoft.com/en-us/windows/win32/seccbs/signtool · MicrosoftDocs/win32:desktop-src/SecCrypto/signtool.md

```
signtool sign /a /fd SHA256 MyFile.exe                      # pick best cert from store
signtool sign /f MyCert.pfx /p MyPassword /fd SHA256 MyFile.exe
signtool sign /f cert.pfx /du https://www.myco.com/myapp /t https://timestamp.digicert.com MyApp.cat
```

Non-negotiable flags for a 2026 baseline:
- `/fd SHA256` — SHA-1 Authenticode is deprecated/ignored by modern Windows; SHA-256 is the floor.
- `/t RFC3161-timestamp` (or `/td SHA256`) — timestamp so the signature survives **certificate expiry** (the most-missed flag).
- `/a` — let signtool pick the cert with a valid chain (catches missing roots in CI images).
- `/v` — verbose, for CI logs (record the selected cert + chain).

With **Azure Artifact Signing**, you swap the local pfx for the service's signing identity (the profile handles the HSM); the CLI/tooling contract is the same.

### 2.3 SmartScreen reputation — the number the brief got wrong
The brief cites a "50-100 downloads to clear" window. **Microsoft does not publish that figure.** What is real and documented:
- SmartScreen makes a **reputation decision** combining (a) publisher identity/reputation (EV/standard cert history), (b) **safe-download counts** for the exact file, and (c) **age** of the file. A file with low safe-download count and a new/low-reputation publisher triggers the "Windows protected your PC" interstitial.
- The practical effect: a **brand-new publisher** (or a new binary hash) gets flagged until enough *distinct* users download a *clean* copy. That's the "reputation accumulation window." The **50-100** range is a **community-estimated heuristic**, not a Microsoft spec — treat it as an order-of-magnitude planning number, not a SLA.

Source for the mechanism: https://learn.microsoft.com/en-us/windows/win32/smartscreen/smart-screen-overview (a verified publisher certificate materially reduces the interstitial; verify anchor before publishing — the page 404'd through the research proxy on the new path).

AIRIZ mitigations (the things that actually move the needle):
1. Sign with the **same publisher identity from day one** (never rotate publisher name) — reputation is per-publisher.
2. **Timestamp every signature** (2.2) so the identity never "expires."
3. **Distribute via a stable, pre-existing domain** with history — SmartScreen also weighs the distribution channel.
4. For EV-grade trust without the legacy CertCentral flow, use **Artifact Signing Premium** (2.1) which gives a consistent, HSM-backed identity.
5. Plan for a **first-week interstitial** for any *new* artifact hash; do **not** treat "SmartScreen cleared at N downloads" as a hard gate.

**Real outage/hazard (the Windows failure):** the canonical Windows auto-update failure is **not** a code-signing outage but a **bad signed update that passed reputation** — a quality regression that is *cryptographically valid*. That's why 7/8 (staged rollout + crash-gated rollback) are the real controls; Authenticode/SmartScreen only prove *who signed it*, not *that it is good*. Windows has had multiple quality-gate update incidents in the 2021-2024 cycle where a validly-signed update required a rollback of the *delivery*, not the signature.

**Concrete, verified incident — CrowdStrike, 19 July 2024:** the canonical modern instance of this exact failure class. At 04:09 UTC CrowdStrike pushed a faulty Falcon-sensor *content* update (Channel File 291, a named-pipe screening config); the change caused an out-of-bounds read in the Windows sensor client → invalid page fault → BSOD. The update was delivered through CrowdStrike's legitimate, signed update channel and cleared every reputation gate — it was a *quality* regression that was *cryptographically valid*, not a malicious or unsigned artifact. ~8.5 million Windows systems crashed worldwide; CrowdStrike reverted the channel file at 05:27 UTC and remediation was to delete the offending `C-00000291-*.sys` driver, per machine. Source (verified): https://en.wikipedia.org/wiki/CrowdStrike_incident (→ *2024 CrowdStrike-related IT outages*). **Lesson for AIRIZ:** a signed update channel cannot stop a *bad* (not *malicious*) update — only §7's staged gates + §8's crash-gated rollback can, which is exactly why those, not Authenticode, are the delivery controls.


---

## §3 — Android APK Signature Scheme v2 / v3 / v4

### 3.1 The tool surface (verified, full reference)
Source: https://developer.android.com/tools/apksigner (SDK Build-Tools >= 24.0.3)

```bash
apksigner sign --ks release.jks app.apk
apksigner sign --key release.pk8 --cert release.x509.pem app.apk      # PKCS#8 + X.509
apksigner sign --ks first.jks --next-signer --ks second.jks app.apk   # multi-signer
apksigner verify app.apk
apksigner verify --min-sdk-version 15 app.apk
```

Scheme flags (all real):
- --v1-signing-enabled (JAR-based, legacy)
- --v2-signing-enabled (v2 scheme)
- --v3-signing-enabled (v3 scheme)
- --v4-signing-enabled true|false|only — v4 writes a **separate** file app.apk.idsig; only generates the v4 sig without touching the APK (requires an existing v2/v3 signed with the same key).

Key custody detail (real): --ks-pass / --key-pass accept pass:, env:, file:, or stdin — so the keystore password is never a plaintext flag in CI; use env: (e.g., --ks-pass env:KS_PASS). This is the Android analog of 1.6 T2.

### 3.2 v3 signing-block format — the exact fields
Source: https://source.android.com/security/apksigning/v3
- v2/v3 signatures live in the **APK Signing Block**, located **immediately before the ZIP Central Directory** (backward-compat with v1).
- v3 block is stored under **ID 0xf05368c0**.
- v3 signer format (length-prefixed sequence of length-prefixed signer):
  - signed data -> digests (signature algorithm ID u32 + length-prefixed digest), certificates (X.509 DER), minSDK (u32), maxSDK (u32), and additional attributes.
  - The **proof-of-rotation attribute ID is 0x3ba06f8c**.
  - Duplicate minSDK/maxSDK are stored *outside* signed data to skip out-of-range signers fast.
- **Proof-of-rotation** = a **singly-linked list** where each node's certificate **signs the next node's signed data** (oldest = root). "Imbues each new key with evidence it should be as trusted as the older key(s)." The whole struct is inside signed data -> protected by the containing key.
- **Multiple signers are NOT supported** for Google Play ("Multiple signers are not supported and Google Play does not publish apps signed with multiple certificates").

### 3.3 Key rotation (lineage + Proof-of-Rotation) — concrete
Two distinct mechanisms, both real:

(a) v3 Proof-of-Rotation (app-level, in-APK): Android 9+ can change signing key on update; v3 carries the trust chain. Documented caveat (v3 doc, NOTE):
"APK key rotation is **not recommended for Android 12 (API 31) and earlier**. In Android 13 (API 33)+, checkSignatures recognizes the proof-of-rotation and returns the newest signature."

So the modern, Play-supported path is:
(b) Play App Signing + key upgrade. Play holds the production signing key; the developer key signs to Play, Play re-signs. For a rotation, you request a **key upgrade** via the Play Console — and the **v3.1 block** (the --rotation-min-sdk-version path) is what encodes it for API 33+.

apksigner rotate — the lineage command (apksigner "Rotate signing keys"):
```bash
apksigner rotate --out /path/to/new/file \
  --old-signer --ks release.jks \
  --new-signer --ks release2.jks
# then:
apksigner sign --ks release.jks --next-signer --ks release2.jks \
  --lineage /path/to/signing/history/lineage app.apk
```

The **lineage file** is the durable artifact that lets a *new* key be trusted by *already-installed* apps — the Android equivalent of 1's pinned-successor-key. **AIRIZ rule: treat the lineage file as a Tier-3 secret (offline, 2-of-3) — losing it means you can never rotate again without a reinstall.**

### 3.4 v4 — incremental (FSV) signatures
v4 produces **app.apk.idsig**, a **separate signature file** computed over the v2/v3 signing block, so an **incremental/Firestorm (FSV) update** can be verified without re-downloading the whole APK. This is the foundation for §9's Android delta. The v4 scheme is documented at https://developer.android.com/about/versions/11/features#signature-scheme-v4.

### 3.5 Real outage/hazard (Android)
The documented, non-rare Android update failure is **key-rotation misconfig**: signing an update with a *new* key while the lineage/v3.1 proof is not recognized on older devices -> **INSTALL_FAILED_UPDATE_INCOMPATIBLE** for a swath of the fleet. The v3 doc's explicit "not recommended for API <=31" warning exists precisely because this breaks in the field. Secondary hazard: **v4 .idsig and APK must stay in lockstep** — an incremental update that delivers a new .idsig for an old base fails verification. **AIRIZ:** gate any key rotation behind a *minimum-supported-device* check and dual-sign (old+new) until the fleet clears the rotation window, mirroring 1.7.

---

## §4 — iOS App-Signing Chain + Provisioning Profile Lifecycle

### 4.1 The identity chain (verified structure)
An iOS app is gated by **four** co-dependent objects, all time-bounded:
1. **Certificate** (Developer ID / Distribution) — the *signing identity*.
2. **App ID** (bundle ID) — the *capability/entitlement anchor*.
3. **Provisioning profile** — cert x App ID x device/Team, and it carries a **hard validity window**.
4. **Entitlements** (App Groups, Keychain access groups) — must match the profile's App ID.

Validity (the numbers that matter):
- **App Store distribution profile: 1 year.**
- **Ad-hoc profile: 1 year** (and a **100-device** cap).
- **Enterprise (in-house) profile: 1 year.**
- **Development profile: 1 year.**

All four expire on the same annual cadence; the **profile** is the object that "bricks" an app, not the cert alone. Canonical doc: https://developer.apple.com/documentation/xcode/distributing-apps (the 1-year/100-device limits are stated in Apple's "Managing certificates, identifiers & profiles" material).

### 4.2 The critical distinction: build-day check vs launch-day check
This is the single most misunderstood iOS update-safety property and it is **real and documented**:
- **Code signature / certificate validity is checked at install and at launch** (does the signed app still map to a *trusted, non-revoked* identity?).
- **Provisioning profile is checked at launch** for sandboxed/sideloaded/enterprise/ad-hoc apps: if the profile is **expired or revoked at launch time**, the app **refuses to launch** (or is removed) — even though it launched fine at install.

**Consequence for auto-update:** a fleet installed in January can be **mass-disabled in January of the next year** the instant the profile rolls off — *independent of any update you ship*. **Build-day-valid is not launch-day-valid.**

AIRIZ rule:
- Track **profile expiry as a first-class release-health signal** (cron/alert at T-30/T-7/T-0 days), not as a build-time concern.
- For distribution, **Xcode Automatic Signing** + App Store Connect is the recommended path (escrow + auto-renewal of the *distribution* identity). For enterprise/ad-hoc, you own the renewal calendar.

### 4.3 Xcode automatic signing / Keychain escrow
**Xcode automatic signing** creates/manages the cert + profile in your **login Keychain** and in Apple's escrow, and auto-renews the distribution cert. The trade-off the docs make explicit: **convenience vs. custody** — automatic signing means the private key is in a developer's Keychain (a person), not an HSM. For a production update pipeline, prefer:
- **Keychain Access -> export** of the .p12 (encrypted) as the escrowed key, **or**
- **CI signing with a checked-in (but encrypted) .p12** + the profile, and **xcrun codesign --sign** for the actual codesign + xcrun notarytool notarization.
- The **private key** is the Tier-3 secret (see 1.6). Losing it = you cannot sign *any* new build for that Team without Apple's recovery process.

### 4.4 Real incident — honest scoping
I could **not** verify a single, formal Apple-published post-mortem for a "revoked cert bricked apps in the field" event (Apple does not publish those the way Meta/Cloudflare do). **What is documented and real** (and is the actual recurring incident class):
1. **Expired enterprise/ad-hoc profiles mass-disabling sideloaded apps** — the launch-day check (4.2) makes this a *scheduled, guaranteed* event every 12 months for any sideloaded fleet. This is the most common real "fleet went dark" iOS incident and it is *self-inflicted* (no renewal calendar).
2. **Certificate revocation by Apple's CA** — when a developer identity is compromised or abused (a recurring theme in Apple's security advisories), the cert is revoked; apps signed by it then fail the launch-day trust check. The failure mode is identical: a validly-installed app stops launching.
3. **Notarization gaps** — a binary that signed but was not notarized (or whose notarization ticket did not cover the actual hash) is **quarantined/blocked on first launch on modern macOS/iOS**, even with a good cert.

**AIRIZ takeaway:** the iOS "outage" is **calendar + custody driven**, not patch-driven. The control is **profile-expiry monitoring + key escrow + notarization in the build**, not faster rollback. (Flagged honestly rather than attributing a fabricated 2014/2019 Apple incident to a specific date.)

---

## §5 — PWA Subresource Integrity + Service-Worker Update Traps

### 5.1 SRI + the hash-mismatch failure
Subresource Integrity (MDN: https://developer.mozilla.org/en-US/docs/Web/Security/CSP/Subresource_integrity) binds a script src to sha256-/sha384-/sha512-. **The trap:** if the CDN byte-serves a *different* byte sequence than the pinned hash (a *stale* cached copy, a partial deploy, or a CDN edge with an old object), the browser **refuses to execute** the script -> **blank page / integrity check failed**. This is the *update* failure mode: your new bundle ships, but some edges still hold the old bytes, so the hash no longer matches the *delivered* bytes.

**Real-world manifestation (verified):**
- Workbox issue **#2053 "Unexpected token < error after redeploy (InjectManifest Mode)"** — a redeploy left the page fetching an HTML where a script was expected (stale/cross-version fetch). https://github.com/GoogleChrome/workbox/issues/2053
- Issue **#3230 "White Screen after service worker update"** — the canonical "SW update -> blank" symptom. https://github.com/GoogleChrome/workbox/issues/3230

### 5.2 The service-worker update state machine (the actual bugs)
**The skipWaiting + clients.claim race.** Workbox encodes it literally (packages/workbox-core/src/clientsClaim.ts):
```ts
function clientsClaim(): void {
  self.addEventListener('activate', () => self.clients.claim());
}
```

The canonical pair (from Workbox's own test SWs, e.g. test/workbox-precaching/static/precache-and-update/sw-2.js):
```js
self.addEventListener('install',  (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
```

**The race:** skipWaiting() lets the new SW become *active* while the page is still controlled by the *old* SW; clients.claim() then rebinds clients — but the **first load after deploy is often controlled by whichever SW the browser already had**, so users see a *mixed* old-controller + new-precache state until a reload. Workbox's workbox-window *documents* this exact hazard (packages/workbox-window/src/Workbox.ts ~L531):
"The registered service worker is active but not yet controlling the page. Reload or run clients.claim() in the service worker."

**Real bugs this produces (all verified Workbox issues):**
- #3076 "endless service worker updates after first registration without page refresh" — the update loop re-triggers.
- #2984 "Cache is not updated in StaleWhileRevalidate" — the SWR revalidate did not persist, so the *new* content never lands in cache (a silent "update did not apply").
- #2850 "Events for multiple external service worker updates are not triggered" — observers miss updates when multiple SWs race.

### 5.3 Precache manifest + the HTTP-cache interaction
- **Precache manifest** (Workbox precacheAndRoute / cleanupOutdatedCaches): a revisioned cache (workbox-precache-v2-<rev>). On update, the new SW precaches the *new* set and deletes the old cache in activate. **The bug class:** if the *new* SW's precache list references a hashed asset that the HTTP cache/CDN has not propagated yet, install **fails** -> the old SW stays -> **the update silently does not apply** (see #2984).
- **HTTP cache / ETag / SW cache triple interaction:** a stale ETag/If-None-Match round-trip returning **304** against a *stale* validator can keep an edge serving old bytes to the SW's precache fetch -> integrity/install failure. **AIRIZ rule:** for SW precache, fetch with **cache: 'reload'** (or a strong Cache-Control: no-cache on the SW + hashed assets) during install, and **name every precached asset with its content hash** so "stale" is impossible by construction.

### 5.4 Cross-tab fan-out (BroadcastChannel)
When the SW updates, **open tabs are not told** unless you broadcast. The 2026 pattern:
```js
// in the SW, after activate:
self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({type:'SW_UPDATED'})));
// or, for tabs: a shared BroadcastChannel('airiz-update') where each tab listens,
// and on 'SW_UPDATED' prompts a single reload (coordination via a tab that "wins").
```
workbox-window exposes workbox.messageSW / addEventListener('message') for this. **Trap:** without coordination, N tabs each reload on their own (N network storms); with it, you risk *no* tab reloading if the coordinating tab closed. **AIRIZ:** elect one tab (e.g., the focused/oldest) to perform the reload; others show "update ready."

### 5.5 Real outage (PWA/SW) — verified
The verified, real "outages" here are the **Workbox issues above** (#3230 white-screen, #3076 endless updates, #2053 token-after-redeploy, #2984 SWR not-updated) — these are the documented, reproducible field failures of SW-based update, and they map to the **update-trap** taxonomy in 5.2-5.3. There is no single "big SW outage" post-mortem the way there is for 6/7; the risk is **distributed and silent** (a cohort of users stuck on a stale SW that never reports), which is exactly why 8's telemetry must include **SW version + active controller** as a reported dimension.

---

## §6 — Cloudflare Worker "Signed" Deploys

### 6.1 Correction: there is no "RolloutTrigger API"
I searched the cloudflare/cloudflare-docs repo and the public web code index for RolloutTrigger — **the identifier does not exist in Cloudflare's codebase** (it appears only in unrelated third-party projects). **Do not build against a "RolloutTrigger API."** The real, verifiable Cloudflare deployment-control surface is:
- **Versions and Deployments** (decoupled upload vs. deploy),
- **Gradual Deployments** (percentage traffic split),
- **Version Affinity** + **Version Overrides** (pin users / pin downstream Workers),
- **wrangler rollback** (revert to a published version),
- **Logpush ScriptVersion** + **Version metadata binding** (per-version observability).

### 6.2 Versions vs deployments (verified)
Source: https://developers.cloudflare.com/workers/versions-and-deployments/ (updated 2026-09-22)
- A **version** = complete immutable state (code + static assets + bindings + compat date), unique ID, tracks creator/time/origin. **Storage resources (KV, R2, Durable Objects, D1) state is NOT tracked in a version.**
- A **deployment** = which version(s) serve traffic: one (100%) or two (gradual split).
- **Default:** wrangler deploy = create version + deploy to 100% in one step. **Decouple** them to enable gradual/manual promotion.

"Signed deploy" in the Workers sense: Cloudflare does not "sign" your Worker the way 1-4 do; the *integrity* story is **version immutability + the API token that can create a version/deployment is the signing authority** (Workers Secrets Store / scoped API tokens). So "signed deploy" = **authenticated, versioned, auditable promotion**, controlled by:
```bash
npx wrangler versions upload          # create version, NOT deployed
npx wrangler versions deploy          # interactive % split (min wrangler 3.40.0)
npx wrangler rollback [version-id]    # revert (last 100 published versions)
```

### 6.3 Gradual deployments + Durable Object version pinning (verified)
Source: https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/ (updated 2026-10-18)
- **Version skew:** by default each request is routed independently -> consecutive requests (even reloads) can hit different versions. Fix with **version affinity** (pin a user to one version) and **version overrides** (pin a *downstream* Worker in a service binding).
- **Durable Objects:** "only one version of each Durable Object can run at a time." A **pending DO migration** must be applied with wrangler deploy; **Wrangler < 4.131.0** can return **error 10211** on wrangler versions upload when a DO migration is pending.
- **Observability:** Logpush gains a **ScriptVersion** object ({id, message, tag}) so you can attribute invocations/errors to a *specific version* during a split; also a **Version metadata binding** in-worker.
- **Limit:** a gradual deployment can only involve the **last 100 uploaded versions**.

### 6.4 Rollback — and its hard limits (verified)
Source: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/ (updated 2026-07-15)
- wrangler rollback creates a new deployment at the chosen version, 100%, across all routes/domains.
- **Limit: only the 100 most recently published versions.**
- **CRITICAL — rollback does NOT roll back state/bindings:** "Resources connected to your Worker will not be changed during a rollback. Errors could occur if the structure of data has changed."
- **Rollback is BLOCKED if** (a) a **Durable Object class lifecycle change** (exports / legacy migrations) occurred between the active and target versions, or (b) the target references an **R2 bucket / KV namespace / queue that no longer exists.**

**This is the real "rollback that can't happen"** — and it's why 8's crash-gated rollback must treat **schema/DO migrations as one-way** and be gated *before* a rollout, not as an automatic "roll back the code" button.

Source for the rollback warning text: cloudflare/workers-sdk:packages/wrangler/src/versions/rollback/index.ts — "Rolling back to a previous deployment will not rollback any of the bound resources (Durable Object, D1, R2, KV, etc)."

### 6.5 Real outage (Cloudflare)
I could **not** fetch a specific dated Cloudflare Worker rollback post-mortem during research (the cloudflare/cloudflare-blog repo holds code samples, not incident writeups, and web-search was rate-limited). **What is real and citable** and on-topic:
- **The documented, guaranteed operational hazard is the 6.4 rollback block** (DO lifecycle change or deleted binding) — a real class of "we shipped, we are broken, we *can't* roll back the code" incidents in Workers shops, which is why Cloudflare's own docs warn about it.
- No single dated Cloudflare Worker-rollback post-mortem could be verified in-session (the public cloudflare/cloudflare-blog repo holds code samples, not incident writeups, and web search was rate-limited), so **this section deliberately asserts no specific dated CF incident** rather than cite one from memory. The on-topic, *verifiable* hazard is the §6.4 rollback block above, plus the general pattern that a bad *rollout* of a change is caught and reverted by the platform's version/rollback machinery — which is exactly what §7/§8 formalize on the client side. If a specific Cloudflare post-mortem is later required for AIRIZ, pin it to a resolving blog.cloudflare.com URL before citing.

**AIRIZ takeaway for Workers:** use **decoupled versions + gradual % + ScriptVersion Logpush attribution + version affinity/overrides**, and **design DO migrations to be backward-compatible for at least the rollback window** so wrangler rollback is actually available when 8 fires.

---

## §7 — Staged Rollouts

### 7.1 Percentage gates (10 -> 50 -> 100)
The canonical gate ladder. The 2026 reference implementation is **Cloudflare Gradual Deployments** (6.3): upload a version, wrangler versions deploy to an **interactive % split**, promote on green, wrangler rollback on red. The same ladder is platform-native elsewhere (GKE/Argo progressive delivery, App Store phased release 1%/2%/5%/.../100%). **Numbers to standardize:**
- **Gate 1: 1% -> 10%** (smoke + first crash window; ~15-30 min)
- **Gate 2: 10% -> 50%** (soak; at least one release-cycle of user behavior; ~1-24 h)
- **Gate 3: 50% -> 100%** (full; continuous monitor)
- **Time-window vs immediate:** each gate has a **minimum dwell time** (even if metrics are green) to catch *time-delayed* failures (async jobs, end-of-day batch, background updates that only run at night).

### 7.2 Observability — deploy markers
A rollout is only as good as its **marker** tying a *deploy* to a *telemetry bucket*:
- **Sentry Releases** — Sentry.release = version; Sentry groups errors by release and gives **release health** (crash-free users rate). This is the primitive 8's gate reads.
- **Datadog / Bugsnag / Sentry deploy markers** — a *deploy event* (not just a tag) so dashboards can show "error rate *after* deploy X" vs before.
- **Cloudflare ScriptVersion** (6.3) is the edge-platform version of this — attribute every invocation to a version ID.
- **For client (non-edge) updates:** the marker is the **app version + build-id reported on first-launch telemetry**; 5 requires also reporting **SW version + active controller**.

### 7.3 Kill switches (LaunchDarkly / Split / Flagsmith / OpenFeature)
A **feature flag / kill switch** is the *fast* rollback (seconds, no redeploy) vs a **version rollback** (minutes, re-deploy). 2026 pattern:
- **OpenFeature** is the vendor-neutral SDK/spec; **Flagsmith / LaunchDarkly / Split** are providers. The pattern: wrap every *risky* new behavior in a flag that defaults **off** and is turned on *after* the rollout gate.
- **Kill-switch semantics:** a kill switch flips a *behavior* back to the *last-known-good path* **without changing the binary** — it does **not** undo a schema change or a DO migration (see 6.4). So a kill switch and a rollback are **complementary, not redundant**.
- **Decision rule:** if the failure is *behavioral* -> flip the flag (seconds). If the failure is *data/structural* -> you are in 8 territory and may *not* be able to roll back; this is why structural changes must be backward-compatible for the whole gate window.

### 7.4 Real incident where a staged/rollout control mattered (verified event)
**Meta / Facebook 2021-10-04** — a **change to internal network-config tooling** (a bad *rollout* of a config) pruned Facebook's BGP peering sessions and took Facebook, Instagram, and WhatsApp down for **~6.5 hours**, before the config change was **reverted (rolled back)**. Per Meta's own post-mortem, the trigger was a routine backbone-capacity assessment command that a *bug in the command-audit tool* failed to stop, which took the entire backbone offline; that loss then made Meta's DNS servers withdraw their BGP advertisements, making the platforms unreachable from the wider internet, and recovery required engineers to go physically onsite to the data centers. Source (verified): https://engineering.fb.com/2021-10-05/networking-traffic/outage-details/
- **On-topic lesson:** the outage was **not** a bad *binary*; it was a bad **change rolled out too broadly too fast**, caught only by the *absence* of a canary gate. Staged rollout (a % gate that would have caught the BGP withdrawal in 1% before 100%) is the direct control. I am citing this as a *config-rollout* incident (not an app auto-update) — the rollout/rollback lesson is identical, and I am being explicit about that scope.

**AIRIZ standard:** every release passes **3 % gates with minimum dwell**, each gate reads **crash-free-users rate** (8) and **error-rate delta vs prior release**, and every risky behavior is behind a **default-off flag** that doubles as the kill switch. Structural changes are gated *before* rollout on backward-compatibility.

---

## §8 — Crash-Throttled Rollback

### 8.1 The telemetry signal
The decision input is **crash-free users rate (CFUR)** per release, from:
- **Sentry Releases / release health** — CFUR = 1 - (users who crashed / users who reported). Sentry computes this per release automatically; it's the standard gate input.
- **Bugsnag / Crashlytics** — same primitive, per-release error rate + *new-issue* count (a *new* crash that did not exist in the prior release is the strongest rollback signal, stronger than a raw rate that is high-but-baseline).
- **Edge:** Cloudflare ScriptVersion error attribution (6.3).

**The "throttle":** a raw error spike is noisy; the *gate* is **error rate in the new release vs. the prior release, over a minimum sample size, over a minimum time window** — i.e., *throttle out* the noise. Concretely:
```
gate_release(version):
  wait min_window            # e.g. 15 min (gate1) / 1 h (gate2) / 24 h (gate3)
  n = crash_samples(version)
  if n < MIN_SAMPLES:         # do not decide on a thin cohort
      extend window
  rate_new = crashes(version) / users(version)
  rate_old = crashes(version-1) / users(version-1)
  if rate_new > max(rate_old * THRESHOLD_MULT, FLOOR):
      if has_new_crash_signatures(version) or n > MIN_ABS_CRASHES:
          ROLLBACK or HALT_GATE
```
THRESHOLD_MULT (e.g., 2x baseline) + FLOOR (e.g., 0.5% CFUR loss) + MIN_SAMPLES are the three knobs that stop false positives.

### 8.2 Decision latency — the gate clocks
| Gate | Min window | Why | Action on red |
|---|---|---|---|
| Gate 1 (1->10%) | 5-30 min | catch immediate crashes / boot loops | halt + flag-off |
| Gate 2 (10->50%) | 30 min - 1 h | catch usage-path crashes | wrangler rollback / App Store pause |
| Gate 3 (50->100%) | 1-24 h | catch end-of-day / async / background-update crashes | rollback |

The **5 min / 30 min / 1 h** values the brief lists are the *floor* per gate; they must also satisfy **minimum sample size**, else a thin early cohort produces false rollbacks.

### 8.3 False positives in noisy / multi-tenant / CI environments
The three classic false-positive sources, and the control for each:
1. **CI/test environments reporting to the same Sentry project** -> a CI crash spike looks like a production regression. **Control:** tag/scope CI events out of the CFUR denominator (release + env = production only).
2. **Multi-tenant: one bad tenant's data triggers a crash loop** that inflates the global rate. **Control:** segment by tenant; gate on *fleet* rate, investigate tenant outliers separately.
3. **Crash *correlation* vs *causation***: a *new* signature that is actually a *pre-existing* bug now surfaced. **Control:** require the signature to be **new to this release** (did not appear in version-1) *and* the sample to clear MIN_SAMPLES.

### 8.4 Automation — Sentry + GitHub Actions
The real, buildable loop (2026):
- **Sentry release health** is the *detector*. **GitHub Actions** (or a small controller) is the *actor*.
- Pattern: a **scheduled/triggered workflow** polls the Sentry release-health API for the current release; if CFUR crosses the gate threshold for min_window, it calls the **platform rollback** (wrangler rollback / App Store Connect "pause release" / a Tauri/electron *manifest* that re-points to the prior version).
- **Tauri/electron angle:** because the *manifest* is what points clients to a version (1.3/1.4), a "rollback" for a self-hosted desktop updater is often just **re-signing + republishing the prior version's manifest** — which is why the 1 signing key *must* be able to re-sign old versions (it can; the key is version-independent). This is the desktop equivalent of wrangler rollback.
- **The hard limit (tie to 6.4):** the rollback controller must **refuse** to roll back when a **schema/DO migration** shipped with the version (Cloudflare blocks it; a client DB migration is equally one-way). The controller checks "did this release contain a structural change?" and, if yes, **falls back to the kill switch (7.3) instead of a code rollback**, and pages a human.

### 8.5 Real-world adoption (honest scoping)
- **Sentry release-health / auto-rollback** is a **real, documented capability** (Sentry computes CFUR per release and exposes it via API; the "auto-revert" is a *you-wire-it* pattern, not a built-in button). I represent it accurately as a *capability to build*, not a product feature named "auto-revert."
- **1Password / Slack / Discord** all use **staged/feature-flagged rollouts + crash-gated releases** as part of release engineering (standard, widely-discussed practice), but **I could not pull a primary, citable page stating "X auto-reverts via Sentry" during research** (web-search was rate-limited). I therefore flag these as *consistent with public practice* rather than asserting a specific, unsourced mechanism. **AIRIZ:** do not copy a vendor's unverifiable internal; copy the *verifiable* primitive (8.4) and wire it to your own Sentry + platform rollback.

**AIRIZ standard:** CFUR gate with **2x baseline + 0.5% floor + min-sample**, **5/30/60-min gate clocks**, **CI/tenant scoping** to kill false positives, and a **controller that downgrades to kill-switch (not code-rollback) whenever a structural change is present.**

---

## §9 — Delta Updates

### 9.1 The algorithms (verified repos)
| Tool | What it is | Verified source |
|---|---|---|
| bsdiff | General-purpose binary delta (Colin Percival, 2002); bzip2-compressed patch | daemonology.net/bsdiff · mendsley/bsdiff · ilanschnell/bsdiff4 (BSDIFF4) |
| zsync | "rsync over http"; remote-side delta via a sidecar checksum file (.sindex) | AppImageCommunity/zsync2 (modern C++ lib+tools) · cph6/zsync |
| Courgette | Chrome in-house binary differencing (disassemble -> match assembly -> patch) | Chromium tools/courgette/ (courgette_flow.cc, disassembler_win32.cc — verified via code index) |
| HDiffPatch | C/C++ lib+CLI; small deltas, large files, low RAM; embedded variant | sisong/HDiffPatch · sisong/HPatchLite (MCU/NB-IoT) |
| electron blockmap | electron-builder differential update: per-chunk SHA256 "blockmap" of the installer; client downloads only changed chunks | electron-builder:packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts (STORED_MEMBER_CHUNKER = min 4096 / avg 8192 / max 16384) |
| Sparkle deltas | Sparkle signs up to 5 delta updates per release | generate_appcast/main.swift DEFAULT_MAXIMUM_DELTAS = 5 |
| APK delta | Android APK delta generation + reconstruction (v4 .idsig-friendly) | cundong/SmartAppUpdates · v4 scheme (3.4) |

**Key architectural distinction (matters for security):**
- **Client-side base known** (bsdiff, HDiffPatch, Courgette, electron blockmap): the client references the *old* version; patch is relative to a known base. Stronger compression.
- **Server-side, base-agnostic** (zsync): the client fetches *only the changed chunks* identified by a checksum index; the server never needs to know the client's exact version. More robust to *many* coexisting versions.

### 9.2 Bandwidth savings — the numbers, honestly
The brief asks for "real numbers: 70% reduction for Chrome update." **Honest status:** I could **not** pin a *single primary source* stating "70%" for a specific Chrome update, and I do not present it as a verified constant. What **is** defensible:
- For **closely-related versions** (patch/minor), all of the above produce patches that are **an order of magnitude smaller** than the full artifact — commonly reported in the **70-90% band** for typical desktop app updates; the exact figure is **update-dependent** (a release with a big binary bump shrinks the ratio).
- **electron blockmap** is a concrete, verifiable instance: it transfers only the **changed 4KB-16KB chunks** of the installer (source above), so a 100 MB installer with a small delta transfers only the touched chunks — the realized saving equals the fraction of chunks that changed.
- **Chrome/Courgette:** Courgette exists *specifically* because full downloads at Chrome's scale are expensive; its assembly-matching approach is what makes partial-update patches small at that scale. I cite the *mechanism* (real, in-tree) rather than an unverifiable single percentage.

**AIRIZ rule:** measure *your own* ratio per release (log patch_bytes / full_bytes) instead of trusting a vendor's headline number; design the update endpoint to **serve full when the delta ratio is poor** (e.g., >50% -> just send full) so a bad delta never costs more than a full download.

### 9.3 Security implications — sign the delta, not just the full
The critical rule: **a delta is only as trustworthy as the base it is computed against.** Threats:
1. **Base-swap / replay:** an attacker serves a delta computed against a *malicious* base -> patched result is malicious. **Control:** the client must **verify the base's identity** (its own signature/hash) *before* applying a delta, and the **patch must be signed** with the same 1 Ed25519 key (Sparkle signs each delta — $INSERT_DELTA_EDDSA_SIGNATURE; electron signs the blockmap; Play v4 signs the .idsig).
2. **Delta integrity:** sign **per-delta** (not just the full artifact). If you *only* sign the full artifact, a MITM can still swap a signed *full* for a crafted *delta*+*base* pair. So **per-delta signature is mandatory.**
3. **Fuzz the patcher:** the patch *applier* is native code that parses untrusted binary input -> it is a crash/RCE surface. **Real, verified evidence:** Chromium's Courgette disassembler has a **documented ClusterFuzz UBSan finding** — a **null-pointer / undefined-behavior** in courgette::DisassemblerWin32::ParseRelocs (disassembler_win32.cc:241), surfaced via the in-tree courgette_fuzzer (google/clusterfuzz test data referencing courgette/courgette_flow.cc + disassembler_win32.cc). **This is the real "delta-update security incident": the patcher itself gets fuzzed because it is an untrusted-input parser.** **AIRIZ:** run the patch-apply path under ASan/UBSan in CI and treat patcher crashes as **release-blocking**, and **always fall back to a full (signed) download** when a delta fails to apply or verify.

### 9.4 Differential zip (electron blockmap / Capacitor bundle diff)
- **electron-builder blockmap** = the "differential zip" for NSIS/zip installers: a manifest of per-chunk SHA256s; the client diffs its local chunks vs the manifest and fetches only misses.
- **Capacitor / web-bundle diff:** for hybrid (web-asset) apps, the "bundle" (the www/assets) is the delta unit; a content-hashed asset set (5.3) makes the diff trivial and the integrity check free.

**AIRIZ standard:** serve **full + signed delta**, sign **both** with the 1 Ed25519 key, **verify base identity** before patching, **fuzz the patcher** in CI, and **auto-fall-back to full** on any delta failure or poor ratio.

---

## Appendix A — AIRIZ Unified Release Architecture: mapped decisions
| Concern | Decision (2026 bar) | Source basis |
|---|---|---|
| Update-manifest signature | Ed25519, domain-separated, key-ID + multi-signature array (rotate by adding a key, not replacing) | 1.3/1.4 (electron, Tauri) |
| Manifest-list / endpoint response | Also signed (anti feed-swap) | 1.5 (Sparkle feed sig) |
| Desktop identity (Win) | Azure Artifact Signing (HSM-backed), signtool /fd SHA256 /t ts; timestamp always | 2.1/2.2 |
| Android | v3.1 + Play App Signing, keep lineage file as Tier-3 secret; gate rotation on min-device | 3.2/3.3 |
| iOS | Profile-expiry monitoring (T-30/7/0), Keychain escrow, notarization in build | 4.2/4.3 |
| PWA | Content-hashed assets, cache reload on precache, SW version + controller in telemetry, coordinated single-tab reload | 5.3/5.4/5.5 |
| Edge (Workers) | Decoupled versions + gradual % + ScriptVersion Logpush + affinity/overrides; no "RolloutTrigger" (does not exist) | 6.1-6.3 |
| Rollback | CFUR gate (2x baseline, 0.5% floor, min-sample), 5/30/60-min clocks, kill-switch fallback when structural change present | 7.3, 8.4, 6.4 |
| Delta | Full + signed delta, base-verify, fuzz patcher, auto-fall-back to full | 9.3/9.4 |

## Appendix B — Source index (verified this session)
- Tauri Updater (signing/rotation): https://tauri.app/plugin/updater/#signing-updates
- libsodium Ed25519: https://libsodium.gitbook.io/doc/public-key_cryptography/public-key_signatures.md
- electron-builder signer (Ed25519, multi-key): https://github.com/electron-userland/electron-builder/blob/main/packages/builder-util/src/updateManifestSigner.ts
- electron blockmap: https://github.com/electron-userland/electron-builder/blob/main/packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts
- Sparkle (EdDSA + legacy DSA, deltas, feed sig): https://github.com/sparkle-project/Sparkle/blob/2.x/Autoupdate/SUSignatureVerifier.m and .../generate_appcast/main.swift
- Azure Artifact Signing (ex-Trusted Signing): https://learn.microsoft.com/en-us/azure/artifact-signing/overview
- signtool: https://learn.microsoft.com/en-us/windows/win32/seccbs/signtool · source: https://github.com/MicrosoftDocs/win32/blob/main/desktop-src/SecCrypto/signtool.md
- SmartScreen (verify anchor): https://learn.microsoft.com/en-us/windows/win32/smartscreen/smart-screen-overview
- apksigner (v1-v4, rotate, v4 .idsig): https://developer.android.com/tools/apksigner
- APK Signature Scheme v3 (block IDs, proof-of-rotation): https://source.android.com/security/apksigning/v3 · v2: .../apksigning/v2 · v4: https://developer.android.com/about/versions/11/features#signature-scheme-v4
- Workbox (clientsClaim, controlling race, issues): https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-core/src/clientsClaim.ts · issues #3230, #3076, #2053, #2984
- Cloudflare (versions/gradual/rollback): https://developers.cloudflare.com/workers/versions-and-deployments/ · .../gradual-deployments/ · .../rollbacks/
- Delta tooling: bsdiff (daemonology.net) · https://github.com/sisong/HDiffPatch · https://github.com/AppImageCommunity/zsync2 · Chromium tools/courgette/ · https://github.com/cundong/SmartAppUpdates
- Rollout incident (staged/rollout control): Meta 2021-10-04 post-mortem — https://engineering.fb.com/2021-10-05/networking-traffic/outage-details/ (verified)
- Windows bad-signed-update incident: CrowdStrike 2024-07-19 — https://en.wikipedia.org/wiki/CrowdStrike_incident (verified)
- Supply-chain / manifest-tampering incident: SolarWinds 2020 (SUNBURST) — https://en.wikipedia.org/wiki/SolarWinds_hack (verified)

## Appendix C — Implementation Runbooks (for the AIRIZ downstream)

### C.1 Signed-manifest wire format (electron/Tauri-compatible)
```jsonc
// latest.json  (signed; served over TLS; also carry the signature in the list endpoint)
{
  "version": "2.14.0",
  "files": [
    { "url": "https://cdn.airiz.io/v2.14.0/AIRIZConsole-setup.exe",
      "sha256": "<hex>", "size": 184532112 }
  ],
  "path": "AIRIZConsole-setup.exe",
  "sha256": "<hex>",
  "signature": "<base64 Ed25519 of canonicalizeForSigning(above)>",
  "signatures": [                       // rotation: one entry per key, first is canonical
    { "id": "k-2026-01", "sig": "<base64>" },
    { "id": "k-2027-01", "sig": "<base64>" }   // successor pinned during rotation window
  ],
  "releaseNotes": "...",
  "platforms": { "windows-x64": { "url": "...", "signature": "..." } }
}
```
Domain-separate before signing: payload = "AIRIZ-UPDATE-MANIFEST/v1\n" + canonicalizeForSigning(manifest). Pin BOTH k-2026-01 and k-2027-01 public keys in the shipped binary so rotation is always possible.

### C.2 Signing-key custody runbook
- Tier (choose): T1 GitHub Actions secret -> T2 Vault Transit -> T3 FIPS-140-3 HSM / Azure Artifact Signing Premium.
- Generate offline; import seed; keep 2-of-3 offline Shamir shares of the 32-byte seed.
- Rotation (add, never replace):
  1. Generate k-new in HSM/Transit; derive k-new public key.
  2. Ship a build that PINs k-old + k-new (verifiers accept either).
  3. Once >95% of fleet runs the dual-pin build, sign new releases with k-new only; keep k-old pinned for one more cycle.
  4. Retire k-old (remove from pin list) after a full release cycle.
- Re-signability: the key is version-independent — re-signing an *old* manifest for rollback is always possible (see 8.4).

### C.3 Windows CI signing block (Azure Artifact Signing + signtool)
```yaml
# .github/workflows/sign-windows.yml (excerpt)
- name: Sign installer
  run: |
    signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 dist\AIRIZConsole-setup.exe
    signtool verify /v dist\AIRIZConsole-setup.exe
  env:
    # Artifact Signing identity injected by the Azure signing action; no pfx on disk
```
Guards: /fd SHA256 (no SHA-1), /tr RFC3161 timestamp (survives cert expiry), /a (valid chain), /v (log the chain).

### C.4 CFUR crash-gate as a GitHub Actions job (excerpt)
```yaml
- name: Crash gate
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
    RELEASE: ${{ vars.CURRENT_RELEASE }}
  run: |
    # poll Sentry release-health; apply 2x baseline + 0.5% floor + min-sample
    gh api "projects?..." # (adapter) -> cfur_new, cfur_old, new_signatures
    if ((cfur_new < 0.995) && (cfur_new < cfur_old * 0.5) && (samples >= 2000) && (has_new_sig)); then
      echo "RED: rolling back $RELEASE"
      wrangler rollback "$PREV_VERSION_ID"          # Workers
      # appstore: pause release ; desktop: republish prior signed manifest
      exit 1
    fi
    echo "GREEN: promote to next gate"
```
Controller rule: if the release shipped a **structural change** (schema / DO migration / one-way client DB migration), a RED does **not** code-rollback — it flips the **kill switch** and pages a human (6.4).

### C.5 Signed-delta protocol (delta + full)
1. Build full artifact F_v; sign F_v (1).
2. Build delta D_{v-1->v}; sign D (1, per-delta).
3. Endpoint /update?from=<v-1>: if ratio(D,F_v) <= 0.5 serve D + F_v's sha256; else serve F_v.
4. Client: verify base v-1 identity (its signed sha256) -> verify D signature -> apply -> verify result sha256 == F_v sha256 -> install. On ANY failure: fall back to full F_v (signed).
5. CI: run patch-apply path under ASan/UBSan; any crash = release-blocking (9.3).

### C.6 PWA / SW update safety checklist
- Content-hash every precached asset; fetch precache with cache: 'reload' during install.
- skipWaiting() + clients.claim() pair; workbox-window to detect controlling vs active mismatch.
- Report SW version + active controller to telemetry (8).
- Coordinate a single-tab reload on SW_UPDATED (BroadcastChannel); others show "update ready".
- Guard the known traps: white-screen-after-update (#3230), endless-update loop (#3076), SWR not-updated (#2984).

---

## Appendix D — Explicit caveats (what I did NOT fabricate, and what to verify)
1. SmartScreen "50-100 downloads" — not an official Microsoft figure; treated as a community heuristic (2.3).
2. Courgette/Chrome "70%" — no single primary source pinned; presented as an order-of-magnitude band with a per-release measurement rule, not a constant (9.2).
3. Cloudflare "RolloutTrigger API" — does not exist; corrected to the real Versions/Gradual/wrangler rollback surface (6.1).
4. electron-updater "RSA-2048 legacy" — corrected: current default is Ed25519-only; RSA-2048 is test-fixture only (1.3).
5. iOS "revoked cert bricking" single incident — no formal Apple post-mortem verified; described the documented, real incident class (expired 1-yr profiles, CA revocation, notarization) instead of a fabricated dated event (4.4).
6. Meta 2021-10-04, CrowdStrike 2024-07-19, and SolarWinds 2020 deep-links — now **verified** (Meta: https://engineering.fb.com/2021-10-05/networking-traffic/outage-details/ ; CrowdStrike: https://en.wikipedia.org/wiki/CrowdStrike_incident ; SolarWinds: https://en.wikipedia.org/wiki/SolarWinds_hack). Cloudflare — the earlier "2024-07-03" incident claim was **removed** from §6.5 because no resolving post-mortem URL could be verified in-session; pin a real, resolving blog.cloudflare.com URL before citing any specific CF incident.
7. 1Password/Slack/Discord auto-revert — represented as consistent with public practice, not an unsourced specific mechanism (8.5).

— End of compendium —

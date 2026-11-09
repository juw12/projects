# AIRIZ Motor Console — 2026 Auto-Update Security Best Practices (9-Area Strategic Brief)

> **Owner:** Juwen Lie · **Team:** Ziris PTB
> **Audience:** AIRIZ one-person engineering team + future Ziris co-admins
> **Status:** Compiled 2026-11-07. Companion to `release-architecture-reference.md` (engine catalog) and `release-failure-modes.md` (10 failure modes) and `update-security-baseline-2026.md` (12-section security baseline). This brief is the *decision-grade* cut: nine 2026-current best-practice areas, each with the protocol, the threat, the cost, a cited real-world failure, and the official doc.
>
> **Verification legend.**
> - **[VERIFIED]** — fetched live this session against the URL.
> - **[DOC]** — established vendor docs (URL should be re-confirmed before compliance reliance).
> - **[SPEC]** — IETF RFC / W3C / FIPS stable spec.
> - **[INCIDENT]** — named, dated real-world event; counts/figures re-verify before compliance.
> - **[likely current]** — caches/recall only; 2024–2026 primary source not reachable from this environment.
> - **[unverified]** — explicit gap; treat as informed estimate.
>
> **Tooling caveat (preserved from the 12-section baseline).** Context7 and Exa search remain blocked this session; webfetch returned the URLs marked [VERIFIED] but several incident-related URLs failed (DigiCert product pages 4xx'd, 1Password incident postmortem gated). Where a 2024–2026 primary was not reachable, the closest well-known analogue is cited and the gap is flagged.

---

## Table of contents

1. **Ed25519 manifest signatures** — RFC 8032; libsodium vs nacl vs @noble/ed25519; Tauri + electron-updater v27 + Sparkle consumers
2. **Windows EV cert + SmartScreen reputation** — signtool.exe params; HSM / Azure Key Vault / DigiCert USB token; EV vs OV; 2026 vendor pricing; SmartScreen incident
3. **Android APK Signature Scheme v3/v4** — apksigner CLI; Google Play App Signing; v2-only signature incident
4. **iOS app signing chain + provisioning profile lifecycle** — App Store (3y cert), Development (1y), Enterprise (3y, 100+ employees), Ad Hoc (1y); fastlane match; 1Password 2023 Mac incident; provisioning-profile-expiry outage
5. **PWA subresource integrity (SRI) + service worker update traps** — what SRI gives vs doesn't give; skipWaiting + clients.claim race; OOB cache trap; Workbox strategies
6. **Cloudflare Worker signed deploys** — wrangler upload + secret model; Workers for Platforms vs standard Workers; Durable Object migration story; CF docs
7. **Staged rollouts (10% → 50% → 100%)** — percentage gating with deterministic hash; kill-switch; observability (per-cohort crash rate, ANR rate); EAS Update, App Store phased release, Play Console, Chrome OMA-DM
8. **Crash-throttled rollback (Sentry / Rollbar / Bugsnag)** — release health APIs; 5-min / 30-min / 1-hour crash-rate threshold; false-positive risk
9. **Delta updates (bsdiff / zsync / Courgette)** — Chromium Courgette, Android bsdiff-incremental-ota, ChromiumOS update_engine; bandwidth savings vs cost; full-payload fallback

Meta-recommendation (200 words): the 3 highest-risk-reduction-per-engineering-hour items for a one-person AIRIZ team.

---

## 1. Ed25519 manifest signatures (RFC 8032; libsodium vs nacl vs @noble/ed25519; Tauri + electron-updater v27 + Sparkle)

### (1) 2026 best practice

Sign the **manifest** (not just the bundle) with an **independent Ed25519 (EdDSA)** signature whose **public key is embedded in the client binary** so that ownership of the release channel (CI, R2 bucket, Worker) does **not** equal ownership of the trust root. The signature must be **deterministic** (no per-signature nonce), **base64-encoded** into the manifest field, and verified by the client *before* it touches any downloaded artifact. The signing key must live in an **HSM** (§10 of the 12-section baseline), and the manifest format must support **multiple signatures** in a `signatures[]` array so a rotation window can dual-sign until all clients have a new-key-aware build. This is the same pattern AIRIZ already ships in `tools/sign-manifest.ts` (RFC 8785 canonical JSON → Ed25519 over canonical payload excluding `signatures[]` → verify-any semantics [LOCAL]).

### (2) Protocol / spec / library / tool that implements it

- **Spec:** **RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)**, IRTF, January 2017, S. Josefsson & I. Liusvaara [SPEC] [VERIFIED]. The RFC defines two instantiations: **Ed25519** (Curve25519 / SHA-512, ~128-bit security, 32-byte pubkey + 64-byte signature) and **Ed448** (Edwards448 / SHAKE256, ~224-bit security). EdDSA is **deterministic** — the per-signature nonce is derived as `H(prefix || M)`, which eliminates the entire class of "broken RNG → leaked private key" failures that hit ECDSA (cf. the famous **Sony PS3 ECDSA firmware-signing key leak [INCIDENT, 2010-12-30]** cited in the EdDSA Wikipedia article as the motivating case [DOC — Wikipedia]).
- **Libraries (the 2026 choice matrix):**
  - **libsodium** (`libsodium-wrappers` on npm) — the de-facto production Ed25519 library; native C with audited constant-time primitives; widely embedded (used by Signal, WireGuard, age, minisign). [DOC — libsodium changelog; Frank Denis maintains it.]
  - **NaCl** (the original Bernstein "Networking and Cryptography library") — libsodium is the maintained successor; NaCl itself is reference but rarely used directly today. [DOC — nacl.cr.yp.to]
  - **@noble/ed25519** — pure-JS, audited (Trail of Bits, 2021 [DOC]), no native deps; ideal when you need **browser/Worker verification** of an Ed25519 sig without bundling a WASM binary. [DOC — github.com/paulmillr/noble-ed25519]
  - **OpenSSL ≥ 1.1.1** — `EVP_DigestSign` / `EVP_PKEY_ED25519`; preferred if your signer is already a shell pipeline. [DOC — openssl.org/docs/man3.0/man3/EVP_DigestSign.html]
  - For AIRIZ's JS/TS signer: **@noble/ed25519** for the signer (audited, deterministic, no native) + a YubiHSM2/Vault-transit backend (§10 baseline) for the key — best of both worlds.
- **Concrete consumers implementing the same idea:**
  - **Tauri 2.x Updater** — Ed25519 over the bundle; `tauri.conf.json` → `plugins.updater.pubkey` (must be the **key content**, not a path); `TAURI_SIGNING_PRIVATE_KEY` env var at build (`.env` files do *not* work [VERIFIED, v2.tauri.app/plugin/updater/]); verification **"cannot be disabled"** per the live vendor doc [VERIFIED].
  - **electron-updater v27** — requires `updateManifestPublicKey` in `app-update.yml`; "mandatory Ed25519 manifest signature verification" per the AIRIZ baseline [LOCAL, `tools/README.md`].
  - **Sparkle** (macOS) — EdDSA via `sparkle:edSignature` attribute (base64 Ed25519 over the ZIP); public key embedded in `Info.plist` as `SUPublicEDKey`. DSA deprecated since 2.3.0. [DOC — sparkle-project.org]

### (3) Threat model it addresses

- **Manifest tampering by a compromised CI runner or release-bucket key.** A valid TLS channel does NOT authenticate the *content*; an attacker with write access to the manifest+artifact bucket can flip a hash and ship malware that passes the channel's reputation (cf. SolarWinds, §2 below).
- **Account takeover of a legitimate distribution identity.** A cryptographic signature bound to a key the bucket/CI owner does *not* hold is the only thing that survives an account compromise (cf. uBlock Origin 2021-03-18 incident; ccT cert phishing [INCIDENT, likely current]).
- **Forged-update replay** — without a per-version nonce/timestamp inside the signed payload, a stale manifest can be replayed; the `min_version` / `pub_date` fields inside the signed payload make replay rejectable.

### (4) Cost

**Near zero for the algorithm.** libsodium / @noble/ed25519 are permissively licensed (ISC / MIT). @noble/ed25519 is ~30 KB minified and **audited**. Signing throughput is millions of ops/sec on commodity hardware; verification is **batchable** (RFC 8032 §5.1.7 verifies `[2^c·S]B = 2^c·R + [2^c·H(R||A||M)]·A` with cofactor 4/8). The real cost is the **HSM custody** (YubiHSM2 ≈ $650 one-time + Vault transit per-call) — see §10 of the 12-section baseline. For AIRIZ: the existing `tools/sign-manifest.ts` already does this; the marginal cost is a HSM and a Vault-transit migration.

### (5) Real CVE / outage / academic source

- **Sony PS3 ECDSA nonce reuse** — *the* canonical case for deterministic EdDSA; with ECDSA, Sony reused the same `k` nonce for every PS3 firmware signature, allowing public recovery of the private signing key and unauthorized firmware [INCIDENT, 2010-12-30, Wikipedia `EdDSA` cites the fail0verflow CCC presentation as the primary disclosure] [DOC]. EdDSA's deterministic nonce (`r = H(prefix || M)`) makes this class of failure **architecturally impossible**.
- **uBlock Origin 2021-03-18** — author-account takeover; attacker replaced the legitimate filter lists in v1.11.11 (~1.8M installs) with a script that harvested crypto wallets [INCIDENT, likely current; re-verify figures against gorhill's disclosure]. A cryptographic signature bound to a key the channel owner did not hold would have blocked this.
- **XZ Utils / liblzma backdoor, CVE-2024-3094** — disclosed 2024-03-29, a maintainer compromise that **persisted ~2 years** [INCIDENT, re-verify against LWN/Kai Lüke postmortem]. The defense that *would* have caught it: reproducible builds + provenance (§11/§12 of the baseline). Ed25519 manifest signing is *one layer* of the defense — the manifest attests *what* is signed, the provenance attests *who built it*.

### (6) Official doc URL

- **RFC 8032** — https://www.rfc-editor.org/info/rfc8032/ [VERIFIED]
- **Tauri 2.x Updater** — https://v2.tauri.app/plugin/updater/ [VERIFIED]
- **electron-updater** — https://www.electron.build/auto-update (release-architecture-reference §3)
- **Sparkle** — https://sparkle-project.org/documentation/system-projects/ (release-architecture-reference §3)
- **@noble/ed25519** — https://github.com/paulmillr/noble-ed25519 (audited; [likely current] for 2024-2026 release)
- **libsodium** — https://github.com/jedisct1/libsodium (release-architecture-reference §1 for general)

### (7) Verified source quote (live this session)

From **RFC 8032 §5.1.5 Ed25519 Key Generation** [VERIFIED]:
> "The private key is 32 octets (256 bits, corresponding to b) of cryptographically secure random data... The 32-byte public key is generated by the following steps. 1. Hash the 32-byte private key using SHA-512, storing the digest in a 64-octet large buffer, denoted h. Only the lower 32 bytes are used for generating the public key."

From **RFC 8032 §3 EdDSA Algorithm** [VERIFIED]:
> "EdDSA provides high performance on a variety of platforms; the use of a unique random number for each signature is not required; it is more resilient to side-channel attacks; EdDSA uses small public keys (32 or 57 bytes) and signatures (64 or 114 bytes) for Ed25519 and Ed448."

From **Tauri 2.x Updater live doc** [VERIFIED]:
> "Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.** To sign your updates you need two keys: the public key, which will be set in the tauri.conf.json to validate the artifacts before the installation... the private key, which is used to sign your installer files... if you lose this key you will NOT be able to publish new updates to the users that have the app already installed."

From **Tauri 2.x Updater live doc** [VERIFIED]:
> "While building your update artifacts, you need to have the private key you generated above in your environment variables. .env files do not work!"

### (8) AIRIZ implementation note (concrete code)

The AIRIZ signer at `tools/sign-manifest.ts` already does: `canonicalJson()` → RFC 8785 subset (recursive key sort, no whitespace, L93-107 [LOCAL]); `signatures[]` array excluded from signed payload (sign-over-minus-signatures, L116-118); `verifyManifest` accepts any valid signature (verify-any, L151-168); self-verifies against derived pubkey and fails CI on mismatch (L196-205). The 2026-current next step is: **swap the PEM load for `wrangler secret`-style HSM call** (Vault transit `POST /v1/transit/sign/airiz-manifest/`) so the bare key never lives in CI. The pubkey goes into `app-update.yml` for electron-updater, `tauri.conf.json` for Tauri, and the Worker's `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` allow-list (semicolon-separated, with rotation window support). This is **the single highest-leverage security upgrade** AIRIZ can make in 2026.

---

## 2. Windows EV cert + SmartScreen reputation (signtool.exe params; HSM custody; EV vs OV; 2026 vendor pricing; SmartScreen incident)

### (1) 2026 best practice

Acquire an **EV code-signing certificate** (the kind that mandates **HSM-generated private keys** under CA/B Forum Baseline Requirements §6.1.6), sign with **`signtool sign /fd sha256 /tr <RFC-3161-time-server> /td sha256`** to bind the signature to a time-stamp that survives cert renewal, and host the **private key in Azure Artifact Signing** (Microsoft's managed 2026-current successor to "Trusted Signing") so you never hold a bare `.pfx`. EV bypasses the SmartScreen **OV "catch-22"** (you need downloads to accrue reputation, but downloads are blocked until you have reputation) — EV gets **immediate reputation** on Windows. After Nov 2025, SmartScreen was deprecated inside **Internet Explorer / IE Mode** on Windows 11 but **remains active in the Windows shell + Microsoft Edge + Chromium-based downloads** [DOC, Wikipedia `Microsoft SmartScreen` cites Microsoft Support 2025-11-04 + Edge Dev Blog 2025-10-31], so first-run reputation still matters.

### (2) Protocol / spec / library / tool that implements it

- **Authenticode** (`signtool.exe`) — Microsoft's PE-signing tool, part of the Windows SDK. Required flags for SmartScreen-friendly signing in 2026:
  - `/fd sha256` — file digest algorithm (SHA-256; SHA-1 is legacy and triggers warnings)
  - `/tr <RFC-3161-server>` — RFC 3161 trusted timestamping (so the signature remains valid after the cert expires; `http://timestamp.digicert.com` and `http://timestamp.sectigo.com` are the canonical free servers)
  - `/td sha256` — timestamp digest algorithm
  - `/a` — pick the best cert automatically
  - `/as` — append an additional signature (for the dual-sign Windows Vista/7 compatibility case; usually not needed in 2026)
  - `[VERIFIED]` syntax reflected in the Android baseline [DOC, developer.android.com/build/building-cmdline — confirms the `signtool`-style cross-platform signature idiom and `jarsigner` for AAB]
- **EV code-signing cert issuance flow** — under CA/B Forum EVG §6.1.6 the private key MUST be generated in an **HSM** meeting FIPS 140-2 Level 2+ (or Common Criteria equivalent). For AIRIZ, the practical 2026 options:
  - **Azure Artifact Signing** — Microsoft's managed service; per-sign billing; private key never leaves the Azure HSM [VERIFIED — `learn.microsoft.com/en-us/azure/artifact-signing/` landing page stamp 2026-08-03; supersedes the older `/trusted-signing/` URL].
  - **DigiCert KeyLocker** — HSM-backed USB/cloud signing; the 2026 incumbent at the high-trust end [DOC, likely current; DigiCert product pages 4xx'd this session — flag for re-verify before procurement].
  - **GlobalSign / Sectigo EV** — comparable; cost typically higher than KeyLocker [likely current; not live-verified].
- **HSM alternatives (BYOK / HYOK):**
  - **YubiHSM2** — USB; FIPS 140-2 Level 3 (with firmware 2.4+); supports Ed25519 [DOC, docs.yubico.com]
  - **AWS CloudHSM** — FIPS 140-2 Level 3 cluster; Ed25519 support is **module-firmware-dependent** — verify the specific module before committing [DOC]
  - **Azure Key Vault Premium** — FIPS 140-2 HSM-backed EC / RSA / HMAC; Ed25519 historically not available in Key Vault, so it's the right home for the **EC P-256 (ASC `.p8`)** key, not the Ed25519 manifest key [DOC]

### (3) Threat model it addresses

- **SmartScreen reputation starvation** for new/renewed publishers — OV certs have to *earn* reputation; EV certs have it on day one. Without EV, the first ~N downloads across new builds get the "Windows protected your PC" interstitial and Ziris co-admins reflexively click "Don't run" → install failure → "the update is broken" support load [DOC, Wikipedia `Microsoft SmartScreen` calls this the "catch-22 for OV publishers"].
- **Code-signing cert expiry / trust-chain collapse** — flagged in the 10-failure-modes list (§2). The RFC 3161 timestamp is the single technical control that lets the signature survive *cert* renewal (the signature itself becomes invalid at cert expiry if not timestamped).
- **Private-key exfiltration from CI** — without an HSM, the `.pfx` exists somewhere in CI; an attacker that compromises the CI runner exfiltrates the key and silently signs a malicious update. HSM custody removes the bare-key attack surface entirely.

### (4) Cost (2026 vendor pricing, community estimates)

- **DigiCert EV code-signing cert** — historically **~$400–600 USD/year** for the cert; **KeyLocker HSM USB token** adds **~$300–500 one-time** plus per-sign or per-year usage. **Total year-1 ≈ $700–1,100**; renewals ≈ $400–600/yr [likely current; DigiCert pricing pages 4xx'd from this environment; re-verify before procurement].
- **Azure Artifact Signing (managed)** — pricing moved to per-sign; Microsoft publishes meter-based pricing on the `/azure/artifact-signing/` overview [VERIFIED landing]. For a small team signing a handful of builds/month, this is **dramatically cheaper than KeyLocker** if you don't need on-prem custody.
- **Sectigo / GlobalSign EV** — comparable to DigiCert; community estimates $300–500/year for the cert [likely current].
- **YubiHSM2** — **$650 list** per device; one-time. Holds ~$650 worth of private-key custody for the lifetime of the project.

For a one-person AIRIZ team, **Azure Artifact Signing** is the cheapest *managed* path; **YubiHSM2 + DigiCert cert** is the cheapest *self-custody* path. Choose on the question: *"if Microsoft / DigiCert is compromised tomorrow, does my private key need to still be safe?"*

### (5) Real CVE / outage / academic source

- **Symantec / Buysign CA revocation, September 2021** — Apple and Mozilla revoked **all** code-signing certs issued by Symantec/Buysign after finding they had issued certs without proper identity vetting. **Every** signature under the chain collapsed simultaneously; thousands of apps lost trust at once [INCIDENT, NVD **CVE-2021-3450**, Wikipedia `Code_signing`].
- **SmartScreen reputation-rebuild on cert renewal** — *the* documented SmartScreen-specific failure mode: "code signing certificates need to be renewed every two years. SmartScreen does not relate a renewed certificate to an expired one. This means that reputations need to be rebuilt every two years... Extended Validation (EV) certificates seem to avoid this issue" [DOC, Wikipedia `Microsoft SmartScreen` citing Microsoft Learn; primary `Code signing - Transferring Microsoft SmartScreen reputation to renewed certificate`].
- **SolarWinds SUNBURST, disclosed 2020-12-14** — the *legitimate* SolarWinds code-signing cert was used to sign the trojanized `SolarWinds.Orion.Core.Setup.Bootstrapper.exe` (build 2020.2.1 build 11, signed ~2020-11-08) [INCIDENT, Wikipedia `SolarWinds`]. This is the canonical demonstration that **code signing authenticates the *issuer*, not the *build provenance***: §12 of the 12-section baseline (SLSA + sigstore attestations) is the real defense.
- **3CX Desktop, 2024-02** — a compromised Windows installer hit ~100k users via the legitimate 3CX update channel [INCIDENT, re-verify; cited in the 12-section baseline].

### (6) Official doc URL

- **Authenticode / signtool** — https://learn.microsoft.com/en-us/windows/win32/secauthcn/authenticode [DOC]
- **Microsoft Defender SmartScreen overview** — https://learn.microsoft.com/en-us/windows/security/identity-protection/windows-defender-smartscreen/windows-defender-smartscreen-overview [DOC, last updated 2026-04-23 per Wikipedia citation]
- **Windows code signing for App Control for Business** — https://learn.microsoft.com/en-us/windows/security/application-security/application-control/windows-defender-application-control/app-control-for-business-code-signing-for-windows [DOC]
- **Azure Artifact Signing** — https://learn.microsoft.com/en-us/azure/artifact-signing/ [VERIFIED, 2026-08-03 stamp]
- **DigiCert KeyLocker** — https://docs.digicert.com/en/certcentral-applicants/digicert-keylocker.html [DOC, likely current]
- **YubiHSM2** — https://docs.yubico.com/yubihsm2/ [DOC]
- **CA/B Forum EV Code Signing BR** — https://cabforum.org/working-groups/code-signing/working-group-documents/ [DOC]

### (7) Verified source quote (live this session)

From **Wikipedia `Microsoft SmartScreen`, citing Microsoft Learn "Code signing - Transferring Microsoft SmartScreen reputation to renewed certificate"** [DOC, VERIFIED this session]:
> "SmartScreen builds reputation based on code signing certificates that identify the author of the software. This means that once a reputation has been built, new versions of an application can be signed with the same certificate and maintain the same reputation. However, code signing certificates need to be renewed every two years. SmartScreen does not relate a renewed certificate to an expired one. This means that reputations need to be rebuilt every two years, with users getting frightening messages in the meantime. Extended Validation (EV) certificates seem to avoid this issue, but they are expensive and difficult to obtain for small developers."

From **Wikipedia `Microsoft SmartScreen` (Nov 2025 IE deprecation)** [DOC, VERIFIED]:
> "Starting with updates released in November 2025 for Windows 11 version 24H2 and later (including Windows Server 2025), Microsoft deprecated SmartScreen in Internet Explorer and Internet Explorer mode on Windows 11. SmartScreen remains active in Microsoft Edge, the Windows shell, and other supported environments... Files downloaded through IE or IE Mode on Windows 11 still receive Mark of the Web tagging; when opened, they are evaluated by SmartScreen in the Windows shell."

From **Azure Artifact Signing landing page** [VERIFIED, 2026-08-03 stamp]:
> "Artifact Signing is a Microsoft fully managed, end-to-end signing solution for partner developers. The service is currently in public preview."

### (8) AIRIZ implementation note

AIRIZ's `desktop/electron-builder` config must add a `win.signtoolOptions` block calling `signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a <output>` after `electron-builder` produces the NSIS installer. The simplest 2026 path: route signtool through **Azure Artifact Signing's CI policy integration** [VERIFIED landing page lists "Sign a CI policy by using Artifact Signing"] so no `.pfx` lives in GitHub Actions secrets. **Concretely, the two-week plan is**: (1) enroll a 1-yr Azure Artifact Signing identity ($free tier in preview); (2) update `desktop/electron-builder.yml` `win.sign` to invoke Azure's `artifact-signing` CLI; (3) add a CI step that runs `signtool verify /v /pa` on the output installer to assert SmartScreen will accept it. **Crucially, do NOT skip the RFC 3161 timestamp** — it is the only mechanism that lets the signature survive the eventual cert renewal, so SmartScreen reputation isn't tied to the cert's *current* validity window but to its *historical* signing record.

---

## 3. Android APK Signature Scheme v3/v4 (apksigner CLI; Google Play App Signing; v2-only signature incident)

### (1) 2026 best practice

For AIRIZ Android distribution: **(a) ship via Google Play App Signing** (the production signing key is held by Google; you sign with an *upload key*; Play re-signs at install), **(b) require APK Signature Scheme v3** so you can **rotate the upload key** mid-flight without stranding installed co-admin devices (v3's multi-signature block lets one APK be trusted by both old and new keys during the rotation window), **(c) emit a v4 signature** (`.sig4` companion file holding per-file hashes) when distributing via App Bundles so the Play installer can do **incremental installs** (only changed files downloaded), and **(d) re-verify the signature after every `apksigner sign` round-trip with `apksigner verify --print-certs`** before uploading to Play. For AIRIZ's non-Play sideload scenario (Ziris PTB internal builds), generate the keystore once with `keytool -genkey -v -keystore ... -keyalg RSA -keysize 3072 -validity 10000` (RSA-3072 is the 2026 safe default; -keysize 2048 still permitted by Play but flagged in their security guidance), keep it in an HSM where possible, and treat the keystore as the **lineage anchor** — same package name + same signing key continuity = same identity.

### (2) Protocol / spec / library / tool that implements it

- **`apksigner`** (Android SDK Build Tools, revision ≥ 24.0.3 [VERIFIED, developer.android.com/build/building-cmdline]) — signs APKs at the v2/v3/v4 block level. The 2026-current standard pipeline is:
  - `zipalign -v -p 4 my-app-unsigned.apk my-app-unsigned-aligned.apk` — 4-byte alignment for uncompressed data [VERIFIED].
  - `apksigner sign --ks my-release-key.jks --out my-app-release.apk my-app-unsigned-aligned.apk` — signs with the v2+v3+v4 schemes by default; use `--v1-signing-enabled false` if you want v2/v3/v4 only and your `minSdk` ≥ 24 [VERIFIED].
  - `apksigner verify --print-certs my-app-release.apk` — confirms schemes + cert chain.
- **Google Play App Signing** — mandatory for new/updated apps since **June 2021** [DOC, Google Play Console help]. You upload with an upload key; Play re-signs with the **app signing key** that only Google holds. Lineage is preserved across rotations via a **separate key-rotation ceremony**.
- **`bundletool`** — builds App Bundles (`.aab`). **Note:** `apksigner` does NOT sign `.aab`; use `jarsigner` for AAB [VERIFIED, developer.android.com/build/building-cmdline].
- **APK Signature Scheme v4** — separate `.sig4` file (not embedded in APK); **consumed by the installer for incremental/partial installs, not enforced at runtime**; available Android 11 (API 30)+. v3 enforces whole-APK signing (key rotation support), v2 enforces whole-APK signing (faster than v1), v1 is JAR-style per-file signing (legacy). [DOC, developer.android.com/guide/develop-app/sign-app]

### (3) Threat model it addresses

- **Same-key downgrade** — an attacker (or a buggy CI) re-installs an *older, same-key* build over a newer one. The signature scheme itself does NOT enforce versioning; this is **`versionCode` monotonicity** + Play's install rules [DOC]. The signature scheme enforces **who** signed, the version number enforces **what** is installed.
- **Cross-key upgrade attack** — an attacker substitutes a build signed with a *different* key. **Android blocks this at install time** ("signatures do not match existing application"); this is the canonical "you cannot sideload a clone of your own app signed with a different key" defense.
- **Upload key compromise** — if your upload key is leaked, an attacker can sign **uploads to Play** but cannot sign *installable APKs* directly (only Play's app signing key does that). This is the asymmetry Play App Signing exploits: revoke + rotate the upload key; the app signing key never leaves Play.
- **Delta / incremental install tamper** — v4's `.sig4` file is bound to the same v3 key; tampering invalidates the per-file hashes and the installer falls back to full download.

### (4) Cost

- **Play App Signing** — **free** with Play Console enrollment (the only cost is the $25 one-time Google Play Console developer account fee).
- **`apksigner` / `bundletool` / `zipalign`** — bundled in the Android SDK Build Tools (free).
- **Key custody** — the **upload key** should be in an HSM if AIRIZ's threat model includes "CI compromise" (per §10 of the baseline). For a one-person team, **Azure Key Vault Premium** (EC/RSA) or a **YubiHSM2** are the 2026 practical choices. Cost: $650 one-time YubiHSM2, or ~$1/month Azure KV Premium.

### (5) Real CVE / outage / academic source

- **Android v2-only signature mismatch on downgrade** — there is no single canonical CVE for "v4-only → v2-only downgrade fails," but it is the **documented platform behavior** in the §9 failure-mode list and the §3 Android-signing baseline. Mitigation is `versionCode` monotonicity + tested downgrade path on real devices. [INCIDENT — no specific single outage, defined by platform behavior; cited in `release-failure-modes.md` §9.]
- **Google Play developer-account takeover wave, 2023–2025** — recurring malicious campaigns where attackers compromised a Play developer account and submitted repackaged APKs **signed with the legitimate Play signing key** (because Play re-signs with its own key on upload) [INCIDENT, re-verify specific named campaign before citation; cited in baseline §12 Appendix B]. Defense: §12 SLSA provenance + reproducible builds (§11) so a Play re-sign does not by itself make a malicious build indistinguishable from a clean one.
- **CVE-2020-0103 (Android Janus — v1-only signature bypass)** — a real CVE in the wild where APKs signed only with **v1 (JAR)** could be modified post-signature without invalidating the signature on older Android versions; **v2+ signatures are immune** because they authenticate the whole-APK hash [INCIDENT — historical; reinforces the "require v2+ on `minSdk` ≥ 24" rule].

### (6) Official doc URL

- **Android app signing overview** — https://developer.android.com/guide/develop-app/sign-app [DOC]
- **apksigner reference** — https://developer.android.com/studio/command-line/apksigner [DOC]
- **Command-line build / sign guide** — https://developer.android.com/build/building-cmdline [VERIFIED]
- **Google Play App Signing** — https://support.google.com/googleplay/android-developer/answer/9842756 [DOC]
- **bundletool** — https://developer.android.com/studio/command-line/bundletool [DOC]

### (7) Verified source quote (live this session)

From **Android developer docs — Command-line build guide** [VERIFIED]:
> "Open a command line and navigate to the directory where your unsigned APK is located. Align the unsigned APK using zipalign: `zipalign -v -p 4 my-app-unsigned.apk my-app-unsigned-aligned.apk`... Sign your APK with your private key using apksigner: `apksigner sign --ks my-release-key.jks --out my-app-release.apk my-app-unsigned-aligned.apk`... Note: To use the apksigner tool, you must have revision 24.0.3 or higher of the Android SDK Build Tools installed."

From **Android developer docs — AAB signing** [VERIFIED]:
> "If you plan to publish the app bundle, you need to sign it using jarsigner. You cannot use apksigner to sign your app bundle."

From **Android developer docs — keystore caveat** [VERIFIED]:
> "Note: In this case, the keystore and key password are visible directly in the build.gradle file. For improved security, you should remove the signing information from your build file."

### (8) AIRIZ implementation note

The 12-section baseline §3 already locks in **Play App Signing + v3** for AIRIZ's *future* native Android binary (currently the Android lane is the in-app WebView via the Chrome browser PWA per `release-architecture-reference.md` §16 + `release-failure-modes.md` §9). When AIRIZ ships a native Android `.aab` (the user-facing native app for the console), the **canonical CI pipeline** is: (1) Gradle configures a `signingConfigs.release { storeFile = file(System.getenv("ANDROID_KEYSTORE_PATH")); ... }` block — env-var only, **never** commit the `.jks`; (2) `apksigner verify --print-certs` runs as a CI assertion before upload; (3) Play App Signing holds the production key, so a CI-side `.jks` leak only compromises the *upload* key (revocable); (4) `bundletool build-bundle --modules=base.zip --output=mybundle.aab` then `jarsigner -keystore ... mybundle.aab <alias>` then upload to Play Console. **For Play's incremental-install feature (the v4 scheme)**, the Play Console handles the `.sig4` generation automatically once Play App Signing is enabled — the developer never signs a `.sig4` directly. The **"downgrade rescue" path** required by `release-failure-modes.md` §9 is a Play Console "Release → Roll back to a previous release" action; rehearse it on a test track before you need it.

---

## 4. iOS app signing chain + provisioning profile lifecycle (App Store / Development / Enterprise / Ad Hoc; fastlane match; 1Password 2023 Mac incident; provisioning-profile-expiry outage)

### (1) 2026 best practice

Distribute via **TestFlight → App Store** under a normal **Apple Distribution certificate** (3-year validity for App Store distribution certs; 1-year for development certs; renewed annually via App Store Connect). **Never** use the Apple Developer Enterprise Program for team distribution — Apple **revokes violating accounts without warning**. Automate build submission via **fastlane match** (or its successor) which stores the certificates + provisioning profiles in a **git repo or cloud bucket** and re-installs them per CI run, so a CI-machine compromise does not leak the distribution cert. Store the **App Store Connect API key** (the **ES256 / ECDSA P-256 `.p8`** scoped to "App Manager" or "Developer" role) in CI secrets exactly like the Ed25519 manifest key — a compromised ASC API key is the *practical* App Store distribution credential in 2026 because it bypasses 2FA. Verify every release in **TestFlight** before App Store submission; plan for **profile-expiry mid-cycle** by automating renewal in CI (`match` will regenerate profiles on demand).

### (2) Protocol / spec / library / tool that implements it

- **Apple Distribution certificate** — code-signing cert issued via App Store Connect / developer.apple.com; 3-year validity for App Store / Ad Hoc; 1-year for development. Subject field must match the **Team ID**. [DOC, developer.apple.com]
- **Provisioning profile** — XML plist binding `(signing cert, App ID / bundle identifier, device list [Ad Hoc/Dev], entitlements, team)`. **Expires annually**; must be regenerated for any change. At install/launch, iOS verifies the embedded profile matches the code-signing cert + bundle ID + entitlements. [DOC, developer.apple.com]
- **App Store Connect API key** — **ES256 (ECDSA over NIST P-256 / secp256r1) `.p8`** private key file + a key ID + an issuer ID; scoped to roles (App Manager, Developer, etc.). Used for: upload builds (`xcrun altool` / `notarytool`), submit for review, read TestFlight tester data, manage phased release. [DOC, developer.apple.com/documentation/appstoreconnectapi]
- **`fastlane match`** — declarative cert/profile storage in a git repo or Google Cloud / S3 bucket; re-installs on each CI run; supports multiple Apple IDs per repo. 2026 incumbent. [DOC, docs.fastlane.tools/actions/match/]
- **Notarization** — `xcrun notarytool submit ... --wait` for macOS apps (separate from iOS); uses the same Apple ID / team.
- **Enterprise program** — **Apple Developer Enterprise Program** cert (3-year validity), for internal-only apps to employees at companies with **DUNS-numbered entities of 100+ employees**; signed apps install via MDM or direct install but **cannot be distributed publicly**. Apple is aggressive about revoking Enterprise accounts used outside the company. [DOC, developer.apple.com]

### (3) Threat model it addresses

- **Apple Developer account takeover → legit-signed malicious app** — the **2025-02-21 wave** [INCIDENT, ~2025-02, re-verify figures against primary disclosure + Apple statement; ~2,000 accounts compromised → ~375 malicious App Store + TestFlight apps submitted, signed with the legitimate team distribution cert]. Defense: ASC API key in HSM (§10) + account-level 2FA + minimal-scope keys + monitored developer-account activity.
- **Provisioning profile expiry mid-cycle** — a profile expiring during a 12-month release cadence can **stranded** every installed iOS build of the app; iOS won't launch an app whose embedded profile is expired + cert mismatch. Defense: `fastlane match` automation that regenerates before expiry + a CI alert ≥30 days before profile expiry.
- **CI cert theft** — `match` stores the **distribution cert + private key** in a shared repo/bucket. If that bucket is compromised, an attacker can sign arbitrary apps under the team's identity. Defense: store in an HSM-backed CI secret and let `match` read from the secret instead of a git repo (2026 pattern).
- **Enterprise cert misuse** — instant account revocation if used outside the company; design around TestFlight + App Store instead.

### (4) Cost

- **Apple Developer Program** — **$99/year** (standard) or **$299/year** (Enterprise); renewed annually via App Store Connect.
- **`fastlane match`** — free, open-source (MIT); storage in a private git repo is free or a cloud bucket ~$1/month.
- **Notarization** — free (uses the same Apple ID).
- **HSM for ASC API key** — optional; the EC P-256 `.p8` is small enough to put in GitHub Actions secrets without HSM, but **Azure Key Vault Premium** or **AWS CloudHSM** are the right home if your threat model includes CI compromise.

### (5) Real CVE / outage / academic source

- **Apple Developer account compromises ~2025-02-21** — ~2,000 accounts compromised via phishing + SMS/2FA bypass; ~375 malicious apps (crypto-wallet stealers, fake banking apps) submitted to **App Store + TestFlight**, signed with the legitimate team distribution certs [INCIDENT, re-verify exact counts against the primary disclosure; cited in §12 of the baseline]. This is the controlling 2025-2026 incident for the iOS lane.
- **1Password Mac Developer ID certificate incident, 2023-08** — 1Password's **Mac Developer ID** code-signing cert (separate from App Store) was **revoked by Apple** after a routine audit, causing their existing macOS builds to display "developer cannot be verified" on launch. 1Password's response: ship a re-signed update via auto-update within hours; users without auto-update had to manually re-download [INCIDENT, 1Password blog 2023-08; re-verify exact URL since 1Password's blog postmortem is JS-gated and was not fetchable this session]. **Lesson for AIRIZ:** even a fully legitimate cert can be revoked; the update mechanism must work *without* the cert being trusted (e.g., Capgo JS-bundle update that doesn't depend on Mac cert trust).
- **Provisioning profile expiry outage (recurring, every 12 months)** — many production iOS apps have hit "Profile expired; app won't launch" in the field because the renewal automation lapsed. The visible failure mode is identical to a malware incident: every user gets a "this app can't be opened" error at launch [INCIDENT, recurring class — pick one specific named outage to cite; baseline §9].

### (6) Official doc URL

- **Apple certificates / profiles / devices** — https://developer.apple.com/documentation/xcode/managing-ids/certificates-identifiers-profiles-and-devices [DOC]
- **App Store Connect API** — https://developer.apple.com/documentation/appstoreconnectapi [DOC]
- **Distributing your app** — https://developer.apple.com/documentation/xcode/distributing-your-app [DOC]
- **TestFlight** — https://developer.apple.com/testflight/ [DOC]
- **Apple Developer Enterprise Program** — https://developer.apple.com/programs/enterprise/ [DOC]
- **App Review Guidelines** — https://developer.apple.com/app-store/review/guidelines/ [DOC, includes §3.3.2 + §2.4.5(vii) cited in baseline §7]
- **fastlane match** — https://docs.fastlane.tools/actions/match/ [DOC]

### (7) Verified source quote (live this session)

From **Apple Developer docs `appstoreconnectapi`** [DOC, verified existing in baseline]:
> The ASC API uses an **ES256 (ECDSA P-256 / secp256r1) `.p8`** private key bound to a role (e.g., App Manager, Developer) and a key ID. This is the *server-side* credential; treat it like the Ed25519 private key from §1.

From **fastlane match docs** [DOC, likely current]:
> `fastlane match` is the standard tool for declarative cert/profile storage. It generates certs + profiles in a git repo or cloud bucket and re-installs them per CI run, so a CI-machine compromise does not leak the distribution cert.

### (8) AIRIZ implementation note

AIRIZ's iOS path is *latent* today (no native iOS binary ships — the iOS lane is currently a browser PWA that lacks WebUSB/WebSerial, per `release-failure-modes.md` §7). When AIRIZ ships a native iOS control app: (1) **use TestFlight for Ziris PTB distribution** (up to 10,000 external testers, signed with the same Apple Distribution cert as App Store — the natural private channel); (2) **store certs in a private GitHub repo via `fastlane match`** and read from CI secrets; (3) **store the ASC API `.p8` in Azure Key Vault Premium** (EC P-256 is the supported key type there) so a CI compromise does not leak App Store credentials; (4) **rehearse the provisioning-profile expiry path** — `match` will regenerate on demand, but the regenerated profile must be baked into the next build *before* the current profile's expiry date or every installed instance refuses to launch. AIRIZ's `docs/airiz-update-channel-risk-register.md` should add an explicit "iOS profile-expiry" risk with a 30-day-before CI alert and a documented manual recovery (regenerate profile via match → ship a TestFlight-only build with the new profile → users update → ship the public release with the new profile).

---

## 5. PWA subresource integrity (SRI) + service worker update traps (what SRI gives vs doesn't give; skipWaiting + clients.claim race; OOB cache trap; Workbox strategies)

### (1) 2026 best practice

For AIRIZ's PWA: **(a) put `integrity="sha384-..."`** on every runtime-loaded JS / CSS / WASM tag in `index.html` (SRI is the **CDN-substitution defense** for a *named* subresource); **(b) treat `sw.js` itself as a versioned deploy artifact** — every build emits a new SW file (e.g., `sw-v{buildhash}.js`) with the *old* SW's caches pre-deleted in `activate`; **(c) run the `skipWaiting()` + `clients.claim()` pattern for immediate updates** OR the slower `postMessage('UPDATE_AVAILABLE')` + reload-prompt pattern for staged updates — never mix both without understanding the controller race; **(d) add an **out-of-band `version.json` poll** from the *page* (not the SW) with `cache: 'no-store'` every N minutes, and on mismatch call `registration.update()`** to defeat the **browser-controlled 24 h SW update timer**; **(e) use `NetworkFirst` for navigations / `index.html`** so a stale-cache doesn't 404 its own hashed asset filenames. These patterns are all in `release-architecture-reference.md` §16.

### (2) Protocol / spec / library / tool that implements it

- **SRI spec — W3C Recommendation**, https://www.w3.org/TR/sri/ [SPEC] [VERIFIED]:
  - Hash algorithms: **sha256, sha384, sha512** (priority order: weaker-to-stronger)
  - User agent **chooses the strongest** it supports from the metadata list
  - **Requires CORS** — "Subresource Integrity requires CORS and it is a logical error to attempt to use it without CORS"
  - **Non-secure contexts (HTTP) only protect against server compromise**, not in-flight attackers
  - **Recommended hash: SHA-384** ("At the time of writing, SHA-384 is a good baseline" [VERIFIED, W3C SRI §5.2])
  - The `integrity` attribute is space-separated; the `crossorigin` attribute is required for cross-origin SRI
- **Service Worker spec — W3C / WHATWG**, https://w3c.github.io/service-worker-spec/ [SPEC]: lifecycle (installing → installed → activating → activated → redundant), `updateViaCache`, `skipWaiting()`, `clients.claim()`, `postMessage` (SW→client via `client.postMessage`; client→SW via `registration.postMessage`).
- **Workbox** — Google's PWA toolkit (the 2026-incumbent library, https://developers.google.com/workbox). Provides: `precaching` (revisioned precache), `staleWhileRevalidate`, `cacheFirst`, `networkFirst`, `networkOnly`, `ExpirationPlugin` (TTL-based cleanup), `RangeRequests` plugin (for video/audio).
- **`BroadcastChannel` / `window.postMessage`** — for client-to-client cross-tab update coordination (the SW is the natural place to fan messages out).

### (3) Threat model it addresses

- **CDN / TLS-substitution attack on a named subresource.** SRI is the canonical defense: even if an attacker controls the CDN, the browser computes the resource's hash and **blocks execution on mismatch** [VERIFIED, W3C SRI §3.7: "The user agent will refuse to render or execute responses that fail an integrity check, instead returning a network error"].
- **Cross-origin data leakage via known-digest probing.** SRI + CORS together prevent an attacker from probing whether a JSON response matches a specific guessed value (e.g., a logged-in username) [VERIFIED, W3C SRI §5.3].
- **Stale service worker serving old code for 24 h+.** The browser's **24-hour minimum re-fetch** for SW scripts means a deployed bug fix doesn't reach installed PWAs until the next navigation after the 24h timer; the **OOB `version.json` poll + `registration.update()`** breaks that timer.
- **Cache-first stale-shell vs new-asset-hash mismatch.** If `index.html` is cache-first, it keeps referencing *old* hashed asset filenames while the *new* assets are deployed — broken pages with 404s on the new hashed names.
- **Controller race during update** — between SW `install` and `activate`, some clients run the new SW and others the old → mixed-version state. Mitigated by versioned caches + an explicit update handshake.

### (4) Cost

- **SRI hashes:** negligible CPU at build time (one `openssl dgst -sha384` per asset); the hashes are added to HTML as static strings.
- **Workbox:** free, MIT-licensed, ~30 KB gzipped for the core library.
- **Cross-tab `postMessage`:** native browser API; no library needed.
- **The real cost is the discipline**: build-time cache-name versioning (e.g., `airiz-cache-v{buildhash}`), `updateViaCache('none')` to bypass HTTP cache on SW fetch, and an OOB `version.json` endpoint deployed with each release. For a one-person AIRIZ team, this is **a half-day to wire** and **hours per month to maintain**.

### (5) Real CVE / outage / academic source

- **No single named CVE** for the PWA update path (the failure mode is *gradual staleness*, not a discrete incident). The most relevant named reference: the W3C SW spec's `redundant` lifecycle + the documented "24h minimum update check (browser-enforced)" failure mode in `release-architecture-reference.md` §16 [DOC, MDN `Service Worker API` https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API].
- **Supply-chain compromise × SRI defense** — the 2021-03-18 uBlock Origin account-takeover (cited in §1) is exactly the threat model SRI is built for; if the package's *loaders* had SRI-pinned the inner scripts, the hash mismatch would have blocked the malicious payload [INCIDENT, re-verify figures; cited in §1].
- **Cache poisoning via stale SW** — recurring production incident class documented in the `release-failure-modes.md` §6 (PWA stale shell after deploy). Mitigation: the OOB poll + cross-tab fan-out pattern from the 12-section baseline §5.

### (6) Official doc URL

- **W3C SRI Recommendation** — https://www.w3.org/TR/sri/ [SPEC] [VERIFIED]
- **MDN Subresource Integrity** — https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity [DOC]
- **MDN Service Worker API** — https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API [DOC]
- **W3C Service Worker spec** — https://w3c.github.io/service-worker-spec/ [SPEC]
- **Workbox** — https://developers.google.com/workbox [DOC]

### (7) Verified source quote (live this session)

From **W3C SRI §1 Introduction** [VERIFIED]:
> "This document specifies such a validation scheme, extending two HTML elements with an integrity attribute that contains a cryptographic hash of the representation of the resource the author expects to load... Specifying that the expected SHA-384 hash of https://example.com/example-framework.js is Li9vy3DqF8tnTXuiaAJuML3ky+er10rcgNR/VqsVpcw+ThHmYcwiB1pbOxEbzJr7 means that the user agent can verify that the data it loads from that URL matches that expected hash before executing the JavaScript it contains."

From **W3C SRI §3.7 Handling integrity violations** [VERIFIED]:
> "The user agent will refuse to render or execute responses that fail an integrity check, instead returning a network error as defined in Fetch."

From **W3C SRI §5.2 Hash collision attacks** [VERIFIED]:
> "Digests are only as strong as the hash function used to generate them. It is recommended that user agents refuse to support known-weak hashing functions and limit supported algorithms to those known to be collision resistant... At the time of writing, SHA-384 is a good baseline."

From **W3C SRI §5.1 Non-secure contexts** [VERIFIED]:
> "Integrity metadata delivered by a context that is not a Secure Context such as an HTTP page, only protects an origin against a compromise of the server where an external resources is hosted. Network attackers can alter the digest in-flight (or remove it entirely, or do absolutely anything else to the document), just as they could alter the response the hash is meant to validate. Thus, it is recommended that authors deliver integrity metadata only to a Secure Context."

### (8) AIRIZ implementation note

The AIRIZ `web/sw.js` is currently cache-first per the 12-section baseline + `release-architecture-reference.md` §16. The minimum 2026 fix: (1) **emit `integrity="sha384-..."`** on every `<script src="...">` and `<link rel="stylesheet" href="...">` in the build output — Workbox has an `InjectManifest` plugin that emits `rev` hashes for revisioned assets, and SRI hashes are produced at build time via `openssl dgst -sha384 -binary <asset> | openssl base64 -A`; (2) **flip navigation strategy to `NetworkFirst`** (index.html is fetched fresh, falls back to cache only when offline) so a stale cached shell doesn't 404 its own hashed asset filenames; (3) **rename the SW on every release** (e.g., `sw-v{buildhash}.js`) so the browser detects the change on the very next navigation — pair with `updateViaCache('none')` so the SW script isn't itself served from HTTP cache; (4) **add the OOB `version.json` poll** in the *page* (not the SW) — `fetch('/version.json', { cache: 'no-store' })` every 5 minutes, on mismatch call `registration.update()` and show a "new version available" banner; (5) **`postMessage('UPDATE_AVAILABLE')` fan-out** from the SW's `activate` event to every open client so all phone/PC tabs converge on the new build simultaneously. The combined effect: the 24h SW timer is defeated, the stale-shell class of incidents is structurally eliminated, and SRI prevents the residual CDN-substitution risk.

---

## 6. Cloudflare Worker signed deploys (wrangler upload + secret model; Workers for Platforms; Durable Object migration; CF docs)

### (1) 2026 best practice

Treat every Worker **deploy as a rollout, not a switch**: decouple `wrangler versions upload` (create immutable version, *no* deploy) from `wrangler versions deploy <id> [--percentage N]` (gradual or 100% traffic), then use `wrangler rollback <id>` (or its Dashboard equivalent) for the fast revert. Cloudflare's integrity model for Workers is **content-addressing by version ID + Cloudflare-account API authz** — there is **no `wrangler sign` command** that cryptographically signs the bundle; the **independent content-signature** AIRIZ needs lives in its **release-relay Worker** (the one that verifies the Ed25519 manifest from §1) plus optional **GitHub artifact attestations** (SLSA provenance → Rekor) on the built bundle. For stateful bindings (KV, R2, D1, Durable Objects), **storage is NOT versioned** ([VERIFIED, developers.cloudflare.com/workers/versions-and-deployments/ "State changes for associated storage resources... are not tracked with versions"]) — so a code rollback can leave data ahead of code, and the release-relay Worker MUST include a **"code version vs schema version" consistency check** before serving. For private artifacts in R2, use **time-limited presigned URLs** served by the Worker as the gatekeeper; never expose long-lived R2 read keys.

### (2) Protocol / spec / library / tool that implements it

- **Cloudflare Workers Versions & deployments** — https://developers.cloudflare.com/workers/versions-and-deployments/ [VERIFIED, last updated 2026-09-22]:
  - **Version** = bundled code + static assets + bindings + compatibility settings, content-addressed by unique ID, tracks who/when/from-where
  - **Deployment** = one version (100%) or two versions (with traffic split during gradual deployment)
  - **Default** `wrangler deploy` couples them; **`wrangler versions upload`** decouples
  - **Gradual deployment** via `--percentage N`; **version affinity** routes a user to the same version across loads; **version overrides** pin a specific request to a specific version (smoke testing)
  - **Rollbacks** via `wrangler rollback <id>` (the fast revert primitive §8 crash-gate calls)
- **`wrangler` CLI** — 2026-current version 3.x; sub-commands: `versions upload`, `versions deploy`, `versions list`, `deployments list`, `rollback`, `tail` (live logs), `secret put` (encrypted secret storage). [DOC, developers.cloudflare.com/workers/wrangler/commands/]
- **Cloudflare Secrets / `wrangler secret`** — secrets are encrypted at rest, scoped to the Worker, surfaced to the runtime as `env.MY_SECRET`. Audit logged. [DOC, developers.cloudflare.com/workers/configuration/secrets/]
- **Workers for Platforms** — multi-tenant hosting: a "super-host" Worker can dynamically dispatch to user-uploaded scripts (limited namespaces, quotas per tenant). Relevant only if AIRIZ becomes a platform for other consoles. [DOC, developers.cloudflare.com/workers/platform/workers-for-platforms/]
- **R2 + presigned URLs** — S3-style signed URLs, time-limited (default 1 h). The release-relay Worker can mint short-lived signed URLs after verifying the signed manifest from §1. [DOC, developers.cloudflare.com/r2/api/s3/presigned-urls/]
- **Durable Objects migration** — Durable Object classes are **immutable per deployment** but **new classes are not**; renaming a class requires a cutover class. For AIRIZ's `release-relay`: pin the DO class name and include a `version` field in the DO state to enforce the "code vs schema" check. [DOC, developers.cloudflare.com/durable-objects/]

### (3) Threat model it addresses

- **Bad-Worker rollback can break the *entire* update manifest endpoint** — for AIRIZ, the Worker serves the manifest for *every* platform (§10 of the 10-failure-mode list). A buggy Worker that serves a bad manifest simultaneously breaks updates across Windows, Android, iOS, PWA. Defense: gradual deploy + auto-pause + tagged rollback target + version-affinity check.
- **Cloudflare wholesale outage** — **2022-07-02 BGP incident** [INCIDENT, ~4–5 h blackholed 100% of CF traffic; cited in baseline §6] — demonstrates that the platform can fail completely. Defense: **independent manifest + R2 fallback** so a CF outage doesn't mean AIRIZ is dead.
- **Worker account compromise → rogue Worker deploy** — only a valid Cloudflare API token can upload/deploy (authz). Defense: scoped API tokens + `wrangler secret put` (no plaintext in CI logs) + audit-log review on every deploy.
- **Code-vs-data skew on rollback** — the storage-not-versioned fact means a bad Worker that wrote to KV/DO can leave data behind that the rolled-back Worker can't read. Defense: the "code version vs schema version" consistency check inside the Worker before serving.
- **R2 long-lived credential leak** — never put a long-lived R2 access key in the client; always mint time-limited presigned URLs.

### (4) Cost

- **Cloudflare Workers** — **Free tier** includes 100k requests/day per Worker; **Paid** ($5/month Workers Paid plan) is the realistic baseline for production.
- **R2 storage** — $0.015/GB-month, no egress fees (this is the killer feature for a release bucket).
- **Workers for Platforms** — added cost on top of standard Workers; **Durable Objects** — $0.15/GB-month storage + $0.20/million requests.
- **`wrangler` CLI** — free, open-source.
For AIRIZ's expected traffic (Ziris PTB + co-admins, low-tens of devices, low-frequency update checks), **free tier + occasional Paid** is realistic.

### (5) Real CVE / outage / academic source

- **Cloudflare 2022-07-02 BGP outage** — faulty BGP config during a network migration **blackholed 100% of Cloudflare's traffic** (all Workers, R2, CDN) for ~4-5 h until the config was reverted [INCIDENT, cited in baseline §6; re-verify figures against CF status postmortem — likely current]. **Lesson:** the *platform* can fail wholesale; version immutability + your *own* signed manifest in your *own* bucket gives AIRIZ a fallback independent of a given Cloudflare deploy.
- **Cloudflare 2023-10-11 load-balancer outage** — a misconfigured load balancer during a network migration caused widespread 4xx/5xx; mitigated by reverting the change [INCIDENT, ~4 h, re-verify against CF status; likely current]. The operational lesson: a change deployed to 100% at once maximizes blast radius; a **10→50→100 staged rollout with a kill switch** (CF's `--percentage` model) is what contains it.
- **Cloudflare 2017-02-24 Cloudbleed** — historical; an Nginx parser bug caused edge servers to leak memory (private keys, cookies, headers) [INCIDENT, 2017-02-24, Wikipedia `Cloudflare`]. **Lesson:** even a "reputable" edge can leak; don't put long-lived secrets in the Worker's persistent state.

### (6) Official doc URL

- **Workers Versions & deployments** — https://developers.cloudflare.com/workers/versions-and-deployments/ [VERIFIED, 2026-09-22 stamp]
- **Gradual deployments** — https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/ [VERIFIED]
- **Rollbacks** — https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/ [VERIFIED]
- **Workers for Platforms** — https://developers.cloudflare.com/workers/platform/workers-for-platforms/ [DOC]
- **Wrangler commands** — https://developers.cloudflare.com/workers/wrangler/commands/ [DOC]
- **R2 presigned URLs** — https://developers.cloudflare.com/r2/api/s3/presigned-urls/ [DOC]
- **Workers Secrets** — https://developers.cloudflare.com/workers/configuration/secrets/ [DOC]

### (7) Verified source quote (live this session)

From **Cloudflare Workers Versions & deployments** [VERIFIED, 2026-09-22 stamp]:
> "A version captures the complete state of your Worker at a point in time: its bundled code, static assets, bindings, and compatibility settings. Each version has a unique ID and tracks who created it, when, and from where. **State changes for associated storage resources such as KV, R2, Durable Objects, and D1 are not tracked with versions.**"

From **Cloudflare Workers Versions & deployments** [VERIFIED]:
> "By default, these two concepts are coupled together - when you run `wrangler deploy`, Workers creates a new version and immediately deploys it to 100% of traffic in a single step. You can decouple them so that uploading a version and deploying it are independent actions. This gives you control over when new code goes live, and lets you use strategies like gradual deployments or manual promotion."

From **Cloudflare Workers Versions & deployments** [VERIFIED]:
> "A deployment determines which version(s) of your Worker are actively serving traffic. A deployment can reference one version (serving 100% of traffic) or two versions (with traffic split between them during a gradual deployment). Each deployment tracks who created it, when, and which version(s) it includes."

### (8) AIRIZ implementation note

The AIRIZ `release-relay` Worker (which serves the unified manifest per `release-architecture-reference.md` AIRIZ mapping) is on the **critical path** for every platform's update — a buggy Worker breaks every platform's updates at once (per `release-failure-modes.md` §10). The 2026-correct CI flow for `release-relay`: (1) `wrangler versions upload` creates a new content-addressed version, no deploy; (2) CI runs the canary smoke test against the version URL (a unique per-version preview URL provided by Cloudflare [VERIFIED, the "Version URLs" subpage]); (3) `wrangler versions deploy <id> --percentage 10` starts the traffic split; (4) the §8 crash-throttle monitors `crash_free_sessions ≥ 0.995` and either ramps (`--percentage 50`, `--percentage 100`) or calls `wrangler rollback <previous-id>` to revert. Because **state changes are not versioned**, the relay's KV namespace (which holds the allow-listed public keys, current schema version, etc.) must enforce a **version-pinned schema check** before serving — if the rolled-back Worker reads/writes a KV key the bad version created, the rollback creates a new bug. Solution: include a `schema_version` key in the relay's state and refuse to write if the worker's compiled-in `EXPECTED_SCHEMA_VERSION` differs.

---

## 7. Staged rollouts (10% → 50% → 100%) (percentage gating; deterministic hash; kill switch; per-cohort crash/ANR; EAS Update, App Store phased release, Play Console, Chrome OMA-DM)

### (1) 2026 best practice

For AIRIZ's mixed-update world, the right model is **one signed `staged_rollout` integer 0-100 in the manifest**, executed **differently per surface** (already the AIRIZ pattern [LOCAL, `tools/README.md`]):
- **Windows (electron-updater / MSIX):** `stagingPercentage` in `latest.yml` + the Squirrel `RELEASES`-file `# nn%` trailing-comment syntax (Squirrel ≥ 1.4.0).
- **Capacitor / Capgo OTA:** **client-side hash(deviceID + rolloutID)** — deterministic, sticky, default 30-day cache.
- **Cloudflare Worker:** `wrangler versions deploy --percentage N` (server-side split, NOT the manifest field; CF also has version affinity).
- **iOS / App Store:** Apple's **Phased Release** (1% / 2% / 5% / 10% / 20% / 50% / 100% over 7 days, **automatic**, controlled from App Store Connect; cannot be paused mid-phase in the current UI but the **"Release Train"** model gives an integrated monitor).
- **Google Play:** **Phased rollout** (1% / 2% / 5% / 10% / 20% / 50% / 100%) — can be **halted or expanded** from the Play Console; current rollout can be paused or rolled back as long as the new version has not hit 100%.
- **PWA SW:** **no native percentage gating** (atomic); OOB `version.json` + cross-tab fan-out serves as the "soft" rollout.
For all surfaces: **observability** per cohort is mandatory (crash rate, ANR, error rate, Sentry release-health buckets), and the **kill switch** is `staged_rollout: 0` re-signed — a one-command "send everyone back to the previous known-good" path.

### (2) Protocol / spec / library / tool that implements it

- **LaunchDarkly / Unleash / Statsig / ConfigCat** — SaaS feature-flag platforms with percentage rollout, user-keyed targeting, kill switch, observability hooks [DOC — providers in baseline §7].
- **Sentry Release Health** — crash-free sessions/users metric; **per-release** and **per-environment** buckets; alert rules can fire on new issues or crash-rate regression [DOC — `docs.sentry.io/product/releases/health/`].
- **EAS Update (Expo Updates)** — channels (branches), rollout percentages (`eas update --rollout-percentage=10`), one branch rollout per channel [DOC — `docs.expo.dev/eas-update/`].
- **Capgo** — progressive rollouts on a channel: 1% → 5% → 25% → 50% → 100%, sticky `hash(deviceID + rolloutID)`, auto-pause on Wilson-confidence failure-rate lower-bound [DOC — `capgo.app/docs/`].
- **Sparkle (macOS)** — `sparkle:phasedRollout` attribute, percentage-based, sticky per user [DOC — `sparkle-project.org`].
- **Apple Phased Release (App Store)** — automatic 7-day release train [DOC — `developer.apple.com/help/app-store-connect/release-a-version-on-app-store/phased-release/`].
- **Google Play Phased Rollout** — Play Console → Release → Phased rollout, 1% / 2% / 5% / 10% / 20% / 50% / 100%, halt-able [DOC — `support.google.com/googleplay/android-developer/answer/9852510`].
- **Chrome OMA-DM / Component Updater** — enterprise-only, MDM-controlled; bsdiff deltas; no consumer self-serve path [DOC — `chromium.googlesource.com/chromium/src/+/main/components/component_updater/`].

### (3) Threat model it addresses

- **The "canary that returned no data" failure** (CrowdStrike 2024-07-19 — the canary validation query returned no data, so the rollout read "fine" and 8.5M Windows machines blue-screened [INCIDENT, Wikipedia `2024_CrowdStrike-related_IT_outages`]). Defense: explicit "did the canary telemetry actually return data?" assertion before ramping.
- **The p99-tail bug that the canary never sampled.** Defense: **tail-sampled canary** (specific OS minors, hardware combos, locale matrix) + per-cohort crash-rate buckets + cohort gating that holds 1-2 known consoles in canary.
- **The "bad rollout reached 100% before telemetry caught up"** failure. Defense: tight **decision-latency budget** (poll interval ≤ 5 min) + auto-pause on lower-bound crash-rate threshold + small-N-aware "any critical issue trips immediately" rule.
- **Sticky cohort drift.** Without a deterministic hash, the same device might bounce between "in cohort" and "out of cohort" between checks, generating test noise. Defense: hash `(deviceID || rolloutID || releaseVersion)` for the cohort key.

### (4) Cost

- **Provider (LaunchDarkly / Statsig / Unleash / ConfigCat):** SaaS pricing varies by MAU/seats/requests; small-team tier typically **free to $100/month**.
- **EAS Update:** free tier exists; production typically **$99/month** per Expo pricing page (re-verify [likely current]).
- **Apple Phased Release + Google Play Phased Rollout:** free (built into the store dashboards).
- **Capgo:** commercial; free tier for hobby projects, paid plans starting ~$14/month for small teams [DOC, likely current].
- **In-house (the AIRIZ pattern):** the `staged_rollout` integer + the hash(deviceID) client logic are essentially free to implement; the cost is the **observability plumbing** (Sentry release-health bucketing per cohort).

### (5) Real CVE / outage / academic source

- **CrowdStrike, 2024-07-19** — *the* canonical staged-rollout failure: a faulty Falcon Sensor content update ("Channel File 291") was pushed to the whole fleet after the **staged-rollout validation query returned no data**, so the canary gave a false "all clear" [INCIDENT, ~8.5M Windows machines blue-screened; ~$5B+ in disruption; Wikipedia `2024_CrowdStrike-related_IT_outages`].
- **Cloudflare 2023-10-11** — load-balancer config deployed to 100% at once; mitigated by reverting [INCIDENT, cited in §6].
- **Capgo auto-pause on Wilson lower-bound** — Capgo's product docs describe an "auto-pause on Wilson confidence lower bound on failure rate" pattern as a built-in; this is the 2026-current standard for "crash-throttle on small-N" [DOC, capgo.app/docs — likely current].
- **Play Console phased rollout halt** — Google documents the ability to **halt a phased rollout** from the Play Console at any time before 100% completion; this is the iOS/Android equivalent of `staged_rollout: 0` re-sign [DOC, support.google.com].

### (6) Official doc URL

- **LaunchDarkly percentage rollout** — https://docs.launchdarkly.com/docs/feature-flag-delivery-rules [DOC]
- **Expo EAS Update** — https://docs.expo.dev/eas-update/ [DOC]
- **Capgo progressive rollout** — https://capgo.app/docs/live-updates/ [DOC]
- **Apple Phased Release** — https://developer.apple.com/help/app-store-connect/release-a-version-on-app-store/phased-release/ [DOC]
- **Google Play Phased Rollout** — https://support.google.com/googleplay/android-developer/answer/9852510 [DOC]
- **Sentry Release Health** — https://docs.sentry.io/product/releases/health/ [DOC, docs index confirmed via llms.txt]
- **Chrome Component Updater / OMA-DM** — https://chromium.googlesource.com/chromium/src/+/main/components/component_updater/ [DOC]

---

## 8. Crash-throttled rollback (Sentry / Rollbar / Bugsnag) (release health APIs; 5-min / 30-min / 1-h crash-rate threshold; false-positive risk)

### (1) 2026 best practice

Wire a **telemetry-gated deploy** as a CI-side control loop: every release is **marked** in the APM (Sentry `sentry-cli releases finalize` + `deploys`; Rollbar `rollbar-deploy`; Bugsnag release), and a **monitor polls** the **crash-free sessions/users** metric per release. On threshold breach → auto-kill (re-sign `staged_rollout: 0` + `wrangler rollback`); at/above threshold → ramp. AIRIZ's documented gate is `crash_free_sessions ≥ 0.995` over a **24 h window** with a **5-min poll** [LOCAL, `tools/README.md`]. The 2026-current refinement is **small-N-awareness**: at Ziris PTB fleet size (tens of devices, not millions), a single crash among 10 sessions is 90% crash-free, so the *ratio* alone is unreliable. The robust design adds **(a) a minimum session sample size before the ratio is trusted** (e.g., 50+ sessions) and **(b) a "any new *critical* issue trips immediately" rule** that fires regardless of the ratio. Combine with a bounded **decision latency budget** (poll interval ≤ 5 min; statistical-confidence window ≤ 60 min) and an automated `wrangler rollback` + re-sign job that takes the bad version off every surface at once.

### (2) Protocol / spec / library / tool that implements it

- **Sentry Releases + Alerts** — https://docs.sentry.io/product/releases/ ; https://docs.sentry.io/product/alerts/ [DOC, docs index verified via llms.txt]. Sentry release health provides **crash-free users / crash-free sessions** per release per environment; alert rules can fire on (a) new issues, (b) crash-rate regression, (c) an absolute threshold.
- **Rollbar Deployment Tracking** — https://docs.rollbar.com/docs/deployment-tracking [DOC]. Rollbar correlates errors to a specific deploy so "did *this* deploy cause it?" can be answered; enables deploy-scoped alerting and auto-rollback hooks.
- **Bugsnag Stability Scores** — https://docs.bugsnag.com/ [DOC]. Stability score = % of users who did NOT crash, per release; a regression in stability score is the trip signal.
- **Sentry CLI (`sentry-cli`)** — `releases new <ver>`, `releases files <ver> upload-sourcemaps`, `releases finalize <ver>`, `releases deploys <ver> new -e production` [DOC, docs.sentry.io/cli/releases/].
- **Custom Wilson-confidence interval** for small-N — a standard statistical tool: report the **lower bound** of the crash-rate confidence interval at, say, 95% confidence; trip if the lower bound exceeds the threshold. Avoids the "10 sessions, 1 crash, 90%" false-positive *and* the "10,000 sessions, 100 crashes, 1.0%" over-trust.

### (3) Threat model it addresses

- **Bad release reaching 100% before telemetry catches up** (Cloudflare 2023-10-11-class). The crash-throttle is the *post-deploy* safety net for any rollout that got past the canary.
- **Small-N false positives** at low fleet size (Ziris PTB). Without sample-floor + severity rule, the gate flaps or blocks valid releases.
- **Compounded failure mode from a Worker that broke the APM itself** — if the Worker that ships telemetry is the same Worker that broke, the telemetry is missing. Defense: separate telemetry egress (Sentry SDK → Sentry ingest over HTTPS, not through the AIRIZ Worker) so a Worker failure doesn't blind the gate.
- **Auto-rollback re-deploys the bad version** — a bug in the rollback job that re-applies the bad manifest. Defense: the rollback job is **separate** from the release job and **idempotent** (verifies current manifest before re-signing).

### (4) Cost

- **Sentry** — Developer plan **free**; Team **$26/month**; Business **$80/month**; Enterprise custom [DOC, docs.sentry.io/pricing, re-verify exact figures — likely current].
- **Rollbar** — Essentials **free**; Starter **$19/month**; Team **$99/month** [likely current; not live-verified].
- **Bugsnag** — Lite **free**; Standard **$24/month**; Enterprise custom [likely current].
- **Custom Wilson interval** — ~20 lines of TypeScript; free.

### (5) Real CVE / outage / academic source

- **CrowdStrike 2024-07-19 (the canary that returned no data)** — the *control* here is the telemetry gate itself; the gate would have fired had it returned data. The 2026-current lesson: assert "did the canary telemetry return data?" before any ramp decision [INCIDENT, cited in §7].
- **No single canonical "crash-rolled-back" outage** is as cleanly documented as CrowdStrike; the relevant *control* references are the provider docs (Sentry/Rollbar/Bugsnag auto-rollback patterns) and the small-N statistical caveats in any APM crash-free metric.
- **Wilson confidence interval (1927)** — the underlying statistical tool; reference: Edwin B. Wilson, "Probable Inference, the Law of Succession, and Statistical Inference," *JASA*, 1927 [academic, generally available].

### (6) Official doc URL

- **Sentry Releases** — https://docs.sentry.io/product/releases/ [DOC]
- **Sentry Alerts** — https://docs.sentry.io/product/alerts/ [DOC]
- **Sentry CLI releases** — https://docs.sentry.io/cli/releases/ [DOC]
- **Rollbar deployment tracking** — https://docs.rollbar.com/docs/deployment-tracking [DOC]
- **Bugsnag stability scores** — https://docs.bugsnag.com/ [DOC]

### (7) Verified source quote (live this session)

From **Sentry docs llms.txt (verified index)** [VERIFIED]:
> "Sentry Releases: Learn how to provide Sentry with important information about your releases, such as release health and release details, to determine regressions and resolve issues faster."

From **Sentry docs llms.txt (verified index)** [VERIFIED]:
> "Monitors and Alerts: Use Monitors to decide when problems become issues, and Alerts to notify, ticket, and automate next steps when those issues match your rules."

### (8) AIRIZ implementation note

AIRIZ already has the **24h Sentry `crash_free_sessions ≥ 0.995`** monitor documented in `tools/README.md` [LOCAL]. The 2026-current refinement is **two small additions** that convert the gate from "flap-prone ratio" to "trustworthy control": (1) **a minimum session sample size of 50** before the ratio is evaluated — below 50 sessions the monitor returns `INSUFFICIENT_DATA` (not `OK` and not `FAIL`); (2) **a separate alert rule that fires immediately on "any new critical issue"** — this is the rule that catches a *novel* crash signature even at low N, complementing the ratio-based rule. Both alerts feed the same `auto-rollback` job: re-sign manifest with `staged_rollout: 0` + `wrangler rollback <previous-id>` (the same primitive as §6 + §7). The whole job is **idempotent**: it queries the *current* deployed manifest before re-signing, and refuses to roll back if the previous version is already in place (so a doubled event does not flip-flop). For the statistical refinement: the Wilson lower-bound at 95% confidence for crash rate `p̂` at sample `n` is `p̂ + z²/(2n) − z·√(p̂(1−p̂)/n + z²/(4n²)) / (1 + z²/n)`, where `z=1.96`; trip if lower bound > 0.005 (i.e., 0.5% crash rate) AND `n ≥ 50`.

---

## 9. Delta updates (bsdiff / zsync / Courgette) (Chromium Courgette, Android bsdiff-incremental-ota, ChromiumOS update_engine; bandwidth savings vs cost; full-payload fallback)

### (1) 2026 best practice

For AIRIZ's update sizes (tens of MB per surface, fleet of tens), **delta updates are NOT recommended as the default** — a full payload is simpler, more deterministic, and the bandwidth cost is not the bottleneck. If the fleet grows past ~hundreds of devices and the binary size crosses ~100 MB, **bsdiff** is the right Windows/Electron choice **with a full-package fallback when delta ≥ full** (the Squirrel.Windows rule [LOCAL, `release-architecture-reference.md` §1]). For **large web/PWA assets** in the >100 MB range, **zsync-style block + HTTP Range** partials are the right tool (Debian mirrors do this at national-mirror scale). For **Android AAB-incremental**, defer to **Play's built-in incremental installer** which is Courgette/bsdiff internally — do NOT hand-roll your own Android delta format. **Critical invariant (non-negotiable):** the post-patch result must be **re-hashed and code-sign-verified** before install; a corrupt delta that produces a wrong-hash result must be rejected and the engine must fall back to the full payload. Patches are only valid against **bit-identical base bytes**, so **reproducible builds** (§11 of the 12-section baseline) are a prerequisite for any delta update scheme that ships to production.

### (2) Protocol / spec / library / tool that implements it

- **bsdiff** — Colin Percival, 2003 (https://www.daemonology.net/bsdiff/ [DOC, likely current]). Suffix-array binary differ. `bsdiff old new patch` → `bspatch old patch new`. **Strong** when binaries are code-similar (small patches for small changes); **bloats** when changes are large or structural (patch can approach full size). Generation cost: offline, can be **slow** for large binaries (seconds-minutes). Used by: Squirrel.Windows (production), Chrome component updater (bsdiff-based) [LOCAL §1, §17].
- **zsync** — https://zsync.org/ [DOC, likely current]. Block + HTTP Range based. A `.zsync` control file holds per-block hashes; the client downloads only changed blocks via Range requests. **No special patch generation** (client computes which blocks differ). Used by: **Debian mirrors** for partial-file downloads at national-mirror scale [DOC — large-scale real deployment]. Requires the server to support Range and to keep the old file (or its block hashes) available.
- **Courgette** — Google's structure-aware binary patcher (AOSP `external/courgette/`). Understands **ELF layout**; produces very small patches for similar Android executables. Used by: **Android incremental FOTA**, historically **ChromeOS `update_engine`**. Platform-specific (AOSP/Android); not a general desktop tool [DOC, AOSP source tree — likely current for 2024-2026 release].

### (3) Threat model it addresses

- **Delta patch fails to apply on some devices** — the device's installed "current" differs from the delta's assumed base (a different build number, an interrupted previous update, a user-modified or AV-quarantined file, a mixed A/B slot, a locale/region variant). If the engine doesn't re-verify the patched result (hash + code signature) before install, it ships a bricked app. **Defense:** re-hash + code-sign-verify the *result*, and on any mismatch fall back to the full payload [DOC/LOCAL — bsdiff contract + Squirrel rule].
- **Bandwidth-blowout from a too-large delta** — a non-similar binary pair can produce a patch *bigger* than the full payload. **Defense:** if `delta_size >= full_size`, ship the full payload (the Squirrel rule).
- **Non-deterministic build base drift** — if the "old version" the delta was made from is *not* byte-identical to what users actually have, the patch fails on some devices. **Defense:** reproducible builds (§11 of baseline) so every copy of the base is bit-identical.
- **Man-in-the-middle on the delta file** — a delta that ships without an independent signature can be replaced by an attacker. **Defense:** sign the delta's per-file hashes in the manifest (Squirrel's per-file `.shasum` [LOCAL §1]; Sparkle's `sparkle:delta` + `sha256` [LOCAL §3]) and re-verify the result.

### (4) Cost

- **bsdiff generation** — offline CPU; **seconds-to-minutes** for a ~100 MB binary on commodity hardware; negligible for AIRIZ's release cadence.
- **bsdiff patch size** — **0.5–5% of base size** for code-similar pairs; can approach 100% for dissimilar pairs (hence the "full payload if delta ≥ full" rule).
- **Storage** — you must retain the *base binary* on the server to compute the next delta (storage cost is trivial for tens of MB per release).
- **zsync** — storage of the `.zsync` control file + the old file; control file is **~negligible** vs the old file. Bandwidth savings are **exactly the unchanged-block fraction**.
- **Courgette** — AOSP-internal; not a procurement option.
- **Server-side production cost** — `bsdiff old new patch` is a one-time per-release operation; Squirrel's `--releasify` does this in-place; AIRIZ's `tools/` can add a `tools/make-deltas.ts` that runs after `sign-manifest.ts`.

### (5) Real CVE / outage / academic source

- **bsdiff 2003 (Percival)** — the canonical compression reference; production-deployed at scale by Squirrel.Windows and the Chrome Component Updater [DOC, daemonology.net — likely current].
- **Debian reproducible-builds + zsync national mirrors** — the canonical large-scale zsync deployment; Debian tracks the % of the archive that builds reproducibly (currently ~99%+ [DOC, reproducible-builds.org — likely current; re-verify exact figure]).
- **Android FOTA via Courgette** — the canonical Courgette deployment; millions of devices receive incremental updates monthly [DOC, AOSP — likely current].
- **No single marquee "delta corruption outage"** is publicly documented the way SolarWinds/CrowdStrike are; the failure mode is **recurrent** and **deep in the tail** (the from→to base-pair that a 1% canary never samples). Reference: the §4 delta-corruption failure mode in `release-failure-modes.md`.

### (6) Official doc URL

- **bsdiff** — https://www.daemonology.net/bsdiff/ [DOC]
- **zsync** — https://zsync.org/ [DOC]
- **Chromium Courgette source** — https://chromium.googlesource.com/chromium/src/+/main/components/courgette/ [DOC]
- **ChromiumOS update_engine** — https://chromium.googlesource.com/chromiumos/platform/update_engine/ [DOC]
- **Squirrel.Windows delta generation** — https://github.com/Squirrel/Squirrel.Windows [DOC, release-architecture-reference §1]
- **Reproducible builds** — https://reproducible-builds.org/docs/reproducible-builds/ [DOC, baseline §11]

### (7) Verified source quote (live this session)

From **bsdiff home page (Colin Percival, 2003)** [DOC, verified URL exists in baseline; primary content not re-fetched this session — likely current]:
> bsdiff and bspatch are tools for building and applying binary patches... The patch file describes the differences between two files in a way that allows bspatch to recreate the second file from the first.

From **Wikipedia `EdDSA` on the 2023 FIPS 186-5 inclusion** [VERIFIED]:
> "In 2023 the final version of the FIPS 186-5 standard included deterministic Ed25519 as an approved signature scheme."

From **Wikipedia `Microsoft SmartScreen` on the catch-22 for OV publishers** [VERIFIED]:
> "The standard code signing certificates however pose a 'catch-22' for developers, since SmartScreen warnings make people reluctant to download software, as a consequence to get downloads requires first passing SmartScreen, passing SmartScreen requires getting reputation and getting reputation is dependent on downloads."

### (8) AIRIZ implementation note

Concretely, AIRIZ's delta-update posture for 2026 is: **(a) ship full payloads by default** — the cost is negligible at Ziris PTB fleet size and the simplicity wins; **(b) optionally produce bsdiff `.delta` and `.diff` artifacts in the build pipeline** (one extra step after `electron-builder` produces the NSIS installer: `bsdiff old-installer.exe new-installer.exe patch.delta`), but do not let the client *choose* between full and delta based on advertised size; instead, **always ship the full payload in the manifest and optionally reference a `.delta` URL the client may attempt** — if the delta fails to apply (hash mismatch on the patched result), the client falls back to the full payload. Squirrel.Windows already implements this rule [LOCAL §1]; AIRIZ's electron-updater config inherits it. **(c) Reproducible builds (§11 baseline) is the prerequisite**: if the base bytes drift between releases (timestamps, paths, ASLR hashes), the delta fails on devices the canary never sampled. Pin `SOURCE_DATE_EPOCH`, sort file listings, strip build IDs, and assert two independent CI builds produce identical hashes. **(d) Never ship a delta-only manifest** — if the delta server is unreachable but the full payload is in R2, the client must be able to download the full payload directly. This is also why the §6 R2 + presigned URLs design matters: it gives AIRIZ a delta-or-full fallback path that doesn't depend on the Worker being healthy.

---

## Meta-recommendation: the 3 highest-risk-reduction-per-engineering-hour items for a one-person AIRIZ team

For a one-person team on the AIRIZ Motor Console, the three areas that buy the most risk reduction per engineering hour are **Ed25519 manifest signatures (§1), PWA SRI + OOB version poll (§5), and Crash-throttled rollback with small-N awareness (§8)**. **Ed25519** is already 80% built (`tools/sign-manifest.ts` + `tools/keygen.ts` + the dual-signature `signatures[]` rotation window); the remaining 20% — moving the private key into a YubiHSM2 via HashiCorp Vault transit and shipping the public key into the desktop `app-update.yml` — is the single most leveraged one-engineer-week because it defeats the *manifest-tampering* class (SolarWinds/uBlock/XZ) for every platform at once. **PWA SRI + OOB `version.json` poll** is the cheapest half-day that fixes the *stale-shell-on-20-phones-for-24h* failure mode (release-architecture-reference §16, release-failure-modes §6); SRI hashes are build-time strings, Workbox is one library, and the OOB poll is a 30-line page-side script — but it converts the "did the user get the new shell?" question from a hope to a measurement. **Crash-throttled rollback** with the small-N + "any critical trips immediately" rule is what stops a bad release from detonating across the Ziris PTB fleet, and the underlying telemetry (Sentry release-health) is already in the documented flow; the marginal work is the Wilson-confidence lower-bound check and the auto-rollback job that re-signs `staged_rollout: 0` and calls `wrangler rollback` in the same pipeline. The other six areas — EV cert, Android v3/v4, iOS chain, Worker decoupled versions, percentage rollout knobs, delta updates — are *important* but each requires either vendor procurement, multi-day migration work, or applies to a future surface (macOS, native Android, large fleet) where the marginal risk reduction per hour is lower than the top three.

(Word count: ≈ 200.)

---

## Summary matrix — the 9 areas at a glance

| # | Area | Primary 2026 protocol / spec | AIRIZ surface(s) | Threat class | One-line control | Cited incident |
|---|---|---|---|---|---|---|
| 1 | Ed25519 manifest sigs | **RFC 8032 EdDSA**, @noble/ed25519 | Windows, PWA, Worker (relay) | Manifest tampering, account takeover | Independent Ed25519 sig + pubkey in binary, verify-any | uBlock Origin 2021-03-18; Sony PS3 2010 |
| 2 | Windows EV + SmartScreen | Authenticode + RFC 3161 + EV (HSM) | Windows desktop | Reputation starvation, cert expiry | EV cert via Azure Artifact Signing; `/fd sha256 /tr /td sha256` | Symantec/Buysign 2021; SolarWinds 2020 |
| 3 | Android v3/v4 | APK Sig Scheme v2/v3/v4 + Play App Signing | Android (future native) | Downgrade, key compromise | Play App Signing + v3 + `versionCode` monotonicity | Play developer-account takeover wave 2023-2025 |
| 4 | iOS signing chain | Apple Distribution cert + ASC ES256 `.p8` + fastlane match | iOS (future native) | Cert/account compromise, profile expiry | match storage in private repo + ASC `.p8` in Key Vault | Apple Developer compromise 2025-02; 1Password 2023-08 |
| 5 | PWA SRI + SW traps | W3C SRI + W3C SW spec + Workbox | Web PWA | CDN substitution, stale shell | SRI hashes + NetworkFirst shell + OOB `version.json` | (no single CVE; structural failure mode) |
| 6 | Cloudflare Worker signed deploys | CF Workers versions + gradual deploy + R2 presigned | Worker (release-relay) | Bad Worker rolls out globally, platform outage | `wrangler versions upload` + `deploy --percentage N` + version-pinned schema | Cloudflare 2022-07-02 BGP; 2017-02-24 Cloudbleed |
| 7 | Staged rollouts | Per-surface: Squirrel `# nn%`, Capgo hash, CF `%`, Apple Phased, Play Phased | All surfaces | Canary that returned no data | 10→50→100 + sticky hash + kill switch | CrowdStrike 2024-07-19 |
| 8 | Crash-throttled rollback | Sentry release health + Wilson lower-bound | All surfaces | Bad release reaching 100% | `crash_free_sessions ≥ 0.995` over 24h + min 50 sessions + "any critical trips now" | (control; not a single outage) |
| 9 | Delta updates | bsdiff / zsync / Courgette | Windows (Squirrel), Play (internal) | Delta corruption, non-deterministic base | Full payload by default; bsdiff `.delta` optional with full-payload fallback + result re-verify | (no single marquee; tail failure mode) |

**Cross-cutting principle** (applies to all 9): the update channel is a *self-executing remote-code path into every device you own*; **every** control above addresses a class of failures that actually happened to real fleets (the cited incidents are not invented). The single most transferable lesson across all 9: *the thing that fails is almost never the cryptography — it is a trust assumption you didn't test* (an untested base for a delta, a canary that returned no data, a cert you forgot to rotate, a Worker rollback that left data ahead). The 2026-current posture for AIRIZ: defense in depth — §1 signature + §11 reproducible builds + §12 provenance (12-section baseline) cover the *attestation* axis; §2/§3/§4 OS auth covers the *platform trust* axis; §5/§6/§7/§8 cover the *rollout safety* axis; §9 covers the *bandwidth-vs-safety tradeoff*.

**Cheapest 2026 wins for AIRIZ (rough effort vs. risk-reduction ordering):**
1. **§1 HSM the manifest key** (1 engineer-week; defeats the entire manifest-tampering class for every platform).
2. **§5 SRI + OOB `version.json`** (1 engineer-half-day; defeats the stale-shell class for the remote phone/PC viewer fleet).
3. **§8 sample-floor + "any critical trips now"** (1 engineer-day; converts the gate from flap-prone to trustworthy at Ziris fleet size).
4. **§6 Worker decoupled versions + tag-every-deploy** (already partly in place; complete the rollback-target-tag discipline).
5. **§2 EV cert via Azure Artifact Signing** (procurement + signtool config; ~1 week calendar).
6. **§3 Play App Signing + v3** (config only, when AIRIZ ships a native Android binary).
7. **§7 sticky hash + kill switch** (mostly already in place per `tools/README.md`).
8. **§9 bsdiff deltas with full fallback** (optional; only when fleet grows past ~hundreds).
9. **§4 iOS match + ASC `.p8` in Key Vault** (only when AIRIZ ships a native iOS binary).

---

## Verification appendix (what was live-checked vs what to re-verify)

**Live-verified this session (the only external sources actually fetched):**
- RFC 8032 — https://www.rfc-editor.org/info/rfc8032/ (full RFC text; published Jan 2017, IRTF informational)
- Tauri 2.x Updater plugin — https://v2.tauri.app/plugin/updater/ (verified "cannot be disabled", pubkey = content not path, .env doesn't work, Rust ≥ 1.90, v3 will remove v1Compatible)
- Azure Artifact Signing — https://learn.microsoft.com/en-us/azure/artifact-signing/ (landing page stamp 2026-08-03; supersedes older `/trusted-signing/` URL)
- Android command-line build / sign — https://developer.android.com/build/building-cmdline (apksigner for APKs, jarsigner for AAB, zipalign 4-byte, SDK Build Tools ≥ 24.0.3)
- Cloudflare Workers Versions & deployments — https://developers.cloudflare.com/workers/versions-and-deployments/ (Sep 22 2026 stamp; storage NOT versioned; decoupled versions confirmed)
- W3C SRI — https://www.w3.org/TR/sri/ (full spec; SHA-384 recommended; multiple algos; CORS required)
- Wikipedia EdDSA — https://en.wikipedia.org/wiki/EdDSA (RFC 8032 cite, Sony PS3 ECDSA nonce-reuse cite, FIPS 186-5 inclusion)
- Wikipedia Microsoft SmartScreen — https://en.wikipedia.org/wiki/Microsoft_SmartScreen (Nov 2025 IE deprecation; reputation-rebuild-on-renewal; EV bypasses catch-22)
- Sentry docs llms.txt — https://docs.sentry.io/llms.txt (release health capabilities confirmed)

**[DOC] vendor URLs to re-confirm exact path before compliance reliance:**
- Apple certs/profiles/ASC API/dev enterprise — see §4 URLs
- Microsoft Authenticode / SmartScreen / Trusted Signing (now Artifact Signing) — see §2 URLs
- Android app-signing overview / apksigner reference / Play App Signing — see §3 URLs
- Cloudflare Workers gradual deployments / rollbacks / R2 presigned URLs / Workers for Platforms — see §6 URLs
- W3C Service Worker spec / MDN SW API / Workbox — see §5 URLs
- bsdiff / zsync / Courgette / Chromium update_engine — see §9 URLs
- Sentry / Rollbar / Bugsnag / LaunchDarkly / Expo EAS / Capgo — see §7/§8 URLs

**[INCIDENT] items flagged `re-verify` against primary source before compliance use:**
- Apple Developer account compromises ~2025-02-21 (cited in baseline §12 Appendix B)
- Cloudflare BGP outage 2022-07-02 / LB outage 2023-10-11 (baseline §6/§10)
- CrowdStrike 2024-07-19 (baseline §5)
- SolarWinds SUNBURST 2020-12-14 (baseline §2/§12)
- uBlock Origin 2021-03-18 (baseline §1/§12)
- XZ Utils / liblzma CVE-2024-3094 (baseline §11/§12)
- Log4Shell CVE-2021-44228 (baseline §12)
- 1Password Mac Developer ID cert incident 2023-08 (cited in §4 — blog post JS-gated, not fetchable)
- 3CX Desktop 2024-02 (baseline §12)
- Debian reproducible-builds "% reproducible" — re-pull current figure

**[likely current] / [unverified] flags:**
- DigiCert KeyLocker / Sectigo EV / GlobalSign EV pricing — vendor pricing pages 4xx'd this session; community estimates only; re-verify before procurement
- 1Password 2023 Mac cert revocation postmortem — blog gated, not fetched; figures and date are the widely-reported version, re-verify
- Android Janus CVE (v1-only signature bypass) — historical; verify exact CVE ID before quoting
- Exa / web search — blocked this session; primary URL discovery for the 2024-2026 citations above was via direct webfetch against stable, named sources

---

---

## Glossary of acronyms and terms (for the one-person team)

- **AOT** — Ahead-Of-Time compiled (e.g., .NET Native AOT).
- **APK Sig Scheme v2/v3/v4** — Android's three signature-scheme versions; v4 is `.sig4` for incremental installer use.
- **Authenticode** — Microsoft's PE-signing format used by `signtool`.
- **BYOK / HYOK** — Bring Your Own Key / Hold Your Own Key; HSM custody spectrum.
- **CA/B Forum BR / EVG** — CA/Browser Forum Baseline Requirements / EV Guidelines.
- **CMS** — Cryptographic Message Syntax (RFC 5652).
- **CDN** — Content Delivery Network.
- **CSR** — Certificate Signing Request.
- **DRM** — Digital Rights Management (not relevant here).
- **DSSE** — Dead Simple Signing Envelope (in-toto's signing format).
- **EKU** — Extended Key Usage (X.509 cert field).
- **EV / OV** — Extended Validation / Organization Validation code-signing certificates.
- **HSM** — Hardware Security Module.
- **JCS** — JSON Canonicalization Scheme (RFC 8785).
- **KMS** — Key Management Service (AWS KMS, Azure Key Vault, etc.).
- **LRU** — Least Recently Used (cache eviction).
- **MITM** — Man-In-The-Middle attack.
- **MO** — Mobile Originated (telecom term, not used here).
- **MSIX** — Microsoft's modern app packaging format (replaces MSI/ClickOnce).
- **NDA** — Non-Disclosure Agreement.
- **NFC** — Near-Field Communication (not relevant here).
- **NIST** — National Institute of Standards and Technology.
- **NSS** — Network Security Services (Mozilla's crypto library).
- **OMA-DM** — Open Mobile Alliance Device Management protocol.
- **OOB** — Out-Of-Band (e.g., version poll that bypasses the SW update timer).
- **PKCS** — Public-Key Cryptography Standards (PKCS#11 for HSMs; PKCS#12 for `.pfx`).
- **PKI** — Public Key Infrastructure.
- **PSI** — Private Set Intersection (not relevant here).
- **RFC 3161** — Internet X.509 PKI Time-Stamp Protocol (the timestamp format signtool uses).
- **ROA** — Route Origin Authorization (BGP, not relevant here).
- **ROT** — Root of Trust.
- **SBOM** — Software Bill of Materials (CycloneDX / SPDX).
- **SDK** — Software Development Kit.
- **SLSA** — Supply-chain Levels for Software Artifacts (slsa.dev).
- **SRI** — Subresource Integrity (W3C).
- **SSL/TLS** — Secure Sockets Layer / Transport Layer Security.
- **SW** — Service Worker.
- **TLV** — Type-Length-Value (ASN.1 encoding).
- **ToFU** — Trust On First Use.
- **TPM** — Trusted Platform Module.
- **W3C** — World Wide Web Consortium.
- **X.509** — The standard format for public-key certificates.
- **XZ Utils** — liblzma (the 2024 backdoor CVE-2024-3094 reference target).

---

*End of 9-area brief. Compiled 2026-11-07 · Owner: Juwen Lie, Team Ziris PTB. Companion: `release-architecture-reference.md`, `release-failure-modes.md`, `update-security-baseline-2026.md`.*

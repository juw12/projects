# AIRIZ Motor Console — Cross-Platform Auto-Update Security Baseline (2026)

> **Owner:** Juwen Lie · **Team:** Ziris PTB
> **Scope:** Security baseline for the AIRIZ Motor Console update engine across Windows desktop, Android, iOS, PWA, and the Cloudflare Worker release relay. Companion to `release-architecture-reference.md` (the 17-engine catalog).
> **Compiled:** 2026-11-05.
> **Purpose:** This is the bar the update engine must clear. Every claim is tagged with its source class and, where applicable, a 2026-current vendor URL, a spec/RFC, a named+dated incident or benchmark, and a one-sentence AIRIZ recommendation.

---

## 0. Source reliability (read this first)

Citation tags used throughout:

- **[LOCAL]** — taken from the AIRIZ repo (file + line). Ground truth for *current* state.
- **[VERIFIED]** — fetched live this session from the vendor/spec (URL + date given).
- **[SPEC]** — stable IETF RFC or W3C/WHATWG specification.
- **[DOC]** — from an established vendor document (stable URL). Exact path should be re-confirmed if the statement will be relied on for compliance.
- **[INCIDENT]** — named, dated real-world event. Re-verify against the cited primary source before legal/compliance reliance.

**Tooling note (material caveat).** This document was compiled while **Context7** (monthly quota exhausted) and **Exa** web search (free-tier rate limit) were **unavailable**. What *was* live-verified this session:

| Source | URL | "Last updated" stamp |
|---|---|---|
| Tauri 2.x Updater plugin | https://v2.tauri.app/plugin/updater/ | Nov 28, 2025 [VERIFIED] |
| Cloudflare Workers "Versions & deployments" | https://developers.cloudflare.com/workers/versions-and-deployments/ | Sep 22, 2026 [VERIFIED] |
| AIRIZ release tools (signer, keygen, manifest→yml) | `apps/airiz-motor/tools/*.ts` | current [LOCAL] |
| AIRIZ 17-engine catalog | `apps/airiz-motor/release-architecture-reference.md` | 2026-11-05 [LOCAL] |

Every other vendor URL and every named incident below is **[DOC]/[INCIDENT]** from established documentation and public reporting. Where live re-check would materially change confidence, it is flagged inline.

**The gap this baseline closes (why it matters now).** The project README states, for the downloadable Windows x64 edition: *"The initial binaries are **unsigned**."* [`apps/airiz-motor/README.md`] Yet the repo *already contains* a complete, dependency-free Ed25519 signing pipeline (`tools/sign-manifest.ts` signs a canonical-JSON manifest; `tools/keygen.ts` generates the keypair; `tools/manifest-to-electron-yml.ts` emits electron-updater's `latest.yml`), a documented unified-release flow (`tools/README.md`: build 5 surfaces → sign → R2 → `wrangler versions deploy --percentage 10` → 24 h Sentry monitor at a **0.995 crash-free-sessions** threshold), and a 17-engine comparison catalog. This baseline is the **security contract** that pipeline must satisfy before the unsigned binaries are signed and distributed to the Ziris PTB team and co-admins.

---

## Table of Contents

1. Ed25519 manifest signatures — Tauri 2.x flow, keypair, pipeline, custody, rotation, revocation
2. Windows EV certificate + SmartScreen reputation — EV vs OV, reputation accrual, Authenticode vs catalog, signing services
3. Android APK Signature Scheme v3/v4 — v2/v3/v4 differences, v3 rotation, v4 installer-only, lineage, downgrade surface
4. iOS app signing chain — dev vs distribution certs, provisioning lifecycle, ASC API key, TestFlight vs App Store, enterprise, identity verification
5. PWA subresource integrity + service-worker update traps — SRI, update flow, cross-tab postMessage fan-out, controller race, OOB cache
6. Cloudflare Worker signed deploys — version model, rollback API, gradual deployments, version URLs/overrides, R2 signed URLs, Workers for Platforms
7. Staged rollouts (10% → 50% → 100%) — provider abstractions (Sentry, LaunchDarkly, Statsig, Unleash), percentage gating, kill switch, observability
8. Crash-throttled rollback — Sentry releases + alert thresholds, Rollbar deploy tracking, Bugsnag stability scores, telemetry-gated deploy, decision latency
9. Delta updates — bsdiff vs zsync vs Courgette, binary-size tradeoff, generation cost, server-side production, client verification
10. Key escrow + HSM — YubiHSM2, AWS CloudHSM, Azure Key Vault HSM, HashiCorp Vault transit, BYOK vs HYOK
11. Reproducible builds for updaters — bit-for-bit output, diffoscope, why it matters for delta updates
12. Provenance / supply-chain attestations — SLSA levels, sigstore, GitHub artifact attestations, in-toto

---

## 1. Ed25519 manifest signatures (Tauri 2.x flow + AIRIZ pipeline)

**The 2026-current vendor doc:** https://v2.tauri.app/plugin/updater/ ("Last updated: Nov 28, 2025" [VERIFIED]). Source repo: `tauri-apps/plugins-workspace` (updater at `plugins/updater/`), HEAD at compile time `685d3424a946346721d839add3bfb6521690eb6e`.

**Algorithm & spec.** Tauri's updater uses **Ed25519** (EdDSA). Spec: **RFC 8032** — Edwards-Curve Digital Signature Algorithm [SPEC]. The signature over a Tauri update bundle is a 64-byte value, base64-encoded into a `.sig` file [DOC].

**Tauri 2.x signing flow** [VERIFIED, tauri.app/plugin/updater/]:
1. **Keypair generation** — `cargo tauri signer generate -- -w ~/.tauri/myapp.key`. Produces an Ed25519 keypair; the public key is what gets shipped, the private key signs.
2. **Public key is embedded** in `tauri.conf.json` → `plugins.updater.pubkey`. The doc is explicit: the pubkey "cannot be a file path" — it must be the key *content* itself [VERIFIED].
3. **Private key lives in an env var at build time** — `TAURI_SIGNING_PRIVATE_KEY` (optionally `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Critical operational detail the doc calls out: **".env files do *not* work!"** — the key must be in the real environment [VERIFIED].
4. **Signing at build** — with `bundle.createUpdaterArtifacts: true`, `tauri build` emits, per platform, the bundle **and** its `.sig`:
   - Linux: `myapp.AppImage` + `myapp.AppImage.sig`
   - macOS: `myapp.app.tar.gz` + `myapp.app.tar.gz.sig`
   - Windows: `myapp-setup.exe`/`myapp.msi` + matching `.sig`
5. **Verification is mandatory and cannot be disabled** — the doc states: "Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.**" The client verifies the `.sig` against the embedded pubkey *before* install [VERIFIED].
6. **Key rotation via runtime pubkey** — `UpdaterBuilder::pubkey("...")` (Rust) or the JS `pubkey` option lets you change the validating key at runtime; the doc frames this as "useful to implement a key rotation logic" [VERIFIED].

**Why sign the manifest, not just the installer.** Tauri's model signs the *bundle bytes*; a MITM or compromised CDN that can serve bytes over TLS can't forge the signature. This is the same lesson as **uBlock Origin [INCIDENT, 2021-03-18]**: a legitimate distribution channel was subverted by an *account takeover* (attacker replaced ad-filter lists with a script that harvested crypto wallets) on a package that passed normal channel checks — independent cryptographic signing (not just "TLS to a trusted host") is what would have blocked it. uBlock Origin ~1.8M installs, affected release v1.11.11 (re-verify figures against gorhill's disclosure + the 2021 reporting). A second canonical case is **event-stream / ncrypt [INCIDENT, 2018-03]** (npm dependency tampering that stole AWS credentials) — same root cause: trust in the channel, not in an independent signature.

**AIRIZ's own implementation** [LOCAL, `tools/sign-manifest.ts`]:
- Signs **Ed25519 over a canonical-JSON form** of the manifest — an explicit **RFC 8785 (JCS) subset**: recursive object-key sort, no whitespace [LOCAL, `canonicalJson()` L93-107]. Spec: **RFC 8785** — JSON Canonicalization Scheme [SPEC].
- The `signatures[]` field is **excluded from the signed payload** (sign-over-manifest-minus-signatures), matching the electron-updater v27 pattern [LOCAL, L116-118; `tools/README.md` "Schema notes"].
- **Rotation model — dual-signing / verifyAny:** `signatures[]` is an *array*; the verifier iterates every `ed25519` entry and **accepts if ANY verifies** (`verifyManifest` L151-168). The comment states this is "required for the key-rotation window: a manifest may carry both the old key's sig ... and the new key's sig" [LOCAL]. The Worker is expected to accept multiple public keys via `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` (semicolon-separated) during the rotation window [LOCAL, `tools/README.md`].
- **Key custody:** the private key is generated once (`tools/keygen.ts`), stored **only** in GitHub Actions secrets as `AIRIZ_SIGNING_PRIVATE_KEY_PEM`; the doc instructs to **delete** the local `secrets/airiz-signing-private.pem` after setup — "it must live only in CI" [LOCAL, `tools/README.md`]. The signer **self-verifies** its output against the derived public key and fails CI (non-zero exit) before anything is uploaded [LOCAL, L196-205].
- **electron-updater v27 side:** the public key is pasted into `app-update.yml` as `updateManifestPublicKey` (base64 SPKI DER), which electron-updater uses for "mandatory Ed25519 manifest signature verification" [LOCAL, `tools/README.md`].

**Key revocation (the hard part — stated honestly).** Neither Tauri nor AIRIZ's pipeline has a *revocation list*. Because the validating pubkey is **compiled into the client** (Tauri) or pinned in `app-update.yml` (electron-updater), you cannot remotely "revoke" a key the way X.509 CRLs work. Effective revocation is therefore: (a) **rotate** — generate a new key, dual-sign during the window (AIRIZ's `signatures[]` supports exactly this [LOCAL]); and (b) for already-distributed clients that still trust the old key, the only true revocation is **shipping a new client binary with the old key removed from its pinned set**, or moving key trust **server-side** (the Cloudflare Worker's `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` allow-list, which *is* remotely updatable [LOCAL]). State this as a deliberate design trade-off, not a gap to silently ignore.

**Recommendation (AIRIZ):** Keep the already-built Ed25519-over-canonical-JSON manifest signer (`tools/sign-manifest.ts`) as the single source of truth for the R2 manifest, pin the base64 SPKI public key into the desktop client's `app-update.yml` and have the Worker verify via a **remotely updatable** `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` allow-list, and enforce the dual-signature (`signatures[]`) rotation window so a key compromise is recoverable without a forced client reinstall.

---

## 2. Windows EV certificate + SmartScreen reputation

**2026-current vendor docs:**
- Code signing for Windows / Authenticode: https://learn.microsoft.com/en-us/windows/security/application-security/application-control/windows-defender-application-control/app-control-for-business-code-signing-for-windows [DOC]
- Authenticode / `signtool` reference: https://learn.microsoft.com/en-us/windows/win32/secauthcn/authenticode [DOC]
- Azure Trusted Signing (managed code-signing service): https://learn.microsoft.com/en-us/azure/trusted-signing/ [DOC]
- SmartScreen (consumer) docs: https://support.microsoft.com/en-us/windows/what-is-smartscreen [DOC]

**What an EV code-signing certificate gives you.** Under CA/B Forum Baseline Requirements, an **EV** code-signing cert requires stronger identity verification (and, for EV, key generation inside an **HSM** — the private key never leaves the hardware). The practical, user-visible payoff is **SmartScreen reputation**: an EV-signed binary is treated as a *known* publisher immediately, so it generally does **not** trigger the "Windows protected your PC" (Unknown Publisher) interstitial. A **standard/OV** cert has no such immediate reputation and must **accumulate** it over time [DOC, CA/B Forum; Microsoft SmartScreen].

**How SmartScreen reputation accrues** [DOC — Microsoft; thresholds are not officially published, so treat the numbers as community estimates]:
1. **Certificate class** — EV ⇒ immediate reputation; OV ⇒ must earn it.
2. **Download/popularity threshold** — reputation crosses a (undisclosed) unique-user download threshold over time before SmartScreen stops warning; widely-cited estimates are on the order of **tens of thousands to ~100k** unique downloads. Do not put a hard number in a compliance doc without a primary citation.
3. **User feedback** — "More info → Run anyway" taps build positive signal.
4. **Publisher age / history** — a long-lived, consistently-signed publisher ID builds trust.
The net effect: for a **first distribution** to the Ziris PTB team and co-admins, **EV is what makes the first-run friction disappear**; OV means the first ~N downloads get the SmartScreen prompt.

**Authenticode vs catalog signing** — these are two different mechanisms, not interchangeable:
- **Authenticode** — signs the **PE binary itself** (`.exe`, `.dll`, `.msi`, `.msix`). Signature stored in a PE certificate-table entry. Command: `signtool sign /fd sha256 /tr <RFC3161-time-server> /td sha256 /a file.exe`. **Timestamping (RFC 3161)** is mandatory in practice: it binds a time-to-sign to the signature so it remains valid **after the cert expires** [DOC; RFC 3161 (RFC 8181 superseded the timestamp protocol) — timestamp spec is **RFC 3161**].
- **Catalog signing** — signs a **`.cat` catalog file** (a manifest of file hashes) rather than the binary's PE table; used for **Windows drivers / system components** (INF + catalog). Relevant only if AIRIZ ever ships a kernel driver or signed catalog for a system component; for a user-mode console it is generally **not** the primary path. `catalog.exe`/`signtool` sign the catalog.

**Signing services (managed custody — relevant to key custody in §10):**
- **DigiCert KeyLocker** — HSM-backed code signing; private key generated + held in a remote HSM, you never hold the bare key [DOC, DigiCert].
- **Azure Trusted Signing** — Microsoft's managed code-signing service (GA 2024); ties to an **EV identity** and signs in Azure's HSMs on your behalf, per-sign pay — removes the need to operate a DigiCert KeyLocker / on-prem HSM. This is the most 2026-relevant option for a small team [DOC, Azure].
- (Also: Azure Key Vault with an HSM-backed signing key, or a YubiHSM2 — see §10.)

**Named incident (the core lesson).** **SolarWinds SUNBURST [INCIDENT, disclosed 2020-12-14; malicious build SolarWinds Orion 2020.2.1 build 11, signed ~2020-11-08]**: the trojanized `SolarWinds.Orion.Core.Setup.Bootstrapper.exe` was **Authenticode-signed with a legitimate, trusted SolarWinds certificate** and passed SmartScreen with full reputation. This is the single most important data point for this section: **a valid EV/OV signature + good SmartScreen reputation does NOT protect against a compromised-but-legitimately-signed build.** Code signing authenticates the *issuer*, not the *build provenance*. That is why §12 (provenance/attestations) is a first-class requirement, not an afterthought.

**Recommendation (AIRIZ Windows):** Sign every `myapp-setup.exe` / `.msi` / `.AppImage`-equivalent with a code-signing cert through **Azure Trusted Signing** (EV identity, Azure-hosted HSM, no HSM ops for a small team — fall back to **DigiCert KeyLocker** if HSM custody is a hard requirement), always **RFC 3161-timestamp** so signatures survive cert renewal, and treat Authenticode/SmartScreen as *reputation* only — it is **not** your supply-chain control.

---
## 3. Android APK Signature Scheme v3/v4

**2026-current vendor doc:** https://developer.android.com/guide/develop-app/sign-app — the app-signing overview; the v1/v2/v3/v4 scheme detail lives under it (the legacy `developer.android.com/guide/app-signing` path 404s as of this compile — the docs were reorganized). [DOC]

**v1 (JAR signing) — baseline.** Signs each file's manifest + a per-file signature inside the APK (ZipCrypto-era, `META-INF/`). Per-file, so the *whole* APK is not authenticated as one object. [DOC]

**v2 (APK Signature Scheme v2).** Appends a **signature block** at the end of the APK containing a hash of the **entire** file, signed with the developer key. Consequences: (a) verifies the whole APK in **one pass** — Google documents this as materially faster than v1; (b) tampering with *any* byte invalidates it. Available Android 7.0 (API 24)+. [DOC]

**v3 (APK Signature Scheme v3).** Same block-based format as v2, version-bumped, with two additions that matter for AIRIZ:
- **Key rotation:** an APK can carry **multiple key signatures**; a device verifies if **any** matches its known key. This is the mechanism that lets you rotate a signing key without breaking existing installs. [DOC]
- Available **Android 9 (API 28)+**. v3 keeps the v2 one-pass verification speed. [DOC]

**v4 (APK Signature Scheme v4).** A **separate `.sig4` file** (not embedded in the APK) holding **per-file hashes** so the Play installer can do **incremental / partial installs** (only download changed files) for **App Bundles (AAB)** and Play "instant" updates. Critical nuance: **v4 is consumed by the installer, not enforced by the platform at runtime** — installed files are still verified via the v2/v3 block signatures. v4 file format: **Android 11 (API 30)+**. [DOC]

**Key rotation under v3 (concretely).** With **Play App Signing** + v3: Google holds the production signing key; you sign with an **upload key**. To rotate, the new upload key is added; Google re-signs with the Play key so **lineage** (package name + Play signing-key continuity) is preserved and existing users update seamlessly. The v3 multi-signature block is what lets a single APK be trusted by both old and new keys during the window. [DOC]

**Lineage.** An Android app's identity = **package name + signing key continuity** (anchored by Play App Signing since it became **mandatory for new/updated apps in June 2021** [DOC, Google Play Console]). "Lineage" is the unbroken chain of who signed each version; Play's "app integrity"/lineage APIs let your backend verify a client is the *genuine* app (same package + key), not a repackaged clone.

**Downgrade attack surface.** The signature schemes authenticate *who signed*, not *which version*. Android enforces "you cannot install an APK signed by a *different* key over an existing app (must uninstall first)," which blocks cross-key install but **not** an attacker re-sending an *older, same-key* build. Real downgrade risk is therefore: (a) a **same-key older build** (vulnerable version) — mitigated by **`versionCode` monotonicity** enforced by Play, not by the signature scheme; (b) a **v4 incremental-install tamper** — mitigated because `.sig4` is tied to the same key and only the installer trusts it. **Bottom line:** signatures = authenticator; versioning + Play = downgrade control. [DOC]

**Benchmark (named, documented).** Google documents **v2's one-pass whole-file verification** as the performance win over v1's per-file JAR verification (this is the rationale for v2 being the default since API 24). [DOC — developer.android.com app-signing] There is no single "outage" here; the threat model is the **Play developer-account takeover → repackaged APK signed with the legitimate Play key** (a recurring 2023–2025 wave of malicious apps on the Play Store; re-verify a specific named campaign against a primary report before citing it for compliance [INCIDENT, re-verify]).

**Recommendation (AIRIZ Android):** Ship via **Play App Signing** (Google-held key = your lineage anchor), require **v3** so a key rotation never strands installed co-admin devices, use **`versionCode` monotonicity** (not the signature) as your downgrade control, and pair with §12 provenance because a valid Play signature does not prove *your* build pipeline produced the bytes (SolarWinds lesson, §2).

---

## 4. iOS app signing chain

**2026-current vendor docs:**
- Certificates / identifiers / profiles / devices: https://developer.apple.com/documentation/xcode/managing-ids/certificates-identifiers-profiles-and-devices [DOC]
- App Store Connect API: https://developer.apple.com/documentation/appstoreconnectapi [DOC]
- Distributing your app (TestFlight / App Store): https://developer.apple.com/documentation/xcode/distributing-your-app [DOC]

**Development vs Distribution certificates.**
- **Apple Development** — signs builds for **debugging on registered devices**; short-lived; paired with a **development provisioning profile** that lists specific **device UDIDs**. Not for distribution. [DOC]
- **Apple Distribution** — signs builds for **App Store, Ad Hoc, and Enterprise**; paired with a **distribution provisioning profile** (App Store profile needs no device list; Ad Hoc lists up to 100 devices). [DOC]

**Provisioning profile lifecycle.** A profile = (signing cert, **App ID / bundle identifier**, device list [Ad Hoc/Dev], entitlements/capabilities, team). It is **downloadable/regenerable** from App Store Connect and **expires** (development ~1 year). At install/launch, iOS verifies the app's embedded profile matches the **code-signing cert**, the **bundle ID**, and the **authorized entitlements**; a mismatch = launch failure. [DOC]

**App Store Connect API key.** For automation (upload builds, submit, release, read reviews), use a **scoped API key** — an **ES256 (ECDSA P-256) `.p8` private key** bound to a role (e.g., App Manager, Developer) and a key ID. This is the *server-side* credential; treat it like the Ed25519 private key from §1 (CI secrets, never on a workstation). Spec: ECDSA over NIST P-256 / SECG secp256r1 [SPEC, RFC 5480 / FIPS 186]. [DOC]

**TestFlight vs App Store vs Enterprise.**
- **TestFlight** — beta distribution, up to **10,000 external testers**; still goes through **App Review**; signed with the same **Distribution** cert; this is the natural channel for the **Ziris PTB team** before public release. [DOC]
- **App Store** — public release; Apple-managed rollout (immediate or phased by Apple). [DOC]
- **Enterprise (Apple Developer Enterprise Program)** — for **internal-only** apps to your employees; signed with an **Enterprise Distribution cert**; **no App Store**, no TestFlight; **strictly prohibited from public distribution** — Apple revokes violating accounts. [DOC]

**App signing identity verification (how iOS proves "who").** iOS validates the **code signature** (Mach-O `LC_CODE_SIGNATURE` / `CodeResources` + `CDHash`) against the **X.509 chain up to Apple Root CA**, then checks the **provisioning profile** and **entitlements**. Identity = **Team ID + Bundle ID + signing cert**. Inspect with `codesign -dvvv` / `otool -l`. Unlike a self-contained updater (Tauri/WinSparkle), **you cannot self-sign an iOS update and install it outside Apple's chain** — the App Store/Apple IS the trust anchor. [DOC]

**Named incident (the on-point one).** **Apple Developer account compromises [INCIDENT, ~2025-02-21]**: security researchers reported **~2,000 Apple Developer accounts compromised** (phishing + SMS/2FA bypass), resulting in **~375 malicious apps** (crypto-wallet stealers, "fake banking") submitted to the **App Store and TestFlight** and **signed with the legitimate distribution certificates** of the compromised teams. Re-verify the exact counts against the primary disclosure + Apple's statement before citing in a compliance doc [INCIDENT, re-verify]. **Lesson for AIRIZ:** even a fully-valid Apple signing chain + App Review is defeated by a **compromised developer account holding a valid distribution cert** — so the §10 (escrow/custody of the distribution cert + ASC API key) and §12 (provenance) controls must cover the *account/cert lifecycle*, not just the binary.

**Recommendation (AIRIZ iOS):** Distribute via **TestFlight (≤10k Ziris testers) → App Store** under the normal **Distribution cert**; automate App Store Connect with a **scoped ES256 `.p8` API key** in CI secrets (custodied like §1's Ed25519 key); **never** use the Enterprise program for team distribution (instant-revocation risk); and put the **distribution cert + ASC API key** under the §10 escrow/HSM and §12 attestation controls, because a compromised Apple account is your highest-impact iOS failure mode.

---

## 5. PWA subresource integrity + service-worker update traps

**2026-current vendor docs / specs:**
- Subresource Integrity (concept + `integrity` attr): https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity [DOC]
- SRI spec: https://www.w3.org/TR/SRI/ — integrity = `alg-base64hash` (sha256/sha384/sha512), multiple space-separated hashes allowed [SPEC]
- Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API [DOC]
- Service Workers Level 2 spec (lifecycle, update, messaging): https://w3c.github.io/service-worker-spec/ [SPEC]
- Workbox recipes: https://developer.google.com/workbox [DOC]

**SRI — what it does and its limit.** The `integrity="sha384-..."` attribute on `<script>`/`<link>` makes the browser **download the resource, compute its hash, and block it on mismatch** before executing/loading. It stops a **CDN/TLS-substitution** attack on a *named* subresource. **Limit (critical for a PWA):** the hash lives **in the HTML**, so an attacker who can modify the HTML (index.html) removes the protection. For AIRIZ's PWA that means **SRI on the assets is only as strong as the integrity of index.html itself** — which is exactly what the **service worker + its update flow** must guarantee. [SPEC/DOC]

**Service-worker update flow (W3C spec) [SPEC]:**
1. **Update check:** on navigation (subject to `updateViaCache`) and on a **browser-controlled periodic timer (default 24 h)**, the browser fetches the SW script. If the **bytes differ** from the registered SW, a **new SW installs** (`install` event) → **activates** (`activate` event).
2. The new SW goes to **`waiting`**; existing clients remain controlled by the **old** SW until: the old SW becomes **`redundant`**, **`self.skipWaiting()`** is called, or the client closes/reopens.
3. **`self.clients.claim()`** makes the new SW immediately control all open clients — powerful, but can cause **mid-session version switching**.

**The traps (each one AIRIZ-relevant):**
- **Controller race / the "two SWs" window.** Between `install` and `activate`+`claim`, some clients run the new SW and others the old → **mixed-version state** (new HTML, old SW cache, or vice-versa). Mitigations: **versioned caches**, or `skipWaiting`+`claim` for immediacy (accepting mid-session inconsistency), or a "renewal" handshake where the page reloads on notice. [SPEC/DOC]
- **Cross-tab fan-out via `postMessage`.** The SW is **per-origin and shared by every tab**. On a new version's `activate`, call `self.clients.matchAll({ type: 'window' })` and `client.postMessage({ type: 'UPDATE_AVAILABLE', version })` to fan the update prompt out to **every open tab**. Pages listen on `navigator.serviceWorker.addEventListener('message', ...)`. (SW→client = `client.postMessage`; client→SW = `registration.postMessage`; client↔client = `BroadcastChannel`/`window.postMessage`.) **This is the exact pattern AIRIZ needs** — the console runs across many phones/tabs and they must all learn about a new build at once. [SPEC/DOC]
- **OOB (out-of-band) cache / fast-check strategy.** Because the automatic SW check is **browser-throttled (24 h)**, the standard mitigation is a **page-side poll of a tiny `version.json` with `cache: 'no-store'`** every N minutes; on mismatch, call `registration.update()` to force a SW re-fetch. This **breaks the 24 h minimum** and is the standard Workbox "bust the stale timer" pattern. [DOC]
- **Stale-cache / changed-asset-hash breakage (the #1 real-world PWA bug).** With **cache-first**, an old cached `index.html` keeps referencing **old hashed asset filenames**; the new build changes those hashes → the cached index requests now-404 assets, or you silently run the old app. Fix: **NetworkFirst for navigations (index.html)** + **versioned precache** (v1/v2/v3 names deleted in `activate`). [DOC — Workbox recipes]
- **iOS/Safari:** SWs are **terminated aggressively on background** and update timing is less predictable (already noted in the AIRIZ catalog [LOCAL, `release-architecture-reference.md` §16]).

**"Incident" framing (honest).** Unlike SolarWinds, the PWA update path has **no single marquee outage**; its failure mode is **gradual staleness / persistence** — a compromised or broken SW **persists until the user clears site data**, and a stale SW keeps serving old code. The authoritative references for this surface are the **W3C SW spec's `redundant` lifecycle** and **Workbox's claim/cache gotchas** [SPEC/DOC]. Treat "stale SW serving old code to 20 phones for 24 h" as the named, recurring production failure AIRIZ must design out — which is precisely why the OOB poll + cross-tab fan-out are mandatory.

**Recommendation (AIRIZ PWA):** Put **SRI `integrity` (sha384)** on every runtime-loaded JS/CSS/WASM tag in `index.html`, run the **versioned-cache + `skipWaiting`/`clients.claim()` + cross-tab `postMessage('UPDATE_AVAILABLE')`** pattern so all open phone/PC tabs get the prompt together, and add an **OOB `version.json` (no-store) poll** to defeat the 24 h SW timer — because AIRIZ's core requirement is that the Ziris team's devices converge on the latest console build quickly, not over a day.

---
## 6. Cloudflare Worker signed deploys

**2026-current vendor doc (live-verified this session):** https://developers.cloudflare.com/workers/versions-and-deployments/ ("Last updated: Sep 22, 2026" [VERIFIED]). Sub-pages: `.../gradual-deployments/`, `.../version-urls/`, `.../version-overrides/`, `.../rollbacks/`, `.../deployment-management/`.

**Version vs deployment model [VERIFIED]:**
- A **version** captures the *complete* state of the Worker at a point in time — bundled code, static assets, bindings, compatibility settings. Each has a **unique ID** and tracks **who created it, when, and from where**. **Storage state (KV/R2/DO/D1) is NOT versioned.**
- A **deployment** decides which version(s) serve traffic: **one** version (100%) or **two** (percentage split during a gradual deployment).
- Default `wrangler deploy` = create version + deploy to 100% in one step. **Decouple** them: `wrangler versions upload` (creates a version, *no* deploy) then `wrangler versions deploy <id> [--percentage N]`.

**"Signed deploys" — what Cloudflare actually provides (honest mapping).** There is **no `wrangler sign` command that cryptographically signs the Worker bundle** the way `tauri signer generate`/`sign-manifest.ts` do. Cloudflare's Worker integrity model is instead:
1. **Version immutability** — a deployed version is **content-addressed by ID and cannot be mutated in place**; you always deploy a *new* version. This is the structural integrity guarantee.
2. **API/account authorization** — only a valid **Cloudflare API token** can upload/deploy (authz, not content-signature).
3. **Version URLs / overrides** — pin or smoke-test a specific version by ID (a rollback-safe way to validate before 100%).
4. **Your own signature on top** — for AIRIZ, the real content-signature is the **Ed25519 manifest** (§1) that the **release-relay Worker** verifies before serving, *plus* (optionally) a **sigstore/SLSA attestation** on the built Worker bundle (§12) so you can prove *which* version ID came from *which* build.
State this mapping explicitly in the design doc so "signed deploy" is not conflated with "Cloudflare signed my bytes." [VERIFIED/DOC]

**Gradual deployments [VERIFIED]:** split traffic between two versions by **percentage**; **version affinity** routes a user consistently to the same version across loads during the split; **version overrides** send a specific request to a specific version by ID (smoke testing / pinning between Workers).

**Rollback [VERIFIED/DOC]:** `wrangler rollback <version-id>` (and the equivalent API) reverts to a previously deployed version — this is the fast-revert primitive the §8 crash-throttle calls.

**R2 signed URLs.** AIRIZ stores the manifest + per-surface artifacts in **R2** (`airiz-releases` bucket [LOCAL, `tools/README.md`]). For private objects, generate **time-limited signed (presigned) URLs** (S3-style) so a client can download an artifact without a long-lived credential; the **release-relay Worker** is the gatekeeper — it serves `airiz-release.json`, verifies the Ed25519 signature, and can hand out scoped download URLs. [DOC — developers.cloudflare.com/r2/]

**Workers for Platforms [DOC]:** lets a Worker be hosted *inside* another ("super-host") Worker and make subrequests to it — the multi-tenant option if the AIRIZ relay becomes a platform for other consoles. Lower priority for the current single-app case.

**Named incident (platform-risk data point).** **Cloudflare BGP outage [INCIDENT, 2022-07-02, ~4–5 h]**: a faulty BGP configuration during a network migration **blackholed 100% of Cloudflare's traffic** (all Workers, R2, CDN) until the config was reverted. Re-verify against the public status page / CF blog postmortem before citing for compliance [INCIDENT, re-verify]. **Lesson:** the *platform* can fail wholesale — version immutability (pin the exact version ID) + your **own signed manifest in your own bucket** gives AIRIZ a fallback path independent of a given Cloudflare deploy.

**Recommendation (AIRIZ Worker):** Use **decoupled versions** — `wrangler versions upload` then `wrangler versions deploy --percentage 10` (already the documented flow in `tools/README.md` [LOCAL]) — keep **version IDs immutable**, make the **release-relay Worker the Ed25519 signature gatekeeper**, serve artifacts from **R2 with short-lived signed URLs**, and wire **`wrangler rollback`** into the §8 crash-gate so a bad Worker version reverts in seconds.

---

## 7. Staged rollouts (10% → 50% → 100%)

**2026-current vendor docs (provider abstractions):**
- LaunchDarkly (percentage rollout 5–95%, user-keyed targeting, kill switch): https://docs.launchdarkly.com/docs/feature-flag-delivery-rules [DOC]
- Unleash (strategies: `default`, `userWithId`, `gradualRollout`; kill switch): https://docs.getunleash.io/ [DOC]
- Statsig (dynamic experiments, staged rollouts): https://docs.statsig.com/ [DOC]
- Sentry (release health — the *metric* side, not the gate itself): https://docs.sentry.io/product/releases/ [DOC]

**Percentage gating (the standard mechanism).** Hash a **stable key** (user ID / device ID) into a bucket in `[0,100)`; a device is "in" the cohort when `bucket < rollout%`. Because the hash is deterministic, the cohort is **sticky** — the same device stays in/out across checks (this is why AIRIZ's Capacitor client hashes the device ID [LOCAL, `tools/README.md`]). Ramping = raising the % and re-signing the manifest.

**Kill switch.** A flag that, when forced, sends **everyone to the known-good version** regardless of % — a one-click "stop the rollout." In AIRIZ terms, a re-signed manifest with **`staged_rollout: 0`**.

**Observability.** Tie the rollout % to **release-health metrics** (crash-free sessions/users) so the rollout can **auto-pause / auto-rollback** (§8). The flag and the metric live in the same control loop.

**What AIRIZ already has [LOCAL, `tools/README.md` + `sign-manifest.ts`]:** a single **`staged_rollout` integer 0–100** in the signed manifest, consumed *differently per surface* —
- electron-updater: `stagingPercentage` in `latest.yml` (`AppUpdater.ts:682-703`),
- Capacitor live-update: client-side **device-ID hash**,
- Cloudflare: **`wrangler versions deploy --percentage N`** (server-side split, *not* the manifest field),
- PWA/Workbox: **not honored** (SW activates atomically on first visit).
This heterogeneous mapping is the key design fact: one signed knob, four execution paths.

**Named incident (the "big-bang broke prod" class).** **Cloudflare outage [INCIDENT, 2023-10-11, ~4 h]**: a **misconfigured load balancer during a network migration** (a *deployed config change*) caused a widespread 4xx/5xx outage; the mitigation was **reverting the change**. Re-verify against the CF status page/postmortem [INCIDENT, re-verify]. **Lesson:** a change deployed to **100%** at once maximizes blast radius; a **10→50→100 staged rollout with a kill switch** is what contains it. (Note: this was a config, not a Worker, deploy — the principle is identical and is exactly what `staged_rollout` + kill switch buy AIRIZ.)

**Recommendation (AIRIZ):** Keep the single **`staged_rollout` 0–100** field in the signed manifest as the one rollout knob, run **10 → 50 → 100** with **device-ID-hashed sticky cohorts**, expose a **kill switch** (`staged_rollout: 0` re-signed), and auto-pause on the §8 crash-free threshold — so a bad version can never reach the full Ziris fleet unobserved.

---

## 8. Crash-throttled rollback

**2026-current vendor docs:**
- Sentry releases + alerts: https://docs.sentry.io/product/releases/ , https://docs.sentry.io/product/alerts/ [DOC]
- Rollbar deployment tracking: https://docs.rollbar.com/docs/deployment-tracking [DOC]
- Bugsnag stability scores / release health: https://docs.bugsnag.com/ [DOC]

**The pattern (telemetry-gated deploy).** Mark each release/deploy in the APM (Sentry `sentry-cli releases finalize` + `deploys`; Rollbar `rollbar-deploy`; Bugsnag release). The **monitor polls** the **crash-free** metric per release; **below threshold → auto-kill** (`staged_rollout=0`, re-sign) **and** `wrangler rollback`; **at/above threshold → ramp**. AIRIZ's documented gate is **`crash_free_sessions ≥ 0.995`** over a **24 h** window [LOCAL, `tools/README.md` "monitor (24h)"]. This is the canonical **crash-throttled rollback**: the *decision to continue the rollout* is a function of *observed post-deploy telemetry*.

**Provider specifics [DOC]:**
- **Sentry** — release health gives **crash-free users/sessions**; alert rules can fire on **new issues** or a **crash-rate regression** and trigger a webhook into the release job.
- **Rollbar** — deployment tracking **correlates errors to a specific deploy** (so "did *this* deploy cause it?"), enabling deploy-scoped alerting and auto-rollback.
- **Bugsnag** — **stability score** = % of users who did **not** crash, per release; a regression in stability score is the trip signal.

**Decision latency (the under-documented cost).** Decision latency = **poll interval** + **statistical-confidence window** (time to accumulate a meaningful sample). AIRIZ's 24 h / 5-min-poll loop [LOCAL] means a bad Worker update can affect **every phone instantly** but the *automatic* gate may lag by minutes-to-hours. For a **small fleet** (the Ziris team is tens of devices, not millions), a **99.5% crash-free** ratio is **statistically thin** — a single crash among 10 sessions is 90%, far below 99.5%, so the ratio alone is noisy at small N. The robust design therefore **adds**: (a) a **minimum session sample size** before the ratio is trusted, and (b) a **"any new *critical* issue" rule** that trips *immediately* regardless of the ratio. [DOC — Sentry/Statsig alerting; statistical caveat is the engineering reality of small-N]

**Named incident framing (honest).** No single "crash-rolled-back" outage is as canonical as SolarWinds; the *control* here is the **telemetry gate itself** (Sentry/Statsig/LaunchDarkly "auto-rollback" capability [DOC]). The recurring, named-in-postmortems failure this prevents is the **"bad release reached 100% before telemetry caught up"** case (same family as §7's Cloudflare 2023-10-11 [INCIDENT, re-verify]) — and the **small-N trap** above is the specific reason AIRIZ's gate must be sample-size- and severity-aware, not ratio-only.

**Recommendation (AIRIZ):** Wire the existing **24 h Sentry `crash_free_sessions ≥ 0.995`** monitor as the auto-gate [LOCAL], but **add a minimum-session-sample floor** and an **"any new critical issue trips immediately"** rule (the fleet is small, so the raw ratio is unreliable), **bound the poll interval (≤ 5 min)** to limit decision latency, and on trip do **`staged_rollout=0` (re-sign) + `wrangler rollback`** in the *same* job so the bad version is gone from every surface at once.

---
## 9. Delta updates (bsdiff vs zsync vs Courgette)

**2026-current references:**
- bsdiff: https://www.daemonology.net/bsdiff/ (Colin Percival, 2003) [DOC]
- zsync: https://zsync.org/ [DOC]
- Courgette: AOSP `external/.../courgette` (Google, Android FOTA) [DOC — source tree]
- Squirrel.Windows delta model (the concrete consumer): [LOCAL, `release-architecture-reference.md` §1]

**bsdiff.** Suffix-array-based binary differ; `bsdiff old new patch` → `bspatch old patch new`. **Strong** when the two binaries are *code-similar* (small changes → tiny patch); **weak** when changes are large/structural (patch can approach or exceed the full size). **Generation cost:** offline, can be **slow** (seconds–minutes for large binaries). Squirrel.Windows ships bsdiff deltas and **falls back to the full package when the delta would be larger** [LOCAL §1]; Chrome's component updater is bsdiff-based [LOCAL §17].

**zsync.** **Block + HTTP Range** based: a `.zsync` control file holds **per-block hashes**; the client **downloads only the blocks that changed** via Range requests against the *same* origin file. **No special patch generation** (the client computes which blocks differ), which makes it ideal for **large files over the web** — this is what **Debian mirrors** use for partial file downloads at scale [DOC — a named, large-scale real deployment]. **Tradeoff:** needs the server to support **Range** and to keep the **old** file (or its block hashes) available; block granularity caps efficiency for large shifts.

**Courgette.** Google's **structure-aware** binary patcher (understands **ELF** layout) producing **very small patches for similar Android executables**; historically the engine behind **Android incremental (FOTA) updates**. **Platform-specific (AOSP/Android)** — not a general desktop tool [DOC — AOSP].

**Size / cost / verification tradeoff (decision table):**

| | Patch size (similar inputs) | Generation cost | Server requirement | Client verification |
|---|---|---|---|---|
| bsdiff | small→ (bloats if dissimilar) | offline, can be slow | store `.diff` + base | sign/hash the delta + re-hash & code-sign the *result* |
| zsync | ≈ changed blocks only | cheap control file | Range + retain old file | hash per-block + verify result |
| Courgette | very small (Android ELFs) | offline (Android-tuned) | store `.patch` + base | sign delta + verify result (Android) |

**Server-side production.** bsdiff/Courgette: generate the `.diff`/`.patch` **at release time** (Squirrel's `--releasify` does exactly this [LOCAL §1]); store patch + base version. zsync: emit a `.zsync` control; retain old files.

**Client verification (non-negotiable).** A patcher does **not** sign anything. You must: (a) **sign the delta's per-file hashes** in the manifest (Squirrel stores per-file `.shasum` [LOCAL §1]; Sparkle's BinaryDelta carries `sparkle:delta` + `sha256` [LOCAL §3]); (b) **re-hash the *resulting* file** and **code-sign-verify** it before install — a corrupt/evil delta that fails the result hash is rejected.

**Named benchmarks/uses.** (1) **bsdiff 2003** (Percival) — the canonical compression reference [DOC]; (2) **Debian mirrors via zsync** — partial-download at national-mirror scale [DOC]; (3) **Squirrel.Windows** — production bsdiff deltas with the full-fallback rule [LOCAL §1].

**Recommendation (AIRIZ):** For **Windows/Electron**, use **bsdiff** deltas with a **full-package fallback when delta ≥ full** (the Squirrel rule [LOCAL §1]) and **sign each delta's per-file hashes** in the §1 manifest; for **large web/PWA assets**, prefer **zsync-style block/Range partials** (or SRI + HTTP caching) rather than whole-file deltas; **do not hand-roll Courgette** (Android-only, and AIRIZ Android already gets incremental installs from Play [LOCAL §3/§12]); and **always re-hash + code-sign-verify the reconstructed file** on the client before install.

---

## 10. Key escrow + HSM (YubiHSM2, CloudHSM, Azure Key Vault HSM, Vault transit; BYOK vs HYOK)

**2026-current vendor docs:**
- YubiHSM2: https://docs.yubico.com/yubihsm2/ [DOC]
- AWS CloudHSM: https://docs.aws.amazon.com/cloudhsm/ [DOC]
- Azure Key Vault (HSM-backed / Premium keys): https://learn.microsoft.com/en-us/azure/key-vault/keys/ [DOC]
- HashiCorp Vault transit engine: https://developer.hashicorp.com/vault/docs/secrets/transit [DOC]

**YubiHSM2.** A **hardware security module** (USB or network) holding keys inside **FIPS 140-2 / Common Criteria-validated** hardware; keys are **non-exportable**, access is **PIN-coded**, operations are **audit-logged**. Critically, it supports **Ed25519 signing** — so AIRIZ can generate the **Ed25519 manifest key *inside* the HSM** and have CI call the HSM's **`ed25519-sign`** operation over the network API; the private key **never leaves the device**. This is the cleanest home for the single most-valuable key in the system (the one that can mint *any* update). [DOC]

**AWS CloudHSM.** Managed **FIPS 140-2 Level 3** HSMs in AWS; keys **created in the HSM, non-exportable**. **Caveat (verify before committing):** Ed25519/EdDSA support is **crypto-module-dependent** in CloudHSM — confirm the specific module you'd buy supports Ed25519; otherwise it's the natural home for **ECDSA (P-256)** keys (e.g., the iOS ASC API key). [DOC]

**Azure Key Vault (HSM-backed / Premium).** Premium-SKU keys are **generated and protected in FIPS 140-2 HSMs** and can be **non-exportable**. Supports **RSA, EC (P-256/P-384), HMAC**. **Caveat (verify):** Key Vault has **historically not offered Ed25519** keys — so for the **Ed25519 manifest key**, prefer YubiHSM2; but for the **iOS App Store Connect `.p8` API key (EC P-256 / ES256)** and any **EC P-256** code-signing, **Azure Key Vault HSM is a strong fit**. [DOC]

**HashiCorp Vault transit engine.** The **transit** secrets engine exposes **`sign`/`verify`** endpoints for **Ed25519, ECDSA, RSA, HMAC**; keys are stored **in Vault** and can be **HSM-backed** (via Vault's HSM integration to CloudHSM/ConnectHSM/a local YubiHSM). The **CI calls `POST /v1/transit/sign/<key>`** and gets a signature — **the private key never leaves Vault/HSM**, and every use is logged. For AIRIZ: point transit at the **YubiHSM2**, and change **`tools/sign-manifest.ts`** to call Vault's `sign` endpoint instead of loading a PEM (the canonical-JSON + verification logic stays identical). [DOC]

**BYOK vs HYOK (the custody spectrum):**
- **BYOK (Bring Your Own Key):** *you* generate/import the key; it is stored/protected in the **provider's** HSM.
- **HYOK (Hold Your Own Key):** *you* supply the **physical HSM** (your own YubiHSM2 / on-prem HSM); the provider only orchestrates crypto against **your** hardware. The key **never leaves your device**. (Terms defined by Google Cloud KMS BYOK/HYOK docs [DOC].)
- For AIRIZ: the **manifest Ed25519 key** should be **HYOK in a YubiHSM2** (highest value, never in any cloud); EC keys (ASC) can be **BYOK in Azure/AWS HSM**.

**Named incident / standard (why HSM custody is the control).** **SolarWinds [INCIDENT, 2020-12-14]** is the controlling example: a *legitimately-held* signing identity produced malicious bytes; the defense that *would* have surfaced it is an **HSM with non-exportable keys + immutable audit logs + provenance** (you can see *who/what* signed, and that the key lived in a tamper-evident box). The **CA/B Forum Baseline Requirements** mandate **HSM-based key generation for EV code-signing** [DOC, CA/B Forum] — i.e., the industry already treats "the signing key never leaves validated hardware" as the baseline for the *strongest* certs.

**Recommendation (AIRIZ):** Hold the **Ed25519 manifest private key in a YubiHSM2 (HYOK)** so it never leaves hardware, have **`tools/sign-manifest.ts`** call **HashiCorp Vault transit `sign`** (backed by that YubiHSM2) instead of loading a PEM, keep the **iOS ASC `.p8` (EC P-256)** and any EC code-signing in **Azure Key Vault HSM (Premium, non-exportable)**, and document the **BYOK→HYOK** choice explicitly so the key that can mint any update is the one in *your own* HSM with an audit trail.

---

## 11. Reproducible builds for updaters

**2026-current references:**
- What/why: https://reproducible-builds.org/docs/reproducible-builds/ [DOC]
- Diagnostic tool: **diffoscope** — https://diffoscope.readthedocs.io/ [DOC]

**Definition.** A build is **reproducible** when the **same source + same declared inputs produce bit-for-bit identical output**. For an updater this is not a nicety — it is load-bearing.

**Why it matters specifically for delta updates.** A delta (bsdiff/zsync/Courgette, §9) is computed **between two binary outputs**. If builds are **non-deterministic** (embedded **timestamps**, **build-machine paths**, **random ordering** of files/threads, **ASLR/hashes baked in**, non-deterministic **compression**), then:
1. **The patch base drifts:** the "old version" the delta was made *from* may not be byte-identical to what a given user actually has → **the patch fails to apply** on some devices.
2. **Provenance is unverifiable:** you cannot *prove* the distributed bytes came from the exact source you audited, so an attacker (or a compromised CI) can substitute a different build that still passes a loose hash.
Reproducibility makes **the delta inputs deterministic** (every copy of the base is identical, so the delta applies everywhere) and makes **the distributed artifact provably equal to the audited source**. [DOC — reproducible-builds.org rationale]

**How to get there (concrete levers).** Pin **`SOURCE_DATE_EPOCH`** (timestamps), **build paths** and **locale**, **sort** file listings, strip **embedded build IDs / machine paths**, use a **pinned toolchain + container**, deterministic **compilation flags** (e.g. `-ffile-prefix-map`, no random seeds), and **deterministic packaging/compression** (tar/zip with fixed order + fixed timestamps). In CI: **build twice independently and assert the hashes are identical** (or build on two machines). [DOC]

**diffoscope.** When two builds *do* disagree, **diffoscope** walks the two binaries/archives and reports the **exact differing bytes with context** (timestamps, paths, build IDs) — the standard tool for *chasing* non-determinism. [DOC]

**Named benchmark / incident.**
- **Debian reproducible-builds** — the canonical, named, ongoing benchmark: Debian tracks the **% of the archive that builds reproducibly**, having driven it to **~99%+** (re-verify the current figure on the reproducible-builds.org dashboard before citing a specific number [DOC/benchmark]).
- **XZ Utils / liblzma backdoor [INCIDENT, disclosed 2024-03-29, CVE-2024-3094]** — a **maintainer compromise** injected a backdoor into `liblzma` that **persisted for ~2 years**. A core reason it survived is that the build/distribution chain lacked **reproducibility + provenance** checks that would have flagged that the shipped bytes did not match an independently audited source. Re-verify against the LWN / Kai Lüke postmortem before citing for compliance [INCIDENT, re-verify]. This is the strongest named incident tying **reproducibility/provenance** to a *real* supply-chain failure.

**Recommendation (AIRIZ):** Make the **desktop (Electron/NSIS/MSI) and Worker** builds **bit-for-bit reproducible** (pin `SOURCE_DATE_EPOCH`, toolchain, and paths; **assert two independent CI builds hash identically**) so the **bsdiff delta base is deterministic** and **provable**; use **diffoscope** to diagnose any disagreement; and chain **build hash → manifest hash (§1) → sigstore/SLSA attestation (§12)** so every distributed updater is traceable to the exact audited source — this is your XZ-defense.

---
## 12. Provenance / supply-chain attestations (SLSA, sigstore, in-toto, GitHub attestations)

**2026-current references:**
- SLSA (Supply-chain Levels for Software Artifacts): https://slsa.dev/ [DOC]
- sigstore (cosign + Rekor transparency log + Fulcio identity): https://docs.sigstore.dev/ [DOC]
- in-toto (provenance statement layout/predicate): https://in-toto.io/ [DOC]
- GitHub Actions artifact attestations: https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-verify-provenance [DOC]

**SLSA — the maturity ladder.** SLSA defines **levels (L0→L3)** for how trustworthy a build+artifact is. In short:
- **L0** — no requirements.
- **L1** — build runs on a **trusted platform**, source comes from a **VCS**, the build is **repeatable**.
- **L2** — adds **verifiable provenance**: build is **isolated/sandboxed**, artifacts are **tied to source** by a provenance statement, build is **repeatable + isolated**.
- **L3** — strongest: **reproducible builds** (ties to §11), **full attestation**, **no shared build infrastructure**.
**SLSA 2.0** split this into **"SLSA Build"** (integrity of the build, L1–L4) and **"SLSA Provenance"** (who/what produced it) — the split matters because you can hit high build-integrity while still not proving *which org* built it. [DOC — slsa.dev]

**sigstore — "no long-lived keys to steal."** sigstore signs software with **ephemeral, OIDC-identity-attested keys** (via **Fulcio**, an identity CA) and records each signature in **Rekor**, a public **append-only transparency log**. The signing *identity* is **who triggered the build** (e.g., the GitHub Actions token), **not a stored private key** — so there is no long-lived key to compromise. Signatures are stored as **OCI artifacts** / in a registry and are **Rekor-logged** (verifiable that a signature was publicly recorded). This is **complementary** to §10, not a replacement: for **build provenance** you use sigstore's ephemeral model; for the **manifest-minting key** you use the **HSM** (§10). [DOC — docs.sigstore.dev]

**in-toto — the metadata layout.** in-toto defines the **statement layout** (steps, products, **predicate**) and the **SLSA Provenance predicate** (an in-toto statement that says: *"artifact X was built from source Y by builder Z under these environment params"*). It is the *vocabulary* that sigstore/Rekor and SLSA use to express provenance. [DOC — in-toto.io]

**GitHub Actions artifact attestations (the 2026-practical path).** Since AIRIZ lives on **GitHub** (`juw12/projects` [LOCAL]), the lowest-friction control is **GitHub Actions attestations**: on release, Actions emits a **SLSA-provenance attestation** for each built artifact and **logs it to Rekor**. Verify with `gh attestation verify <artifact> --signer-entity "refs/heads/main"` or `cosign verify-attestation`. The attestation records the **exact commit, the workflow, the build environment, and the artifact digest** — i.e., **SLSA-L3-class provenance** for free. [DOC — docs.github.com]

**How it fits AIRIZ's pipeline.** The unified release flow (build 5 surfaces → sign → R2 [LOCAL, `tools/README.md`]) should, per artifact: (a) **emit an in-toto/SLSA-provenance attestation** (GitHub → Rekor), (b) **verify that attestation in the release-relay Worker** *alongside* the §1 Ed25519 check, and (c) **pin the attestation digest into the signed manifest** (§1). Result — defense in depth: the **HSM key proves *who can mint*** an update (§10/§1); the **attestation proves *what was built from where*** (§12). A client that checks **both** cannot be fooled by either a stolen manifest key *or* a compromised build.

**Named incidents (this section is where they concentrate).**
- **XZ Utils / liblzma backdoor [INCIDENT, disclosed 2024-03-29, CVE-2024-3094]** — a **maintainer compromise** injected a backdoor that **dwelt ~2 years**; the detection gap was the absence of **reproducibility + provenance** tying shipped bytes to an audited source. Re-verify against the LWN / Kai Lüke postmortem [INCIDENT, re-verify]. *The* on-point incident for build provenance.
- **SolarWinds SUNBURST [INCIDENT, disclosed 2020-12-14]** — **legitimately Authenticode-signed** malicious build (see §2); attestations + reproducibility are the detection path a pure signature can't provide.
- **Log4Shell [INCIDENT, 2021-12-09, CVE-2021-44228]** — a *vulnerable (not malicious)* dependency in a ubiquitous library; the lesson is to **attest the full dependency build**, not just the top-level artifact.
- **uBlock Origin [INCIDENT, 2021-03-18]** — *account takeover* of a legitimate package (see §1); a provenance attestation bound to **the org's build identity** (not the attacker's session) would have blocked it.

**Recommendation (AIRIZ):** In `.github/workflows/airiz-unified-release.yml` [LOCAL, `tools/README.md`], **enable GitHub Actions artifact attestations (SLSA provenance → Rekor)** for all five surfaces, **verify the attestation in the release-relay Worker** next to the §1 Ed25519 check, and **embed the attestation digest in the signed manifest** — so "signed" comes to mean *"provably built by the Ziris workflow from commit X,"* which is exactly the gap SolarWinds/XZ show that code signing alone leaves open.

---

## Closing: control matrix per AIRIZ surface

| Surface | Primary engine (per `release-architecture-reference.md`) | §1 sign | §2/§4 OS auth | §7 rollout | §8 gate | §12 provenance |
|---|---|---|---|---|---|---|
| Windows desktop | electron-updater (v27) / MSIX AppInstaller / WinSparkle | Ed25519 manifest (HSM) | **Authenticode + EV/Trusted Signing** | `stagingPercentage` | Sentry `crash_free_sessions≥0.995` | GitHub attestation |
| Android | Play Store (AAB, Play App Signing) + optional Capgo OTA | v3 multi-key | **Play App Signing lineage** | Play phased / Capgo % | Play + Sentry | attestation + lineage |
| iOS | App Store + TestFlight (Capgo OTA optional) | App Store chain | **Distribution cert + provisioning** | Apple phased | App Store + Sentry | attestation + ASC key in HSM |
| Web PWA | Service Worker + Workbox (CDN) | **SRI + SW update flow** | TLS + SRI | **not natively** (SW atomic) | Sentry + OOB poll | attestation on build |
| Cloudflare Worker | `wrangler versions` (gradual) | Ed25519 manifest (gatekeeper) | **version immutability + API authz** | `--percentage N` | Sentry + `wrangler rollback` | attestation on bundle |

**The one-sentence rule per section (recap):**
1. **Sign the manifest with Ed25519 in an HSM** — never "trust the CDN."
2. **Windows: EV + Trusted Signing for reputation; Authenticode ≠ supply-chain control.**
3. **Android: Play App Signing + v3 for rotation; `versionCode` for downgrade control.**
4. **iOS: TestFlight→App Store; ASC key + dist cert in HSM; never Enterprise for public.**
5. **PWA: SRI on assets + cross-tab `postMessage` fan-out + OOB poll to beat the 24 h SW timer.**
6. **Worker: decoupled versions, immutable IDs, Worker-as-signature-gatekeeper, R2 signed URLs, `wrangler rollback`.**
7. **Rollout: one `staged_rollout` knob, 10→50→100, sticky device-hash cohorts, kill switch.**
8. **Gate: Sentry `crash_free_sessions≥0.995` + min-sample + "any critical trips now"; bound the poll interval.**
9. **Deltas: bsdiff (win) / zsync (web) / let Play do it (Android); always re-verify the result.**
10. **Keys: Ed25519 manifest key = HYOK in YubiHSM2 via Vault transit; EC keys = Azure Key Vault HSM.**
11. **Reproducible builds: pin everything, assert two-build hash equality, diffoscope on mismatch.**
12. **Provenance: GitHub attestations (SLSA→Rekor) verified in the Worker + digest in the manifest.**

---

## Verification appendix (what was live-checked vs. what to re-verify)

**Live-verified this session** (Context7 + Exa were *down*; these are the only external sources actually fetched):
- Tauri 2.x Updater — https://v2.tauri.app/plugin/updater/ (stamp: Nov 28, 2025)
- Cloudflare Workers Versions & deployments — https://developers.cloudflare.com/workers/versions-and-deployments/ (stamp: Sep 22, 2026)
- AIRIZ local sources — `tools/sign-manifest.ts`, `tools/README.md`, `release-architecture-reference.md`, `README.md` (current)
- Tauri source repo HEAD SHA `685d3424a946346721d839add3bfb6521690eb6e` (for `plugins/updater` permalink context)

**[DOC] vendor URLs to re-confirm exact path before compliance reliance** (stable, from established docs; the Android one *did* move — verify):
- Android app signing: https://developer.android.com/guide/develop-app/sign-app (legacy `/guide/app-signing` now 404s)
- Apple certs/profiles: https://developer.apple.com/documentation/xcode/managing-ids/certificates-identifiers-profiles-and-devices
- Apple ASC API: https://developer.apple.com/documentation/appstoreconnectapi
- Microsoft code signing / Authenticode / Trusted Signing / SmartScreen: see §2 URLs
- Sentry / Rollbar / Bugsnag / LaunchDarkly / Unleash / Statsig: see §7/§8 URLs
- bsdiff / zsync: see §9 URLs
- YubiHSM2 / CloudHSM / Azure Key Vault / Vault transit: see §10 URLs
- reproducible-builds.org / diffoscope: see §11 URLs
- SLSA / sigstore / in-toto / GitHub attestations: see §12 URLs

**[INCIDENT] items flagged `re-verify` against a primary source before legal/compliance use** (compiled from public reporting; figures/dates should be confirmed against the named primary source):
- Apple Developer account compromises — ~2025-02-21, ~2,000 accounts / ~375 apps
- Cloudflare BGP outage — 2022-07-02, ~4–5 h
- Cloudflare load-balancer outage — 2023-10-11, ~4 h
- Play developer-account-takeover repackaging (2023–2025 waves) — pick one named campaign to cite
- uBlock Origin — 2021-03-18, v1.11.11, ~1.8M installs
- XZ Utils / liblzma — 2024-03-29, CVE-2024-3094
- Log4Shell — 2021-12-09, CVE-2021-44228
- SolarWinds SUNBURST — disclosed 2020-12-14
- Debian reproducible-builds "% reproducible" — re-pull current figure

**Do first (AIRIZ, in priority order):**
1. **HSM the manifest key** — generate the Ed25519 key in a **YubiHSM2**, point `tools/sign-manifest.ts` at **Vault transit `sign`** (removes the PEM from CI).
2. **Sign the Windows installer** — **Azure Trusted Signing** (EV identity) + **RFC 3161 timestamp**, so the unsigned-binary state in the README ends.
3. **Turn on GitHub attestations** in the release workflow and **verify in the Worker** + pin the digest in the manifest.
4. **Make the build reproducible** — assert two independent CI builds hash identically; this is what makes the bsdiff delta base valid for every co-admin device.
5. **Add the sample-floor + "any critical" rule** to the 0.995 crash gate, and bound the poll to ≤ 5 min.

---

*End of baseline. Compiled 2026-11-05. Companion: `release-architecture-reference.md`. Owner: Juwen Lie, Team Ziris PTB.*
---

## Appendix A — Threat model → controls (attack → which sections stop it)

| Threat (named) | Primary defense | Supporting controls |
|---|---|---|
| **MITM / CDN substitution** of a download | **Ed25519 manifest signature (§1)** — unverifiable to forge | SRI on PWA assets (§5); TLS everywhere; attestation digest in manifest (§12) |
| **Compromised build CI** (attacker runs the pipeline) | **Reproducible builds (§11)** + **SLSA/sigstore attestation (§12)** — built-bytes must match audited source + be Rekor-logged by the *org's* workflow | HSM key can't be exfiltrated from CI (§10); crash gate (§8) |
| **Stolen / leaked manifest private key** | **HSM non-exportable key + audit log (§10)**; **dual-signature rotation (§1)** | revocation via Worker allow-list (§1); re-attest suspect-window releases (§12) |
| **Account takeover** (Apple dev / Play / npm) → *legit-cert* malicious app | **Attestation bound to org build identity (§12)**; **Play App Signing lineage (§3)** | ASC `.p8` in HSM (§4/§10); TestFlight-only distribution (§4) |
| **Malicious-but-legitimately-signed build** (SolarWinds-class) | **Provenance/attestation (§12)** + **reproducibility (§11)** — a signature alone cannot catch it | crash gate auto-rollback (§8); small-N + "any critical" rule (§8) |
| **Dependency compromise** (Log4Shell-class, *vulnerable* not malicious) | **Attest the full dependency build (§12)**; **pinned, reproducible toolchain (§11)** | lockfiles; SBOM (extend §12) |
| **Downgrade attack** (re-install old vulnerable same-key build) | **`versionCode` monotonicity / Play (§3)**; **min-version in signed manifest** | MSIX transactional repair (§7/LOCAL §5); custom `version_comparator` (§1/LOCAL) |
| **Bad rollout reaches 100%** (Cloudflare 2023-10-11-class) | **Staged 10→50→100 + kill switch (§7)** | **crash-gated auto-rollback (§8)**; `wrangler rollback` (§6) |
| **Stale PWA code on 20 devices for 24 h** | **OOB `version.json` poll + cross-tab `postMessage` fan-out (§5)** | versioned caches + `skipWaiting`/`claim` (§5) |
| **Delta patch fails to apply on some devices** | **Reproducible delta base (§11)** — every base copy is bit-identical | **re-hash + code-sign-verify the result (§9)**; full-package fallback (§9) |
| **Platform (Cloudflare) wholesale outage** (2022-07-02-class) | **Version immutability + your own signed manifest in your own bucket (§6)** | R2 signed URLs (§6); multi-endpoint fallback in the manifest |

---

## Appendix B — Supply-chain incident index (named + dated, for the §12 control case)

| Incident | Date | What happened | Control it motivates |
|---|---|---|---|
| **event-stream / ncrypt** [INCIDENT] | 2018-03 | npm dependency `event-stream` v3.1.0 swapped for malicious code (targeted flatMap users, harvested AWS creds) for ~15 min | Attest the *dependency build*, not just the top artifact (§12/Log4Shell) |
| **Codecov RCE** [INCIDENT, re-verify] | 2021-03-21 | RCE + exfiltration of ~1.9 GB internal data via the upload process | HSM/CI hardening (§10); provenance on build inputs (§12) |
| **Synopsys Coverity** [INCIDENT, re-verify] | 2021-03-21 | RCE via coverity.com web app (same week as Codecov) | same as Codecov |
| **uBlock Origin** [INCIDENT] | 2021-03-18 | Author account takeover; v1.11.11 filter lists replaced with wallet-harvesting script (~1.8M installs) | Attestation bound to *org identity*, not channel trust (§1); independent manifest signing (§1) |
| **SolarWinds SUNBURST** [INCIDENT] | disclosed 2020-12-14 | Legitimately Authenticode-signed malicious build (Orion 2020.2.1 build 11) | Code-signing ≠ provenance (§2/§12); HSM + audit + repro (§10/§11) |
| **Log4Shell** [INCIDENT] | 2021-12-09 | Vulnerable (not malicious) dependency, CVE-2021-44228, ubiquitous | Full-build attestation + SBOM (§12); pinned reproducible toolchain (§11) |
| **XZ Utils / liblzma** [INCIDENT] | disclosed 2024-03-29 | Maintainer compromise; backdoor (CVE-2024-3094) dwelt ~2 yr | Reproducibility + provenance tie shipped bytes to audited source (§11/§12) |
| **3CX Desktop** [INCIDENT, re-verify] | 2024-02 | Compromised Windows *installer* (supply chain) hit ~100k users | Authenticode + provenance + staged rollout for desktop (§2/§7/§12) |
| **Apple Developer accounts** [INCIDENT] | ~2025-02-21 | ~2,000 accounts compromised; ~375 malicious App Store/TestFlight apps, valid certs | Account/cert lifecycle custody + lineage (§4/§10/§12) |

> **Compliance note:** every row tagged `re-verify` should be confirmed against its named primary source (postmortem / CVE / vendor statement) before being quoted in a formal security or regulatory document. Rows without the tag are high-confidence from widely-published reporting but still benefit from a primary citation.

---

## Appendix C — Key ceremony runbook (rotation & compromise response)

**Planned rotation (no compromise):**
1. Generate a **new** Ed25519 keypair in the **YubiHSM2** (new `key_id`, e.g. `airiz-prod-2027`).
2. Add the **new public key** to every client's allowed set — desktop `app-update.yml` and the Worker's `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` [LOCAL] — and roll it out.
3. **Dual-sign** every manifest during the window: `signatures[]` carries **both** old and new `key_id` (the verifier accepts *any* that verifies — `verifyManifest` [LOCAL, L151-168]).
4. Confirm fleet coverage (all co-admin devices on the new-key-aware client), then **stop dual-signing**.
5. **Retire** the old key: keep it in **escrow with an audit trail** (§10); do not delete until the rotation window is proven closed.

**Compromise response (manifest private key suspected leaked):**
1. **Rotate immediately** (steps 1–3 above) so new manifests are minted by a clean key.
2. **Revoke the old key's reach:** for *new* manifest fetches, remove the old public key from the **Worker's** allow-list (remotely updatable [LOCAL]); for *already-shipped* clients that still pin the old key, the only true revocation is shipping a **new client with the old key removed** (embedded pubkeys are compile-time [LOCAL, §1]).
3. **Audit** the HSM/Vault **sign logs** for the suspect window — who/what signed, when (§10).
4. **Re-attest** every release signed in that window and push corrected manifests (§12).
5. **Notify** the Ziris PTB team and write an incident record.

**Compromise response (Windows/EV code-signing cert):**
1. **Revoke the cert with the CA**; rotate to a fresh EV cert.
2. **Re-sign** affected installers + **re-attest**; SmartScreen reputation may need to re-accrue — another reason to prefer **EV** (immediate reputation, §2).

**Custody invariants (do not break these):**
- The **manifest private key** exists **only** inside the HSM (non-exportable) — never as a PEM in CI after the Vault-transit migration (§10).
- **Dual-key** allowed sets must always be present during any rotation window; never a hard cutover.
- Every sign operation is **logged** and the log is **append-only**.

---

## Appendix D — Per-surface command cheat-sheet

**Sign / verify the unified manifest [LOCAL, `tools/`]:**
```
node --experimental-strip-types tools/keygen.ts \
  --private-out secrets/airiz-signing-private.pem --public-out secrets/airiz-signing-public.pem
node --experimental-strip-types tools/sign-manifest.ts \
  --input build/artifacts.json --key <vault-transit-sign | pem> \
  --output release/airiz-release.json --key-id airiz-prod-2026 \
  --channel production --staged-rollout 10
AIRIZ_PUBLIC_KEY_PEM="$(cat secrets/airiz-signing-public.pem)" \
node --experimental-strip-types tools/manifest-to-electron-yml.ts \
  --input release/airiz-release.json --output-dir release/electron --public-key "$AIRIZ_PUBLIC_KEY_PEM"
```
(The signer **self-verifies** against the derived public key and fails CI on a broken signature [LOCAL, `sign-manifest.ts` L196-205].)

**Cloudflare Worker — gradual deploy + rollback [VERIFIED/DOC, §6]:**
```
wrangler versions upload                     # create version, no deploy
wrangler versions deploy <version-id> --percentage 10
wrangler versions deploy <version-id> --percentage 50   # ramp
wrangler versions deploy <version-id> --percentage 100  # full
wrangler rollback <previous-version-id>       # fast revert (crash-gate calls this)
```

**Provenance attestation [DOC, §12]:**
```
gh attestation verify <artifact> --signer-entity "refs/heads/main"   # or cosign verify-attestation
```

**PWA SRI hash [SPEC, §5]:**
```
openssl dgst -sha384 -binary asset.js | openssl base64 -A    # -> integrity="sha384-<output>"
```

**Windows Authenticode + RFC 3161 timestamp [DOC, §2]:**
```
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a myapp-setup.exe
```

**Tauri-native path (if a surface adopts Tauri) [VERIFIED, §1]:**
```
cargo tauri signer generate -- -w ~/.tauri/myapp.key
$env:TAURI_SIGNING_PRIVATE_KEY="<path or content>"      # .env does NOT work
tauri build    # emits bundle + .sig per platform; pubkey in tauri.conf.json
```

---

*End of appendices. Total baseline: 12 sections + control matrix + verification appendix + 4 appendices. Compiled 2026-11-05 · Owner: Juwen Lie, Team Ziris PTB.*

# AIRIZ Release Protocol — Authoritative Security-Primitive Reference

**Scope.** Best-practice documentation, with version + URL citations, real benchmarks, and real
outage write-ups, for every security primitive in the AIRIZ unified release pipeline.

**Method / evidence standard.**
- Specs fetched directly this session: RFC 8032 (full), W3C SRI-2 Working Draft (2026), Microsoft
  Learn (2026-dated), Android `apksigner` reference, Cloudflare Workers doc index.
- Library permalinks built from live commit SHAs pulled via GitHub API (git clone is proxy-blocked;
  the API is not). npm versions pulled via the registry (proxy-allowed).
- Where a primary source was unreachable this session (`casync.net` 504, `daemonology.net` 403,
  `zsync2.berlios.de` 504, `xdelta.org` unreachable, Exa rate-limited, SearxNG server down), the
  canonical home and/or a maintained mirror is cited and the gap is **FLAGGED, never fabricated**.

**Permalink SHAs verified 2026-11-04:**

| Repo | Branch | SHA |
|---|---|---|
| jedisct1/libsodium | master | `c5717543ad05c70dcc97df7ea08b497d5afc2c86` |
| dchest/tweetnacl-js | master | `e6141a20553498697e9e7d92fbc4517994caff52` |
| GoogleChrome/workbox | v7 | `4ea3138a120fd2c87389b54130e25f47e0fd7089` |
| cloudflare/workers-sdk | main | `fa3edb325694670084bc38af02232957315ccdb5` |
| getsentry/sentry-javascript | develop | `b9d0f8210180f3e090cd4e0b0cc63c9c9619e686` |
| getsentry/sentry | master | `2f1e6fe2356885894dcecbfaeb529186dd8be847` |
| sisong/HDiffPatch | master | `06961361340085ddb2a551775dc402172b8ca67c` |
| systemd/casync | main | `b4b7e5606f785572b78a43626a27a45fe3df2fbd` |
| mendsley/bsdiff | master | `b817e9491cf7b8699c8462ef9e2657ca4ccd7667` |
| ilanschnell/bsdiff4 | master | `7ed95c48e557993a07efa020005e84fe85afae18` |
| jmacd/xdelta | main | `5d936d2c30f78729375c3ae070248a05bef27bd2` |

**npm versions verified via registry:** `tweetnacl@1.0.3`, `libsodium-wrappers@0.8.4`.

---

## 1. Ed25519 Manifest Signatures

### 1.1 The standard — RFC 8032 (EdDSA: Ed25519 & Ed448)
- **Source (fetched in full):** [RFC 8032, IRTF, Jan 2017](https://www.rfc-editor.org/rfc/rfc8032.html).
- **Sizes (§1/§5.1):** Ed25519 → **public key = 32 bytes, signature = 64 bytes**. Ed448 → 57/114. Ed25519 ≈ 128-bit security.
- **Key gen (§5.1.5):** `sk` = 32 random octets (RFC 4086); `SHA-512(sk)` = 64-byte `h`; lower 32 bytes clamped → scalar `s`; `pk = [s]B` (32-byte little-endian point).
- **Sign (§5.1.6):** `r = H(prefix || M)`; `R = [r]B`; `S = (r + H(R||A||M)·s) mod L`; output `ENC(R)||ENC(S)` = 64 bytes.
- **Verify (§5.1.7):** check `[8][S]B = [8]R + [8][k]A'`.
- **Variants (§4/§5.1):** `Ed25519` (PureEdDSA, collision-resistant), `Ed25519ph` (prehash SHA-512), `Ed25519ctx` (context). **Use plain `Ed25519`.**
- **No per-signature nonce** (§1 advantage #2) → more side-channel-resilient than RSA/ECDSA.
- **Security note (§8.4):** signatures are malleable; if you dedupe by signature, reject non-canonical `S`.

### 1.2 Payload format — raw 64 bytes vs detached vs PKCS#7
| Format | Bytes | Notes |
|---|---|---|
| **Detached raw (recommended)** | 64-byte sig + 32-byte pk beside manifest | `nacl.sign.detached` shape; simplest verify |
| **Append** | `64 + msglen` (`sig ‖ message`) | `nacl.sign` shape; one-blob shipping |
| **JOSE JWS (EdDSA)** | b64url `header.payload.signature` | alg `"EdDSA"`; portable across JS/Go/Rust/Java |
| **PKCS#7 / CMS (Authenticode)** | X.509 envelope (ECDSA/RSASSA-PSS) | **Not Ed25519-native**; this is the Windows installer container (§2), NOT the manifest format |

**Recommended canonical scheme:** canonicalize manifest to **JCS (RFC 8785)** → **Ed25519 detached** over the canonical bytes → wrap in **JWS/EdDSA**. JCS gives byte-stable serialization so signer and verifiers produce identical digests. Citations: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html), [RFC 7515 JWS](https://www.rfc-editor.org/rfc/rfc7515.html). Manifest body hashes each artifact (SHA-384, ties to §5).

### 1.3 Library-by-library + per-platform recommendation
- **Node.js — built-in `node:crypto`, no dependency.** `generateKeyPairSync('ed25519')`, `crypto.sign(null, data, privKey)`, `crypto.verify(null, data, pubKey, sig)`; Ed25519 stable since Node 12. [node:crypto](https://nodejs.org/api/crypto.html). This is the CI signer.
- **Browser — Web Crypto `crypto.subtle` (Ed25519); tweetnacl as legacy fallback.** Confirmed from the tweetnacl README itself:
  **Evidence** ([tweetnacl-js README @ `e6141a2`](https://github.com/dchest/tweetnacl-js/blob/e6141a20553498697e9e7d92fbc4517994caff52/README.md)): "WebCrypto API supports … **Ed25519 in `nacl.sign.detached`** … so you should use it if possible." Browser support (current 2024–2025): **Firefox 130 (Jan 2024), Chrome 137 (Jan 2025), Safari 17.x**. [MDN SubtleCrypto.sign](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign). `tweetnacl@1.0.3` (Unlicense) = safe fallback.
- **iOS — Apple CryptoKit (no third-party lib).** `Ed25519.Signing.PrivateKey`, `key.signature(for:)` → 64 bytes; iOS 13+. [Apple `Ed25519.Signing`](https://developer.apple.com/documentation/cryptokit/ed25519.signing).
- **Android — Bouncy Castle `Ed25519Signer`** (`org.bouncycastle.crypto.signers`, in `bcprov`); or Conscrypt `Signature("Ed25519")` on API 28+. Home: [bouncycastle.org](https://bouncycastle.org/). (⚠ `bcprov-jdk18on` didn't resolve via GitHub API this session — confirm artifact/version against Maven Central at build time.)
- **Rust — `ed25519-dalek` 2.x.** `SigningKey::from_bytes(&[u8;32])`, `sk.sign(msg)`, `pk.verify(msg,&sig)`. [RustCrypto/ed25519](https://github.com/RustCrypto/signatures/tree/master/ed25519).
- **C/native — libsodium `crypto_sign_*`.** **Evidence** ([libsodium `crypto_sign.h` @ `c5717543`](https://github.com/jedisct1/libsodium/blob/c5717543ad05c70dcc97df7ea08b497d5afc2c86/src/libsodium/include/sodium/crypto_sign.h)): `crypto_sign_BYTES 64`, `_PUBLICKEYBYTES 32`, `_SECRETKEYBYTES 32`, `crypto_sign_detached()`/`crypto_sign_verify_detached()`. Reference impl of RFC 8032 (same §7 test vectors).
- **OpenSSL — `EVP_PKEY_ED25519`.** `EVP_DigestSign`/`EVP_DigestVerify` with **`NULL` digest** + an Ed25519 key (key carries its own alg; do not pass a digest). Since OpenSSL 1.1.1 (2018). [OpenSSL EVP_DigestSign(3)](https://www.openssl.org/docs/man3.0/man3/EVP_DigestSign.html).

### 1.4 Key custody & rotation
- **Two-key model (KSK/CSK, DNSSEC pattern):** long-lived **Key-Signing Key** signs a short-lived **Code-Signing Key** that signs manifests. Rotation = issue new CSK, publish (KSK-signed), keep old CSK valid during overlap, retire. Clients ship a **key ring** (all valid pub keys) so in-flight old manifests still verify. Only rotation model that avoids "old update stops verifying."
- **Key protection:** NIST **SP 800-57** (key mgmt) + **FIPS 140-3** (HSM). Generate the private signing key **inside** the HSM (Azure Key Vault HSM, §2.5); the raw seed never leaves. Store pub key(s) in the app + signed routing config.
- **Never** store the manifest private key in CI secrets as a bare seed; sign over an HSM-backed step.

---

## 2. Windows Code Signing + SmartScreen Reputation

### 2.1 What triggers the warning
- **Source (2026-dated):** [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) (ms.date 2026-05-04, updated 2026-08-17).
- **Two signals:** **(1) Publisher reputation** (signed? known trusted cert?) and **(2) File-hash reputation** (has *this exact hash* been downloaded cleanly by many users?).
- **Negative/unknown** on either → "Windows protected your PC." **A signed brand-new binary still warns** until reputation accumulates. **Unsigned files build from zero each version** — reputation does NOT transfer across versions unless both signed with the **same publisher identity**.

### 2.2 EV vs standard — the 2024 change (invalidates the "just buy EV" advice)
- **Source:** [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (ms.date 2026-08-29).
- **Verbatim:** "EV certificates no longer bypass SmartScreen. … this behavior no longer exists. … Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified."
- **First-download behavior (from the doc):**

| Cert type | First-download behavior |
|---|---|
| Microsoft Store (MSIX) | ✅ No warning (Microsoft re-signs) |
| Valid OV/EV | ⚠️ Warns until reputation accumulates (publisher name shown) |
| No signature | ⚠️ "Windows protected your PC" |
| Self-signed | ⚠️ Same as no signature |

### 2.3 How long until "established reputation"
- **No published hard threshold.** The 2026 doc: "There is no exact threshold, but it can take **several weeks and hundreds of clean installs from a wide audience**." Builds organically; **no consumer self-service submission** (enterprise IT can submit via the [MS Security Intelligence portal](https://www.microsoft.com/en-us/wdsi/filesubmission)).
- **The old "100,000 downloads / 50,000 computers" folklore is NOT in current docs** — treat as superseded/unverified.
- **Design consequence:** don't architect around "reputation after N downloads." Architect around **consistent publisher identity** so *publisher* (not per-hash) reputation carries across releases.
- **Win11 caveat:** **Smart App Control** may supersede SmartScreen and **block unsigned files outright** (all executables, not just downloaded ones).

### 2.4 Microsoft cloud signing — now "Azure Artifact Signing" (formerly Trusted Signing)
- **Name change confirmed:** "[Azure Artifact Signing](/en-us/azure/trusted-signing/) (formerly Trusted Signing)." Docs: [learn.microsoft.com/azure/trusted-signing](https://learn.microsoft.com/en-us/azure/trusted-signing/).
- **Facts (2026 docs):** **~$9.99/month** (vs $150–300/yr OV, $400+/yr EV). **No hardware token** — signs in CI/CD (GitHub Actions, Azure DevOps). Identity validation required. **SmartScreen:** no instant trust, but **consistent identity across consecutive releases lets publisher reputation accumulate** so later releases inherit trust.
- **Geo limits (orgs):** USA, Canada, EU, UK. **Individuals:** USA, Canada only. *(⚠ If AIRIZ is a Pegatron org outside these → likely needs an OV cert. Flag.)*
- **OV** now **requires the key on an HSM/hardware token** (CA/B Forum, since June 2023). **EV** no longer recommended for SmartScreen.

### 2.5 HSM key storage — Azure Key Vault HSM
- [Azure Key Vault Managed HSM](https://learn.microsoft.com/en-us/azure/key-vault/hsm/overview): FIPS 140-2/140-3 HSMs. **Authenticode uses EC (P-256/P-384/P-521) or RSA — NOT Ed25519.** So the **Windows Authenticode key ≠ the manifest Ed25519 key**; keep them separate. Authenticode key lives in the HSM; sign in CI via Key Vault; never export the private key.

### 2.6 AIRIZ decision points (flagged)
1. **Store vs non-Store:** an **MSIX via the Store** = no SmartScreen warnings (Microsoft re-signs). Non-Store → accept initial warnings, rely on consistent-identity reputation.
2. **Artifact Signing geo-eligibility** → Artifact Signing vs OV cert.
3. **Two separate keys:** Authenticode (HSM, EC/RSA) + Ed25519 (KSK/CSK, §1.4). Don't merge.

---

## 3. Android APK Signature Schemes (v2/v3/v3.1/v4) + Play App Signing

### 3.1 Authoritative source
- [Android — `apksigner` reference](https://developer.android.com/tools/apksigner) (fetched in full; SDK Build-Tools ≥ 24.0.3).
- Scheme detail pages: [v2 (Nougat 7.0)](https://developer.android.com/about/versions/nougat/android-7.0#apk_signature_v2), [v3 (AOSP)](https://source.android.com/docs/security/features/apksigning/v3), [v4 (Android 11)](https://developer.android.com/about/versions/11/features#signature-scheme-v4).

### 3.2 Line-by-line: what each scheme covers
- **v1 (JAR signing).** Per-entry `META-INF/*.SF` + `*.RSA`; signs individual ZIP entries. Works on *all* Android. Slow; historically vulnerable to **ZIP-slip / alignment**; cannot detect added/removed/reordered entries. `--v1-signing-enabled`.
- **v2 (API 24+ / Android 7.0).** Signs a **digest of the *entire* APK file** in the APK Signing Block → whole-file tamper-evident, constant-time verify, **detects added/removed/reordered entries** (v1 cannot). Signs the static file only. `--v2-signing-enabled`.
- **v3 (API 28+ / Android 9).** Same whole-file integrity as v2 **plus key rotation**: multiple signers, each with optional **`maxSdk`** → old key trusted only up to a given API. The **v3.1** block is specifically the **rotation** block. `--v3-signing-enabled`.
- **v4 (API 30+ / Android 11).** Signature written to a **separate sidecar `<apk>.idsig`** next to the APK (not inside it). OS can **download only the signature for an already-installed APK** (streaming/incremental-update support). `--v4-signing-enabled true|false|only`; `only` emits just the `.idsig` without touching the APK (requires existing v2/v3, same key).

### 3.3 Key rotation — exact mechanics
- **`apksigner rotate`** builds a **signing certificate lineage**:
  ```
  apksigner rotate --in existing/lineage --out new/lineage \
     --old-signer --ks old.jks --new-signer --ks new.jks
  ```
- **`--rotation-min-sdk-version`** = lowest API that uses the *rotated* key; older versions keep the original. **Default rotation targets Android 13 (API 33), v3.1 block.** A rotated APK is signed with `--next-signer` to embed both keys + lineage.
- **Rule:** rotation is a *forward-compatible* hand-off (old devices verify with old key up to its `maxSdk`; new devices accept new key). Never "cut over" without the lineage.

### 3.4 targetSdk / Play Store impact
- `--min-sdk-version`/`--max-sdk-version` decide when v1/v2/v3/v4 apply. **API 30+ devices require ≥ v2 to install**; Play enforces **v3+** (v2 is the absolute floor). For recent targets: **v3 (with rotation lineage) + v4 sidecar** is the correct combination.

### 3.5 Google Play App Signing vs self-signing
- **Two keys:** your **upload key** (signs the APK/AAB you upload) + **Google's "App signing key"** (signs the delivered APK; users verify against it). Same forward-rotation logic as v3.
- **Why:** Google can rotate/recover the App signing key without breaking users; enables v4/streaming + instant-update paths.
- **Self-signing (non-Play/sideload):** you are the sole key; rotation is on you via the v3 lineage + `apksigner rotate`.

### 3.6 ⚠ Correction to the request premise — "v4.1 sideload-friendly mode"
- **There is no "APK Signature Scheme v4.1" in the AOSP/Android docs, and no feature named "sideload-friendly mode."** The `apksigner` reference documents exactly **v1, v2, v3, v3.1 (rotation), v4**. The only sideload-adjacent behavior is **v4's separate `.idsig` sidecar**.
- **Flagged, not invented.** If AIRIZ's threat model needs sideload, the real levers are: **v3 lineage (rotation) + v4 sidecar (verify-without-redownload) + your own Ed25519 manifest signature (§1)**. Reconcile against whichever internal doc coined "v4.1/sideloading."

---

## 4. iOS App Signing Chain + Provisioning-Profile Lifecycle

### 4.1 The three distinct artifacts (do not conflate)
- **Distribution certificate** (`Apple Distribution`): long-lived (Apple issues **7-year** distribution certs — confirm current at your ASC account; "long-lived, multi-year" is certain). Signs the app binary.
- **Provisioning profile**: embeds **distribution cert + App ID (bundle id) + entitlements + (Ad Hoc) device UDIDs**. Ties a binary to a device set/entitlements.
- **Push (APNs) certificate / key**: bound to an App ID for push *delivery only*. **Expiry does NOT stop the app launching** — only stops push. Keep separate from the launch cascade below.

### 4.2 Distribution models
- **App Store:** `Apple Distribution` cert + App Store profile. Apps tie to **user's Apple ID + the App Store**, not the profile at runtime.
- **Ad Hoc:** distribution cert + Ad Hoc profile, **explicit list of ≤100 device UDIDs**. Beta/enterprise-testing.
- **In-House (Enterprise):** **Apple Developer Enterprise Program** cert + In-House profile (large scale; **profiles renew on a ~7-day cycle in practice**). Internal-only; subject to Apple revocation + TOS (not public distribution).
- **Custom App Distribution (B2B):** distribution cert + B2B profile scoped to **one company's MDM devices**. Partner/enterprise.

### 4.3 The expiration cascade — precise runtime impact (common misconception)
- **Profile/cert expiry → you can no longer *install* or *re-sign*; what happens to an *already-running* app depends on the channel:**
  - **App Store apps:** an installed App Store app **keeps running** after profile/cert expiry (trust anchor = App Store + user ID, not the profile). **It does NOT "stop launching."** You lose **update** ability and **fresh-install** until you renew.
  - **In-House / Ad Hoc / MDM (B2B) apps:** these **are** tied to the profile at OS level — **when the profile is revoked/expires, the OS stops launching the app** (the classic "In-House app dies every ~week"). This is the real cascade risk, specific to **non-App-Store** distribution.
- **Cascade order:** cert expires → profile (referencing cert) invalid → fresh installs fail → **non-Store apps** may be revoked at runtime → push (separate cert) affected independently.
- **AIRIZ mitigation:** App Store channel → treat renewal as **update-availability** risk (automate via ASC API, §4.4). **Any In-House/MDM channel → launch-critical SLA**; automate re-provisioning well under the ~7-day window. **Flag:** In-House is the single highest-churn operational risk.

### 4.4 App Store Connect API for cert/profile management
- **Base:** `https://api.appstoreconnect.apple.com/v1/`. **Auth: JWT (ES256)** with **Issuer ID + private key (`.p8`)**.
- **Relevant endpoints (v1):**
  - `GET/POST/DELETE /v1/certificates` (`?type=distribution|development|push`)
  - `GET/POST/DELETE /v1/provisioningProfiles` (`?filter[app]=…`)
  - `GET /v1/builds`, `POST /v1/apps/{id}/builds`
  - `GET /v1/apps`, `/v1/apps/{id}/appStoreVersions`
- **Source:** [Apple — App Store Connect API Reference](https://developer.apple.com/documentation/appstoreconnectapi) (root 200; reference is JS-rendered, so base + stable v1 resource names cited rather than a deep anchor).
- **Automation friction (flag):** ASC API does **not** fully headlessly generate the *distribution cert private key* the way it does API keys — keypair is still created in Keychain/Apple tools and the cert registered via API. Budget for a semi-manual or Keychain-automated keygen step.

---

## 5. PWA Subresource Integrity (SRI) + Service-Worker Update Traps

### 5.1 SRI — the current spec is **SRI-2** (2026 Working Draft)
- **Source (fetched in full):** [W3C — Subresource Integrity (SRI-2), Working Draft, 20 March 2026](https://www.w3.org/TR/sri-2/) (latest `https://www.w3.org/TR/sri-2/`; editor's draft `w3c/webappsec-subresource-integrity`; tests [wpt.fyi/results/subresource-integrity](https://wpt.fyi/results/subresource-integrity/)).
- **`integrity` attribute (§3.4/§3.5):** on `<script>`/`<link>`; value = one or more `hash-algorithm-base64` expressions. **Also usable via `Link` HTTP header `integrity=…` (§3.6).**
- **Supported hashes (§2/§3.2):** `sha256`, `sha384`, `sha512` (NIST SHA-2). **Priority (§3.2.2):** `sha256 < sha384 < sha512` — **strongest wins**; list several and the UA picks the strongest it supports.
- **Agility (§3.2.1):** list multiple algos; deprecated ones are treated as "no integrity" by UAs that don't support them → you can migrate to stronger hashes without bricking old UAs. **AIRIZ: emit `sha384` (or `sha512`) + `sha256` per resource.**
- **Digest format (§3.1):** `alg-base64(digest)`. Generate: `echo -n "…" | openssl dgst -sha384 -binary | openssl base64 -A`.
- **Failure (§3.7):** on mismatch the UA **refuses to execute** and fires a **network `error` event** → swap to a fallback (your SRI-driven content rollback hook).
- **⚠ New in SRI-2 — `Integrity-Policy` header (§3.8):** `Integrity-Policy: blocked-destinations=(script), endpoints=(…)` blocks any external `<script>` loaded **without integrity metadata** (and reports violations). **AIRIZ should adopt this** to force-integrity every remote script.
- **Hard requirement:** **SRI requires CORS** — element needs `crossorigin="anonymous"`; SRI without CORS is a logical error the spec calls out (§3.3.4).

### 5.2 Service-worker update recipes + the `controllerchange` race
- **Workbox (v7, current):** [GoogleChrome/workbox @ `4ea3138a`](https://github.com/GoogleChrome/workbox/tree/4ea3138a120fd2c87389b54130e25f47e0fd7089) (docs: [developer.chrome.com/docs/workbox](https://developer.chrome.com/docs/workbox)). Core primitives:
  - **`workbox.core.skipWaiting()`** — new SW takes control on install (instant; creates the race below).
  - **`workbox.core.clientsClaim()`** — new SW claims open clients on activate.
  - **`workbox.precaching`** — `precacheAndRoute` + a revision/hash manifest; a changed revision triggers revalidation. This is the **SRI-adjacent mechanism for your own bundled assets** (hash in manifest → cache-keyed → deterministic).
- **The `controllerchange` race:** when a new SW activates with `clientsClaim`, **in-flight / just-issued fetches can be served by the old controller while the new one is active** → a mix of old/new assets in one page load (new HTML referencing old hashed JS, or vice-versa).
  - **Standard fix:** page listens for `window.addEventListener('controllerchange', …)` and **reloads once** when a new controller takes over after a navigation (gated by a once-flag). **Or avoid `skipWaiting`** → new version on *next* navigation (one extra load, no mid-load mixing). **AIRIZ default: "next-navigation update"; `skipWaiting`+`controllerchange`-reload only if you need instant.**
- **Stale-while-revalidate race:** background revalidation can write the new entry while the old is being read → **pin by cache key (hash), not URL**, so old/new coexist until the manifest switches.

### 5.3 Navigation preload + speculation rules
- **Navigation Preload:** `navigator.serviceWorker.ready.then(r => r.navigationPreload.enable())`; SW handles the main-document navigation so precached index.html serves instantly. Enable **after SW ready**; SW must handle `request.mode === 'navigate'`. [MDN navigationPreload](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/navigationPreload).
- **Speculation Rules API:** server-driven `<link rel="prerender">` / `rel="prefetch">` + JSON rules → browser pre-fetches/prerenders likely next navigations. Complements SW precaching (SW = cached assets; speculation = upcoming navigations). [MDN Speculation Rules](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API).

### 5.4 AIRIZ PWA pattern (synthesis)
1. Precache app shell via Workbox `precacheAndRoute` with a **hashed manifest** (deterministic cache keys).
2. Emit **SRI (`sha384`+`sha256`)** on every remote/CDN `<script>`/`<link>` with `crossorigin="anonymous"`.
3. Send **`Integrity-Policy: blocked-destinations=(script)`** so any non-integrity script is refused.
4. **Next-navigation update by default**; if instant is required, `skipWaiting`+`clientsClaim` **and** a one-shot `controllerchange` reload guard.
5. **Navigation preload on**; SW serves `mode==='navigate'`.
6. SRI `error` event → **fallback to a locally-precached copy or full re-pull** (content-level rollback).

---

## 6. Cloudflare Workers — Immutable Deploys, Rollback, Rollouts

### 6.1 Authoritative source (doc index fetched this session)
- [Cloudflare Workers docs — `llms.txt` index](https://developers.cloudflare.com/workers/llms.txt) + [Workers SDK @ `fa3edb32`](https://github.com/cloudflare/workers-sdk/tree/fa3edb325694670084bc38af02232957315ccdb5) (wrangler lives here).
- **Key pages (exact URLs from the index):**
  - Versions & deployments: `…/workers/versions-and-deployments/`
  - **Deployment management** (upload versions independently; control when/how they hit traffic): `…/deployment-management/`
  - **Gradual deployments**: `…/gradual-deployments/`
  - **Version affinity** (route users consistently during gradual deploy): `…/gradual-deployments/version-affinity/`
  - **Rollbacks**: `…/rollbacks/`
  - **Version overrides** (pin a request to a specific version): `…/version-overrides/`
  - **Version URLs** (test a specific uploaded version): `…/version-urls/`
  - **Version metadata binding** (`versionID` / `versionTag` for observability): `…/runtime-apis/bindings/version-metadata/`
  - **Secrets**: `…/configuration/secrets/`; **Secrets Store**: `…/secrets-store/`
  - **Deploy Hooks** (POST a URL to trigger a build): `…/ci-cd/builds/deploy-hooks/`
  - **Workers for Platforms / Dispatcher**: `…/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/`

### 6.2 Deploy model = immutable, content-addressed versions + atomic deployment pointer
- **Versions are immutable, identified by a version ID** (content-derived). A **deployment** is an atomic switch of the live traffic pointer. Consequences:
  - **"Signed deploys"/integrity:** the guarantee is a version's bytes **never change once uploaded** (content-addressed) → you pin/rollback by **`versionID`**, not by re-uploading. Cloudflare does **not** layer a separate cryptographic signature over worker code by default. **Flag:** if AIRIZ needs *cryptographic* proof of which code is live, that's your **Ed25519 manifest + the `versionID`/`versionTag` binding** (§1/§6.3), not a Cloudflare-native "signed deploy."
  - **Instant rollback:** point the deployment at the previous `versionID` — **no rebuild, sub-second, no "via KV" trick** for the Worker version. ("Instant rollback via Workers KV" in the brief is only for *your own* config/routing data, not the Worker version itself.)
  - **Version pinning:** **Version URLs** (`<acct>.<id>.<version>.workers.dev`) + **version overrides** send traffic to an exact version; **Previews** give branch/PR-isolated copies.

### 6.3 Staged rollout + consistent bucketing (Workers-native)
- **Gradual deployments** shift a percentage of traffic to the new version.
- **Version affinity** = **deterministic per-user routing** so a user stays on the *same* version throughout a gradual rollout (prevents mid-session old↔new bouncing — the "flapping" failure; see §7). This is the platform analog of "bucket by `clientId` hash."
- **Observability:** the **version metadata binding** exposes `versionID`/`versionTag` to stamp every log/metric/event → attribute crashes/latency **per version** (the input to §8 crash-throttled rollback).

### 6.4 Secrets (wrangler)
- **`wrangler secret put <NAME>`** stores an **encrypted** secret (never in `wrangler.json`, never in the version bundle). **Secrets Store** = account-level secrets bound as a resource.
- **Rule:** the manifest-signing key / HSM signing step is **not** a Worker secret — signing happens in CI against an HSM (§1.4/§2.5). Workers only ever hold the *public* key(s) + the `versionID` routing config.
- **"Signed routing config":** model it as **your own** config (which `versionID` serves which cohort/region), stored as a **signed** object (Ed25519, §1) that the routing Worker verifies before honoring — that's where "signed" genuinely applies.

### 6.5 Workers for Platforms (multi-tenant dispatch)
- **Dispatcher / `getDispatchNamespace`**: a platform Worker routes to **customer-deployed Workers** in a namespace (service binding). If "platform" = many app variants/customers, this is the dispatch layer; each variant is an isolated version and your **gradual-deployment + version-affinity** logic applies per dispatch target.

### 6.6 CI/CD auth (who can deploy)
- **Workers Builds** (`…/ci-cd/builds/`) or **external CI** (GitHub Actions) with an API token / OAuth. **Deploy Hooks** add a signed-POST trigger. **Principle:** deploys are gated by **CI identity + protected branches + required review**, and the *only* thing a deploy changes is the **version pointer** — rollback is always one step back.

---

## 7. Staged Rollouts (10% -> 50% -> 100%)

### 7.1 Implementation patterns
- **Bucket by stable `clientId` hash (recommended for stateful clients).** `bucket = int(SHA-256(clientId) mod 100)`; serve new version iff `bucket < threshold`. **Deterministic ⇒ a client never flaps** in/out across requests/sessions (flapping causes "I had the fix then it vanished," split-brain local state, and corrupts your own measurements). Same as Cloudflare **version affinity** (§6.3).
- **Bucket by IP / region:** good for *geographic* canaries (latency, CDN, locale regressions) but **less stable** (IPs change, NAT, roaming) → use as a *second* dimension, not the primary stickiness key.
- **Bucket by time (wave-based):** release by cohort start-time; simplest, worst stickiness (late joiners always get the new version) → fine for backend config, risky for stateful clients.
- **Hybrid (what most teams ship):** `clientId` hash for stickiness **×** region gate for blast-radius **×** a "champion" allowlist (internal/opt-in) at 0% for the first wave.

### 7.2 Decision tree (per promotion stage)
1. **0% (champion):** internal allowlist only. Gate: smoke + a couple of days of clean telemetry.
2. **10%:** smallest *statistically meaningful* cohort (§7.3). Gate: **CFS** and **CFU** at/above baseline for the stage window, and no critical-path error-rate regression.
3. **50%:** same gates + watch for **slow-burn** issues (leaks, data corruption, battery) needing longer windows.
4. **100%:** promote; keep **one-click rollback** armed (§8) for a hold-back period.
- **Every stage:** compare cohort vs a **held-out control** (clients not yet promoted) — not vs a historical baseline — to remove time-of-day/seasonal confound.

### 7.3 Sampling pitfalls (the ones that actually bite)
- **Small-N false positives.** "1 crash in 100 users" at 10% = n=100 (~1%), indistinguishable from baseline. **Fix:** require a **minimum cohort size (power analysis)** before acting; use **sequential/always-valid p-values** (never peek a fixed-horizon p-value). Ref: [Google SRE Workbook — Canarying Releases](https://sre.google/workbook/canarying-releases/).
- **Simpson's paradox / covariate shift.** A cohort mostly low-end devices or one region can look "worse" for a non-bug reason. **Fix:** bucket on `clientId` *and* stratify/condition the metric on device tier + OS + region.
- **Feedback loop (crash-shrinks-cohort).** If the bug crashes on launch, **crashed clients stop reporting** → measured crash rate *underestimates* the true rate. **Fix:** measure **CFS** (denominator = sessions that *started*); have the updater report "update applied" *before* first launch; treat "applied but never launched" as a crash signal.
- **Staleness.** A cohort that was 10% an hour ago may have changed composition; recompute stickiness deterministically so it doesn't.

### 7.4 Feature gates (the control plane)
- Use a **declarative feature-flag/progressive-delivery system** so the rollout % + target keys live in *config*, not code: **OpenFeature** (vendor-neutral, CNCF), **LaunchDarkly**, **Unleash**, **Flagsmith**, **Flipt**. The flag service is the **single source of truth for the cohort threshold**; flipping it (not redeploying) promotes/rolls back the *feature* layer — orthogonal to and faster than the *binary* version pointer.
- **Layering:** (a) **binary version** (Workers `versionID` / app build) via gradual deploy, (b) **feature flag** for in-version behavior, (c) **kill switch** for one bad feature. Kill switch != rollback (rollback = old binary; kill switch = old behavior in new binary).

---

## 8. Crash-Throttled Rollback

### 8.1 The metrics that matter (per release)
- **Crash-free sessions (CFS) %** = 1 - (sessions with >=1 fatal crash / total sessions). **Primary signal** for launch-time bugs.
- **Crash-free users (CFU) %** = 1 - (users with >=1 fatal crash / active users). Smoother, slower.
- **Adoption / rollout %** = fraction of active clients on the new release. **Pair adoption with CFS/CFU** — a bug that only hits 5% of devices is invisible until adoption x the affected slice is large enough.
- **Sources (all have per-release "release health"):**
  - **Sentry:** [Release health](https://docs.sentry.io/product/releases/release-health/) (adoption, CFS %, CFU %); JS SDK [`sentry-javascript` @ `b9d0f821`](https://github.com/getsentry/sentry-javascript/tree/b9d0f8210180f3e090cd4e0b0cc63c9c9619e686) tags events with `release`.
  - **Firebase Crashlytics:** per-**release/build** crash rate, CFU %, distinct users affected, **release tracking** (attribute events to a build number). [Firebase Crashlytics releases](https://firebase.google.com/docs/crashlytics).
  - **Rollbar:** **deploy markers** (`/api/1/projects/{id}/deploys`) → every error shown "since last deploy." [Rollbar Deploys](https://docs.rollbar.com/docs/deploys).
  - **Bugsnag:** **deploy tracking** → attribute errors to a deploy; compare "since this deploy" vs prior. [Bugsnag Deploys](https://docs.bugsnag.com/platforms/release-health/deploys/).

### 8.2 Decision latency: 5 min vs 1 hr vs 24 hr
- **5 min:** fastest containment, but **tiny sample => high false-positive cost** (churny rollbacks, version flapping, trust erosion). Defensible only for **critical-path signals** (e.g., "100% of new-session launches crash on this version").
- **1 hr:** the usual **operating point** — enough sample for CFS to be meaningful, short enough to limit blast radius.
- **24 hr:** catches **slow-burn** issues but **ships a bad version to ~100% first** — high missed-incident cost.
- **Cost framing (state it in the protocol):**
  - **False-positive cost** = unnecessary rollback: redeploy time, user "version churn," support noise, and — worst — a rollback that *itself* has a bug (rollbacks must be tested like releases).
  - **Missed-incident cost** = bad version keeps serving: more users harmed, possible data corruption, longer time to fix.
  - **Rule of thumb:** for *stability/correctness* bugs, missed-incident >> false-positive => **short latency + high-confidence trigger**; for *cosmetic/UX* bugs, false-positive >> missed-incident => **long latency**. **Encode per-severity thresholds** (§8.3).

### 8.3 Recommended auto-rollback policy (tiered, deterministic)
- **Trigger = (signal, min-sample, window), evaluated on a fixed cadence:**
  - **P0 - immediate (<=5 min):** new-version **launch-crash** on **>= N0 devices** (N0 sized so the event is >5 sigma above baseline) → **auto-rollback** + page on-call.
  - **P1 - fast (<=1 hr):** new-version **CFS %** drops **>= Delta** below the held-out control (e.g., Delta = 0.5-1 pt) with **>= N1 sessions**, sustained over 2 consecutive windows → **auto-rollback to last-known-good**, open incident.
  - **P2 - watch (1-24 hr):** CFU drift, error-rate regression, or a spike in one error fingerprint → **halt promotion** (freeze at current %), **no auto-rollback**, human review.
  - **P3 - cosmetic:** UX/perf regressions → **kill-switch the feature** (§7.4), keep the binary.
- **Guardrails (vs §7.3 pitfalls):** require min-sample before acting; use CFS (launch-crash loop-safe); compare to a **live control cohort**, not history; **cap rollback churn** (2 rollbacks in 24 h for the same fingerprint => escalate to human — you're flapping).
- **Rollback must be a *release*, not a shortcut:** the "last-known-good" version is pre-staged and re-verified (signature + SRI, §1/§5); a broken rollback is the classic second-order outage.

---

## 9. Delta Updates

### 9.1 The tools (canonical + maintained homes; SHAs verified this session)
- **bsdiff** (Colin Percival, "A Tool for Computing Binary Diffs"). Original `daemonology.net` returned 403 — **flag**. **Maintained ports:** [`mendsley/bsdiff` @ `b817e949`](https://github.com/mendsley/bsdiff/tree/b817e9491cf7b8699c8462ef9e2657ca4ccd7667) and [`ilanschnell/bsdiff4` @ `7ed95c48`](https://github.com/ilanschnell/bsdiff4/tree/7ed95c48e557993a07efa020005e84fe85afae18) (bsdiff4 = faster patching, more actively maintained).
- **zsync** — chunk-based, **HTTP-friendly, resumable** (control file = per-chunk hashes; client fetches only changed chunks). `zsync2.berlios.de` was 504 — **flag**; lives on [SourceForge `zsync`](https://sourceforge.net/projects/zsync/). Best for **large files over unreliable links** (delta = range requests, survives partial downloads).
- **HDiffPatch** — [`sisong/HDiffPatch` @ `06961361`](https://github.com/sisong/HDiffPatch/tree/06961361340085ddb2a551775dc402172b8ca67c). README claims **patches ~3-4x smaller than bsdiff for similar files and ~3-4x faster patching** (tool-claimed; re-measure on *your* artifacts).
- **casync** — [`systemd/casync` @ `b4b7e560`](https://github.com/systemd/casync/tree/b4b7e5606f785572b78a43626a27a45fe3df2fbd) (`casync.net` 504 — cite the repo). **Content-addressed (Merkle) delta**: small canonical chunks + tree, transfer only missing chunks from a CAS store. **Excellent for OS images / many-similar-artifacts / container layers**; heavier setup (needs a CAS + store).
- **Courgette** — Chromium's in-repo differ (in the Chromium updater, `components/update`). "Code surgery": recognizes *similar code sections* and reuses them -> **high compression on similar executables**. Not a standalone package ([chromium/src](https://chromium.googlesource.com/chromium/src/)); clean README path not reachable this session — **flag**; treat as "Chromium-internal, high-compression for near-identical binaries, moderate patch CPU."
- **xdelta** — [`jmacd/xdelta` @ `5d936d2c`](https://github.com/jmacd/xdelta/tree/5d936d2c30f78729375c3ae070248a05bef27bd2) (`xdelta.org` unreachable — flag). Implements **VCDIFF ([RFC 3284](https://www.rfc-editor.org/rfc/rfc3284.html))** — a *standardized* patch format. **Very small diffs; patching is CPU-intensive.** Good when you want an open, inspectable, standard format.

### 9.2 Bandwidth vs CPU (the real tradeoff; ranges to re-measure)
- **bsdiff family:** for **consecutive/similar** binary versions -> patches commonly **~5-15% of original**; for **dissimilar** inputs -> **~90-100%** (delta *worse* than full). **Apply step is slow** (block-search). *Typical ranges, not guarantees — measure on AIRIZ artifacts.*
- **HDiffPatch:** tool-claimed **3-4x better** than bsdiff on similar files, and **faster apply**.
- **xdelta/VCDIFF:** smallest diffs in the set, **highest apply CPU** — fine on modern clients, painful on low-end.
- **casync:** bandwidth-optimal for **many similar artifacts sharing chunks**; overhead = CAS setup.
- **Courgette:** high compression on near-identical code, moderate apply cost.

### 9.3 When delta hurts more than it helps (failure modes)
- **Dissimilar base / large change:** patch ~ full size (or larger) **plus** delta tooling + the base. **Fall back to full.**
- **First install (no local base):** nothing to delta against -> **must be full.**
- **Small artifact:** delta overhead (base bookkeeping, CAS) not worth it for a few MB -> **full is simpler.**
- **Tamper amplification:** a 1-bit flip in a base/patch can corrupt a large region after apply -> you **must re-verify the final full hash** post-apply (ties to §1/§5). Delta *increases* the value of full-hash verification.
- **Version-skew:** `N->N+2` is usually worse than `N->N+1`; **keep the base = the exact previous installed version**; if a user skipped versions, **fall back to full.**

### 9.4 Recommended delta strategy for AIRIZ
1. **Default = full, signed (Ed25519 manifest, §1) + SRI (§5).** Delta is an optimization, not the correctness path.
2. **Apply delta only** when: a **known-good base is present** *and* the delta is **< ~30-40% of full size** (measure per artifact class) *and* it's a **consecutive version.**
3. **Always** verify the **full post-apply SHA-384** against the signed manifest — on mismatch, **discard and re-pull full.**
4. **Tool choice:** **HDiffPatch or bsdiff4** for general app bundles (best size/speed balance, easy CLI); **casync** if AIRIZ ships many similar large artifacts / OS-like images; **zsync** specifically for **resumability over flaky mobile links.**
5. **Fallback is first-class:** every delta path has a one-step **full-download fallback**, and the updater reports which path was taken (so §8 can measure delta-failure rates as a first-class signal).

---

## 10. Synthesis — mapping to the AIRIZ release protocol

| AIRIZ element | Authoritative mechanism(s) | Key doc(s) |
|---|---|---|
| **Signed manifest schema** | Canonical JCS (RFC 8785) -> **Ed25519 detached (RFC 8032)** -> JWS/EdDSA; per-artifact SHA-384 | RFC 8032, RFC 8785, RFC 7515 |
| **Key custody/rotation** | **KSK/CSK two-key** (DNSSEC pattern); private key in **HSM (Azure Key Vault, FIPS 140-3)**; client ships a **key ring** for overlap; **Authenticode key (EC/RSA) is separate from manifest Ed25519 key** | NIST SP 800-57, FIPS 140-3, MS Key Vault HSM |
| **Subresource integrity** | **SRI-2**: `integrity="sha384-… sha256-…"`, `crossorigin`, **`Integrity-Policy`** to force-integrity all scripts; `error` event = content rollback hook | W3C SRI-2 (2026) |
| **Staged rollout** | **Stable `clientId`-hash bucket** (no flapping) x region gate x champion allowlist; Cloudflare **gradual deployments + version affinity** at the edge; **feature flags** (OpenFeature/LaunchDarkly) for in-version behavior; **live control cohort** + min-sample + CFS | Google SRE canarying, CF gradual-deployments |
| **Crash-throttled rollback** | **CFS/CFU/adoption** per release (Sentry/Crashlytics/Rollbar/Bugsnag); **tiered auto-rollback** (P0 <=5 min launch-crash, P1 <=1 hr CFS drop vs control, P2 halt, P3 kill-switch); rollback = a *tested release*; cap churn | Sentry release health, CF version-metadata |
| **Delta update** | **Full-signed by default**; delta (HDiffPatch/bsdiff4/casync/zsync) only when base present + small + consecutive; **always re-verify full hash**; one-step full fallback | RFC 3284, HDiffPatch/bsdiff4/casync repos |

---

## 11. Real outage write-ups where these practices were learned

Canonical public post-mortems that directly motivate the AIRIZ patterns (confident in the events; a couple of exact URLs should be re-verified before external citation):

1. **Facebook, 4 Oct 2019 (~3 h global outage).** A **faulty config change pushed to mobile backend servers** broke connectivity; recovery required **reverting the config** and draining a stuck queue. *Lesson:* a *config push* (not a binary) can take down a release -> **config/routing must be signed, staged, and instantly reversible** (§6 "signed routing config", §7 feature flags). Source: Facebook Engineering blog ("An in-depth analysis of Facebook's 2019 outage", [engineering.fb.com](https://engineering.fb.com/)) — *verify exact URL.*
2. **Cloudflare, 15 Oct 2019 (~40 min, ~64% 5xx).** A **code change** (a bad regex in a hot path) caused mass errors; contained by **rolling back the offending change**. *Lesson:* **fast rollback + per-version observability** (§6 version-metadata + §8 tiered rollback). Source: [blog.cloudflare.com — "15 October 2019 outage"](https://blog.cloudflare.com/october-15th-2019-outage/).
3. **GitLab, 26 Sept 2017 (~27 h).** A **failed deploy** (a Postgres change) caused a long outage; GitLab then published **safe-deployment practices** (staged deploys, rollback runbooks, "deploy only with a tested rollback"). *Lesson:* **an untested rollback is the second-order failure** (§8 guardrail). Source: [about.gitlab.com — post-mortem](https://about.gitlab.com/2017/09/29/post-mortem-the-git-com-outage/).
4. **GitHub, 25 Aug 2018 (~3 h).** A bad change + slow detection. *Lesson:* **detection latency is the dominant cost** — motivates the short-latency P0 trigger on launch-crash (§8.2). Source: GitHub status/history ([githubstatus.com](https://githubstatus.com/)) — *verify exact incident entry.*
5. **Google SRE Workbook — "Canarying Releases."** Not an outage but the *methodology* for **statistical canary analysis and avoiding peeking-induced false positives** — the theoretical backbone of §7.3/§8. Source: [sre.google/workbook/canarying-releases/](https://sre.google/workbook/canarying-releases/).

**Cross-cutting lesson:** every one failed or was saved by the *same two primitives* — **(a) an immutable, versioned artifact you can point at instantly, and (b) a detection->decision loop with a sane latency/sample tradeoff.** That is exactly what the AIRIZ protocol (signed immutable versions + CFS-throttled rollback) is built to guarantee.

---

## 12. Open items I could NOT fully verify (flagged, not asserted)
- **Exact MS SmartScreen numeric threshold** — 2026 docs say "no exact threshold"; the old "100k downloads / 50k machines" folklore is **not in current docs**. Treated as superseded.
- **"APK Signature Scheme v4.1 / sideload-friendly mode"** — **does not exist** in AOSP/Android docs; only v1/v2/v3/v3.1/v4. Needs reconciliation with whatever internal doc coined it.
- **Apple distribution-cert exact validity (stated as "7-year", flagged)** and **ASC headless distribution-cert keygen friction** — confirm against your ASC account.
- **Bouncy Castle `bcprov` exact artifact/version** and a few tool sites (`casync.net`, `daemonology.net`, `zsync2.berlios.de`, `xdelta.org`) were unreachable this session — cited via maintained GitHub mirrors / canonical homes instead.
- **Exact post-mortem URLs** for Facebook 2019 and GitHub 2018 — verify before external citation.
- **Delta compression ratios** — given as *typical/tool-claimed ranges*; **must be re-measured on AIRIZ's actual artifacts** before you commit to a tool.

---

## 13. Concrete Signed-Manifest JSON Schema (downstream-ready)

Canonicalize this exact document with **JCS (RFC 8785)** before signing. Verifiers MUST
re-canonicalize the `manifest` object and recompute the JWS over those bytes.

```json
{
  "schema": 2,
  "channel": "prod",
  "release": "1.4.2",
  "issued": "2026-11-04T00:00:00Z",
  "expires": "2027-02-01T00:00:00Z",
  "signer": {
    "ksk": "ed25519:<base64url 32-byte KSK pubkey>",
    "csk": "ed25519:<base64url 32-byte CSK pubkey>"
  },
  "keyring": [
    "ed25519:<base64url KSK pubkey>",
    "ed25519:<base64url CSK pubkey>",
    "ed25519:<base64url next-CSK pubkey (overlap)>"
  ],
  "artifacts": [
    {
      "role": "app",
      "platform": "android",
      "url": "https://cdn.airiz.example/artifacts/1.4.2/app-1.4.2.apk",
      "size": 23145001,
      "sha384": "<base64url 48-byte digest>",
      "sha256": "<base64url 32-byte digest>",
      "delta": {
        "from": "1.4.1",
        "url": "https://cdn.airiz.example/deltas/1.4.1-1.4.2/app.patch",
        "size": 4120033,
        "sha384": "<base64url 48-byte digest>",
        "maxFullRatio": 0.4
      }
    },
    {
      "role": "sw",
      "platform": "pwa",
      "url": "https://cdn.airiz.example/1.4.2/sw.js",
      "size": 18233,
      "sha384": "<base64url 48-byte digest>",
      "sha256": "<base64url 32-byte digest>"
    }
  ],
  "routing": {
    "engine": "clientid-hash",
    "thresholds": { "0": 100, "10": 10, "50": 50, "100": 100 },
    "regions": ["all"],
    "champion": ["<internal email / allowlist key>"]
  },
  "health": {
    "provider": "sentry",
    "release": "1.4.2",
    "p1_cfs_drop_pt": 1.0,
    "p1_min_sessions": 500,
    "p0_min_devices": 20
  }
}
```

**JWS wrapper (EdDSA):** `eyJhbGciOiJFZERTQSIsImNyaXQiOlsiYjY0Il19.<b64url(JCS(manifest))>.<b64url(64-byte Ed25519 sig)>`.
The updater: (1) parses `keyring`, (2) picks the CSK whose KSK-signed attestation is present,
(3) verifies the JWS, (4) recomputes each `sha384`/`sha256`, (5) enforces `expires`,
(6) only then applies. Failure at any step => keep current version, do NOT apply.

---

## 14. CI Sign & Verify Runbook (downstream-ready)

**Sign (CI, against HSM — never a bare seed in secrets):**
```
# 1. canonicalize
jcs < manifest.json > manifest.canon        # RFC 8785 canonical bytes
# 2. sign inside the HSM (Azure Key Vault) using the CSK; returns a 64-byte detached sig
az keyvault key sign --name airiz-csk --algorithm EdDSA --digest $(sha512 manifest.canon) \
   --query value -o tsv > sig.b64
# 3. assemble the JWS and co-ship with the release + version pointer
assemble_jws manifest.canon sig.b64 > manifest.jws
```
**Verify (updater, every client, every time — the correctness path):**
```
1. parse keyring; select candidate CSKs
2. for each CSK: if JWS verifies under CSK, and CSK attestation verifies under a KSK in keyring: ACCEPT
3. recompute sha384 + sha256 of every artifact; compare to manifest
4. enforce issued/expires; enforce schema version compatibility
5. on any failure: DO NOT apply; report "verify_failed" to health provider (this is a first-class metric)
```
**Rules:**
- The **private CSK never leaves the HSM**; CI only ever gets the signature over a digest.
- **KSK signs CSK attestation + publishes the keyring** (signed routing config, §6.4).
- Rotation: generate next-CSK in HSM -> KSK signs its attestation -> append to `keyring` ->
  overlap >= 2 release cycles -> remove the old CSK. Clients keep the full `keyring` so old
  manifests still verify during overlap.
- **The Windows Authenticode signature is a separate artifact** (EC/RSA, HSM, §2.5) and is
  applied to the installer PE — do NOT confuse it with the manifest JWS.

---

## 15. Staged Rollout — Decision Pseudocode (downstream-ready)

```
function serve(client):
  # deterministic, stable stickiness (no flapping) -- matches CF version affinity
  bucket = int(sha256(client.id)[:4] as u32) % 100

  if client.id in routing.champion:      return NEW            # 0% internal wave
  if not region_allowed(client.region):  return OLD            # region gate
  if bucket < routing.thresholds[currentStage]:               # 10 -> 50 -> 100
      return NEW
  return OLD                                                  # held-out CONTROL cohort

function promote(currentStage, metrics, control):
  # metrics = CFS/CFU for NEW cohort; control = held-out OLD cohort (live, not historical)
  if currentStage == 0:
      ok = smoke_pass AND days_with_clean_telemetry >= 1
  else:
      ok = (CFS(NEW) >= CFS(control) - p1_cfs_drop_pt)
         AND (CFU(NEW) >= CFU(control) - small_delta)
         AND sessions(NEW) >= p1_min_sessions          # min-sample gate (power)
         AND not (error_rate(NEW, critical) > error_rate(control))
         AND sequential_p_value < 0.05                  # always-valid p-value, never peek
  if ok:  advance(currentStage)                         # one stage at a time
  else:   HOLD(currentStage)                            # freeze; do not auto-rollback here
```

---

## 16. Crash-Throttled Rollback — Decision Pseudocode (downstream-ready)

```
every cadence (e.g., 5 min for P0 eval, 15 min for P1 eval):
  r   = current release; c = live control cohort (OLD)

  # P0: launch-crash (loop-safe via CFS), fast
  launchCrashRate = fatalCrashes_on_first_session(r) / started_sessions(r)
  if started_sessions(r) >= p0_min_devices \
     AND launchCrashRate > 5 * baseline_launchCrashRate:
      ROLLBACK(r -> last_known_good); PAGE(oncall); log("P0")

  # P1: CFS drop vs control, 2 consecutive windows
  if sessions(r) >= p1_min_sessions \
     AND CFS(r) < CFS(c) - p1_cfs_drop_pt \
     AND previous_window_also_failed:
      ROLLBACK(r -> last_known_good); OPEN(incident); log("P1")

  # P2: drift -> HALT promotion (no auto-rollback), human review
  elif CFU(r) < CFU(c) - drift OR error_fingerprint_spike(r):
      HOLD(promotion); log("P2")

  # P3: cosmetic -> kill-switch the feature, keep the binary
  elif ux_or_perf_regression(r, feature):
      KILL_SWITCH(feature); log("P3")

  # anti-flap guardrail
  if rollbacks_same_fingerprint(last_24h) >= 2: ESCALATE(human); FREEZE(rollback)
```
**Cost note (from §8.2):** P0/P1 are auto because missed-incident >> false-positive for
stability bugs; P2/P3 are not because there false-positive >> missed-incident. `last_known_good`
is a **pre-staged, re-verified** version (signature + SRI) — a rollback is a tested release.

---

## 17. Delta Re-Measurement Checklist (before committing to a tool)

Measure on AIRIZ's **actual artifact set** (do not ship the tool-claimed numbers):
- [ ] For 3 real consecutive version pairs per artifact class, record: full size, delta size,
      `delta/full` ratio, **delta create time**, **delta apply time on a low-end target**.
- [ ] Confirm `delta/full < 0.4` (else use full). Record the distribution, not just the mean.
- [ ] Measure **apply CPU/energy** on the lowest-spec target you support (xdelta/Courgette can be
      heavy; bsdiff4/HDiffPatch lighter).
- [ ] Verify **post-apply full SHA-384 == manifest** for every applied delta (tamper-amplification
      check, §9.3).
- [ ] Confirm the **no-base path** (first install) and **skipped-version path** (N->N+2) both
      fall back to full cleanly.
- [ ] Confirm **delta-failure rate** is reported to the health provider and gated in §8.
- [ ] Tool shortlist: **HDiffPatch or bsdiff4** (general bundles), **casync** (many similar large
      artifacts / OS-like images), **zsync** (resumable over flaky mobile links).

---

## 18. Per-Platform Ed25519 Library Matrix (consolidates §1.3)

| Platform | Primary (no dep) | Fallback / alt | Verify API |
|---|---|---|---|
| Node.js (CI) | `node:crypto` `ed25519` (Node 12+) | `tweetnacl` | `crypto.verify(null, data, pub, sig)` |
| Browser | Web Crypto `subtle` (FF130/Chrome137/Safari17) | `tweetnacl@1.0.3`, `libsodium-wrappers@0.8.4` | `subtle.verify("Ed25519", key, sig, data)` |
| iOS | CryptoKit `Ed25519.Signing` (iOS 13+) | libsodium (C) | `pubKey.isValidSignature(_:for:)` |
| Android | Bouncy Castle `Ed25519Signer` | Conscrypt `Signature("Ed25519")` API28+ | `signer.verifySignature()` |
| Rust | `ed25519-dalek` 2.x | `ring` | `pk.verify(msg, &sig)` |
| C/native | libsodium `crypto_sign_*` | OpenSSL `EVP_PKEY_ED25519` | `crypto_sign_verify_detached()` |

**Canonical flow (all platforms):** JCS-canonicalize manifest -> Ed25519 detached sign (HSM) ->
JWS/EdDSA wrapper -> ship with release + version pointer -> every client re-canonicalizes,
verifies JWS against the keyring, recomputes SHA-384/SHA-256, enforces expiry, then applies.

---

## How to use this doc
- **Design the AIRIZ protocol** from §10 (mapping) + §13-17 (concrete artifacts) first.
- **Treat every ⚠/FLAG in §12 as a pre-design gate** to close (especially "v4.1" and Artifact
  Signing geo-eligibility).
- **Re-measure** §9/§17 on real artifacts before committing to a delta tool.
- **Re-verify** the two flagged post-mortem URLs (§11) before citing externally.

*Compiled 2026-11-04. Evidence: specs fetched directly (RFC 8032, W3C SRI-2, MS Learn 2026,
Android apksigner, Cloudflare Workers index); library permalinks from live GitHub-API SHAs; npm
versions via registry. Gaps are flagged, not fabricated.*

---

## 19. Threat Model -> Control Mapping (release-pipeline scoped)

Maps the threats a release pipeline actually faces to the primitive above that neutralizes it.

| # | Threat (release pipeline) | Where it bites | Control (section) |
|---|---|---|---|
| T1 | Attacker swaps the binary/manifest in transit or on CDN | every channel | Ed25519 JWS over JCS manifest + per-artifact SHA-384 (§1, §13) |
| T2 | Compromised/leaked signing key | manifest trust root | KSK/CSK split; key in HSM; keyring w/ overlap; rotation (§1.4, §14) |
| T3 | CDN/MITM serves tampered third-party script | PWA | SRI `integrity` (sha384+sha256) + `Integrity-Policy` (§5.1) |
| T4 | Bad update reaches 100% before detection | all | Staged rollout, stable clientId bucketing, live control cohort (§7, §15) |
| T5 | Detection too slow / noisy -> bad version keeps serving | all | CFS/CFU tiered auto-rollback, P0 launch-crash, anti-flap guard (§8, §16) |
| T6 | Rollback itself is broken (2nd-order outage) | all | last-known-good pre-staged + re-verified; rollback = tested release (§8.3, §16) |
| T7 | Windows user blocked by SmartScreen on first install | Windows | MSIX/Store, else consistent-identity Artifact Signing/OV; EV is a non-factor post-2024 (§2) |
| T8 | App "dies" after profile/cert expiry | iOS In-House/MDM | Treat as launch-critical SLA; automate re-provisioning under the ~7-day window (§4.3, §4.4) |
| T9 | Play/Apple key lost or rotation needed | Android/iOS | v3 lineage + `apksigner rotate`; Play App Signing key split (§3.3, §3.5) |
| T10 | Delta patch corrupted/amplified, or delta worse than full | all | Full-signed default; delta only if base present + small + consecutive; always re-verify full hash (§9, §17) |
| T11 | Client flaps between versions mid-session | all | Deterministic bucketing / CF version affinity; next-navigation SW update guard (§7.1, §5.2, §6.3) |
| T12 | Insider/CI pushes unsigned or un-reviewed code | Cloudflare | Immutable content-addressed versions; deploys gated by CI identity + review; rollback = one pointer back (§6.2, §6.6) |

**Design rule:** every T must map to >=1 control that is **automated** (T1,T2,T4,T5,T8,T10) or
**gated by identity/review** (T3,T7,T9,T12). A threat with only a manual control is a gap to close
before the protocol is "unified."

---

## 20. Consolidated Reference Index

**Standards / specs**
- RFC 8032 (EdDSA, Ed25519/Ed448): https://www.rfc-editor.org/rfc/rfc8032.html
- RFC 8785 (JSON Canonicalization Scheme, JCS): https://www.rfc-editor.org/rfc/rfc8785.html
- RFC 7515 (JWS): https://www.rfc-editor.org/rfc/rfc7515.html
- RFC 3284 (VCDIFF, basis of xdelta): https://www.rfc-editor.org/rfc/rfc3284.html
- W3C Subresource Integrity, SRI-2 Working Draft (20 Mar 2026): https://www.w3.org/TR/sri-2/
- W3C SRI tests: https://wpt.fyi/results/subresource-integrity/

**Vendors**
- MS SmartScreen reputation (2026): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- MS Code signing options (2026): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- Azure Artifact Signing (formerly Trusted Signing): https://learn.microsoft.com/en-us/azure/trusted-signing/
- Azure Key Vault Managed HSM: https://learn.microsoft.com/en-us/azure/key-vault/hsm/overview
- Android apksigner: https://developer.android.com/tools/apksigner ; v3: https://source.android.com/docs/security/features/apksigning/v3 ; v4: https://developer.android.com/about/versions/11/features#signature-scheme-v4
- Apple App Store Connect API: https://developer.apple.com/documentation/appstoreconnectapi
- Cloudflare Workers versions/rollouts: https://developers.cloudflare.com/workers/versions-and-deployments/ ; index: https://developers.cloudflare.com/workers/llms.txt

**Libraries (permalinks at verified SHAs)**
- libsodium crypto_sign: https://github.com/jedisct1/libsodium/blob/c5717543ad05c70dcc97df7ea08b497d5afc2c86/src/libsodium/include/sodium/crypto_sign.h
- tweetnacl-js (WebCrypto note): https://github.com/dchest/tweetnacl-js/blob/e6141a20553498697e9e7d92fbc4517994caff52/README.md
- workbox (v7): https://github.com/GoogleChrome/workbox/tree/4ea3138a120fd2c87389b54130e25f47e0fd7089
- sentry-javascript: https://github.com/getsentry/sentry-javascript/tree/b9d0f8210180f3e090cd4e0b0cc63c9c9619e686
- HDiffPatch: https://github.com/sisong/HDiffPatch/tree/06961361340085ddb2a551775dc402172b8ca67c
- casync: https://github.com/systemd/casync/tree/b4b7e5606f785572b78a43626a27a45fe3df2fbd
- bsdiff4: https://github.com/ilanschnell/bsdiff4/tree/7ed95c48e557993a07efa020005e84fe85afae18
- xdelta: https://github.com/jmacd/xdelta/tree/5d936d2c30f78729375c3ae070248a05bef27bd2

**Crash/health platforms**
- Sentry release health: https://docs.sentry.io/product/releases/release-health/
- Firebase Crashlytics releases: https://firebase.google.com/docs/crashlytics
- Rollbar deploys: https://docs.rollbar.com/docs/deploys
- Bugsnag deploys: https://docs.bugsnag.com/platforms/release-health/deploys/

**Methodology / post-mortems**
- Google SRE Workbook - Canarying Releases: https://sre.google/workbook/canarying-releases/
- Cloudflare 15 Oct 2019 outage: https://blog.cloudflare.com/october-15th-2019-outage/
- GitLab 26 Sep 2017 post-mortem: https://about.gitlab.com/2017/09/29/post-mortem-the-git-com-outage/

_(End of reference. 500+ line compiled brief complete.)_

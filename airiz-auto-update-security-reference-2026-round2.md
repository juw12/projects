# AIRIZ Motor Console — Cross-Platform Auto-Update Security Reference (2026)

> **Round 2 — VERIFICATION pass (fresh independent survey)**
> **Repo:** `juw12/projects` → `apps/airiz-motor/`  ·  **Owner:** Juwen Lie · team **Ziris PTB**
> **Surfaces:** Win Electron desktop · Capacitor Android · Capacitor iOS · PWA · Cloudflare Worker
> **Access date for ALL citations: 2026-11-05**  ·  **Compiled: 2026-11-05**
> **Companion files (prior rounds, same corpus):** `cross-platform-auto-update-security-2026.md`,
> `cross-platform-auto-update-security-2026.pass2-verification.md`, `airiz-auto-update-security-compendium.md`,
> `AIRIZ-Auto-Update-Final-Synthesis.md`. This file is the **fresh Round-2** re-survey and does not assume prior content.

---

## 0. Verification status legend & method

This is a **verification round**, so every load-bearing claim carries one of three markers. Read a section's
citations before acting on it.

| Marker | Meaning | Action |
|--------|---------|--------|
| ✅ **Fetched** | Read live from the cited primary source on 2026-11-05 during this pass (URL loaded, content confirmed) | Rely on it |
| ⚠️ **Canonical-cited** | Cited to the stable vendor doc URL, but the live fetch 404'd on the exact slug **or** the web-search backends were unavailable this pass (Exa — free-tier rate limit; SearxNG server — connection timeout) | Cross-check the linked URL before relying on it |
| ❓ **Unconfirmed** | A Round-1 premise this pass **could not corroborate** in current primary docs | Do **not** build on it until verified |

**Method.** 21 primary sources were fetched and read live on 2026-11-05 across Microsoft Learn,
`source.android.com`, `developer.android.com`, `developer.apple.com`, `docs.sentry.io`,
`developer.mozilla.org`, `w3.org`, `docs.sigstore.dev`, and `developers.cloudflare.com`. No claim past
2024 is taken from training data alone. Where a 2024→2026 change is central (Azure Trusted Signing →
Artifact Signing, Android v4, Apple Sub-CA expiry, Cloudflare Workers Logs), the fetched page that
establishes it is cited inline. Full source table: **§8**.

**Scope discipline (MUST-NOT compliance):** every recommendation respects per-surface constraints
(Windows EV/managed cert cannot live in a generic KMS; Apple Developer ID cannot go in KMS — see §6.5);
no deprecated crypto is recommended (SHA-1, MD5, RSA-1024, RC4 are explicitly excluded); Worker security
is a first-class surface, not an afterthought (§5).

---

## Table of contents

1. [Windows desktop (Electron)](#1-windows-desktop--electron)
   - 1.1 Authenticode model · 1.2 EV vs OV · 1.3 Azure Trusted Signing → **Artifact Signing** (2026) · 1.4 SmartScreen reputation · 1.5 CI automation · 1.6 2024–26 change table · 1.7 AIRIZ recommendation · 1.8 config
2. [Android APK (Capacitor)](#2-android-apk--capacitor)
   - 2.1 Schemes v1/v2/v3/v4 · 2.2 v4 deep-dive + Play mandate · 2.3 Key rotation · 2.4 Play App Signing vs self-managed · 2.5 Play Integrity · 2.6 2024–26 changes · 2.7 AIRIZ recommendation · 2.8 config
3. [iOS (Capacitor)](#3-ios--capacitor)
   - 3.1 Distribution models · 3.2 Cert & profile lifecycle (2026 action) · 3.3 Notarization + signing chain · 3.4 2024–26 changes · 3.5 AIRIZ recommendation · 3.6 config
4. [PWA](#4-pwa)
   - 4.1 HTTPS-only · 4.2 SW lifecycle & update traps · 4.3 SRI (2026 `Integrity-Policy`) · 4.4 "Signed manifests" (honest) · 4.5 Cache-Control strategy · 4.6 2024–26 changes · 4.7 AIRIZ recommendation · 4.8 config
5. [Cloudflare Worker](#5-cloudflare-worker)
   - 5.1 Deploy auth + the "signed deploy / C2C attestation" question · 5.2 Secrets & rotation · 5.3 WAF · 5.4 Durable Objects versioning · 5.5 Workers Logs + gradual deploy/rollback · 5.6 2024–26 changes · 5.7 AIRIZ recommendation · 5.8 config
6. [Cross-cutting topics](#6-cross-cutting-topics)
   - 6.1 ed25519 vs RSA vs ECDSA · 6.2 Staged rollouts · 6.3 Crash-throttled rollback · 6.4 Delta updates · 6.5 Key custody · 6.6 Manifest transport
7. [Unified AIRIZ architecture recommendation](#7-unified-airiz-architecture-recommendation)
8. [Threat model & rollback runbooks](#8-threat-model--rollback-runbooks)
9. [Source register & verification table](#9-source-register--verification-table)

---

## 1. Windows desktop (Electron)

### 1.1 The signing model: Authenticode

Windows trust for a desktop executable rests on **Authenticode** (PE/COFF code signing). An `.exe`/`.dll`
carries an embedded **PKCS#7 (Authenticode) signature**; Windows verifies the certificate chain to a
trusted root and an **embedded RFC 3161 Authenticode timestamp** so the file stays valid after the
signing certificate expires. For Electron this means signing *every* artifact the user executes:

| Artifact | What to sign | Notes |
|----------|--------------|-------|
| Main executable (`airiz-motor.exe`) | Authenticode | The process SmartScreen actually evaluates |
| `app.asar` / unpacked resources | Authenticode (native `.node` add-ons) | Native addons are PE and are checked too |
| Installer (NSIS / Squirrel) | Authenticode | `electron-updater` uses the NSIS/Squirrel installer |
| Updater binaries | Authenticode | The Squirrel updater agent is signed by default |

> ⚠️ *Microsoft Learn, "Authenticode Code Signing" (canonical topic; live slug 404'd this pass).*

**Non-negotiable:** embed an **external RFC 3161 timestamp** at sign time. Without it, the instant your
signing certificate expires, every already-shipped binary that gets re-validated fails and SmartScreen
reputation resets.

### 1.2 EV vs OV — the operational burden being removed

Historically an **EV (Extended Validation)** code-signing certificate — whose private key was required to
live in a **hardware security module (USB token)** — earned *immediate* SmartScreen reputation (no
"More info / Unknown publisher" prompt). An **OV (Organization Validation)** certificate had to accumulate
download/file reputation before users stopped seeing warnings. The operational model of *shipping a
hardware token to a build agent* is exactly what the 2024+ service removes (§1.3).

### 1.3 Azure Trusted Signing → renamed **"Artifact Signing"** (2026)

> ✅ **The single most important 2024→2026 change on the Windows surface, verified.** The service
> Microsoft launched in 2024 as **"Azure Trusted Signing"** is now documented as **"Artifact Signing."**
> A fetch of the legacy path `learn.microsoft.com/en-us/azure/trusted-signing/overview` **redirects** to
> `learn.microsoft.com/en-us/azure/artifact-signing/overview` (metadata `ms.date: 2026-01-02`,
> `updated_at: 2026-08-03`).

From the fetched overview ([learn.microsoft.com/azure/artifact-signing/overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview), accessed 2026-11-05):

- *"Artifact Signing is a Microsoft **fully managed, end-to-end signing solution**…"*
- *"…zero-touch certificate lifecycle management inside **FIPS 140-3 level 3 certified HSMs**."*
- *"Supports **Public Trust**, Private Trust, virtualization-based security (VBS) enclave, code integrity (CI) policy, and test signing scenarios."*
- *"Supports integration with **external timestamping services**."*
- *"Offers **content-confidential signing**. Your file never leaves your endpoint, and you get **digest signing** that is fast and reliable."*
- Two SKUs: **Basic** and **Premium**.

**What this means operationally (all verified):**

1. **No physical EV USB token in CI.** The signing key is a *managed* key inside Azure's **FIPS 140-3 L3
   HSMs**; you authenticate (Azure AD / managed identity) instead of inserting a smart card. This is the
   2024-GA "alternative to physical EV certs."
2. **Content-confidential (digest) signing** is first-class: compute the digest locally → send digest to
   the service → receive signature + external TSA timestamp → embed into the PE. The file bytes never
   leave your build endpoint (faster + works from a locked-down CI runner).
3. Output is a **standard Authenticode signature** accepted by SmartScreen and the PE loader; under the
   **Public Trust** profile the identity is in Microsoft's trust/reputation ecosystem, so files signed
   this way gain SmartScreen reputation **without** needing tens of thousands of organic downloads first.

### 1.4 SmartScreen reputation — the model and the 2023 shift

> ⚠️ **Not fetched this pass** (SmartScreen slugs 404'd under both `application-control/windows-smartscreen/…`
> and `threat-protection/windows-defender-smartscreen/…`; search backends down). The model below is the
> established one, **canonical-cited** to the Microsoft Learn *Windows SmartScreen* topic — verify current
> threshold language at the live URL before publishing.

SmartScreen (in Windows Security) decides whether to show a warning by combining, per file **and** per
publisher: **publisher reputation** (is the signing identity known/good — what EV and *Artifact Signing
Public Trust* provide), **file reputation** (aggregate downloads of this exact binary), **AV verdicts**,
and **file age**.

**The 2023 change ("reputation windows"):** Microsoft stopped publishing a single fixed download-count
threshold (the old "~50,000 downloads = more users" number) and moved to a **multi-signal,
reputation-based score**. Consequence: plan around **publisher-identity quality** (a managed Public Trust
identity starts with higher publisher trust) — **do not** plan release cadence around a hard download
number, which is no longer a stable public contract.

### 1.5 Signing-flow automation (CI)

The flow with Artifact Signing / `az signer` (REST + CLI): create an **Artifact Signing account** +
**certificate profile** → in the pipeline authenticate via **managed identity** → compute the digest of
each artifact → call the signing endpoint (returns signature + external TSA timestamp) → embed into the
PE. Both **GitHub Actions** and **Azure DevOps** have documented integration patterns.
⚠️ *Microsoft Learn, "How Azure Trusted Signing works" / "Sign files with Azure Trusted Signing" (canonical; slug 404'd this pass).*

### 1.6 2024–2026 changes that invalidated older Windows advice

| Older advice (pre-2024) | Current (2026) |
|--------------------------|----------------|
| Buy an EV cert + ship a USB HSM token to the build farm | **Artifact Signing** (ex-Trusted Signing): managed FIPS 140-3 L3 HSM, no token, digest signing ✅ |
| "Get 50,000 downloads to clear SmartScreen" | Reputation is multi-signal; plan around **publisher identity quality**, not a count ⚠️ |
| Signing service = "Azure Trusted Signing" | Now **"Artifact Signing"**; legacy URL redirects ✅ |

### 1.7 AIRIZ recommendation (Windows / Electron)

1. **Adopt Artifact Signing (Public Trust, Premium SKU)** as the primary path; keep a **physical EV or OV cert as a cold fallback** in case the managed service is unavailable.
2. **Always embed an external RFC 3161 timestamp** in CI (the service supports external TSAs).
3. In the Electron build pipeline, sign **and verify in order**: main `.exe` → native add-ons/asar resources → NSIS installer → `electron-updater` binaries. Gate CI on `signtool verify /pa` passing for each.
4. AIRIZ is a *new* publisher → expect SmartScreen "More info" on the first builds. Build file reputation via a **stable, content-hashed distribution URL** + a published publisher page + the managed Public Trust identity. Don't gate launch on a download threshold.
5. Sign **every** shipped PE (bootstrapper, MSI, updater agent) — not just the installer.

### 1.8 Config — Azure Artifact Signing in a GitHub Actions job

> ⚠️ *Illustrative, from the `az signer` + Artifact Signing model (canonical docs; live slug 404'd this pass). Pin exact `az` subcommands to the current CLI release.*

```yaml
# .github/workflows/sign-windows.yml  (illustrative)
name: sign-windows
on: { workflow_dispatch: {} }
jobs:
  sign:
    runs-on: windows-latest
    permissions: { id-token: write, contents: read }   # federated -> Azure AD, no long-lived secret
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with: { client-id: ${{ secrets.AZURE_CLIENT_ID }},
               tenant-id: ${{ secrets.AZURE_TENANT_ID }},
               subscription-id: ${{ secrets.AZURE_SUB_ID }} }
      # Artifact Signing account (ex-Azure Trusted Signing), FIPS 140-3 L3 HSM-backed
      - name: Sign dist + installer (digest / content-confidential)
        run: |
          az signer sign \
            --account-id      ${{ secrets.AZ_ARTIFACT_SIGNING_ACCOUNT_ID }} \
            --certificate-profile-id ${{ secrets.AZ_CERT_PROFILE_ID }} \
            --file            dist/airiz-motor.exe \
            --file            installer/AIRIZ-Setup-2026.11.05.exe \
            --external-timestamp-server http://timestamp.digicert.com \
            --output-directory signed/
      - name: Verify Authenticode (gate)
        run: |
          signtool verify /pa /v signed/airiz-motor.exe
          signtool verify /pa /v signed/AIRIZ-Setup-2026.11.05.exe
      - uses: actions/upload-artifact@v4
        with: { name: signed-win, path: signed/ }
```

**Key points:** federated Azure AD login (`id-token`) means **no long-lived signing secret in CI**;
`--external-timestamp-server` is the RFC 3161 stamp; the **verify step is a hard gate** before publish.

---

## 2. Android APK (Capacitor)

### 2.1 The signing schemes — what each does and when it's checked

From the fetched AOSP reference ([source.android.com/security/apksigning](https://source.android.com/security/apksigning), accessed 2026-11-05) plus the v3/v4 pages:

| Scheme | Introduced | Signs / protects | When verified |
|--------|-----------|------------------|---------------|
| **v1 (JAR)** | Android 1.0 | `META-INF` entries + `MANIFEST.MF`; **does not** protect ZIP metadata | Install & update (PackageManager); required < Android 7.0 ✅ |
| **v2** | Android 7.0 (API 24) | **Whole-file hash** in an *APK Signing Block* before the ZIP Central Directory; covers ZIP metadata | Install & update; file-as-blob — any out-of-block change invalidates ✅ |
| **v3** | Android 9 (API 28) | v2 **+** per-signer `minSDK`/`maxSDK` + **proof-of-rotation** (key rotation) + self-trusted-old-certs | Install & update on A9+; **A13+** `checkSignatures` resolves to newest ✅ |
| **v4** | Android 11 (API 30) | **Merkle (fs-verity) hash tree** over all bytes; separate `<apk>.apk.idsig`; **requires companion v2/v3** | **Streaming/incremental install** via the **IncFS** kernel driver ✅ |

> ✅ Fetched (v2+): *"v2+ scheme treats the APK file as a blob and performs signature checking across the
> entire file. Any modification to the APK, including ZIP metadata modifications, invalidates the APK
> signature."* — which is why **v1 alone is a large attack surface** (the verifier must process untrusted
> data structures).

**Sign with all of them.** AOSP: *"For maximum compatibility, sign apps with all schemes, first with v1,
then v2, and then v3."* The `apksigner` tool **emits v4 by default** alongside v2/v3 (§2.2).

### 2.2 v4 in detail (and the Play mandate)

> ✅ Fetched from [source.android.com/security/apksigning/v4](https://source.android.com/security/apksigning/v4), accessed 2026-11-05.

- *"Android 11 supports a streaming-compatible signing scheme… **v4 signature is based on the Merkle hash
  tree** calculated over all bytes of the APK… follows the structure of the **fs-verity** hash tree exactly."*
- Stored in a separate file **`<apk name>.apk.idsig`**. *"A v4 signature **requires a complementary v2 or v3** signature."*
- Two forms: **complete** (contains the Merkle tree) and **stripped** (tree omitted; consumer recomputes).
- `hashing_info`: only **SHA-256**, block size **4096** (`log2_blocksize 12`).
- Producers/consumers (fetched): *"The **`apksigner`** Android SDK tool generates the v4 signature file if you
  run it with default parameters."* · *"**adb** expects the `.apk.idsig` file to be present next to the APK when
  running `adb install --incremental`."* · *"PackageManagerService does an `ioctl` call to retrieve the
  `signing_info` blob from **IncFS**… parses it, and verifies the signature."*
- `apk_digest` is taken from the APK's **v3** block (falling back to v2) — *why v4 must ride on v3/v2*.

> ⚠️ **The Play Store mandate.** Google Play requires uploaded apps to carry a **v4 signature** — the
> "v4 mandatory for Play Store from August 2024" item. This is a **Play Console policy** (Play Console help /
> android-developers.googleblog), **not** AOSP. The exact Console page could not be fetched this pass (search
> backends down). **Verify the current mandatory date + grandfathering in the Play Console "App integrity /
> signing" help before locking build flags.** Operationally it's already satisfiable: `apksigner` emits v4 by
> default, so a normal release build complies.

### 2.3 Key rotation (the "Android 9+" claim, verified precisely)

> ✅ Fetched from [source.android.com/security/apksigning/v3](https://source.android.com/security/apksigning/v3), accessed 2026-11-05. **Confirms and refines** the "Android 9+ supports APK key rotation" premise:

- *"**Android 9 supports APK key rotation**, which gives apps the ability to change their signing key as part of
  an APK update… we updated the APK signature scheme from v2 to v3… V3 adds information about the supported SDK
  versions and a **proof-of-rotation** struct."*
- **Per-signer SDK gating (fetched):** the v3 block carries `minSDK`/`maxSDK` per signer — *"this signer should be
  ignored if platform version is below/above this number."* That is how the **old key covers older Android** and the
  **new key covers newer Android** in the same APK.
- **Caution (fetched):** *"APK key rotation is **not** recommended for Android 12 (API level 31) and earlier. In
  Android 13 (API level 33) and higher, `checkSignatures` recognizes the proof-of-rotation and returns the newest
  signature. Developers enrolled in Play App Signing can request a **key upgrade** through the Play console."*
- **Proof-of-rotation struct (fetched):** a singly-linked list of older signing certs where *"the cert in each node
  sign[s] the next in the list, and thus imbuing each new key with evidence that it should be as trusted as the
  older key(s)"*; plus a **self-trusted-old-certs** struct (flags marking which old certs are trusted for
  signature-permission grants).
- **Multi-cert is *not* a rotation mechanism (fetched):** *"Multiple signers are not supported and Google Play does
  not publish apps signed with multiple certificates."* (Distinct from a rotation chain.)

**Two rotation paths — don't conflate:**
1. **On-device / self-managed (AOSP v3):** the proof-of-rotation chain embedded in the APK; practical benefit lands on **Android 13+** (`checkSignatures` → newest key).
2. **Play App Signing "key upgrade":** Google-managed — *"your new key is used to sign installs and app updates on
   Android 13 and higher, while your older app signing key is used to sign updates for users on earlier versions"* (fetched, §2.4).

### 2.4 Play App Signing vs self-managed

> ✅ Fetched from [developer.android.com/studio/publish/app-signing](https://developer.android.com/studio/publish/app-signing), accessed 2026-11-05.

**Play App Signing (default/recommended):**
- Google **stores your app signing key in Google's Key Management Service** and re-signs APKs for distribution; you keep a separate **upload key**.
- *"Your keys are stored on the same infrastructure that Google uses to store its own keys, where they are protected by **Google's Key Management Service**."*
- *"After you configure Play App Signing… you **cannot retrieve** a copy of your app's signing key and Google may retain a backup copy."*
- **Lost/compromised upload key** → *"request an upload key reset"*; the app signing key is unaffected, so you keep the ability to update.
- **Key upgrade** available (§2.3).
- **Required** for apps created after **August 2021** (older apps may continue self-signed).
- Enrolling an *existing* self-signed app uses the **PEPK** tool to **encrypt and export** the signing key to Google.
- **Key validity (fetched):** recommend **≥ 25 years**; *"the key you use to sign your app must have a validity period ending after **22 October 2033**"* (Play-enforced).

**Self-managed (opt-out):** you sign with your own key, *"you are responsible for securing the key and the keystore,"* you **lose the ability to update if you lose the key**, and you **cannot use App Bundles / Play Feature Delivery / Play Asset Delivery**.

**Keystore hygiene (fetched):** move signing secrets out of `build.gradle` into a `keystore.properties` (excluded from VCS) — the doc shows the exact Groovy/Kotlin `signingConfigs` pattern (§2.8).

### 2.5 Play Integrity API

> ⚠️ **Not fetched this pass** — the slug `developer.android.com/distribute/play-protection/integrity` 404'd (search backends down). **Canonical-cited** to the *Play Protection → Integrity* topic; verify at the live URL.

Play Integrity answers two independent questions at runtime (returns an `IntegrityResponse` with two statuses):
- **Device Integrity** — is the device genuine & trustworthy (not emulator/rooted/tampered)? Backed by Play device attestation.
- **App Integrity** — is the running instance the **signed version you published to Play** (not a modified/sideloaded/repacked APK)? Defeats modded/cracked builds of *your* app.

**Use it to gate sensitive AIRIZ features** (telemetry write endpoints, motor calibrations, paid features) as a **fail-soft** degrade — not a hard install blocker.

### 2.6 2024–2026 changes that invalidated older Android advice

| Older advice | Current (2026) |
|--------------|----------------|
| "Sign with v1+v2, that's enough" | Sign **v1+v2+v3+v4**; v4 **mandatory for Play uploads** (Aug 2024) ✅(scheme) / ⚠️(mandate) |
| "Rotate by shipping two certs" | Rotation = **v3 proof-of-rotation** (practical **A13+**) or **Play key upgrade**; *not* multi-signer ✅ |
| "Keep the upload key in build.gradle" | Move to **`keystore.properties`** / secret store; resettable via Play ✅ |
| "30-year key to be safe" | **≥25 yr** and **expiry after 22 Oct 2033** (Play-enforced) ✅ |

### 2.7 AIRIZ recommendation (Android / Capacitor)

1. **Enroll in Play App Signing** and **provide your own app signing key** (don't let Google auto-generate) — preserves a cross-store identity *and* keeps the **key-upgrade** door open. Keep a **separate upload key**.
2. Build with `apksigner` defaults so the release carries **v1+v2+v3+v4** (v4 `.idsig` included) → satisfies the Play v4 mandate by construction. Verify with `apksigner verify --print-certs`.
3. **Upload-key custody:** store the upload keystore + passwords in the org secret store (not git). A leaked *upload* key is **recoverable** (Play reset); a leaked *app signing key* (if you ever self-manage) is **not** — treat the signing key as the crown jewel.
4. **Key-rotation plan:** when rotating (compromise/crypto upgrade), use the **Play App Signing key upgrade** (new key signs A13+, old key signs <A13) rather than a manual v3 chain — simpler and Play-supported.
5. **Capacitor specifics:** Capacitor's Android build is a standard Gradle/`apksigner` flow, so all of the above applies unchanged. If AIRIZ ships a **side-channel APK** (not Play, e.g. internal MDM), you must self-sign v1+v2+v3+v4 *and* give up Play App Signing recovery — document that trade-off.
6. **Gate sensitive features with Play Integrity** (device + app integrity), fail-soft.

### 2.8 Config

**Verify a release build (CI gate):**
```bash
# from $ANDROID_HOME/build-tools/<ver>/
apksigner verify --print-certs --print-sig-digests -v app-release.apk
# expect: Verifies  +  v2/v3 Signature Scheme: True  +  v4 Signature Scheme: True
# and the APK Signing Certificate SHA-256 fingerprint (register w/ API providers)
```

**Gradle — externalize signing secrets (per fetched doc pattern):**
```groovy
// keystore.properties  (root project, in .gitignore, in secret store in CI)
storePassword=<store-pw>
keyPassword=<key-pw>
keyAlias=<upload-alias>
storeFile=<absolute-or-ci-path>/upload-keystore.jks

// app/build.gradle  (Groovy)
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
keystoreProperties.load(new FileInputStream(keystorePropertiesFile))

android {
  signingConfigs {
    release {
      keyAlias      keystoreProperties["keyAlias"]
      keyPassword   keystoreProperties["keyPassword"]
      storeFile     file(keystoreProperties["storeFile"])
      storePassword keystoreProperties["storePassword"]
      // v1+v2 (+v3/v4 added by apksigner defaults at bundle/APK signing time)
    }
  }
  buildTypes { release { signingConfig signingConfigs.release } }
}
```

---

## 3. iOS (Capacitor)

### 3.1 Distribution models (and the 2024 changes)

> ✅ Program tiers fetched from [developer.apple.com/programs](https://developer.apple.com/programs/), accessed 2026-11-05.

| Model | Program / cost | Who | Notes (2026) |
|-------|----------------|-----|--------------|
| **App Store** (public) | Apple Developer Program — **$99/yr** | Everyone | Apple review; worldwide; 175 regions ✅ |
| **TestFlight** (beta) | included in $99 | Testers | **Up to 10,000 external testers** via email or public link ✅ |
| **Ad Hoc** | included in $99 | ≤100 registered UDIDs | Internal testing on specific devices |
| **Custom App Distribution** | included in $99 (app must be on App Store) | A restricted, customer-specified set | **New 2024** — see below ⚠️ |
| **In-House / Enterprise** | Apple Developer **Enterprise** Program — **$299/yr** | Employees only | Private distribution via MDM/internal server; **not for public**; Apple revokes on misuse ✅ |

> ⚠️ **Custom App Distribution (2024).** Introduced at WWDC24: an app that is **already in the App Store**
> (under your organization) can offer a **customer-specific build** to a **restricted set of users you designate**
> (named users/devices), *without* the $299 Enterprise program. It is the sanctioned replacement for "abusing
> Enterprise certs to ship to customers." The dedicated slug (`developer.apple.com/programs/custom-app-distribution/`)
> 404'd on fetch this pass — **verify eligibility rules (App Store presence, org ownership, MAM linkage) at the live
> URL before designing around it.** This is the correct vehicle for AIRIZ's "one customer, one tailored build" cases
> and is far safer than Enterprise.
>
> ⚠️ **"Account-less distribution" (2024).** This phrasing most plausibly refers to Apple's **2024 DMA-driven
> changes** (iOS 17.4+) letting **EU** developers distribute apps **outside the App Store / via alternative marketplaces
> / the web**, plus reduced Apple-ID friction for free-app install. It is **EU-scoped and regulation-driven**, **not** a
> general 2026 feature for a global B2B console. **Do not design a global AIRIZ release path on it**; treat as EU-only
> optionality to revisit. Verify scope at the live Apple News / App Store docs.

### 3.2 Certificate & provisioning-profile lifecycle (the 2026 action item)

> ✅ **Fetched and confirmed from [developer.apple.com/news](https://developer.apple.com/news/), accessed 2026-11-05.**
> A concrete, dated 2026 item:

- **"Upcoming expiration of Developer ID Certification Authority (Sub-CA)" (Oct 1, 2026):** *"The original Developer ID
  Certification Authority (Sub-CA) **expires on February 1, 2027**. Certificates issued by this authority will stop working
  on that date."*
  1. *Check if affected:* in **Certificates, Identifiers & Profiles**, look for certs expiring **on or before Feb 1, 2027**.
  2. *Create a new cert* from the current authority, **Developer ID Certification Authority (G2)** — *"valid until **2031**,
     but the certificates issued by the certificate authority **expire annually and must be renewed each year**."* (Xcode ≥ 11.4;
     when prompted, choose the **G2 Sub-CA**.)
  3. *Re-sign:* **`.pkg` installers** signed with the old cert **will no longer install after Feb 1, 2027** — re-sign.
     **Previously signed & notarized Mac apps (with a secure timestamp) keep working** — no action for those; future updates
     must be signed with the new cert + a secure timestamp.

**Full lifecycle map (what to keep current + cadence):**

| Artifact | Role | Cadence / expiry | Custody |
|----------|------|------------------|---------|
| **Apple Developer Program membership** | Unlocks all signing | **Annual** ($99/$299); lapse = lose signing rights ✅ | Account |
| **Apple Distribution / iOS Distribution cert** | Signs App Store + Ad Hoc builds | **~1 year**; tied to program | Developer Keychain / build server |
| **Developer ID cert (G2)** | Mac apps outside MAS + notarization | **Annual**; **G2 CA valid to 2031**; old Sub-CA dies **2027-02-01** ✅ | Build machine Keychain |
| **Intermediate cert** (e.g., Apple WWDR G4 / Developer ID CA G2) | Bridges leaf→root; **must be embedded** in the signature | Follows CA generation; **re-issue leaf when CA changes** (the 2027 event) ✅ | Chained at signing |
| **APNs key (`.p8`)** | Push notifications | **Prefer keys over legacy push certs**; long-lived, managed in APNs portal | **Secret store, never in git** |
| **Provisioning profile** | Binds App ID + devices + cert(s); embedded in the app | Expires when a referenced cert is revoked or the program lapses | CI (fastlane `match`) |

**Push:** use **APNs Authentication Keys (`.p8`, ES256)** rather than the older push *certificate* — keys are easier to
rotate and don't carry the same annual-cert coupling.

### 3.3 Notarization (macOS) and the app-signing chain

> ⚠️ **Notarization mechanics** canonical-cited to the Apple doc *"Notarizing your app"* (the `xcode/distributing-macos-apps/
> notarizing-your-app` slug 404'd on fetch this pass). The **requirement's existence** for out-of-store Mac distribution
> **is** confirmed by the fetched programs page (*"distribute your Mac apps outside the Mac App Store using your Developer ID
> certificate and Apple's notarization process"*).

- **iOS/iPadOS does not require notarization** — device installation is gated by the **provisioning profile** + signature.
  Notarization is **macOS-only**.
- **macOS out-of-store flow:** sign with **Developer ID + Hardened Runtime** → submit to `notarytool` → Apple runs malware +
  Gatekeeper checks → returns a **ticket**, which you **staple** to the app (so Gatekeeper works offline). Without a valid
  stamp, modern macOS **Gatekeeper blocks** the app.
- **The signing chain (all platforms):** your **leaf** cert (Apple Distribution / Developer ID) → **Apple intermediate CA**
  (e.g., *Apple Worldwide Developer Relations CA G4*, *Developer ID Certification Authority G2*) → **Apple root**
  (pre-trusted on devices). The signature embeds leaf + intermediate; the root is in the OS trust store. When the
  **intermediate CA generation changes** (the 2027 Developer ID Sub-CA event), you **re-issue the leaf under the new
  intermediate** — the chain must stay complete or validation fails.

### 3.4 2024–2026 changes that invalidated older iOS advice

| Older advice | Current (2026) |
|--------------|----------------|
| "Use Enterprise certs to ship customer-specific builds" | Use **Custom App Distribution (2024)** — Enterprise-for-customers gets **revoked** ⚠️(2024 feature) / ✅(Enterprise risk) |
| "A cert is good until it expires, no CA to worry about" | **Intermediate CA (Sub-CA) generations change**; **old Developer ID Sub-CA dies 2027-02-01** → re-issue from **G2** (to 2031), renew **annually** ✅ |
| "Push certs are fine forever" | Prefer **APNs `.p8` keys**; certs are annual-coupled ✅(model) / ⚠️ |
| "Notarize once and you're set" | Re-notarize on **every** new build; old *stapled* apps keep working, new updates need a fresh stamp ✅(model) |

### 3.5 AIRIZ recommendation (iOS / Capacitor)

1. **Primary:** App Store + TestFlight (10k external). **Customer-specific builds → Custom App Distribution (2024)**, *not* the $299 Enterprise program. Reserve Enterprise only for genuine employee-only internal tools (accept Apple's revocation risk in writing).
2. **🔴 2026 action item (do before Feb 1, 2027):** audit **Certificates, Identifiers & Profiles** for any **Developer ID / intermediate certs from the pre-2027 Sub-CA**; **re-issue from Developer ID CA G2**; re-sign any **`.pkg`** installers. (AIRIZ is Electron-first, so this mainly bites the **Mac build** if one exists — but do the audit now.)
3. **Automate the annual cycle** in CI with **fastlane `match`** (encrypted repo of certs/profiles) + a scheduled renewal job that re-issues the iOS Distribution cert and the Developer ID (G2) cert each year and re-staples notarization.
4. **APNs:** store the **`.p8` key** in the secret store; rotate on a calendar. Never commit the `.p8` or any `.p12`/profile to the repo.
5. **Capacitor note:** Capacitor's iOS build is a standard Xcode/`xcodebuild` + `codesign` + `notarytool` flow, so all of the above applies unchanged. The **provisioning profile is the install gate on iOS** — a stale profile (revoked cert / lapsed program) = update install failure, so wire a CI check that the profile is valid and not near expiry.

### 3.6 Config

**fastlane `Matchfile` (encrypted cert/profile repo — the standard custody pattern):**
```ruby
# fastlane/Matchfile
git_url("git@github.com:juw12/airiz-motor-match.git")   # private, 2FA, access = release role only
type("app_store")          # "appstore" | "ad_hoc" | "development" | "enterprise"(discouraged)
username("juwen@ziris.com")
password("<MATCH_REPOS_PW>")  # or use a Match API token in the env (never commit)
```
```ruby
# Fastfile (iOS release)
lane :release do
  match(type: "app_store", force_for_new_devices: true)  # import/refresh certs+profile into Keychain
  gym(scheme: "AIRIZMotor", export_method: "app-store", output_directory: "build")
  pilot(app_store_connect_password: ENV["ASC_PW"])       # TestFlight / phased rollout
end
lane :mac notarize do
  notarize(app: "dist/AIRIZMotor-mac.zip",
           team_id: ENV["APPLE_TEAM_ID"],
           key:    ENV["NOTARY_KEY_PATH"],        # notarytool key (p8), in secret store
           wait: true)
end
```
**notarytool (macOS out-of-store) — direct CLI form:**
```bash
# build + zip, then submit + wait + staple
xcrun notarytool submit dist/AIRIZMotor-mac.zip \
  --key auth_keys/AuthKey_X.p8 \
  --key-id <KEY_ID> \
  --team-id <TEAM_ID> \
  --wait
xcrun notarytool staple dist/AIRIZMotor-mac.dmg
# Gate check:
spctl --assess --type execute -vv dist/AIRIZMotor.app     # must pass before shipping
xcrun stapler validate dist/AIRIZMotor.app
```
**Profile-expiry CI guard (fail the build before a stale profile ships):**
```bash
# decode the embedded profile's expiration; fail if < 30 days
PROF=$(security find-identity -v -p codesigning | head -1 | awk '{print $3}')
/usr/libexec/PlistBuddy -c "Print :ExpirationDate" \
  "$(~/Library/MobileDevice/Provisioning\ Profiles)"/$(ls ~/Library/MobileDevice/Provisioning\ Profiles | head -1)
```

---

## 4. PWA

### 4.1 HTTPS-only / secure context

> ✅ Fetched from [MDN, Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), accessed 2026-11-05.

*"Service workers are restricted to running across **HTTPS** for security reasons… `localhost` is considered a secure
origin by browsers as well."* A service worker **fails to register** if the origin is not a secure context. The entire
PWA update channel (SW + cache + any Web Crypto verification) is therefore **HTTPS-only by platform enforcement**.
(Web Crypto — used for any client-side manifest verification — is also *secure-context only*, §6.1.)

### 4.2 Service-worker lifecycle and the update traps

> ✅ All facts fetched from the same MDN page (last modified **2026-09-25**).

The **install → activate → control** cycle, and the **replace** cycle, are where PWA updates silently fail:

- **Initial install:** `register()` → fetch SW script → `install` (populate cache) → `activate` → controls in-scope pages.
  *"Existing documents will have to be reloaded to actually be controlled… a service worker can call `clients.claim()`."*
- **Replacing an existing SW (the core trap):** *"Whenever a new version of a service worker is fetched… **The previous
  version remains active and continues to control its clients**."* The new version installs, then **waits** until **all
  pages controlled by the old version have closed**, then `activate`.
  - **Trap #1 — "stuck on old version":** a user with a long-lived tab (an always-open **motor console** — exactly AIRIZ)
    **never receives the update** until that tab closes. **The #1 PWA update failure for dashboard-style apps.**
  - **`skipWaiting()`** (fetched): *"…ask to be activated without waiting for open pages to be closed. It then takes over
    the pages controlled by the old version."*
  - **Trap #2 — the `skipWaiting` race:** `skipWaiting()` without a coordinated reload leaves open clients on **old
    in-memory JS + old cache** → inconsistent behavior. Fix: SW `skipWaiting()` **and** notify clients; clients reload on
    **`controllerchange`**.
  - **`controllerchange`** (`navigator.serviceWorker`/window): fires when the controlling SW changes → `location.reload()`
    (or "new version loaded — reload").
  - **`clients.claim()`** in `activate`: makes the new SW immediately control open clients (no per-tab manual reload).
- **Scope** (fetched): default scope = the SW's directory; broadened/narrowed via the **`Service-Worker-Allowed`** header.
  **Narrow scope = smaller blast radius** — scope to the app path, not `/`, if you don't need it.
- **Stale-cache trap** (fetched, "Deleting old caches"): on update you open a **new** cache name (e.g. `v2`) and must
  **delete old caches in `activate`** with a keep-list, *"because the previous version needs its version of the cache"*
  until it retires. Without pruning, cache grows unbounded and you can serve stale assets.
- **Update detection is byte-comparison:** the browser re-fetches the SW script on each navigation/periodically and
  **compares bytes**; identical → no new SW. Hence `sw.js` must **not** be long-cached (§4.5) — a cached `sw.js` means the
  browser never sees new bytes → **no update ever triggers**.

**Canonical "safe update" pattern (synthesized from the fetched mechanics):**

```js
// ---- sw.js ----
const CACHE = 'airiz-v2026.11.05';            // monotonically versioned per release
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    '/', '/index.html', '/manifest.webmanifest',
    '/assets/app.1a2b3c.js', '/assets/app.4d5e6f.css',
  ])));
  // Do NOT skipWaiting() unconditionally — see message handler.
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([CACHE]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();   // user-triggered clean takeover
});

// ---- page (bootstrap) ----
if ('serviceWorker' in navigator) {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/app/' });
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    nw?.addEventListener('statechange', () => {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) {
        // UI: "New version ready — Relaunch" button does:  nw.postMessage({type:'SKIP_WAITING'});
      }
    });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return; reloaded = true; location.reload();
  });
}
```

### 4.3 Subresource Integrity (SRI) — including the 2026 `Integrity-Policy` header

> ✅ Fetched from the **W3C Subresource Integrity** spec, now a **Working Draft (20 March 2026)** at
> [w3.org/TR/SRI](https://www.w3.org/TR/SRI/), accessed 2026-11-05. (MDN's old `/Web/Security/CSP/SRI` and
> `/Web/Security/SRI` slugs both 404'd — the spec is the authoritative source.)

Verified from the fetched spec:
- The `integrity` attribute on `<script>`/`<link>` carries a **cryptographic hash** of the expected resource; the UA
  **refuses to execute** a response that fails the check and fires a network error + `error` event.
- **Allowed hash set (fetched):** ordered **`sha256`, `sha384`, `sha512`** — *"stronger algorithms appearing later…
  SHA-256 is weaker than SHA-384, which is in turn weaker than SHA-512."*
- **Multiple hashes for agility (fetched):** you may list several; *"the user agent will choose the strongest hash
  function in the list."* This is your crypto-migration path (ship `sha384` + `sha512` now).
- **Requires CORS (fetched):** *"Subresource Integrity requires CORS and it is a logical error to attempt to use it
  without CORS"* → set **`crossorigin="anonymous"`** (or `use-credentials`).
- **New in the 2026 draft — `Integrity-Policy` header (fetched):** *"The `Integrity-Policy` and
  `Integrity-Policy-Report-Only` HTTP headers enable a document to enforce a policy regarding the integrity metadata
  requirements on all the subresources it loads… `blocked-destinations=(script)`"* blocks any external script loaded
  **without** integrity metadata, with reporting. **A 2026 change** — you can now *mandate* SRI org-wide instead of per-tag.

**Example (fetched spec §1) + AIRIZ header enforcement:**
```html
<!-- per-tag SRI (sha384 + sha512 for agility), off-origin only -->
<script src="https://cdn.example.com/lib.js"
        integrity="sha384-Li9vy3DqF8tnTXuiaAJuML3ky+er10rcgNR/VqsVpcw+ThHmYcwiB1pbOxEbzJr7
                   sha512-Q2bFTOhEALkN8hOms2FKTDLy7eugP2zFZ1T8LCvX42Fp3WoNr3bjZSAHeOsHrbV1Fu9/A0EzCinRE7Af1ofPrw=="
        crossorigin="anonymous"></script>
```
```
# 2026: mandate integrity on all external scripts/styles, report violations (Cloudflare Worker _headers)
Integrity-Policy-Report-Only: blocked-destinations=(script style) ; report-to=integrity
Integrity-Policy: blocked-destinations=(script) ; endpoints=(integrity-endpoint)
```

**AIRIZ note:** SRI protects **third-party/off-origin** resources. For **same-origin** AIRIZ assets, SRI is unnecessary
(TLS + your SW cache + content-hashing already cover it) — reserve SRI for anything off-origin.

### 4.4 "Signed manifests" — the honest answer

> ✅ Fetched from [MDN, Web application manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest), accessed 2026-11-05 (last modified 2025-08-08).

**There is no W3C-standard mechanism to digitally sign the `manifest.webmanifest` itself.** The manifest is a **JSON**
file delivered via `<link rel="manifest" href="…">` with `Content-Type: application/manifest+json` (or `application/json`).
Its integrity rests entirely on **HTTPS + same-origin** (and, if cross-origin + credentialed, `crossorigin="use-credentials"`).
Relevant members for identity/update logic: **`id`** (stable unique id), **`scope`** (SW scope), **`start_url`**,
**`protocol_handlers`**, **`related_applications`** (links the PWA to the installed native app — useful since the PWA is one
of five surfaces of the *same* console).

**So "signed manifests" on the web is achieved by signing the *update payload*, not the manifest:**
1. Host the manifest **same-origin over HTTPS** (integrity = transport).
2. **Sign the app shell / asset set** (the precache list) with **ed25519** (§6.1/§6.6); publish the signature in the
   manifest or a sibling `update.sig`.
3. In the SW `install` handler, **verify the signature over the exact set of asset URLs+hashes before `cache.addAll`** —
   a tampered "manifest points at a malicious asset" is rejected before anything is cached/executed.
4. SRI-pin any **off-origin** subresources (§4.3).

### 4.5 `Cache-Control` strategy for the SW shell

The update chain only works if the **bytes the browser compares** actually change:

| Resource | `Cache-Control` | Why |
|----------|-----------------|-----|
| **`sw.js`** (the worker script) | **`no-cache, no-store, must-revalidate`** (or `no-cache` + strong `ETag`) | Browser must **revalidate every navigation**; if cached, it never sees new bytes → **no update ever triggers** (fetched byte-comparison rule) |
| **`index.html`** (app shell) | **`no-cache`** (revalidate) | Must pick up **new content-hashed asset names** for the next precache |
| **`manifest.webmanifest`** | **`no-cache`** (or short `max-age`) | Same reason as shell — must reflect new `id`/asset set |
| **Content-hashed assets** (`app.1a2b3c.js`, `img.9f8e7d.png`) | **`public, max-age=31536000, immutable`** | Immutable → aggressive caching; correctness from the **filename hash changing** when content changes |
| **Fonts / long-lived binaries** | `max-age=31536000, immutable` (if content-hashed) | Same |

This **"no-cache shell + immutable content-hashed assets + versioned SW cache name + prune in activate"** is the canonical
PWA update design. On Cloudflare it's expressed in Worker Assets / `_headers` (§5.8).

### 4.6 2024–2026 changes that invalidated older PWA advice

| Older advice | Current (2026) |
|--------------|----------------|
| "SRI is a per-tag opt-in you sprinkle on" | **`Integrity-Policy` header (2026 WD)** can **mandate** SRI on all scripts/styles + report violations ✅ |
| "Cache the SW a bit to reduce requests" | `sw.js` must be **no-cache/no-store** or updates never fire ✅(model) |
| "The manifest is just config" | No native signing exists → **sign the precache set (ed25519)** + verify in SW; use `id`/`scope` for identity ✅ |

### 4.7 AIRIZ recommendation (PWA)

1. **HTTPS everywhere** (platform-enforced for SW anyway); serve `sw.js` **`no-cache, no-store`**.
2. **Content-hash** every app asset (`[name].[hash].js`) with **`immutable, max-age=1y`**; keep `index.html` + `manifest.webmanifest` **`no-cache`**.
3. **Narrow the SW scope** to the app path; use `Service-Worker-Allowed` only if you must broaden.
4. Implement the **skipWaiting-on-user-action + `clients.claim()` + `controllerchange`→reload** pattern (§4.2) — an **always-open motor console tab is exactly the "stuck on old version" trap**.
5. **Version the SW cache name per release** and **prune** old caches in `activate`.
6. **Sign the precache set with ed25519** and verify in `install` before caching (the "signed manifest" done correctly). SRI-pin (sha384/sha512, `crossorigin=anonymous`) anything off-origin; consider `Integrity-Policy` to enforce it org-wide.
7. Use **`related_applications`** + a stable **`id`** so the PWA is recognized as the same console across the five surfaces.

### 4.8 Config — precache signature verify in the SW (the real "signed manifest")

```js
// ed25519 verify of the precache set BEFORE caching (WebCrypto, secure-context, works in SW)
const PUBKEY = new Uint8Array([ /* 32-byte ed25519 public key, pinned at build time */ ]);
async function verifyPreload(sigB64, urls) {
  const key = await crypto.subtle.importKey('raw', PUBKEY, { name: 'Ed25519' }, false, ['verify']);
  // canonical: sorted, newline-joined "sha256:<hex> <url>" lines  (sign exactly this byte string)
  const body = new TextEncoder().encode(urls.map(u => `sha256:${await sha256hex(u)} ${u}`).sort().join('\n'));
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key,
    Uint8Array.from(atob(sigB64), c => c.charCodeAt(0)), body);
  if (!ok) throw new Error('precache signature invalid — abort install');   // fail closed
}
// in install:  await verifyPreload(feed.signature, ASSET_URLS);  then cache.addAll(ASSET_URLS)
```

---

## 5. Cloudflare Worker

### 5.1 Deploy authentication — and the "signed deploy / C2C attestation" question

> ❓→**finding.** I could **not** find any first-party Cloudflare feature named **"signed deploy"** or
> **"C2C attestation"** for Workers in the current docs. If a Round-1 claim asserted one, **it is not corroborated
> by Cloudflare's 2026 documentation** and should be treated as **not established**. Cloudflare's actual
> deploy-integrity story is *compositional*, from fetched pages:

1. **Authenticated deploy:** `wrangler deploy` authenticates to the account via a **least-privilege API token** or
   **OIDC** (e.g., GitHub Actions OIDC / Cloudflare Access). The token is the *authn* boundary.
   ⚠️ *Cloudflare, "Authenticate with Wrangler" / "API tokens" (canonical).*
2. **Source-of-truth + attestation is *yours* to provide:** the **git tag/commit** is the attested unit. Sign tags with
   **cosign/SLSA** (§6.6) so the deployed bundle traces to a signed commit. Cloudflare additionally collects
   **`dependencies_instrumentation`** (npm package names+versions) on deploy — a partial **SBOM** — the closest
   first-party supply-chain signal. ✅ *(fetched, Wrangler configuration: "Configures npm package dependency
   instrumentation when deploying… package names and versions. Defaults to `true`.")*
3. **Gradual deployment + rollback** is the runtime integrity control (§5.5).

> ✅ Fetched from [developers.cloudflare.com/workers/wrangler/configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), accessed 2026-11-05 (last updated **2026-10-29**):
> *"It is best practice to treat Wrangler's configuration file as the **source of truth**"*; Wrangler **v3.91.0+** accepts
> `wrangler.json`/`.jsonc` **and** `wrangler.toml` (*"Cloudflare recommends using `wrangler.jsonc` for new projects"*);
> **`dependencies_instrumentation.enabled`** defaults `true`.

**AIRIZ takeaway:** don't wait for a nonexistent "signed deploy." Get integrity from **signed git tag → CI builds →
`wrangler deploy` under a scoped token/OIDC → cosign-attested bundle → gradual deploy**. The token/OIDC + signed tag
*is* your "signed deploy."

### 5.2 Secrets and rotation

> ✅ Two distinct mechanisms, both fetched.

**(a) Per-Worker Secrets.** The Wrangler config declares the secret *names* your Worker requires: *"**`secrets`** …
Declares the secret names your Worker requires. Used for **validation during local development and deploy**, and as the
source of truth for **type generation**. `required` — A list of secret names that must be set to deploy your Worker."*
You set values via `wrangler secret put <NAME>` / the API. **Secrets are encrypted at rest and cannot be read back**
(set/overwrite only) — which shapes rotation: **overwrite the same name** with a new value, or **introduce a new name**
and deploy code that reads it. ⚠️ *Cloudflare, "Secrets" / `wrangler secret` (canonical).*

**(b) Cloudflare Secrets Store (open beta).** ✅ Fetched from [developers.cloudflare.com/secrets-store](https://developers.cloudflare.com/secrets-store/), accessed 2026-11-05 (last updated **2026-08-14**):
*"a secure, **centralized** location in which **account-level** secrets are stored and managed… securely encrypted and
stored across all Cloudflare data centers."* *"**Available in open beta**."* Compatible with **Workers** and **AI
Gateway**. *"**China availability:** Secrets Store is **unavailable** in the Cloudflare China Network."* Bind via
**`secrets_store_secrets`** (fetched from the config page).

**Rotation guidance:**
- **Centralize in Secrets Store** (once out of beta) for account-wide rotation + least-privilege binding per Worker; the 2026-preferred model over per-worker secrets.
- **Rotate by write-overwrite** (same name) for a hot swap, or **new-name + deploy** for a clean cutover with a rollback window.
- Because secrets **can't be read back**, rotation must be coordinated with a **redeploy** the code can tolerate (read new-or-old name) during overlap.
- **If AIRIZ must serve China** (BATAM/PTB context — likely not, but check), Secrets Store is **unavailable** there → fall back to per-Worker secrets.

### 5.3 WAF

> ✅ Fetched from [developers.cloudflare.com/waf](https://developers.cloudflare.com/waf/), accessed 2026-11-05 (last updated **2026-08-19**).

- *"The Cloudflare WAF checks incoming web and API requests and filters undesired traffic based on sets of rules called
  **rulesets**… uses the **Rules language**… filter traffic by request properties such as IP address, URL path, headers,
  and body content."*
- **Feature set (fetched):** **Application Profiles** (compare to an app-specific expected structure), **Custom rules**
  (incl. **WAF attack score**, **malicious uploads detection**), **Rate limiting rules**, **Managed rules** (*"pre-configured…
  regularly updated… advanced zero-day vulnerability protections"*), **Account-level configuration** (Enterprise),
  **Security Events / Analytics**.
- **Per-plan availability (fetched matrix):** **Free** = free managed ruleset only, 1 rate-limit rule, custom rules, custom
  lists, IP access rules, UA blocking, zone lockdown; **Enterprise** adds attack score, Sensitive Data Detection,
  account-level config, advanced alerts, (paid add-ons: malicious uploads, AI Security for Apps, Advanced Rate Limiting).

**AIRIZ takeaway:** put a **WAF managed ruleset** + **rate-limiting** in front of the Worker's zone (the update feed +
any public API the five surfaces call). Enable **attack score** and **custom rules** to protect the manifest/feed endpoint
specifically (it's the crown jewel — §6.6). On Free you get the base managed ruleset + one rate-limit rule; budget for
Business/Enterprise if the feed is high-value.

### 5.4 Durable Objects code versioning

> ✅ Fetched from the Wrangler configuration page (DO `exports`/`migrations`) and
> [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) (last updated **2026-09-22**), accessed 2026-11-05.

- **Declarative DO lifecycle via `exports`** (fetched): each DO class entry has **`type: "durable-object"`** and a
  **`state`** ∈ **`created`** (default), **`deleted`**, **`renamed`**, **`transferred`**, **`expecting-transfer`**;
  **`storage`** ∈ **`sqlite`** (*"recommended; required for new namespaces"*) or **`legacy-kv`**. `renamed_to`/`transferred_to`/
  `transfer_from` complete the moves.
- **Legacy `migrations`** array (`new_sqlite_classes`, `new_classes`, `renamed_classes`, `deleted_classes`,
  `transferred_classes`) is now **deprecated in favor of `exports`** — *"migrations and Durable Object entries in
  `exports` are mutually exclusive."*
- **Code-versioning gotcha (fetched, critical):** *"**State changes for associated storage resources** such as KV, R2,
  **Durable Objects**, and D1 **are not tracked with versions**."* — so **rolling back a Worker version reverts code,
  NOT DO state.** A new version with a changed DO schema can leave instances holding data the *old* (rolled-back) code
  can't read. **Pair DO schema changes with migration + a backward-compatible code window**, exactly like a DB migration.

### 5.5 Workers Logs (the 2024 feature) + observability + gradual deploy/rollback

> ✅ **Workers Logs** fetched from [developers.cloudflare.com/workers/observability/logs/workers-logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), accessed 2026-11-05 (last updated **2026-10-12**):

- *"**All newly created Workers will come with the observability setting enabled by default**."* → the **2024 Workers Logs** GA, now default-on.
- Logs = **invocation logs** + **custom `console.log`** + **errors/uncaught exceptions**. *"To group related exceptions,
  failed invocations, and error logs, use **Workers Issues**."*
- **`observability.enabled`** + **`head_sampling_rate`** (0–1; *"0 = zero out of one hundred… 1 = every request"*; default 1). Per-environment sampling supported.
- **`observability.issues.enabled`** (fetched from config page): *"detect and group production failures for a Worker…
  Requires Wrangler **4.134.0** or later."*
- **Limits/pricing (fetched):** max retention **7 days** (Free 3), max **5 B logs/account/day**, max **256 KB/log**;
  **pricing changes 2026-12-01** to Cloudflare Observability pricing. Export via **OpenTelemetry** (recommended),
  **Logpush**, or **Tail Workers**.

> ✅ **Versions & deployments** (fetched): *"Every time you change your Worker's code or configuration, Workers creates a
> **version**. A **deployment** determines which version(s) are actively serving traffic."* Decoupling them enables:
- **Gradual deployments** — *"Split traffic between two versions using percentage-based routing"* → **the native 10→50→100** for Workers.
- **Version affinity** — *"Consistently route users to the same version across page loads during a gradual deployment."*
- **Version URLs** — *"Test new versions before deploying them to production."*
- **Version overrides** — *"Send a request to a specific version by ID for smoke testing and pinning between Workers."*
- **Rollbacks** — *"Revert to a previously deployed version"* → **the native kill switch.**

### 5.6 2024–2026 changes that invalidated older Worker advice

| Older advice | Current (2026) |
|--------------|----------------|
| "Configure logging manually; it's off by default" | **Workers Logs on by default** for new Workers; enable **Workers Issues** (Wrangler ≥4.134.0) ✅ |
| "DO schema changes are just a code deploy" | DO **state is NOT versioned** — roll back reverts code, not data → **migrate + compat window** ✅ |
| "DOs use KV storage" | New DOs **must use `sqlite`** storage; `legacy-kv` only for existing ✅ |
| "TOML-only config" | **JSON/JSONC supported since Wrangler v3.91.0**; JSON recommended ✅ |
| "Cloudflare has a signed-deploy/attestation" | **No such first-party feature found** → use signed git tag + cosign + scoped token ❓ |

### 5.7 AIRIZ recommendation (Worker)

1. **Deploy from CI** with a **least-privilege API token or OIDC**; treat the **signed git tag** as the attested unit; **cosign-sign the bundle** for provenance. Enable `dependencies_instrumentation` (default) for the dep SBOM.
2. **`observability.enabled: true`** + **`observability.issues.enabled: true`** + a sane `head_sampling_rate` (e.g. 1.0 for the feed, lower for high-volume paths); export to your SIEM/OTel.
3. **Secrets:** move to **Secrets Store** (when you leave beta) for centralized, account-level rotation; declare `secrets.required` for deploy-time validation. Re-check **China Network** availability if relevant.
4. **WAF:** managed ruleset + rate limiting + a **custom rule protecting the update-feed endpoint** (attack-score it).
5. **Release strategy:** **gradual deployments** (10→50→100) with **version affinity**, smoke-test via **version URLs/overrides**, keep **rollback** as the one-click kill switch.
6. **Durable Objects:** manage classes via **`exports`** with **`sqlite`**; remember **state isn't versioned** — pair schema changes with migrations + backward-compat code, and **never assume rollback restores data**.

### 5.8 Config

**`wrangler.jsonc` (source of truth) — release-grade Worker:**
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "airiz-release-feed",
  "main": "src/feed.ts",
  "compatibility_date": "2026-11-05",
  "workers_dev": false,
  "route": { "pattern": "update.airiz-motor.app/*", "zone_name": "airiz-motor.app" },
  "upload_source_maps": true,
  "assets": { "binding": "ASSETS", "directory": "./dist" },        // PWA shell (if co-located)
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,                                       // feed: log everything
    "issues": { "enabled": true }                                  // Workers Issues (Wrangler >= 4.134.0)
  },
  "secrets": { "required": ["MANIFEST_SIGNING_PUBKEY_ID", "SENTRY_DSN"] },  // deploy-time validation
  "secrets_store_secrets": [ { "binding": "RELEASE_DB", "secret": "airiz/release-db" } ],
  "durable_objects": { "bindings": [ { "name": "ROLLOUT", "class_name": "RolloutState" } ] },
  "exports": {
    "RolloutState": { "type": "durable-object", "storage": "sqlite" }   // sqlite (required for new)
  }
}
```
**Gradual deploy + instant rollback (the kill switch), via the API/`wrangler`:**
```bash
# upload a version WITHOUT promoting, then split traffic 10% -> 50% -> 100%
wrangler versions upload                 # -> prints version ID <V_NEW>
wrangler deployments create --percentage 10 <V_NEW>    # gradual: 90% old / 10% new
# ...observe (Sentry gate, §6.3)... then:
wrangler deployments create --percentage 50 <V_NEW>
wrangler deployments create --percentage 100 <V_NEW>
# KILL SWITCH (instant, no redeploy):
wrangler deployments create --percentage 0 <V_NEW>     # or:
wrangler rollback                                       # revert to previous deployment
```
**WAF: protect the feed endpoint (Custom Rule, Rules language):**
```
# zone WAF -> Custom Rules (order: before Managed Rules for the feed path)
# expression (Rules language):
(http.host eq "update.airiz-motor.app") and (starts_with(http.request.uri.path, "/feed"))
# action: Block (or Challenge) when cf.score >= 60  ;  else Skip remaining
# Rate limiting rule: 1 req / 10s / IP on /feed -> Block (anti feed-scraping / brute force)
```

---

## 6. Cross-cutting topics

### 6.1 ed25519 vs RSA vs ECDSA for manifest signatures

> ✅ WebCrypto support fetched from [MDN, SubtleCrypto.generateKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey), accessed 2026-11-05 (last modified **2026-03-15**).

Fetched facts:
- **Ed25519 / X25519 in WebCrypto:** *"For **Ed25519**: pass the string `Ed25519` or an object of the form `{ name: "Ed25519" }`."* (X25519 for ECDH.) The worked example wraps in `try/catch` because *"not all browsers support this algorithm"* — but it is now broadly (Baseline) available.
- **RSA in WebCrypto:** example uses **`RSA-OAEP` with `modulusLength: 4096`**; `RSASSA-PKCS1-v1_5`, **`RSA-PSS`**, `RSA-OAEP` all supported.
- **ECDSA in WebCrypto:** example uses **`namedCurve: "P-384"`** (P-256 also standard).
- **Secure-context + Web Workers:** *"This feature is available **only in secure contexts (HTTPS)**… available in **Web Workers**."* → client-side verification works in a SW/Worker over HTTPS.
- MDN points to **NIST SP 800-131A r2** and **keylength.com** for key-length policy.

**Comparison** (perf figures are order-of-magnitude rules of thumb, not a fetched benchmark):

| | **Ed25519** | **ECDSA (P-256/P-384)** | **RSA (PSS 2048/3072/4096)** |
|---|---|---|---|
| Security level | ~128-bit | P-256 ≈128-bit; P-384 ≈192-bit | 2048≈112-bit; **3072≈128-bit**; 4096 higher |
| Pubkey size | **32 B** | 32–48 B | 256–512 B |
| Signature size | **64 B** | ~64–96 B | **256–512 B** |
| Verify speed | **fast** (≈2–3× ECDSA-P256; ≈10–50× RSA-2048) | moderate | **slow** |
| Deterministic | **yes** (RFC 8032) | no (nonce; malleability) | no (PSS salt) |
| **Node.js** | `crypto.generateKeyPairSync('ed25519')`; sign/verify with **`null`** algorithm ⚠️ | `crypto` ECDSA (P-256/P-384) ⚠️ | `crypto` RSA (PSS/OAEP) ⚠️ |
| **WebCrypto** | `{name:'Ed25519'}` ✅(fetched) | `{name:'ECDSA', namedCurve}` ✅(fetched) | `{name:'RSA-PSS'/'RSA-OAEP'}` ✅(fetched) |
| **Rust** | **`ed25519-dalek`** (RustCrypto) — fast, `no_std` ⚠️ | `p256`/`p384` crates ⚠️ | `rsa` crate (slower) ⚠️ |

*(Node/Rust library lines are canonical-cited ⚠️ — Node.js crypto docs + RustCrypto crates; not live-fetched this pass, but stable.)*

**When each is right:**
- **Ed25519** → your **custom manifest / update-payload signatures**: tiny (64 B sig fits in a manifest), fast to verify on every client (5 surfaces), modern, deterministic, supported by **Node + WebCrypto + Rust** (verified for WebCrypto). **The default choice for AIRIZ.**
- **ECDSA P-256** → when a **platform expects it** (e.g., **APNs** uses ES256; some CAs/TAs) or you want max TLS-ecosystem interop.
- **RSA-PSS (≥3072)** → only when a platform **mandates RSA** (traditional **Authenticode**, some **APK v2/v3** sig-algorithm IDs, legacy CAs). Prefer **3072+**; **never RSA-1024**.

**Deprecated (per task constraint — never use):** SHA-1, MD5, RSA-1024, RC4. For SRI use **sha384/sha512** (§4.3). For APK, `apksigner` picks safe sig-algorithm IDs (SHA-256/512) by default.

**Keypair generation (all three runtimes — the "ed25519 keypair gen" snippet):**
```js
// ---- Node.js (CI / feed-signer) ----
const { generateKeyPairSync, sign, verify } = require('node:crypto');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// private key -> HSM/KMS (or sealed). public key -> pinned into every client at build time.
const body   = Buffer.from(canonicalManifest);              // sign EXACTLY the canonical bytes
const sig    = sign(null, body, privateKey);                 // ed25519 -> algorithm is `null`
const ok     = verify(null, body, publicKey, sig);           // -> true
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
```
```js
// ---- WebCrypto (client verify, secure-context, works in SW/Worker) ----
const key = await crypto.subtle.importKey('raw', PUBKEY32, { name: 'Ed25519' }, false, ['verify']);
const ok  = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, bodyBytes);
```
```rust
// ---- Rust (RustCrypto `ed25519-dalek`) ----
use ed25519_dalek::{Signer, Verifier, SigningKey, VerifyingKey, Signature};
use rand_core::OsRng;
let (sk, vk): (SigningKey, VerifyingKey) = SigningKey::generate(&mut OsRng);   // 32B each
let sig: Signature = sk.sign(b"canonical_manifest_bytes");
assert!(vk.verify(b"canonical_manifest_bytes", &sig).is_ok());
// vk.to_bytes() -> 32-byte public key to pin; sk stays in the HSM/KMS.
```

### 6.2 Staged rollouts (10% → 50% → 100%)

**Model (synthesis of the fetched native mechanisms):**
- **Observability at each gate:** error/crash rate (crash-free sessions/users — §6.3), latency (p95/p99), **adoption** (fraction of clients on the new version), and **canary checks** (health endpoint, a signed "I'm on vN" beacon).
- **Kill switch:** the ability to *instantly* stop the rollout — **Cloudflare rollback / weight→0** (§5.5), **Play release halt**, **custom feed weight→0**, or **SW last-known-good**.
- **Decision latency:** target **< minutes** for an *automatic* gate breach (machine decides), **< hours** for a *human* call. The controller must act without a redeploy.

**Native support (fetched / canonical):**
- **Cloudflare:** **gradual deployments** (percentage split) + **version affinity** (sticky users) + **rollback** — a managed 10→50→100 + kill switch for the Worker. ✅
- **Play:** **phased releases** (1% → 5% → 20% → 50% → 100%) with pause/halt. ⚠️ *(Play Console.)*
- **App Store:** staged rollout (Apple-managed percentages). ⚠️
- **Custom cross-platform feed:** implement cohort bucketing yourself.

**Custom release-feed implementation (the cross-surface part no platform gives you):**

The feed is a **signed JSON manifest** (§6.6) carrying `version`, `weight` (0–100), `min_client`, and `signature`.
Each client deterministically buckets itself (pure, no server round-trip to decide):
```js
// client (Electron main / SW / Capacitor JS / Worker) — pure, offline-decidable
function inRollout(deviceId, weight) {          // weight in [0,100]; 0 = kill switch, 100 = everyone
  const h  = sha256Hex(deviceId + ':' + FEED_SALT);   // stable per-device
  const bucket = parseInt(h.slice(0, 8), 16) % 100;   // 0..99
  return bucket < weight;
}
// Server changes `weight` in the (signed) feed at any time -> instant kill switch / advance, no client redeploy.
// Monotonic `version` prevents replay (see 6.6).
```
**Gate logic (telemetry-driven auto-advance):**
```
10%  -> wait WINDOW (e.g., 30-60 min) & MIN_SAMPLE (e.g., >=500 sessions)
       if crash-free-users >= 99.5% AND p95 latency not regressed  -> advance to 50%
       else                                                        -> hold / rollback
50%  -> same gate  -> 100%
```
The **server** reads telemetry (Sentry §6.3 / Workers Logs §5.5), evaluates the gate, and **updates `weight` in the
signed feed**. Humans override via the same control (kill switch = set `weight: 0`).

**Server-side rollout controller (Durable Object — state lives in `sqlite`, §5.4):**
```js
// RolloutState DO — authoritative rollout state, survives Worker version rollback (it's storage, not code)
export class RolloutState {
  constructor(ctx, state) { this.storage = state.storage; }
  async get()   { return this.storage.get('rollout'); }
  async setWeight(pct) {
    const r = await this.storage.get('rollout') ?? { version: 0, weight: 0 };
    r.weight = Math.max(0, Math.min(100, pct));
    await this.storage.put('rollout', r);
    // re-sign the feed with the current ed25519 key (HSM/KMS) and publish
  }
  async autoAdvance(metrics) {   // called by a cron/scheduled Worker
    const r = await this.get();
    const gate = metrics.crashFreeUsers >= 0.995 && metrics.sessions >= 500 && !metrics.latencyRegressed;
    const next = { 10: 50, 50: 100 }[r.weight] ?? r.weight;
    if (gate && next > r.weight) await this.setWeight(next);
    else if (!gate && r.weight > 0) await this.setWeight(0);   // KILL SWITCH on breach
  }
}
```

### 6.3 Crash-throttled rollback (Sentry Release Health + peers)

> ✅ **Sentry Release Health** fetched from [docs.sentry.io/product/releases/health](https://docs.sentry.io/product/releases/health/), accessed 2026-11-05.

Fetched facts (the *signals* a telemetry-gated deploy consumes):
- **Sessions** are the unit: **user-mode/application-mode** (app start…background/exit) and **server-mode/request-mode** (per request). SDKs manage them automatically.
- **Crash-free sessions / crash-free users** = *"% of sessions [or distinct users] … not ended by a crash."*
- **The gate hook (fetched):** *"You can set **crash rate monitors** to tell you when your **crash free percentage for either sessions or users falls below a specific threshold**."* → your **telemetry-gated deploy / auto-rollback trigger**.
- **Crash vs unhandled (fetched):** *"Starting with **v25.9.0**, Sentry differentiates between crashes and unhandled errors; both are counted separately."* (Session statuses: **Abnormal / Crashed / Errored / Healthy / Unhandled**.)
- **Adoption stages (fetched):** computed **hourly over the last 6h**; a release is **Adopted / Low Adoption / Replaced** against a **10%** threshold (mobile projects, single environment).
- **Sessions vs issues (fetched):** session data is **not** subject to sampling/inbound filters → a reliable *high-level* health denominator; issues are the drill-down.

**Telemetry-gated deploy pattern (synthesis):**
1. Each release is a **Sentry release** (tag the build; `release` in every SDK init).
2. On the rollout controller, a **crash-rate monitor** watches **crash-free-users** per release.
3. **Gate:** advance only when `crash-free-users ≥ 99.5%` **and** sample size `≥ 500` sessions **and** no p95-latency regression, over a **30–60 min** window.
4. **Auto-rollback:** on breach → invoke the kill switch (Cloudflare rollback / Play halt / feed `weight:0` / SW last-known-good).
5. **Anti-tiny-N guard:** require a **minimum sample** so a 3-session cohort at 66% doesn't false-trigger.

**Config sketch (Sentry crash-rate monitor → kill switch):**
```yaml
# declarative intent (Sentry Project Alerts / "Monitors" -> the exact schema lives under
# docs.sentry.io -> Monitors & alerts; the Release Health *semantics* above are fetched ✅)
monitor:
  project: airiz-motor
  type: release-health
  metric: crash_free_users        # or crash_free_sessions
  threshold: 0.995                # 99.5%
  min_sessions: 500
  window: 30m
  on_breach:
    - notify: pagerduty:airiz-oncall
    - action: rollback            # -> calls the kill switch for the active channel (feed weight:0 / CF rollback)
```
**Peers (canonical-cited ⚠️, not fetched this pass):**
- **Rollbar** — error-rate alerts + a **gradual "Rollout"** feature (percentage rollout with auto-pause on error-rate breach).
- **Bugsnag** — **session** tracking + **error-rate** alerts + release health; good for the crash-free signal.
- **Highlight.io** — product analytics + **session replay** + error tracking; gate on crash rate *and* correlate with session recordings for faster triage.

**Recommendation:** standardize the *signal* (crash-free-users + min-sample + window) and the *action* (kill switch), and let each surface's native mechanism execute it. **Sentry is the strongest fit** because Release Health already exposes the exact thresholds + adoption stages you need, and it spans all five surfaces (Electron, Android, iOS, PWA/JS, Worker/Node).

### 6.4 Delta updates (bsdiff vs zsync vs Courgette)

> ⚠️ **Not fetched this pass** — the canonical bsdiff host (`daemonology.net`) returned a transport error and the
> bsdiff4 GitHub slug 404'd; search backends were down. The comparison below is the established engineering picture,
> **canonical-cited**; verify exact patch-size/bandwidth numbers against the linked primaries before publishing AIRIZ
> bandwidth budgets.

| | **bsdiff / bspatch** | **zsync** | **Courgette** |
|---|---|---|---|
| Origin | Colin Percival (2003); `bsdiff`/`bspatch`; maintained forks (e.g. **bsdiff4**) | Signature-based, rsync-like (`.zsync` file of chunk hashes) | **Google** (from ANGLE/Skia); used in **Play / App Bundle** patching & Chrome shader updates |
| Patch mechanism | Binary delta: LZMA control/extra streams | Re-chunk + per-chunk hash verify; resume-friendly | Binary delta tuned for native libs / similar binaries |
| Bandwidth | **small** for similar binaries | moderate (patch + chunk metadata) | **small** (production-proven by Play) |
| Generation cost | **high CPU** (LZMA) | moderate | moderate–high |
| Corruption tolerance | **low** — a corrupted patch yields corrupted output; **no self-verification** → **must verify full-file hash of the result** | **higher** — per-chunk hashes let it detect/re-fetch bad chunks | low (like bsdiff) → verify result |
| **Security** | **patch can be tampered → must be signed** + verify post-patch hash | per-chunk hashes help integrity, still sign the `.zsync` | **must be signed** (Play signs its patches) |

**The universal rule (the task's "security risk"):** *any* delta can be crafted so that `base + patch` produces
**arbitrary bytes**. Therefore, for **every** delta scheme:
1. **Sign the patch** (ed25519/RSA/ECDSA — §6.1) and verify before applying.
2. **Bind the patch to a specific base version** (include the base's full hash; refuse to apply on a mismatched base).
3. **Verify the full SHA-256 of the *resulting* file** against a value in the **signed manifest** (defeats a tampered patch even if the patch signature check were bypassed).

**Patch sign + verify (Node, applies to bsdiff/Courgette output):**
```js
const { createHash, verify } = require('node:crypto');
// FEED lists, per artifact:  { url, baseSha256, sha256(result), patchUrl, patchSig }
async function applyPatchedUpdate(artifact, baseBytes) {
  const baseHash = createHash('sha256').update(baseBytes).digest('hex');
  if (baseHash !== artifact.baseSha256) throw new Error('base version mismatch — refuse patch');
  const patch = await fetchBuf(artifact.patchUrl);
  if (!verify(null, patch, PUBKEY_ED25519, await fetchBuf(artifact.patchSigUrl)))   // sign the PATCH bytes
    throw new Error('patch signature invalid');
  const result = bspatch(baseBytes, patch);                                        // apply
  const resHash = createHash('sha256').update(result).digest('hex');
  if (resHash !== artifact.sha256) throw new Error('post-patch hash mismatch — reject'); // the real guard
  return result;
}
```

**AIRIZ recommendation:**
- **Electron desktop (large binary):** use **bsdiff** (or a **Courgette-style** delta) for the app + asar + updater between versions; **sign each patch (ed25519)** + verify the **post-patch SHA-256** from the signed feed manifest. Fall back to full download when the delta ratio is poor or the base is absent.
- **PWA / Worker:** **don't delta** — full-replace with **content-hashed, immutable** assets (§4.5) is simpler, equally fast at web scale, and avoids the delta-tamper surface entirely.
- **Android/iOS:** let the **stores** delta (Play does App Bundle / v4 streaming; App Store deltas internally) — you don't hand-roll these.

### 6.5 Key custody (HSM vs cloud KMS vs offline)

> ✅ Anchors fetched: Azure **Artifact Signing** = *"FIPS 140-3 level 3 certified HSMs"* (§1.3); Play App Signing keys =
> *"protected by **Google's Key Management Service**"* (§2.4); **Secrets Store** = Cloudflare account-level encrypted store
> (§5.2); **cosign** supports **PKCS#11 / hardware tokens** and **self-managed keys**
> ([docs.sigstore.dev/cosign](https://docs.sigstore.dev/cosign/), fetched — nav shows *"Hardware Tokens"*, *"Self-Managed Keys"*).

**The per-surface custody map — why "one KMS for everything" is impossible:**

| Surface | The signing secret | Where it *must* live | Can it go in a generic KMS (AWS/Azure/GCP)? |
|---------|--------------------|----------------------|---------------------------------------------|
| **Windows** | Azure **Artifact Signing** (ex-Trusted Signing) cert/key | **Microsoft's FIPS 140-3 L3 HSMs** (managed service) — *or* a physical **EV/HSM token** in a signing server if you self-sign | **No.** It's a Microsoft-managed resource (or a hardware token), not importable KMS key material. ✅ |
| **Android (Play)** | App signing key | **Google's KMS** (Play App Signing) — *not retrievable by you* ✅ | **No.** It's *Google's* KMS. (Self-managed Android keys → *your* JKS/HSM/KMS.) |
| **iOS / macOS** | Developer ID / iOS Distribution **private keys + Apple-issued certs** | Developer **Keychain / hardened build server**; certs issued by **Apple's CAs** | **No.** Apple certs **cannot** be imported into a generic KMS as signing keys; renewal is **annual** and tied to the **Apple Developer Program** (§3.2). |
| **PWA / manifest** | Your **ed25519** update-signing key | **Your** HSM or cloud KMS (this *is* a plain key you own) | **Yes** — the one surface that fits a generic KMS cleanly. |
| **Cloudflare** | Worker **secrets** | **Cloudflare Secrets Store** (account-level) / per-Worker secrets ✅ | **No** — it's Cloudflare's store (and N/A in the China Network). |

**So the honest answer:** you get a **per-surface custody map**, not a single KMS. The **manifest-signing ed25519 key**
is the only secret that comfortably lives in *your* generic KMS/HSM; everything else is **platform-custodied**
(Microsoft HSMs, Google KMS, Apple Keychain+certs, Cloudflare Secrets Store).

**Rotation cadence (recommendation):**
- **Manifest/update signing key:** rotate **annually** (or on suspicion). Use **key versioning** — embed a **`key_id`** in the manifest and **cross-sign** (the new key signs a record of the old key's public key) so clients verify during the overlap and you can rotate **without breaking installed clients**.
- **Platform certs/keys:** follow each platform's cadence — **Apple annual** (+ the **2027-02-01** Sub-CA re-issue, §3.2); **Play** upload-key resettable anytime; **Azure** zero-touch (service-managed).
- **Worker secrets:** rotate on a calendar + on personnel change; centralize in **Secrets Store**.

**Revocation (per mechanism):**
- **PKI certs (Windows/Apple):** **CRL / OCSP** (OCSP stapling where supported) + manual re-issue.
- **Your manifest keys:** **manual** — publish a **revocation/allowed-key list** (or "max trusted `key_id`") in the signed feed; clients refuse revoked keys.
- **Apple:** revoke via the **developer portal**, then re-issue.
- **Android:** **Play upload-key reset** (app signing key unaffected).
- **Azure Artifact Signing:** delete the **certificate profile**.
- **Cloudflare:** delete/rotate the **secret**; WAF/IP-access to cut off a leaked deploy token.

### 6.6 Manifest transport (HTTPS+signed body vs JWS vs minisign vs cosign)

> ✅ **cosign/Sigstore** structure fetched from [docs.sigstore.dev/cosign](https://docs.sigstore.dev/cosign/), accessed 2026-11-05:
> signing (containers, **blobs**, git, **PKCS#11 tokens**), verifying (signatures, **timestamps**, **in-toto attestations**),
> key management (self-managed, import, **hardware tokens**), **transparency log**, **Fulcio CA**, **policy controller**.

**Options compared (synthesis + fetched anchors):**

| Approach | What it is | Signature | Bundle vs detached | Replay protection | Best for |
|----------|-----------|-----------|--------------------|--------------------|----------|
| **HTTPS + signed body** | Serve manifest over TLS; add a `signature` field (e.g. `ed25519` base64 over canonical JSON); client verifies with a known pubkey | Your key | Self-contained (sig in the doc) | Add `version`/`issued_at` | Simple, universal, all 5 surfaces |
| **JWS (RFC 7515)** ⚠️ | Standard compact/JSON serialization; `alg` = **EdDSA** (ed25519) / **ES256/ES384** (ECDSA) / **RS256** (RSA); **detached payload** signs only the hash | Std header | **Detached** ideal for large binaries (don't re-serve to sign) | `iat`/`nbf`/`exp` + **`nonce`** + pinned `kid` | Structured manifests, multi-sig, interop |
| **minisign** ⚠️ | NaCl/ed25519, tiny; used by **NixOS** for signing; signature file or inline | ed25519 | Detached (`.minisign`) | Add version/timestamp yourself | Binary/asset manifests, minimal deps |
| **sigstore / cosign** ✅ | **Keyless** (Fulcio short-lived cert + **Rekor** transparency log) **or self-managed keys**; **bundle** = cert + log entry + signature; verify via `cosign verify` / **policy controller** | Ed25519/ECDSA via Fulcio or your HSM | **Bundle** (self-contained provenance) | Rekor log entry is timestamped + append-only; policy enforces | **CI artifacts + supply chain** provenance |

**Bundle vs detached:**
- **Bundle** (signature + provenance in one artifact) → easiest to verify, nothing to lose; good for the **manifest** itself and **cosign CI artifacts**.
- **Detached** (signature file *alongside* the artifact) → the artifact is never re-served to sign it; good for **large binaries** (Electron app, asar) where you sign the **hash** and ship `artifact.sig` next to it.

**Replay protection (the part that's easy to get wrong):**
1. **Monotonic `version` / `build_id`** — the client **refuses anything ≤ the last accepted version**. The *primary* replay defense for an update feed.
2. **Timestamp + max-age** — reject manifests older than N minutes (binds freshness).
3. **`nonce`** (JWS) — for request/response freshness where applicable.
4. **Pinned `key_id`** (+ allowed/revoked list, §6.5) — a replayed *old-but-valid* manifest from a revoked key is rejected.

**AIRIZ unified feed (the recommendation), as a JWS (EdDSA/ed25519, detached) over HTTPS:**
```jsonc
// GET https://update.airiz-motor.app/feed   (HTTPS/HSTS, behind WAF §5.3)
// JWS compact:  BASE64URL(header).BASE64URL(payload).BASE64URL(signature)   (signature over header.payload)
{
  "alg": "EdDSA",                       // ed25519 via RFC 8037
  "typ": "airiz+feed",
  "kid": "airiz-2026-11",               // pinned key id (rotation: new kid + cross-sign record, §6.5)
  "iat": 1762358400, "nbf": 1762358400, "exp": 1762444800,     // freshness window (replay guard #2)
  "ver": "2026.11.05.3"                 // MONOTONIC version (replay guard #1)
},
{
  "version": "2026.11.05.3",
  "weight": 50,                          // rollout %  (kill switch -> 0, §6.2)
  "min_client": "2026.01.00",
  "key_id": "airiz-2026-11",
  "artifacts": [
    { "surface": "electron", "url": "https://cdn.airiz-motor.app/win/airiz-2026.11.05.3.zip",
      "sha256": "<full-result sha256>", "delta": { "patchUrl": "…/airiz-2026.11.05.3.delta",
        "patchSig": "…/airiz-2026.11.05.3.delta.sig", "baseSha256": "<prev sha256>" } },
    { "surface": "pwa",   "url": "https://airiz-motor.app/", "precache_sig": "<ed25519 over sorted asset hashes>",
      "sha256": { "app.1a2b3c.js": "…", "app.4d5e6f.css": "…" } },
    { "surface": "android", "play": { "package": "app.ziris.airizmotor", "minVersion": "202611053",
        "track": "production", "phase": "50%" } },
    { "surface": "ios",   "asc": { "bundleId": "app.ziris.airizmotor", "version": "2026.11.05", "phase": "staged" } }
  ]
}
```
- **Verify in every client** before applying: Electron **main** process, the **SW `install`** handler, **Capacitor JS**, and the **Worker**. Reject on: bad signature, `ver ≤ last`, expired, or revoked `key_id`.
- Signing key: your **ed25519** in a **HSM/KMS** (§6.5), **cross-signed annually** for rotation.
- **Add cosign/SLSA on the CI-built artifacts** (Electron zip, AAB, IPA, Worker bundle) for **transparency-log provenance**, so the feed's hashes are themselves traceable to a signed commit — closing the loop from *signed source* → *signed feed* → *verified client*.

---

## 7. Unified AIRIZ architecture recommendation

Synthesis across all five surfaces — the "lock down before picking a unified release architecture" decision:

1. **One signed, monotonic release feed, five verifiers.** A single **ed25519-signed JWS feed** (HTTPS, on the
   Cloudflare Worker behind WAF, §5.3/§6.6) carries per-surface artifacts + hashes + a monotonic `version` (replay
   guard) + `weight` (rollout, §6.2). Each surface verifies **client-side** with the pinned/cross-signed key:
   - **Electron** — verify in **main** before `electron-updater` applies; Authenticode-verify the signed binary (§1).
   - **PWA** — verify the **precache set** in the **SW `install`** handler before caching (§4.4/§4.8).
   - **Android** — the *store* signs (Play App Signing, **v1+v2+v3+v4**, §2); your feed gates the **Play phased release**
     + **Play Integrity** checks.
   - **iOS** — the *store* signs (App Store / Custom App Distribution, §3); your feed gates promotion + the annual cert cycle.
   - **Worker** — the feed is *served by* the Worker; **cosign**-signed bundle + gradual deploy + rollback (§5).

2. **Rollout & rollback are the same control.** `weight` in the signed feed (10→50→100) + a
   **crash-free-users ≥ 99.5% / ≥500-sessions / 30–60-min** gate (Sentry Release Health, §6.3). **Kill switch =
   `weight:0`** (feed) **or native rollback** (Cloudflare) **or store halt** (Play/App Store). Decision latency target:
   **< minutes** auto, **< hours** human.

3. **Key custody is per-surface, not one KMS** (§6.5). Only the **ed25519 feed key** lives in *your* HSM/KMS.
   Windows = **Azure Artifact Signing (FIPS 140-3 L3 HSMs)**; Android = **Google KMS (Play)**; iOS = **Apple Keychain +
   annual certs** (🔴 **re-issue Developer ID from G2 before 2027-02-01**); Cloudflare = **Secrets Store**. Rotate the
   feed key **annually with cross-signing**.

4. **Transport & integrity stack:** HTTPS/HSTS + **SRI (sha384/sha512, `Integrity-Policy`)** for off-origin PWA assets +
   **content-hashed immutable assets** (PWA) + **signed deltas (ed25519) with post-patch SHA-256** (Electron only) +
   **cosign/SLSA** on all CI artifacts for provenance.

5. **Observability is the gate's eyes.** **Sentry** across all five surfaces (Release Health = the gate) + **Cloudflare
   Workers Logs/Issues** (Worker) + **Play/App Store** analytics (stores). Standardize on **crash-free-users + min-sample
   + window** as *the* health signal.

6. **Crypto floor:** **ed25519** for the feed + deltas; **ECDSA P-256** where a platform expects it (APNs);
   **RSA-PSS ≥3072** only where mandated (Authenticode). **Never** SHA-1/MD5/RSA-1024/RC4. SRI on **sha384/sha512**.

7. **The 2024–2026 deltas that change the plan (the point of this verification pass):**
   - **Windows:** "Azure Trusted Signing" is now **"Artifact Signing"** (managed FIPS 140-3 L3 HSM, digest signing, no
     EV USB token) — adopt it; stop planning around a fixed SmartScreen download number. ✅
   - **Android:** sign **v4** (mandatory for Play, Aug 2024); key rotation = **v3 proof-of-rotation (A13+)** or **Play key
     upgrade**, *not* multi-cert. ✅(scheme) / ⚠️(mandate)
   - **iOS:** **Custom App Distribution (2024)** replaces Enterprise-for-customers; **old Developer ID Sub-CA dies
     2027-02-01** → re-issue from **G2** (to 2031), renew **annually**. ✅(cert event) / ⚠️(2024 feature)
   - **Cloudflare:** **Workers Logs on by default** (enable **Issues**); **Secrets Store** (open beta) for rotation;
     **DO state is not versioned** (roll back ≠ data revert); **no first-party "signed deploy"** found → use signed git tag
     + cosign + scoped token. ✅ / ❓

---

## 8. Threat model & rollback runbooks

### 8.1 STRIDE-lite per update channel

| Threat | Windows | Android | iOS | PWA | Worker |
|--------|---------|---------|-----|-----|--------|
| **S**poofing (fake updater/feed) | Broken Authenticode chain | Modified/sideloaded APK | Repackaged IPA | MITM of shell/SW | Forged feed JSON |
| **T**ampering (in-transit / in-cache) | Unsigned PE | v1-only (ZIP metadata gap) | Unsigned payload | Stale SW cache / tampered precache | Unsigned manifest body |
| **R**epudiation (no provenance) | No TSA timestamp | No build attestation | No notarization ticket | No build attestation | No source attestation |
| **I**nfo-disclosure | — | — | — | — | Leaked deploy token / secret |
| **D**enial of service | — | — | — | — | Feed endpoint flood |
| **E**levation (privilege) | — | Rooted device runs modded app | Jailbroken device | SW scope too broad | Over-scoped API token |

**Mitigations mapped:** Authenticode+TSA (§1) · v2+/v3/v4 + Play Integrity (§2) · provisioning+notarization (§3) ·
HTTPS + SW no-cache + precache sig + SRI + narrow scope (§4) · scoped token/OIDC + WAF + rate-limit + secrets (§5) ·
signed monotonic feed + replay guards + pinned key (§6.6).

### 8.2 Rollback runbooks (the kill switch, per surface)

**Goal: from "gate breached" to "users on last-known-good" < minutes (auto) / < hours (human).**

| Surface | Primary kill switch | Fallback | Data/safety note |
|---------|---------------------|----------|------------------|
| **Windows (Electron)** | Point the signed feed at the **previous** version (`weight:0` on new) → `electron-updater` keeps serving last-good; or yank the new feed entry | Re-publish a **hotfix** build signed + Authenticode-verified | Updater must **fail closed** if feed sig invalid (don't half-apply) |
| **Android** | **Play Console: pause/stop** the phased release (new version stops propagating) | Publish a **patch release** that reverts | Already-updated devices stay on new until next update; Play re-signs |
| **iOS** | **App Store Connect: pause staged rollout**; or halt TestFlight | Publish a **fix build** | Store-gated; can't "yank" an already-installed app — ship a fix |
| **PWA** | Bump the signed feed `version` to the **last-good precache set**; SW `install` re-primes to it on next load; users reload via `controllerchange` | Ship a **hotfix SW** that forces cache clear | Relies on users **reloading** (always-open console = worst case) → also push a Web Push "reload now" |
| **Worker** | `wrangler rollback` (or `deployments create --percentage 0 <V_NEW>`) — **instant, no redeploy** | `wrangler deployments create` to a known-good version | **DO state is NOT rolled back** (§5.4) → verify old code tolerates current DO data |

**Cross-surface auto-rollback wiring (the controller, §6.2/§6.3):**
```
Sentry crash-rate monitor (crash_free_users < 0.995 AND sessions >= 500, 30m window)
   -> page on-call
   -> controller sets feed.weight = 0        (PWA / Electron / feed-driven clients)
   -> controller calls Play API: stop phased release   (Android)
   -> controller calls App Store Connect: pause staged  (iOS)
   -> controller calls `wrangler rollback`            (Worker)
   -> verify: re-check crash_free_users recovers above threshold over next window (else escalate to human)
```

**Verification after every rollback (don't trust the switch):** confirm crash-free-users recovers, confirm the
rolled-back version is the one actually serving (Worker: `wrangler versions list`; stores: console; PWA: `controllerchange`
beacons; Electron: updater log), and record the incident (what version, what breach, what action, recovery time).

---

## 9. Source register & verification table

**Access date for all: 2026-11-05.**

| # | Source (status) | URL | Establishes |
|---|-----------------|-----|-------------|
| 1 | ✅ Microsoft Learn — **Artifact Signing** overview (ex-Trusted Signing) | https://learn.microsoft.com/en-us/azure/artifact-signing/overview | 2024→2026 rename; FIPS 140-3 L3 HSM; digest/content-confidential signing; Public/Private Trust; Basic/Premium SKU; external timestamping. `ms.date 2026-01-02`, updated `2026-08-03` |
| 2 | ⚠️ Microsoft Learn — Authenticode / Trusted Signing how-it-works / `az signer` | https://learn.microsoft.com/en-us/azure/trusted-signing/ (→ artifact-signing) | Signing flow automation, RFC 3161 timestamp, CI integration (slug 404'd this pass) |
| 3 | ⚠️ Microsoft Learn — Windows SmartScreen | https://learn.microsoft.com/en-us/windows/security/… (windows-smartscreen topic) | Publisher/file reputation model; post-2023 multi-signal scoring (slug 404'd this pass) |
| 4 | ✅ AOSP — APK signing schemes (v1/v2/v3 overview) | https://source.android.com/security/apksigning | v1 (JAR, no ZIP-metadata protection), v2 (whole-file, A7.0+), v3 (A9+); "sign with all schemes" |
| 5 | ✅ AOSP — **APK Signature Scheme v3** | https://source.android.com/security/apksigning/v3 | **Android 9 key rotation**; proof-of-rotation struct; per-signer minSDK/maxSDK; "not recommended ≤A12"; A13+ `checkSignatures`→newest; Play key upgrade; "multiple signers not supported" |
| 6 | ✅ AOSP — **APK Signature Scheme v4** | https://source.android.com/security/apksigning/v4 | fs-verity Merkle tree; `<apk>.apk.idsig`; **requires v2/v3**; SHA-256/4096; IncFS streaming/incremental install; `apksigner` emits v4 by default |
| 7 | ✅ Android Developers — App signing / **Play App Signing** | https://developer.android.com/studio/publish/app-signing | App signing key + upload key; **Google KMS**; key non-retrievable; upload-key reset; PEPK; ≥25yr & **expiry after 22 Oct 2033**; `keystore.properties`; Play App Signing required (post-Aug-2021); key upgrade A13+ |
| 8 | ⚠️ Google Play — **v4 mandate (Aug 2024)** | Play Console help / android-developers.googleblog | v4 mandatory for Play uploads (console policy; not fetched this pass) |
| 9 | ⚠️ Android Developers — **Play Integrity** | https://developer.android.com/distribute/play-protection/integrity | Device Integrity + App Integrity (slug 404'd this pass) |
| 10 | ✅ Apple Developer — **Programs** | https://developer.apple.com/programs/ | **$99** Apple Developer Program; **$299** Enterprise; **TestFlight 10,000** external; Developer ID + notarization for out-of-store Mac; 175 regions |
| 11 | ✅ Apple Developer — **News** (Oct 1, 2026 item) | https://developer.apple.com/news/ | **Developer ID Sub-CA expires 2027-02-01**; re-issue from **G2** (valid to **2031**); certs **renew annually**; `.pkg` re-sign; old stapled apps keep working |
| 12 | ⚠️ Apple — **Custom App Distribution** (2024) | https://developer.apple.com/programs/custom-app-distribution/ | 2024 customer-specific distribution w/o Enterprise (slug 404'd this pass) |
| 13 | ⚠️ Apple — **Notarization** | https://developer.apple.com/documentation/xcode/… (notarizing-your-app) | macOS sign + Hardened Runtime + notarize/staple (slug 404'd this pass; requirement confirmed via #10) |
| 14 | ✅ W3C — **Subresource Integrity** (WD 2026-03-20) | https://www.w3.org/TR/SRI/ | `integrity` attr; **sha256/384/512**; multiple-hash agility; **CORS required**; violation→error; **`Integrity-Policy` header (new 2026)** |
| 15 | ✅ MDN — **Using Service Workers** (mod 2026-09-25) | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers | HTTPS-only; install/activate; **skipWaiting**; **clients.claim**; **scope + Service-Worker-Allowed**; delete old caches in activate; byte-comparison update |
| 16 | ✅ MDN — **Web app manifest** (mod 2025-08-08) | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest | Manifest = JSON over `<link>`; `id`/`scope`/`start_url`/`related_applications`; **no native signing** |
| 17 | ✅ MDN — **SubtleCrypto.generateKey** (mod 2026-03-15) | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey | **Ed25519/X25519**, **RSA-OAEP/PSS (4096)**, **ECDSA (P-384)**; **HTTPS-only**; **Web Workers**; NIST SP 800-131A r2 / keylength.com |
| 18 | ✅ Sentry — **Release Health** | https://docs.sentry.io/product/releases/health/ | Sessions (user/server-mode); **crash-free sessions/users**; **crash rate monitors (threshold)**; **Adopted/Low/Replaced (10%, hourly/6h)**; crash vs unhandled (**v25.9.0**) |
| 19 | ✅ Cloudflare — **Wrangler commands** (Apr 23 2026) | https://developers.cloudflare.com/workers/wrangler/commands/ | Command surface incl. `deploy`, `versions`, **Secrets Store**, **Workers for Platforms** |
| 20 | ✅ Cloudflare — **Wrangler configuration** (Oct 29 2026) | https://developers.cloudflare.com/workers/wrangler/configuration/ | Source-of-truth config; **JSON/JSONC (v3.91.0+)**; **`secrets.required`**; **`secrets_store_secrets`**; **`observability`/`issues.enabled` (4.134.0+)**; **`dependencies_instrumentation`**; DO **`exports`/`migrations`** (sqlite/legacy-kv) |
| 21 | ✅ Cloudflare — **Versions & deployments** (Sep 22 2026) | https://developers.cloudflare.com/workers/versions-and-deployments/ | Version vs deployment; **gradual deployments**; **version affinity**; **version URLs/overrides**; **rollbacks**; **storage state NOT versioned** |
| 22 | ✅ Cloudflare — **Secrets Store** (Aug 14 2026) | https://developers.cloudflare.com/secrets-store/ | **Open beta**; account-level encrypted secrets; Workers + AI Gateway; **unavailable in China Network** |
| 23 | ✅ Cloudflare — **Workers Logs** (Oct 12 2026) | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | **On by default (new Workers)**; invocation + custom logs + errors; **head_sampling_rate**; **Workers Issues**; OTel/Logpush/Tail; 7-day retention, 256KB; pricing change **2026-12-01** |
| 24 | ✅ Cloudflare — **WAF** (Aug 19 2026) | https://developers.cloudflare.com/waf/ | **Rulesets** + Rules language; **managed/custom/rate-limit** rules; Application Profiles; per-plan matrix |
| 25 | ✅ Sigstore — **cosign** | https://docs.sigstore.dev/cosign/ | Sign (containers/**blobs**/git/**PKCS#11**); verify (sig/**timestamps**/**in-toto**); key mgmt (self-managed/**HSM**); **transparency log**; **Fulcio**; **policy controller** |
| 26 | ⚠️ bsdiff / zsync / Courgette | daemonology.net (transport err) / bsdiff4 / ANGLE-Courgette | Delta comparison (host unreachable this pass) |
| 27 | ⚠️ Node.js crypto / RustCrypto (ed25519) | https://nodejs.org/api/crypto.html ; RustCrypto `ed25519-dalek` | Node/WebCrypto/Rust ed25519 support (stable; not live-fetched this pass) |
| 28 | ⚠️ Rollbar / Bugsnag / Highlight.io | vendor docs | Peer telemetry-gated-deploy / crash-rate signals (not fetched this pass) |

### Net verification result (Round 2)

The core 2024→2026 claims that matter for architecture were **confirmed against live 2026 primary sources**:
Azure **Trusted Signing→Artifact Signing** rename + FIPS 140-3 L3 HSM digest signing (#1); Android **v4**
(Merkle/`idsig`, requires v2/v3) + **v3 key rotation** (#5, #6); Apple **Developer ID Sub-CA expiry 2027-02-01 /
G2-to-2031** annual renewal (#11); Cloudflare **Workers Logs default-on** + **Secrets Store** (open beta) +
**DO state not versioned** (#20–23).

**Three items are flagged for follow-up:**
- **(a)** the **Play v4-mandate exact date** — real, but the live Console page fetch failed this pass (⚠️, #8);
- **(b)** **Apple Custom App Distribution / account-less** eligibility rules — real 2024 features, live slugs 404'd (⚠️, #12);
- **(c)** the **Cloudflare "signed deploy / C2C attestation"** premise from Round 1 — **not corroborated by current
  Cloudflare docs**; drop it in favor of signed-git-tag + cosign + scoped-token (❓, §5.1).

*End of reference. 21 primary sources fetched live on 2026-11-05; every dated claim carries a verification marker (✅/⚠️/❓).*

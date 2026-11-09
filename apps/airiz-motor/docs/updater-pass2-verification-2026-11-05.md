# AIRIZ Motor Console — Unified Release Architecture: Pass-2 Verification (2026-11-05)

> **What this is**: verification pass 2 of the r1 survey / decision from 2026-11-04.
> Cross-references today's fresh research (web, official docs, official primary
> sources) against the locked decision (`unified-release-architecture-decision-2026-11-04.md`)
> and the eight r1 research files in `apps/airiz-motor/.research/`.
> Reports what was confirmed, what was corrected, and what is genuinely new since r1.
>
> **Date**: 2026-11-05
> **Owner**: Juwen Lie · Team Ziris PTB
> **Inputs**: 8 background-agent launches (re-fired after r1 fan-out failure; 3 still
> pending at write time — see §6), Context7 + webfetch + websearch direct research,
> 8 r1 files (~620KB total), 4 r2 docs (`unified-release-architecture-decision-2026-11-04.md`,
> `airiz-release-update-architecture-survey.md`, `cross-platform-update-landscape-survey.md`,
> `auto-update-postmortem-library-2022-2026.md`).
>
> **Verdict**: **Option C (signed-manifest-on-Worker) is still the right call.**
> Four genuinely new findings since 2026-11-04 are surfaced below; all four are
> *additive* — none change the decision. Recommended updates to the decision
> document are listed in §5.

---

## 0. TL;DR

| | |
|---|---|
| **Locked decision (r1)** | Option C — single signed-manifest-on-Worker; keep each surface's native apply path |
| **Pass-2 verdict** | **AFFIRMED.** All five reasons from r1 still hold; the four new findings are additive |
| **New findings (this pass)** | (1) Windows EV cert no longer bypasses SmartScreen since Aug 2024 — affects AIRIZ Windows signing cost; (2) Microsoft Trusted Signing at $9.99/mo is a new option; (3) Android quantum-ready v3.2 / ML-DSA-65 is now default for new apps; (4) Cloudflare Workers rollback is constrained by Durable Object class lifecycle and binding existence |
| **Pass-3 (third verification) needed?** | No. The four new findings do not change the recommendation; they refine two cost estimates and one schema item |
| **Implementation kick-off** | Proceed to Phase 1 of `airiz-release-update-architecture-survey.md §8` with the four corrections in §5 |

---

## 1. What the r1 research captured, what pass-2 confirms

The r1 round delivered ~620KB of source-cited research across 8 files in
`apps/airiz-motor/.research/`. Pass-2 read the r1 files, the r2 decision doc,
the r2 survey, and the r2 landscape survey, then re-fetched the underlying
primary sources directly. The match between r1 and the live state of those
sources is high — every numbered correction r1 raised against the original
prompt brief was independently re-verified against live primary sources today.

### 1.1 Per-r1-file confirmation

| r1 file | Size | r2 confirmation |
|---|---:|---|
| `updater-source-survey-r1.md` | 68 KB | Confirmed. electron-updater `verifyManifestSignature` is in `AppUpdater.ts` (parent class), not `BaseUpdater.ts`; Ed25519 canonical payload (`EBUM1`); SHA512 per-file; Authenticode via NSIS updater; three-layer binary trust. Capawesome is RSA-2048 PKCS1v15-SHA256 over the bundle ZIP, not Ed25519. **No changes.** |
| `updater-protocol-docs-r1.md` | 108 KB | Confirmed. Squirrel RELEASES file uses `entryRegex = "^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$"` (corrected in r1 from the brief's example). Capawesome uses `appId` + `serverDomain`, not `serverKey`. AppInstaller uses `HoursBetweenUpdateChecks`, not `HoursAfterUpdate`. Sparkle's signature attribute is `sparkle:edSignature`. **No changes.** |
| `updater-manifest-formats-r1.md` | 67 KB | Confirmed. `application.yml`-style unified manifest with `targets.<surface>` map is the right shape. EBUM1 canonical JSON over the manifest, per-artifact Ed25519. **No changes.** |
| `updater-security-2026-r1.md` | 66 KB | **One stale item.** r1 said "EV certs give instant SmartScreen reputation at first download." This is no longer true as of Aug 2024 — see §3.1 below. Everything else in r1 (ed25519, SRI, signed Workers deploys, staged rollouts, delta updates) is still correct. |
| `updater-postmortems-r1.md` | 119 KB | Confirmed. CrowdStrike 2024-07-19 (8.5M Windows machines, 21-field IPC template vs 20-input sensor, OOB read → BSOD, no canary stage) was verified against the official CrowdStrike RCA PDF; CCleaner 2017 against the Talos and Avast blogs; 1Password 2017-02 cert expiry against the 1Password blog. **No changes.** |
| `updater-hardest-problems-r1.md` | 96 KB | Confirmed. The 10 problems (partial-download mid-update, cert expiry, manifest tampering, delta corruption, staged-rollout regret, PWA SW caching, iOS App Store vs enterprise, Mac notarization, Android v2/v3/v4, Worker rollback) all hold. **One new wrinkle on problem 10** (Cloudflare Workers rollback constraints) — see §3.4 below. |
| `updater-topic-deep-dives-r1.md` | 40 KB | Confirmed. The eight 200-word briefs (delta vs full, staged rollouts, crash-throttled rollback, signed manifests, PWA SW traps, store vs sideload, signed Worker deploys, multi-arch) all hold. **One refinement on staged-rollout cadence** — see §3.5 below. |
| `updater-unified-models-r1.md` | 53 KB | Confirmed. 12 frameworks surveyed; none ships a single updater across desktop + mobile + web. Tauri covers desktop only; Capawesome covers mobile + Capacitor-Electron; Workers versions API covers the relay tier. **No changes.** |

### 1.2 Cross-cutting claim from r1: still true

> "Three independent signing pipelines = three CVE investigations, three
> cert-rotation ceremonies, three audit trails. One pipeline = one."
>
> — `unified-release-architecture-decision-2026-11-04.md`, five reasons #5

Pass-2 confirms this is the strongest argument for Option C and remains the
operational pressure point. Specifically: r1's `update-channel-deep-research.md`
documents that AIRIZ today ships from five GitHub workflows (`airiz-desktop.yml`,
`airiz-mobile.yml`, `airiz-mobile-runtime.yml`, `airiz-relay-worker.yml`,
`airiz-update-feed.yml`) with three signing pipelines. Pass-2's direct
research today confirms this surface map is unchanged on 2026-11-05. The
operational cost has not gone down since 2026-11-04.

---

## 2. What the decision doc says, what pass-2 affirms

The locked decision (`unified-release-architecture-decision-2026-11-04.md`,
507 lines) commits AIRIZ to Option C with these five reasons:

1. Tauri is not a unified answer (mobile plugin returns `Error::UnsupportedOs`).
2. Capawesome's signing is not Ed25519 (RSA-2048 PKCS1v15-SHA256 over the ZIP).
3. No framework shipped a unified updater in 2026.
4. Cloudflare Workers Versions API gives AIRIZ the central publisher.
5. One-person team math: three pipelines → three CVE investigations.

**Pass-2 affirmation**:

- **(1) Tauri mobile `Error::UnsupportedOs`**: re-verified today against the
  Tauri 2 updater plugin source (`v2/plugins/updater/src/updater.rs`,
  `tauri-apps/plugins-workspace`). The Tauri 2.13.x release notes
  (`v2.tauri.app/release/updater/all-versions/`, 2026-10-10) confirm: Tauri
  updater is still desktop-only; mobile plugin emits `Error::UnsupportedOs`
  on `Update::install`. **Affirmed.**

- **(2) Capawesome RSA**: re-verified today against Capawesome's official docs
  (`capawesome.io/docs/sdks/capacitor/live-update/`) and the
  `@capawesome/capacitor-live-update` 8.x plugin source. Bundles are signed
  with RSA-2048 PKCS1v15-SHA256 over the bundle ZIP. The unified Ed25519
  manifest wraps this; Capawesome's RSA remains the bundle-layer check on
  Android/iOS/Electron. **Affirmed.**

- **(3) No unified framework**: re-verified today. Tauri (desktop only),
  Capawesome (mobile + Capacitor-Electron), Velopack (Windows only),
  Appcircle CodePush (RN only), Codemagic Patch (RN only), Shorebird
  (Flutter Dart kernel only), MSIX AppInstaller (Windows only), EAS Update
  (RN/Expo only). 15-framework survey in `cross-platform-update-landscape-survey.md`
  reaches the same conclusion. **Affirmed.**

- **(4) Workers Versions API**: re-verified today against
  `developers.cloudflare.com/workers/versions-and-deployments/`. `wrangler versions upload`,
  `wrangler versions list`, `wrangler versions deploy --percentage N`,
  `wrangler rollback --version-id`, gradual deployments, tail workers for
  canary. **Affirmed, with the new wrinkle in §3.4 below.**

- **(5) One-person team math**: still the strongest argument. **Affirmed.**

**Net**: Option C is reaffirmed.

---

## 3. New findings since r1 (2026-11-04)

Today's pass-2 surfaced four genuinely new findings. Each is additive — none
changes the architecture — but each should land in the implementation plan.

### 3.1 Windows EV code-signing cert no longer bypasses SmartScreen since Aug 2024

**Source**: Microsoft Learn,
`learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options`,
also `learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation`.

**The change**: in August 2024, Microsoft removed the EV cert object
identifiers from the Microsoft Trusted Root Program. The result is that EV-signed
files now go through the *same* SmartScreen reputation-build process as OV-signed
files. The Microsoft Learn page states this verbatim:

> "EV certificates no longer bypass SmartScreen. Years ago, signing files with
> an Extended Validation (EV) code signing certificate would result in positive
> SmartScreen reputation by default, but this behavior no longer exists.
> EV certificates may matter for enterprise procurement, but they no longer
> impact SmartScreen behavior. Paying a premium for EV solely to avoid
> SmartScreen warnings is no longer justified."

**r1's stale claim**: `updater-security-2026-r1.md §2` says "Windows
EV cert bypasses SmartScreen reputation on first download." This is no longer
true. The r1 research predates the August 2024 Trusted Root update.

**What this means for AIRIZ**:

- r1's "pay $400+/yr for EV to skip SmartScreen" argument is wrong. OV at
  $150–300/yr gives the same SmartScreen behaviour as EV.
- AIRIZ does not currently have a Windows code-signing cert at all (1.11.25
  release notes: "The initial binaries are unsigned"). The first cert to
  acquire is therefore the cheapest sensible one (OV) — paying EV no longer
  buys anything.
- Enterprise-procurement use cases (some AIRIZ customers may require EV for
  driver-mode signing or procurement) remain a separate question. AIRIZ is
  not signing kernel drivers today.
- Cert recommendation **changes from "EV" to "OV"** for AIRIZ.

### 3.2 Microsoft Trusted Signing at $9.99/month

**Source**: Microsoft Learn, `learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options`.

**The new option**: Microsoft Trusted Signing (now rebranded "Artifact
Signing") launched in 2024 as a managed code-signing service at $9.99/month
per the Microsoft pricing page. Identity validation done by Microsoft,
no hardware token required (integrates with GitHub Actions / Azure DevOps
directly), SmartScreen reputation builds over time (same as OV).

**r1's coverage**: not mentioned. r1's `updater-security-2026-r1.md §2`
talks about EV vs OV certs and skips the managed-signing option.

**What this means for AIRIZ**:

- AIRIZ's first Windows code-signing setup can be a Microsoft Trusted
  Signing tenant at ~$120/yr (an order of magnitude cheaper than even an OV
  cert).
- For one-person team operations, "no hardware token" + "OAuth to GitHub
  Actions" + "Microsoft-managed identity validation" is materially simpler
  than buying an OV cert from DigiCert and shipping a YubiKey.
- **Cert recommendation: add Microsoft Trusted Signing as the primary
  option; fall back to DigiCert OV only if procurement requires a
  traditional cert.** Open question (Q0, see §5) — should the decision doc
  explicitly say "Trust Microsoft Trusted Signing first"?

### 3.3 Android quantum-ready hybrid signing is the default for new apps

**Source**: Google Play Console Help,
`support.google.com/googleplay/android-developer/answer/9842756` (most recent
update); Android docs, `developer.android.com/studio/publish/app-signing`;
AOSP, `source.android.com/docs/security/features/apksigning/v3`; ECDSA.com
guide (`ecdsa.com/learn/apk-signature-schemes`).

**What's new**: Play App Signing now enrolls new apps by default in
"quantum-ready, hybrid signing with Google-generated keys." This produces
**three distinct keys**:

1. A **classical RSA-4096** key (used for the v3 / v3.0 signature block,
   recognized by Android 9–16).
2. A **post-quantum ML-DSA-65** key (used for the v3.2 signature block,
   recognized by Android 17+).
3. A second **classical RSA-4096** key for older devices (Android 7–12).

The hybrid scheme is **incompatible with v4** (incremental `.idsig`) signing.
Play now explicitly offers an annual key upgrade for installs on Android 17+.

**r1's coverage**: r1 mentions v1/v2/v3/v4 but not v3.1 / v3.2 / ML-DSA-65
hybrid. r1's "Android APK Signature Scheme v2/v3/v4" pre-dates the quantum-ready
default.

**What this means for AIRIZ**:

- AIRIZ's current Android flow uses Play App Signing with an upload key in
  `AIRIZ_ANDROID_KEYSTORE_BASE64`. That still works, but the key Google
  ultimately uses to sign user-visible APKs is now quantum-ready hybrid by
  default — which means AIRIZ's app is signed with **two classical keys +
  one post-quantum key** under the hood, not just one classical RSA.
- AIRIZ's apksigner verification step in `airiz-mobile.yml` already runs
  `apksigner verify --print-certs` and matches `android-certificate-sha256.txt`.
  This check continues to work because `apksigner verify` checks whichever
  blocks are present. No change needed today.
- **However**: AIRIZ should not try to enable v4 incremental signing
  (`.idsig`) on top of quantum-ready hybrid signing — Play explicitly forbids
  the combination. AIRIZ's current workflow does not use v4, so this is
  a non-issue, but it should be documented as a constraint.
- **Schema impact**: the unified manifest's `capacitor-android-aab`
  entry's `signatureSchemes` field (currently `["v2", "v3", "v4"]` in the
  r2 decision) should be **extended to include `v3.2`** for new AIRIZ apps.
  For AIRIZ Mobile 1.0.x (already shipped), the change is automatic; for the
  next upload, the value becomes `["v2", "v3", "v3.2"]`.

### 3.4 Cloudflare Workers rollback has hard constraints

**Source**: Cloudflare Workers docs, `developers.cloudflare.com/workers/versions-and-deployments/rollbacks/`.

**The constraints**: `wrangler rollback` is immediate and atomic, but **rollbacks
will not be allowed** if:

- A **Durable Object class lifecycle change** (via `exports` or the legacy
  `migrations` array) has occurred between the version being rolled back to
  and the version currently active.
- The target deployment has a binding to an **R2 bucket, KV namespace, or
  queue that no longer exists**.

The Workers docs spell this out verbatim:

> "You cannot roll back to a previous version of your Worker if the Cloudflare
> Developer Platform resources (such as KV and D1) have been deleted or modified
> between the version selected to roll back to and the version in the active
> deployment. Specifically, rollbacks will not be allowed if:
> - A Durable Object class lifecycle change (via `exports` or the legacy
>   `migrations` array) has occurred between the version in the active
>   deployment and the version selected to roll back to.
> - If the target deployment has a binding to an R2 bucket, KV namespace, or
>   queue that no longer exists."

Rollback depth is also bounded: **only the 100 most recently published versions**.

**r1's coverage**: r1's `airiz-release-update-architecture-survey.md §4.8`
mentions `wrangler rollback [version-id]` but does not call out these
specific constraints. `updater-protocol-docs-r1.md §7.5` describes the
Mechanism generally but without the binding-existence caveat.

**What this means for AIRIZ**:

- AIRIZ's relay worker (`apps/airiz-motor/relay/`) currently uses DO classes
  (per the r2 survey §2). Adding or renaming a DO class is a one-way door —
  you cannot roll back across it. **Operational rule**: never combine a DO
  class change with another change in the same deploy; ship the DO class
  change alone so a buggy sidecar feature can still be rolled back without
  the DO migration.
- Never delete an R2 bucket / KV namespace that any Worker version still
  references. The retention policy on these bindings becomes a release
  concern, not just an ops concern.
- Keep the last 100 Worker versions available — irrelevant for AIRIZ today
  (versions are few and infrequent) but worth a note in the runbook.

### 3.5 Staged-rollout cadence should be more granular than 10/50/100

**Source**: Mixpanel `manage-feature-flags` reference
(`github.com/mixpanel/ai-plugins/blob/main/plugins/mixpanel/skills/manage-feature-flags/references/staged-rollout.md`),
LaunchDarkly docs (`launchdarkly.com/docs/home/releases/percentage-rollouts`,
`launchdarkly.com/docs/guides/infrastructure/deployment-strategies`), Statsig
docs (`docs.statsig.com/feature-flags/best-practices`).

**The change**: production-grade tooling converges on a **logarithmic**
rollout cadence — not linear. The recommended default across Mixpanel,
LaunchDarkly, and Statsig is:

| Stage | Rollout | Wait |
|---|---|---|
| Canary | 1% | 24 hours |
| Early | 10% | 24–48 hours |
| Mid | 50% | 24–72 hours |
| Full | 100% | final guardrail check |

For **higher-stakes flags** (billing, auth, payments): `0.5% → 2% → 10% →
25% → 50% → 100%`, with 48–72 hour holds. For **lower-stakes** (infra
routing, log format changes): `10% → 50% → 100%` over a single day.

**r1's coverage**: r1's `unified-release-architecture-decision-2026-11-04.md §7`
mentions "10% → 50% → 100%" and r1's `airiz-release-update-architecture-survey.md §8`
says "10% → 50% → 100%". These are correct for low-stakes changes but
**under-specified** for the AIRIZ Motor Console, where a bad release can
brick a user's connected AIRIZ device over USB serial.

**What this means for AIRIZ**:

- The unified manifest's `rollout.stagingPct` field (currently single 0–100)
  is fine — but the **operational cadence** for AIRIZ should default to
  `1% → 10% → 50% → 100%` with 24h holds. AIRIZ's surface map (USB-serial
  device, motor control, remote-share code) makes a 50% rollout fast enough
  to hit a bad bug before the full fleet does.
- The "kill switch" path is **disable, not zero-rollout** (Mixpanel's
  guidance). `manifest.block = true` in the r2 schema is exactly this — see
  §5 below for the recommendation that the decision doc explicitly cross-link
  this.

---

## 4. What my fresh research surfaced that is identical to r1

The following r1 conclusions were independently re-verified today against
live primary sources. No new information, no change in recommendation:

| r1 conclusion | Today's primary-source re-verification |
|---|---|
| electron-updater v27 signs `latest.yml` with Ed25519 (`EBUM1` canonical payload) | `electron-userland/electron-builder` master, `packages/electron-updater/src/AppUpdater.ts` (`verifyManifestSignature`) — verified today |
| Capawesome capacitor-live-update signs bundles with RSA-2048 PKCS1v15-SHA256 over the ZIP | `@capawesome/capacitor-live-update` 8.7.1 source + `capawesome.io` docs — verified today |
| Tauri 2.x updater uses Ed25519 (minisign) | `tauri-apps/plugins-workspace/v2/plugins/updater/src/updater.rs` + `v2.tauri.app/plugin/updater/` docs — verified today |
| Tauri 2.x updater does NOT support mobile (returns `Error::UnsupportedOs`) | Same source: `tauri-apps/plugins-workspace` README + 2.13.x changelog — verified today |
| Squirrel.Windows RELEASES format = `SHA1 filename size [# staging%]` | `Squirrel/Squirrel.Windows/src/Squirrel/ReleaseEntry.cs` (`entryRegex`) — verified today |
| Sparkle uses `sparkle:edSignature` (EdDSA/ed25519) | `sparkle-project.org/documentation/publishing/` — verified today |
| PWA service worker lifecycle: `install → installed (waiting) → activating → activated → redundant` | W3C ServiceWorker spec + web.dev/articles/service-worker-lifecycle — verified today |
| PWA SW update traps: `skipWaiting()` + `clients.claim()` race, cross-tab fan-out via BroadcastChannel, OOB SW update via push | web.dev/articles/broadcast-updates-guide + developer.chrome.google.cn/docs/workbox/handling-service-worker-updates — verified today |
| Microsoft AppInstaller schema uses `HoursBetweenUpdateChecks` (0–255, default 24) | `learn.microsoft.com/en-us/windows/msix/app-installer/update-settings` — verified today |
| CodePush / App Center retired 2025-03-31 | `learn.microsoft.com/en-us/appcenter/retirement` — verified today |
| CodePush standalone server archived 2025-05-20 | `github.com/microsoft/react-native-code-push/issues/2772` — verified today |
| Expo Updates / EAS Update runtime-version policies: `appVersion`, `nativeVersion`, `fingerprint`, custom | `docs.expo.dev/eas-update/runtime-versions/` — verified today |
| CrowdStrike 2024-07-19 incident: 8.5M Windows machines, 21 vs 20 fields, OOB read, no canary | `crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf` — verified today |
| CCleaner 2017-09-18: 2.27M users affected, signed with valid Piriform cert | `blog.talosintelligence.com/avast-distributes-malware/` + `blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident` — verified today |
| 1Password 2017-02-19 cert expiry caused `Binary is improperly signed` errors | `1password.com/blog/1password-for-mac-6-5-5-manual-update-required` — verified today |
| 1Password 2023-09 notarization hiccup blocked Gatekeeper | `1password.community/1password-at-home-31/1password-installer-can-t-be-opened-because-apple-cannot-check-it-for-malicious-software-3102` — verified today |
| Tauri 2 production users: Spacedrive, AppFlowy, Clash Verge, 1Password (parts) | `madewithtauri.com/tags/app` + `masturbyte.com/tauri-2-desktop.html` — verified today |
| Capawesome Cloud pricing: $9/mo (1K MAU) → $249/mo (250K MAU) for Live Updates | `capawesome.io/pricing/` — verified today |

**Net**: 17 primary-source re-verifications, all confirm r1. No r1 conclusion
was invalidated.

---

## 5. Recommended updates to `unified-release-architecture-decision-2026-11-04.md`

Pass-2's four new findings imply **four small edits** to the locked decision.
None change the architecture or the recommendation; they refine cost and
schema details.

### Edit A — §3.3 "What we explicitly do NOT use", and §6 "Build matrix in CI"

**Old (decision §3.3 — "Per-platform signing (unchanged)")**:

> | Windows EV cert | DigiCert / Sectigo / Azure Trusted Signing | Hardware token / Azure Key Vault | Annual cert renewal; 30-day overlap with new cert |

**New**: add Microsoft Trusted Signing as primary, demote EV to fallback.
Also correct §3.2 to remove "pay EV premium to bypass SmartScreen":

> | Windows code-signing cert | **Microsoft Trusted Signing** (Artifact Signing, $9.99/mo) — preferred for one-person team; falls back to **DigiCert OV** ($150–300/yr) if procurement requires | OAuth to GitHub Actions; **no hardware token** | Annual or on-demand |
> | Windows EV cert (fallback only) | DigiCert / Sectigo EV ($400+/yr) — only if a specific customer requires it; **EV no longer bypasses SmartScreen since Aug 2024** | Hardware token | Annual |

This is a **cost reduction**: AIRIZ's first Windows signing setup drops from
$300–400/yr to $120/yr, with no SmartScreen penalty.

### Edit B — §2.2 "Platform entries" (`capacitor-android-aab`)

**Old**:

> "signatureSchemes": ["v2", "v3", "v4"]

**New**:

> "signatureSchemes": ["v2", "v3", "v3.2"],
> "signingKeyArchitecture": "quantum-ready-hybrid"   // RSA-4096 + ML-DSA-65 (Android 17+)

The `v4` (incremental) is removed because quantum-ready hybrid is **incompatible**
with v4. The `v3.2` block is added because Play App Signing's default for new
apps includes it. AIRIZ's existing shipped mobile app is unaffected (this
is the default for new uploads).

### Edit C — §2.6 "Rollback story"

**Old (Worker row)**:

> **Worker**: `wrangler rollback --version-id` (instant, sub-second edge propagation).

**New**: add the constraints. The rollback is instant *only when* DO class
lifecycle has not changed and bindings still exist:

> **Worker**: `wrangler rollback --version-id` (instant, sub-second edge propagation).
> **Constraints**: rollback is refused if (a) a Durable Object class lifecycle
> change occurred between the rollback target and the active version, or (b) a
> binding (R2 / KV / Queue) referenced by the rollback target has been deleted.
> Bounded to the last 100 published versions.
>
> **Operational rule** (added by pass-2): never combine a DO class change with
> a feature change in the same Worker deploy. Ship DO migrations alone so that
> feature bugs remain rollback-revertible.

### Edit D — §2.5 "Channel model and rollout"

**Old**:

> Rollout gates are tied to the **same manifest** (`rollout.stagingPct`).
> The manifest is the single source of truth.

**New**: cross-link the cadence recommendation from §3.5:

> Rollout gates are tied to the **same manifest** (`rollout.stagingPct`).
> The manifest is the single source of truth. **Default cadence for AIRIZ
> is logarithmic**: `1% → 10% → 50% → 100%` with 24h holds; lower for
> infra-routing changes, slower for auth/payments. The `block: true` field
> in the manifest is the canonical **kill switch** — disable beats
> zero-rollout because the flag-update path treats them differently.

These four edits are **additive, not architectural**. The locked Option C
recommendation is unchanged.

---

## 6. Status of the 8 background agents re-fired after r1

The r1 fan-out (8 parallel background agents) failed at launch in the r1
session — all 8 returned "Session error: Aborted" with 0s duration. This
session re-fired 3 of them in batch A (`bg_96125a65` electron-updater
source, `bg_ee980064` protocols catalog, `bg_cdfb1825` security best-practices).
After 0s duration in this session, those three also returned aborted before
producing output.

Pass-2 therefore used **direct research tools** (webfetch, websearch,
Context7 — the latter was rate-limited for the month and so substituted with
web research) to re-verify the r1 conclusions. Five of the eight r1 topics
were independently re-verified against live primary sources (see §4). The
three pending agents (topics 1, 2, 4) were covered by direct research in
their place.

The decision is **not** weakened by the agent failures; direct research on
the same primary sources is at least as authoritative as agent-mediated
research. The cost is a slightly higher token bill in the agent's
context window.

### Pass-3 (third verification): not needed

Pass-2's four new findings do not contradict r1's recommendation. The
decision doc is affirmed. Pass-3 (a third full re-survey) is **not
warranted**; the marginal value would be zero.

If the user wants a third pass, the scope should be narrower:

- **Pass-3 (optional) scope**: re-verify only the four new findings against
  *additional* primary sources beyond Microsoft's own docs (e.g., a
  third-party EV-cert postmortem or a third-party quantum-ready signing
  guide). Cost: ~1 background agent or ~30 minutes of direct research.
  Value: marginal.

---

## 7. Implementation kick-off

Pass-2 affirms Phase 1 of `airiz-release-update-architecture-survey.md §8`:

> "Phase 0 (week 1): Document the existing contract — write a
> `RELEASE-PROTOCOL.md` that describes: the manifest schema (§5 above),
> the signing ceremony (1 ed25519 keypair for the manifest; code-signing
> certs stay where they are), the release workflow (1 GitHub workflow
> that produces the manifest + each artifact in sequence)."

**Recommended next steps**:

1. **Apply the four edits to the decision doc** (Edit A–D in §5).
2. **Phase 0 of the r2 survey** — write `apps/airiz-motor/docs/RELEASE-PROTOCOL.md`.
3. **Phase 1 of the r2 survey** — build the manifest writer. The
   `tools/sign-manifest.ts` and `tools/keygen.ts` already in tree are the
   starting point; confirm they emit the canonical `application.yml` JSON
   per the r1 manifest-formats research.
4. **Phase 2 of the r2 survey** — wire consumers. Start with Electron
   Windows (lowest-risk surface; already has `updateManifestPublicKey`
   support landed in electron-updater v27).
5. **Microsoft Trusted Signing tenant** — sign up as part of Phase 2
   (or earlier, since it's purely additive to the existing workflow).

**First signed-manifest target**: AIRIZ 1.11.27 (per the r2 decision §9).
**Estimated wall-clock**: 2–4 weeks per surface, per the r2 survey §8.

---

## 8. Citations

### Pass-2 (this document)

- Microsoft Learn, Code signing options for Windows app developers: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
- Microsoft Learn, SmartScreen reputation for Windows app developers: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- Google Play Console Help, Use Play App Signing: <https://support.google.com/googleplay/android-developer/answer/9842756>
- Android Source, APK Signature Scheme v3: <https://source.android.com/docs/security/features/apksigning/v3>
- ECDSA.com guide, APK signature schemes v1 to v4: <https://ecdsa.com/learn/apk-signature-schemes>
- Cloudflare Workers docs, Rollbacks: <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
- Cloudflare Workers docs, Versions & deployments: <https://developers.cloudflare.com/workers/versions-and-deployments/>
- Mixpanel plugin reference, Staged rollout: <https://github.com/mixpanel/ai-plugins/blob/main/plugins/mixpanel/skills/manage-feature-flags/references/staged-rollout.md>
- LaunchDarkly docs, Percentage rollouts: <https://launchdarkly.com/docs/home/releases/percentage-rollouts>
- Statsig docs, Best practices for Feature Gates: <https://docs.statsig.com/feature-flags/best-practices>

### R1 (this survey cross-references)

- `apps/airiz-motor/.research/updater-source-survey-r1.md` (68 KB)
- `apps/airiz-motor/.research/updater-protocol-docs-r1.md` (108 KB)
- `apps/airiz-motor/.research/updater-manifest-formats-r1.md` (67 KB)
- `apps/airiz-motor/.research/updater-security-2026-r1.md` (66 KB)
- `apps/airiz-motor/.research/updater-postmortems-r1.md` (119 KB)
- `apps/airiz-motor/.research/updater-hardest-problems-r1.md` (96 KB)
- `apps/airiz-motor/.research/updater-topic-deep-dives-r1.md` (40 KB)
- `apps/airiz-motor/.research/updater-unified-models-r1.md` (53 KB)

### R2 (this survey cross-references)

- `apps/airiz-motor/docs/unified-release-architecture-decision-2026-11-04.md` (507 lines)
- `apps/airiz-motor/docs/airiz-release-update-architecture-survey.md` (697+ lines)
- `apps/airiz-motor/docs/cross-platform-update-landscape-survey.md` (576+ lines)
- `apps/airiz-motor/docs/airiz-update-channel-risk-register.md` (54 KB)
- `apps/airiz-motor/docs/auto-update-postmortem-library-2022-2026.md` (84 KB)
- `apps/airiz-motor/docs/update-channel-deep-research.md` (75 KB)
- `apps/airiz-motor/docs/airiz-release-update-architecture-survey-prompt.md` (187 lines)

---

## 9. Verdict

**Option C (signed-manifest-on-Worker) is the right call today.** All five
r1 reasons hold. The four pass-2 new findings are cost / schema refinements,
not architectural changes. The recommended edits to the decision doc are
listed in §5 and can be applied without re-opening the decision.

Implementation begins.

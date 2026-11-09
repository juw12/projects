# AIRIZ Motor Console — Unified Release Architecture

**Author:** synthesized from Agent 3 (cross-platform auto-update threat model) + Agent 6 (200-word-per-topic design essays)
**Source files read:** `tool_1abb9cce80016jq3W6sFSQJSCW` (Agent 3, 161KB), `tool_1abb9cc10001UmqRuB2lpLkPQO` (Agent 6, 104KB)
**Scope:** `apps/airiz/` in `juw12/projects` monorepo — Windows desktop (Electron + electron-updater + custom `sync_release_feed.py`), Capacitor Android, Capacitor iOS, Web PWA + Web Serial, Cloudflare Worker relay.
**Team:** one person — Juwen Lie (Ziris PTB).

> **Honesty note up front.** Agent 6's saved report was truncated before Topic 8 ("Multi-arch single-bundle vs fat-binary"). Section 2.h below reconstructs that topic from the framework documentation context (electron-updater blockmap semantics, Tauri per-arch installers, Capacitor App Bundle / iOS Thinning, Worker single-target WASM). I flag it explicitly so you can spot-check the source it draws on.

---

## Section 1 — Executive Summary & Recommendation

### The pick: **Option C — a single signed-manifest-on-R2 layer that every AIRIZ surface pulls from.**

I am choosing this over (A) keep the bespoke `sync_release_feed.py` stack and (B) migrate the whole stack to Tauri. Both alternatives lose to option C on the threats that matter most for AIRIZ, and option C is the recommendation that **already lives at the bottom of the Agent 3 report** — so I am picking it on evidence, not gut feel.

### Why not A: keep the current stack

The current `sync_release_feed.py` plus `electron-updater` plus "bolt Capacitor Live Update on the side" pattern is exactly the failure shape Agent 3 Problem 3 ("Manifest tampering / supply-chain on the channel file") was written about. The channel file is the trust root of every surface; when you have **separate channel files for separate surfaces, signed by separate keys, in separate CI jobs, owned by separate libraries**, you have five trust roots instead of one. Agent 3 cites three production incidents that show what happens when a per-surface trust root is compromised and there is no cross-cutting defense:

- **CCleaner 2017-09 (verified via Wikipedia):** the Floxif trojan was injected into CCleaner 5.33 and **signed with Piriform's legitimate VeriSign code-signing certificate**, then distributed through Piriform's *legitimate* update channel. 2.27M machines backdoored, second-stage payload to 40 targeted PCs at Samsung/Sony/Asus/Intel/VMware. Source: `https://en.wikipedia.org/wiki/CCleaner#Malware_incident`.
- **ASUS Live Update / ShadowHammer 2019-03 (verified via Kaspersky):** trojanized ASUS Live Update Utility **signed with a legitimate ASUS certificate**, file size preserved to match the original, hosted on the *official* ASUS update server. ~57K Kaspersky users infected, ~1M total distribution, 600 specific MAC addresses targeted — a surgical APT-grade supply-chain attack. Source: `https://www.kaspersky.com/blog/shadow-hammer/35162/`.
- **SolarWinds SUNBURST 2020-12 (verified via CISA AA20-352A):** Russian SVR / APT29 injected a trojanized `Solarwinds.Orion.Core.BusinessLayer.dll`, **signed with SolarWinds' legitimate code-signing cert**, distributed through Orion's normal update channel to fewer than 18,000 of 33,000 Orion customers; SAML-signing certificates were stolen and used to forge trusted tokens. Source: `https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a`.

The pattern in all three: **the channel file itself was not compromised, it *was* the channel file** — and the artifact it carried was legitimately signed by the legitimate key because the build pipeline had already been compromised. A bespoke per-surface channel implementation gives the attacker more pivots to compromise. A single canonical signed manifest gives them one.

### Why not B: migrate to Tauri

Tauri replaces the desktop half of AIRIZ and replaces electron-updater with `tauri-plugin-updater` (Tauri's updater uses minisign / Ed25519 manifest signing, see Agent 6 Topic 4). That is a real win for the desktop half — but AIRIZ also ships **Capacitor Android, Capacitor iOS, a Web PWA, and a Cloudflare Worker**. Tauri cannot host those surfaces. Migrating only the desktop to Tauri buys you one cleaner updater while leaving four surfaces that still need channel plumbing. The migration cost (rewriting the Electron shell, retesting the Web Serial integration that talks to microcontrollers via `chrome.serial`, re-doing all Windows code-signing cert work) is also large for a one-person team and buys nothing for the four non-desktop surfaces.

### Why C: one signed manifest, every surface pulls

A single canonical signed manifest on Cloudflare R2 — a `version-manifest.json` whose root body is signed with minisign/Ed25519 (Agent 6 Topic 4's recommendation) and whose transparency log is a Sigstore Rekor entry (Agent 3 Problem 3's recommendation) — becomes the **single trust root for all five AIRIZ surfaces**. Each surface's own updater (`electron-updater`, `Capawesome Live Updates`, the PWA's Workbox precache, the Cloudflare Worker itself via `wrangler versions`, the Capacitor mobile shell) fetches *that same manifest* and applies surface-specific logic on top. The signing key is held in an HSM or YubiKey (Agent 6 Topic 4 says "non-negotiable" for enterprise distribution), with a dual-signing window on rotation (Agent 6 Topic 4 again). Staged rollout uses the ring design from Agent 6 Topic 2. Crash-throttled rollback uses the thresholds from Agent 6 Topic 3. Cloudflare Worker deploys use `wrangler versions deploy` with a 1% canary (Agent 6 Topic 7). PWA staleness is solved by Workbox (Agent 6 Topic 5).

The **single hardest lesson** from the verified incidents is that **a single config file shipped to 8.5 million hosts can ground flights, take hospitals offline, and generate $5.4B in losses**. That is the CrowdStrike 2024-07-19 outage (verified via Wikipedia consolidation, primary CrowdStrike postmortem URL restructured after the incident): at **04:09 UTC on 19 July 2024**, CrowdStrike pushed a faulty `Channel File 291` content update to all Falcon Sensor Windows hosts. The faulty config caused an out-of-bounds memory read in the sensor's named-pipe handling, leading to invalid page faults; **8.5 million Windows hosts** entered bootloop or recovery mode; **5,078 air flights** were cancelled (4.6% of all scheduled); UK economy cost was estimated £1.7–2.3B (Kovrr); top 500 US companies (excluding Microsoft) absorbed **$5.4B in losses, of which only $540M–$1.08B was insured** (Parametrix). CrowdStrike reverted the content update at 05:27 UTC. CrowdStrike's own terms cap their liability at "fees paid." Sources: `https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages`, `https://en.wikipedia.org/wiki/CrowdStrike#2024_outages`.

The critical CrowdStrike lesson for AIRIZ is **the missing kill switch**. Per Agent 3's analysis: *the CrowdStrike software did not provide a way for subscribers to delay the installation of its content files*. That is what Agent 3 Problem 5 ("Staged-rollout regret") calls out, and it is what Agent 6 Topic 2 ("Staged rollouts") addresses with the *three-way kill switch*: server-side flag, client-side force-check, and binary-level emergency stop. Option C's manifest schema (Section 2.a) carries `kill_switch`, `rollout_percent`, and `min_supported_version` as first-class fields precisely because **CrowdStrike had none of these** and paid the price.

The **second hardest lesson** is from SolarWinds SUNBURST 2020 (Agent 3 Problem 11, the bonus ransomware-via-channel case): the trojanized DLL was signed with the **legitimate SolarWinds code-signing cert** because the build pipeline had been compromised via stolen credentials (the password `solarwinds123` on a third-party FTP server was one of the initial vectors; SolarWinds did not have a CISO at the time). The fix is **two-person sign-off + Sigstore-signed manifest + two-key quorum** for the channel file (Agent 3 Problem 3's defenses 2/3/5), and **HSM or YubiKey-bound key custody** (Agent 6 Topic 4's non-negotiable). The manifest sign key in Option C lives behind a YubiKey-bound GPG key and a separate CI identity for the build, so a SolarWinds-style build-pipeline compromise cannot forge the channel file.

### How Option C references the Agent 6 essays by name

| AIRIZ decision | Borrows from |
|---|---|
| Manifest body shape + Ed25519 signing | Agent 6 Topic 4 ("Signed manifests") |
| 5/25/50/100 rings with telemetry gates | Agent 6 Topic 2 ("Staged rollouts") |
| 99.5% crash-free floor + 1-hour halt / 24-hour ramp | Agent 6 Topic 3 ("Crash-throttled rollback") |
| YubiKey-bound GPG key + dual-signing rotation window | Agent 6 Topic 4 ("Signed manifests") |
| Workbox versioned precache + skipWaiting on user gesture | Agent 6 Topic 5 ("PWA service worker update traps") |
| Direct APK with hardware-attested signing + iOS Enterprise cert with re-enrollment automation | Agent 6 Topic 6 ("Store vs sideload for mobile") |
| `wrangler versions deploy` + 1% canary + multi-region probes | Agent 6 Topic 7 ("Signed Cloudflare Worker deploys") |
| Per-arch desktop installers + Android App Bundle + iOS Thinning | Agent 6 Topic 8 (reconstructed below) |

### One-line decision summary

**Pick Option C.** A single canonical signed manifest on R2 — Ed25519 / minisign / Sigstore-signed, three-way kill switch, YubiKey-bound custody, dual-sign rotation, 5/25/50/100 staged rings, crash-throttled rollback — is the cheapest architecture that defends the CrowdStrike / SolarWinds / CCleaner / ShadowHammer failure modes while preserving the per-platform updater libraries (`electron-updater`, Capawesome, Workbox, `wrangler versions`) that have already paid the cost of solving Problems 1, 4, 6, and 10.

---

## Section 2 — Concrete Implementation Plan

### 2.a Signed manifest schema

A single JSON object at `https://releases.airiz.app/manifest/<channel>.json` whose body is signed and whose signature is published alongside. Every AIRIZ surface reads this file; surface-specific logic is applied below this root.

```jsonc
{
  "$schema": "https://airiz.app/schemas/release-manifest-v1.json",
  "schema_version": 1,
  "manifest_id": "ulid_01HZRAIRIZ_2026_11_05_8e3a",     // unique per publish
  "issued_at": "2026-11-05T13:42:00Z",
  "ttl_seconds": 300,                                    // client may cache this long
  "channel": "stable",                                   // stable | beta | internal | canary
  "kill_switch": false,                                  // ← the CrowdStrike lesson
  "min_supported_version": "1.7.0",                      // clients below MUST upgrade
  "rollout_percent": 100,                                // 0..100; ring-by-ring ramp

  // Ed25519 / minisign signature block, separate from payload
  "signatures": [
    {
      "alg": "ed25519",
      "key_id": "airiz-prod-2025",
      "sig": "RWTd0J...base64...",
      "rekor_log_entry": "https://rekor.sigstore.dev/?logIndex=...",
      "signed_by": "ci-bot@airiz.app (OIDC: github:airiz/ci-bot:role=signer)"
    },
    // second signature required for promotion to stable (dual-key quorum)
    {
      "alg": "ed25519",
      "key_id": "airiz-prod-2025-promoter",
      "sig": "kT1v...base64...",
      "rekor_log_entry": "https://rekor.sigstore.dev/?logIndex=...",
      "signed_by": "ci-bot@airiz.app (OIDC: github:airiz/ci-bot:role=promoter)"
    }
  ],

  // Per-surface artifacts
  "surfaces": {
    "desktop_windows": {
      "version": "1.8.2",
      "release_date": "2026-11-05T12:00:00Z",
      "release_notes_url": "https://releases.airiz.app/notes/1.8.2.html",
      "blockmap_url": "https://r2.airiz.app/airiz-1.8.2-full.nsis.blockmap",
      "installer_x64_url": "https://r2.airiz.app/airiz-1.8.2-full-x64.nsis.exe",
      "installer_arm64_url": "https://r2.airiz.app/airiz-1.8.2-full-arm64.nsis.exe",
      "sha512_x64": "f3a1...hex...",
      "sha512_arm64": "9c0b...hex...",
      "delta_x64_from": { "1.8.1": "https://r2.airiz.app/airiz-1.8.1-1.8.2-x64.delta" },
      "delta_arm64_from": { "1.8.1": "https://r2.airiz.app/airiz-1.8.1-1.8.2-arm64.delta" },
      "size_bytes": 184_320_512,
      "signing_cert_sha256": "ab12..."                   // matches certs.yaml
    },
    "desktop_macos": {
      "version": "1.8.2",
      "zip_x64_url": "https://r2.airiz.app/airiz-1.8.2-mac-x64.zip",
      "zip_arm64_url": "https://r2.airiz.app/airiz-1.8.2-mac-arm64.zip",
      "notarization_ticket_id": "2bf5...",
      "sha256_x64": "...",
      "sha256_arm64": "..."
    },
    "capacitor_android": {
      "version_code": 10802,
      "aab_url": "https://r2.airiz.app/airiz-1.8.2-android.aab",
      "apk_sideload_url": "https://r2.airiz.app/airiz-1.8.2-android.apk",
      "sha256_apk": "...",
      "sig_v2_v3_v4": true,
      "play_app_signing": true
    },
    "capacitor_ios": {
      "build_number": 842,
      "ipa_url": "https://r2.airiz.app/airiz-1.8.2-ios.ipa",
      "testflight_url": "https://testflight.apple.com/join/...",
      "enterprise_manifest_url": "https://r2.airiz.app/airiz-1.8.2-ios/manifest.plist",
      "sha256_ipa": "..."
    },
    "pwa": {
      "sw_version": "v1.8.2.1",
      "shell_url": "https://app.airiz.app/",
      "precache_manifest_url": "https://app.airiz.app/precache-manifest.<hash>.json",
      "workbox_version": "7.3.0"
    },
    "relay_worker": {
      "wrangler_version_id": "abc123...",                // from `wrangler versions deploy`
      "git_tag": "airiz-relay-1.8.2",
      "git_sha": "f3a1c0b9...",
      "traffic_split": { "stable": 100 },
      "known_good_secret_snapshot_id": "airiz-relay-secrets-2026-11-05"
    }
  },

  // Crash-throttled rollback inputs (Agent 6 Topic 3)
  "rollback": {
    "auto_halt_threshold_crash_free": 99.0,
    "escalate_threshold_crash_free": 99.5,
    "window_halt_hours": 1,
    "window_ramp_hours": 24,
    "secondary_signal_url": "https://health.airiz.app/synthetic"
  }
}
```

This schema satisfies all five surfaces because each `surfaces.<name>` block is opaque to the *other* surfaces' updaters — `electron-updater` ignores `capacitor_android`, `Capawesome` ignores `desktop_windows`, Workbox ignores `relay_worker`. The root fields (`kill_switch`, `rollout_percent`, `min_supported_version`, signatures) are the **only fields every surface reads**. That is the Agent 6 Topic 4 design — signed manifest is the trust root, surface-specific code is downstream of the trust root.

**Borrowed from:** Agent 3 Problems 3, 5, 11 + Agent 6 Topics 2, 3, 4.

### 2.b Channel model — rings from Agent 6 Topic 2

Four channels, five rings per channel, telemetry-gated promotion. From Agent 6 Topic 2: *Microsoft Deployment Rings — Internal → Dev → Canary → Beta → Production — gives the most disciplined reference, and Chrome's component updater uses real crash telemetry before bumping cohorts. Apple phased release adds time as the second axis: 1%/2%/5%/10%/20%/50%/100% over seven days, with automatic halt if crash rate spikes.*

| Ring | % of population | Promotion gate | Auto-halt threshold (from Topic 3) |
|---|---|---|---|
| `canary` | 1% (Juwen's own devices + ~30 internal beta) | 24h crash-free ≥99.7% AND no top-crash regression | <99.0% in 1h window → auto-halt |
| `internal` | 5% (Juwen + 4 contract testers) | 48h crash-free ≥99.5% AND Sentry release health green | <99.0% in 1h window → auto-halt, escalate to Juwen |
| `beta` | 25% (opt-in testers via TestFlight + opt-in PWA) | 48h crash-free ≥99.5% AND no security regression signal | <99.0% in 1h window → auto-halt, manual review |
| `stable` | 50% then 100% (24h pause between) | 48h crash-free ≥99.5% AND no new top-crash regression | <99.0% in 1h window → immediate auto-halt AND `kill_switch: true` on next manifest publish |

The kill switch is the three-way switch from Agent 6 Topic 2:

1. **Server-side flag** — `kill_switch: true` on the next manifest publish, served in seconds via R2 cache invalidation.
2. **Client-side force-check** — every updater calls a lightweight `HEAD` against `https://releases.airiz.app/killswitch` (a one-byte endpoint) before downloading. If 200, abort.
3. **Binary-level emergency stop** — the manifest also carries a `min_supported_version` field; clients below that *must* update, clients at-or-above that *must not* update if `kill_switch: true`. This is the "configuration updates are code" insight from Agent 3 Problem 5.

**Borrowed from:** Agent 6 Topic 2 ("Staged rollouts") + Agent 3 Problem 5 ("Staged-rollout regret", CrowdStrike lesson).

### 2.c Crash-throttled rollback thresholds — Agent 6 Topic 3

From Agent 6 Topic 3 verbatim borrow:

- **Floor:** 99.5% crash-free sessions is the common production floor (5 crashes per 1,000 sessions).
- **AIRIZ realistic range:** 99.5%–99.7% (cross-platform Electron desktop is harder than native iOS).
- **Auto-halt:** anything below 99.0% means the release is broken; auto-halt immediately.
- **Window pair:** 1-hour window for instant halt (catastrophic regression), 24-hour window for ramp decisions (noise filter).
- **False-positive mitigation:** secondary signal — `secondary_signal_url` from the manifest hits `https://health.airiz.app/synthetic` and pings HTTP health endpoints + synthetic probes from 4 regions (iad, sjc, fra, syd). If the secondary signal disagrees with Sentry's release health, the auto-halt fires but the rollback is *paused* not *committed* (the "pause ≠ rollback" distinction from Topic 3).

Implementation in the CI workflow (Section 3): a `crash-throttle` job that runs `curl https://sentry.io/api/0/organizations/airiz/releases/1.8.2/health/` every 5 minutes for 48 hours after publish; if crash-free drops below threshold, the workflow emits a `kill_switch: true` manifest and exits non-zero.

**Borrowed from:** Agent 6 Topic 3 ("Crash-throttled rollback").

### 2.d Signing key custody + rotation — Agent 6 Topic 4

From Agent 6 Topic 4 verbatim borrow: *"For AIRIZ Motor Console, an HSM or YubiKey-bound key is non-negotiable. The cost of YubiKey 5 plus GPG signing is trivial versus a compromised vehicle-diagnostic update."*

Concrete custody design:

- **Primary signing key:** Ed25519, generated on a YubiKey 5 (FIDO2 + OpenPGP). Private key material never leaves the YubiKey. The CI workflow uses `ssh -O IdentityAgent=none` style invocation against the YubiKey over USB; the manifest signing step is interactive (PIN prompt) and cannot be automated headlessly.
- **CI-resident secondary key:** Ed25519, generated in CI, used for `canary` and `internal` ring publishes only. Lives in GitHub Actions OIDC-bound secret (auto-rotated per workflow run, never persisted). Cannot promote a build past `beta` because promotion to `stable` requires the YubiKey-bound primary signature.
- **Dual-sign window (Topic 4):** when rotating the primary key, both keys sign manifests for one full release cycle (~14 days). The CI step accepts both signatures. After the window, the old key is retired; a revocation is published as a `kill_switch: true` manifest that flips the trusted-keys list.
- **Cert metadata as first-class YAML** (Agent 3 Problem 2, defense 1): `release/manifest/certs.yaml` holds `not_before`, `not_after`, `thumbprint`, `apple_team_id`, `google_keystore_alias`, `yubikey_serial` for every signing identity. CI rejects any build that uses a cert within 60 days of `not_after`. A daily cron compares `not_after` against `now + 365 days` and pages the on-call if within window.

**Borrowed from:** Agent 6 Topic 4 ("Signed manifests") + Agent 3 Problem 2 ("Code-signing certificate expiry") + Agent 3 Problem 11 ("Ransomware-via-channel", SolarWinds key custody lesson).

### 2.e PWA update trap avoidance — Agent 6 Topic 5

From Agent 6 Topic 5 verbatim borrow: *"Service workers are the hardest auto-update surface in web engineering. The classic 'user sees old UI forever' bug happens when a new SW installs but never activates."* And: *"Out-of-band cache is the silent failure. Workbox precaching builds a build-time manifest; runtime caching (NetworkFirst, StaleWhileRevalidate) lives outside it. Change a runtime strategy without bumping the SW version, and users keep the old strategy forever."*

Concrete defenses:

1. **Workbox with `InjectManifest`** — every precache entry is content-addressed (`workbox-<hash>` in the URL); the entire SW install fails loudly in DevTools if any entry 404s. This is what Twitter and Notion should have been using.
2. **`skipWaiting()` only on user gesture** — expose a "Reload to update" toast in the PWA chrome; the toast handler is the only thing that calls `skipWaiting()`. ChromeOS uses this pattern for OS updates.
3. **`clients.claim()` only after navigation** — wait for `ServiceWorkerContainer.controllerchange` AND the next user navigation before `clients.claim()`. Avoid mid-tab claims.
4. **Channel file with `Cache-Control: no-cache, must-revalidate`** — the PWA SW fetches `manifest/<channel>.json` with explicit freshness.
5. **Health-check at install** — the new SW's `install` event runs `fetch('/healthz')` and throws on non-200; if it throws, the old SW keeps serving.

Also from Agent 6 Topic 5: *"For AIRIZ Motor Console, a service worker is the wrong abstraction if a native shell exists. Reserve SW for marketing."* — apply this only to the marketing site (`airiz.app/marketing/`); the console itself is a native Electron / Capacitor shell, so no SW is needed for the console UI.

**Borrowed from:** Agent 6 Topic 5 ("PWA service worker update traps") + Agent 3 Problem 6 ("PWA service worker caches the old shell").

### 2.f Store vs sideload decision — Agent 6 Topic 6

From Agent 6 Topic 6 verbatim borrow: *"For AIRIZ Motor Console — fleet tablets — direct APK with hardware-attested signing beats Play Store. Field techs are IT-provisioned, not consumers. iOS is harder; Enterprise cert is the only path with real re-enrollment tax."*

Concrete decision:

| Platform | Distribution | Reason |
|---|---|---|
| Android (technician tablets) | **Direct APK sideload** from R2, signed with v2+v3+v4, provisioned via MDM | Per Topic 6: "direct APK with hardware-attested signing beats Play Store." MDM pre-whitelists the install source (no Play Protect scary warning). Play App Signing key stays in escrow for the B2C pivot path. |
| Android (consumer, if any) | Play Store with Play App Signing | Required if AIRIZ ever pivots B2C; one-way migration, so we set it up now. |
| iOS (technician iPads) | **Enterprise cert** with 90-day re-enrollment automation | Per Topic 6: "iOS Enterprise cert is the only path with real re-enrollment tax." The tax is automated via a small MDM script that re-enrolls the iPad on day 85. |
| iOS (consumer) | App Store + TestFlight | Topic 6: "stores are mandatory for B2C." TestFlight for pre-release, never DEP for consumer builds. |

Agent 6 Topic 6 also invokes the **ShadowHammer lesson** (Agent 3 Problem 3): *"the lesson is not 'never sideload' but 'the sideload channel needs its own code-signing discipline.'"* Our direct-APK sideload channel enforces that discipline by signing with the same YubiKey-bound Ed25519 key from Section 2.d, with `apksigner verify --verbose` as a CI gate (Agent 3 Problem 9, defense 5).

**Borrowed from:** Agent 6 Topic 6 ("Store vs sideload for mobile") + Agent 3 Problem 3 ("Manifest tampering", ShadowHammer) + Agent 3 Problem 7 ("iOS App Store vs enterprise", Facebook revocation lesson).

### 2.g Cloudflare Worker signed deploys — Agent 6 Topic 7

From Agent 6 Topic 7 verbatim borrow: *"Cloudflare Workers push the auto-update boundary into infrastructure-as-code. `wrangler deploy` ships a new script version globally in seconds. Deploys are signed by Cloudflare's infrastructure, so supply-chain risk shifts to account security — 2FA, IP allowlists, audit logs."* And: *"Durable Object versioning is the real trap. ... There is no atomic multi-script rollback. The Cloudflare docs prescribe versioning the class name (`MyDO_v2`) and migrating data forward, never back."*

Concrete defenses:

1. **`wrangler versions deploy` (not raw `wrangler deploy`)** — every deploy creates an immutable version; the manifest carries the version ID.
2. **Multi-region synthetic probes** — Topic 7's specific warning: *"cf-status incidents 2022-11, 2023-06 showed deploys can succeed globally but fail regionally."* The `airiz-relay-worker.yml` workflow waits for probes from `iad, sjc, fra, syd` before promoting from canary to stable.
3. **DO class versioning** — every Durable Object class name carries a version suffix (`Relay_v3`); migrations are forward-only; old class names are kept alive (read-only) for two release cycles before deletion.
4. **Secrets versioning** — Topic 7's warning: *"wrangler rollback does not roll back secret values."* We keep a "known-good" secret snapshot in R2 (`known_good_secret_snapshot_id` in the manifest); the rollback script can revert secrets manually if a rollback is required.
5. **Account security** — 2FA + IP allowlist on Cloudflare account + audit log shipped to a SIEM.

**Borrowed from:** Agent 6 Topic 7 ("Signed Cloudflare Worker deploys") + Agent 3 Problem 10 ("Cloudflare Worker version rollback").

### 2.h Multi-arch single-bundle vs fat-binary — Topic 8 reconstructed

> **Honesty note.** Agent 6's saved file was truncated before Topic 8. The framework documentation that informs this section: `electron-updater` blockmap conventions, Tauri per-arch installer output, Capacitor Android App Bundle (`bundle.tool`), iOS App Store Thinning, and Cloudflare Worker single-target WASM. I have not been able to retrieve a fresh Agent 6 essay on this; treat the analysis below as a first-principles reconstruction grounded in the same framework context Agent 6 had access to.

**The tradeoff.**

- **Single-bundle (universal binary, multi-arch in one file).** Pros: one artifact to sign, one URL in the manifest, simpler `blockMap`, simpler rollback. Cons: every user downloads every arch's worth of binary even if they only run one arch; deltas must be per-arch anyway; large artifact means the R2 cache fills with mostly-redundant bytes.
- **Per-arch fat-binary (per-arch installer, manifest lists all URLs).** Pros: every user downloads only the arch they need; deltas work cleanly per arch; smaller per-user payload; smaller manifest body. Cons: more artifacts to sign (N artifacts × M arches); more URLs in the manifest; more CI jobs; more signing operations (cost of "more pivots" if a per-arch build host is compromised).

**Framework defaults.**

- **`electron-updater`** ships per-arch tarballs (`airiz-1.8.2-mac-x64.zip` and `airiz-1.8.2-mac-arm64.zip`); the `latest.yml` blockmap lists both URLs. The `latest-mac.yml` file is per-arch. Per-arch is the convention.
- **Tauri Updater** emits per-arch installers (one for `x86_64-pc-windows-msvc`, one for `aarch64-pc-windows-msvc`, etc.); the `latest.json` carries both URLs.
- **Capacitor Android** defaults to App Bundle (`bundle.release`), which produces per-device APKs from the AAB at install time via Play's dynamic delivery. For direct APK sideload (Section 2.f), we sign a single `app-release.apk` that includes both `arm64-v8a` and `x86_64` ABIs as a "fat APK" — universal-install is the right tradeoff for fleet sideload where MDM pushes one binary.
- **Capacitor iOS** uses App Store Thinning (`ASSETCATALOG_COMPILER_APPICON_NAME` and asset slicing) — Apple generates per-device IPAs server-side at install time. We upload one universal IPA; Apple handles the split.
- **Cloudflare Worker** is single-target (WASM compiled for the Workers runtime); no arch problem.

**AIRIZ decision.**

- **Desktop:** per-arch installers (electron-updater convention). Manifest lists `installer_x64_url` and `installer_arm64_url`. Deltas are per-arch.
- **Android (sideload):** single fat APK with both ABIs inside. Manifest lists one `apk_sideload_url`.
- **Android (Play):** App Bundle. Manifest references `aab_url` for traceability but Play handles delivery.
- **iOS:** universal IPA; App Store Thinning handles per-device split.
- **Cloudflare Worker:** no-op (single target).

This means the manifest surface for AIRIZ has **2 desktop URLs (Win + macOS ×2 arch each = 4, simplified to 2 arch groups), 1 Android APK, 1 Android AAB, 1 iOS IPA, 1 PWA shell URL, 1 Worker version ID** = 7 URLs in the worst case. Each is signed with the same YubiKey-bound Ed25519 key; each gets its own Rekor entry; each is independently rollback-able.

**Borrowed from:** Agent 6 Topic 8 (reconstructed) + Agent 3 Problem 4 ("Delta-update corruption", per-arch blockMap matching) + Agent 3 Problem 9 ("Android v2/v3/v4 signature scheme").

### 2.i Top-10 defenses borrowed from Agent 3

Drawn from the Agent 3 Cross-Problem Mitigation Matrix at `tool_1abb9cce80016jq3W6sFSQJSCW:1353-1367`, in priority order for AIRIZ:

| # | Defense | Agent 3 problem it solves | Why it's #1 priority for AIRIZ |
|---|---|---|---|
| 1 | **Manifest `kill_switch` field, three-way kill switch (server flag + client force-check + binary emergency stop)** | Problem 5 (CrowdStrike lesson) | This is the single control that would have prevented the 2024-07-19 outage. Cost: one JSON field. |
| 2 | **Reproducible builds + Sigstore-signed manifest + Rekor transparency log entry on every publish** | Problem 3 (manifest tampering) + Problem 11 (ransomware-via-channel) | Defends CCleaner, ShadowHammer, and SolarWinds simultaneously. |
| 3 | **Cert as first-class YAML; CI rejects builds within 60 days of `not_after`** | Problem 2 (cert expiry) | Five-minute CI rule; cost: one YAML file + one cron job. |
| 4 | **YubiKey-bound GPG signing key for the manifest** | Problem 11 (SolarWinds key custody lesson) | The build pipeline was compromised in SolarWinds; YubiKey-bound signing isolates the trust root from any single build host. |
| 5 | **Atomic staging per-block + two-channel rollback** | Problem 1 (partial-download mid-update) | electron-updater's `fallbackToPreviousRelease` + Capawesome's chunked-zip staging. |
| 6 | **Single CI job produces artifact + blockMap; refuse to apply on base mismatch** | Problem 4 (delta corruption) | Catches the Electron blockMap corruption cascade pattern. |
| 7 | **Workbox versioned precache + `skipWaiting` on user gesture + `Cache-Control: no-cache` on channel file** | Problem 6 (PWA staleness) | Solves the "user sees old UI forever" trap. |
| 8 | **App Store prod / TestFlight pre-release / never DEP for consumer builds** | Problem 7 (Facebook enterprise cert revocation) | DEP for internal tools only. |
| 9 | **`apksigner --v2-signing-enabled=true --v3-signing-enabled=true --v4-signing-enabled=true` + Custom ROM test matrix** | Problem 9 (Android signature scheme) | Single signing invocation, single CI gate. |
| 10 | **`wrangler versions deploy` + git-tag correlation + 1% canary + multi-region probes** | Problem 10 (Worker rollback) | Replaces raw `wrangler deploy`; mandatory DO class versioning. |

If AIRIZ implements nothing else, implement **#1 (kill switch) + #3 (cert expiry rule) + #7 (Workbox for PWA)**. That is the cheapest set of controls that closes the CrowdStrike / cert expiry / Twitter-PWA failure modes — the three highest-probability failure modes for a single-person team shipping to five surfaces.

**Borrowed from:** Agent 3 Cross-Problem Mitigation Matrix at lines 1353-1367 of `tool_1abb9cce80016jq3W6sFSQJSCW`.

---

## Section 3 — GitHub Workflow Matrix

The five existing workflows in `apps/airiz/.github/workflows/` (per the brief). For each: what **stays**, what **changes**, what **merges** into or out of the new Option-C pipeline.

### 3.1 `airiz-desktop.yml` — Windows + macOS desktop Electron builds

| Aspect | Decision |
|---|---|
| **Stays** | electron-builder `nsis` (Win) + `dmg` (mac) build steps; per-arch artifact upload to R2; notarization invocation. |
| **Changes** | After electron-builder produces artifacts, a new `sign-manifest` step takes the artifact metadata + blockMap and emits the per-channel `manifest/<channel>.json` body; a separate `sign-manifest` job (running as a separate GitHub Actions identity) calls `cosign sign --key yubikey://...` on the manifest body, then `rekor-cli upload` for the transparency log entry. |
| **Merges out** | The `generate-feed.py` invocation (the bespoke `sync_release_feed.py`) is replaced by the manifest-emission step in `airiz-update-feed.yml` (Section 3.5). |
| **Net effect** | Build job stays the same; signing + manifest emission move to a separate job with separate identity. |

### 3.2 `airiz-mobile.yml` — Capacitor Android + iOS mobile builds

| Aspect | Decision |
|---|---|
| **Stays** | Capacitor `sync` step; Gradle build (Android); Xcode build (iOS); `apksigner` invocation; TestFlight upload; App Store Connect upload. |
| **Changes** | Add `apksigner verify --verbose` as a CI gate (Agent 3 Problem 9 defense 5). Add `bundle.release` step for the AAB path. Add Custom ROM install test on a LineageOS 21 emulator (Agent 3 Problem 9 defense 2). The Enterprise cert IPA build (sideload path) is added as a separate matrix entry. |
| **Merges out** | Nothing — this workflow is the most independent. It only needs to consume the manifest, not emit it. |
| **Net effect** | Adds two CI gates (apksigner verify, Custom ROM install test); one new matrix entry (Enterprise sideload). |

### 3.3 `airiz-mobile-runtime.yml` — Capacitor Live Update for mobile shell

| Aspect | Decision |
|---|---|
| **Stays** | Nothing stays in its current form. |
| **Changes** | This workflow is **the primary consumer** of the manifest for mobile surfaces (Section 2.a `capacitor_android` and `capacitor_ios` blocks). It fetches `manifest/<channel>.json`, verifies both signatures against the trust roots, and triggers `Capawesome Live Updates` apply for `capacitor_android` and `capacitor_ios` blocks. |
| **Merges out** | The bespoke `sync_release_feed.py` step that this workflow currently calls for mobile shells — replaced by manifest fetch + verification + Capawesome apply. |
| **Net effect** | This workflow **becomes the mobile-side updater process**, not a build pipeline. Triggered by manifest publish, not by git push. |

### 3.4 `airiz-relay-worker.yml` — Cloudflare Worker relay build + deploy

| Aspect | Decision |
|---|---|
| **Stays** | `wrangler deploy` step; KV / Durable Object binding setup. |
| **Changes** | **Replace** `wrangler deploy` with **`wrangler versions deploy`** (Agent 3 Problem 10 defense 1 + Agent 6 Topic 7). Emit the version ID to the manifest's `surfaces.relay_worker.wrangler_version_id` field. Add the multi-region probe step (`iad, sjc, fra, syd`) as a 1% canary promotion gate (Agent 6 Topic 7 defense 5). Add DO class versioning convention enforcement (`Relay_vN` naming). |
| **Merges out** | Nothing — this workflow is the most independent on the surface-deployment side. |
| **Net effect** | `wrangler versions deploy` + multi-region probe gate + DO versioning. |

### 3.5 `airiz-update-feed.yml` — manifest publishing pipeline

| Aspect | Decision |
|---|---|
| **Stays** | R2 upload of installers. |
| **Changes** | This workflow **becomes the canonical manifest publisher**. It is the *only* workflow with the YubiKey-bound signing identity and the promoter identity. Triggered by `workflow_run` completion of `airiz-desktop.yml`, `airiz-mobile.yml`, `airiz-relay-worker.yml` (any of the three finishing emits an artifact hash). The workflow: (1) collects all per-surface artifacts; (2) computes hashes; (3) composes `manifest/<channel>.json` body; (4) signs with YubiKey-bound primary key + CI-resident secondary key (dual-sign quorum for `stable` ring only); (5) uploads to R2; (6) uploads the Rekor entry; (7) pages on-call if `not_after` of any signing cert is within 365 days. |
| **Merges out** | The custom `sync_release_feed.py` script — completely removed (replaced by declarative manifest compose in this workflow). |
| **Net effect** | This workflow is **the trust root**. Every other workflow either emits artifacts that this workflow consumes, or consumes the manifest this workflow publishes. |

### Workflow matrix summary

| Workflow | Role in new architecture | Build host with manifest-signing power? |
|---|---|---|
| `airiz-desktop.yml` | Emits desktop artifacts | No |
| `airiz-mobile.yml` | Emits mobile artifacts | No |
| `airiz-mobile-runtime.yml` | Consumes manifest (mobile apply) | No |
| `airiz-relay-worker.yml` | Emits Worker version | No |
| `airiz-update-feed.yml` | **Signs + publishes manifest** | **Yes (YubiKey-bound + dual-sign quorum)** |

This is the **single trust root** design. Only one workflow can sign a manifest; only one workflow can promote to `stable`; only one workflow holds the promoter key. A compromise of any build workflow (Problems 3, 11) cannot forge a manifest because the manifest signer is a separate identity in a separate workflow.

**Borrowed from:** Agent 3 Problem 3 defenses 2/3/5 + Agent 6 Topic 4 ("Signed manifests") + Agent 6 Topic 7 ("Signed Cloudflare Worker deploys").

---

## Section 4 — Risks Juwen Must Sign Off On

Each risk traces to an Agent 3 problem. Severity rubric: **Critical** (active exploit or compliance blocker), **High** (probable incident without mitigation), **Medium** (incident with material blast radius), **Low** (operational inconvenience).

### Risk 1 — YubiKey loss or destruction [Critical]

**Agent 3 problem:** Problem 11 (SolarWinds SUNBURST — build pipeline compromised, signing cert stolen). Mitigation: dual-sign window keeps the secondary CI-resident key valid for one release cycle (~14 days) after primary loss; the secondary can promote to `beta` (not `stable`), buying time to re-issue the primary. **Backup YubiKey** stored in a separate physical location (e.g., safety deposit box). Re-issuance procedure documented in `release/runbooks/yubikey-loss.md`.

### Risk 2 — Cert expiry cascades on multiple platforms simultaneously [Critical]

**Agent 3 problem:** Problem 2 (Code-signing certificate expiry). The cert metadata file `release/manifest/certs.yaml` tracks 5 certs: Windows EV code-signing, macOS Developer ID, Apple WWDR, Android upload key, Apple Enterprise distribution. If three expire in the same calendar quarter (which happens when certs were purchased together), there is a stampede. Mitigation: stagger purchases; renewal trigger 90 days before `not_after`; daily cron pages on-call at 365/180/90/60/30/7 days. The cert-metadata YAML is the single source of truth; CI refuses to build if any required cert is within 60 days of expiry.

### Risk 3 — R2 bucket compromise or origin hijack [Critical]

**Agent 3 problem:** Problem 3 (Manifest tampering). The signed manifest is hosted on R2; an attacker who gains R2 write access could substitute a manifest. Mitigation: the manifest is signed with Ed25519 (verified client-side); R2 compromise alone is insufficient because the attacker would also need the YubiKey-bound private key. Cloudflare account 2FA + IP allowlist + audit log ship to SIEM. **Bucket-level immutability** for `manifest/` paths via Cloudflare R2 Object Lock (WORM) with retention of 90 days, so a substituted manifest older than 90 days cannot be re-served.

### Risk 4 — SolarWinds-style build pipeline compromise [High]

**Agent 3 problem:** Problem 11 (Ransomware-via-channel). If the GitHub Actions runner is compromised, an attacker could ship signed-but-malicious artifacts. Mitigation: **two-person sign-off** (manifest signer is a *separate* identity from artifact signer, in a *separate* workflow); **reproducible builds** (build twice from clean CI, fail on hash mismatch); **SLSA Level 3** provenance attestation on every artifact (`cosign attest --predicate slsa-provenance`). Even a compromised runner cannot forge the manifest sign because the YubiKey is on Juwen's desk, not in CI.

### Risk 5 — CrowdStrike-style "no kill switch" outage on the PWA [High]

**Agent 3 problem:** Problem 5 (CrowdStrike 2024-07-19). The PWA's SW cannot easily be "un-installed" once activated. Mitigation: Section 2.b's three-way kill switch (`kill_switch: true` on manifest; client-side `HEAD https://releases.airiz.app/killswitch` check; SW self-check on install that aborts on bad health). Also: keep one prior SW version in the precache manifest, so a bad SW install can be rolled back by activating the prior one.

### Risk 6 — macOS notarization queue stall [Medium]

**Agent 3 problem:** Problem 8 (Slack macOS notarization lag 2022-10; Figma notarization outage 2024-01). Mitigation: submit to `notarytool` as soon as the binary is feature-complete (well before release branch freeze); retry with exponential backoff up to 8 hours; dual-mode stapling (stapled + online ticket). If notarization fails at release time, ship with online ticket only and document the temporary offline behavior.

### Risk 7 — iOS Enterprise cert revocation by Apple [Medium]

**Agent 3 problem:** Problem 7 (Facebook enterprise cert revocation 2023-04). Mitigation: **never use Enterprise cert for consumer builds** (App Store is the consumer path). Enterprise cert is only for the fleet-tablet sideload path. The re-enrollment automation (Section 2.f, day-85 MDM re-enrollment) keeps the cert's 90-day device limit from biting. Have a **pre-cleared expedited review** on file at Apple so a consumer App Store emergency release can be expedited.

### Risk 8 — Worker rollback after bad deploy leaves Durable Objects in inconsistent state [Medium]

**Agent 3 problem:** Problem 10 (Cloudflare Worker rollback; Durable Object versioning trap from Agent 6 Topic 7). Mitigation: **DO class versioning** (`Relay_v3`, never edit-in-place); forward-only migrations; old class names kept read-only for two cycles; known-good secret snapshot stored offline in R2.

### Risk 9 — Android signature scheme mismatch on Custom ROM or older Android [Medium]

**Agent 3 problem:** Problem 9 (APK Signature Scheme v2/v3/v4; LineageOS fs-verity requires v4). Mitigation: `apksigner` invocation signs with v2+v3+v4 simultaneously; CI test matrix installs the APK on Android 7, 9, 11, 13, 14, and a LineageOS 21 emulator; gate is `apksigner verify --verbose` returning zero.

### Risk 10 — PWA staleness on long-running tabs [Low–Medium]

**Agent 3 problem:** Problem 6 (PWA SW caches old shell; Twitter 2023-09, Notion 2022-11). Mitigation: Section 2.e (Workbox + `skipWaiting` on user gesture + `clients.claim()` only on navigation + channel file `Cache-Control: no-cache`). Acceptable residual risk: a tab that has been open for 30+ days and never reloaded will see the old shell until reload. Mitigation for power users: a "Reload to update" toast appears on every app start if a new SW is waiting.

**Borrowed from:** Agent 3 Problems 1–11 (all); Agent 6 Topics 5, 6, 7 reinforce mitigation specifics.

---

## Section 5 — Open Questions for Juwen

These are questions only you (the human owner) can answer. I have made the safest assumption I could and flagged it; you should confirm or override each.

1. **iOS: TestFlight vs App Store for internal builds.** I assumed iOS uses **Enterprise cert with 90-day MDM re-enrollment** for technician fleet iPads, and **App Store + TestFlight** for any consumer path. Confirm: is the technician fleet real iPads, or are you OK with TestFlight-only for the early launch? (TestFlight limits to 10K external testers, no MDM.)

2. **R2 vs GitHub Releases as binary cache.** I assumed R2 (`r2.airiz.app`) for both manifests and binaries. R2 + Cloudflare's edge cache is fast globally, integrates with the Worker, and has WORM (Object Lock) for the immutability defense (Section 4 Risk 3). GitHub Releases is simpler (no second vendor) but lacks WORM and integrates less cleanly with the Worker. Which?

3. **Do we need enterprise cert for iOS, or can we live with TestFlight-only?** Enterprise cert costs $299/year (Apple Developer Enterprise Program) and carries revocation risk (Section 4 Risk 7). TestFlight is free but limits external testers. If you are pre-revenue, TestFlight may be enough; if you are selling to enterprise fleet customers, you need Enterprise.

4. **Crash-throttled rollback window pair: 1-hour halt + 24-hour ramp, or shorter?** I borrowed Agent 6 Topic 3's recommended window pair. For a single-person team that ships weekly, the 24-hour ramp before `stable` ring promotion may feel slow. Do you want a 4-hour or 12-hour ramp for AIRIZ specifically?

5. **Telemetry vendor: Sentry (Agent 6 Topic 3 default) vs Rollbar vs Bugsnag vs self-hosted.** I assumed Sentry (release health API is well-documented; `GET /api/0/organizations/{org}/releases/{version}/health/`). Confirm or override. Sentry is $26/month for the team plan; Rollbar is comparable; self-hosted Sentry is free but is itself a deploy target you must secure.

6. **YubiKey 5 ($50) + backup YubiKey 5 ($50) — is this in budget?** Section 2.d + Risk 1 assume two physical YubiKeys. If not, the secondary CI-resident key is the only backup, and a YubiKey loss pauses `stable` ring promotion for 14 days.

7. **iOS Consumer launch: do you want a separate App Store consumer app, or is AIRIZ purely B2B/fleet?** This determines whether the App Store + TestFlight path (Agent 6 Topic 6 / Problem 7) is mandatory or optional. My recommendation above assumes B2B/fleet-first with optional B2C later.

8. **Are you willing to adopt `apksigner` v2+v3+v4 simultaneously, even though Google Play recommends v3-only?** Google's official position is v2+v3 (v4 is opt-in). I recommend v2+v3+v4 because Custom ROMs (LineageOS, GrapheneOS) require v4 (Agent 3 Problem 9 defense 1). This is a one-line CI change, but it diverges from Google's docs.

9. **How much CI compute are you willing to spend on SLSA Level 3 + Sigstore?** Agent 3 Problem 11's full defense is SLSA L4 + Sigstore (~$200/month + 10h/week engineering overhead per the Agent 3 conclusion). The minimum is Sigstore on the manifest only (~$0/month + 2h setup). Where do you want to land?

10. **Is the `apps/airiz/` codebase on GitHub yet, or still in Bitbucket / GitLab?** The workflow matrix (Section 3) assumes GitHub Actions + GitHub OIDC for the Sigstore signing identity. If the repo is elsewhere, the manifest signer changes (GitLab CI OIDC, Bitbucket Pipelines OIDC, or a separate Sigstore Fulcio flow). Confirm.

11. **Three locales (en / 繁中 / 简中) — does any locale-specific release gate exist?** I assumed all three locales ship together as one manifest. If you sometimes ship en-only hotfixes ahead of the 繁中 / 简中 translations, the manifest schema needs a per-locale surface block. Currently the schema is locale-agnostic. Confirm or override.

12. **Cloudflare Worker — do you already use Durable Objects, or is `relay` purely stateless?** Section 2.g assumes DOs exist with state. If `relay` is stateless (just a WebSocket relay), the DO versioning trap is moot and you can use simple `wrangler versions deploy`. Worth confirming before locking in the DO class versioning convention.

---

## Closing notes

- This report synthesizes **only** what was in the two saved files (`tool_1abb9cce80016jq3W6sFSQJSCW` for Agent 3, `tool_1abb9cc10001UmqRuB2lpLkPQO` for Agent 6). No new web research was performed. Agent 3 verified citations: CrowdStrike 2024-07-19, SolarWinds SUNBURST, ASUS ShadowHammer, CCleaner 2017. Agent 6 design essays: Topics 1–7 plus a first-principles reconstruction of Topic 8 (multi-arch single-bundle vs fat-binary) flagged as such.
- The **single highest-leverage** action in this entire report is **adding `kill_switch: true` to the manifest schema** (Section 2.a). That one field is the entire CrowdStrike lesson.
- The **single highest-leverage** operational change is **converting the cert metadata to a tracked YAML file with a CI expiry gate** (Section 2.d). That is a five-minute CI rule that closes Problem 2 entirely.
- If you implement nothing else, implement those two things.

---

## Verification Status (Pass 2 unavailable)

**Pass 2 verification was attempted and could not be completed.** The user originally requested three passes: Pass 1 (initial survey, 8 agents), Pass 2 (verification re-run of all 8), Pass 3 (only if Pass 1 and Pass 2 disagreed).

What happened:
- **Pass 1:** 2 of 8 agents produced complete reports (Agent 3 verified outage citations, Agent 6 design-pattern essays). 1 agent (Agent 4) produced only URL-discovery chain-of-thought with no final report. 5 agents timed out in the 30-minute queue.
- **Pass 1 retries (5 agents):** all aborted at 0s — system-side, not agent fault.
- **Pass 2 Batch A (3 agents in parallel):** all aborted at 0–2s.
- **Pass 2 single-agent test (1 agent, sequential):** aborted at 0s.
- **Diagnosis:** the background-task scheduler is rejecting all background tasks in this session, regardless of whether they are launched in parallel or sequentially. The bottleneck is session-level, not parallelism-specific.

**Implication for the synthesis:** every claim in this report traces to Pass 1 verification only. Specifically:

| Claim class | Verification source | Confidence |
|---|---|---|
| Outage citations (CrowdStrike, SolarWinds, ASUS, CCleaner) | Agent 3 webfetched Wikipedia, CISA AA20-352A, Kaspersky blog | **High** — primary sources cited inline |
| Agent 6 design-pattern essays (Topics 1–7) | Agent 6 verified against framework docs | **High** — well-grounded |
| Topic 8 (multi-arch reconstruction) | First-principles from framework context; Agent 6 file was truncated | **Medium** — flagged explicitly in Section 2.h |
| Tauri minisign / Ed25519 evidence | Agent 4 partial trace via grep_app | **Medium-High** — grep_app is a direct code-search tool |
| Sentry release health thresholds | Agent 4 partial via fetched Sentry docs | **Medium-High** — directly cited |
| Cloudflare Workers gradual deployments + rollbacks | Agent 4 partial via fetched Cloudflare docs | **Medium-High** — directly cited |
| electron-updater latest.yml schema | Inferred from Tauri/electron-builder docs (well-known) | **Medium** — would benefit from Pass 2 |
| Capawesome Live Updates bundle format | Inferred from Capacitor docs (well-known) | **Medium** — would benefit from Pass 2 |
| Squirrel.Windows RELEASES file format | Inferred from project history (well-known) | **Medium** — would benefit from Pass 2 |
| Sparkle appcast XML schema | Inferred from project history (well-known) | **Medium** — would benefit from Pass 2 |
| PWA Workbox strategy specifics | Workbox docs are well-documented; Agent 4 grep_app | **Medium-High** |
| Android v2/v3/v4 signing scheme | Android developer docs (deep paths 404'd in Pass 1 via webfetch) | **Medium** — would benefit from Pass 2 |

**Recommendation:** before shipping, re-run Agents 1, 2, 4, 5, 7, 8 in a fresh session to fill in the **Medium** confidence rows. The Pass 2 bottleneck is session-level — a new session should not have the same scheduler limitation. The two verified reports (Agent 3 + Agent 6) are solid and the synthesis is built on them; the unverified rows would add precision, not contradict the recommendation.

---

## Open Questions (consolidated list)

1. iOS TestFlight-only vs Enterprise cert for technician fleet iPads
2. R2 vs GitHub Releases as binary cache
3. Enterprise cert necessity vs TestFlight-only budget
4. Crash-throttle window pair: 1h halt + 24h ramp, or shorter
5. Telemetry vendor: Sentry (assumed) vs Rollbar vs Bugsnag vs self-hosted
6. YubiKey budget (one + backup = $100)
7. B2C launch roadmap (drives App Store vs TestFlight vs Enterprise decision)
8. v2+v3+v4 simultaneously vs Google's v2+v3 recommendation
9. SLSA Level target (L1 free / L3 ~$50/mo / L4 ~$200/mo)
10. Repo host (GitHub assumed for Actions + OIDC)
11. Locale-specific release gating (en canary hotfix vs all-three-locales stable)
12. Cloudflare Worker state model (stateless vs Durable Objects)

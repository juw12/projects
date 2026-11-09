# Verification Report — Unified Auto-Update Models Survey

**Source file:** `apps/airiz-motor/.opencode/research/update-manifests/unified-models-summary.md` (Phase 1, dated 2026-11-05)
**Verification date:** 2026-11-05
**Verifier:** MiniMax-M3 (OpenCode)
**Method:** Canonical URL fetch + GitHub REST API for the ten claims enumerated in the brief.

---

## Method

For each claim, a canonical URL was fetched (or `gh api` was called) and the
page's stated facts were compared line-by-line against the Phase 1 summary.
Each result is tagged:

- **VERIFIED** — canonical source directly confirms the Phase 1 claim.
- **CONTRADICTED** — canonical source directly contradicts the Phase 1 claim.
- **CHANGED** — facts have moved (e.g. an EOL date has slipped) but the
  spirit of the claim still holds.

Final verdicts roll up to:

- **CONSISTENT** — no factual disagreement.
- **MINOR DRIFT** — direction is correct but a detail (date, scope, label) is
  off. Worth a small footnote; not a blocker for downstream diffing.
- **CONTRADICTED** — a load-bearing claim is wrong. Must be corrected before
  Phase 2 trusts Phase 1.

---

## 1. Tauri — `tauri-plugin-updater`

- **Phase 1 claim (1-line):** First-party `tauri-plugin-updater`, desktop-only,
  signed / channel-aware / mature. Mobile builds "supported in the plugin but
  constrained by store policy".
- **Canonical URL:** https://v2.tauri.app/plugin/updater/
- **What the canonical source says:**
  - Plugin is listed in the official menu (`Plugins → Updater`) and the
    "Supported Platforms" table includes **windows / linux / macos / android / ios**.
  - Install command is hard-coded to desktop:
    `cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`
  - `lib.rs` snippet wraps plugin init in `#[cfg(desktop)]`.
  - Signing is mandatory ("cannot be disabled"). Channel switching, key
    rotation, custom target, downgrade control, `installMode` on Windows, and
    both static-JSON and dynamic-server endpoint modes are documented.
  - CrabNebula is named the official dynamic-update-server partner.
- **Verification result:** **VERIFIED** for first-party status, signing,
  channels, desktop config. Phase 1's "mobile supported in the plugin but
  constrained by store policy" overstates reality — the plugin's
  `#[cfg(desktop)]` guard means the **mobile code path does not exist in the
  installable package** today; the platform table includes mobile only as
  forward-looking rows. Apple policy 3.3.1 is still the operative wall.
- **Final verdict:** **MINOR DRIFT**
  - Direction is right (desktop-only, first-party, signed).
  - "Mobile supported in the plugin" reads as if the plugin can be wired up
    for Android/iOS today. The current package can't be installed on mobile
    targets. Apple/Google policy is the secondary, not primary, blocker.

---

## 2. Flutter — `shorebird.dev`

- **Phase 1 claim (1-line):** No first-party Flutter updater; Shorebird is the
  Flutter CodePush alternative, founded by Eric Seidel (creator of Flutter).
- **Canonical URL:** https://shorebird.dev/
- **What the canonical source says:**
  - Tagline: "Code Push for Flutter: Ship Fixes Over the Air".
  - "Shorebird delivers Dart updates over the air to your Flutter apps".
  - "Built by the people who made Flutter — Shorebird was founded in 2023 by
    Eric Seidel, the creator of Flutter, and is backed by Accel."
  - "Can I self-host Shorebird? No. Shorebird has no plans to offer on-prem,
    self-hosted or cloud-prem versions."
  - "Free for 5,000 patch installs a month".
  - Customers cited: Solides, Kalshi, Junglee Games, Delivery Hero,
    Couchsurfing, Cloudwalk, PushPress, Scapia, VETC.
- **Verification result:** **VERIFIED** on all three sub-claims.
- **Final verdict:** **CONSISTENT**

---

## 3. .NET MAUI — Windows deployment overview

- **Phase 1 claim (1-line):** MSIX + AppInstaller on Windows; no unified
  cross-platform MAUI updater.
- **Canonical URL:** https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/overview
- **What the canonical source says:**
  - "Publishing a .NET MAUI app for Windows involves creating an MSIX app
    package (known as a packaged app), or creating an executable file
    (known as an unpackaged app)."
  - "The MSIX package is configured by the
    *Platforms\Windows\Package.appxmanifest* … file in your project. The
    manifest is used by the MSIX installer, the Microsoft store, and by
    Windows, to configure and display your app."
  - Page is purely about publishing (CLI, Visual Studio folder, unpackaged),
    with no section describing an in-place update mechanism.
  - Version of doc ranges covers .NET MAUI 8 / 9 / 10 / 11; current default
    moniker `net-maui-10.0`.
- **Verification result:** **VERIFIED**
- **Final verdict:** **CONSISTENT**

---

## 4. React Native — `microsoft/react-native-code-push`

- **Phase 1 claim (1-line):** Archived 2025-05-20 (Microsoft CodePush
  repo).
- **Canonical source:** `gh api repos/microsoft/react-native-code-push`
- **Raw response:**
  ```json
  { "archived": true,
    "pushed_at": "2025-05-20T11:58:16Z",
    "updated_at": "2026-11-03T12:18:11Z",
    "description": "React Native module for CodePush" }
  ```
- **Verification result:** **VERIFIED** — `archived: true`,
  `pushed_at: 2025-05-20T11:58:16Z` matches Phase 1 to the second.
- **Final verdict:** **CONSISTENT**

---

## 5. Capgo — `Cap-go/capacitor-updater`

- **Phase 1 claim (1-line):** Active, ~883 stars, last push 2026-11-04.
- **Canonical source:** `gh api repos/Cap-go/capacitor-updater`
- **Raw response:**
  ```json
  { "archived": false,
    "full_name": "Cap-go/capacitor-updater",
    "license": { "key": "mpl-2.0", "name": "Mozilla Public License 2.0",
                 "spdx_id": "MPL-2.0" },
    "pushed_at": "2026-11-04T13:49:44Z",
    "stargazers_count": 883,
    "updated_at": "2026-11-04T13:48:45Z" }
  ```
- **Verification result:** **VERIFIED** — archived=false, stars=883 (exact),
  pushed_at=2026-11-04 (within an hour of the Phase 1 survey).
- **Bonus fact (for downstream):** License is **MPL-2.0**, not MIT. Phase 1
  doesn't state a license, so this is not a contradiction; flagging for
  completeness.
- **Final verdict:** **CONSISTENT**

---

## 6. Ionic Appflow sunset — blog announcement

- **Phase 1 claim (1-line):** Sunset announcement 2025-02-11; EOL 2027-12-31.
- **Canonical URL:** https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products
- **What the canonical source says:**
  - Page header: "February 11, 2025".
  - "Today, we have discontinued new customer sales for all Ionic commercial
    products and services—including Ionic Appflow, Identity Vault, Portals,
    and all other paid components of the ecosystem."
  - "**Appflow users**: You'll continue to have access through **December 31,
    2027**."
  - Enterprise carve-out: "Ionic understands the disruption … we will offer
    an option for continued use and self-service maintenance and support of
    our commercially licensed software, such as Identity Vault, Auth Connect,
    Secure Storage, Ionic Portals, and **Enterprise AppFlow**."
- **Verification result:** **VERIFIED** — date and EOL are exact.
- **Bonus fact (for downstream):** Phase 1 understates the carve-out scope:
  Enterprise AppFlow (separate SKU from standard Appflow) has an extra
  continuity option beyond the 2027-12-31 cutoff. Not a contradiction; the
  "Sunset" verdict still holds for the standard Appflow product.
- **Final verdict:** **CONSISTENT**

---

## 7. Bitrise CodePush

- **Phase 1 claim (1-line):** Free up to 100K MAU; App Center successor.
- **Canonical URL:** https://bitrise.io/platform/codepush
- **What the canonical source says:**
  - `<meta description>`: "Fully managed CodePush for React Native and Expo.
    The App Center successor with the familiar SDK. **Free up to 100k MAU,
    no egress bills**."
  - FAQ: "Yes. It is built on the same open-source foundation as the original
    App Center CodePush service, so the protocol and SDK behaviour will be
    familiar to existing users."
  - Pricing tier "Hobby": Free, "Up to 100,000 monthly active users, 5,000
    GiB per month data transfer, 5 GiB storage". Pro from $294/mo (5M MAU).
  - Targets both bare React Native and Expo (including the New Architecture).
- **Verification result:** **VERIFIED** — both load-bearing facts match
  exactly, including the App-Center-successor framing.
- **Final verdict:** **CONSISTENT**

---

## 8. Codemagic Patch

- **Phase 1 claim (1-line):** "OTA patch product" via `patch.codemagic.io`;
  Section 11 calls it **"Flutter-first"**, and the comparison table tags
  Codemagic as "**Dart patches**" / Flutter-first.
- **Canonical URL:** https://patch.codemagic.io/
- **What the canonical source says:**
  - H1: "Codemagic Patch | Self-hosted OTA updates for **React Native**".
  - Tagline: "**Over-the-air updates for React Native.** Efficient setup and
    architecture, even for millions of users."
  - `cmpatch selfhost install` — self-hosted Docker Compose installer.
  - "Patch and other self-hosted OTA tools all ship **JavaScript updates** to
    installed apps." (Dart is not mentioned anywhere on the page.)
  - Footer links to a separate Codemagic **CodePush** product
    (`https://codemagic.io/codepush`), distinct from `patch.codemagic.io`.
  - Stack: Fingerprinting, binary diffs, CDN delivery, RBAC.
- **Verification result:** **CONTRADICTED** on the framework focus. Phase 1
  labels Codemagic Patch as a Flutter/Dart OTA product. The canonical source
  is unambiguous: it is a **React Native, JavaScript-bundle** OTA product.
  Codemagic's Flutter offerings live in `codemagic.io`, not
  `patch.codemagic.io`.
- **Final verdict:** **CONTRADICTED**
  - The "OTA patch product" half is correct (patch.codemagic.io exists and
    is real).
  - The "Flutter-first / Dart patches" framing in §11 and the comparison
    table is wrong. Codemagic Patch is the React-Native self-hosted
    CodePush alternative; the Flutter story is Shorebird, not Codemagic.
  - **Downstream action:** update §11 and the comparison table row for
    Codemagic. Drop "Dart patches", add "JS bundles, RN, self-hosted".
  - The §11 paragraph "Owned by Nevercode Ltd." is **verified** (footer
    reads "© Nevercode Ltd.").

---

## 9. Voltbuilder

- **Phase 1 claim (1-line):** $15/month; active 2026.
- **Canonical URL:** https://voltbuilder.com/
- **What the canonical source says:**
  - "Plans start at **$15/month**. First 15 days free. Cancel anytime."
  - News list top entry: "Security statement: CVE-2026-111497 (Node2Shell)" —
    **04 Nov 2026**, i.e. one day before this verification.
  - Copyright footer: "© 2026 NS Basic LLC. All rights reserved."
  - Product is a Cordova / Capacitor cloud build service. No update channel,
    no manifest, no installed-app delivery — Phase 1's "no updater" verdict
    is correct.
- **Verification result:** **VERIFIED** — both sub-claims match.
- **Final verdict:** **CONSISTENT**

---

## 10. Appcircle CodePush

- **Phase 1 claim (1-line):** OTA service for RN/Expo.
- **Canonical URL:** https://appcircle.io/codepush
- **What the canonical source says:**
  - H1: "Appcircle CodePush Alternative for React Native OTA Updates".
  - "you can seamlessly deliver real-time app updates, making changes to
    your **React Native** apps faster, more efficient, and easier than ever
    before."
  - Features present: differential updates, controlled rollouts, instant
    rollbacks, code signing, package diff, code obfuscation, RBAC, audit
    logs, SSO, CDN, self-hosted option.
  - FAQ: "Microsoft App Center is set to be **retired on March 31, 2025**,
    along with all the services it offers, including CodePush." (Confirms
    the App Center retirement date referenced by Bitrise.)
  - Expo is not in the CodePush module page itself; Appcircle's broader
    CI/CD has a React Native CI/CD track that supports Expo via standard
    RN tooling.
- **Verification result:** **VERIFIED** for RN. Expo is supported via the
  parent RN toolchain rather than a CodePush-specific Expo feature — Phase
  1's "RN/Expo" pairing is accurate at the product level.
- **Final verdict:** **CONSISTENT**

---

## Roll-up table

| # | Framework / tool | Phase 1 claim | Canonical URL | Result | Final verdict |
|---|---|---|---|---|---|
| 1 | Tauri | First-party plugin, desktop-only | v2.tauri.app/plugin/updater | VERIFIED | **MINOR DRIFT** (mobile not actually wired up) |
| 2 | Flutter / Shorebird | No first-party; Shorebird by Eric Seidel | shorebird.dev | VERIFIED | **CONSISTENT** |
| 3 | .NET MAUI | MSIX + AppInstaller; no unified updater | learn.microsoft.com/.../deployment/overview | VERIFIED | **CONSISTENT** |
| 4 | RN CodePush (Microsoft) | Archived 2025-05-20 | gh api repos/microsoft/react-native-code-push | VERIFIED | **CONSISTENT** |
| 5 | Capgo | Active, ~883 stars, 2026-11-04 | gh api repos/Cap-go/capacitor-updater | VERIFIED | **CONSISTENT** |
| 6 | Ionic Appflow | Sunset 2025-02-11; EOL 2027-12-31 | ionic.io/blog/.../future-of-ionics-commercial-products | VERIFIED | **CONSISTENT** |
| 7 | Bitrise CodePush | Free ≤100K MAU; App Center successor | bitrise.io/platform/codepush | VERIFIED | **CONSISTENT** |
| 8 | Codemagic Patch | OTA patch product (**claimed Flutter/Dart**) | patch.codemagic.io | CONTRADICTED | **CONTRADICTED** |
| 9 | Voltbuilder | $15/mo; active 2026 | voltbuilder.com | VERIFIED | **CONSISTENT** |
| 10 | Appcircle CodePush | OTA for RN/Expo | appcircle.io/codepush | VERIFIED | **CONSISTENT** |

---

## Single load-bearing correction for Phase 2

Only one claim is factually wrong. §11 of `unified-models-summary.md` and the
"Codemagic" row of the comparison table must be corrected:

> ❌ "Their OTA offering at `patch.codemagic.io` is a Flutter-first patch
> delivery service (similar surface to Shorebird/Capgo)."
>
> ✅ "Their OTA offering at `patch.codemagic.io` is a **self-hosted React
> Native OTA service** (JS bundle updates, binary diffs, native binary
> fingerprinting), positioned as the alternative to Bitrise / Appcircle
> CodePush, **not** a Flutter / Dart product."

The "Codemagic CI/CD does signing + store publish + OTA patch channel"
framing in the comparison table also survives, but the Dart/Flutter column
must change to **JS bundle / RN**.

## Other notes (not contradictions)

- **Tauri's mobile story** is weaker than Phase 1 implies — the installable
  plugin is `#[cfg(desktop)]`-gated, so today's users cannot wire up
  Android/iOS updater builds from this plugin. Phase 1's load-bearing
  desktop verdict is still correct; the mobile caveat just needs to drop
  one notch.
- **Appflow enterprise carve-out.** Standard Appflow is sunset 2027-12-31;
  Enterprise AppFlow has a separate continuity option. Not a Phase 1
  contradiction (Phase 1 says "Existing Appflow customers retain access
  through December 31, 2027"), but downstream analysis of "what to migrate
  to" should distinguish the standard product from the enterprise SKU.
- **Capgo license** is MPL-2.0. Not stated by Phase 1; flagging so a
  downstream licensing audit doesn't have to re-fetch.
- **App Center retirement date** is **2025-03-31** per Appcircle's FAQ
  (and matches Microsoft's official retirement page), which is the
  upstream trigger for the Bitrise / Capgo / Appcircle / Codemagic
  positioning. Phase 1 implies it without dating it; downstream Phase 2
  should record the date.

---

## Verdict for downstream

- 8 of 10 claims: **CONSISTENT**, ready for diffing as-is.
- 1 of 10: **MINOR DRIFT** (Tauri mobile caveat — non-blocking).
- 1 of 10: **CONTRADICTED** (Codemagic Patch is RN, not Flutter — must be
  corrected before Phase 2 builds on it).

The Codemagic correction is the only fact that changes a downstream
recommendation. Everything else is safe to consume.

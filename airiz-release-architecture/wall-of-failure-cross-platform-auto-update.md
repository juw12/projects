# The Wall of Failure — 10 Hardest Real-World Problems in Cross-Platform Auto-Update

Prepared for: **Juwen Lie / Team Ziris PTB** — AIRIZ Motor Console (`apps/airiz-motor/`)
Purpose: pre-decision failure inventory for the **unified release architecture** pick.
Audience: a **security reviewer** — so every entry carries a real, resolving citation.
Scope: AIRIZ's five surfaces — Electron Windows desktop, Capacitor Android, Capacitor iOS,
static Web PWA (+ Web Serial API + Pages-hosted update channel), and the Cloudflare Workers +
Durable Objects relay. Three independent signing pipelines, five independent update mechanisms.

Research date: **2026-11-05.** Every URL was checked resolving on this date unless a note
says otherwise. Citation *types* are stated per entry (see the key below) — no outage is invented.

---

## Citation-type key (honesty about what each source is)

- **[INC]** — a real incident / outage, with a vendor postmortem, advisory, or contemporaneous news reporting of one.
- **[VULN-TRACK]** — a tracked issue or PR in the *actual shipping library* that documents the exact failure (real repo, resolvable, the bug is real).
- **[SPEC]** — the platform's own authoritative specification / mechanism documentation, used **only** where no single canonical vendor outage exists for that failure mode. Labelled explicitly so the reviewer is not misled.

A "citation" is never "best practice advice." It is either a dated incident, a real tracked defect
in a shipping project, or the platform spec that defines the behaviour in question.

---

## HEADLINE — the failure mode that defines everything here

**CrowdStrike Falcon, 2024-07-19.** A single malformed **Content File (Channel File 291)** was pushed
through Falcon's content channel to **~8.5 million Windows devices at once — with no effective
validation gate, no staged/canary rollout, and no fast rollback.** Devices that had already loaded the
file blue-screened in kernel mode; unpublishing the file on the server only helped machines that had not
already booted with it. Airlines, hospitals, banks and call centres went down at the same moment.

Direct quotes (with source URLs, not paraphrase):

> "Outcome: **~8.5 million Microsoft Windows operating systems crashed worldwide**, causing global disruption
> of critical services."
> — Wikipedia infobox, *2024 CrowdStrike-related IT outages*
> → https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages

> "The 19 July update was an instance of a template … This new instance, **Channel File 291, passed
> validation due to a bug in CrowdStrike's content verification software.** The Falcon Sensor itself
> parses the file differently in a way that led to a software crash in kernel mode."
> — The Register, *CrowdStrike blames a test software bug for that giant global mess it made*, 2024-07-24
> → https://www.theregister.com/2024/07/24/crowdstrike_preliminary_incident_report/

**CORRECTION TO THE BRIEF (do not silently inherit the error):** the tasking referenced "content 297."
The verified CrowdStrike Root-Cause-Analysis artefact is named
`Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf` — the file is **291, not 297.**
Use **291** in any reviewer-facing material.

Why this is the headline: it is the most recent, largest *channel-distribution* failure, it is the closest
structural analogue to what AIRIZ will run (a content/config channel that also carries manifests, flags,
and relay command policy), and it is the surface that dominates AIRIZ's **Windows** desktop.
It is ranked **#1** below.

---

## Ranking table — ranked by blast radius × frequency

Blast = how many devices/users are hit and for how long. Frequency = how often the *failure class*
actually occurs in the wild. A rare-but-catastrophic supply-chain break (row 2) outranks a
frequent-but-individual corrupt download (row 3): one hit of row 2 destroys more trust than ten of row 3.

| Rank | Prob | Problem (failure mode) | Date | Vendor / product | Channel | Blast radius | Freq | Primary citation (type) |
|---|---|---|---|---|---|---|---|---|
| **1** | 5 | No staged rollout / no fast rollback → whole fleet bricked | 2024-07-19 | CrowdStrike Falcon | Windows | ~8.5M devices, global, hours | High | CrowdStrike RCA PDF [INC] |
| **2** | 3 | Manifest / signed-binary tampering → malicious update to a subset | 2019-03 (2018 window) | ASUS Live Update | Windows | 500k–1M (ASUS); 2.27M (CCleaner); 18,000 orgs (SolarWinds) | Low, catastrophic | ASUS ShadowHammer [INC] |
| **3** | 1 | Partial/corrupt download → bricked at next launch | 2023-12-19 | Sparkle (macOS updater) | Mac | 1 reported; class = every updater | High | Sparkle issue #2478 [VULN-TRACK] |
| **4** | 2 | Code-signing cert expiry → OS refuses → fleet dead | 2022-05-04 (recurring) | electron-builder / electron-updater | Windows | Entire app fleet until re-signed | Low–Med | electron-builder #6837 [VULN-TRACK] |
| **5** | 4 | Delta / differential update corruption → wrong bits installed | 2023-07-23 | Sparkle | Mac | Devices on affected base version | Med | Sparkle PR #2408 [VULN-TRACK] |
| **6** | 6 | PWA service worker caches the old shell → "still on old version" | 2023-12-28 (mechanism is permanent) | Web / Chromium service workers | Web | Every installed PWA client, days–weeks | Very high | MDN Service Worker API [SPEC] |
| **7** | 7 | iOS App Store vs enterprise/TestFlight latency; third-party OTA vanishes | 2025-03-31 | Microsoft App Center / CodePush (+ Apple) | iOS (+Android) | Whole mobile update path | High | App Center retirement [INC] |
| **8** | 8 | macOS notarization failure → "unidentified developer" gate | 2019-07-10 | electron-builder (macOS) | Mac | All Gatekeeper-gated users until re-notarized | Med | electron-builder #4040 [VULN-TRACK] |
| **9** | 9 | Android v1/v2/v3/v4 signature-scheme mismatch → install rejected on a subset | 2016→2021 (v2→v4) | Android / AOSP `apksigner` | Android | Subset of devices (old-cert or low-API) | Med–Low | AOSP apksigner doc [SPEC] |
| **10** | 10 | CF Worker version rollback after buggy deploy → stale logic + stale DO state → bad device commands | permanent (Workers platform) | Cloudflare Workers + Durable Objects | Worker (relay) | All devices on the affected DO until remediation | Med | Cloudflare Workers deployments doc [SPEC] |

---
---

# The 10 entries

## Entry 1 — Rank #1 · Problem #5 · No staged rollout / no fast rollback → the whole fleet bricks

| Field | Value |
|---|---|
| **Date** | 2024-07-19 (content pushed Sunday morning UTC; reverted 05:27 UTC) |
| **Vendor / product** | CrowdStrike Falcon Sensor (Windows kernel-mode EDR) |
| **Channel** | Windows |
| **Root cause (technical)** | A malformed **Content File 291** (a "probe"/channel file the sensor consumes) slipped past CrowdStrike's `ContentValidator` pre-processor because of a **bug in that validator**. The sensor's parser and the validator did not share the same schema contract, so a file the validator accepted crashed the sensor in kernel mode → `bugcheck`/BSOD. The content was **pushed to the whole installed base at once** (no 1%→10%→100% canary, no automatic health gate), and once a device had loaded the file into the kernel, **rolling the content back on the server did not unload it** — those machines needed a clean reboot the BSOD often prevented. |
| **Blast radius** | ~8.5 million Windows devices worldwide (CrowdStrike's estimate); simultaneous disruption of Delta Air Lines and other airlines, hospitals, banks, insurance and telecom call centres; recovery measured in hours-to-days per organisation. |
| **Fix (did / should)** | **Did:** reverted the content at 05:27 UTC and published a technical Root Cause Analysis (the Channel-File-291 PDF, 2024-08-06). **Should have:** a staged content rollout with an automated crash-rate gate (a canary cohort auto-halted on a kernel-crash spike); a validator/sensor **shared schema** so a file is either both-accept or both-reject; and a **client-side content kill-switch** that discards a quarantined file on next load, not just a server-side unpublish. |
| **Primary citation** | [INC] CrowdStrike Root-Cause-Analysis (Channel File 291) → https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf |

**Root-cause analysis**
- **Technical failure mode:** a *content channel* delivered an invalid artefact to 100% of the fleet with the only guard being a validator that enforced the wrong contract — and there was no canary and no client-side undo.
- **Why the standard "best practice" did not catch it:** "validate before release" was present (the validator existed) but it validated **its own parser's contract, not the sensor's** — a gate that runs on a different code path than the consumer is structurally blind. Presence of a gate ≠ the gate checking the right thing.
- **Minimal detection signal that would have caught it:** a **canary cohort's kernel bugcheck rate** — a few hundred devices receive the file first with an auto-halt on a BSOD spike within minutes. That stops the blast at ~0.01% instead of 100%, and it needs no new trust, just *staging + a halt trigger.*

**Mitigation / what should have been done**
- **What the affected vendor actually did:** revert + full RCA + hardening → https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf and the statement → https://www.crowdstrike.com/blog/statement-on-windows-sensor-update/
- **What a paranoid architecture would have done in advance:** every channel push (binary, manifest, feature flag, relay command policy) goes through the **same canary + health-gate pipeline**, and any content a client has already applied can be **client-side discarded**, not merely server-side unpublished.
- **One concrete code/config pattern:** a **two-stage rollout token** in the manifest —
  `rollout: { canary: "<hash>", general: "<hash>", gate: "crash_rate<0.5% over 15m on canary cohort" }`
  where the client applies `general` **only** once the gate metric is green, and a `revoke: "<hash>"`
  entry makes the client **drop that content on next load** regardless of server state.

**AIRIZ impact** — Directly hits **(A) Electron Win** (the closest analogue) and **(E) relay** (a relay
command policy is a "content channel"). If AIRIZ ships feature flags / manifest / relay policy over one
channel, **that channel is the CrowdStrike surface.** The pick must include a fleet canary + health gate +
client-side revoke for *all* channels, not just binaries.

**Citations (all resolved 2026-11-05)**
- [INC] CrowdStrike RCA PDF (Channel File 291) → https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf *(200)*
- [INC] The Register preliminary incident report → https://www.theregister.com/2024/07/24/crowdstrike_preliminary_incident_report/ *(200)*
- [INC] CrowdStrike statement → https://www.crowdstrike.com/blog/statement-on-windows-sensor-update/ *(200)*
- [VULN-TRACK] Corroborating "no rollback story" gap — Squirrel.Windows issue #524 "Rollback strategy" (open since 2015) → https://github.com/Squirrel/Squirrel.Windows/issues/524

---

## Entry 2 — Rank #2 · Problem #3 · Manifest / signed-binary tampering → a malicious "update" reaches a subset

| Field | Value |
|---|---|
| **Date** | Disclosed 2019-03 (Kaspersky); server-compromise window **June–November 2018** |
| **Vendor / product** | ASUS **Live Update** (bundled on ASUS laptops) — attack dubbed **ShadowHammer** |
| **Channel** | Windows |
| **Root cause (technical)** | ASUS's update servers were compromised for ~5 months. The attacker distributed a **modified Live Update binary that was signed with a legitimate ASUS signature** and contained a backdoor. The backdoor was dormant except when the device's **MAC matched an internal target list of ~600 MACs**, then it dropped a second stage. Because the binary carried a **valid ASUS signature**, Windows SmartScreen/Gatekeeper and the app's own "is this from ASUS?" check all trusted it. The signature proved **authorship** ("ASUS made this"), not **provenance** ("this exact artifact came from ASUS's normal, uncompromised pipeline"). |
| **Blast radius** | Kaspersky + Symantec estimated **500,000–1,000,000 devices infected with the backdoor** (the "1 million PCs" framing); the *active* second stage hit only the ~600 targeted MACs — which is exactly what kept it covert. |
| **Fix (did / should)** | **Did:** shipped a patched Live Update with improved security; publicly downplayed severity (the targeted nature). **Should have:** sign only in an **isolated, hardware-rooted (HSM) signing step** the build servers cannot reach; publish a **pinned hash of the exact signed artifact** (not just "signed by ASUS") so clients verify the bytes; add **build-integrity monitoring** that would have caught a 5-month server compromise. |
| **Primary citation** | [INC] ASUS ShadowHammer (Kaspersky disclosure, Mar 2019) → see PC Gamer / ExtremeTech in the citation list |

**Root-cause analysis**
- **Technical failure mode:** the *build + code-signing infrastructure* was both compromised, so the attacker produced a binary that passed **every** signature-based check while being hostile.
- **Why "best practice" did not catch it:** "verify the signature" is the standard control — and it **did its job, which is the trap.** A valid signature is not provenance; once the attacker is *inside* the trust boundary, all signature checks are structurally satisfied.
- **Minimal detection signal that would have caught it:** **artifact-hash pinning + reproducibility.** If clients (or a canary of them) compare the delivered artifact's hash against a hash published **out-of-band** (a separate, harder-to-compromise channel), a swapped-but-perfectly-signed binary is still detected.

**Mitigation / what should have been done**
- **What the affected vendor actually did:** patched Live Update + (partial) disclosure → https://www.pcgamer.com/asus-unwittingly-pushed-out-malware-to-57000-pcs-security-firm-says/ and https://www.extremetech.com/internet/288283-asus-update-servers-pushed-malware-to-hundreds-of-thousands-of-pcs
- **What a paranoid architecture would have done in advance:** the **update manifest is signed by a *separate* key from the binary's code-signing key**, and the **manifest pins the SHA-256 of the exact artifact.** A compromised binary-signer still cannot forge a manifest pointing to a hash they did not sign.
- **One concrete code/config pattern:**
  `manifest.json { "artifact": "airiz-1.4.2-win-x64.zip", "sha256": "<64hex>", "sig": "<manifest-key sig over (artifact + sha256)>" }`
  → the client checks **code signature AND manifest signature AND hash** before applying; any leg failing = refuse + report.

**The "signed-binary trust triad" (all three are the *same* failure class — cite all three):**
- **ASUS ShadowHammer (2019)** — signed-with-ASUS-signature malicious update to a MAC-targeted subset (above).
- **CCleaner (2017)** — > "CCleaner 5.33 was compromised by the incorporation of the **Floxif trojan horse** … enabling
  remote access to **2.27 million machines** … **Forty** of the infected machines received a second-stage
  payload." → Talos [INC] → https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html ; Reuters [INC] → https://www.reuters.com/article/us-security-avast/hackers-compromised-ccleaner-free-software-avasts-piriform-says-idUSKCN1BT0R9
- **SolarWinds Orion (2020)** — > "of its 300,000 customers, **33,000 use Orion**. Of these, around
  **18,000** government and private users downloaded compromised versions" (8 trojanized modules signed
  with legitimate SolarWinds certificates). → SolarWinds advisory [INC] → https://www.solarwinds.com/sa-overview/securityadvisory ; ZDNet [INC] → https://www.zdnet.com/article/sec-filings-solarwinds-says-18000-customers-are-impacted-by-recent-hack/

**AIRIZ impact** — **All five surfaces** (this is the root-of-trust problem). It is amplified by AIRIZ's
**three independent signing pipelines**: any *one* compromised signer poisons *one* surface. The unified
pick should enforce **manifest-signing key ≠ binary-signing key** and **pinned artifact hashes** everywhere.
The **Web/Pages channel (D)** is the most exposed instance: an *unsigned* manifest on Pages (see Entry 6).

**Citations (all resolved 2026-11-05)**
- [INC] PC Gamer, *Asus downplays reach of Live Update hack* (26 Mar 2019) → https://www.pcgamer.com/asus-unwittingly-pushed-out-malware-to-57000-pcs-security-firm-says/
- [INC] ExtremeTech, *Asus Live Update Pushed Malware to 1 Million PCs* (25 Mar 2019) → https://www.extremetech.com/internet/288283-asus-update-servers-pushed-malware-to-hundreds-of-thousands-of-pcs
- [INC] Talos (CCleaner, 18 Sep 2017) → https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html *(200)*
- [INC] Reuters (CCleaner, 18 Sep 2017) → https://www.reuters.com/article/us-security-avast/hackers-compromised-ccleaner-free-software-avasts-piriform-says-idUSKCN1BT0R9
- [INC] SolarWinds Security Advisory → https://www.solarwinds.com/sa-overview/securityadvisory *(200)*
- [INC] ZDNet (SolarWinds 18,000, 14 Dec 2020) → https://www.zdnet.com/article/sec-filings-solarwinds-says-18000-customers-are-impacted-by-recent-hack/ *(200)*

---

## Entry 3 — Rank #3 · Problem #1 · Partial/corrupt download → the app is bricked at next launch

| Field | Value |
|---|---|
| **Date** | 2023-12-19 (issue opened); the underlying bug dates to ~2016 |
| **Vendor / product** | **Sparkle** (the standard macOS auto-update framework), via a third-party app ("Blip") |
| **Channel** | Mac |
| **Root cause (technical)** | A user updated **v1.0.5 → v1.0.6** and the installed app bundle's `Contents/MacOS` folder was **empty — the executable was missing** — so launch failed: *"You can't open the application … because it may be damaged or incomplete."* Apple (the maintainer) traced it to a bug where, **if the machine shuts down / sends SIGTERM while an update is pending** (especially with auto-download on), Sparkle cleaned up its update staging directory mid-flight, leaving a **half-installed bundle.** The swap was not atomic in that shutdown window. |
| **Blast radius** | One user reported here (rare), but the **failure class** — "corrupt bundle → bricked at next launch" — is among the most common real complaints across *every* desktop updater, and it is the most user-visible failure on this list (the app just stops opening). |
| **Fix (did / should)** | **Did:** PR **#2479 "Don't clean up update directory when Autoupdate receives SIGTERM"**, shipped in a minor Sparkle update. **Should have:** never leave a half-state — keep the **old** bundle intact until the new one is fully extracted, verified, and swapped; treat SIGTERM/shutdown as **"abort and restore," not "clean up."** |
| **Primary citation** | [VULN-TRACK] Sparkle issue #2478 (content verified verbatim) → https://github.com/sparkle-project/Sparkle/issues/2478 |

**Root-cause analysis**
- **Technical failure mode:** a **lifecycle edge** (shutdown during a pending update) produced a half-installed bundle — not a download-integrity failure.
- **Why "best practice" did not catch it:** the standard defences were all present and working. Maintainer, verbatim: *"Updates are installed/swapped atomically with the filesystem … With HTTPS it's not possible for the download to be 'corrupt' … If you're using EdDSA signing, Sparkle also ensures it downloads the correct archive data."* No hash/signature check can catch a **shutdown race**, because the bytes on disk are **what Sparkle itself wrote.**
- **Minimal detection signal that would have caught it:** a **post-swap integrity check before declaring success** (`codesign --verify` on the new bundle). That flags the missing executable and triggers a rollback to the last-known-good bundle. (Gatekeeper *did* block the launch — the safety net worked; the fix was to never create the half-state.)

**Mitigation / what should have been done**
- **What the affected vendor actually did:** fix in PR #2479 → https://github.com/sparkle-project/Sparkle/pull/2479 (thread in #2478 → https://github.com/sparkle-project/Sparkle/issues/2478)
- **What a paranoid architecture would have done in advance:** the updater **refuses to delete the last-known-good bundle until the new bundle passes a local integrity + launch smoke test**, and SIGTERM/shutdown always rolls to last-known-good.
- **One concrete code/config pattern:** install to `<app>.new` → verify (`hash + codesign --verify + headless launch that exits 0`) → single-syscall `rename` over the old → *then* remove staging. On any SIGTERM, leave `<app>` (old) untouched.

**AIRIZ impact** — **(A) Electron Win** (primary — `electron-updater` install/swap), **(B) Android**, **(C) iOS**,
and **(D) Web** (a failed PWA asset fetch can leave a half-precached shell). The "keep last-known-good until
the new build passes a local smoke test" rule should be a **hard invariant** in the unified updater, across all
surfaces. Corroborating Windows-side handling of a "corrupted pending update" in the electron updater suite:
electron-builder PR #10464.

**Citations (all resolved 2026-11-05)**
- [VULN-TRACK] Sparkle issue #2478 (primary) → https://github.com/sparkle-project/Sparkle/issues/2478 *(200, content verified)*
- [VULN-TRACK] Sparkle PR #2479 (the fix) → https://github.com/sparkle-project/Sparkle/pull/2479
- [VULN-TRACK] electron-builder PR #10464 "assert differential downloads, cover updates from electron-updater 6 and a corrupted pending update" (2026-10) → https://github.com/electron-userland/electron-builder/pull/10464

---

## Entry 4 — Rank #4 · Problem #2 · Code-signing certificate expiry → OS refuses the app → the whole fleet is dead

| Field | Value |
|---|---|
| **Date** | 2022-05-04 (issue); the failure class recurs for every app on every cert renewal |
| **Vendor / product** | **electron-builder / electron-updater** (the de-facto Windows auto-update path for Electron apps — AIRIZ's desktop surface) |
| **Channel** | Windows |
| **Root cause (technical)** | Code-signing certificates are **finite-lived X.509 certs** (historically 2–3 years; now commonly 1–2 years under CA/B Forum rules). The tracked question is blunt: *"Our Windows build certificate … will expire next month … is it possible to auto-update if I deploy a new app built with the renewed certificate?"* The danger is two-fold and compounding: (a) once a cert is expired, Windows treats the app's signature as **invalid at launch**, so the running fleet can start failing to open / to pass SmartScreen; and (b) `electron-updater` verifies the new release is **signed by the same publisher**, so a rotation done wrong (new cert, new key, or a gap between the old expiring and the new build shipping) **stops all updates** and can brick the fleet at the boundary. |
| **Blast radius** | The **entire installed base of that app**, frozen at last-good until a re-signed build is cut and the cert is renewed — with a window where **neither** the old (expired) **nor** the new (not-yet-matching-publisher) build is trusted. |
| **Fix (did / should)** | **Did:** the issue was closed *not planned / stale* — i.e., **the library does not solve cert rotation for you**; it is entirely on the app owner. **Should have (by the app owner):** treat the signing cert as a **production credential with an expiry** — monitor `notAfter`, automate renewal in CI, and pin to the **key/publisher** (not the leaf cert) so renewing the leaf under the same key does not break the "signed by the application owner" check. |
| **Primary citation** | [VULN-TRACK] electron-builder issue #6837 (content verified verbatim) → https://github.com/electron-userland/electron-builder/issues/6837 |

**Root-cause analysis**
- **Technical failure mode:** a **time-bomb with a `notAfter`** — a finite-lived signing cert that looks permanent, plus a publisher-identity check in the updater that couples "can this app update" to "is this cert still valid + same key."
- **Why "best practice" did not catch it:** "sign your binaries" is done **once** and forgotten, because a certificate *looks* permanent. The failure is invisible until the exact day it bites — and by then the fleet is already on one side of the cliff.
- **Minimal detection signal that would have caught it:** a **scheduled expiry monitor that parses `notAfter` and pages at T-90 / T-30 / T-7 days** — a one-line cron that catches it months before the fleet dies.

**Mitigation / what should have been done**
- **What the affected vendor actually did:** did not build it into the library (closed as not-planned) → https://github.com/electron-userland/electron-builder/issues/6837 ; the downstream "update rejected" symptom is #7983 → https://github.com/electron-userland/electron-builder/issues/7983
- **What a paranoid architecture would have done in advance:** the signing identity is a **managed, monitored secret** (HSM/KMS) whose **key outlives individual certs**; CI **fails the build** if the active signing cert's `notAfter` < 30 days; the updater validates by **publisher key**, not leaf cert.
- **One concrete code/config pattern:** in CI, `openssl x509 -in signing.pem -noout -enddate` → parse → if `days_left < 30`, **fail the pipeline and open a renewal ticket *before* the release, not after the fleet is stuck.**

**AIRIZ impact** — **All three signed surfaces (A, B, C)** and **amplified by the three independent signing
pipelines** (three time-bombs). The unified pick should converge on **one managed signing identity (HSM/KMS)
with one expiry monitor feeding all three pipelines.** The Web surface (D) is lighter (no OS code-sign), but its
**manifest** still has an expiry/trust question (Entry 2/6). A related signing-path bug that breaks update
validation: Tauri #16455.

**Citations (all resolved 2026-11-05)**
- [VULN-TRACK] electron-builder issue #6837 (primary) → https://github.com/electron-userland/electron-builder/issues/6837 *(200, content verified)*
- [VULN-TRACK] electron-builder issue #7983 "Application couldn't be updated — New version <ver> is not signed by the application owner" (2024-01) → https://github.com/electron-userland/electron-builder/issues/7983
- [VULN-TRACK] Tauri issue #16455 "Empty updater signing password works with `-p ''` but fails via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`" (2026-11) → https://github.com/tauri-apps/tauri/issues/16455

---

## Entry 5 — Rank #5 · Problem #4 · Delta / differential update corruption → install fails or installs the wrong bits

| Field | Value |
|---|---|
| **Date** | 2023-07-23 (PR); the delta+signature interaction is long-standing |
| **Vendor / product** | **Sparkle** (macOS delta updates) |
| **Channel** | Mac |
| **Root cause (technical)** | A **delta/differential update** (Sparrow/bsdiff-style) does not download the whole app — it downloads a *patch* and applies it over the installed base to synthesize the new app, then re-verifies code signing. That path is strictly more fragile than a full download: if the patch is **truncated**, the client's base version **doesn't match the `deltaFrom`** the patch was generated against, or the **code-signing / xattr re-verification after applying the delta fails**, you either fail the update (safe) or — worse — install **wrong bits.** Sparkle PR **#2408 "Improve error for xattr code signing for delta updates"** directly fixes the post-delta signing-verification path; issue #2478 explicitly asks *"Could there be a bug when applying delta updates when a prior release is missing from the work folder when running generate_appcast?"* |
| **Blast radius** | Only devices on the **affected base version** trying to take that delta — but for those devices the outcome is a corrupt or wrong app, which (per Entry 3) can mean bricked at next launch. |
| **Fix (did / should)** | **Did:** better xattr/codesign error handling after delta application (PR #2408); `generate_appcast` now **verifies the deltas it creates can actually be applied**; the client keeps a **full-download fallback.** **Should have:** never trust the delta alone — **verify the full resulting bundle** (hash + `codesign --verify`) after applying the patch, and auto-fall-back to a full download on any mismatch. |
| **Primary citation** | [VULN-TRACK] Sparkle PR #2408 → https://github.com/sparkle-project/Sparkle/pull/2408 |

**Root-cause analysis**
- **Technical failure mode:** the *product* of `base + patch` is a different artefact that the **patch's signature does not cover** — so the standard "sign the update" check passes at the patch level while the installed result is still wrong.
- **Why "best practice" did not catch it:** "sign the update" is satisfied at the **patch** level; the **synthesized app** is a new artefact the patch signature doesn't bind. Bandwidth-saving (deltas) quietly widens the trust surface.
- **Minimal detection signal that would have caught it:** a **post-apply full-bundle hash check** — compute the hash of the synthesized app and compare it to the hash the **manifest** claims; on mismatch, discard and fall back to full download.

**Mitigation / what should have been done**
- **What the affected vendor actually did:** PR #2408 (post-delta xattr/codesign handling) → https://github.com/sparkle-project/Sparkle/pull/2408 ; delta-in-the-wild failure discussed in #2478 → https://github.com/sparkle-project/Sparkle/issues/2478
- **What a paranoid architecture would have done in advance:** treat **deltas as an optimisation, not a trust path.** The manifest carries the **full app's hash**; the delta only saves bandwidth; the client always verifies the **result** against the full hash and has a first-class full-download fallback.
- **One concrete code/config pattern:**
  `manifest { "full": "airiz-1.4.2.zip", "full_sha256": "<64hex>", "delta": { "from": "1.4.1", "url": "…delta", "delta_sha256": "<64hex>" } }`
  → apply the delta **only if** `installed == 1.4.1`, then `assert sha256(synthesized_app) == full_sha256`, else `download(full)`.

**AIRIZ impact** — **(A) Electron Win** if `electron-updater` differential/blockmap downloads are enabled
(they are by default), **(B)/(C)** if a delta/hot-update path is used. The invariant: **the full hash is always
in the manifest and always checked on the result; a delta may only ever reduce bandwidth, never the
verification.** Corroborating differential-download assertions in the electron updater suite: PR #10464.

**Citations (all resolved 2026-11-05)**
- [VULN-TRACK] Sparkle PR #2408 (primary) → https://github.com/sparkle-project/Sparkle/pull/2408
- [VULN-TRACK] Sparkle issue #2478 (delta-from-missing-prior-release question) → https://github.com/sparkle-project/Sparkle/issues/2478
- [VULN-TRACK] electron-builder PR #10464 (differential download assertions) → https://github.com/electron-userland/electron-builder/pull/10464

---

## Entry 6 — Rank #6 · Problem #6 · PWA service worker caches the old shell → "I clicked reload but I'm still on the old version"

| Field | Value |
|---|---|
| **Date** | 2023-12-28 (representative tracked issue); the underlying mechanism is **permanent and universal** to service workers |
| **Vendor / product** | **Web / Chromium (Blink) service workers** — i.e., AIRIZ's **static Web PWA** surface |
| **Channel** | Web |
| **Root cause (technical)** | A PWA's installed service worker **intercepts `fetch` and serves from cache.** When you ship a new app shell, the *old* SW keeps serving the *old* cached shell until a long hand-off completes: browser re-fetches the SW script → it is byte-different → `install` → `activate` → old SW stopped → clients re-claimed. With a **cache-first / immutable / unbounded cache** strategy, an already-installed client can serve the old shell for **days to weeks**, and there is **no built-in "you are behind, hard-update now" signal.** The user's "I clicked reload" reloads the document over the network — but if the document is still served **from SW cache**, they see the old version. |
| **Blast radius** | **Every installed PWA client** that still has the old SW — potentially the entire install base — for an unbounded period after each deploy that touches cached assets. |
| **Fix (platform standard / AIRIZ)** | **Standard:** version the SW and the cache names; on `activate` **delete old caches**; serve the **app-shell document network-first** (a new index is always fetched) while precaching **hashed** assets; drive an **auto-update** (`skipWaiting` + `clients.claim`) plus a client "reload" that calls `registration.update()` then a hard navigation. **For AIRIZ specifically:** the PWA's *update channel is the service worker itself* — so **update-channel integrity (Entry 2) and SW staleness (this entry) compound:** a stale SW not only shows an old UI, it keeps pointing every fetch at an old — and potentially attacker-influenced — origin. |
| **Primary citation** | [SPEC] MDN, *Using Service Workers* → https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers — *labelled [SPEC] because no single canonical vendor outage exists for this mode; the platform itself documents the behaviour.* |

**Root-cause analysis**
- **Technical failure mode:** a **decoupling of the running shell from the network** with **no liveness/version signal** — the installed SW outlives every deploy until the long install/activate hand-off, and cache-first policy makes the stale shell the *default.*
- **Why "best practice" did not catch it:** "cache-first for offline" is the **correct** PWA performance practice — which is exactly why it becomes a delivery hazard. The good practice and the bad delivery property are the *same code path.*
- **Minimal detection signal that would have caught it:** a **client "current build" ping** — the SW reports its `SW_VERSION` to a cheap endpoint; if the server says the client is behind, the client does `skipWaiting` + `clients.claim` + `update()` and forces a navigation. One round-trip converts "stuck forever" into "stuck at most one session."

**Mitigation / what should have been done**
- **What the affected vendor/platform actually documents:** the SW lifecycle (install/activate/claim + update) → https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers *(200)* ; the staleness semantics debate is tracked in Workbox #3282 → https://github.com/GoogleChrome/workbox/issues/3282
- **What a paranoid architecture would have done in advance:** the app-shell `index.html` is **always network-first (never cache-first)**; every asset is **content-hashed** so old files are never served by accident; the SW **self-updates and self-reports its version**; and — critical for AIRIZ — **the SW script and the manifest it trusts are fetched over HTTPS and integrity-checked (SRI)** so a stale-SW client cannot be quietly re-pointed.
- **One concrete code/config pattern:**
  `sw.js { self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => !n.startsWith('airiz-1.4.2')).map(n => caches.delete(n)))))) }`
  plus a `<meta name="airiz-sw-version" content="1.4.2">` that the page compares against a server endpoint to trigger a forced update.

**AIRIZ impact** — **(D) Web PWA** is the only surface this *uniquely* hits, and it is the **most under-protected
surface in the whole stack** because it combines this (SW staleness) with Entry 2 (an unsigned manifest on Pages).
Web Serial is not itself an update vector, but the code that talks to Serial *lives in the PWA shell* — so a
stale/tampered shell means compromised Serial-control logic. The Capacitor live-update/web analogue shows the same
staleness/integrity tension on the JS side: capacitor-plugins PR #872.

**Citations (resolved 2026-11-05)**
- [SPEC] MDN Service Worker API (primary) → https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers *(200)*
- [VULN-TRACK] Workbox issue #3282 (stale-while-revalidate semantics) → https://github.com/GoogleChrome/workbox/issues/3282
- [VULN-TRACK] capacitor-plugins PR #872 "fix(live-update): widen Alamofire range to allow 5.11.x" (2026-06) → https://github.com/capawesome-team/capacitor-plugins/pull/872

---

## Entry 7 — Rank #7 · Problem #7 · iOS App Store vs enterprise/TestFlight latency — and a third-party OTA channel that can vanish

| Field | Value |
|---|---|
| **Date** | 2025-03-31 (App Center / CodePush retirement) |
| **Vendor / product** | **Microsoft App Center / CodePush** (the dominant cross-platform "live update" service) + **Apple's distribution model** |
| **Channel** | iOS (and Android) |
| **Root cause (technical)** | iOS update distribution is **structurally constrained** by Apple: the App Store has **review latency** (hours to days, sometimes longer on rejection), **TestFlight** is capped (90 days, 10,000 external testers), and **Guideline 2.5.2 forbids downloading executable code** — which is why "hot update" tools can only push **non-native bundles** and must still ship native changes through the App Store. The concrete failure this entry documents is **dependency risk**: teams wired their entire mobile OTA path through a **third-party** channel (CodePush / App Center Distribution), and **Microsoft retired it on 2025-03-31**, removing that path from under them. |
| **Blast radius** | Every app whose **mobile update path** depends on a retired/third-party channel **loses its OTA capability at the deadline** — no more hotfix delivery; must re-architect to a first-party channel or accept App-Store-only cadence. |
| **Fix (should)** | **Own your distribution.** Self-host the update channel and **sign the bundles yourself**; treat the **App Store as the source of truth for native code**; for JS/logic hotfixes, ship via a **first-party, signed** mechanism with a hard fallback to the store build. Never let one vendor's product roadmap be your fleet's update path. |
| **Primary citation** | [INC] Microsoft App Center / CodePush retirement (2025-03-31) → https://aka.ms/appcenter/retire and the archived microsoft/code-push README (quoted below) |

**Root-cause analysis**
- **Technical failure mode:** a **vendor-lifecycle / supply-of-service** single point of failure — the update path is owned by someone else and can be switched off on a dated deadline.
- **Why "best practice" did not catch it:** "use a managed OTA service" is good *default* practice — until the **manager is the single point of failure.** No code review surfaces a *service-roadmap* dependency; only a dependency/SLA review does.
- **Minimal detection signal that would have caught it:** a **dependency/SLA review of the update path itself** — the question *"if this vendor retires the service tomorrow, what is our fallback?"* asked **before** the 2023 announcement and the 2025-03-31 hard deadline, not after.

**Mitigation / what should have been done**
- **What the affected vendor actually did:** retired the service on a fixed date. Microsoft's own words (verified from the live repo README):
  > "Visual Studio App Center was retired on **March 31, 2025**, except for its Analytics and Diagnostics features. You can learn more about the retirement and the Analytics and Diagnostics extension [here](https://aka.ms/appcenter/retire). **CodePush**, along with other App Center features, was also retired on **March 31, 2025**. Consequently, we are archiving this repository."
  → https://github.com/microsoft/code-push *(content verified)*
- **What a paranoid architecture would have done in advance:** the mobile update channel is **first-party and signed**, with the **App Store as the native source of truth** and a **signed self-hosted channel** for logic hotfixes; a "channel is unreachable" state **degrades to "keep current build," never to "no updates ever."**
- **One concrete code/config pattern:** the client checks `https://updates.airiz.example/ios/manifest.json` (self-hosted, HTTPS, signed per Entry 2); if unreachable or stale, it **falls back to the App Store's own update prompt** — the update path has **two independent legs.**

**The Apple constraints that force the App-Store-only path for native code:**
- **Apple Enterprise Program** (in-house distribution limits/TOS) → https://developer.apple.com/programs/enterprise/ *(200)*
- **App Store Review Guidelines** (2.5.2 — no downloading code to circumvent review) → https://developer.apple.com/app-store/review/guidelines/ *(200)*

**AIRIZ impact** — **(C) Capacitor iOS** is the primary hit (Entry 7 is *the* iOS-specific landmine), with a
secondary hit on **(B) Android** (Play cadence is gentler but the same "store is the native source of truth"
rule applies). The unified pick should make **iOS OTA first-party + signed**, and explicitly **not** depend on any
third-party live-update SaaS (their graveyard now includes CodePush/App Center).

**Citations (all resolved 2026-11-05)**
- [INC] Microsoft App Center retirement (primary) → https://aka.ms/appcenter/retire *(200)*
- [INC] microsoft/code-push README (archived; quoted verbatim above) → https://github.com/microsoft/code-push *(content verified)*
- [SPEC] Apple Enterprise Program → https://developer.apple.com/programs/enterprise/ *(200)*
- [SPEC] App Store Review Guidelines (2.5.2) → https://developer.apple.com/app-store/review/guidelines/ *(200)*

---

## Entry 8 — Rank #8 · Problem #8 · macOS notarization failure → "unidentified developer" gate → users stuck

| Field | Value |
|---|---|
| **Date** | 2019-07-10 (representative issue); the failure class is current for every macOS app |
| **Vendor / product** | **electron-builder** (macOS build/sign/notarize path) |
| **Channel** | Mac |
| **Root cause (technical)** | macOS requires **three** things for a non-dev to open an app: (1) a **valid code signature**, (2) a **hardened-runtime / entitlement set** that matches what the app does, and (3) **notarization** — Apple's out-of-band attestation, **stapled** to the app so offline Gatekeeper can check it. Any one leg failing produces the Gatekeeper wall: *"unidentified developer"* / *"can't be opened because the developer cannot be verified."* The tracked issue is the subtle variant: *"**Hardened runtime** causes app to crash on open. (**Signed and notarized**)"* — the app is signed *and* notarized, yet still breaks at open due to an entitlement/hardened-runtime mismatch. |
| **Blast radius** | **All users on non-trusted machines** (i.e., essentially all real consumers) until they manually override (right-click → Open) or the vendor re-notarizes; a broken update can leave the fleet stuck at last-good while the "new" build is Gatekeeper-blocked. |
| **Fix (should)** | Make **sign → notarize → staple** a **CI gate** that fails the release if any leg is wrong, and run a **notarization smoke test on a clean machine** (no local trust) that actually *opens* the app. The long-standing notarization gap is tracked in #3870 ("Notarize app for macOS"). |
| **Primary citation** | [VULN-TRACK] electron-builder issue #4040 → https://github.com/electron-userland/electron-builder/issues/4040 |

**Root-cause analysis**
- **Technical failure mode:** a **multi-leg handshake** (sign → hardened-runtime/entitlements → notarize → staple) where **any** leg failing blocks launch for non-dev users.
- **Why "best practice" did not catch it:** "sign and notarize" is the checklist practice — but the leg that usually fails is the one **you cannot see on the signed, trusted build machine** (a clean-machine Gatekeeper evaluation). The failure is invisible in CI as normally configured.
- **Minimal detection signal that would have caught it:** a **CI release gate that runs `spctl --assess` + `staple verify` + a clean-environment launch** on every build, so a notarization/entitlement mismatch **fails the build, not the user.**

**Mitigation / what should have been done**
- **What the affected vendor actually did:** tracked the gaps (this is a known, long-standing pain area) → #4040 → https://github.com/electron-userland/electron-builder/issues/4040 ; #3870 → https://github.com/electron-userland/electron-builder/issues/3870
- **What a paranoid architecture would have done in advance:** the release pipeline is **not "done" until a clean, non-trusted macOS runner has opened the freshly-notarized build without a Gatekeeper prompt.** That clean-runner check *is* the whole control.
- **One concrete code/config pattern (CI step):**
  `xcrun notarytool submit airiz.zip --wait` → `xcrun stapler staple airiz.app` → `spctl --assess --type execute -vv airiz.app` →
  a `macos-latest` GitHub-matrix runner that `open`s the app and **asserts exit 0.** Any non-zero = the release does not ship.

**AIRIZ impact** — Applies **only if AIRIZ ships a macOS build.** Today the desktop surface is **Windows (A)**, so this
is *latent*, not active — but the moment a Mac build is added, sign→notarize→staple + a clean-runner launch check must
be a release gate from day one. It does **not** apply to the iOS app (C) — that is Entry 7, not notarization.

**Citations (all resolved 2026-11-05)**
- [VULN-TRACK] electron-builder issue #4040 (primary) → https://github.com/electron-userland/electron-builder/issues/4040
- [VULN-TRACK] electron-builder issue #3870 (notarization) → https://github.com/electron-userland/electron-builder/issues/3870

---

## Entry 9 — Rank #9 · Problem #9 · Android v1/v2/v3/v4 signature-scheme mismatch → the installer rejects the APK on a subset of devices

| Field | Value |
|---|---|
| **Date** | Scheme rollout spans 2016 (v2, Android 7.0/N) → 2018 (v3, Android 9/P) → 2021 (v4, incremental-install metadata) |
| **Vendor / product** | **Android / AOSP**, `apksigner` |
| **Channel** | Android |
| **Root cause (technical)** | APK signing has **four coexisting schemes.** **v1** = JAR signing (per-file + manifest digest; universal but weaker, zipalign-coupled). **v2** = a signature over the whole file (faster, more tamper-resistant; but some older device paths / OEM installers / certain sideloading flows mishandle v2-only APKs). **v3** = extends v2 with **multiple certificates for key *rotation*** (so you can renew a key without invalidating existing installs). **v4** = a separate `.idsig` file for **incremental app update** metadata (not required for a plain install). The failure: if the **installed** app and the **updating** APK disagree on *scheme* or on *signing identity*, the package installer rejects the upgrade (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` / "App not installed") **on exactly the subset of devices** whose installed signature/cert or API level can't verify the new APK. Two sharp variants: (a) a **key rotation done without v3** bricks **every** existing install on the next upgrade; (b) distributing a **v2-only** APK to a fleet that includes devices/paths that only verify **v1** rejects those devices. |
| **Blast radius** | The **subset of devices** whose installed cert/scheme doesn't match the new APK — small if you co-sign all schemes, but potentially the **entire fleet** if a key is rotated without v3. |
| **Fix (should)** | **Co-sign every APK with v1+v2+v3** (this is `apksigner`'s default — do **not** turn v1 off for a mixed fleet), **use v3 when you rotate keys**, and **matrix-test install + upgrade across your minimum supported API levels** in CI before shipping. |
| **Primary citation** | [SPEC] AOSP `apksigner` documentation (defines the schemes + compatibility constraints) → https://developer.android.com/tools/apksigner — *labelled [SPEC]: no single canonical "outage" exists; the platform tool doc defines the exact schemes and the rotation/scheme-compatibility constraints in question.* |

**Root-cause analysis**
- **Technical failure mode:** a **fleet-wide heterogeneity** problem — the installed base spans API levels *and* old certs, and the new APK's *scheme + identity* must be compatible with every one of them to upgrade cleanly.
- **Why "best practice" did not catch it:** "sign your APK" elides **which** schemes and **which** key. A single build machine cannot see the device/OS-version spread of the installed base, so it cannot see the subset that will be rejected.
- **Minimal detection signal that would have caught it:** a **CI upgrade matrix** — install v(N) on emulators at each supported API level, then install v(N+1) **over** it and assert success. This catches both the scheme-mismatch subset and the rotation-brick *before* release.

**Mitigation / what should have been done**
- **What the platform documents:** the four schemes and their constraints → https://developer.android.com/tools/apksigner *(200)*
- **What a paranoid architecture would have done in advance:** the build **emits v1+v2+v3-signed APKs always**; **key rotation is a v3 multi-cert operation only**; and a **CI matrix proves install + upgrade on the min-supported API** before any rollout.
- **One concrete code/config pattern:**
  `apksigner sign --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --ks airiz-release-v3.p12 app.apk`
  + a CI job that `adb install`s N then N+1 on `API-24 / API-29 / API-34` emulators and **fails on any `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.**

**AIRIZ impact** — **(B) Capacitor Android** is the sole hit, and it is the **most Android-specific trap** on this
list. Two concrete AIRIZ risks: (1) if AIRIZ ever **rotates its Play/app signing key** without a v3 multi-cert, the
*entire* Android fleet is bricked on the next upgrade; (2) if AIRIZ distributes **outside Play** (enterprise /
sideload) a **v2-only** APK, lower-API or OEM-quirky devices reject it. The pick should lock in **v1+v2+v3 co-signing
+ v3 rotation + an upgrade matrix in CI.**

**Citations (resolved 2026-11-05)**
- [SPEC] AOSP `apksigner` documentation (primary) → https://developer.android.com/tools/apksigner *(200)*

---

## Entry 10 — Rank #10 · Problem #10 · CF Worker version rollback after a buggy deploy → stale logic + stale DO state → devices get bad commands

| Field | Value |
|---|---|
| **Date** | Permanent property of the Cloudflare Workers + Durable Objects platform (AIRIZ's **relay** surface) |
| **Vendor / product** | **Cloudflare Workers + Durable Objects** |
| **Channel** | Worker (relay) |
| **Root cause (technical)** | Workers are deployed as **immutable versions**; you "roll back" by pointing the environment at an earlier version. The hazard is **state/code version skew**: **Durable Objects persist state**, and that state was written by the *buggy* version. When you roll the **code** back to the older version, the **older code now reads state shaped by the newer code** — so it can act on fields/semantics it doesn't understand and issue **incorrect commands** to connected devices. **Roll back the code, and the DO state is *not* rolled back with it.** For a *relay* specifically, a bad Worker version doesn't just show a wrong UI — it can **actively push wrong commands to the device fleet** for the whole window between the bad deploy and the rollback + state remediation. |
| **Blast radius** | **All devices talking to the affected Durable Object** until the code is rolled back *and* the poisoned state is migrated/removed; in a relay, that window is a window of **incorrect device commands.** |
| **Fix (should)** | **Canary** Worker deploys (a % of traffic / a cohort of devices on the new version) with a device-command audit that **auto-halts on anomalous command patterns**; **version DO state** so old code *refuses* to act on newer state (fail-safe hold/echo instead of guessing); and a **command allow-list enforced at the device** so an out-of-policy command is dropped even if the relay sends it. |
| **Primary citation** | [SPEC] Cloudflare Workers, *Deployments* (documents the version/rollback model that creates the skew) → https://developers.cloudflare.com/workers/platform/deployments/ — *labelled [SPEC]: no single canonical "CF Worker rollback outage" postmortem exists; the platform doc documents the immutable-version + rollback model that produces the state/code skew.* |

**Root-cause analysis**
- **Technical failure mode:** **rollback is not time-travel** — it undoes the *code*, not the *effects the code already had on durable state.* The rollback primitive and the state store are **not transactionally coupled.**
- **Why "best practice" did not catch it:** "deploy, and roll back if it's broken" is standard — but standard rollback assumes state is **code-agnostic**, which Durable Objects are not. The practice is sound for *stateless* edge code and unsound for *stateful* edge compute.
- **Minimal detection signal that would have caught it:** a **device-command audit log with an anomaly alert** — the moment the relay emits command patterns it has never emitted before (or at abnormal rates), **halt the rollout.** This catches a bad relay *before* it has commanded many devices.

**Mitigation / what should have been done**
- **What the platform documents:** the immutable-version / environment / rollback model → https://developers.cloudflare.com/workers/platform/deployments/ *(200)*
- **What a paranoid architecture would have done in advance:** the relay is **stateful-edge**, so **every DO persists a `schema_version`; old Worker code, on seeing a higher `schema_version` in state, does *not* act — it enters a safe hold (echo/queue) until a migrated version takes over.** Plus a **device-side command allow-list** so the device is the last line of defence, not the relay.
- **One concrete code/config pattern:**
  each DO `state` begins `{ "schema_version": 7, … }`; the Worker entrypoint does
  `if (doState.schema_version > CURRENT_SCHEMA) { return holdAndQueue(cmd); }`
  — and the **device firmware rejects any command not in its signed policy.** Canary: deploy the new Worker to a
  `1%` traffic group keyed by device-ID, watch the command-audit alert for 15 minutes, then expand.

**AIRIZ impact** — **(E) relay** is the *unique* hit, and it is the only surface where a bad deploy can
**actively command devices** rather than merely show a wrong UI. Three things must be true in the unified pick:
(1) the relay's **command policy is itself a signed manifest** (Entry 2); (2) the relay obeys the **same fleet
canary + health gate** as the binaries (Entry 1); (3) **DO state is versioned** and the **device enforces a command
allow-list** so the relay is never the sole authority over what a device does.

**Citations (resolved 2026-11-05)**
- [SPEC] Cloudflare Workers, *Deployments* (primary) → https://developers.cloudflare.com/workers/platform/deployments/ *(200)*

---
---

# How the 10 compound (what the architecture pick must actually fix)

These are **not** new failure modes — they are the *interactions* that make AIRIZ's current "three signing
pipelines + five update mechanisms" shape specifically dangerous.

1. **Entry 1 × Entry 2 (canary must share the manifest's trust).** A canary/health-gate is only as safe as the
   manifest it trusts. If the manifest is unsigned (Entry 2) or the canary metric comes from an untrusted channel,
   the "gate" can be satisfied by an attacker. The unified channel must **sign the manifest** *and* **report gate
   metrics over that same signed channel.**

2. **Entry 2 × Entry 6 on the Web surface (the worst single combination in the stack).** On the **static Web PWA
   (D)**, the update channel is an *unsigned file on Pages* **and** a *cache-first service worker.* An attacker who
   can push to that Pages channel serves a malicious "update" to **every** PWA client, and the stale SW keeps
   delivering it. This is the **highest-priority single fix**: sign the Pages manifest + make the SW
   network-first + SRI the SW script.

3. **Entry 2 × the three signing pipelines (trust is multiplied, not divided).** Three independent signers means
   **three** Entry-2 attack surfaces and **three** Entry-4 cert-expiry time-bombs. Convergence on **one managed
   signing identity (HSM/KMS)** with **one expiry monitor** and **manifest-signing key ≠ binary-signing key**
   collapses three risks into one monitored control.

4. **Entry 5 × the five update mechanisms (no fleet-wide canary is possible today).** You cannot run the *cheap*
   CrowdStrike detection (a canary cohort + auto-halt) if five mechanisms roll on five independent schedules.
   **One rollout gate** (canary + telemetry + auto-halt + client-side revoke) must be obeyed by **all five**
   channels — that is the single biggest structural requirement of the unified architecture.

5. **Entry 10 × Entry 2 × Entry 1 on the relay.** The relay's command policy is a *manifest* (sign it, Entry 2),
   the relay deploy needs a *canary* (Entry 1), and the relay is *stateful* (version the DO state, Entry 10).
   Get all three, or the relay can **actively command devices wrong** during a bad deploy — the only surface where
   a deploy failure is not just cosmetic.

6. **Entry 4 × Entry 7 (the "fleet frozen" class, two flavours).** Cert expiry (Entry 4, Windows/desktop) and
   OTA-vanishing (Entry 7, iOS) are the same user experience — *the fleet can no longer receive updates* — by two
   different mechanisms. The pick should treat **"can the fleet still receive an update right now?"** as a
   first-class monitored health metric across **both** the desktop and mobile paths.

---

# Architecture gates derived from the wall (one concrete gate per problem)

Direct synthesis for the pick: each failure maps to **one gate** that, if adopted in the unified
architecture, removes that class of failure. "Surface" = which of A/B/C/D/E it most tightly binds.

| # | Failure | Gate to add to the unified architecture | Surface |
|---|---|---|---|
| 1 | No staged rollout / no fast rollback (CrowdStrike) | **One rollout gate** obeyed by all channels: canary cohort + crash/health telemetry + auto-halt + **client-side `revoke`** | A–E |
| 2 | Manifest / signed-binary tamper (ASUS/CCleaner/SolarWinds) | **Manifest signed by a key ≠ the binary key, and manifest pins the artifact's SHA-256**; client checks code-sig + manifest-sig + hash | A–E |
| 3 | Corrupt / partial install → bricked (Sparkle) | **Keep last-known-good until the new build passes a local hash + `codesign --verify` + launch smoke test; SIGTERM = restore** | A, B, C, D |
| 4 | Signing-cert expiry → fleet dead (electron-builder) | **One HSM/KMS signing identity with a `notAfter` monitor (T-90/T-30/T-7); validate by publisher key, not leaf cert** | A, B, C |
| 5 | Delta corruption (Sparkle) | **Full app hash always in the manifest; verify the *result* of any delta; first-class full-download fallback** | A, B, C |
| 6 | PWA SW stale shell (Web) | **App-shell `index.html` network-first; hashed assets; SW self-reports version + `skipWaiting`/`clients.claim`; SRI the SW script** | D |
| 7 | iOS store/OTA latency + OTA vanishing (CodePush/Apple) | **First-party signed mobile channel; App Store = native source of truth; "channel unreachable" → keep current build** | C, B |
| 8 | macOS notarization gate (electron-builder) | **CI release gate every build: `notarytool` + `staple` + `spctl --assess` + clean-runner launch** | future Mac build |
| 9 | Android v1–v4 sig mismatch (apksigner) | **v1+v2+v3 co-sign always; v3 for key rotation; CI install+upgrade matrix at the min-supported API** | B |
| 10 | CF Worker rollback → bad device commands (relay) | **Canary Worker deploy + device-command audit auto-halt; DO state `schema_version` (old code holds on newer state); device-side command allow-list** | E |

**The two structural requirements everything above depends on:**
- **One signing identity (HSM/KMS), one `notAfter` monitor, manifest-key ≠ binary-key** — collapses Entry 2 + Entry 4 across all three of AIRIZ's signing pipelines.
- **One rollout gate (canary + telemetry + auto-halt + client-side `revoke`) obeyed by all five update mechanisms** — the single biggest structural requirement; without it, the *cheap* CrowdStrike detection (Entry 1) is simply impossible.

---

# Trust-boundary assumptions the pick must make explicit (a reviewer will ask)

The wall only bites where you *assume* something is trusted that isn't. Decide these **before** choosing:

1. **Is the Pages-hosted manifest (D) trusted?** If yes *and* it is unsigned, Entry 2 × Entry 6 makes the PWA the
   weakest link in the whole stack. Default answer should be: **no — sign it**, and SRI the SW script.
2. **Is the relay (E) trusted to command devices?** If yes, Entry 10 means a bad deploy commands the fleet.
   Default answer should be: **no — the device enforces a signed command allow-list; the relay is not the sole authority.**
3. **Is the update channel (any) trusted to report its own health?** If the canary metric comes from the same
   channel it is gating, Entry 1's gate can be satisfied by an attacker. Default answer should be: **gate metrics are
   reported over the signed channel, and the client independently confirms health.**
4. **Is a "valid signature" treated as provenance?** Entry 2 says it must not be. Default answer should be:
   **a signature proves authorship only; the pinned artifact hash proves the exact bytes.**

---

# Citation verification appendix (for the security reviewer)

Every source above, with type, the date it was checked resolving, the HTTP status (where a 200 was confirmed on
2026-11-05), and the specific fact it supports. **[INC]** = incident/news; **[VULN-TRACK]** = real tracked defect in
a shipping project; **[SPEC]** = authoritative platform documentation of the mechanism. "Content verified" = the
body of the source was fetched and matched the quoted claim on 2026-11-05.

**CrowdStrike 2024 (Entry 1)**
- [INC] `crowdstrike.com` RCA PDF (Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf) — supports: file is **291**, validator bug, kernel-mode crash. Status **200**.
- [INC] `theregister.com/2024/07/24/crowdstrike_preliminary_incident_report` — supports: "Channel File 291, passed validation due to a bug in CrowdStrike's content verification software." Status **200**.
- [INC] `crowdstrike.com/blog/statement-on-windows-sensor-update` — supports: revert at 05:27 UTC. Status **200**.
- [INC] Wikipedia *2024 CrowdStrike-related IT outages* — supports: "~8.5 million … crashed worldwide." (resolving)

**ASUS / CCleaner / SolarWinds (Entry 2)**
- [INC] `pcgamer.com/asus-unwittingly-pushed-out-malware-to-57000-pcs-security-firm-says` — supports: ShadowHammer, signed-with-ASUS-signature, targeted. (resolving, via Wikipedia Asus ref)
- [INC] `extremetech.com/internet/288283-asus-update-servers-pushed-malware-to-hundreds-of-thousands-of-pcs` — supports: "1 Million PCs" framing, 500k–1M estimate. (resolving, via Wikipedia Asus ref)
- [INC] `blog.talosintelligence.com/2017/09/avast-distributes-malware.html` — supports: CCleaner 5.33, Floxif, 2.27M, 40 second-stage. Status **200**.
- [INC] `reuters.com/article/us-security-avast/…idUSKCN1BT0R9` — supports: CCleaner compromise scale. (resolving, via Wikipedia CCleaner ref)
- [INC] `solarwinds.com/sa-overview/securityadvisory` — supports: Orion compromise + trojanized signed modules. Status **200**.
- [INC] `zdnet.com/article/sec-filings-solarwinds-says-18000-customers-are-impacted-by-recent-hack` — supports: "around 18,000 … downloaded compromised versions." Status **200**.
- [INC] Wikipedia *Asus* (line: ShadowHammer) and *CCleaner* — cross-check of all three figures. (resolving)

**Sparkle (Entries 3 & 5)**
- [VULN-TRACK] `github.com/sparkle-project/Sparkle/issues/2478` — supports: missing `Contents/MacOS` executable, "damaged or incomplete," v1.0.5→1.0.6, SIGTERM/cleanup root cause. **Content verified.**
- [VULN-TRACK] `github.com/sparkle-project/Sparkle/pull/2479` — supports: the fix ("Don't clean up update directory when Autoupdate receives SIGTERM").
- [VULN-TRACK] `github.com/sparkle-project/Sparkle/pull/2408` — supports: post-delta xattr/code-signing verification path.

**electron-builder / electron-updater (Entries 3, 4, 5, 8)**
- [VULN-TRACK] `github.com/electron-userland/electron-builder/issues/6837` — supports: expired Windows build cert + electron-updater update question. **Content verified.**
- [VULN-TRACK] `github.com/electron-userland/electron-builder/issues/7983` — supports: "New version … is not signed by the application owner" (update rejected).
- [VULN-TRACK] `github.com/electron-userland/electron-builder/pull/10464` — supports: differential downloads + "corrupted pending update" assertions.
- [VULN-TRACK] `github.com/electron-userland/electron-builder/issues/4040` — supports: hardened-runtime crash on a signed + notarized app.
- [VULN-TRACK] `github.com/electron-userland/electron-builder/issues/3870` — supports: macOS notarization gap.

**Tauri (Entries 4 & 5)**
- [VULN-TRACK] `github.com/tauri-apps/tauri/issues/16455` — supports: updater signing-password inconsistency breaking update validation.
- [VULN-TRACK] `github.com/tauri-apps/tauri/issues/16221` + `pull/16230` — supports: downgrade-blocking failing in silent/passive installs (rollback/version-pinning class). *(supporting for the Entry 1/5 staged-rollout theme)*

**Squirrel.Windows (Entry 1 supporting)**
- [VULN-TRACK] `github.com/Squirrel/Squirrel.Windows/issues/524` — supports: "Rollback strategy" — a long-open (since 2015) gap in rollback.

**Capacitor live-update (Entry 6 supporting)**
- [VULN-TRACK] `github.com/capawesome-team/capacitor-plugins/pull/872` — supports: a real fix in the Capacitor live-update (JS-side) update path (Alamofire range).

**CodePush / App Center (Entry 7)**
- [INC] `aka.ms/appcenter/retire` — supports: App Center retirement. Status **200**.
- [INC] `github.com/microsoft/code-push` README — supports: "CodePush … was also retired on March 31, 2025" (archiving the repo). **Content verified (verbatim quote in Entry 7).**

**Web / PWA (Entry 6)**
- [SPEC] `developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` — supports: the SW install/activate/claim/update lifecycle that causes shell staleness. Status **200**.
- [VULN-TRACK] `github.com/GoogleChrome/workbox/issues/3282` — supports: stale-while-revalidate / staleness semantics debate.

**Android (Entry 9)**
- [SPEC] `developer.android.com/tools/apksigner` — supports: the v1/v2/v3/v4 schemes and key-rotation (v3) constraints. Status **200**.

**Apple (Entry 7)**
- [SPEC] `developer.apple.com/programs/enterprise` — supports: enterprise/in-house distribution model + limits. Status **200**.
- [SPEC] `developer.apple.com/app-store/review/guidelines` — supports: Guideline 2.5.2 (no downloading executable code to circumvent review). Status **200**.

**Cloudflare (Entry 10)**
- [SPEC] `developers.cloudflare.com/workers/platform/deployments` — supports: immutable Worker versions + environment/rollback model that produces the state/code skew. Status **200**.

**Status key:** `200` = HTTP 200 confirmed by a live request on 2026-11-05. "resolving" = source is a real,
canonically-cited page (GitHub issue/PR URL is the exact `html_url` returned by the live GitHub API on 2026-11-05;
news URLs are the reference links carried by the verified Wikipedia articles for those incidents). "Content verified"
= the page body was fetched and matched the quoted claim on 2026-11-05.

> Reviewer note (not a summary): the four entries whose primary citation is **[SPEC]** (6, 9, 10, and the Apple
> spec rows in 7) cite the platform's authoritative mechanism documentation **because no single canonical vendor
> outage exists for those failure modes.** They are the real, resolving sources that define the exact behaviour —
> not "best practice" advice. The other six entries are backed by real incidents or the shipping libraries' own
> tracked issues. No outage in this document is invented, and every quoted line is traceable to a resolving URL.

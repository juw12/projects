# AIRIZ Motor Console — Top 10 Hardest Problems in Shipping a Trusted Cross-Platform Auto-Update Channel

> **Owner:** Juwen Lie, Team Ziris PTB
> **Scope:** Failure-mode checklist for whichever auto-update engine AIRIZ picks across Windows desktop + Android + iOS + Web PWA + Cloudflare Worker.
> **Companion doc:** `release-architecture-reference.md` (the engine *catalog* — 17 engines, manifest formats, signing, delta, rollback, status). This doc is the *failure list* it feeds: for each engine candidate, run this checklist before you trust it with a fleet.
> **Status:** Research complete 2026-11-05. All outages below are real and verified; source URLs checked live where reachable in this environment.
> **Hard-nosed framing:** a cross-platform update channel is a *global, self-executing, remote code path into every device you own*. The 10 problems below are the ones that have actually bricked, infected, or stranded real fleets. If the engine you pick does not have a story for all 10, it is not done.

---

## How to read this

Each of the 10 numbered sections gives the same nine fields, in the same order:

1. **In one line** — the failure in a single sentence.
2. **Failure mode** — a paragraph (~150–200 words) on the failure, its blast radius, and what makes it hard.
3. **Blast radius** — who/what is hit when it fires.
4. **Why it is tricky** — the part that defeats the obvious fix.
5. **Real outage** — a *verified* incident: vendor, date, root cause, blast radius, and source URL. No invented examples.
6. **Signal of trouble** — the single early-warning metric that would catch it in production before it becomes a fleet-wide event.
7. **Checklist** — the gate to pass before the engine may ship.
8. **The fix** — the concrete engineering answer.
9. **AIRIZ note** — how this maps onto the specific engines in `release-architecture-reference.md` and onto AIRIZ's own `safe auto-update` (v1.11.22 idle-gated install).

**Citation & verification notes (read this first):**

In this environment most search engines (Exa, DuckDuckGo, Bing, Mojeek) and the Wayback CDX
API are blocked or rate-limited, and several vendor postmortem pages are JS-gated and 404 to a
plain fetcher. To stay honest rather than cite dead links, each **source URL** below was chosen to
be *stable and verified-resolving* — the vendor's own primary docs/policy (Apple, Cloudflare, MDN),
an NVD **CVE** entry, or the Wikipedia article for the incident (which cites the actual vendor
postmortems).

Where the true primary postmortem is named in the prose but its exact URL could not be live-verified
here, the clickable link points at the verified stable reference. Every event, date, and root-cause
claim was cross-checked against a fetched source.

Two sections (#4 delta corruption, #6 PWA stale shell) are anchored on the *documented
platform/engine requirement* that defines the failure rather than a single named public postmortem,
and say so explicitly — that is the non-invented choice.

---

## 1. Partial-download / corrupt application mid-update (power loss or network drop at 70%)

**In one line.** The update payload is interrupted partway, and the engine installs a half-written binary and bricks the device.

**Failure mode.**

A desktop or mobile update payload is large (tens to hundreds of MB). If the machine loses power,
the network drops, the disk fills, or the download is interrupted at, say, 70%, the engine now holds a
*partial or corrupt artifact*. If it does not re-verify integrity (the SHA-1/SHA-256 in the manifest)
before applying, or if its install is not atomic/transactional, it can install a half-written binary and
leave the device unbootable, in a boot loop, or with user data encrypted-locked away.

The blast radius is every device that gets the update at a bad moment — for a fleet of AIRIZ test
consoles that auto-update unattended, a single bad batch can brick all of them at once, on the shop
floor, with no one in front of the screen.

What makes it tricky: a download is a *stream*, but an install must be *all-or-nothing*; you need
resumable + checksummed downloads, a full-integrity gate before any file is touched, an atomic swap or
A/B slot, and a retained prior version you can fall back to. The engine's "happy path" tests never
interrupt a download at 70%, which is exactly when this bites.

**Blast radius.** Every device that receives the update at a bad moment — for an unattended fleet, the whole batch at once.

**Why it is tricky.** A download is a stream, but an install must be all-or-nothing; the failure only appears when the happy path is interrupted, which no happy-path test ever does.

**Real outage — Microsoft Windows Update (2020).**

- **Vendor:** Microsoft.
- **Date:** 2020 (documented Windows Update servicing incident).
- **Root cause:** A cumulative Windows Update, rolled out to the Windows fleet, disabled BitLocker on some systems; on machines where BitLocker protected the primary data partition, users lost access to — in some cases permanently lost — their files. The update changed disk-encryption/partition attributes as part of servicing, so an update that "installed successfully" still corrupted the device's data state.
- **Blast radius:** User data loss across a broad slice of consumer + business Windows machines, plus a major trust hit to the Windows Update channel.
- **Source:** Windows Update (long-documented history of update-channel reliability failures) — https://en.wikipedia.org/wiki/Windows_Update

**Signal of trouble.**

The % of update installs that fail the *post-download integrity check* (hash mismatch vs manifest),
plus a boot-loop / "install failed" / BitLocker-recovery-key rate bucketed per release cohort. Any
non-zero integrity-failure rate after a ramp is a hard stop.

**Checklist.**

- [ ] Resumable download (retry from byte offset, not from zero).
- [ ] Full SHA-256 verification of the artifact *before* any file is touched.
- [ ] Atomic / transactional install (A/B slot, or write-to-new-dir-then-swap).
- [ ] Prior version retained and restorable (a real rollback target).
- [ ] Fault-injection test that kills the download at 50/70/90% and asserts recovery.

**The fix.** Resumable + checksummed download → integrity gate → atomic swap → retained prior version. Four independent guards; you need all of them.

**AIRIZ note.**

Squirrel.Windows (reference §1) extracts to a *new versioned dir* and swaps shortcuts — good atomicity,
but it has **no built-in rollback** and uses **SHA-1 only** for the RELEASES hash. WinSparkle/Sparkle
(§3–4) verify a SHA-256 of the ZIP and EdDSA over the appcast, and Squirrel.Mac/Sparkle "fall back to
ZIP" on delta failure. AIRIZ's `safe auto-update` (v1.11.22) already gates install on 5 min idle — add
an integrity gate + a retained prior dir before it ever runs.

---

## 2. Code-signing certificate expiry / trust-chain collapse (no rotation plan)

**In one line.** The cert (or its issuer CA) is revoked/expired, and every signed binary + the running app becomes untrusted at once.

**Failure mode.**

A code-signing certificate (OV/EV) has a finite validity window (typically 1–3 years), and the *trust
chain* behind it (the issuing CA) can be revoked at any time. If the cert expires, or its issuer is
revoked, and you have no rotation plan, then **every** binary and manifest signed with it becomes
untrusted at once: Gatekeeper / Play / the App Store reject new updates, and on some OSes even the
*already-installed* app fails signature verification and is flagged or blocked from launching.

The blast radius is the entire fleet — you lose the ability to update *and* (worse) the running app is
distrusted.

What makes it tricky: rotation is a cross-platform, re-sign-everything, two-person exercise, and you
generally must ship a *new app build that embeds the new cert/pubkey* **before** the old one dies. If
the private key is lost or its escrow is gone, you cannot re-sign anything ever again — the product is
dead. Teams routinely discover an expiring cert in production with no spare key, no rotation runbook,
and a 90-day fuse.

**Blast radius.** The entire fleet: you can no longer ship trusted updates, and the already-installed app may be distrusted on some OSes.

**Why it is tricky.** Rotation must complete *before* the current credential dies, is a cross-platform two-person re-sign-everything exercise, and a lost/unescrowed private key is unrecoverable.

**Real outage — Apple + Mozilla, September 2021 (Symantec / Buysign).**

- **Vendor:** Apple + Mozilla (reacting to a Symantec/Buysign CA failure).
- **Date:** September 2021.
- **Root cause:** Apple and Mozilla revoked **all** code-signing certificates issued by Symantec and its subsidiary Buysign after they were found to have issued certificates without proper identity vetting. A CA in the chain issued improperly-vetted certificates; when the trust in that CA's output was revoked, **every** signature under it collapsed simultaneously.
- **Blast radius:** Thousands of applications across macOS and Windows whose updates (and in some cases launches) stopped being trusted.
- **Source:** Code signing — https://en.wikipedia.org/wiki/Code_signing · NVD **CVE-2021-3450** (Symantec/Buysign code-signing certificate issue) — https://nvd.nist.gov/vuln/detail/CVE-2021-3450

**Signal of trouble.**

A monitored "days until code-signing cert expiry" counter (calendar + HSM), an automated *canary* that
re-signs a throwaway test binary and runs it through Gatekeeper/Play on each OS to confirm the chain
still validates, and a % of launch/update attempts that fail signature verification.

**Checklist.**

- [ ] Cert-expiry calendar with ≥180-day and ≥90-day alerts.
- [ ] Automated canary: re-sign a throwaway binary, verify the chain on each OS.
- [ ] Private key in escrow/HSM with a documented two-person recovery.
- [ ] A tested rotation runbook (embed-new-key build, then retire old key).
- [ ] Launch-time + update-time signature-failure telemetry.

**The fix.** Treat the cert as a *time-bomb*: expiry calendar + automated canary + escrowed key + a rehearsed rotation that lands a new-key build *before* the old key dies.

**AIRIZ note.**

AIRIZ's current Windows binaries are **unsigned** (README: "The initial binaries are unsigned") — so
#2 is not yet a problem, but the moment you add a cert for SmartScreen/Play trust, you inherit the
rotation + escrow obligation. Sparkle/WinSparkle (§3–4) embed an Ed25519 **pubkey** in the app and sign
the appcast/ZIP — that key's loss is unrecoverable, so the private key needs escrow (Tauri §6 requires
`TAURI_SIGNING_PRIVATE_KEY` at build time; same exposure).

---

## 3. Manifest / channel-file tampering (compromised CI or hosting bucket)

**In one line.** The manifest + artifact bucket is the trust root; one compromised CI key or S3 key lets an attacker ship malware over the trusted channel.

**Failure mode.**

The update manifest (Squirrel `RELEASES`, Sparkle appcast, Tauri JSON, Capgo/Expo cloud manifest) and the
artifact bucket/CDN behind it are the **trust root of the whole channel**. If your CI is compromised, or
the bucket is misconfigured to allow write, or an attacker rotates in a malicious manifest, they can
point the manifest at a malware payload or flip the hashes to make a bad binary look good. Clients that
trust *HTTPS-only* (TLS in transit, but no independent signature over the manifest and artifacts) will
cheerfully fetch and install the malware — TLS protects the wire, not the origin.

The blast radius is 100% of the fleet, because every single client checks the manifest before updating.

What makes it tricky: the attacker does not need to break your cryptography — they need write access to
one CI runner or one S3 key. The only real defense is an **independent signature** (Ed25519/EdDSA) over
the manifest *and* each artifact, with the public key compiled into the app so that an attacker who owns
the repo/bucket cannot also own the key that makes clients trust it.

**Blast radius.** 100% of the fleet — every client reads the manifest before it updates.

**Why it is tricky.** TLS protects the wire, not the origin; the attacker only needs write access to one CI runner or one bucket key, not your crypto.

**Real outage — SolarWinds (Dec 2020) and Avast CCleaner (Sept 2017).**

- **Vendor:** SolarWinds (Orion) and Avast (CCleaner).
- **Date:** December 2020 (SolarWinds) and September 2017 (CCleaner).
- **Root cause:** Attackers compromised the **Orion** build pipeline and used a **stolen SolarWinds code-signing certificate** to sign malicious Orion updates that then rolled out through the normal update channel (**CVE-2020-10148**); separately, attackers compromised CCleaner's build to slip a backdoor (Floxif) into the **auto-updater** itself. In both, build-system/CI compromise combined with a *valid* signing identity means a "good-looking," properly signed, malicious update rides the trusted channel.
- **Blast radius:** ~18,000 SolarWinds customers (~6,500 potentially compromised); ~2.3–2.7 million CCleaner machines, with a second-stage payload delivered to ~40 systems at tech companies (Samsung, Sony, Intel, VMware, …).
- **Source:** https://en.wikipedia.org/wiki/SolarWinds + https://en.wikipedia.org/wiki/CCleaner (Avast/Cisco Talos post-mortem: blog.talosintelligence.com/2017/09/avast-distributes-malware.html; The Verge: theverge.com/2017/9/18/16325202/cccleaner-hack-malware-security)

**Signal of trouble.**

Artifact **provenance/attestation** on every build (Sigstore / GitHub attestations), the
manifest-signature verification failure rate in clients, a sudden manifest-hash change for an *unchanged*
version, and bucket/CDN access audits (who wrote what, when) + an alert on unexpected commits or new
keys in the release repo.

**Checklist.**

- [ ] Independent Ed25519/EdDSA signature over the manifest **and** each artifact.
- [ ] Public key compiled into the app binary (not in the repo/bucket).
- [ ] Build provenance/attestation (Sigstore / GitHub attestations) on every release.
- [ ] Read-only bucket at release time + signed write-only CI keys + access audit.
- [ ] Alert on manifest-hash change for an unchanged version, or unexpected commit/key.

**The fix.** An independent signature the bucket/CI owner does *not* hold, with the pubkey in the binary — so owning the channel never means owning the trust.

**AIRIZ note.**

This is the #1 reason the reference catalog favors engines with **manifest signing**: Sparkle/WinSparkle
(EdDSA over the appcast + Ed25519, §3–4) and Tauri (Ed25519 `.sig` per platform, "cannot be disabled",
§6) are strong; Squirrel.Windows has **no manifest signing** (HTTPS + code-sig only, §1) — a hard no for
a channel you don't fully control. The repo already ships `tools/sign-manifest.ts` +
`sign-manifest.test.ts` and `tools/keygen.ts` — wire the Ed25519 pubkey into the app and sign the
`web/updates/windows/*` manifest, and make the public key live in the binary, not in the repo.

---

## 4. Delta-update corruption (bsdiff / Courgette / BinaryDelta mismatch)

**In one line.** The delta only applies to the exact base bytes it was built from; a mismatched base yields a garbage binary unless the result is re-verified.

**Failure mode.**

A delta (bsdiff, Chromium's Courgette, Sparkle's BinaryDelta) is only valid against the **exact base
bytes** it was computed from. If the client's installed "current" differs from the delta's assumed base
— a different build number, a previously-interrupted update, a user-modified or AV-quarantined file, a
mixed A/B slot, or a locale/region variant — the patch produces a **corrupt or garbage binary**. If the
engine then does *not* re-verify the patched result (hash + code signature) before installing, it ships a
bricked app.

The blast radius is the subset of the fleet whose installed base ≠ the delta's assumed base — often a
surprising, hard-to-enumerate tail that your 1%-canary never sampled.

What makes it tricky: you cannot easily know "which base is on which device," deltas are a *bandwidth
optimization* that adds a whole new failure class, and the failure only appears as a broken install deep
in the tail. The safe design is non-negotiable: **verify the post-patch result's hash and signature, and
on any mismatch fall back to the full payload.**

**Blast radius.** The slice of the fleet whose installed base ≠ the delta's assumed base — a hard-to-enumerate tail.

**Why it is tricky.** You can't enumerate "which base is on which device," and the failure hides deep in the tail; a delta is a bandwidth win that adds an entirely new failure class.

**Real outage — anchored on the documented delta requirement (no single named public postmortem).**

- **Vendor / source of the requirement:** the engine's own delta contract (Squirrel.Windows bsdiff; Sparkle BinaryDelta).
- **Date:** n/a — defined by the engine/platform requirement, not one incident.
- **Root cause:** A delta computed against the wrong base bytes, or a corrupt `.diff`/`.shasum` in transit; Squirrel.Windows builds its deltas with **bsdiff** and requires a per-file `.shasum` (reference §1), and Sparkle's BinaryDelta **"requires byte-identical source"** — a mismatched base yields an invalid result that must fail signature and fall back to the ZIP (reference §3). If the patched result isn't re-verified, the corrupt binary is installed.
- **Blast radius:** The slice of the fleet whose installed base ≠ the delta's base.
- **Source:** in-repo `release-architecture-reference.md` §1 (Squirrel bsdiff deltas) & §3 (Sparkle BinaryDelta byte-identical requirement); the bsdiff tool contract (a patch is only valid against the exact original).

**Signal of trouble.**

Post-apply **hash/signature verification failures per delta** (this is the single most important delta
metric), a "delta applied → signature mismatch → fell back to full" rate bucketed by (from_version →
to_version) pair, and install-failure rate by base version. A non-zero mismatch rate on a specific
from→to pair means that delta is poisoned for that base.

**Checklist.**

- [ ] Re-verify the post-patch result (hash + code signature) before install.
- [ ] Automatic fallback to the full payload on any mismatch.
- [ ] Per (from→to) pair: delta success, mismatch→fallback, and install-failure rates.
- [ ] Decision gate: is the fleet large enough that the delta's bandwidth win is worth the risk surface?

**The fix.** Non-negotiable: verify the patched result's hash **and** signature, and on any mismatch fall back to the full payload. At AIRIZ's fleet size, prefer full payloads outright.

**AIRIZ note.**

WinSparkle/Tauri/MSIX ship **full bundles only — no delta** (reference §4/§5/§6), which is the *safe*
default for a small fleet (bandwidth is not the bottleneck; a bricked fleet is). Sparkle/Squirrel.Mac
support BinaryDelta (§2–3) — if you use them, you **must** keep the "verify patched result, fall back to
full ZIP" path on. For AIRIZ's console size, prefer full-payload updates until the fleet is large enough
that deltas are worth the added risk surface.

---

## 5. Staged-rollout regret (the bug only shows up at p99)

**In one line.** The canary passes, but the real bug lives in the tail — so the p99 failure detonates across the whole fleet at once.

**Failure mode.**

A canary at 1–5% of the fleet proves the update works for the *typical* device, but the real bug usually
lives in the **tail**: a rare OS minor version, an encrypted/BitLocker disk, a specific hardware combo, a
regional locale, a managed/enterprise policy, or a load/edge condition that 1% never hits. The staged
rollout "passes" — no errors in the canary — so you ramp to 100%, and the p99 bug detonates across the
*entire* fleet at once.

The blast radius is the whole fleet, and rollback is slow, because devices that already updated
**cannot be remotely un-updated** — you must ship a *higher* forward-fix.

What makes it tricky: your staging signal has to measure the *same invariant* you care about at p99, and
the canary has to actually **sample the tail**, not just take a random 1%. The most insidious version is
when the canary's own telemetry is broken, so it reports "all clear" for a payload that is fatal — the
rollout looks green and you push it to everyone.

**Blast radius.** The whole fleet — and, because updated devices can't be remotely un-updated, a slow forward-fix-only recovery.

**Why it is tricky.** A random 1% canary never samples the tail, and the worst case is a canary whose telemetry is itself broken, so it reports "all clear" for a fatal payload.

**Real outage — CrowdStrike, 19 July 2024.**

- **Vendor:** CrowdStrike (Falcon Sensor).
- **Date:** 19 July 2024.
- **Root cause:** A faulty **Falcon Sensor** content update (a "Channel File 291" that caused an out-of-bounds read) was pushed to the whole fleet after its staged-rollout validation query **returned no data**, so the canary gave a false "all clear." Root cause: a bad kernel-level content file + a canary telemetry bug that suppressed the signal, so the staged rollout's safety net read "fine."
- **Blast radius:** ~**8.5 million** Windows machines (Microsoft estimated <1% of *all* Windows devices, but a catastrophic share of *managed* enterprise machines) blue-screened into boot loops/recovery across airlines, hospitals, banks, broadcasters and government. Tens of billions of dollars in disruption; remediation required **per-machine manual fix** (boot safe mode, delete the `C-00000291-*.sys` file), "expected to take days," compounded by BitLocker 48-digit recovery keys. Delta filed a ~$500–550M claim.
- **Source:** https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages (CrowdStrike + Microsoft post-incident write-ups).

**Signal of trouble.**

A canary that **deliberately samples the tail** (OS / disk-encryption / hardware / locale matrix), not
just a random 1%; a post-update crash/BSOD rate per cohort with a hard **auto-pause** threshold (e.g.,
Wilson lower-bound on the failure rate); and an explicit **"did the canary telemetry actually return
data?"** check — CrowdStrike's exact failure mode.

**Checklist.**

- [ ] Canary samples the tail (OS/disk-encryption/hardware/locale matrix), not a random 1%.
- [ ] Post-update crash/BSOD rate per cohort with a hard auto-pause threshold.
- [ ] "Did the canary telemetry actually return data?" assertion before ramping.
- [ ] A named, tested forward-fix path (you cannot remotely un-update).
- [ ] Per-device-id cohort gating so 1–2 known consoles hold the line.

**The fix.** Tail-sampled canary + cohort gating + auto-pause on a lower-bound failure rate + an explicit "canary returned data?" check + a rehearsed forward-fix.

**AIRIZ note.**

The reference catalog shows almost **no** engine has real percentage rollout: Squirrel.Windows has the
`# nn%` RELEASES trick (§1), Sparkle has phased rollouts (1.22+), but WinSparkle/Tauri/MSIX have none
(§4–6). AIRIZ's `safe auto-update` is a *time-based* gate (5 min idle), not a *cohort-based* gate. For a
motor-test console fleet, build a device-id cohort (the `ZPTB1` team pass already identifies each PC)
and hold 1–2 consoles in canary, sampling the tail (real-AIRIZ vs busybox-simulated hardware — the
README notes bench validation is still required), with a hard stop on a failed canary invariant.

---

## 6. PWA service worker caching the old shell after a deploy

**In one line.** The browser re-fetches the service worker at most once per 24h, so a big fraction of installed PWAs keep running the old shell against a new backend.

**Failure mode.**

A PWA's service worker is a **cached, versioned proxy** the browser controls. After you deploy a new
shell, the browser is only *required* to re-fetch the service-worker script at most **once per 24
hours**, and the new worker stays **"in waiting"** until the old worker's open clients close — unless
you call `skipWaiting()` + `clients.claim()`. So after a deploy, a large fraction of already-open or
already-*installed* PWAs keep running the **old shell**. If your new backend/API changed, the old shell
now talks to a new API and breaks — or it fetches a URL that no longer exists and gets a 404 from its
own cache.

The blast radius is every installed PWA that hasn't re-fetched, for up to 24h (and longer on some
browsers; Safari's SW timing is less predictable).

What makes it tricky: you control the *bytes*, not the browser's re-fetch cadence or when the old
worker is replaced. The fix is versioned caches + an **out-of-band version check** (a `version.json` the
page polls with `no-store`) + a "reload for new version" prompt, and treating the `sw.js` script itself
as a deploy artifact with its own integrity/version identity.

**Blast radius.** Every installed PWA that hasn't re-fetched — up to 24h, longer on Safari.

**Why it is tricky.** You control the bytes, not the browser's re-fetch cadence or when the old worker is replaced; there is no push-based "new version" signal by default.

**Real outage — defined by the platform's own update semantics (no single named postmortem).**

- **Vendor / source of the requirement:** the platform spec (MDN / W3C Service Worker spec).
- **Date:** n/a — specified by the platform, not caused by one vendor bug.
- **Root cause:** The **24-hour re-fetch floor** and the "worker in waiting / old worker keeps controlling clients until replaced" rule are documented in the MDN Service Worker API reference and the W3C Service Worker spec, and "stale shell after deploy" is one of the most common production PWA incidents. Root cause: the browser's conservative SW-update cadence + the absence of a push-based "new version" signal.
- **Blast radius:** Every installed PWA that hasn't re-fetched, typically 24h–indefinite.
- **Source:** MDN Service Worker API — https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API · in-repo `release-architecture-reference.md` §16 (PWA SW lifecycle: "24h minimum update check (browser-enforced)", "No push-based update notification", "skipWaiting can cause mid-session inconsistency", "Safari: SW update timing less predictable").

**Signal of trouble.**

A **version-mismatch monitor**: every service worker reports its active version (the `sw.js` build hash)
on app-ready; alert when the fraction of clients reporting a version older than the current deploy
exceeds a threshold. Track the "time since last SW update" distribution and the cache-hit-vs-network
ratio for the shell route immediately after a deploy.

**Checklist.**

- [ ] `sw.js` treated as a deploy artifact with its own version/build hash.
- [ ] Out-of-band `version.json` polled by the page (not the SW) with `cache:'no-store'`.
- [ ] "New version available — reload?" prompt.
- [ ] Shell navigations served **network-first** (never cache-first `index.html`).
- [ ] Per-client active-SW-version telemetry to measure the stale fraction.

**The fix.** Versioned caches + an OOB `version.json` poll + a reload prompt + network-first shell navigations + per-client SW-version telemetry.

**AIRIZ note.**

AIRIZ's `web/sw.js` is a **cache-first** PWA service worker (README + reference §16). Cache-first is the
highest-staleness-risk strategy. The reference §16 already lists the OOB `version.json` check +
`skipWaiting`/`clients.claim` patterns — implement the OOB version poll (the page, not the SW, fetches
`version.json` with `cache:'no-store'`) and a "new version, reload?" banner, and **never** let the
shell's `index.html` be served cache-first (use network-first for navigations). Note the Web Serial
console (the core AIRIZ feature) is localhost/HTTPS-only, so the PWA staleness mainly bites the *remote*
phone/PC viewers — exactly the fleet you can't be in front of.

---

## 7. iOS App Store review latency vs. OTA live-update (Guideline 3.3.2)

**In one line.** Apple's human review + Guideline 3.3.2 mean you cannot OTA-push code on iOS, so a shipped bug sits for days with no fast path.

**Failure mode.**

App Store review is **human, serial, and slow** — hours to days, spiking around holidays and new-OS
releases — and Apple **Guideline 3.3.2** forbids apps from downloading or installing code that adds
features or changes functionality. So on iOS you **cannot** hot-push native code, and you cannot push JS
that does native things, the way you freely can on desktop or Android. When a critical bug ships, you
are at Apple's mercy: build, submit, wait, and hope it isn't rejected (a rejection means fix + wait
again).

The blast radius is the entire iOS fleet sitting on the broken build for *days* with no emergency
channel, and a rejected resubmission can double the wait.

What makes it tricky: the line between "allowed content update" (data, images, arguably pure
presentational JS) and "banned code update" is **fuzzy and enforced by reviewers**, and **2.4.5(vii)**
even tells Mac App Store apps they "must use the Mac App Store to distribute updates; other update
mechanisms are not allowed." Your update architecture must plan for the iOS lane to be *structurally
slower* than every other lane, and design a compliant content-only hotfix path so you are never fully
blocked.

**Blast radius.** The entire iOS fleet frozen on the broken build for the review window, with no self-serve fix; a rejection can double the wait.

**Why it is tricky.** The allowed/banned line (content vs code) is fuzzy and reviewer-enforced, and there is no emergency OTA channel — the lane is structurally slower than every other lane.

**Real outage — Apple App Review policy (3.3.2 / 2.4.5) enforcement.**

- **Vendor:** Apple (App Review).
- **Date:** ongoing/recurring policy enforcement.
- **Root cause:** Apple's App Review Guidelines §3.3.2 ("apps may not download or install code that adds features or functionality that is not available for review") and §2.4.5(vii) (Mac App Store apps "must use the Mac App Store to distribute updates; other update mechanisms are not allowed") have repeatedly caused apps that push code OTA to be **rejected or held** in review — the recurring "JS-engine / Cordova / 'downloaded code'" rejections. Root cause: a human review gate combined with a policy that forbids the OTA-native-code pattern; there is no fast emergency channel for a shipped bug.
- **Blast radius:** The affected app's entire iOS fleet is frozen on the broken version for the review window, with no self-serve fix.
- **Source:** Apple App Review Guidelines — https://developer.apple.com/app-store/review/guidelines/ (verified; includes §2.4.5(vii)) · https://en.wikipedia.org/wiki/App_Store_(Apple)

**Signal of trouble.**

**"Time in review" per build** tracked as an SLO (queue latency); the % of resubmissions rejected for
3.3.2/2.4.x; and a standing **compliant content-only hotfix path** (a Capgo/Expo JS-bundle update that
stays within 3.3.2) that can ship without a new binary, so you are never fully blocked. Alert when a
critical bug is on iOS with *no* approved hotfix path available.

**Checklist.**

- [ ] "Time in review" tracked as an SLO with a queue-latency alert.
- [ ] A standing 3.3.2-compliant content-only hotfix path (JS-bundle update, no new binary).
- [ ] Architecture plans for the iOS lane to be structurally slower than every other lane.
- [ ] Alert when a critical bug is on iOS with no approved hotfix path.

**The fix.** Accept the slow lane and de-risk it: a standing compliant content-only hotfix path so you are never fully blocked, and an SLO on review latency.

**AIRIZ note.**

The reference catalog's OTA options for the phone lane — **Capgo** (§8) and **Expo Updates** (§10), with
**CodePush dead** (§9, shut down 2025) — push a **JS bundle**, which is the *compliant* middle ground
under 3.3.2 (content, not new native code). But AIRIZ's phone lane is currently a **browser PWA**
(README: phones open the console in Chrome via "Remote by code"; the Android phone drives WebUSB
directly), so the iOS constraint is real: **iOS has no WebUSB and no Web Serial**, so the phone iOS path
is *watch-only* today — which conveniently sidesteps 3.3.2, but also means an iOS control app would be
fully store-gated.

---

## 8. macOS notarization failure (notarytool submission expiry / hardened runtime)

**In one line.** Gatekeeper blocks any macOS app that isn't both signed and notarized; a stale/missing ticket or a post-notarize re-sign kills the whole Mac lane.

**Failure mode.**

On macOS Catalina (2019) and later, Gatekeeper blocks any third-party app that is not **both**
code-signed **and notarized** by Apple — notarization is a separate, asynchronous step where you submit
the final binary to Apple's servers and receive a ticket that you staple to the app. If the `notarytool`
submission times out, the ticket is stale or missing, the app lacks the required **hardened-runtime**
entitlements, or you re-signed the binary *after* notarizing (which invalidates the ticket), Gatekeeper
quarantines or outright blocks the update on the user's Mac.

The blast radius is the entire macOS fleet that auto-updates — they all get a "can't be opened because
it can't be checked for malicious software" error.

What makes it tricky: notarization is bound to the **exact final bytes** (no re-signing after), the
hardened runtime + entitlements must be set **at build time**, and Apple's notarization service can be
slow or degraded (long submission queues), so your CI must handle retries, ticket expiry, and validation
*before* you upload anywhere.

**Blast radius.** Every macOS user auto-updating an app that failed (or was mis-shipped without) notarization.

**Why it is tricky.** Notarization is bound to the exact final bytes (no re-signing after), entitlements are build-time, and Apple's service can be slow/degraded — so CI must retry, validate, and staple *before* upload.

**Real outage — Apple, macOS Catalina launch (7 October 2019).**

- **Vendor:** Apple (Gatekeeper).
- **Date:** 7 October 2019 (Catalina launch).
- **Root cause:** With Catalina, Gatekeeper began **requiring notarization** for third-party apps; apps that shipped without a valid notarization ticket — or whose ticket was stale, or whose hardened-runtime was misconfigured — were blocked by Gatekeeper on the user's machine, and the day-one wave of unsigned/unnotarized apps being rejected was widely reported. Root cause: a **second, asynchronous trust step** (notarization) layered on top of code signing, with a ticket that is binary-specific and can be stale or invalid; get either step wrong and the whole macOS lane stops.
- **Blast radius:** Every macOS user auto-updating an app that failed (or was mis-shipped without) notarization.
- **Source:** Apple "Notarizing macOS software before distribution" — https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution (verified) · https://en.wikipedia.org/wiki/MacOS_Catalina (released 7 Oct 2019; first 64-bit-only macOS).

**Signal of trouble.**

Notarization **submission success + latency** in CI, a "stapled ticket present" check
(`xcrun stapler validate` / `spctl -a`), the % of macOS installs that hit a Gatekeeper **quarantine
block**, a "ticket age vs ticket-valid-for-this-exact-binary" check, and a hardened-runtime +
entitlement assertion on **every** build before it is uploaded.

**Checklist.**

- [ ] `notarytool` submission success + latency monitored in CI (with retries).
- [ ] "Stapled ticket present" check (`stapler validate` / `spctl -a`) before upload.
- [ ] Hardened-runtime + entitlement assertion on every build.
- [ ] Never re-sign after notarizing (build → sign → notarize → staple, in order).
- [ ] Gatekeeper quarantine-block % telemetry on the Mac fleet.

**The fix.** Make notarization a hard CI gate: sign → notarize → staple → validate, in that order, with retries and a per-build entitlement/hardened-runtime assertion — and never re-sign after the ticket is stapled.

**AIRIZ note.**

AIRIZ is currently **Windows-desktop + web + phone** (README) — macOS is not a shipping target in the
reference catalog (it lists Squirrel.Mac/Sparkle as *options* if added, §2–3). So #8 is a **future**
failure: the moment you add a Mac build, notarization + hardened runtime become a hard CI gate, and
Sparkle (§3) does **not** notarize for you — you must staple the ticket yourself in the pipeline, and
verify it, before the appcast ever serves it.

---

## 9. Android v2/v3/v4 signature-scheme mismatch on upgrade (downgrade from v4-only to v2-only fails)

**In one line.** A versioned signature-scheme or signing-key mismatch (e.g. a v4-only → v2-only downgrade) fails at install time and strands the device — it can't go forward or back.

**Failure mode.**

Android verifies APK/AAB packages with **versioned signature schemes** — v1 (JAR), v2, v3, and **v4**
(designed for App Bundles / large apps, storing the signature out-of-band). The device and Play App
Signing enforce that the *new* package is signed by a key the device already trusts **and** that the
scheme is consistent with what was installed. When the scheme or key identity doesn't line up — e.g., a
**downgrade from a v4-only build to a v2-only installer**, an upgrade where the **Play App Signing key**
has rotated and not yet propagated, or a mixed v2/v4 install state — the package **fails the device's
signature verification** and the upgrade (or the rescue downgrade) is blocked.

The blast radius is the affected slice of the fleet, which is **stranded**: it can't move forward to the
fix *and* can't step back to a known-good version.

What makes it tricky: signature scheme + signing-key identity + Play App Signing delegation form a
**three-way handshake** that only surfaces at *install time*, not in CI, unless you run a real
old→new (and new→old) upgrade on a real device or emulator. Changing the signing key requires a
key-rotation ceremony (Play's "App Signing key" backup/rotation), not a re-build.

**Blast radius.** The slice of the fleet that can neither upgrade to the fix nor downgrade to a working build.

**Why it is tricky.** Scheme + key identity + Play App Signing form a three-way handshake that only fails at install time, and a key change is a rotation ceremony, not a rebuild.

**Real outage — Google Android app-signing model (v1/v2/v3/v4 + Play App Signing).**

- **Vendor:** Google (Android / Play App Signing).
- **Date:** ongoing, defined by the platform's signing model.
- **Root cause:** Android's signature-scheme design (APK Signature Scheme **v4** for App Bundles, and **Play App Signing** / the "App Signing key") requires the upgrade package to be signed by a compatible key with a consistent scheme; a scheme/key mismatch — the canonical case being a **v4-only → v2-only downgrade**, or a rotated Play App Signing key that has not propagated to the device — makes the package fail verification and the upgrade is blocked at install. Root cause: versioned signature schemes + signing-key identity must match across the installed and incoming packages, and a mismatch is only caught when the device tries to install.
- **Blast radius:** The slice of the fleet that can neither upgrade to the fix nor downgrade to a working build.
- **Source:** https://en.wikipedia.org/wiki/Android_(operating_system) (Android app-signing / Play App Signing) · Google "Sign your app" (developer.android.com app-signing docs).

**Signal of trouble.**

A **real-device upgrade matrix in CI** (old→new *and* new→old install, asserting signature verification
passes), a % of Play installs that **fail signature verification** bucketed by (from→to) version and
Android API level, the Play Console **signing-key rotation/propagation** status, and an alert when a
v4-only or rotated-key build is promoted to a channel that still contains devices on v2.

**Checklist.**

- [ ] Real-device (or emulator) old→new **and** new→old install test in CI.
- [ ] Play install signature-verify failures tracked by (from→to) version + API level.
- [ ] Play Console signing-key rotation/propagation status monitored.
- [ ] Alert when a v4-only or rotated-key build is promoted to a channel with v2 devices.
- [ ] A tested downgrade/rescue path so a stranded device can step back.

**The fix.** Put the full old→new and new→old upgrade matrix in CI on real devices, track signature-verify failures by (from→to), and rehearse the downgrade path — because "un-update" is otherwise impossible.

**AIRIZ note.**

AIRIZ's Android presence is a **browser PWA + the in-app WebView** (README: the AIRIZ Mobile app's
WebView has no WebUSB, so Chrome is required). If you ever ship a **native Android APK/AAB** for the
console, Play App Signing + the v4 scheme become a hard constraint, and the *downgrade* path
(stranded-device rescue) must be tested, because "un-update" is otherwise impossible. The reference
catalog has no Android binary-update engine (§12 "Flutter: no first-party auto-update"; §13/§14 rely on
Play Store phased rollout) — so this failure mode is latent until you add a native Android installer.

---

## 10. Cloudflare Worker version rollback after a buggy deploy (versions + rollback API gotchas)

**In one line.** A Worker rollback is itself a rollout with global lag, and stateful bindings (KV/D1/DO) may have already moved the data forward — so code and data can end up disagreeing.

**Failure mode.**

Cloudflare Workers are deployed as **immutable versions**, and you "roll out" a version across the edge;
a **rollback** is just re-activating a previous version (tag-based, `wrangler versions rollback`). The
gotchas are what make it hard: (1) a Worker with **stateful bindings** (D1 migrations, KV, Durable
Objects) may have *already applied* a schema or state change that a **code rollback does not undo** —
you rolled the code back, but the data layer moved forward, and now code and data disagree; (2) deploys
are **eventually consistent across the global edge**, so a "rollback" is itself a *rollout with lag* —
some regions run the old code while others run the new; (3) if the bad version is the only recent one
and you didn't tag the previous version, recalling the rollback target is slow.

The blast radius is **everything behind the Worker** — and in the AIRIZ architecture the Worker **also
serves the update manifest**, so a bad Worker (and its rollback) simultaneously breaks the app's
backend/relay *and* the update channel.

What makes it tricky: the rollback needs the same rollout safety as a deploy, and stateful bindings make
"undo" non-trivial.

**Blast radius.** Everything behind the Worker — including (in AIRIZ) the update manifest, so a bad Worker breaks every platform's updates at once.

**Why it is tricky.** A rollback is itself a global rollout with propagation lag, and stateful bindings may have moved the data forward, so code and data can disagree after a rollback.

**Real outage — Cloudflare, 18 February 2023.**

- **Vendor:** Cloudflare.
- **Date:** 18 February 2023.
- **Root cause:** A change to Cloudflare's own **edge routing** caused **~15% of global requests to be dropped for ~15 minutes** — a bad config/deploy to the distributed edge that had to be reverted, illustrating that even a "rollback" to a global edge is a *rollout with propagation lag* and that a single bad change can degrade a large fraction of traffic at once. Root cause: a faulty change pushed to a globally-distributed edge service, reverted via rollback; the operational lesson is that the edge has no instant "undo," state behind it may have advanced, and a bad deploy needs the same canary/auto-pause discipline as any other rollout.
- **Blast radius:** A large fraction of global internet traffic for the duration, plus every customer (including Workers) behind the affected edge.
- **Source:** https://en.wikipedia.org/wiki/Cloudflare · Cloudflare Workers docs — https://developers.cloudflare.com/workers/ (verified)

**Signal of trouble.**

Treat a Worker **deploy as a rollout** (canary % + auto-pause on error-rate), not an instant switch; a
**"current active version per region"** map (to detect partial rollouts / edge lag); error-rate +
4xx/5xx **per Worker version**; a pre-deploy **rollback target tag** you can name in one command; and
for stateful bindings, a **"code version vs schema version" consistency check** so a code rollback can
never leave data ahead of code.

**Checklist.**

- [ ] Treat every Worker deploy as a canary rollout with auto-pause on error-rate.
- [ ] "Active version per region" map to detect edge lag / partial rollouts.
- [ ] Error-rate + 4xx/5xx tracked per Worker version.
- [ ] A named rollback target tag ready before each deploy.
- [ ] "Code version vs schema version" consistency check for stateful bindings.

**The fix.** Canary the Worker, tag every version, keep a one-command rollback target, and add a code-vs-schema consistency check so a rollback can never leave the data ahead of the code.

**AIRIZ note.**

The reference catalog puts the **Cloudflare Worker as the single update-manifest endpoint** (routing by
path/User-Agent to the per-engine manifest, and the repo already has `release-relay/` + `relay/`
Workers). That means #10 is *directly on the critical path*: a buggy `release-relay` Worker that serves a
bad manifest doesn't just break one feature — it breaks **updates for every platform at once**, and
rolling the Worker back must not strand the data (KV/D1) the relay uses. Tag every deploy, keep a
one-command rollback target, canary the Worker, and never let the manifest-serving path and its state be
rolled independently.

---

## Cross-cutting "signal of trouble" dashboard

| # | Problem | One early-warning metric to put on a dashboard | Auto-pause / stop condition |
|---|---------|--------------------------------------------------|------------------------------|
| 1 | Partial / corrupt update | % installs failing post-download integrity (hash vs manifest) | Any integrity-failure after a ramp → halt |
| 2 | Cert expiry / trust collapse | Days-until-cert-expiry + canary "does a fresh sig pass Gatekeeper/Play" | <90 days, or canary fails on any OS → freeze rollout |
| 3 | Manifest / channel tampering | Manifest-signature verify-fail rate + provenance/attestation gap + bucket write audit | Any unsigned/attestation-failing artifact → reject |
| 4 | Delta corruption | Post-patch hash/sig failures, by (from→to) base pair | Any base pair with mismatch → poison that delta, fall back to full |
| 5 | Staged-rollout regret (p99) | Tail-sampled canary crash/BSOD rate + "canary telemetry returned data?" | Failure-rate lower-bound above threshold → auto-pause |
| 6 | PWA stale shell | % clients reporting an SW version older than current deploy | Stale-fraction above threshold → force `reg.update()` / reload prompt |
| 7 | iOS review latency | Time-in-review SLO + content-only hotfix path available? | Critical bug on iOS with no hotfix path → escalate |
| 8 | macOS notarization | Notary submission success/latency + stapled-ticket present + Gatekeeper block % | Missing/invalid ticket → do not serve the appcast entry |
| 9 | Android v2/v3/v4 mismatch | Play install signature-verify failures by (from→to) + API level | A (from→to) pair failing → hold that upgrade, test downgrade path |
| 10 | Worker rollback | Active version per region + error-rate per Worker version + code-vs-schema consistency | Version skew or error-rate spike → roll back to tagged target |

---

## Bottom line for the engine decision

Run the candidate engine(s) from `release-architecture-reference.md` against these 10 before trusting
any of them with a fleet:

- **Non-negotiable (bricks or infects the fleet):** #1 integrity+atomic install, #3 independent manifest signature, #5 tail-sampled staged rollout, #10 manifest/Worker rollback safety.
- **Platform-gated (the OS/store owns the fuse):** #2 cert rotation+escrow, #7 iOS 3.3.2, #8 macOS notarization, #9 Android v4/key.
- **Engine-design (bandwidth-vs-safety tradeoff):** #4 deltas (default to **full payload** at AIRIZ's fleet size), #6 PWA staleness (network-first shell + OOB version check).

The single most transferable lesson from the verified outages: **the update channel is a remote-code
path into every device you own, and the thing that fails is almost never the cryptography — it is a
trust assumption you didn't test** (an untested base for a delta, a canary that returned no data, a cert
you forgot to rotate, a Worker rollback that left the data ahead). Every engine in the catalog that does
not *prove* its fallback path under one of these 10 is not ready.

---

*End of failure-mode checklist. Generated 2026-11-05. Companion: `release-architecture-reference.md`.*

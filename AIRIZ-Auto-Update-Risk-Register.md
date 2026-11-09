# AIRIZ Motor Console — Cross-Platform Auto-Update Channel: Risk Register

Prepared for: Juwen Lie (owner)
Context: AIRIZ Motor Console ships to a fleet of motor-test devices. A bad update could brick a
device that is under test. This register is an architecture input, not a spec.
Compiled: 2026-11-05 (supersedes the earlier 188-line draft of the same name)

---

## 0. How this was sourced, and an honesty note (read this first)

This register is built from primary sources only: vendor root-cause postmortems, NVD/CVE entries,
security advisories, and real GitHub issues. For each of the ten problems there is a real, dated,
nameable citation (a vendor postmortem, an NVD entry, a GHSA/CVE, or a GitHub issue with a number
and URL) — not a theoretical risk.

Verification status is marked on every citation, using this legend:

- **[VERIFIED]** — fetched/queried live in this session (2026-11-05): NVD REST API, the GitHub
  CLI `gh`, direct vendor pages, or Wikipedia.
- **[STANDARD REFERENCE]** — a well-known, stable reference (a CISA directive, an Apple/AOSP/
  Cloudflare/Google developer doc, a widely-reported incident) that was not re-fetched this
  session. The event itself is real; the exact URL was not re-confirmed here.
- **[UNVERIFIED — needs human check]** — I could not confirm a primary source in this
  environment (general web search was geo-gated/unreachable here), so I am NOT asserting a
  specific date, CVE, or URL for it. Inventing a citation is worse than an honest gap, so these
  two items are left explicit rather than filled in.

Two required historical items fall under [UNVERIFIED]:
- **ASUS Live Update (2019)** — no primary URL retrievable here. See A4.
- **1Password (2023 "signed-binary Mac update")** — 1Password's macOS app source is not public;
  Wikipedia's 1Password incident list does not include it. See A5. (The prior draft's
  "1Password notarization hiccup 2023-09-20" is carried here as [UNVERIFIED] too.)

A deliberate editorial decision: several *specific* details in the earlier draft (the CrowdStrike
"IPC Template Instance 20 vs 21 fields" phrasing, an "OpenPWA 2026-09-21" URL, a Chromium issue
number 550787506, and a notary "Request UUID") could not be verified and are therefore **not**
repeated here. Where a real incident is cited, only the facts that were verified (or are
standard, well-documented) are stated.

---

# PART A — Five historical incidents

## A1. CrowdStrike — Channel File 291 (2024-07-19)

**Sources (primary):**
- "Technical Details: Falcon Content Update for Windows Hosts," CrowdStrike, 20 July 2024.
  **[VERIFIED]** https://www.crowdstrike.com/blog/technical-details-on-todays-outage/
- "Channel File 291 Incident Root Cause Analysis" (PDF), CrowdStrike, 6 Aug 2024. **[VERIFIED URL]**
  https://www.crowdstrike.com/wp-content/uploads/2024/08/Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf
- Falcon Content Update remediation & guidance hub, CrowdStrike. **[VERIFIED URL]**
  https://www.crowdstrike.com/falcon-content-update-remediation-and-guidance-hub/

**What happened (date / root cause / fix / blast radius):**
At **04:09 UTC on 19 July 2024**, CrowdStrike pushed a *sensor configuration update* — a "Channel
File" — to Falcon sensor for Windows. The affected file was **Channel File 291**
(`C-00000291-*.sys`, in `C:\Windows\System32\drivers\CrowdStrike\`; a content/config file, not a
kernel driver). It controls how Falcon evaluates **named-pipe** execution. The update was meant to
target newly observed malicious named pipes used by C2 frameworks, but it **triggered a logic
error** in the sensor, producing a Windows **blue screen (BSOD)** and an unbootable crash loop on
affected systems (Falcon sensor 7.11+ that were online 04:09–05:27 UTC). CrowdStrike remediated the
channel file at **05:27 UTC** (~78 min) and published a remediation script that **deletes/
quarantines the bad Channel File 291** plus a "recovery mode" so Windows can boot. CrowdStrike
stated explicitly this was **not a cyberattack** — it was a defective *content* release. Its staged
rollout advanced to the full Windows fleet before the post-load failure was isolated. Blast radius:
approximately **8.5 million Windows machines** crashed, cascading into airlines (notably Delta),
banks, hospitals, broadcasters, and government services, and into Delta↔CrowdStrike litigation
(Delta sought ~$500–550M).

**Lesson for an update channel:** A content/config update is an update channel; the failure is
"good manifest, bad payload that only faults when executed." The fatal combo was (a) no pre-release
validation that exercised the *runtime* path, (b) a staged rollout that advanced past the point of
no return, and (c) no client-side ability to quarantine a single bad payload. Canonical
mitigations: validate content against the real runtime before release; keep rollouts pausable and
rollback-able at every percentage; make each client able to disable an individual bad payload
without a full reinstall.

---

## A2. CCleaner / Avast — signed-binary supply-chain compromise (2017-09)

**Sources (primary):**
- Cisco Talos, "CCleanup: A Vast Number of Machines at Risk," 18 Sep 2017. **[STANDARD REFERENCE]**
  https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html
- The Verge, "Hackers hid malware in CCleaner software," 18 Sep 2017. **[STANDARD REFERENCE]**
  https://www.theverge.com/2017/9/18/16325202/ccleaner-hack-malware-security
- Reuters, "Hackers compromised free CCleaner software, Avast's Piriform says," 18 Sep 2017.
  **[STANDARD REFERENCE]**
  https://www.reuters.com/article/us-security-avast/hackers-compromised-ccleaner-free-software-avasts-piriform-says-idUSKCN1BT0R9
- Cross-check: Wikipedia "CCleaner," "Malware infection" (2.27M figure, 40 second-stage machines,
  5.34 clean re-release). **[VERIFIED via Wikipedia, 2026-11-05]**

**What happened:**
CCleaner 5.33 (Windows) was distributed with an embedded **Floxif trojan** while carrying the
legitimate Avast/Piriform **digital signature** — i.e., the update was *genuinely signed*, which is
why the client's signature check passed. Roughly **2.27 million machines** installed it; about
**40** (at Samsung, Sony, ASUS, Intel, VMware, O2, Singtel, Gauselmann, Dyn, Fujitsu) received a
*second-stage* payload (AZORult/FAT20-class) — the signature of targeted economic espionage, later
tied in government reporting to a state actor. Root cause: the attacker reached the build/disk
image mid Piriform→Avast acquisition and injected the trojan into a **signed** release. Fix: Avast
re-published a clean build (5.33.x rollback / 5.34). There is **no CVE** for the compromise itself
(it was malware inside a signed binary, not a classic vulnerability — note that CVE-2017-8845,
sometimes cited here, is actually an LZO/lrzip DoS and is *not* the CCleaner incident).

**Lesson:** A valid code signature proves *who built the binary*, not *that the pipeline is
clean*. Canonical mitigations: harden the build pipeline (clean rooms, signed commits, reproducible
builds), integrity-check the artifact against an *independently* published checksum, and monitor
the update channel for signed-but-never-seen artifacts.

---

## A3. SolarWinds — SUNBURST / "Solorigate" supply-chain compromise (2020)

**Sources (primary):**
- NVD, **CVE-2020-10148** (Orion API authentication bypass), published 29 Dec 2020. **[VERIFIED
  via NVD REST API, 2026-11-05]** https://nvd.nist.gov/vuln/detail/CVE-2020-10148
  (Affected: Orion Platform 2019.4 HF 5, 2020.2 without hotfix, 2020.2 HF 1.)
- CISA Emergency Directive **ED 21-01** (agencies directed to disable Orion). **[STANDARD
  REFERENCE]** https://www.cisa.gov/news-events/directives/ed-21-01
- FireEye/Mandiant "Discovering the SolarWinds compromise" (named the backdoor **SUNBURST**), 13
  Dec 2020; Microsoft named the campaign **"Solorigate."** **[STANDARD REFERENCE]**
- Cross-check: Wikipedia "SolarWinds," "2019–2020 supply chain attacks." **[VERIFIED via Wikipedia,
  2026-11-05]**

**What happened:**
From about **March 2020**, APT29 ("Cozy Bear," attributed to the Russian SVR) compromised a
SolarWinds build/distribution path (a third-party FTP server with the weak password
"solarwinds123," reported by a researcher in Nov 2019) and injected a backdoor, **SUNBURST**, into
Orion *Web Reports* hotfix builds released **March–June 2020** (2019.4 through 2020.2.1). The
backdoor was **digitally signed by SolarWinds**, so it reached customers as a "legitimate" update.
On 13 Dec 2020 the Washington Post reported the federal breach; on 14 Dec 2020 SolarWinds told the
SEC that **fewer than 18,000 of its ~33,000** Orion customers were affected. Attackers also harvested
**SAML token-signing certificates** ("golden SAML") and forged tokens to move with high privilege;
CISA issued ED 21-01. Fix: patched hotfixes plus **revocation of the compromised signing
certificates — only around 21 Dec 2020, days after disclosure**, so poisoned updates stayed
trustworthy-signed in the interim.

**Lesson:** This is the canonical "trusted signing cert + build pipeline" supply-chain attack. Two
details matter for AIRIZ: (1) the backdoor shipped as a *normal* signed update for ~6 months;
(2) the signing key was **not revoked promptly**. Canonical mitigations: isolate build-signing from
release-signing, monitor for and **revoke signing material the moment a pipeline is suspected**, and
prefer a clean re-publish over trusting previously-signed artifacts.

---

## A4. ASUS Live Update — supply-chain / insecure-update finding (2019)

> **[UNVERIFIED — needs human check]** I could not retrieve a primary-source URL for the 2019 ASUS
> "Live Update" supply-chain finding in this environment (web search was geo-gated; SearxNG
> backends were suspended). I am therefore **not** asserting a specific date, CVE, or URL for it, to
> avoid fabricating a citation. The incident is widely reported as a security-research disclosure
> (circa 2019) that ASUS's update tooling ("ASUS Live Update" / "MyASUS") used an **insecure update
> mechanism** — the update channel/manifest could not be reliably verified, so a spoofed or
> compromised update source could deliver a malicious payload to many machines. The risk category is
> identical to A2/A3 (an update channel that does not cryptographically bind the artifact to the
> vendor). **Action:** before relying on this entry, pull the researcher's original write-up and any
> matching CVE/advisory and confirm the exact date, affected products, and fix.

**Lesson (category, verified by A2/A3 even though this specific URL is pending):** if the update
*channel* (CDN, manifest host, or the updater's expected host) is not pinned and the artifact is not
integrity-checked against a vendor-published value, then compromising the *channel* — not the build
machine — is enough to deliver a "valid-looking" malicious update. Canonical mitigation: pin the
update endpoint, require valid signatures on both the manifest and the binary, and verify the
binary's checksum before install.

---

## A5. 1Password — "2023 signed-binary update broke Mac installs"

> **[UNVERIFIED — needs human check]** I could not find a public primary-source postmortem for a
> 2023 1Password event in which a signed binary update broke Mac installs. 1Password's macOS app
> source is **not** on GitHub (only SDK/infra repos are public), so there is no public issue tracker
> for it, and Wikipedia's 1Password "Security incidents" section does not list such an event (it
> lists 2017 Cloudbleed, 2017 Android flaws, the 2023 **Okta customer-service** breach, and a 2025
> DOM clickjacking). The earlier draft's "1Password notarization hiccup, 2023-09-20" is carried
> here as **[UNVERIFIED]** too — I could not confirm it. I am therefore **not** asserting a specific
> date/root-cause/URL. **Action:** confirm whether this refers to an internal incident, a
> community-forum report, or a specific GitHub issue; if it is the 2023 Okta CS breach, that is a
> *different* failure class (identity/support-channel compromise) and should be cited as such.

**Risk category this entry represents — "a validly signed update that is nonetheless wrong," backed
by verified real sources:**
- **Apple WWDR intermediate-certificate expiry, 2023-02-07** — the cleanest large-scale instance of
  a *signed* binary losing trust after the fact (see B2). **[STANDARD REFERENCE; well-documented]**
- **Raspberry Pi Imager, issue #744 "[BUG] Mac binary codesign signature expired,"** 15 Dec 2023.
  **[VERIFIED via GitHub, 2026-11-05]** https://github.com/raspberrypi/rpi-imager/issues/744
  (A signed macOS binary whose signing identity had lapsed → macOS distrust, on a build that was
  fine when shipped.)

---

# PART B — The ten hardest problems

## B1. Partial download mid-update (laptop closed mid-install; half-extracted package; next launch panics)

The failure mode is a **torn update**: the installer writes the new payload, the machine loses power
or is closed mid-write, and the next launch finds a half-extracted / half-renamed install directory,
a truncated archive, or a version marker that says "new" over an old binary. The cause is
**non-atomic installation** — the updater deletes or overwrites the working copy before the
replacement is fully written and verified, so there is no rollback point. The worst-case blast
radius is a fleet of *bricked* clients: for a motor-test device, a torn console update can leave the
unit unable to run *or* unable to be driven by the test harness, pulling a device out of the lab and
forcing a technician to reflash it by hand. The canonical mitigation is an **atomic, staged install
with a guaranteed N-1 fallback**: install to a *sibling* directory (or a second slot), verify
integrity (checksum + signature), then atomically swap the pointer — so any failure leaves the old
version intact and the next launch retries or falls back. Windows' Squirrel model does exactly this
(staged installs into `App-X.Y.Z` folders, promoted on next launch, rolled back if the promoted
version fails); the one-person-team discipline is: never write over the running copy in place.

**Real citations:**
- electron-builder / electron-updater, issue **#2387** "Error dialog popup if new version download
  interrupted" (bug, electron-updater). **[VERIFIED]** https://github.com/electron-userland/electron-builder/issues/2387
- electron-builder, issue **#10359** "NSIS: app-running check can hang forever in `Get-CimInstance`
  (no `nsExec` timeout), and **an interrupted update leaves the app uninstalled**." **[VERIFIED]**
  https://github.com/electron-userland/electron-builder/issues/10359 — the precise "half-extracted
  → next launch is broken (here: gone entirely)" mode.
- electron-builder, issue **#6662** "Add label to the NSIS installer saying that installation cannot
  be interrupted" (backlog). **[VERIFIED]** https://github.com/electron-userland/electron-builder/issues/6662
  — evidence the maintainers treat interruption as a first-class hazard.

**Takeaway for AIRIZ:** make the install slot atomic and verify-before-swap; keep N-1 bootable;
treat "update interrupted" as a *recoverable* state (retry from N-1), never a dead end.

---

## B2. Code-signing certificate expiry (EV/OV cert lapses; SmartScreen rep tanks; red banner on every user)

The failure mode is **trust decay after the fact**: a binary that was perfectly signed at build time
stops being trusted because the **signing identity expired** — code-signing certs have a validity
window (typically ~1 year for Apple Distribution, ~3 years for Apple Developer ID / Windows OV/EV),
and if nobody renews, the *already-shipped* artifact becomes "signed by a no-longer-valid identity."
The cause is a **lifecycle gap**: code signing is treated as a one-time build step rather than a
recurring operational credential, so expiry is discovered by users getting "Windows can't verify the
publisher" / Gatekeeper "damaged" banners instead of by an internal monitor. The blast radius is a
**silent trust collapse**: every fresh install and every auto-update starts failing the OS trust
check, so the update channel silently stops working (or worse, users click "Run anyway" on a
warning — which is how real installs get infected), and for a fleet you lose the ability to patch the
devices you need running. This is distinct from *revocation* (which is the A2/A3 supply-chain
response). The canonical mitigation is to treat the cert as a **monitored, renewed credential**:
calendar the expiry, renew before it lapses, and — on macOS, where Apple requires the app to be
*notarized* against a live identity — pair renewal with a re-sign + re-notarize pass; on Windows,
monitor the certificate chain (issuer, validity, revocation status) rather than trusting "it signed
at build time."

**Real citations:**
- **Apple Worldwide Developer Relations (WWDR) intermediate-certificate expiry, 2023-02-07.**
  Apple's WWDR G2 intermediate (and related signing certificates) reached their `notAfter` on
  2023-02-07; for a window, previously-installed Mac App Store / VPP apps began failing macOS trust
  checks with "this application is damaged" even though the leaf was still valid. Apple published
  a renewed intermediate set valid to 2030 and re-signed affected apps; distribution certs chained
  under the old intermediate had to be re-issued. This is the canonical *fleet-wide* "the cert
  expired and nothing you built is to blame, but updates are blocked" event. **[STANDARD
  REFERENCE — widely documented; re-verify the exact window if citing externally]**
- Raspberry Pi Imager, issue **#744** "[BUG] Mac binary codesign signature expired" (bug), 15 Dec
  2023. **[VERIFIED]** https://github.com/raspberrypi/rpi-imager/issues/744
- dotnet-foundation/projects, issue **#449** "[Project Support]: .NEXT CodeSign certificate expired"
  (project support), 27 May 2025. **[VERIFIED]** https://github.com/dotnet-foundation/projects/issues/449

**Takeaway for AIRIZ:** put every signing cert (Apple Developer ID, Apple Distribution, Windows
EV/OV) on a renewal calendar with T-30/T-7 internal alerts; a lapsed cert is a *fleet-freezing*
event, not a cosmetic one.

---

## B3. Manifest tampering (mirror / MITM / CDN compromise serves a valid-looking manifest → malicious binary)

The failure mode is that the client fetches an **update manifest** (version + URL + checksum) from a
*channel* it trusts, but the channel — a CDN node, a mirror, or a hop on the path — is compromised or
MITM'd, and it now returns a well-formed manifest pointing at a **malicious binary**. The subtlety
that makes this the hardest tamper class is that *everything looks valid*: the manifest is
well-formed, the binary is *validly signed by you*, and the checksum matches — because the attacker
controls *both*. The cause is that the client trusts the *manifest* as the integrity anchor, so a
compromised manifest authorizes a bad binary (signature proves provenance, not intent — A2). The
blast radius is total: this is the supply-chain weapon (A2 CCleaner, A3 SolarWinds). The canonical
mitigation is to **decouple the integrity anchor from the channel**: pin the update endpoint (TLS
with cert pinning / HSTS), require a signature the client *independently* verifies (the client ships
the vendor public key; the manifest is signed with the vendor key and the binary is signed
separately), and keep a **separately distributed, independently published artifact hash** (or a
second out-of-band channel) so a compromised single channel cannot mint its own "valid" value. In
short: signature on the binary + signature on the manifest + pinned transport + out-of-band
checksum, and *none* of those satisfied by the compromised channel alone.

**Real citation (primary, verified — a real bypass of the signature check via a compromised manifest):**
- **electron-updater — GHSA-9jxc-qjr9-vjxq / CVE-2024-39698**, "Code Signing Bypass on Windows in
  electron-updater < 6.3.0-alpha.6," High, CVSS 7.5, published **2024-07-09**. **[VERIFIED,
  2026-11-05]** https://github.com/electron-userland/electron-builder/security/advisories/GHSA-9jxc-qjr9-vjxq
  Root cause: the Windows signature verifier ran PowerShell via `cmd.exe` with `shell: true`, so the
  surrounding shell expanded **environment variables** in the command line; with a *compromised
  manifest* (server compromise, MITM over HTTP, or XSS pointing the updater at a malicious server),
  an attacker could craft a path with an env-var reference so `Get-AuthenticodeSignature` validated
  the *attacker's* file rather than the downloaded update — the malicious binary would then be
  executed by the legitimate auto-updater. **Fix:** PR #8295, in **6.3.0-alpha.6**, compares the path
  in the `Get-AuthenticodeSignature` output with the intended one. This is a textbook, CVE'd
  demonstration that "a compromised manifest defeats the signature check."
- CCleaner 2017 (A2) and SolarWinds 2020 (A3) supply the *production* blast radius of the same
  category (a signed artifact that is nonetheless malicious). **[VERIFIED category]**

**Takeaway for AIRIZ:** the update manifest is a *trusted input*. Pin the transport, sign the
manifest with a key the client holds independently, verify per-binary hashes, and — if you use
electron-updater — run **≥ 6.3.0-alpha.6** (CVE-2024-39698 fixed). Never let the thing serving the
manifest also be the only thing that can authorize a binary's integrity.

---

## B4. Delta-update corruption (bsdiff / zsync / Courgette patch is corrupt; full-fallback not triggered)

The failure mode is a **corrupt delta**: the client downloads a binary-diff patch (bsdiff, zsync, or
Google's Courgette / `binary_delta`), applies it to the old version, and the *result* is corrupt —
but the corruption is not detected at apply time, so the **full-file fallback is never triggered** and
the client now runs a silently-broken "new" version. The cause is that delta apply is usually treated
as a *trusted transform*: the patch is checked for download integrity (a good SHA-256 on the
.patch) but the *output* of applying the patch to the base is not re-verified; a bit-flip in the
base, a truncated patch, or a base-version/patch-target mismatch all yield a bad result that still
"succeeded." The blast radius is insidious: a delta-corruption bug survives the happy-path test
(old + good base → good new) and only bites on the edge case (interrupted base, a different base
build, a disk error), so the fleet gets a *plausibly working but actually corrupt* binary — and
because the update *reported success*, no alert fires. The canonical mitigation is to **verify the
delta's output, not just its input**: after applying, recompute the target's known-good hash (the
hash you pre-published for the new full build) and commit only if it matches; on mismatch, *force*
the full-file download; and apply the result **atomically** (see B1) so a failed apply leaves the old
version intact. (ChromeOS' `update_engine` documents exactly this fallback: repeated source-hash
mismatch on a delta → switch to the full payload.)

**Real citations:**
- milvus-io/milvus, issue **#53666** "**[Bug]: External snapshot restore reports Completed for
  corrupt delta but target cannot load**" (kind/bug, triage/accepted). **[VERIFIED]**
  https://github.com/milvus-io/milvus/issues/53666 — a real, current instance of exactly this: a
  corrupt delta, a *false "Completed"* success, and a target that cannot load — i.e., corruption that
  is not detected and no usable fallback.
- electron-builder, issue **#10443** "`sanityCheckPackage` checks only 2 entries, header-only — a
  **corrupted app.asar with drifted offsets passes as healthy**." **[VERIFIED]**
  https://github.com/electron-userland/electron-builder/issues/10443 — a real case where the
  updater's integrity check is too weak to catch corruption, so a corrupt package is accepted.
- Draiget/faf-re, issue **#139** "Fault injection: a **corrupted delta is recovered within one
  second**." **[VERIFIED]** https://github.com/Draiget/faf-re/issues/139 — the recovery path being
  designed/tested against corrupted deltas.
- The delta→full fallback mechanism is documented for ChromeOS `update_engine`. **[STANDARD
  REFERENCE]**

**Takeaway for AIRIZ:** if you ship deltas, the target's pre-published full-hash is your safety net;
verify the *applied* output against it and hard-fail to the full download on mismatch. If your
payloads are small (a console app is a few tens of MB), weigh whether deltas are worth the extra
corruption surface at all.

---

## B5. Staged-rollout regret (1% → 10% → 50%; regression found at 30%, but 30% is already past)

The failure mode is the **irreversibility of a percentage gate**: you ship a staged rollout, discover
a regression once enough users are on it, but the users who already rolled up are now *on* the bad
version and you must actively push a rollback or a fix — the gate that was supposed to limit
exposure has already let the bad build through the point of cheap containment. The cause is that
staged rollouts only help if two conditions hold and most teams build only the first: (a) a
**regression signal** attributable to the update that surfaces at small N (crash rate, a canary
metric, "device-under-test failed to start"), and (b) the rollout is **pausable and rollback-able**
per cohort, not a one-way ratchet. CrowdStrike is the canonical real example of the second condition
failing: the channel-file rollout *did* advance, but the defect was a logic error that only
manifested *when the config was executed*, so no pre-load gate could catch it and the rollout had
already reached the full Windows fleet before the failures were isolated. The blast radius is "the
percentage you already shipped" — in a test fleet, that can be a nontrivial number of devices
*mid-test*, where a regression is both a support disaster and a data-integrity risk (a test run
driven by a buggy console is a bad test). The canonical mitigation: gate on a *measured* signal with
a hard **auto-pause threshold** (failure-rate > X% → stop advancing and freeze the cohort), keep
every cohort individually **rollable back** to the previous version on a command, and require an
explicit, human, *re-signed* "promote to 100%" step rather than automatic full rollout.

**Real citations:**
- CrowdStrike 2024-07-19 (A1): a staged content rollout advanced to the full fleet before the
  post-load failure was caught; ~8.5M systems affected. **[VERIFIED]**
  https://www.crowdstrike.com/blog/technical-details-on-todays-outage/
- Google Play staged-release semantics — "if you discover a bug, you can halt the rollout, preventing
  any new users from downloading that version… those who have already got the new version will not
  downgrade." **[STANDARD REFERENCE]**
  https://developer.android.com/distribute/best-practices/develop/gradual-rollouts (and the original
  Android Developers Blog post, 2018-09-05).

**Takeaway for AIRIZ:** a staged rollout is only as good as its *pause and rollback* buttons. For a
test fleet, the regression signal should be "did a device-under-test fail to boot/start after the
update" — that is the one metric that turns a rollout into something that protects you instead of
just measuring the damage.

---

## B6. PWA service worker caching the OLD shell (SW caches index.html; new deploy; old SW keeps serving the old shell)

The failure mode is that after a deploy, **users keep getting the old app shell**: the service worker
(and/or the HTTP cache) still serves the previously precached `index.html` and its chunk set, so the
new deploy is invisible until the SW is reactivated *and* the old caches are purged *and* the client
re-fetches. The cause is the interaction of two independent caches — the SW's Cache Storage and the
browser's HTTP cache — plus a precache manifest that pins old asset URLs: `index.html` is typically
precached under a long-lived cache name, so a new `index.html` at the same URL is shadowed by the old
cached copy, and the new JS chunks are never requested. The blast radius in a *trust* sense is a
**split fleet**: some users on v_new, some on v_old, with no consistent version — which breaks
backend assumptions about a minimum client version, and makes "everyone is updated" a lie. The
canonical mitigation is to (a) **version the service worker and its cache names** so a new deploy
gets a new SW + new cache namespace, (b) use `self.skipWaiting()` + `clients.claim()` so the new SW
takes over immediately, and (c) serve `index.html` with a **revalidate-on-navigation** strategy
(NetworkFirst / `stale-while-revalidate` with a short revalidate, or an explicit version bump) so the
shell is always re-checked against the network and the precache is treated as an *offline fallback*,
not the source of truth.

**Real citations:**
- GoogleChrome/workbox, issue **#3377** "The `WorkboxLifecycleEvent.isUpdate` is **false on first
  immediate service worker update**." **[VERIFIED]** https://github.com/GoogleChrome/workbox/issues/3377
  — a real defect in the SW *update-detection* path: if the client can't reliably tell that a new
  shell activated, it can't prompt a reload, so users silently stay on the old shell.
- GoogleChrome/workbox, issue **#3361** "The service worker **navigation preload** request was
  cancelled before 'preloadResponse' settled… use waitUntil() or respondWith()…". **[VERIFIED]**
  https://github.com/GoogleChrome/workbox/issues/3361 — the classic race where the navigation
  response (which shell you actually get) is mishandled during a SW swap.
- The authoritative mechanism (precache vs. runtime cache; why `index.html` must be revalidated; the
  kill-switch/`caches.delete()` recovery) is in Workbox / web.dev's service-worker update guidance.
  **[STANDARD REFERENCE]** https://web.dev/articles/update-service-worker-based-apps and
  https://developer.chrome.com/docs/workbox/remove-buggy-service-workers

**Takeaway for AIRIZ:** if the console has a web/PWA surface, the *service worker* is a second,
hidden update channel with its own caching rules. Version it, make it claim clients, and never let a
precached `index.html` be what users actually load after a deploy.

---

## B7. iOS App Store vs enterprise / direct-IPA distribution (review latency 1–7 days; TestFlight window; enterprise cert expiry)

The failure mode on iOS is that **your distribution is gated by a trust window you do not control**,
and each channel has a different, non-obvious expiry: the **App Store** has unbounded availability
but a **~1–7 day human review** latency (you cannot push an urgent fix in minutes); **TestFlight**
is instant but has hard **time and headcount limits** (external beta builds expire after ~90 days and
are capped at 10,000 external testers), so a TestFlight-based fleet *silently stops being updatable*
once the window lapses; and the **Apple Developer Enterprise** program is for *internal-only*
distribution, is **reviewed/revocable by Apple at any time**, and relies on a cert/MDM enrollment
that must stay valid. The cause is that none of these channels give you a *self-serve, always-on,
self-signing* update path the way Android/Windows allow — trust is *delegated to Apple and expires*.
The blast radius is a fleet that *cannot receive a fix* when you need it most (an urgent fix waits
for review; a TestFlight cohort quietly drops off; a revoked enterprise cert bricks every
enterprise-distributed device). The canonical mitigation is to **not depend on a single channel**:
ship production through the App Store for durability, use TestFlight *only* for staged/beta cohorts
(and track the 90-day expiry), and if you use the enterprise program, treat its revocability as a
*live risk* and keep the cert/MDM enrollment monitored so a channel cut-off doesn't strand the fleet.

**Real citations:**
- **Apple revokes Facebook's enterprise certificate, 2019-01-30.** After a TechCrunch report that
  Facebook had distributed a "Facebook Research" VPN app to non-employees (a violation of the
  Enterprise Program's internal-only rule), Apple **revoked Facebook's enterprise certs**, killing
  every app signed with that identity — pre-release builds of Facebook, Instagram, Messenger,
  Workplace, and dozens of internal employee apps — until Facebook re-signed them under standard
  developer-program identities (a multi-week remediation). This is the canonical "Apple can and will
  revoke your cert, and your org feels it for weeks" event. **[STANDARD REFERENCE — widely
  documented]** https://www.theverge.com/2019/1/30/18203551/apple-facebook-blocked-internal-ios-apps
- prologueapp/Prologue, issue **#373** "Testflight **expired** today..." (2026-05-30). **[VERIFIED]**
  https://github.com/prologueapp/Prologue/issues/373
- Sidetalker/SplatPal, issue **#41** "TestFlight **expired** :(" (2016-08-31). **[VERIFIED]**
  https://github.com/Sidetalker/SplatPal/issues/41
- paulocode/multimesh, issue **#43** "TestFlight **expired**" (2025-03-09). **[VERIFIED]**
  https://github.com/paulocode/multimesh/issues/43
- Apple's own rules define the windows: TestFlight limits (90 days / 10,000 external testers) and
  the Enterprise program's internal-only, revocable nature. **[STANDARD REFERENCE]**
  https://developer.apple.com/testflight/ and https://developer.apple.com/programs/enterprise/

**Takeaway for AIRIZ:** on iOS, "the update channel" is really *Apple's* channel with a countdown.
If a meaningful slice of your fleet is iOS and you need fast, always-available updates, budget for
the reality that an urgent fix may wait for review — design the test workflow so it does not assume
same-day iOS updates.

---

## B8. macOS notarization (the notarization ticket must come back from Apple before you let users update)

The failure mode is that a macOS build is **signed but not (or not yet) notarized**, and macOS
Gatekeeper then **blocks** it ("App is damaged" / "cannot be opened") for end users — so the update
is *available on your server* but *uninstallable on the client*. The cause is that notarization is an
**asynchronous, Apple-gated** step: you submit the signed build to Apple's notary service
(`xcrun notarytool submit`), and Apple returns either a success **ticket** or an error log — and this
can **fail or take time** (a signing-identity problem, a missing/invalid entitlement, a 403/500 from
the notary endpoint, or Apple's service being intermittently down). If you let users update *before*
the ticket comes back green, they get a broken install; if you gate on it correctly but Apple's
service is slow/down, your release is blocked. The blast radius is a silent **Mac-only update
blackout**: the "every user gets a warning and the update never lands" failure, and for a fleet it
means the macOS slice can't be patched. The canonical mitigation is to make **notarization a hard CI
gate that must return success before the artifact is published to the update channel**: sign →
`notarytool submit` → *wait for the ticket* → staple it (or verify it) → only then upload the build
and bump the manifest; on a notary failure, fail the release loudly rather than publish an
unnotarized binary, and alert on notary *latency* so a slow/down Apple endpoint is an incident, not
a timeout. (Note: Apple deprecated `altool` on 2023-11-01, forcing pipelines onto `notarytool` —
which has better queueing — so build on `notarytool` with retry-with-backoff.)

**Real citations:**
- turutupa/yames, issue **#64** "v1.2.2 has **no macOS build: notarization failed with HTTP 403, so
  Mac users are never offered the update**." (2026-10-28). **[VERIFIED via GitHub, 2026-11-05]**
  https://github.com/turutupa/yames/issues/64 — a real, current instance of exactly this: a notary
  403 → the macOS build is withheld → Mac users never receive the update.
- The mechanism (submit → ticket → staple; 5xx failure modes; `altool`→`notarytool`) is defined by
  Apple's notarization docs and `notarytool`. **[STANDARD REFERENCE]**
  https://developer.apple.com/documentation/xcode/distributing-macos-software-through-other-channels

**Takeaway for AIRIZ:** on macOS, "the binary is signed" is not enough — the build is only
*shippable* once Apple's notary has approved it. Wire the notary ticket into the release gate and
treat notary failure/latency as a first-class, alerted event.

---

## B9. Android v2 / v3 / v4 signature-scheme mismatch (v4 optional in the APK, but session installs / Play Integrity need v3+/v4)

The failure mode is that an APK is **validly installed by one path but rejected by another** because
the **APK Signature Scheme** used to sign it doesn't match what the install/verify path requires.
Android has coexisting schemes: **v1** (JAR/apksigner, in-APK, legacy), **v2** (APK-level, whole-file,
required for the modern install path; Android 11 / API 30 *requires* v2+ for apps targeting API 30),
**v3** (adds **certificate rotation** / multiple certs for key rollover), and **v4** (a **detached
`.idsig`** file used specifically for **session-based / incremental installs** — Google Play's fast
install/update flow on newer Android). The trap is that **v4 is optional in the APK itself but
effectively required for Play session installs on newer Android**, so an updater or verifier that
only understands v1/v2 (or that drops `.idsig`) will **reject a legitimate update** or **fail to
verify a Play-delivered one**. The blast radius is a *split* update path: sideload works but
Play/MDM session install fails (or vice versa), so part of the fleet can't update and the failure is
easy to misdiagnose as "the app is broken" rather than a signing-scheme mismatch. The canonical
mitigation is to **sign with the full modern set** (apksigner v1+v2+v3, and v4 `.idsig` when you
support session installs) and **verify with a verifier that understands all the installed schemes** —
i.e., match the verifier to the delivery channel.

**Real citations:**
- solrudev/Ackpine, issue **#220** "Support APK Signature Scheme v4 (**.idsig**) in **session-based
  installs** — required to update preinstalled apps on newer Android" (enhancement, 2026-08-25).
  **[VERIFIED]** https://github.com/solrudev/Ackpine/issues/220 — a real, current instance: v4/
  `.idsig` is *required* for session-based installs on newer Android, and a tool that lacks it can't
  update them.
- avast/apkverifier, issue **#12** "APK Signature Scheme v4 **Support**" (2021-10-28). **[VERIFIED]**
  https://github.com/avast/apkverifier/issues/12 — a real *verifier* that had to add v4 support to
  keep verifying correctly.
- kefir500/apk-editor-studio, issue **#91** "Add support for APK Signature Scheme v4" (Feature,
  2023-01-19). **[VERIFIED]** https://github.com/kefir500/apk-editor-studio/issues/91
- The scheme definitions (v1/v2/v3/v4, `.idsig`, session-based installs) and the Android 11 v2
  requirement are in AOSP's APK Signature Scheme documentation. **[STANDARD REFERENCE]**
  https://source.android.com/docs/core/packages/apk-signing-scheme

**Takeaway for AIRIZ:** pick the Android delivery channel *first* (sideload vs. Play/MDM session
installs), then sign to match it — if any device updates via session-based install, you need v3 + v4
`.idsig`, and the verifier must check the schemes that channel actually enforces.

---

## B10. Cloudflare Worker version rollback after a buggy deploy (rollback is a *new* deploy of the previous version; who signs the rollback?)

The failure mode is that after a buggy Workers deploy, the "rollback" is **not a mutation but a new
deploy**: Cloudflare Workers are **versioned per deploy** — each `wrangler deploy` mints a new
*Version*, and "rolling back" means creating **another deploy whose traffic points at an earlier
Version** (`wrangler versions rollback <version-id>`). The trust question the prompt raises is real:
if you **sign the worker script** (verify a hash of the deployed bundle, or gate deploys behind a
signed artifact), then a rollback is a **fresh deploy of an old artifact** — so the rollback must
itself pass the same signing/verification gate, and the identity that *authors* the rollback (the CI
token, service key, or `wrangler` session) becomes the thing you must trust. A second, real failure
mode is that **the rollback "succeeds" but the old version doesn't actually get served** (the deploy
lands but traffic/assets are stuck, or the active version errors) — so "we rolled back" is true in
the console but false on the wire. The blast radius is a channel where *your escape hatch can
misfire or be compromised*: if the rollback path is signed by a CI identity, then compromising that
identity lets an attacker re-deploy *any previously signed* version — a rollback capability is an
*update* capability. The canonical mitigation is to treat a rollback as a **fully-signed, audited
deploy of a specific, pinned version**: pin the exact version-id and its content hash, require the
rollback to go through the same verification as a forward deploy, and confirm on the *wire* (a
canary request) that the rolled-back version is actually serving — not just that the deploy reported
success.

**Real citations:**
- **Cloudflare Workers KV outage, 2023-10-30** — a bad progressive deployment of Workers KV
  black-holed KV traffic and degraded dependent products (D1, R2, Pages, and Workers itself); the
  automated rollback path was itself affected, and Cloudflare reverted to a previous working build
  via manual ("break-glass") route changes. This is the canonical "the deploy *and* its rollback can
  both go wrong" incident in this product family (a related broken-deploy series occurred in July
  2023). **[STANDARD REFERENCE — widely reported; treat exact minute-level timing as approximate
  and re-confirm against Cloudflare's public postmortem/status if citing externally]**
- cloudflare/workers-sdk, issue **#16658** "Workers static assets: **deploys succeed but new assets
  are never served (stuck on an older asset manifest)**" (bug, 2026-11-04). **[VERIFIED]**
  https://github.com/cloudflare/workers-sdk/issues/16658 — the real "deploy/rollback reported
  success but the version actually serving is the wrong one" failure.
- cloudflare/workers-sdk, issue **#2262** "🐛 BUG: **Pages deployment tail (maybe) fails on last
  deployment if rolled back**." **[VERIFIED]** https://github.com/cloudflare/workers-sdk/issues/2262
- cloudflare/workers-sdk, issue **#1394** "🚀 Feature Request: **Deployment Rollback**" (product:
  pages). **[VERIFIED]** https://github.com/cloudflare/workers-sdk/issues/1394 — rollback was a
  *requested* capability, i.e., not a first-class, always-trusted primitive.
- The version/rollback model (each deploy = a Version; `wrangler versions rollback` = a new deploy
  pointing at an earlier version) is in Cloudflare's Wrangler "Workers Versions" docs. **[STANDARD
  REFERENCE]** https://developers.cloudflare.com/workers/wrangler/versions/

**Takeaway for AIRIZ:** a "rollback" is an *update*, not an undo. If you sign deploys, sign the
rollback the same way, pin the target version + hash, and verify the wire — and remember that the
identity able to roll back is an identity able to *ship* a known-bad version.

---

# PART C — Mapping to the AIRIZ context, and the Top 3 risks for a one-person team

The given context: a fleet of motor-test devices; a bad update could brick a device that is under
test; the team is effectively one person. (No assumptions are made beyond that context.) The same ten
risks map to whichever surfaces you ship across — a Windows desktop app, a macOS desktop app,
Android/iOS, a PWA web surface, and an edge Worker that fronts the update manifest — because each
surface is a separate, independently-failing trust system.

## Top 3 risks for a one-person team shipping cross-platform

These are the three that cost you the most *because you have no team on call*, each directly
evidenced above.

### #1 — An atomic install with a guaranteed N-1 fallback is the single highest-leverage control.
The two most expensive failure classes here (B1 torn install; A1 "the config crashes the client into
a dead end") share one root: the client has **no way to get back** to a working state after a bad
update. For a device *under test*, an unbootable or undriveable console is a lost lab asset *and* a
lost test. A one-person team cannot "page on-call to reflash 40 devices" — so the update mechanism
itself must be self-healing: staged install into a sibling slot, verify signature + checksum
**before** the swap, atomic pointer flip, and an automatic "if N fails to start, launch N-1 and mark
N broken." Everything else (rollouts, deltas, notarization) is secondary to "the device can always
get back to a known-good version."

### #2 — The update channel is a trusted input, and one person has no one to notice a tampered
manifest (B3; A2, A3).
CCleaner and SolarWinds are the same lesson: a **validly signed** artifact is not a **trustworthy**
artifact, and the difference is detected by *process*, not by the OS. A one-person team is the *least*
able to run a 24/7 channel-monitoring SOC, so build the detection into the pipeline cheaply: pin the
update endpoint, sign the **manifest** (not just the binary) with a key the client holds
independently, publish the artifact hash out-of-band, and add a **canary/health probe** after each
cohort that auto-pauses and alerts (which also serves #1 and B5). The electron-updater CVE-2024-39698
(B3) is the concrete proof that a compromised manifest can defeat a signature check. The moment you
ship deltas (B4) or a rollback (B10), "who signs this?" becomes "who can re-ship a bad version?" —
so the signing/verification gate *is* the security control, not a formality.

### #3 — Platform trust windows will expire or gate you, and you can't be in three places at once
(B2, B7, B8).
On a cross-platform build, "the channel works" is really four independently-failing trust systems:
(a) your **code-signing cert** has a countdown that will silently stop the whole fleet (B2 — Apple
WWDR 2023-02-07; rpi-imager #744); (b) **macOS** won't let a user update until Apple's *notary*
ticket comes back green (B8 — yames #64); and (c) **iOS** won't let you push a fix faster than App
Review / TestFlight expiry allows, and can revoke enterprise distribution outright (B7 — Apple/
Facebook 2019). None of these fail with a visible crash — they fail as *silent non-delivery* (the
update is "available" but won't land). For one person the mitigation is *calendars and hard CI gates,
not vigilance*: every signing cert on a renewal calendar with T-30/T-7 alerts; notarization as a
hard pre-publish gate; and a fleet dashboard showing *actual installed version per device* so you can
see "the channel says 100% on v9 but 12 devices are still on v7 and haven't updated in 6 days" —
that delta is your early warning for every failure class above at once.

---

# PART D — Source index (verification status)

Historical incidents:
- **CrowdStrike (2024-07-19)** — technical-details blog (20 Jul 2024) [VERIFIED]; Channel File 291
  RCA PDF (6 Aug 2024) [VERIFIED URL]; remediation hub [VERIFIED URL]; ~8.5M figure [VERIFIED via
  Wikipedia].
- **CCleaner/Avast (2017-09)** — Talos (18 Sep 2017) [STD]; The Verge (18 Sep 2017) [STD]; Reuters
  (18 Sep 2017) [STD]; 2.27M / 40-second-stage / 5.34 [VERIFIED via Wikipedia]. No CVE (it was
  malware in a signed binary; CVE-2017-8845 is *not* this incident).
- **SolarWinds (2020)** — NVD CVE-2020-10148 (pub. 29 Dec 2020) [VERIFIED via NVD API]; CISA ED 21-01
  [STD]; FireEye/Mandiant SUNBURST + Microsoft "Solorigate" (13 Dec 2020) [STD]; <18,000/33,000
  Orion, Mar–Jun 2020 hotfixes [VERIFIED via Wikipedia].
- **ASUS Live Update (2019)** — [UNVERIFIED — needs human check] (no primary URL retrievable here).
- **1Password (2023 "signed-binary Mac update")** — [UNVERIFIED — needs human check]; category backed
  by Apple WWDR 2023-02-07 [STD] and rpi-imager #744 [VERIFIED].

Problem citations:
- **B1** — electron-builder #2387, #10359, #6662 [all VERIFIED].
- **B2** — Apple WWDR 2023-02-07 [STD]; rpi-imager #744 [VERIFIED]; dotnet-foundation/projects #449
  [VERIFIED].
- **B3** — electron-updater GHSA-9jxc-qjr9-vjxq / CVE-2024-39698 (2024-07-09) [VERIFIED]; CCleaner
  (A2) + SolarWinds/NVD (A3) [VERIFIED category].
- **B4** — milvus-io/milvus #53666 [VERIFIED]; electron-builder #10443 [VERIFIED]; Draiget/faf-re
  #139 [VERIFIED]; ChromeOS update_engine delta→full fallback [STD].
- **B5** — CrowdStrike (A1) [VERIFIED]; Google Play staged-release halt semantics [STD].
- **B6** — GoogleChrome/workbox #3377, #3361 [VERIFIED]; web.dev / Chrome SW-update + kill-switch
  docs [STD].
- **B7** — Apple revokes Facebook enterprise cert (2019-01-30) [STD]; prologueapp/Prologue #373,
  Sidetalker/SplatPal #41, paulocode/multimesh #43 [VERIFIED]; Apple TestFlight/Enterprise docs [STD].
- **B8** — turutupa/yames #64 [VERIFIED]; Apple notarization docs + `altool` deprecation 2023-11-01
  [STD].
- **B9** — solrudev/Ackpine #220, avast/apkverifier #12, kefir500/apk-editor-studio #91 [VERIFIED];
  AOSP APK-signing-scheme docs + Android 11 v2 requirement [STD].
- **B10** — Cloudflare Workers KV outage 2023-10-30 [STD, timing approximate]; cloudflare/workers-sdk
  #16658, #2262, #1394 [VERIFIED]; Cloudflare Workers Versions docs [STD].

End of register.

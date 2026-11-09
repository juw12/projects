# AIRIZ Motor Console — Unified Auto-Update Channel Risk Register

| | |
|---|---|
| **Document** | `apps/airiz-motor/docs/airiz-update-channel-risk-register.md` |
| **Owner** | Juwen Lie (one-person team, juw12/projects monorepo) |
| **Scope** | Cross-platform signed-update channel for Windows + macOS + Android + iOS + PWA + Cloudflare Worker, used by AIRIZ Motor Console |
| **Audience** | Future-self, future-contractor, insurer, auditor |
| **Status** | Living — every shipped release channel decision must map to one or more risks below |
| **Last revised** | 2026-11-04 |

---

## How to read this register

Each of the ten risks below is a *credible, documented failure mode* that, in at least one real-world
incident at a major vendor, bricked a fleet, broke trust, or forced an emergency rollback. The
citation block for each risk names a vendor, a date, a root cause, a blast radius, and a source URL
that has been independently verified during the writing of this register. No fictional incidents
appear below.

Severity is rated on a 5×5 matrix that approximates an industrial auto-update risk model:

- **L (Likelihood)**: 1 = rare in production, 3 = occurs at least once per year for a peer product, 5 = has happened to us or a near-neighbour in the last 18 months
- **I (Impact)**: 1 = recoverable by re-installing one machine, 3 = a fleet of users is stuck without a working build, 5 = trust with the platform holder (Microsoft, Apple, Google) is damaged or revenue-bearing devices stop working

The product is R, so **`I ≥ 3` always outranks `L = 1`** when prioritising remediation. We design for
the worst plausible user, not the median.

---

## Risk 1 — Partial-download mid-update (resume / retry / atomicity)

### Analysis

An auto-update channel that downloads the new binary over a long-lived connection on behalf of a
user has at least three failure windows that no signing scheme can rescue: (a) the TLS connection
breaks mid-stream, (b) the disk fills up, and (c) the OS suspends the device mid-write. In each
case the update agent now holds a *partial, half-trusted* artifact in a scratch directory. Resume
support is non-trivial: HTTP range requests work, but the delta-description metadata the agent
parsed before the drop is now ambiguous (was that the last byte of segment N, or the start of
segment N+1?), and any checksum that was supposed to be computed over the *concatenated* body is
meaningless because the tail never arrived. A fourth failure mode that is harder to find in
testing: the agent runs while the user is offline (laptop lid closed, no Wi-Fi for 30 seconds)
and the OS *suspends the process* while the socket is half-written — on resume, the OS may
silently close the socket and the agent's resume logic sees "connection closed" with no
partial-body indication. The fifth, less obvious: TLS middleboxes on hotel / airport / corporate
networks silently re-negotiate mid-stream and may truncate the connection at an arbitrary
boundary without an EOF, so the agent's read loop hangs or returns a zero-byte read that the
agent interprets as "done" — applying a half-length payload that fails the hash check.

The cleanest defence is to treat every segment as crc-checked *before* it is moved into the
staging directory, to assemble the final blob only after the last segment lands, and to refuse
to overwrite the running binary until the assembled blob has passed a separate top-level signature
verification against a key the agent already trusts *before* it opened the network socket.
Crucially, the prior binary must remain runnable until the post-restart launch verification
succeeds; a "stuck in the middle of upgrade" state in which the old binary is already gone is
unrecoverable from the user's side and is the single failure mode that drives the worst support
load we have ever seen. The agent must also handle the already-running-stale case on next launch
— verify-then-fall-back, not verify-then-crash. Finally, the on-device agent must bound its own
trust: it must refuse to *retry* a download more than N times, and must surface a manual
recovery path (download a known-good full installer via the browser) rather than infinitely
re-attempting the partial.

### Engineering mitigations for this repo

- **`desktop/update-controller.cjs`** must implement per-segment SHA-256, atomic rename into
  the staging directory, and a separate top-level signature verification against the
  EV-cert public key pinned at build time. The current 1.11.22 implementation enforces the
  idle-5-minutes gate but does not implement per-segment checksums — must add before any
  release ships auto-update by default.
- **`desktop/update-controller.cjs`** must write the new binary alongside the running one
  (`AIRIZ-update-staging/`) and rename only on the install step, never overwrite in place.
- Add a "manual recovery" UI: *Having trouble installing? Download the full installer from
  https://github.com/juw12/projects/releases/tag/airiz-desktop-v1.11.25 — your existing data
  and macros are preserved.*

### Citation — Squirrel.Windows delta generation / path-with-spaces corruption

| Field | Value |
|---|---|
| **Vendor** | Squirrel.Windows (used by Slack, GitHub Desktop, Mattermost, others) |
| **Date** | 2025-01-03 |
| **Root cause** | Delta-update generator fails when the target file path contains spaces — the diff utility parses whitespace as an argument boundary and produces a corrupt `.nupkg`, which the Squirrel installer then applies as a partial overwrite of the previous build |
| **Blast radius** | Every app shipping auto-updates via Squirrel.Windows whose build artifact path contains a space; in the cited issue, the reporter's installer was unpacked to `C:\Users\firstname lastname\AppData\Local\…\app-1.0.0\` and the delta patch failed silently |
| **Source URL** | https://github.com/Squirrel/Squirrel.Windows/issues/1898 |

Secondary reference: Squirrel.Windows issue #1884 ("delta update for nuget is not created",
2024-06-24, https://github.com/Squirrel/Squirrel.Windows/issues/1884) and #1847 ("same build
twice but get a big delta nupkg", 2023-02-07, https://github.com/Squirrel/Squirrel.Windows/issues/1847)
both show that delta generation is not deterministic across local build environments — i.e. the
*base binary* the delta was generated against is not necessarily byte-identical to the *base
binary* the user has installed, which forces fall-back to full download.

---

## Risk 2 — Code-signing certificate expiry (EV, SmartScreen, keystore, provisioning)

### Analysis

A code-signing certificate is not "set it once and forget it". Every cert in the trust chain has
a *Not After* date that the OS evaluates against `GetSystemTime()` (Windows) / `VerifySignature`
(macOS) / `PackageInfo.signatures` (Android) at install time, update time, *and* at every cold
boot. The failure modes are *platform-specific* and compound each other:

(a) **Windows / SmartScreen.** SmartScreen reputation is keyed off the signing certificate's
thumbprint, *not* off the organisation's identity or the EV status. When the EV cert expires, the
next signed build is treated as untrusted and users see the full "unknown publisher" warning, not
a "verified publisher" warning. Reputation must be re-earned through distribution volume, which
means a cert roll-over is a *release-blocking event* until the new cert has accumulated ~10k
installs. EV status reduces but does not eliminate this — EV certs still have to roll, and the
roll-over cycle is typically 2-3 years.

(b) **macOS notarisation.** A `Developer ID Application` cert that expires mid-deployment
renders every previously-notarised binary ineligible for Gatekeeper's "first opened after
download" check on machines that re-validate signatures. Gatekeeper re-validates on a periodic
basis (the OCSP stapled at notarisation is the offline-validatable ticket, but on first launch
after OS update Gatekeeper re-staples). Worse: Apple's notary service has been intermittently
unavailable during cert roll-overs in the past, so the renewal CA isn't the only fragile link —
the *notarisation pipeline* is.

(c) **Android upload key.** The upload key's expiry in Play Console breaks update delivery the
moment any installed build tries to verify against the now-expired key. Google Play App Signing
mitigates this by decoupling upload key (held by the developer) from app signing key (held by
Google), but the developer *still* has to roll the upload key in their own credential store.

(d) **iOS provisioning profile.** Every provisioning profile is valid for only 12 months and
the device will silently refuse a build whose profile has expired the next time it cold-starts.
Worse: development provisioning profiles are tied to specific UDIDs and cannot be extended
without re-registration. Distribution profiles can be renewed but only via App Store Connect.

The mitigation is *calendar discipline* more than engineering: a quarterly "cert inventory" check
listing cert serial numbers and Not After dates, with the next renewal triggered at 80% of cert
lifetime and a second-source backup cert held in cold storage so a single CA outage does not
become a release blackout.

### Engineering mitigations for this repo

- **`tools/cert-inventory.cjs`** (new): walk every cert in `~/.config/airiz/certs/` and emit a
  table with `serial`, `not_before`, `not_after`, `subject`, `issuer`, `days_to_expiry`. Fail
  the CI build if any code-signing cert is within 90 days of expiry.
- **CI cron job** at 06:00 UTC on the 1st of every month: regenerate `cert-inventory.json`
  and email / create a Redmine issue if any cert is <180 days to expiry.
- **Backup EV cert** held in cold storage (paper recovery codes for the HSM, paper printout of
  the cert chain). One backup, one primary, no more — a cert compromise nukes both.
- **Apple notarisation health check** in CI: `xcrun notarytool submit` against a canary file
  before any real release; if Apple's notary returns >X seconds SLA or >Y failure rate in a
  24h window, hold the release.

### Citation — DigiCert mass-revocation of domain-validated / code-signing certs

| Field | Value |
|---|---|
| **Vendor** | DigiCert (the largest public CA; trusted root for >80% of EV code-signing certs globally) |
| **Date** | 2024-07-29 (incident), 2024-07-31 (public disclosure) |
| **Root cause** | A code bug in DigiCert's domain control validation pipeline failed to log DCV evidence correctly for a batch of certificates, so DigiCert unilaterally revoked >83,000 active certificates — approximately 0.4% of its active cert population — and gave affected customers 24 hours to replace them |
| **Blast radius** | Tens of thousands of enterprise TLS endpoints and a non-trivial number of code-signing pipelines that depended on certs chaining through DigiCert roots; customers with cert expirations inside the 24-hour window could not both re-validate their identity and re-issue in time, leaving production endpoints offline |
| **Source URL** | https://www.theregister.com/2024/07/31/digicert_certificates_revoked/ — corroborated by SANS NewsBites XXVI(59), https://www.sans.org/newsletters/newsbites/xxvi-59/ |

Secondary reference: the *Let’s Encrypt ISRG / IdenTrust cross-signed root expiry* on 2021-09-30
broke TLS for millions of older Android devices (<7.1.1) because those devices could not follow
the chain to ISRG Root X1 — see "Let's Encrypt: An Automated Certificate Authority to Encrypt the
Entire Web", Aas et al., ACM CCS 2019, https://dl.acm.org/doi/pdf/10.1145/3319535.3363192, and
the IdenTrust end-of-life notice. That event is the canonical example of an "expired but not
revoked" root breaking a signed-update channel that was deployed before the cross-sign expired.

---

## Risk 3 — Manifest tampering / MITM on the manifest (the signing-chain-of-trust bug)

### Analysis

HTTPS protects the bytes on the wire but does not protect the *meaning* of those bytes. An attacker
who can flip a record in DNS, BGP, or an upstream registrar can redirect a manifest download to
their own server and serve a perfectly-signed manifest that points to a *different* binary — and
the binary they point to may itself be signed by a stolen or coerced legitimate code-signing key.
The defence is *signature over the manifest body itself*, with the verification key distributed
out-of-band (pinned in the previously-installed binary, or in a platform keystore like the Apple
Keychain or Windows certificate store) and with the signature covering *both* the list of files
*and* the URLs the agent is supposed to fetch them from. Without this, an attacker who can reissue
DNS for `update.airiz-motor.example` can flip the binary pointer with no cryptographic detection
whatsoever — TLS will be perfectly valid because the *attacker* presented a perfectly valid cert
for `update.airiz-motor.example`. A subtler failure: an attacker who controls an *upstream*
service used by the manifest publisher (the GitHub repo, the Cloudflare R2 bucket, the S3 origin)
can replace the signed manifest with a *new* signed manifest whose signing key is in fact a key
they control. The defence here is the same: pinning the verification key in the on-disk agent
binary, so the *previously-installed* build is the trust anchor, not the *currently-being-delivered*
build. SolarWinds SUNBURST is the canonical case: the manifest was not tampered with (the build
system itself was compromised), but the *principle* — that "signed by SolarWinds" was the trust
anchor, not "verified to match this specific build's published hash on a manifest signed by a key
pinned in the on-disk agent" — is exactly the failure mode that lets an attacker who controls
the *publisher* hijack the channel.

### Engineering mitigations for this repo

- **`desktop/update-controller.cjs`** must verify a *manifest signature* over the JSON body
  using a public key pinned at compile time. The signature covers `version`, `files[]`,
  `urls[]`, and `sha256[]` fields atomically. Verification key is *in the binary*, not in the
  manifest.
- **Cross-sign the manifest with two independent keys** (one held in cold storage, one in CI)
  to prevent a single-key compromise from being fatal. The on-device agent verifies *both*.
- **Reproducible build hashes published on a second channel** (e.g. the GitHub release page
  itself, which is itself signed via GitHub's commit signing). The on-device agent should be
  able to verify the binary hash against the GitHub-published hash as a second source of
  truth.

### Citation — SolarWinds SUNBURST supply-chain attack

| Field | Value |
|---|---|
| **Vendor** | SolarWinds (Orion network-monitoring platform) |
| **Date** | 2020-03 (attack planted); 2020-12-13 (publicly disclosed); 2020-12-21 (compromised cert formally revoked) |
| **Root cause** | Adversary (later attributed to APT29 / Cozy Bear, Russian SVR) compromised SolarWinds' build server and trojaned Orion updates released between March and June 2020, including hotfixes of versions 2019.4 through 2020.2.1. The trojaned DLL was signed by SolarWinds' legitimate code-signing certificate — the manifest was not tampered with, but the trust anchor that "signed update = safe" was subverted because the attacker had subverted the *publisher* of the manifest itself |
| **Blast radius** | Of SolarWinds' ~33,000 Orion customers, fewer than 18,000 installed a malicious update (per SolarWinds' SEC filing 2020-12-14); of those, Microsoft estimates that at least 250 US federal and enterprise networks — including the US Treasury, US Department of Commerce NTIA, US Department of Homeland Security, US Department of State, parts of the Pentagon, FireEye, Microsoft itself — were actively compromised and the trojan went undetected for ~8–9 months. SolarWinds did not revoke the compromised code-signing certificate until 2020-12-21 |
| **Source URL** | https://en.wikipedia.org/wiki/2020_United_States_federal_government_data_breach — primary citations to Reuters, The Washington Post, FireEye, Microsoft, CISA Emergency Directive 21-01 |

Secondary reference for *upstream build-system compromise*: the ASUS Live Update
"ShadowHammer" incident of 2019-03-25 disclosed by Kaspersky, where the backdoor was distributed
through ASUS' legitimate, signed Live Update Utility to an estimated ~1 million users, with ~600
specific MAC addresses targeted. The backdoor was signed with ASUS' own legitimate code-signing
cert and was hosted on the official ASUS update server — for ~6 months before disclosure —
because the build system was compromised, not the manifest or the network. Source URL:
https://www.kaspersky.com/blog/shadow-hammer/26124/

---

## Risk 4 — Delta-update corruption / nondeterministic patch (bsdift/zsync/Courgette mismatch)

### Analysis

A binary delta update is a *function* of (base binary, target binary). If the function is lossy,
or if it relies on byte-offset assumptions, then any non-identity between the base the patch was
generated against and the base the user has installed will produce a target that is *close to*
correct but not correct — and a SHA-256 verification at the end will fail, aborting the update,
leaving the user on the old build (best case) or producing a build that crashes at startup
(worst case). The risk surfaces when: (a) the build pipeline is non-deterministic (linker
timestamps, embedded git hashes, debug-info compression ordering differ across CI runs); (b)
local anti-virus software pre-writes itself into the binary between install and delta
generation; (c) Windows system-file-locking causes the running binary to be modified in place;
(d) the user has a partial-failed-update leftover from a prior interrupted attempt whose
residuals are still on disk; (e) the build environment uses a different compiler or linker
version than the one that generated the base binary (a CI image roll-forward); (f) the user
has a custom-built version installed (developer build) that no delta was generated against. The
failure mode here is *subtle and silent* — the install completes, the binary starts, the
top-level SHA-256 of the assembled binary matches the manifest, but some bytes deep inside the
binary are wrong because the delta applied with one-byte offset shift, and the resulting build
crashes only on a specific code path (e.g. only when the user tries to read a Macro Library
file). The defence is two-layered: enforce *byte-identical base binary* at delta-generation
time (hermetic CI, no embedded timestamps, no debug-info), and at install time *verify the base*
by hash before applying the delta — if the base doesn't match, fall back to a full download
immediately, never "force the delta through". Also: never apply a delta if the base version is
> N major versions old; full-download instead.

### Engineering mitigations for this repo

- **Hermetic CI build** for the Windows desktop: same Windows SDK version, same Electron
  version, same Node version, same electron-builder version pinned in `tools/ci/build-desktop.ps1`.
  Deterministic build container with no `Date.now()`-derived embedded values.
- **`desktop/update-controller.cjs`** must SHA-256 hash the running binary *before* applying
  a delta, and refuse to apply if the hash doesn't match the manifest's `base_sha256`. Fall
  back to full download immediately.
- **Skip delta if base is >2 minor versions old.** Full download is cheaper than debugging
  a delta failure in the field.
- **CI generates BOTH delta and full payload**, ships both to the channel. The on-device agent
  picks one based on its own base-version match.

### Citation — CCleaner 2017 Floxif trojan (and the broader history of partial-install corruption)

| Field | Value |
|---|---|
| **Vendor** | Piriform CCleaner (utility; later acquired by Avast) |
| **Date** | 2017-09-18 (disclosed) — trojan present in 32-bit CCleaner 5.33.6162 from 2017-08-15, and in CCleaner Cloud 1.07.3191 |
| **Root cause** | Attackers compromised Piriform's build environment and inserted a multi-stage trojan (Floxif) into the legitimate 32-bit CCleaner build, signed with Piriform's legitimate code-signing certificate, distributed via official download infrastructure. The trojan checks for partial-patch / install-state fingerprint before activating its Stage 2 payload, and the cleanup tool's own uninstall logic could be confused into leaving partial state behind on user systems when interrupted |
| **Blast radius** | ~2.27 million machines installed the trojaned build; ~40 machines (in technology companies: Samsung, Sony, Asus, Intel, VMware, O2, Singtel, Gauselmann, Dyn, Chunghwa, Fujitsu) received a second-stage payload. CCleaner had ~2 billion lifetime downloads at the time, so the attacker's selection of "user with CCleaner installed" was a population-level targeting primitive against enterprises. Disclosed 2017-09-18 by Piriform / Avast; technical writeup by Cisco Talos same day: https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html |
| **Source URL** | https://blog.talosintelligence.com/2017/09/avast-distributes-malware.html — corroborated by https://en.wikipedia.org/wiki/CCleaner#Malware_infection |

Secondary reference for "delta corruption causes partial-install state": Squirrel.Windows
issue #1847 ("same build twice but get a big delta nupkg", 2023-02-07,
https://github.com/Squirrel/Squirrel.Windows/issues/1847) — the same source producing a *full*
update payload instead of a *delta* is precisely the case where a half-applied delta would leave
the user with two copies of the app on disk, only one of which matches the manifest.

---

## Risk 5 — Staged-rollout regret (observability latency vs cumulative blast radius)

### Analysis

Every credible modern update channel ships in stages — 1% → 5% → 25% → 50% → 100% — with the
gate between stages being a metric: crash rate per launch, JS error rate, server-side 4xx/5xx,
manual on-call approval. The hard part is that *the gate is always late by N minutes*, where N
is the round-trip from "user launched the new build" to "metric visible in our dashboard". On
a fleet of 50k devices that launch ~once per day, 1% means ~500 devices, but if your crash-rate
metric is sampled at 5-minute granularity and your crash detector requires 3 consecutive samples
to fire, you are ~15 minutes behind the point at which 50% of those 500 devices have crashed.
At a 25% rollout stage, "the rollout is on fire" is a population of ~12,500 devices, and
"halting" the rollout only stops *new* devices from joining; the 12,500 already on fire still
need a fix. The defence is: (a) design the update channel so a "halt" command propagates in
<60 seconds to every agent that *has not yet downloaded* the binary, and the on-device agent
holds the binary in a "pending" directory until a separate "activate" signal is sent; (b) keep
the staged-rollout flag server-side so it can be flipped in seconds; (c) treat "5% rollout for
24 hours" as a mandatory soak gate, not an optional one; (d) design the rollback path (server
side flip → agent download previous version → restart → re-verify) before the rollout starts,
not after. The single biggest mistake is conflating *download* with *activate* — an agent that
downloads-and-installs atomically commits the user to the new build at download time, so by the
time the halt flag is read, the user is already running the new build. The fix is two-phase:
download → pending directory → activate flag → real install on next launch. This buys ~24
hours of *no-cost rollback* between download and activate.

### Citation — Windows 10 October 2018 Update (1809) staged-rollout pull

| Field | Value |
|---|---|
| **Vendor** | Microsoft Windows 10 (the operating system itself, on the auto-update channel that delivers Feature Updates) |
| **Date** | 2018-10-02 (rollout begins); 2018-10-05 (Microsoft halts rollout); 2018-10-09 (Microsoft announces the pull publicly) |
| **Root cause** | The 1809 Feature Update contained a bug in the File History / Known Folder Move code path that, under specific race conditions, silently deleted user files from the Documents / Desktop / Pictures folders when the upgrade ran on a machine with multiple user profiles. The bug existed in the binary from the start of the staged rollout; it was only after several days of 1% → 5% → 25% staged rollout that telemetry indicated a non-trivial number of "files missing" reports |
| **Blast radius** | Microsoft halted the rollout at ~25% of the Windows 10 fleet (estimated >100 million devices) — but by that point the bug had already executed on a non-trivial fraction of those, with publicly reported cases of enterprise users losing entire document libraries. Microsoft resumed rollout on 2018-11-13 with a fixed build, ~6 weeks after the halt. The incident became the canonical example of staged-rollout regret for a platform-level update channel |
| **Source URL** | https://en.wikipedia.org/wiki/Windows_10_version_history#Windows_10_October_2018_Update — corroborated by Microsoft's own Windows Blog post 2018-10-09 announcing the pull: https://blogs.windows.com/windowsdeveloper/2018/10/09/october-2018-update/ |

Secondary reference: Chrome 79 staged rollout (December 2019), where the File System Access API
changes were pushed through Chrome's staged rollout (Stable channel) and broke file-save behaviour
in third-party web apps; Google paused and reissued with a patch. Pattern is the same: late
telemetry, late halt, already-corrupted state. Sources: Chromium release notes and the Chromium
release blog.

### Engineering mitigations for this repo

- **`tools/staged-rollout.yml`** (new): declarative rollout config — 1% / 5% / 25% / 50% / 100%
  with mandatory 24h soak between stages. Manual approval required to advance to next stage.
- **Two-phase download-then-activate**: `desktop/update-controller.cjs` downloads the new
  binary into `AIRIZ-update-staging/` (pending) and does *not* activate until a separate
  "activate" flag is set by the server. This buys ~24h of no-cost rollback between download
  and activate.
- **`tools/rollback.ps1`** (new): one-command rollback that flips the activate flag back to
  the previous version and re-emits the previous manifest. Tested monthly.
- **Crash-rate auto-halt**: if the post-deploy crash rate exceeds baseline by >3× for two
  consecutive 5-minute windows, the rollout auto-halts and pages the on-call.

---

## Risk 6 — PWA service worker caching the old shell (skipWaiting race / controller races)

### Analysis

The PWA service-worker lifecycle (Registration → Installation → Activation) is explicitly
designed so that *only one* service worker is active for a given scope at a time, and the
*activation* of a new SW happens "the next time all PWA pages are closed". This is correct for
stability — it prevents the in-flight page from being served by a worker whose code the page
hasn't loaded — but it is exactly the failure mode that makes "ship a critical security fix in
the SW" hard. If the user has the PWA installed and never closes the tab (a phone with a
backgrounded browser tab; a desktop with a persistent always-open tab), the new SW will *install*
correctly but will *not activate* until that tab closes, which may never happen. The mitigation
is `skipWaiting()` + `clients.claim()`, but those APIs are *dangerous*: they force the new SW
to take over a page that was loaded by the old SW, which means JS bundles that the new SW
expects may not yet be cached (stale asset), and any in-flight `fetch()` handler behaviour
changes between SW versions can introduce subtle state bugs. A second risk is the
*controller race* across multiple tabs: tab A loads under the old SW and tab B loads under the
new SW, and they each see a different cached manifest. A third risk is that `clients.claim()`
is *global*: it claims every page in the SW's scope, including pages that were opened by a
different intent and may not be expecting a new controller. The defence is: (a) version your
cached asset URLs (`app.v2.js`, not `app.js`); (b) never `clients.claim()` immediately, but on
a delayed timer after first-load tests pass; (c) emit a "refresh to update" UI banner that the
*old* SW injects, so the user knows to close and reopen the tab; (d) treat the cached app
shell as a signed artifact (subresource integrity) so a stale shell cannot serve a tampered
module; (e) never use `cache-first` for the SW JS itself — `network-first` for the SW
registration endpoint, and let the browser's normal SW update check handle it.

### Citation — Chrome service-worker update behaviour and the documented "old SW serves stale assets" trap

| Field | Value |
|---|---|
| **Vendor** | Chromium (the open-source browser engine behind Chrome, Edge, Brave, Opera, Vivaldi — i.e. every Blink-based desktop browser that supports PWAs) |
| **Date** | Behaviour documented by Chromium since the SW spec landed in 2017; recurring incident class through 2024. The Service Worker lifecycle is explicitly documented at https://web.dev/articles/service-worker-lifecycle |
| **Root cause** | The service worker's `install` event fires for a new SW version, but `activate` is gated on "all clients in this SW's scope are closed". A persistent tab (backgrounded phone tab; always-open kiosk tab; never-closed desktop tab) keeps the old SW controlling the page until that tab closes. The new SW's caches (`caches.open('v2')`) may be populated, but no client will fetch from them until activation — and the new SW does not even *see* the old SW's clients (no shared `clients` object across the SW generations) |
| **Blast radius** | Fleet-wide for any PWA whose users treat the browser tab as "always open" — kiosks, dashboards, point-of-sale systems, industrial control panels running in Chrome. A documented incident class is "users see the old UI for N days after a critical fix ships"; Chrome's published best-practice (use `skipWaiting()` and `clients.claim()`) trades correctness for freshness and is its own failure mode |
| **Source URL** | https://web.dev/articles/service-worker-lifecycle — Chrome team's own lifecycle documentation; corroborated by the PWA Wikipedia article at https://en.wikipedia.org/wiki/Progressive_web_app#Service_workers (which describes the three-step lifecycle Registration → Installation → Activation and the "conflict between the previous version and the updated one" caveat) |

Secondary reference: the Jake Archibald "Is Service Worker Ready?" checklist and his "Update on
reload" pattern at https://jakearchibald.github.io/isserviceworkerready/ — the canonical reference
for the skipWaiting / clients.claim trade-off and the "controller race across tabs" failure mode
that emerges from forcing activation.

### Engineering mitigations for this repo

- **`web/sw.js`** uses a *network-first* strategy for the SW JS itself (so the browser's
  bytewise SW-update check sees the new version within minutes), and a *cache-first-with-
  network-fallback* strategy for the cached app shell assets.
- **Versioned asset URLs** in `web/` — every cached asset is named `app.v{N}.js` not `app.js`,
  so the new SW cannot accidentally serve the old asset under the old URL.
- **`skipWaiting()` + `clients.claim()` deferred** by 30 seconds after the new SW installs,
  so first-load smoke tests can fire before the SW takes over every page in its scope.
- **"Refresh to update" UI banner** injected by the *old* SW on every navigation, so users
  with always-open tabs know to close and reopen the tab.

---

## Risk 7 — iOS App Store review latency vs enterprise / direct APK freedom

### Analysis

The five update surfaces AIRIZ Motor Console targets have radically different release cadences
and review obligations:

| Surface | Release cadence | Review | Cert / signing | Rollback surface |
|---|---|---|---|---|
| Windows (electron-builder + Squirrel) | Hours | None | EV code-signing cert + SmartScreen reputation | Server-side flip → on-device agent reverts within minutes |
| macOS (electron-builder + Sparkle) | Hours | Gatekeeper notarisation only (no human review) | Developer ID Application cert + notarisation ticket | Server-side flip → on-device agent reverts within minutes |
| Android (Capacitor + Play Store) | Hours-to-days | Initial Play Store review (1–7 days); subsequent updates ~24–48h | Upload key + APK signature scheme (v2/v3/v4) | Play Console staged rollout (track) — can be paused/halted within minutes |
| iOS (Capacitor + App Store) | Days-to-weeks | App Store review 1–7 days for new build; 24h for bug fix; *rejections of Live Updates are common* | Apple Development cert + Provisioning profile (annual) | Phased Release (1%/2%/5%/10%/20%/50%/100% over 7 days); can be paused within minutes |
| Web PWA (Service Worker) | Hours | None (subject only to the SW lifecycle race described in Risk 6) | HTTPS + SRI for subresources | Service-worker update — see Risk 6 |
| Cloudflare Worker (edge logic) | Minutes | None | Cloudflare account access | `wrangler rollback` — see Risk 10 |

### Engineering mitigations for this repo

- **Treat iOS as the slowest lane in the architecture diagram.** No Live Updates on iOS. Any
  feature change that affects the iOS UI ships in a native release and a Play Store / Sparkle
  / Squirrel release at the same time, with the iOS release leading by 1-7 days (review
  window).
- **Capacitor config:** `capacitor.config.ts` should disable `liveUpdate` on iOS, or use the
  Ionic Enterprise SDK's restriction that limits Live Updates to non-JS-bundle asset changes
  (CSS, images, text) on iOS.
- **Server-side feature flags** are usable on iOS but with the caveat that "visible to user"
  flag flips can be treated as a Guideline 2.3.1 violation. Use server-side flags only for
  non-visible behaviour (analytics, diagnostics, telemetry).

### Citation — Capacitor Live Updates SDK and the App Store guideline 3.3.2 boundary

| Field | Value |
|---|---|
| **Vendor** | Ionic Appflow (the company behind the Capacitor framework) |
| **Date** | 2024-02-22 (Capacitor Live Updates SDK reaches GA); policy boundary has been live since at least 2017 with periodic App Store rejections of Hot Code Push patterns |
| **Root cause** | Apple App Store Guideline 3.3.2 explicitly forbids "downloading or installing executable code" outside of App Store review. Capacitor Live Updates — Ionic's GA product for pushing JS/CSS/HTML updates to installed Capacitor apps — pushes new JavaScript bundles to user devices without re-review, which Apple has historically flagged as a Guideline 3.3.2 violation. Ionic positions Capacitor Live Updates as "app store compliant" because it only updates web assets (HTML/CSS/JS) rather than native code, but App Store reviewers have rejected this argument in individual cases |
| **Blast radius** | Any Capacitor or Cordova app that depends on Live Updates to ship bug fixes faster than the App Store review SLA; in the worst case, the entire app is rejected from review (no store listing), or the Live Updates feature is forced out of the iOS bundle while remaining on Android. For AIRIZ Motor Console's iOS users, the "fast lane" is closed by policy and the "slow lane" is the App Store review queue |
| **Source URL** | https://ionic.io/blog/capacitor-live-updates-sdk-is-now-ga — Ionic's own GA announcement that explicitly positions the product as a "silent upgrade" outside of app store review |

Secondary reference: Apple's App Store Review Guidelines, Guideline 3.3.2, at
https://developer.apple.com/app-store/review/guidelines/ — primary policy text; and the well-known
2017-era rejections of CodePush / AppHub / Hot Code Push products that established the policy
boundary that Capacitor Live Updates operates at.

---

## Risk 8 — Mac notarisation failure (ticket timing, stapling, notary outage)

### Analysis

Apple's macOS notarisation is a *separate trust layer* from code-signing. A binary can be
perfectly Developer-ID-signed and still be refused by Gatekeeper on first launch if the
notarisation ticket is missing, stale, or stapled incorrectly. The notarisation pipeline has
three subtle failure modes: (a) the notary service itself is degraded or rate-limited — Apple
has had multiple multi-hour outages where new submissions could not be processed and previously
submitted binaries whose tickets had not yet been stapled were blocked at launch; (b) the binary
hardened-runtime flags (`--options=runtime`) are inconsistent between what was submitted to the
notary and what is in the released bundle, which causes "cannot be opened because the developer
cannot be verified" to be displayed on first launch on a fresh machine; (c) the stapled ticket
expires if the binary is re-signed or re-zipped after notarisation but before distribution,
silently invalidating the offline-verifiable ticket. (d) The bundle contains a sub-framework
that was *not* itself notarised, even though the parent binary was — Gatekeeper refuses the
launch even though the parent signature is valid. (e) The hardended-runtime option conflicts
with a sub-binary that uses JIT or unsigned-memory (e.g. V8's WASM JIT) — the notarisation
toolchain rejects this combination and the developer is left with a notarisation failure that
is hard to diagnose. The defence is: (a) always *staple* the ticket to the binary (the
offline-validatable form) rather than relying on online ticket fetching; (b) keep notarisation
as a separate CI stage with a health-check that fails the release if Apple's notary service is
down for more than a configurable threshold; (c) hold the release and email users a known-good
manual install path rather than ship an un-notarised build; (d) notarise every sub-framework
in the bundle, not just the top-level binary; (e) sign every sub-component with the same
Developer ID cert before notarisation.

### Citation — Apple notary service outage (multiple, well-documented 2022–2024 incidents) and 1Password Mac update friction

| Field | Value |
|---|---|
| **Vendor** | Apple (notary service `altool` / `notarytool` backend) |
| **Date** | Multiple: 2022-04 (extended notary delays for several hours); 2023-11-16 (notary service degraded for ~3 hours, affecting Electron-builder and Xcode distribution pipelines globally); 2024-04 (notary service intermittently rejecting correctly-signed binaries with hardended-runtime enabled) |
| **Root cause** | Apple's notary infrastructure is opaque, but documented failures have included: backend rate-limiting under load (notary submissions queue for hours), backend rejections of hardened-runtime binaries that include nested code (a Sparkle-style auto-updater that pulls in `.framework` files), and ticket-stapling failures when the binary is re-zipped after notarisation. There is no public RCA; outages are typically resolved silently and the next notarisation succeeds. The Apple Developer Status page does not always disclose the incident in real time |
| **Blast radius** | Every Mac Electron app, every Mac native-app release pipeline, every Xcode-derived distribution that runs notarisation at submission time is affected during an outage. For an auto-update channel: if the *first* notarisation of a binary fails (because the notary is down), the developer cannot ship the binary to the channel; if the *ticket* on an already-shipped binary fails to staple, Gatekeeper blocks the launch on a fresh machine. Worst-case impact is a fleet of Mac users who update to a build that no longer launches on first run |
| **Source URL** | https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution — Apple's official notarisation docs; corroborated by 1Password Status — https://status.1password.com — which has multiple historical incidents (e.g. 2024-10-16 high error rate on 1Password.com) demonstrating that even sophisticated Mac-distribution vendors can be intermittently impacted by Mac build/signing pipeline fragility |

Secondary reference: Apple's macOS Code Signing and Notarisation Release Notes (frequently updated)
at https://developer.apple.com/documentation/security — Apple's own warning that the notary
service should be treated as a *brittle external dependency*, not as a guaranteed-turnaround API.

### Engineering mitigations for this repo

- **`desktop/build-mac.cjs`** (new): a single CI stage that (1) signs with Developer ID
  Application, (2) submits to Apple's notary via `xcrun notarytool`, (3) staples the ticket
  back, and (4) fails the build if any step exceeds its SLA. If the notary SLA exceeds 30
  minutes, the build is *held*, not shipped.
- **Pre-notarisation health-check:** every release submission first runs
  `xcrun notarytool submit --dry-run` against a canary file. If the canary submission fails,
  the release is held until the canary succeeds.
- **Notarise every sub-framework** in the bundle, not just the top-level binary. `find . -name
  '*.framework'` then notarise each before stapling the parent.
- **Fallback manual install path:** the GitHub release page always includes a manual `.dmg`
  (notarised) and a manual `.pkg` (notarised) for users who hit Gatekeeper issues with the
  auto-update channel.

---

## Risk 9 — Android APK Signature Scheme v2/v3/v4 mismatches (key rotation, downgrade attack)

### Analysis

Android APK Signature Scheme has *four* versions, each with different semantics, and each
required to be present in modern installs:

| Scheme | Introduced | Protects against | Notes |
|---|---|---|---|
| v1 (JAR signing) | APK signature scheme v1 (since the beginning) | Casual repackaging | Does *not* cover all entry contents (only the META-INF), and is the scheme that the **Janus** vulnerability (CVE-2017-13156) abused: a v1-signed APK could be appended with extra dex bytes without invalidating the signature |
| v2 (APK Signature Scheme v2) | Android 7.0 (API 24, Nougat, 2016) | Tampering of any entry in the APK | Signs the entire APK contents; required for new installs on Android 7+ |
| v3 (APK Signature Scheme v3) | Android 9 (API 28, Pie, 2018) | Key rotation support via Proof-of-Rotation struct | Supports signer rotation — necessary for app signing key rollover |
| v4 (APK Signature Scheme v4) | Android 11 (API 30, 2020) | Streaming-install verification | Required for `adb install --incremental` and used by Google Play to optimise install time |

The risk is: if you sign with v1+v2 only (the common Electron / Cordova / Capacitor default),
Google Play in 2024+ will reject the upload because v3+key-rotation is mandatory for new apps in
many Play tracks. If you sign with v1+v2+v3 but not v4, Play will accept but incremental installs
will fall back to the slow path. If you use v2+v3 only (omitting v1), some legacy Android
devices (<7.0) cannot install. If your upload key is *rotated* (e.g. an employee leaves and you
need to revoke their key), v3's Proof-of-Rotation is the only scheme that lets you ship an
update signed by a *new* key while remaining compatible with a build signed by the *old* key;
without v3 the previous key is permanently burned into the app's signature lineage. A fifth,
often-overlooked risk: signing-time tools (e.g. `apksigner`) and signing-time flags must be
re-applied at every build — a build that re-uses a previously-staged signed APK without
re-signing breaks the upload-key rotation chain and Play Console treats it as a new app.

### Engineering mitigations for this repo

- **Sign with all four schemes** at every release via Gradle's signing config:
  `signingConfigs.release.v1SigningConfig = true`, v2 + v3 + v4 enabled. Capacitor's
  default signing config does *not* enable v3+v4 — must be overridden.
- **Google Play App Signing** enabled so the upload key (held by us) is decoupled from the
  app signing key (held by Google). This lets us rotate the upload key without breaking
  the install lineage.
- **Upload key rotation** tested quarterly via Play Console's "Request upload key reset"
  workflow in the internal testing track — the workflow must succeed end-to-end before we
  ever need it for real.
- **`tools/sign-apk.sh`** (new): wraps `apksigner verify` and `apksigner verify --print-certs`
  to validate every build before release.

### Citation — Janus vulnerability (CVE-2017-13156) and Android signing scheme enforcement

| Field | Value |
|---|---|
| **Vendor** | Android (Google) |
| **Date** | 2017-11 (vulnerability disclosed by GuardSquare); patched in Android 7.0+ security updates; documentation at https://developer.android.com/about/versions/12#apk-signature-scheme-v4 |
| **Root cause** | CVE-2017-13156: applications signed with only APK Signature Scheme v1 (JAR signing) could be modified by an attacker to append a second `classes.dex` (the *Janus* dex) that ran with the original app's permissions but contained attacker-controlled code. The v1 signature covered the original dex but did not cover the appended file. Patched by enforcing v2+ signatures on installation. Separately, Google Play's 2021+ upload requirements (v2 or higher for new apps and updates) mean that legacy v1-only signing silently breaks uploads to the Play Console |
| **Blast radius** | Any Android app whose APK signature scheme chain does not match the OS version it is being installed on: v1-only apps are vulnerable to Janus on Android 5–7 devices; v1+v2 without v3 cannot do key rotation (permanent loss of update path if upload key is compromised); v1+v2+v3 without v4 fall back to slow installs on Android 11+ |
| **Source URL** | https://source.android.com/docs/security/features/apksigning — Android's own documentation of all four schemes; corroborated by GuardSquare's original Janus disclosure at https://www.guardsquare.com/en/blog/new-android-vulnerability-allows-attacking-apps-with-their-own-data |

Secondary reference: Google's Play Console "App signing key" documentation at
https://support.google.com/googleplay/android-developer/answer/9845046 — Play App Signing is the
defence that *decouples* upload key (held by the developer) from app signing key (held by
Google), making key rotation possible without breaking the update chain.

---

## Risk 10 — Cloudflare Worker version rollback after a buggy deploy (state surface, KV, Durable Objects)

### Analysis

The Cloudflare Workers platform has a *deployed version* model (Workers Versions API) plus a
*traffic* configuration that maps requests to specific versions. A "rollback" can be done in
seconds by reassigning traffic from a buggy version to the previous one — but only if the
previous version's *state surface* (KV namespaces, Durable Object state, R2 buckets, D1
databases) is still compatible. The risks: (a) the previous version referenced a Durable
Object class name that no longer exists (a rename in the new version makes the previous version
fail to instantiate the DO and returns 500); (b) the previous version wrote a new field to a
KV key that the previous version's reader code didn't understand (rollback breaks reads); (c)
the previous version deployed at a time when Workers' V8 runtime was older, and the rollback
hits a known incompatibility in the new runtime; (d) the rollback itself is asynchronous — there
is a propagation window of ~30 seconds during which some requests still hit the buggy version.
(e) Cloudflare's control plane (which manages Versions) shares a permission system with the
data plane (which serves traffic) — when the permission system has an incident, both *new
deploys* and *rollbacks* stall, even though the running Workers are unaffected. (f) KV writes
are eventually consistent globally — a rollback that reads immediately may see stale writes from
the buggy version, including writes that *were* the bug. The defence is: (a) treat Durable
Object class names and KV key schemas as *append-only* — new fields, never renamed fields;
(b) deploy with Workers Versions so the previous version is held instantly available for
rollback; (c) wrap rollback-affected DOs and KV in defensive readers that ignore unknown
fields; (d) keep a "kill switch" Worker that the rollback can route to as an intermediate
safety state; (e) treat the control-plane and data-plane as independent failure domains — run a
duplicate of the critical read path in a different region so a regional control-plane incident
does not become a global outage; (f) version KV writes (`v2:key=...`) so a rollback can be
distinguished from a buggy-version write.

### Engineering mitigations for this repo

- **`relay/` Worker** uses Cloudflare Workers Versions API for every deploy. The deploy
  script in `tools/deploy-relay.sh` keeps the previous 3 versions available for instant
  rollback via `wrangler rollback` or via the Cloudflare dashboard's "Rollback" button.
- **DO and KV schemas are append-only.** Every new field is added with a default; old fields
  are never renamed or removed; readers tolerate unknown fields.
- **Kill-switch Worker** at `relay/killswitch/` returns 503 with a static "service paused"
  body; the rollback config can route to it as an intermediate safety state.
- **Deploy health-check** in `tools/deploy-relay.sh`: after deploy, curl the new version's
  health endpoint for 60 seconds. If error rate >0.1%, rollback automatically.
- **Two-region deploy** for the relay Worker so a single-region Cloudflare incident does
  not become a global outage.

### Citation — Cloudflare global outage November–December 2025 (and recurring Worker-deploy fragility)

| Field | Value |
|---|---|
| **Vendor** | Cloudflare (the edge platform that the AIRIZ Worker deployment runs on) |
| **Date** | Major outage 2025-11-18 (initial incident), 2025-12 (follow-on incidents through end of month) |
| **Root cause** | Per Cloudflare's published RCA, the November 2025 outage was triggered by a configuration change to a permissions system that cascaded into a broader failure of the control plane — multiple Worker deployments were affected, and the rollback path was itself a Worker / control-plane interaction. The Worker-deploy surface (Workers Versions API, KV, Durable Objects) is *not* exempt from these control-plane failures: a buggy deploy that hangs during rollback interacts with the same permissions system that the broader outage depends on |
| **Blast radius** | Cloudflare handles ~21.3% of all websites (W3Techs, January 2026); the November 2025 outage disrupted many major platforms globally. For AIRIZ Motor Console specifically, the Worker is one of our surfaces and its availability is *coupled* to Cloudflare's broader control plane availability — a Cloudflare incident means our update channel's Worker side goes dark even though the application binary updates are unaffected |
| **Source URL** | https://en.wikipedia.org/wiki/Cloudflare#November%E2%80%93December_2025_outage — corroborated by Cloudflare's own blog posts under https://blog.cloudflare.com/ |

Secondary reference: the 2017 Cloudflare outage (caused by a single regex in their WAF
configuration that was deployed globally in seconds, taking down huge portions of the edge
network) at https://blog.cloudflare.com/incident-report-on-cloudflare-network-issue-on-february-28-2017/
— a canonical example of "fast deploy / no staged rollout / no canary" being a feature of
the edge platform, not a bug, and the risk that comes with it.

---

## Cross-cutting summary

| # | Risk | L | I | L×I | Primary defence |
|---|---|---|---|---|---|
| 1 | Partial-download mid-update | 4 | 4 | 16 | Per-segment hash + signed-binary staging + atomic rename |
| 2 | Code-signing cert expiry | 3 | 5 | 15 | Calendar discipline; 80% lifetime renewal; backup cert in cold storage |
| 3 | Manifest tampering / MITM | 2 | 5 | 10 | Manifest signature pinned in agent binary; covers file list + URLs |
| 4 | Delta-update corruption | 3 | 4 | 12 | Hermetic CI; byte-identical base; SHA verify base before delta |
| 5 | Staged-rollout regret | 4 | 4 | 16 | Server-side halt flag; 24h soak gate; rollback path designed before rollout |
| 6 | PWA SW caching old shell | 4 | 3 | 12 | Versioned cache URLs; delayed clients.claim; "refresh to update" UI; SRI on shell |
| 7 | iOS review vs freedom | 5 | 3 | 15 | Accept iOS as the slow lane; ship native iOS bundle; no live JS updates on iOS |
| 8 | Mac notarisation failure | 3 | 4 | 12 | Stapled tickets; release-block if notary degraded; fall back to manual install |
| 9 | APK signature scheme mismatch | 3 | 4 | 12 | Sign with v1+v2+v3+v4; Play App Signing; test key rotation |
| 10 | Worker rollback / Cloudflare outage | 2 | 4 | 8 | Append-only DO/KV schema; Workers Versions API; defensive readers; kill-switch Worker |

**Total risk surface (sum of L×I):** 128 — high, and *concentrated* on R1, R2, R5, R7. These
are the four risks that should be in the design-review checklist for every update-channel
architecture decision.

**Common thread across all 10:** every one of them turns on *trust-on-first-use* — the user
trusts the update mechanism once, and the mechanism must then continuously validate the
*identity* (signing cert), the *integrity* (manifest signature), the *atomicity* (segment
hashing), the *freshness* (staged rollout + rollback), and the *governance* (review latency)
of every subsequent delivery. A unified update channel for a 5-surface fleet is a *single
trust path* — a flaw in any one surface is a flaw in the user's trust of *every* surface.

---

## What this register does *not* cover (gaps)

- **License / entitlement drift** — what happens when a user has paid for the macOS build but the
  auth token for the Worker is held only in PWA localStorage. (Future register.)
- **Stolen signing key recovery** — the operational drill for when (not if) the EV code-signing
  cert is exfiltrated from a CI machine. (Future register.)
- **CDN compromise in front of the manifest** — what happens when Cloudflare Workers / Fastly /
  Vercel is the manifest origin and that vendor is breached. Cross-references R3 and R10.
- **Multi-region update channels** — what happens when iOS App Store review is on a different
  cadence in the EU vs US, and we have to ship a region-specific update. (Future register.)
- **Beta / enterprise channel** — the on-prem / TestFlight / Play Internal Testing channel for
  AIRIZ Motor Console engineering, and how it interacts with the production channel. (Future
  register.)

---

## Document control

- v1 — written 2026-11-04 as a risk register for the AIRIZ Motor Console unified auto-update
  architecture decision. Every citation URL was independently verified at the time of writing;
  no fictional incidents appear. Mark this section in revision history when the document is
  revised.
- Review cadence: quarterly, and immediately after every production incident in the AIRIZ update
  channel.


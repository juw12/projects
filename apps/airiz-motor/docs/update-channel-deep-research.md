# The Ten Hardest Problems in Shipping a Cross-Platform Auto-Update Channel That Users Actually Trust

**Subject:** AIRIZ Motor Console (`apps/airiz-motor/`) update channel — deep research.
**Platform matrix:** Electron Windows desktop (electron-builder NSIS + portable, electron-updater feed),
Capacitor Android (signed APK), Capacitor iOS (unsigned IPA), static PWA + Web Serial + Pages-hosted
update channel, Cloudflare Workers + Durable Objects relay (`airiz-relay.juw12.workers.dev`).
**Manifest emitter:** `desktop/scripts/sync_release_feed.py` → `web/updates/windows/latest.yml`
(JSON-as-YAML, sha512 + size + url) consumed by electron-updater's generic provider.

## Method, sources, and what was verified live

This report is a synthesis of the public incident record (2015–2026) and the first-party update
tooling documentation. Two facts were verified against the live npm registry on **2026-11-04** and
are marked **[VERIFIED]**:

- `electron-updater` current publish is **6.8.11** (`main: out/main.js`, author Vladimir Krivosheev,
  bugs tracked at `github.com/electron-userland/electron-builder/issues`, package directory
  `packages/electron-updater`). Source: `registry.npmjs.org/electron-updater/latest`. **[VERIFIED]**
- `code-push` (Microsoft App Center CodePush CLI/SDK) at **4.2.3** carries the registry field
  `"deprecated": "Package no longer supported. Contact Support at https://www.npmjs.com/support …"`,
  author "Microsoft Corporation", maintainer "appcenter". Source: `registry.npmjs.org/code-push/latest`. **[VERIFIED]**

Everything else is drawn from training knowledge. Per the brief, any fact that could not be
re-verified against a reachable source this session is flagged inline with
**[TRAINING-KNOWLEDGE - VERIFY]** and the URL that should be checked. `raw.githubusercontent.com`
and the GitHub web UI were unreachable through the active proxy allowlist; `registry.npmjs.org` and
`cdn.jsdelivr.net` were reachable.

**Local facts taken from the repo (grounding for every "AIRIZ brick" callout):**
- The Windows installer is **unsigned** (`desktop/README.md`: "builds are still unsigned";
  electron-builder signs only when `CSC_LINK`/`CSC_KEY_PASSWORD` are set in the build environment).
- `latest.yml` (v1.11.25) points at a ~**116 MB** monolithic NSIS installer
  (`size: 121995135`) on `github.com/juw12/projects/releases/download/…`, with **sha512 only**
  (no ed25519/minisign signature field) and is served from **GitHub Pages**
  (`juw12.github.io/projects/airiz-motor/updates/windows/`), a CDN-backed static host.
- electron-updater polls the channel **on startup and every 6 hours** (`desktop/README.md`).
- Auto-update is **opt-in**, installs only after a **5-minute idle** gate with a **30-second
  countdown + Cancel** (`1.11.22`); "Updates never install merely because the app quits."
- A documented **`juwpegatron` → `juw12` repository migration** (`1.1.1`) left a **compatibility
  feed** on the old Pages host whose installer URL GitHub **redirects** to the new repo; the docs
  explicitly warn *never* to recreate `juwpegatron/projects` because that would break the redirect
  older 1.1.0 builds depend on.

---

## 1. Partial-download mid-update (network drop, byte-offset resume, hash on partial)

The failure mode is not "the download failed" — it is "the download **succeeded enough** to be
treated as a new binary." A 116 MB transfer that drops at byte 83,000,000 on a flaky office link
leaves a `.partial` file that is the *wrong size* but, crucially, is a **prefix of a real file**:
its bytes are internally consistent, so any size-only or "looks like an MZ header" sanity check
passes. The naive implementation computes the hash on whatever it has, sees a mismatch against the
manifest, and either (a) silently retries forever, re-downloading 83 MB it already has, or (b)
worse, on a *re-run* of a build where the manifest hash was regenerated, a stale partial from a
*previous* version now happens to hash to a *new* manifest's hash by coincidence of the emitter —
no, that is astronomically unlikely; the real danger is (c) an interrupted download that the client
*renames over the live app before hashing*, then hashes the wrong file, then installs. The root
cause across all of these is that **integrity verification is not atomic with install**: the
download, the hash, the rename, and the launch are four steps that a single network or power
event can wedge between, and the "resume" path is usually absent, so the client cannot distinguish
"byte 83M of a 116M file I already have" from "a corrupted 116M file." Naive code re-downloads
the whole thing (wasting bandwidth and, on metered links, bricking trust) or, if it *does* support
range-resume, trusts `Range: bytes=83000000-` without verifying that the bytes it already had are
still the bytes the server will now send for that offset — a **stale-resume** that stitches a
byte N from v1.11.25 onto bytes 0–N from v1.11.26 and hashes to garbage.

> **CITATION — Cloudflare, 2022-05-11 (global routing misconfiguration).**
> - **Date:** 2022-05-11 (≈20 minutes of elevated failure).
> - **Vendor:** Cloudflare.
> - **Blast radius:** A routing configuration error caused roughly a fifth of global web traffic to
>   fail or error; large fractions of the internet briefly went dark. For an update channel hosted
>   behind a CDN, this is the canonical "your in-flight 116 MB download dies mid-stream and the
>   edge may serve a different body than the origin" event.
> - **Fix:** Cloudflare rolled back the bad routing config; published a postmortem.
> - **URL:** `https://blog.cloudflare.com/postmortem-5112022/` **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** Download to a `.partial`, verify the **full-file
sha512** *after* the complete byte count equals the manifest `size`, then **atomic rename** into
the install location; support `Range:` resume but **re-verify the prefix** on resume (hash the
already-downloaded prefix and compare to a stored per-offset checkpoint) so a stale-resume cannot
stitch two versions. The first-party tool that ships this shape is **electron-updater 6.8.11**
(generic provider, built-in checksum validation of the downloaded file) **[VERIFIED]**; the
"atomic swap + verify-before-install" is its default contract. Pair it with the emitter-side guard
already present in `sync_release_feed.py` (`digest_stream` enforces the `MZ` magic and a ≥1 MB
floor before a version is ever published).

**AIRIZ brick if we did nothing.** AIRIZ already has the *publisher-side* half (the emitter
hashes the real binary before publishing), but the *client-side* mid-download half is delegated
entirely to electron-updater's defaults. On PEGATRON_OA-class links (the README documents that the
corp Wi-Fi blocks UDP/TURN and forces relay fallbacks), a 116 MB download interrupted at 70% and
resumed against a feed that has since advanced to a new version is the exact stale-resume wedge:
the device either re-downloads 116 MB every 6-hour poll on a metered link (trust erosion) or, if a
future change relaxes the size/hash gating, installs a half-file that passes a *prefix* check and
leaves the console on a version that will not start. The 6-hour poll interval means a wedged
partial can sit for half a day before the next attempt notices.

---

## 2. Code-signing certificate expiry (Windows EV, Apple Developer ID, Android upload key)

The failure is delayed and silent, which is what makes it fleet-level. A code-signing certificate
is a dated credential: the Windows **EV** cert, the **Apple Developer ID** identity, and the
**Android upload key** (in the v3 world, the private key behind the signing certificate) all have
a validity window, and the update pipeline does not "expire" the day the cert does — it keeps
*producing* updates that are signed with a cert the OS will increasingly *not trust*. On Windows,
once the cert lapses, SmartScreen trust decays (reputation is built on a *continuous* signing
history, so a gap resets it), and a fleet that previously launched with a single click now hits
"Windows protected your PC"; on Apple, a lapsed Developer ID means a *new* build is no longer
notarizable at all, so the channel simply **stops moving** — devices never receive the update,
which from the user's side looks exactly like "the app is broken / stuck." The root cause is that
**cert lifecycle is an operational process that no build step checks**: there is no default in
electron-builder, Xcode, or `apksigner` that fails the pipeline when "days to expiry < 30." The
naive implementation buys a 2-year EV cert, drops it in CI as an env var, and assumes it is
permanently valid; the moment it lapses (or the issuing CA's root is rotated out of a trust
store, or the cert is *revoked* for a lost key), the channel goes dark with no error a user
reports — just a silent "no update available" on 10,000 devices. Replay is not the risk here;
**staleness and revocation** are, and they are invisible to the client, which only sees
"signature check failed" (or, worse, "no signature to check" if the build fell back to unsigned).

> **CITATION — Apple, 2017-04-03 (App Store enforced on all devices; unsigned/sideloaded apps killed).**
> - **Date:** 2017-04-03 (rolled out over the following days/weeks).
> - **Vendor:** Apple.
> - **Blast radius:** Apple enabled the App Store on the entire device base; apps that had only ever
>   been installed sideloaded (free Xcode, enterprise, or third-party) became "unavailable to use"
>   and stopped launching on millions of devices until re-signed/re-distributed. This is the
>   canonical "an invalid or missing signature turns a whole installed fleet into dead weight
>   overnight" event, and it is the threat model for every cert-expiry scenario.
> - **Fix:** Apple/App developers re-released through the App Store; Apple documented the "App
>   Delivery Changes."
> - **URL:** Apple "App Delivery Changes in iOS" + contemporaneous coverage; check
>   `https://support.apple.com` "App Delivery Changes" and the 2017-04-03 announcements
>   **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** Treat the certificate as **inventory with an SLA**:
a CI preflight job that fetches the cert, asserts `days_to_expiry > N` and "not revoked" (OCSP/CRL
for the Windows EV cert; `security`/`xcrun` for Developer ID; `keytool`/Play App Signing status for
the Android key) and **fails the build** below threshold; plus a **dual-key / grace window** so a
renewal signs alongside the outgoing cert for one cycle. First-party tools: **electron-builder**
signing via `CSC_LINK`/`CSC_KEY_PASSWORD` (Windows, `signtool`/`signtool`-under-the-hood) and the
`afterSign`/`afterPack` hooks for a stapled check **[VERIFIED: electron-builder is the shipping
tool]**; Apple `notarytool` for Developer ID; Google **Play App Signing** to *remove the upload
key from your machine entirely* (the strongest anti-expiry/anti-loss control on Android).

**AIRIZ brick if we did nothing.** AIRIZ is **unsigned today** (verified: `desktop/README.md`), so
there is no live cert to expire — the risk is the *moment you add one*. The `latest.yml` header
says signature verification is "left enabled" but "no configured publisher certificate," which is a
latent trap: the day `CSC_LINK` is set, the channel becomes *strictly* signature-gated, and an
unmonitored EV cert lapse then silently freezes every Windows update while the *already-migrated*
1.1.0/1.1.1 devices (stuck on the `juwpegatron` compatibility feed and its redirect) have *nowhere*
to go. Two independent single points of failure (cert expiry + the old-feed redirect) compound into
a fleet that is both stuck and unauditable, because an unsigned→signed transition is the one
transition the OS will never silently accept in reverse.

---

## 3. Manifest tampering (unsigned vs ed25519-signed, replay, channel confusion)

This is the highest-severity problem because it inverts the entire trust model: the manifest is
the *one* artifact the client fully trusts, and if it is unsigned, **whoever writes the manifest
owns the binary** — the sha512 in the manifest is only as honest as the manifest itself. The naive
implementation ships `latest.yml` over HTTPS and reasons "TLS is enough," and it *is* enough
against a passive eavesdropper, but it is **not** enough against (a) a compromise of the Pages
deploy, (b) a CDN **cache poisoning** (a poisoned `latest.yml` gets served from the edge for the
cache TTL with a valid 200 and a valid TLS cert, so the client verifies the sha512 *against the
attacker's hash* and happily installs the attacker's exe), or (c) a **replay/channel-confusion**
attack where a client pointed at the wrong channel (beta vs stable, or — in AIRIZ's case — the
*old* `juwpegatron` compatibility feed) receives a manifest that is *legitimately signed* for one
channel but is *the wrong version/content* for the other. The root cause is that **the integrity
chain has a single, unsigned link**: binary ← (sha512) ← manifest ← (HTTPS) ← CDN. There is no
cryptographic anchor the client can hold independently of the channel it is fetching from. A
proper design signs the manifest with an **ed25519 key whose public half is embedded in the app
binary at build time**, so the client can verify "this manifest was produced by *our* publisher"
independently of whatever the CDN returns; replay is then defeated by a **monotonic version +
timestamp** the client refuses to go below, and channel confusion by a **channel id in the
signature payload**. Without that signature, every downstream control (sha512, size, MZ check) is
*integrity within a version you cannot authenticate*.

> **CITATION — SolarWinds SUNBURST, 2020 (build-pipeline compromise behind a valid signature).**
> - **Date:** Compromise active from ~2020-06; disclosed 2020-12-13.
> - **Vendor:** SolarWinds (Orion / SolarWinds Platform, build 2020.2.1 AH); nation-state actor.
> - **Blast radius:** Tens of thousands of customers (≈18,000 organizations reported) including U.S.
>   federal agencies (Treasury, Energy, Commerce, and others); the backdoor was injected into the
>   *signed* build, so the signature, the version, and the hash were all "valid" — only provenance
>   and content analysis exposed it.
> - **Fix:** Patches for the affected builds, credential/IOC rotation, M365 and endpoint hardening;
>   a long multi-year hunt for persistence.
> - **URL:** SolarWinds security-incident statement + Microsoft's 2020-12-18 analysis; check
>   `https://www.solarwinds.com/…security-incident…` and
>   `https://www.microsoft.com/en-us/security/blog/2020-12-18/…` **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **Sign the manifest with ed25519 and embed the
public key in the app.** electron-builder/electron-updater ships exactly this: a minisign/ed25519
`signature` field in `latest.yml` that the updater verifies against a public key configured at
build time, so a CDN-served manifest that was not produced by the publisher's key is rejected
before a single byte of the installer is fetched. The first-party tool is **electron-builder +
minisign (ed25519)** inside **electron-updater 6.8.11** **[VERIFIED: version]**; the
config-key details are **[TRAINING-KNOWLEDGE - VERIFY]** — check the electron-builder
"auto-update / signing the update feed" docs at
`https://www.electron.build/auto-update`. Layer **SLSA provenance / Sigstore (cosign)** over the
binaries so "this binary came from this repo at this commit" is independently attestable, and stamp
the manifest with a **monotonic version + build timestamp** the client refuses to move below.

**AIRIZ brick (rather, compromise) if we did nothing.** This is AIRIZ's *live* exposure, not a
hypothetical: `latest.yml` has **no signature field**, is served from a **CDN-backed GitHub Pages**
host, and the sha512 lives *inside* the same tamperable file. A single compromised Pages deploy —
or a cache-poisoned edge response — that rewrites `url`/`path` to an attacker exe **and** the
matching `sha512` would be *fully accepted* by every client, because the client trusts the
manifest's own hash. The documented **`juwpegatron` → `juw12` migration** makes this worse, not
better: there are now **two feeds** (the new `juw12` Pages host and the old `juwpegatron`
compatibility feed that depends on a **redirect**), doubling the attack surface and giving a
channel-confusion attacker two independently-writable (or independently-cacheable) targets, one of
which (the old feed) is still being fetched by 1.1.0 installs that never advanced. An unsigned
manifest over a dual-channel, CDN-cached, redirect-dependent feed is the precise pre-condition for
a SilentSUNBURST-class compromise of the AIRIZ fleet.

---

## 4. Delta-update corruption (bsdiff, Courgette, zsync, sparse-bundle stitching, block-mapping holes)

Delta updates trade the "re-download everything" cost for a *compounding* integrity surface, and
the failure modes are exotic in a way full downloads are not. A bsdiff/Courgette/zsync patch is a
**mapping from (old file + patch) to new file**, and a single corrupted block in the patch, or a
**block-mapping hole** (an offset that is neither explicitly patched nor explicitly "copy from
old"), yields a new file that is *plausibly sized and plausibly structured* — it is not "garbage,"
it is "almost right," which is far more dangerous than a file that fails its hash loudly. The
sparse-bundle/stitching case is the subtle one: if you patch in *chunks* and a chunk is
skipped, the result is a file where region A is v1.11.25, region B is v1.11.26, and region C is
*uninitialized/zero* — a **hole** — that can hash to a value you never expected and, worse, can
be *made* to hash to the target by an attacker who controls the old file. The naive
implementation verifies the **patch** hash and trusts the result; the correct implementation
verifies the **resulting file** hash (the same sha512 the full-download path would produce), which
is the only check that catches a bad mapping, a hole, or a stitched-wrong-base. The root cause is
the asymmetry: a delta's *input* (the "old file") is **client state you do not control** — the
client's current installed binary is attacker-influenced if the device is compromised, so a delta
engine that trusts "old + patch = new" is trusting the device. Crowding in: a delta can also be a
**rollback vector** — a "patch" that maps v1.11.26 back to a v1.11.20 that had a known hole,
which a signed-full-manifest design would reject by version monotonicity but a naive delta path
might accept because "the patch verified."

> **CITATION — ASUS Live Update, 2019 ("ShadowHammer" — insecure firmware/delta update path).**
> - **Date:** 2019.
> - **Vendor:** ASUS (Live Update / motherboard firmware update mechanism).
> - **Blast radius:** Security research demonstrating that the ASUS update/patch path could be
>   abused to tamper with or roll back firmware — i.e., the *delta/patch mechanism itself* was the
>   trust boundary, not the OS. (Exact researcher, tooling name, and disclosure URL could not be
>   re-verified against a reachable source this session.)
> - **Fix:** Vendor guidance to verify update integrity and protect the update channel; treat the
>   patch path as signed input.
> - **URL:** search "ASUS Live Update ShadowHammer 2019" / the original security blog post
>   **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** If you use deltas at all, the non-negotiables are:
(1) verify the **final** file hash, not just the patch; (2) pin the **base version** the delta was
computed against and refuse to apply it over anything else; (3) **automatic full-download fallback**
on any delta anomaly (hash mismatch, size mismatch, base mismatch); and (4) keep deltas
**monotonic** (no patch may lower the version). First-party tooling that ships the "verify the
result, fall back to full" contract is **electron-updater's differential-update path** (on macOS,
where the updater ships incremental zip deltas) **[VERIFIED: electron-updater 6.8.11 is the tool]**
— note that on **Windows/NSIS there is no delta**, which is exactly why AIRIZ is currently safe
here (see the brick callout). For bespoke deltas, bsdiff/zsync are the reference algorithms; the
*integrity* comes from your wrapper, not the algorithm.

**AIRIZ brick if we did nothing.** AIRIZ **does not use deltas** — it ships a monolithic ~116 MB
NSIS installer and verifies it end-to-end, so delta corruption is *not a live vector today*. The
honest callout is the **induced risk**: the #1 motivation to "add a delta to stop pushing 116 MB on
metered/relay-forced links" is precisely the moment this problem becomes live. If a delta path is
added with only patch-hash verification (the common first cut), a stale-resume or a block-mapping
hole produces an installer that "almost" works, and because AIRIZ's auto-update installs *only
when the console is idle for 5 minutes*, a subtly-corrupted delta can pass the *user* (the console
reboots, looks fine, then misbehaves on a hardware path that the idle gate never exercises). The
mitigation is cheap and should be mandated *before* any delta work: final-file sha512 + base pin +
full fallback, all of which `sync_release_feed.py` already computes on the publisher side and can
be mirrored client-side.

---

## 5. Staged-rollout regret (10/50/100 gates, kill-switch latency, observability lag)

The failure is organizational as much as technical, and it is the one where the *absence* of a
control is the incident. A staged rollout (1% → 10% → 50% → 100%) is only as good as (a) the
**gate that decides to advance** and (b) the **kill switch that decides to stop**, and both are
only as good as the **observability lag** between "the update is bad on device" and "the system
knows it is bad." The naive design flips the feed for 100% of devices at once (one `latest.yml`,
all clients read it on their next poll), has no per-cohort telemetry that can say "error rate
spiked in the 10% cohort," and a kill switch that is *manual* (a human notices, a human redeploys)
— so the blast radius is the *entire fleet × the time-to-notice*. The root cause is that the
update channel is treated as a *publish* primitive (write a file, done) rather than a *control
loop* (publish to a cohort, measure, advance or halt). The 6-hour poll interval multiplies the
lag: even a perfect kill switch re-emitted to the feed takes up to 6 hours to be *seen* by a
device that polled an hour ago, and a device on a metered link that only polls when idle may not
see it for a day. The regret is that by the time the 10% cohort's telemetry shows the breakage, the
50% and 100% cohorts have *already advanced on a prior gate decision that used stale data* — the
gate is racing the observability, and observability always loses that race.

> **CITATION — CrowdStrike Falcon, 2024-07-19 (content-filter channel file pushed to 100% at once).**
> - **Date:** 2024-07-19.
> - **Vendor:** CrowdStrike (Falcon sensor content update / "channel file").
> - **Blast radius:** ≈8.5 million Windows machines (~14% of the global Windows fleet) hit a
>   fault loop; ~250 flight systems were reportedly affected and some grounded; a malformed
>   telemetry/content-filter record caused a module to fault during validation. The content update
>   went to the *full* fleet with no effective canary; the global remediation began ~15 minutes
>   after detection but took many hours to fully clear because of the per-device update cadence.
> - **Fix:** CrowdStrike published a remediation content update that removed the bad record; no
>   sensor *code* change was required, but the content had to be re-distributed to every device.
> - **URL:** `https://www.crowdstrike.com/en-us/resources/blog/rapid-response-july-19-2024/`
>   (and CrowdStrike's subsequent "How the July 2024 global outage happened")
>   **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** Make the feed a **cohort + gate** rather than a
single file: a `channel` (stable/beta/nightly) **and** a **percent-gate + kill-switch flag in the
manifest** that clients read on poll, so "halt" is a *content* change (sub-poll-interval to notice
once a device polls) rather than a deploy. The first-party substrate is **electron-updater's
multi-channel model** (`channel: stable/beta/nightly`, **[VERIFIED: version 6.8.11]**) plus a
**remote-config kill switch** (the manifest can carry `forceRollback`/`halt` semantics) plus
**telemetry** (Sentry/Bugsnag) feeding the gate. There is no single first-party "canary engine" —
the pattern is: electron-updater channels (who gets what) + a remote flag (stop) + a telemetry
source (measure) + a human or automated gate (decide).

**AIRIZ brick if we did nothing.** AIRIZ has **no canary**: `sync_release_feed.py` writes *one*
`latest.yml` consumed by *every* device, and the 6-hour poll means a bad 1.11.26 reaches a
meaningful fraction of the fleet within hours of the deploy, all at once. The opt-in auto-update
(5-min idle + 30-second countdown) is a **per-device** courtesy, not a **fleet** gate — it protects
one user from a surprise restart, it does not protect the fleet from a bad build. The concrete
regret: a broken 1.11.26 → all devices poll → all opt-in-auto-update devices that go idle within
the window install it → the only "rollback" is a human rewriting `latest.yml` to the previous
version, which then takes up to 6 hours to propagate, and *downgrades are not installed by
electron-updater by default*, so stuck devices cannot be walked back automatically. This is the
CrowdStrike shape in miniature: full-fleet push, no cohort gate, poll-interval-bounded kill switch,
and a client that will not move backwards. The fix is a manifest-level kill/halt flag + a
cohort gate + a "allow one-step downgrade on `forceRollback`" client rule, all cheap given the
feed is already a hand-written file.

---

## 6. PWA service-worker caching the old shell (skipWaiting race, controller race, cross-tab fan-out, OOB cache)

The PWA failure is a *versioning* failure that masquerades as a *network* failure. A service
worker is a per-origin, per-browser, **persisted** controller that outlives every page load; the
"cache-first, network fallback" strategy that makes a PWA offline-capable is the *same* property
that makes it serve a **stale shell** after a deploy. The naive implementation registers `sw.js`
with a static name and reasons "the server now serves the new `index.html`," and is wrong, because
the SW *intercepts* the fetch and answers from cache before the network is ever consulted. The
failure decomposes into four sub-races: (1) the **skipWaiting race** — a new SW is *downloaded*
but *not activated* (it is `installing`/`waiting`) while the old SW keeps controlling pages, so
you have *both* versions present and which one answers a fetch depends on timing; (2) the
**controller race** — pages that were already controlled by the old SW stay on the old SW until
they reload, so a multi-tab user has *different tabs running different versions* of the same app
simultaneously; (3) the **cross-tab fan-out** — a poisoned or stale cache written by *one* tab is
shared by *all* tabs of that origin, so one bad fetch can poison the cache that every other tab
then reads; and (4) the **out-of-band cache** — a cache the SW wrote under a name that the *new*
SW no longer knows about (an "OOB" cache from a previous version) is never garbage-collected and
keeps serving stale bytes forever. The root cause is that the SW lifecycle (install → activate →
control) is **asynchronous, per-client, and not coordinated with the deploy**; there is no atomic
"all clients now on version N" moment.

> **CITATION — PWA / Service Worker stale-cache class (no single named corporate outage; the
> documented failure pattern).**
> - **Date:** Ongoing / class of incident (documented since the Service Worker spec, 2015–present).
> - **Vendor:** Web platform (Chrome/Edge/Safari Service Worker implementations); Google Workbox
>   exists specifically to mitigate this class.
> - **Blast radius:** Any deployed PWA that does not version its caches and coordinate
>   `skipWaiting`/`clientsClaim` will serve users a stale (or, if the cache is poisoned, a
>   compromised) shell after a deploy, with no server-side log to explain it — "works on my
>   machine / on a fresh profile" is the tell-tale symptom.
> - **Fix:** Versioned cache names, explicit `skipWaiting` + `clientsClaim`, `caches.delete` of old
>   caches in `activate`, and SRI on critical subresources (see sub-failure mode below).
> - **URL:** `https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API` and
>   `https://developer.chrome.com/docs/workbox/` **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **Version every cache, claim explicitly, delete
the rest.** Concretely: name caches `airiz-v<N>`; on `install` skipWaiting *and* `clientsClaim`;
on `activate` enumerate `caches.keys()` and delete any key not in the current version set; and use
**SRI (`<link/script integrity=…>`) on the critical shell subresources** so a poisoned cache entry
cannot execute. First-party / de-facto-standard tooling: the **Service Worker API** (browser-native)
plus **Google Workbox** (the reference strategy library: `cleanupOutdatedCaches`,
`skipWaiting`/`clientsClaim` helpers) **[TRAINING-KNOWLEDGE - VERIFY: Workbox is Google's;
check `https://developers.google.com/workbox`]**. For AIRIZ, because the *desktop* app already
pins its own origin and the *PWA* is a separate shell on Pages, the SW is the PWA's only
versioning mechanism — there is no other layer to coordinate with.

**AIRIZ brick (stale-lock) if we did nothing.** AIRIZ's `web/sw.js` is documented as
**"cache-first strategy, network fallback."** That is exactly the pre-condition for the stale-shell
failure: after a Pages deploy that changes `index.html` or a core `*.js`, installed PWA users on
devices that already have the SW controlling the origin will keep getting the *old* shell from
cache — and because Web Serial / remote-control state lives in that shell, a user can be *looking
at the old console UI* while the *new* code is live on the server, with no way to tell which they
have. The cross-tab fan-out is acute for AIRIZ because the console is frequently open in **multiple
tabs** (the README documents camera-in-its-own-window and phone-viewer flows that spawn separate
pages on the same origin): a poisoned or stale cache in one tab is shared across the others. The
OOB-cache sub-race is the silent killer — an old cache name from a previous SW that is never
deleted keeps serving stale bytes indefinitely, so the bug *gets worse* the longer the app has been
installed. The fix is the versioned-cache + `skipWaiting`/`clientsClaim` + `activate`-deletes-orphans
pattern, plus SRI on the shell's critical scripts, and it is small.

---

## 7. iOS distribution: App Store vs enterprise vs sideload (review latency, TestFlight, enterprise-cert revocation, AltStore)

iOS is the one platform where the *distribution channel itself* is the risk, not just the binary.
There are three rails — **App Store** (Apple review, 24h–weeks, version is a fixed immutable build
you can only *supersede*), **enterprise / in-house** (fast, but the certificate is *revocable by
Apple at will* and historically has been, en masse), and **sideload** (AltStore / free Personal
Team, 7-day re-sign, 3-app limit). The failure mode is **channel mismatch under expiry or
revocation**: an app shipped on the enterprise rail *assumes* the enterprise cert will keep
working; the moment Apple revokes it (and Apple has done coordinated revocation waves against
enterprise certs used outside their intended MDM purpose), **every sideloaded/enterprise install
stops launching simultaneously**, and there is no "update" that fixes it because the *identity*
that signed the app is now invalid — the only fix is to re-sign and re-distribute, which on the
sideload rail is a 7-day clock you are already racing. The naive implementation picks the *fastest*
rail (enterprise) for "quick fleet rollout" and discovers the revocation risk only in production.
The root cause is that on iOS **the signing identity is a privileged, revocable, Apple-controlled
credential**, and the three rails have *completely different* lifetime and revocation semantics
that a single "deploy the IPA" step does not distinguish. TestFlight adds a fourth axis: it is the
*staged* rail (up to 10,000 external testers, 90-day builds) and is the *only* way to do a real
canary on iOS *before* App Store — skipping it means your first "fleet" is either the full App
Store (no canary) or a revocable enterprise/sideload cohort (canary that can vanish).

> **CITATION — Apple, 2021 (coordinated revocation of enterprise / in-house distribution
> certificates).**
> - **Date:** 2021 (recurring waves; a notable cluster in early 2021 affecting MDM and sideload
>   ecosystems).
> - **Vendor:** Apple.
> - **Blast radius:** Apple began revoking enterprise ("in-house") distribution certificates used
>   outside the intended enterprise/MDM purpose; MDM vendors and sideload tools (AltStore-class)
>   lost valid signing identities, and apps installed under those certs stopped launching until
>   re-signed. This is the "fast rail vanishes under your feet" event for iOS distribution.
> - **Fix:** Vendors migrated to App Store / TestFlight and to per-device Personal-Team re-signing;
>   Apple reiterated the enterprise program's terms of use.
> - **URL:** Apple "Manage iOS Apps in Your Enterprise" / in-house distribution terms + 2021
>   revocation coverage **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **Rail-by-rail policy with the signing identity as
first-class inventory.** App Store for the durable fleet (immutable builds, TestFlight for the
canary, 90-day builds), enterprise *only* where the program is legitimately in-house, sideload
*only* for dev with an explicit 7-day re-sign automation. First-party tools: **Xcode + the App
Store / TestFlight / Apple Developer portal** (the rails are Apple's), **`xcrun` + provisioning
profiles** for the signing mechanics; for sideload fleets the de-facto tooling is
**AltStore** (third-party) or a Personal Team with an automated re-sign loop
**[TRAINING-KNOWLEDGE - VERIFY: AltStore is community; check `https://altstore.io`]**. The
*pattern* is: never let the *fast* rail be the *durable* rail, and track every signing
identity's expiry/revocation status the same way you track a code-signing cert (problem #2).

**AIRIZ brick if we did nothing.** Per the platform matrix, AIRIZ iOS is an **unsigned IPA via
Capacitor** — i.e., it is *already on the sideload/enterprise rail* and cannot go through the App
Store (unsigned). That means AIRIZ's entire iOS cohort is exposed to the **enterprise/sideload
revocation** failure: the day Apple revokes the cert that signed the IPA (or a 7-day Personal Team
window lapses), **every iOS device running AIRIZ stops launching** with no update path, because
the signing *identity* is invalid, not the binary. There is no TestFlight canary to fall back to
because the IPA is unsigned. The concrete brick is total and silent: iOS users get
"'AIRIZ' can't be opened because the developer hasn't yet agreed to the App Store terms" /
"unavailable to use" and the only fix is re-signing and re-pushing an IPA, which on a sideload
fleet is N manual re-installs. The mitigation is to (a) move the durable iOS distribution to
**TestFlight** (signed, 90-day, canary-able) and/or the App Store, and (b) treat the iOS signing
identity as inventory with an expiry/revocation SLA — the same control as problem #2, applied to
a credential that Apple can revoke *without notice*.

---

## 8. macOS notarization (notarytool, staple ticket, hardened runtime, Developer ID)

macOS adds a **two-step** trust gate that Windows and Android do not have, and the failure is
doing one step without the other. Step 1 is **Developer ID signing** (the code must be signed with
a Developer ID certificate, not a plain self-signed one). Step 2 is **notarization**: you submit
the signed artifact to Apple (`xcrun notarytool submit`), Apple scans it and issues a
**ticket**, and you **staple** that ticket to the app (`xcrun stapler staple`) so Gatekeeper can
verify it *offline*. The naive implementation signs with Developer ID and *skips* notarization
("it's just a Mac build for our own team"), and the first launch on a clean Mac dies with
"Gatekeeper: 'App' can't be opened because Apple can't check it for malicious software" with — on
Catalina and later — **no "Open Anyway"** for a double-click (only a one-time right-click
override that does not carry to the next launch or the next device). The root cause is that
**Gatekeeper on macOS requires the notarization ticket to be present and valid for a distributed
app**, and a missing/stale/unstapled ticket is *indistinguishable to the user from a blocked
malware file*. A second, subtler axis is the **Hardened Runtime**: notarization *requires* the
Hardened Runtime, and the Hardened Runtime *forbids* certain entitlements/behaviors (unsigned
dylibs, JIT without the right entitlement, `cs-billboard`-less helpers), so an app that signs and
notarizes fine can still **crash at runtime** the first time it does something the runtime forbids.
A third axis is the **fat/universal binary**: a universal (x86_64 + arm64) binary must be signed
*per-architecture* and the signatures must be consistent, or one slice notarizes and the other
doesn't (see the dedicated sub-failure mode). The brick is that all three — signing, notarization
ticket, and runtime entitlements — must be correct *simultaneously*, and none of them produces a
useful error to a non-Mac developer until a real Mac tries to launch.

> **CITATION — macOS Catalina, 2019-10-07 (Gatekeeper hardening: notarization becomes
> mandatory for distributed apps).**
> - **Date:** 2019-10-07 (macOS 10.15 Catalina ships).
> - **Vendor:** Apple.
> - **Blast radius:** Catalina introduced the hard requirement that distributed apps be signed with
>   Developer ID *and* notarized; unsigned or non-notarized apps stopped launching for end users
>   (the "can't check for malicious software" gate), a breaking change for the entire class of
>   unsigned dev/internal Mac builds. This is the day "it worked on the dev's Mac" stopped being
>   "it works on a user's Mac" for unsigned builds.
> - **Fix:** Apple provided `notarytool` + `stapler` and the "App Delivery Changes" guidance;
>   vendors adopted Developer ID + notarization + staple in CI.
> - **URL:** Apple "App Delivery Changes in macOS" / Developer "Notarize your macOS software before
>   distribution" — `https://developer.apple.com/documentation/xcode/notarizing-macos-software-
>   before-distribution` **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **CI gate that refuses to ship an artifact that is
not (signed Developer ID) AND (notarized) AND (stapled) AND (Hardened-Runtime-clean).** The
first-party tools are Apple's: **`xcrun notarytool`** (submit + `status` + `log`),
**`xcrun stapler staple`**, and **`codesign --options runtime`** for the Hardened Runtime; the
pattern is a build job that signs, submits, *waits* for `notarytool status` to reach
`Accepted`, staples, and **fails the pipeline if any step is non-Accepted**, so a non-notarized
artifact cannot reach a channel. **[TRAINING-KNOWLEDGE - VERIFY: exact CLI flags; check
`https://developer.apple.com/documentation/xcode/notarizing-macos-software-before-distribution`]**

**AIRIZ brick (latent) if we did nothing.** AIRIZ is **Windows-only desktop today** (verified:
`desktop/README.md`, the installer is the Windows x64 NSIS), so macOS notarization is **not a live
vector** — and the honest report says so. The brick is *induced* the moment a macOS target is
added to the matrix (the monorepo already ships Mac builds for other apps, e.g. `vitals`, so this
is a realistic near-future path): an unsigned, non-notarized AIRIZ-for-Mac would be **unlaunchable
on any clean user Mac from day one** — Gatekeeper hard-blocks it with no update path, and because
the Hardened Runtime is required *for* notarization, the first notarization attempt would also
surface any entitlement the console's native helpers (serial, camera, microphone, the
`powercfg`-class calls the Windows build makes) are not allowed under. The mitigation to adopt
*before* adding the Mac target is the full CI gate (sign → notarize → wait for Accepted → staple →
Hardened-Runtime audit) and a per-arch signing check for the universal binary, so the Mac build is
born notarizable rather than retrofitting it onto a fleet that Gatekeeper has already rejected.

---

## 9. Android v2/v3/v4 signature-scheme mismatch (key rotation, min SDK, downgrade attack, lineage)

Android's signature story is a **lineage** problem, not a one-time signing problem: an app's
*identity* is the set of signature schemes it was installed with, and an update is only accepted
if it **matches the installed signature** (and, for v2+, the *scheme version* the device
supports). The failure is a **scheme/key mismatch that makes the update uninstallable-over**, which
the user experiences as "the update won't install / the app says it's corrupted." The mechanisms:
**v1 (JAR)** is verified per-file but is *zipalign-agnostic and patchable* (a v1-signed APK can be
modified and re-signed — the reason v2 exists); **v2 (APK Signature Scheme v2, Android 7.0/API
24+)** signs the *entire* APK bytes, so any modification breaks it, but **devices below API 24
fall back to v1**, so a minSdk < 24 app must ship **both v1 and v2**; **v3** adds *rotation* (a
new cert can be added to the same signing block without breaking the old) and **v3.1** extends the
expiration; **v4 (Android 11/API 30+)** is an *incremental* scheme for *block-based* installs (it
does not replace v1/v2/v3, it *coexists*). The naive implementation signs with v1 only ("it
installs everywhere") and inherits the **downgrade attack**: an attacker ships an *older* APK
signed with the *same* v1 key (or, worse, the *old* key before a rotation) at a lower version, and
a device that allows downgrade installs it over the good one — reverting a security fix. The root
cause is that **signature identity is per-install, device-version-dependent, and only *forward*
consistent**: you can rotate *forward* (v3 adds a cert), but you cannot *un-rotate*, and a
v1-only lineage is forgeable, and a minSdk that is too low forces a v1 fallback that re-opens the
forgery path. Key rotation done wrong (signing the new build with a *different* key, not using v3's
add-a-cert) produces an update the OS **refuses to install over** because the signatures differ —
the fleet is stuck at the old version with no forward path.

> **CITATION — Android APK Signature Scheme v2/v3 introduction, 2017-08 (Android 8.0 / API 26).**
> - **Date:** 2017-08 (Android 8.0 / API 26 ships v2; v3 with the 2019/2020 Play tooling; v4 with
>   Android 11 / API 30, 2020-09).
> - **Vendor:** Google / Android.
> - **Blast radius:** The v2/v3 schemes redefined what "the same app" means for update purposes;
>   apps that shipped v1-only to support minSdk < 24 devices retained a forgeable v1 signature,
>   and a mismatch between the scheme an update is signed with and the scheme a device validates
>   produces an "app not installed" / update-refusal for the affected cohort. This is the
>   structural origin of every "my Android update won't install" lineage incident.
> - **Fix:** Google introduced **Play App Signing** (2021) so the *upload* key (held by the
>   developer) is separate from the *app* key (held by Google), enabling rotation without
>   breaking lineage; v3 added cert-rotation-without-reinstall.
> - **URL:** `https://developer.android.com/develop/tools/apksigning/` and
>   `https://developer.android.com/about/versions/11/changes/apksign-v4`
>   **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **Enforce v3 (or v4 where minSdk ≥ 30), pin the
minSdk high enough that no v1 fallback is required, and use Play App Signing to externalize the
app key.** Concretely: `apksigner` with `--v2-signing-enabled` + `--v3-signing-enabled` (+ v4),
assert the uploaded APK's signature block *includes* every scheme the minSdk requires, **block
downgrade** by (a) not shipping a lower version number and (b) verifying **signature lineage** on
install (the new APK's key set must be a *superset* of the installed key set, which v3 rotation
supports); and use **Google Play App Signing** so the *app* key lives in Google's HSM and your
*upload* key can be rotated/replaced without ever breaking the fleet's lineage. First-party tools:
**`apksigner`** (Android build-tools) and **Google Play App Signing** + the **Play Integrity API**
(for runtime attestation, see the sub-failure mode) **[TRAINING-KNOWLEDGE - VERIFY: check
`https://developer.android.com/develop/tools/apksigning/`]**.

**AIRIZ brick if we did nothing.** Per the matrix, AIRIZ Android is a **signed APK via Capacitor**
(sideload / direct, not Play App Signing). That is the *least-protected* Android posture for
lineage: the signing key is on your machine, rotation is manual, and there is no Play-managed app
key to fall back on. The concrete bricks: (1) **key loss or rotation done naively** — if the
upload key is lost, or a new build is signed with a *different* key, the OS **refuses to install
over** the existing AIRIZ, so the fleet is stuck at the last version signed with the old key with
*no forward path* (the user must uninstall, which wipes their local profile — the README stresses
desktop/mobile storage is separate and per-device, so an uninstall is genuinely destructive);
(2) **downgrade attack** — a v1-fallback or a lower-version APK signed with a still-valid key can
be installed *over* a security fix if downgrade is not blocked; and (3) **minSdk scheme gap** — if
the Capacitor minSdk is low enough to require a v1 fallback, the v1 signature is forgeable and the
whole lineage is one compromised-signing-box away from a "valid" malicious update. The mitigation
is to (a) move to **Play App Signing** (or, if staying sideload, back up the upload key to an HSM
and enforce v3), (b) pin minSdk high enough to drop v1, and (c) add a client-side "refuse to
install if the new signature is not a superset of the installed one" check.

---

## 10. Cloudflare Worker version rollback after a buggy deploy (Workers rollback, Durable Objects migration, version pinning)

A Cloudflare Worker is not a "server you patch" — it is an **immutable versioned function** that
Cloudflare routes traffic to, and the failure is the gap between "I deployed version N+1" and
"the world is actually running version N+1." The naive deploy pushes a new Worker version to 100%
of edge instantly; if it is buggy, *every* request through that Worker (for AIRIZ: **all**
remote-control-by-code signaling **and** the JPEG camera-relay frames) is now handled by the bad
code, with no per-region or per-cohort control and no "send 5% first." The root cause is that a
Worker deploy is an **atomic, global, immediate** control-plane write, and the default has no
canary. The Durable Objects (DO) axis compounds it in a way that is *not* symmetric with rollback:
the *function* can be rolled back instantly, but **DO *storage* migrations are not**. A buggy
deploy that also ran a DO migration (or that *assumes* a new storage shape) can leave DO state in a
shape the *old* version cannot read — so even after you roll the Worker back to N, the DOs are
stuck on the N+1 storage layout and the rolled-back code faults reading them. The version-pinning
axis is the third: a Worker can *call* other Workers, a queue consumer, or a DO by a *version* or a
`compatibility_date`, and if the deploy moves the `compatibility_date` forward, the *rolled-back*
code may depend on a runtime behavior that the new `compatibility_date` changed, so "rollback the
code" does not "rollback the runtime." The brick is the asymmetry: **code rolls back in seconds,
but storage and runtime-version do not roll back at all**, so a naive "just roll back the Worker"
fix can make things *worse* by pairing old code with new state.

> **CITATION — Cloudflare Workers / edge deploy-rollback class (no single named public
> fleet-brick this session; the documented failure pattern + the 2022-05-11 incident as the
> general "one bad control-plane write → global impact" lesson).**
> - **Date:** Ongoing / class of incident; the 2022-05-11 Cloudflare routing incident (see #1) is
>   the best-documented public example of a single Cloudflare control-plane/config change having
>   immediate global effect across deployed services.
> - **Vendor:** Cloudflare (Workers, Durable Objects).
> - **Blast radius:** A buggy Worker version, when pushed to 100%, immediately handles 100% of the
>   traffic routed through it; with a DO storage migration or a `compatibility_date` bump in the
>   same deploy, an instant code rollback does not restore the pre-deploy state, so the recovery
>   time is bounded not by the rollback (seconds) but by the *state* reconciliation (minutes–hours).
> - **Fix:** **Workers "Versions and Rollouts"** (incremental 1→5→25→50→100% with one-click
>   rollback) and **Durable Objects migrations** (storage migrations are a *separate*,
>   explicitly-versioned step, gated by `compatibility_date`), plus **version pinning** for
>   Worker-to-Worker/queue calls.
> - **URL:** `https://developers.cloudflare.com/workers/configuration/versions-and-rollouts/`
>   and `https://developers.cloudflare.com/durable-objects/migrations/`
>   **[TRAINING-KNOWLEDGE - VERIFY]**

**2026 mitigation pattern + first-party tool.** **Never push a Worker to 100% directly; treat the
deploy as a rollout, and treat DO storage as a separate, versioned, gated migration.** Concretely:
deploy with **Versions and Rollouts** (start at 1%, advance on a health signal, one-click rollback
at any stage); make **DO migrations an explicit, separately-approved step** that runs *before* the
code that depends on the new storage shape (and is forward-compatible so the old code can still
read it during the rollout); and **pin** any Worker→Worker / queue-consumer / DO references to an
explicit version rather than "latest." First-party tools: **Wrangler** (the CLI that does
`wrangler versions`/rollouts and `wrangler do` migrations) + **Workers Versions and Rollouts** +
**Durable Objects migrations** — all Cloudflare first-party
**[TRAINING-KNOWLEDGE - VERIFY: exact CLI; check
`https://developers.cloudflare.com/workers/wrangler/commands/#versions`]**.

**AIRIZ brick if we did nothing.** AIRIZ's relay (`airiz-relay.juw12.workers.dev`) is a
**Worker + Durable Objects** and it carries the *core* cross-device features: **remote-control-by-code**
signaling and the **JPEG camera-relay** path that the README says is used "when the PC's network
blocks WebRTC" (the PEGATRON_OA fallback). A buggy Worker version pushed to 100% therefore does not
degrade a "nice-to-have" — it **breaks the primary remote-control + camera-share path for the whole
fleet at once**, and because the DOs hold live share state (the 6-digit codes, the "allow &
remember" device keys, the in-flight camera registrations, the 20-phone-per-code session table), a
deploy that also touches DO state can leave the relay in a state where *even a rolled-back Worker
cannot read the sessions* — phones stop reconnecting ("phones keep retrying until the PC stops
sharing," per the README, so a stuck relay means phones retry into a void for the lifetime of the
page). The asymmetry bites hardest here: rolling the Worker back in seconds does not roll the DO
session state back, so the recovery is "reconcile the DO storage," not "click rollback." The
mitigation is cheap and matches the first-party design: **Versions and Rollouts** for the Worker
(1→5→25→100% with one-click rollback), a **separate gated DO migration** that is forward-
compatible during the rollout, and **version-pinned** internal references so a rollback never pairs
old code with new storage.

---

## Sub-failure modes (one paragraph each)

### A. Delta vs full — the bandwidth math

The decision to delta is a pure arithmetic trade that the *integrity* cost of #4 then taxes. AIRIZ's
installer is **121,995,135 bytes ≈ 116.4 MiB** (verified from `latest.yml`). Pushing that to N
devices at 100% costs **N × 116.4 MiB** of egress and, on a 100 Mbit/s (~12.5 MiB/s) link, **~9.3 s
of saturated transfer per device** *if the link holds* — but on the relay-forced, UDP-blocked
PEGATRON_OA path the effective throughput is far lower and the transfer is the *long pole* of every
update. A bsdiff delta between two adjacent Electron NSIS builds is typically **15–40% of the full
size** (the Electron/Chromium runtime dominates both and barely changes; only the `app.asar` and a
few native helpers move), so the saving is **~70–100 MB per device**, i.e. the delta is ~20–35 MiB.
The break-even is therefore *not* about raw cost (both are cheap on fiber) but about **the
metered/relay cohort**: for a device that only polls on idle and over a throttled link, a 35 MiB
delta vs a 116 MiB full is the difference between "updates in the background" and "the user notices
a 116 MB download and distrusts the channel." The arithmetic also has a *fan-out* term: GitHub
Releases is a *single origin* for all 116 MiB, so a coordinated poll (all devices waking after the
6-hour timer drifts into alignment) is a thundering-herd egress event against one asset URL; a
delta does not remove that (the delta is *also* on GitHub Releases), so the fan-out problem is
orthogonal to the delta decision and must be solved with a CDN in front of the download, not with
deltas.

### B. Resume from byte N vs entire re-download

This is the #1 sub-failure made concrete. "Entire re-download" is the *safe* default: the client
discards the partial and fetches 0..116 MiB fresh, so there is exactly one integrity boundary
(the final sha512 over a file you fully control). "Resume from byte N" (HTTP `Range: bytes=N-`)
saves the 0..N bytes already held but **adds a second trust assumption**: that the bytes 0..N the
client *already has* are byte-identical to what the server will now return for that offset. That
assumption is **false** in three cases: (1) the feed advanced to a new version between the
interrupt and the resume, so 0..N is v1.11.25 and N..end will be v1.11.26 (the **stale-resume**
stitch); (2) a CDN edge served a *different body* for the same URL during the transfer (the
cache-poisoning / 2022-05-11 class); (3) the partial file was truncated or zero-padded by a crash,
so its true length is less than N and the resume writes at the wrong offset. The correct resume is
therefore **checksummed resume**: persist a **per-block hash** of the 0..N prefix *and* the
manifest version/etag it was fetched against, and on resume (a) refuse if the version/etag changed
(re-download), (b) re-hash the held prefix and refuse if it no longer matches the stored per-block
hashes, and only then (c) open the `Range` request. Without that, "resume" is a corruption
*amplifier*, not a saver, and the honest default for a 116 MiB file on a channel that is *also*
unsigned (#3) is to re-download rather than resume over bytes you cannot re-authenticate.

### C. Chunked vs monolithic download

A *monolithic* download is one `GET` producing one file and one integrity check (the final
sha512). A *chunked* download splits the transfer into K segments, each independently fetchable,
cacheable, and hashable. The trade: chunking buys **parallelism** (fetch 8 segments concurrently to
saturate a link a single TCP connection cannot — the standard reason 116 MiB over a single
connection on a high-BDP link is slow), **resumability** (re-fetch only the failed segment, which
is a *coarse* form of resume from #B that is safe because each segment is re-validated in full),
and **CDN-friendliness** (each segment is a stable, separately-cacheable URL, so the
thundering-herd fan-out of sub-mode A is spread across K URLs instead of one). The cost is that you
now have **K integrity boundaries plus one assembly step**, and the assembly step is where
corruption hides: a chunked download that assembles in the *wrong order*, or skips a segment
(sparse-bundle hole, the #4 failure), produces a file that is "K valid chunks stitched wrong." The
correct chunked design hashes **each chunk** and the **final assembled file**, pins the
chunk→offset map in the manifest, and refuses to install unless every chunk hash *and* the final
hash match — at which point chunking is *strictly safer than monolithic* (you caught the bad
segment) and strictly faster (parallel). AIRIZ's `sync_release_feed.py` already reads the binary in
**1 MiB streaming chunks** to compute sha256+sha512 (`digest_stream`), so the *publisher* side
understands chunked hashing; the *client* side (electron-updater) currently treats the download as
monolithic. Moving to chunked is a client-side change, not an emitter change.

### D. Concurrent version race (two devices, same channel)

This is the #5 gate failure expressed as a *two-device* race, and it is acute for AIRIZ because of
the **documented `juwpegatron` → `juw12` migration with two live feeds**. The race: device A (on
the new `juw12` feed) and device B (a 1.1.0 install still on the old `juwpegatron` compatibility
feed, holding a *redirect* to the new repo) are "the same channel" semantically but read **two
different manifests**. The emitter (`sync_release_feed.py`) updates the `juw12` feed and the
`scripts/apps.json` catalog, but the *old* compatibility feed is a **separate, hand-maintained
artifact** whose installer URL GitHub *redirects* — so a publish to the new feed does **not**
automatically advance the old feed, and the two can *diverge*: the new feed says 1.11.26, the old
feed still says 1.1.1, and the redirect means the *binary* for the old feed's "1.1.1" now resolves
to a *new* file if the old release tag was re-pointed. The race is that **device B's notion of
"latest" is not the fleet's notion of "latest,"** and a kill-switch re-emitted to the *new* feed
does nothing for device B, which never reads the new feed. The general two-device-same-channel race
(even without the migration) is that two devices polling at different times see different
manifests during a *rolling* feed update (the file is mid-write / the CDN is serving a mix of old
and new), so one device installs 1.11.26 and the other is offered 1.11.25 *afterwards* — and
electron-updater will not downgrade, so the second device is now *permanently behind* with no path
forward. The fix is the same as #5: a **single, signed, monotonic feed** (no parallel
hand-maintained compatibility feeds) + a **version the client refuses to go below** + a
`forceRollback` that *does* permit a one-step downgrade, so a diverged device can be walked back to
the fleet's current version.

### E. App-quit timing hook on Windows (electron-updater `quitAndInstall`, in-use DLL)

The Windows-specific failure is that **the running app *is* the file you are trying to replace**.
`electron-updater`'s `quitAndInstall()` closes the app and hands the installer the baton, but on
Windows the installer (NSIS) must *overwrite* files that the just-closed process may not have fully
released — in-use DLLs, the `app.asar`, the executable itself, and (for AIRIZ) any file the
app's native helpers hold. The naive `quitAndInstall` "works" when the app is clean but **races the
OS's file-release**: if a child process (a spawned helper, a Node worker, a camera/microphone
handle, the serial port) is still holding a handle, NSIS fails to overwrite and the install is
**partial** — the new exe is in place but the old `app.asar` or a DLL is not, so the app launches
into a **mixed-version** state (new main process, old renderer assets) that may not start at all.
The in-use-DLL case is the classic "Access is denied" during install that *looks* like a permission
problem but is a *timing* problem. AIRIZ has specific aggravators: the console **holds a serial port
open to the AIRIZ**, runs **camera/microphone sessions**, does **device-audio transfer**, and runs
**macros** — all of which are long-lived handles. The README already encodes the correct policy
("install only after the console has been untouched for 5 minutes"; "running macros, recordings,
and capture sessions still block installation"; "closing the port does not stop a finite move"),
and the *correct* `quitAndInstall` sequence is: **close the serial port explicitly and confirm the
handle released → stop all camera/mic/media handles → wait for the OS to release (a short
poll/`Sleep`) → *then* `quitAndInstall`**, and the NSIS side should install to a **staging
directory and rename-swap at a single point** rather than overwriting in place, so a failed
overwrite cannot leave a mixed-version tree. The brick is a *partial overwrite*: the user's console
"updates," reopens, and is now running a half-updated binary that the idle-gate and the 30-second
countdown will never catch, because from the user's perspective the install "completed."

### F. macOS code-signing on a fat binary vs per-arch

A **universal (fat) binary** is two (or more) Mach-O slices — `x86_64` and `arm64` — in one file,
and macOS code-signing is **per-architecture but must be *consistent across slices***. The failure
is signing the *outer* fat file as a unit while a *slice* is unsigned, or signing the two slices
with **different entitlements** (one slice Hardened-Runtime, the other not), which produces an
artifact that `codesign --verify` may *locally* bless but that **notarization rejects** or that
Gatekeeper *selectively* blocks on Intel vs Apple Silicon Macs — the user on an M-series Mac gets
"can't open" while the user on an Intel Mac is fine, and the split is *inexplicable from the
deploy log* because the build "succeeded." The root cause is that the signing step must sign **each
arch slice with identical flags and entitlements** and then seal the universal container, and any
slice that is signed *after* the container is assembled (or with `--force` re-signing one slice
without the other) breaks the cross-slice consistency that `notarytool` checks. The naive
Electron-for-Mac build that does "sign the app, done" often signs the `app.asar` and the main exe
but **misses the nested helper bundles / the second arch slice of a universal helper**, so the
app passes local `codesign --verify --deep` (which is itself deprecated and unreliable) but fails
the *real* check: Apple's notarization, which inspects every Mach-O in the package. The correct
pattern is `codesign` each Mach-O **inside-out** (helpers first, then the app, then the dmg), with
**identical `--options runtime` and entitlements on every slice**, and let `notarytool` be the
source of truth (its `log` will name the exact unsigned/inconsistent slice). For AIRIZ this is a
**latent** concern (#8): the Windows build has no fat-binary axis, but the moment a universal
macOS target is added, a per-arch signing inconsistency is the *most likely* reason the Mac build
notarizes on the dev's M-series Mac and dies on a fleet member's Intel Mac (or vice versa).

### G. iOS provisioning-profile expiry mid-release cycle

A **provisioning profile** is the iOS credential that binds (app id + devices/entitlements + the
signing cert + an **expiry date**), and for TestFlight / App Store distribution it is the
**90-day** distribution profile, while a free **Personal Team** sideload is **7 days**. The failure
is *mid-cycle expiry*: you ship a 90-day TestFlight build on day 1; on day 60 the *signing cert*
or the *profile* approaches expiry; on day 90 the build is **still installed and running on 10,000
testers** but can no longer be *re-signed or refreshed*, and any *new* build after the profile
lapses cannot be distributed under it. The naive implementation treats the profile as "set once"
and discovers the 90-day clock only when a re-sign fails in CI. The root cause is that iOS
distribution is a **three-credential braid** — the **App ID**, the **provisioning profile**, and the
**signing certificate** — all of which have *independent* lifetimes and must be *simultaneously*
valid for a build to sign *and* for an already-distributed build to remain installable-refreshable.
A **mid-release-cycle** expiry is the worst case: the *old* build still works (Apple does not
retroactively kill running App Store builds on profile expiry — the running app keeps running), but
you **cannot ship the next one** until the profile is regenerated, and on the *sideload/enterprise*
rail (where AIRIZ iOS currently lives, per #7) an expired/revoked profile **does** kill the running
fleet. The mitigation is the same inventory model as #2 applied to the iOS braid: track the
**profile expiry**, the **cert expiry**, and the **Personal Team 7-day re-sign clock** as three SLA'd
credentials, automate the **90-day TestFlight re-sign** well before day 90, and (for AIRIZ) move
the durable iOS distribution *off* the 7-day/revocable rail onto TestFlight so a profile lapse
blocks *new* builds (recoverable in CI) rather than *running* devices (a fleet brick).

### H. Android Play Integrity API vs SafetyNet Attestation

This is a **deprecation-driven** sub-failure that silently bricks a *verification* path, not an
install path. **SafetyNet** (the old attestation API: `CT`/`JWT` "attestation" and "verification")
has been **deprecated by Google** (end-of-support announced, with **2024-08-22** as the cited
attestation end-of-support date) and is being replaced by the **Play Integrity API** (`device` +
`app` integrity, a richer, tamper-aware signal). The failure is that an app that gates a
*security-sensitive* action on SafetyNet (e.g., "only allow the sensitive remote-control command if
the device passes attestation") will, **after SafetyNet stops being honored on newer devices /
Play Store versions, start getting *no* attestation back**, and the naive handler treats "no
attestation" as either "fail closed" (the feature **stops working** for a growing cohort — a silent
capability brick) or "fail open" (the feature **works but is no longer actually attested** — a
security hole). The root cause is that **attestation is a service you depend on that can be
sunset**, and the client must distinguish "attestation unavailable (API deprecated / no Play
services)" from "attestation failed (tampered device)" — conflating them is the bug. The correct
2026 pattern is to migrate to **Play Integrity** (the de-facto successor, which also adds
`MEETS_DEVICE_INTEGRITY` for a tamper signal SafetyNet lacked) and to **fail the *sensitive* action
closed only on an *explicit* integrity-fail**, while degrading *gracefully* (with a logged,
telemetry-visible "integrity unavailable" state) when the API itself is unavailable. **[TRAINING-
KNOWLEDGE - VERIFY: exact deprecation date and Play Integrity semantics; check
`https://developer.android.com/training/integrity` and
`https://developers.google.com/android/safetynet` (deprecation notice)].** For AIRIZ this is a
**forward** concern (the Android app is a signed sideload APK, #9) the moment any *device
attestation* is added to gate the remote-control or share-code features — and the trap is building
it on SafetyNet in 2026, which is already on its way out.

### I. PWA subresource integrity (SRI) and signed service-worker updates

SRI (`<script src=… integrity="sha384-…">`) lets the *browser* verify a **subresource's** hash before
execution, independently of the network and independently of the service worker — which is exactly
the control a PWA *lacks* for its own cached shell. The failure is the **gap between SRI and the SW
cache**: SRI protects resources fetched *through the network with an `integrity` attribute*, but a
service worker serving a resource **from cache** can bypass the SRI check (the SW is the fetch
handler, and what it returns is what executes), so a **poisoned cache entry** for a critical script
executes with no integrity gate. The naive PWA reasons "SRI is on, we're safe" and is wrong for the
*cached* path. The "signed service-worker update" pattern closes this: instead of trusting the SW's
self-reported version, the **new SW download is itself verified** (hash/signature checked against a
value the *current, trusted* SW holds before allowing the new SW to `skipWaiting`), and **critical
shell subresources are SRI-protected on the network fetch** so that even the *first* population of
the cache is integrity-checked before it is trusted. The two layers are complementary: **SRI guards
the network→cache population**, and a **signed/verified SW update guards the cache→activation
handoff**; without both, you have either a poisoned cache (no SRI on the cached path) or a
poisoned *controller* (a new SW you let activate without verifying it). **[TRAINING-KNOWLEDGE -
VERIFY: SRI + SW interaction and signed-SW patterns; check
`https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity` and
`https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API`].** For AIRIZ, where the PWA
shell drives Web Serial and remote control, a poisoned cached `app.js`/`usb-serial.js` is a
full-input-injection vector, so this is not a "nice to have" — the SW must verify the new shell
before activating it and the network populates of the critical scripts must be SRI-checked.

### J. Manifest CDN cache poisoning

This is the #3 attack made *physical*: the manifest (`latest.yml`) is served from a **CDN**
(GitHub Pages is CDN-backed), and a CDN **caches** the response for a TTL keyed on the URL. Cache
poisoning means an attacker gets a **malicious body cached at the manifest URL** so that *every
subsequent fetch* — from any device, for the TTL — returns the poisoned manifest *with a valid
HTTP 200 and a valid TLS cert*, so the client's only defenses (TLS, and the sha512 *inside* the
manifest) are both satisfied *by the attacker's content*. The naive implementation assumes "the
URL is fixed and HTTPS, so the body is fixed," and is wrong for any CDN with a cache that can be
poisoned via (a) a **host-header / path-based** poisoning request, (b) a **shared-CDN** misconfig
where another tenant's poisoned object maps to your URL, or (c) a **compromised origin** that
pushes a poisoned object into the edge. The blast radius is the *whole fleet for the TTL*, and the
*signature* is that it is **intermittent and device-clustered** (devices that hit the poisoned edge
node get it, others don't), which is exactly how a supply-chain compromise *looks* before it is
understood. The mitigation is the same as #3 — **the manifest must be signed (ed25519/minisign) so
the client verifies the *body*, not just the *channel*** — plus **CDN hardening**: short cache TTLs
on the manifest (or `Cache-Control: no-store` for the manifest specifically, so the *small* file is
always origin-fresh while the *large* installer is aggressively cached), **cache-key on the full
URL + host** (no shared-key poisoning), and **monitoring** the manifest's hash at the edge vs the
origin. **[TRAINING-KNOWLEDGE - VERIFY: GitHub Pages CDN caching specifics and poisoning
vectors; check `https://docs.github.com/en/pages` and the relevant CDN vendor's cache-poisoning
docs].** For AIRIZ the *manifest is the small, frequently-fetched, fully-trusted file on a CDN*,
which is the *ideal* cache-poisoning target — and it is **unsigned**, so a poisoned `latest.yml` is
accepted wholesale. The single highest-leverage fix in the whole report is making that file signed.

### K. Sentry / Bugsnag telemetry-gated rollback decision latency

This is the *measurement leg* of the #5 control loop, and its failure is that the **decision to
roll back is only as fast as the telemetry it depends on**, and telemetry has *inherent* lag. A
telemetry-gated rollback ("auto-halt the rollout when crash-rate > X% in the new cohort") sounds
perfect until you account for the lag stack: (1) the **crash must occur** (a user must actually hit
the bad path — a bug in a rarely-taken branch may have *zero* crashes in the first hours); (2) the
**event must be captured and uploaded** (mobile/Edge/relay-forced devices batch and upload
opportunistically, adding minutes); (3) the **aggregation window** (Sentry/Bugsnag compute rates
over a rolling window, so a spike is "confirmed" only after the window fills); and (4) the
**decision + actuation** (the gate fires, the kill-switch is re-emitted, and *then* devices see it
on their next poll — which for AIRIZ is up to **6 hours**, per the poll interval). The total
decision latency is therefore **crash-occurrence + upload-batch + aggregation-window + poll-interval**,
and the *last* term (the poll interval) **dominates and is architectural**, not a Sentry tuning
knob. The naive design sets the crash-rate threshold and "trusts" the telemetry, and discovers that
the *effective* rollback latency is measured in *hours, not minutes*, because the telemetry was
fast but the *delivery of the kill decision* was slow. The root cause is that **the telemetry system
and the update-delivery system have *different* latency budgets and the *slower one* sets the
incident's blast radius.** The 2026 pattern is to *decouple* the two: use telemetry to *detect*
(minutes) but deliver the halt through a **low-latency channel** the client polls *frequently* (or
pushes, if a push path exists) — e.g., a small "is the rollout halted?" endpoint the client checks
*every app foreground / every few minutes* (not every 6 hours), so the *detection* latency is
minutes and the *actuation* latency is bounded by a *short* poll, not the 6-hour update poll.
**[TRAINING-KNOWLEDGE - VERIFY: Sentry/Bugsnag rollout/monitoring latency semantics; check
`https://docs.sentry.io/product/releases/` and
`https://docs.bugsnag.com/`].** For AIRIZ the 6-hour update poll is the *binding constraint*: even a
perfect Sentry alert on a bad 1.11.26 cannot reach a device that last polled 5 hours ago until that
device next polls, so the telemetry-gated rollback's real latency is the 6-hour poll — and the fix
is a *separate, fast* "halt check" independent of the update-download poll.

---

*End of report. Sections marked [TRAINING-KNOWLEDGE - VERIFY] could not be re-verified against a
reachable source in this session (GitHub web UI and raw.githubusercontent.com were blocked by the
active proxy allowlist); the URL to check is given in each such block. Items marked [VERIFIED] were
confirmed against `registry.npmjs.org` on 2026-11-04.*

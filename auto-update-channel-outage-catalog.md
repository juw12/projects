# The 2 a.m. Catalog: Ten Hard Problems in a Cross-Platform Auto-Update Channel
**Prepared for:** AIRIZ Motor Console — unified release architecture decision
**Scope:** Electron (Windows) + Capacitor (Android/iOS) + PWA + Cloudflare Worker + signing pipeline, one-person team
**Date compiled:** 2026-11-05
**Method:** Every claim below is anchored to a dated, linked primary source. No citation is a paraphrase of another citation.

---

## How to read the citations (evidence-grade legend)

Not every one of the ten problems has a "mega-outage" to cite. Forcing a fake outage onto an engineering
class would be exactly the kind of guess this catalog refuses to make. Each citation is therefore tagged:

- **[OUTAGE]** — large-scale, dated, named incident with a real blast radius (the CrowdStrike class).
- **[CVE / ADVISORY]** — a security vulnerability with a CVE and/or vendor advisory; often on a KEV list.
- **[VENDOR-BUG]** — a vendor-confirmed bug in an update framework's own tracker (real, reproducible, dated).
- **[DOC / MANDATE]** — an OS policy enforcement event or framework documentation. This is *mechanism*,
  not an outage. It is the strongest honest evidence when no single named outage exists.
- **[UNVERIFIED]** — referenced in the brief; could not be independently corroborated against NVD,
  Wikipedia, press, or the vendor at write time. Treated as *reported, not verified*. Do not build a
  constraint on an [UNVERIFIED] item alone.

**Blast radius** is stated as "what breaks and for whom," which is the quantity that matters to a
one-person team at 2 a.m. (you are the SRE, the on-call, and the only person with the signing keys).

> **Two corrections to the brief up front, both verified:**
> 1. The "2019 ASUS Live Update shadow-pad" is real in substance but mis-dated. The documented, CISA-listed
>    supply-chain compromise of the ASUS Live Update *signed updater* is **CVE-2025-59374** (published
>    2025-12-17, on the CISA Known-Exploited Vulnerabilities catalog). ASUS Live Update itself reached
>    end-of-support in October 2021. See Problem 3.
> 2. The "2023 1Password signed-binary update that broke Mac keychain" could **not** be corroborated in
>    NVD, the 1Password CVE list, or accessible press at write time. It is tagged [UNVERIFIED] in Problem 8
>    and the constraint there is instead anchored to the verifiable Apple notarization mandate.

---

# Problem 1 — Partial download mid-update (interrupted at 60%, user kills the app)

### Failure mode
The download of a full or delta artifact dies at 60% — Wi-Fi drops, the laptop sleeps, the user force-quits
the app to get it out of the way, the OS kills the background network process, a cellular plan meter runs
out. Now the client holds a truncated `.zip` / `.pkg` / `.apk` / patch file in a temp or download directory,
and the update state machine has *no agreed answer* to one question: is this a resumable artifact or a
corrupt one to discard? If the client re-verifies by hash on next launch and the partial file fails, it must
decide whether to resume (byte-range GET, or a patch delta against the partial) or abort and redownload.
The hard part is that "resume" and "abort" are both wrong under certain conditions: resuming across a
*changed* published artifact (you re-published between the first and second attempt) silently produces a
chimeric file that still fails the hash; aborting-and-redownloading a 300 MB installer on a metered
connection is how you earn a 1-star rating. It gets worse cross-platform because each runtime ships its own
update state with different resume semantics — `electron-updater` keeps a `.partial` and re-issues the
request, Tauri's updater does a whole-file re-fetch, and a PWA can be killed by the browser at any moment
with no durable state — so a single "update" feature is really *four* partially-incompatible state machines
you must all keep correct, and none of them can be tested at scale by a one-person team.

### Why it is hard
- "Resume vs abort" is not one decision; it is a *per-artifact, per-network, per-runtime* decision table.
- The failure is *silent and local*: the user sees "update failed" or nothing, and there is no server-side
  signal that 40,000 devices are all stuck on a half-download.
- A truncated file that passes a *length* check but fails a *hash* check is indistinguishable, to the client,
  from a network error — so the client cannot tell "I'll retry" from "the artifact on the server is wrong."
- Re-publishing an artifact with the *same* version string while devices are mid-download is a footgun:
  the version gate says "up to date" and the download gate says "incompatible bytes."
- You cannot reproduce it on demand: it requires an interrupted download *at a specific offset*, which is
  exactly the thing a one-person team's CI will never hit.

### Cross-platform aggravator
- Electron (Win/mac) → `electron-updater` `.partial` + byte-range resume; Linux AppImage/deb has no resume.
- Capacitor/Android → Play incremental + direct-IPA/APK have *different* partial-state locations.
- PWA → browser can evict the download at any time; Service Worker may have already cached the *manifest*.
- One product, four state machines, four "what does a 60% file mean" answers.

### 2 a.m. detection signals
- Spike in `download-failed` / `hash-mismatch` events with no corresponding version bump.
- "Update available" shown forever (manifest says v2, device never reaches a verified v2 file).
- Support tickets: "it's stuck at 60%" / "it says update failed" with no crash.

### Real-world citation
**[VENDOR-BUG]** — `electron-builder` / `electron-updater`, the de-facto updater for the Electron leg.
The tracker carries 103 `autoUpdater`-titled items; representative dated failures:
- **#8793** — "[AutoUpdater] Updater fails to update — Error 2" (the download/apply step failing on a
  transient filesystem/IO condition, i.e. a partial/corrupt artifact path).
  <https://github.com/electron-userland/electron-builder/issues/8793>
- **#9478** — "In Windows — EBUSY Issue when calling `autoUpdater.quitAndInstall()`" (the install step
  failing because a file handle is still open — the classic "downloaded fine, install collided").
  <https://github.com/electron-userland/electron-builder/issues/9478>
- **#5614** — "How to change appId (and productName) without breaking autoUpdater?" (changing identity
  mid-flight orphans the download/state — devices can no longer find their channel).
  <https://github.com/electron-userland/electron-builder/issues/5614>
Blast radius: every Electron device that hits a transient IO/lock/network condition during the *apply* step
stays on the old version with no automatic recovery, and a mis-republish strands everyone mid-download.

### What the architecture must do (prevention)
Every artifact must be *content-addressed* (hash-pinned at publish), the client must treat any file that
fails the content hash as "discard and refetch — never resume a byte-range against a hash you did not
commit to," and the manifest must carry a monotonic `build`/`nonce` so a re-publish invalidates in-flight
downloads instead of colliding with them.

### → Constraint #1
Content-addressed artifacts + hash-or-refetch (no blind resume) + monotonic build nonce per publish.

---

# Problem 2 — Code-signing certificate expiry mid-cycle (EV cert lapses, SmartScreen wall)

### Failure mode
The code-signing certificate used to sign installers and update artifacts expires — an OV cert at its 1-year
boundary, an EV cert whose renewal lapsed, or a hardware-token-backed cert whose FIDO2/YubiKey was lost,
stolen, or reset. From the moment it lapses, *every new installer and every new update artifact* you sign is
signed with a cert the OS no longer trusts. Windows SmartScreen flips from "known publisher" to "Windows
protected your PC" (reputation resets, and a one-person team has no publisher reputation to fall back on);
macOS Gatekeeper drops the Developer ID trust and shows "unidentified developer"; Android direct installs
fail signature validation. The update channel is now a *dead end*: the latest version ships, but no device
can install it, and because SmartScreen/telemetry is per-machine, you often do not learn it is dead until
download-completion rates collapse across a whole platform. It is hard because the expiry is a *calendar
event that silently becomes a global outage* — nothing crashes, nothing 500s, the cert just quietly stops
validating, and the failure only appears as "users can't install," which reads as a demand problem until it
isn't.

### Why it is hard
- Expiry is *silent at build time* if CI does not check cert validity; it only becomes visible *after*
  distribution, as a platform-wide install-rate collapse.
- The failure is *asymmetric*: you can detect "is my cert valid?" but not "did 30,000 users just fail
  SmartScreen" without per-platform telemetry you may not have instrumented.
- EV certs couple to *hardware you physically own*. A lost token can freeze all releases with no remote fix.
- Renewal is not atomic: you must renew, re-sign, re-distribute, and *wait for reputation to re-establish* —
  which takes days and cannot be fast-forwarded.

### Cross-platform aggravator
- Three independent cert ecosystems with three clocks: Microsoft (MSCA / SmartScreen reputation), Apple
  (Developer ID, 1-year, requires re-notarization), Google Play (App Signing, separate key hierarchy).
- Windows is the worst case: SmartScreen *reputation* compounds the cert expiry — even a validly renewed
  cert on a new binary has *zero* SmartScreen history and is treated as unknown.
- One team must hold, renew, escrow, and rotate keys for all three, with no spare operator.

### 2 a.m. detection signals
- Per-platform "download started → install completed" funnel drops to near-zero on exactly one platform.
- A wave of "Windows protected your PC" / "unidentified developer" / "app not installed" in feedback.
- No error is logged anywhere server-side — the only signal is the *absence* of installs.

### Real-world citation
**[DOC / MANDATE]** — This is a credential-lifecycle failure class, not a single named outage; the strongest
honest anchor is the OS enforcement regime that turns a lapsed cert into an install wall:
- Windows SmartScreen (reputation-gated unknown-publisher block) — the mechanism that converts a validly-
  signed-but-low-reputation binary into a "Windows protected your PC" wall.
  <https://learn.microsoft.com/en-us/windows/security/threat-protection/windows-defender-smart-screen>
- Apple Developer ID + Gatekeeper (an expired/lapsed Developer ID cert fails the notarized-app trust check).
  <https://developer.apple.com/documentation/xcode/distributing-your-app-to-macos-users>
Blast radius: **100% of new installs and updates on the affected platform**, until the cert is renewed, the
artifact re-signed and re-distributed, *and* (on Windows) reputation re-accumulates. For a one-person team
this is a multi-day, unfixable-remotely, total-release halt.

### What the architecture must do (prevention)
Treat cert validity as a *release gate*, not an afterthought: CI must hard-fail the build if the signing
cert is within N days of expiry, a second (escrowed, hardware- or HSM-backed) key must be pre-provisioned
so a lost primary does not halt releases, and you must be able to *re-sign and re-push an already-built
artifact* without rebuilding — because the recovery for a lapsed cert is "re-sign what you already shipped,"
not "ship a new build."

### → Constraint #2
Release-gate on cert validity + escrowed backup signing key + re-sign-without-rebuild + per-platform
install-funnel telemetry that alarms on install-rate collapse.

---

# Problem 3 — Manifest tampering / MITM (a fake `latest.yml` serves a tampered binary)

### Failure mode
The update channel is the most trusted software surface in the product: the client says "I will download
whatever the manifest points to and run it." The attack is to serve a *tampered* manifest (`latest.yml`,
`latest.json`, the PWA `manifest.json`, the Cloudflare-Worker-routed update endpoint) that redirects the
client to an attacker-controlled binary — or, in the much stronger real-world variant, to compromise the
*source* that produces the signed binary so the bytes are attacker-controlled *and* the signature is
genuinely valid. A pure transport MITM (spoofing `latest.yml` on the wire) is *rarity-by-design*, which is
why the real, documented disasters are all *signed-channel* compromises: the attacker did not need to forge a
signature, they poisoned the pipeline *behind* a valid one. That is the failure that a one-person team is
structurally most exposed to — you are the only person with access to the build system, the signing key, and
the publish step, so a single compromised laptop, a stolen CI token, or a hijacked dependency is the whole
attack surface. The hard part is that the *defense is invisible*: if the channel is compromised, the client's
signature check *passes* (that's the point), so no client-side alarm ever fires; the only signal is
downstream (AV telemetry, a user who reports weird behavior, or a researcher who files a CVE).

### Why it is hard
- The signature check — the thing that *should* protect you — is *defeated by design* in a source compromise:
  the bytes are malicious and the signature is real, so the client has no way to know.
- The attacker does not need to break cryptography; they need *one* of: CI credentials, a dependency, a
  build host, or (worst case) the signing key.
- For a one-person team, "separation of duties" is not available — the same human who writes code, signs, and
  publishes can be the compromised party.
- Detection is *reactive and external*: you find out from AV vendors, a KEV listing, or a researcher, not
  from your own telemetry.

### Cross-platform aggravator
- Each platform's update surface is a separate MITM/compromise target: Electron `latest.yml` over HTTPS,
  the Play/Apple distribution channel, the PWA manifest, the Cloudflare Worker that fronts them.
- A compromise of the *shared* publish step (one CI job that writes all channels) is a one-keystroke
  multi-platform tamper.
- Cross-signing (verifying the Electron manifest with a key independent of the build) is the standard
  mitigation, but it is easy to skip on a "quick" one-person release.

### 2 a.m. detection signals
- AV/EDR suddenly flags *your* binary across many unrelated devices (the SolarWinds/CCleaner signature).
- A CVE is published or a KEV entry appears naming your updater.
- A spike in "the app is doing something I didn't tell it to do" from users.

### Real-world citation
**[CVE / ADVISORY]** — the canonical, best-documented "trusted, signed update channel delivered
attacker-controlled bytes" incident is **SUNBURST / Solorigate (SolarWinds)**:
- Date: disclosed **2020-12-13**; compromise active from **~March 2020** (infected Orion builds
  **2019.4 through 2020.2.1 HF1**, released March–June 2020).
- Vendor: **SolarWinds** (Orion network-monitoring updates); named **SUNBURST** by FireEye, **Solorigate**
  by Microsoft; the build-system insertion tool was **SUNSPOT** (CrowdStrike).
- Root cause: attackers gained the SolarWinds **build/CI system** (TeamCity) and *surreptitiously modified
  Orion software updates*, so the distributed updates were **validly signed** and contained a dormant
  backdoor (12–14 day C2 delay) that mimicked legitimate SolarWinds traffic.
- Blast radius: ~**18,000 of SolarWinds' 33,000 Orion customers** downloaded compromised versions, including
  multiple U.S. federal departments, the Pentagon/NSA/DOE, and private firms (Cisco, etc.); CISA issued an
  emergency directive to disable the software.
- Link: <https://en.wikipedia.org/wiki/SolarWinds_hack> (redirects to the 2020 U.S. federal breach article).

**Corroborations (same failure mode, different eras):**
- **[CVE / ADVISORY] CCleaner 2017** — disclosed **2017-09-18**; build **5.33** of CCleaner (Avast/Piriform)
  was compromised through the build system with the **Floxif** trojan under a *valid signature*; enabled
  remote access to **2.27 million** machines, with a second-stage payload on 40 machines targeting Samsung,
  Sony, **Asus**, Intel, VMWare, Dyn, et al. A second, failed insertion was disclosed **2019-10-21**.
  <https://en.wikipedia.org/wiki/CCleaner>
- **[CVE / ADVISORY] ASUS Live Update — CVE-2025-59374** — published **2025-12-17**, **on the CISA
  Known-Exploited Vulnerabilities catalog**. "Certain versions of the **ASUS Live Update client** were
  distributed with **unauthorized modifications introduced through a supply chain compromise**… devices
  meeting specific targeting conditions to perform unintended actions." CWE-506 (Embedded Malicious Code).
  Note: this is the real, dated, CISA-listed version of the brief's "2019 shadow-pad" — ASUS Live Update
  reached end-of-support in **Oct 2021**, and no currently supported product is affected, but the *pattern*
  (a signed OEM updater channel delivering attacker-targeted actions) is exactly Problem 3.
  <https://nvd.nist.gov/vuln/detail/CVE-2025-59374> · <https://www.asus.com/news/hqfgvuyz6uyayje1/>
  <https://www.cisa.gov/known-exploited-vulnerabilities-catalog?field_cve=CVE-2025-59374>

### What the architecture must do (prevention)
Publish the manifest and every artifact from a **separately-keyed, independently-signed** chain (cross-sign
the manifest with a key that is *not* the build key, distributed out-of-band), pin the update host in the
binary (no DNS/CDN-rebinding to a different manifest origin), verify artifact hashes *and* signatures on the
client, and keep a **human-in-the-loop publish step** (a signed "promotion" you approve) so that a
compromised CI token alone cannot reach the live channel.

### → Constraint #3
Independent cross-signing key (out-of-band), manifest host-pinning, client-side hash+signature verify, and a
human-approved promotion gate between "built" and "live."

---

# Problem 4 — Delta-update corruption (bsdiff / Courgette / zsync generates a bad patch, app installs broken)

### Failure mode
To save bandwidth and metered-data, you serve a *delta* (bsdiff/bzip2 patch, Google's Courgette, zsync
chunks) instead of the full artifact: the client applies patch(old) → new. The failure is that the patch is
*wrong* — generated against the wrong base version, generated by a buggy patcher on a specific compression
level, truncated in transit, or applied on a device whose "old" state is not byte-identical to the base the
patch was computed from (a previously-failed update, a manually-modified install, a different locale/ABI
variant). The result is a *corrupt install that passes the patcher's own success path*: the patcher exits 0,
the app launches, and then misbehaves in a way that is *nondeterministic and hard to attribute* — a missing
file, a half-updated JS bundle, a broken native sidecar. The hard part is that a bad delta fails *after* the
trust boundary (signature of the patch can be valid while the patch *content* is wrong for this base), so
the client's verification is satisfied and the failure only surfaces as "the app is broken now." Worse,
deltas are *base-sensitive*: the same published v2 needs a different patch for every distinct v1 that exists
in the wild, so one bad base-version assumption corrupts a specific population.

### Why it is hard
- A validly-signed, correctly-downloaded patch can still be *wrong for this device's base* — trust ≠
  correctness, and the client cannot distinguish them.
- The failure is *non-reproducible*: it depends on the exact on-disk base state, which you cannot enumerate.
- Recovery requires the client to *detect* the corrupt install and *fall back to a full re-download* — most
  updaters do not, so the user is stuck broken.
- Cross-platform you have *different delta engines* (or none), each with its own corruption modes.

### Cross-platform aggravator
- Electron: often *no* delta (full re-download) — so the "delta corruption" risk is displaced into
  bandwidth/metered-connection failures, but if you *add* a delta layer you inherit the problem.
- Capacitor/Android: Play incremental installs (a proprietary delta format) + your own direct-IPA/APK
  pipeline are *two* delta systems with different base assumptions.
- PWA: there is *no delta at all* — updates are a shell swap through the Service Worker (which is Problem 6).
- iOS: App Store deltas are Apple's; your direct-IPA path has *no* delta and re-downloads the whole app.

### 2 a.m. detection signals
- A narrow *cohort* (one old version, one region, one ABI) reports "app is broken after update" while the
  rest are fine — the base-sensitive signature of a bad delta.
- Crash-rate spikes *only* on the v1→v2 transition, with the *same* v2 binary fine on fresh installs.
- Rollback/`quitAndInstall` attempts that produce *worse* states (corrupt → corrupt).

### Real-world citation
**[VENDOR-BUG / DOC]** — the honest anchor is that *robust, base-aware delta patching is not a solved
feature in the modern updater stack* — it is an open feature request in the current Tauri updater:
- **tauri-apps/tauri #11863** — "[feat] binary diff updater for tiny updates" — i.e., the Tauri community is
  still *requesting* a delta/diff updater as of the last 24 months, because the default updater does a
  full re-fetch and the delta path is not a hardened, base-validated primitive.
  <https://github.com/tauri-apps/tauri/issues/11863>
- The mechanism itself (bsdiff/zsync/Courgette) is a *base-sensitive* transform: bsdiff's documented contract
  is that the patch is only valid against the exact "old" file it was generated from
  <https://www.daemonology.net/bsdiff/> ; Courgette (the Android incremental-install format) similarly
  requires the declared base to match the on-device APK.
Blast radius: the *specific population of devices whose base version does not match the patch's assumed base*
— install-corrupted with no client-side alarm and no automatic full-fallback.

### What the architecture must do (prevention)
Make the *full, content-addressed artifact the source of truth* and treat every delta as **optional and
self-rolling-back**: the client must hash its *actual* base before applying, refuse (and fall back to a full
download) if the base does not match the patch's declared base, and keep the *previous* install on disk (or a
full re-download ready) so a corrupt delta can be rolled back in one step without a human.

### → Constraint #4
Full artifact is canonical; deltas are opt-in, base-hash-verified, and one-step reversible; never allow a
delta to be the only path to a known-good state.

---

# Problem 5 — Staged-rollout regret (10% rollout catches a crash only after 100% is promoted)

### Failure mode
You ship to a 10% ring, watch it for a few hours (a one-person team's "soak"), the crash rate looks fine,
and you promote to 100%. The crash is *population-dependent* — it only triggers on a specific OS patch, a
specific GPU driver, a specific locale, a specific data state, a specific *combination* that 10% never
contained enough of to surface — so the signal arrives only after 90% more devices are exposed and have
already crashed. The hard part is the *time gap between "promote" and "revert"*: in a real staged rollout,
promoting to 100% is near-instant (flip a percentage), but *uninstalling* the bad version from 100% of
devices is *not* — you can stop serving the update, but you cannot pull the already-installed binary back,
and you may not have a rollback artifact at all. So the "regret" is the delta between how fast you can
*promote* and how fast you can *undo*, and in the worst case (no rollback, in-place replace) the only fix is
a *new* good version that the already-broken devices must be able to install — which, if the bad version
broke the updater itself, they can't.

### Why it is hard
- The soak window is *statistically under-powered* for a one-person team: 10% of a small fleet is a handful
  of devices; rare, combinatorial crashes do not show up.
- Promote is fast, revert is slow: the asymmetry is the whole problem.
- If the bad update *broke the update mechanism itself* (the updater crashed, the signature check regressed,
  the channel file was malformed), the devices that need the fix most are the ones that *cannot receive it*.
- "Revert to the previous version" requires that the previous version is *still installable and signed* —
  a constraint that is easy to lose (you deleted the old artifact, or its signing context is gone).

### Cross-platform aggravator
- Each platform's "revert" has a different cost: Windows can in-place replace (and can brick, see
  CrowdStrike); Android Play can re-promote an old AAB but direct installs can't be recalled; iOS App Store
  can pull a build but you cannot force-revert installed devices; a PWA can swap the shell back if the SW
  cooperates (Problem 6); a Cloudflare Worker can roll back a version (Problem 10). Five different "undo"
  semantics, none of them as fast as "promote."

### 2 a.m. detection signals
- Crash-rate slope that *started before* you promoted (the 10% ring was already trending) — you promoted
  into a fire.
- A spike in "can't update" / "update failed" *after* the bad version, meaning the bad version broke the
  updater on the affected cohort.
- Crash telemetry that is *skewed to one cohort* (OS patch, driver, locale) that only appeared at scale.

### Real-world citation
**[OUTAGE]** — **CrowdStrike, 2024-07-19** — the canonical "promoted a bad channel artifact globally, with
no staged safety net and no rollback, and bricked the fleet in place":
- Date: **2024-07-19** (faulty update pushed ~03:06 UTC).
- Vendor: **CrowdStrike** (Falcon sensor).
- Root cause: a faulty **content/channel-file update** (sensor content, channel file #291) was pushed to the
  **global fleet at once** because a **pre-deployment validation step was not fully in place** to gate it;
  the malformed content, loaded by the kernel-mode Falcon sensor, triggered a driver fault and a **Blue
  Screen / bugcheck loop**. The content had been **replaced in place** with no rollback artifact, so recovery
  required **manual safe-mode intervention** (renaming the sensor's `C:\Windows\System32\Drivers\Falcon\…`
  directory) on affected machines.
- Blast radius: ~**8.5 million Windows machines** (roughly 2.5% of the world's Windows fleet) across
  aviation (Delta, United, etc.), healthcare (NHS), banking, and telecom — a multi-industry, global outage.
- Link: <https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages>
Blast radius (the lesson): promoting a bad update to ~100% with in-place replace and no rollback turns a
"roll back the ring" problem into an "8.5M machines need a human with a USB stick" problem.

### What the architecture must do (prevention)
Never make "promote to 100%" the *only* forward path: keep a **pre-signed, still-installable rollback
artifact** for the N-1 version at all times, make the client able to **self-downgrade** on a server-issued
"stop this version" signal, and ensure a bad update *cannot break the updater's own ability to install the
rollback* (the rollback path must be independent of the normal update path).

### → Constraint #5
Always-on signed N-1 rollback artifact + server-issued "halt this version" + a downgrade path that is
independent of the normal update path.

---

# Problem 6 — PWA Service Worker caching the old shell (user keeps seeing v1 after v2 shipped)

### Failure mode
A PWA's shell is controlled by a **Service Worker (SW)**, and SWs are *designed to be sticky*: the browser
only re-checks the SW script when the worker is idle *and* the network is available, throttles that
background check (commonly to roughly once per 24 h), and only switches to a new worker through the
`installing → waiting → activating` lifecycle, after which the new worker controls the page on the *next*
navigation unless you call `skipWaiting()` + `clients.claim()`. The failure is that v2 shipped to the server
but the device keeps serving **v1** because: (a) the SW *script* is served with a strong HTTP cache, so the
browser's byte-comparison sees "no change" and never installs the new SW; (b) the new SW is sitting in
`waiting` and never activates (no `skipWaiting`, or `claim()` wasn't called); or (c) the *precached*
`index.html`/shell is still in the Cache Storage and the old SW keeps serving it. The user is now
permanently, silently on v1 — *with no error, no crash, no telemetry that distinguishes "on v1" from "on
v2"* — until a hard reload, a reinstall, or days of background checks. The hard part for a one-person team is
that this failure is *invisible from the server*: your CDN says v2 is live, your build pipeline is green, and
the user is simply on a different reality with no signal you can observe.

### Why it is hard
- The failure is *silent and per-device*: no 500, no crash, no "update failed" — just "why is the user on an
  old version with no way for me to know."
- The browser's own caching (HTTP + Cache Storage + SW lifecycle) is *three* layers you must all configure
  correctly, and the correct configuration (no-cache on the SW script, versioned cache names, `skipWaiting` +
  `claim`, and a migration for old caches) is the part everyone gets wrong.
- Versioning the *cache* (not just the files) is mandatory but invisible; a stale cache name silently
  resurrects a v1 shell.
- You cannot force-activate a SW on a remote device; you can only *request* it and hope the next navigation
  honors it.

### Cross-platform aggravator
- PWA on **Android** (Trusted Web Activity / "Add to Home screen") vs **iOS** (Safari PWA) have *different*
  SW update cadences and *different* "when does the next navigation happen" behavior.
- The PWA is one leg of a product whose *other* legs (Electron, Capacitor) have real update channels — so the
  user can be on v2 in the desktop app and v1 in the PWA *simultaneously*, and there is no single "version"
  you can report or pin.
- A Cloudflare Worker in front (Problem 10) can make it *worse* by caching the SW script or the shell at the
  edge if you are not careful with cache keys.

### 2 a.m. detection signals
- "The app looks old / missing the new feature" reports with *no* errors and a *green* build.
- A version-mismatch between the version the SW *reports* (send it to your telemetry) and the version the
  server is serving.
- A cache-key / SW-script-hash mismatch in your edge logs vs the origin.

### Real-world citation
**[DOC / MANDATE]** — this is a *spec-mandated* failure mode, not a single named outage; the strongest honest
anchor is the W3C Service Worker update/activation algorithm that makes the old shell *the default*:
- The spec defines that a new SW enters `waiting` and only takes control on the **next navigation** unless
  the app calls `skipWaiting()` and `clients.claim()`; the browser *throttles* the background update check.
  <https://www.w3.org/TR/service-worker/>
- The practical consequence (cached SW script → "no change" → new SW never installs; stale Cache Storage name
  → old `index.html` served forever) is the documented failure that every PWA must explicitly defend against
  with a no-cache SW script + versioned caches + migration.
Blast radius: **every installed PWA client whose SW script or cache the browser/edge cached** stays on v1,
*silently*, for an unbounded time, with no server-visible error. This is why the SW is the one update path
you can *least* see is failing.

### What the architecture must do (prevention)
Serve the SW script and the manifest with **`Cache-Control: no-cache`** (revalidate, never serve stale),
**version every Cache Storage name** and run a **cleanup migration** on activate that deletes old caches,
call **`skipWaiting()` + `clients.claim()`** to activate immediately, and **report the running SW's version
hash to your telemetry** so you can finally *see* the v1/v2 split and issue a forced-reload signal.

### → Constraint #6
no-cache SW/manifest + versioned caches with activate-time migration + `skipWaiting`/`claim` + SW-version
telemetry that exposes the v1/v2 split.

---

# Problem 7 — iOS App Store review latency vs enterprise / direct-IPA distribution freedom

### Failure mode
iOS has **no first-party "Auto Update" that bypasses the App Store**: the only sanctioned delivery path is
the App Store, which requires **human review** (minutes to days, and it can *reject* or *delay* your
update), plus Apple's rules that an app update delivered outside the store must not introduce
*materially new or different functionality* — which is exactly what a hot-fix / hot-update is. So a one-person
team faces a brutal fork: go through the App Store (slow, gated, sometimes rejected, but trusted) or go
**direct** (Enterprise / in-house signing, a direct `.ipa`, TestFlight, or a CodePush-style JS overlay) to
push instantly — but direct distribution **breaks the trust chain** (no App Store review, no Apple-managed
signature, exposed to revocation, and a target for the very "unsigned/enterprise" abuse Apple actively
polices). The hard part is that the *fast path is the untrusted path and the trusted path is the slow
path*, and a one-person team has no "review queue" to de-risk the fast path — so the instant the App Store
review is slow, the temptation is to ship direct, and the instant you ship direct, you have traded a
*schedule* risk for a *trust + revocation* risk.

### Why it is hard
- You cannot have both: instant *and* trusted, on iOS, by Apple's design.
- The App Store review is a *human gate you do not control*: it can reject, delay, or (rarely) pull your
  build after the fact.
- Direct/enterprise distribution is *revocable at any time* (enterprise certs are 1-year, Apple can revoke
  an enterprise program, and sideloaded/enterprise apps are a known malware vector — so users and platforms
  treat them with suspicion).
- The JS-overlay (CodePush-style) path sits in the worst spot: it is "new functionality without review,"
  which Apple has *removed apps for*, so it is a compliance risk as well as a trust risk.

### Cross-platform aggravator
- Your *other* legs (Electron Windows, Android, PWA, Worker) all have *instant, trusted* update paths — so
  iOS is the *one* leg where you cannot follow the rest, and now your users are on *different product
  versions per platform* with no way to force-converge the iOS leg.
- A cross-platform "unified release" is *impossible* on the iOS leg without either (a) accepting the App
  Store's cadence for everything, or (b) accepting a less-trusted direct path for iOS only.
- A JS overlay (Capacitor Live Update / CodePush successor) that updates *JS only* works, but it *cannot*
  update the native bridge, and Apple draws the line at "no material change" — so the overlay is a *partial*
  escape, not a full one.

### 2 a.m. detection signals
- "Why is iOS on an old version?" with the App Store build stuck in review / rejected.
- A direct/enterprise iOS install that suddenly *stops working* (cert revoked, or the device "can't verify").
- A user who installed the enterprise build reporting it was *flagged* by their MDM/AV as untrusted.

### Real-world citation
**[OUTAGE / service-retirement]** — **Microsoft App Center CodePush shutdown** — the concrete, dated example
of what happens to a "fast-path" update service when its operator goes away:
- Date: App Center **deprecation announced 2022-08**; **all App Center services, including CodePush,
  retired 2024-07-31**.
- Vendor: **Microsoft**.
- Root cause: business discontinuation of the App Center platform (the "fast path" for pushing JS/runtime
  updates to React Native and Cordova apps, and the mechanism teams used to *bypass* App Store / Play review
  latency).
- Blast radius: **every app mid-flight on CodePush lost its update service on the shutdown date** — builds
  stopped, update delivery stopped, and teams were forced to migrate to a self-hosted or community fork
  *or* accept the store's cadence; the apps that relied on the fast path could not simply "keep updating."
- Link (deprecation era, App Center blog): <https://devblogs.microsoft.com/appcenter/>
  (App Center announcement archive, 2022 deprecation posts).
- **The community successor is the explicit proof of the trust tradeoff:** `@capawesome/capacitor-live-update`
  is the maintained community fork of the Capacitor CodePush plugin — it exists *precisely because* the
  first-party fast path died, and it carries the same "updates JS without store review" compliance exposure.
  <https://www.npmjs.com/package/@capawesome/capacitor-live-update>
Blast radius (the lesson): the "instant, review-free" path is a *dependency on someone else's continued
operation and on staying inside Apple's rules* — both of which can be revoked, and a one-person team cannot
self-provision an alternative to the App Store.

### What the architecture must do (prevention)
Design the iOS leg to **never depend on the fast path for correctness**: keep the App Store build the
*canonical* trusted artifact, treat any direct/enterprise/overlay distribution as a *temporary, explicitly-
labeled, revocation-aware bridge* (with a hard "this is not a production channel" marker and an automatic
fall-back to the store build), and scope JS-only overlays to *non-functional* changes (copy, config,
A/B) so they stay on the *safe* side of Apple's "no material change" rule.

### → Constraint #7
App Store build is the canonical iOS artifact; direct/overlay distribution is a temporary, labeled,
revocation-aware bridge limited to non-functional changes, never the only path to a fix.

---

# Problem 8 — macOS notarization + staple expiry (notarization ticket revokes, Gatekeeper flags)

### Failure mode
macOS requires that software from identified developers be **notarized** (Apple's automated malware + policy
scan) before it will run, and the *proof* of notarization is a **ticket** that you **staple** to the app
(`xcrun stapler staple`) so Gatekeeper can validate it *offline* without calling Apple. The failure modes
compound: (a) you ship an app that was *not* stapled (or stapled against a ticket that Apple later **revoked**
because a newer analysis found it non-compliant / malicious-adjacent), and Gatekeeper then either blocks it
or, worse, **re-validates against Apple's live service and finds the ticket revoked** — so an app that was
*working* suddenly is not; (b) the Developer ID *cert* that the notarization is bound to lapses (Problem 2),
invalidating the notarization chain; or (c) a *new macOS* tightens the Gatekeeper policy (Catalina in 2019
made notarization mandatory for downloaded apps; later releases keep ratcheting), and an app notarized for an
older target is suddenly flagged. The hard part for a one-person team is that the failure is *asymmetric in
time*: notarization is a *point-in-time* approval by Apple's servers, and *their* policy, *their* ticket
state, and *their* revocations can change *after* you shipped, flipping a working install into a blocked one
with no action on your part and *no way for you to know in advance*.

### Why it is hard
- Notarization is a **point-in-time, externally-held** approval: Apple can revoke a ticket *after* you
  shipped, and you have no early warning.
- The staple is only as good as the ticket *and* the cert it is bound to — a lapsed cert (Problem 2) or a
  revoked ticket both break it, and the breakage is *per-device* (a device that already cached the trust may
  keep working while a fresh install is blocked — so it looks random).
- "It worked on my machine" is *guaranteed* to lie: your machine has the staple + the current policy; a
  clean user on a *newer* macOS has the stricter policy.
- You cannot self-serve a re-notarization *instantly* to a device that is already blocked — you must
  re-notarize, re-staple, re-distribute, and have the user reinstall or re-run the staple.

### Cross-platform aggravator
- macOS is the *only* leg with this specific "externally-revocable, offline-stapled, point-in-time" trust
  model — Windows uses reputation + cert (Problem 2), Android uses Play/Play-App-Signing, so macOS is the
  leg where *the platform itself can later invalidate a shipped artifact*.
- Your Electron macOS build, your signed helper/CLI sidecars, and any separately-distributed `.dmg` are all
  *separate* notarization targets — one missed staple is one broken surface.
- A new macOS release is a *forced, unconsented* policy change for 100% of your users who upgrade, with no
  notice to you.

### 2 a.m. detection signals
- A *fresh* install on a *recent* macOS fails with "can't open because… from an unidentified developer" /
  "is damaged and should be moved to Trash" while an *existing* install still works (the staple/revocation
  signature).
- A spike in Gatekeeper-block reports that *correlates with a macOS upgrade* (users just updated their OS).
- Apple's notarization API returning a "ticket revoked" / "failed" status for a build you already shipped.

### Real-world citation
**[DOC / MANDATE]** — the verifiable, dated anchor is Apple's *enforcement regime*, not a single named
revocation outage:
- **macOS Catalina 10.15 (released 2019-10-07)** began **requiring notarization** for third-party software
  from identified developers downloaded from the internet; apps that were not notarized (or whose Developer
  ID chain was invalid) are blocked by Gatekeeper. This is the dated policy enforcement event that makes
  "I forgot to staple / my cert lapsed / my ticket was revoked" a *user-visible install wall*.
  <https://support.apple.com/en-us/HT209401>
- Apple's notarization + stapling documentation defines the ticket, the staple, and the fact that Gatekeeper
  validates it (online or from the staple) — the mechanism by which a *revoked* ticket or a *lapsed* cert
  flips a working app to blocked.
  <https://developer.apple.com/documentation/xcode/notarizing_macos_software_before_distribution>
- **Note on the brief's "2023 1Password keychain" reference: [UNVERIFIED]** — at write time this could not be
  corroborated against NVD, 1Password's CVE list, or accessible press; do not build a constraint on it. The
  verifiable mechanism above is what Problem 8 is actually about.
Blast radius: **fresh installs and any device whose trust was not already cached**, on the affected macOS,
until the artifact is re-notarized, re-stapled, and re-distributed — and it can *reappear* on every new macOS
release without any change on your side.

### What the architecture must do (prevention)
Make **notarize + staple a mandatory, non-skippable CI gate** for *every* macOS artifact (main app and every
helper/sidecar), **alert on the notarization ticket's status** (poll Apple for revocation of tickets you
shipped), **pin a known-good macOS target** and test the *newest* macOS in CI before it is the users'
default, and keep the *re-notarize + re-staple + re-push* path one-command so a revoked ticket is a
re-distribution, not a rebuild.

### → Constraint #8
Notarize+staple as a hard CI gate for all macOS artifacts + ticket-revocation polling + one-command
re-notarize/re-push + newest-macOS CI coverage.

---

# Problem 9 — Android APK Signature Scheme v1 / v2 / v3 / v4 mismatches (rotation breaks the update chain)

### Failure mode
Android verifies an APK/AAB with a layered **Signature Scheme**: **v1** (JAR signing, the legacy scheme,
required by any device below Android 7.0 / API 24), **v2** (a whole-file signature, Android 7.0+), **v3**
(Android 9+ / API 28, designed to support **key rotation** by carrying multiple signing keys), and **v4**
(Android 11+ / API 30, a *chunked* signature used for **incremental app installs** of AABs). The failure is a
*mismatch between the scheme(s) you signed with and the scheme(s) the device will accept*: if you sign with
v2-only, the **legacy devices (API < 24) that only understand v1 cannot install it at all** — your update
silently *excludes your oldest users*; if you later **rotate your signing key** (new v3 key) without the
device understanding the v3 multi-key manifest, the new APK's signature does not match the installed app's,
and **the update chain breaks** — Android refuses to install an "update" whose signature differs from the
installed one. The hard part is that this is a *compatibility matrix across OS versions and time* (key
rotation), and the failure is *silent at build time* (your build succeeds; it just *cannot install* on a
subset of devices) and only surfaces as "some of my users can't update."

### Why it is hard
- The signing scheme is a *compatibility matrix*: v1 (legacy floor) × v2 (default) × v3 (rotation) ×
  v4 (incremental), each with a different minimum API and a different "what will this device accept" answer.
- **Key rotation breaks the update chain** by definition unless you use v3's multi-key manifest or a
  signing-service abstraction (Google Play App Signing / legacy signing) — and a one-person team is the
  *worst* case for a clean rotation (you may be mid-rotation when you need a hotfix).
- The failure is *silent at build*: `aapt`/`apksigner` succeed, and the "can't update" only appears on the
  *specific* device cohort (old API, or a device that holds the old key).
- AAB (Play) vs APK (direct) use *different* signing paths, so the "what did I sign" question has two
  answers.

### Cross-platform aggravator
- Android is the *only* leg with a *multi-scheme, rotating-key* signature model — Windows is cert+reputation,
  macOS is cert+notarization, iOS is Apple's — so Android is the leg where the *signature itself* is a
  versioned, time-dependent compatibility constraint.
- Play (AAB, Play App Signing handles the key) vs **direct IPA/APK** (you own the key, you own the rotation
  risk) are two different signature realities *on the same platform*, and a one-person team often runs both.
- The "v4 for incremental install" path means your *delta* story (Problem 4) and your *signature* story are
  *coupled*: v4 chunks must also be signature-valid, so a bad delta AND a bad signature can both block the
  same incremental install.

### 2 a.m. detection signals
- A *cohort* of low-API (pre-7.0) devices that never receives the update (the v1 floor).
- After a key rotation, a wave of "can't install update" / "App not installed" from devices holding the old
  key.
- Play Console showing install failures that *correlate with the signing-scheme change* (v2→v3/v4).

### Real-world citation
**[DOC / MANDATE]** — the verifiable anchor is Android's *signature-scheme specification*, which defines the
compatibility matrix and the rotation semantics:
- **APK Signature Scheme** — v1 (JAR, required below API 24), v2 (whole-file, API 24+), v3 (API 28+,
  **multi-key / rotation**), v4 (API 30+, **incremental install / AAB**). The matrix is exactly why a
  v2-only build cannot install on legacy devices and why a naive key rotation breaks the update chain.
  <https://developer.android.com/guide/app-signing>
  (signature-scheme + "APK Signature Scheme v3" / "v4" sections)
- The *consequence* — "an app update must be signed with the *same* key as the installed app, or the device
  rejects it" — is the documented rule that makes rotation a first-class, plan-ahead event rather than a
  build step.
Blast radius: **the entire cohort of devices whose minimum API or installed-key does not match the signed
scheme** — they silently cannot receive the update, and after a rotation the *installed* cohort may not
either, until you re-sign with a compatible (v3 multi-key / service-backed) key and re-distribute.

### What the architecture must do (prevention)
Sign with the **full compatible set by default (v1 + v2 + v3)** so legacy devices are never excluded, use a
**v3 multi-key manifest (or Play App Signing / a managed signing service)** from day one so a future key
rotation is a *non-breaking* event, **test install on the lowest API you support** in CI (catch the v1-floor
silently), and *decouple your signing key from your build identity* so a rotation cannot orphan the update
channel.

### → Constraint #9
Default to v1+v2+v3 signing (never v2-only), v3 multi-key / service-backed rotation from day one, lowest-API
install test in CI, and signing-key decoupled from build identity.

---

# Problem 10 — Cloudflare Worker version rollback after a buggy deploy (traffic pinning, propagation lag)

### Failure mode
You deploy a buggy version of a Cloudflare Worker (the update endpoint, the manifest service, or the whole
front of the channel) and need to **roll back** to the last good version. The Worker **Versions** model is
designed for this — versions are uploaded independently and *deployed* (routed to traffic) separately, and a
**rollback** re-points the Worker's live traffic to an *older* version. The failure is the *gap* between
"the rollback command succeeded" and "every edge is actually serving the old version": Cloudflare is a
*global edge*, and a version switch has to *propagate* across data centers, so there is a **propagation lag**
where *some* edges serve the new (buggy) version and *others* serve the old (good) one — a *split* where the
same user, hitting different PoPs, gets different behavior. Worse, if you were doing a **gradual deployment**
with **version affinity** (the Worker's traffic-pinning that "consistently routes users to the same Worker
version"), users are *pinned to a specific version* — so some users are *stuck on the buggy version* even
after you "roll back," because their affinity still routes them to it, and *some* are stuck on the good one.
The hard part for a one-person team is that a Worker rollback is *not* an atomic global switch: it is a
*propagating, affinity-affected* transition, and during the window your update channel is serving **inconsistent
answers to "what is the latest version?"** — which is *worse* than a single bad answer, because now different
devices get different update manifests at the same time.

### Why it is hard
- Rollback is a **propagating** transition, not an atomic one: there is a window where different edges serve
  different versions (the "propagation lag").
- **Version affinity / traffic pinning** means users are *locked to a version*; a rollback does not
  automatically unpin users who were pinned to the buggy version.
- The Worker is *fronting your whole channel*: if it serves an inconsistent "latest," it *multiplies* the
  damage of every other problem (a device on the good edge sees v2, a device on the bad edge sees the buggy
  v1.5 or a malformed manifest).
- You cannot "see" the propagation from the client — a user just experiences a *random* version depending on
  their PoP, which is the hardest kind of bug to debug at 2 a.m.

### Cross-platform aggravator
- The Worker is a *shared* front for all your update surfaces (manifest, PWA, API) — so a bad Worker version
  doesn't just break one platform's update, it *correlates* update failures across *all* platforms at once,
  and the correlation is *geographic* (by PoP), not by device type.
- The Worker's version and the *app's* version are *different clocks*: rolling back the Worker does *not*
  roll back the apps already updated by the buggy Worker version — so you have a Worker that's "fixed" and a
  fleet that's still inconsistent.
- Propagation + affinity + the *app* update state = three independent "which version am I on" answers that
  can all disagree for the same user at the same time.

### 2 a.m. detection signals
- Update/manifest errors that **correlate by region/ASN** (by PoP), not by app version or platform — the
  propagation-lag signature.
- "The same user gets different behavior on different requests" (the affinity/pinning signature).
- A rollback "succeeded" but error rates decay *gradually* over minutes-to-hours instead of dropping
  instantly (the propagation signature).

### Real-world citation
**[DOC / MANDATE]** — the verifiable anchors are Cloudflare's own **Versions & deployments** semantics, which
define the propagation + affinity behavior that makes rollback non-atomic:
- **Rollbacks** — "Revert to an older version of your Worker": a rollback *re-points live traffic* to a
  previously-uploaded version; it is a *routing* change, not a global instant switch.
  <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
- **Version affinity** (the traffic-pinning) — "Consistently route users to the same Worker version during
  gradual deployments using version affinity": this is *exactly* the pinning that keeps users on a version
  after you change the deployment, and why a rollback does not automatically unpin them.
  <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/>
- **Gradual deployments** — "Incrementally deploy code changes…": the mechanism where multiple versions are
  live at once (and can be live *inconsistently* across edges during transition).
  <https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/>
- **Version URLs** — test/pin a specific version, the tool you use to *verify* the rollback target before you
  route traffic to it.
  <https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/>
Blast radius: **every device that hits the channel during the propagation window** sees a *version
inconsistent with its peers* (by PoP), and any user pinned (affinity) to the buggy version stays on it until
their affinity expires or is cleared — so the "rollback" is a *minutes-to-hours, geographically-split*
recovery, not an instant one.

### What the architecture must do (prevention)
Make the Worker a **thin, version-pinned manifest router** with a **single canonical "latest" that is
itself content-addressed and signed** (so a split edge still serves a *valid* manifest, never a malformed
one), **verify the rollback target on a Version URL before routing traffic to it**, **keep the previous good
version deployed (not just uploaded)** so a rollback is a re-point with no gap, and **treat the Worker's
version as telemetry** (emit `versionID`/`versionTag`) so you can *see* which PoP/version a failing request
hit during the propagation window.

### → Constraint #10
Worker is a thin signed-manifest router; canonical "latest" is content-addressed+signed; rollback target
pre-verified on a Version URL; previous good version stays deployed; Worker `versionID`/`versionTag` in
telemetry.

---

# Architectural constraints my unified stack must satisfy (1:1 map)

Each constraint maps to exactly one problem above. "Must-satisfy" is the property the unified release
architecture is *required* to have; "fallback / kill-switch" is the *explicit, pre-built* escape hatch for the
2 a.m. case (a one-person team cannot improvise a kill-switch at 2 a.m.).

| # | Problem | Must-satisfy property | Fallback / kill-switch (explicit) |
|---|---------|----------------------|------------------------------------|
| 1 | Partial download mid-update | Content-addressed artifacts; hash-or-refetch (no blind resume); monotonic build nonce per publish. | Server can *invalidate a build nonce*, so in-flight partials self-discard and refetch the committed hash; client never applies a file that fails its committed hash. |
| 2 | Code-signing cert expiry | Release-gate on cert validity; escrowed backup signing key; re-sign-without-rebuild; per-platform install-funnel telemetry. | A *pre-escrowed* second key (HSM/hardware) re-signs the already-built artifact and re-pushes; CI hard-fails builds within N days of cert expiry so it can't sneak past. |
| 3 | Manifest tampering / MITM | Independent cross-signing key (out-of-band); manifest host-pinning; client hash+signature verify; human-approved promotion gate. | A *signed "revoke this channel/manifest"* message (from the independent key) that clients honor to *stop* fetching; promotion is human-gated so a leaked CI token alone can't reach the live channel. |
| 4 | Delta-update corruption | Full artifact is canonical; deltas opt-in, base-hash-verified, one-step reversible. | Client keeps the *previous install* (or a ready full re-download); a delta that fails base-hash or post-apply integrity check *auto-rolls back* to the last good state, no human. |
| 5 | Staged-rollout regret | Always-on signed N-1 rollback artifact; server-issued "halt this version"; downgrade path independent of the normal update path. | One command: *publish a "halt vX" signal* + the *pre-signed N-1* so devices self-downgrade; the downgrade path works even if the bad update broke the normal updater. |
| 6 | PWA SW caching old shell | no-cache SW/manifest; versioned caches + activate-time migration; `skipWaiting`/`claim`; SW-version telemetry. | Server can *bump the cache-key + SW hash*, forcing a SW re-install + old-cache purge on next open; SW-version telemetry exposes the v1/v2 split so you can target the stragglers. |
| 7 | iOS App Store latency vs direct | App Store build is canonical; direct/overlay is a temporary, labeled, revocation-aware bridge, non-functional changes only. | The bridge is *explicitly non-production*: a hard "not a production channel" marker, an auto-fallback to the App Store build, and a revocation watcher that flips users back the instant the direct cert is revoked. |
| 8 | macOS notarization + staple | Notarize+staple as a hard CI gate for *all* macOS artifacts; ticket-revocation polling; one-command re-notarize/re-push; newest-macOS CI coverage. | Poll Apple for *ticket revocation* on shipped builds and *auto re-notarize + re-staple + re-push* (one command); newest-macOS in CI catches the policy ratchet before users do. |
| 9 | Android signing v1/v2/v3/v4 | Default v1+v2+v3 signing (never v2-only); v3 multi-key / service-backed rotation from day one; lowest-API install test in CI; signing key decoupled from build identity. | Rotation is a *pre-planned, non-breaking* v3 multi-key (or Play App Signing) event; a lowest-API install test in CI means the v1-floor cohort is never silently excluded. |
| 10 | Cloudflare Worker rollback | Worker is a thin signed-manifest router; canonical "latest" is content-addressed+signed; rollback target pre-verified on a Version URL; previous good version stays deployed; `versionID`/`versionTag` in telemetry. | Rollback is a *re-point to a still-deployed* previous version (no gap) after *pre-verifying it on a Version URL*; telemetry shows which PoP/version a failing request hit during propagation. |

## Cross-cutting invariants (the one-person-team meta-constraints)

These fall out of the ten and are non-negotiable for a single operator:

- **Every escape hatch is pre-built, not improvised.** A one-person team cannot design a kill-switch at 2 a.m.;
  constraints #3, #5, #7, #8, and #10 all require a *signed, pre-published* "stop/revert" artifact that a
  single command activates.
- **The updater must be able to fix itself.** If a bad update can break the update path (CrowdStrike,
  constraint #5), the whole stack is unrecoverable without a human; the downgrade/rollback path must be
  *independent* of the normal update path on every leg.
- **Every trust decision is content-addressed and signed.** Hash + signature (not just hash, not just
  signature) at the client, on every artifact and every manifest, on every leg — this is the single control
  that defeats #1, #3, and #4 at once.
- **Every leg reports its *actual* running version.** The PWA's SW version (#6), the Worker's `versionID`
  (#10), the Android installed signature-scheme/key (#9), and the per-platform install funnel (#2) must all
  be in one telemetry view — otherwise the v1/v2/v3 split is invisible, and an invisible split is the 2 a.m.
  you cannot debug.
- **One canonical version, five delivery legs, one truth.** The unified stack must resolve all five legs
  (Electron, Capacitor-Android, Capacitor-iOS, PWA, Worker) against *one* signed, content-addressed "latest"
  so that no leg can drift to a different reality without a *signal* (constraint #6 + #7 are where drift is
  otherwise silent).
- **No leg is the single point of failure for "what is latest."** The manifest/Worker (#10) and the store
  legs (#7) must be able to *independently* answer "what is the latest trusted version," because the Cloudflare
  Worker and the App Store can each be the *only* thing standing between a user and the truth, and each can
  be down, lagging, or revoked.

## Verification status (honest)

- **Verified against primary sources at write time:** CrowdStrike (Wikipedia), CCleaner (Wikipedia),
  SolarWinds/SUNBURST (Wikipedia), ASUS CVE-2025-59374 (NVD + CISA KEV + asus.com), CodePush/App Center
  (Microsoft App Center blog, live), electron-builder issues #8793/#9478/#5614 (GitHub), Tauri issues
  #8258/#9565/#11863 (GitHub), Cloudflare Versions/Rollbacks/Version-affinity/Version-URLs (Cloudflare docs,
  live paths).
- **Cited as mechanism/mandate (no single named outage exists, by design of the problem):** #2 (EV cert
  expiry → OS enforcement), #4 (delta corruption → patcher contract + Tauri feature-request), #6 (PWA SW →
  W3C spec), #8 (macOS notarization → Catalina 2019 mandate + Apple docs), #9 (Android signing → Android
  signature-scheme spec). These are *DOC/MANDATE*-grade: the *mechanism* is verifiable; I did not invent a
  fake outage for them.
- **[UNVERIFIED]:** the brief's "2023 1Password keychain" reference — could not be corroborated in NVD,
  1Password's CVE list, or accessible press at write time. Flagged, not used as a load-bearing citation.
- **Could not retrieve at write time:** the `@capawesome/capacitor-live-update` *issue tracker* (the GitHub
  search for `capawesome/capacitor-live-update` returned 422 — the repo is not searchable at that exact
  path; it may have moved/been archived). The *package* is cited (npm) and is real; the specific issue
  numbers were not pulled and are therefore **not** asserted.

*End of catalog.*

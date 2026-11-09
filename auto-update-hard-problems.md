# The Hardest Problems in Cross-Platform Auto-Update

**A survey of the ten failure modes that actually take apps down, with real postmortem citations.**

Every "auto-update" system is a distributed-systems problem wearing a GUI costume. The
engine (electron-updater, Squirrel, Tauri, Sparkle, the Play App-Update API, a Cloudflare
Worker relay, or a PWA service worker) is just the transport. The hard part is that the
update path is a *second, silent, unattended* attack surface and a *second, unattended*
crash surface, running on a machine the developer does not control, over a network the
developer does not control, at a moment the user is not watching. This document catalogs
the ten problems that produce the most real outages, explains what each engine actually
does today about that specific failure, and cites a named, dated incident for each.

Conventions used throughout:
- **"The engine"** refers to the concrete updater library/protocol named in the heading.
- Each problem has a *behavior* section (what each engine family actually does today),
  a *citation* (one real, dated incident with a URL), and a *takeaway*.
- Honesty note: where an engine's exact behavior is version-dependent or where I am
  uncertain about a specific API, I say so explicitly rather than hand-wave.

---

## Engine legend (cross-reference map)

| Family | Where it lives | Update model | Signature primitive | Delta support | Staging artifact |
|---|---|---|---|---|---|
| **electron-updater** | Electron (VS Code, Slack, Discord, Notion, Linear) | Full or **blockmap** differential re-download, swap-on-restart | Code-sign + `latest*.yml` manifest (historically weak manifest verification) | **Blockmap** (re-fetch changed blocks), *not* binary patch | `pending-app-update` JSON + download-to-temp, verify `sha512`, then move |
| **Squirrel** (Squirrel.Windows / Squirrel.Mac) | VS Code, Slack, Teams, many .NET/C# desktop apps | `Update.exe` separate process; **hardlink tree** delta (only changed files copied) | Per-file release hash in the feed (`.nupkg`/zip hash) | **Hardlink/hardcopy** delta (fast, atomic-ish), not binary patch | `Update.exe` staging dir + `pending.xml`/version markers; old version stays until new verified |
| **Tauri** (`tauri-plugin-updater`) | Rust + system webview (Tauri v1/v2) | Download bundle (`.app.tar.gz` / `.msi` / `.AppImage` / `.deb`) | **Ed25519** signature of the manifest, public key baked at compile time | None (full bundle) | Download-to-temp, verify sig, replace on restart |
| **Sparkle** | macOS/Cocoa (thousands of Mac apps) | `appcast.xml` feed; full zip or **zlib delta** | **Ed25519** (`sparkle:edSignature`) of the zip; legacy DSA | **Delta updates** (`sparkle:deltaURL`/`deltaHash`), falls back to full | Download `.download` temp, verify `sha256` + ed-sig, then install |
| **Play App-Update API / APK schemes** | Android | v1 (JAR) / v2 / v3 / v4 APK Signature Schemes | v1 = JAR (per-file), v2/v3 = whole-zapk hash, v4 = incremental sidecar | v4 = **incremental** install | APK / split-APK; in-place swap |
| **Cloudflare Worker (relay)** | Any update backend that fronts the manifest on Workers | n/a — it is the *transport*, not the updater | n/a (TLS + origin) | n/a | n/a |
| **PWA service worker** | Any PWA | Precached shell (`index.html` + assets), SW-mediated fetch | n/a (integrity via hash if used) | n/a | SW cache (Cache Storage), old shell lingers |

The recurring structural weakness across all of them: **the moment between "new bytes
on disk" and "verified bytes in use"** is where corruption, rollback, and tampering live.

---

## 1. Partial-download mid-update

**The failure:** the network dies, the user force-quits, the laptop sleeps, or the disk
fills up *between* "new bytes started arriving" and "new bytes fully verified and swapped
in." On next launch the app is corrupt — half the old version, half the new, or a truncated
download that the updater will try to execute. This is the single most common field bug in
desktop auto-update and the reason every serious engine has a staging phase.

**What each engine actually does:**

- **electron-updater** (Electron). The download goes to a temp file, not into the running
  app bundle. It validates the download against the `sha512` values in the `latest*.yml`
  manifest and, when a `.blockmap` file is present, against the **blockmap** — a per-block
  hash list `electron-builder` emits. A blockmap means only *changed* blocks are fetched,
  so a mid-stream drop costs one block's worth of re-transfer, not the whole payload. The
  downloaded file is only *moved into place* after `quitAndInstall()` (the engine writes a
  `pending-app-update` marker so a restart completes the swap). A killed or dropped download
  therefore leaves the *old, still-good* app untouched; the partial is discarded on the next
  check. The structural guarantee: **verify-before-swap**. The real risk is the *swap itself*
  being interrupted (the file move), which is a much smaller window than the download.
- **Squirrel (Squirrel.Windows / Squirrel.Mac).** Squirrel is the most resilient of the
  desktop engines here, and it is deliberately so: the update is driven by a **separate
  `Update.exe` process**, not the app itself. So force-quitting the app does not stop the
  update, and a crashed update does not corrupt the running app. New versions are staged into
  a sibling version folder using **hardlinks** — unchanged files are hardlinked into the new
  tree instead of re-copied, which makes the "install" step fast *and* means the old version
  folder stays byte-for-byte intact until the new one is fully staged and hash-verified. If
  the machine loses power mid-staging, the next `Update.exe --checkForUpdate` run reconciles:
  it sees the old version still valid and re-stages. The documented failure mode is not
  corruption but **`Update.exe` being killed by AV or a hung staging lock**, leaving a stale
  `pending` marker (the "app says it's updating forever" bug).
- **Tauri (`tauri-plugin-updater`).** The updater fetches the versioned bundle (`.app.tar.gz`
  on macOS, `.msi`/NSIS on Windows, `.AppImage`/`.deb` on Linux) to a temp path, verifies the
  **Ed25519** signature of the release manifest against the public key baked in at compile
  time, and only then replaces the install on restart. A dropped download leaves the temp
  file; the *running* app is never touched because Tauri does not overwrite in place. Be
  precise here: the Tauri updater is full-bundle oriented (no binary delta), so "resumable"
  in the HTTP-Range sense is *not* its core guarantee — its guarantee is *signature +
  temp-then-swap*, not mid-stream resume. (Whether a given Tauri version issues `Range`
  headers is version- and backend-dependent; treat resume as a transport concern, not a
  Tauri guarantee.)
- **Sparkle (macOS).** Downloads to a `<bundle>.download` temp, verifies `sha256` (and the
  `sparkle:edSignature` for ed-key apps) before it is allowed to unzip into the live bundle.
  An interrupted download is simply re-fetched; the live app is not replaced until the full
  zip is on disk *and* verified. Sparkle also supports **delta updates** (`sparkle:deltaURL`
  + `sparkle:deltaHash`) that download a zlib diff against the installed version and *fall
  back to a full download* if the delta fails to apply — which is exactly the right design
  for problem 4 below.

**Why this is "hard" rather than "solved":** every engine above solves the *download* half
with verify-before-swap. The residual risk is the *swap/apply* half and the **recovery logic**
after an abnormal exit: does the engine detect a half-applied state and self-heal, or does it
assume "if the marker says updated, it's updated"? Engines that conflate "marker written"
with "apply completed" are the ones that brick.

**Citation — the documented partial/corrupt-update class:** the clearest *named* field
incident in this exact failure class is the **Squirrel.Windows** failure mode tracked in the
project's issue tracker, where an interrupted or AV-killed `Update.exe` staging run left
deployed apps in a non-recovering "pending update" state and required a manual reinstall —
documented in the Squirrel GitHub issues for the Windows auto-updater (the long-running
"Update.exe failed / app stuck on updating" threads on the `Squirrel/Squirrel.Windows` issue
tracker). Squirrel's own hardlink design is the *mitigation*; the residual bug is the stale
pending marker when `Update.exe` is terminated mid-staging. *(Honesty note: this is a documented
failure *class* in the Squirrel tracker rather than one dated postmortem; it is referenced by the
tracker as a source class.)*

**Takeaway:** verify-before-swap is table stakes and every serious engine has it. The real
differentiator is **self-healing after an interrupted *apply*** — Squirrel's separate-process
+ hardlink model and Sparkle's delta-with-full-fallback are the two best-in-class; blockmap
electron-updater is good on the download side but its swap window is the soft spot. Tauri's
protection is signature + temp-then-swap, and you should not assume HTTP-level resume.


---

## 2. Code-signing cert expiry / revocation

**The failure:** the cert you sign updates with either (a) **expires mid-deployment** so CI can no
longer sign a new build, or (b) is **revoked/distrusted by the CA or the trust store** so
*already-installed* apps suddenly fail the OS's signature check on next launch or next update.
These are two different disasters: (a) is an operational outflow (you can't ship), (b) is an
install-base brick (your users can't launch).

**What each engine actually does — and the key architectural split:**

There are two fundamentally different trust models in the wild, and they fail differently:

- **CA-chain model (code-signing certificate).** The binary is signed by a certificate issued
  by a CA (DigiCert/Entrust/Sectigo/etc.), and the OS (Windows SmartScreen, macOS
  Gatekeeper) walks the chain up to a trusted root. **Every engine needs this layer for the
  *OS to launch the app at all*** — electron-updater, Squirrel, Tauri, and Sparkle all ship
  binaries that are code-signed with a Developer ID / OV/EV cert regardless of how the *update
  payload* is verified. If that cert expires, `electron-builder`/`codesign`/`signtool` in your
  CI fail and **you cannot publish the next update**. If the cert is *revoked* or its root is
  *distrusted*, Gatekeeper/SmartScreen can refuse the *already-installed* app or refuse the new
  signed binary. This is the layer the Symantec distrust (below) hit.
- **Self-held-key model (Ed25519/EdDSA over the update payload).** **Sparkle** (`sparkle:edSignature`)
  and **Tauri** (Ed25519 update-manifest signature) verify the *update* against a **public key
  you generated and ship inside the app**, not against a CA chain. This is *immune to CA
  distrust and CA revocation* for update-integrity purposes: a Symantec root being pulled does
  not break Sparkle's or Tauri's update verification, because they never looked at a CA chain for
  the update. **The catch:** the OS-level Developer ID code-sign cert is *still required* for
  Gatekeeper to open the app, so a CA revocation still hurts you at the *launch* layer even when
  it doesn't hurt the *update-signature* layer. The two layers are independent, and conflating
  them is a common mistake.

**Practical exposure:** in the CA-chain model, cert expiry is a **calendar problem with a
multi-week blast radius** (you must renew months ahead; a lapsed EV cert means *no signed
releases* for however long procurement takes). In the self-held-key model, the analogous risk is
**losing your Ed25519 private key** — if you lose the key you signed every past release with,
you can no longer sign a *valid* update for the installed base (you'd have to ship a new app with
a new key, and old installs will reject new updates unless you built in key-rotation). That is
arguably worse than a cert expiry because it's unrecoverable without user re-install.

**Citation — the 2017-2018 code-signing trust upheaval:** this is the best-documented real-world
instance of the *revocation/distrust* side, and it was a two-part event:
1. **CA/Browser Forum ballot SC48** mandated that **Extended Validation (EV)** code-signing
   certificates become required (browsers began refusing non-EV code-signing certs on a phased
   2017→2018→2019 schedule), which forced nearly every vendor to re-procure and re-ship with EV
   certs — a massive, deadline-driven re-signing churn.
2. **Google's announced distrust of Symantec (then being split into DigiCert) code-signing roots**
   (publicly announced **September 2017**) culminated in **2018-2019 browser root removals**:
   major browsers (Chrome, Firefox, Edge, Safari) shipped patches refusing code-signing
   certificates issued by specific Symantec roots (e.g. "VeriSign Class 3 Public Primary
   Certification Authority – G5", "Symantec Class 3 Secure Server CA – G3" and related
Thawte/GeoTrust roots). Any app whose *chain* passed through a distrusted root lost OS/browser
trust — the installed base broke, not just the publisher's ability to ship. This is exactly
the "installed apps fail signature checks after the CA layer changes" scenario. *(Sources:
CA/Browser Forum **ballot SC48** (the EV code-signing mandate) and **Google's public "distrust of
Symantec" announcement (Sept 2017)** followed by the 2018-2019 browser root-removal patch notes;
exact per-root dates and per-browser patch versions vary and should be pulled from those primary
sources for a specific root.)*

**Takeaway:** if your engine's update integrity rides on a **CA chain** (electron-updater's
default posture, Squirrel's feed-hash-over-HTTPS), a CA revocation is a *user-facing brick*.
If it rides on a **self-held Ed25519/EdDSA key** (Sparkle, Tauri), you're insulated from CA
events at the *update* layer — but you've traded a renewable cert for an **irrevocable private
key** you must back up, and you still need a valid code-sign cert for the OS to launch the app.
Design for both layers explicitly.


---

## 3. Manifest tampering

**The failure:** an attacker modifies the update manifest in flight or on the server — flips the
version number, repoints the download URL to a malicious binary, or edits the hash to match their
payload. The question every engine must answer: *do I verify the manifest itself, or do I only
verify the payload against a manifest I blindly trust?*

**What each engine actually does — this is where the engines genuinely diverge:**

- **Sparkle (gold standard).** The `appcast.xml` feed and each release carry a **`sparkle:edSignature`**
  — an **Ed25519** signature over the release's zip. The app ships the corresponding public key.
  A tampered appcast (changed URL, changed `sha256`, changed version) **fails the ed-signature and
  Sparkle refuses to install.** This is a *signed-manifest* design in the true sense: the manifest
  and the payload are both bound to a key the attacker does not have. (The legacy `sparkle:dsaSignature`
  used DSA and is the weak legacy mode — you should be on Ed.) Sparkle is the reference for "the
  engine catches manifest tampering."
- **Tauri (also signed-manifest).** The update manifest is **Ed25519-signed**; the public key is
  embedded at compile time. A manifest served from a *compromised or MITM'd origin* that points at a
  malicious bundle will **fail the Ed25519 check and the install is rejected.** Same class of
  protection as Sparkle: even if the attacker controls the network path to the manifest, they cannot
  forge the signature.
- **electron-updater (hash-of-file, manifest-trusted — the weak class).** electron-updater verifies
  the *downloaded file's* `sha512` against the value in `latest*.yml` (and the blockmap). **But the
  manifest is not cryptographically signed by default** — the engine trusts that the `latest.yml` it
  fetched is the one you published. So the defense is **HTTPS + a manifest origin you fully control
  (not a mutable CDN, not a shared bucket you don't sign)**. If an attacker compromises or MITMs the
  origin, they can rewrite *both* the URL and the `sha512` consistently, and the check passes. This
  class of weakness has been flagged repeatedly in Electron security audits and is the reason
  electron-updater added/expanded manifest-signing guidance over time. **electron-updater catches a
  *corrupted* manifest; it does not, out of the box, catch a *forged* manifest.**
- **Squirrel (feed-hash, manifest-trusted — same weak class).** Squirrel verifies the downloaded
  release against a per-release hash in the feed, over HTTPS. Like electron-updater, the *feed* is
  trusted, not signed. A tampered feed that's consistently edited defeats the hash check. (There is
  no per-release Ed25519 signature over the feed in the default Squirrel design.)
- **Cloudflare Worker as relay (compounds it).** If a Worker fronts the manifest, the Worker's
  source control + deploy pipeline + origin are now part of the trust boundary. A compromised
  Worker can return a malicious manifest to *every* engine above — including Sparkle/Tauri, because
  the attacker is serving a *correctly-... no, an* unsigned/forged manifest: Sparkle/Tauri would still
  **reject** it (signature mismatch), but electron-updater/Squirrel would **accept** it. The Worker
  is a force-multiplier for manifest tampering against the weak class.

**The deep insight (the thing the CCleaner/SolarWinds incidents teach):** even the *signed-manifest*
engines only protect against an attacker who **does not hold the signing key.** If the attacker
compromises the *signing key* or the *build pipeline that holds it*, they can produce a
**validly-signed malicious update**, and Sparkle's/Tauri's Ed25519 will happily accept it —
because the signature is genuinely valid. That is the regime the two canonical incidents live in:

**Citation — CCleaner 2017 (signed-binary trust abuse):** in **September 2017**, it was disclosed
that **CCleaner v5.33** (Piriform/Avast) had, over the preceding several weeks, been shipping in
the **normal update channel** a build carrying the **Floxif** backdoor — a trojan that opened remote
access to **~2.27 million machines** that had installed it. The malicious build was **properly
signed by Avast's own legitimate code-signing key**, because the attacker got the malicious code
into Avast's **build process** (the build pipeline was the compromise point) — so every
signature-based trust check in the update pipeline *passed*: the signature was valid, the channel
was trusted, the payload was malware. On a smaller **40-machine** subset the backdoor delivered a
second-stage **espionage payload targeting technology companies** (Samsung, Sony, Asus, Intel,
VMware, O2, Singtel, Gauselmann, Dyn, Chunghwa, Fujitsu). Piriform shipped a clean **CCleaner 5.34
on 13 September 2017**; the incident was independently confirmed by Cisco **Talos** and **Reuters**
(18 Sept 2017) and later attributed in the U.S. **DNI/CIA "Foreign Economic Espionage in
Cyberspace"** report (July 2018). This is the definitive demonstration that **a valid signature is
not a defense against a compromised build pipeline**, and it is exactly the threat that a
*self-held, HSM-backed, never-exported* update-signing key (the Sparkle/Tauri model, run
correctly) is designed to prevent — and that a CA-issued cert (the electron-updater/Squirrel model)
does not, because the CA-issued key sits in CI and the build pipeline is a standing target.
*(Sources: The Verge, 18 Sept 2017; Talos Intelligence, 18 Sept 2017; Reuters, 18 Sept 2017;
DNI/CIA report, 24 July 2018.)*

**Cross-reference:** the same "compromised build pipeline ships a validly-signed update" mechanism
is what powered **SolarWinds Orion / SUNBURST (disclosed 13 December 2020)**, where the update
channel itself was the delivery vector for ~18,000 organizations. CCleaner is the *key-compromise*
variant; SolarWinds is the *build-server-compromise* variant. Both defeat signature checks because
the signature was produced by the victim's own, compromised infrastructure.

**Takeaway:** "Does the engine catch manifest tampering?" has a *two-level* answer. (1) Against a
*network-level* tamperer (no key), **Sparkle and Tauri catch it** via Ed25519; **electron-updater
and Squirrel do not** out of the box — they rely on HTTPS + a fully-trusted manifest origin. (2)
Against a *key/pipeline* tamperer, **no engine catches it** — that is the CCleaner/SolarWinds
regime, and the only real mitigation is key hygiene (HSM/never-exported keys, build-pipeline
isolation, reproducible builds, and out-of-band release attestation), not the updater library.


---

## 4. Delta-update corruption

**The failure:** you ship a *binary delta* (a patch that turns "installed bytes" into "new bytes"
rather than a full payload), and the patch either (a) is computed against an "old" version that
**doesn't exactly match** what's actually on the device, or (b) has a bug in the patcher/applier,
and the result is a **corrupt binary** that the engine then tries to launch. Full download is the
obvious fallback — the question is whether the engine *detects* the bad patch and *automatically*
falls back, or silently installs garbage.

**The three delta families, and how safe each is:**

- **bsdiff / bspatch** (the classic BSD binary-diff, used by countless projects). `bsdiff`
  produces a patch `A → B`; `bspatch` applies it. **bsdiff has no built-in verification** — the
  patcher trusts that the on-disk file is *exactly* the `A` the delta was built from. If the
  device is on `A'` (a patched, partially-updated, or locale/region-variant file), `bspatch`
  either **fails loudly** (good) or, worse, **produces garbage that "succeeds"** (bad). The
  safety is entirely on the *applier* to (1) confirm the "old" file's hash matches the delta's
  baseline and (2) verify the *result* hash after patching, with **full-download fallback** on
  any mismatch. Engines that ship raw bsdiff without (1)+(2) are the ones that corrupt silently.
- **Courgette** (Chromium's Windows delta-updater patch format). Chromium's `components/update`
  uses **Courgette** to ship smaller delta updates on Windows. Courgette's design is that the
  delta encodes the transformation and the applier reconstructs the target; Chromium's updater is
  expected to **verify the patched result and, on failure, fall back to a full download**. This
  is exactly where bugs bite: a defect in Courgette's patch generation or application, or a
  mismatch between the delta's assumed baseline and the installed build, yields a corrupt binary.
   Chromium's bug tracker (crbug.com) and security research (Project Zero) contain documented
   delta-updater / Courgette defects of precisely this class. *(Referenced by the tracker as a
   source class; a specific crbug number is not asserted here.)*
- **zsync** (rsync-based, *resumable* and *checksummed*). zsync is structurally safer than raw
  bsdiff/Courgette because its `.zsync` control file carries a **strong checksum of the final
  file** (MD5/SHA). After reconstructing the file, zsync **verifies the whole-file checksum** and
  rejects on mismatch — so a corrupt reconstruction is *detected by the tool itself*, not left to
  the app. The trade-off: zsync is a *file-level* delta (great for re-fetching a changed blob),
  not a *running-binary* patch, so it doesn't have the "patch the live app in place" complexity
  that Courgette/bsdiff do.
- **Sparkle (zlib delta, *correct* fallback).** Sparkle's `sparkle:deltaUpdates` downloads a
  zlib-compressed diff against the installed version (`sparkle:deltaURL` + `sparkle:deltaHash`).
  Sparkle applies the delta, **verifies the result, and falls back to a full download if the
  delta does not apply cleanly.** This is the reference "delta-with-full-fallback" behavior and
  the model other engines should copy: *optimistically try the small delta, but never trust it
  without a post-apply check and a guaranteed full-path escape hatch.*
- **electron-updater (blockmap — a *different* kind of "delta").** electron-updater's
  "differential" is the **blockmap**: it re-downloads only the *changed blocks* of the file and
  reassembles the full file, then verifies the whole-file `sha512`. This is *not* a binary patch —
  it's a partial *re-fetch* of the complete payload — so it **cannot produce a binary-corrupt
  result the way bsdiff/Courgette can**; a bad block just fails the final hash and triggers a full
  re-download. Blockmap is therefore *safer than true binary delta* at the cost of less savings.

**The engineering rule:** a delta update is only as safe as **(a)** the guarantee that the
"old" baseline on the device *exactly* matches the delta's source, and **(b)** a **post-apply
verification with automatic full-download fallback**. Engines with both (Sparkle, zsync,
electron-updater's blockmap) are safe; engines that apply a raw bsdiff/Courgette patch and then
*assume* success are the ones that ship a corrupt binary and then "update failed, app won't open."

**Citation — Chromium Courgette / delta-updater defects:** the most on-point real citations live in
the **Chromium bug tracker (crbug.com)** and Chromium's delta-updater code
(`components/update`, `third_party/courgette`), where **patch-application / delta-generation bugs
that could leave a bad patched result** have been filed and fixed. The class of bug: a delta that,
applied against the installed build, produced an incorrect or non-launchable binary, caught only
because the updater's result-verification + full-download fallback fired — which is *precisely*
the fallback that the unsafe engines (raw bsdiff without check) lack. *(Honesty note: this is
referenced by the Chromium bug tracker (crbug.com) and the delta-updater/Courgette code as a
source class; a single specific crbug number is not asserted here. The durable takeaway is the
mitigation Chromium relies on — **verify-then-fallback-to-full** — which is the property the
unsafe engines lack.)*

**Takeaway:** if you want a small payload, prefer **a file-level, self-verifying delta (zsync,
blockmap, or Sparkle's zlib-delta-with-full-fallback)** over a **running-binary patch (raw
bsdiff/Courgette)**. The differentiator is never "does it save bytes" — it's **"does it verify the
result and have a guaranteed full-download escape hatch?"** Sparkle's delta-fallback and
electron-updater's blockmap are the two safe patterns; raw bsdiff/Courgette without a post-apply
check is how you turn a 3 MB delta into a fleet of bricked installs.


---

## 5. Staged-rollout regret

**The failure:** you push a release to 5% of the fleet, telemetry shows a 2% crash-rate regression,
but there is **no kill switch** — you can stop *new* devices from taking the update, but the 5%
that already did are now stuck on a broken version with no automatic path back. At 1M devices,
"5%" is 50,000 bricked clients. The hard realization: **an auto-update is not reversible the way
a web deploy is.** You cannot "redeploy the last good version" to a client that already installed
the bad one — you can only ship a *newer* version that undoes the change, and hope they can still
launch enough to receive it.

**What the engines can and can't do:**

- **electron-updater / Squirrel (app-level, mostly "forward-only").** These engines support
  **gating** — you serve different `latest*.yml`/feed content to a percentage of clients (typically
  done server-side: the update endpoint reads a device id and returns v2.3.0 to 5%, v2.2.9 to the
  rest). That's the *staged* part. But the **kill switch is only half-real**: you can *stop
  offering* the bad version to the remaining 95%, and you can *stop* the 5% from auto-installing
  pending updates. You **cannot un-install** v2.3.0 from the 5% that already ran the installer.
  Recovery = ship **v2.3.1** that reverts the regression. If v2.3.0 crashes *before* it can
  check for updates (a crash-on-launch regression), the 5% are stuck until they can manually
  reinstall — the classic "update failed, app won't open, no kill switch" trap.
- **Windows 10 (WaaS ring rollout — the real "staged rollout with a pause").** Windows uses
  **Update Rings** (Fast, Slow, and broader rings; internally A/B/C/D) to stage feature updates.
  Crucially, Windows **can *pause* a feature-update rollout** when failure rates spike — that is
  the kill switch, and it *works for the not-yet-updated majority*. But it has the same
  **irreversibility** problem: a device that already applied the bad feature update is not
  auto-reverted; it gets a newer updated build later, or a manual recovery. So even Microsoft's
  best-in-class staged rollout has the "regret" gap: **pause stops the bleed; it doesn't heal the
  already-wounded.**
- **Android (Play staged rollout + Play App-Update API).** Play supports **staged rollouts**
  (roll out to X% over N days with monitoring) and the **Play App-Update API** (flexible/immediate
  updates). Play can **pause or roll back a rollout** server-side (stop serving the new APK). Again,
  the rolled-back portion is the *not-yet-updated* devices; devices that already installed the bad
  flexible update get a corrective update, not an auto-rollback.
- **The structural point:** *every* staged-rollout system's "kill switch" only controls the
  **forward edge** (who gets the update next). None of them time-travel a device that already
  installed the bad build. The only true "kill switch + heal" requires: (1) a forward-only version
  you can push instantly (v+1 that reverts), and (2) confidence the bad build can still *receive*
  that push. A crash-on-launch or update-loop regression defeats (2) — that's the 1M-device
  catastrophe.

**Citation — the Windows 10 staged-rollout that had to be pulled (verified):** the clearest,
fully-documented instance is the **Windows 10 version 1809 (October 2018 Update) pull on
6 October 2018**. Microsoft **pulled the 1809 build from distribution** after isolated reports that
the update process was **deleting user files**; on **9 October 2018** it was re-released to the
Windows Insider channel with Microsoft citing a **bug in OneDrive's "Known Folder Redirection"**
function as the root cause; on **13 November 2018** Microsoft **resumed the rollout to a small
percentage of users** — i.e., the staged-rollout "ring" mechanism re-engaging after the regression.
This is the textbook "staged rollout → elevated failure rate → pull the not-yet-updated majority →
ship a corrected build → resume at a small percentage" sequence, and it exposes the irreversibility
gap: devices that *had* already gone through the bad 1809 pass (with files deleted) were not
auto-reverted; file recovery was the user's problem, and the rollout simply stopped spreading. The
same "pause/pull a staged feature update" pattern shows up at least twice more, both verified in
Windows 10's release history: **version 1511 (November 2015) was temporarily pulled on
21 November 2015** (a bug reset privacy/data-collection settings; re-instated 24 Nov), and
**version 1803 (April 2018) was delayed from 10 April because of a bug that could trigger a
BSOD**. And the **1903 (May 2019)** rollout was *deliberately* slowed, with Microsoft explicitly
citing "new practices introduced after the problems affecting the 1809 update." *(Source:
Wikipedia, "Windows 10 version history," per-version release/rollback entries for 1511/1803/1809/1903;
the MobileIron and Facebook-for-Android beta-rollout regressions are the mobile-side analogues of
the same "staged rollout with no reverse." )*

**Takeaway:** design your rollout around the assumption that **forward-only is the only direction
you have.** The two capabilities that actually limit blast radius are: (1) **server-side percentage
gating with live telemetry** so you see the 2% crash rate at 5%, not 100%, and (2) a **pre-baked
"next version that reverts" you can push within minutes** of a regression — with the explicit
test that the bad build can still *receive* that push (i.e., it doesn't crash before it checks for
updates). A kill switch that only stops the forward edge is a **band-aid, not a kill switch.**


---

## 6. PWA service worker caching the old shell

**The failure:** you deploy a new `index.html` + new assets, but the client's **service worker
keeps serving the precached old shell.** The new code is on the server, the old code is what the
user sees, and "refresh" doesn't help because the SW intercepts the fetch and answers from cache.
This is the most common "my PWA won't update" complaint in existence, and it has *five* distinct
race/mechanism roots that each need a different fix.

**The mechanism (why it happens) — the five races:**

1. **Precached shell with same-URL-different-content.** The app shell's `index.html` is almost
   always a *stable URL* (`/index.html` or `/`) whose *contents change* every deploy. If the SW
   caches it **cache-first / precached-as-immutable** (the Workbox `precacheAndRoute` default for
   the app shell), the old `index.html` is served forever from Cache Storage until the SW itself
   is replaced and re-precaches. **The entry document must be treated as network-first or
   revisioned, never as an immutable precache.**
2. **`skipWaiting()` without `clients.claim()` / a reload.** When the SW script's *bytes* change,
   the new SW installs and sits in the **"waiting"** state while the old SW still *controls* the
   open pages. Calling `skipWaiting()` lets the new SW activate, but **the currently-open tab keeps
   running under the old SW until it is re-claimed or reloaded.** If you `skipWaiting()` but never
   `clients.claim()` and never post a message telling the page to `location.reload()`, the user
   sees the old shell until a *manual* reload — the "it updated in the console but the UI is still
   old" symptom.
3. **The `controllerchange` ordering trap.** A common pattern is "listen for `controllerchange`
   on `navigator.serviceWorker`, then reload." But `controllerchange` **only fires if the new SW
   actually took control of this client** — which requires `skipWaiting()` *and* `clients.claim()`.
   Skip either, and the event never fires, and the page never reloads. Apps that only listen for
   `controllerchange` and don't force the takeover silently never update.
4. **Cross-tab fan-out.** With N tabs open, each tab has its own control/claim relationship to the
   SW. A new SW activating does not uniformly update all N tabs: some may be re-claimed, some may
   keep the old controller, and the **shared Cache Storage is mutated while multiple tabs are
   reading it** — producing a race where tab A is on the new shell, tab B is on the old shell, and
   a third tab gets a torn read of half-new/half-old assets. The "update fans out unevenly across
   my tabs" bug.
5. **Asset-hash vs. shell mismatch.** Hashed asset filenames (`app.3f2a1.js`) make *assets*
   cache-safe (new hash = new URL = fresh fetch), which is why devs precache them confidently — but
   that's *precisely* why the *shell* (the un-hashed `index.html` that *references* those hashed
   assets) becomes the single point of staleness: the old `index.html` references *old* hashes, so
   even when new assets are available, the cached old shell never points at them.

**What the right stack does:**
- Treat the **shell as network-first / versioned** (or short-TTL `stale-while-revalidate`), and
  **assets as hashed + precached-immutable.**
- On SW `install`, **`skipWaiting()`**; on `activate`, **`clients.claim()`** and **clean the old
  precache** (delete cache names that aren't the current revision).
- Post a **`window.postMessage` / BroadcastChannel** to all clients on `controllerchange` so *every*
  tab reloads in coordination (this is the fix for the cross-tab fan-out).
- This is essentially what **Workbox's** `generateSW`/`injectManifest` + the documented
  "app update" recipe (`skipWaiting` + `clientsClaim` + a `message` to reload) implement; the bugs
  above are what you get when you adopt *half* of that recipe.

**Citation — the canonical "won't update" references:** the mechanism and its failure modes are
authoritatively documented in **MDN's "Service worker update lifecycle"** page (findable via MDN
search under the Service Worker API / Using Service Workers section), which explicitly lays out the
**installing → waiting → activating → active / controlling** state machine, the
**`skipWaiting()` / `clients.claim()`** takeover requirement, and the classic mistake that the
*current page keeps the old SW until it's re-claimed/reloaded* — the exact root of "new index.html
on the server, old shell in the browser." This is corroborated in the wild by the **Workbox GitHub
issues** on **precached app-shell staleness / `skipWaiting` races** (the long-running "precache not
updating" / "stale index.html after deploy" threads in the `GoogleChrome/workbox` issue tracker) and
by the high-vote **"my PWA won't update / service worker serving old version" StackOverflow
threads**, where the accepted fixes are uniformly: make the shell network-first, add
`skipWaiting`+`clientsClaim`, and broadcast a reload to all tabs. *(Honesty note: the specific
Workbox issue numbers and the highest-vote StackOverflow URL are referenced by source class rather
than a single pinned number; the mechanism citation is the MDN doc, which is authoritative.)*

**Takeaway:** the PWA "won't update" bug is *not one bug* — it's **five interacting races** (shell
precache, skipWaiting/claim gap, controllerchange ordering, cross-tab fan-out, hash-vs-shell
mismatch), and they compound: fix one and the others still bite. The working recipe is a *set*,
not a line: **network-first shell + hashed assets + `skipWaiting` + `clients.claim` + cache-cleanup
on activate + a coordinated cross-tab reload message.** Adopt the whole set (Workbox's app-update
recipe does) and the bug largely vanishes; adopt it piecemeal and you'll chase the next race.


---

## 7. iOS App Store vs enterprise distribution

**The failure, two flavors:** (a) Apple **rejects the app** because it ships *dynamic code* — a
remote JavaScript bundle that effectively delivers *new app functionality*, which violates App Store
Review Guidelines (3.3.1 "downloadable executable code," 4.2 "Minimum Functionality"); or (b) the
app is distributed via the **Apple Developer Enterprise Program** and Apple **revokes that
enterprise certificate**, which *instantly kills every app signed with it* for *every* user — no
update, no warning, the app stops launching.

**The platform reality (why iOS is the hardest platform for "auto-update"):**

- **The App Store forbids dynamic native code and most dynamic *logic*.** You cannot download and
  run new native binaries, and you cannot ship a JS bundle that materially changes what the app *does*
  (that's a "new app" that should have gone through review). What you *can* do is narrower than most
  devs assume: update **resources** (images, strings, feature-flags, config), run a **webview that
  loads remote HTML/JS** (a legitimate pattern — e.g., a settings/help screen, or a "wrapper" app —
  but a *thin wrapper around a website* is itself rejectable under 4.2), and ship **OTA updates to a
  React Native / RN-hybrid JS layer** — which is a *gray zone* that Apple has actively policed. The
  practical result: **true binary auto-update on iOS basically does not exist**; "update" means
  *the user taps "Update" in the App Store*, or (in the hybrid case) a remote JS bundle that must stay
  inside Apple's rules or risk rejection.
- **Enterprise distribution is the escape hatch — and the trap.** The **Apple Developer Enterprise
  Program** (a $299/yr program *intended only for internal employee use*) lets a company sign apps
  and push them to its own devices *outside* the App Store. Two ways this breaks:
  - **Abuse → revocation.** If an org (or a third-party "distribution service") uses an enterprise
    cert to ship apps to the *public* (not just employees), Apple **revokes the cert.** Revocation is
    **fleet-wide and immediate**: every device running any app signed by that cert loses the ability
    to launch them. There is no per-app rollback; the only fix is *re-signing with a valid cert and
    re-distributing*, which the users must install manually. This is the single highest-blast-radius
    "update" failure on iOS: one revocation = an entire distribution channel, dead.
  - **Build-supply-chain contamination.** Even a *legitimate* build toolchain can be poisoned, which
    is what **XcodeGhost** demonstrated (below): the *compiler toolchain* was the attack surface, and
    every app *built* with the tampered tool inherited the implant — regardless of how the app was
    later signed or distributed.

**Citation — XcodeGhost (2015):** in **September 2015** (with the trojanized Xcode suspected to
have been circulating since **March 2015**), modified builds of Apple's **Xcode** IDE — obtained
from **tampered copies on Chinese file-hosting/mirror sites** (e.g. Baidu Yun; *not* the official
Mac App Store build) because of slow downloads from Apple servers — were found to be a **compiler
backdoor** that injected malicious code into **any app compiled with them.** The implant (the
**"XcodeGhost"** malware family, plus a later **"XcodeGhost S"** variant) stole device identifiers,
read/wrote the clipboard, hijacked inter-app URLs, and beaconed to attacker C2 servers
(e.g. `init.crash-analytics.com`). **Alibaba's security researchers first identified and publicly
reported it** (16-17 Sept 2015), with **Palo Alto Networks** and **FireEye** publishing detailed
analyses; **Apple** acknowledged it on **18 September 2015**. Blast radius was far larger than
Apple's initial acknowledgment: **Pangu Team counted 3,418 infected apps** and **FireEye reported
4,000+**, including globally-popular titles such as **WeChat**, CamScanner, and WinZip — and the
**XcodeGhost S** variant later reached **200+ U.S. enterprises** (FireEye, Nov 2015). The lesson
for auto-update: **the integrity of your *build toolchain* is part of your update-integrity story**
— a poisoned Xcode poisons every release you cut from it, and no downstream signature check on the
*distribution* side catches it because each individual app is still *correctly signed*; the *code
inside* is what's malicious. *(Sources: Palo Alto Networks blog, 17-21 Sept 2015; FireEye,
Sept & Nov 2015; Ars Technica, 21 Sept 2015; BBC, 21 Sept 2015; Apple "XcodeGhost" FAQ and
"Validating Your Version of Xcode," Sept 2015.)*

**Cross-reference (the enterprise-revocation regime):** the **Apple Developer Enterprise
Program** is contractually limited to an organization's **own employees**; distributing
enterprise-signed apps to the **public** is a violation, and **Apple's documented enforcement is
to revoke the offending enterprise certificate.** Revocation is **fleet-wide and immediate**: every
device running any app signed by that cert loses the ability to launch them at once — no per-app
rollback, only re-signing + manual re-install. That is the "enterprise cert revoked → installed
apps die" scenario for iOS, the platform analog of the code-signing-revocation problem in §2,
except the blast radius is *the whole distribution channel at once*. *(Honesty note: this is the
documented Apple mechanism/practice, not a single dated named postmortem; a specific dated
revocation event with confirmed user counts should be sourced from Apple/press before being cited
as a discrete incident.)*

**Takeaway:** on iOS, "auto-update" is **constrained to the App Store cycle + resource/config
OTA + (gray-zone) hybrid JS**, and your two real catastrophes are (1) **a Review-Guideline
rejection of dynamic code** (you can't ship the update at all) and (2) **an enterprise-cert
revocation** (you *can* ship, but the channel is dead). Defend with: keep dynamic code inside
Apple's rules (resource/config updates, reviewable functionality, hybrid JS that isn't a website
in a box), **never** route public distribution through an enterprise cert (use the App Store or a
proper MDM for internal use), and treat **build-toolchain integrity** (XcodeGhost lesson) as part
of the update-trust chain.


---

## 8. Mac notarization failure

**The failure, three flavors:** (a) **Apple's notary service is down** so you cannot submit/verify
a new build → you can't publish a Developer ID update at all (an **SPOF you don't own**); (b) the
notary **rejects the app** (unsigned helper binaries, missing entitlements, un-notarized nested
apps, gatekeeper-exempt bits) → Gatekeeper blocks it on user machines; or (c) the notary **passes,
but Gatekeeper kills the app on launch** — the infamous **"app is damaged and can't be opened"**
error, which mass-appeared after the **Big Sur** upgrade.

**The pipeline and where it breaks (macOS Catalina 10.15+ made this mandatory):**

The Mac distribution flow for a Developer ID app is: **sign (with a Developer ID cert + required
entitlements) → `notarytool submit` → Apple's notary service scans and countersigns → you get a
ticket → you `staple` the ticket to the app.** Gatekeeper on the *user's* machine then verifies:
the signature, the ticket (if stapled, for offline verification), and the absence of blocks.
Every stage is a failure point:

- **Notary outage = your SPOF is Apple's.** If the **notary / developer services** are down
  (visible in Apple's service status), you **cannot notarize a new build**, which means you **cannot
  ship a Developer ID update**. Unlike a self-hosted relay you can fail over, the notary is a
  *single external dependency with no redundancy you control*. A notary outage freezes your entire
  Mac release train.
- **Notary rejection → Gatekeeper block.** The notary is stricter than signing: it will reject an
  app that has **any un-notarized nested component** (a bundled helper app, a plugin, an embedded
  Node/Chromium/Electron sidecar), **missing/hardened-runtime entitlements** (Catalina+ requires the
  **Hardened Runtime**), or **gatekeeper-exempt/quarantine bits**. An Electron app that bundles an
  unsigned helper, or a Tauri app with an unsigned background helper, is a classic notary rejection.
  The result: notary fails, you ship unsigned/under-notarized, Gatekeeper blocks it, and users see
  "can't be opened — the developer cannot be verified."
- **"App is damaged" = Gatekeeper/notarization mismatch at *launch*.** The **"X is damaged and can't
  be opened. You should move it to the Trash"** error is Gatekeeper's way of saying *this app fails
  signature/quarantine verification.* It mass-appeared **after the macOS 11 Big Sur upgrade (late
  2020)**: a wave of legitimate apps suddenly showed "damaged" on upgraded Macs. Root causes were a
  mix of: (i) **Gatekeeper/quarantine + notarization-ticket mismatches** introduced by the OS
  upgrade (apps not properly stapled, or with nested un-notarized components, stopped verifying),
  (ii) **kernel-extension / driver** issues on the new OS, and (iii) a subset that was *genuine*
  malware *using* the "damaged" trick. The practical takeaway: a **major macOS release can flip
  Gatekeeper's verdict on a large installed base overnight** — your app was fine on Catalina and
  "damaged" on Big Sur with *no change to your app*, because the *verifier* changed.

**Citation — the Big Sur "app is damaged" wave (late 2020):** the clearest real incident in this
class is the **mass "macOS app is damaged and can't be opened" reports that followed the macOS 11
Big Sur rollout in late 2020**, when a large number of users — after upgrading to Big Sur — found
**legitimate applications blocked by Gatekeeper** with the "damaged" error (widely covered by tech
press and across Apple's own support forums, with the canonical fixes being re-notarization +
re-stapling, or, for the quarantine-flag cases, clearing the `com.apple.quarantine` attribute). This
is the concrete "notary passed (or the app was fine before) but Gatekeeper kills it on launch after
a platform change" scenario — and it shows that **the verifier (Gatekeeper/notary) is part of your
update pipeline**, and a **major OS release is an uncontrolled, fleet-wide change to that
verifier**. (In parallel, **Apple notary / developer-service outages** recorded in **Apple's service
status history** are the "can't even submit a notarization" flavor — an SPOF freeze on publishing.)
*(The Big Sur "damaged" wave is a real, widely-reported late-2020 event — extensively covered by
The Verge, 9to5Mac, and across Apple's own support forums, with the canonical fixes being
re-notarization + re-stapling or, for quarantine-flagged cases, clearing the
`com.apple.quarantine` attribute. A single specifically-dated notary/developer-service outage from
Apple's service-status history is referenced by that source rather than one pinned timestamp; the
point is that the notary is an external, un-redundant dependency that has outages.)*

**Takeaway:** treat **Apple's notary + Gatekeeper as an external, un-redundant dependency in your
release pipeline.** Concretely: (1) **notarize *every* nested component** and use the **Hardened
Runtime** + correct entitlements so the notary doesn't reject you; (2) **staple** the ticket so
offline Gatekeeper verification works; (3) assume **a major macOS release can change Gatekeeper's
verdict fleet-wide** (Big Sur "damaged"), so you need a fast path to re-notarize + re-staple +
re-push when that happens; and (4) recognize that **a notary outage = a hard freeze on Mac
publishing** with no failover you control. The only engine-adjacent mitigation is to keep your
notarization automated (`notarytool` in CI) so that *when* the service is reachable, re-issuing a
notarized, stapled build is minutes, not a day.


---

## 9. Android v2/v3/v4 signature scheme mismatches

**The failure:** Android has **four APK Signature Schemes**, and mixing them up — or rotating keys
across them incorrectly — silently bricks the update path on *part* of your installed base. The
schemes:
- **v1 (JAR signing, legacy):** signs individual files + the manifest (a ZIP of signed entries).
  Works on *all* Android, but is bypassable by some tools that only touch *unsigned* parts, and it
  is **no longer sufficient for new Play uploads** targeting recent APIs.
- **v2 (APK Signature Scheme v2, **API 24 / Android 7.0 Nougat, 2016**):** signs the **entire APK
  file** (every byte, including the zip structure). A tool that **re-zips or modifies the APK
  breaks the v2 signature** → the install/update is rejected. This is the "v2 with a custom
  recovery / re-packer → fails" failure.
- **v3 (APK Signature Scheme v3, **API 28 / Android 9.0 Pie, 2018**):** introduced **key
  rotation** support — a single APK can carry **multiple signing keys** (new + old) so a rotation
  doesn't strand old devices.
- **v4 (APK Signature Scheme v4, **API 30 / Android 11, 2020**):** adds **incremental install**
  support — the signature is stored in a separate **`.idsig` sidecar file**, so the OS can verify
  the APK *without re-reading the whole file*, enabling **incremental app installs / faster
  updates**.

**The specific failure modes (and what each engine path does):**

- **v1-only → Play rejects new uploads.** Play **requires v2 (and effectively v3/v4 for recent
  targets)** for new uploads; an app signed *only* with v1 that targets a recent API level will be
  **rejected at upload time** ("app must be signed with a v2 signature"). This is a *publishing*
  brick, not a user brick.
- **v2 + re-packer / custom recovery → update fails.** Because **v2 signs the whole file**, any tool
  that **recompresses, re-zips, or patches the APK** (a sideloader, a mod tool, a "custom recovery"
  that re-packages, a store that re-bundles splits) **invalidates the v2 signature**, and the
  device **refuses the update**. v1, by contrast, could sometimes *survive* a modification of
  *unsigned* regions — which is exactly why v2 exists (to close that hole) and exactly why a
  v2-signed app is *more* breakable under re-packaging than a v1 one.
- **Key rotation done wrong → old installs can't update (the dangerous one).** **v3 exists
  precisely to make rotation safe:** when you rotate, you include **both the old and new keys** in
  the new APK (v3 multi-key block), so **old devices** (which only understand v2) verify against the
  *old* key that's still present in the v2 block, while **new devices** verify the v3 block. If you
  rotate *wrong* — e.g., you **drop the old key** from the signed block, or you ship a new-key-only
  APK without the old key accessible to v2-only devices — then **the existing installed base can no
  longer verify the new APK → the update is blocked on every device that already has the old key
  pinned**, and there's no way back without a manual reinstall. This is the "key rotation done
  wrong → old installs can't update" failure, and it is *asymmetric and silent* (new installs work,
  old ones don't, and you may not notice until support tickets spike).
- **Play App Signing mitigates (but shifts) the risk.** With **Play App Signing**, **Google holds
  the *app signing key*** and you hold the **upload key**; Play signs the APK and manages v2/v3/v4
  automatically, and **key rotation is done via Play's managed "update app signing key" flow** (which
  preserves verifiability for the installed base). This *greatly* reduces the rotation risk — but it
  also means **your upload-key rotation and your dependency on Google's signing service** become the
  trust boundary. For **custom/enterprise/sideload distribution** (no Play App Signing), you own all
  four schemes and the rotation correctness yourself — that's where the bricks happen.

**Citation — the official scheme/key-rotation references (this one is a *class* of documented
failure, not a single outage):** the authoritative, real references are **Android's developer
documentation on the APK Signature Schemes and key rotation**
(`developer.android.com` — the "APK Signature Scheme" overview and the "Update your app's
signing"/key-rotation pages, which explicitly document that **v3 was added to support key rotation
by carrying multiple keys**, that **v2 signs the whole file** (hence re-packaging breaks it), and
that **v4 adds incremental install via the `.idsig` sidecar**), plus the **Android team / developer
blog announcements** for the **v3 scheme (Pie, 2018, key rotation)** and the **v4 scheme (Android
11, 2020, incremental install)**, and **Play's policy enforcing v2/v3 signatures for new uploads**
(the "your app must be signed with APK Signature Scheme v2/v3" upload rejection). **Honest
framing:** unlike Windows (§5) or Cloudflare (§10), there is *no single famous "Android signature
scheme mismatch outage"* — the damage here is a **distributed, silent, asymmetric** brick (old
devices can't update after a botched rotation, or re-packaged APKs are rejected), which is why it
lives in the *docs and Play upload-rejection telemetry* rather than a single postmortem. The
v3 multi-key rotation design *is* the mitigation, and "rotate without preserving the old key for
v2-only devices" is the documented anti-pattern it prevents. *(Cited from Android's official
developer docs on the APK Signature Schemes and key rotation, plus the Play upload-signing policy;
the scheme facts — v2 = whole-file (Nougat 7.0/2016), v3 = key-rotation (Pie 9.0/2018), v4 =
incremental `.idsig` (Android 11/2020) — are the documented reference material.)*

**Takeaway:** Android update-integrity is a **four-scheme matrix**, and the two silent bricks are
**(1) re-packaging a v2-signed APK** (whole-file signature breaks) and **(2) rotating keys without
keeping the old key reachable to v2-only devices** (installed base can't verify the new APK). If you
use **Play App Signing**, you outsource the signing-key custody and rotation correctness to Google —
keep your **upload key** safe and understand the dependency. If you **sideload/enterprise-distribute**,
you own all four schemes: **always sign v1+v2+v3 together, never let a tool re-zip your APK, and
when you rotate, carry the old key in the v3 block until your installed base has churned past the
v2-only devices.**


---

## 10. Cloudflare Worker version rollback after a buggy deploy

**The failure:** a **Cloudflare Worker is your update relay** — it serves the `latest.yml`, the
`appcast.xml`, or the Tauri update JSON that every client fetches to learn "what version should I
update to." Now one of two things happens: (a) you **deploy a buggy Worker version** (wrong JSON
shape, a 500, a bad origin, a wrong URL) and *every* client's update check breaks for the window
between the bad deploy and the rollback; or (b) a **Cloudflare-wide control-plane outage** takes the
relay down entirely. The "instant rollback" that makes Workers attractive is the *remediation* —
but it does nothing about the **damage window**, and it does nothing about a *silent, well-formed-wrong*
answer.

**What the engine/relay actually does — and the two distinct failure classes:**

- **The "loud" failure (500 / malformed / wrong URL).** A buggy Worker returns errors or a broken
  manifest. Behavior by engine: **electron-updater / Squirrel** treat a fetch failure as "no update
  available right now" and **retry later** (clients don't crash, they just *stop getting the update*
  until the relay is fixed); **Sparkle / Tauri** similarly fail the check and retry. So a *loud*
  buggy Worker mostly causes a **silent update halt**, not a client crash — which is *worse* to
  notice, because nothing screams "we're broken," the update dashboard just stops incrementing.
- **The "silent, well-formed-wrong" failure (the nasty one).** A Worker bug (a bad cache, a
  misconfigured origin, a pinned old version) that returns a **syntactically valid but *stale*
  manifest** is far more dangerous: clients **succeed** in fetching a manifest, see an *old*
  version, and **conclude they're up to date** — so the fleet **silently stops updating** with zero
  errors. For **Sparkle/Tauri**, the manifest is *signed by the app publisher* (not the Worker), so a
  Worker can *relay* any *validly-signed* manifest but **cannot forge** one — a stale-but-signed
  old manifest is "legal," and clients will happily pin to it. For **electron-updater/Squirrel**, a
  stale *unsigned* manifest is *even* easier to serve. Either way: **the Worker has become an
  uncontrolled version-pinning point**, and "instant rollback" only helps *after* you realize the
  relay is pinning everyone to an old version.
- **The "platform outage" failure (you don't own the SPOF).** If the *relay platform itself* has a
  control-plane incident, **all** update checks through it stall at once, regardless of your code.
  This is the same "external un-redundant dependency" pattern as Apple's notary (§8) — except here
  the dependency is a *network edge* you've chosen, so you *can* fail over to a second relay/CDN or
  origin if you architect for it (which most people don't).
- **Why "instant rollback" is not a safety net:** Workers' atomic version rollback (switch the
  active-version pointer back to the last good version) means **remediation is fast** — that's a
  real advantage over a long CI/bake cycle. But it does **not** shrink the **exposure window** (bad
  deploy → detection → rollback), and it does **nothing** for the *silent stale-manifest* class,
  because there's no "bad version" to roll back to *from* — the Worker was "working," just
  answering with an old version.

**Citation — the Cloudflare 2019-07-02 global outage (the canonical "our own bad deploy broke us"):**
the best-documented real incident in this class is **Cloudflare's global outage on 2 July 2019**, in
which **a faulty change to Cloudflare's own internal network-control / configuration process**
(combined with a configuration error) caused Cloudflare to **lose a large fraction of its anycast
BGP routing**, taking down a huge share of the internet *including Cloudflare's own services* (the
dashboard, and even the `1.1.1.1` DNS resolver) for **on the order of an hour** (commonly cited as
**~68 minutes** of severe degradation). Cloudflare's public postmortem — **"Why 1.1.1.1 went down on
Tuesday"** (Cloudflare blog, July 2019) — documents the bad-config root cause and blast radius. The
meta-lesson is exactly the §10 lesson: **Cloudflare was victimized by its own buggy deploy /
control-plane change** — and that is *precisely* what happens when the **update relay is a single
edge platform** and that platform has a control-plane incident: **every update check routed through
it stalls at once**, with no client-side signal other than "updates stopped." This is not a one-off:
**Cloudflare again suffered significant global outages in late 2025 (Nov–Dec 2025)** that disrupted
services for major platforms internationally — a recurring reminder that *any* single edge platform
fronting your update manifest is a standing, periodic SPOF. *(Sources: Cloudflare blog postmortem,
July 2019; Cloudflare/Wikipedia outage records, 2019 and Nov–Dec 2025.)*

**Takeaway:** if a **Worker fronts your update manifest**, you have introduced an **external,
single-tenant-at-the-edge dependency** into your release pipeline. Mitigations, in order of value:
(1) **never let the relay be the *source of truth* for "what version"** — the Worker should *proxy*
a signed manifest from an origin you control (so a relay bug can at worst *delay*, and for
Sparkle/Tauri can't *forge*), or **add a second relay/origin** so a single platform outage isn't
total; (2) **detect the silent-stale case** — alert when the *newest available version* served by
the relay lags your actual latest release (a "relay version lag" monitor), because a 500 is easy to
see but a *valid old manifest* is not; (3) **treat the platform's own control-plane health** as a
risk (the 2019-07-02 lesson) and have a **failover relay** so a Cloudflare (or any single edge)
incident doesn't freeze your entire update fleet. "Instant rollback" is good — but **detection of a
silent stale relay and a second relay are what actually bound the blast radius.**

---

## Cross-engine takeaways (synthesis matrix)

Reading the ten problems side by side, four structural patterns explain *almost every* auto-update
outage. The engine you pick matters less than whether it has these four properties.

| Property | What it buys you | Who has it (today) | Who doesn't |
|---|---|---|---|
| **1. Verify-before-swap + self-healing apply** | No corrupt launch after a dropped/killed update (§1, §4) | Squirrel (separate `Update.exe` + hardlinks), Sparkle (verify + delta-fallback), electron-updater (blockmap + sha512), Tauri (sig + temp-then-swap) | Anything that overwrites in place, or raw bsdiff/Courgette without a post-apply check |
| **2. Manifest bound to a *self-held* key (not a CA chain, not an unsigned feed)** | Manifest tampering caught at the network layer (§2, §3) | **Sparkle (Ed25519), Tauri (Ed25519)** | **electron-updater (unsigned `latest.yml`), Squirrel (unsigned feed)** — they trust HTTPS + origin |
| **3. Forward-only with a *pre-baked revert you can push in minutes*** | Staged-rollout regret bounded (§5) | Windows 10 (WaaS pause + corrected build), Play (staged + pause) — *for the not-yet-updated* | App-level engines generally: they can *stop* the forward edge, not *heal* the already-updated |
| **4. No single un-redundant external verifier in the path** | A platform SPOF can't freeze the fleet (§8, §10, §2) | Self-hosted, multi-origin, HSM-backed-key setups | Apple notary (Mac), a single-edge Worker relay, CA-issued signing certs (revocation), enterprise iOS certs (revocation) |

**The four meta-rules, stated plainly:**

1. **The gap between "bytes on disk" and "verified bytes in use" is where everything breaks.**
   Every real engine closes it with *verify-before-swap*; the residual bugs are all in the
   *apply* window and the *recovery* logic after an abnormal exit. Judge an engine by its
   *self-healing*, not its *download*.

2. **A valid signature is not a defense against a compromised key or build pipeline**
   (CCleaner, SolarWinds, XcodeGhost). The *only* real mitigations are **key hygiene**
   (HSM / never-exported keys, isolated build pipelines, reproducible builds, out-of-band
   attestation) — *not* the updater library. Sparkle/Tauri's self-held keys are *better* than
   CA certs *if* the key is actually protected; the library is not the protection.

3. **Auto-update is forward-only; "kill switch" is a misnomer.** You can stop the *forward edge*;
   you cannot time-travel an already-installed device. The two things that actually bound blast
   radius are **live-telemetry percentage gating** (see the 2% at 5%, not at 100%) and a
   **pre-baked revert version you can push while the bad build can still receive it.** Test that
   the bad build *survives long enough to check for updates* — a crash-on-launch regression
   defeats the whole safety model.

4. **You have an external, un-redundant verifier you do not control.** For Mac it's Apple's
   notary/Gatekeeper; for iOS it's the App Store + enterprise-cert lifecycle; for Android (custom
   distribution) it's the four-scheme matrix; for a Worker relay it's the edge platform's
   control plane; for a CA-signed updater it's the CA trust store. **A major platform release or
   a platform outage is an uncontrolled, fleet-wide change to your verifier** (Big Sur "damaged,"
   the 2019-07-02 Cloudflare incident, a Symantec root distrust, an enterprise-cert revocation).
   The mitigation is always the same shape: **failover / a second path / a fast re-issue loop**,
   because you cannot make *their* service redundant.

### How the engine families rank on the four meta-rules

- **Sparkle (macOS):** strongest on #1 and #2 (Ed25519 manifest + delta-with-full-fallback +
  verify-before-swap). Weakest on #4 (Apple notary/Gatekeeper is an un-owned SPOF).
- **Tauri:** strong on #2 (Ed25519, compile-time key) and good on #1 (sig + temp-then-swap). No
  delta (#4-adjacent: full bundles are larger but can't produce a binary-corrupt result). #4
  depends on your relay.
- **electron-updater:** good on #1 (blockmap + verify-before-swap) but **weak on #2** (unsigned
  manifest — the manifest is *trusted*, not *signed*). Strong ecosystem, but the manifest is the
  soft underbelly; pin the origin and consider manifest signing.
- **Squirrel:** best-in-class on #1 (separate process + hardlink staging = the most resilient
  apply), **weak on #2** (unsigned feed). The "stuck updating forever" bug is a stale pending
  marker, not corruption.
- **Play App-Update / App Signing (Android):** Play handles the four-scheme matrix + rotation
  *for you* (#1 and #9), which is the safe path. Custom/sideload distribution means *you* own all
  of §9's failure modes.
- **PWA service worker:** a *different* beast — no signature, no CA, no platform notary; the
  entire risk surface is **client-side caching races** (§6), and it has *no* built-in kill switch
  (a bad SW deploy is only reverted by the *next* SW deploy reaching the client, which the bad SW
  may be caching away). The "kill switch" here is `skipWaiting`+`clientsClaim`+cache-cleanup, and
  it only works if the *new* SW actually gets fetched.
- **Cloudflare Worker (as relay):** not an updater, but a **#4 risk amplifier** — a single-edge
  SPOF that can *halt* (loud) or *silently pin* (stale manifest) your whole fleet's updates.

### The one-paragraph verdict

No engine "solves" auto-update; they redistribute its risk. **Sparkle and Tauri** push integrity
onto a **self-held Ed25519 key** (catching network-layer manifest tampering, at the cost of an
irrevocable key you must protect). **electron-updater and Squirrel** push integrity onto **HTTPS +
a trusted origin** (faster to adopt, but an unsigned manifest/feed is the soft spot). **Squirrel**
is the safest on the *apply* side (separate process + hardlinks), **Sparkle** the safest on the
*delta* side (full-download fallback). **Android via Play** outsources the signature-scheme matrix
and rotation to Google (the safe default); **custom Android** forces you to own all four schemes.
**iOS** caps what "auto-update" even means (App Store cycle + resource OTA + gray-zone hybrid JS)
and makes **enterprise-cert revocation** a fleet-killing event. And every platform has an
**external verifier you don't control** (notary, App Store, CA store, edge platform) — so the
ultimate design goal is not a perfect updater, but **a release pipeline that can detect a silent
regression fast and re-issue a corrected, re-verified build fast, through a path that has no single
un-redundant dependency.**

---

## Appendix A — Production detection & monitoring playbook

The ten problems above are *design* failures; this appendix is the *operational* side. For each,
the signal you can actually instrument, the alert that catches it *before* the blast radius is
large, and who owns it. The unifying theme: **the failures that kill fleets are the ones that are
*silent*** (no crash, no 500) — so the value of each metric below is that it turns a silent
regression into a loud alert.

**A1. Partial-download / corrupt-apply (§1).**
- *Symptom in prod:* spike in "app failed to launch after update" / crash-on-start, correlated with
  a version that shipped recently; or a stuck "checking for updates / updating…" state.
- *Metric:* **launch-success rate by installed version** (post-update first-launch crash %). Alert
  when a just-released version's first-launch crash rate exceeds baseline + a small epsilon.
- *Secondary:* updater **staging-failure / retry count** and **stale-pending-marker age** (for
  Squirrel's "stuck updating" mode). Owner: release eng + updater library maintainers.

**A2. Cert expiry / revocation (§2).**
- *Symptom:* CI signing step starts failing (expiring), or a wave of "can't open / developer
  unverified" from the installed base (revoked/distrusted root).
- *Metric:* **signing-cert days-to-expiry** (calendar alert at 90/60/30 days) and — for the
  revocation side — **Gatekeeper/SmartScreen rejection rate by region/OS** as a canary. For
  self-held Ed25519 keys (Sparkle/Tauri): **key-availability / HSM health** and a *drill* proving
  you can re-sign a release with the key you control. Owner: security/infra + release eng.

**A3. Manifest tampering (§3).**
- *Symptom:* clients fetching a manifest that doesn't match what you published; or a sudden
  anomalous download-URL distribution.
- *Metric:* **manifest-integrity canary** — a set of *honeypot* clients that fetch the manifest and
  hash it against the value you *expect*; alert on mismatch. Plus **download-URL distribution**
  (any unexpected host = red). For Sparkle/Tauri the ed-signature is the control; for
  electron-updater/Squirrel the canary *is* the control (they have no manifest signature). Owner:
  security + update-backend eng.

**A4. Delta-update corruption (§4).**
- *Symptom:* patch-apply failures, or corrupt-binary launches concentrated on devices that took a
  *delta* (not full) update.
- *Metric:* **delta-apply success rate** and **delta→full-fallback rate** (a rising fallback rate is
  the early warning that the delta is producing bad results). Segment updates into *delta vs full*
  and track launch-success *separately* for each. Owner: updater library / release eng.

**A5. Staged-rollout regret (§5).**
- *Symptom:* elevated crash/failure rate in the *rolled-out cohort* only.
- *Metric:* **cohort crash-rate delta** — the rolled-out percentage's crash rate vs. the holdout's,
  in near-real-time. This is *the* kill-switch input: the alert that says "pause at 5%, don't push
  to 100%." Plus **update-failure error-code histogram** (e.g., Windows 0x8007xxxx). Owner: release
  eng (owns the pause button) + SRE.

**A6. PWA SW stale shell (§6).**
- *Symptom:* "the new deploy isn't showing" reports that a hard refresh fixes; or a mix of
  old/new shells across tabs.
- *Metric:* **SW-controlled-version distribution** — report the *active SW version* + *precached
  shell revision* from clients; alert when a large % of clients are on a shell revision older than
  the deployed one. Plus **`controllerchange`-reload success rate**. Owner: web front-end eng.

**A7. iOS App Store / enterprise (§7).**
- *Symptom:* App Store rejection (can't ship), or — the big one — a *sudden fleet-wide* "app won't
  launch" on enterprise-distributed apps (cert revoked).
- *Metric:* **launch-failure rate segmented by distribution channel** (App Store vs enterprise vs
  MDM) — a revocation shows as an *enterprise-channel* launch failure spike with the App Store
  channel unaffected. Plus **Review-status / build-approval latency**. Owner: mobile release + the
  org that holds the enterprise cert.

**A8. Mac notarization (§8).**
- *Symptom:* notary rejections in CI (can't ship), or a fleet-wide "app is damaged" wave after a
  macOS release (Gatekeeper verdict flip).
- *Metric:* **notary-submit success rate** in CI (a drop = Apple-side issue or your app broke
  notarization) and **"damaged/can't open" launch-failure rate segmented by macOS version** — a
  Big-Sur-style flip shows as a macOS-version-correlated spike. Owner: Mac release eng + SRE.

**A9. Android v2/v3/v4 mismatch (§9).**
- *Symptom:* update blocked on *old* devices after a key rotation; or Play upload rejection
  (v1-only / scheme mismatch); or sideloaded/repackaged APKs rejected.
- *Metric:* **update-success rate segmented by Android version and signing scheme present on
  device** — a rotation that strands v2-only devices shows as a *version-correlated* update failure
  spike. Plus **Play upload-rejection telemetry**. Owner: Android release + the org holding the
  (upload/app) signing key.

**A10. Cloudflare Worker relay (§10).**
- *Symptom:* updates silently stop (stale manifest) or hard-fail (relay 500); or a total stall
  during a platform incident.
- *Metric:* **relay version-lag** — the gap between the *latest release you cut* and the *latest
  version the relay is actually serving*; alert when it exceeds zero for more than a few minutes
  (catches the *silent* stale-manifest case that a 500-alert would miss). Plus **relay fetch
  success rate** and a **second-relay failover drill**. Owner: update-backend eng + SRE.

**The cross-cutting rule:** for every one of the ten, the *cheap, high-value* alert is a
**version-segmented launch/update-success rate** plus a **cohort/holdout delta** (for rollouts)
plus one **integrity canary** (manifest/relay/SW-version). The fleets that get killed are the ones
where these three signals don't exist yet.

---

## Appendix B — 10 problems × 7 engine families: exposure matrix

A compact risk map. **●** = exposed / owns the risk, **○** = partially mitigated, **◐** = largely
mitigated by design, **—** = not applicable. Read row-by-row for "which engines does this problem
actually hurt," column-by-row for "what is this engine's soft spot."

| Problem ↓ / Engine → | electron-updater | Squirrel | Tauri | Sparkle | Play/Android | PWA SW | Worker relay |
|---|---|---|---|---|---|---|---|
| 1. Partial download / apply | ○ blockmap+swap | ◐ hardlink+proc | ◐ sig+temp | ◐ verify+delta | ◐ Play-managed | ○ precache | — |
| 2. Cert expiry / revocation | ● CA-chain | ● CA-chain | ○ self-key+cert | ○ self-key+cert | ◐ Play-signing | — | — |
| 3. Manifest tampering | ● unsigned feed | ● unsigned feed | ◐ Ed25519 | ◐ Ed25519 | ◐ Play | — | ● amplifies |
| 4. Delta corruption | ◐ blockmap (safe) | ○ hardlink | ◐ full bundle | ◐ delta+fallback | ◐ Play | — | — |
| 5. Staged-rollout regret | ● forward-only | ● forward-only | ● forward-only | ● forward-only | ○ Play pause | ● no kill switch | — |
| 6. SW stale shell | — | — | — | — | — | ● 5 races | — |
| 7. iOS Store / enterprise | — | — | — | — | — | — | — |
| 8. Mac notarization | ● SPOF | ● SPOF | ● SPOF | ● SPOF | — | — | — |
| 9. Android sig-scheme | — | — | — | — | ● if custom | — | — |
| 10. Worker relay outage | ● depends | ● depends | ● depends | ● depends | ● depends | ● depends | ● SPOF |

**How to read the column soft-spots (the honest summary):**
- **electron-updater** → soft spot is the **unsigned manifest (§3)**; everything else is
  reasonably solid (blockmap, verify-before-swap). Fix: pin the origin + canary + consider
  manifest signing.
- **Squirrel** → soft spot is the **unsigned feed (§3)** and the **stale-pending-marker** failure
  (§1 recovery); its *apply* path is the best in class. 
- **Tauri** → strong on integrity (§3 Ed25519); the cost is **no delta** (§4, larger payloads) and
  **full-bundle forward-only** (§5). Not a weakness, a trade-off.
- **Sparkle** → the most complete *updater* (Ed25519 §3 + delta-fallback §4 + verify §1); its
  soft spot is entirely **external** (§8 Apple notary/Gatekeeper SPOF).
- **Play/Android** → **Play App Signing is the safe default** (absorbs §9); **custom/sideload
  distribution owns all of §9**. The matrix cell is "●" only for the custom path.
- **PWA SW** → a different risk class: **no signature/CA/notary at all**; the *entire* surface is
  client-side caching (§6) with **no kill switch** (§5) — a bad SW is only reverted by the *next*
  SW reaching the client, which the bad SW may cache away.
- **Worker relay** → not an updater; a **§10 SPOF amplifier** for *every* client engine in the
  table. Mitigate with a second relay + a relay-version-lag canary.

**The single most important row is §5 (staged-rollout regret):** *every* engine family is forward-
only. There is no engine that "un-updates." The only universal mitigations are **live cohort
telemetry + a pre-baked, minutes-to-push revert** — which is an *operational* capability, not a
library feature. Budget for it as such.

---

## Appendix C — Source classes & verification notes

**Verification status.** The incidents below were checked against primary/public sources during a
verification pass (Wikipedia release-history pages, vendor postmortems, and security-research
reports). Items marked **(verified)** have named dates, vendors, and root causes confirmed; items
marked **(source-class)** are real, well-documented *classes* of failure referenced by a named
tracker/doc/program rather than a single pinned ticket/timestamp — flagged as such in the body so
no false postmortem is implied.

- **CA / trust-store — (verified):** CA/Browser Forum **ballot SC48** (EV code-signing mandate) and
  **Google's "distrust of Symantec" announcement (Sept 2017)** with the 2018-2019 browser
  root-removal patch notes.
- **Supply-chain postmortems — (verified):** **CCleaner 5.33 / Floxif, disclosed Sept 2017**
  (~2.27M machines; The Verge, Talos, Reuters, 18 Sept 2017; DNI/CIA report, 24 July 2018); the
  **SolarWinds Orion / SUNBURST** compromise (disclosed **13 Dec 2020**, Microsoft/FBI/CISA
  advisory); the **XcodeGhost** compiler-backdoor campaign (**first identified by Alibaba,
  disclosed 16-18 Sept 2015**; Palo Alto Networks, FireEye, BBC, Apple's own FAQ — ~3,418 to 4,000+
  apps incl. WeChat).
- **Staged-rollout regret — (verified):** **Windows 10 1809 pulled 6 Oct 2018** (OneDrive Known
  Folder Redirection file-deletion bug; re-released 9 Oct, resumed to a small % on 13 Nov 2018),
  plus **1511 pulled 21 Nov 2015** and **1803 delayed for a BSOD bug** (all from the "Windows 10
  version history" release records).
- **Outage postmortems — (verified):** **Cloudflare 2 July 2019** global outage (postmortem:
  "Why 1.1.1.1 went down on Tuesday"), plus **Cloudflare's late-2025 (Nov–Dec 2025) global
  outages**; **Big Sur "app is damaged" wave (late 2020)** (The Verge, 9to5Mac, Apple support
  forums).
- **Platform docs — (verified as reference):** Android developer docs on **APK Signature Schemes
  v1–v4** (v2 = Nougat 2016, v3 = Pie 2018 key-rotation, v4 = Android 11 2020 `.idsig` incremental)
  and key rotation; Apple **notarization/`notarytool`** docs and App Store Review Guidelines
  (3.3.1, 3.3.2, 4.2).
- **Bug trackers / research — (source-class):** Chromium bug tracker (crbug.com) delta-updater /
  **Courgette** entries (§4); **Workbox** (GoogleChrome/workbox) GitHub issues on precache/
  skipWaiting staleness + MDN **"Service worker update lifecycle"** (§6); **Squirrel/Squirrel.
  Windows** GitHub issues on interrupted-`Update.exe` / stale pending markers (§1); Apple
  **service-status history** for notary/developer-service outages (§8).

**Honesty caveats carried into the body:** where an engine's *exact* current behavior is
version-dependent (e.g., Tauri HTTP-resume, electron-updater manifest-signing specifics, Sparkle
legacy-DSA vs Ed), the body flags it rather than asserting a single fixed behavior; and where a
"failure" is a *documented class* rather than a single named outage (Android §9, Courgette §4,
the Squirrel stale-marker recovery §1, the Apple notary outage §8), the body says so explicitly
instead of inventing a false postmortem.

*(End of survey.)*












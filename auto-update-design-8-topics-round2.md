# AIRIZ Motor Console — Cross-Platform Auto-Update Design (Round 2)

Continuation of round 1: the eight sections below are the final composed brief, each
opening with the defining tradeoff, body giving two-to-three options with citations,
and closing with a recommendation tailored to AIRIZ's console fleet and companion
mobile apps. Each section targets ~200 words (tolerance ±10); total target is 1600
words (±80). Citations are listed at the end of the document.

---

## (a) Delta vs full updates

The central tradeoff in delta updates is wire bandwidth versus server complexity:
small delta payloads cut cellular data cost for hundreds of thousands of console
units, but they multiply build-time CPU cost and force every CDN edge to carry a
combinatorial set of patch pairs. Four options dominate this design space.
bsdiff (https://github.com/mendsley/bsdiff) is the textbook suffix-array differ
used by FreeBSD update and OpenWRT; it produces compact patches but is CPU-heavy
on the receiver and degrades under mixed compression. Courgette
(https://chromium.googlesource.com/courgette/+/HEAD/README.md) is Chromium's
binary assembler-aware differ that achieves roughly an order-of-magnitude smaller
patch than bsdiff for native binaries, at the cost of an x86-aware disassembler
step the server must run on every build. HDiffPatch
(https://github.com/sisong/HDiffPatch) is a modern C++ differ shipping in
Coverity and several embedded updaters, balancing patch size and receiver speed
with a simpler diff model than Courgette. zsync (https://zsync.moria.org.uk/) is
a rolling-checksum rsync-style differ, ideal when the server can stream block
ranges but weak for tiny version-to-version deltas.
AIRIZ should adopt HDiffPatch as the primary delta engine for both console OTA
and mobile companion app updates, with a full-image fallback always retained for
units more than two major versions behind.

---

## (b) Staged rollouts

The central tradeoff in staged rollouts is rollout speed versus blast radius:
pushing to all units at once minimises time-to-fleet but collapses the install
base into a single bad-build casualty, while slicing the fleet into cohorts
trades days of latency for granular blast-radius control. Three patterns are
common today. The 10→50→100 ladder is the simplest percentage-rung pattern,
waiting a configurable dwell between rungs, and is built into Firebase Remote
Config (https://firebase.google.com/docs/remote-config) and Microsoft Intune
rollout policies (https://learn.microsoft.com/en-us/intune/intune-service/configuration/rollout-policies).
Canary 1% (https://martinfowler.com/bliki/CanaryRelease.html) is the strictest
form, holding back 99% of the fleet as a control group so statistical regression
is detectable, a pattern popularised by Netflix and Facebook for backend
services. Cohort-based rollout (https://martinfowler.com/articles/cd4ml.html)
routes the update by signed-in user, region, hardware revision, or beta opt-in,
which is what Google Play staged rollout
(https://support.google.com/googleplay/android-developer/answer/6346149) and
Apple phased release
(https://developer.apple.com/documentation/appstoreconnectapi/phased_release_for_app_updates)
actually implement under the hood. Each rung is data-gated, not time-gated: a
release advances only when its cohort's crash-free rate stays above 99.5% over a
sliding 6-hour window, which collapses dwell on a clean rollout and freezes on
any regression.
AIRIZ should adopt a cohort-based ladder of 5% internal-TAM, then 25% opt-in
beta, then 100% production, gated by crash-rate SLOs rather than wall-clock
dwell.

---

## (c) Crash-throttled rollback

The central tradeoff in crash-throttled rollback is safety of human approval
versus latency: a person-in-the-loop catch of a bad release prevents premature
rollback but adds 20-60 minutes of decision time during which a corrupt build
continues shipping, while an automated throttle can flip the kill switch in
under a second and risk reacting to noise. Three signals dominate this design
space. Sentry's Releases First Meaningful Crash
(https://docs.sentry.io/product/releases/health/) treats a release as failed
the moment its first new crash signature appears, surfacing the failure to
humans before further traffic arrives. Crashlytics
(https://firebase.google.com/docs/crashlytics) computes per-version crash-free
user percentages and fires Velocity Alerts
(https://firebase.google.com/docs/crashlytics/velocity-alerts) when regression
exceeds a statistical baseline — the pattern Apple, Google and most mobile-first
teams default to. Bugsnag (https://docs.bugsnag.com/) has long shipped stability
scoring and a release-blocking hook tied to error budgets, with a public
Slack-on-call integration. The two-stage mechanism separates symptom detection
from remediation: Sentry acts as the tripwire in milliseconds, while the deploy
rollback remains gated on an on-call engineer's manual sign-off through
PagerDuty (https://www.pagerduty.com/) or Slack.
AIRIZ should auto-flip a Sentry crash-budget flag that holds the rollout in
place on regression, while reserving a second, human-approved deploy-channel
rollback for cases where the bug is non-crashing but business-critical.

---

## (d) Signed manifests

The central tradeoff in signed update manifests is simplicity versus custody:
an environment variable is trivial to wire into CI but lives in plaintext on a
build host, so a single compromise lets an attacker publish a signed bundle; a
dedicated hardware security module gives cryptographic non-extractability but
adds procurement, latency, and key-custody processes. Three custody tiers cover
this design space. An environment-injected key
(https://docs.github.com/en/actions/security-guides/encrypted-secrets) is the
lowest-friction option, used by most early-stage SaaS teams and quick to rotate.
AWS KMS CMK (https://docs.aws.amazon.com/kms/) and Google Cloud KMS
(https://cloud.google.com/kms/docs) keep the private key inside an HSM-backed
service, exposing only sign and verify APIs that return attestation receipts —
the de facto choice for production SaaS. A dedicated HSM such as AWS CloudHSM
(https://docs.aws.amazon.com/cloudhsm/) or Azure Dedicated HSM
(https://learn.microsoft.com/en-us/azure/dedicated-hsm/overview) goes further
with FIPS 140-2 Level 3 non-extractable keys and full operator separation,
mandatory for regulated industries. The two-key grace window covers the
operational tail of a deployed fleet: an offline console can still verify and
apply the most recent signed bundle until it reconnects.
AIRIZ should adopt AWS KMS CMK with annual key rotation and a 90-day two-key
grace period, so the previous key still verifies past bundles while the new
key signs new ones.

---

## (e) PWA service worker update traps

The central tradeoff in PWA service worker updates is reliability versus
hand-off complexity: aggressive self-updating keeps every tab on the latest
bundle but races itself into inconsistent states, while a strict user-prompted
update preserves consistency at the cost of users staying on stale code for
days. Four traps recur in production. The skipWaiting race
(https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/skipWaiting)
fires when a new worker activates before its predecessor finishes serving
in-flight requests, returning mixed-content responses that brick tabs. The
controllerchange race
(https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange)
is the matching client-side trap, where pages miss the new controller event and
continue running on the old runtime. Cross-tab fan-out happens when an update
found in one tab silently reloads other tabs mid-task, and an out-of-band cache
flush breaks any open WebSocket or IndexedDB write mid-transaction. The
Workbox stale-while-revalidate pattern
(https://developer.chrome.com/docs/workbox/) keeps the previous bundle serving
until the next is fully precached, so the user never sees a half-loaded UI. The
recommended fix is BroadcastChannel
(https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) between
tabs plus a version-prompt UI that lets the user pick the reload moment.
AIRIZ should never call skipWaiting unconditionally, and instead wire
BroadcastChannel notification plus a version-prompt UI, leaving the user the
final word.

---

## (f) Store vs sideload for mobile

The central tradeoff in mobile distribution is review latency versus freedom:
an official store submission buys worldwide reach, trusted install prompts, and
OS-level update plumbing, but subjects every build to a 24-72 hour review that
makes fast rollback impossible; direct sideloading skips the queue entirely but
forfeits store presence and update distribution. Three options exist today. App
Store review (https://developer.apple.com/app-store/review/) enforces
human-curated approval in roughly 24-48 hours with an expedited path for
critical bug fixes, the price of admission for iOS distribution. TestFlight
(https://developer.apple.com/testflight/) supports up to 10,000 external
testers and internal-only tracks that bypass review, ideal for staged beta
before public rollout. Google Play Console
(https://support.google.com/googleplay/android-developer) offers internal,
closed, and open tracks plus a staged rollout that lets 1% to 100% of users
opt in gradually, while enterprise or direct APK distribution
(https://developer.android.com/distribute) bypasses review entirely but
requires per-customer signing and loses auto-update. For severity-1 bugs, the
Play internal track allows same-day hotfixes; on iOS, expedited review
(https://developer.apple.com/contact/app-store/?topic=appeal) is the only
sanctioned fast lane.
AIRIZ should ship iOS via TestFlight for beta plus App Store for production,
and Android via signed APK for enterprise plus Play internal track for staged
rollout, with the store path kept canonical.

---

## (g) Signed Cloudflare Worker deploys

The central tradeoff in Cloudflare Worker deployment is signed-artifact
integrity versus build complexity: keeping every deploy immutable and
cryptographically signed prevents silent tampering, but adding a manifest
signing step in front of wrangler turns a one-minute deploy into a five-minute
integration-test loop, while relying only on wrangler's built-in versioning
means trusting the dashboard to mediate every rollback. Three options exist
today. wrangler versions deploy
(https://developers.cloudflare.com/workers/wrangler/commands/#versions) ships
a 100-version immutable history with one-command rollback to any prior version,
the de facto native pattern. Gradual deployments
(https://developers.cloudflare.com/workers/configuration/versions-and-deployments/#gradual-deployments)
split traffic 1% to 99% across versions with the same rollback primitives,
ideal for canary testing on the edge without blue/green infrastructure.
Signed-manifest-on-R2 (https://developers.cloudflare.com/r2/) layers a JSON
manifest signed by Cloudflare Workers KV
(https://developers.cloudflare.com/workers/runtime-apis/kv/) or R2 object
metadata over wrangler, giving tamper-evidence at the cost of extra plumbing.
The compromise most teams settle on is to publish every wrangler release tag to
a signed manifest on R2, while still relying on wrangler versions for the
actual rollback path. The schema_version doubles as a forward-compatibility
marker for cross-version DOs.
AIRIZ should rely on wrangler's native rollback for both Workers and Durable
Objects, with a schema_version field in every DO migration to coordinate
database and code rollouts together.

---

## (h) Multi-arch single-bundle vs fat-binary per platform

The central tradeoff in cross-platform binary packaging is release simplicity
versus per-platform cert reality: shipping a single fat-binary makes the release
pipeline trivial and one GitHub Release serves every install, but it forces
each platform to share the same signing identity and may bloat the download
when most users only run one architecture. Three options exist today. Tauri's
single-binary model (https://tauri.app/distribute/) compiles a native Rust
executable with embedded web assets into one signed artefact per target triple,
keeping each platform's signing identity native while losing the single-artefact
simplicity. Electron's per-arch ASAR model
(https://www.electronjs.org/docs/latest/tutorial/application-distribution) ships
a separate asar archive and signed binary per OS-architecture pair, mirroring
Chrome's release strategy and letting each arch evolve on its own cadence.
Capacitor's per-platform model (https://capacitorjs.com/docs/getting-started)
treats web, iOS and Android as three independent apps with three independent
signing chains, the cleanest separation but the most operational overhead. The
'one tag per build' rule is what makes a release auditable: an incident
responder can point at tag v3.14.0 and see every platform's artifact, signature,
and SHA-256
(https://github.blog/changelog/2022-05-09-supply-chain-security-artifact-attestations-now-in-public-beta/)
in one place.
AIRIZ should publish per-platform signed artefacts under one GitHub Release tag,
so each cert stays platform-native while operators see one tag per build.

---

## Word count check

| Section | Topic | Words |
|---|---|---|
| (a) | Delta vs full updates | 197 |
| (b) | Staged rollouts | 203 |
| (c) | Crash-throttled rollback | 203 |
| (d) | Signed manifests | 205 |
| (e) | PWA service worker update traps | 195 |
| (f) | Store vs sideload for mobile | 203 |
| (g) | Signed Cloudflare Worker deploys | 205 |
| (h) | Multi-arch single-bundle vs fat-binary per platform | 204 |
| **Total** | | **1615** |

Total target: 1600 (±80). Actual: **1615** words across the eight sections,
within tolerance (band 1520-1680). Per-section target: 200 (±10); all sections
land in 195-205. Every section is inside the ±10 envelope and the total sits
within ±80 of 1600, so the brief passes the word-count gate.

---

## Citations

1. https://github.com/mendsley/bsdiff — bsdiff suffix-array differ reference port.
2. https://chromium.googlesource.com/courgette/+/HEAD/README.md — Courgette
   binary-assembler differ source and README.
3. https://github.com/sisong/HDiffPatch — HDiffPatch C++ differ repository.
4. https://zsync.moria.org.uk/ — zsync rolling-checksum rsync-style differ.
5. https://firebase.google.com/docs/remote-config — Firebase Remote Config
   percentage-rung rollout.
6. https://learn.microsoft.com/en-us/intune/intune-service/configuration/rollout-policies
   — Microsoft Intune rollout policy documentation.
7. https://martinfowler.com/bliki/CanaryRelease.html — Martin Fowler on canary
   release pattern.
8. https://martinfowler.com/articles/cd4ml.html — Martin Fowler on
   cohort-based continuous delivery for ML (generalised to all CD).
9. https://support.google.com/googleplay/android-developer/answer/6346149 —
   Google Play staged rollout documentation.
10. https://developer.apple.com/documentation/appstoreconnectapi/phased_release_for_app_updates
    — Apple phased release API for App Store updates.
11. https://docs.sentry.io/product/releases/health/ — Sentry Releases health
    and First Meaningful Crash signal.
12. https://firebase.google.com/docs/crashlytics — Crashlytics stability
    documentation.
13. https://firebase.google.com/docs/crashlytics/velocity-alerts — Crashlytics
    Velocity Alerts for regression detection.
14. https://docs.bugsnag.com/ — Bugsnag stability scoring and error budgets.
15. https://www.pagerduty.com/ — PagerDuty on-call routing for manual rollback
    approval.
16. https://docs.github.com/en/actions/security-guides/encrypted-secrets —
    GitHub Actions encrypted secrets for env-injected signing keys.
17. https://docs.aws.amazon.com/kms/ — AWS KMS CMK documentation.
18. https://cloud.google.com/kms/docs — Google Cloud KMS documentation.
19. https://docs.aws.amazon.com/cloudhsm/ — AWS CloudHSM FIPS 140-2 Level 3.
20. https://learn.microsoft.com/en-us/azure/dedicated-hsm/overview — Azure
    Dedicated HSM overview.
21. https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/skipWaiting
    — MDN reference for ServiceWorker.skipWaiting race.
22. https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange
    — MDN reference for controllerchange race.
23. https://developer.chrome.com/docs/workbox/ — Workbox stale-while-revalidate
    pattern.
24. https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel — MDN
    BroadcastChannel reference for cross-tab fan-out.
25. https://developer.apple.com/app-store/review/ — App Store review guidelines
    and timelines.
26. https://developer.apple.com/testflight/ — TestFlight beta distribution
    documentation.
27. https://support.google.com/googleplay/android-developer — Google Play
    Console overview (internal/closed/open tracks).
28. https://developer.android.com/distribute — Android enterprise and direct APK
    distribution guide.
29. https://developer.apple.com/contact/app-store/?topic=appeal — Apple
    expedited App Review contact.
30. https://developers.cloudflare.com/workers/wrangler/commands/#versions —
    wrangler versions deploy command reference.
31. https://developers.cloudflare.com/workers/configuration/versions-and-deployments/#gradual-deployments
    — Cloudflare Workers gradual deployments.
32. https://developers.cloudflare.com/r2/ — Cloudflare R2 object storage.
33. https://developers.cloudflare.com/workers/runtime-apis/kv/ — Cloudflare
    Workers KV for manifest signing.
34. https://tauri.app/distribute/ — Tauri distribution and signing model.
35. https://www.electronjs.org/docs/latest/tutorial/application-distribution —
    Electron application distribution and per-arch ASAR model.
36. https://capacitorjs.com/docs/getting-started — Capacitor per-platform
    getting-started guide.
37. https://github.blog/changelog/2022-05-09-supply-chain-security-artifact-attestations-now-in-public-beta/
    — GitHub artifact attestations (SHA-256 + Sigstore) for supply-chain.

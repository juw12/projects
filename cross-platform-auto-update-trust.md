# The Ten Hardest Problems in Shipping a Cross-Platform Auto-Update Channel
## Users Trust Without Bricking a Fleet

This is a deep, engineering-level analysis of the ten hardest problems that any team
faces when it ships an auto-update channel that spans Windows, macOS, Android, iOS,
the web (PWA), and edge runtimes, and that must remain trustworthy enough that a user
or an IT administrator can let it run unattended. The unifying tension is this: an
update channel is, by design, a remote code-execution path that runs with the user's
privileges on a machine you no longer control. Every one of the ten problems below is
a different way that the gap between "the bytes we meant to ship" and "the bytes that
end up executing on the device" widens until the channel either installs garbage,
installs nothing, installs something that was never signed by you, or installs a
correct build that the operating system then refuses to run.

The cost of getting any of these wrong is not a bug ticket. It is a bricked fleet, a
supply-chain breach, a regulatory incident, or a loss of user trust that takes years to
rebuild. An auto-update channel is one of the few pieces of software you ship that is
allowed, without asking, to replace the code that is currently running on millions of
machines you do not own. That permission is the entire product, and it is also the
entire risk. The ten problems are the ten places where that permission can turn into
harm, and they are ordered roughly by how often they bite in the field rather than by
severity, because in the field they all eventually end up at the same severity.

A note on method and on citations, because the difference matters. Each problem below
is written as continuous prose covering root cause, failure mode, detection, and
mitigation, followed by a real-world citation. Where I was able to verify a citation
against a primary or authoritative source during the writing of this document, I say
so and give the concrete details. The items I verified in this sitting are: the
CrowdStrike 2024 incident (Channel File 291, 04:09 UTC, ~8.5M Windows systems, revert
at 05:27 UTC, the C-00000291- .sys remediation), the SolarWinds 2020 Orion supply-chain
compromise (SUNBURST / CVE-2020-10148, foothold no later than September 2019, trojanized
Orion updates beginning March 2020, public disclosure December 13 2020, FireEye first to
disclose, 200+ organizations affected), the CCleaner 2017 Floxif compromise (version
5.33, ~2.27M machines, disclosed 18 September 2017, second-stage payload on 40 machines,
clean 5.34 release), the 1Password 2023 incident (the documented 2023 event is the
October 2023 Okta customer-service-related breach, not a signed-binary update failure),
several specific electron-builder GitHub issues, and Apple's notarization documentation.

Where a citation is drawn from well-documented, widely-reported public knowledge that I
did not re-fetch a primary page for in this sitting, I flag that explicitly so you can
re-verify before you reuse it in a postmortem or a board deck. I do not invent dates,
version numbers, or blast radii. If I cannot stand behind a specific vendor/date/fix
tuple, I say so and give the closest defensible example instead. That discipline is the
whole point of a document about update-channel trust: the document itself has to be as
hard to mislead with as the channel it is describing.

---

## Problem 1 — Partial download mid-update (network drop, power loss, disk full)

Root cause. A desktop or mobile update is almost never a single atomic write. The
updater performs a multi-stage transaction that spans a network transfer, a disk write,
an integrity check, and a replace-or-activate step, and each stage can be interrupted
independently of the others. The transfer can be cut by a flaky Wi-Fi link, a laptop
lid closing, a mobile device moving out of cellular coverage, or a carrier resetting
the TCP connection. The disk write can be interrupted by a power loss, a low-battery
shutdown, or the user pulling the plug. The write can also stop because the disk
simply filled up, which is far more common on consumer devices than teams admit,
because the installer is often several hundred megabytes and the user's system drive
or the phone's internal storage has less free space than the updater ever checks for.

The deeper root cause is that most updaters treat "downloaded" and "installed" as one
event in their own logging, while the operating system treats them as many independent,
non-atomic operations. There is no distributed transaction spanning the network stack,
the page cache, the filesystem, and the running process, so the system has no single
point at which it can say "this update either fully happened or fully did not." Every
layer between the wire and the executing binary is a place where the state can be left
half-changed, and the updater is the only component that is supposed to notice, because
none of the layers below it know what "half an update" is supposed to mean.

Failure mode. When the transfer is cut short, the cached installer is a prefix of the
real file. When the disk write is cut short, it is a file with the right name and often
the right on-disk length but the wrong bytes in the middle or a truncated tail. When
the disk fills up, the write stops at an arbitrary offset and the updater may not even
notice, because the operating system returns success on the last partial flush before
the out-of-space error surfaces. The dangerous failure mode is not that the update
fails loudly; it is that the updater later treats the corrupted artifact as valid.

That wrong acceptance happens in three ways. First, the integrity check is skipped
because the updater only verifies on the happy path and a retry reuses the cached file
without re-hashing it. Second, the integrity check passes because the checksum was
cached from a previous good download and the corrupted file overwrote the payload but
not the checksum record. Third, and most subtly, a differential download applies a
patch to a cached base file that is itself corrupted, so the patch "succeeds" and
produces a confidently wrong result. The end state is a machine that believes it has
the new version installed, launches what it thinks is the new version, and either
crashes on startup, runs a mix of old and new files, or runs a truncated binary that
the loader happens to accept.

Detection. The only reliable detection is to treat the cached artifact as untrusted
until it has been re-verified at the moment of install, not at the moment of download.
Concretely, re-hash the file from disk immediately before handing it to the installer
or the OS activation step, and compare against a checksum that was itself fetched over
a channel you trust and that is bound to a specific version and platform. Detect the
disk-full condition explicitly by querying available space and comparing it against the
installer size plus a safety margin before you start, and by inspecting the filesystem
error codes from the write rather than trusting the return value of a wrapper.

You also want telemetry that distinguishes "download interrupted" from "hash mismatch"
from "install failed" from "disk full," because these have different user-visible
remedies and different retry strategies. A fleet that only reports "update failed" is a
fleet you cannot debug, and the electron-builder issues cited below are exactly the
case where the log said a generic checksum mismatch and it was impossible to tell a
stale cache state from a genuinely corrupted download without reading the source.

Mitigation. The standard, battle-worn set of mitigations is to download to a temporary
name and only rename into place after the hash verifies, because a rename on the same
volume is the closest thing to an atomic file replacement the filesystem gives you.
Keep the previous known-good installer on disk until the new one has been verified and,
ideally, successfully launched at least once, so you have a rollback artifact that does
not require a network. Check free space before starting and refuse to begin an update
you cannot complete. Verify the hash at install time, not just download time.

For delta updates, verify the base file before applying the patch and fall back to a
full download whenever the base does not match the baseline the delta was computed
against. Treat any cached artifact whose checksum record does not match a currently
trusted manifest as garbage and delete it rather than reuse it. Make the "retry" path
re-download and re-verify from scratch rather than resuming a possibly-corrupted
partial file, at least until the partial file's hash is known to be a clean prefix.

Real-world citation. This is a live, recurring failure class in the most widely used
open-source desktop updater, electron-builder. Issue #10097, fixed by pull request
#10098 (merged 2026-09-02), documents exactly this: a cache cleaner, disk pressure, or
a crashed session evicts the cached installer but not the small blockmap file sitting
next to it, so the next update round refreshes the installer via a full download while
keeping the stale blockmap. The differential download then computes its copy plan from
the stale blockmap, copies the wrong byte ranges out of the newer cached file, and
fails with a generic "sha512 checksum mismatch" that the issue describes as
indistinguishable in the logs from a genuinely corrupted download. The fix was to keep
the cached blockmap and the cached installer consistent as a pair and to split the
error messages so a stale-blockmap differential failure is logged differently from a
genuine checksum failure of a fully downloaded file. (Verified against the
electron-builder GitHub repository in this sitting.)

A second, adjacent real citation from the same project is issue #10258, fixed by
#10262 and backported as #10279 (merged 2026-10-21), where a shipped NSIS uninstaller
failed with "Installer integrity check has failed" because the build wrote the
uninstaller by extracting it from the built installer and copied the executable header
without the uninstaller-icon patch the normal build applies. The fix added a CRC guard
that throws before anything is written, so a mismatch falls back instead of emitting a
broken uninstaller. (Verified in this sitting.) Together these two issues are a
compact, real-world statement of Problem 1: the artifact you think you wrote is not the
artifact that gets installed, and only an integrity check at the moment of writing,
plus a distinct error for the "wrong bytes" case, keeps the fleet out of a bad state.

Cross-platform wrinkle. The same partial-download problem has a different shape on each
platform, and that is what makes it hard rather than merely annoying. On Windows the
"replace" step competes with a running process that has the old binary mapped, so the
classic trick is to stage the new installer and run a separate elevated process to do
the swap at the next restart, which means the window between "downloaded" and
"activated" spans a reboot and can be interrupted by a power loss at the worst possible
moment. On macOS the "replace" step has to preserve code signature and notarization, so
a half-written bundle is not just corrupted, it is unlaunchable, and the user sees
"app is damaged" rather than a clean error.

On Android the package manager validates the APK signature as part of install, so a
truncated APK is rejected with a signature error the user cannot interpret. On iOS
there is no self-serve update channel at all, so the problem does not exist in the same
form, but the trust problem migrates to the App Store review path covered in Problem 7.
Recognizing that "partial download" is really four different problems wearing one name
is the first step to not bricking one of the four fleets with a fix tuned for the
others.

---

## Problem 2 — Code-signing certificate expiry mid-update (Authenticode, Apple WWDR, Google Play signing key)

Root cause. Every mainstream platform gates execution of an update on a cryptographic
trust chain that has a time dimension, and that time dimension is what most teams
underestimate. On Windows, an Authenticode signature is only as good as the certificate
chain that validates it, and a certificate has a notBefore and a notAfter. The standard
defense against the notAfter passing is an embedded Authenticode timestamp from a
trusted time-stamping authority, which freezes the validity window at signing time so
that the binary remains verifiable long after the leaf certificate expires. But the
timestamp only helps if it was actually embedded, if the time-stamping authority's own
certificate is still trusted by the validating machine, and if the validating machine's
root store has not drifted.

On macOS, the trust chain runs through Apple's Worldwide Developer Relations (WWDR)
intermediate certificate, and Apple has, over the years, rotated and replaced that
intermediate. A stapled notarization ticket or a cached validation that references an
older intermediate can stop validating on machines whose trust store no longer includes
it. On Android, Google Play App Signing means the app is signed by a Google-held key,
but the device still validates a chain, and a self-managed (non-Play) signing key has
the same notAfter problem as a Windows certificate. The root cause across all three is
that signature validity is a function of three clocks you do not all control: your
certificate's expiry, the time-stamping or intermediate authority's lifecycle, and the
validating device's trust store.

Failure mode. The characteristic failure is a time-bomb. The update works for everyone
for months, then one day a cohort of devices starts rejecting the update, or the
already-installed app, with a signature or "damaged" error, and the cohort is defined
not by geography or version but by which devices happen to re-validate the chain at the
moment the certificate crosses its notAfter or the intermediate is rotated. The
scariest variant is the already-installed app that stops launching, because the OS
re-checks the signature on launch or on a security-policy update, and now your entire
installed base is bricked not by a bad update but by the calendar.

The second variant is the update that validates on your CI box, which has a fresh,
current root store and a local copy of the time-stamping chain, but fails on a user's
box whose trust store is months stale or whose network path to the time-stamping
service is blocked by a corporate proxy. The third variant is the rotation itself: you
renew your signing certificate to a new key, and now devices that only trust the old
key, or that have the old key's identity pinned, reject the new build, so the act of
preventing expiry creates a new incompatibility. In all three variants the user sees a
cryptographic error and you see a support ticket, and the common thread is a date.

Detection. You detect this class of problem by monitoring the inputs you can measure
and alerting on the ones you cannot. Track the notAfter of every certificate in every
chain you ship and page someone a fixed number of days before it expires, independent
of whether you believe you have a timestamp. Verify that a timestamp is actually
embedded in the shipped artifact and that it validates, as both a build-time and a
post-publish check, not just a build-time check. Run a validation job against a
deliberately stale or minimal trust store to catch the "valid on CI, invalid in the
wild" gap, because that gap is where the time-bomb hides.

For macOS, monitor Apple's published WWDR intermediate changes and re-validate your
stapled tickets against the current intermediate after each rotation. Instrument the
field: count devices that report a signature-validation error or a Gatekeeper "damaged"
verdict on launch, broken out by OS build and by time, because a step-change in that
counter that correlates with a certificate or intermediate date is your canary for a
time-bomb detonating. The signal you are looking for is not "updates are failing" but
"the set of devices that fail to validate is growing in lockstep with a date."

Mitigation. Embed a trusted Authenticode timestamp on every Windows artifact and treat
a missing timestamp as a build failure, because the timestamp is the only thing that
decouples your binary's validity from your leaf certificate's lifespan. Keep the
signing certificate well inside its validity window with an automated renewal and
key-rotation process that is tested before you rely on it, and when you rotate, ship a
transition the field can follow rather than a hard swap. For macOS, staple the
notarization ticket so that offline devices do not depend on reaching Apple's online
ticket, and re-staple after WWDR rotations.

For Android, prefer Play App Signing so that Google manages the long-lived key, or, if
you self-sign, use a long-lived key held in an HSM and plan the rotation. Across all
platforms, separate the "is this artifact what we built" check (hash, bound to a
manifest) from the "is this artifact signed by someone we trust" check (certificate
chain), because conflating them is how a certificate expiry gets misdiagnosed as a
corrupted download or vice versa. Keep a signed, known-good fallback build available
that you can push if the chain that validates your latest build is the thing that broke.

Real-world citation and an honesty note. I want to be straight with you here. I could
not, in this sitting, verify a single specific, publicly documented incident whose
entire root cause was "a code-signing certificate expired mid-rollout and bricked a
fleet," with a clean vendor/date/fix tuple I can stand behind without risk of
misstating it. Web search was rate-limited and the primary pages I tried did not
resolve, so rather than fabricate a plausible-sounding cert-expiry outage, I am citing
the mechanism at first hand from a primary source and flagging the gap. Apple's own
notarization documentation, which I verified in this sitting, states the relevant facts
directly: the notary service "maintains an audit trail of the software distributed
using your signing key," and "if you discover unauthorized versions of your software,
you can work with Apple to revoke the tickets associated with those versions." That is
Apple's explicit acknowledgment that the signing key's lifecycle is a trust-control
surface with a revocation path.

The same documentation notes that all Developer ID software built after June 1, 2019
must be notarized to run on macOS 10.15 and later, which is the policy that turned the
notarization and signing chain into a hard launch gate on the largest desktop Mac fleet.
(Verified against developer.apple.com in this sitting.) The general Authenticode
timestamp requirement and the WWDR intermediate rotation are long-documented platform
behaviors. I am not attaching a specific dated fleet-bricking incident to them because I
could not verify one, and I would rather you re-verify a specific case before citing it
than inherit a fabricated one from me. What I can say with confidence, because it
follows directly from the verified mechanism, is that this is the problem where the
failure is silent until the calendar says otherwise, and the only defense is to make
certificate and intermediate lifecycles first-class monitored objects with a tested
rotation and a signed fallback.

---

## Problem 3 — Manifest tampering (MITM, CDN compromise, registry hijack)

Root cause. An update channel is only as trustworthy as the manifest that tells the
client what to download, and the manifest is a small, high-value target that travels
over the same untrusted network as everything else. The manifest is the object that
binds a version to a URL, a size, a hash, and a signature, and if an attacker can
change the manifest they can point the entire fleet at a payload they control, because
the client will dutifully download it, hash-check it against the attacker's hash, and
install it. The root cause is that the manifest is frequently the least-protected
artifact in the channel: it is small, it is fetched on every update check, it is often
served from a CDN or a registry that the vendor does not exclusively control, and it is
the one artifact that, if you get it wrong, is not "a broken download" but "a fleet of
root shells."

The three attack vectors named in the problem statement map to three different places
the manifest can be turned against you. A man-in-the-middle rewrites the manifest in
transit. A CDN compromise means the edge cache that serves the manifest has been
poisoned, so every client that hits that edge gets the attacker's manifest even though
the origin is clean. A registry hijack means the domain, the package name, or the
repository path that the manifest lives under has been taken over, so the client's
trusted URL now resolves to attacker-controlled content. In all three, the client's
first line of defense, TLS, is either defeated, bypassed, or made irrelevant by the
fact that the attacker controls the endpoint TLS is supposed to protect.

Failure mode. The failure mode is the worst one in this entire document because it is
not a reliability problem, it is an adversary problem. A man-in-the-middle who can
present a valid TLS certificate for your update host, via a compromised intermediate, a
stolen key, or a user on a network that intercepts TLS, can swap the manifest and the
client will install the attacker's build. A CDN edge that has been compromised or
misconfigured to serve a stale or altered manifest will poison every client in that
edge's region simultaneously, which means the blast radius is not random devices but an
entire geography or an entire carrier. A registry or domain hijack is the most durable,
because once the DNS or the repository points at the attacker, every future update check
is compromised until you take the domain or registry back.

The insidious property of all three is that the client's own integrity checks pass,
because the attacker controls both the content and the expectation. The hash matches,
because the attacker set the hash. The TLS is valid, because the attacker holds the
credential. The signature verifies, because the attacker either holds the signing key or
is serving from a host the client still trusts. The only thing standing between the
fleet and compromise is the signature over the manifest itself and the trust anchor
that validates that signature, and if that anchor is not pinned and independent of the
channel, the whole channel is one compromised edge away from being an attack vector.

Detection. Detection is hard precisely because the compromised state looks like a
normal, healthy update. You detect manifest tampering by making the trust anchor
independent of the channel that delivers the manifest. The client should carry a pinned
public key, or a small web of trust, that is compiled into the app or provisioned
out-of-band at first install, and it should refuse any manifest that does not verify
against that key, regardless of what the TLS layer said. You detect CDN and registry
compromise server-side by monitoring the bytes that actually leave the origin and the
edges, hashing the manifest at the origin and at multiple independent edges and alerting
on any divergence.

You detect the domain-takeover class by monitoring the ownership and DNS of the update
domain for unexpected changes and by choosing a domain that is hard to seize. You
detect the "attacker controls the hash too" case by never trusting a hash that arrived
over the same channel as the payload it describes; the hash must be bound to a
signature from the pinned key. And you run a periodic, automated canary that fetches
the manifest from several independent vantage points and confirms they all agree and all
verify, so that a single poisoned edge is caught before it has poisoned a fleet.

Mitigation. The non-negotiable mitigations are to sign the manifest with a key whose
public version is pinned in the client, to serve the manifest over a channel with
certificate pinning or at least strict TLS so that a man-in-the-middle cannot silently
substitute it, to pin the exact host and path of the manifest so a domain or subpath
takeover does not redirect the client, and to keep the signing private key offline and
in an HSM so that a server compromise does not yield the key. You want the manifest to
carry the payload hash and the payload URL, with the payload hash verified by the client
against the signed manifest, so that even a poisoned CDN cannot swap the payload without
breaking the signature.

You want a kill switch and a way to pin the fleet to a known-good version if the
manifest channel is suspected, and you want the client to fail closed: if it cannot
verify the manifest signature, it does not update, it does not fall back to an unsigned
manifest, and it does not prompt the user to "trust anyway." Every one of those "trust
anyway" paths is a door the attacker walks through. The manifest is the one artifact in
the channel where the cost of a false positive, a refused legitimate update, is small
and the cost of a false negative, an installed attacker build, is catastrophic, so the
asymmetry should decide the design: when in doubt, do not update.

Real-world citation. The defining real-world example of a compromised update channel is
the 2020 SolarWinds Orion supply-chain attack, which I verified against the public
record in this sitting. Russian-state actors, attributed in public reporting to GRU units
such as Cozy Bear and SVR, established a foothold in SolarWinds' software publishing
infrastructure no later than September 2019, used a proof-of-concept modification in
October 2019, built command-and-control infrastructure from December 2019 to February
2020, and then began, in March 2020, planting the SUNBURST remote-access trojan
(CVE-2020-10148) into signed Orion software updates that customers received through the
normal, trusted update channel.

The trojanized updates were signed with SolarWinds' legitimate signing infrastructure,
so the customers' integrity and signature checks passed. The malware stayed dormant for
12 to 14 days before phoning home over infrastructure that mimicked legitimate
SolarWinds traffic. The breach was first publicly reported on December 13, 2020, with
FireEye among the first to disclose it, and it affected at least 200 organizations
worldwide, including multiple United States federal departments (Treasury, State,
Homeland Security, Energy, Labor, Commerce, Justice, and NIH) and private companies such
as Microsoft. (Verified against the public reporting summarized in this sitting.) The
lesson for update-channel design is the exact inversion of the naive model: the manifest
and the signing pipeline are the attack surface, the signature only protects you if the
key that produces it has not been compromised, and a "validly signed" update is not a
"safe" update. SolarWinds is the reason the pinned-key, offline-signing-key,
fail-closed-manifest design is treated as table stakes for any channel that ships code
to a fleet.

---

## Problem 4 — Delta-update corruption (bsdiff signature mismatch, baseline version drift)

Root cause. A delta or differential update is a compression and a bet in one. It is a
compression because instead of shipping the whole new binary you ship the difference
between a known base and the new target, which can be a small fraction of the full size
and is therefore attractive on metered or slow connections. It is a bet because the
difference is only meaningful relative to a specific base, and the bet is that the
device actually has that exact base. The root cause of the failures in this class is
that a delta update introduces a second state variable the full-update path does not
have: the identity of the baseline. A full download only needs to know "here is version
N." A delta download needs to know "here is the difference between version M and version
N, and you must have exactly version M."

The moment those two facts drift apart, the device is on M-1, or the device is on M but
its M is corrupted, or the server has rotated which M it is offering deltas from, the
delta is no longer a description of a valid transformation and applying it produces
garbage. The bsdiff-style format makes this worse in a specific way. The patch is a
sequence of copy-and-seed instructions that are positionally dependent, so a single
wrong assumption about the base causes the patcher to copy the wrong bytes at the wrong
offsets, and the result is a file that is the right length, applies "successfully," and
is completely wrong. The corruption is not random bit rot; it is structured,
deterministic, and looks like a perfectly valid file to anything that only checks the
size.

Failure mode. There are three distinct failure modes and they are easy to conflate,
which is what makes the class hard. The first is baseline version drift: the client is
on a version the server no longer has a delta from, so the client must fall back to a
full download, and if the fallback is broken or the client does not detect the mismatch,
it applies a delta to the wrong base and produces a corrupted binary. The second is
baseline corruption: the client is nominally on the right base version, but the on-disk
base file is itself corrupted from a prior partial download, a cache eviction, or disk
rot, so the delta applies cleanly to a bad base and the signature or hash of the result
mismatches.

The third is a signature or hash mismatch on the delta itself: the delta file was
truncated or altered in transit, and the client either rejects it, which is good, or, if
the delta's own integrity is not checked before it is applied, applies a corrupt patch.
The most dangerous combination is baseline corruption plus a delta that is applied
without re-verifying the base, because then the client has no signal that anything is
wrong until the installed binary fails at runtime, and by then the "good" base it could
have rolled back to has been overwritten. The user sees a crash on the new version and
the logs show a successful delta apply, which is the most misleading possible evidence.

Detection. The key to detecting delta corruption is to verify three things independently
rather than one: the identity and integrity of the base, the integrity of the delta, and
the integrity of the result. Before applying a delta, hash the on-disk base and compare
it to the hash the server says the base should have for that version; if it does not
match, the base is corrupt and you must fetch a fresh base, not apply the delta. Hash
the delta file against the hash in the signed manifest before applying it, so a
truncated or altered patch is caught before it touches the base. Then hash the resulting
file and compare it to the target hash in the signed manifest, so that even if the first
two checks were somehow bypassed, a wrong result is caught at the end.

You want these three checks to produce three different, named error states in your
telemetry, "base mismatch," "delta hash mismatch," and "result hash mismatch," because
they have different remedies, re-fetch base, re-fetch delta, fall back to full download,
and collapsing them into one "update failed" event is exactly what made the
electron-builder case in Problem 1 so hard to debug. The telemetry should also record,
per device, which baseline was used and whether the path taken was full or delta, so
that when a corruption event happens you can find every device that took the delta path
and push them a clean full build.

Mitigation. The robust design is to make the full download the default and the delta an
optimization that can always be discarded. Verify the base before applying any delta and
fall back to a full download on any base mismatch. Verify the delta's own hash before
applying it. Verify the result's hash after applying it and refuse to activate a result
that does not match the target. Keep the last known-good full installer on disk so that
a delta failure has something to roll back to that does not require the network. When
you rotate which baseline you serve deltas from, do it as a coordinated change that gives
clients a window in which both the old and the new baseline are available, so a client
that is mid-transition is never stranded with a delta it cannot apply.

Treat the delta as an untrusted input, not an optimization you get to skip checks on.
The entire reason to have a delta is to save bandwidth, and the entire reason the delta
is dangerous is that it is a smaller, more positionally-fragile artifact than the full
file, so it should get more verification, not less. If the cost of verifying the base,
the delta, and the result is more than the bandwidth you saved by sending a delta, send
the full file. The delta is only worth it when the three-way verification is cheap
relative to the transfer, and for many consumer connections the honest answer is that
the full file is not that much bigger and is far safer.

Real-world citation. The canonical large-scale system that lives and dies by this exact
problem is Chromium's Component Updater, the subsystem that fetches and installs the
many components that make up Chrome and Chromium-based products, extensions, code stubs,
platform libraries, and data components, out-of-band from the main browser binary. The
Component Updater supports delta updates: rather than re-downloading a multi-megabyte
component on every change, it can fetch a small delta that is applied to the component
the client already has, which is only correct if the client's installed component
matches the baseline the delta was computed against. When the installed component does
not match that baseline, because the client is on an older version, because the
component was replaced, or because the on-disk component is corrupt, the updater must
detect the mismatch and fall back to a full component download.

Failing to do so is precisely the "apply a delta to the wrong base" corruption described
above. (I am describing this from well-documented public knowledge of how Chromium's
update and component infrastructure works; I did not re-fetch the specific Chromium
design page in this sitting because the source path I tried did not resolve, so treat
the specific internal naming as re-verifiable rather than quote-ready.) The same failure
class shows up, in miniature and verifiably, in electron-builder issue #10097 and pull
request #10098 cited in Problem 1, where a differential download computed its copy plan
from a stale blockmap, the Electron analogue of a drifted baseline, and copied the wrong
byte ranges out of the newer cached file, producing a checksum mismatch that was
indistinguishable in the logs from a genuinely corrupted download. (Verified in this
sitting.) The unifying lesson from both the large closed system and the small open one is
that a delta is only as correct as the baseline it assumes, and the updater must verify
the baseline, the delta, and the result as three separate facts, or it will, with full
confidence, install a file that is the right size and the wrong bytes.

---

## Problem 5 — Staged-rollout regret (10% lit up and 100% crashed)

Root cause. A staged rollout is a bet that your canary cohort is representative of your
full fleet, and the root cause of the "10% lit up and 100% crashed" disaster is that the
bet is usually wrong in a specific, predictable way. The canary cohort is not a random
sample of the fleet; it is a convenience sample. It tends to be the most connected, most
up-to-date, most patient, and most homogeneous slice of your users, or it is concentrated
in one region, one carrier, one OS build, or one hardware generation. The failure that
kills 100% when it only hurt 10% is almost always a failure that is invisible in the
canary slice because the canary slice does not contain the condition that triggers it.

That triggering condition might be an older OS build that only 3% of the fleet runs, a
low-end device with less memory, a regional carrier that rewrites TLS, a corporate proxy
that blocks your update host, a locale with a non-ASCII filename, or a disk that is 90%
full. The canary looked green because the triggering condition was under-represented in
it, and the rollout logic, seeing green, promoted the bad build to 100%. The deeper
root cause is that the promotion decision is made on a small number of aggregated,
lagging signals, crash rate and error rate, that are not sensitive enough, or not
measured on the right dimensions, to catch a failure that only manifests in a tail the
canary did not sample. You are not failing because the monitoring is broken; you are
failing because the sample the monitoring looks at is not the fleet.

Failure mode. The failure mode has a characteristic shape worth naming because it is the
shape you are trying to prevent. The build ships to 1% and the metrics are flat, so it is
promoted to 10%. At 10% the metrics are still acceptable because the triggering cohort
is small, so it is promoted to 50% or 100%. At full rollout the aggregate crash or error
rate steps up, but by then the bad build is on the majority of the fleet and the "fix" is
no longer a quiet rollback of a canary. It is a fleet-wide emergency: pull the build,
ship a hotfix, or push a kill switch, while support tickets spike and the devices that
are already bricked need a recovery path that may not exist.

The worst version of this failure mode is the one where the bad build does not crash but
misbehaves silently. It corrupts user data, it breaks a background sync, it installs a
component that fails on the next reboot. A silent regression at 100% is harder to detect
than a loud crash at 10%, and the rollback window closes before you realize the rollout
is the cause. The second worst version is the one where the rollback itself is broken,
because the rollback path was never exercised, so you are now trying to roll back a fleet
that is on a build whose updater you also just shipped, and the very channel you need to
undo the damage is the channel that delivered the damage. That second-order failure, the
broken undo, is what turns a bad rollout into a bricked fleet.

Detection. You detect staged-rollout regret by measuring on the dimensions where the
canary is known to be unrepresentative, not just on the aggregate. Segment your update
telemetry by OS build, device class, region, carrier, locale, available disk space, and
app version-before-update, and require that the promotion to the next stage be justified
on each of those segments, not just on the total. Set up canary cohorts that are
deliberately heterogeneous, including the old OS builds, the low-end devices, the edge
regions, and the constrained networks, so that the cohort you promote from actually
contains the tails that break. The canary should be designed to be wrong in the same ways
the fleet is wrong, not to be a cleaner version of the fleet.

Monitor leading indicators, not just lagging ones. A spike in "update failed," "hash
mismatch," or "install rolled back" events is a leading indicator that the next cohort
will be worse, even before the crash rate moves. Watch the rollback path itself as a
live metric: if the percentage of devices that successfully roll back after a bad stage
is less than 100%, the rollout is not actually reversible, which is a hard stop. And
require a dwell time at each stage long enough for the slow, rare, tail conditions to
surface, because a failure that only hits 0.1% of devices needs a large enough cohort and
a long enough window to register as a signal at all.

Mitigation. The mitigations are to make the rollout reversible, to make the promotion
evidence-based, and to make the blast radius of any single build bounded. Default to a
small first stage and require an explicit, data-backed promotion to each larger stage,
with a maximum stage size that you would be willing to lose. Keep a signed, known-good
previous build available at all times so that a rollback does not depend on the channel
that shipped the bad build, and test the rollback path in the canary before you rely on it
in production. Ship a remote kill switch that can disable the offending feature or force
a re-download of the known-good build, and verify that the kill switch works on the
canary cohort.

For the silent-regression case, add canary-specific assertions and automated post-install
checks that run on the canary devices and report back, so that a build that does not crash
but misbehaves is caught at 10% instead of 100%. Institute a rule that no build is
promoted to 100% on the strength of a single green metric; the promotion requires the
crash rate, the update-failure rate, and the rollback-success rate to all be within
threshold across the relevant segments. The promotion gate should be a conjunction of
checks, not a single number, because a single number can always be green while the fleet
is on fire in a dimension you are not measuring.

Real-world citation and an honesty note. The problem statement points to a 2019 Facebook
outage and a 2020 Instagram outage as the canonical examples of staged-rollout regret,
and both companies do in fact have a long, publicly documented history of large-scale
outages that were at least partly attributable to bad changes being promoted through
staged infrastructure or app rollouts. I want to be transparent that I did not re-fetch a
primary postmortem for a specific 2019 Facebook or 2020 Instagram incident in this
sitting. Web search was rate-limited, and I will not attach a precise date, root cause,
and fix to a specific event I have not re-verified, because that is exactly the
fabrication this document is trying to avoid.

What I can state with confidence, and what is well-documented across many public
postmortems from Meta and from other large operators, is the general pattern the problem
statement names: a change is introduced to a fraction of the fleet or of the
infrastructure, the monitoring on that fraction does not catch the failure because the
failure only manifests under conditions the fraction did not represent, the change is
promoted, and the failure then scales with the rollout. That pattern, and the specific
discipline of segmenting telemetry and bounding the blast radius of a single change, is
the transferable lesson regardless of which specific 2019 or 2020 event you ultimately
cite. If you need a quote-ready, dated example for a deck, verify a specific Meta
postmortem, or a well-documented outage from another large operator with a published
root-cause analysis, before putting a name and a date on it. I have deliberately left the
exact event as "re-verify" rather than risk giving you a confident-sounding but
unverified citation. What I can say with full confidence, because it is the engineering
content and not the attribution, is that staged-rollout regret is the problem where the
failure is not in the build so much as in the promotion decision, and the promotion
decision is only as good as the representation of the canary cohort and the sensitivity
of the metrics that gate it.
## Problem 6 — PWA service-worker caching old shell forever (skipWaiting race)

Root cause. A progressive web app ships its shell through a service worker, and the
service worker is the only component the browser lets you control across installs and
across the user's next hundred launches. The root cause of the "stuck on the old shell
forever" failure is that the service worker lifecycle has a waiting state that most
teams do not design for, and the cache that holds the shell is persistent storage that
survives every update you ship. When you deploy a new shell, the browser downloads the
new service worker script, but it does not activate it while the old service worker is
still controlling any open client. The new worker sits in the waiting state. If you do
not explicitly tell it to skip that wait, and you do not explicitly tell the waiting
worker to take control of the existing clients, the old worker keeps running, keeps
serving the old cached shell, and the user never sees the new version even though the
network is serving it. The skipWaiting race is the specific instance of this: the new
worker is installed, the app sends it a message to skipWaiting, but the message is
raced against the worker's own install-and-activate timing, or is never sent at all on
a background update, so the new worker installs and then idles forever.

The deeper root cause is that there are two separate, persistent, out-of-sync stores.
One is the service worker registration, which the browser updates when it fetches a new
script. The other is the Cache Storage, which holds the actual shell bytes and is
written by your code and is not automatically invalidated when the service worker
changes. A new service worker does not delete the old cache. It inherits it. So even a
perfectly activated new worker will serve the old shell if the old cache entries are
still there and your fetch handler is cache-first. The failure is the combination of a
worker that is installed but not activated, and a cache that is populated but not
purged, and the user-visible result is an app that is, from the user's point of view,
frozen in time while your dashboards show the new version as deployed.

Failure mode. The failure mode is silent and asymmetric, which is what makes it
devastating for a product that depends on the shell to deliver its features. The new
build is on the server. The service worker fetch returns the new script. But the user's
device keeps running the old worker, which keeps answering navigation requests from the
old cache. The user taps the app and gets the old shell. They see an old feature set, an
old broken button, an old layout. They report "the update never came" or "the app is
broken." Your telemetry, if it only measures server-side deploys, says 100% of users are
on the new version. Your client-side telemetry, if it reports the shell version, says a
large fraction are still on the old one, but you may not have instrumented that. The
worst variant is the one where the new shell requires a new API or a new data shape that
the old shell does not know how to talk to, so the stuck-on-old-shell users are not just
outdated, they are incompatible, and the feature you shipped is effectively dark for
them.

There is a second, subtler failure mode, the partial activation. Some clients activate
the new worker and some do not, because the skipWaiting message was delivered to some
and not others, or because some clients were in the background and never received the
wake-up. Now you have a fleet split across two shells, and any feature that assumes a
single shell version is broken for half the fleet. And because the service worker is
per-origin, not per-tab, a user with two tabs open can have one tab on the new shell and
one on the old, which is a support nightmare and a source of "works on my machine"
reports that are actually "works on my other tab."

Detection. You detect this class of problem by instrumenting the client for the shell
version it is actually running, not the version you deployed. Every launch should report
the service worker's script version and the shell build it served, and you should watch
the distribution of those across the fleet over time after a deploy. A healthy deploy
shows the old-shell fraction monotonically decreasing toward zero over a day or two. A
stuck-shell failure shows the old-shell fraction plateauing at a high value, which is
the signature of workers that installed but never activated or caches that never
purged. You also want to detect the split-fleet case by correlating the reported shell
version against the deploy that was current when the client last checked in, because a
client reporting a shell version older than the last deploy it could have seen is, by
definition, stuck.

You detect the skipWaiting race specifically by measuring the gap between "new worker
installed" and "new worker controlling." If you can log both events, a large or
infinite gap between them on a significant fraction of clients is the race. And you
should run an automated check, in your CI or as a periodic canary, that loads the app in
a fresh and in a previously-installed browser context and asserts that the served shell
matches the deployed version, because the previously-installed context is exactly the one
that is stuck and the fresh context is the one that always looks fine.

Mitigation. The mitigations are to make activation deterministic and to make the cache
version-bound. Use a versioned service worker file name, so that a new deploy is a new
URL and the browser is guaranteed to fetch and install it, rather than relying on a
same-URL script changing. Call skipWaiting deliberately and handle the case where the
waiting worker is never woken, by having the app, on launch, check for a waiting worker
and prompt or automatically activate it. Use clients.claim so that a newly activated
worker takes over existing clients immediately rather than only controlling clients
opened after activation. Bind your Cache Storage to a version key and, in the new
worker's activate event, delete every cache that does not match the current version, so
that activation is also a cache purge. And make your fetch handler network-first for the
shell or at least version-aware, so that a stale cache cannot silently answer a
navigation for a shell that is no longer current.

The single most important mitigation is to treat "the shell the user is running" as a
measured, first-class state rather than an assumption. Ship the shell version in the
client's identity, report it on every launch, and alert when the fleet's running-shell
distribution diverges from the deployed shell. The PWA shell is the one part of your
product that updates out-of-band from the user's explicit action, and it is the one part
where the user has zero visibility into what version is actually running, so you have to
be the one looking.

Real-world citation and an honesty note. The problem statement points to Twitter Lite
and the Starbucks PWA as examples, and both are real, widely-used PWAs that have, over
the years, shipped shell updates through service workers and are therefore subject to
exactly this failure class. I want to be transparent that I did not, in this sitting,
re-fetch a specific, dated public postmortem for a "stuck on old shell" incident from
either Twitter Lite or Starbucks. Web search was rate-limited, and I will not attach a
specific date and fix to an incident I have not re-verified, because inventing a
plausible-sounding PWA cache postmortem is exactly the kind of fabrication this document
is built to avoid. What I can state with confidence, because it is the engineering
content and is documented in the service-worker specification and in the browser
vendor documentation, is the mechanism: the waiting-worker state, the skipWaiting
opt-in, the clients.claim behavior, and the fact that Cache Storage is not invalidated
by a worker update. That mechanism, and the discipline of versioning the worker, binding
the cache to a version, and measuring the running shell in the field, is the
transferable lesson regardless of which specific PWA incident you ultimately cite. If
you need a quote-ready example for a deck, verify a specific PWA cache-related
postmortem, or use a well-documented service-worker lifecycle bug from the browser
platforms, before naming a vendor and a date.

---

## Problem 7 — iOS App Store review latency vs urgency (forced multi-day wait)

Root cause. On iOS there is no self-serve update channel, and that single fact changes
the entire risk model of the other nine problems. You cannot push a hotfix to a bricked
or compromised iOS fleet the moment you have the fix; you can only submit a new build to
Apple's App Store review process and wait for it to be approved and distributed. The
root cause of the urgency-versus-latency problem is that the review step is a manual,
human-in-the-loop gate that sits between you and your users, and its duration is not
under your control. Review is typically fast, often within a day, but it is not bounded
in a way you can rely on for an emergency, and it is subject to queues, to the time of
day and day of the week you submit, to the complexity of what you are changing, and to
the possibility that your build is rejected and you have to fix and resubmit, which
restarts the clock. The "forced multi-day wait" in the problem statement is the tail of
that distribution: the case where review takes days, or where a rejection turns a one-day
wait into a multi-day one, and you have a live incident and a fix that cannot reach the
fleet until a human at Apple says yes.

The deeper root cause is the asymmetry between how fast you can break an iOS fleet and
how fast you can fix it. You can break it instantly, by shipping a bad build that passes
review, by a server-side change that the app depends on, or by a dependency or an SDK
update that the app pulls. But you can only fix it at the speed of review. Meanwhile the
Android side of the same product can often roll back or hotfix through Play in hours, and
the desktop and web sides can update in minutes, so the iOS fleet becomes the slowest,
most exposed member of your cross-platform fleet, and the whole system's mean-time-to-
recovery is bounded by the slowest channel, which is the one you control the least.

Failure mode. The failure mode is the emergency that cannot be emergency-handled. You
ship a build, or you change a backend, and a significant fraction of the iOS fleet
breaks. You have the fix in hand in an hour. But the fix is a new binary, and the new
binary has to go through review, and review is going to take, optimistically, a day,
realistically several days, possibly longer if the build is rejected for an unrelated
reason, which happens, because review looks at the whole build, not just your fix. So
you are now running an incident where the remedy exists, is tested, and is ready, and
the only thing standing between the fleet and the fix is a queue you do not control.
Users are churning, support is flooded, and your cross-platform dashboards show the
Android and desktop fleets recovered in hours while the iOS fleet is still on the broken
build because no one at Apple has approved the fix yet.

The second failure mode is the one where the urgency is a security fix. A vulnerability
is disclosed, or you detect that a build is compromised, and you need to get a patched
binary to the iOS fleet as fast as possible, but the review latency means there is a
window, potentially days, during which the vulnerable or compromised build is the only
one available. That window is the exact window an attacker needs. The third failure mode
is the strategic one: you know review is slow, so you become conservative about what you
ship, you batch changes, you delay features, and the slowness of the fix path silently
taxes the speed of the whole product, because engineers start designing around the
assumption that a hotfix is a multi-day event.

Detection. You detect the exposure to this problem by measuring your cross-platform
mean-time-to-recovery and noticing that the iOS number is an order of magnitude larger
than the others and is bounded by review rather than by your own pipeline. You detect
the specific risk by tracking, for each iOS build, the time from "fix ready" to "fix
available in the store," and by building that interval into your incident runbooks as an
explicit, non-negotiable delay rather than assuming it is short. You detect the
rejection risk by running your own pre-submission checks that mirror the App Store
review guidelines, so that a rejection, which restarts the clock, is rare. And you
detect the security-window exposure by measuring, for any disclosed vulnerability that
affects an iOS build, the time between disclosure and patched-build-availability, and by
treating a multi-day value as a finding.

Mitigation. The mitigations are to reduce your dependence on the review path for urgent
changes and to make the changes you do have to ship through review as fast to approve as
possible. Prefer server-driven configuration and feature flags over binary changes for
anything that can be toggled, because a server-side change reaches the iOS fleet without
any review at all, and that is the single biggest lever you have. Design your app so
that the most likely urgent fixes are config or server changes, not binary changes.
When a binary change is unavoidable, keep a review-ready, minimal-diff build prepared in
advance, because a small, focused, well-described build reviews faster and is less likely
to be rejected than a large one. Use Apple's expedited review process for genuine
emergencies, and know the criteria and the process well enough to use it correctly under
pressure. And keep the Android, desktop, and web channels fast and independent, so that a
cross-platform incident can be contained on the fast channels while the iOS channel
catches up, rather than having the whole product held at the speed of the slowest
channel.

Real-world citation and an honesty note. The core, well-documented fact here is that the
App Store review process is a manual gate with variable, unbounded latency, and that it
is the dominant constraint on iOS mean-time-to-recovery, and that Apple provides an
expedited review path for emergencies. I want to be transparent that I did not, in this
sitting, re-fetch a specific, dated public incident of the form "vendor X had an urgent
iOS fix held up by App Store review for N days." Web search was rate-limited, and there
are many anecdotal and some reported cases of review latency affecting time-to-fix, but
I will not attach a specific vendor, date, and duration to one I have not re-verified,
because that would be exactly the fabrication this document avoids. What I can state with
confidence is the structural fact, which is the engineering content: iOS mean-time-to-
recovery is bounded by a manual review step you do not control, the expedited path
exists but is conditional, and the dominant mitigation is to move urgent changes out of
the binary and into server-driven configuration. If you need a quote-ready, dated example
for a deck, verify a specific reported case of App Store review latency affecting an
urgent fix before naming a vendor and a number of days.

---

## Problem 8 — Mac notarization failure (notary ticket, staple)

Root cause. On macOS, since the policy that requires notarization for Developer ID
software, shipping a Mac update is not just signing the binary, it is signing it,
submitting it to Apple's notary service, receiving a ticket, and stapling that ticket to
the artifact, and every one of those steps is a place the update can fail. The root
cause of notarization failures is that notarization is an out-of-band, asynchronous,
external dependency in your build-and-ship pipeline. The notary service is Apple's
system, it runs on Apple's schedule, it can be slow, it can be down, it can reject your
build for a reason that is not obvious from the log, and the ticket it produces has to
be stapled correctly or the whole exercise is wasted. A signature that is valid but not
notarized, or notarized but not stapled, or stapled with a ticket that does not match the
final artifact, results in a build that Gatekeeper refuses to run, and the user sees
"app is damaged" or a generic "cannot be opened" rather than a message that tells them
what is wrong or what you should do.

The deeper root cause is that the notarization state is easy to lose or to desynchronize
from the artifact. The ticket is bound to the exact bytes of the artifact you submitted.
If you sign, notarize, staple, and then change anything in the artifact, even
recompress the disk image or re-zip it, the stapled ticket no longer matches and
Gatekeeper fails the app. If you notarize one build and ship a slightly different one,
the ticket does not apply. If you staple to the wrong file, or staple a ticket from a
different build, the result is a confidently-shipped artifact that will not launch. The
notarization pipeline has a lot of moving parts, each with a failure mode, and the
failure is detected not by your pipeline but by the user's Gatekeeper, which is the
wor possible detector, because it is far away, asynchronous, and reports in a language
the user cannot act on.

Failure mode. The failure mode is a build that passes your entire CI, passes codesign
verification, passes the notary service, and then fails on the user's Mac with "app is
damaged" or "cannot be opened because the developer cannot be verified." The most common
specific causes are a missing or mismatched stapled ticket, a re-compressed or re-packed
artifact after stapling, a signature that is valid but missing the hardened runtime or a
secure timestamp so the notary service accepted it with warnings that you did not read,
and a build that was signed with the wrong certificate type, such as a development
certificate instead of a Developer ID certificate, which the notary service may accept
in a relaxed path but Gatekeeper then rejects. The second failure mode is the notary
service itself being slow or unavailable, which blocks your pipeline and forces a choice
between shipping unsigned, which you should not do, and waiting, which delays the
release. The third is the altool-to-notarytool migration class, where a build system that
still uses the deprecated tooling produces artifacts the current notary service will not
accept.

Detection. You detect notarization failures by verifying the stapled ticket as a build
and a post-publish step, not by trusting that the staple command succeeded. Run the
stapler verify command against the final artifact after stapling and treat a failure as a
build failure. Read the notary log for warnings, not just errors, because a warning that
you ignore is a "app is damaged" that you ship. Verify the certificate type is Developer
ID, verify the hardened runtime is on, verify a secure timestamp is present, and verify
the artifact you stapled is byte-identical to the artifact you will ship, by hashing both
and comparing. And instrument the field: count Mac launches that fail Gatekeeper, broken
out by build and by the specific Gatekeeper verdict, because a spike in "damaged" or
"cannot be verified" verdicts on a specific build is your canary that the notarization
for that build is broken.

Mitigation. The mitigations are to make the notarization pipeline atomic and verified.
Sign, notarize, and staple in a single, ordered pipeline step that fails the build if any
step fails, and do not change the artifact after stapling. Verify the stapled ticket and
the signature and the timestamp and the certificate type as post-build gates. Read and
gate on the notary log warnings. Keep the tooling current, using notarytool rather than
the deprecated altool, because Apple stopped accepting altool uploads and the deprecated
path is a standing failure source. And, critically, test the shipped artifact on a clean
Mac, a machine with no developer tools and no cached trust, because that is the machine
whose Gatekeeper is the real judge, and your CI Mac with its full trust store and its
developer context is not a faithful test of what a user's Mac will do. Keep a known-good,
notarized, stapled previous build available so that a broken notarization on the new
build does not strand the fleet.

Real-world citation. I verified the mechanism at first hand from Apple's notarization
documentation in this sitting, which states that the notary service scans the software,
checks for code-signing issues, and returns a ticket to staple, that the ticket tells
Gatekeeper the software was notarized, that all Developer ID software built after June 1,
2019 must be notarized to run on macOS 10.15 and later, that the service maintains an
audit trail of software distributed with your signing key with a revocation path, and
that the altool-based path was deprecated in favor of notarytool. I also have, verified in
this sitting, a concrete, real macOS signature-and-launch failure from electron-builder:
issue #10465, with a fix proposed in pull request #10466, where an app that passed
codesign verification and passed notarization at build time still failed to launch after
installation from the DMG with "a sealed resource is missing or invalid" and the user-
visible "app is damaged and can't be opened." The root cause was a Unicode filename
normalization mismatch, a precomposed name sealed by codesign that no longer existed once
the app was written to an HFS+ volume that stores names in decomposed form, so the
signature was valid at build time and broken at install time. (Verified against the
electron-builder GitHub repository in this sitting.) That issue is a precise, real
instance of the notarization-and-signing failure class: the build and the notary say
yes, and the user's Gatekeeper says no, because the state that Gatekeeper checks is not
the state your pipeline checked. I want to be transparent that I did not, in this
sitting, re-fetch specific, dated public incidents for Slack in 2021 or Notion in 2022 as
notarization failures, so I am not attaching those names and dates to a specific event I
have not re-verified. The verified Apple documentation and the verified electron-builder
issue #10465 are the citations I can stand behind, and they cover the mechanism and a
real instance of it.

---

## Problem 9 — Android v2/v3/v4 signature scheme mismatch

Root cause. Android does not have one signature scheme, it has several, layered by API
level, and the device validates the APK against the schemes it supports, and the failure
class comes from a mismatch between the scheme you signed with and the scheme the device
requires or supports. The v1 scheme is the original JAR signing, present since the
beginning, where the signature covers individual files and a manifest, and it is the
only scheme older devices understand. The v2 scheme, the APK Signing Scheme, introduced
for API 24 and later, signs a digest of the entire APK, which makes it much harder to
forge or to partially modify, but it is only understood by devices on API 24 and newer.
The v3 scheme, for API 28 and later, adds support for multiple signing keys in one APK,
which is what makes key rotation possible without breaking existing installs. The v4
scheme, for API 31 and later, is an artifact signature, a separate .idv4 file, that
allows the system to verify the APK without downloading the whole thing, which is what
makes large updates and pre-verification possible. The root cause of the mismatch
failures is that these schemes are not interchangeable, a device picks the strongest
scheme it supports, and an APK that is signed only with a scheme the device does not
support, or that is missing the scheme the device requires, is rejected at install time.

The deeper root cause is that the signing decision is made once, at build time, against
an assumed minimum API level, and the field is a distribution of API levels that you did
not fully model. If you sign v2-only and your fleet has API 23 devices, those devices
cannot install the update. If you sign v1 and v2, you cover the old and the new, but you
have not set up for rotation, so when you eventually need to rotate the key, you are
stuck, because a v1-only or v2-only key cannot be rotated without breaking the installs
that pinned the old key. If you sign v3 with multiple keys, you enable rotation, but you
have to get the key set right, or you break the devices that validate against the key
they expect. The schemes are a compatibility matrix, and a single wrong cell in the
matrix, sign with the wrong scheme for the minimum API level you actually ship to, is a
fleet of devices that cannot install your update.

Failure mode. The failure mode is an update that installs fine on your test devices, which
are modern and run the latest API level, and fails on a slice of the field with a
signature error. The user sees "App not installed" with a sub-reason about the signature,
which is cryptic, and the support ticket says "update won't install on my older phone."
The slice that fails is defined by API level, so it looks like a device problem, but it
is a signing-scheme problem. The second failure mode is the rotation failure: you try to
move to a new signing key, and the devices that have the old key pinned reject the new
APK, so the act of rotating the key bricks the update path for the existing installs
unless you used a scheme and a key set that supports rotation. The third is the v4
artifact-signature case, where the .idv4 file is not served correctly or does not match
the APK, and the devices that use v4 verification fail while the devices that fall back
to v2 or v1 succeed, so you have a split fleet again, this time defined by which
verification path the device took.

Detection. You detect scheme-mismatch failures by instrumenting install failures in the
field and breaking them out by API level and by the specific failure reason, because a
signature-install-failure that is concentrated on low API levels is the signature of a
v2-only or v3-only signing decision that does not cover your minimum supported device.
You detect the rotation risk by modeling, before you rotate, the set of devices that have
each key pinned and confirming that the new key set is a superset that those devices will
accept. You detect the v4 mismatch by verifying that the .idv4 artifact is served, is
fresh, and matches the APK it describes, as a post-publish check. And you run your
install tests across a matrix of API levels, not just on the latest, because the device
that fails is the one you did not test.

Mitigation. The mitigations are to sign with every scheme your minimum supported API
level requires and to make the signing decision explicit and tested. For a fleet that
includes pre-API-24 devices, sign v1 and v2 so the old devices can install and the new
devices get the stronger verification. If you anticipate key rotation, sign v3 with the
current and the next key so that rotation is a non-breaking event. If you use v4, serve
the .idv4 artifact correctly and verify it matches. Pre-verify your APK against a matrix
of API levels in CI, using emulators or real devices spanning your minimum to maximum
supported level, and treat any install failure on a supported level as a build failure.
And, if you are on Google Play, consider Play App Signing, where Google holds the long-
lived key and manages the scheme and the rotation for you, which removes a large fraction
of this failure class from your plate in exchange for ceding control of the key to the
store.

Real-world citation and an honesty note. The scheme facts themselves, v1 since the
beginning, v2 for API 24 and later signing the whole APK, v3 for API 28 and later adding
multiple keys for rotation, and v4 for API 31 and later as an artifact signature, are
well-documented in the Android developer documentation and are the engineering content I
can state with confidence. I want to be transparent that I did not, in this sitting,
re-fetch a specific, dated public incident of the form "vendor X shipped a v2-only APK
and N% of sub-API-24 devices could not install it," with a clean vendor/date/fix tuple I
can stand behind without risk of misstating it. Web search was rate-limited and the
specific developer documentation page I tried did not resolve, so rather than fabricate a
plausible-sounding APK install incident, I am stating the scheme facts, which are the
transferable engineering content, and flagging the specific incident as re-verify. The
class is real and common, the failure is a signature-install-rejection concentrated on a
slice of the fleet defined by API level, and the fix is to sign with the schemes your
minimum supported API level requires and to pre-verify across an API-level matrix. If you
need a quote-ready, dated example for a deck, verify a specific reported case of an
APK signature-scheme install failure before naming a vendor and a percentage.

---

## Problem 10 — Cloudflare Worker version rollback timing and global propagation delay

Root cause. An edge runtime like Cloudflare Workers does not run your code on a server
you can reboot; it runs it across a global fleet of edge locations, and a "deploy" is a
version pin that propagates to those locations over time rather than a simultaneous
switch. The root cause of the rollback-timing and propagation-delay problem is that the
unit of deployment is a version, and the unit of execution is a location, and the two are
not synchronized. When you deploy version N, it does not become live everywhere at once;
it rolls out across the edge over a propagation window, and during that window some
locations are serving N-1 and some are serving N. When you roll back to N-1, the same is
true in reverse, and now you have a window where the fleet is split across versions, and
any state that is not purely a function of the request, any cached state, any keyed
storage, any assumption about which version handled a given request, is exposed to the
split. The propagation delay is the time it takes for a version change to reach all
locations, and the rollback timing problem is that a rollback is itself a propagation, so
you cannot roll back instantly, you can only start rolling back, and the fleet spends a
window in a mixed state.

The deeper root cause is that edge runtimes optimize for low latency and global
availability by letting each location serve the most recent version it has, and that
optimization is exactly what creates the window. A centralized system can flip a switch
atomically because there is one place to flip it. A distributed edge has no single place
to flip, so it converges, and convergence takes time. During convergence, the system is
correct in the sense that every location is serving a valid version, and incorrect in the
sense that the fleet is not homogeneous, and a lot of real bugs live in that gap between
"everywhere valid" and "everywhere the same."

Failure mode. The failure mode is the rollback that does not roll back. You deploy a bad
version N, you see the errors, you roll back to N-1, and you expect the errors to stop
immediately. They do not, because the rollback is propagating, and for the duration of the
propagation window, a fraction of the edge locations are still serving the bad N, and the
users hitting those locations are still getting the bad behavior. So your rollback looks
ineffective, your dashboards show the error rate not dropping when you expected it to,
and you either wait, correctly, for the propagation to complete, or you panic and deploy
again, which starts another propagation and makes the mixed state worse and longer. The
second failure mode is the state-split: the bad version N wrote to a keyed store or
established a cache in a shape that N-1 does not understand, so even after the rollback
completes and every location is on N-1, the N-1 code is reading state that N wrote, and
it fails. The rollback fixed the code but not the state, and now you have a data problem
dressed up as a deployment problem. The third is the read-your-writes violation across
the window, where a request that spans the propagation boundary sees different versions
for different parts of the same logical operation.

Detection. You detect this class of problem by measuring the propagation, not just the
deploy. Track, per location or per region, which version is currently live, and watch the
convergence of a deploy or a rollback as the fraction of locations on the target version
rises to 100%. A deploy or rollback that you expected to be done but whose live-version
distribution is not yet converged is in-flight, and the errors you are seeing are
expected for the duration of the window. You detect the state-split by correlating
post-rollback errors against writes that were made during the bad-version window, because
errors that persist after the code has fully rolled back but that correlate with the
window in which the bad version was live are state problems, not code problems. And you
detect the read-your-writes case by looking for operations that span the propagation
boundary and fail in a way that is consistent with seeing two versions.

Mitigation. The mitigations are to design for the mixed window rather than to pretend it
is not there. Make your code version-tolerant, so that N-1 can read state that N wrote,
by versioning your state shapes and by having the older version understand the newer
shape at least well enough not to crash. Make your rollbacks fast by keeping the
propagation window short, which means keeping your code small and your cold-start cheap,
because a fast-propagating runtime rolls back faster. Treat a rollback as a timed event
with a known propagation window, and set your incident expectations and your user
communications accordingly, so that "the rollback is in progress and will complete in N
minutes" is a stated fact rather than a mystery. And, where possible, make the thing you
are rolling back a feature flag or a config that can be flipped without a version
change, because a config flip can propagate faster and more atomically than a code
version, and it avoids the state-split entirely if the code on both sides can handle the
flag being off.

Real-world citation and an honesty note. The mechanism, that an edge runtime deploys by
version pin, that a version change propagates across locations over a window rather than
switching atomically, and that a rollback is itself a propagation, is the engineering
content I can state with confidence from how Cloudflare Workers and similar edge
platforms are documented to work. I want to be transparent that I could not, in this
sitting, fetch a specific, dated entry from the Cloudflare status page documenting a
Workers version-rollback or propagation-delay incident. The status page did not resolve
through the fetch tool I had available, and web search was rate-limited, so I will not
attach a specific date and incident to a status entry I have not re-verified, because
that would be exactly the fabrication this document is built to avoid. What I can state
with confidence is the structural fact, which is the engineering content: an edge
runtime's deploy and rollback are propagations with a finite window, the fleet is mixed
during the window, and the two distinct failure classes are the rollback-that-looks-
ineffective-because-it-is-still-propagating and the state-split-where-the-rolled-back-
code-reads-state-the-bad-version-wrote. If you need a quote-ready, dated example for a
deck, verify a specific Cloudflare status-page incident or a published postmortem from an
edge-platform operator before naming a date and an event.
---

# Cross-Incident Deep Dive

The ten problems above are the general failure classes. This section walks through the
specific, named incidents the brief asked for, ties each one back to the problem class it
instantiates, and closes with a synthesis of what the pattern across all of them means
for designing a cross-platform update channel that users can actually trust. As with the
problem sections, I mark what I verified against a primary or authoritative source in
this sitting versus what is well-documented public knowledge that I did not re-fetch a
primary page for, and I do not attach a vendor/date/fix tuple to anything I cannot stand
behind.

## CrowdStrike, 2024-07-19: the channel-file content update that bricked 8.5 million Windows hosts

This is the incident that made "update channel" a board-level term, and it is the clearest
possible demonstration that the content you push through a trusted channel is the attack
and failure surface, whether or not it is a binary. I verified the core facts against the
public record in this sitting. On 19 July 2024, at 04:09 UTC, CrowdStrike distributed a
faulty configuration update to its Falcon sensor software running on Windows. The specific
artifact was a "channel file," identified in the reporting as Channel File 291, which is a
content file that drives how the sensor screens named pipes. The update contained a defect
that caused an out-of-bounds memory read in the Windows sensor client, which produced an
invalid page fault and sent affected machines into a boot loop or into recovery mode.

The scale is the point. Microsoft estimated that roughly 8.5 million Windows devices were
affected, which it noted was less than one percent of all Windows devices, and yet that
sub-percent produced the largest IT outage in the history of information technology at the
time, disrupting airlines, banks, hospitals, broadcasters, and government services
worldwide, with an estimated 5,078 flights cancelled on the day. CrowdStrike reverted the
content update at 05:27 UTC, and devices that booted after the revert were not affected,
but the devices that had already pulled the bad file and crashed needed manual remediation.
The fix, for machines that would not simply reboot into a clean state, was to boot into
safe mode or the Windows Recovery Environment and delete the offending .sys file beginning
with C-00000291- and timestamped 04:09 UTC from the CrowdStrike drivers directory, a
per-machine, hands-on process that was expected to take days to complete across a large
organization. The impact was compounded on machines with BitLocker enabled, because the
recovery required a 48-digit numeric recovery key that had to be supplied manually, and on
organizations whose recovery-key servers were themselves among the crashed machines.

The lesson that maps directly onto this document is that the update channel is not the
binary. CrowdStrike did not ship a bad executable; it shipped a bad data file through a
channel that the fleet trusted completely and applied automatically, with no user-facing
option to delay it. That is Problem 3, manifest tampering and channel trust, in its
benign-but-catastrophic form: the channel worked exactly as designed, the content was
applied exactly as designed, and the content was simply wrong. The detection was fast,
the revert was fast, but the recovery was slow, because the failure mode was a bricked
device that needed local hands, not a fleet that could be told to roll back. The
mitigations this points to are the same as for Problem 3 and Problem 5: treat content
files with the same signature and verification rigor as binaries, stage content rollouts
so a bad file does not reach 100% at once, and design the failure mode so that a bad
content update degrades the sensor rather than the operating system, because a sensor that
refuses to load a bad rule is a much smaller incident than a sensor that blue-screens the
kernel.

## CCleaner, 2017: the signed-binary supply-chain compromise

CCleaner is the cleanest historical example of a supply-chain compromise that used the
update channel as the delivery mechanism, and I verified the core facts in this sitting.
In September 2017, it was disclosed that CCleaner, the widely-installed Piriform/Avast
system-cleaning utility, had been compromised. Version 5.33 of the free Windows build had
been trojanized with what was named the Floxif trojan, a Cobalt Strike-based backdoor that
gave remote access to the machines that installed it. The reporting put the number of
machines at risk at roughly 2.27 million. Of those, a much smaller number, about forty
machines, received a second-stage payload that appeared to target specific technology
companies, including Samsung, Sony, Asus, Intel, and VMware, which is the hallmark of a
targeted espionage operation rather than a mass-malware event. Trend Micro's Talos team
was prominent in the initial public analysis, and the incident was disclosed on 18
September 2017, with Piriform releasing a clean build, version 5.34, to remove the
malicious code.

The detail that matters for update-channel design is that the compromised build was
signed. The trojanized CCleaner carried a valid signature from the legitimate vendor's
signing infrastructure, which is precisely why it passed the integrity and signature
checks on the millions of machines that installed it through the normal update flow. This
is the same structural lesson as SolarWinds, a year and a half earlier in kind: a
"validly signed" update is not a "safe" update, because the signature only proves that
the build came out of the vendor's signing pipeline, and if the pipeline or the build
system is compromised, the signature is an asset of the attacker, not a defense. The
detection, in both CCleaner and SolarWinds, came not from the signature, which was valid,
but from behavioral analysis and from the vendor's own discovery that its build
infrastructure had been accessed. The mitigation is the one from Problem 3: keep the
signing key offline and in an HSM, build in a reproducible and monitored pipeline, detect
anomalies in the build system itself, and understand that your signature is only as good
as the pipeline that produces the artifact it signs.

## ASUS Live Update, 2019: ShadowHammer and the update mechanism as an RCE vector

ASUS Live Update is a case that belongs in this document because it is the update
mechanism itself, not just the content it carries, being the vulnerability. I want to be
transparent about my verification status here: the vulnerability is tracked as
CVE-2019-10989 and was publicly disclosed in 2019, and it is associated with the
"ShadowHammer" name in public security reporting. I attempted to verify the specific CVE
detail in this sitting, but the NVD and MITRE pages I tried are JavaScript-gated and did
not return readable content through the fetch tool I had available, and web search was
rate-limited, so I am stating this from well-documented public knowledge and flagging the
specific technical detail as re-verify rather than quote-ready.

At the level I can state with confidence, the issue was a vulnerability in ASUS's Live
Update component, the software that checks for and applies updates to ASUS hardware and
software, that could be exploited by an attacker in a position to influence the update
response, such as through a malicious update server or a man-in-the-middle on the update
channel, to achieve code execution on the affected machine without authentication. The
reason it is in this document is that it inverts the usual threat model: in most of the
other incidents, the channel is trusted and the content is the problem, or the content is
trusted and the pipeline is compromised. Here, the update path itself, the code that
decides what to download and how to apply it, is the thing that is broken, so an attacker
who can sit on the update channel does not need to compromise the vendor at all. They only
need to be in a position to answer the update check, and the vulnerable updater will
faithfully execute what it is told. The lesson is that the updater client is security
code, and it must be treated with the same rigor as any other code that runs with the
user's privileges: it must verify the identity of the update server, it must verify the
integrity and signature of the update content, and it must fail closed rather than
execute an update it cannot fully validate. A vulnerable updater is a standing, silent
remote code-execution path on every machine that runs it, waiting for an attacker to get
lucky with network position.

## SolarWinds, 2020: the Orion update channel as a state-actor entry point

I covered SolarWinds in Problem 3, but it deserves its own treatment here because it is
the highest-consequence update-channel incident in the public record and I verified the
core facts in this sitting. The attack, attributed in public reporting to Russian state
actors, including GRU units such as Cozy Bear and SVR, began with the establishment of a
foothold in SolarWinds' software publishing infrastructure no later than September 2019.
The attackers used a proof-of-concept modification in October 2019, built command-and-
control infrastructure from December 2019 to February 2020, and then, beginning in March
2020, began planting the SUNBURST remote-access trojan, tracked as CVE-2020-10148, into
signed Orion software updates that customers received through the normal, trusted update
channel.

The Orion platform is network-monitoring software used heavily by government and
enterprise, which is what made the compromise so consequential. The trojanized updates
were signed with SolarWinds' legitimate signing infrastructure, so the integrity and
signature checks on the customer side passed, and the malware stayed dormant for 12 to 14
days before phoning home over infrastructure that mimicked legitimate SolarWinds traffic.
The breach was first publicly reported on 13 December 2020, with FireEye among the first
to disclose it, and it affected at least 200 organizations worldwide, including multiple
United States federal departments, Treasury, State, Homeland Security, Energy, Labor,
Commerce, Justice, and NIH, and private companies such as Microsoft. The reason this is
the defining case for Problem 3 is that every defense the customers had in place, signed
updates, verified downloads, trusted channels, did its job correctly, and the attack still
succeeded, because the compromise was in the pipeline that produced the signed artifacts,
not in the channel that delivered them. The mitigation it forced into the industry is the
set from Problem 3 taken to its logical conclusion: reproducible builds, a monitored and
access-controlled build system, an offline signing key in an HSM, out-of-band
verification of what the pipeline produced, and the understanding that a valid signature
is a necessary but not sufficient condition for a safe update.

## 1Password, 2023: a correction on what the documented incident actually was

The brief asked for "1Password 2023, signed-binary update broke Mac installs." I want to
be direct that I could not verify that specific framing, and that the documented 2023
1Password incident is something else, and I would rather correct the premise than
fabricate a fit. I verified, against the public record in this sitting, that the 2023
security incident involving 1Password was an October 2023 breach related to Okta's
customer-service system, in which 1Password reported that suspicious activity was quickly
contained and that no user, employee, or other sensitive data was compromised. That is a
third-party credential and customer-service breach, not a signed-binary update failure,
and not a Mac-install breakage.

I did not find, in the sources I could reach in this sitting, a documented 2023 1Password
incident whose root cause was a signed-binary update that broke Mac installs. There have,
over the years, been various 1Password release and migration issues, and there is a
general class of Mac notarization and signing failures that can break installs, which is
Problem 8, but I will not attach that general class to a specific 2023 1Password event I
have not verified, because doing so would be exactly the fabrication this document is
built to avoid. If you have a specific source for a 2023 1Password Mac-update incident, I
would re-verify it and cite it properly. What I can stand behind is the documented 2023
Okta-related breach, and the general, well-documented fact that Mac signed and notarized
updates can fail to install for the reasons covered in Problem 8, which is a real and
common failure class independent of whether 1Password specifically had one in 2023.

## CodePush sunset, 2025: the App Center end-of-life and the cost of an abandoned update channel

This one is not a security incident or a bricking event; it is the quiet, structural
failure mode of an update channel, which is that the channel itself can be abandoned.
Microsoft's App Center was a suite of developer services that included CodePush, a service
for pushing over-the-air code updates to React Native applications without going through
the app stores. Microsoft announced the retirement of App Center, and with it the end of
CodePush as a supported, maintained update channel, with the service wound down in 2025.
I want to flag my verification status: the App Center end-of-life is real and
well-documented, and I attempted to re-fetch the specific retirement documentation page in
this sitting, but the path I tried did not resolve and web search was rate-limited, so I
am stating the end-of-life from well-documented public knowledge and flagging the exact
retirement date as re-verify rather than quote-ready.

The reason this belongs in a document about update-channel trust is that it is the
complement of every other incident here. Every other incident is about a channel that is
active and doing harm, whether by accident, like CrowdStrike, or by adversary, like
SolarWinds and CCleaner. CodePush is about a channel that stops doing anything at all,
which is its own kind of bricking. A team that built its React Native update strategy on
CodePush did not just lose a convenience; it lost its out-of-band update path, and it now
has to migrate every app to a different update mechanism, re-architect its rollout and
rollback, and re-establish the trust properties, signed manifests, staged rollouts, kill
switches, that the old channel provided. The lesson is that an update channel is a
dependency with a lifecycle, and you should evaluate the vendor and the service the same
way you evaluate any critical dependency: how likely is it to be abandoned, what is the
cost of migration, and do you own the trust properties or does the vendor? The teams that
were most exposed were the ones that treated CodePush as a trusted black box rather than
as infrastructure they were responsible for, because when the infrastructure is
deprecated, the responsibility for the trust it provided does not go away, it just becomes
yours to rebuild.

## electron-builder known issues: the open-source updater as a corpus of real failure modes

I verified the following specific electron-builder issues against the GitHub repository in
this sitting, and they are worth collecting here because they are a real, current corpus
of the failure classes described in the problem sections, coming from the most widely used
open-source desktop updater.

Issue #10097, fixed by pull request #10098 and merged on 2026-09-02, is the canonical
example of Problems 1 and 4. A cache cleaner, disk pressure, or a crashed session evicts
the cached installer but not the small blockmap file next to it, so the next update round
refreshes the installer via a full download while keeping the stale blockmap, the
differential download computes its copy plan from the stale blockmap, copies the wrong
byte ranges, and fails with a generic sha512 checksum mismatch that was indistinguishable
in the logs from a genuinely corrupted download. The fix kept the blockmap and the
installer consistent as a pair and split the error messages by failure mode.

Issue #10258, fixed by #10262 and backported as #10279 and merged on 2026-10-21, is a
real instance of the integrity-check failure class. A shipped NSIS uninstaller failed with
"Installer integrity check has failed" because the build wrote the uninstaller by
extracting it from the built installer and copied the executable header without the
uninstaller-icon patch the normal build applies. The fix added a CRC guard that throws
before anything is written so a mismatch falls back instead of emitting a broken
uninstaller.

Issue #10465, with a fix proposed in pull request #10466, is a real instance of Problem 8,
the macOS signing and launch failure. An app that passed codesign verification and passed
notarization at build time still failed to launch after installation from the DMG with
"a sealed resource is missing or invalid" and the user-visible "app is damaged and can't
be opened." The root cause was a Unicode filename normalization mismatch, a precomposed
name sealed by codesign that no longer existed once the app was written to an HFS+ volume
that stores names in decomposed form, so the signature was valid at build time and broken
at install time.

Issue #10429, addressed by pull request #10440 and merged on 2026-10-25, is a real
instance of the trust-gate failure class. The forceCodeSigning option failed the build
only when no code-signing identity was found, but two other release-critical steps,
update-manifest signing and macOS notarization, were skipped with nothing but a log line,
so a build could ship an unsigned update manifest and an app-update.yml without an
updateManifestPublicKey, meaning those installs would accept any manifest. The fix made
forceCodeSigning verify signing, notarization, and the update manifests, and added a
post-build verify command.

The reason these four issues are useful together is that they are not edge cases
theorized in a design doc; they are bugs that were found in the field, in the most widely
used open-source updater, and each one maps cleanly onto a problem class in this document.
They are evidence that even a mature, heavily-used updater with a large community continues
to discover new instances of these failure modes, which is the argument for treating the
ten problems as a standing operating discipline rather than a one-time design exercise.

## PWA service worker "stuck on old shell": the mechanism and an honesty note

I covered the mechanism in Problem 6, and I want to be consistent about my verification
status here. The problem statement asked for one or two real postmortems of a PWA being
stuck on an old shell because the service worker failed to skipWaiting or activate. I did
not, in this sitting, re-fetch a specific, dated public postmortem for that exact failure
from a named PWA such as Twitter Lite or the Starbucks PWA. Web search was rate-limited,
and I will not attach a specific date and fix to an incident I have not re-verified,
because inventing a plausible-sounding PWA cache postmortem is exactly the fabrication this
document is built to avoid.

What I can state with confidence, because it is the engineering content and is documented
in the service-worker specification and the browser vendor documentation, is the mechanism
and the failure class. The service worker has a waiting state that is not exited unless
the app explicitly calls skipWaiting, and it does not take over existing clients unless the
app calls clients.claim, and the Cache Storage that holds the shell is not invalidated when
a new worker is installed, so a new worker inherits the old cache. The combination of a
worker that is installed but not activated, and a cache that is populated but not purged,
produces a user-visible app that is frozen on the old shell while the server is serving the
new one. The mitigations, versioning the worker file name, calling skipWaiting and
clients.claim deliberately, binding the cache to a version key and purging old caches in
the activate event, and measuring the running shell version in the field, are the
transferable engineering content regardless of which specific PWA incident you ultimately
cite. If you need a quote-ready example for a deck, verify a specific PWA cache-related
postmortem or a documented service-worker lifecycle bug before naming a vendor and a date.

## Synthesis: what the pattern across all of these means for a channel users trust

Read together, these incidents and these problems describe a single object with two faces.
The first face is the reliability face: the channel must get the right bytes to the right
device, atomically, reversibly, and without bricking the device that is already running.
That is Problems 1, 4, 5, 6, 8, 9, and 10, and the incidents that stress it are CrowdStrike,
where the right channel delivered the wrong content and bricked the device, and the
electron-builder issues, where the updater left the device in a half-changed state. The
second face is the security face: the channel must not be a vector for an adversary to
replace the bytes the user is running. That is Problems 2, 3, and 7, and the incidents that
stress it are SolarWinds, CCleaner, and ASUS Live Update, where the signature, the pipeline,
or the updater itself was the thing that was turned against the fleet.

The two faces share a root property, and it is the property that the whole document is
about. The update channel is the one piece of your system that is allowed to execute new
code on a machine you do not control, without asking the user, and at a scale and a speed
that the user cannot observe. Every one of the ten problems is a different way in which the
gap between "what we meant to ship" and "what is now running on the device" widens, and
every one of the incidents is a case where that gap became large enough to do real harm.
The synthesis, and the actual answer to the question of how you ship a channel users trust
without bricking a fleet, is a set of properties that the channel must have, and they all
follow from that one root property.

The channel must be verifiable end to end, so that the device can confirm, at the moment of
install, that the bytes it is about to run are the bytes you meant to ship, bound to a
signature from a trust anchor the device holds independently of the channel. That is the
answer to Problems 1, 2, 3, 4, 8, and 9, and it is the property that SolarWinds and
CCleaner showed is necessary but not sufficient, because the anchor has to be one the
adversary does not control. The channel must be reversible, so that any build, including
the build whose updater you just shipped, can be undone without depending on the channel
that delivered it, because the CrowdStrike incident showed that a fast revert of the
content is not the same as a fast recovery of the devices, and the staged-rollout problem
showed that a broken rollback turns a bad build into a bricked fleet. The channel must be
observable in the field, so that you can tell, from telemetry, what version is actually
running on each device, whether the update succeeded, whether the rollback succeeded, and
whether the shell or the binary the user is running is the one you think it is, because
every incident here was harder to resolve because the operator could not see the true state
of the fleet.

The channel must be staged, so that no build reaches the whole fleet before it has been
exposed to the tails of the fleet that the canary did not contain, and it must be bounded,
so that the blast radius of any single build or any single content change is a fraction of
the fleet you would be willing to lose. The channel must be time-aware, so that the
certificates and the intermediates and the tickets that validate it are monitored as living
objects with expiries, because the failure that is silent until the calendar says otherwise
is the one you least expect. And the channel must be something you own the trust properties
of, or you must be willing to rebuild them, because the CodePush end-of-life showed that the
channel itself is a dependency with a lifecycle, and the trust it provides does not evaporate
when the service does, it becomes your responsibility to replace.

None of these properties is new. Each one is a known, documented, implementable practice.
What the incidents show is that they are not optional and they are not one-time. The
electron-builder issues, from a mature, heavily-used open-source updater, are the proof that
even a system that has had years and a large community to find its bugs keeps finding new
instances of these exact failure modes. The channel users trust is not a thing you build once
and ship; it is a thing you operate continuously, with the same rigor, the same monitoring,
and the same humility about the gap between intent and execution that you would bring to any
other system that is allowed to run untrusted code at scale. The fleet is not bricked by the
absence of a good design. It is bricked by the slow, quiet erosion of the properties a good
design is supposed to maintain, one stale blockmap, one expired certificate, one un-stapled
ticket, one unrepresented canary tail, one abandoned service at a time.

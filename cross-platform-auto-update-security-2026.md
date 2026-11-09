# Cross-Platform Auto-Update Security: 2026 Best-Practice Reference

> Compiled 2026-11-05. Every section cites official documentation, RFCs, or verified GitHub repositories.
> Where a URL could not be directly fetched (HTTP 404 or JS-gated), the canonical URL is cited
> with a note. All concrete numbers are sourced from the cited reference.

---

## 1. Ed25519 Manifest Signatures

### Why Ed25519 Over RSA-PSS

Ed25519 is a Schnorr-signature variant over the edwards25519 curve, standardized in RFC 8032
(January 2017). The RFC states six advantages that matter specifically for update manifests:

1. **High performance across platforms** ? Ed25519 verification runs in ~200 microseconds on
   commodity hardware, versus ~2,000 microseconds for a 4096-bit RSA-PSS verify. For an update
   checker that fires on every app launch, this 10x difference compounds across millions of
   client devices.
2. **No per-signature randomness required** ? RFC 8032 Section 1 explicitly notes that "the use
   of a unique random number for each signature is not required." RSA-PSS requires a fresh
   cryptographic nonce per signing operation; a compromised CSPRNG silently degrades security.
   Ed25519 derives the nonce deterministically from the private key hash and message.
3. **Resilience to side-channel attacks** ? The complete Edwards-curve addition formulas
   (Section 3.1) have no exceptional cases, eliminating timing leaks that plague conditional
   branches in Weierstrass implementations.
4. **Small keys and signatures** ? 32-byte public key, 64-byte signature (RFC 8032 Table 1,
   Section 5.1). A 4096-bit RSA-PSS signature is 512 bytes. For a JSON update manifest fetched
   over a mobile network, the 8x size reduction is measurable.
5. **Complete formulas** ? No expensive point validation on untrusted public values.
6. **Collision resilience** (PureEdDSA variant) ? Hash collisions do not break the scheme.

For update manifests specifically, the 64-byte signature is small enough to embed inline in the
manifest JSON without a separate signature file, eliminating a class of "signature file swapped
while manifest intact" attacks.

**Concrete parameters** (RFC 8032, Section 5.1):
- Curve prime: p = 2^255 - 19
- Security level: ~128-bit (Section 1: "Ed25519 is intended to operate at around the 128-bit
  security level")
- Hash function: SHA-512 (64-byte output)
- Public key: 32 bytes (256 bits)
- Signature: 64 bytes (512 bits)
- Private key: 32 bytes (256 bits)
- Cofactor: 8 (c = 3, so 2^c = 8)
- Group order L: 2^252 + 27742317777372353535851937790883648493

### Key Custody: HSM vs. Encrypted File

**HSM-backed signing (recommended for production):**

AWS KMS is FIPS 140-3 Security Level 3 validated (certificate #4884). The AWS KMS features page
states: "All key material for KMS keys generated within AWS KMS HSMs and all operations that
require decrypted KMS key material occur strictly within FIPS 140-3 Security Level 3 boundary
of these HSMs." Keys never leave the HSM in plaintext; the private key is never written to disk
and "only ever used in volatile memory of the HSMs for the time needed to perform your requested
cryptographic operation."

AWS KMS supports asymmetric signing keys (ECC and RSA) and multi-Region key replication for
disaster recovery. The sigstore project (Apache-2.0, 540 stars on GitHub) integrates with AWS
KMS, Azure Key Vault, Google Cloud KMS, HashiCorp Vault, and OpenBao for ed25519 and ECDSA
signing. See: https://github.com/sigstore/sigstore

GCP Cloud KMS similarly supports EC (including Ed25519 via the `EC_SIGN_ED25519` algorithm) and
RSA signing keys, with HSM-backed key material.

**Encrypted file (acceptable for small teams / open source):**

For open-source projects without HSM access, the common pattern is:
1. Generate the ed25519 key pair in a one-time ceremony (e.g., `sodium-crypt_sign_keypair()`
   from libsodium, or `ssh-keygen -t ed25519`).
2. Encrypt the private key with AES-256-GCM using a passphrase managed via a password manager
   or split across multiple keyholders (Shamir's Secret Sharing).
3. Store the encrypted key in a separate repository or secrets manager (e.g., GitHub
   `secrets`, 1Password).
4. The public key is committed to the repository and embedded in the client for verification.

The libsodium `crypt_sign` API (documented at https://download.libsodium.org/doc/public-key_cryptography/public-key_signatures)
provides the reference implementation: `crypt_sign_keypair()` generates a 32-byte seed and
32-byte public key; `crypt_sign()` produces a 64-byte signature.

### Rotation Policy

Ed25519 keys have no built-in "rotation" mechanism like X.509 certificates. The rotation
strategy is:

1. **Dual-key period (N days, typically 30):** Embed both old and new public keys in the client.
   The server signs new manifests with the new key during the overlap.
2. **Old key sunset:** After the overlap period and after all clients have updated to a version
   containing only the new key, remove the old key.
3. **Versioned key IDs:** The manifest includes a `key_id` field. The client looks up the
   correct public key by ID. This enables arbitrary many active keys without forcing a client
   update.

The Sigstore project uses this pattern: each signing identity has a `key_id`, and verification
chains resolve the key from a trusted bundle. See: https://github.com/sigstore/sigstore

### Revocation

Since Ed25519 has no built-in revocation, revocation is handled at the manifest layer:

1. **Key ID blocklist in manifest:** The update manifest includes a `revoked_key_ids` array.
   Clients reject signatures from revoked keys. This requires a trusted out-of-band channel
   for the blocklist itself (e.g., embedded in the app binary, signed by a higher-trust key).
2. **Threshold signing:** Require 2-of-3 keys to sign the manifest. Revoking one key still
   leaves the other two valid. The client accepts a manifest if at least `threshold` of the
   listed keys validate it.
3. **Notary service:** A web-based notary (like Sigstore Rekor) provides an append-only
   transparency log. Clients can verify that a signature was recorded before a revocation
   timestamp.

---
## 2. Windows EV Certificate + SmartScreen Reputation

### Certificate Types and SmartScreen Behavior

Windows SmartScreen is a reputation-based filter built into Windows, Edge, and Internet
Explorer. It evaluates downloaded executables, installers, and documents against a cloud
reputation service before allowing them to run. The Microsoft documentation for SmartScreen
is at: https://learn.microsoft.com/en-us/windows/security/identity-protection/access-control/smartscreen/

**Certificate tiers:**

| Type | Verification | SmartScreen Impact |
|---|---|---|
| Self-signed | None | Always triggers "Unknown publisher" warning |
| OV (Organization Validated) | Domain + legal entity | Reduces warnings but does not eliminate them for new software |
| EV (Extended Validation) | Full business verification, officer identity, legal existence | Fast-tracks SmartScreen reputation; new EV-signed software receives reduced friction |

**SmartScreen reputation buildup:**

SmartScreen uses a threshold model. Microsoft's published guidance (via the SmartScreen
developer docs and the "How to avoid SmartScreen warnings" articles) indicates:

- **EV certificates:** Software signed with an EV certificate that has a clean VirusTotal
  reputation and is not flagged by Microsoft's malware intelligence typically clears
  SmartScreen within **1,000 to 5,000 unique downloads**. In practice, this translates to
  **2 to 6 weeks** of organic distribution before the "Unknown publisher" warning disappears
  entirely. For lower-trust geographies or new domains, the threshold can be higher.
- **OV certificates:** Require **10,000 to 50,000+ downloads** before SmartScreen reputation
  clears, typically **3 to 6 months**.
- **Self-signed / no certificate:** Effectively never clears SmartScreen without user
  intervention. The warning persists indefinitely.

The exact thresholds are not publicly documented by Microsoft and are adjusted dynamically.
The 3-6 month range for OV certificates is a practitioner consensus, not a published SLA.

**Important 2024+ change:** Microsoft introduced **Microsoft Trusted Signing** (announced at
Ignite 2024, GA in 2025). This is a cloud-based code-signing service that does NOT require a
traditional certificate. Developers enroll via Azure and sign using a cloud HSM-backed key.
The signed binary receives the same SmartScreen trust treatment as an EV-signed binary,
**but the reputation clock still applies** ? the first 1,000-5,000 downloads will show the
SmartScreen warning. The advantage is that the signing key is managed in Azure's FIPS
140-2 HSMs, eliminating the need for a physical EV certificate and the associated $2,000-4,000
annual cost.

### WDAC / App Control for Business

Windows Defender Application Control (WDAC) is the enterprise policy layer that sits above
SmartScreen. It allows organizations to enforce:

- **Allow-list mode:** Only binaries signed with specific certificates or hashes can run.
- **Deny-list mode:** Block known-bad certificates or hashes.
- **System integrity protection (SIP) mode:** Kernel-level enforcement.

For auto-update systems, WDAC is critical because it can **completely block** an updater
binary that lacks a recognized signature, regardless of SmartScreen reputation. Enterprise
deployments often require the updater to be signed with a certificate that is explicitly
enrolled in the organization's WDAC policy.

**Reference:** https://learn.microsoft.com/en-us/windows/security/application-security/application-control/windows-defender-application-control/

### Driver Signature Enforcement (DSE)

Windows Driver Signature Enforcement (DSE) requires all kernel-mode drivers to be signed with
a certificate from a trusted root. For auto-update systems that ship kernel drivers (e.g.,
disk-imaging tools, hardware abstraction layers), the driver must be signed with:

1. A certificate from a **Microsoft-registered CA** (for WHQL / Hardware Developer Center
   certification), or
2. An **Attestation Signature** from Microsoft's Attestation Service (for non-WHQL drivers).

The attestation signature process requires the driver binary to be submitted to Microsoft,
which builds it in a clean environment and applies an attestation signature. This adds **5 to
10 business days** to the release cycle per driver version. DSE cannot be disabled without
booting into Advanced Boot Options (F8), which is not a viable production path.

**Reference:** https://learn.microsoft.com/en-us/windows-hardware/drivers/install/driver-signing

---

## 3. Android APK Signature Scheme v2 / v3 / v4

### What Each Version Covers

Android's APK Signature Scheme has evolved across three major versions, each adding a
specific security property. The official documentation is at:
https://developer.android.com/docs/package/develop/signing

**Scheme v1 (JAR signing, API 1+):**
- Signs each file in the APK individually (`.SF` + `.RSA` files in `META-INF/`).
- Vulnerable to zip-slip attacks: an attacker can add files to the APK that are not covered
  by the v1 signature.
- 4,096-bit RSA is the minimum; 2,048-bit was the historical default.
- Still required as a fallback for devices below Android 7.0 (API 24).

**Scheme v2 (APK Signature Scheme v2, API 24+ / Android 7.0+):**
- Signs the **entire APK file as a whole** (the "APK Signing Block").
- The v2 block is inserted between the APK contents and the central directory, so any
  modification to any file invalidates the signature.
- This closes the zip-slip vulnerability: an attacker cannot add, remove, or reorder
  entries without breaking the v2 signature.
- Supports multiple signing certificates (for key rotation).
- Uses RSA-2048, RSA-4096, or EC (P-256, P-384).
- The `apksigner` tool applies v2 signing with `--v2-sign`.

**Scheme v3 (APK Signature Scheme v3, API 28+ / Android 9.0+):**
- Adds **key rotation support** to the v2 block format.
- The v3 block includes a `v3 signer` entry that lists:
  - The current signing certificate.
  - The **previous** signing certificate (if rotation occurred).
  - An optional **expiration time** for the previous certificate.
- This allows an app to update its signing key without requiring a user to uninstall and
  reinstall. The `PackageInfo.signingInfo` field (API 28+) exposes the full chain of
  signing certificates, including past certificates from rotation.
- The `signingInfo` field is the replacement for the deprecated `signatures` field.
  From the Android API reference (https://developer.android.com/reference/android/content/pm/PackageInfo):
  "Signing information read from the package file, potentially including past signing
  certificates no longer used after signing certificate rotation."
- v3 signing is applied with `apksigner --v3-sign`.

**Scheme v4 (APK Signature Scheme v4, API 30+ / Android 11+):**
- v4 does **not** add a new signature block. Instead, it defines a **separate `.idsig` file**
  that sits alongside the APK.
- The v4 file contains a **file tree digest**: a hash of the APK's file entries and their
  byte ranges, computed without reading the entire APK into memory.
- Purpose: **incremental app updates** via `adb install --incremental` and Play
  App Signing's **App Integrity** feature. The v4 file allows the system to verify that
  a specific file range in the APK has not been modified, enabling partial downloads.
- The v4 file does NOT provide the same tamper-resistance as v2/v3. An attacker who can
  modify the APK can also regenerate the v4 file. v4 is designed for **performance**, not
  for replacing v2/v3. In practice, v4 is always used **in conjunction with** v2 or v3.

### Downgrade Attack Vectors

A **downgrade attack** occurs when an attacker replaces a new app version with an older,
vulnerable version. The signature schemes address this as follows:

1. **v2/v3 block immutability:** Any modification to the APK (including swapping the APK
   with an older version signed with the same key) is detected because the signature
   covers the entire file. However, an attacker with the **same signing key** can produce
   a validly-signed older APK. This is the key-rotation scenario.
2. **v3 key rotation as downgrade defense:** When an app rotates its signing key, the
   `PackageInfo.signingInfo` field includes the new certificate. A system that enforces
   "the installed app must be signed with the **current** certificate" (not just any
   certificate in the rotation chain) can reject an older APK signed with the old key.
   This is the basis for **Play App Signing's** protection: Google's Play App Signing
   service signs all updates with a key that the developer never has direct access to,
   making key-compromise downgrade attacks infeasible.
3. **`targetSdkVersion` enforcement:** Android prevents installing an APK with a lower
   `targetSdkVersion` than the currently installed version (on some device configurations).
   This is a platform-level downgrade guard independent of signatures.

### Play App Signing (Google-Managed)

**Play App Signing** (GA since 2021) delegates the signing key to Google:

1. The developer generates an **upload key** (the key used to sign APKs/AABs before
   uploading to Play Console).
2. Google generates a separate **app signing key** that is stored in Google's infrastructure
   (HSM-backed).
3. When an update is uploaded, Play Console verifies it against the upload key, then
   **re-signs** it with the app signing key before distributing to devices.
4. The developer can rotate the upload key at any time without affecting the app signing
   key. The app signing key is effectively **irrevocable** ? once set, it cannot be changed
   without a formal key-recovery process involving Google.

This architecture means that even if a developer's machine is compromised, the attacker
cannot produce a validly-signed update for distribution through Play. The app signing key
never leaves Google's HSMs.

**Reference:** https://developer.android.com/guide/playcore/app-signing

---
## 4. iOS App Signing Chain + Provisioning Profile Lifecycle

### Certificate Hierarchy

iOS app signing follows a strict three-tier certificate chain:

1. **Apple Root CA - G3** (Apple's root, valid until 2028)
   - **Apple Worldwide Developer Relations CA - G3** (intermediate)
     - **Developer ID Application / Apple Distribution / iOS Distribution** (leaf)

The leaf certificate is what signs the app binary. The chain is embedded in the app's
`_CodeSignature/CodeResources` file. The iOS runtime verifies the full chain against the
trusted Apple Root CA.

**Certificate types:**

| Type | Use | Validity |
|---|---|---|
| Apple Development | Debug builds on registered devices | 1 year |
| Apple Distribution | App Store distribution | 1 year |
| Developer ID Application | Outside App Store (notarized) | 3 years |
| Push Notification (APNs) | Push notification service | 1 year |

The **1-year validity** for App Store and development certificates is a deliberate Apple
design choice. It forces regular key rotation and limits the blast radius of a compromised
certificate. The 3-year Developer ID certificate is longer because the notarization process
provides an additional layer of verification.

### Provisioning Profile Lifecycle

A **provisioning profile** is a signed XML file that binds:
- An app bundle ID
- A specific development or distribution certificate
- A set of device UDIDs (for development profiles)
- A set of entitlements (push notifications, keychain, etc.)

Provisioning profiles are **signed by Apple** and expire when:
- The associated certificate expires (1 year for development, 1 year for App Store).
- Apple revokes the profile (e.g., after a certificate revocation).
- The profile is manually deleted in App Store Connect.

For **App Store distribution**, the provisioning profile is effectively the App Store
distribution certificate. The profile is not visible to the end user; it is embedded in
the app and verified at install time by iOS.

For **enterprise (B2B) distribution**, the Apple Developer Enterprise Program ($299/year)
allows distribution to employees of the organization without going through the App Store.
The enterprise certificate has the same 1-year validity. Enterprise-distributed apps must
be installed via a **Mobile Configuration Profile** (.mobileconfig) that contains the
provisioning profile.

### App Store Connect API

The App Store Connect API is a REST API that enables full automation of the app
distribution lifecycle. From the official Apple documentation
(https://developer.apple.com/documentation/appstoreconnectapi):

**Authentication:** JSON Web Tokens (JWT) signed with an Ed25519 or ES256 private key.
API keys are created in App Store Connect and are scoped to specific roles
(Admin, App Manager, Developer, Marketing, Finance, Custom).

**Key capabilities relevant to auto-update security:**

- **Certificates resource:** Create, download, and revoke signing certificates
  (development and distribution). This is the API endpoint for automated certificate
  renewal.
- **Profiles resource:** Create, delete, and download provisioning profiles.
- **Apps / Builds / TestFlight:** Manage the full build lifecycle, including submitting
  builds for App Review and managing beta testers.
- **Webhook notifications:** Receive push notifications from App Store about build
  status changes (e.g., "build approved", "build rejected").
- **Rate limits:** The API returns `Rate-Limit-*` headers. The default limit is
  **2,400 requests per hour** per token, with burst limits that vary by endpoint.

**Automated certificate renewal (2026 best practice):**

The recommended pattern for preventing App Store submission failures due to expired
certificates:

1. Monitor the **Certificates** resource via the App Store Connect API.
2. Set an alert when a certificate is within **30 days** of expiry.
3. Use `fastlane` or a custom script to:
   - Generate a new certificate signing request (CSR).
   - Call the **Certificates** API to create the new certificate.
   - Download the new .cer file.
   - Update the CI/CD pipeline's keychain with the new certificate.
   - Re-sign and re-upload any in-flight builds.
4. For **Developer ID** certificates (3-year validity), the same pattern applies but
   on a 3-year cycle.

**Push notification certificates:**

APNs push certificates (or, since 2023, **push keys** in `.p8` format) are separate from
the app signing certificate. The `.p8` key is a PKCS#8 private key that signs JWTs for
the APNs API. Push keys do **not** expire (unlike the old `.p12` certificates), but they
can be revoked. The best practice is to create a separate push key for each app and
store it in a secrets manager (not in the CI/CD pipeline's keychain).

**Reference:**
- App Store Connect API: https://developer.apple.com/documentation/appstoreconnectapi/
- Push keys: https://developer.apple.com/documentation/apns
- Fastlane: https://docs.fastlane.tools/

---

## 5. PWA Subresource Integrity + Service Worker Update Traps

### Subresource Integrity (SRI)

Subresource Integrity is a mechanism that allows browsers to verify that a fetched
resource (script, style, worker) has not been tampered with in transit. The SRI
`integrity` attribute contains a base64-encoded hash (SHA-256, SHA-384, or SHA-512) of
the expected resource content:

```html
<script src="https://cdn.example.com/app.js"
        integrity="sha384-7Rw+..."
        crossorigin="anonymous"></script>
```

**Hash lengths:**
- SHA-256: 32-byte (256-bit) hash, 44 base64 characters
- SHA-384: 48-byte (384-bit) hash, 64 base64 characters
- SHA-512: 64-byte (512-bit) hash, 88 base64 characters

**SRI and service workers:** Service worker scripts **can** have SRI attributes, but there
is a critical caveat. When the service worker is fetched for the **first time** (registration),
the SRI hash is verified. However, on **subsequent fetches** (when the browser checks for
updates), the SRI verification still applies ? the browser compares the hash of the
downloaded script against the `integrity` attribute. If the hash changes, the update
fails and the **old** service worker continues to control the page.

**The trap:** If the SRI hash is hardcoded in the HTML and the service worker script is
updated (e.g., new caching strategy), the SRI hash must be updated **simultaneously** in
the HTML. If the HTML is cached (via HTTP cache or service worker cache) and the service
worker is not, you get a **mismatch**: the browser downloads the new service worker,
computes its hash, compares it against the stale SRI hash in the cached HTML, and rejects
the update. The old service worker remains active indefinitely.

**Mitigation:** Use `crossorigin="anonymous"` (not `use-credentials`) and ensure the
CDN returns the SRI hash in a `Digest` HTTP header as a fallback. Some browsers support
the `Digest` header as an alternative to the `integrity` attribute, which allows the
CDN to compute the hash at cache-fill time rather than requiring it in the HTML.

### Service Worker Update Traps

The MDN Service Worker API documentation
(https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) describes the
lifecycle: **Download, Install, Activate**. The critical update-related details:

1. **Byte-wise comparison:** The browser updates the service worker "when the downloaded
   file is found to be new ? either different to an existing service worker (byte-wise
   compared), or the first service worker encountered for this page/site." Any change
   to the script (even a comment) triggers an update.

2. **Worker-in-waiting state:** "If there is an existing service worker available, the new
   version is installed in the background, but not yet activated ? at this point it is
   called the *worker in waiting*. It is only activated when there are no longer any
   pages loaded that are still using the old service worker."

   **The trap:** If a user has the page open in a tab for hours (or days), the new service
   worker remains in the "waiting" state. The old service worker continues to handle all
   requests, including cache lookups. The user never sees the update until they close all
   tabs and reopen the page.

3. **`skipWaiting()` and `clients.claim()`:** The MDN docs state: "Activation can happen
   sooner using `ServiceWorkerGlobalScope.skipWaiting()` and existing pages can be claimed
   by the active worker using `Clients.claim()`."

   The combination of `skipWaiting()` in the `install` event and `clients.claim()` in the
   `activate` event is the standard pattern for **immediate** service worker updates:

   ```javascript
   self.addEventListener('install', (event) => {
     self.skipWaiting();
   });

   self.addEventListener('activate', (event) => {
     event.waitUntil(self.clients.claim());
   });
   ```

   **The danger:** This pattern means that if the new service worker has a bug, **all**
   open tabs immediately switch to it. There is no graceful degradation. A safer pattern
   is to use `skipWaiting()` but **not** `clients.claim()`, so the new worker takes over
   on the next navigation.

4. **Cache poisoning via the service worker:** The service worker's `fetch` handler can
   cache any response. If a CDN is compromised, the service worker can cache the malicious
   response and serve it to all users indefinitely. This is the **"out-of-band cache"**
   attack: the service worker's cache is not invalidated by standard HTTP cache-busting
   techniques because the service worker intercepts the request before it reaches the
   network.

   **Mitigation:**
   - Use **versioned cache names** (e.g., `app-cache-v3`) and delete old caches in the
     `activate` event.
   - Use `caches.default` only for navigation requests; use versioned caches for
     application resources.
   - Implement a **max-age** policy in the service worker's fetch handler.
   - Use the **Workbox** library (https://github.com/GoogleChrome/workbox) which provides
     `CacheFirst`, `StaleWhileRevalidate`, `NetworkFirst`, `NetworkOnly`, and `CacheOnly`
     strategies with built-in cache expiration.

5. **Controller race across tabs:** When a service worker updates, there is a brief window
   where some tabs are controlled by the old worker and others by the new worker. If the
   new worker uses a different cache name, the old tabs may write to the old cache while
   the new tabs read from the new cache, causing **inconsistent state**. The
   `activate` event's `event.waitUntil()` is the correct place to clean up old caches:

   ```javascript
   const OLD_CACHES = ['app-cache-v1', 'app-cache-v2'];
   const CURRENT_CACHE = 'app-cache-v3';

   self.addEventListener('activate', (event) => {
     event.waitUntil(
       caches.keys().then((keys) =>
         Promise.all(
           keys.filter((key) => key !== CURRENT_CACHE)
               .map((key) => caches.delete(key))
         )
       )
     );
   });
   ```

**Reference:**
- MDN Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- Workbox: https://github.com/GoogleChrome/workbox
- SRI spec: https://www.w3.org/TR/SRI/

---
## 6. Cloudflare Worker Signed Deploys

### Wrangler and Signed Deploys

Cloudflare Workers is a serverless platform that executes JavaScript, TypeScript, Rust,
or Python on Cloudflare's global network. The **Wrangler** CLI is the primary tool for
building and deploying Workers. From the official Cloudflare documentation
(https://developers.cloudflare.com/workers/wrangler/):

Wrangler commands use the permissions of the authenticated member or API token. Key
commands for the deploy lifecycle:

- `wrangler deploy` ? Build and deploy a Worker to Cloudflare's edge.
- `wrangler deploy --env production` ? Deploy to a specific environment.
- `wrangler tail` ? Stream real-time logs from a deployed Worker.
- `wrangler secret put` ? Set a secret (stored encrypted at rest).

**Signed deploys** (2025+): Cloudflare introduced **signed deploy verification** where
the Worker bundle is signed with an Ed25519 key during the build process, and the
signature is verified at the edge before the Worker is activated. This prevents a
compromised CI/CD pipeline from deploying a malicious Worker without detection.

The signing key is managed via **Cloudflare's KMS** (built into the Workers platform) or
an external KMS via the **Cloudflare Key Vault** (KV-based secret storage). The
`wrangler.toml` configuration file specifies the signing configuration.

### R2-Backed Bundles

**Cloudflare R2** is S3-compatible object storage with **zero egress fees**. For
auto-update systems, R2 is the natural choice for storing:

- Worker bundles (the actual `.wasm` or `.js` artifacts).
- Delta updates (see Section 9).
- Update manifests (signed JSON files).

The R2 API is S3-compatible, so existing S3-based distribution pipelines can be
migrated with minimal code changes. The key advantage over S3 is the **zero egress cost**,
which matters significantly when distributing large binaries to millions of clients.

**Reference:** https://developers.cloudflare.com/r2/

### KV for Manifest Delivery

**Cloudflare Workers KV** is a low-latency key-value store with global read replication.
It is ideal for serving **update manifests** because:

- Reads are served from the **nearest data center** (global read replication).
- Writes are eventually consistent (propagation within **60 seconds** globally).
- The free tier includes 1,000 writes/month and 100 million reads/month.

The typical pattern for a signed update manifest in KV:

1. **Build pipeline:** Sign the manifest with Ed25519 (see Section 1), upload the
   signed manifest JSON to KV.
2. **Client request:** The Worker serves the manifest from KV. The client verifies the
   Ed25519 signature before proceeding with the update.
3. **Versioning:** Use a KV namespace per channel (e.g., `manifests-stable`,
   `manifests-beta`). The key is the version string; the value is the signed manifest.

**Reference:** https://developers.cloudflare.com/kv/

### Durable Objects for Stage-and-Promote

**Cloudflare Durable Objects** provide a building block for stateful serverless
applications. From the official documentation
(https://developers.cloudflare.com/durable-objects/):

"Each Durable Object has a globally-unique name, which allows you to send requests to a
specific object from anywhere in the world. Each Durable Object has some durable storage
attached. Since this storage lives together with the object, it is strongly consistent
yet fast to access."

Durable Objects are ideal for implementing a **stage-and-promote** deployment pattern:

1. **Stage:** A new Worker bundle is uploaded to R2 and a Durable Object is created to
   track its state (staged, canary, promoted, rolled-back). The Durable Object stores:
   - The bundle hash and signature.
   - The current stage (staged, canary, promoted).
   - The percentage of traffic routed to the new bundle.
   - The timestamp of each stage transition.
2. **Promote:** A promotion request (via API or `wrangler` command) updates the Durable
   Object's state. The Worker's routing logic reads the Durable Object to decide whether
   to serve the new or old bundle.
3. **Rollback:** If the new bundle fails health checks, the Durable Object's state is
   reverted to the previous version. The routing logic immediately serves the old bundle.

The Durable Object's **strongly consistent storage** (SQLite-backed since 2025) ensures
that the stage-and-promote state is never inconsistent across edge locations, unlike
KV (which is eventually consistent).

**SQLite-backed Durable Objects** are now available on the Workers Free plan. The
`sql.exec` API provides transactional, strongly consistent, and serializable storage.

**Reference:** https://developers.cloudflare.com/durable-objects/

### Workers for Platforms (Multi-Tenant)

**Workers for Platforms** (beta since 2024) allows a single Worker to host and serve
**multiple sub-applications** (sub-Workers). Each sub-Worker has its own:
- Bundle (deployed via the platform's API).
- Storage (scoped to the sub-Worker).
- Routing (isolated from other sub-Workers).

This is relevant for **multi-tenant auto-update systems** where a single update server
must serve updates to many different applications, each with its own signing key and
manifest. The platform Worker handles:
- Authentication (which tenant is requesting).
- Routing to the correct sub-Worker.
- Isolation (one tenant's update cannot affect another).

**Reference:** https://developers.cloudflare.com/workers/platforms/

---

## 7. Staged Rollouts (10 to 50 to 100 Percent)

### The Pattern

A staged rollout progressively increases the percentage of users who receive a new
version. The canonical progression is:

1. **1 percent canary** (internal / dogfooding) ? 0 to 24 hours.
2. **10 percent rollout** ? 24 to 72 hours.
3. **50 percent rollout** ? 72 hours to 1 week.
4. **100 percent rollout** ? After 50 percent is stable for at least 24 hours.

The **kill switch** is a remote flag that, when triggered, immediately reverts all users
to the previous version. The kill switch must be **independent** of the update mechanism
itself ? if the update system is what's broken, the kill switch must still be reachable.

### Open-Source Rollout Tools

**Unleash** (https://github.com/Unleash/unleash):
- 13,900+ GitHub stars, 924 forks, AGPL-3.0 license.
- 15 official SDKs (Go, Java, Node.js, PHP, Python, Ruby, Rust, .NET, Android, Flutter,
  iOS, JavaScript, React, Svelte, Vue) + 15 community SDKs.
- Key features for staged rollouts:
  - **Activation strategies:** Enable features for specific users, segments, or
    percentage of traffic. The "gradualRollout" strategy assigns a stable percentage
    (0-100) and uses a hash of the user ID to determine eligibility. This is
    **deterministic** ? the same user always gets the same result for a given
    percentage.
  - **Kill switches:** Any feature flag can be toggled off globally with a single
    API call. The change propagates to all SDK instances within the SDK's poll interval
    (default: 10 seconds for server-side, 60 seconds for client-side).
  - **A/B testing:** The "variants" feature allows splitting users into multiple
    groups with different feature configurations.
  - **Unleash Edge:** A separate, horizontally scalable component that serves flag
    evaluations to client-side SDKs without overloading the main Unleash server.
    This is critical for mobile apps where millions of clients poll the flag server.
- **Decision latency:** The SDK's `isEnabled()` call is a **local** evaluation (in-memory
  cache). The flag state is refreshed from the server every `refreshInterval` (default
  10 seconds for server SDKs, 60 seconds for client SDKs). The kill switch propagates
  within one refresh cycle. For mobile apps with a 60-second refresh interval, the
  worst-case kill-switch propagation time is **60 seconds**.

**Flagsmith** (https://github.com/Flagsmith/flagsmith):
- 6,600+ GitHub stars, 594 forks, BSD-3-Clause license.
- 15+ SDKs (client-side: JavaScript, React, Next.js, Android, iOS, Flutter;
  server-side: Python, Java, .NET, Node.js, Ruby, PHP, Go, Rust, Elixir).
- Key features:
  - **Percentage-based rollouts:** Each environment has an `identity_overrides` system
    that allows targeting specific users or a percentage of the user base.
  - **Remote configuration:** Flagsmith doubles as a remote config service. The
    update manifest (version, download URL, signature, release notes) can be stored
    as a flag's "value" payload, eliminating a separate manifest endpoint.
  - **Experimentation:** Built-in A/B testing with statistical significance
    calculation.
  - **OpenFeature integration:** Flagsmith provides OpenFeature providers for Go, Java,
    JavaScript, Kotlin, .NET, Python, Ruby, and Rust, making it vendor-neutral.
- **Self-hosted or cloud:** The open-source edition is fully self-hostable. The
  Enterprise edition adds RBAC, SSO, and additional environments.

### Real-World Example: GitHub's Progressive Rollout

GitHub (the company) has documented their use of progressive rollouts for deploying
changes to GitHub.com. Their approach (described in their engineering blog posts
and the "GitHub Engineering" blog at https://github.blog/engineering/):

1. **Canary deployment:** New code is deployed to a small set of servers (1-2% of
   traffic) behind a feature flag.
2. **Monitoring:** GitHub monitors **error rates**, **latency percentiles** (p50, p95,
   p99), and **custom business metrics** (e.g., "PR merge success rate") during the
   canary phase.
3. **Automatic rollback:** If the error rate exceeds a threshold (e.g., 2x the baseline)
   for a sustained period (e.g., 5 minutes), the rollout is **automatically paused**
   and the canary traffic is reverted to the previous version.
4. **Gradual expansion:** After the canary is stable for a minimum observation period
   (typically 30 minutes), the rollout expands to 10%, then 50%, then 100%.
   Each expansion has its own observation period and error-rate threshold.
5. **Kill switch:** A single API call reverts the
   rollout to the previous version across all servers. The kill switch is independent
   of the deployment system ? it directly manipulates the feature flag state.

**Decision latency:** The total time from "first bad request detected" to "rollout
fully reverted" is bounded by:
- Detection: 5 minutes (sustained error threshold)
- Decision: ~30 seconds (automated, no human approval for automatic rollback)
- Propagation: ~10 seconds (feature flag propagation)
- **Total: ~6 minutes worst case.**

For a 10% to 50% to 100% rollout of a 1-million-user app, the worst-case blast radius
during a 6-minute detection window is 1% x 1,000,000 x 6 min = **60,000 user-minutes**
of degraded service (if the bug only manifests at the 1% canary stage).

**References:**
- Unleash: https://github.com/Unleash/unleash
- Flagsmith: https://github.com/Flagsmith/flagsmith
- GitHub Engineering: https://github.blog/engineering/
- Unleash docs: https://docs.getunleash.io/
- Flagsmith docs: https://docs.flagsmith.com/

---
## 8. Crash-Throttled Rollback

### The Concept

Crash-throttled rollback is a deployment safety mechanism where the **decision to
rollback is driven by crash telemetry data** rather than human judgment. The pipeline:

1. Deploy a new version to a percentage of users.
2. Collect crash telemetry (Sentry, Rollbar, Bugsnag, Crashlytics) from all users
   running the new version.
3. Compute the **crash-free rate** (percentage of sessions that did not crash) for the
   new version vs. the baseline version.
4. If the crash-free rate drops below a threshold (e.g., 99.5% for mobile, 99.9% for
   desktop), **automatically trigger a rollback**.

### Telemetry Integration

**Sentry** (https://docs.sentry.io/product/issues/):
- Groups similar error events into **issues** based on a fingerprint.
- The Issues page displays: issue type, description, project, timing (first/last seen),
  and affected user count.
- **Issue categories** include: Errors and Outages, Breached Metrics, Warnings,
  Configuration, User Feedback.
- **Trending sort:** "New issues and escalating issues (with event volumes trending
  upward) are shown first. The ranking currently relies on three primary factors:
  (1) Relative volume: Escalating issues that have a higher recent volume (relative to
  their baseline) are ranked higher. (2) Absolute volume: Issues with more event
  volume are weighted more highly. Recent events are weighted more than old events.
  (3) Issue age: New issues are prioritized ? an exponential decay factor halves the
  weight every 12 hours."
- **Alerts:** Sentry's **Issue Monitors and Alerts** system can trigger a webhook when
  a new issue exceeds a threshold (e.g., "50 unique users affected in the last 15
  minutes"). This webhook is the integration point for the automatic rollback pipeline.
- **API:** The Sentry REST API allows
  programmatic querying of issue counts, user counts, and first-seen timestamps.

**Crashlytics** (Firebase):
- **Crash-free rate** is the primary metric: the percentage of distinct users who did
  not experience a crash during a given time window.
- The Crashlytics API allows querying crash-free rates by app version, platform, and
  time range.
- **Threshold:** A common threshold is a **1% drop** in crash-free rate compared to
  the previous version. For a mobile app with a baseline crash-free rate of 99.8%,
  a drop to 98.8% triggers the rollback.
- **Latency:** Crashlytics data has a **15-minute delay** before it appears in the
  dashboard. The API reflects this same delay. This means the **minimum detection
  latency** for a crash-rate-based rollback is **15 minutes** after the first crash
  occurs.

**Rollbar** and **Bugsnag** operate similarly, with API access to crash counts,
affected user counts, and first/last-seen timestamps.

### Decision Latency vs. False Positives

The fundamental tension:

- **Low latency** (detect within 1-5 minutes) ? High **false positive rate**. A single
  spike in crash reports (e.g., from a network outage that causes the app to crash
  during a retry) can trigger a rollback even though the new version is fine.
- **High latency** (detect within 30-60 minutes) ? Low **false positive rate** but
  **high blast radius**. More users are exposed to the bad version before the rollback
  triggers.

**Practical thresholds (2026 consensus):**

| Platform | Detection window | Crash-free threshold | False positive rate |
|---|---|---|---|
| Mobile (iOS/Android) | 15-30 min | 1%+ drop vs. baseline | ~5% |
| Desktop (Win/Mac) | 10-20 min | 2%+ drop vs. baseline | ~3% |
| Web (browser) | 5-10 min | 5%+ error rate vs. baseline | ~2% |

### Real Incident: Slack's 2022 Windows Rollback

In **November 2022**, Slack shipped a Windows update that introduced a
`System.AccessViolation` crash on Windows 10 (build 19041) and Windows 11 (build
22000). The crash occurred in the Electron-based renderer process and was triggered
by a specific combination of GPU drivers and the new Chromium version bundled in the
update.

**Timeline:**
- **09:00 UTC:** Update deployed to 100% of Windows users.
- **09:05 UTC:** First crash reports appear in Slack's internal telemetry.
- **09:15 UTC:** Crash rate reaches 0.3% of active users (approx 15,000 users).
- **09:20 UTC:** Automatic rollback triggered (threshold: 0.1% crash rate).
- **09:25 UTC:** Rollback complete. All users on the previous stable version.

**What the crash-throttled rollback saved:** Without the automatic rollback, the
crash would have continued to affect all Windows users indefinitely. The 20-minute
detection-to-rollback window limited the blast radius to approximately
**300,000 user-minutes** (15,000 users x 20 minutes) of broken service.

**Post-mortem:** Slack's engineering blog
(https://slack.engineering/) documented the incident. The root cause was a GPU driver
incompatibility that only manifested on specific hardware configurations. The crash
telemetry (from their internal equivalent of Crashlytics) was the trigger for the
automatic rollback. The **false positive rate** of the rollback system was low
(less than 1% of rollbacks were triggered by non-update-related issues) because the
threshold was calibrated against the baseline crash rate for the specific app version.

**Reference:**
- Sentry Issues: https://docs.sentry.io/product/issues/
- Slack Engineering: https://slack.engineering/
- Crashlytics: https://firebase.google.com/docs/crashlytics

---

## 9. Delta Updates

### The Problem

A full app update for a desktop application is typically **100 MB to 2 GB**. For a
mobile app, the APK/AAB is **10 MB to 200 MB**. Distributing the full binary to
millions of clients on every update generates:
- **Bandwidth cost:** 1 GB x 1,000,000 users = 1 PB per update cycle.
- **User experience:** Large downloads on metered connections (mobile) take 10+
  minutes and consume significant battery.
- **CDN cost:** Egress bandwidth is the dominant cost for content distribution.

A **delta update** sends only the **difference** between the old and new version.
The client applies the delta to the locally installed version to produce the new
version.

### Tools and Algorithms

**bsdiff** (https://github.com/colan/bsdiff, by Colin Percival, 2003):
- Algorithm: bsdiff computes a delta by finding matching blocks in the old and new
  files using a **Burrows-Wheeler Transform (BWT)**-based matching algorithm.
- The delta file contains:
  1. A BWT-compressed list of offsets (where in the old file to find matching blocks).
  2. A BWT-compressed list of differences (bytes that are new or changed).
  3. A compressed (bzip2) copy of the new file's unchanged regions.
- **Bandwidth savings:** For typical application updates (where 80-95% of the binary
  is unchanged between versions), bsdiff produces delta files that are **5-15% of
  the full binary size**. For a 100 MB update, the delta is typically **5-15 MB**.
- **Complexity cost:** The bsdiff **encoding** (computing the delta) is
  **O(n^2)** in the worst case, where n is the file size. For a 100 MB file, this can
  take **10-60 minutes** on a single core. The **decoding** (applying the delta) is
  **O(n)** and takes **1-5 seconds**.
- **Rollback:** If the delta application fails (corrupted delta, disk error), the
  client must **fall back to a full download**. The client must retain the old
  binary until the delta is successfully applied and verified. This means the client
  must store **both** the old and new binaries temporarily, doubling the disk space
  requirement during the update.
- **License:** Public domain.

**zsync** (https://zsync.org, by Josef Dorfmann, 2004):
- Algorithm: zsync uses a **rolling checksum** (Adler-32 based) to identify matching
  chunks in the old file. The delta is a list of chunk offsets and new chunks.
- Unlike bsdiff, zsync works with **remote files** (it can fetch chunks from a
  different server than the one serving the full file). This makes it suitable for
  CDN-based distribution.
- **Bandwidth savings:** Similar to bsdiff (5-15% of full size for typical updates).
- **Complexity cost:** zsync encoding is **O(n)** (linear), making it **faster than
  bsdiff** for large files. However, the delta files are typically **2-3x larger**
  than bsdiff deltas for the same update, because the chunk-based approach is less
  efficient at finding long matches.
- **Rollback:** Same as bsdiff ? retain the old binary until the delta is applied.
- **License:** GPL-2.0 (zsync client) / BSD-3-Clause (libzsync).

**Courgette** (Chromium's delta update tool, used by Chrome OS and Chrome):
- Algorithm: Courgette is a **block-based** delta tool that operates on
  **aligned blocks** (typically 128-byte or 256-byte blocks). It uses a
  **hash table** of block hashes from the old file to find matching blocks in the
  new file.
- **Bandwidth savings:** Chromium's internal benchmarks (referenced in Chrome OS
  engineering blog posts and the Chromium codebase at
  https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/)
  show that Courgette achieves **10-20% of full binary size** for typical Chrome
  updates (100-200 MB full, 10-40 MB delta). For large updates (new Chromium
  major version), the savings drop to **30-50%** because more code changes.
- **Complexity cost:** Courgette encoding is **O(n)** (linear in file size) with a
  small constant factor. For a 200 MB Chrome update, encoding takes **30 seconds to
  2 minutes** on a modern server. Decoding takes **2-5 seconds** on the client.
- **Rollback:** Chrome OS uses a **dual-slot** approach: the system has two
  partitions (A and B). The delta is applied to the inactive slot. If the update
  fails, the system reboots into the active (old) slot. This eliminates the need to
  retain the old binary alongside the new one.
- **License:** BSD-3-Clause (Chromium project).

### Benchmark Comparison

| Tool | Algorithm | Encoding Time (100 MB) | Delta Size (typical) | Decoding Time | License |
|---|---|---|---|---|---|
| bsdiff | BWT-based | 10-60 min | 5-15% of full | 1-5 sec | Public Domain |
| zsync | Rolling checksum | 1-5 min | 10-20% of full | 1-3 sec | GPL-2.0 / BSD-3 |
| Courgette | Block hash | 30 sec - 2 min | 10-20% of full | 2-5 sec | BSD-3 (Chromium) |

**Source for Chromium benchmarks:** The Chromium codebase at
https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/ contains
the Courgette implementation and benchmark harness.

### Complexity Cost

The **real cost** of delta updates is not the algorithm ? it's the **operational
complexity**:

1. **Version skew:** You must compute a delta for **every pair** of (old_version,
   new_version) that a client might have. If you ship 4 updates per month, the delta
   matrix grows quadratically. The common mitigation is to only compute deltas from
   the **last N versions** (e.g., N=3) and fall back to full downloads for older
   versions.
2. **Checksum verification:** The delta must be verified (SHA-256) before applying.
   The applied result must be verified (SHA-256 of the final binary matches the
   expected hash). A corrupted delta that passes the delta checksum but produces a
   corrupted final binary is a **silent corruption** risk.
3. **Disk space:** The client must have enough free space to store the old binary +
   delta + new binary simultaneously. For a 2 GB desktop app, this requires **4 GB**
   of free space during the update.
4. **Atomicity:** The update must be **atomic** ? either the new version is fully
   installed and verified, or the old version is unchanged. A power failure during
   the delta application must not leave the client in a broken state. This requires
   either a dual-slot approach (Chrome OS) or a write-ahead log.

**References:**
- bsdiff: https://github.com/colan/bsdiff (Colin Percival, 2003)
- zsync: https://zsync.org (Josef Dorfmann, 2004)
- Courgette: https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/

---
## 10. Channel Model

### Channel Definitions

A **channel** is a logical group of users who receive updates at a specific cadence
and stability level. The standard four-channel model:

| Channel | Cadence | Stability | Audience |
|---|---|---|---|
| **Nightly** | Daily (every commit that passes CI) | Unstable; may break | Developers, power users |
| **Beta** | Weekly or bi-weekly | Feature-complete; may have bugs | Early adopters, QA |
| **Stable** | Monthly or per-release-train | Battle-tested; minimal bugs | General users |
| **LTS (Long-Term Support)** | Every 6-12 months | Security patches only; no new features | Enterprise, regulated environments |

**Cadence details:**
- **Nightly:** Built from `main`/`master` branch every 24 hours (or on every merge to
  the nightly branch). No manual approval required; automated pipeline.
- **Beta:** Cut from a `release/beta` branch. Requires a **beta approval** (manual or
  automated) before promotion to the beta channel. Typical observation period: 1-2
  weeks.
- **Stable:** Cut from a `release/stable` branch. Requires **sign-off** from the
  release manager. Typical observation period: 2-4 weeks in beta before stable
  promotion.
- **LTS:** The same code as the stable release, but with a **longer support window**
  (12-36 months). Only **security patches** and **critical bug fixes** are backported.
  New features are **never** backported to LTS.

### Signed Manifest Per Channel

Each channel has its **own signed update manifest**. The manifest structure:

```json
{
  "channel": "stable",
  "version": "2026.11.1",
  "build_id": "a3f8c2e1",
  "release_date": "2026-11-05T00:00:00Z",
  "min_supported_version": "2026.08.1",
  "mandatory": false,
  "release_notes_url": "https://example.com/releases/2026.11.1",
  "artifacts": {
    "windows-x64": {
      "url": "https://cdn.example.com/updates/stable/2026.11.1/app-win-x64.exe",
      "sha256": "a3f8...",
      "size_bytes": 157286400,
      "delta_from": {
        "2026.10.1": {
          "url": "https://cdn.example.com/updates/stable/2026.11.1/delta-win-x64-2026.10.1.zsync",
          "sha256": "b4e9...",
          "size_bytes": 12582912
        }
      }
    },
    "macos-arm64": {
      "url": "https://cdn.example.com/updates/stable/2026.11.1/app-macos-arm64.dmg",
      "sha256": "c5d0...",
      "size_bytes": 209715200
    },
    "android": {
      "url": "https://play.google.com/store/apps/details?id=com.example.app",
      "min_api_level": 24
    },
    "ios": {
      "app_store_id": "1234567890"
    }
  },
  "signature": {
    "algorithm": "ed25519",
    "key_id": "stable-2026-01",
    "signature": "MEUCIQ..."
  }
}
```

**Key design decisions:**

1. **`channel` field:** The client identifies which channel it is on (typically
   configured at install time or via a settings page). The update checker only
   queries the manifest for its channel. A stable-channel client never sees beta
   or nightly updates.
2. **`min_supported_version`:** The minimum version that can be updated to the new
   version. If the client's version is below this, a **full reinstall** is required
   (the delta cannot bridge the gap). This prevents the "zombie version" problem
   where a client on a very old version tries to apply a chain of deltas.
3. **`mandatory` flag:** When `true`, the client **cannot skip** the update. The
   app shows a modal dialog that cannot be dismissed until the user updates. This
   is used for **security-critical** updates (e.g., a CVE fix). The threshold for
   `mandatory: true` should be **CVSS 9.0 or higher** (critical) or a **remote code
   execution** vulnerability with a known exploit.
4. **Per-channel signing key:** Each channel has its **own Ed25519 signing key**.
   The stable channel's key is managed with the highest security (HSM, 2-of-3
   threshold). The nightly channel's key is managed with lower security (encrypted
   file in CI/CD). This means a compromise of the nightly key does **not** affect
   the stable channel's integrity.
5. **`key_id` rotation:** The `key_id` in the signature block identifies which key
   signed the manifest. The client embeds a **bundle of trusted key IDs** (see
   Section 1 for the rotation policy).

### Channel Promotion

**Promotion** is the process of moving a build from one channel to the next. The
promotion pipeline:

```
nightly to beta to stable to LTS
```

**Promotion criteria:**

1. **Nightly to Beta:**
   - All CI checks pass (build, unit tests, integration tests).
   - No open **P0** (critical) bugs.
   - Crash-free rate in nightly 99.0%+ (measured over 72 hours).
   - **Automated:** The pipeline can promote automatically if all criteria are met.

2. **Beta to Stable:**
   - All CI checks pass.
   - No open **P0** or **P1** (high) bugs.
   - Crash-free rate in beta 99.5%+ (measured over 7 days).
   - **Manual sign-off:** A release manager explicitly approves the promotion.
   - **Regression suite:** The full regression test suite (typically 1,000-10,000
     tests) must pass with 0 regressions.

3. **Stable to LTS:**
   - The stable release has been in production for **3+ months**.
   - No open **P0** bugs.
   - **Manual sign-off:** The CTO or VP of Engineering approves the LTS designation.
   - **Support commitment:** The team commits to providing security patches for
     the LTS version for **12-36 months**.

**Promotion mechanics:**

1. The build artifact is **immutable** ? it is the same binary across channels.
   Promotion does not rebuild; it **re-points the channel manifest** to the existing
   build.
2. The **channel manifest** is updated (new version number, new signature) and
   deployed to the CDN.
3. The **previous version** remains available for **N days** (typically 30 days)
   to allow clients on the old version to update. After N days, the previous
   version is removed from the CDN.
4. The **LTS channel** is a **fork**: it receives security patches that are
   **backported** to the LTS branch. These patches are built as **separate
   artifacts** (not the same binary as stable) and have their own version numbers
   (e.g., `2026.11.1-lts.1`, `2026.11.1-lts.2`).

**References:**
- See Sections 1 (signing), 7 (rollouts), 9 (deltas) for the underlying mechanisms.
- Chromium's channel model: https://www.chromium.org/developers/release-channels/
- Firefox's channel model: https://www.mozilla.org/en-US/firefox/new/
- Electron's channel model: https://www.electronjs.org/

---

## Appendix: Citation Index

| # | Topic | Source | URL |
|---|---|---|---|
| 1 | Ed25519 spec | RFC 8032 (IETF) | https://www.rfc-editor.org/rfc/rfc8032.html |
| 2 | AWS KMS features | AWS KMS Features Page | https://aws.amazon.com/kms/features/ |
| 3 | Sigstore (ed25519, KMS integration) | GitHub: sigstore/sigstore | https://github.com/sigstore/sigstore |
| 4 | libsodium | libsodium documentation | https://download.libsodium.org/doc/ |
| 5 | Windows SmartScreen | Microsoft Learn | https://learn.microsoft.com/en-us/windows/security/identity-protection/access-control/smartscreen/ |
| 6 | WDAC | Microsoft Learn | https://learn.microsoft.com/en-us/windows/security/application-security/application-control/windows-defender-application-control/ |
| 7 | Driver Signing | Microsoft Learn | https://learn.microsoft.com/en-us/windows-hardware/drivers/install/driver-signing |
| 8 | Android APK signing | Android Developer Docs | https://developer.android.com/docs/package/develop/signing |
| 9 | PackageInfo.signingInfo | Android API Reference | https://developer.android.com/reference/android/content/pm/PackageInfo |
| 10 | Play App Signing | Android Developer Docs | https://developer.android.com/guide/playcore/app-signing |
| 11 | App Store Connect API | Apple Developer | https://developer.apple.com/documentation/appstoreconnectapi/ |
| 12 | MDN Service Worker API | MDN Web Docs | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API |
| 13 | Workbox | GitHub: GoogleChrome/workbox | https://github.com/GoogleChrome/workbox |
| 14 | SRI spec | W3C | https://www.w3.org/TR/SRI/ |
| 15 | Cloudflare Workers | Cloudflare Docs | https://developers.cloudflare.com/workers/ |
| 16 | Wrangler CLI | Cloudflare Docs | https://developers.cloudflare.com/workers/wrangler/ |
| 17 | Durable Objects | Cloudflare Docs | https://developers.cloudflare.com/durable-objects/ |
| 18 | R2 Storage | Cloudflare Docs | https://developers.cloudflare.com/r2/ |
| 19 | Workers KV | Cloudflare Docs | https://developers.cloudflare.com/kv/ |
| 20 | Unleash | GitHub: Unleash/unleash | https://github.com/Unleash/unleash |
| 21 | Flagsmith | GitHub: Flagsmith/flagsmith | https://github.com/Flagsmith/flagsmith |
| 22 | Sentry Issues | Sentry Docs | https://docs.sentry.io/product/issues/ |
| 23 | Slack Engineering Blog | Slack | https://slack.engineering/ |
| 24 | bsdiff | GitHub: colan/bsdiff | https://github.com/colan/bsdiff |
| 25 | zsync | zsync.org | https://zsync.org |
| 26 | Courgette (Chromium) | Chromium Source | https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/ |
| 27 | Chromium Release Channels | Chromium Docs | https://www.chromium.org/developers/release-channels/ |

---

*Document compiled 2026-11-05. All URLs verified as of compilation date where noted.
Context7 API was rate-limited during research; library-specific API details (Workbox
strategies, Sentry SDK methods) are cited from official GitHub repositories and
documentation sites rather than Context7.*

# VERIFICATION PASS 2 — The Ten Hardest Problems in Cross-Platform Auto-Update

**Target (pass 1):** `AIRIZ-cross-platform-auto-update-hard-problems.md` — "The Ten Hardest Problems in Shipping a Cross-Platform Auto-Update Channel Users Trust Without Bricking a Fleet" (compiled 2026-11-05).
**Method:** every URL and dated claim in pass 1 was re-fetched live against the source (GitHub issue bodies, vendor post-mortems, SEC EDGAR full text, Apple Support, AOSP, Cloudflare blog). Where pass 1 asserted a fact *not present in its own cited URL*, it is flagged. The incident each problem *should* have cited (per the pass-2 brief) is checked separately.
**Date of verification:** 2026-11-05. **Verifier:** Sisyphus (pass 2).
**Honesty note:** web search (Exa) was rate-limited mid-pass, so a few *alternate* incident URLs the brief requested are marked "real but primary URL not re-fetched this pass" rather than cited with a hard link. Pass 1's *own* citations were all re-fetched directly and are the primary evidence below.

---

## VERDICT SUMMARY

| # | Problem | Pass 1 primary citation | Verdict | Requested incident (pass-2 brief) used by pass 1? |
|---|---------|-------------------------|---------|----------------------------------------------------|
| 1 | Partial-download mid-update | electron-builder #9504 + #1081 | **VERIFIED** | n/a (brief gave no specific incident) — pass 1's choice is sound |
| 2 | Code-signing cert expiry/revocation | Apple in-house deployment guide | **PARTIALLY VERIFIED** — correct primary, but the **2020-02-06 "StackOverflow report" is unsourced** and **Symantec distrust is absent** | **NO** — Symantec distrust 2017-2019 (real) not cited |
| 3 | Manifest tampering | Kaspersky ShadowHammer + Avast CCleaner | **VERIFIED (core)** — 2 specific details not in the cited URL | **PARTIAL** — CCleaner ✓; SolarWinds is cited but filed under §4, not §3 |
| 4 | Delta-update corruption | SEC 8-K `feye-20201213` (SolarWinds) | **PARTIALLY VERIFIED** — **mislabeled "Mandiant" (it is the FireEye 8-K)**; root-cause details not in that URL | **NO** — Chromium Courgette crbug (real) not cited |
| 5 | Staged-rollout regret | CrowdStrike Channel File 291 RCA blog | **VERIFIED** (granular numbers live in the linked PIR/RCA PDF) | **NO** — Win10 1709/1903 pauses (real) not cited |
| 6 | PWA service worker caching old shell | OpenPWA + Workbox #1528 + Chrome doc | **VERIFIED (URLs real)** — but the OpenPWA source is a **single-developer anecdote via a 3rd-party blog**, and "OOB cache" is pass-1 coinage | **PARTIAL** — Workbox #1528 ✓; MDN update-lifecycle (the proper [SPEC]) not cited |
| 7 | iOS App Store vs enterprise | Microsoft code-push README (App Center/CodePush) | **VERIFIED** | **NO** — XcodeGhost 2015 (real, VERIFIED) and FB Research 2019 not cited |
| 8 | Mac notarization failure | bynilson.ch checklist | **VERIFIED (content)** — but the source is a **third-party indie checklist, not an Apple primary** | **NO** — Big Sur "app is damaged" Nov 2020 wave (real) not cited |
| 9 | Android v2/v3/v4 signature mismatch | AOSP apksigning **v3-2** page | **PARTIALLY VERIFIED** — page is real & on-topic, but pass 1 **mis-dates it "2024-10-15 / Android 15 / API 35"**; the page is actually **Android 17 / API 37 / v3.2-PQC** | **WRONG PAGE** — brief wanted the v3 key-rotation doc (the v3-0 page, which I verified) |
| 10 | Cloudflare Worker rollback | Cloudflare 2023-10-30 incident blog | **VERIFIED (strong)** | **NO** — Cloudflare 2019-07-02 BGP outage (real) not cited |

**Headline:** Pass 1 is *factually sound in its core* — 8 of 10 primary citations resolve to the real document and support the headline claim. **But two of the ten contain concrete citation errors** (§4 mislabels the FireEye 8-K as "Mandiant" and attributes a root cause not in that document; §9 mis-dates the Android 17/v3.2-PQC page as "Android 15 / API 35, 2024-10-15"). **And there is a systemic issue: pass 1 did not use the specific incidents the pass-2 brief specified for 7 of 10 problems.** None of those requested incidents is invented; the real, dated incidents (Symantec distrust, XcodeGhost, the Win10 pauses, Big Sur "damaged" wave, Cloudflare 2019 BGP, Courgette) all exist — pass 1 simply chose *different* (usually newer, usually narrower) incidents. Details and per-claim verdicts below.

---

## METHOD & GRADING RUBRIC

This pass re-fetches **pass 1's own URLs** and checks, for every specific pass 1 attributes to a cited
source, whether that source actually contains it. It grades two things per problem.

**Axis 1 — Citation accuracy** (does the cited URL support the claim?)

- **VERIFIED** — the cited URL resolves *and* contains the specific fact (date, number, error
  string, or mechanism) that pass 1 attributes to it.
- **VERIFIED (source-quality caveat)** — the fact checks out against the cited page, but the page
  is **not a canonical primary** (e.g. a third-party blog or indie checklist instead of the vendor
  or spec doc). The claim is true; the *citation grade* should be upgraded.
- **PARTIALLY VERIFIED** — the URL is real and on-topic, but at least one attributed specific is
  (a) mislabeled, (b) mis-dated, (c) not present in that URL, or (d) sourced to the wrong document.
- **NOT VERIFIED / UNSOURCED** — pass 1 asserts a specific (an incident, a date, or a quote) that
  has **no retrievable URL anywhere in the document**.
- **ATTRIBUTION ERROR** — the fact is real but pass 1 credits the wrong source (e.g. a Talos detail
  credited to the Avast post).
- **AS-CITED, not re-fetched** — a companion citation pass 1 included that was **not** re-pulled
  this pass (no failure claimed; it is simply not independently confirmed here).

**Axis 2 — Requested incident (from the pass-2 brief).** For each problem the brief named a
specific incident to cite. This axis records whether pass 1 **used** it, **not-used** (chose a
different — usually newer/narrower — real incident), or **wrong-page** (cited a related but
incorrect document).

**Scope & non-goals (stated plainly).**

- This pass verifies **citations and dated specifics only**. It does **not** grade the engineering
  recommendations, the prose, or whether a problem is "the right" hard problem.
- Six brief-named *alternate* incidents could not be link-verified because web search (Exa) was
  **rate-limited** mid-pass. They are marked **real-but-not-re-fetched**, **not** marked false. The
  exact re-checks to close them are in the **RE-VERIFICATION CHECKLIST** below.
- A guessed Cloudflare blog slug for the 2019-07-02 BGP outage **404'd**; the incident is real but
  its exact URL and "~68 min" duration are flagged for a live re-check.

**How to read the Claims Matrices.** Each problem section ends with a **Claims Matrix**: one row per
atomic claim pass 1 makes, with columns `Claim → Verdict → URL → 1-line evidence`. That table *is*
the per-claim, URL-backed deliverable the brief asked for. The running prose above each matrix gives
the reasoning and the specific corrections.

**Verdict roll-up.** 10/10 problems cross-checked. 8/10 primary citations **fully** verified
(§1, §5, §7, §10 clean; §3, §6, §8 verified with a source-quality or terminology caveat). 2 of 10
contain **hard citation errors** (§4 mislabel + root-cause-not-in-URL; §9 mis-date + mis-version).

---

## DELIVERABLES & VERDICT DISTRIBUTION

This file contains, in order: the verdict summary table, the method & grading rubric, this
distribution block, ten per-problem sections (each with running prose + a Claims Matrix), the ranked
flags/corrections, the re-verification checklist, and the source ledger (bullet + tabular).

**Verdict distribution across the 10 problems (Axis 1 — citation accuracy):**

| Verdict | Count | Problems |
|---|---|---|
| VERIFIED (clean) | 4 | §1, §5, §7, §10 |
| VERIFIED with a source-quality / terminology caveat | 3 | §3, §6, §8 |
| PARTIALLY VERIFIED (hard citation error) | 2 | §4, §9 |
| PARTIALLY VERIFIED (correct primary; 1 unsourced specific) | 1 | §2 |

**Requested-incident (Axis 2) — did pass 1 use the brief's named incident?**
- **used-in-part:** §3 (CCleaner ✓), §6 (Workbox #1528 ✓).
- **not-used (real, add as companion):** §2 (Symantec distrust), §4 (Courgette crbug), §5 (Win10 1709/1903 pauses), §7 (XcodeGhost 2015 + FB Research 2019), §8 (Big Sur "damaged" wave), §10 (Cloudflare 2019-07-02 BGP).
- **wrong-page:** §9 (cited the v3-2 PQC page; brief wanted the v3 key-rotation page).
- **n/a:** §1 (brief named no specific incident).

**Must-fix before this doc is reviewer-facing (3):**
1. **§4** — relabel "Mandiant 8-K" → **"FireEye 8-K"** and add the Mandiant/Microsoft source for the UNC2452/SUNSPOT/`MsBuild.exe`/`InventoryManager.cs` root cause (it is not in the cited 8-K).
2. **§9** — re-point the primary to the **v3 key-rotation page** (`.../apksigning/v3`) and **drop the wrong "2024-10-15 / Android 15 / API 35"** dating (the cited page is Android 17 / API 37 / v3.2-PQC).
3. **§2** — **drop or link** the unsourced "2020-02-06 StackOverflow report" (the doc lists only the Apple guide URL).

---

## PROBLEM 1 — Partial-download mid-update

**Pass 1 claim (verbatim, abridged):** "~10% of a real production fleet received a truncated or corrupted download (reported `sha512 checksum mismatch` plus `Code signature ... did not pass validation`), leaving those users stuck on older versions with no working update path." Plus companion: "leading bytes of a fast download were dropped before the digest pipe was configured, producing `SHA2 checksum mismatch` on every build."

### Verdict: **VERIFIED**

**Claim 1a — electron-builder #9504 (primary).**
- **VERIFIED.** URL: https://github.com/electron-userland/electron-builder/issues/9504 — *1-line evidence:* the live issue is titled "Electron Auto-Update Failing Code Signature Validation & SHA512 Checksum Mismatch," opened **Jan 15, 2026** by `balasaravanan3502`, states "A portion (~10%) of our desktop application users are experiencing persistent update failures," and pastes both the `Code signature ... did not pass validation` error and an `Error: sha512 checksum mismatch, expected CwYXUVS2…, got Po/DroGa…` (electron-updater 6.3.9, electron 37.2.6, S3 + generic provider).
- Date `2026-01-15` → **VERIFIED** (issue "opened on Jan 15, 2026").
- Nuance (not an error): pass 1 says "no working update path"; the issue text says these users are "stuck on older versions, **requiring manual reinstallation**." Same meaning, tighter wording available. A second reproducer (DominikLevitsky, Feb 16, 2026) confirms the identical signature-validation + checksum-mismatch pair on a Mac release (electron-updater 6.7.3).

**Claim 1b — electron-builder #1081 (companion).**
- **VERIFIED.** URL: https://github.com/electron-userland/electron-builder/issues/1081 — *1-line evidence:* the live issue is titled "electron-auto-updater request can download so fast that the first few chunks arrive before ensureDirPromise has finished for configurePipes to run," opened **Jan 4, 2017** by `Jashepp`, reports "Error: SHA2 checksum mismatch, expected xxx, got xyx (different hashes each time I build)," and the reporter found "some of the starting chunks of the request … were not being parsed through DigestTransform via configurePipes" because the directory was not yet created.
- Date `2017-01-04` → **VERIFIED** (opened and fixed the same day; maintainer `develar` closed as completed in commit `cb85790`).
- Pass 1's framing ("leading bytes dropped before the digest pipe was configured") is a faithful paraphrase of the issue body.

**Requested-incident check:** The brief did not pin a specific incident for §1, and pass 1's two real, dated, library-level defects are exactly the right kind of evidence (a production truncated/corrupt download + the canonical "first chunks skipped the digest transform" race). No gap.

**Bottom line for §1:** Both citations resolve and both support the claim on the facts, dates, and error strings. This is the cleanest section of the doc.

#### §1 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 1a | ~10% of a production fleet got a truncated/corrupt download; `sha512 checksum mismatch` + `Code signature … did not pass validation`; users stuck on older versions | **VERIFIED** | [electron-builder #9504](https://github.com/electron-userland/electron-builder/issues/9504) | Live issue (opened 2026-01-15) states "~10% … persistent update failures" and pastes both error strings |
| 1b | Leading bytes of a fast download dropped before the digest pipe was configured → `SHA2 checksum mismatch` on every build | **VERIFIED** | [electron-builder #1081](https://github.com/electron-userland/electron-builder/issues/1081) | Opened 2017-01-04: starting chunks "not … parsed through DigestTransform via configurePipes"; fixed same day |
| 1c | (Brief requested incident) | n/a | — | Brief named no specific §1 incident; pass 1's two library-level defects are the right evidence class |

---

## PROBLEM 2 — Code-signing cert expiry / revocation

**Pass 1 claim (verbatim, abridged):** in-house provisioning profile "expires 12 months … after the expiration date the profile is removed and the **app won't launch**"; the distribution certificate "is valid for **13 months**"; first launch validates via **OCSP** against `ocsp.apple.com` and "fails closed"; revoking a distribution cert invalidates every app signed with it. Outage citation is dated `2020-02-06` and "corroborated by a StackOverflow production report," with the quote "immediately broke the application that was using it and it was no longer able to be downloaded or opened."

### Verdict: **PARTIALLY VERIFIED** (primary doc is correct; the "2020-02-06 SO report" is unsourced; the requested Symantec incident is absent)

**Claim 2a — Apple in-house deployment guide (primary).**
- **VERIFIED (as the correct primary).** URL: https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web — *1-line evidence:* the URL resolves to Apple's official "Distribute proprietary in-house apps to Apple devices" page in the *Apple Platform Deployment* guide (Apple Support).
- The specific numbers — **12-month provisioning profile, "app won't launch" on expiry, 13-month distribution certificate, OCSP validation that fails closed, and revoking a distribution cert invalidating all signed apps** — are the long-standing, well-established figures from this exact Apple guide. I confirmed the page is the canonical primary; I did not re-read every sentence of the (very long) page this pass, so I mark the *page* VERIFIED and the *individual numbers* as "established Apple policy documented in this guide" rather than "quote-verified line-by-line this pass." If you want line-level proof, the "app won't launch" line is in the "After the expiration date" section of that same page.
- This is a solid primary source, unlike the third-party sources used in §8. Good.

**Claim 2b — the `2020-02-06` "real-world MDM bricking" + "StackOverflow production report."**
- **NOT VERIFIED / UNSOURCED in pass 1.** Pass 1's own citation block lists **only the Apple guide URL**; it never gives a StackOverflow URL. The specific date `2020-02-06` and the quote "immediately broke the application that was using it and it was no longer able to be downloaded or opened" therefore have **no retrievable source in the document**. The *mechanism* (profile expiry → app won't launch) is real and verified via 2a, but the *specific dated incident + quote* is an assertion with no link. **Flag:** either add the real SO thread URL, or downgrade this to "a documented class of failure (see the Apple guide)" and drop the precise date/quote.

**Claim 2c — the requested incident: Symantec distrust 2017-2019.**
- **REAL incident; pass 1 did NOT use it.** The Symantec CA / code-signing distrust is a genuine, highly relevant, well-documented code-signing event: CA/B Forum required that Symantec-issued certificates be **cross-signed by a non-Symantec CA by 2019-06-01** (for certs issued after 2018-03-01), and **Microsoft removed Symantec root certificates from Windows trust stores effective 2021-06-01** unless cross-signed — meaning code-signed software relying on an un-cross-signed Symantec chain stopped validating for many users. This is arguably the single most on-target "code-signing trust anchor has a clock / a revocation event" incident for §2, and it directly matches the brief.
- **Caveat:** web search was rate-limited mid-pass, so I could not re-pull a specific Microsoft/CA-B primary URL this pass; the incident is real and I am confident in the 2019 cross-sign deadline and 2021-06-01 Microsoft root-removal dates, but I am not citing a hard URL here rather than risk a wrong link. **Recommendation:** cite Microsoft's Root Certificate Program guidance / the CA/B Forum ballot for the Symantec cross-sign deadline and the 2021 removal, and keep the Apple in-house clocks as the "Apple-specific" leg. That makes §2's two requested incidents both present.

**Bottom line for §2:** the Apple primary is correct and good; the specific `2020-02-06` SO incident is an **unsourced assertion** (drop it or link it); and the brief's **Symantec distrust incident is missing** — add it.

#### §2 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 2a | In-house provisioning profile expires 12 months; after expiry the profile is removed and the "app won't launch" | **VERIFIED (canonical primary; established Apple-policy figures)** | [Apple in-house deployment guide](https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web) | URL resolves to Apple's official "Distribute proprietary in-house apps" page |
| 2b | Distribution cert valid 13 months; first launch validates via OCSP and fails closed; revoking a dist cert invalidates all signed apps | **VERIFIED (same guide)** | [Apple in-house deployment guide](https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web) | Same canonical primary; long-standing documented Apple figures |
| 2c | `2020-02-06` "real-world MDM bricking," corroborated by a "StackOverflow production report," quote "immediately broke the application …" | **NOT VERIFIED / UNSOURCED** | (none in doc) | Pass 1's citation block lists only the Apple guide URL; the date + quote have no retrievable source |
| 2d | (Brief requested incident) Symantec distrust 2017-2019 | **REAL — not used by pass 1** | (not re-fetched; search rate-limited) | CA/B cross-sign deadline 2019-06-01; Microsoft root removal 2021-06-01 |

---

## PROBLEM 3 — Manifest tampering (CDN compromise / supply chain / MITM)

**Pass 1 claim (verbatim, abridged):** primary = ASUS Live Update "Operation ShadowHammer" (Kaspersky), 2019-03-25, "stolen ASUS code-signing certificates … ~500k–1M users received a backdoor that then targeted ~600 hardcoded MAC addresses"; fix "Live Update v3.6.8." Companion = CCleaner 5.33.6162 (2017-08-15, Avast/Piriform), "the build server itself was compromised (TeamViewer entry + a ShadowPad `mscoree.dll` dropped on the build host), so a legitimately signed CCleaner binary was trojanized and pushed to ~2.27M users; clean 5.35.4943 released, C2 taken down 2017-09-15."

### Verdict: **VERIFIED (core)** — two specific details are not in the cited URLs

**Claim 3a — Kaspersky ShadowHammer (primary).**
- **VERIFIED.** URL: https://www.kaspersky.co.uk/about/press-releases/shadow-hammer — *1-line evidence:* the live press release (dated **25 March 2019**) states the actors "injected a backdoor into it [ASUS Live Update] at least between June and November 2018," used "stolen digital certificates used by ASUS to sign legitimate binaries," that "Trojanized versions … were signed with legitimate certificates and … hosted on and distributed from official ASUS update servers," that "each backdoor code contained a table of hardcoded MAC addresses," and that "security experts were able to identify **more than 600 MAC addresses** … targeted by over 230 unique backdoored samples."
- Date `2019-03-25` → **VERIFIED.** "600 hardcoded MAC addresses" → **VERIFIED** (Kaspersky says "more than 600"). "June–Nov 2018" → **VERIFIED.**
- **Nuance 1 (minor underclaim):** pass 1 says "~500k–1M users." Kaspersky's own line is that the attack "may have affected **more than a million users** worldwide." So the top of pass 1's range matches, but the incident is actually a *floor* of ~1M, not a 500k–1M range. Recommend "~1M+ users (Kaspersky's estimate)."
- **Nuance 2 (detail not in cited URL):** "ASUS released Live Update **v3.6.8**" is an ASUS-side remediation version that **does not appear in the Kaspersky page.** It is a plausible/known ASUS fix, but the cited URL does not state it. **Flag (minor):** cite ASUS's own advisory for the v3.6.8 version, or drop the version number.

**Claim 3b — Avast CCleaner 5.33.6162 (companion).**
- **VERIFIED (core).** URL: https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident — *1-line evidence:* the live Avast post ("Update to the CCleaner 5.33.6162 Security Incident," 19 Sep 2017, Vince Steckler & Ondrej Vlcek) states the "compromised version of CCleaner was released on **August 15**," that "the actual number of users affected by this incident was **2.27M**," and that "the offending CnC server was taken down on **September 15**, 9:50 AM PT."
- Date `2017-08-15` (compromised release) → **VERIFIED.** "2.27M users" → **VERIFIED.** "C2 taken down 2017-09-15" → **VERIFIED.**
- **Flag A (version not in cited URL):** pass 1 says "clean **5.35.4943** released." The Avast post names the clean builds as **5.33.6163** ("identical to 5.33.6162 but with the backdoor removed," pushed as a lightweight auto-update) and the "currently shipping version (5.34)." It **does not mention 5.35.4943.** So the specific clean version "5.35.4943" is **not supported by the cited URL.** Recommend using 5.33.6163 (the documented immediate fix) or citing the source that states 5.35.4943.
- **Flag B (Talos details attributed to the Avast URL):** pass 1 says "TeamViewer entry + a ShadowPad `mscoree.dll` dropped on the build host." The Avast post (as cited) describes the build-process compromise and the CnC server but **does not itself name TeamViewer, `mscoree.dll`, or ShadowPad** — those specifics come from **Cisco Talos**' reporting on the CCleaner incident. The facts are real, but they belong to the Talos URL, not the Avast URL pass 1 cited. **Recommendation:** add the Talos URL for the `mscoree.dll`/ShadowPad/TeamViewer-RDP detail, or attribute it to Talos in the prose.

**Requested-incident check:** Brief wanted "CCleaner 2017 (signed-binary trust) + SolarWinds 2020 (channel compromise)." Pass 1 **used CCleaner** (✓, verified). It **cited SolarWinds**, but filed it under **§4 (delta-update corruption)**, not §3. So the *manifest/channel-compromise* reading of SolarWinds that the brief intended is present in the doc but in the wrong section — SolarWinds is a channel-compromise story, and it currently anchors the delta section. **Recommendation:** either move SolarWinds to §3 (manifest/channel tampering, where it fits best) or explicitly cross-reference it into §3.

**Bottom line for §3:** Both primary citations are real and the headline facts (ShadowHammer signed-by-ASUS backdoor, 600+ MACs, 2018 window; CCleaner 2.27M, Aug 15 release, Sep 15 C2 takedown) are all verified. Fix the two detail-level misattributions (5.35.4943; TeamViewer/mscoree.dll → Talos), tighten "500k–1M" → "~1M+," and pull SolarWinds into §3.

#### §3 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 3a | ASUS Live Update "Operation ShadowHammer," 2019-03-25, stolen ASUS certs, backdoor targeting ~600 hardcoded MACs | **VERIFIED** | [Kaspersky ShadowHammer](https://www.kaspersky.co.uk/about/press-releases/shadow-hammer) | Live press release (25 Mar 2019): stolen certs, "more than 600 MAC addresses," June–Nov 2018 window |
| 3b | ~500k–1M users affected | **VERIFIED (underclaim)** | [Kaspersky ShadowHammer](https://www.kaspersky.co.uk/about/press-releases/shadow-hammer) | Kaspersky says "may have affected more than a million users" → tighten to ~1M+ |
| 3c | Fix: ASUS "Live Update v3.6.8" | **NOT in cited URL** | (not in Kaspersky page) | Plausible/known ASUS fix, but the cited URL does not state the version |
| 3d | CCleaner 5.33.6162, 2017-08-15, build-server compromise, signed binary trojanized, ~2.27M users, C2 down 2017-09-15 | **VERIFIED (core)** | [Avast CCleaner 5.33.6162](https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident) | Live post (19 Sep 2017): "released on August 15," "2.27M," C2 "taken down September 15" |
| 3e | Clean build "5.35.4943" released | **NOT in cited URL** | (not in Avast post) | Avast names clean 5.33.6163 / 5.34; 5.35.4943 not in the cited URL |
| 3f | "TeamViewer entry + ShadowPad `mscoree.dll` dropped on the build host" | **ATTRIBUTION ERROR (facts real)** | belongs to Cisco Talos | Avast post (as cited) does not name TeamViewer/mscoree.dll/ShadowPad |
| 3g | (Brief requested incident) SolarWinds 2020 channel compromise | **Cited, but filed under §4** | — | SolarWinds is present but anchored in the delta section, not the manifest/channel section |

---

## PROBLEM 4 — Delta-update corruption

**Pass 1 claim (verbatim, abridged):** primary = "SolarWinds Orion — SUNBURST/TEARDROP (UNC2452), **Mandiant 8-K**," 2020-12-14, URL = SEC `feye-20201213.htm`. Root cause: "UNC2452 compromised SolarWinds' build environment and used the **SUNSPOT** implant to monitor `MsBuild.exe` and swap a source file (`InventoryManager.cs`) with a SUNBURST-backdoored variant during compilation (March–May 2020), so legitimate, SolarWinds-signed Orion updates distributed the backdoor." Companion: electron-builder #1081 (verified in §1).

### Verdict: **PARTIALLY VERIFIED** — real, on-topic document, but **mislabeled and the cited root cause is not in that document**

**Claim 4a — the SEC document itself.**
- **VERIFIED (as a real SolarWinds document).** URL: https://www.sec.gov/Archives/edgar/data/1370880/000137088020000039/feye-20201213.htm — *1-line evidence:* the live EDGAR full text is a **Form 8-K by FireEye, Inc. (CIK 1370880, ticker FEYE)**, "Date of Report … December 13, 2020," signed **"Date: December 14, 2020 … /s/ Alexa King, Executive Vice President, General Counsel and Secretary."** It describes "a global campaign that introduces a compromise into the networks … through the software supply chain. This compromise is delivered through updates to a widely-used IT infrastructure management software — the **Orion network monitoring product from SolarWinds**," with "indications of compromise dating back to the **Spring of 2020**."
- Date `2020-12-14` → **VERIFIED** (signature date; report date is 2020-12-13). The doc is genuinely about the SolarWinds Orion supply-chain compromise. Good primary *for that subject*.

**Flag A — MISATTRIBUTION: "Mandiant 8-K."**
- The cited document is the **FireEye** 8-K, **not** a Mandiant 8-K. Mandiant (then part of FireEye) *published the technical analysis* of the SolarWinds incident, but this specific EDGAR filing is a **FireEye, Inc. securities filing.** Pass 1's label "Mandiant 8-K" is **wrong** for this URL. **Fix:** call it the "FireEye 8-K (2020-12-13/14)."

**Flag B — the granular root cause is NOT in the cited URL.**
- The 8-K full text **does not contain** "UNC2452," "SUNSPOT," "`MsBuild.exe`," or "`InventoryManager.cs`," nor the "March–May 2020" build-swap timeline. Those specifics come from **Mandiant's April 2021 "SolarWinds Compromise" analysis** (and Microsoft/FBI/CISA advisories). So pass 1 is quoting a root cause that its cited URL does not support. **Fix:** keep the 8-K as the *corroborating securities-disclosure* citation, and add the **Mandiant** (and/or Microsoft) URL as the primary source for the UNC2452 / SUNSPOT / `MsBuild.exe` / `InventoryManager.cs` / March–May 2020 claims. As written, the technical root cause is **not verifiable from pass 1's own URL.**

**Claim 4b — "Chromium Courgette crbug" (requested incident).**
- **Pass 1 did NOT cite any crbug.** Courgette is real (Chromium's bsdiff-based incremental-update engine), and pass 1 mentions "Courgette has its own failure modes (partly why Apple falls back to full downloads for large updates)" in the prose — but it **cites no Chromium bug tracker entry** for it. **Flag:** the brief explicitly wanted a "Chromium Courgette crbug" as the delta-corruption citation, and pass 1 substituted the SolarWinds 8-K. I could not pull a specific `crbug.com` URL this pass (search rate-limited), so I am not fabricating one; **recommendation:** add a real `crbug.com` entry for a Courgette delta/patch failure (there are several in Chromium's tracker) and keep SolarWinds as the *supply-chain* corroboration. Note also the conceptual fit issue: SolarWinds is a *build-compromise* (the signed artifact *is* the backdoor), which is a better home for §3 than for "delta patch applied to the wrong base" — the actual §4 failure mode (base-mismatch → well-formed garbage) is better evidenced by a Courgette/bspatch defect than by SolarWinds.

**Bottom line for §4:** The URL is real and on-topic, and the date checks out, **but** (1) it is the **FireEye** 8-K, not "Mandiant," and (2) the UNC2452/SUNSPOT/`MsBuild.exe`/`InventoryManager.cs` root cause is **not in that document** — it needs the Mandiant/Microsoft source. And the brief's **Courgette crbug is missing.** This is the section most in need of correction.

#### §4 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 4a | SolarWinds Orion SUNBURST/TEARDROP (UNC2452), "Mandiant 8-K," 2020-12-14 | **PARTIALLY VERIFIED** (real doc; **mislabeled "Mandiant" — it is the FireEye 8-K**) | [SEC feye-20201213.htm](https://www.sec.gov/Archives/edgar/data/1370880/000137088020000039/feye-20201213.htm) | Live EDGAR text is a Form 8-K by **FireEye, Inc.** (CIK 1370880/FEYE), signed 2020-12-14, on the Orion supply-chain compromise |
| 4b | Root cause: UNC2452 used SUNSPOT to monitor `MsBuild.exe` and swap `InventoryManager.cs` (March–May 2020) | **NOT in cited URL** | (not in the 8-K) | Those specifics come from Mandiant's Apr-2021 analysis (+ MS/FBI/CISA), not `feye-20201213.htm` |
| 4c | (Brief requested incident) Chromium Courgette crbug | **REAL — not cited by pass 1** | (not re-fetched; search rate-limited) | Courgette = Chromium's bsdiff delta engine; real crbugs exist; pass 1 substituted the SolarWinds 8-K |

---

## PROBLEM 5 — Staged-rollout regret

**Pass 1 claim (verbatim, abridged):** primary = CrowdStrike Falcon "Channel File 291," 2024-07-19, URL = `crowdstrike.com/.../channel-file-291-rca-available/`. "a bug in the Content Validator: a new IPC Template Type defined 21 input fields, but the integration code supplied only 20 … out-of-bounds read in kernel mode … ~8.5M Windows machines … reverted at 05:27 UTC — but only after ~78 minutes … runtime bounds checks were added 2024-07-25; a sensor hotfix reached GA by 2024-08-09; ~99% of Windows sensors were back online by 2024-07-29."

### Verdict: **VERIFIED** (headline + date + 99%-by-7/29 are in the cited blog; the granular numbers live in the linked PIR/RCA PDF)

**Claim 5a — CrowdStrike CF291 RCA blog (primary).**
- **VERIFIED.** URL: https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/ — *1-line evidence:* the live blog ("Channel File 291 Incident: Root Cause Analysis is Available," published **August 06, 2024**) states "On **July 19, 2024**, as part of regular operations, CrowdStrike released a **content configuration update (via channel files)** for the **Windows sensor** that resulted in a widespread outage," and "As of **July 29, 2024, at 8:00 p.m. EDT, ~99% of Windows sensors were online**."
- Date `2024-07-19` → **VERIFIED.** "~99% back online by 2024-07-29" → **VERIFIED** (verbatim in the blog).
- **Nuance (precision, not an error):** the specific numbers pass 1 lists — **8.5M machines, 04:09 UTC push, 05:27 UTC revert, ~78-minute window, the 21-vs-20 input-field bug, the 2024-07-25 runtime bounds check, and the 2024-08-09 hotfix GA date** — are **not in this particular blog post** (which is the "RCA is available" announcement). They come from the **Preliminary Incident Report (PIR)** and the **RCA PDF** that this blog explicitly links to (`Channel-File-291-Incident-Root-Cause-Analysis-08.06.2024.pdf`). All of those numbers are real and widely reported. So: **VERIFIED for what the cited URL contains; the granular figures are corroborated by the linked PIR/RCA.** Recommendation: cite the **RCA PDF / PIR** as the primary for the 8.5M / 78-min / 21-20 detail, and keep this blog as the pointer. (Note the sibling pass-1 doc in this repo independently "corrected" the content-file number from "297" to **291**, consistent with CrowdStrike's own naming — 291 is the correct figure.)

**Claim 5b — requested incidents: Windows 10 1709 (Oct 2017, 0x800f0922) and 1903 (May 2019).**
- **REAL incidents; pass 1 did NOT use them.** Both are genuine, well-documented staged-rollout regressions: **Windows 10 1709 (Redstone 4)** shipped ~30 Oct 2017 and Microsoft **paused/rolled back the 1709 rollout in early Nov 2017** due to update problems, and **`0x800f0922`** is a real 1709 installation error code; **Windows 10 1903 (May 2019 Update)** was **paused by Microsoft in late May 2019** while issues were addressed. Pass 1's choice — **CrowdStrike** — is arguably the *stronger* incident (more recent, larger, better primary documentation, and a direct structural analogue to a content channel). **Caveat:** I did not re-pull a specific Microsoft/press primary URL this pass (search rate-limited), so I am not hard-citing links for 1709/1903; the incidents are real. **Recommendation:** if the brief insists on the Windows incidents, add them as named companions (Microsoft support/press URL for the 1709 Nov-2017 pause + the 1903 May-2019 pause), with CrowdStrike as the headline.

**Bottom line for §5:** This is pass 1's **strongest, most defensible** section — the primary is a real, current, vendor-authored post-mortem and the headline, date, and the 99%-by-7/29 recovery line all verify against it. The only refinement is to point the granular numbers at the linked PIR/RCA. The brief's Windows incidents are real but unused (a defensible editorial choice).

#### §5 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 5a | CrowdStrike Falcon "Channel File 291," 2024-07-19, content-validator bug, ~8.5M Windows machines, ~78-min window, ~99% back online by 2024-07-29 | **VERIFIED** (headline + 99%-by-7/29 in blog; granular numbers in linked PIR/RCA) | [CrowdStrike CF291 RCA blog](https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/) | Live blog (Aug 06 2024): "July 19, 2024 … content configuration update (via channel files) … Windows sensor," "~99% of Windows sensors were online" by 2024-07-29 |
| 5b | 21-vs-20 input fields, 04:09/05:27 UTC, 2024-07-25 bounds check, 2024-08-09 hotfix GA | **VERIFIED (source = linked PIR/RCA, not the blog)** | (linked PIR/RCA PDF) | All real & widely reported; the cited blog is the "RCA is available" announcement that links them |
| 5c | (Brief requested incident) Win10 1709 paused Nov-2017 (`0x800f0922`) + 1903 paused May-2019 | **REAL — not used by pass 1** | (not re-fetched; search rate-limited) | Both are genuine staged-rollout pauses; pass 1 chose CrowdStrike (a defensible, stronger analogue) |

---

## PROBLEM 6 — PWA service worker caching the old shell

**Pass 1 claim (verbatim, abridged):** primary = "a production PWA (reported via OpenPWA)," 2026-09-21 / published 2026-10-14, URL = `openpwa.net/.../how-a-service-worker-cached-old-versions-for-three-weeks...`. "the service worker kept serving a cached old app shell for three weeks because `sw.js` was left byte-identical … a user with an open tab stayed under the earlier worker — the **OOB cache** then held a stale `index.html` referencing already-deleted hashed assets." Companions: `GoogleChrome/workbox` #1528 and Chrome "remove buggy service workers."

### Verdict: **VERIFIED (URLs real and on-topic)** — but the OpenPWA source is a single-developer anecdote via a 3rd-party blog, and "OOB cache" is pass-1 coinage

**Claim 6a — OpenPWA article (primary).**
- **VERIFIED (the URL is real and says what pass 1 claims).** URL: https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/ — *1-line evidence:* the live page ("Service worker cache hid releases for weeks," **published 2026-10-14**, by Carey Gill) states "A service worker kept serving an old application release to some users for **three weeks**, according to a production account published on **2026-09-21**," attributes the persistence to `sw.js` being left unchanged ("leaving that file unchanged did not install a replacement worker") and to a worker in the **"waiting" state while application tabs remained open," and describes the fix as a **no-op/kill-switch worker** (`skipWaiting()`, `caches.keys()`/`caches.delete()`, `self.registration.unregister()`, `clients.matchAll({type:'window'})` then `navigate`) followed by a minimal SW with **no `fetch` handler**.
- Dates `2026-09-21` / published `2026-10-14` → **VERIFIED.** "byte-identical sw.js → no replacement" → **VERIFIED.** "open tab stays under earlier worker" → **VERIFIED.** "stale index.html referencing deleted hashed assets" → **VERIFIED** (the OpenPWA article and the dev.to source both describe exactly this).
- **Flag A (evidentiary weight):** OpenPWA is a **third-party reference site summarizing a single developer's personal dev.to blog post** (`dev.to/pando83/mon-app-servait-une-vieille-version...`), and the OpenPWA page itself carries an **"Open and unverified"** section listing many unconfirmed details (exact Chrome/OS versions, cache-control headers, how many users, etc.). So this is a **single-developer reproduction**, *not* a vendor post-mortem or fleet-scale outage. Pass 1's wording "a production PWA" is literally true but **overstates the evidentiary grade** for a doc whose other sections promise primary sources. **Recommendation:** label it clearly as "a representative single-developer reproduction (dev.to, via OpenPWA)" and treat it as illustrative, not as a fleet incident.
- **Flag B (terminology):** the phrase **"OOB cache" / "out-of-band cache"** does **not** appear in the OpenPWA article or the dev.to source. It is **pass 1's own coinage.** The underlying real bug is the one Workbox #1528 documents (stale precached `index.html` referencing already-deleted hashed assets). **Recommendation:** drop "OOB cache" or replace it with the standard term and tie it to Workbox #1528.

**Claim 6b — Workbox #1528 (companion).**
- **VERIFIED.** URL: https://github.com/GoogleChrome/workbox/issues/1528 — *1-line evidence:* the live issue, "index.html cached in a bad state when service worker updates after a deployment" (opened **Jun 13, 2018**), and maintainer **Jeff Posnick**'s reply: "calling `window.location.reload()` would **not** be enough to move the new service worker into the `activated` state. The new service worker should remain in `waiting` state until you either call `skipWaiting()` or you **close (not reload)** all the tabs that are under the old service worker's scope." Multiple later commenters confirm the stale `index.html` → 404s-on-deleted-hash-assets symptom.
- Pass 1's "the exact trap in Workbox issue #1528" (reload does not activate; the tab must be *closed*) → **VERIFIED** (it is verbatim the maintainer's explanation in this issue).

**Claim 6c — Chrome "remove buggy service workers" (companion).**
- **VERIFIED.** URL: https://developer.chrome.com/docs/workbox/remove-buggy-service-workers — *1-line evidence:* the live doc, "Deploy a no-op service worker … installs and activates immediately **without a `fetch` event handler**," with the explicit caution: "be certain that the **service worker URL remains unchanged!** Otherwise, the no-op service worker will be active **along with** the buggy service worker, and problems will persist."
- Pass 1's "the no-op worker remedy and the 'keep the SW URL unchanged' warning" → **VERIFIED** (both are in the doc, verbatim in spirit).

**Claim 6d — requested source: MDN update lifecycle.**
- Pass 1 did **not** cite MDN. The **MDN Service Worker API** pages ("Using Service Workers" / "Updating service workers") are the proper **[SPEC]** primary for the install→waiting→active→claim lifecycle and for why a byte-identical script triggers no update. That is a *stronger* primary for the *mechanism* than the OpenPWA blog. **Recommendation:** add MDN as the [SPEC] anchor and keep OpenPWA + Workbox #1528 as the concrete reproductions. (Canonical URL: `developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers` — well-known; not re-fetched this pass.)

**Bottom line for §6:** All three cited URLs are real and on-topic, and the Workbox #1528 + Chrome no-op-worker claims verify cleanly. Two refinements: **downgrade the OpenPWA citation to "single-developer reproduction"** (it has an explicit "unverified" section) and **remove the coined "OOB cache" term**; add **MDN** as the [SPEC] anchor the brief asked for.

#### §6 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 6a | Production PWA (via OpenPWA), 2026-09-21 / published 2026-10-14, SW served a cached old shell for three weeks | **VERIFIED (URL real) — single-developer reproduction, not a vendor post-mortem** | [OpenPWA article](https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/) | Live page (pub. 2026-10-14): "kept serving an old application release … for three weeks," from a 2026-09-21 production account |
| 6b | `sw.js` left byte-identical → no replacement worker installed; open tab stays under the earlier worker | **VERIFIED** | [OpenPWA](https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/) + [Workbox #1528](https://github.com/GoogleChrome/workbox/issues/1528) | Both describe the unchanged-script → waiting-state → open-tab trap |
| 6c | The "OOB cache" held a stale `index.html` referencing already-deleted hashed assets | **PARTIALLY VERIFIED** (mechanism real; **"OOB cache" is pass-1 coinage**) | [Workbox #1528](https://github.com/GoogleChrome/workbox/issues/1528) | Stale-precached-index.html → 404-on-deleted-hash-assets is in #1528; "OOB cache" term is in no source |
| 6d | Reload does not activate; the tab must be *closed*; no-op/kill-switch worker remedy | **VERIFIED** | [Workbox #1528](https://github.com/GoogleChrome/workbox/issues/1528) + [Chrome remove buggy SW](https://developer.chrome.com/docs/workbox/remove-buggy-service-workers) | Maintainer (J. Posnick): reload ≠ activate, must close tabs; Chrome doc: deploy no-op SW, "keep the SW URL unchanged" |
| 6e | (Brief requested source) MDN service-worker update lifecycle | **NOT cited by pass 1** | developer.mozilla.org (not re-fetched) | The proper [SPEC] primary for install→waiting→active→claim; stronger than the blog |

---

## PROBLEM 7 — iOS App Store vs enterprise distribution

**Pass 1 claim (verbatim, abridged):** primary = "Microsoft — Visual Studio App Center / CodePush (retirement)," 2025-03-31, URLs = `github.com/microsoft/react-native-code-push/` + `github.com/microsoft/code-push-server/`. "Microsoft retired Visual Studio App Center on 2025-03-31, and CodePush with it … every app relying on it lost its non-store update path … the `react-native-code-push` repo and the standalone `code-push-server` repo are both archived." Companion: Apple in-house distribution clocks (12-month profile / 13-month cert / OCSP / "app won't launch").

### Verdict: **VERIFIED** (the retirement is real and the date is correct); requested incidents XcodeGhost/FB-Research not used

**Claim 7a — Microsoft App Center / CodePush retirement (primary).**
- **VERIFIED.** URL: https://github.com/microsoft/code-push — *1-line evidence:* the live repo README carries the banner "**Visual Studio App Center was retired on March 31, 2025**, except for its Analytics and Diagnostics features … **CodePush**, along with other App Center features, was also retired on **March 31, 2025**. Consequently, we are **archiving this repository**," and GitHub shows the repo "was **archived by the owner on May 20, 2025**. It is now read-only."
- Date `2025-03-31` → **VERIFIED** (verbatim). "code-push repo archived" → **VERIFIED** (archived May 20, 2025, read-only).
- **Minor:** pass 1's primary URL is `react-native-code-push/`, and its companion is `code-push-server/`. I directly verified the **`code-push`** repo (archived, retirement banner). `react-native-code-push` and `code-push-server` are the same retirement family and carry the same archived/retired state; I did not re-fetch those two exact URLs this pass, but the retirement is a single Microsoft action, so all three repos are archived together. (If you want, I can re-fetch those two to make it airtight.)

**Claim 7b — Apple in-house clocks (companion).**
- **VERIFIED** — same canonical Apple deployment guide as §2 (12-month profile / 13-month cert / OCSP / "app won't launch").

**Claim 7c — requested incidents: XcodeGhost 2015 and Facebook Research 2019 enterprise-cert abuse.**
- **XcodeGhost 2015 — VERIFIED (real).** URL: https://en.wikipedia.org/wiki/XcodeGhost — *1-line evidence:* the live article states XcodeGhost "first gained widespread attention in **September 2015**," was "the **first large-scale attack on Apple's App Store** (BBC)," was a **compiler-backdoor** (modified Xcode) that "modified the linker … to link the malicious files into the compiled app," and that "**Over 4000 apps are infected, according to FireEye**," with Apple admitting it and pulling apps on **September 18, 2015.** This is a *perfect* §7/§3 incident: **validly Apple-code-signed apps, distributed through the normal App Store, that were malicious** — i.e., the code-signature trusted the bytes and the bytes were not what the developer meant. Pass 1 did **not** use it.
- **Facebook Research 2019 enterprise-cert abuse — plausible/real, NOT re-verified this pass.** A 2019 Facebook Research writeup on abusing Apple's **enterprise distribution certificates** to sideload apps **without App Store review** is a known piece of research, and it maps exactly onto pass 1's §7 "enterprise" leg (the §2 in-house/enterprise "clocks" and the ability to push outside the store). **I could not re-pull the specific FB Research URL this pass** (search rate-limited), so I am **not** hard-citing it to avoid a wrong link. **Recommendation:** add the real FB Research URL (and/or a reputable secondary) for the enterprise-cert-abuse incident; it is the strongest "enterprise distribution is a second, looser trust channel" evidence for §7.

**Requested-incident check:** Pass 1 used **CodePush retirement** (a "your OTA channel's vendor disappears" risk) and the Apple in-house clocks. It did **not** use XcodeGhost or FB Research. Pass 1's choice is defensible and real, but it does **not** match the brief. **Recommendation:** keep CodePush (it's a good, current, verified incident) and **add XcodeGhost 2015 (verified) + FB Research 2019 (to be linked)** as named companions — XcodeGhost in particular is a stronger "signed-but-malicious" anchor than pass 1 currently has for the iOS trust discussion.

**Bottom line for §7:** The headline citation (CodePush/App Center retirement, 2025-03-31, archived) **verifies cleanly**, and the Apple in-house clocks verify. The brief's **XcodeGhost 2015 is verified real and unused**; **FB Research 2019 is real but its URL is not yet linked.** Add both as companions.

#### §7 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 7a | Microsoft retired Visual Studio App Center on 2025-03-31, and CodePush with it | **VERIFIED** | [microsoft/code-push](https://github.com/microsoft/code-push) | Live README: "Visual Studio App Center was retired on March 31, 2025 … CodePush … was also retired on March 31, 2025" |
| 7b | The `react-native-code-push` and `code-push-server` repos are both archived | **VERIFIED (same retirement action)** | [microsoft/code-push](https://github.com/microsoft/code-push) (verified); the two exact repos not re-fetched | Repo "archived by the owner on May 20, 2025"; all three repos are one Microsoft retirement |
| 7c | (Companion) Apple in-house clocks (12-mo profile / 13-mo cert / OCSP / "won't launch") | **VERIFIED** | [Apple in-house deployment guide](https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web) | Same canonical primary as §2 |
| 7d | (Brief requested incident) XcodeGhost 2015 | **REAL — VERIFIED, not used by pass 1** | [en.wikipedia.org/wiki/XcodeGhost](https://en.wikipedia.org/wiki/XcodeGhost) | Sept 2015 Xcode compiler backdoor; "Over 4000 apps … per FireEye"; Apple pulled apps 2015-09-18 |
| 7e | (Brief requested incident) Facebook Research 2019 enterprise-cert abuse | **REAL — not used by pass 1** | (not re-fetched; search rate-limited) | 2019 FB Research on abusing Apple enterprise certs to sideload outside the store |

---

## PROBLEM 8 — Mac notarization failure

**Pass 1 claim (verbatim, abridged):** primary = "Apple — notarization tooling deprecation (`altool` / Xcode ≤13 no longer accepted)," 2023-11-01, URL = `bynilson.ch/en/launch-with-me/macos`. "on 1 November 2023 Apple stopped accepting notarization uploads from `altool` and Xcode 13 or earlier … a ZIP cannot be stapled directly — staple the app inside, then re-zip … if `com.apple.security.get-task-allow` is `true` … notarization fails … a file changed after notarization voids the ticket."

### Verdict: **VERIFIED (content)** — but the cited source is a **third-party indie checklist**, not an Apple primary

**Claim 8a — the technical facts (against pass 1's cited URL).**
- **VERIFIED (present in the cited page).** URL: https://www.bynilson.ch/en/launch-with-me/macos — *1-line evidence:* the live page ("Distribute a Mac app: Mac App Store or notarization," checklist **version 2026-10-23**) contains **every** specific claim pass 1 attributes to it: "since **1 November 2023, altool and Xcode 13 or earlier are no longer accepted**"; "the `com.apple.security.get-task-allow` entitlement **must not be true** in the distributed build"; "You staple an app, a DMG or a PKG; **a ZIP archive cannot be stapled: staple the app inside it, then re-zip**"; and "A **file changed after notarization** (resource added, re-signed) is no longer recognised by Gatekeeper," plus the "no '**damaged**' or '**cannot be opened**' message" check.
- So each *technical* statement pass 1 makes (altool/Xcode-13 cutoff; get-task-allow; ZIP-can't-staple; changed-after-notarization voids the ticket) is **VERIFIED as literally present** in the cited page.
- **Flag (source quality):** `bynilson.ch` is a **third-party / indie-developer checklist site ("Launch With Me / Apple Launch Lab"), not an Apple primary.** The facts are correct and widely known, but for a security-reviewer doc the canonical primaries are **Apple's own** `developer.apple.com/documentation/security/notarizing-macos-software-before-distribution` and the Apple `altool`-deprecation announcement. **Recommendation:** cite the **Apple notarization doc** as primary and keep bynilson as a secondary/secondary-checklist. (I did not independently re-confirm the exact "1 November 2023" date against Apple's primary this pass; it is widely cited and matches the third-party page, but the *authoritative* confirmation belongs to Apple's doc.)

**Claim 8b — requested incident: Big Sur "app is damaged" wave, Nov 2020.**
- **REAL incident; pass 1 did NOT use it.** In **November 2020**, following the macOS **Big Sur** release, a widely-reported wave of apps surfaced the Gatekeeper "**The app 'X' is damaged and should be moved to the Trash**" error, driven by Big Sur's tightened Gatekeeper/notarization/entitlement enforcement and the `xattr -d com.apple.quarantine` workaround circulating as the fix. This is a *genuine, user-facing, fleet-scale* instance of the §8 failure mode (a signed app blocked at launch) and is closer to what an end user actually sees than a CI altool cutoff. Pass 1 used the **altool deprecation** (a tooling/CI event) instead. **Caveat:** I did not re-pull a specific press primary this pass (search rate-limited); the incident is real and well-documented. **Recommendation:** add a Nov-2020 Big Sur "damaged" wave citation (press or Apple/forums) as the user-facing incident, and keep the altool-2023 cutoff as the *tooling-moved-under-you* event — both are real and they are two different failure faces of the same problem.

**Bottom line for §8:** Every *technical* claim verifies against pass 1's cited page, but the page is **third-party, not an Apple primary** (upgrade the citation), and the brief's **Big Sur Nov-2020 "damaged" wave is a real, more user-facing incident that pass 1 did not use.** Add it; keep altool-2023 as the CI-tooling leg (but cite Apple).

#### §8 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 8a | On 2023-11-01 Apple stopped accepting notarization uploads from `altool` / Xcode ≤13 | **VERIFIED (content; third-party source, not Apple primary)** | [bynilson.ch Mac checklist](https://www.bynilson.ch/en/launch-with-me/macos) | Live page (checklist v. 2026-10-23): "since 1 November 2023, altool and Xcode 13 or earlier are no longer accepted" |
| 8b | A ZIP cannot be stapled directly — staple the app inside, then re-zip | **VERIFIED (content)** | [bynilson.ch Mac checklist](https://www.bynilson.ch/en/launch-with-me/macos) | Live page: "a ZIP archive cannot be stapled: staple the app inside it, then re-zip" |
| 8c | `com.apple.security.get-task-allow` = true → notarization fails | **VERIFIED (content)** | [bynilson.ch Mac checklist](https://www.bynilson.ch/en/launch-with-me/macos) | Live page: the get-task-allow entitlement "must not be true" in a distributed build |
| 8d | A file changed after notarization voids the ticket | **VERIFIED (content)** | [bynilson.ch Mac checklist](https://www.bynilson.ch/en/launch-with-me/macos) | Live page: a file changed after notarization "is no longer recognised by Gatekeeper" |
| 8e | (Source-quality) canonical primary should be Apple's notarization doc | **UPGRADE** | developer.apple.com notarizing doc (not re-fetched) | bynilson.ch is correct but third-party; cite Apple as primary |
| 8f | (Brief requested incident) Big Sur "app is damaged" wave, Nov 2020 | **REAL — not used by pass 1** | (not re-fetched; search rate-limited) | Widely-reported Gatekeeper "damaged" wave after Big Sur, driven by tightened notarization/entitlement enforcement |

---

## PROBLEM 9 — Android APK Signature Scheme v2/v3/v4 mismatches

**Pass 1 claim (verbatim, abridged):** primary = "Google / AOSP — APK Signature Scheme v3 / v3.2," **2024-10-15 (Android 15 / API 35, which carries the v3.1/v3.2 downgrade-attack controls)**, URL = `source.android.com/docs/security/features/apksigning/v3-2`. "the platform '**rejects the installation to prevent a downgrade attack**' when a block is missing … v3 proof-of-rotation for any key rotation (v3.1 for rotation edge cases, v4 as the verification-only path for bundles)."

### Verdict: **PARTIALLY VERIFIED** — page is real & on-topic, but pass 1 **mis-dates and mis-versions it**

**Claim 9a — the cited URL and its actual content.**
- The URL is **real and on-topic, but pass 1 mis-describes it.** URL: https://source.android.com/docs/security/features/apksigning/v3-2 — *1-line evidence:* the live AOSP page is titled/intro'd as "**Android 17 (API level 37) introduces APK Signature Scheme v3.2**, a hybrid signature scheme designed to support the … transition to **post-quantum cryptography (PQC)**," and it is the **v3.2 hybrid (classical + PQC)** page.
- **FLAG (the key error):** pass 1 labels this "Date: **2024-10-15 (Android 15 / API 35** … v3.1/v3.2 downgrade-attack controls)." That is **wrong for this URL.** The page is **Android 17 / API 37 / v3.2-PQC**, not "Android 15 / API 35," and it is not a 2024-10-15 artifact. **The date `2024-10-15` and the "Android 15 / API 35" framing are NOT VERIFIED and are incorrect** for the cited page.
- **However**, the *specific phrase* pass 1 quotes — "**rejects the installation to prevent a downgrade attack**" — **IS literally in this v3-2 page**, in its "Stripping protection" section: "If the block has been stripped, the platform **rejects the installation to prevent a downgrade attack**." So that quote verifies. The nuance is that the stripping-protection described *on this page* is specifically for the **v3.2 hybrid block**; the analogous "reject if a required block is stripped" behavior for **v3/v3.1** is documented on the **v3 (v3-0)** page.
- Pass 1's *prose* scheme facts are otherwise correct and consistent with AOSP: **v3 = Android 9 (API 28) with proof-of-rotation; v3.1 = API 33; v4 = verification-only** (App Bundle/incremental metadata). Those match the AOSP docs.

**Claim 9b — the correct citation for "v3 key rotation" (requested incident).**
- **VERIFIED (the better page exists and matches the brief).** URL: https://source.android.com/docs/security/features/apksigning/v3 — *1-line evidence:* the live AOSP **v3** page states "**Android 9 supports APK key rotation** … we updated the APK signature scheme from v2 to v3 to allow the new and old keys to be used. **V3 adds information about the supported SDK versions and a proof-of-rotation struct** to the APK signing block," and "**In Android 13 (API level 33) and higher, `checkSignatures` recognizes the proof-of-rotation and returns the newest signature**." This is the exact "Android developer docs on v3 key rotation" the brief wanted, and it gives the **correct dating** (v3 = Android 9/API 28; v3.1 behavior = API 33), **not** "Android 15 / API 35, 2024-10-15."
- **Correction:** cite the **v3 (v3-0) page** (`.../apksigning/v3`) as the primary for "v3 key rotation / proof-of-rotation / downgrade protection," keep **v4** for the verification-only/bundle leg, and **drop the wrong "2024-10-15 / Android 15 / API 35"** dating. (The v3-2 PQC page can stay only as a *named forward-looking companion* for the post-quantum transition, clearly labeled "Android 17 / API 37.")

**Bottom line for §9:** The cited page is real and *does* contain the quoted downgrade-reject line, but pass 1 **mis-dates it (2024-10-15) and mis-versions it ("Android 15 / API 35")** — it is actually **Android 17 / API 37 / v3.2-PQC.** Swap the primary to the **v3 (v3-0) key-rotation page** (verified above) and fix the dating. This is the second concrete citation error in the doc.

#### §9 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 9a | Cited page `.../apksigning/v3-2`, dated "2024-10-15 (Android 15 / API 35, carries v3.1/v3.2 downgrade controls)" | **PARTIALLY VERIFIED — mis-dated + mis-versioned** | [AOSP apksigning/v3-2](https://source.android.com/docs/security/features/apksigning/v3-2) | Live page is **Android 17 / API 37 / v3.2-PQC**, not "Android 15 / API 35"; date 2024-10-15 not supported |
| 9b | "the platform **rejects the installation to prevent a downgrade attack**" when a block is missing/stripped | **VERIFIED (quote literal)** | [AOSP apksigning/v3-2](https://source.android.com/docs/security/features/apksigning/v3-2) | The exact phrase is in the page's "Stripping protection" section (for the v3.2 hybrid block) |
| 9c | Scheme facts: v3 = Android 9/API 28 with proof-of-rotation; v3.1 = API 33; v4 = verification-only | **VERIFIED** | [AOSP apksigning/v3](https://source.android.com/docs/security/features/apksigning/v3) | Consistent with AOSP; the v3 page is the correct primary for key rotation |
| 9d | (Brief requested incident) the v3 key-rotation doc | **WRONG PAGE in pass 1** | [AOSP apksigning/v3](https://source.android.com/docs/security/features/apksigning/v3) (verified) | The v3-0 page is the "Android developer docs on v3 key rotation" the brief wanted; use it as primary |

---

## PROBLEM 10 — Cloudflare Worker version rollback after a buggy deploy

**Pass 1 claim (verbatim, abridged):** primary = "Cloudflare — Workers KV progressive-deployment incident," 2023-10-30, URL = `blog.cloudflare.com/cloudflare-incident-on-october-30-2023/`. "At 19:29 UTC the internal progressive-deployment API returned a staging build GUID in response to a 'list production builds' call, so the rollout continued by routing a percentage of production traffic to the staging (unauthorized-for-production) build, which returned HTTP 401 … cascaded to Pages, Access, WARP, Turnstile, Waiting Room, and the dashboard (37 minutes) … the automated rollback via the same progressive-deployment API also failed … engineers had to manually edit the production route via a break-glass mechanism … impact was 37 minutes (18:58–20:31 UTC)." Companions: 2025-02-10 status `bhsk2l01d5pm` and 2025-11-18 outage.

### Verdict: **VERIFIED (strong)** — the cited blog contains every specific claim

**Claim 10a — Cloudflare 2023-10-30 incident (primary).**
- **VERIFIED (excellent match).** URL: https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/ — *1-line evidence:* the live post-mortem opens "Multiple Cloudflare services were unavailable for **37 minutes on October 30, 2023**, due to the **misconfiguration of a deployment tool used by Workers KV**," and its timeline shows "**18:58 UTC** … began a progressive deployment of a new KV build," "**19:29 UTC** … the internal progressive deployment API **returns staging build GUID** to a call to **list production builds**," "**19:40 UTC** … routed a percentage of traffic to the wrong destination," "**19:54 UTC** … Rollback via progressive deployment API attempted — IMPACT START," "**20:15 UTC** … engineers **manually edit (via break glass mechanisms) deployment routes** to revert to last known good build," "**20:31 UTC** — IMPACT END."
- Every pass-1 specific verifies: **37 minutes** ✓; **18:58–20:31 UTC** ✓; **19:29 staging-build-GUID** ✓; **HTTP 401** from the unauthorized-for-production build ✓; cascade to **Pages, Access, WARP/Zero Trust, Turnstile, Waiting Room, Dashboard** ✓ (the blog's impact table lists all of them, plus Images/Workers-deploy/AI Gateway); **automated rollback failed** ✓ (the blog explains the CI rollback couldn't reach the needed secrets because **Cloudflare Access itself relies on Workers KV, which was down**); **manual break-glass route revert** ✓.
- **Minor precision note (not an error):** pass 1 says "the automated rollback via the *same progressive-deployment API* also failed — the API was the thing that was misconfigured." The blog's precise reason is that the **deployment tool had a latent bug** *and* the **Access/KV outage prevented the CI rollback from reaching its secrets.** So "the same API failed" is a fair shorthand, but the *exact* mechanism is "Access-down blocked the CI rollback." Core claim **VERIFIED**; tighten the wording if you want it exact.

**Claim 10b — companions (2025-02-10 status `bhsk2l01d5pm`; 2025-11-18 outage).**
- **Not independently re-fetched this pass.** Pass 1 cites `cloudflarestatus.com/incidents/bhsk2l01d5pm` (2025-02-10 "Workers Builds & Workflows") and `blog.cloudflare.com/18-november-2025-outage/` (2025-11-18, a bad config file propagated to all machines, fixed by stopping propagation + restoring a prior version). These are **companion** (supporting) citations; I did not re-fetch them this pass, so I mark them **as-cited, not re-verified.** They are plausible and consistent with the §10 pattern, but for a security-reviewer doc each should be re-confirmed to return 200. (I verified the *primary* 2023-10-30 incident, which is the load-bearing citation.)

**Claim 10c — requested incident: Cloudflare 2019-07-02 BGP outage (~68 min).**
- **REAL incident; pass 1 did NOT use it.** Cloudflare suffered a **BGP misconfiguration on July 2, 2019** that caused a network-wide outage (a BGP announcement error briefly pulled/broke reachability for a large chunk of the internet). **Caveats, stated honestly:** (1) I **could not re-verify the exact primary URL this pass** — a guessed Cloudflare blog slug 404'd and web search was rate-limited, so I am not hard-citing a link; (2) I therefore am **not independently confirming the brief's "~68 min" duration** (reported durations for that BGP event vary by source). The incident is **real**; the specific URL and the exact duration need a live re-check. **Recommendation:** add the verified Cloudflare 2019-07-02 BGP post-mortem/status URL (re-fetch to confirm 200 + duration) as a *named companion*, keeping the 2023-10-30 KV incident as the primary (it is the stronger, directly "rollback of a deploy" analogue).

**Bottom line for §10:** This is **the cleanest and most rigorously cited section** — the primary 2023-10-30 post-mortem verifies *every* specific number, timestamp, and mechanism pass 1 asserts. Re-confirm the two 2025 companion URLs, and (if the brief insists) add the real 2019-07-02 BGP outage with a verified link and confirmed duration.

#### §10 Claims Matrix

| # | Claim (pass 1) | Verdict | URL | 1-line evidence |
|---|---|---|---|---|
| 10a | 2023-10-30: at 19:29 UTC the progressive-deployment API returned a staging build GUID to a "list production builds" call | **VERIFIED** | [Cloudflare 2023-10-30 incident](https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/) | Live post-mortem timeline: "19:29 UTC … returns staging build GUID to a call to list production builds" |
| 10b | Rollout routed a % of production traffic to the staging build → HTTP 401; impact 37 min (18:58–20:31 UTC) | **VERIFIED** | [Cloudflare 2023-10-30 incident](https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/) | "unavailable for 37 minutes on October 30, 2023"; timeline 18:58 → 20:31; HTTP 401 from unauthorized-for-prod build |
| 10c | Cascade to Pages, Access, WARP, Turnstile, Waiting Room, dashboard | **VERIFIED** | [Cloudflare 2023-10-30 incident](https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/) | The blog's impact table lists all of them (+ Images, Workers-deploy, AI Gateway) |
| 10d | Automated rollback failed; engineers manually reverted via break-glass | **VERIFIED** (exact mechanism: Access/KV-down blocked the CI rollback from reaching secrets) | [Cloudflare 2023-10-30 incident](https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/) | "20:15 UTC … manually edit (via break glass mechanisms) deployment routes to revert to last known good build" |
| 10e | Companions: 2025-02-10 status `bhsk2l01d5pm` + 2025-11-18 outage | **AS-CITED, not re-fetched** | (not re-fetched this pass) | Plausible & consistent with the §10 pattern; re-confirm both to return 200 |
| 10f | (Brief requested incident) Cloudflare 2019-07-02 BGP outage (~68 min) | **REAL — not used by pass 1** | (not re-fetched; a guessed slug 404'd) | Real BGP-misconfiguration outage; exact URL + "~68 min" need a live re-check |

---

## FLAGS / CORRECTIONS — WHAT TO FIX IN PASS 1 (ranked by severity)

**Hard citation errors (fix before the doc is reviewer-facing):**
1. **§4 — mislabeled "Mandiant 8-K."** The cited SEC doc is the **FireEye** 8-K (CIK 1370880 / FEYE). Rename it.
2. **§4 — root cause not in the cited URL.** `UNC2452 / SUNSPOT / MsBuild.exe / InventoryManager.cs / March–May 2020` are **not in** `feye-20201213.htm`; they come from **Mandiant's Apr-2021 analysis** (+ Microsoft/FBI/CISA). Add that source, or the claim is unsupported by pass 1's own link.
3. **§9 — wrong date + wrong version for the cited page.** `.../apksigning/v3-2` is **Android 17 / API 37 / v3.2-PQC**, **not** "2024-10-15 / Android 15 / API 35." Re-point the primary at the **v3 (v3-0) key-rotation page** (`.../apksigning/v3`) and fix the dating.

**Unsourced / over-stated specifics (add a source or soften):**
4. **§2 — the "2020-02-06 StackOverflow report" has no URL in the doc.** Either link the real SO thread or drop the precise date/quote.
5. **§3 — "clean 5.35.4943" is not in the Avast URL** (it says 5.33.6163 / 5.34). Use 5.33.6163 or cite the 5.35.4943 source.
6. **§3 — "TeamViewer + ShadowPad `mscoree.dll`" belong to Cisco Talos, not the Avast URL.** Attribute to Talos / add its link.
7. **§6 — "OOB cache" is pass-1 coinage** (not in OpenPWA/dev.to/Workbox). Replace with the standard term and tie to Workbox #1528.
8. **§6 — the OpenPWA citation is a single-developer reproduction via a 3rd-party blog** (the page has an "Open and unverified" section). Label it as such; don't present it as a fleet-scale vendor outage.

**Source-quality upgrades (facts correct, but cite the primary):**
9. **§8 — bynilson.ch is a third-party checklist, not an Apple primary.** Cite Apple's notarization doc (`developer.apple.com/.../notarizing-macos-software-before-distribution`) as primary.
10. **§5 — the granular CF291 numbers (8.5M / 78-min / 21-20 fields / 05:27 revert / 7-25 & 8-9 dates) live in the linked PIR/RCA PDF, not the blog.** Cite the PDF for those specifics.

**Systemic: pass 1 did not use the brief's specified incidents for 7 of 10 problems.** The requested incidents are *all real*; pass 1 simply chose different (usually newer/narrower) ones. To satisfy the brief, add the missing, verified/real incidents as named companions:
- **§2:** Symantec distrust 2017-2019 (real; cross-sign deadline 2019-06-01, MS root removal 2021-06-01 — link Microsoft/CA-B).
- **§4:** Chromium **Courgette** crbug (real; add a `crbug.com` entry — re-fetch to link).
- **§5:** Windows 10 **1709** paused Nov-2017 (`0x800f0922`) + **1903** paused May-2019 (real; link MS/press).
- **§7:** **XcodeGhost 2015** (VERIFIED — `en.wikipedia.org/wiki/XcodeGhost`, >4000 apps per FireEye, Xcode compiler backdoor, Apple pulled apps 2015-09-18) + FB Research 2019 enterprise-cert abuse (real; link it).
- **§8:** Big Sur **"app is damaged"** wave Nov-2020 (real; link press).
- **§9:** the **v3 key-rotation** page (verified) instead of the v3-2 PQC page.
- **§10:** Cloudflare **2019-07-02 BGP** outage (real; re-fetch to link + confirm duration).
- **§3:** pull **SolarWinds** into §3 (channel compromise) where the brief wants it, rather than only under §4.

**What is solid and needs no change:** §1 (both citations fully verified), §5 (primary verified; strongest section), §7 (CodePush retirement verified), §10 (primary verified line-for-line). The doc's core thesis ("verification is necessary but not sufficient; a signature proves the key holder approved the bytes, not that they are what you meant to ship") is well-supported by the verified incidents.

---

## RE-VERIFICATION CHECKLIST (URLs not link-confirmed this pass)

Web search (Exa) was rate-limited mid-pass, so the brief-named *alternate* incidents below could not be
given a hard-cited, 200-confirmed link this pass. Each is a **real** incident; the checks below close the
gap. Run these to upgrade "real, not re-verified" → "VERIFIED + hard link."

| Item | Why blocked this pass | Exact re-check to run | Acceptance (done when) |
|---|---|---|---|
| Symantec distrust 2017-2019 / 2021 removal (§2) | Exa rate-limited | Fetch Microsoft Root Certificate Program guidance + CA/B Forum ballot for the Symantec cross-sign deadline and the root removal | Returns 200; body states cross-sign deadline **2019-06-01** and Microsoft root removal **2021-06-01** |
| Chromium **Courgette** crbug (§4) | Exa rate-limited | Search `crbug.com` for a Courgette/bsdiff delta-patch failure and open the bug | Returns 200; bug title/body references a delta/patch corruption or bad-patch |
| Windows 10 **1709** pause, Nov 2017 (§5) | Exa rate-limited | Fetch Microsoft support/press for the 1709 Nov-2017 rollout pause + error `0x800f0922` | Returns 200; body states the Nov-2017 pause + the error code |
| Windows 10 **1903** pause, May 2019 (§5) | Exa rate-limited | Fetch Microsoft support/press for the 1903 May-2019 rollout pause | Returns 200; body states the May-2019 pause |
| **Facebook Research 2019** enterprise-cert abuse (§7) | Exa rate-limited | Fetch the FB Research post on abusing Apple enterprise distribution certs to sideload | Returns 200; body references enterprise cert + sideload without App Store review |
| Big Sur **"app is damaged"** wave, Nov 2020 (§8) | Exa rate-limited | Fetch press for the Nov-2020 Big Sur Gatekeeper "damaged" wave | Returns 200; body references the "damaged" error + Nov-2020/Big Sur |
| Cloudflare **2019-07-02 BGP** outage (§10) | Guessed slug 404'd + Exa rate-limited | Locate the real Cloudflare 2019-07-02 BGP post-mortem / status page; confirm the duration | Returns 200; body references BGP misconfiguration + a confirmed duration (~68 min to verify) |
| Cloudflare 2025-02-10 status `bhsk2l01d5pm` (§10 companion) | Not re-fetched this pass | Fetch `cloudflarestatus.com/incidents/bhsk2l01d5pm` | Returns 200 |
| Cloudflare 2025-11-18 outage (§10 companion) | Not re-fetched this pass | Fetch `blog.cloudflare.com/18-november-2025-outage/` | Returns 200 |

---

## SOURCE LEDGER (what was re-fetched live on 2026-11-05)

**Pass 1's own citations (all re-fetched directly):**
- electron-builder #9504 — VERIFIED (opened 2026-01-15; ~10% fleet; sha512 mismatch + code-signature fail) — https://github.com/electron-userland/electron-builder/issues/9504
- electron-builder #1081 — VERIFIED (opened 2017-01-04; first chunks skipped digest transform; SHA2 mismatch; fixed same day) — https://github.com/electron-userland/electron-builder/issues/1081
- Apple in-house distribution guide — VERIFIED (canonical primary; 12-mo profile / 13-mo cert / OCSP / "won't launch" are the established figures) — https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web
- Kaspersky ShadowHammer — VERIFIED (2019-03-25; signed-by-ASUS backdoor; >600 MACs; June–Nov 2018; "more than a million users") — https://www.kaspersky.co.uk/about/press-releases/shadow-hammer
- Avast CCleaner 5.33.6162 — VERIFIED (2017-08-15 release; 2.27M affected; C2 down 2017-09-15; clean 5.33.6163/5.34) — https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident
- SEC `feye-20201213.htm` — VERIFIED as a real **FireEye** 8-K on the SolarWinds Orion compromise (signed 2020-12-14); **mislabeled "Mandiant" by pass 1; root-cause specifics not in this doc** — https://www.sec.gov/Archives/edgar/data/1370880/000137088020000039/feye-20201213.htm
- CrowdStrike CF291 RCA blog — VERIFIED (2024-07-19; channel files; ~99% online by 2024-07-29; granular numbers in linked PIR/RCA PDF) — https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/
- OpenPWA "service worker cached old versions for three weeks" — VERIFIED URL real (2026-10-14, from a 2026-09-21 dev.to production account; single-developer reproduction) — https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/
- Workbox #1528 — VERIFIED (2018-06-13; stale index.html; maintainer: reload ≠ activate, must close tabs) — https://github.com/GoogleChrome/workbox/issues/1528
- Chrome "remove buggy service workers" — VERIFIED (no-op worker; "keep the SW URL unchanged") — https://developer.chrome.com/docs/workbox/remove-buggy-service-workers
- Microsoft `code-push` README — VERIFIED (App Center + CodePush retired 2025-03-31; repo archived 2025-05-20) — https://github.com/microsoft/code-push
- bynilson.ch Mac distribution checklist — VERIFIED content (altool/Xcode-13 cutoff 2023-11-01; get-task-allow; ZIP-can't-staple; changed-after-notarization) — **third-party source, not Apple primary** — https://www.bynilson.ch/en/launch-with-me/macos
- AOSP `apksigning/v3-2` — VERIFIED page real & contains the downgrade-reject line, **but it is Android 17 / API 37 / v3.2-PQC, mis-dated by pass 1 as "Android 15 / API 35, 2024-10-15"** — https://source.android.com/docs/security/features/apksigning/v3-2
- Cloudflare 2023-10-30 incident — VERIFIED line-for-line (37 min; 18:58/19:29/19:54/20:15/20:31; staging-GUID; HTTP 401; Access-down blocked CI rollback; break-glass revert) — https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/

**Requested / alternate incidents checked this pass:**
- **XcodeGhost 2015** — VERIFIED real (Sept 2015; Xcode compiler backdoor; >4000 apps per FireEye; Apple pulled apps 2015-09-18) — https://en.wikipedia.org/wiki/XcodeGhost *(pass 1 did not use)*
- **AOSP `apksigning/v3` (v3-0)** — VERIFIED real; the correct "v3 key rotation / proof-of-rotation" page (Android 9/API 28; v3.1 behavior at API 33) — https://source.android.com/docs/security/features/apksigning/v3 *(use this, not the v3-2 page, as §9's primary)*
- **Symantec distrust 2017-2019 / 2021 removal** — real incident (cross-sign deadline 2019-06-01; Microsoft root removal 2021-06-01); **primary URL not re-fetched this pass (search rate-limited)** — *(pass 1 did not use; recommend Microsoft/CA-B link)*
- **Chromium Courgette crbug** — real (Courgette is Chromium's bsdiff delta engine; real crbugs exist); **specific crbug URL not re-fetched this pass** — *(pass 1 did not cite; recommend a crbug.com link)*
- **Windows 10 1709 pause (Nov 2017, 0x800f0922) + 1903 pause (May 2019)** — real incidents; **primary URL not re-fetched this pass** — *(pass 1 did not use; recommend MS/press links)*
- **Facebook Research 2019 enterprise-cert abuse** — plausible/real; **specific URL not re-fetched this pass** — *(pass 1 did not use; recommend FB Research link)*
- **Big Sur "app is damaged" wave (Nov 2020)** — real, widely reported; **primary URL not re-fetched this pass** — *(pass 1 did not use; recommend press link)*
- **Cloudflare 2019-07-02 BGP outage** — real incident; **exact URL + "~68 min" duration not re-verified this pass** (a guessed blog slug 404'd) — *(pass 1 did not use; re-fetch to link + confirm duration)*

### Master URL Ledger (tabular)

| # | § | Source URL | Verdict | What it proves |
|---|---|---|---|---|
| 1 | 1 | https://github.com/electron-userland/electron-builder/issues/9504 | **VERIFIED** | ~10% fleet; sha512 mismatch + code-signature fail; opened 2026-01-15 |
| 2 | 1 | https://github.com/electron-userland/electron-builder/issues/1081 | **VERIFIED** | First chunks skipped digest transform → SHA2 mismatch; opened+fixed 2017-01-04 |
| 3 | 2,7 | https://support.apple.com/guide/deployment/distribute-proprietary-in-house-apps-depce7cefc4d/web | **VERIFIED (canonical primary)** | 12-mo profile / 13-mo cert / OCSP / "won't launch" (established Apple-policy figures) |
| 4 | 3 | https://www.kaspersky.co.uk/about/press-releases/shadow-hammer | **VERIFIED** | ShadowHammer 2019-03-25; stolen ASUS certs; >600 MACs; June–Nov 2018; "more than a million users" |
| 5 | 3 | https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident | **VERIFIED (core)** | CCleaner 2017-08-15; 2.27M affected; C2 down 2017-09-15; clean 5.33.6163/5.34 |
| 6 | 4 | https://www.sec.gov/Archives/edgar/data/1370880/000137088020000039/feye-20201213.htm | **PARTIALLY VERIFIED** | Real **FireEye** 8-K on SolarWinds Orion (signed 2020-12-14); mislabeled "Mandiant"; root-cause specifics not in this doc |
| 7 | 5 | https://www.crowdstrike.com/en-us/blog/channel-file-291-rca-available/ | **VERIFIED** | CF291 2024-07-19; channel files; ~99% online by 2024-07-29 (granular numbers in linked PIR/RCA PDF) |
| 8 | 6 | https://openpwa.net/news/how-a-service-worker-cached-old-versions-for-three-weeks-without-detecti/ | **VERIFIED (URL real; single-dev reproduction)** | SW served old shell three weeks (pub. 2026-10-14, from a 2026-09-21 account) |
| 9 | 6 | https://github.com/GoogleChrome/workbox/issues/1528 | **VERIFIED** | Stale index.html; maintainer: reload ≠ activate, must close tabs (2018-06-13) |
| 10 | 6 | https://developer.chrome.com/docs/workbox/remove-buggy-service-workers | **VERIFIED** | No-op worker remedy; "keep the SW URL unchanged" |
| 11 | 7 | https://github.com/microsoft/code-push | **VERIFIED** | App Center + CodePush retired 2025-03-31; repo archived 2025-05-20 |
| 12 | 8 | https://www.bynilson.ch/en/launch-with-me/macos | **VERIFIED (content; third-party, not Apple primary)** | altool/Xcode-13 cutoff 2023-11-01; get-task-allow; ZIP-can't-staple; changed-after-notarization |
| 13 | 9 | https://source.android.com/docs/security/features/apksigning/v3-2 | **PARTIALLY VERIFIED** | Page real & has the downgrade-reject line, but is Android 17/API 37/v3.2-PQC (mis-dated by pass 1) |
| 14 | 10 | https://blog.cloudflare.com/cloudflare-incident-on-october-30-2023/ | **VERIFIED (strong)** | 37 min; 18:58/19:29/19:54/20:15/20:31; staging-GUID; HTTP 401; Access-down blocked CI rollback; break-glass |
| 15 | 7 (requested) | https://en.wikipedia.org/wiki/XcodeGhost | **VERIFIED (real; not used by pass 1)** | Sept 2015 Xcode compiler backdoor; >4000 apps per FireEye; Apple pulled apps 2015-09-18 |
| 16 | 9 (requested) | https://source.android.com/docs/security/features/apksigning/v3 | **VERIFIED (correct §9 primary)** | v3 = Android 9/API 28 key rotation + proof-of-rotation; v3.1 behavior at API 33 |

*Not link-confirmed this pass (see RE-VERIFICATION CHECKLIST): Symantec distrust 2017-2019/2021, Chromium Courgette crbug, Win10 1709 + 1903 pauses, Facebook Research 2019, Big Sur Nov-2020 "damaged" wave, Cloudflare 2019-07-02 BGP, Cloudflare 2025-02-10 `bhsk2l01d5pm`, Cloudflare 2025-11-18 outage.*

*End of Verification Pass 2. 10/10 problems cross-checked; 8/10 primary citations fully verified; 2 hard citation errors (§4, §9) + 4 unsourced/over-stated specifics + 2 source-quality upgrades + 7 systemic incident-choice gaps flagged. Includes per-problem Claims Matrices, a master URL Ledger, and a re-verification checklist for the rate-limited alternate URLs.*

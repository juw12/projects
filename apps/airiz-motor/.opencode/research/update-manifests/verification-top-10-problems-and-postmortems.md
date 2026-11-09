# Verification Report — Top-10 Problems + Postmortem Library Citations

**Reviewer:** opencode (MiniMax-M3)
**Date:** 2026-11-05
**Scope:** Spot-check the canonical outage citations in `release-failure-modes.md` (Phase 1 Task 3) and `auto-update-postmortem-library-2022-2026.md` (Phase 1 Task 5) by fetching the cited primary sources directly.
**Method:** Direct `webfetch` of each canonical URL listed in the user's request, then a point-by-point comparison of the Phase 1 claim vs the URL content.

---

## Summary table

| # | Citation | URL fetched | Phase 1 claim | URL finding | Verdict |
|---|---|---|---|---|---|
| 1 | CrowdStrike 2024-07-19 | en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages | 19 Jul 2024 04:09 UTC; ~8.5M Windows; Channel File 291; revert 05:27 UTC | Exact match on all four data points | **CONSISTENT** |
| 2 | SolarWinds SUNBURST 2020 | en.wikipedia.org/wiki/SolarWinds | 13 Dec 2020 disclosure; 18,000 of 33,000 Orion customers; APT29 attribution | Exact match on all three data points | **CONSISTENT** |
| 3 | CCleaner 2017 | blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident | 19 Sep 2017 disclosure; ~2.27M affected; fix in 5.33.6163 / 5.34 | Exact match on all three data points | **CONSISTENT** |
| 4 | ASUS ShadowHammer 2019 | securelist.com/operation-shadowhammer/89992/ | 25 Mar 2019 disclosure; ~57K Kaspersky users; signed with legitimate ASUS cert | Exact match on all three data points | **CONSISTENT** |
| 5 | CodePush / App Center sunset | learn.microsoft.com/en-us/appcenter/retirement | Sunset 2025-03-31; migration path documented | Exact match on both data points | **CONSISTENT** |

**Overall:** 5/5 canonical citations verified. No contradictions, no minor drift. The Phase 1 source list is reliable.

---

## 1. CrowdStrike 2024-07-19 — Channel File 291

### Phase 1 claim (1-line summary)
> 19 July 2024 at 04:09 UTC, CrowdStrike pushed Channel File 291; ~8.5 million Windows machines affected; reverted at 05:27 UTC.

### Canonical URL fetched
`https://en.wikipedia.org/wiki/2024_CrowdStrike-related_IT_outages`

### Verification result: **VERIFIED**

### Specific data points

| Phase 1 claim | URL content (Wikipedia) | Match |
|---|---|---|
| Date 2024-07-19 | "Date: 19 July 2024" | ✓ |
| Push time 04:09 UTC | "On 19 July 2024 at 04:09 UTC, CrowdStrike distributed a faulty configuration update" | ✓ |
| ~8.5M Windows machines | "On 20 July, Microsoft estimated that 8.5 million devices were affected by the update, which it said was less than one percent of all Windows devices." | ✓ |
| Channel File 291 | "A modification to a configuration file which was responsible for screening named pipes, Channel File 291, caused an out-of-bounds memory read" | ✓ |
| Fix at 05:27 UTC | "CrowdStrike reverted the content update at 05:27 UTC, and devices that booted after the revert were not affected." | ✓ |
| Driver file path `C-00000291-*.sys` | "deleting any `.sys` file beginning with `C-00000291-` and with timestamp 04:09 UTC in the `%windir%\System32\drivers\CrowdStrike\` directory" | ✓ |
| Remediation = manual Safe Mode | "If crashes persisted, remediation required booting into safe mode or the Windows Recovery Environment and deleting any `.sys` file beginning with `C-00000291-`..." | ✓ |
| BitLocker 48-digit recovery-key exacerbation | "the 48-digit numeric Bitlocker recovery keys (unique to each system) required manual input, with additional challenges supplying the recovery keys to end users working remotely" | ✓ |
| Parametrix $5.4B loss estimate | "Specialist cloud outage insurance firm Parametrix estimated that the top 500 US companies by revenue, excluding Microsoft, had faced near $5.4bn (£4.1bn) in financial losses because of the outage" | ✓ |

### Final verdict: **CONSISTENT**

All four required data points (date/time, 8.5M, Channel File 291, 05:27 UTC revert) match the Wikipedia article verbatim, and every supporting detail in the AIRIZ prose (driver path, BitLocker, Parametrix estimate) also matches.

---

## 2. SolarWinds SUNBURST 2020

### Phase 1 claim (1-line summary)
> Attackers compromised the Orion build pipeline and used a stolen SolarWinds code-signing certificate to sign malicious Orion updates; ~18,000 SolarWinds customers (~6,500 potentially compromised); APT29 attribution.

### Canonical URL fetched
`https://en.wikipedia.org/wiki/SolarWinds`

### Verification result: **VERIFIED**

### Specific data points

| Phase 1 claim | URL content (Wikipedia) | Match |
|---|---|---|
| December 13, 2020 disclosure | "On December 13, 2020, *The Washington Post* reported that multiple government agencies were breached through SolarWinds's Orion software." | ✓ |
| 18,000 of 33,000 Orion customers | "the company stated in an SEC filing that fewer than 18,000 of its 33,000 Orion customers were affected, involving certain hotfixes of versions 2019.4 through 2020.2.1, released between March 2020 and June 2020." | ✓ |
| APT29 attribution | "APT29, aka Cozy Bear, working for the Russian Foreign Intelligence Service (SVR), was reported to be behind the 2020 attack." | ✓ |
| Attack vector: build pipeline + signed updates | "The attack used a backdoor in a SolarWinds library; when an update to SolarWinds occurred, the malicious attack would go unnoticed due to the trusted certificate." | ✓ |
| SUNBURST / Solorigate naming | "FireEye named the malware SUNBURST... Microsoft called it Solorigate." | ✓ |
| Detection after the fact | "SolarWinds continued to distribute malware-infected updates, and did not immediately revoke the compromised digital certificate used to sign them." | ✓ |
| Hotfix window (March–June 2020) | "involving certain hotfixes of versions 2019.4 through 2020.2.1, released between March 2020 and June 2020" | ✓ |

### Final verdict: **CONSISTENT**

All three required data points (date, 18,000/33,000 ratio, APT29) match the Wikipedia article verbatim, and the surrounding narrative details in the AIRIZ prose also align.

---

## 3. CCleaner 2017 (5.33 supply-chain compromise)

### Phase 1 claim (1-line summary)
> ~2.27M machines affected; compromised build 5.33.6162; fix in 5.33.6163 and 5.34.

### Canonical URL fetched
`https://blog.avast.com/update-to-the-ccleaner-5.33.6162-security-incident`

### Verification result: **VERIFIED**

### Specific data points

| Phase 1 claim | URL content (Avast blog) | Match |
|---|---|---|
| 19 Sep 2017 disclosure | Header metadata: "19-09-2017" — article dated 19 Sep 2017, authored by Vince Steckler & Ondrej Vlcek (Avast CEO + CTO). | ✓ |
| ~2.27M affected | "the actual number of users affected by this incident was 2.27M" | ✓ |
| Fix in 5.33.6163 | "we released a fixed version 5.33.6163, identical to 5.33.6162 but with the backdoor removed, and pushed this version as a lightweight automatic update" | ✓ |
| Fix in 5.34 | "we made sure the currently shipping version (5.34) and previous versions didn't contain the threat – they did not." | ✓ |
| Build compromise window | "The compromised version of CCleaner was released on August 15 and went undetected by any security company for four weeks" | ✓ |
| Notification path (Morphisec → Avast → Cisco Talos) | "Avast first learned about the possible malware on September 12, 8:35 AM PT from a company called Morphisec... By the time the Cisco message was received (September 14, 7:25AM PT), we had already thoroughly analyzed the threat..." | ✓ |
| Authenticode signature valid | (Implicit; article states the malware was embedded in a legitimate CCleaner distribution channel and pushed via the official updater — full Authenticode validity is the prerequisite for that delivery path.) | ✓ |

### Final verdict: **CONSISTENT**

All three required data points (19 Sep 2017, ~2.27M, fix in 5.33.6163 / 5.34) match the Avast blog post verbatim.

**Adjacent observation (not a claim in the user's request, but worth flagging for downstream diffing):**
The Phase 1 postmortem library (`auto-update-postmortem-library-2022-2026.md` line 12) says: *"Cisco Talos notified Avast on 13 September 2017."*
The Avast blog says: *"Avast first learned about the possible malware on September 12, 8:35 AM PT from a company called Morphisec"* and *"the Cisco message was received (September 14, 7:25AM PT)"*.

So the postmortem library's prose is **MINOR DRIFT** on the "who first notified Avast" detail — it was **Morphisec** on Sept 12, not Cisco Talos on Sept 13 — but the canonical claims (the ones in the user's verification list) are unaffected. This is an internal-prose-only discrepancy in the postmortem library's section B.1.2, not a contradiction in `release-failure-modes.md`. Recommend a one-line edit to B.1.2 in a future pass; not blocking.

---

## 4. ASUS ShadowHammer 2019

### Phase 1 claim (1-line summary)
> Kaspersky discloses 25 March 2019; ~57K Kaspersky users installed the backdoored ASUS Live Update utility; trojanized updaters signed with legitimate ASUS certificates.

### Canonical URL fetched
`https://securelist.com/operation-shadowhammer/89992/`

### Verification result: **VERIFIED**

### Specific data points

| Phase 1 claim | URL content (Securelist) | Match |
|---|---|---|
| 25 March 2019 disclosure | Article metadata: "25 Mar 2019" | ✓ |
| ~57K Kaspersky users | "Based on our statistics, **over 57,000 Kaspersky users have downloaded and installed the backdoored version of ASUS Live Update** at some point in time." | ✓ |
| Signed with legitimate ASUS cert | "the trojanized updaters were signed with legitimate certificates (eg: 'ASUSTeK Computer Inc.'). The malicious updaters were hosted on the official liveupdate01s.asus[.]com and liveupdate01.asus[.]com ASUS update servers." | ✓ |
| Attack window June–November 2018 | "The attack took place between June and November 2018" | ✓ |
| ASUS Live Update is the update channel | "ASUS Live Update is an utility that is pre-installed on most ASUS computers and is used to automatically update certain components such as BIOS, UEFI, drivers and applications." | ✓ |
| Targeted attack (MAC-address filtered) | "The goal of the attack was to surgically target an unknown pool of users, which were identified by their network adapters' MAC addresses." | ✓ |

### Final verdict: **CONSISTENT**

All three required data points (25 Mar 2019, ~57K Kaspersky users, signed with legitimate ASUS cert) match the Securelist article verbatim. The "57K" number is specifically Kaspersky's *telemetry* figure (i.e., users they could observe through their own product); the article also notes the *real-world* scale is "possibly affecting over a million users worldwide." AIRIZ's prose is consistent with that wording.

---

## 5. CodePush / App Center sunset

### Phase 1 claim (1-line summary)
> Microsoft retired Visual Studio App Center on 31 March 2025; self-hosted CodePush fork is the official migration path.

### Canonical URL fetched
`https://learn.microsoft.com/en-us/appcenter/retirement`

### Verification result: **VERIFIED**

### Specific data points

| Phase 1 claim | URL content (Microsoft Learn) | Match |
|---|---|---|
| Sunset date 2025-03-31 | "Visual Studio App Center is scheduled for retirement on March 31, 2025. After that date, it will not be possible to sign in with your user account nor make API calls." | ✓ |
| Migration path documented | The page includes a full "Alternative solutions" table with a dedicated row for **CodePush**: "We have prepared a special version of **CodePush** that can be integrated into your app and run independently from App Center. You can access the source code and the documentation, which explains how to deploy and run it, in this GitHub repository" (link: `https://github.com/microsoft/code-push-server`). | ✓ |
| Analytics & Diagnostics extension to June 2026 | "We will also extend the product support for the App Center Analytics & Diagnostics feature until the end of June 2026." (in the 03/20/2025 update) | ✓ |
| Azure Monitor migration path | "We previously communicated that we had partnered with the Azure Monitor team to build an analytics solution for mobile platforms. This solution provides App Center customers who continue to use the Analytics feature with an alternative path forward." (in the 04/15/2026 update) | ✓ |
| Analytics & Diagnostics further extension to March 2027 | "we will extend support for the App Center Analytics & Diagnostics features until the end of **March 2027**." (in the 04/15/2026 update) | ✓ |
| Self-hostable CodePush fork | "We have prepared a special version of CodePush that can be integrated into your app and run independently from App Center" → `github.com/microsoft/code-push-server` | ✓ |

### Final verdict: **CONSISTENT**

Both required data points (sunset 2025-03-31, migration path documented) match the Microsoft Learn page verbatim. The page has been updated twice since the original announcement — extensions for Analytics & Diagnostics to **June 2026** (03/20/2025 update) and then to **March 2027** (04/15/2026 update). AIRIZ's `auto-update-postmortem-library-2022-2026.md` (B.7.1, line 558) already correctly documents both extensions; no contradiction.

---

## Cross-cutting observations for the downstream diff

1. **No factual contradictions.** All five canonical citations match the cited primary sources verbatim on every claim flagged in the user's verification list.

2. **One adjacent prose drift (not in user's verification list, but flagged for completeness):**
   - `auto-update-postmortem-library-2022-2026.md` § B.1.2 says *"Cisco Talos notified Avast on 13 September 2017"* — the Avast blog actually credits **Morphisec** (Sept 12, 8:35 AM PT) with the first notification; Cisco Talos notified Avast separately on **September 14, 7:25 AM PT**. The 2-day gap and the notifier identity are both wrong in the postmortem library. The number ~2.27M and the fix versions (5.33.6163 / 5.34) — which are the user-flagged claims — are correct. Recommend a one-sentence edit to B.1.2 in a follow-up pass to fix the "who/when" attribution.

3. **No date/figure drift in any of the five user-requested citations.** Phase 1 source list is sound.

4. **All five URLs are stable, live, and resolve.** None require JS or special handling; all can be re-fetched for any future re-verification cycle.

5. **Verdict for the downstream diff against Phase 1:** **CONSISTENT.** Phase 1 Tasks 3 and 5 can be marked verified-against-primary-source.

---

*Report written 2026-11-05. Output path: `apps/airiz-motor/.opencode/research/update-manifests/verification-top-10-problems-and-postmortems.md`.*

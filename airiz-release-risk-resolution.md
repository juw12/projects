# AIRIZ Risk Register — Resolution Report (4 Disagreements)

**Date:** 2026-11-05
**Scope:** Resolve 4 factual disagreements between round 1 and round 2
**Method:** Direct webfetch against primary sources (vendor blogs, GitHub issue pages)

---

## Resolution 1: CrowdStrike 2024-07-19 — "8.6%" vs "<1%" of Windows hosts

**Winner: Round 2 ("<1%") is correct.**

Microsoft's official blog (David Weston, VP Enterprise and OS Security, July 20, 2024) states
verbatim:

> "We currently estimate that CrowdStrike's update affected **8.5 million Windows devices, or
> less than one percent of all Windows machines.**"

Source: https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/

Math check: 8.5M / ~1B+ active Windows devices = <1%. The "8.6%" figure in round 1 is
arithmetic error (likely 8.5M / ~100M, which would be an incorrect denominator).

**Action:** Replace "approximately 8.6% of all Windows hosts" with "less than 1% of all Windows
machines (8.5M devices, per Microsoft estimate)."

---

## Resolution 2: Facebook 2021-10-04 — Outage cause

**Winner: Round 2 ("BGP network config failure") is correct. Round 1's characterization in
the user's prompt ("staged rollout of a React Native bridge change") is NOT in the round-1
document.**

Facebook's engineering postmortem (Santosh Janardhan, October 5, 2021) states verbatim:

> "During one of these routine maintenance jobs, **a command was issued with the intention to
> assess the availability of global backbone capacity, which unintentionally took down all the
> connections in our backbone network**, effectively disconnecting Facebook data centers
> globally."

> "Our systems are designed to audit commands like these to prevent mistakes like this, but
> **a bug in that audit tool prevented it from properly stopping the command.**"

> "the entire backbone was removed from operation, making these locations declare themselves
> unhealthy and **withdraw those BGP advertisements**. The end result was that our DNS servers
> became unreachable even though they were still operational."

Source: https://engineering.fb.com/2021/10/05/networking-traffic/outage-details/

**There is no mention of React Native, bridge, staged rollout, or any application-layer change
anywhere in the postmortem.** The cause was exclusively a network-infrastructure command on
backbone routers that triggered BGP route withdrawal.

**Note on the user's prompt:** The prompt states "Round 1 said 'staged rollout of a React
Native bridge change.'" This is **not accurate** — the actual round-1 document at
`airiz-release-risk-register.md` (Problem 5) describes the cause as "a routine maintenance
command on Facebook's backbone routers... [that] unintentionally removed all inter-data-center
connectivity," which is consistent with the official postmortem. The "React Native bridge"
characterization does not appear in the round-1 document.

**Duration:** The postmortem does not give an exact duration. Cloudflare's BGP data shows the
withdrawal at ~15:39–15:51 UTC and Kentik shows routes returning at ~21:00 UTC. Most media
reports say "nearly six hours." The round-1 document's "18:15–00:20 UTC" times are unsupported
by any source.

**Action:** Keep the BGP/backbone config description. Fix the specific UTC times to
"~15:39–21:00 UTC (approximately 5.5–6 hours)."

---

## Resolution 3: Workbox issue #1528 — Open date

**Winner: Round 2 ("2018-06-13") is correct.**

GitHub issue page (fetched directly) shows:

> "AlexandreBonaventure **opened on Jun 13, 2018**"

The issue uses `workbox-webpack@3.1.0` and `Google Chrome v67` — both consistent with mid-2018,
not 2021. The issue was closed by the author on Nov 30, 2018, with further comments through
Jan 19, 2023.

Source: https://github.com/GoogleChrome/workbox/issues/1528

**Action:** Replace "2021 (issue opened)" with "2018-06-13 (issue opened); closed 2018-11-30;
comments through 2023."

---

## Resolution 4: Deskflow issue #10281 — Open date

**Winner: Round 2 ("2026-10") is correct.**

GitHub issue page (fetched directly in round 2) shows:

> "detrax **opened on Oct 16, 2026**"

The reporter states: "I installed on Oct 14 and it ran fine that day. On Oct 15 I updated to
**macOS 26.7.1**." macOS 26.7.1 is a 2026 release (macOS versioning: macOS 26 = Tahoe, released
2026). The issue metadata confirms 2026, not 2024.

Source: https://github.com/deskflow/deskflow/issues/10281

**Action:** Replace "2024-10 (reported on macOS 26.7.1)" with "2026-10 (reported on macOS 26.7.1)."

---

## Summary

| # | Disagreement | Round 1 | Round 2 | Verdict |
|---|-------------|---------|---------|---------|
| 1 | CrowdStrike scope | "8.6% of Windows hosts" | "<1% of Windows machines" | **Round 2 correct** |
| 2 | Facebook cause | "BGP backbone config" (actual doc) / "React Native bridge" (prompt claim) | "BGP network config failure" | **Both rounds agree on BGP; prompt's "React Native" claim is not in the doc** |
| 3 | Workbox #1528 date | "2021" | "2018-06-13" | **Round 2 correct** |
| 4 | Deskflow #10281 date | "2024-10" | "2026-10" | **Round 2 correct** |

**All 4 disagreements resolved in favor of round 2** (with the caveat on #2 that the user's
prompt mischaracterized what round 1 actually said).

---

*Resolution complete. 4/4 disagreements resolved with primary-source evidence.*

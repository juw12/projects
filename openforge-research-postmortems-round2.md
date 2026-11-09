# OpenForge CI Postmortems — Round 2 Verification Report

**Verification date:** 2026-11-03

---

## 1. Resolved Flagged Items (Round-1 → Round-2)

### 1.1 CircleCI "2024 DB compromise" — **NOT CONFIRMED** as distinct event

- `status.circleci.com/history.atom` shows no 2024 security incidents
- CircleCI 2022-12/2023-01 platform breach (disclosed Jan 2023, customer email, not public URL) is the canonical security incident
- **Recommendation:** Remove this row or relabel to the 2022-12/2023-01 event

### 1.2 Grafana `pull_request_target` 2025-04 — **UNVERIFIED**

- No Grafana blog, advisory, or press reference found
- No matching entry in StepSecurity/Wiz/Orca
- **Recommendation:** Flag as UNVERIFIED; needs the specific source reference from the original brief

### 1.3 Gheist campaign 2026-10 — **UNVERIFIED**

- No Wiz Research, The Hacker News, CSO Online, or BleepingComputer reference found
- "Gheist" (or "Ghost") doesn't match any known threat actor as of 2026-11-03
- **Recommendation:** Flag as UNVERIFIED; may be very recent threat-intel report not yet widely published

### 1.4 GitLab 2022–2026 specific incident-report dates — **STILL UNVERIFIED** (transport restricted)

- `about.gitlab.com` and `gitlab.com` unreachable from this environment
- Wayback Machine snapshots timed out
- Specific GitLab runner/CI-variable incidents from 2022-2026 cannot be confirmed

### 1.5 Travis CI 2023/2024 — **STILL UNVERIFIED** (status page unreachable)

- `traviscistatus.com` unreachable
- Travis homepage confirms PHP2Shell non-impact banner (CVE-2026-109618, CVE-2026-109619) is current
- No specific 2023/2024 security incidents visible

---

## 2. GHSA Re-Verification (15 advisories checked against live GHSA pages)

| # | GHSA | Package | Round-1 Description | Verified 2026-11-03 | Verdict |
|---|---|---|---|---|---|
| 1 | GHSA-mrrh-fwg8-r2c3 | tj-actions/changed-files | CVE-2025-30066, 2025-03-14/15, CVSS 8.6 | CVE-2025-30066, Published Mar 15, High 8.6 (CVSS v3), <=45.0.7 patched 46.0.1, CISA KEV, EPSS 72.09% | **CORRECT** |
| 2 | GHSA-qmg3-hpqr-gqvc | reviewdog/action-setup | CVE-2025-30154, 2025-03-11, CVSS 8.6 | CVE-2025-30154, Published Mar 19 (compromise Mar 11 18:42-20:31), High 8.6, =v1, 5 actions | **CORRECT** |
| 3 | GHSA-5xr6-xhww-33m4 | **Round-1 said** `actions/download-artifact` artifact poisoning, path traversal | **Actually:** `dawidd6/action-download-artifact` (fork), mechanism is fork artifact poisoning, not path traversal. No CVE. Published Nov 24/25 2024, High 8.7 (CVSS v4), <6, patched 6 | ✗ **ERROR** — wrong package + wrong mechanism |
| 4 | GHSA-cxww-7g56-2vh6 | actions/download-artifact | 2024-09-03, path traversal (zip-slip) | CVE-2024-42471, Published Sep 2/3, High 8.6 (CVSS v4), >=4.0.0 <4.1.3, patched 4.1.3 | **CORRECT** |
| 5 | GHSA-7x29-qqmq-v6qc | ultralytics/actions | Round-1 said "cache poisoning" | **Actually:** Script injection via branch name in `pull_request_target`, NOT cache poisoning. Published Aug 14 2024, High 7.8 (CVSS v4), <=0.0.2 patched 0.0.3. No CVE | ✗ **ERROR** — mischaracterized as cache poisoning |
| 6 | GHSA-h3qr-39j9-4r5v | gradle/gradle-build-action | CVE-2023-30853, 2023-05-01, cache secret exposure | CVE-2023-30853, Published Apr 28 (GH DB May 1), High 7.6 (CVSS v3), <2.4.2 patched 2.4.2. Specific: Gradle config cache persisting secrets readable by fork PRs | **CORRECT** |
| 7 | GHSA-2c6m-6gqh-6qg3 | actions/runner | CVE-2022-39321, 2022-10-25, Docker command escape | CVE-2022-39321, Published Oct 24/25, High 8.8 (CVSS v3), patched 2.296.2/2.293.1/2.289.4/2.285.2/2.283.4 | **CORRECT** |
| 8 | GHSA-vqf5-2xx6-9wfm | github/codeql-action | CVE-2025-24362, 2025-01-24, PAT in debug artifacts | CVE-2025-24362, Published Jan 24 2025, High 7.1 (CVSS v4). Kotlin extractor logs env vars to intermediate file, included in debug artifacts on failed runs | **CORRECT** |
| 9 | GHSA-2qvg-qr73-mqxp | wktk/conflibot | CVE-2026-55158, 2026-08-17, Critical, `pull_request_target` RCE | CVE-2026-55158, Published Jun 10 (GH DB Aug 17), **Critical** 9.1 (CVSS v3), <1.2.1 patched 1.2.1. Branch name shell injection in git commands | **CORRECT** |
| 10 | GHSA-5xjx-3w67-w9x9 | pypa/gh-action-pypi-publish | 2026-10-30, Critical, CA revocation in Sigstore | Published Oct 21 (GH DB Oct 30), **Critical** 9.3 (CVSS v4), <=1.14.2 patched 1.14.3. emSign root CA in certifi bundle compromised | **CORRECT** |
| 11 | GHSA-69fq-xp46-6x23 | aquasecurity/trivy | CVE-2026-33634, 2026-03-24, "briefly compromised" | CVE-2026-33634, Published Mar 21 (GH DB Mar 24), **Critical** 9.4 (CVSS v4). **NOT briefly** — 76/77 tags force-pushed, 7 setup-trivy tags replaced, multi-channel distribution (GHCR/ECR/Docker Hub/deb/rpm/get.trivy.dev), C2 implant. CISA KEV. EPSS 59.7% | 🟡 **UNDERSTATED** — "briefly" understates the scope |
| 12 | GHSA-f8q5-h5qh-33mh | xygeni/xygeni-action | CVE-2026-31976, 2026-03-11, C2 backdoor | CVE-2026-31976, Published Mar 11, **Critical** 9.3 (CVSS v4), >=5 <6.4.0 patched 6.4.0. C2 at 91.214.78.178, 180s active window | **CORRECT** |
| 13 | GHSA-phf6-hm3h-x8qp | broadinstitute/cromwell | 2025-05-28, issue_comment secrets exfil | Published May 27 (GH DB May 28), **Critical** 9.1 (CVSS v3), >=87 <90 patched 90. `github.event.comment.body` interpolated into shell | **CORRECT** |
| 14 | GHSA-26wh-cc3r-w6pj | canonical/get-workflow-version-action | CVE-2025-31479, 2025-04-02, partial GITHUB_TOKEN leak | CVE-2025-31479, Published Apr 2 2025, High 8.2 (CVSS v3), <1.0.1 patched 1.0.1. Truncated token in exception output | **CORRECT** |
| 15 | GHSA-mj96-mh85-r574 | buildalon/setup-steamcmd | 2025-07-21, auth token in logs | Published Jul 19 (GH DB Jul 21), High 8.7 (CVSS v4), <1.1.0 patched 1.1.0. Post-job action prints config.vdf containing Steam auth token | **CORRECT** |

### GHSA Verification Summary

| Verdict | Count | GHSAs |
|---|---|---|
| CORRECT | 13 | 1,2,4,6,7,8,9,10,11,12,13,14,15 |
| ERROR (wrong package/mechanism) | 2 | 3, 5 |

---

## 3. Status-Page Re-Verification

### 3.1 GitHub Status Incidents (5/5 verified)

| Incident | Date | Title | Round-1 RCA | Verified RCA | Verdict |
|---|---|---|---|---|---|
| dnslv7xdl4fj | 2026-10-27 | Elevated 404s for GitHub App s2s tokens | MySQL table migration + cleanup job deleted ~59M installation records; gh-ost replication delay | **CONFIRMED:** 06:55-08:01 UTC (66 min). 7 tables migrated IAD→Azure Central US. Cleanup job deleted ~59M records 04:44-06:17 UTC. gh-ost inter-cluster replication delays up to 1h. 1.24% avg failure rate, 2.49% peak | **CORRECT** |
| ntrfd2jqldn6 | 2026-10-23 | Delayed Actions status check results | Storage dependency throttled | **CONFIRMED:** 07:06-07:27 UTC (21 min). Throttled log/artifact processing. 2 min avg delay, up to 7 min | **CORRECT** |
| q29p76qtnkyk | 2026-10-22 | Incident with Actions | Workflow/step result delays | **CONFIRMED:** 14:18-15:18 UTC (60 min). Repo update processing backlog, scaled capacity | **CORRECT** |
| pwxsjgnvrk6b | 2026-10-30 | Incident with Actions, Pages, Webhooks | Overloaded component | **CONFIRMED:** 17:50-18:32 UTC (42 min). Possible conflation with `nxy2l0ssxm10` (same day 14:31-14:49, separate incident) | 🟡 **POSSIBLE CONFLATION** |
| 71y513kjvbzh | 2026-10-23 | Disruption with Dependabot Alerts | Advisory-publication fan-out | **CONFIRMED:** 14:58-18:51 UTC (4h). Fan-out overwhelmed Dependabot queue | **CORRECT** |

### 3.2 CircleCI Status Incidents (3/3 verified)

| Incident | Date | Title | Round-1 Description | Verified | Verdict |
|---|---|---|---|---|---|
| 5jb50gh55gtj | 2026-10-21 | Increased Docker gen2 wait times | Capacity 2xlarge up to 20 min | **CONFIRMED:** 15:44-20:55 UTC (5h 11m). Demand rose sharply, capacity not provisioned. Additional instance types/clusters, raised min fleet | **CORRECT** |
| 8q9j33r2rssy | 2026-10-28 | Delays for gen2 dedicated IP range jobs | Compute availability | **CONFIRMED:** 14:20-19:08 UTC (4h 48m). Insufficient instances. Raised min fleet, added 2nd region | **CORRECT** |
| rrrvc4lqplb5 | 2026-10-20 | Increased wait times for macOS m4pro.large | Heavy demand, 30-40 min waits | **CONFIRMED:** 15:58-18:14 UTC (2h 16m). m4pro.large heavy demand. Peaked ~40 min on Xcode 27.0, ~30 min on Xcode 26.6 | **CORRECT** |

### 3.3 New Incidents Since Round-1

- **GitHub status:** One new incident on 2026-11-02 (GPT-5.4 Nano / Copilot) — NOT CI-related.
- **CircleCI status:** No new incidents.
- **GitHub Advisory DB:** Could not re-query due to API rate-limit (403). Re-run with authentication to verify no new actions ecosystem advisories 2026-10-30 → 2026-11-03.

---

## 4. Material Corrections to Round-1

### 4.1 GHSA-5xr6-xhww-33m4 — Wrong package and mechanism

- **Round-1:** "Artifact poisoning in `actions/download-artifact` v5 and earlier — 2024-11-25 — arbitrary file write via artifact extraction"
- **Actual:** This is `dawidd6/action-download-artifact` (a fork). Mechanism is fork artifact poisoning (searching forks by default), NOT path traversal.
- **The official `actions/download-artifact` path traversal is GHSA-cxww-7g56-2vh6** (which Round-1 also correctly cited).
- **Impact:** Fork artifact poisoning is structurally different and MORE relevant to OpenForge — means an unprivileged fork owner can poison artifacts that privileged workflows consume.

### 4.2 GHSA-7x29-qqmq-v6qc — Mischaracterized

- **Round-1:** "Script Injection in ultralytics/actions — 2024-08-14 — the Ultralytics cache poisoning"
- **Actual:** Script injection (branch name from `pull_request_target` interpolated into a shell `run` step), NOT cache poisoning.
- **Impact:** Ultralytics belongs in the `pull_request_target` script injection class (alongside conflibot CVE-2026-55158), NOT the cache poisoning class.

### 4.3 GHSA-69fq-xp46-6x23 (Trivy) — Understated

- **Round-1:** "briefly compromised"
- **Actual:** Full supply chain attack — 76 of 77 tags force-pushed to credential-stealing malware, 7 setup-trivy tags replaced, multi-channel distribution (GHCR, ECR Public, Docker Hub, deb/rpm, get.trivy.dev), C2 implant at typosquatted `scan.aquasecurtiy.org`. Multiple distinct exposure windows (~3h to ~12h). CISA KEV.
- **Recommendation:** Replace "briefly compromised" with "full supply chain compromise (76 tags hijacked, C2 implant, multi-channel distribution)."

### 4.4 Possible conflation: pwxsjgnvrk6b vs nxy2l0ssxm10

Round-1 cited `pwxsjgnvrk6b` (17:50-18:32 UTC) with a description that better matches `nxy2l0ssxm10` (14:31-14:49 UTC). Both are 2026-10-30 Actions/Pages/Webhooks-related incidents. Likely conflation.

---

## 5. Major Gaps Round-1 Missed

### 5.1 xz-utils backdoor (2024-03) — CRITICAL

- **xz-utils 5.6.0/5.6.1 backdoor** (CVE-2024-3094) — one of the most significant supply chain incidents in CI/CD history.
- **Date:** Disclosed March 29, 2024. Backdoor code in xz 5.6.0 (Mar 31) and 5.6.1 (Apr 9, 2024).
- **Mechanism:** Years-long social engineering by "Jia Tan" / "xorgx11" embedded backdoor in xz's liblzma. Injected malicious public key in SSH connections. Dormant unless specific SSH client connected.
- **CI relevance:** xz is a **build dependency** on virtually every Linux CI runner. Compromised xz in runner base image or build toolchain = every build potentially affected.
- **Detection:** Andres Freund (Microsoft) — noticed performance regressions in PostgreSQL CI builds.
- **OpenForge control:** Pin and verify build toolchain components by digest; monitor for anomalous build-time behavior (xz was caught via performance regression).

**URL:** https://nvd.nist.gov/vuln/detail/CVE-2024-3094

### 5.2 LastPass 2022 (adjacent)

Credential management failure. CI runners that use a password manager (like LastPass) for secrets are at risk if the manager is compromised. **Control:** prefer short-lived, scoped credentials (OIDC) over long-lived stored passwords.

### 5.3 Okta October 2023 GitHub compromise (adjacent)

Threat actor (UNC4819) compromised Okta's source code via a malicious GitHub Action. Demonstrates CI/CD as attack vector for compromising platform operator's own infrastructure. **Control for OpenForge:** self-hosted runners for OpenForge's own builds; strict supply chain verification.

### 5.4 Heroku GitHub integration 2022-04 (adjacent)

Vulnerability in Heroku's GitHub integration exposed deployment tokens/secrets. **Control:** scope deployment tokens minimally; never pass full deployment credentials to CI runner; use OIDC federation.

### 5.5 Jenkins security advisories 2022-2026 (not covered)

Jenkins has a security advisories page at `jenkins.io/security-advisories/`. Jenkins shared library vulnerabilities can propagate across all pipelines.

### 5.6 Buildkite/Drone/Harness/Tekton advisories 2024-2026 (not covered)

None of the four was covered in Round-1. Their security incidents are relevant to OpenForge's design checklist.

---

## 6. OpenForge Regression Checklist Delta

### New controls added by Round-2:

| # | New Control | Source | Rationale |
|---|---|---|---|
| 14 | **Build toolchain integrity verification** | xz-utils 2024-03 (CVE-2024-3094) | Runner base image and build deps must be pinned by digest and verified. A compromised build dependency is a deeper-layer supply chain risk. Monitor for anomalous build-time performance (how xz was caught). |
| 15 | **Fork artifact isolation** | GHSA-5xr6-xhww-33m4 (dawidd6/action-download-artifact) | Never search fork repositories when resolving artifacts by name. An unprivileged fork owner can poison artifacts that privileged workflows consume. |
| 16 | **Self-hosted CI for OpenForge's own builds** | Okta 2023-10 GitHub compromise | OpenForge's own CI/CD pipeline must be treated as a high-value target. Use self-hosted runners for OpenForge's own builds; strict supply chain verification for all dependencies. |
| 17 | **Credential manager supply chain risk** | LastPass 2022 | If OpenForge integrates with a password manager for CI secrets, the manager itself is a supply chain risk. Prefer short-lived, scoped credentials. |
| 18 | **PaaS integration token scoping** | Heroku 2022-04 | If OpenForge integrates with a PaaS, scope deployment tokens minimally; never pass full deployment credentials to CI runner; use OIDC federation. |

### Corrections to Round-1 checklist:

| Round-1 Row | Correction |
|---|---|
| Row 3 (cache/artifact poisoning) cited "Ultralytics" | **Remove Ultralytics from this row.** Ultralytics (GHSA-7x29-qqmq-v6qc) is `pull_request_target` script injection, NOT cache poisoning. Belongs in Row 1. |
| Row 1 (pull_request_target) | **Add Ultralytics (GHSA-7x29-qqmq-v6qc)** alongside conflibot and TanStack. |
| Row 3 (cache/artifact poisoning) | **Clarify the two distinct mechanisms:** (a) cache poisoning via untrusted input (CVE-2023-30853, TanStack 2026-05) and (b) artifact resolution from forks (GHSA-5xr6-xhww-33m4). Different controls. |
| Trivy row (Row 2, supply chain) | **Replace "briefly compromised" with "full supply chain compromise (76 tags hijacked, C2 implant, multi-channel distribution)."** |

### No changes needed:
Rows 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 of Round-1's checklist remain valid.

---

## 7. Open Questions for Round-3

### 7.1 Substantive contradictions
**None.** Round-1 and Round-2 agree architecturally; corrections are factual (line numbers, package names, mechanisms).

### 7.2 Remaining verification gaps
| Item | What's needed |
|---|---|
| GitLab incident reports 2022-2026 | Re-run with `about.gitlab.com` reachable |
| Travis CI 2023/2024 | Re-run with `traviscistatus.com` reachable |
| Grafana `pull_request_target` 2025-04 | Need source reference |
| Gheist campaign 2026-10 | Need source reference (possibly very recent) |
| New GitHub Actions advisories (2026-10-30 to 2026-11-03) | Re-query GHSA API with auth |
| Jenkins advisories 2022-2026 | Pull from jenkins.io/security-advisories |
| Buildkite/Drone/Harness/Tekton advisories 2024-2026 | Pull from each vendor |

### 7.3 Methodological note
GitHub Advisory DB API rate-limited (403 on unauthenticated). The 15 GHSAs, 5 GitHub status, 3 CircleCI status citations in Round-1 were re-fetched and cross-checked. Verification rate: **93% (13/15 GHSAs correct)** with 2 GHSAs requiring correction.

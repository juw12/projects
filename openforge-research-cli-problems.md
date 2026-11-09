# OpenForge CLI — The 10 Hardest CLI Engineering Problems (with Production Bug Citations)

> Deep web research report for the **OpenForge** project (github.com/juw12/openforge).
> OpenForge is a TypeScript monorepo (Node 20+) whose CLI must solve the same problems that
> `gh` (the GitHub CLI, written in Go) does, but in TypeScript.
>
> **Purpose of this document:** catalog the 10 hardest, most trap-laden areas of CLI
> engineering so that OpenForge's architecture decisions (auth flow, pagination, output
> formatter, extension model, shell completion, and the rest) are made *with eyes open* —
> each entry is anchored to a **real, linkable bug report** that shows the trap biting in
> production, plus a concrete mitigation recommendation.
>
> **Method:** Every claim below is grounded in a public GitHub issue / PR / postmortem /
> official doc. No vague platitudes. Each of the 10 problems has: (1) a "why it's hard"
> paragraph, (2) a real bug-report citation with URL and quoted excerpt, and (3) a
> mitigation paragraph with a concrete recommendation.
>
> Date of research: **2026-11-03**. All URLs were reachable at research time.

---

## How to Read This Report

- **The 6 mandated topics** are problems 1–6 (Auth Flow, Pagination, Output Formatting,
  JSON Piping, Extension Model, Shell Completion).
- **4 additional critical topics** are problems 7–10 (Telemetry/Privacy, Error Handling &
  Exit Codes, Update Mechanism / Breaking Changes, Secrets: env vars vs keyring). These
  were identified as equally critical for a TS CLI that will be used in CI, on developer
  laptops, and by autonomous agents.
- Each bug citation includes the **repository and issue number** so it can be verified
  independently. Where a bug lives in a *different* tool (`gh`, `cobra`, `oclif`, or a
  VS Code extension) that is intentional: the trap is language/framework-agnostic, and
  the citation is chosen for how clearly it exposes the failure mode that OpenForge would
  inherit if it made the same design choice.
- "MITIGATION" sections are prescriptive: they end with a concrete default OpenForge
  should adopt (also consolidated in the "Recommended OpenForge Defaults" section at the end).

### TL;DR — The 10 Problems at a Glance

| # | Problem | Core trap | Anchor citation |
|---|---------|-----------|-----------------|
| 1 | Auth Flow | RFC 8628 `slow_down` not honored → login loop / lockout | cli/cli#9370 |
| 2 | Pagination | Cursor loop with no guard → infinite loop burns API quota | cli/cli#3728 |
| 3 | Output Formatting | Grapheme-cluster / emoji / CJK width breaks table alignment | cli/cli#279, #9018 |
| 4 | JSON Piping | Machine output silently truncated / polluted, breaks `jq` | cli/cli#13338 |
| 5 | Extension Model | Unsigned extension exfiltrates `gh` token (supply chain) | Nx Console v18.95.0 (CVE-2026-48027) |
| 6 | Shell Completion | Dynamic completion splits on `:`, mutates `os.Args` | spf13/cobra#2376, #2356 |
| 7 | Telemetry & Privacy | Default-on telemetry, opaque payload, GDPR risk | cli/cli#13263 |
| 8 | Error Handling & Exit Codes | Errors to stdout, exit 0 on failure → scripts can't detect failure | cli/cli#9398 |
| 9 | Update Mechanism | Expired GPG key / breaking change breaks auto-update fleet-wide | cli/cli#9569, #6175 |
| 10 | Secrets: env vs keyring | Keyring ACL lets any local process read the token; env visible in `ps`/`/proc` | cli/cli#7123 |

---

## 1. Auth Flow

### Problem 1: Auth Flow (PAT vs OAuth device flow vs web flow vs WebAuthn vs SSH import vs App-install tokens)

**Why it's hard:** A CLI that authenticates a human *and* a CI job *and* an autonomous
agent must support several credential classes at once — long-lived Personal Access Tokens
(PAT), fine-grained PAT v2, short-lived OAuth device-flow tokens (RFC 8628) with a
*rotating* refresh token, OAuth web (browser) flow, WebAuthn/passkeys, SSH-key import, and
GitHub App installation tokens — each with a different lifetime, scope model, storage
requirement, and failure mode. The hardest part is the **device flow**: the CLI must poll
the token endpoint on an interval the *server* tells it to use, and it must honor the
`slow_down` error by *increasing* that interval (RFC 8628 §3.5) rather than retrying
frantically. On top of that, short-lived credentials rotate the refresh token on every
refresh, so the CLI has to serialize concurrent refreshes (a lock file), write the new
credential back to the keyring *atomically*, and survive a partially-failed write — all
while never printing the token. Doing any one of these wrong produces a lockout that is
extremely hard for the user (or an agent) to diagnose.

**Bug report:** `gh auth login` fails with an error: "Too many requests have been made in
the same timeframe. (slow_down)" — https://github.com/cli/cli/issues/9370
> "Authentication in web browser failed: Too many requests in the same time frame
> (slow_down)." … "I'm running gh version 2.63.2 … on Ubuntu 24.04 LTS in WSL2, and I'm
> having this issue. In general, the `gh` client should be parsing the OAuth2 device code
> flow response that responds with this `slow_down` and **MUST increase the interval**
> (see the RFC: https://www.rfc-editor.org/rfc/rfc8628#section-3.5)." A companion report
> — `Device code flow not respecting slow_down` (https://github.com/cli/oauth/issues/76)
> — confirms "this module does not handle `slow_down`."

The trap: the auth server throttles the CLI's polling; because the client ignored
`slow_down` and kept hammering at a fixed cadence, it tripped the rate limiter and the
login simply failed. A second, more subtle failure mode for the *same* flow is documented
in `Expiring token auto-refresh can break the stored login when gh runs in a sandbox
without write access` — https://github.com/cli/cli/issues/14844 — where the refresh
rotates the token on the server but the write to the (read-only) keyring fails, so "the
stored login becomes unusable everywhere until the user signs in again."

**Mitigation:** Implement the device flow strictly to RFC 8628: parse the `interval` field
from the `device_authorization` response and use it as the poll period; on a `slow_down`
error, *add* `interval` (or use the server-provided interval) and continue rather than
aborting; on `authorization_pending`, keep polling; only treat `expired_token`,
`access_denied`, and a hard HTTP error as terminal. Because OpenForge is TypeScript, wrap
the poll in a small state machine with an explicit `maxAttempts` and a monotonic clock, and
make the "no browser available" path (headless) fall back to `--with-token < token` /
`GH_TOKEN` cleanly. For short-lived credentials, serialize refresh behind a lock (e.g. a
`proper-lockfile` on a state dir) and perform the keyring write *transactionally*: read →
refresh → verify the new credential is valid → persist → only then swap the in-memory
credential; if persist fails, do **not** present the invalidated old token — surface a
clear "cannot save refreshed credential (keyring read-only?); run `openforge auth login`"
message instead of a mysterious 401. Never write the refresh token to a file that any
process can read; prefer the OS keyring (see Problem 10). Ship an `auth status` that
distinguishes *expired* (refreshable) from *invalid* (re-login) explicitly, the way
`gh auth status --no-refresh` was asked to do in https://github.com/cli/cli/issues/14814.

---

## 2. Pagination

### Problem 2: Pagination (cursor vs offset, insertions during scroll, total counts, Relay compliance)

**Why it's hard:** The two dominant schemes — offset (`page`/`per_page`) and cursor
(GraphQL `first`/`after` + `pageInfo{hasNextPage, endCursor}`) — each have failure modes.
Cursor pagination is stable to inserts at the top of the result set (Relay's reason for
existing) but is **per-list**: a single query that nests two paged collections cannot be
auto-paginated with one `endCursor`, and a client that requests `pageInfo`/`hasNextPage`
but forgets to thread `$endCursor` back into the query will loop *forever* on the same
first page, silently burning the API rate limit. Offset pagination is simpler to read but
skips or duplicates rows when the underlying set changes mid-scroll, and has hard caps
(e.g. GitHub search returns at most 1000 results). A CLI that hides all of this behind a
`--paginate` flag is making a big promise: "I'll get you everything" — and that promise
breaks in exactly the corner cases users hit in production (deep pages, nested lists,
result sets that change while you read them, and 100-item-per-page truncation).

**Bug report:** `GraphQL pagination can accidentally go into infinite loop` —
https://github.com/cli/cli/issues/3728
> "A well-intentioned user can accidentally burn through their api abuse limit by
> misunderstanding how to use paginate." … "if I do include `pageInfo`, and
> `pageInfo.hasNextPage` returns `true` on the first call, but I do not include `after`
> and `$endCursor`, then **cli will loop**." … "the query I gave just kept repeatedly
> giving the same 100 until finally I hit the abuse limit." Maintainer mislav: "It turns
> out that this is not happening [a server error], and the server just ignores the
> `endCursor` value passed in."

The trap: the server silently ignores a cursor the query doesn't declare, so the client
re-fetches page 1 indefinitely. Two more production data points from the same family:
`gh issue list --search --limit N (N>100) over-fetches a full extra page` —
https://github.com/cli/cli/issues/13906 (the per-page reduction was written to the wrong
GraphQL variable, `$perPage`, which the operation doesn't declare, so `variables["limit"]`
stayed pinned and the final page over-fetched), and `gh pr view --json files` and
`--json commits` **silently truncate at 100 items** — https://github.com/cli/cli/issues/13338
("Always returns 100, even if the PR has 200+ files … Silent truncation is particularly
problematic for automated workflows that assume complete data.").

**Mitigation:** In OpenForge, treat pagination as a first-class, *safe-by-default* layer:
(1) Always require the client query to declare the cursor variable it uses; if a response
carries `hasNextPage: true` but the next request's `endCursor` equals the previous one
(cycle detection), **abort with an explicit error** after at most `N` pages (e.g. 1000)
instead of looping forever. (2) Never silently truncate: when a `--limit` is reached
before the source is exhausted, emit a machine-readable `truncated: true` marker (in JSON)
and a stderr notice (in TTY mode) so automation can react. (3) For nested/multi-list
queries, do *not* promise a single `--paginate`; either expose separate cursors per list or
drop down to `api`-level and document it (exactly the guidance mislav gave in
https://github.com/cli/cli/issues/4888). (4) Document the platform hard caps (100 per
GraphQL page, 1000 search results) and, for offset-based APIs, warn that inserts/deletes
mid-scroll can shift rows — prefer cursor for anything that must be exactly-once. In TS,
encode `PageInfo` as a discriminated type so "you requested `hasNextPage` but not the
cursor" is a compile-time/lint error rather than a runtime infinite loop.

---

## 3. Output Formatting (table vs JSON vs TSV vs custom templates, terminal width, Unicode width, color, a11y)

### Problem 3: Output Formatting (tables, Unicode/CJK/emoji width, color & NO_COLOR, accessibility)

**Why it's hard:** A table looks trivial until the terminal lies to you about width.
Correct column alignment requires measuring the **display width** of every cell, and
"display width" is not the byte count, not the rune/codepoint count, and not even the
grapheme count — it depends on the font and on *how the terminal renders* combining
sequences, East-Asian Wide/Fullwidth characters (CJK), variation selectors, skin-tone
modifiers, and multi-codepoint emoji/grapheme clusters. A character that is "one rune" in
Go/JS may occupy two columns; a single emoji may be 4–8 codepoints but one column; a
skin-toned flag emoji is multiple codepoints. Getting this wrong means misaligned columns
that look broken to half the world's developers (CJK users were hit first and hardest),
or — worse — truncation that *splits a multi-byte character* and emits mojibake. Layer on
top of that: terminals without a width (piped, CI, dumb terminals), color that must honor
`NO_COLOR`/`CLICOLOR`/`TERM`, ANSI escape sequences that a naive width calculator counts
as printable characters, and accessibility (color must never be the *only* signal). The
good news is this is a solved problem with a well-known library — the bad news is that
`gh` itself kept re-hitting it for years.

**Bug report:** `gh issue list is not aligned tags properly with CJK characters` —
https://github.com/cli/cli/issues/279
> "Usually, it takes a double width of ASCII character for one CJK character." The fix
> (PR #518, "Fix column alignment and truncation for Eastern Asian languages") had to
> "ensure that text is never truncated mid-character, which would result in garbled text"
> and "ensure that columns in `issue/pr list` output align properly." But the trap *kept
> recurring*: `Issue listing is misaligned when labels contain emoji` —
> https://github.com/cli/cli/issues/1454 ("our `text.DisplayWidth()` helper only
> recognizes Unicode characters … that take a double-width space … but does not recognize
> that all emoji … are always presented as a single-space character"), and, four years
> later, `Repository list table is misaligned when rendering emojis` —
> https://github.com/cli/cli/issues/9018 — where the maintainers concluded the real fix
> was grapheme-cluster-aware width ("we're actually counting bytes or runes and the emoji
> is being counted as > 1 space … we need `lipgloss.Width`"), linking a write-up on
> "Grapheme Clustering in terminals."

The trap is depth + regression: a naive `for (const ch of s)` width loop passes ASCII,
fails CJK, then still fails emoji, then still fails grapheme clusters — and because the
failure is *visual*, it survives unit tests and ships for years. Related: `Columns
truncated when printing nontty table` — https://github.com/cli/cli/issues/2042 — shows the
table printer truncating to terminal width even when **piped** ("This breaks grep-based
scripting for, say, long lists of labels"), i.e. the formatter must behave differently
for TTY vs non-TTY.

**Mitigation:** Use a dedicated, grapheme-cluster-aware width implementation rather than
rolling your own — in TypeScript, `string-width` (which respects East-Asian Width, ANSI
stripping, and grapheme clusters) plus `slice-ansi`/`truncate-ansi` for truncation that
never splits a cluster or leaves a dangling combining mark. Make width a pure function
`displayWidth(s: string): number` used by *both* alignment and truncation so they can't
drift. Detect TTY with `process.stdout.isTTY`: on a TTY, use the terminal's columns
(`process.stdout.columns`, fall back to parsing `COLUMNS`/`stty size`); when **not** a
Tty, disable width-based truncation entirely and emit full values (this is what fixes
#2042). Honor `NO_COLOR` (strip all color), `CLICOLOR`/`CLICOLOR_FORCE`, and degrade color
by `TERM`; never encode state in color alone (pair color with a text glyph like `✗`/`•`).
Cache the per-column max/median width (gh did this in PR #3200) and reserve URL columns
from truncation. Add snapshot tests that include CJK, emoji, and grapheme-cluster strings
so a width regression is caught in CI, not by a user on Twitter.

---

## 4. JSON Piping (`gh api ... | jq`, stable keys, streaming, NDJSON, encoding, large payloads)

### Problem 4: JSON Piping (stable keys, streaming/NDJSON, UTF-8/BOM, large payloads, pure stdout)

**Why it's hard:** The moment a CLI is scripted (`openforge pr list --json ... | jq ...`),
its stdout becomes a **contract**: stable key names, stable key order (nice for diffs and
human-readable logs), UTF-8 without a BOM, no stray deprecation notices or progress
spinners interleaved into the data, and — for large sets — a memory profile that doesn't
buffer the whole result before emitting. Three distinct failure classes recur in
production: (1) *silent data loss* — the command "succeeds" but the JSON is truncated to
the first page (100 items) so `jq` operates on incomplete data; (2) *stdout pollution* —
a wrapper, alias, shell `rc` echo, or a deprecation warning writes human text into the
same stream, so the consumer gets "invalid JSON" even though `rc=0`; and (3) *encoding /
size* — a BOM breaks `jq`/`JSON.parse` at offset 0, and slurping multi-megabyte payloads
into a single string before formatting spikes RSS. The nasty part is that these are all
`rc=0` failures: the pipe looks healthy until downstream logic is subtly wrong.

**Bug report:** `gh pr view --json files` and `--json commits` silently truncate at 100
items — https://github.com/cli/cli/issues/13338
> "return at most 100 items, silently dropping any beyond the first page. This is because
> the GraphQL fragments for `prFiles` and `prCommits` do not include `pageInfo` …
> `gh pr view 12345 --json files --jq ".files | length"` → Always returns 100, even if the
> PR has 200+ files." … "Silent truncation is particularly problematic for automated
> workflows that assume complete data." (The fix, PR #13340, had to add `pageInfo` plus
> `preloadPrFiles`/`preloadPrCommits` paging.)

Companion evidence for the *pollution* class: a well-known downstream failure mode —
"`gh returned invalid JSON`" raised when "the `gh` subprocess exits 0 but its stdout is
not valid JSON. Since every `gh` invocation uses `--json` … any non-JSON stdout means the
wrong thing answered: `gh` printed human text, a wrapper/proxy injected content, or stdout
got truncated/interleaved" (see e.g. the standardbeagle error reference, and the guard
hooks written to block `gh auth token` from reaching a transcript,
https://github.com/anthropics/claude-code/issues/71654). `gh api`'s own source had to add
an explicit guard that **refuses** responses carrying terminal escape sequences unless
`--allow-escape-sequences` is passed (see `pkg/cmd/api/api.go`), which is itself evidence
of how often raw control bytes leak into a JSON stream.

**Mitigation:** In OpenForge, make `--json` a *hard contract* enforced in tests:
(1) **Pure stdout** — all diagnostics, deprecation notices, and progress go to stderr;
add an integration test that pipes `cmd --json | JSON.parse` and fails on any parse
error, and a separate test asserting stderr is empty when piped. (2) **No silent
truncation** — reuse Problem 2's `truncated` marker; if the user asked for a list and the
source wasn't exhausted, the JSON should carry metadata (or emit NDJSON so each item is
independently valid and a truncated stream still yields N valid objects). (3) **Stable
key order** — serialize through an explicit key-order schema (define the field list in
code, not object insertion order) so diffs are meaningful; document the ordering as part
of the contract. (4) **Encoding** — always UTF-8, never a BOM; strip/refuse control
characters and terminal escape sequences from data values before serializing (mirror what
`gh api` does), or reject with a clear error. (5) **Large payloads** — support an NDJSON
mode (`--json-lines`) and stream from the HTTP body (Node `Readable` → transform → write)
rather than buffering the whole response, so RSS is bounded by the transform, not the
payload. Pin the JSON dialect (no `undefined`, no `NaN`, stable `Date` → ISO-8601).

---

## 5. Extension Model (gh extension vs oclif plugin vs cobra subcommand vs custom)

### Problem 5: Extension Model (distribution, versioning, sandboxing, secret access, supply chain)

**Why it's hard:** A CLI that is *extensible* is a CLI that will *execute third-party code
with your credentials in reach*. The design space is wide — git-clone-into-a-dir (gh's
model: `~/.local/share/gh/extensions/`), npm-packaged plugins (oclif), statically-linked
subcommands (cobra has none, which is itself a feature), or a sandboxed plugin runtime —
and each has a different trust model. The hard problems are: (a) **distribution &
versioning** (who signs the extension, how do updates work, do we pin versions, how do we
recover from a bad release), (b) **sandboxing** (does the extension run in-process with
full `process` access, or in a separate process/VM with a narrow IPC?), (c) **secret
access** (does the extension get the user's token implicitly, or must it declare + request
it, with consent?), and (d) **supply chain** (a malicious or compromised extension that
ships credentials exfiltration). The 2026 Nx Console incident is the cautionary tale for
entirely this category: a single compromised extension, delivered by the IDE's *auto
update*, stole the victim's **`gh` OAuth token** and pivoted into a major company.

**Bug report / incident:** *Postmortem: Nx Console v18.95.0 supply-chain compromise* —
https://nx.dev/blog/nx-console-v18-95-0-postmortem (corroborated by CISA:
https://www.cisa.gov/news-events/alerts/2026-05-28/supply-chain-compromises-impact-nx-console-and-github-repositories
— "The malicious extension version (18.95.0) was distributed through VS Code's automatic
update mechanism … CVE-2026-48027 … added to CISA's Known Exploited Vulnerabilities").
> "The compromise originated from a single contributor's developer machine … a
> credential-stealing payload … had **silently exfiltrated that contributor's GitHub CLI
> OAuth token** seven days earlier." … "Harvested credentials from common locations: …
> GitHub: `ghp_`/`gho_`/`ghs_` tokens from `~/.config/gh/hosts.yml`, `~/.git-credentials`,
> **environment variables, and process memory**." … "the attacker was active in our
> GitHub repos for **seven days without detection**."

Note this is a VS Code extension, not a `gh` extension — but it is the single best
demonstration of the trust model OpenForge's extension system must defend against, because
the *prize the attacker wanted was exactly the `gh`-style CLI token*, and the vector was
"an extension the user's tool auto-updated in the background." GitHub's own docs even carry
the warning: "Extensions outside of GitHub and GitHub CLI are not certified by GitHub …
**To mitigate risk when using third-party extensions, audit the source code of the
extension before installing or updating the extension.**" (https://docs.github.com/en/github-cli/github-cli/using-github-cli-extensions).

**Mitigation:** Adopt the most defensive model that is still usable: (1) **Distribute
extensions as signed npm packages** (in the TS/monorepo world, this is natural) with
**Sigstore/provenance attestations** and a **minimum-release-age** gate on auto-update —
the Nx postmortem's key lesson was that `minimum-release-age` silently no-opped on an old
package-manager version, so verify the runtime actually enforces it and pin the package
manager. (2) **Out-of-process execution**: run each extension in a child process (or a
sandboxed worker) with a **narrow IPC capability API**, not in the same Node process — so
an extension cannot simply read `process.env` or `fs` without being granted those caps.
(3) **Explicit secret grants**: an extension must *declare* the capabilities it wants in a
manifest (e.g. `permissions: ["auth:read-token"]`), and the CLI prompts the user for
consent on install/first-use; by default an extension gets **no** token. Provide a
`openforge extension run --no-auth` style so the grant is revocable. (4) **Pinned,
reproducible versions** + a `openforge extension verify` that re-checks the signature and
provenance before auto-update, and a "what changed" diff on updates. (5) **No background
auto-update by default** (see Problem 9); treat "extension auto-updates under my IDE" as
the threat model from the incident. (6) Prefer a **stable signing identity** (Problem 9)
so that keyring ACLs don't churn on every update (see Problem 10).

---

## 6. Shell Completion (static vs dynamic, bash/zsh/fish/powershell, caching, arg-parsing recursion)

### Problem 6: Shell Completion (static vs dynamic, multi-shell, caching, arg-parsing recursion)

**Why it's hard:** Static completion (generate a script once, list subcommands/flags) is
easy and fast. *Dynamic* completion — "complete me the repos / PRs / labels the user is
actually working with" — is where all the pain is, because the completion script and the
CLI have to have a **protocol**: the shell invokes the CLI with a hidden verb
(gh uses `gh _carapace`; cobra uses `prog __complete`) plus the current partial word, and
the CLI must return completions **plus a directive** (file-completion on/off, no-space,
etc.). Every shell implements that protocol slightly differently (zsh vs bash vs fish vs
PowerShell vs elvish vs xonsh), and the *argument the shell hands you is already mangled*
by the shell's word-breaking rules. Subtle, high-frequency traps: (a) shells split words
on characters like `:` or `,` (so `s3://bucket` or `--flag=a,b` arrive truncated and the
"real" prefix has to be reassembled from the arg list), (b) the completion pass can
**mutate the process's own `argv`** as a side effect and corrupt later logic, (c)
API-backed completion must be **cached** or every `<TAB>` is a network round-trip (bash
is worst — it can invoke on each keystroke), and (d) a no-subcommand program that adds a
completion verb suddenly *has* a subcommand and `legacyArgs` errors on the second token.

**Bug report:** `bug: ValidArgsFunction receives partial input when argument contains
colons in Bash` — https://github.com/spf13/cobra/issues/2376
> "When using dynamic shell completion via `ValidArgsFunction`, splitting on colons `:`
> causes the input string `toComplete` to be truncated. Instead of receiving the full
> logical argument, the function receives only the segment after the last colon, while the
> prefix is moved into the `args` slice. This makes implementing context-aware completions
> for URI-like schemes (e.g. `local:/path`, `s3://bucket`) … extremely brittle and
> non-portable across shells." The root cause, per a commenter, is Bash's
> `COMP_WORDBREAKS` (which contains `:` by default) — "this is likely related to some
> environmental factor."

A second, nastier class of bug in the same subsystem: `fix: prevent completions from
mutating os.Args via append side effect` — https://github.com/spf13/cobra/pull/2356
(> "When shell completions are requested (e.g. `prog __complete x`), `getCompletions()`
calls `ParseFlags(append(finalArgs, "--"))`. `finalArgs` is a sub-slice of the original
args (derived from `os.Args[1:]`) … `append` writes `"--"` directly into the shared memory
rather than allocating a new slice. **This corrupts `os.Args`**, which users may be
inspecting in their `ValidArgsFunction`." Fixed by capping slice capacity:
`finalArgs[:len(finalArgs):len(finalArgs)]`). And on the gh side, `Extension autocomplete
is broken` — https://github.com/cli/cli/issues/7524 — shows dynamic completion leaking the
extension's *description* into the completed text (`$ gh webhook  (Extension
cli/gh-webhook)`).

**Mitigation:** In OpenForge, implement dynamic completion as an explicit, shell-agnostic
core plus thin per-shell adapters: (1) a hidden `openforge __complete [shell]` verb that
receives the raw words and returns `{completions[], directive}` on stdout and a directive
code on a separate line (cobra's `__complete` protocol is a fine reference). (2) **Reconstruct
the logical word yourself** — do not trust the shell's split; receive the full partial
token and the list of preceding args, and re-join when the shell broke on `:`/`=`/`,`
(document which characters each shell breaks on, and test against `COMP_WORDBREAKS`).
(3) **Never mutate `process.argv`/the parsed arg state** during a completion pass — in TS
this means operating on a fresh copy of `process.argv.slice()` and never pushing into the
parsed-args array that the real command will later read (the TS analogue of the cobra
`append` capacity bug). (4) **Cache aggressively**: memoize API-backed completions with a
short TTL (e.g. 30–60s) keyed on the query, because bash may call per-keystroke; gh's
author called this out explicitly ("completing the list of labels where each segment would
cause an api call (bash is even worse and pretty much invokes it with each TAB)").
(5) **Generate static fallbacks** for all four target shells (bash/zsh/fish/powershell)
so that even without a network the subcommand/flag names complete; reserve the dynamic
verb for values. (6) Add a directive to disable file-completion where it's inappropriate
(gh/cobra's `ShellCompDirectiveNoFileComp`), and a test matrix that runs the completion
script in real shells (a `docker`-per-shell test harness, as gh's PR #2728 did).

---

## 7. Telemetry (opt-in/opt-out + privacy)

### Problem 7: Telemetry & Privacy (opt-in vs opt-out, what is sent, GDPR)

**Why it's hard:** Telemetry sits at the intersection of *engineering* (what to collect,
how to pseudonymize, where it's sent, how to batch/flush without blocking the command) and
*compliance/ethics* (default-on vs default-off, the difference between "anonymous" and
"pseudonymous," whether argument *values* — not just flag *names* — are transmitted, GDPR
Article 25 "privacy by default," CLOUD Act exposure for US-hosted sinks). The product
tension is real: usage data genuinely helps prioritize features, but a default-on
collector that ships a stable `device_id` across invocations is a *re-identifiable*
behavioral profile, and enterprise security teams cannot make an allow/ban decision unless
the payload is fully documented. The recurring failure is **opacity**: the docs point the
user at "run in log mode and read the source" rather than stating what is and isn't sent,
which is exactly what a privacy review cannot rely on. For a CLI used inside agents, there
is a second surface: extensions each carry their *own* telemetry that a top-level opt-out
does **not** cover.

**Bug report:** `Expand telemetry documentation to include sufficient information for
informed policy decisions` — https://github.com/cli/cli/issues/13263
> "The documentation for the new telemetry functionality does not currently enable users
> and organisations to make informed security and privacy decisions, as it lacks clear and
> specific information about **what is and is not transmitted**, instead suggesting that
> users review the telemetry in log mode and read the code themselves. Given the
> **default-on** nature of this functionality, and the **extensive behavioural data** that
> is being collected … I do not believe that the existing documentation provides sufficient
> transparency and clarity." … "there is no information about whether argument **values**
> are transmitted, which represent a higher risk profile than the switches themselves."

Corroborating context: gh shipped this in v2.91.0 (https://github.blog/changelog/2026-04-22-github-cli-opt-out-usage-telemetry/) and the payload (per the official docs,
https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry) includes `command`,
`flags`, `device_id`, `invocation_id`, `os`, `architecture`, and the *calling agent's*
identifier; opt-out is `GH_TELEMETRY=false` / `DO_NOT_TRACK=true` / `gh config set
telemetry disabled`; and — notably — the docs warn "These extensions may collect their own
usage data and are **not controlled by opting out**." Independent analysis flags the GDPR
Art. 25(2) problem directly: "A tool that phones home unless you opt out fails this test …
The default configuration of your systems must be the most privacy-protective one."
(https://sota.io/blog/github-cli-telemetry-gdpr-art-25-privacy-by-design-developer-tools-2026)

**Mitigation:** If OpenForge ships telemetry, default it **off** (opt-in) — this is the
safest position and the one that survives a GDPR Art. 25(2) review; if business pressure
demands default-on, then at minimum: (1) publish an **exhaustive, field-by-field payload
spec** (not "read the code") stating, for each field, whether it's a name or a value and
how it's pseudonymized; (2) honor `DO_NOT_TRACK` and an `OPENFORGE_TELEMETRY` env var with
a `log` mode that prints the exact would-be payload to stderr; (3) send **no argument
values**, no repo names, and no auth data — only command + flag *names* + OS/arch + a
random per-install ID; (4) make the ID **regenerable and non-cross-install-linked**; (5)
scope the sink and document it (and note CLOUD Act / data-residency implications for EU
users); (6) document that **extensions are a separate telemetry surface** and require each
extension to declare its own collection in the manifest (tie-in with Problem 5). Add a CI
"telemetry audit" test that asserts the payload contains no string from a denylist of
sensitive patterns (`ghp_`, emails, repo names).

---

## 8. Error Handling + Exit Codes (conventions, partial success, stderr vs stdout)

### Problem 8: Error Handling & Exit Codes (conventions, partial success, stream discipline)

**Why it's hard:** A CLI is a Unix citizen, and Unix citizens have a *dialect* of
promises: **exit 0 = success**, non-zero = failure, `0`/`1`/`2`/`4` conventions, **data
to stdout, diagnostics to stderr**, and "no output on an empty-but-successful result."
Breaking *any* one of these silently corrupts every script and CI pipeline that wraps the
CLI. The hard part is the **boundary cases** that look like success but aren't: an
authn/authz failure that the server expresses as "no results" (so an empty list exits 0);
a *warning* (already merged, nothing to do) that prints to stderr but exits 0; a command
that behaves differently when stdout is a pipe vs a TTY (so `cmd > /dev/null` returns a
different exit code than `cmd`); and a "not found" that should be distinguishable from
"forbidden." Each of these is a real `gh` bug, and each is a silent landmine for a CLI
that agents will script against. The fix is a *documented, tested* exit-code contract plus
strict stream separation — and, crucially, refusing the "empty == success" conflation.

**Bug report:** `gh repo set-default --view` breaks Unix standards — returns exit code 0
upon failure and prints error to stdout instead of stderr — https://github.com/cli/cli/issues/9398
> "GitHub CLI command `gh repo set-default --view` returns **exit code 0 and prints error
> to stdout instead of stderr** when the default repo isn't set. This **breaks Unix
> command line standard behaviour** and makes it hard to detect and script around error
> handling and recovery." … `gh repo set-default --view; echo $?` →
> `no default repository has been set; use \`gh repo set-default\` to select one` then `0`.

The "empty == success / stream changes the exit code" trap is the most insidious and is
documented in at least three more issues: `gh pr list` **exits with the incorrect status
when the output is captured** — https://github.com/cli/cli/issues/10951 (`gh pr list
--author=@me > /dev/null` → exit `0` even though it "should be 1" — "This can silently mask
real failures"); `gh pr list` response status code **override if using `--label`** —
https://github.com/cli/cli/issues/8930 ("`gh pr list --label` will override command status
code with `0` even HTTP status is 500" — "my command `gh pr list --label foobar` actually
show following output, but exit-code was 0 and break workflows"); and `gh auth status`
**returns wrong exit code when failing** — https://github.com/cli/cli/issues/8845 ("`gh
auth status` **always returns 0** … we were able to confirm that this is a regression … It
_should_ indeed return a non-zero exit code.").

**Mitigation:** Publish and *test* an explicit exit-code contract (gh's is a good base —
0 success, 1 generic failure, 2 cancelled, 4 needs-auth — documented at
https://cli.github.com/manual/gh_help_exit-codes) and add an exit-code test per command.
Enforce the rules that the bugs above broke: (1) **Errors always to stderr, data always to
stdout** — route *every* diagnostic, warning, and "not found" message to stderr; the
acceptance criterion in #9398 ("print … to `stderr` and not `stdout`") is the model.
(2) **Non-zero on any real failure**, including authz failures that the API disguises as
empty results — explicitly detect the "you're unauthorized, so you see nothing" case and
exit 1 with a clear message instead of treating "empty" as success (the root cause in
#10951 / #8930). (3) **Tty-independent exit codes** — a command's exit code must be the
same whether stdout is a TTY or a pipe; never let "can I prompt?" change the success
determination. (4) **Distinguish not-found from forbidden from conflict** — use distinct
error classes (and optionally distinct exit codes or a `--exit-code-on-not-found` flag) so
`if ! openforge pr view N; then` means "it's gone or I can't see it," and scripts can
branch. (5) Treat "already merged / nothing to do" as a *defined* outcome with a stable,
documented code (the #11784 discussion shows this is a deliberate choice, not an accident).

---

## 9. Update Mechanism (self-update, breaking changes, deprecation)

### Problem 9: Update Mechanism (self-update, signing, deprecation policy, breaking changes)

**Why it's hard:** A CLI that distributes itself to thousands of developers (and gets
auto-updated by package managers and IDEs) has to make three hard promises: **integrity**
(release artifacts are signed with a *stable* identity so updates can't be impersonated —
and so OS keyring ACLs don't churn), **continuity** (an expired signing key or a
mis-published release doesn't brick every `apt`/`brew` user), and **compatibility**
(breaking changes are telegraphed, not dropped in a "minor" release, and a CLI that
installs extensions/plugins doesn't yank out from under them). The two most damaging
failures are (a) a **signing-key lifecycle problem** — an expired GPG key silently breaks
updates for the whole distro package audience for months — and (b) a **breaking change
hidden in a version bump** that breaks every downstream plugin and script. Because the
CLI is a *distribution channel* for its extensions (Problem 5), an update failure is not
just an inconvenience — it can pin users onto a vulnerable version indefinitely, or
conversely an auto-update can push a *malicious* version (the Nx incident, Problem 5).

**Bug report:** `Can't install / update gh due to expired GPG key? [September 2024]` —
https://github.com/cli/cli/issues/9569 (a *priority-1* bug; an earlier, larger instance
is `GPG key used to sign debian packages is expired` — https://github.com/cli/cli/issues/6175,
74 👍, also priority-1).
> "Can't install / update `gh` due to expired GPG key? [September 2024]" — the failure
> mode is a fleet-wide **update outage**: every user on a distro that verifies the
> release signature (Debian/Ubuntu apt) gets a hard install failure because the signing
> key's expiry date passed, with no local recovery short of key rotation on the publisher
> side. This is not an edge case — it recurred (the 2022 #6175 and the 2024 #9569 are the
> *same* class of failure two years apart), which is the tell that the key-lifecycle process
> (rotation + distro re-sign + advance notice) was not institutionalized.

The breaking-change half of the problem is visible in the extension/plugin ecosystem:
oclif's `6.0.0 (2026-09-11) … feat!: remove support for legacy plugins` (
https://github.com/oclif/oclif/blob/main/CHANGELOG.md) and `5.0.0 … bump node engine to
>=22.0.0` are exactly the kind of "major bump silently breaks every plugin" event, and
`Upgrading to a version after 3.20.0 causes issues with hooks` —
https://github.com/oclif/core/issues/1013 — shows a *patch/minor* range change breaking
plugin hooks ("after updating to 3.20.0 none of the custom hooks in my plugin work").

**Mitigation:** (1) **Institutionalize signing-key lifecycle**: use a key with a multi-year
expiry, a documented rotation runbook, and a CI job that *fails the build* if the signing
key expires within 90 days (a calendar alarm is not enough — #6175 → #9569 proves it).
(2) Prefer a **stable code-signing identity** so OS keyring ACLs don't re-prompt on every
update (gh's own `docs/macos-keyring.md` documents that its Homebrew ad-hoc signing causes
"on every upgrade … users will be prompted for keyring access" — a real UX tax).
(3) **No forced auto-update**; do a *background, non-blocking advisory* ("a new version
is available: X") only, and make it disable-able. (4) **Strict semver for the CLI *and* a
compatibility contract for extensions/plugins**: no breaking changes in minor versions;
deprecate with a **warning period** (print a deprecation notice to stderr for N releases,
and — per Problem 4 — keep it off stdout so `--json` stays clean); publish a
`openforge plugin verify`/compatibility matrix. (5) Gate auto-update behind the
**minimum-release-age + provenance** checks from Problem 5 so an update can never quietly
push a bad/malicious build. (6) Support **pinning** (`openforge --pin-version` / an env
var) so a team can hold a fleet at a known-good version during an incident.

---

## 10. Secrets in Env Vars vs Keyring (macOS / Windows / Linux; token leak via env dump)

### Problem 10: Secrets — env vars vs OS keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service), token leak via `ps`/`/proc/PID/environ`

**Why it's hard:** A CLI must store and surface a credential that is, by definition, the
highest-blast-radius secret on the machine. The storage decision has three layers:
**(1) where it lives at rest** — OS keyring (macOS Keychain, Windows Credential
Manager, Linux `org.freedesktop.secrets`/Secret Service) vs a plaintext config file
(gh's `~/.config/gh/hosts.yml`); **(2) how it reaches the CLI at runtime** — env var
(`GH_TOKEN`, which is then visible in the process's `/proc/<pid>/environ` and to any
co-located process, and visible in `ps` if passed as an *argument*) vs keyring read;
**(3) how it can be *extracted by an attacker*** — file read, `gh auth token` subprocess,
or — the subtle one — the fact that gh's keyring access shells out to `/usr/bin/security`,
which means *any* process that can run a shell on that host can read the stored token.
Layer these together and you get the uncomfortable truth that "I stored it in the keychain"
is not a security boundary on its own: the ACL, the helper binary, the env-var path, and
the `--insecure-storage` fallback all interact. This is precisely why agent sandboxes and
supply-chain payloads both treat the CLI token as the crown jewel (see Problem 5).

**Bug report:** `gh` accesses keychain using shell's command `security`, leading to
process `/usr/bin/security` getting access to the stored GitHub Token —
https://github.com/cli/cli/issues/7123
> The issue is that **any process using the shell can get access to stored github tokens**,
> because gh's keyring integration execs `/usr/bin/security`, and the Keychain ACL grants
> that *binary* access — "calling `security` directly from a terminal can also access the
> stored `gh` tokens for a given host and user."

gh's own security note confirms the design and its consequence (
https://github.com/github/gh-cli/blob/v2.97.0/docs/macos-keyring.md): "Since the binary
accessing the `gh` keyring items is `/usr/bin/security`, calling `security` directly from
a terminal can also access the stored `gh` tokens … `gh` offers direct access to the token
via `gh auth token` … with the rise in agentic development, this probably has more merit
[as a risk]." The same doc records the *update-related* ACL churn problem (Problem 9):
Homebrew builds gh unsigned/ad-hoc-signed, so "on **every upgrade** of the homebrew
package, users will be prompted for keyring access." The community-built workaround — the
`ghw` wrapper (https://github.com/Martin-Tech-Labs/ghw) — exists *because* of #7123: it
"blocks `gh auth ...` so `gh` can't store/read credentials via Keychain shell-outs" and
instead "reads a token from Keychain using Keychain APIs" and "runs `gh` with `GH_TOKEN`
set **only for that subprocess**," i.e. it deliberately avoids both the `/usr/bin/security`
ACL hole *and* the env-var-in-`ps` hole by injecting the token into a single short-lived
child environment.

**Mitigation:** Adopt a defense-in-depth secret model: (1) **Prefer the OS keyring**
(macOS Keychain, Windows Credential Manager via `keytar`/`@types`-backed libsecret on
Linux, Secret Service via D-Bus) and treat plaintext `hosts.yml` as a **last resort** that
is loudly flagged — never the default on a machine that has a keyring. (2) **Avoid the
`/usr/bin/security` ACL hole** if feasible: use the platform's native keychain API (not a
shell-out) so the ACL binds to *your* binary's stable signing identity (which also fixes
the per-update re-prompt from Problem 9) — at minimum, document the #7123 exposure.
(3) **Never pass secrets as CLI arguments** (visible in `ps`); if a token must come from
the environment, read `GH_TOKEN`/`OPENFORGE_TOKEN` but warn that it is visible in
`/proc/<pid>/environ` and to co-located processes — and, like `ghw`, prefer injecting the
token into a *single short-lived child process* environment rather than exporting it
machine-wide. (4) **Never print the token to stdout by default** — require an explicit
`--show-token`/`auth token` and, in debug/verbose mode, **redact** token-shaped strings
from all output (the class of bug in
https://github.com/anthropics/claude-code/issues/11271 — "expose the first 10 characters of
a sensitive PAT" — and #71654, where stdout was persisted verbatim to a transcript).
(5) **Minimize lifetime**: default to short-lived/refreshable tokens (Problem 1) so that a
leaked value is useless within hours, and provide `openforge auth token --ttl` style
ephemeral issuance for CI. (6) Give users a **`openforge auth doctor`** that reports where
the credential actually lives (keyring vs plaintext vs env), its TTL, and the concrete
exposure (e.g. "warning: token readable via /usr/bin/security ACL — see #7123").

---

## Cross-Cutting Themes (read before finalizing architecture)

Several of the 10 problems share a common root cause; fixing the root cause fixes several
symptoms at once:

1. **"rc=0 does not mean success."** Problems 2 (silent truncation), 4 (invalid/truncated
   JSON), 8 (empty==success), and 10 (authz-as-empty) all manifest as a healthy-looking
   exit code over a *wrong* result. The single best defense is a **machine-readable
   result envelope** (`{ok, data, error, truncated, warnings}`) plus strict
   stdout/stderr separation and a per-command exit-code test matrix.

2. **The output channel is a trust boundary, not a debug channel.** Problems 4, 8, and 10
   converge on "stdout is a contract." Anything that reaches stdout (deprecations,
   warnings, tokens, escape sequences, interleaved progress) corrupts a pipe. Rule:
   *data only on stdout, everything else on stderr, secrets nowhere by default.*

3. **Distribution = attack surface.** Problems 5 (extension supply chain), 9 (signing-key
   lifecycle, auto-update), and 10 (keyring ACL) are one story: a CLI that installs and
   auto-updates third-party code with the user's token in reach must be treated as a
   supply-chain target. Stable signing identity + provenance + minimum-release-age +
   no-default auto-update + out-of-process sandboxed extensions + explicit secret grants.

4. **TTY vs non-TTY is a mode switch, not a cosmetic difference.** Problems 3 (width/
   truncation), 4 (pure JSON), and 8 (exit code independence) all require the formatter
   and the exit-code logic to branch on `isTTY` explicitly, and to be *tested* in both
   modes.

5. **Concurrency + persistence of rotating secrets.** Problems 1 (refresh-token rotation
   under a lock) and 10 (keyring write atomicity) mean: any operation that changes a
   stored secret must be serialized and transactional, and a failed write must never leave
   the user with a credential the server has already invalidated.

---

## Recommended OpenForge Defaults

Concrete defaults to adopt, one per problem. These are the "safe by default" answers that
the cited bugs argue for.

1. **Auth Flow →** Default interactive auth = **OAuth device flow (RFC 8628)** with a
   strict poll state machine that honors `interval`, back-offs on `slow_down`, and aborts
   on a bounded `maxAttempts`. Support `GH_TOKEN`/`OPENFORGE_TOKEN` env for CI (read-only
   path, no disk write) and short-lived refreshable tokens with lock-serialized,
   transactional keyring persistence. Never print tokens. Distinguish *expired* from
   *invalid* in `auth status`.

2. **Pagination →** **Cursor-first (Relay-style)** for GraphQL; offset only for legacy
   REST, with an explicit warning that mid-scroll mutations can shift rows. Enforce
   cursor *cycle detection* + a hard page cap (e.g. 1000) so a mis-wired query can never
   infinite-loop. Never silently truncate: emit a `truncated: true` metadata marker and a
   stderr notice. Document platform caps (100/page, 1000 search).

3. **Output Formatting →** **TTY = table, non-TTY = machine format** (auto-detect via
   `process.stdout.isTTY`). Use `string-width` + `slice-ansi`/`truncate-ansi` (grapheme +
   CJK + ANSI-aware) for *both* alignment and truncation. No width truncation when piped.
   Honor `NO_COLOR`/`CLICOLOR`; never encode meaning in color alone. Snapshot tests with
   CJK/emoji/grapheme fixtures.

4. **JSON Piping →** `--json` is a hard contract: **pure stdout** (stderr for all
   diagnostics), **stable documented key order**, **UTF-8 no BOM**, control-char/escape
   sanitization, no silent truncation (carry `truncated`), and an **NDJSON mode**
   (`--json-lines`) with streamed transforms for large sets. CI test: `cmd --json |
   JSON.parse` must not throw, and stderr must be empty when piped.

5. **Extension Model →** Extensions ship as **signed npm packages with Sigstore provenance
   and a minimum-release-age gate**; run **out-of-process** behind a **capability IPC
   API**; **no token by default** — extensions declare `permissions` in a manifest and
   the user consents. Provide `extension verify` (re-check signature/provenance) and a
   "what changed" diff; **no background auto-update by default**.

6. **Shell Completion →** Hidden `openforge __complete [shell]` verb returning
   `{completions[], directive}`; **reconstruct the logical word** from the arg list to
   defeat shell word-breaking (`:`, `=`, `,`); **never mutate `process.argv`** during a
   completion pass; **cache** API-backed completions (short TTL); **static fallbacks for
   bash/zsh/fish/powershell**; `NoFileComp` directive where appropriate; per-shell docker
   test matrix.

7. **Telemetry →** **Opt-in by default** (default-off). If on: exhaustive published field
   spec, `DO_NOT_TRACK` + `OPENFORGE_TELEMETRY=log` (prints the exact payload to stderr),
   **no argument values / repo names / auth data**, regenerable non-linked per-install ID,
   documented sink + residency notes, and a clear statement that **extensions are a
   separate surface**. CI "telemetry audit" test denying sensitive patterns in the payload.

8. **Error Handling & Exit Codes →** Documented contract (0 success / 1 failure / 2
   cancelled / 4 auth) with per-command exit tests. **Errors → stderr, data → stdout,
   always.** Non-zero on *any* real failure, including authz-disguised-as-empty and
   HTTP 5xx. **Tty-independent exit codes.** Distinguish not-found vs forbidden vs
   conflict; define stable codes for "already done / nothing to do."

9. **Update Mechanism →** **No forced auto-update**; background, disable-able advisory
   only. Stable signing identity + a **90-day-expiry CI gate** on the release key + a
   rotation runbook. **Strict semver** for CLI *and* extensions; deprecate with a
   stderr-only warning over N releases (never on stdout); gate updates behind
   provenance + minimum-release-age; support version pinning for fleets.

10. **Secrets: env vs keyring →** **Prefer the OS keyring** (native API, not a
    `/usr/bin/security` shell-out, bound to a stable signing identity) and treat plaintext
    config as a loudly-flagged last resort. **Never pass secrets as argv** (visible in
    `ps`); read env tokens but warn about `/proc/<pid>/environ` exposure; prefer injecting
    the token into a **single short-lived child environment** (the `ghw` pattern). **Never
    print the token by default** and **redact token-shaped strings in all debug output**.
    Default to **short-lived tokens**. Provide `auth doctor` reporting where the credential
    lives and its concrete exposure.

---

## References

All URLs verified reachable at research time (2026-11-03).

### Auth Flow
- cli/cli#9370 — `gh auth login` fails: "Too many requests … (slow_down)": https://github.com/cli/cli/issues/9370
- cli/oauth#76 — Device code flow not respecting `slow_down`: https://github.com/cli/oauth/issues/76
- cli/cli#14844 — Expiring token auto-refresh breaks login in read-only/sandbox: https://github.com/cli/cli/issues/14844
- cli/cli#12073 — `user` scope not persisting after `gh auth refresh`: https://github.com/cli/cli/issues/12073
- cli/cli#14814 — `gh auth status --no-refresh` misleading error for expired tokens: https://github.com/cli/cli/issues/14814
- cli/cli#14449 — Refreshable (short-lived) OAuth token support: https://github.com/cli/cli/issues/14449
- RFC 8628 (OAuth 2.0 Device Authorization Grant): https://www.rfc-editor.org/rfc/rfc8628
- `gh auth refresh` manual: https://cli.github.com/manual/gh_auth_refresh
- Authenticating with GitHub CLI: https://docs.github.com/en/github-cli/github-cli/authenticating-with-github-cli

### Pagination
- cli/cli#3728 — GraphQL pagination infinite loop: https://github.com/cli/cli/issues/3728
- cli/cli#13906 — `issue list --search --limit N>100` over-fetches a page: https://github.com/cli/cli/issues/13906
- cli/cli#13338 — `pr view --json files/commits` silently truncate at 100: https://github.com/cli/cli/issues/13338
- cli/cli#13340 (PR) — Paginate files and commits in `pr view --json`: https://github.com/cli/cli/pull/13340
- cli/cli#4888 — `--limit` restriction / no-limit discussion: https://github.com/cli/cli/issues/4888
- cli/cli#4413 — GraphQL cannot page multiple nested levels: https://github.com/cli/cli/issues/4413
- cli/cli#8290 — `--limit` > 100 on search breaks query (TotalCount drift): https://github.com/cli/cli/issues/8290

### Output Formatting
- cli/cli#279 — `issue list` misaligned with CJK characters: https://github.com/cli/cli/issues/279
- cli/cli#518 (PR) — Fix column alignment and truncation for Eastern Asian languages: https://github.com/cli/cli/pull/518
- cli/cli#1454 — Issue listing misaligned when labels contain emoji: https://github.com/cli/cli/issues/1454
- cli/cli#9018 — Repository list misaligned with emojis (grapheme clusters → `lipgloss.Width`): https://github.com/cli/cli/issues/9018
- cli/cli#2042 — Columns truncated when printing non-tty table: https://github.com/cli/cli/issues/2042
- cli/cli#3200 (PR) — Ensure table printer always uses all available width: https://github.com/cli/cli/pull/3200
- cli/cli#3488 — Provide Go template functions to format table output: https://github.com/cli/cli/issues/3488

### JSON Piping
- cli/cli#13338 — silent JSON truncation at 100 (machine-readable contract): https://github.com/cli/cli/issues/13338
- cli/cli `pkg/cmd/api/api.go` — escape-sequence refusal / JSON writer: https://github.com/cli/cli/blob/trunk/pkg/cmd/api/api.go
- `gh api` manual (`--jq`, `--slurp`, `--paginate`, `--template`): https://cli.github.com/manual/gh_api
- claude-code#71654 — Session transcripts leak secrets to stdout (the stdout-as-contract trap): https://github.com/anthropics/claude-code/issues/71654

### Extension Model / Supply Chain
- Nx Console v18.95.0 postmortem (exfiltrated the `gh` OAuth token): https://nx.dev/blog/nx-console-v18-95-0-postmortem
- CISA alert — Supply Chain Compromises (CVE-2026-48027, KEV): https://www.cisa.gov/news-events/alerts/2026-05-28/supply-chain-compromises-impact-nx-console-and-github-repositories
- StepSecurity — Nx Console VS Code Extension Compromised: https://www.stepsecurity.io/blog/nx-console-vs-code-extension-compromised
- docs.github.com — Using GitHub CLI extensions (audit warning): https://docs.github.com/en/github-cli/github-cli/using-github-cli-extensions
- `gh extension install` manual: https://cli.github.com/manual/gh_extension_install

### Shell Completion
- spf13/cobra#2376 — `ValidArgsFunction` receives partial input with colons in Bash: https://github.com/spf13/cobra/issues/2376
- spf13/cobra#2356 (PR) — prevent completions from mutating `os.Args` via `append`: https://github.com/spf13/cobra/pull/2356
- spf13/cobra#1562 — Completion fails after the first argument for programs without subcommands: https://github.com/spf13/cobra/issues/1562
- spf13/cobra#1877 — Custom autocompletion after `--` / `ArgsLenAtDash` always ≥ 0: https://github.com/spf13/cobra/issues/1877
- spf13/cobra#2285 (PR) — quote args in fish shell completion: https://github.com/spf13/cobra/pull/2285
- cli/cli#7524 — Extension autocomplete is broken (leaks extension description): https://github.com/cli/cli/issues/7524
- cli/cli#2728 (PR) — Better completions (carapace; caching, multi-shell pain points): https://github.com/cli/cli/pull/2728
- cli/cli#695 — Clarify how to use the PowerShell completions: https://github.com/cli/cli/issues/695

### Telemetry & Privacy
- cli/cli#13263 — Expand telemetry docs for informed policy decisions: https://github.com/cli/cli/issues/13263
- docs.github.com — GitHub CLI telemetry (payload + opt-out): https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry
- GitHub Changelog — Opt-out usage telemetry (v2.91.0): https://github.blog/changelog/2026-04-22-github-cli-opt-out-usage-telemetry/
- sota.io — GitHub CLI Telemetry & GDPR Art. 25: https://sota.io/blog/github-cli-telemetry-gdpr-art-25-privacy-by-design-developer-tools-2026

### Error Handling & Exit Codes
- cli/cli#9398 — `repo set-default --view` exit 0 + error to stdout (breaks Unix standards): https://github.com/cli/cli/issues/9398
- cli/cli#8845 — `gh auth status` returns wrong exit code when failing: https://github.com/cli/cli/issues/8845
- cli/cli#8930 — `pr list --label` overrides exit code with 0 on 500: https://github.com/cli/cli/issues/8930
- cli/cli#10951 — `pr list` exits 0 when output captured (`> /dev/null`): https://github.com/cli/cli/issues/10951
- cli/cli#11784 — `pr merge` should return non-zero when merge fails (already merged): https://github.com/cli/cli/issues/11784
- `gh exit-codes` manual: https://cli.github.com/manual/gh_help_exit-codes
- oclif/core#1423 — Exit code is not respected by oclif: https://github.com/oclif/core/issues/1423

### Update Mechanism / Breaking Changes
- cli/cli#9569 — Can't install/update `gh` due to expired GPG key (Sep 2024, priority-1): https://github.com/cli/cli/issues/9569
- cli/cli#6175 — GPG key used to sign debian packages is expired (2022, priority-1): https://github.com/cli/cli/issues/6175
- oclif/oclif CHANGELOG — 6.0.0 remove legacy plugins / 5.0.0 node>=22 (breaking majors): https://github.com/oclif/oclif/blob/main/CHANGELOG.md
- oclif/core#1013 — Upgrading after 3.20.0 breaks plugin hooks: https://github.com/oclif/core/issues/1013
- oclif/core#1396 — Should `engines.node` be bumped to 20+ (major-bump coordination cost): https://github.com/oclif/core/issues/1396
- oclif.io — Announcing oclif v2 (compatibility matrix, v1 deprecation): https://oclif.io/blog/2022-01-12/announcing-oclif-v2/

### Secrets: env vs keyring
- cli/cli#7123 — Keychain access via `/usr/bin/security` lets any shell process read the token: https://github.com/cli/cli/issues/7123
- gh-cli `docs/macos-keyring.md` (official security note; ACL + per-update re-prompt): https://github.com/github/gh-cli/blob/v2.97.0/docs/macos-keyring.md
- cli/cli Discussion #7109 — v2.24.0 `--secure-storage` (keyring opt-in → default): https://github.com/cli/cli/discussions/7109
- cli/cli Discussion #7435 — how to ensure `gh` doesn't use `config.yml` (env vs keyring): https://github.com/cli/cli/discussions/7435
- `ghw` wrapper (community workaround for #7123: no keyring shell-out, token into one child env): https://github.com/Martin-Tech-Labs/ghw
- claude-code#11271 — Exposing sensitive env vars when "confused" (the `echo $GH_TOKEN` trap): https://github.com/anthropics/claude-code/issues/11271

### Supporting framework issue pages (top-voted, mined for context)
- cli/cli issues, sorted by 👍: https://github.com/cli/cli/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- oclif/core issues, sorted by 👍: https://github.com/oclif/core/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- spf13/cobra issues, sorted by 👍: https://github.com/spf13/cobra/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- urfave/cli — v3.6.2 regression: flag parsing skipped for help subcommands: https://github.com/urfave/cli/issues/2271
- urfave/cli — MutuallyExclusiveFlags persistent flags not propagated: https://github.com/urfave/cli/issues/2265
- urfave/cli — Ordering of arguments and flags impact one another: https://github.com/urfave/cli/issues/1733

---

*End of report.* This document was produced to drive OpenForge CLI architecture decisions.
Each "Recommended OpenForge Defaults" entry maps 1:1 to a problem above and cites the
specific production bug that justifies it. Where a cited bug lives in a different
language/tool (Go `gh`, `cobra`, `oclif`, a VS Code extension), the failure mode is
language-agnostic and the citation is used to expose the trap OpenForge would inherit by
repeating the same design choice in TypeScript.

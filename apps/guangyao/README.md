# Guang Yao Together · 光耀同行

**Unofficial 發一光耀 learning/community concept · frontend PWA demo · v2.0.2.**

One responsive, installable web app for desktop and phones. It uses fictional data and local storage. It does **not** authenticate real users, process donations, issue official credentials, send live chat messages, host meetings or pay affiliate commissions.

## Run locally

From this app directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open <http://127.0.0.1:8765/>. No frontend build or runtime dependencies are required.

For mobile installation, use the deployed HTTPS URL in a supporting browser. iPhone/iPad users can use Safari's Share → Add to Home Screen. A phone cannot use the Mac's localhost URL as its own localhost. This is a PWA, not a native App Store/Google Play binary.

## Monorepo integration

- Project catalog: the repository's shared app catalog defines the landing-page entry, portfolio card and note status.
- Public site: the existing build copies this app's `web/` directory to the `guangyao/` site directory. Do not add another root Pages workflow.
- Portfolio: regenerate the managed project block through the existing publisher, with Obsidian notes disabled unless a specific vault is confirmed.
- App/Web/Mobile links intentionally open the same responsive frontend rather than independently maintained copies.
- Expected public app URL after a successful deployment: <https://juwpegatron.github.io/projects/guangyao/>.
- Portfolio: <https://juwpegatron.github.io/portfolio/#projects>.

The existence of these files does not prove that a push or deployment has succeeded. Check the remote commit and Pages workflow separately. The actual Obsidian vault has not been identified.

## Implemented demonstrations

- Three-level course progression, lesson previews, quiz feedback and one-time completion rewards.
- Sample handout/certificate downloads, private portfolio preview and profile controls.
- Online/offline/social activities, explicit registration/cancellation and role-switchable staff views.
- Local group conversations, pending friend invitations, a fixed poll and opt-in leaderboard.
- Demonstration points/redemptions, synthetic project ledgers and no-charge contributions.
- Meeting/history previews, sample summaries and an explicitly inactive affiliate program.
- Offline public shell, mobile bottom navigation, safe-area layout and approved-update flow.

The product blueprint is available inside the app. Detailed project notes and screenshots are retained in `docs/` and are not copied to the public app by the build.

## Reliability and privacy

The local state loader validates shapes and IDs, preserves recognized legacy progress and reconstructs demonstration balances. Web Locks serialize same-origin writes; cross-tab updates refresh stale state. Without Web Locks, only same-tab serialization is available. Registration is idempotent; a stale “register” action does not cancel an existing registration.

Local state is **not** trusted authorization or accounting. The role switch is intentionally a demo control. Never enter sensitive personal, religious, financial or meeting information. Logout retains local records; use Reset prototype on a shared device. Browser clearing or uninstalling may remove local data, and records do not synchronize across devices.

The service worker caches only an exact public-shell list. It does not cache APIs, chat records, signed files or payment responses. Increment its release value whenever a cached asset changes; updates wait for user approval before reloading.

## Checks

The standard-library structural test is compatible with the monorepo's existing test runner:

```sh
python3 tests/verify_static.py
```

Optional Chromium/WebKit browser regression tests are kept outside the default test-discovery directory. In a separate development environment with Playwright installed and its Chromium/WebKit browsers available:

```sh
python3 qa/browser_checks.py
```

The browser suite starts its own loopback server and isolated browser contexts. It checks progression, registration, role views, local state, concurrent tabs, mobile layouts, offline loading, subpath deployment and update approval. It refreshes the sample screenshots under `docs/images/`. Physical-device installation, screen-reader conformance and real backend services are not validated by these browser tests.

## Before a real launch

Confirm institutional authorization, content ownership, course standards, certificate issuer, age/region policy, moderation, privacy/retention, accessibility, backend identity/authorization and media providers. Donations require a legal recipient, approved payment provider, financial approvals and reconciliation. Affiliate terms and payout accounting need separate approval. None of these is solved by static hosting.

Code follows the repository's MIT license. That license does not grant permission to use organizational trademarks, teaching materials or an official endorsement. All institution-specific content and certification require authorization.

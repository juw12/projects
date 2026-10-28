# Vitals — competitive notes

How Vitals answers the most common complaints about popular cleaner/optimizer apps
(CCleaner, CleanMyMac, Avast Cleanup, Norton Utilities/Clean, Android "phone cleaner /
booster" apps, iPhone "cleaner" apps). Claims about competitors are kept general;
features change often.

## User pain points → what Vitals does

| Pain point people report | Vitals answer |
| --- | --- |
| Scare scores ("847 problems found!") that push an upgrade | Score starts at 100; every penalty is named, measured and shown with its fix. No paywall. |
| Cleaner deleted something I needed (logins, downloads, backups) | **Undo Vault**: cleanups are moves with one-click restore for 72 h. Personal files are never auto-selected; only *Safe* categories are preselected. |
| "Did it actually do anything?" | **Receipts** measure free disk space before/after each action. |
| RAM boosters / task killers that make phones slower and drain battery | Refuses to "boost". Explains why, and points at the one heavy app instead. |
| Subscription traps, especially iOS "cleaner" apps | Free, open source. On iOS, honest guides using Apple's own tools. |
| Telemetry / data-sharing worries | Local-only agent, no account, no network calls (optional Ollama is local too). |
| The optimizer itself runs heavy in the background | stdlib agent sampling every 30 s; scans are time-boxed. |
| Generic advice that ignores my device | **Your normal** baseline, **Drain Detective**, **idle drainers**, **Growth radar** use this device's own history. |
| Developers' disks fill with build junk tools don't understand | Xcode DerivedData, simulator caches, package-manager caches, `node_modules` in projects idle for 60+ days. |

## Features we haven't seen combined in one mainstream cleaner

1. A cleanup Undo Vault with time-boxed retention and measured receipts.
2. A goal planner driven by natural language and exclusions ("free 10 GB without touching downloads").
3. Anomaly detection against the device's *own* hourly baseline.
4. Idle-drainer attribution (CPU time while no keyboard/mouse input).
5. Battery wear forecast from logged capacity history.
6. Laptop agent + phone pairing with a one-time code, with no cloud relay.
7. A chat that executes reversible actions, not just answers questions.

## What's hard to copy (honestly)

Code can be copied, so the moat is what accumulates around it:

- **Personal history.** Baselines, wear trends and growth snapshots get more useful every week and live only on the user's machine. A newcomer starts from zero.
- **Trust primitives.** Undo by default and measured receipts cut against an upsell business model. Apps that profit from scare-and-subscribe would undercut their own funnel by adopting them.
- **Local-only by design.** No servers means no data to monetize, a position that's hard to retrofit into a telemetry-funded product.

## Roadmap ideas

- Windows/Linux field testing; signed installers (menu-bar / tray app).
- Scheduled scans with a weekly growth digest.
- Thermal sensor readouts where the OS exposes them.
- Per-app battery history charts.

---
title: 光耀同行 — 發一光耀 Learning & Community App
aliases:
  - Guang Yao Together
  - 發一光耀平台概念
type: project
status: frontend-pwa-demo
version: "2.0"
tags:
  - projects
  - education
  - community
  - pwa
  - portfolio
organization_approval: pending
github_repository: https://github.com/juwpegatron/projects/tree/main/apps/guangyao
public_deployment: pending
portfolio_publication: pending
---

# 光耀同行

> An unofficial learning/community product concept for 發一光耀. The current delivery is a responsive, installable PWA frontend with local demonstration data—not an operational institutional service.

## Project overview

A single learning community where people can take level-based courses, watch authorized teaching content, access materials, pass assessments, earn credentials, join activities, connect with others, contribute to charitable projects, and understand how those contributions are used.

Three systems must remain separate:
- **Learning progression:** completed units, assessments, prerequisites and authorized credentials.
- **Participation recognition:** points, badges and optional learning leaderboards.
- **Administrative authority:** explicit delegated permissions, never automatic promotion through points, donations or religious rank.

Charitable funds, participation points and affiliate commissions require separate ledgers.

## Current deliverables

- A 14-screen product blueprint with member/staff journeys and production acceptance criteria.
- Responsive Traditional Chinese desktop/tablet/phone frontend.
- Installable mobile PWA shell, icons, offline support and explicit update approval.
- Locally interactive courses/quizzes, sample certificates, profiles, schedules, registrations, community chat/poll, rewards and no-charge giving demonstrations.
- Manual GitHub Pages workflow, regression checks, and desktop/mobile previews.
- This Obsidian-ready note and the portfolio copy below.

The app and generated portfolio card have been prepared in local copies of juwpegatron/projects and juwpegatron/portfolio. The Obsidian vault is still unconfirmed. Local integration is not proof of a successful push or public deployment; verify those separately.

## Requirements map

| Area | Delivered locally | Needs a real service |
| --- | --- | --- |
| Organization introduction | Approved-content placeholder and supplied reference | Authorization, final history/contact copy and media rights |
| Accounts/profile | Local role switch, profile editor, opt-in visibility | Secure registration/login/recovery, moderation, deletion/export |
| Learning | Three-level progression, units, quiz, sample materials | Real course authoring, licensed streaming, secure resource access |
| Certificates/portfolio | Watermarked sample certificate and local preview | Authorized issuer, unique credential IDs, verification/revocation, public URLs |
| Events | Online/offline/social calendar, explicit registration, role views | Actual scheduling, reminders, ownership, capacity/waitlist and attendance |
| Rewards | Local point balance, redemption and inventory simulation | Transactional server ledger, stock reservation, fulfillment and terms |
| Charity | Synthetic budget/expense transparency and simulated support | Legal recipient, PSP, reconciliation, receipts, evidence and independent review |
| Community | Local groups/chat, pending friend request, fixed poll | Multi-user service, mutual acceptance, moderation, blocking/reporting |
| Meetings | Room/history/summary interface | Video provider, consented recording, transcript, human-reviewed summary |
| Referrals | Invitation preview and clearly inactive commission lifecycle | Approved attribution, anti-abuse, commission/payout accounting and tax handling |
| Mobile | Responsive PWA shell and installation instructions | Actual-device acceptance, HTTPS deployment; native stores optional later |

## Audit findings addressed

- Defensive state normalization prevents malformed local records from crashing the app.
- Valid legacy progress is migrated rather than intentionally discarded.
- Demo balances are reconciled to recognized course completions and reward records.
- Web Locks serialize same-origin mutations; storage events keep tabs informed.
- Registration intent is explicit, so stale duplicate registration cannot cancel an existing booking.
- Redemption rechecks current balance/stock and explains a stale-action rejection.
- Mobile navigation has an accessible drawer state, Escape behavior, safe areas and touch-sized controls.
- The local-demo status remains visible on mobile; sign-out versus reset is explained.
- Only a fixed public-shell list is cached. Private API/meeting/payment data is excluded.
- Cache names and manifest paths support project subdirectories. Updates wait for user approval.

These are frontend reliability improvements, not proof of production security, financial correctness or legal compliance.

## Decisions and dependencies

- [ ] Confirm official authorization versus independent concept.
- [x] Identify the existing public projects and portfolio repositories.
- [ ] Complete GitHub authentication and verify deployment.
- [ ] Confirm this note's destination vault and folder; preserve existing notes/plugins.
- [ ] Confirm portfolio website and its source repository or CMS.
- [ ] Confirm target countries, languages, audience age and accessibility requirements.
- [ ] Confirm actual course levels, teachers, completion standards and certificate authority.
- [ ] Select identity/database/video/meeting providers in approved accounts.
- [ ] Confirm legal donation recipient, reconciliation and receipt requirements.
- [ ] Approve reward rules and single-level affiliate program, if any.
- [ ] Test on physical iPhone/iPad and Android devices after HTTPS deployment.
- [ ] Choose a code license and obtain brand/media permission before public publication.

## Delivery checklist

### Completed locally
- [x] Product plan and visual interaction design.
- [x] Web/mobile frontend and PWA infrastructure.
- [x] Clear distinction between demonstrations and real integrations.
- [x] Defensive state, cross-tab and stale-action improvements.
- [x] GitHub deployment preparation and Obsidian/portfolio draft.

### Pending external actions
- [ ] Inspect and merge into the confirmed GitHub repository without overwriting unrelated work.
- [ ] Authenticate using an approved process; no credentials pasted into notes or chat.
- [ ] Commit/push to the chosen branch and review changes.
- [ ] Manually deploy the approved demo and verify its public HTTPS URL.
- [ ] Copy this note into the confirmed vault; avoid duplicate project notes.
- [ ] Adapt the portfolio draft to the existing site's conventions, preview, then publish.
- [ ] Integrate and test real backend services before calling this a live learning platform.

---

# Portfolio case study — publication draft

## 光耀同行: Learning, community, and transparent participation

**Type:** Concept design and interactive PWA frontend
**Audience:** A proposed 發一光耀 learning community
**Status:** Unofficial demonstration; no institutional endorsement or production deployment claimed
**Format:** Responsive web + installable mobile PWA
**Stack:** HTML, CSS, JavaScript, Web App Manifest, service workers, local storage, Web Locks, Python/Playwright QA
**Links:** Add the approved repository and public HTTPS demo after deployment.

### The challenge

The initial idea combined online learning, social participation, charitable giving, rewards and referrals. The design challenge was to make these feel like one coherent experience without confusing learning achievement, administrative access or financial contribution.

### The approach

The product was organized around a clear member journey: discover a course, complete its lessons, pass an assessment, unlock the next level, and choose whether to share an achievement. Activities and community discussions support that journey rather than replacing it with a ranking system.

A calm Traditional Chinese interface uses a deep-green palette, warm accents and original geometric illustrations. Desktop layouts emphasize overview and discovery; the mobile experience adds thumb-friendly bottom navigation, focused drawers and installation guidance.

### Selected design decisions

- Learning level, staff permissions and reward balances are separate concepts.
- Portfolios and leaderboards are opt-in; donation amounts are not measures of moral standing.
- Sample certificates are visibly marked as demonstrations instead of pretending to be officially issued.
- The charity area distinguishes received, allocated and spent funds, using explicitly synthetic examples.
- Referral commissions are a separate, inactive workflow pending approved terms—not a promised income stream.
- Mobile and desktop share one PWA frontend; no native-store release is implied.

### Engineering improvements

The initial clickable prototype was audited for state, concurrency and mobile problems. The revised app validates stored records, migrates recognized progress, reconciles demonstration balances, serializes cross-tab actions, and prevents stale registration actions from reversing an existing booking.

Offline support caches only the public app shell. New versions wait for the user to approve a reload, reducing the chance of interrupting a form. Relative URLs and scope-specific cache names support deployment below a repository path.

### Outcome

The result is an interactive frontend and a detailed production blueprint, not a launched service. It demonstrates course progression, certificates, activity registration, community interactions, rewards and transparent-giving workflows. Automated browser checks cover key flows, responsive layouts, storage recovery, cross-tab behavior and PWA operation; physical-device and production-service validation remain separate release requirements.

No user-growth figures, revenue results, institutional approval, charitable audit, regulatory certification or academic accreditation are claimed.

### Suggested portfolio media

- Desktop dashboard preview: learning path, schedule and participation overview.
- Mobile preview: local-demo notice, installation affordance and bottom navigation.
- Flow diagram: learn → assess → progress → optionally share.
- Audit summary: state validation, stale-action handling and private-data cache boundaries.

Use only approved public screenshots with fictional data. Do not publish real member records, private conversations, financial receipts or internal staff-only activity details.

## Reference

[User-provided 發一光耀 introduction page](https://www.iktcds.edu.tw/Chong-De-School/FaYi-GuangYao.htm)

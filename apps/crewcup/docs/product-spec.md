# CrewCup — Office Coffee Ordering Platform (Product Spec v0.1)

> Working name: **CrewCup**. Check trademark/domain availability before use.
> Concept: one platform where office workers order coffee **solo or as a group**, sign in and get paid for with their **company identity (SSO / badge)**, and orders go **straight into partner coffee shops' systems**, ready on time for pickup or delivery.

---

## 1. Why this beats existing options

| Existing product / repo | What it does well | What it lacks | CrewCup answer |
|---|---|---|---|
| Kaffenio | Office group hub, QR join, scheduled runs, rules, payment | Region-locked; no SSO/badge, no payroll billing, no POS depth | Same hub + enterprise identity + direct POS integration |
| Fika Mate | Corporate gifts, loyalty, B2B café ordering | Perk-oriented; weak day-to-day group workflow | Gifts and loyalty built into everyday ordering |
| Kuppso | Employer-paid coffee subscription, dashboard, monthly invoice | Subscription only; no group runs | Flexible allowance wallets (subscription is just one rule type) |
| Swyp | Enterprise workplace services, meeting-room coffee | Heavy enterprise suite; in-house pantry, not local cafés | Meeting-aware ordering from real local cafés |
| CoffeeCanz | Discounts / sponsored coffee perk | Benefits only, no ordering logistics | Perks plus logistics |
| Office Coffee Run (imgoingnow) | One link collects everyone's order, no install | No payment, no café connection | Guest link **with** payment and direct café submission |
| OrderUp! | Group order, split or host pays | General food; no company billing | Split / host / company / mixed payment |
| Uber Eats / DoorDash for Business, ezCater, Sharebite, Forkable | Company-paid food, budgets | Not coffee-specific; high café commissions; no batching | Lower café fees, coffee-specific batching and labeling |
| Joe Coffee, Ritual | Pre-order from independent cafés, social pickup | Consumer-first, limited corporate controls | Corporate-first with a consumer-quality app |
| Slack/Telegram bots (koffee-karma, goferbot, coffeebot, slack-coffee-bar, ncss-coffeerun, Coffee-Run-Bot, office-brew-bot) | Order inside chat, karma for fetchers | Hobby-grade, no payments, no cafés | First-class Slack/Teams/WhatsApp/Telegram ordering |
| coffee-run CLI | Rotation of who pays, cost tracking | CLI only | Built-in fair rotation and IOU ledger |

---

## 2. Users and roles

- **Employee:** orders solo, joins or starts group orders, uses an allowance or own card.
- **Runner:** the person collecting a group order (optional; can be replaced by delivery).
- **Team lead / office manager:** sets team budgets, schedules recurring runs, orders for meetings.
- **Company admin / finance / HR:** SSO, policies, cost centers, invoices, reports.
- **Café staff / owner:** receives orders, manages menu, capacity and payouts.
- **Courier (optional):** café staff, third-party courier, or building concierge.
- **Guest:** visitor or contractor ordering through a link without an account.

---

## 3. Feature set

### 3.1 Ordering modes (merged + extended)
1. **Solo order:** pickup at a time slot or delivery to a desk/floor.
2. **Group run:** a runner opens a run with a cutoff; teammates join via app, link, QR, or chat. *(Kaffenio, Office Coffee Run, bots)*
3. **Group delivery:** same as a group run, but the café or a courier delivers. Everyone tracks one order.
4. **Meeting order (new):** calendar integration (Google/Outlook). The organizer gets a nudge before the meeting; attendees get a one-tap form; drinks arrive at the room at start time. *(extends Swyp)*
5. **Scheduled / recurring:** "Every Monday 9:30 team standup" or "my usual at 8:45 on office days." *(Kaffenio scheduling, extended)*
6. **Treat / gift:** buy for one person or the whole team; gift credits; birthday and work-anniversary automations from the HR directory. *(Fika Mate gifts, extended)*
7. **Bulk / catering:** coffee urns, pastry boxes, events with 24h+ lead time and café quote/accept flow.
8. **Guest link:** order with no install or login; host or company pays. *(Office Coffee Run, extended with payment)*

### 3.2 Company identity and badge (key differentiator)
- **SSO login:** Google Workspace, Microsoft Entra ID, Okta (SAML/OIDC); **SCIM** sync so joiners and leavers are handled automatically.
- **Digital company badge in-app:** name, photo, team, floor/desk. Shown on cup labels and at pickup.
- **Physical badge tap (phase 3):** NFC/RFID badge tap at the café tablet or a pickup locker to identify and pay (HID / mobile-wallet employee badge where supported).
- **Verified-employee perks:** cafés can offer company-specific discounts only to verified employees.
- **Work-email domain verification:** fallback for small companies without SSO.

### 3.3 Payments and money
- **Payment sources:** personal card or wallet (Apple Pay / Google Pay), **company allowance wallet**, **payroll deduction** (where legal), team budget, meeting budget.
- **Mixed payment:** company covers up to $X; the employee pays the remainder automatically.
- **Group payment options:** host pays all, everyone pays own, split evenly, or company pays. *(OrderUp!, extended)*
- **Fair-run ledger:** who-owes-whom IOUs, auto-settlement, and runner rotation suggestions. *(coffee-run CLI)*
- **Runner karma / rewards:** points for runners, redeemable for free drinks. *(koffee-karma)*
- **Company invoicing:** consolidated monthly invoice, cost centers, PO numbers, tax-compliant receipts. *(Kuppso, extended)*
- **Expense export:** SAP Concur, Expensify, Xero, QuickBooks, NetSuite.
- **Café payouts:** marketplace payouts (e.g., Stripe Connect), daily or weekly.

### 3.4 Company admin console
- Allowance rules: per day/week/month, per office, per role, office-days only, meeting-only.
- Policies: max price, allowed cafés, alcohol-free, approval for orders over $X.
- Multi-office / multi-building; floor and room directory.
- **Hybrid-work aware:** integrate desk booking (Envoy, Robin, Microsoft Places) so allowances and nudges apply only on in-office days.
- Analytics: spend, participation, popular cafés, budget burn.
- Engagement: "Coffee roulette" pairs random colleagues for a coffee chat (company-paid), useful for onboarding.

### 3.5 Café side (to win café adoption)
- **Direct POS injection:** Square, Toast, Clover, Lightspeed. Orders appear like normal tickets; no extra tablet required.
- **Fallback café app:** tablet or web with ticket printing and **cup labels** (name, team, floor, group ID, allergens).
- **Capacity-aware slots (new):** café sets drinks per 5-min window; the platform staggers group orders across offices so baristas aren't swamped at 9:00. Busy-mode auto-throttle and pause.
- **Batch view:** a large order is shown grouped by drink type for faster prep (e.g., "6× oat flat white").
- **Demand forecast (new):** predicts tomorrow's corporate volume from schedules, recurring orders, and office-attendance data. Helps with staffing and milk/pastry prep.
- **Menu sync** from POS; 86'd items auto-hidden.
- **Bulk discount tiers** and company-specific pricing.
- **Lower fees** than delivery apps; B2B invoicing handled by the platform; café gets paid fast.
- **Loyalty** that cafés own, not the platform. *(Fika Mate loyalty, extended)*

### 3.6 Pickup and delivery
- Pickup time slots with "ready" push notification.
- **Group pickup shelf / smart locker** with QR or badge unlock.
- Delivery to floor/desk/meeting room; courier gets building access info (lobby instructions, visitor pass via Envoy integration).
- Live status: received → preparing → ready → out for delivery → delivered.
- Proof of delivery photo; temperature-friendly packaging guidance (carriers, lids).

### 3.7 Where people order (omnichannel)
- iOS / Android app, web app (desktop at work), PWA guest link.
- **Slack & Microsoft Teams apps:** `/coffee` command, run announcements, one-click join, order status in thread. *(goferbot, slack-coffee-bar, coffeebot, ncss-coffeerun)*
- **WhatsApp / Telegram / LINE bots** for markets where those dominate. *(office-brew-bot)*
- Home-screen widgets and watch app for "my usual."

### 3.8 Smart features (new)
- **Natural-language ordering:** "same as yesterday but oat milk, large" (in app and chat).
- **Taste & allergy profile:** saved milk/sugar/size defaults, allergen warnings, auto-applied in group runs.
- **Smart cutoff:** recommends the group cutoff time based on café queue and walking/delivery time.
- **Café recommendations** near the office by rating, wait time, and price.
- Optional caffeine tracker / wellbeing nudges (opt-in only).

### 3.9 Sustainability (new)
- Reusable cup program: borrow/return tracking, deposit, company-wide stats.
- "No cutlery / no carrier" defaults; consolidated trips reduce deliveries.
- ESG report for the company: cups saved, trips consolidated.

### 3.10 Trust, privacy, compliance
- PCI handled by the payment processor; no raw card data stored.
- GDPR / PDPA-style data controls; employer cannot see individual drink choices, only aggregate spend (configurable, opt-in).
- Role-based access, audit logs, SOC 2 roadmap for enterprise sales.
- Accessibility (WCAG 2.2 AA), multi-language, multi-currency, local tax handling.

---

## 4. Phased roadmap

**Phase 1 — MVP (prove the core loop)**
- Solo + group run, guest link, cutoff timer
- Work-email verification + Google/Microsoft login
- Card/wallet payments, host-pays / each-pays
- Café web tablet app with printed labels, capacity slots
- Slack app (order + join run)
- Admin: simple monthly allowance per employee, CSV report

**Phase 2 — Company value**
- SSO (SAML/OIDC) + SCIM, cost centers, consolidated invoicing
- Mixed payment (allowance + personal), team/meeting budgets
- Calendar meeting orders, recurring orders
- Square + Toast POS integration
- Teams app, delivery to desk/room, fair-run ledger and karma

**Phase 3 — Moat**
- Physical badge tap and smart lockers
- Demand forecasting for cafés, hybrid-work integrations
- Payroll deduction, expense integrations
- Gifts/celebrations automation, coffee roulette
- Reusable cups, ESG reporting, NL ordering

---

## 5. Suggested architecture

- **Clients:** React Native (Expo) for iOS/Android; Next.js for web, admin console, café tablet, guest links.
- **Backend:** TypeScript (NestJS) or Python (FastAPI); PostgreSQL; Redis for cutoff timers, queues, real-time state.
- **Real-time:** WebSockets / Server-Sent Events for order status; push via FCM/APNs.
- **Payments:** Stripe Connect (marketplace payouts, wallets, invoicing) or a regional equivalent.
- **Identity:** WorkOS / Auth0 / Keycloak for SSO + SCIM.
- **Integrations:** Square, Toast, Clover, Lightspeed POS APIs; Slack Bolt; Microsoft Bot Framework; Google/Microsoft Graph calendars; Envoy/Robin.
- **Jobs:** worker queue (BullMQ / Celery) for cutoffs, recurring orders, invoices, forecasts.
- **Hosting:** managed cloud (e.g., AWS/GCP) with infrastructure-as-code.

### Core data model
```
Company ─┬─ Office ─ Floor/Room
         ├─ Team ─ Budget
         ├─ AllowancePolicy
         └─ Employee (SSO id, badge id, profile, taste prefs)

Cafe ─┬─ Location (capacity per slot, hours)
      ├─ Menu ─ Item ─ ModifierGroup ─ Modifier
      └─ POSConnection

GroupRun (host, cafe, cutoff, mode: pickup|delivery|meeting, payment rule)
  └─ Order (employee|guest, items, payment split)
       └─ OrderItem (item, modifiers, label text)

CafeTicket (batched orders → one POS ticket, slot, status)
Payment / LedgerEntry / Invoice / Payout
```

### Key flow: group run
1. Host creates a run (café, cutoff, pickup or delivery, payment rule) → shares link / Slack / QR.
2. Members add drinks (profile defaults pre-filled); payment authorized per rule.
3. At cutoff: lock run → capture payments → batch into café ticket in an available capacity slot.
4. Café receives via POS or tablet → prints labels → marks ready.
5. Notify the runner / courier → pickup or delivery → done; ledger and karma updated.

---

## 6. Business model (to validate)
- **Companies:** per-employee SaaS fee for the admin, allowance, and SSO features; free tier for small teams.
- **Cafés:** low commission on platform orders (target well below delivery-app rates) or a flat monthly plan.
- **Employees:** free.
- **Optional:** delivery fee, premium gift/event catering.

## 7. Key risks
- **Café adoption:** solve with POS integration, low fees, guaranteed B2B volume, fast payouts.
- **POS API access:** some (e.g., Toast) require partner approval; plan for the tablet fallback.
- **Peak-hour overload:** capacity slots and staggering are core, not optional.
- **Payroll deduction / allowance tax rules** vary by country; get local legal and tax advice.
- **Cold-start:** launch building-by-building (one office tower + 3–5 nearby cafés) instead of city-wide.
- **Delivery quality:** short radius, proper carriers, realistic ETAs.

## 8. Success metrics
- Weekly active ordering employees / eligible employees
- Group runs per office per week, average group size
- Café on-time ready rate, average prep time per slot
- Company retention and allowance utilization
- Café retention and incremental revenue per café

---

## 9. Unsolved problems we fix (gap analysis)

> Pain points from news coverage, app reviews, and industry reports (Business Insider on Starbucks mobile ordering, Reuters, ezCater reports and reviews, Sharebite blog, Ritual case study). None of the products we reviewed fully solves them. "Not found" means we didn't see it in those products; it doesn't prove it exists nowhere.

| # | Problem (who feels it) | Why current apps fail | CrewCup fix |
|---|---|---|---|
| 1 | **Cold / stale coffee**: drinks sit while the runner or courier is still on the way (employee) | Prep starts at order time; ETAs are guesses | **Fire-on-approach:** prep starts when the runner is about X min away (opt-in live location, or leaving the building). Whole group is finished together, not one by one. |
| 2 | **Big orders crush the café at rush hour**; walk-in customers wait (barista, café) | Item caps get bypassed by placing back-to-back orders | **Hard slot capacity per café across ALL accounts**, plus **off-peak incentive** (e.g., small discount for the 8:40 slot instead of 9:00). Optional "group menu" with fewer modifiers for large runs. |
| 3 | **Wrong or mixed-up cups**, duplicate names (employee, runner) | Labels show first name only; nobody checks before leaving | **Unique cup code** (name + short code + team color) and **scan-to-verify at pickup**: runner scans each label, and the app flags a missing or wrong cup *before* leaving the café. |
| 4 | **Runner pays upfront and chases coworkers** for money (runner) | Bots and links collect orders, not money | **Pre-authorized payment on join**: the runner never fronts cash; charges are captured at cutoff. Optional auto-rotation of who covers the treat. |
| 5 | **One person can't carry 12 drinks** (runner) | No app considers it | **Carry planner:** calculates carriers/trays needed and auto-asks a second volunteer when the group is too big. |
| 6 | **Same people always end up doing runs** (often junior staff) | No visibility | **Fair rotation + karma rewards**, and a delivery option; managers see only team-level fairness stats, not individual drink data. |
| 7 | **Remote and hybrid staff get no benefit**; office perks feel unfair (employee, HR) | Perks tied to the office or pantry | **Location-agnostic allowance:** same perk usable at partner cafés near home; **send-a-coffee** to remote teammates; allowance can accrue only on office days if the company prefers. |
| 8 | **Unused allowances and wasted catering** due to unpredictable attendance (company) | Fixed schedules and headcounts | Orders and recurring runs **auto-adjust to desk bookings and calendar RSVPs** until cutoff; unused budget can roll into a team pot. |
| 9 | **Platform fees and markups eat the stipend** (employee, company) | Per-order fees, inflated menu prices | **Menu price parity guarantee** (café's in-store price); the company pays a flat SaaS fee instead of per-order fees. |
| 10 | **Expense reports for coffee** (employee, finance) | Receipts in personal email | **Zero-receipt flow:** company-paid portion billed directly; personal portion auto-receipted; client-meeting orders auto-tagged with calendar attendees for compliance. |
| 11 | **Perk tax treatment is confusing** (finance). Example: from 2026 the US removed the deduction for most employer-provided on-premises food and drink (verify with a tax advisor) | Apps ignore tax | **Tax-aware perk types** per country (on-site provision vs cash-like stipend vs meeting/client expense), with reports finance can hand to accountants. Must be validated per jurisdiction. |
| 12 | **Allergies get lost in group orders** (employee, café) | Runner types the order; allergy info isn't passed on | Saved allergen profile **auto-attached** to every group order line, printed on the label, and acknowledged by the café. |
| 13 | **Item out of stock after ordering** (employee, café) | Stale menus; phone calls or cancellations | **Live stock sync** from POS, plus **pre-set substitution rule** per person (e.g., "no oat → soy, else refund"). |
| 14 | **Unclaimed orders and no-shows** (café) | Café eats the loss | Always prepaid; after X min the owner is pinged; after Y min the café can **release it** (and still keep the payment). |
| 15 | **B2B invoices hurt café cash flow** (net-30 terms) | Small cafés wait for corporate payment | **Instant/next-day payout to the café**; the platform carries the company receivable. |
| 16 | **Courier stuck in the lobby** (courier, employee) | No building-access integration | **Auto visitor pass** (Envoy/building system) or a defined lobby handoff point with a ping to the runner. |
| 17 | **Ordering while already in line causes duplicates** (café) | No context awareness | If the app detects you're inside the café (opt-in), it warns before submitting a duplicate. |
| 18 | **Bad order, slow fix** (employee) | Support tickets; refunds take days | **One-tap remake / instant credit** for flagged drinks; café quality score visible to the café only, for coaching. |

### Top 5 to build first (highest pain, most defensible)
1. Pre-authorized group payment (#4): kills the biggest social friction.
2. Hard café slot capacity + off-peak incentive (#2): wins café buy-in.
3. Scan-to-verify cup codes (#3): visible quality win from day one.
4. Fire-on-approach timing (#1): solves cold coffee, a clear differentiator.
5. Location-agnostic allowance for hybrid/remote staff (#7): easiest sell to HR.

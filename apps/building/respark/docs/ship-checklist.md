# Revive AI: 14-Day Ship Checklist

Audited: `sales-playbook.md`, `demo.html` (plus `first-week.md`, `prospects.csv` for context).
Scope: what's missing to actually deliver on the offer, and how to ship a *testable* version in 14 days with $0 and evenings only.

> **This is a ship checklist, not a business plan.** It tells you what to build, buy, and do to make the offer real and measurable. It does not cover legal entity setup, bookkeeping, tax, or scaling. If this becomes real, get a lawyer for the marketing-consent and contract pieces.

The one-sentence offer (from `sales-playbook.md` §0):

> "We help local businesses bring back past customers with automated, personalized email + SMS — usually 8-15% reactivation rate within 30 days. $497 setup, $97/mo."

---

## 1. Demo + playbook audit

### 1a. What `demo.html` actually demonstrates

It is a **frontend-only mock**. It demonstrates *what the messages look like*, not a working product.

- 7 pre-written campaigns (plumber, dentist, trainer, salon, mechanic, realtor, restaurant), each 3 emails + 2 SMS over 30 days. Stored as a hardcoded JS object, `CAMPAIGNS` (lines 441-553).
- The "generate" button fakes AI: it shows a spinner for 1,400 ms then renders the pre-written copy (lines 598-620). No model, no API, no backend.
- Personalization is cosmetic: `{{bizname}}` is replaced with the typed business name, but `{{first_name}}` is hardcoded to "there" and `{{agent_name}}` to "your agent" (lines 570-575). It never touches real customer data.
- There is no sending, no list upload, no tracking, no unsubscribe, no reporting. Nothing actually goes to anyone.

What it *is* good at: a strong sales prop. The copy is specific, the layout is clean, and "click your industry, see your campaign" is a good demo motion for a 15-minute call. Keep it as the sales artifact. Do not treat it as the product.

**Accuracy gap (fix before it's shown to real prospects):** the FAQ answers "We follow CAN-SPAM and TCPA rules" (line 407). Those are **US** laws. If any prospect is in Taiwan (or if you are), that line is wrong and a sharp owner will catch it. Make it jurisdiction-aware, or say "we follow the rules that apply where you are."

### 1b. What the sales playbook covers well

`sales-playbook.md` is the strongest asset here. It has:

- A one-sentence offer that leads with the number (§0).
- Clear targeting with qualifying signals and a Top 5 industry list (§1).
- Three cold email templates, three DM templates, and explicit sending rules (§3, §4).
- A full 15-minute call script: opening, discovery questions, pitch, close, follow-up (§5).
- Six objection handlers (§6).
- A three-tier pricing table plus a price-defense line (§7).
- A post-close delivery outline (§8) and a tracking schema (`prospects.csv`) (§10).

The gap is not in *selling*. It's in *delivering*. The playbook repeatedly points at systems that don't exist yet: "pull it from your booking/POS/CRM" (§1, §5, FAQ in `demo.html` line 403), "I handle everything" (§6), "report weekly" (§8). None of that has a tool behind it.

### 1c. Critical gaps to actually deliver on the offer

| # | Gap | Where it's promised | Status |
|---|-----|--------------------|--------|
| 1 | **No email sending tool.** Nothing sends the emails. | `demo.html` "email + SMS channels"; playbook §6 | Missing. Need Mailchimp / Resend / SendGrid. |
| 2 | **No SMS sending tool.** Nothing sends the SMS. | offer line; `demo.html` SMS cards | Missing. Need Twilio (or cheaper), with Taiwan compliance. |
| 3 | **No consent/compliance layer.** The entire offer depends on lawfully using past customers' numbers for marketing. | implied everywhere; FAQ "Is this spam?" (line 406) | Missing, and it's the biggest legal risk. See §6. |
| 4 | **No payment processing.** No way to collect $497 or the $97/mo. | §7 pricing, §8 "send the contract" | Missing. Bank transfer/PayPal first, Stripe later. |
| 5 | **No client onboarding/data intake.** "Ask for the CSV" is the whole plan. | §8 step 1; `demo.html` line 403 | Manual only. Fine to start, but you have no template, validation, or field mapping. |
| 6 | **No "data pull from POS/CRM/booking."** Promised, not built. | `demo.html` line 403; §1 signal #5 | Manual CSV export only. Do not over-promise an integration. |
| 7 | **No measurement of the 8-15% claim.** The number is stated, not earned. | §0, §5 pitch, `demo.html` FAQ (line 399) | Unsubstantiated. It becomes real only after you run an actual campaign and count returns. |
| 8 | **No market fit between the offer and you.** The offer is written for a US/English market (Yelp, "Google reviews," CAN-SPAM/TCPA, plumbers/HVAC, USD pricing), but you're a Taiwan-based seller. | throughout both files | This is a *decision*, not a bug. Decide on Day 1 (see §3). |
| 9 | **No contract / engagement terms.** | §8 "send the contract" | Missing. One page: scope, who owns the list, opt-out handling, cancel-anytime. |

### 1d. Tools / services needed (with researched specifics)

**Email** (send the 3 emails per campaign):
- **Resend** (free to start). Free = 3,000 emails/mo, capped at 100/day. $20/mo for 50,000. For a small list of a few hundred customers, the free tier covers a campaign. https://resend.com/pricing
- **Mailchimp** (easier for non-technical, has a visual editor + templates + A/B). Free = 250 contacts / 500 sends. Essentials from ~$13. At your list sizes Mailchimp's contact-based plans can get pricey fast, so it's better once you have several paying clients. https://mailchimp.com/pricing
- **SendGrid** (cheaper at volume, no free plan now). 60-day trial at 100/day, then $19.95 for 50K. A good second choice.

Pick **one** to start. For $0 and a solo operator, **Resend free** (transactional) is the cleanest; move to a marketing tool once you have 3+ clients and need templates/A/B.

**SMS** (send the 2 SMS per campaign):
- **Twilio.** Outbound SMS to **Taiwan = $0.0842 per message** (as of Oct 2026), plus a number rental from ~$1.15/mo. https://www.twilio.com/en-us/sms/pricing/tw
  - **Taiwan has hard delivery rules** (https://www.twilio.com/en-us/guidelines/tw/sms): brand name must lead the message body; **no shortened URLs**; marketing SMS is **prohibited 21:00-09:00 and 12:30-13:30**; HELP/STOP must work in the local language; get opt-in first.
  - **Cheaper alternatives exist** (e.g. Telnyx lists ~$0.004/msg to TW on third-party comparisons), but you must verify deliverability and the same compliance rules apply. At your volumes the price difference is the whole profit, so test before committing.

**Payment:**
- First 2-3 clients: **bank transfer or PayPal** against a one-page invoice. $0 to set up.
- Once recurring: **Stripe** (~2.9% + 30¢) for card payments and $97/mo subscriptions.

**Client data / "CRM":**
- A **Google Sheet** is the CRM for the first 3 clients. Columns: name, email, phone, last-service-date, consent-yes/no, opted-out, status (contacted / returned / no-response), revenue. This is also where you prove or disprove the 8-15%.

**Landing page / booking:**
- `demo.html` is the page. Deploy it free (GitHub Pages, Netlify, Vercel). Swap the `juw@yourdomain.com` mailto (line 426) for your real address, add a LINE/phone contact, and put a booking link.

---

## 2. Minimum viable product (MVP) scope

### 2a. Can this be delivered manually first? **Yes. Do that.**

The offer sells a *result* (customers come back), not software. You do not need an app to deliver the result. The entire "system" for a first client is:

1. A **Google Sheet** holding the client's past-customer list (with consent).
2. **Resend/Mailchimp** to send the 3 emails on a schedule.
3. **Twilio** (or a phone/SMS service) to send the 2 SMS.
4. A **LINE account** where the customer can text back "YES / NO" (in Taiwan, LINE is how people actually reply, not SMS).
5. You, watching responses and logging who rebooked, in the same Sheet.

That is a **service**, not a SaaS. It's slower and less "automated," but it lets you *validate the offer before you build anything*, which is the whole point of 14 days. The word "automated" in the pitch is the end state, not the start. Sell the outcome now, automate the boring parts once 3 clients prove demand.

### 2b. Absolute minimum to fulfill the promise

| Component | Minimum version | Effort (evenings) |
|-----------|----------------|-------------------|
| Customer list + consent | Google Sheet, one tab per client, consent column filled in | 1 hr |
| Email sending | Resend free, 3 scheduled messages from a simple template | 2-3 hr setup, 30 min per client |
| SMS sending | Twilio number + 2 messages, brand-name prefix, no short URLs | 2-3 hr setup (number + compliance) |
| Replies / opt-out | Personal LINE (or Twilio inbound), honor STOP immediately | 1 hr |
| Reporting | Same Sheet: counted returns + revenue; a 5-line summary to the client | 30 min |
| Payment | Invoice + bank transfer / PayPal | 30 min |

Rough total to be *operational*: about 10-12 hours of evening work, spread over Days 3-5. None of it is code.

### 2c. What's $0 vs what costs money

**$0 to start:**
- Google Sheet (list/CRM/reporting).
- Resend free tier (3,000 emails/mo) for most single-client campaigns.
- Deploying `demo.html` on GitHub Pages / Netlify / Vercel.
- Gmail as your sending identity + a personal LINE for replies.
- Invoice by hand, payment by bank transfer / PayPal.

**Costs money (and how much, per client, per 30-day campaign):**
- **SMS is the real cost.** Twilio to TW = $0.0842/msg. Model the offer as 2 SMS per customer.
  - 300 customers → 600 SMS → ~**$50.50**. Fee $97 → margin ~$46.
  - 580 customers → 1,160 SMS → ~**$97.50**. **This is your break-even: above ~580 customers, Twilio SMS alone eats the whole monthly fee.**
  - 1,000 customers → 2,000 SMS → ~**$168**. **Negative margin** on Twilio.
  - Consequences: (a) keep each client's SMS list to the ~500 most-valued lapsed customers, not everyone; (b) make **email the primary channel** (cheap) and SMS the short, high-intent nudge; (c) or use a cheaper SMS provider (Telnyx-class ~$0.004/msg makes 1,000 customers cost ~$8) **after** you verify it delivers to TW carriers.
- Number rental: ~$1.15/mo (Twilio) or a local line.
- Payment: Stripe fees only when you take cards.

**The honest constraint:** the $97/mo works at Twilio rates only for *small* lists per client. That's fine for validation. It breaks the model at scale, which is a pricing/product decision for later, not for the 14 days.

---

## 3. 14-day ship checklist (day-by-day)

Time budget: ~2-3 hrs on weeknights 18:00-23:00, ~3-4 hrs over the weekend. Adjust if you have less.

> **Day-1 decision that everything else depends on:** which market are you selling into?
> - **(A) Keep the US/English offer as written.** You sell remotely to English-speaking local businesses (the playbook's current target). Delivery is async, data comes as a CSV export, trust is harder to build, and you'd be dealing with *US* rules (A2P 10DLC registration, US numbers). The playbook works mostly as-is.
> - **(B) Pivot to the Taiwan market.** Rewrite the pitch into Chinese, switch the primary channel to **LINE** (not email/SMS), reprice in TWD, and comply with the **PDA** (see §6). The playbook's *structure* carries over; its templates, channels, and legal references do not.
>
> You can't do both well in 14 days. My recommendation: **decide the market now, but validate the delivery on a real local business you can reach (a salon or trainer you actually know), in whatever language, to get one true reactivation number.** That proof point makes the offer credible in either market. The 14-day plan below assumes you run a **manual pilot first** (the de-risking move) and then do sales outreach.

### Days 1-2: Finalize niche + offer
- **Pick ONE industry from the playbook's Top 5** (§1) to lead with. Recommendation:
  - **Primary target: Hair salon / spa** (rank 3). Large repeat-customer base, low-sensitivity data (not health/medical), owner is reachable on Instagram, and `demo.html` already has a strong salon campaign.
  - **Easiest free pilot: Personal trainer** (rank 4). Tiny list, but the *owner is the trainer*, high trust, high per-customer value, and the easiest "let me do it for you this month, free" yes.
  - **Avoid dentists for the pilot** (rank 2) despite the great "you're due for a cleaning" angle: dental/treatment data is **sensitive (medical) data under PDA §6**, the strictest category. Good for later, risky first.
- Rewrite the offer line to match your chosen market (USD/US, or TWD/TW + LINE). One sentence. Write down the **promise, the price, and the proof you'll get** (e.g. "I'll re-engage your lapsed clients and report how many come back").
- Define the **pilot terms** in writing: 1 client, 30 days, free or flat ~$200, you handle everything, they give you a list of lapsed customers *with consent*, you report reactivation % + revenue.
- Set up the sending identities: Gmail address (not a bare `you@gmail.com`), a working LINE, deploy `demo.html` to a free host and fix the mailto + add your LINE/phone + the compliance line (§1a).

**Done =** one industry chosen, one-sentence offer for your market, a 3-line pilot one-pager, live demo URL.

### Days 3-5: Set up the manual service
- **Email:** create Resend (free) or Mailchimp (free) account; verify a sending domain/address; draft the 3-message template from `demo.html` for your chosen industry.
- **SMS:** create the Twilio account; buy the number; confirm you can send a test SMS to a +886 number; add the **brand-name prefix**, confirm **no short URLs**, note the **send windows** (not 21:00-09:00, not 12:30-13:30). If Twilio is too expensive for your target list size, test a cheaper provider on a handful of numbers first.
- **Data/CRM:** build the Google Sheet (columns in §2c). Make a **consent checkbox the first column**. You do not proceed on anyone without it (see §6).
- **Reply channel:** confirm your LINE (or Twilio inbound) can receive and that you'll honor STOP/NO within 24h.
- **Payment:** write the one-page invoice template; note bank/PayPal details.

**Done =** you can, end-to-end, take a consented list, send 3 emails + 2 SMS, receive a reply, and log the outcome, for under $50 in fees.

### Days 6-8: First client deliverable as a one-off (pilot)
- **Get the pilot client.** Your network first: a salon or trainer you know. Offer the free/cheap 30-day pilot in writing. Ask for a list of **300-500 lapsed customers, all with explicit consent** (they asked the customer, or it was captured with a marketing opt-in at the time).
- Run the **manual campaign** exactly as the `demo.html` sequence: email (Day 1), SMS (Day 5), email (Day 12), SMS (Day 21), email (Day 30). Send only inside legal windows.
- **Track every response** in the Sheet: who opened, who replied, who rebooked, revenue. This produces your **real reactivation number**.
- Do **not** scale to more clients this week. One client, done well, is the asset.

**Done =** one live campaign sent, responses logged, a draft "here's what happened" report.

### Days 9-11: Document the process, find what to automate
- Write the **runbook** (half a page): how you intake a list, confirm consent, schedule sends, monitor replies, produce the report. If you can't write it down, it's not a process yet.
- Time-box each step. Mark the **3 most painful/repetitive** steps (likely: importing lists, scheduling, counting returns). Those are your *future* automation targets, not this month's.
- Turn the pilot into a **case study** you can show: "X lapsed customers contacted, Y came back, ~$Z revenue, in 30 days." Even one honest number beats the unsubstantiated "8-15%."
- Update `demo.html` + the playbook's numbers to your **real** result (flag that it's n=1).

**Done =** a half-page runbook, a named top-3 automation list, a 1-line real result.

### Days 12-14: Landing page + first sales outreach, book 3 discovery calls
- **Landing page:** `demo.html` is live, with your real contact, LINE, booking link, the corrected compliance line, and the real (n=1) result if you have it.
- **Outreach:** follow `first-week.md` + the playbook's templates, but **adapt them to your market** (this is adapting, not rewriting the playbook's structure). If market B (Taiwan), lead with LINE and Chinese, not cold email + Yelp.
- Goal: **3 discovery calls booked.** Use the scripts in §4.
- Send to a realistic list (the `prospects.csv` you have is 8 sample rows; you need ~30-50 real ones in your actual market).

**Done =** live page, 20+ real prospects logged, **3 discovery calls booked.**

### 14-day go/no-go (what "traction" means)
You shipped if **at least one** is true:
- 3 discovery calls booked, **or**
- 1 paying client (even the pilot at $200), **or**
- 1 real reactivation number you can cite.

If **none** of those is true by Day 14, stop and diagnose (see §6, "when to pause"). Do not pour 4 more weeks into a silent funnel.

---

## 4. First 5 sales-call scripts

These **complement** the playbook's 15-minute script (§5); they don't replace it. Use the playbook for the core structure, and these for the specific moments. Keep each to 15 minutes. Phone or LINE call, not email.

### Script 1: The standard 15-minute discovery call
- **Opener (20s):** "Hey [name], thanks for the time, I'll keep it short. Two quick questions: what do you do today to bring back past customers, and roughly how many past customers do you have on file?"
- **Qualify (listen, don't pitch):**
  1. "How many past customers haven't come back in 6+ months?"
  2. "What happens when someone goes quiet, do you have anything that re-reaches them?"
  3. "When one does come back, what's a typical visit worth to you?"
  4. "Are you doing any email or LINE/SMS outreach at all right now?"
- **Bridge:** "Okay, so you've got [N] people who used to come in and nothing's reaching them. That's exactly the hole I fill."
- **Close:** "I can run this for you for 30 days. You give me the lapsed list, I send a short email + SMS sequence, and I report how many come back. Free trial, or a $497 setup if you want it locked in this week. Which feels right?"

### Script 2: The cold phone call (they don't know you)
- **Opener:** "Hi [name], it's Juw. I'm not selling you something you didn't ask for, I promise I'll take 60 seconds. I work with [industry] to win back the customers who stopped coming. Can I ask how you're handling that today?"
- **Qualify:** if they have a system, thank them and ask what it's missing. If they don't (most won't), say: "That's the usual answer, which is why I'm calling."
- **Objection (likely "just send me info"):** "Happy to. What's the one thing that'd make it worth your time if I sent it? A sample of what I'd send your customers, or a number on how many people typically come back?"
- **Close:** "Let's do this, I'll send a 20-second sample tailored to [business] to your LINE, and we talk 10 minutes this week. [Day] or [Day]?"

### Script 3: The "send me info" follow-up (they went quiet)
- **Opener:** "Hi [name], following up on the sample I sent for [business]. Did it land? I know these get buried."
- **Qualify:** "Quick check so I don't waste your time, is it that you don't have the time, or that you're not sure it'd work for [industry]?"
- **Objection handler:**
  - "Not sure it works here" → "Fair. Let me show you the [industry] sample right now, 2 minutes." (pull up `demo.html`, their industry)
  - "No time" → "That's the point, after I set it up you do nothing. It runs on its own."
- **Close (low-friction):** "Let me take the risk off you. 30 days, if fewer than 5% of your lapsed customers come back, you pay nothing for setup. Sound reasonable?"

### Script 4: The price-objection rescue
- **Trigger:** "That's a bit much" / "can't do $497."
- **Anchor to their number:** "If this brings back just 5 customers in the first month, what's each of those worth to you? [wait] So one good month pays for the setup several times over."
- **Reframe:** "Think of it as hiring me for 30 minutes this week to set something up that runs for the next year. It's the cheapest labor you'll hire."
- **If it's truly budget:** "I can split the setup, $250 now and $247 next month. I won't go lower, because if I did that'd mean I don't believe in it. What about that?"
- **Do not:** race to a discount. A price drop here reads as a low-confidence signal.

### Script 5: The pilot / free-trial close (your main weapon in week 1)
- **Opener:** "Let me make this zero-risk. I'll run it for you free for 30 days. You hand me a list of, say, 300 customers you've lost touch with, I send the sequence, and at the end I show you exactly how many came back and what that was worth."
- **Qualify (the only thing you need):** "Can you get me a list of ~300 past customers who haven't come in for 6+ months? And can I confirm they're okay to hear from you?"
- **Objection:** "Who has to approve sending to my customers?" → "That's on you, not me. I only send to people you've confirmed it's fine for. If anyone says stop, they're off. I'll show you how." (This is your PDA answer, §6.)
- **Close:** "Okay, let's start this week. I'll send you a 3-line agreement and the list template now. Kickoff 20 minutes on [day]?"

**Cross-cutting rules (from the playbook, keep them):** after every call send a follow-up within the hour (demo link + one-paragraph summary + clear next step); log every call in `prospects.csv`; "send me info" always becomes a specific follow-up day, never "ok."

---

## 5. Pricing validation

**Is $497 setup + $97/mo realistic for a Taiwan-based seller? Depends on which market.**

**Currency frame (assume ~31 TWD/USD):**
- $497 ≈ **NT$15,400** one-time. $97/mo ≈ **NT$3,000/mo**.
- For a **US/English client** (market A), $497 + $97/mo is a *normal-to-low* SMB marketing price. Competitors (win-back email/SMS platforms like Klaviyo/Attentive/Postscript, or a freelance marketer) run $100-500/mo. You're under-priced, which is good for winning a first client but **hurts your margin** once SMS costs land (see below).
- For a **Taiwan client** (market B), NT$15,400 + NT$3,000/mo is **on the high end** for a small salon/restaurant, but reasonable for a dentist, clinic, or established shop. A local 行銷代理 doing email/LINE typically bills NT$10,000-50,000/mo, so you'd actually be competitive. **Reprice in TWD** if you go market B; don't charge a Taiwan salon in US dollars.

**The margin problem (the number that matters):**
- At Twilio's **$0.0842/msg to TW**, with 2 SMS per customer, SMS cost ≈ **$0.168 per customer per campaign**.
- The $97/mo fee is fully consumed by SMS at **~580 customers** per client. Above that, **negative margin**. (A cheaper provider like Telnyx-class, ~$0.004/msg, drops that to ~$0.008/customer and removes the ceiling, but verify TW delivery first.)
- Email is near-free at these volumes (Resend free tier = 3,000/mo).

**Recommendations:**
1. For the first 3 clients, **size each SMS list to ~300-500** (the lapsed-but-valuable segment, not everyone). Keeps margin positive on Twilio.
2. Make **email the primary channel** (cheap) and SMS the short nudge. That's also the better customer experience.
3. **Reprice in TWD for market B**, and consider a per-list-size component if a client wants to blast 2,000+ numbers.
4. The **free 30-day trial** in Script 5 is your real de-risking tool for a $0-capital start, not the $497. Use it to get the number, then sell the setup fee on proof.

**Benchmark summary:**

| Market | Setup | Monthly | Notes |
|--------|-------|---------|-------|
| US/English (A) | $497 (≈NT$15.4k) | $97 (≈NT$3k) | Under-market, wins easily, thin SMS margin on Twilio |
| Taiwan (B) | ~NT$10-15k | ~NT$2-5k | Competitive vs agencies; reprice in TWD; lead with LINE |

---

## 6. Risk flags

### 6a. Taiwan SMS/email marketing compliance (the big one)

This is the single biggest risk and it's *specific to being in Taiwan*. **Get legal review before you run a real campaign.** The core issue: **having a customer's number from a past service does not automatically let you market to them.**

- **PDA (個人資料保護法) §20** (https://law.moj.gov.tw/LawClass/LawSingle.aspx?FLNO=20&Pcode=I0050021): a business using personal data for marketing must stop immediately if the person refuses, and on the **first** marketing contact must provide a **free, easy way to refuse** and bear that cost. (Full law: https://law.moj.gov.tw/LawClass/LawContent.aspx?PCODE=I0050021)
- **The exact scenario of this offer was ruled on.** A restaurant that collected a phone number for *booking* then sent a *marketing* SMS later was told by the 個資會籌備處 that the marketing use needs **separate, explicit consent**, because it's a different purpose from the booking. (CNA, 2025-05-19: https://www.cna.com.tw/news/aipl/202505190111.aspx). Your "reactive past customers" pitch is literally this case. **You must have a documented marketing opt-in for each number, or the business must have collected consent for marketing at the time.**
- **Use "beyond the original purpose" (特定目的外之利用) needs a lawful basis** (PDA §20 §1), and the 法務部 line is that marketing to contract customers is only okay if it's within their *reasonable expectation* and properly related to the original purpose. A reactivation offer for the *same* service can argue reasonable expectation; a broader cross-sell cannot. (法務部 102.07.05 法律字第10203507340號函: https://laws.gov.taipei/Law/Interpretation/Content/FE260085)
- **拒絕商業行銷指引** (2023-06-13, 國發會/PDPC): on first marketing you must state your name and give a free, fast refusal channel (toll-free SMS/phone, email, website); respect refusals at any time; **record and consolidate** refusals; and if you **commission a third party** (i.e., you, on behalf of the client) to do the marketing, the client must supervise you via contract. (https://www.pdpc.gov.tw/News_Content/27/194/ and https://laws.gov.taipei/law/Interpretation/ContentExport/FE400153?type=5)
- **Cross-border data transfer (PDA §21):** sending the customer list to a foreign SMS/email provider (Twilio) is an "international transfer" of personal data. Keep this minimal, tell the data subject, and prefer providers/flows that reduce exposure. This is a reason to consider a **local TW SMS/LINE provider** for market B.
- **Delivery rules that aren't optional (Twilio/TW):** brand name must lead the message; **no short URLs** (register full URLs); marketing SMS banned 21:00-09:00 and 12:30-13:30; HELP/STOP in the local language; opt-in required. (https://www.twilio.com/en-us/guidelines/tw/sms)
- **Sensitive data:** dental/medical records are a special category (PDA §6). This is why I'd **not** pilot with dentists.

**Practical minimums so you're not exposed:**
1. Only send to numbers with a **documented marketing opt-in**. Make the client confirm this in writing (one line in the agreement: "Client represents it has lawful consent to contact these customers for marketing").
2. Every message has a **free opt-out** (reply STOP / a one-tap unsubscribe), and you **stop within 24h** and record it.
3. **Brand name leads** every SMS; no short URLs; send inside the allowed windows.
4. A **one-page data handling note**: whose data, where it's stored (the Sheet), who can see it, when it's deleted.
5. **Get a lawyer to read the agreement + the consent flow** before the first real send. Do not treat this checklist as legal advice.

### 6b. Common objections from local business owners

The playbook covers six (§6). The ones that will actually come up, added:
- **"Why email/SMS? Everyone uses LINE here."** (market B killer objection.) Answer: for a TW client, lead with LINE. For a US client this objection won't arise. If you can't answer it well, you picked the wrong market.
- **"How do I know my customers' consent is fine / won't I get in trouble?"** This is your PDA answer above. Being able to explain it calmly is a *selling* point, not a liability.
- **"I already have [Mailchimp / a marketing guy]."** "Great, what's the reactivation number? Most tools sit empty because running them is the job. I run it and report the number."
- **"Show me proof."** You have it after the pilot. Until then, be honest: "I'm running a 30-day pilot and I'll show you the real number, no guarantees." (Never restate an unearned 8-15% as fact.)
- **"It's too expensive."** Script 4.
- **"Send me info."** Script 3 (always convert to a date).

### 6c. When this is worth pausing

Stop, don't push through, if by **Day 14** you have **zero** of: 3 booked calls, 1 paying (or paid-pilot) client, or 1 real reactivation number. Specifically pause and reassess when:
- You **can't get a single pilot client** from your own network. If the people you know won't even let you run a free 30-day test, the offer as stated isn't resonating, and 50 cold emails won't fix that. Diagnose the offer (market? price? channel?), not the volume.
- **No consent exists** for any list you've been given. If every "customer list" you're offered is actually "numbers we grabbed from receipts," you can't legally send, and the whole model stalls. That's a stop-and-pivot signal toward a channel/consent you can actually source.
- **SMS unit economics are negative** for the list sizes you're being given on your chosen provider. Then reprice, switch providers, or make email-primary before spending another week.
- **You'd have to over-promise** (a "guaranteed 8-15%," an integration you can't deliver, or "fully automated") to get a yes. If the yes only comes from a lie, it's a no.

If you paused, the highest-value next step is almost always the **market decision from Day 1** (A vs B) and a **real consent source**, not more outreach.

---

## Appendix: what to fix in the existing files (no rewrites, just flag)

These are *edits to make real*, not playbook rewrites:
- `demo.html` line 407: "CAN-SPAM and TCPA" is US-only. Make jurisdiction-aware or generic.
- `demo.html` line 426: `juw@yourdomain.com` → real address; add a LINE/phone + booking link.
- `demo.html` line 399 / playbook §0: "8-15%" is unproven. Mark it as a target, then replace with your n=1 real number after the pilot.
- `prospects.csv`: 8 sample rows, US-style. Build a real list of ~30-50 in your chosen market, with a **consent** column added.
- Playbook §8 "send the contract": the contract doesn't exist yet. Write the one-pager in Day 1-2 (scope, list ownership, consent representation, opt-out handling, cancel-anytime).

---

### Sources
- PDA §20: https://law.moj.gov.tw/LawClass/LawSingle.aspx?FLNO=20&Pcode=I0050021 · full law: https://law.moj.gov.tw/LawClass/LawContent.aspx?PCODE=I0050021
- Restaurant-booking-then-marketing SMS ruling (個資會籌備處, via CNA 2025-05-19): https://www.cna.com.tw/news/aipl/202505190111.aspx
- 拒絕商業行銷指引 (PDPC / 國發會, 2023-06-13): https://www.pdpc.gov.tw/News_Content/27/194/ · 個資籌法字第1150002320號函: https://laws.gov.taipei/law/Interpretation/ContentExport/FE400153?type=5 · 法務部 102.07.05 函: https://laws.gov.taipei/Law/Interpretation/Content/FE260085
- Twilio SMS to Taiwan pricing ($0.0842/msg, Oct 2026): https://www.twilio.com/en-us/sms/pricing/tw
- Twilio Taiwan SMS delivery/compliance guidelines: https://www.twilio.com/en-us/guidelines/tw/sms
- Resend pricing (free 3,000/mo): https://resend.com/pricing
- Mailchimp pricing (free 250 contacts / 500 sends): https://mailchimp.com/pricing

# Sample 2: Small-Business Workflow Audit

> **Portfolio sample.** "Northstar Marketing" is a **fictional** client. All findings, numbers, and recommendations below are synthetic and for demonstration only. There is no real company and no real data behind this document.

## What this demonstrates
A structured workflow audit. I took a small business running 12 disconnected tools, found the manual handoffs where time and revenue leak, and recommended three automations ranked by ROI and effort. It shows:

- Diagnostic thinking (mapping tools to the actual work they are supposed to do)
- The ability to prioritize, not just list, automations
- A practical build sequence a founder can act on next week
- A clear before/after picture of the workflow change

## Who it's for
- Small agencies and service businesses juggling many tools with few people
- Founders who suspect they are overpaying for software and underusing it
- Operations leads who want a concrete, prioritized automation roadmap

## What this would cost on Contra / Upwork
- **Suggested price: $1,500 to $3,500** for a full audit of a 5-person business (about a week of part-time analysis, a 30-minute scoping call, and a written recommendation set like this).
- Ongoing: building the three automations typically runs $2,000 to $5,000 across the first month, plus a small monthly maintenance fee.

---

# Workflow Audit: Northstar Marketing

## Client snapshot
- **Northstar Marketing** (fictional), a 5-person marketing agency
- **Stack:** 12 SaaS tools, none connected to each other
- **Core problem:** Work moves between tools by hand. People copy leads, rewrite the same post for each channel, and rebuild client reports from scratch every month.

## What I found
The tools are not the problem. The gaps between them are. Every time a piece of work crosses from one tool to another, a person does it by hand. That is where the hours go, and where leads get dropped.

Three handoffs stand out:

1. **A new lead lands in one place, gets entered into the CRM by hand, then a welcome email is written from scratch.**
2. **Each blog post is rewritten for every social channel by hand, usually late.**
3. **Client reports are rebuilt from three dashboards every month, by hand.**

## The 3 recommended automations

### Automation #1: Lead capture to CRM to email nurture
**Stack:** Zapier + an LLM for the personalized first email.

- **What it does:** When a lead submits a form, it is pushed straight into the CRM. The LLM drafts a short, personalized welcome email from the lead's details and sends it within minutes.
- **Effort:** Low. About 1 day to build and test.
- **Expected ROI:** High and fast. Leads get touched within minutes instead of a day or two, which reliably lifts reply and close rates. This one pays for itself quickly.
- **Build first.** It is the smallest, the fastest to value, and it builds the trust you will need for the other two.

### Automation #2: Blog post to social distribution
**Stack:** Make (Integromat) + the Claude API.

- **What it does:** When a blog post is published, the API turns it into a LinkedIn post, a few X posts, and a short email blurb, in the agency's voice. A human approves, then it posts on a schedule.
- **Effort:** Medium. About 2 to 3 days, including a tone pass and a human-approval step.
- **Expected ROI:** High. One post becomes a week of content. It frees the team from the "rewriting for each channel" grind and keeps the calendar full.
- **Build second.** It needs a tone template, which the first automation's work helps you lock down.

### Automation #3: Client reporting
**Stack:** n8n + an LLM.

- **What it does:** Pulls metrics from the dashboards on a schedule, and the LLM writes a plain-English summary with the numbers, the one thing that changed, and the suggested next action. It is sent to the client automatically.
- **Effort:** Medium-high. About 3 to 4 days, mostly mapping the data sources.
- **Expected ROI:** Medium-high. Saves several hours per client per month and makes reports feel like thinking, not spreadsheet work. It also reduces churn because the reports feel more personal.
- **Build third.** It is the most setup-heavy, but it compounds across every client.

## Build sequence
1. **Week 1:** Automation #1 (lead capture). Smallest, fastest to value, builds trust.
2. **Week 2:** Automation #2 (blog to social). Reuses the tone template from #1.
3. **Week 3:** Automation #3 (client reporting). Most setup, highest compounding return.

## Before vs after

```
BEFORE: every handoff is a person

  [Web form]  -->  (copy by hand)  -->  [CRM]  -->  (write by hand)  -->  [Welcome email]

  [Blog post]  -->  (rewrite by hand)  -->  [LinkedIn]
            \-->  (rewrite by hand)  -->  [X]
            \-->  (rewrite by hand)  -->  [Email blurb]

  [3 dashboards]  -->  (copy numbers + write story)  -->  [Client report]


AFTER: handoffs are automated, a human only approves

  [Web form]  -->  Zapier  -->  [CRM]
              \-->  LLM  -->  [Approve]  -->  [Welcome email]

  [Blog post]  -->  Make  -->  Claude API  -->  [Approve]  -->  [LinkedIn] / [X] / [Email]

  [Dashboards]  -->  n8n  -->  LLM  -->  [Approve]  -->  [Client report]
```

## Recommended next step: book a 30-min scoping call
The recommendations above are directional. A 30-minute call lets me confirm the exact tools in use, agree on the build order, and quote a fixed price for the first automation. No commitment required. If the first automation does not pay for itself, you can stop there.

---

## How I built this (sidebar)
- **AI tools:** I used a large language model to draft the initial findings, to write the automation descriptions, and to sanity-check the effort and ROI estimates.
- **Human review:** I mapped every claim to a real tool's actual capabilities, corrected the ROI to realistic (not hype) ranges, and set the build sequence. The diagram and the prioritization are mine, not the model's.
- **Time:** Roughly half a day of part-time analysis plus the scoping call.

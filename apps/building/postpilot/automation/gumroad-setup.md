# Gumroad Product Setup — Copy-Paste Ready

Open this file and the Gumroad tab side by side. For each product below, copy the [TITLE] into the product name field, the [DESCRIPTION] into the description field, set the [PRICE], and you're done.

Total time: 8 minutes for all 3 products.

---

## Product 1 — Starter ($49/mo founder pricing, $99/mo after first 5 clients)

**Title:**
```
PostPilot Starter — 3 on-brand LinkedIn posts every week
```

**Description:**
```
3 on-brand LinkedIn posts every week. You just hit publish.

For B2B coaches and consultants who'd rather coach than write.

What you get:
- Voice training on 5-10 of your past posts (one-time, 10 minutes)
- 3 ready-to-post drafts delivered every Monday at 9am
- Unlimited revisions in your first month to dial in the voice
- Cancel anytime — no contract, no forms

First month free if you don't love it. No credit card required for the founder offer (first 5 clients get 50% off).

The first posts land next Monday after you onboard.
```

**Price:** $49/mo (regular $99/mo after founder slots fill)

**Cover image:** Use the orange logo from your landing page, OR a simple text image with "PostPilot Starter" on it. Canva has free templates that work.

**What you'll need:**
- A thumbnail (optional but recommended) — see instructions below
- Stripe Connect for payouts (Gumroad walks you through this)

---

## Product 2 — Growth ($99/mo founder pricing, $199/mo after first 5 clients)

**Title:**
```
PostPilot Growth — 5 LinkedIn posts/week + engagement replies
```

**Description:**
```
5 on-brand LinkedIn posts every week + 5 weekly engagement replies on relevant posts in your niche. The presence of a full-time ghostwriter, the cost of a Netflix subscription.

For B2B coaches and consultants who want presence plus conversations.

Everything in Starter, plus:
- 2 additional posts per week (5 total)
- 5 engagement replies/week (we draft replies in your voice on posts your audience sees)
- Monthly content audit (what's working, what to adjust)
- Unlimited revisions on all posts

First month free if you don't love it. Founder offer: $99/mo instead of $199/mo for the first 5 clients.

The first posts land next Monday after you onboard.
```

**Price:** $99/mo (regular $199/mo after founder slots fill)

---

## Product 3 — Scale ($199/mo founder pricing, $399/mo after first 5 clients)

**Title:**
```
PostPilot Scale — Daily LinkedIn + comment engine + monthly strategy
```

**Description:**
```
Daily on-brand LinkedIn posts + a weekly comment engine + monthly content strategy call. For agencies and high-ticket coaches running outbound.

For B2B coaches, consultants, and agencies ready to make LinkedIn their #1 channel.

Everything in Growth, plus:
- Daily post (7/week instead of 5)
- Comment engine (10 thoughtful comments/week on relevant posts in your niche)
- Voice training + topic strategy (we plan your content calendar quarterly)
- Monthly 30-minute strategy call (review performance, plan next month)

First month free if you don't love it. Founder offer: $199/mo instead of $399/mo for the first 5 clients.

The first posts land next Monday after you onboard.
```

**Price:** $199/mo (regular $399/mo after founder slots fill)

---

## Step-by-step in Gumroad

### Step 1: Sign up (90 seconds)
1. Open https://gumroad.com/signup (already in your browser tabs)
2. Click "Sign up"
3. Use any email — Gmail works
4. Verify your email (Gumroad sends a link)
5. Done — you're logged in

### Step 2: Connect payouts (3 minutes)
1. Gumroad will prompt you for Stripe or PayPal
2. **Pick Stripe** (simpler, faster setup)
3. Click "Connect with Stripe"
4. Enter your business info (or personal — Gumroad works for individuals)
5. Enter your bank account or debit card for payouts
6. Stripe verifies your account (instant for US bank accounts, 1-2 days for some others)

### Step 3: Create Product 1 (2 minutes)
1. Click "+ New Product" (top right)
2. Select "Product" (not "Workflow" or "Subscription" — just "Product")
3. **Name:** paste "PostPilot Starter — 3 on-brand LinkedIn posts every week"
4. **Price:** set to $49 (or whatever matches your offer)
5. **Quantity:** Unlimited
6. **Description:** paste the Product 1 description from above
7. **Cover image:** upload the orange logo or skip for now
8. **Custom checkout fields:** add "Your LinkedIn profile URL" so you get their profile
9. Click "Save and continue"
10. Copy the product URL (you'll see it after saving)

### Step 4: Repeat for Product 2 and Product 3
Same steps, just paste the Product 2 and Product 3 details from above.

### Step 5: Get your 3 product URLs
1. Go to your Gumroad dashboard
2. Click each product
3. Copy the URL (it'll be something like `https://yourusername.gumroad.com/l/postpilot-starter`)
4. Save them somewhere — you'll paste them into your landing page

---

## Now: paste URLs into your landing page

Once you have your 3 Gumroad URLs:

1. Open `landing/index.html` in any text editor (right-click → "Open with" → Notepad or VS Code)
2. Press Ctrl+H (Find and Replace)
3. Find: `href="#start"`
4. Replace with: nothing yet — you need to do this 4 times with DIFFERENT URLs for the 4 different buttons:
   - Nav button "Start free" → use the Starter URL
   - Hero CTA "Start free →" → use the Growth URL (most popular, biggest push)
   - Pricing tier 1 "Start free" → Starter URL
   - Pricing tier 2 "Start free" → Growth URL
   - Pricing tier 3 "Start free" → Scale URL
   - Final CTA → Growth URL
5. Save the file
6. Re-upload to Netlify Drop (the tab is still open in your browser)

That's it. Your site is live, your payment links work, you're done with Day 0.

---

## If you get stuck at any step

Reply to me with:
- "stuck at signup" — I'll walk you through it
- "stuck at payouts" — I'll explain the Stripe Connect flow
- "stuck at creating products" — I'll give you a tighter walkthrough
- "stuck at HTML find/replace" — I'll tell you exactly what to type

Don't waste time stuck. Just ask.

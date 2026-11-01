# Gumroad Setup — 15-Minute Walkthrough

Every click is spelled out. Every text field has the exact content you paste. Do this in one sitting — don't split across days or you'll lose momentum.

---

## Step 1: Create your account (3 min)

1. Open https://gumroad.com in Chrome
2. Click **"Sign in"** (top right)
3. Click **"Sign up"** at the bottom of the login popup
4. Enter your email — use the email you actually check daily (this is where Gumroad sends payouts, tax docs, and customer messages)
5. Click the magic-link email Gumroad sends you → click the link → you're in

**No password needed.** Gumroad uses magic-link login.

---

## Step 2: Set up payouts (4 min)

You won't be able to publish until payouts are set. Do this BEFORE writing the listing.

1. Once logged in, look at the left sidebar
2. Click **"Account"** → **"Payouts"**
3. Click **"Connect Stripe"** (this is how Gumroad sends you money)
4. Stripe popup opens. Enter:
   - Your legal name (must match your bank account)
   - Your date of birth
   - Your address
   - Your SSN (US) / tax ID (other countries)
   - Your bank account number + routing number
   - OR — connect your PayPal instead (simpler if you have it)
5. Submit. Stripe verifies in 1-3 business days. You can publish immediately while waiting.

**Why this matters:** If you don't set up payouts, the listing goes live but you can't receive money. Don't skip this.

---

## Step 3: Create the product (5 min)

1. In the Gumroad dashboard, click **"Products"** in the left sidebar
2. Click the **"+ New product"** button (top right, purple)
3. You land on the product editor

### 3a. Product name

Click the title field (top of page). Paste this exact text:

```
150 ChatGPT Prompts for Etsy Sellers
```

### 3b. Product URL slug

Below the name, you'll see a URL preview like `gumroad.com/l/`. The part after `/l/` is your slug. Type:

```
etsy-seller-ai-prompts
```

Your URL becomes `gumroad.com/l/etsy-seller-ai-prompts`

### 3c. Price + currency

1. Click the price field
2. Enter: **24**
3. Currency: **USD** (default, leave it)
4. Click **"+ Add a tier"** below to add PLR and MRR tiers

### 3d. Add Tier 2 — PLR ($67)

1. Click **"+ Add a tier"**
2. Tier name: `Tier 2 — PLR Rights`
3. Price: **67**
4. Description (small field below price): `Edit, rebrand, resell as your own.`
5. Toggle **"Allow customers to choose this tier"** → ON

### 3e. Add Tier 3 — MRR ($97)

1. Click **"+ Add a tier"** again
2. Tier name: `Tier 3 — MRR Rights`
3. Price: **97**
4. Description: `Resell rights + keep 100% revenue.`
5. Toggle ON

You should now see three tiers: $24 / $67 / $97

### 3f. Summary (the one-liner below the title)

1. Click the field right below the product name
2. Paste this:

```
A 6-phase workflow that uses 150 prompts to write Etsy listings that rank, descriptions that convert, and a shop that grows.
```

### 3g. Description (the main content)

1. Click into the big description box (the editor)
2. You'll see a rich text editor — use formatting as needed
3. Open `marketing/gumroad-listing.md` from your file system
4. Copy the entire body of the "Subtitle" section through the "Pricing Tiers" section
5. Paste it into the Gumroad editor
6. Format the headers (H2/H3) using the toolbar — Gumroad's editor will recognize the markdown headers if you paste them
7. Make sure the callouts (bold text, blockquotes) render properly

The copy is fully written. You're just pasting.

### 3h. Cover image

1. Scroll to the **"Cover"** section (left side or below description)
2. Click **"Upload"** or drag-and-drop
3. Navigate to `etsy-prompts-product/product-files/cover-gumroad.png`
4. Select it. Image uploads.

### 3i. Thumbnail (square)

1. Look for **"Thumbnail"** field (smaller image, square aspect)
2. Upload `product-files/thumbnail-etsy.png`
3. (Optional — falls back to cover if you skip)

### 3j. Files (the deliverable)

1. Scroll down to **"Files"** section
2. Click **"Upload files"** or drag-and-drop
3. Navigate to `etsy-prompts-product/product-files/150-etsy-prompts.pdf`
4. Wait for upload (234 KB, takes a few seconds)
5. The file appears in the product

**Important:** This is what buyers download. The PDF is the product. Make sure it uploaded.

### 3k. Tags / categories

1. Look for **"Tags"** or **"Categories"** field
2. Paste these tags one at a time, pressing Enter after each:
   ```
   ChatGPT
   Etsy
   prompts
   AI
   small business
   SEO
   digital product
   seller tools
   ```

3. Click **"Save"** (top right)

---

## Step 4: Publish (2 min)

1. Click **"Publish"** button (top right, green)
2. Confirm the listing URL looks right
3. Confirm the price displays correctly
4. Click **"Publish now"**
5. Gumroad shows you the public URL: `https://yourusername.gumroad.com/l/etsy-seller-ai-prompts`

**You're live.** First buyer can find you immediately (via the direct URL), but search/discovery takes a few days to build.

---

## Step 5: Set up the workflow email (1 min)

When a customer buys, Gumroad sends them a receipt automatically. You don't need to do anything.

When you want to send a follow-up email (like the "thanks for buying" email from Section 06 of the prompts), you can either:
- Reply to their email directly (Gumroad forwards customer emails to your account email)
- OR use a free Mailchimp / ConvertKit account to send broadcasts

For now, the auto-receipt is enough. Skip this until you have 5+ customers.

---

## Step 6: Test the buyer flow (optional, 2 min)

1. Open your product URL in a NEW incognito browser window
2. Confirm the page renders correctly:
   - Cover image visible
   - Three tier prices show ($24, $67, $97)
   - Description reads well
   - PDF preview shows (Gumroad lets buyers preview before buying)
3. Click the "I want this!" button on the $24 tier
4. Enter your own email (don't actually pay — just see the checkout flow)
5. Cancel out before completing payment

This catches any formatting issues before a real buyer sees them.

---

## What Happens After You Publish

| Timeframe | What happens |
|---|---|
| **Minutes** | Listing is live. Direct URL works. Share it anywhere. |
| **Day 1-3** | Gumroad indexes the listing in their internal search. Few organic views. |
| **Day 4-14** | Sales come from your own sharing (Reddit, X, Pinterest — see launch-plan.md). |
| **Day 14-30** | Gumroad's algorithm may surface your listing to relevant visitors based on conversion rate. |
| **Day 30-90** | If sales are steady, Gumroad's recommendation engine starts featuring it. |

---

## Common Mistakes (Don't Do These)

- **Don't skip the Stripe payout setup.** Without it, sales will fail or money gets stuck in Gumroad limbo.
- **Don't publish without uploading the PDF.** Buyers will email you asking where the file is.
- **Don't paste the description as plain text.** Use the rich text editor's formatting so it looks like the spec, not a wall of text.
- **Don't set the price at $9 or $14 to "test demand."** The research validates $24 — testing at lower prices anchors buyers low and you'll never raise it back. Set $24 from day 1.
- **Don't edit the URL slug after publishing.** It changes your public URL. Pick it once.

---

## Troubleshooting

**"Stripe says my country isn't supported."**
Gumroad works in ~190 countries. Stripe works in ~46. If Stripe doesn't support your country, use PayPal payouts instead. Gumroad supports PayPal in more regions.

**"The PDF won't upload."**
Check the file isn't open in another program. Try uploading from the Gumroad dashboard, not an old browser tab.

**"I don't see the description I pasted."**
Click the description box. The rich text editor might be hiding pasted content in a collapsed section. Click the expand arrow.

**"Gumroad is asking for my SSN / tax ID."**
This is required by Stripe for KYC (Know Your Customer). It's the law, not optional. You'll only see this once.

**"Can I edit the product after publishing?"**
Yes. You can change copy, price, files, etc. anytime. Edits don't break existing customer receipts.

---

## The Entire Setup, End to End

```
1. Sign up at gumroad.com (magic link to your email) .............. 1 min
2. Connect Stripe or PayPal for payouts ......................... 4 min
3. Create new product ........................................... 1 min
4. Paste name, URL slug, prices, tiers ......................... 2 min
5. Paste description from gumroad-listing.md ................... 2 min
6. Upload cover image .......................................... 30 sec
7. Upload PDF deliverable ...................................... 30 sec
8. Add tags .................................................... 30 sec
9. Click Publish ............................................... 30 sec
10. Test buyer flow in incognito ............................... 2 min
                                                       Total: ~15 min
```

---

## After Setup — Day 1 of the Launch

Open `marketing/launch-plan.md` → Day 1 actions:
- Share your new Gumroad URL on your personal socials
- Post Template A on r/EtsySellers
- Make first 3 Pinterest pins (already rendered to PNG)

Then keep going through the 14-day calendar.

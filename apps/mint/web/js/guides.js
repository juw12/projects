/* Mint creator guides — static content (trusted HTML authored here, not user input). */
(function (root) {
  "use strict";

  root.MintGuides = [
    {
      slug: "create",
      icon: "\u2728",
      title: "Create a template in 2 minutes",
      summary: "Describe it, tweak it with words, check the preview, export.",
      body:
        "<p><strong>1. Describe the job, not the spreadsheet.</strong> \u201cInvoice tracker for freelancers in rupiah, with notes\u201d works better than \u201ca table with 6 columns\u201d. Mint picks the closest blueprint, then applies your currency, theme words (pastel, dark, minimal, green\u2026) and extra columns (priority, owner, notes, deadline, status).</p>" +
        "<p><strong>2. Tweak with plain commands</strong> \u2014 one per line, English or Bahasa Indonesia:</p>" +
        "<ul><li><code>add column Priority</code> \u00b7 <code>tambah kolom Catatan</code></li>" +
        "<li><code>add column Margin = [Profit]/[Price]</code> (formulas use [Column Name])</li>" +
        "<li><code>rename Cost to Price</code> \u00b7 <code>remove column Notes</code> \u00b7 <code>add 10 rows</code></li>" +
        "<li><code>theme ocean</code> \u00b7 <code>make it dark</code> \u00b7 <code>currency IDR</code></li>" +
        "<li><code>total of Amount</code> \u00b7 <code>highlight Profit below 0 red</code></li></ul>" +
        "<p><strong>3. Fine-tune by hand.</strong> Every cell, column type, dropdown option, formula, dashboard card and colour rule is editable in the Studio.</p>" +
        "<p><strong>4. Export.</strong> The .xlsx has live formulas, dropdowns, colour rules, a frozen header, 200 ready rows and a Dashboard tab. It opens in Excel and in Google Sheets (File \u203a Import).</p>"
    },
    {
      slug: "themes",
      icon: "\ud83c\udfa8",
      title: "Themes & branding",
      summary: "Look consistent across every template you sell.",
      body:
        "<p>Buyers judge templates by the thumbnail. Pick <strong>one signature theme</strong> for your shop (for example Blush for a lifestyle brand, Midnight for tech, Mono for business) and use it on every listing so your products are recognisable in the market grid.</p>" +
        "<ul><li><strong>Light themes</strong> (Mint, Ocean, Sunset, Lavender, Blush, Forest, Mono) print well and suit business buyers.</li>" +
        "<li><strong>Midnight</strong> is a full dark sheet \u2014 popular with students and creators, less so for printing.</li>" +
        "<li>Keep column names short (1\u20132 words) so headers stay readable on phones.</li>" +
        "<li>Put 4\u20136 realistic sample rows in every template: an empty sheet does not sell.</li></ul>" +
        "<p>The share card in <em>Affiliate \u203a Content kit</em> uses the listing\u2019s theme automatically, so your social posts match your products.</p>"
    },
    {
      slug: "pricing",
      icon: "\ud83c\udff7\ufe0f",
      title: "Pricing that sells",
      summary: "Free lead magnets, paid niche systems, bundles.",
      body:
        "<p>Generic templates (basic budget, to-do list) compete with free versions everywhere. Charge for <strong>specific systems</strong> that save a professional real time.</p>" +
        "<ul><li><strong>Free:</strong> one simple, useful template to build your audience and reviews.</li>" +
        "<li><strong>Entry ($3\u2013$7):</strong> personal-life systems \u2014 habits, meals, travel, study.</li>" +
        "<li><strong>Pro ($9\u2013$19):</strong> business systems \u2014 invoices, inventory, CRM, rental P&amp;L, pricing calculators.</li>" +
        "<li><strong>Bundles:</strong> list a bundle at roughly the price of 2 items to lift the average order.</li></ul>" +
        "<p><strong>Local pricing:</strong> list in the buyer\u2019s currency. In Indonesia, round, familiar prices (Rp 29.000, Rp 49.000, Rp 99.000) read better than converted dollar amounts.</p>" +
        "<p>Mint keeps a platform fee (shown in your Sell dashboard) and pays affiliates the commission you choose, only on sales they actually referred.</p>"
    },
    {
      slug: "affiliate",
      icon: "\ud83e\udd1d",
      title: "How the affiliate program works",
      summary: "Anyone can promote any template and earn commission.",
      body:
        "<ol><li>Sellers choose a commission (0\u201350%) when publishing. 0% means no affiliates.</li>" +
        "<li>Any logged-in user opens a listing and taps <strong>Get affiliate link</strong>. The link looks like <code>\u2026#/item/ID?ref=yourname-1a2b3c</code>.</li>" +
        "<li>When a visitor arrives through the link, the referral is remembered on their device for <strong>30 days</strong> and the click is counted.</li>" +
        "<li>If they buy, the affiliate earns <em>price \u00d7 commission</em>. Self-referrals and seller-referrals earn nothing.</li>" +
        "<li>Clicks, attributed sales and earnings appear in your Affiliate dashboard; the seller sees the same sale with the commission deducted.</li></ol>" +
        "<p><strong>Tip for sellers:</strong> 25\u201335% gives creators a reason to make content about your template. You still keep the sale you would not otherwise have had.</p>"
    },
    {
      slug: "content",
      icon: "\ud83d\udce3",
      title: "Content marketing playbook",
      summary: "Turn one template into a week of posts.",
      body:
        "<p>Templates sell when people <strong>see the result</strong>. Use the Content kit on any listing to get ready-made copy plus a themed share card, then post on this cadence:</p>" +
        "<ul><li><strong>Day 1 \u2014 short video (TikTok / Reels / Shorts):</strong> hook (\u201cstop rebuilding this every month\u201d), 8-second screen recording of totals updating, CTA.</li>" +
        "<li><strong>Day 2 \u2014 carousel or LinkedIn post:</strong> the problem, 3 bullets of what the sheet does, link.</li>" +
        "<li><strong>Day 3 \u2014 Pinterest pin:</strong> share card + keyword-rich title (\u201cfreelance invoice tracker google sheets\u201d).</li>" +
        "<li><strong>Day 5 \u2014 blog / SEO post:</strong> use the outline from the kit; answer the question people search for.</li>" +
        "<li><strong>Day 7 \u2014 WhatsApp / community share:</strong> personal recommendation with your affiliate link.</li></ul>" +
        "<p>Always disclose affiliate links where required (for example \u201c#affiliate\u201d or \u201cI earn a commission\u201d). Track which channel works in your Affiliate dashboard and double down.</p>"
    },
    {
      slug: "live",
      icon: "\ud83d\ude80",
      title: "How payments work",
      summary: "How buying works on Mint, and how you get paid.",
      body:
        "<p><strong>Mint is live.</strong> Accounts, listings, orders and affiliate links are stored on Mint\u2019s servers, so they work on every device.</p>" +
        "<p><strong>How a sale works:</strong></p>" +
        "<ol><li>Add your own payment link when you publish (Lynk.id, Saweria, Trakteer, a Stripe or PayPal link, Gumroad\u2026).</li>" +
        "<li>A buyer clicks <em>Buy</em>, gets an order reference like <code>M-7K3QXA</code> and pays you on your link with that reference in the note.</li>" +
        "<li>You see the order under <em>Sell \u2192 Orders to confirm</em>. Tap <em>Payment received</em> and the buyer can download right away.</li>" +
        "<li>If an affiliate referred the sale, Mint shows the commission you owe and their payout details. Pay them, then tap <em>Mark paid</em>.</li></ol>" +
        "<p>Mint never holds your money, so there\u2019s no payout delay. Free templates unlock instantly.</p>" +
        "<p><strong>Tips:</strong> use a payment page that shows the amount (so buyers can\u2019t underpay), confirm orders at least daily, and reject orders that never arrive \u2014 the buyer can simply order again.</p>"
    }
  ];
})(typeof globalThis !== "undefined" ? globalThis : this);

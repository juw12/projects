# Industrial Connect

A company showcase and partnership portal for industrial manufacturers. It serves three audiences in one app:

| Audience | What they get |
|---|---|
| **Customers / OEMs** | Product catalog with search and filters, interactive 3D models, side-by-side compare, printable datasheets, one RFQ basket for many parts |
| **Investors** | KPIs (revenue, CAGR and margin calculated automatically), revenue/margin chart, investment thesis, funding ask with use-of-funds chart, roadmap, team, deck-request form |
| **Suppliers** | Sourcing categories and volumes, requirements, qualification steps, registration form |
| **Your team** (`#/admin`) | Lead inbox with automatic **hot/warm/cold scoring**, status pipeline, CSV export, section/product analytics, built-in content editor |

The "I am a Customer / Investor / Supplier" switch in the header changes the home-page message and calls to action.

## Run it
Double-click `index.html`. No install or build step is needed. The 3D viewer loads three.js from a CDN, so it needs internet access. Everything else works offline.

## Make it yours
1. Edit `data.js`: company, stats, certifications, products, investor figures, supplier categories, contacts. **All shipped values are placeholders.**
2. Or open **Team login** (footer) → PIN `1234` → *Content*, edit the content there, then **Download data.js** and replace the file.
3. Real 3D models: export **GLB** (recommended) or **STL** from your CAD software, put it in a `models/` folder and add `"modelUrl": "models/my-part.glb"` to the product. (Loading files by URL requires the site to be served over http(s). On a local double-click, use the **Load STL / GLB** button instead.)
4. Receiving leads: set `settings.formEndpoint` to a Formspree, Make, Zapier or CRM webhook URL. Every inquiry is POSTed as JSON. Without it, leads are stored only in the visitor's browser (demo mode).

## Publish
Upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, your web server).

## Before going live
- Replace the demo PIN. The admin page is client-side only and is **not secure**. Real lead management should go through the form endpoint or CRM.
- Have finance and legal review the investor figures and disclaimer.
- Add a privacy notice for the form data you collect.

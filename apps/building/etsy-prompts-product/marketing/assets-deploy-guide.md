# Assets & Deploy Guide

This file explains what was auto-generated for you, where it lives, and how to use it.

---

## What's in `assets/` (HTML sources)

These are the editable source files. Open any of them in a browser to see the design.

| File | Purpose |
|---|---|
| `assets/cover-gumroad.html` | Source HTML for the Gumroad cover (16:9, 1280×720) |
| `assets/thumbnail-etsy.html` | Source HTML for the Etsy thumbnail (1:1, 2000×2000) |
| `assets/pin-pain-point.html` | Source HTML for Pinterest pin #1 (2:3, 1000×1500) |
| `assets/pin-stat.html` | Source HTML for Pinterest pin #2 (2:3, 1000×1500) |
| `assets/landing-page.html` | Self-hostable full product sales page |

To edit any of these: open in Notepad, VS Code, or any editor. Change text, save. Re-render via the script below.

---

## What's in `product-files/` (ready-to-upload PNGs)

These are already rendered at exact platform dimensions and ready to upload.

| File | Dimensions | Use for |
|---|---|---|
| `product-files/cover-gumroad.png` | 1280×720 | Gumroad product cover image |
| `product-files/thumbnail-etsy.png` | 2000×2000 | Etsy listing thumbnail (first image) |
| `product-files/pin-pain-point.png` | 1000×1500 | Pinterest pin #1 |
| `product-files/pin-stat.png` | 1000×1500 | Pinterest pin #2 |

**You do NOT need to do anything else with these files.** They are ready to upload as-is.

---

## How the PNGs were generated (for your reference)

The PNGs were rendered using Chrome headless. If you ever edit the HTML sources and want to regenerate:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$assets = "~\Documents\Default Project\etsy-prompts-product\assets"
$product = "~\Documents\Default Project\etsy-prompts-product\product-files"

& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars `
  --window-size=1280,720 `
  --screenshot="$product\cover-gumroad.png" `
  "file:///$assets/cover-gumroad.html"
```

Change `1280,720` and the filename for the other sizes (2000×2000, 1000×1500).

If you want to re-render all 4 at once, copy this block:

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$assets = "~\Documents\Default Project\etsy-prompts-product\assets"
$product = "~\Documents\Default Project\etsy-prompts-product\product-files"

& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1280,720 --screenshot="$product\cover-gumroad.png" "file:///$assets/cover-gumroad.html"
& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=2000,2000 --screenshot="$product\thumbnail-etsy.png" "file:///$assets/thumbnail-etsy.html"
& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1000,1500 --screenshot="$product\pin-pain-point.png" "file:///$assets/pin-pain-point.html"
& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1000,1500 --screenshot="$product\pin-stat.png" "file:///$assets/pin-stat.html"
```

---

## How to deploy the landing page (optional backup)

The HTML landing page (`assets/landing-page.html`) is a complete, deployable product page. If Gumroad changes its policy or you want a self-hosted option, deploy it for free in 5 minutes.

### Option A: GitHub Pages (recommended if you use GitHub)

1. Create a new GitHub repo (e.g., `etsy-prompts-landing`)
2. Copy `assets/landing-page.html` → rename to `index.html` → push to the repo
3. Settings → Pages → Source: `main` branch → Save
4. Your page is live at `https://yourusername.github.io/etsy-prompts-landing/` in ~60 seconds
5. Point the Gumroad CTA buttons to your Gumroad URL

### Option B: Netlify Drop (zero setup)

1. Go to https://app.netlify.com/drop
2. Drag a folder containing the renamed `index.html` (and any assets) into the page
3. Get a free `*.netlify.app` URL immediately
4. No account required for the initial drop

### Option C: Vercel (zero setup, more features)

1. Go to https://vercel.com/new
2. Drag the folder containing `index.html`
3. Get a free `*.vercel.app` URL

### Option D: Local (just for testing)

1. Open `assets/landing-page.html` directly in Chrome
2. Press F12 → Toggle Device Toolbar (Ctrl+Shift+M) → Test mobile view
3. The page is fully responsive

---

## Quick edit cheatsheet

| To change | Open | Edit |
|---|---|---|
| Cover headline | `assets/cover-gumroad.html` | Search for "150 ChatGPT" → edit the text |
| Cover section names on cards | Same file | Search for "SECTION 0X" → edit the title |
| Landing page hero text | `assets/landing-page.html` | Search for "150 ChatGPT Prompts." |
| Landing page pricing | Same file | Search for "Tier 1" → "Tier 2" → "Tier 3" |
| Landing page FAQ | Same file | Search for "summary>" → edit questions |

After editing any HTML, re-run the screenshot commands above (or skip — only re-render if you changed a visual file).

---

## What's NOT included (and why)

- **Stock photos of Etsy sellers.** Intentionally avoided — they're the #1 Etsy listing cliche.
- **AI-generated "person at desk" illustrations.** Same reason.
- **Logo / brand mark.** You don't have one yet. Add later if you build a brand.
- **Product preview screenshots of the actual PDF.** Couldn't generate without opening the PDF in a browser and screenshotting (you can do this manually if you want).

---

## What to do now (final)

1. ✅ Cover, Etsy thumbnail, and 2 Pinterest pins are **already rendered** — upload them
2. ✅ Landing page is **already built** — deploy when you want a backup
3. The remaining manual work is account creation (Gumroad/Etsy) and the actual launch posts — these need your accounts

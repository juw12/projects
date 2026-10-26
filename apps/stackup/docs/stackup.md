# Stackup — product note

## Why this product

Generic spreadsheet templates (budgets, invoices, planners) are saturated and
racing to the bottom, and AI can now generate them on demand. Niche *professional*
tools hold their price. Tolerance stack-ups are a daily task for mechanical / hardware
engineers, yet the options are either ad-hoc spreadsheets or expensive 3D variation
tools (CETOL, 3DCS, VisVSA). Stackup sits in between: fast 1D stacks with the
statistics engineers actually need in design reviews (Cpk, ppm, biggest lever).

## Offer (open-core)

| Tier | Price idea | Contents | Role |
| --- | --- | --- | --- |
| Web app | Free | Worst case, RSS, Monte Carlo, Pareto, report, share link | Traffic + trust (SEO, LinkedIn) |
| Lite workbook | Free | Stack sheet, live formulas, Excel + Google Sheets | Lead magnet, email capture |
| Pro workbook | USD 29–49 one-time (test) | + Monte Carlo sheet, gasket checker, DVT tracker, RCA/8D log, dashboard | Revenue |
| Team / custom | Quote | Company template, training, custom loops | High-ticket |

The Pro workbook is **not** in this public repo. It is built from a private script.

## Launch checklist

1. Create a Gumroad / Lemon Squeezy / Payhip product for Stackup Pro; replace the
   `mailto:` link in `web/index.html#pro` with the checkout URL.
2. Post the gasket example (FAIL → fix via the biggest lever) on LinkedIn with a
   15-second screen recording; engineers share "I found the problem" posts.
3. List the Lite workbook on Etsy / Gumroad as free, Pro as paid. Keywords:
   tolerance stack up calculator, RSS tolerance analysis, Cpk calculator, DVT tracker.
4. Indonesian / Chinese versions of the landing page (Batam / Suzhou manufacturing audience).

## Roadmap

- v1.1: EN / ID / 中文 UI, stack templates library (connector, lens focus, screw boss)
- v1.2: tolerance allocation (solve for the tolerance that hits target Cpk)
- v1.3: measured-data mode (paste FAI data → real mean/σ per contributor)

## Verification log (v1.0)

- JS core vs. independent SciPy reference: mean, worst case, σ, Cpk identical; ppm within 1e-7.
- Lite workbook recalculated with an independent formula engine (`formulas`): identical
  results for all three presets, covering FAIL, PASS (worst case, one-sided spec) and
  PASS (statistical).
- Monte Carlo σ within 0.3% of RSS σ at 200k runs; gasket example shows lighter real tails
  (≈1300 ppm) than the normal estimate (2097 ppm) because of the uniform flatness term.

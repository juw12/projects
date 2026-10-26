# Stackup — tolerance stack-up studio

Worst case, RSS and Monte Carlo tolerance stack-ups side by side, with Cpk, predicted
ppm, a variance Pareto and the one dimension to tighten first. Offline-first PWA, no
backend, no sign-up. Ships with a free Excel / Google Sheets workbook.

**Live:** https://juwpegatron.github.io/projects/stackup/ ·
[App](https://juwpegatron.github.io/projects/stackup/app.html) ·
[Web](https://juwpegatron.github.io/projects/stackup/web.html) ·
[Mobile](https://juwpegatron.github.io/projects/stackup/mobile.html)

## Features

- 1D stacks with sensitivities (±1, 0.5 for diameters acting as radii, …)
- Asymmetric tolerances (mean shift), normal (custom k), uniform and triangular distributions
- Worst case, RSS ±3σ, Cp / Cpk vs. target, predicted ppm (normal model)
- Seeded Monte Carlo (10k–200k runs) with histogram, spec and worst-case markers
- Variance Pareto, "biggest lever" what-if (halve its tolerance → new Cpk), re-centring hint
- Vector loop diagram, three example stacks (IPX7 gasket, PCB clearance, snap-fit)
- Multiple stacks in local storage, JSON import/export, CSV for Excel/Sheets,
  share-by-link (stack encoded in the URL hash), one-page print/PDF report, light/dark

## Layout

```
apps/stackup/
  web/
    index.html            product page
    app.html web.html mobile.html   App / Web / Mobile shells (same app.js)
    stackup-core.js       pure math (no DOM) — analyze(), monteCarlo(), toCsv()
    app.js app.css        UI
    sw.js manifest.webmanifest icons/
    downloads/Stackup-Lite.xlsx     free workbook (generated)
  tools/build_workbooks.py          builds the Lite workbook (needs openpyxl, build-time only)
  tests/test_stackup.py             hermetic stdlib test
  docs/stackup.md                   product note
```

## Run & test

```bash
python -m http.server -d apps/stackup/web 8000   # then open http://localhost:8000/
python apps/stackup/tests/test_stackup.py
pip install openpyxl && python apps/stackup/tools/build_workbooks.py   # rebuild the free workbook
```

The test checks static integrity, re-derives the three presets with a pure-Python
reference, runs the real `stackup-core.js` (via `osascript -l JavaScript` on macOS or
`node` if present) against the same golden values, and confirms the free workbook
has live formulas and no paid (Pro) sheets.

## Method

```
mean_i = nominal + (tol+ − tol−)/2        half_i = (tol+ + tol−)/2
σ_i    = half_i/k (normal) · half_i/√3 (uniform) · half_i/√6 (triangular)
μ      = Σ a_i·mean_i       worst case = μ ± Σ|a_i|·half_i       σ = √Σ(a_i·σ_i)²
Cpk    = min(USL−μ, μ−LSL)/3σ
```

Engineering aid only — not a substitute for a reviewed tolerance analysis. Example
values are illustrative.

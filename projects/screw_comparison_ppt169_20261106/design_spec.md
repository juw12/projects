# Screw Comparison - Design Spec

> Human-readable design narrative for the screw comparison deck.

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | Screw Comparison: 131C-01QU000 vs 131C-01QN000 |
| **Canvas Format** | PPT 16:9 (1280x720) |
| **Page Count** | 5 |
| **Design Style** | B) General Consulting + clean technical |
| **Target Audience** | Internal engineering / procurement team |
| **Use Case** | Explain main vs second source differences and interchangeability |
| **Created Date** | 2026-11-06 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Format** | PPT 16:9 |
| **Dimensions** | 1280x720 |
| **viewBox** | `0 0 1280 720` |
| **Margins** | left/right 60px, top/bottom 50px |
| **Content Area** | 1160x620 |

---

## III. Visual Theme

### Theme Style

- **Style**: General Consulting + clean technical
- **Theme**: Light theme
- **Tone**: Professional, factual, technical

### Color Scheme

| Role | HEX | Purpose |
| ---- | --- | ------- |
| **Background** | `#FFFFFF` | Page background |
| **Secondary bg** | `#F5F7FA` | Card/section background |
| **Primary** | `#1565C0` | Titles, key sections, icons |
| **Accent** | `#E65100` | Highlight differences |
| **Secondary accent** | `#42A5F5` | Secondary emphasis |
| **Body text** | `#212121` | Main body text |
| **Secondary text** | `#616161` | Captions, annotations |
| **Tertiary text** | `#9E9E9E` | Supplementary info, footers |
| **Border/divider** | `#E0E0E0` | Card borders, divider lines |
| **Success** | `#2E7D32` | Same/identical indicators |
| **Warning** | `#C62828` | Different/warning indicators |

---

## IV. Typography System

### Font Plan

**Typography direction**: Clean technical sans-serif, Latin-primary

| Role | Chinese | English | Fallback tail |
| ---- | ------- | ------- | ------------- |
| **Title** | `"Microsoft YaHei"` | `Arial` | `sans-serif` |
| **Body** | `"Microsoft YaHei"` | `Arial` | `sans-serif` |
| **Code** | — | `Consolas, "Courier New"` | `monospace` |

**Per-role font stacks**:

- Title: `Arial, "Microsoft YaHei", sans-serif`
- Body: `Arial, "Microsoft YaHei", sans-serif`
- Code: `Consolas, "Courier New", monospace`

### Font Size Hierarchy

**Baseline**: Body font size = 20px

| Purpose | Size | Weight |
| ------- | ---- | ------ |
| Cover title | 48px | Bold |
| Page title | 32px | Bold |
| Subtitle | 24px | SemiBold |
| **Body** | **20px** | Regular |
| Annotation | 14px | Regular |
| Page number | 12px | Regular |

---

## V. Layout Principles

### Page Structure

- **Header area**: 80px — page title + optional icon
- **Content area**: 540px — main content
- **Footer area**: 40px — page number, source info

### Layout Pattern Library

| Pattern | Used In |
| ------- | ------- |
| Single column centered | P01 (Cover) |
| Top-bottom split | P02 (Overview) |
| Symmetric split (5:5) | P03 (Comparison) |
| Three-column | P04 (Key Differences) |
| Single column centered | P05 (Bottom Line) |

### Spacing Specification

| Element | Value |
| ------- | ----- |
| Safe margin | 60px |
| Content block gap | 32px |
| Icon-text gap | 12px |

---

## VI. Icon Usage Specification

### Source

- **Library**: `tabler-outline` (stroke weight: 2)

### Recommended Icon List

| Purpose | Icon Path | Page |
| ------- | --------- | ---- |
| Mechanical/screw | `tabler-outline/settings` | P01, P02 |
| Comparison | `tabler-outline/git-compare` | P03 |
| Same/identical | `tabler-outline/circle-check` | P03 |
| Different/warning | `tabler-outline/alert-triangle` | P04 |
| Differences | `tabler-outline/arrows-diff` | P04 |
| Bottom line/conclusion | `tabler-outline/circle-check` | P05 |

---

## VII. Visualization Reference List

Catalog read: 71 templates

| Page | Template | Path | Summary-quote (verbatim) | Usage |
| ---- | -------- | ---- | ------------------------------------------------- | ----- |
| P03 | comparison_table | `templates/charts/comparison_table.svg` | "Pick for 2-4 plans/products compared across many feature rows (dense matrix). Skip for pricing-tier marketing layout (use comparison_columns)." | Full spec comparison between the two screws |
| P04 | vertical_list | `templates/charts/vertical_list.svg` | "Pick for 3-6 numbered key points each with a short description — design principles, core tenets, action items, key takeaways, recommendations, executive summary points. Skip for icon-style cards (use icon_grid) or sequential steps (use numbered_steps)." | 3 key differences highlighted |

**Runners-up considered**:

- `basic_table` | rejected for P03: less visual structure for the "same/different" color-coding this comparison needs
- `pros_cons_chart` | rejected for P04: this is spec deltas, not pros/cons argument
- `labeled_card` | rejected for P04: 3 differences don't map to 3-4 parallel aspects of one subject

---

## VIII. Image Resource List

No images used (Approach A).

---

## IX. Content Outline

### Part 1: Screw Source Comparison

#### Slide 01 - Cover

- **Layout**: Single column centered
- **Title**: Screw Source Comparison
- **Subtitle**: 131C-01QU000 (Main) vs 131C-01QN000 (Second Source)
- **Info**: BOM Reference | Nov 2026

#### Slide 02 - Overview

- **Layout**: Top-bottom split
- **Title**: At a Glance
- **Content**:
  - Both are M1.7 x 4.5mm tapping screws, Torx T6, K-head
  - Main source: HARMONY (White Zinc)
  - Second source: SCREWTECH (Blue Zinc)
  - Part numbering: "-S-" prefix marks second source

#### Slide 03 - Spec Comparison

- **Layout**: Symmetric split (5:5) — table
- **Title**: Detailed Specification
- **Visualization**: comparison_table
- **Content**: Full comparison table with Same/Diff color coding

#### Slide 04 - Key Differences

- **Layout**: Three-column cards
- **Title**: What's Different
- **Visualization**: vertical_list (adapted as 3 cards)
- **Content**:
  1. Plating: White Zinc vs Blue Zinc
  2. Supplier: HARMONY vs SCREWTECH
  3. Part Number: QU vs QN (with -S- marker)

#### Slide 05 - Bottom Line

- **Layout**: Single column centered
- **Title**: Interchangeability Assessment
- **Content**:
  - Mechanically identical
  - Plating difference may affect corrosion spec / cosmetic
  - Confirm with product spec before substitution

---

## X. Speaker Notes Requirements

- **Filename**: match SVG name
- **Style**: Professional, concise
- **Purpose**: Inform

---

## XI. Technical Constraints Reminder

### SVG Generation Must Follow:

1. viewBox: `0 0 1280 720`
2. Background uses `<rect>` elements
3. Text wrapping uses `<tspan>`
4. Transparency uses `fill-opacity` / `stroke-opacity`
5. FORBIDDEN: `mask`, `<style>`, `class`, `foreignObject`, `textPath`, `animate*`, `script`
6. No `radialGradient`, `linearGradient`, `filter` (native PPTX compatibility)
7. Raw Unicode for symbols; XML reserved chars escaped

### PPT Compatibility Rules:

- `<g opacity>` FORBIDDEN
- Inline styles only

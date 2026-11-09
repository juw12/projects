# Execution Lock

## canvas
- viewBox: 0 0 1280 720
- format: PPT 16:9

## colors
- bg: #FFFFFF
- bg_secondary: #F5F7FA
- primary: #1565C0
- accent: #E65100
- secondary_accent: #42A5F5
- text: #212121
- text_secondary: #616161
- text_tertiary: #9E9E9E
- border: #E0E0E0
- success: #2E7D32
- warning: #C62828

## typography
- font_family: Arial, "Microsoft YaHei", sans-serif
- code_family: Consolas, "Courier New", monospace
- body: 20
- title: 32
- cover_title: 48
- subtitle: 24
- annotation: 14
- page_number: 12

## icons
- library: tabler-outline
- stroke_width: 2
- inventory: settings, git-compare, circle-check, alert-triangle, arrows-diff

## page_rhythm
- P01: anchor
- P02: dense
- P03: dense
- P04: breathing
- P05: anchor

## page_charts
- P03: comparison_table
- P04: vertical_list

## forbidden
- Mixing icon libraries
- rgba()
- `<style>`, `class`, `<foreignObject>`, `textPath`, `@font-face`, `<animate*>`, `<script>`
- `<g opacity>` (set opacity on each child individually)
- radialGradient, linearGradient, filter (native PPTX compat)
- HTML named entities in text

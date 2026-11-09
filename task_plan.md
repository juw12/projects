# CI/CD Vendor Failure Catalog Research

## Goal
Compile a sortable markdown table of ≥25 public incidents from 9 CI/CD vendors (Jan 2022 → present). Must inform OpenForge SLO + threat-model design.

## Vendors to Cover
1. GitHub Actions
2. GitLab CI
3. CircleCI
4. Travis CI
5. Drone
6. Woodpecker
7. Forgejo Actions
8. Buildkite
9. Concourse

## Requirements
- ≥25 incidents total
- ≥5 security-class
- ≥10 from 2024 or later
- All 9 vendors represented
- Primary-source URLs only
- 500-1200 line deliverable

## Plan
- **Phase 1**: Parallel web searches across all 9 vendors — known incidents + blog archives
- **Phase 2**: Specific searches for major security incidents (CircleCI 2022, tj-actions 2024, GitHub Actions crypto mining)
- **Phase 3**: GitHub Advisory Database / status page mining
- **Phase 4**: Compile findings.md with raw incident data
- **Phase 5**: Build final markdown table + patterns section

## Final stats
- 46 incidents (target ≥25) ✓
- 20 security-class (target ≥5) ✓
- 36 from 2024+ (target ≥10) ✓
- All 9 vendors represented ✓
- Line count: 211 (target 500-1200) — needs expansion

## Errors / Notes
- Web search (Exa) rate-limited from start of session; pivoted entirely to webfetch of known primary-source URLs.
- `status.gitlab.com` returned transport errors throughout.
- CircleCI legacy blog URLs returned 404; cited category page.
- Forgejo security advisories returned 404 (URL pattern mismatch); used news page + Codeberg blog instead.
- Travis CI no longer publishes postmortems since 2022; cited community forum + status twitter.

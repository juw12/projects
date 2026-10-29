# Contributing

This is a personal monorepo, but the conventions below keep it maintainable.

## Layout

- One directory per product under `projects/<name>/`.
- `web/` holds the static front-end (this is what gets deployed to Pages).
- `server/` (or `server.py` at the project root) holds the optional backend.
- `tests/` holds a hermetic, stdlib-only end-to-end test.
- `docs/` holds specs and guides.
- Shared build/deploy logic lives in `scripts/` and `.github/workflows/`.

## Standards

- **Python 3.11+**, standard library only. No third-party runtime dependencies.
- Every backend is reachable via `python <server>.py` and exposes `GET /api/health`.
- Every project must be runnable and testable with a single command.
- Front-ends must keep working with **no backend** (offline mode). The backends
  are an upgrade, not a requirement.
- Tests exit `0` on success and `1` on failure, and must not touch real data
  (use a temp database and a free port).

## Portfolio cards

Every app listed in `scripts/apps.json` gets a card on the portfolio, and all cards
share one look: a 1600x1000 image of the app's real UI framed in a browser window on
a dark gradient tinted with the app's accent colour. Never hand-draw, halftone or
paste a raw screenshot as card art. Make it with the card tool, then publish:

```bash
python scripts/portfolio_card.py <id>      # capture the live app into ../portfolio/assets/projects/
python scripts/portfolio_card.py --check   # audit every card
python scripts/publish_portfolio.py        # refuses missing, undersized or greyscale cards
```

Capture settings (page, clicks, theme, accent colours, or `frame_image` for native
apps) live in the app's optional `card` object in `scripts/apps.json`. The card tool
needs Playwright (`pip install playwright`); it is a dev-only dependency.

## Commit messages

Concise, imperative, one logical change per commit, e.g.:

```
peers: add stdlib state backend and opt-in wiring
```

## Before committing

Run the relevant project's test:

```bash
python projects/<name>/tests/verify_api.py
```

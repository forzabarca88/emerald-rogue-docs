# Pokémon Emerald ROGUE — documentation site

A static, zero-dependency documentation site for the Pokémon Emerald ROGUE fan-game (Vanilla vs Expansion builds), covering routes, quests, hub, Safari Zone, mechanics, settings, versions, and game modes.

**Live site:** <https://forzabarca88.github.io/emerald-rogue-docs/>

## Quick start

No npm dependencies to install — Node is the only requirement.

- `npm run build` — validates the `data/*.json` envelopes and emits the deployable site into `dist/`.
- `npm test` — runs the node:test suites (unit + e2e over the built `dist/`); the Playwright UI suites self-skip when Playwright is absent.
- `npm run screenshots` — captures page screenshots into gitignored `test/ui/screenshots/` (requires Playwright).
- `npm run verify:citations` — dev-only: checks every source citation in `data/*.json` against the vendored `references/pokeemerald-rogue` game repo, which must be present at the baseline SHAs in `scripts/verify/baseline.json`.

## How it works

`data/*.json` is the single source of truth — every record carries a verified source citation pinned to the game-repo SHAs recorded in `scripts/verify/baseline.json`. `scripts/build.mjs` validates the data files and bundles them with the page shells from `site/` into `dist/`, which `.github/workflows/pages.yml` deploys to GitHub Pages. For deeper detail, see `AGENTS.md` and the data files themselves.

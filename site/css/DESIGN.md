# DESIGN.md — Emerald Rogue Docs · design contract

**This file is the binding design contract for all page and stylesheet work.**
Read it before writing markup or CSS. The four stylesheets are loaded in a
fixed order — `tokens.css` → `base.css` → `components.css` → `pages.css`.
Do not reorder, remove, or add stylesheets.

## 1. Identity

A **field guide for a GBA-era roguelite**. The site is set in a night-Hoenn
forest: deep green-tinted darks (never neutral black), a faint 28px
tile-grid texture (the GBA screen), chunky 2px borders and small radii (GBA
menu panels), and a pixel display face used with restraint. Two accents
carry the whole system: **Emerald** (the Vanilla edition, and the primary
interactive color) and **Amber Gold** (the EX edition, after the gold "EX"
card symbol of the Pokémon TCG). The home hero opens with the game's most
characteristic artifact — a generated **run path** — instead of a stock
graphic. Everything else (cards, tables, badges) stays quiet and
disciplined; the boldness is spent on the run path and the version toggle.

## 2. Palette

Six named hex tokens in `tokens.css` — **these are the only hues on the
site**. All other colors are the three *derived* tokens below. If a page
needs a new hue (e.g. a per-type `.chip--fire` modifier for routes), add a
**named token to tokens.css** and a row to this table **in the same task**.

| Token | Hex | Name | Use |
| --- | --- | --- | --- |
| `--color-bg` | `#10241b` | Deep Pine | page background only |
| `--color-surface` | `#152a20` | Canopy | header, footer, cards, tables, stat blocks |
| `--color-raised` | `#1b3529` | Moss | hovers, table headers, chips, `code` |
| `--color-ink` | `#eaf5ee` | Moonlight | primary text, active nav/tabs, table text |
| `--color-muted` | `#96b5a4` | Fern | secondary text, labels, inactive options |
| `--color-emerald` | `#2ec27e` | Emerald | Vanilla accent, links, focus ring, eyebrows, active tab indicator, Vanilla toggle fill, default (inactive) run-path nodes |
| `--color-gold` | `#f2b63c` | Amber | EX accent: link hover, EX badge/toggle fill, boss node, anything that says "EX" |

Derived (pre-computed mixes/shades — no new hues, do not edit without
re-deriving):

| Token | Hex | Derivation | Use |
| --- | --- | --- | --- |
| `--color-both` | `#90bc5d` | 50/50 emerald + amber | "Both" badge fill only |
| `--color-line` | `#2f4a3d` | fern @ ~30% on bg | all borders, table row rules, run-path links |
| `--color-grid` | `#173127` | fern @ ~5% on bg | page background tile-grid only |

Contrast (measured, all pass WCAG AA for text; badges pass AAA):
ink on bg 14.9:1 · muted on bg 7.0:1 · emerald on bg 7.4:1 · gold on bg
9.3:1 · dark bg text on emerald/gold/both fills 7–9:1.

## 3. Typography

Exactly **two web font families**, loaded via the CDN `<link>` block already
in every shell's `<head>` (do not add families or weights):

| Role | Stack (see `--font-*`) | Where |
| --- | --- | --- |
| Display — *Pixelify Sans* (pixel face; GBA vocabulary) | `--font-display` | brand, h1–h3, eyebrows, tab labels, hero stat values, `.card__title`. **Never below 14px, never for body text.** |
| Body — *IBM Plex Sans* | `--font-body` | everything else: prose, nav links, buttons, table cells |
| Data — system mono stack (no web font) | `--font-mono` | version toggle, badges, chips, table headers, `.card__source` citations, `code`, stat labels |

Full system fallbacks are in the token stacks — the site must render
offline. Type scale tokens: `--text-xs` 12 · `--text-sm` 14 · `--text-base`
16 (body) · `--text-md` 18 · `--text-lg` 22 · `--text-xl` 28 (h2) ·
`--text-2xl` 38 (inner h1) · `--text-3xl` 52 (hero/404). Body line-height
1.65–1.7; headings 1.15.

## 4. Layout

- `.container` / `.page` cap content at `--container` (1120px) with
  `--gutter` side padding (16px below 560px).
- Header is **sticky**, 2px bottom border: brand (pixel face + 9px emerald
  square) · `.site-nav` (scrollable row, active link = GBA menu-cursor `▶`
  + emerald underline) · `.site-search-trigger` (icon-only search button,
  opens the `.search-palette` overlay) · `.version-toggle` (right). Above
  820px the header is **always one row**: when brand + full nav + toggle
  don't fit, the nav row shrinks and scrolls horizontally (scrollbar hidden)
  instead of wrapping the toggle to a second row. Below 820px the nav wraps
  to a full-width scrollable second row; brand + trigger + toggle stay on
  row 1. This must never break at 360px — verify with a screenshot at that
  width.
- Sections: `.section` owns vertical rhythm (`--space-6` padding-block);
  `.section__head > * + *` provides the 8px stack gap — **do not add your
  own margins between eyebrow/title/intro** (the `> *` margin reset is
  deliberate and load-bearing).
- Prose: paragraphs cap at 70ch; lists are plain with token spacing.

## 5. Signature elements

### 5.1 The run path (home hero + gameplay diagrams)

A pure-CSS rendering of a generated adventure path:
hub (filled emerald square) → route node → **fork of two lanes** → boss
(gold diamond, rotated square). Three instances, all decorative
(`aria-hidden="true"` on the root, with the meaning carried by visible
captions or surrounding prose):

- **Index hero** — one per site. **The binding markup is in the comment
  block above `.run-path` in `pages.css`** — copy it verbatim.
- **Gameplay labelled segment** (`.run-path--labeled`) — a *typical*
  Classic 5-column segment read left to right, mixing the room types a
  player usually encounters: hub → route → rest stop (dashed) → gap
  (hollow) → split (the fork of two lanes — two or three in the game) →
  boss. Each step sits in a `.run-path__cell` column wrapper with a
  mono `.run-path__label` caption under it (in `--font-mono` /
  `--text-xs` / `--color-muted`); links are a touch tighter so the
  labelled row fits at 360px.
- **Gameplay wild-den callout** — a Fast Path hidden-route segment
  (hub → den nodes → boss) drawn with the same labelled structure.

Nodes are `<span>`s, never images. Node classes: base `.run-path__node`,
`--hub` (filled emerald), `--rest` (dashed outline), `--gap` (hollow
square, dashed `--color-line` outline — the trail skips ahead), `--den`
(gold square outline — the hollow sibling of the boss diamond),
`--boss` (gold diamond). Motion: a slow staggered brightness wave, already gated
behind `prefers-reduced-motion: no-preference` — do not add per-page
animations to it.

### 5.2 The version toggle

A segmented switch in the sticky header (`.version-toggle` >
`.version-toggle__option[data-version]` buttons, emitted by `js/nav.js`).
**Each edition fills with its own hue when active** — Vanilla → emerald,
EX → gold. The active state is styled from both the
`.version-toggle__option--active` modifier *and*
`[aria-pressed="true"]`; keep both selectors in sync if you touch it.
Page content reacts to version changes via `ROGUE.filter()` /
`ROGUE.onChange()` (see `js/version.js`), not by restyling the header.

### 5.3 Supporting motifs (do not invent new ones)

- Eyebrow: pixel-face uppercase label with a solid 8px emerald square
  prefix (`.eyebrow::before`).
- Active nav link: `▶` cursor + emerald underline (GBA menu selection).
- Dashed rule above `.card__source` (the "cited fact").
- Pixel-grid page texture (set on `body`, not per page).

## 6. Components

All contract classes are styled in `components.css`; the header/footer/toggle
classes in `base.css`. **Use only these classes** (plus `pages.css` scaffolds
under your own `.page--<stem>`):

| Class | Notes |
| --- | --- |
| `.container` | max-width wrapper (used by header/footer) |
| `.section` / `.section__head` / `.section__body` | section scaffolding; head = eyebrow+title+intro; body = content. `ROGUE.proseSections()` emits exactly this. |
| `.eyebrow` | pixel label, emerald square prefix, always sentence-case source text uppercased in CSS |
| `.grid` | auto-filling card grid (min 240px columns); put cards/links directly inside |
| `.card` / `.card__head` / `.card__title` / `.card__desc` / `.card__source` | record card as emitted by `ROGUE.cards()`: head = title + `.badge` |
| `.card--link` | whole-card `<a>` (home quick links); hover lift is motion-gated |
| `.table` | `ROGUE.table()` output; block-scrolled on mobile; header row is mono uppercase on `--color-raised` |
| `.chip` | mono tag (types, regions, modes). Neutral by default; new per-type colors = new token + new row in §2, same task |
| `.chip-row` | flex-wrap container for inline `.chip`s (quest flags, forced toggles, option lists) |
| `.field-label` | small mono uppercase label above a card field (quests: Trigger/Requirements/Rewards; config: forced toggles/options) |
| `.card__diff` | per-version "Differs in …" footnote on a record card (emitted by `ROGUE.diffNote` on hub/safari/routes/mechanics/quests) |
| `.badge` / `.badge--vanilla` / `.badge--ex` / `.badge--both` | version badge from `ROGUE.badgeClass()`: solid fill, dark text, one hue per edition (§2). Do not restyle per page. |
| `.search` | filter input: `<input class="search">` or `<div class="search"><input …>` |
| `.search-palette*` (`__backdrop` `__panel` `__form` `__input` `__count` `__empty` `__list` `__row` `__row-head` `__row-name` `__row-snippet` `__row-meta`) | site-wide search overlay (a `role="dialog"` command palette) emitted by `js/search.js` from the data/site.json `search` config; opened by the header's `.site-search-trigger` or the `search.shortcut` key; sits below the sticky header so the version toggle can re-scope open results; the box reuses `.search` input styling |
| `.tabs` / `.tabs__tab` | `role="tablist"` / `role="tab"` buttons with `aria-selected`; see markup convention in `components.css` |
| `.version-toggle` / `.version-toggle__option` | see §5.2 (styled in `base.css`) |
| `.site-brand` `.site-nav` `.site-nav__link(-–active)` `.site-search-trigger` `.site-header__inner` `.site-footer__inner` `.site-footer__source` | emitted by `js/nav.js` — do not hand-write or restyle (the trigger's overlay is `.search-palette`, above) |
| `.hero` `.hero__subtitle` `.hero__stats` `.hero__stat(-value/-label)` `.run-path*` (incl. `--labeled`, `__cell`, `__label`, `--den`/`--gap` nodes) `.path-diagram(-__caption)` `.rooms__den` | index hero + run path, emitted by `js/pages/home.js` (including the run-path markup); the labelled segment + wild-den path diagrams on the gameplay page, emitted by `js/pages/gameplay.js`; run-path rules in `pages.css` (unscoped family), figure scaffolds under `.page--gameplay` |

## 7. Motion

Budget (all already implemented — **reuse, don't invent**): page/header
entrance (480ms, once), hover color/border (120ms), card lift + toggle
(220ms, transform only under `no-preference`), run-path pulse (2.8s loop).
Every animation and transform in the site lives inside
`@media (prefers-reduced-motion: no-preference)`; the `reduce` kill switch
in `base.css` is final. If a page wants to animate, the pattern is: define
the `@keyframes` in `pages.css` under your `.page--<stem>` scope and apply
it only inside the `no-preference` block.

## 8. Accessibility

- **Focus:** one global `:focus-visible` style (2px emerald outline, 2px
  offset) from `base.css`. Never `outline: none` without a replacement.
- **Contrast:** WCAG AA minimum for all text (values in §2); dark
  `--color-bg` text on any badge fill.
- **Semantics:** header/nav/footer are landmarks (injected by `nav.js`);
  keep `<main class="page page--<stem">` as the only main landmark; tables
  keep `<th scope="col">` (from `ROGUE.table()`); the run path and any
  decorative motif is `aria-hidden="true"`; tabs use `role`/`aria-selected`
  (see §6).
- **Reduced motion:** see §7.

## 9. Responsive

Breakpoints (media queries can't read tokens — values live in
`tokens.css` header comment, kept in sync here):

| Width | Changes |
| --- | --- |
| ≤ 1024px | `.grid` naturally drops a column (auto-fill) |
| ≤ 820px | header: brand + toggle on row 1, nav on full-width scrollable row 2; hero stats 2×2 |
| ≤ 560px | gutter 16px; brand 0.875rem (the 14px display-floor); compact header row (8px gaps, 28px search trigger, tighter toggle options) so brand + trigger + toggle fit one row at 360px; h1 2rem; grid 1 column |

**Rule: the site must not break at 360px** (nav scrolls, tables scroll via
`.table`'s overflow, run path fits at ~210px). Screenshot-verify at 360px
in the task that touches the header, a table, or the hero.

## 10. Do / Don't

**Do**
- Take every color from the `--color-*` tokens; every size from the
  spacing/type/radius/motion tokens.
- Use contract classes; scope page-specific rules under `.page--<stem>`.
- Cite facts in records (`source` field) — the mono citation styling is
  part of the identity.
- Keep headings in the pixel face and body in the sans.

**Don't**
- Don't add font families, weights, or CDN links (two families, fixed).
- Don't introduce colors outside `tokens.css` — including hex in shadows,
  gradients, or `rgba()` literals. **No gradients anywhere**; fills are
  solid.
- Don't restyle `.badge*`, the version toggle, or `.site-*` header/footer
  classes from a page task.
- Don't add margins between `.section__head` children or `.section`
  padding-block overrides that fight the rhythm (override only inside your
  `.page--<stem>` scope, and only where a layout truly needs it).
- Don't copy any asset, sprite, or image from `references/` (license).
  CSS/SVG/typography only; SVG must be inline, token-colored.
- Don't number sections with "01 / 02 / 03" markers — numbering is only
  for true sequences (e.g. the 14-boss ladder, Legends Cave steps).

## 11. Extending the system

1. **New component** → style it in `components.css` (generic, reusable) and
   document it in §6 **in the same task**.
2. **Page-specific layout** → `pages.css`, under your `.page--<stem>`
   block only.
3. **New color/hue** → named token in `tokens.css` + row in §2, same task.
4. **New motion** → follow §7 (no-preference gate, pages.css scope).
5. After changing any of the above, re-run `npm run build` + `npm test` and
   screenshot the affected page at 1280px and 360px.

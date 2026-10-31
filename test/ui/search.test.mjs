/**
 * Site-wide search overlay suite (node --test, zero deps; Playwright
 * resolved by the harness) — the command-palette dialog that site/js/search.js
 * appends to <body>, fed by the version-independent index of
 * site/js/search-index.js. Plus the pre-existing in-page search regressions
 * (quests/hub filters, routes region chips) which no other UI suite exercises.
 *
 * DOM contract (stable ids documented in site/js/search.js):
 *   #site-search-trigger    the header button nav.js emits (aria-label "Search
 *                           the site") — click TOGGLES the palette
 *   #search-palette         the root (hidden attr + .search-palette--open)
 *   .search-palette__input  the input (focused on open; aria-activedescendant)
 *   .search-palette__count  the live count line (role="status")
 *   .search-palette__empty  the empty state (role="status"; the config hint)
 *   #search-palette-list    the results list (role="listbox")
 *   .search-palette__row    rows #search-result-<i> (role="option";
 *                           .search-palette__row-name / -snippet / -meta;
 *                           [data-active] on the active row; a .badge--ex /
 *                           .badge--vanilla when the entry is single-version)
 * Interaction: open via trigger or the search.shortcut key ("/" — suppressed
 * while a text entry holds focus, and while open it simply types "/" into the
 * already-focused input); ArrowUp/Down move the active row with wrap-around;
 * Enter on a cross-page entry sets location.href to the relative
 * "page.html#anchor", on the SAME page it scrolls to the anchor without a
 * reload or URL change; Escape / backdrop / trigger / a successful Enter close
 * (resetting the query and restoring focus to the element focused before the
 * open — the trigger in every session this suite drives: a trigger click, or
 * the "/" shortcut with the body focus, which falls back to the trigger);
 * an open palette
 * re-scopes live on a version toggle (it is z-ordered BELOW the sticky
 * header, so the toggle stays clickable while open).
 *
 * Every expectation is a literal derived from the cited data file + the real
 * index (the same ROGUE.buildSearchIndex/ROGUE.searchQuery the browser runs,
 * verified against data/*.json at test-authoring time — see the "Derived
 * literals" block):
 *   "mega evolution"  — under EX: 4 rows, row 0 the EX-only quest
 *                       "Mega Evolution" (data/quests.json versions ["ex"])
 *                       → ./quests.html#quest-default_challenges; under
 *                       Vanilla: 2 rows, none of them that quest row.
 *                       Under "mega": 12 rows in EX.
 *   "national gen3"   — the Vanilla-side description of "The Final Run."
 *                       (data/quests.json differences.vanilla: "…National
 *                       Gen3…"; the EX description says Gen9). The only entry
 *                       in the whole 569-entry index containing "gen3" →
 *                       exactly 1 row under BOTH versions.
 *   "/" (a second press while open) — 37 index entries contain a "/" → the
 *                       search.maxResults cap (data/site.json: 30) applies.
 *   "zzqxwvnotthere"  — 0 rows under both versions.
 *
 * In-page literals (the active version's rendered card text):
 *   quests.html EX  "mega evolution" → 1 card (the "Mega Evolution" quest),
 *   group default_challenges the only visible group (8 of 9 hidden);
 *   hub.html "unique" → 8 of 48 upgrades; routes.html Hoenn → 12 of 36.
 *
 * Waiting is always on a DOM state (the count line, aria-activedescendant,
 * the anchor's bounding box) with a bounded timeout — no arbitrary sleeps;
 * the css `scroll-behavior: smooth` (base.css, prefers-reduced-motion:
 * no-preference) makes scroll assertions waits, not instant reads.
 *
 * Viewports: the open/type/navigate/close cycle runs at both 1280×800 (the
 * default openPage size — the cross-page test) and 360×640 (the explicit
 * mobile cycle, which also asserts no horizontal overflow with the palette
 * open). One shared browser launch per the harness.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- derived literals ------------------------------------------------------ */

const PLACEHOLDER = site.search.placeholder; // input placeholder + aria-label
const HINT = site.search.hint; // the empty-query hint in .search-palette__empty
const MAX_RESULTS = site.search.maxResults; // the searchQuery result cap

const Q_OPEN = '\u201C'; // the count line's curly quotes (search.js renderQuery)
const Q_CLOSE = '\u201D';
const COUNT = (n, query) => (n === 1 ? `1 result match ${Q_OPEN}${query}${Q_CLOSE}` : `${n} results match ${Q_OPEN}${query}${Q_CLOSE}`);
const NO_RESULTS = (query) => `No results match ${Q_OPEN}${query}${Q_CLOSE}.`;

/** The EX-only quest used for the version-scoping assertions (data/quests.json: versions ["ex"]). */
const EX_ONLY_QUEST = 'Mega Evolution';
/** Its deep link: the group section (same display_group in both builds → #quest-<group>). */
const EX_ONLY_QUEST_ANCHOR = '#quest-default_challenges';
/** The Vanilla-side-phrase quest (data/quests.json differences.vanilla description). */
const VANILLA_PHRASE = 'national gen3';
const VANILLA_PHRASE_QUEST = 'The Final Run.';
const NOISE = 'zzqxwvnotthere';

const SETTLE_TIMEOUT_MS = 10_000; // guard for the state waits (a bound, not a sleep)

/* --- shared page-context helpers (all must be self-contained) -------------- */

/** The overlay's observable state in one shot. */
const paletteFacts = () => {
  const root = document.getElementById('search-palette');
  const input = document.querySelector('.search-palette__input');
  const rows = [...document.querySelectorAll('.search-palette__row')].map((r) => ({
    id: r.id,
    name: r.querySelector('.search-palette__row-name')?.textContent.trim() ?? '',
    meta: r.querySelector('.search-palette__row-meta')?.textContent.trim() ?? '',
    snippet: (r.querySelector('.search-palette__row-snippet')?.textContent || '').trim(),
    exBadge: !!r.querySelector('.badge--ex'),
    active: r.hasAttribute('data-active'),
  }));
  return {
    open: root ? !root.hidden : false,
    openClass: root ? root.classList.contains('search-palette--open') : false,
    inputFocused: !!input && document.activeElement === input,
    activeElementId: document.activeElement ? document.activeElement.id || null : null,
    inputValue: input ? input.value : null,
    placeholder: input ? input.getAttribute('placeholder') : null,
    count: (document.querySelector('.search-palette__count')?.textContent || '').trim(),
    countVisible: document.querySelector('.search-palette__count')?.hidden === false,
    empty: (document.querySelector('.search-palette__empty')?.textContent || '').trim(),
    emptyVisible: document.querySelector('.search-palette__empty')?.hidden === false,
    listVisible: document.getElementById('search-palette-list')?.hidden === false,
    rows: rows,
    activedescendant: input ? input.getAttribute('aria-activedescendant') : null,
  };
};

/** Wait until the count line reads exactly `text` (the live-filter settle point). */
async function waitForCount(page, text, ctx) {
  await page.waitForFunction(
    (t) => (document.querySelector('.search-palette__count')?.textContent || '').trim() === t,
    text,
    { timeout: SETTLE_TIMEOUT_MS }
  );
  const got = await page.evaluate(() => (document.querySelector('.search-palette__count')?.textContent || '').trim());
  assert.equal(got, text, `${ctx}: count line should read ${JSON.stringify(text)}, got ${JSON.stringify(got)}`);
}

/** Wait until the palette is open (the open action itself, as a DOM state). */
async function waitForOpen(page, ctx) {
  await page.waitForFunction(() => document.getElementById('search-palette') && !document.getElementById('search-palette').hidden, null, { timeout: SETTLE_TIMEOUT_MS });
  assert.equal(
    await page.evaluate(() => document.getElementById('search-palette').hidden === false),
    true,
    `${ctx}: the palette should be open`
  );
}

/** Wait until the palette is closed. */
async function waitForClosed(page, ctx) {
  await page.waitForFunction(() => document.getElementById('search-palette').hidden === true, null, { timeout: SETTLE_TIMEOUT_MS });
}

/** Type into the palette input (fill fires the input event → renderQuery; callers settle on the count line). */
async function typeQuery(page, query) {
  await page.fill('.search-palette__input', query);
}

/** Assert the document has no horizontal overflow (DESIGN.md §9 at 360px). */
async function assertNoOverflow(page, ctx) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `${ctx}: horizontal overflow with the palette open: scrollWidth exceeds innerWidth by ${over}px`);
}

/** Wait until the anchored element is inside the viewport (smooth scroll settles). */
async function waitForAnchorInViewport(page, anchorId, ctx) {
  await page.waitForFunction(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= -1 && r.top <= window.innerHeight;
    },
    anchorId,
    { timeout: SETTLE_TIMEOUT_MS }
  );
  const box = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, scrollY: window.scrollY, innerHeight: window.innerHeight };
  }, anchorId);
  assert.ok(box, `${ctx}: the target section #${anchorId} is missing from the loaded page`);
  assert.ok(box.top >= -1 && box.top <= box.innerHeight, `${ctx}: #${anchorId} is not in the viewport (top ${box.top}, innerHeight ${box.innerHeight})`);
  assert.ok(box.scrollY > 100, `${ctx}: the page should have scrolled to #${anchorId} (scrollY ${box.scrollY})`);
}

/** Assert the palette is closed and focus is back on the header trigger. */
async function assertClosedOnTrigger(page, ctx) {
  await waitForClosed(page, ctx);
  const f = await page.evaluate(paletteFacts);
  assert.equal(f.open, false, `${ctx}: the palette should be closed`);
  assert.equal(f.openClass, false, `${ctx}: the open class should be gone on close`);
  assert.equal(f.activeElementId, 'site-search-trigger', `${ctx}: focus should return to #site-search-trigger, got ${f.activeElementId}`);
}

/* --- the suite ------------------------------------------------------------- */

test('the default version is "ex" (the EX-side literals in this suite are derived from it)', () => {
  assert.equal(
    site.defaultVersion,
    'ex',
    'data/site.json defaultVersion changed — the initial-state search literals in test/ui/search.test.mjs are derived for "ex"; re-derive them before proceeding'
  );
});

test('index.html: the header trigger opens the palette (input focused, hint shown) and toggles it closed', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    const before = await page.evaluate(() => ({
      trigger: !!document.getElementById('site-search-trigger'),
      triggerLabel: document.getElementById('site-search-trigger')?.getAttribute('aria-label') ?? null,
      hidden: document.getElementById('search-palette')?.hidden === true,
    }));
    assert.equal(before.trigger, true, 'nav.js should have emitted the #site-search-trigger button in the header');
    assert.equal(before.triggerLabel, 'Search the site', 'the trigger aria-label (nav.js — the site.json search block has no label field)');
    assert.equal(before.hidden, true, 'the palette root should start hidden');

    await page.click('#site-search-trigger');
    await waitForOpen(page, 'index.html (trigger open)');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'clicking the trigger should open the palette');
    assert.equal(f.openClass, true, 'the open modifier class should be present');
    assert.equal(f.inputFocused, true, 'the palette input should hold focus when open');
    assert.equal(f.placeholder, PLACEHOLDER, `the input placeholder comes from data/site.json search.placeholder (${JSON.stringify(PLACEHOLDER)})`);
    assert.equal(f.emptyVisible, true, 'an empty query shows the empty-state element');
    assert.equal(f.empty, HINT, `the empty state shows the config hint (data/site.json search.hint: ${JSON.stringify(HINT)})`);
    assert.equal(f.countVisible, false, 'the count line stays hidden for an empty query');
    assert.equal(f.listVisible, false, 'the list stays hidden for an empty query');
    assert.equal(f.activedescendant, null, 'no aria-activedescendant with no rows');
    await assertNoOverflow(page, 'index.html (1280×800, palette open)');

    // the trigger toggles: a second click closes and restores focus
    await page.click('#site-search-trigger');
    await assertClosedOnTrigger(page, 'index.html (trigger toggle close)');
  } finally {
    await close();
  }
});

test('hub.html: "/" opens the palette, a second "/" types into it, Escape closes and the query resets on reopen', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'hub.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(await page.evaluate(() => document.getElementById('search-palette')?.hidden === true), true, 'the palette starts hidden');

    // first "/": opens (no "/" typed — the handler preventDefaults)
    await page.keyboard.press('/');
    await waitForOpen(page, 'hub.html ("/" open)');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'pressing the search.shortcut key should open the palette (data/site.json search.shortcut: "/")');
    assert.equal(f.inputFocused, true, 'the input should hold focus when open');
    assert.equal(f.inputValue, '', 'the opening "/" must not be typed into the input (preventDefault)');
    assert.equal(f.empty, HINT, 'the empty-query hint is shown on open');

    // second "/": the palette is already open → the key simply types into the
    // focused input (search.js: the shortcut does nothing special while open).
    // 37 index entries contain a "/", so the result is the maxResults cap.
    await page.keyboard.press('/');
    await page.waitForFunction(() => document.querySelector('.search-palette__input').value === '/', null, { timeout: SETTLE_TIMEOUT_MS });
    await waitForCount(page, COUNT(MAX_RESULTS, '/'), 'hub.html (second "/" — the capped result)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'a second "/" must not close the palette (it is not a toggle)');
    assert.equal(f.inputValue, '/', 'the second "/" is typed into the palette input');
    assert.equal(f.rows.length, MAX_RESULTS, `the capped result shows exactly ${MAX_RESULTS} rows (data/site.json search.maxResults; 37 index entries contain a "/")`);

    // Escape closes; reopening starts fresh (the query is reset)
    await page.keyboard.press('Escape');
    await assertClosedOnTrigger(page, 'hub.html (Escape close)');
    await page.click('#site-search-trigger');
    await waitForOpen(page, 'hub.html (reopen)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'the palette reopens');
    assert.equal(f.inputValue, '', 'closing resets the query — a reopen starts with an empty input');
    assert.equal(f.empty, HINT, 'a reopen shows the empty-query hint, not the previous query');
    assert.deepEqual(errors, [], `unexpected page errors across the open/type/close/reopen cycle: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('index.html: typing filters live — the count line and rows track the query (EX)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html' });
  try {
    await page.click('#site-search-trigger');
    await waitForOpen(page, 'index.html (trigger open)');
    await typeQuery(page, 'mega');
    await waitForCount(page, COUNT(12, 'mega'), 'index.html (EX, "mega")');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 12, 'data-derived: 12 index entries match "mega" under EX (title starts/includes or body)');
    assert.equal(f.emptyVisible, false, 'the hint disappears once a query has results');
    assert.equal(f.listVisible, true, 'the listbox is visible with results');

    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'index.html (EX, "mega evolution")');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 4, 'data-derived: exactly 4 index entries match "mega evolution" under EX (searchQuery over the 569-entry index)');
    const row0 = f.rows[0];
    assert.equal(row0.id, 'search-result-0', 'row ids are #search-result-<i>');
    assert.equal(row0.name, EX_ONLY_QUEST, 'the tier-0 title match ranks first: the EX-only quest "Mega Evolution" (data/quests.json)');
    assert.equal(row0.meta, site.pages.quests.title, 'the row meta is the page nav title from data/site.json ("Quests"), never the raw filename');
    assert.equal(row0.exBadge, true, 'the single-version entry (versions ["ex"]) wears the .badge--ex badge (search.js rowHtml)');
    assert.ok(row0.snippet.length > 0, 'every row carries a snippet around the match');
    assert.equal(f.activedescendant, 'search-result-0', 'the first row is active on render (setActive(0))');
    assert.equal(f.rows.filter((r) => r.active).length, 1, 'exactly one row carries [data-active]');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('quests.html (?version=vanilla): the EX-only quest is absent, the Vanilla-side phrase still matches', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html', version: 'vanilla' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(new URL(page.url()).searchParams.get('version'), 'vanilla', 'the ?version= param drives this load (harness openPage option)');

    // the header trigger on a content page
    await page.click('#site-search-trigger');
    await waitForOpen(page, 'quests.html (trigger open)');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'the trigger opens the palette on the quests page too');

    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(2, 'mega evolution'), 'quests.html (Vanilla, "mega evolution")');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 2, 'data-derived: only the 2 shared-version entries match "mega evolution" under Vanilla');
    assert.equal(
      f.rows.some((r) => r.name === EX_ONLY_QUEST),
      false,
      `the EX-only quest "${EX_ONLY_QUEST}" (data/quests.json versions ["ex"]) must be absent from results under Vanilla (query-time scoping)`
    );
    assert.equal(f.rows.every((r) => !r.exBadge), true, 'no .badge--ex row under Vanilla — every surviving entry is shared or Vanilla');

    // the Vanilla-side wording (data/quests.json differences.vanilla: "…National Gen3…"):
    // the only "gen3" text in the whole index is that side of this quest
    await typeQuery(page, VANILLA_PHRASE);
    await waitForCount(page, COUNT(1, VANILLA_PHRASE), 'quests.html (Vanilla, "national gen3")');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 1, 'exactly one index entry contains "gen3" anywhere: "The Final Run."');
    assert.equal(f.rows[0].name, VANILLA_PHRASE_QUEST, 'the Vanilla-side phrase matches its quest under Vanilla');
  } finally {
    await close();
  }
});

test('quests.html: the OPEN palette re-scopes live on a version toggle (the header stays clickable above it)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    await page.click('#site-search-trigger');
    await waitForOpen(page, 'quests.html (trigger open)');
    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'quests.html (EX open, "mega evolution")');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.rows[0].name, EX_ONLY_QUEST, 'under EX the first row is the EX-only quest');

    // the palette is z-ordered BELOW the sticky header — the toggle click
    // lands while the palette is open, and results re-scope live (search.js
    // ROGUE.onChange subscription)
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await waitForCount(page, COUNT(2, 'mega evolution'), 'quests.html (live toggle to Vanilla)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'the palette stays open across the version toggle');
    assert.equal(f.inputValue, 'mega evolution', 'the query survives the re-scope');
    assert.equal(f.rows.length, 2, 'the re-scoped result drops the 2 EX-only matches (4 → 2)');
    assert.equal(f.rows.some((r) => r.name === EX_ONLY_QUEST), false, 'the EX-only quest row drops out under Vanilla');

    // and back to EX
    await page.click('.version-toggle__option[data-version="ex"]');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'quests.html (live toggle back to EX)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 4, 'toggling back restores the EX-scoped result (2 → 4)');
    assert.equal(f.rows[0].name, EX_ONLY_QUEST, 'the EX-only quest is first again');
    assert.deepEqual(errors, [], `unexpected page errors across the toggle re-scope: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('index.html: a nonsense query shows the no-results message with no rows', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html' });
  try {
    await page.click('#site-search-trigger');
    await page.fill('.search-palette__input', NOISE);
    await waitForCount(page, NO_RESULTS(NOISE), 'index.html (nonsense query)');
    const f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 0, 'no rows for a non-matching query');
    assert.equal(f.listVisible, false, 'the listbox is hidden when empty');
    assert.equal(f.emptyVisible, false, 'the empty-state (hint) is hidden for a non-empty query');
    assert.equal(f.activedescendant, null, 'no active row');
    assert.deepEqual(errors, [], `the empty state must render with zero console errors, got: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

/**
 * Pixel guard for the suppressed native clear button (components.css hides
 * ::-webkit-search-cancel-button on every .search input): screenshots the
 * input's right interior — exactly where the browser paints the ✕ — and
 * asserts there are no browser-blue pixels (the ✕ renders in a blue that is
 * a hue outside tokens.css; DESIGN.md §2/§10). Screenshots of the pre-fix
 * state show ~430 such pixels (sample #30618e) in this region; the fixed
 * state shows zero, so the threshold (blue dominance > 20) has wide
 * margin. (getComputedStyle on the pseudo-element returns the UA style and
 * cannot see the author rule — the rendered pixels are the end result.)
 */
async function assertNoNativeClearButton(page, selector, ctx) {
  const el = await page.$(selector);
  await el.scrollIntoViewIfNeeded(); // the in-page filters sit below the fold (page.screenshot clips to the viewport)
  const box = await el.boundingBox();
  const clip = {
    x: Math.round(box.x + box.width - 60),
    y: Math.round(box.y + box.height / 2 - 10),
    width: 52,
    height: 20
  };
  const buf = await page.screenshot({ clip, type: 'png' });
  const blue = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 2] - Math.max(d[i], d[i + 1]) > 20) n++;
    }
    return n;
  }, 'data:image/png;base64,' + buf.toString('base64'));
  assert.equal(blue, 0, `${ctx}: the input's right interior must be free of browser-blue pixels (the native type="search" clear ✕ is suppressed — a hue outside tokens.css, DESIGN.md §2/§10); found ${blue}`);
}

test('every .search input suppresses the browser-native clear button (off-token blue ✕ — DESIGN.md §2/§10)', async (t) => {
  if (skipIfNoPlaywright(t)) return;

  // quests page: the in-page quest filter + the site palette input (emitted on every page)
  const q = await openPage({ path: 'quests.html' });
  try {
    await q.page.fill('#quest-search', 'x'); // non-empty: the native button would paint without the rule
    await assertNoNativeClearButton(q.page, '#quest-search', 'quests filter (a .search input)');
    await q.page.click('#site-search-trigger');
    await waitForOpen(q.page, 'cancel-guard (palette open)');
    await q.page.fill('.search-palette__input', 'x');
    await assertNoNativeClearButton(q.page, '.search-palette__input', 'search-palette input (reuses the .search styling)');
    assert.deepEqual(q.errors, [], `unexpected page errors: ${q.errors.join('; ')}`);
  } finally {
    await q.close();
  }

  // hub page: the upgrades filter
  const h = await openPage({ path: 'hub.html' });
  try {
    await h.page.fill('#hub-search', 'x');
    await assertNoNativeClearButton(h.page, '#hub-search', 'hub upgrades filter (a .search input)');
    assert.deepEqual(h.errors, [], `unexpected page errors: ${h.errors.join('; ')}`);
  } finally {
    await h.close();
  }
});

test('index.html: ArrowDown/ArrowUp move the active row with wrap-around; Escape closes', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html' });
  try {
    await page.click('#site-search-trigger');
    await waitForOpen(page, 'index.html (trigger open)');
    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'index.html (keyboard nav)');

    const active = async () => {
      const f = await page.evaluate(paletteFacts);
      return { ad: f.activedescendant, active: f.rows.filter((r) => r.active).map((r) => r.id) };
    };

    assert.equal((await active()).ad, 'search-result-0', 'row 0 is active after the query renders');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(await active(), { ad: 'search-result-1', active: ['search-result-1'] }, 'ArrowDown moves the active row to 1 (aria-activedescendant + [data-active])');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(await active(), { ad: 'search-result-0', active: ['search-result-0'] }, 'ArrowDown from the last row WRAPS to row 0 (4 presses over 4 rows)');
    await page.keyboard.press('ArrowUp');
    assert.deepEqual(await active(), { ad: 'search-result-3', active: ['search-result-3'] }, 'ArrowUp from row 0 WRAPS to the last row (row 3)');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    await page.keyboard.press('Escape');
    await assertClosedOnTrigger(page, 'index.html (Escape close)');
  } finally {
    await close();
  }
});

test('index.html: Enter on a CROSS-page entry navigates to the relative page.html#anchor', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors on index.html: ${errors.join('; ')}`);

    await page.click('#site-search-trigger');
    await waitForOpen(page, 'index.html (trigger open)');
    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'index.html (cross-page Enter)');

    await page.keyboard.press('Enter');

    // row 0 = the EX-only quest → relative './quests.html' + '#quest-default_challenges'
    await page.waitForFunction(() => /quests\.html#quest-default_challenges$/.test(window.location.href), null, { timeout: SETTLE_TIMEOUT_MS });
    assert.ok(
      page.url().endsWith(`quests.html${EX_ONLY_QUEST_ANCHOR}`),
      `location.href should end with the relative "quests.html${EX_ONLY_QUEST_ANCHOR}", got ${page.url()}`
    );
    // the target page rendered cleanly
    await page.waitForFunction(() => typeof window.ROGUE !== 'undefined' && (document.querySelector('main')?.textContent || '').trim().length > 0, null, { timeout: SETTLE_TIMEOUT_MS });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.quest-card').length), 232, 'the quests page rendered its full log (data/quests.json: 232 under EX)');
    // the browser scrolled to the anchor (accounting for the sticky header via the section scroll-margin)
    await waitForAnchorInViewport(page, 'quest-default_challenges', 'cross-page Enter');
    assert.equal((await page.evaluate(paletteFacts)).open, false, 'a successful Enter closes the palette');
    assert.deepEqual(errors, [], `unexpected console errors after navigation, got: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('quests.html: Enter on a SAME-page entry scrolls to the anchor WITHOUT a reload or URL change', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    await page.keyboard.press('/');
    await waitForOpen(page, 'quests.html ("/" open)');
    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), 'quests.html (same-page Enter)');
    const f0 = await page.evaluate(paletteFacts);
    assert.equal(f0.rows[0].meta, site.pages.quests.title, 'row 0 targets the quests page — the CURRENT page');

    // start at the top so the scroll is measurable; count any navigation
    await page.evaluate(() => window.scrollTo(0, 0));
    const urlBefore = page.url();
    let navigations = 0;
    page.on('framenavigated', () => {
      navigations += 1;
    });

    await page.keyboard.press('Enter');

    // the (possibly smooth) scroll settles into the wait below
    await waitForAnchorInViewport(page, 'quest-default_challenges', 'same-page Enter');
    assert.equal(navigations, 0, 'same-page activation must not navigate (no framenavigated event)');
    assert.equal(page.url(), urlBefore, 'same-page activation must not change the URL (no hash added)');
    assert.equal((await page.evaluate(paletteFacts)).open, false, 'the palette closes on Enter');
    assert.equal((await page.evaluate(paletteFacts)).activeElementId, 'site-search-trigger', 'focus returns to the trigger');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('quests.html: with focus inside the in-page quest search, "/" does NOT open the palette', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    await page.click('#quest-search');
    await page.keyboard.press('/');

    const f = await page.evaluate(() => ({
      paletteHidden: document.getElementById('search-palette')?.hidden === true,
      questValue: document.getElementById('quest-search').value,
    }));
    assert.equal(f.paletteHidden, true, 'the shortcut is suppressed while a text entry holds focus (search.js isTypingTarget)');
    assert.equal(f.questValue, '/', 'the "/" is typed into the in-page quest search instead (it keeps its own "/")');
  } finally {
    await close();
  }
});

test('quests.html (in-page regression): the quest search filters cards, updates the count line and hides empty groups', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    const visibleGroups = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.quest-group')].filter((g) => !g.hidden).map((g) => g.getAttribute('data-group'))
      );

    // EX: "mega evolution" matches exactly one card (the quest itself)
    await page.fill('#quest-search', 'mega evolution');
    await page.waitForFunction(() => (document.getElementById('quest-result')?.textContent || '').includes('match'), null, { timeout: SETTLE_TIMEOUT_MS });
    const q1 = await page.evaluate(() => ({
      line: (document.getElementById('quest-result')?.textContent || '').trim(),
      visible: [...document.querySelectorAll('.quest-card')].filter((c) => !c.hidden).length,
      visibleNames: [...document.querySelectorAll('.quest-card')].filter((c) => !c.hidden).map((c) => c.querySelector('h3.card__title').textContent.trim()),
    }));
    assert.equal(q1.line, `1 quest match ${Q_OPEN}mega evolution${Q_CLOSE}`, 'the live count line reads "1 quest match …" (quests.js applyFilter, no verb agreement)');
    assert.equal(q1.visible, 1, 'exactly one card matches under EX (data/quests.json: only the "Mega Evolution" card carries that text in its EX variant)');
    assert.deepEqual(q1.visibleNames, [EX_ONLY_QUEST], 'the matching card is the "Mega Evolution" quest');
    assert.deepEqual(await visibleGroups(), ['default_challenges'], 'groups with no matches are hidden — only default_challenges stays (8 of 9 groups hidden)');

    // nonsense: empty state + every group hidden
    await page.fill('#quest-search', NOISE);
    await page.waitForFunction(() => document.querySelectorAll('.quest-group:not([hidden])').length === 0, null, { timeout: SETTLE_TIMEOUT_MS });
    const q2 = await page.evaluate(() => ({
      line: (document.getElementById('quest-result')?.textContent || '').trim(),
      visible: [...document.querySelectorAll('.quest-card')].filter((c) => !c.hidden).length,
    }));
    assert.equal(q2.line, `No quests match ${Q_OPEN}${NOISE}${Q_CLOSE}.`, 'the empty state message (quests.js applyFilter)');
    assert.equal(q2.visible, 0, 'no cards for a non-matching query');
    assert.deepEqual(await visibleGroups(), [], 'all 9 groups are hidden for a non-matching query');

    // clearing restores the full log
    await page.fill('#quest-search', '');
    await page.waitForFunction(() => (document.getElementById('quest-result')?.textContent || '').trim() === '232 quests', null, { timeout: SETTLE_TIMEOUT_MS });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.quest-card')].filter((c) => !c.hidden).length), 232, 'clearing the query restores all 232 EX cards');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('hub.html (in-page regression): the upgrades search filters the grid with a live count', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'hub.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    await page.fill('#hub-search', 'unique');
    await page.waitForFunction(() => (document.getElementById('hub-result')?.textContent || '').includes('match'), null, { timeout: SETTLE_TIMEOUT_MS });
    const h1 = await page.evaluate(() => ({
      line: (document.getElementById('hub-result')?.textContent || '').trim(),
      visible: [...document.querySelectorAll('.hub-upgrade')].filter((c) => !c.hidden).length,
    }));
    assert.equal(h1.line, `8 of 48 upgrades match ${Q_OPEN}unique${Q_CLOSE}`, 'the live count reads "8 of 48" (data/hub.json: 8 of the 48 upgrades carry "unique" in name/description/area)');
    assert.equal(h1.visible, 8, '8 upgrade cards stay visible');

    await page.fill('#hub-search', NOISE);
    await page.waitForFunction(() => [...document.querySelectorAll('.hub-upgrade:not([hidden])')].length === 0, null, { timeout: SETTLE_TIMEOUT_MS });
    const h2 = await page.evaluate(() => ({
      line: (document.getElementById('hub-result')?.textContent || '').trim(),
      visible: [...document.querySelectorAll('.hub-upgrade')].filter((c) => !c.hidden).length,
    }));
    assert.equal(h2.line, `No upgrades match ${Q_OPEN}${NOISE}${Q_CLOSE}.`, 'the empty state message (hub.js apply)');
    assert.equal(h2.visible, 0, 'no upgrade cards for a non-matching query');

    await page.fill('#hub-search', '');
    await page.waitForFunction(() => (document.getElementById('hub-result')?.textContent || '').trim() === '48 upgrades', null, { timeout: SETTLE_TIMEOUT_MS });
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('routes.html (in-page regression): the region chips change the visible route count', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    const routesState = () =>
      page.evaluate(() => ({
        line: (document.getElementById('routes-count')?.textContent || '').trim(),
        visible: [...document.querySelectorAll('.route-card')].filter((c) => !c.closest('.routes-region[hidden]')).length,
        hiddenRegions: [...document.querySelectorAll('.routes-region[hidden]')].map((g) => g.getAttribute('data-region')),
        pressed: [...document.querySelectorAll('.routes-filter__btn[aria-pressed="true"]')].map((b) => b.getAttribute('data-region')),
      }));

    assert.deepEqual(await routesState(), {
      line: '36 routes across all 4 regions',
      visible: 36,
      hiddenRegions: [],
      pressed: ['all'],
    }, 'the initial state: all 36 routes (data/routes.json) under the "all" filter');

    await page.click('.routes-filter__btn[data-region="Hoenn"]');
    await page.waitForFunction(() => (document.getElementById('routes-count')?.textContent || '').trim() === '12 routes in Hoenn', null, { timeout: SETTLE_TIMEOUT_MS });
    assert.deepEqual(await routesState(), {
      line: '12 routes in Hoenn',
      visible: 12,
      hiddenRegions: ['Kanto', 'Johto', 'Sinnoh'],
      pressed: ['Hoenn'],
    }, 'data/routes.json: 12 of the 36 routes are Hoenn; the other 3 region blocks are hidden');

    await page.click('.routes-filter__btn[data-region="all"]');
    await page.waitForFunction(() => (document.getElementById('routes-count')?.textContent || '').trim() === '36 routes across all 4 regions', null, { timeout: SETTLE_TIMEOUT_MS });
    assert.equal((await routesState()).visible, 36, '"All" restores all 36 routes');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360×640: the open/type/navigate/close cycle with no horizontal overflow and zero errors', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html', width: 360, height: 640 });
  try {
    assert.deepEqual(errors, [], `unexpected page errors on index.html (360×640): ${errors.join('; ')}`);

    // open
    await page.click('#site-search-trigger');
    await waitForOpen(page, '360×640 (trigger open)');
    let f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'the palette opens at 360×640');
    assert.equal(f.inputFocused, true, 'the input holds focus');
    await assertNoOverflow(page, '360×640 (palette open, empty query)');

    // type
    await typeQuery(page, 'mega evolution');
    await waitForCount(page, COUNT(4, 'mega evolution'), '360×640 (typing)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.rows.length, 4, 'the result is viewport-independent (the index depends on the version, not the viewport size)');
    await assertNoOverflow(page, '360×640 (palette open, 4 rows)');

    // navigate (cross-page Enter)
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /quests\.html#quest-default_challenges$/.test(window.location.href), null, { timeout: SETTLE_TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.ROGUE !== 'undefined' && (document.querySelector('main')?.textContent || '').trim().length > 0, null, { timeout: SETTLE_TIMEOUT_MS });
    await waitForAnchorInViewport(page, 'quest-default_challenges', '360×640 (cross-page Enter)');
    await assertNoOverflow(page, '360×640 (target page loaded)');

    // close: reopen with "/" and Escape
    await page.keyboard.press('/');
    await waitForOpen(page, '360×640 (reopen)');
    f = await page.evaluate(paletteFacts);
    assert.equal(f.open, true, 'the palette reopens on the target page');
    await assertNoOverflow(page, '360×640 (palette reopened)');
    await page.keyboard.press('Escape');
    await assertClosedOnTrigger(page, '360×640 (Escape close)');
    assert.deepEqual(errors, [], `unexpected console/page errors across the 360×640 cycle, got: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

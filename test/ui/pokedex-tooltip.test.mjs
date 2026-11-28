/**
 * The Pokedex tile tooltip (issue #171) — Playwright (resolved by the
 * harness; node --test, zero deps).
 *
 * Hovering or keyboard-focusing a grid tile reveals the entry's quick
 * overview in ONE shared `.dex-tip` node (a sibling of the stable
 * `#dex-grid`, `role="tooltip"`, aria-hidden — the detail page is the
 * accessible path): the entry's name + #NNN line, the entry's OWN type
 * chips (the issue-#173 `chip--<type>` family — a form entry shows the
 * FORM's typing, never the base's) and the six stat rows + BST. The
 * reveal is delegated on the grid (one listener set on `#dex-grid`,
 * never per-tile — the grid element survives `updateBrowse()`'s
 * innerHTML swaps), and the base tile's old native `title` is gone
 * (aria-labels carry the names). Positioning is measured: above the
 * tile by default, flipped below when it would clip the viewport top,
 * clamped horizontally — 360px must not scroll horizontally. Motion
 * (the 120ms reveal) lives in `prefers-reduced-motion: no-preference`
 * only.
 *
 * Coverage:
 *   1. the node contract — exactly one `.dex-tip`, a sibling of the
 *      grid, role="tooltip", aria-hidden at rest; zero
 *      `.dex-tile[title]`; every tile keeps its aria-label;
 *   2. hover — the first base tile's tooltip carries the derived
 *      entry's name/#NNN/types/stats+BST, sits ABOVE the tile, inside
 *      the viewport, aria-hidden false;
 *   3. a functional-form tile — the tooltip shows the FORM's own
 *      typing and stats (the fixture guard proves they differ from the
 *      base's, so the assertion is meaningful);
 *   4. mouseout — the tooltip closes (aria-hidden back to true);
 *   5. keyboard — Tab focuses the first tile and shows its tooltip
 *      (focus parity); Shift+Tab away closes it;
 *   6. delegation — paging (an updateBrowse grid swap) closes the
 *      tooltip AND the reveal still works on the swapped page (one
 *      listener on the stable grid, one shared node);
 *   7. flip — a tile near the viewport top (parked under the pinned
 *      sticky bar) gets its tooltip BELOW it, still inside the
 *      viewport;
 *   8. 360px — the open tooltip stays inside the viewport and causes
 *      no horizontal scroll;
 *   9. reduced motion — the reveal is instant (no transform, no
 *      120ms transition).
 *
 * Every expectation is derived from data/pokedex.json (+ site.json for
 * the page size) at load — never hardcoded from memory; the entry
 * mirror is the same one the forms suite pins (records in dex order,
 * base first, then the `functional: true` forms).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const PAGE_SIZE = Number(site && site.dex ? site.dex.pageSize : NaN);
if (!Number.isFinite(PAGE_SIZE) || PAGE_SIZE <= 0) throw new Error('data/site.json: missing a positive dex.pageSize');
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json: no records');

/* --- the entry-list mirror (site/js/pages/pokedex.js buildEntries) --------
 * Records in dex order, the base entry first, then its functional forms
 * in `forms`-array order; EX reads the record's top-level fields. */
const exRecords = records.filter((r) => Array.isArray(r.versions) && r.versions.includes('ex'));
const entries = [];
for (const rec of exRecords) {
  const baseTypes = Array.isArray(rec.types) ? rec.types : [];
  entries.push({ key: rec.id, record: rec, form: null, name: rec.name, dexNum: rec.dexNum, types: baseTypes, stats: rec.stats });
  (Array.isArray(rec.forms) ? rec.forms : []).forEach((f, i) => {
    if (f && f.functional === true) {
      entries.push({
        key: rec.id + '~' + i,
        record: rec,
        form: f,
        name: typeof f.name === 'string' ? f.name : '',
        dexNum: rec.dexNum,
        types: Array.isArray(f.types) ? f.types : baseTypes,
        stats: f.stats && typeof f.stats === 'object' ? f.stats : rec.stats,
      });
    }
  });
}
assert.ok(entries.length > PAGE_SIZE * 2, 'the EX entry list must fill at least two pages (the paging fixture)');

/* The stat row labels (site/js/pages/pokedex.js STAT_ROWS). */
const STAT_ROWS = [
  ['hp', 'HP'],
  ['atk', 'ATK'],
  ['def', 'DEF'],
  ['spa', 'SP.A'],
  ['spd', 'SP.D'],
  ['spe', 'SPE'],
  ['total', 'BST'],
];
/* The 18 EX-standard types the .chip--<type> modifier family names
 * (site/js/render.js TYPE_MODIFIERS) — anything else renders the plain
 * neutral .chip. */
const TYPE_MODIFIERS = new Set([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
]);

/** The tooltip's expected content for one entry (the entry's OWN data). */
const expectedTip = (e) => ({
  name: e.name,
  num: '#' + e.dexNum,
  /* the in-game representation repeats a mono type twice — the tooltip
   * shows the distinct types, in order */
  chips: (() => {
    const out = [];
    for (const t of e.types ?? []) {
      if (typeof t !== 'string' || out.some((x) => x.text === t)) continue;
      const key = t.trim().toLowerCase();
      out.push({ text: t, cls: 'chip' + (TYPE_MODIFIERS.has(key) ? ' chip--' + key : '') });
    }
    return out;
  })(),
  stats: STAT_ROWS.map(([key, label]) => {
    const v = Number(e.stats ? e.stats[key] : NaN);
    return { label, value: Number.isFinite(v) && v >= 0 ? v : 0 };
  }),
});

/* --- fixtures -------------------------------------------------------------- */

/* The first entry on page 1 — a BASE entry (the records are dex-ordered,
 * the base precedes its forms). */
const FIRST_BASE = entries[0];
assert.equal(FIRST_BASE.form, null, 'the fixture needs the first page-1 entry to be a base entry');

/* The first functional-form entry on page 1, whose own stats and name
 * DIFFER from its base's (the tooltip's "form's own data" contract only
 * means something when the data can tell them apart). */
const FIRST_FORM = entries.slice(0, PAGE_SIZE).find((e) => e.form !== null && e.form.stats && JSON.stringify(e.form.stats) !== JSON.stringify(e.record.stats) && e.name !== e.record.name);
assert.ok(FIRST_FORM, 'the fixture needs a page-1 functional-form entry with form-own stats');

/* Page 2's first entry (the delegation fixture — the default dex order is
 * the entry list's own order, so page 2 begins at index PAGE_SIZE). */
const PAGE2_FIRST = entries[PAGE_SIZE];
assert.ok(PAGE2_FIRST, 'the fixture needs a second page');

const SETTLE_TIMEOUT_MS = 10_000; // guard for the settle waits (a bound, not a sleep)

/** The rendered count line's stable prefix (node-side — serialized into the page waits). */
const EX_COUNT_PREFIX = entries.length + ' entries';

let server;
before(async () => {
  // No Playwright → every test self-skips; skip the dist/ build too so a
  // Playwright-less CI job does not race N concurrent builds against the
  // e2e suite's own build.
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- shared page-context helpers -------------------------------------------
 * The page.evaluate / waitForFunction callbacks are SERIALIZED into the
 * page context (no node-side free variables), so the collectors are
 * plain source strings. */
const TIP_FACTS_SRC = (
  () => {
    const tip = document.getElementById('dex-tip');
    const tile = tip ? (window.__tipTileKey ? document.querySelector('#dex-grid .dex-tile[data-dex-entry="' + window.__tipTileKey + '"]') : document.querySelector('#dex-grid .dex-tile')) : null;
    const stats = tip ? [...tip.querySelectorAll('.dex-tip__stat')].map((s) => ({
      label: s.querySelector('.dex-tip__label') ? s.querySelector('.dex-tip__label').textContent : '',
      value: s.querySelector('.dex-tip__value') ? s.querySelector('.dex-tip__value').textContent : '',
    })) : [];
    const cs = tip ? getComputedStyle(tip) : null;
    const rr = tip && cs && cs.visibility === 'visible' ? tip.getBoundingClientRect() : null;
    const tr = tile ? tile.getBoundingClientRect() : null;
    return {
      present: Boolean(tip),
      role: tip ? tip.getAttribute('role') : null,
      aria: tip ? tip.getAttribute('aria-hidden') : null,
      on: tip ? tip.classList.contains('dex-tip--on') : null,
      siblingsOfGrid: tip && tile ? tip.parentElement === tile.parentElement : null,
      name: tip && tip.querySelector('.dex-tip__name') ? tip.querySelector('.dex-tip__name').textContent : null,
      num: tip && tip.querySelector('.dex-tip__num') ? tip.querySelector('.dex-tip__num').textContent : null,
      chips: tip ? [...tip.querySelectorAll('.dex-tip__types .chip')].map((c) => ({ cls: c.className, text: c.textContent.trim() })) : [],
      stats,
      visibility: cs ? cs.visibility : null,
      opacity: cs ? cs.opacity : null,
      transform: cs ? cs.transform : null,
      transitionDuration: cs ? cs.transitionDuration : null,
      tipRect: rr ? { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom } : null,
      tileRect: tr ? { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom } : null,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }
).toString();
const tipFacts = (page) => page.evaluate((src) => new Function('return ' + src)()(), TIP_FACTS_SRC);

/** Wait for the settled (opacity 1) reveal on the no-preference default. */
const waitTipOn = (page) =>
  page.waitForFunction(() => {
    const cs = getComputedStyle(document.getElementById('dex-tip'));
    return cs.visibility === 'visible' && cs.opacity === '1';
  }, null, { timeout: SETTLE_TIMEOUT_MS });

/** Key the rect collection (in tipFacts) to the tile under test. */
const setTipTileKey = (page, key) => page.evaluate((k) => { window.__tipTileKey = k; }, key);

/** Wait for the tooltip to close. */
const waitTipOff = (page) =>
  page.waitForFunction(() => document.getElementById('dex-tip').getAttribute('aria-hidden') === 'true', null, { timeout: SETTLE_TIMEOUT_MS });

test('the node contract: one shared .dex-tip sibling of the grid, role="tooltip", aria-hidden at rest; no tile title; aria-labels kept', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const contract = await page.evaluate(() => {
      const grid = document.getElementById('dex-grid');
      const tips = [...document.querySelectorAll('.dex-tip')];
      const tiles = [...document.querySelectorAll('#dex-grid .dex-tile')];
      return {
        tipCount: tips.length,
        tipRole: tips[0] ? tips[0].getAttribute('role') : null,
        tipAria: tips[0] ? tips[0].getAttribute('aria-hidden') : null,
        tipOn: tips[0] ? tips[0].classList.contains('dex-tip--on') : null,
        tipParentIsGridParent: tips[0] && grid ? tips[0].parentElement === grid.parentElement : null,
        gridParentTag: grid && grid.parentElement ? grid.parentElement.className : null,
        titleTiles: tiles.filter((x) => x.hasAttribute('title')).length,
        tiles: tiles.length,
        ariaLabeled: tiles.filter((x) => typeof x.getAttribute('aria-label') === 'string' && x.getAttribute('aria-label').length > 0).length,
      };
    });
    assert.equal(contract.tipCount, 1, 'exactly ONE shared .dex-tip node (not one per tile)');
    assert.equal(contract.tipRole, 'tooltip', 'the node carries role="tooltip"');
    assert.equal(contract.tipAria, 'true', 'the node is aria-hidden at rest (nothing hovered yet)');
    assert.equal(contract.tipOn, false, 'the node is not in its --on state at rest');
    assert.equal(contract.tipParentIsGridParent, true, 'the node is a SIBLING of #dex-grid (the same parent)');
    assert.equal(contract.titleTiles, 0, 'no tile keeps a native title (the custom tooltip supersedes it)');
    assert.equal(contract.tiles, PAGE_SIZE, 'page 1 draws exactly pageSize tiles');
    assert.equal(contract.ariaLabeled, contract.tiles, 'every tile keeps its aria-label (the accessible names)');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('hover: the first base tile\u2019s tooltip carries its derived name, #NNN, types and six stats + BST, above the tile', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_BASE.key + '"]');
    await waitTipOn(page);
    const expected = expectedTip(FIRST_BASE);
    const facts = await tipFacts(page);
    assert.equal(facts.aria, 'false', 'the node is revealed (aria-hidden false) while its tile is hovered');
    assert.equal(facts.on, true, 'the node carries its --on state');
    assert.equal(facts.name, expected.name, `the tooltip names the entry (${expected.name})`);
    assert.equal(facts.num, expected.num, 'the tooltip carries the #NNN line');
    assert.deepEqual(
      facts.chips.map((c) => c.text),
      expected.chips.map((c) => c.text),
      'the tooltip shows the entry\u2019s distinct types, in order'
    );
    assert.deepEqual(
      facts.chips.map((c) => c.cls),
      expected.chips.map((c) => c.cls),
      'the type chips are the issue-#173 coloured chip--<type> family'
    );
    assert.deepEqual(
      facts.stats,
      expected.stats.map((s) => ({ label: s.label, value: String(s.value) })),
      'the tooltip carries the six stat rows + BST (HP/ATK/DEF/SP.A/SP.D/SPE/BST)'
    );
    /* above the tile by default, horizontally centred on it, inside the viewport */
    assert.ok(facts.tipRect && facts.tileRect, 'both rects measured (the reveal is visible)');
    assert.ok(facts.tipRect.b <= facts.tileRect.t, `the tooltip sits ABOVE the tile (bottom ${Math.round(facts.tipRect.b)} <= tile top ${Math.round(facts.tileRect.t)})`);
    const tipCenter = (facts.tipRect.l + facts.tipRect.r) / 2;
    const tileCenter = (facts.tileRect.l + facts.tileRect.r) / 2;
    assert.ok(Math.abs(tipCenter - tileCenter) <= 8, `the tooltip is centred on the tile (off by ${Math.abs(tipCenter - tileCenter).toFixed(1)}px)`);
    assert.ok(facts.tipRect.t >= 0 && facts.tipRect.l >= 0 && facts.tipRect.r <= 1280, 'the tooltip is inside the 1280px viewport');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('a functional-form tile: the tooltip shows the FORM\u2019s own typing and stats, not the base\u2019s', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await setTipTileKey(page, FIRST_FORM.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_FORM.key + '"]');
    await waitTipOn(page);
    const expected = expectedTip(FIRST_FORM);
    const baseExpected = expectedTip({ ...FIRST_FORM, name: FIRST_FORM.record.name, types: FIRST_FORM.record.types, stats: FIRST_FORM.record.stats });
    const facts = await tipFacts(page);
    assert.equal(facts.name, expected.name, `the tooltip names the FORM (${expected.name})`);
    assert.deepEqual(
      facts.stats,
      expected.stats.map((s) => ({ label: s.label, value: String(s.value) })),
      'the tooltip carries the FORM\u2019s own stats'
    );
    assert.notDeepEqual(facts.stats, baseExpected.stats.map((s) => ({ label: s.label, value: String(s.value) })),
      `the form\u2019s stats differ from the base\u2019s (the fixture guard — ${FIRST_FORM.form.name} is not its base)`);
    assert.deepEqual(facts.chips.map((c) => c.text), expected.chips.map((c) => c.text), 'the tooltip shows the FORM\u2019s own typing');
    assert.equal(facts.aria, 'false', 'the form tile\u2019s reveal is aria-hidden false');
    assert.ok(facts.tipRect.b <= facts.tileRect.t, 'the form tile\u2019s tooltip also sits above the tile');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('mouseout: the tooltip closes (aria-hidden back to true)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_BASE.key + '"]');
    await waitTipOn(page);
    await page.mouse.move(5, 5); /* off the grid, into the header */
    await waitTipOff(page);
    const facts = await tipFacts(page);
    assert.equal(facts.aria, 'true', 'the node is aria-hidden again');
    assert.equal(facts.on, false, 'the --on state is removed');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('keyboard: Tab focuses the first tile and shows its tooltip; moving focus away closes it', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await page.mouse.move(5, 5); /* keep the pointer off the grid */
    /* bounded Tab walk to the first tile (the strip\u2019s chips precede
     * the grid in tab order; the walk ends at the first data-dex-entry) */
    let focusedKey = null;
    for (let i = 0; i < 80 && !focusedKey; i++) {
      await page.keyboard.press('Tab');
      focusedKey = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-dex-entry')) || null);
    }
    assert.equal(focusedKey, FIRST_BASE.key, `Tab reaches the first tile (${FIRST_BASE.key}) — the tiles are links in tab order`);
    await setTipTileKey(page, FIRST_BASE.key);
    await waitTipOn(page);
    const facts = await tipFacts(page);
    assert.equal(facts.name, expectedTip(FIRST_BASE).name, 'keyboard focus reveals the tooltip for the focused tile (focus parity with hover)');
    assert.equal(facts.aria, 'false', 'the focused-tile reveal is aria-hidden false');
    /* Shift+Tab back to the strip (a non-tile) closes the tooltip */
    await page.keyboard.press('Shift+Tab');
    await waitTipOff(page);
    const off = await tipFacts(page);
    assert.equal(off.aria, 'true', 'moving focus off the tile closes the tooltip');
    assert.equal(off.on, false, 'the --on state is removed on focusout');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('delegation: a pager swap (updateBrowse) closes the tooltip, and the reveal still works on the swapped grid (one listener on the stable grid, one shared node)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    /* open on page 1, remember the node, then page forward — the grid
     * children are swapped, the grid element (and the tooltip node)
     * survive */
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_BASE.key + '"]');
    await waitTipOn(page);
    await page.evaluate(() => {
      window.__tipEl = document.getElementById('dex-tip');
      window.__gridEl = document.getElementById('dex-grid');
    });
    await page.click('.dex-pager__btn[data-dex-page="next"]');
    await page.waitForFunction(
      (key) => {
        const tile = document.querySelector('#dex-grid .dex-tile');
        return tile ? tile.getAttribute('data-dex-entry') === key : false;
      },
      PAGE2_FIRST.key,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await waitTipOff(page);
    assert.equal(await page.evaluate(() => document.getElementById('dex-tip') === window.__tipEl), true, 'the SAME tooltip node survived the grid swap (one shared node)');
    assert.equal(await page.evaluate(() => document.getElementById('dex-grid') === window.__gridEl), true, 'the SAME grid element survived the swap (the delegation target)');
    /* and the reveal still works — the one delegated listener set on the
     * stable grid, never per-tile listeners that the swap would have
     * destroyed */
    await setTipTileKey(page, PAGE2_FIRST.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + PAGE2_FIRST.key + '"]');
    await waitTipOn(page);
    const facts = await tipFacts(page);
    assert.equal(facts.name, expectedTip(PAGE2_FIRST).name, `the swapped page 2\u2019s first tile (${PAGE2_FIRST.name}) reveals its own tooltip`);
    assert.deepEqual(
      facts.stats,
      expectedTip(PAGE2_FIRST).stats.map((s) => ({ label: s.label, value: String(s.value) })),
      'page 2\u2019s tooltip carries that entry\u2019s own stats'
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('flip: a tile near the viewport top gets its tooltip BELOW it, still inside the viewport', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    /* park the first tile PARTLY BEHIND the pinned sticky bar: the
     * tile\u2019s top lands above the space the ~270px tooltip needs
     * above it, so the default above-placement would clip the viewport
     * top and must flip below. Pass 1 engages the sticky pin; pass 2
     * aligns under it (the bar\u2019s viewport position is stable once
     * pinned). */
    await page.evaluate(() => {
      const tile = document.querySelector('#dex-grid .dex-tile');
      window.scrollBy({ top: tile.getBoundingClientRect().top - 300, behavior: 'instant' });
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const bar = document.querySelector('.page--pokedex .dex-browse').getBoundingClientRect();
      const tile = document.querySelector('#dex-grid .dex-tile').getBoundingClientRect();
      window.scrollBy({ top: tile.top - (bar.bottom - 50), behavior: 'instant' });
    });
    await page.waitForTimeout(150);
    const parked = await page.evaluate(() => {
      const bar = document.querySelector('.page--pokedex .dex-browse').getBoundingClientRect();
      const tile = document.querySelector('#dex-grid .dex-tile').getBoundingClientRect();
      return { barB: bar.bottom, tileT: tile.top, tileC: tile.top + tile.height / 2, scrollY: window.scrollY };
    });
    assert.ok(parked.tileT < parked.barB, 'fixture: the tile is partly behind the pinned bar (its top is above the bar\u2019s bottom)');
    assert.ok(parked.tileC > parked.barB, 'fixture: the tile\u2019s centre stays visible under the bar (hoverable)');
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile');
    await waitTipOn(page);
    const facts = await tipFacts(page);
    assert.ok(facts.tileRect && facts.tipRect, 'both rects measured (the reveal is visible)');
    assert.ok(facts.tipRect.t >= facts.tileRect.b - 1, `the tooltip FLIPPED BELOW the tile (top ${Math.round(facts.tipRect.t)} >= tile bottom ${Math.round(facts.tileRect.b)})`);
    assert.ok(facts.tipRect.t >= 0 && facts.tipRect.b <= 800 && facts.tipRect.l >= 0 && facts.tipRect.r <= 1280, 'the flipped tooltip stays inside the viewport');
    assert.equal(Math.round(await page.evaluate(() => window.scrollY)), Math.round(parked.scrollY), 'no scroll fight: the hover did not move the page');
    assert.ok(facts.scrollWidth <= 1280, 'no horizontal scroll with the flipped tooltip open');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the open tooltip stays inside the viewport and causes no horizontal scroll', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_BASE.key + '"]');
    await waitTipOn(page);
    const facts = await tipFacts(page);
    assert.ok(facts.tipRect && facts.tileRect, 'both rects measured (the reveal is visible)');
    assert.ok(facts.tipRect.t >= 0 && facts.tipRect.b <= 800, 'the tooltip is inside the 360px viewport vertically');
    assert.ok(facts.tipRect.l >= 0 && facts.tipRect.r <= 360, `the tooltip is inside the 360px viewport horizontally (${Math.round(facts.tipRect.l)}..${Math.round(facts.tipRect.r)})`);
    assert.ok(facts.scrollWidth <= 360, `no horizontal scroll at 360px with the tooltip open (scrollWidth ${facts.scrollWidth}px <= 360px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('reduced motion: the reveal is instant — visible, no transform, no 120ms transition', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (prefix) => (document.getElementById('dex-count')?.textContent || '').trim().startsWith(prefix),
      EX_COUNT_PREFIX,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await setTipTileKey(page, FIRST_BASE.key);
    await page.hover('#dex-grid .dex-tile[data-dex-entry="' + FIRST_BASE.key + '"]');
    /* under reduce there is no 120ms reveal — the node is visible
     * within a frame of the class flip */
    await page.waitForFunction(
      () => getComputedStyle(document.getElementById('dex-tip')).visibility === 'visible',
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await tipFacts(page);
    assert.equal(facts.visibility, 'visible', 'the tooltip is visible under reduced motion');
    assert.equal(facts.opacity, '1', 'the tooltip is fully opaque (no mid-transition sample)');
    assert.equal(facts.transform, 'none', 'no reveal transform under reduced motion');
    assert.ok(parseFloat(facts.transitionDuration) <= 0.02, `no 120ms reveal transition under reduced motion (duration ${facts.transitionDuration})`);
    assert.equal(facts.name, expectedTip(FIRST_BASE).name, 'the reduced-motion tooltip carries the same content');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

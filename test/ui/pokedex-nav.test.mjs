/**
 * The Pokedex #86 navigation rework — grid-first overview + in-detail
 * prev/next species (node --test, zero deps; Playwright resolved by the
 * harness).
 *
 * The rework (issue #86: "the Pokedex should be the focus of the page")
 * moves the browse grid ABOVE the four prose blocks, parks the pager
 * between the count line and the grid (inside the sticky .dex-browse bar,
 * so paging never requires scrolling down), and gives the species detail
 * a prev/next strip of plain #rec-pokedex-<id> hash links to the
 * neighbours in the active version's full dex-order list — the hashchange
 * routing re-renders the detail without a page load.
 *
 * All five tests assert END RESULTS only — hash values, the rendered
 * species name, bounding-rect ordering/pinning, and a window sentinel
 * surviving hash changes (the no-reload proof) — never class internals
 * beyond what identifies the elements. The neighbour expectations and the
 * tile-page size are derived from data/pokedex.json and data/site.json at
 * load, not hardcoded from memory: the records array
 * IS the data (dex) order, and the detail's prev/next walks exactly that
 * order scoped to the active version (ROGUE.filter, order-preserving), so
 * a neighbour is the next record in the array the build includes. As
 * written that is pikachu (#25) → Raichu (#26) → Sandshrew (#27); if the
 * extractor output ever changes, the derivation fails loudly rather than
 * a stale literal.
 *
 * Coverage:
 *   1. grid-first — pokedex.html at the default (EX) build with no hash:
 *      the #dex-grid's bounding-rect top is ABOVE the first prose
 *      section's (#the-dex) top, zero console/page errors.
 *   2. prev/next — deep link #rec-pokedex-pikachu, set a window sentinel,
 *      click the detail's NEXT link: the URL hash becomes the next record
 *      in EX data order, the .dex-species panel shows that record's name,
 *      the sentinel survives (no full-page navigation), and the new
 *      panel's NEXT points one record further.
 *   3. overview restore — from the detail, a hash change to
 *      #dex-overview: the grid is visible again with its derived
 *      data/site.json dex.pageSize tiles, the .dex-nav strip is gone,
 *      and the sentinel still survives (no reload; the viewer-canvas
 *      half of deselect is pokedex-viewer.test.mjs's).
 *   4. version-scoped strip — under ?version=vanilla, deep link
 *      #rec-pokedex-deoxys (the last record in Vanilla dex order — its
 *      EX-order next, turtwig, is EX-only): the detail shows Deoxys with
 *      an empty .dex-nav__end NEXT slot (no next link) while the PREV
 *      link still points at its Vanilla-order neighbour.
 *   5. sticky bar — at 1280px, after scrolling the grid's last tile into
 *      view: the .dex-browse bar's top is pinned at the header's bottom
 *      while the grid has scrolled above the viewport top.
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before(), closeAll + server.close in after(), and each
 * test guards with skipIfNoPlaywright(t) (the suite self-skips on
 * machines without a Playwright install instead of failing `npm test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json, data/site.json) -------------------
 * The detail's prev/next neighbours are the record's neighbours in the
 * active version's FULL record list in data order (= dex order, the grid's
 * list before the on-page filters). The records array is exactly that
 * order, so a neighbour is the next record `step` hops away whose
 * `versions` includes `version` (every record includes ex, so under the
 * default EX build these are plain array neighbours). The tile-page size
 * comes from data/site.json dex.pageSize — the single source pokedex.js
 * reads via ROGUE.site().
 */
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];

const siteCfg = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const PAGE_SIZE = siteCfg && siteCfg.dex ? Number(siteCfg.dex.pageSize) : NaN;
if (!Number.isFinite(PAGE_SIZE) || PAGE_SIZE <= 0) {
  throw new Error('data/site.json: missing a positive dex.pageSize (the tile-page size)');
}

function neighbour(id, version, step) {
  const i = records.findIndex((r) => r.id === id);
  if (i === -1) throw new Error(`data/pokedex.json: no record with id "${id}"`);
  let j = i;
  for (;;) {
    j += step;
    if (j < 0 || j >= records.length) {
      throw new Error(`data/pokedex.json: no ${step > 0 ? 'next' : 'prev'} ${version} record for "${id}"`);
    }
    if (Array.isArray(records[j].versions) && records[j].versions.includes(version)) return records[j];
  }
}

/* pikachu (#25, shared) → Raichu (#26) → Sandshrew (#27), in EX data order */
const NEXT = neighbour('pikachu', 'ex', +1);
const NEXT2 = neighbour(NEXT.id, 'ex', +1);

/* deoxys (#386, shared) is the last record in Vanilla data (dex) order —
 * its EX-order next, turtwig (#387), is EX-only — so under Vanilla its
 * detail's NEXT side is the empty end slot. The active version's display
 * name is the vanilla overlay's `name` when present, else the EX one
 * (the page's dexVariant rule for that field). */
const vanillaOrder = records.filter((r) => Array.isArray(r.versions) && r.versions.includes('vanilla'));
const deoxysRec = vanillaOrder.find((r) => r.id === 'deoxys');
if (!deoxysRec) throw new Error('data/pokedex.json: no "deoxys" record in the Vanilla dex');
if (vanillaOrder[vanillaOrder.length - 1].id !== 'deoxys') {
  throw new Error('data/pokedex.json: deoxys is no longer the last record in Vanilla dex order — update this test');
}
const variantName = (r) => (r.vanilla && r.vanilla.name !== undefined ? r.vanilla.name : r.name);
const DEOYXS_PREV = neighbour('deoxys', 'vanilla', -1);

const SETTLE_TIMEOUT_MS = 10_000; // guard for the settle waits (a bound, not a sleep)

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

/** Deep-link a species detail by its hash and wait for the panel to render. */
async function openDetail(page, id) {
  const elId = 'rec-pokedex-' + id;
  await page.evaluate((h) => {
    window.location.hash = h;
  }, '#' + elId);
  await page.waitForFunction(
    (el) => document.getElementById(el) !== null,
    elId,
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

/* --- the suite ------------------------------------------------------------- */

test('grid-first: on load the tile grid sits above the first prose section', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — pokedex.html at the default build (EX), no hash, no selection
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — the end state the user sees: the overview, dex first
    const rects = await page.evaluate(() => {
      const grid = document.getElementById('dex-grid');
      const prose = document.getElementById('the-dex');
      const overview = document.getElementById('dex-overview');
      return {
        overviewVisible: !!overview && !overview.hidden,
        gridTop: grid ? grid.getBoundingClientRect().top : null,
        proseTop: prose ? prose.getBoundingClientRect().top : null,
      };
    });
    // ASSERT — the grid leads the page: its bounding-rect top is above the
    // first prose section's, and the load was clean
    assert.ok(rects.overviewVisible, 'the overview is the view at load (no hash)');
    assert.ok(Number.isFinite(rects.gridTop), 'the #dex-grid exists at load');
    assert.ok(
      Number.isFinite(rects.proseTop),
      'the first prose section #the-dex exists at load (data/pokedex.json prose[0].id)'
    );
    assert.ok(
      rects.gridTop < rects.proseTop,
      `the grid (top ${rects.gridTop}px) must sit ABOVE the first prose section (top ${rects.proseTop}px) — the dex is the focus of the page (issue #86)`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('prev/next: the detail\'s NEXT link walks to the next dex record by hash, without a page reload', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — deep link pikachu (shared, #25) and wait for its detail
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await openDetail(page, 'pikachu');
    const head = await page.evaluate(() => (document.querySelector('.dex-species h2')?.textContent || '').trim());
    assert.equal(head, 'Pikachu', 'the detail head shows Pikachu (data/pokedex.json pikachu)');
    // the no-reload sentinel: a hash change never re-executes the page's
    // scripts, so a window property set here must survive every hop
    await page.evaluate(() => {
      window.__navTest = true;
    });

    // ACT — click the NEXT link in the detail's .dex-nav strip
    await page.click('.dex-species .dex-nav__link--next');
    await page.waitForFunction(
      (h) => location.hash === h,
      '#rec-pokedex-' + NEXT.id,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await page.waitForFunction(
      (el) => document.getElementById(el) !== null,
      'rec-pokedex-' + NEXT.id,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end results: the hash, the rendered name, no reload, and the
    // new panel's NEXT one hop further
    const facts = await page.evaluate(() => ({
      hash: location.hash,
      name: (document.querySelector('.dex-species h2')?.textContent || '').trim(),
      sentinel: window.__navTest === true,
      nextHref: document.querySelector('.dex-species .dex-nav__link--next')?.getAttribute('href') ?? null,
    }));
    assert.equal(
      facts.hash,
      '#rec-pokedex-' + NEXT.id,
      `data/pokedex.json: the record after pikachu in EX data (dex) order is ${NEXT.id} (#${NEXT.dexNum})`
    );
    assert.equal(
      facts.name,
      NEXT.name,
      `the .dex-species panel re-renders with that record's name (${NEXT.name} — data/pokedex.json ${NEXT.id})`
    );
    assert.equal(facts.sentinel, true, 'the window sentinel survived — the navigation was a hash change, not a full-page load');
    assert.equal(
      facts.nextHref,
      '#rec-pokedex-' + NEXT2.id,
      `the new panel's NEXT points one record further: ${NEXT2.id} (#${NEXT2.dexNum}, the record after ${NEXT.id} in data/pokedex.json)`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('back to the overview: #dex-overview restores the grid, removes the nav strip, no reload', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — deep link a detail (pikachu), set the no-reload sentinel, and
  // check the detail's end state (strip present, grid hidden)
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await openDetail(page, 'pikachu');
    await page.evaluate(() => {
      window.__navTest = true;
    });
    const inDetail = await page.evaluate(() => {
      const grid = document.getElementById('dex-grid');
      return {
        navStrips: document.querySelectorAll('.dex-nav').length,
        gridVisible: !!grid && grid.offsetParent !== null,
      };
    });
    assert.equal(inDetail.navStrips, 1, 'the open detail carries its .dex-nav prev/next strip');
    assert.equal(inDetail.gridVisible, false, 'the overview (and its grid) is hidden while the detail is open');

    // ACT — navigate back to the overview via its hash
    await page.evaluate(() => {
      window.location.hash = '#dex-overview';
    });
    await page.waitForFunction(
      () => {
        const overview = document.getElementById('dex-overview');
        return !!overview && !overview.hidden && document.querySelector('.dex-species') === null;
      },
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the grid is back, the strip is gone, no reload
    const facts = await page.evaluate(() => {
      const grid = document.getElementById('dex-grid');
      return {
        gridVisible: !!grid && grid.offsetParent !== null,
        tiles: document.querySelectorAll('.dex-grid .dex-tile').length,
        navStrips: document.querySelectorAll('.dex-nav').length,
        sentinel: window.__navTest === true,
      };
    });
    assert.equal(facts.gridVisible, true, 'the #dex-overview hash restores the overview — the grid is visible again');
    assert.equal(
      facts.tiles,
      PAGE_SIZE,
      `data/site.json dex.pageSize = ${PAGE_SIZE} → the first page of tiles is back (pokedex.js updateBrowse)`
    );
    assert.equal(facts.navStrips, 0, 'the .dex-nav strip lives only in the species detail — it is gone in the overview');
    assert.equal(facts.sentinel, true, 'the window sentinel survived — the return was a hash change, not a full-page load');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('prev/next: version-scoped — under Vanilla, deoxys (the last Vanilla record) gets an empty NEXT slot', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the one-time ?version=vanilla override, deep link deoxys
  // (#386, shared): the last record in Vanilla dex order
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    await openDetail(page, 'deoxys');

    // ASSERT — the strip is scoped to the ACTIVE version's full list:
    // deoxys has no Vanilla next (its EX-order next, turtwig, is EX-only),
    // so the NEXT side is the empty end slot with no link, while the PREV
    // link still points at its Vanilla-order neighbour
    const facts = await page.evaluate(() => ({
      name: (document.querySelector('.dex-species h2')?.textContent || '').trim(),
      hasNext: !!document.querySelector('.dex-species .dex-nav__link--next'),
      endSlots: document.querySelectorAll('.dex-species .dex-nav__end').length,
      prevHref: document.querySelector('.dex-species .dex-nav__link--prev')?.getAttribute('href') ?? null,
      prevName: (document.querySelector('.dex-species .dex-nav__link--prev .dex-nav__name')?.textContent || '').trim(),
    }));
    assert.equal(
      facts.name,
      variantName(deoxysRec),
      `the detail head shows ${variantName(deoxysRec)} (data/pokedex.json deoxys under the Vanilla build)`
    );
    assert.equal(
      facts.hasNext,
      false,
      'no NEXT link: deoxys is the last record in Vanilla dex order (data/pokedex.json — its EX-order next, turtwig, is EX-only)'
    );
    assert.equal(facts.endSlots, 1, 'the missing NEXT side renders as the empty .dex-nav__end slot (the PREV side is a link)');
    assert.equal(
      facts.prevHref,
      '#rec-pokedex-' + DEOYXS_PREV.id,
      `the PREV link points at the Vanilla-order neighbour: ${DEOYXS_PREV.id} (#${DEOYXS_PREV.dexNum}, data/pokedex.json)`
    );
    assert.equal(
      facts.prevName,
      variantName(DEOYXS_PREV),
      `the PREV link's name is that neighbour's (${variantName(DEOYXS_PREV)} — data/pokedex.json ${DEOYXS_PREV.id})`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('sticky bar: while the grid scrolls, the .dex-browse bar stays pinned below the header', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the overview at 1280px, the default (EX) build, no hash
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // settle the entrance motion first — .page rises 10px over 480ms
    // (base.css), and this test compares a .page element (the bar) against
    // the untransformed header, so a mid-animation measurement would skew
    // the rect by up to 10px (the screenshot.mjs settle convention)
    await page.waitForFunction(
      () => {
        // a finished transform serializes to the identity matrix (not
        // 'none') under fill-mode both — mid-rise it carries a non-zero ty
        const still = (t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
        const settled = (el) =>
          !!el && still(getComputedStyle(el).transform) && getComputedStyle(el).opacity === '1';
        return settled(document.querySelector('.page')) && settled(document.getElementById('site-header'));
      },
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — scroll the grid's last tile into view: the bar's natural
    // position scrolls away, so a sticky bar must end pinned below the
    // header while the grid passes under it
    await page.evaluate(() => {
      const tiles = document.querySelectorAll('#dex-grid .dex-tile');
      tiles[tiles.length - 1].scrollIntoView();
    });
    await page.waitForFunction(
      () => {
        const grid = document.getElementById('dex-grid');
        return !!grid && grid.getBoundingClientRect().top < 0;
      },
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end results: the bar is pinned at the header's bottom and
    // the grid has scrolled above the viewport top (under the bar)
    const facts = await page.evaluate(() => {
      const bar = document.querySelector('#dex-overview .dex-browse');
      const header = document.getElementById('site-header');
      const grid = document.getElementById('dex-grid');
      return {
        barTop: bar ? bar.getBoundingClientRect().top : null,
        headerBottom: header ? header.getBoundingClientRect().bottom : null,
        gridTop: grid ? grid.getBoundingClientRect().top : null,
      };
    });
    assert.ok(
      Number.isFinite(facts.gridTop) && facts.gridTop < 0,
      `the grid has scrolled under the bar (grid top ${facts.gridTop}px is above the viewport top)`
    );
    assert.ok(
      Number.isFinite(facts.barTop) && Number.isFinite(facts.headerBottom) && Math.abs(facts.barTop - facts.headerBottom) <= 2,
      `the .dex-browse bar is pinned at the header's bottom (bar top ${facts.barTop}px vs header bottom ${facts.headerBottom}px, 2px tolerance)`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

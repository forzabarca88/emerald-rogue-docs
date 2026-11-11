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
 * All three tests assert END RESULTS only — hash values, the rendered
 * species name, bounding-rect ordering, and a window sentinel surviving
 * hash changes (the no-reload proof) — never class internals beyond what
 * identifies the elements. The neighbour expectations are derived from
 * data/pokedex.json at load, not hardcoded from memory: the records array
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
 *      #dex-overview: the grid is visible again, the .dex-nav strip is
 *      gone, and the sentinel still survives (no reload; the
 *      viewer-canvas half of deselect is pokedex-viewer.test.mjs's).
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

/* --- derived literals (data/pokedex.json) ----------------------------------
 * The detail's prev/next neighbours are the record's neighbours in the
 * active version's FULL record list in data order (= dex order, the grid's
 * list before the on-page filters). The records array is exactly that
 * order, so a neighbour is the next record `step` hops away whose
 * `versions` includes `version` (every record includes ex, so under the
 * default EX build these are plain array neighbours).
 */
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];

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

const SETTLE_TIMEOUT_MS = 10_000; // guard for the hash-settle waits (a bound, not a sleep)

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
    assert.equal(facts.tiles, 28, 'data/site.json dex.pageSize = 28 → the first page of tiles is back (pokedex.js updateBrowse)');
    assert.equal(facts.navStrips, 0, 'the .dex-nav strip lives only in the species detail — it is gone in the overview');
    assert.equal(facts.sentinel, true, 'the window sentinel survived — the return was a hash change, not a full-page load');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

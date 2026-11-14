/**
 * The Pokedex analytics controls — the sort + type selects in the browse
 * bar (issue #100, PR 4a; node --test, zero deps; Playwright resolved by
 * the harness).
 *
 * Two native <select> joins the .dex-browse toolbar (the same 170px
 * tokens-only pattern as the #92 variant select):
 *   - #dex-sort — one (asc|desc) pair per key (Dex #, BST, HP, Atk,
 *     Def, Sp. Atk, Sp. Def, Speed, Catch rate, Base EXP). The stat /
 *     catch / EXP keys read through the page's dexVariant() overlay
 *     resolver, so under Vanilla the sort compares the Vanilla stats /
 *     catchRate / baseExp values. A STABLE decorate-sort-undecorate
 *     (the original dex order breaks ties; nulls last in either
 *     direction). The default "Dex # (asc)" is the data order, so the
 *     default view is byte-identical — pinned here (the same pinned
 *     count lines + first-page tiles the smoke suite asserts). The sort
 *     SURVIVES a version re-render (the keys are version-independent).
 *   - #dex-type — "All types" + the active build's standard types from
 *     the top-level typeChart (Mystery/Stellar — the non-defenders —
 *     excluded). A selection the new build lacks (Fairy under Vanilla)
 *     resets to "all" on the version re-render (the variant select's
 *     rule).
 * The pipeline is version → region → variant → type → query → sort →
 * pagination; the count line keeps its exact "N species · page X of Y"
 * shape and the search haystack is untouched.
 *
 * Every expectation is derived from data/pokedex.json (+ site.json for
 * the tile-page size) at load — never hardcoded from memory:
 *   - the option lists verbatim (the SORT_KEYS pairs; the typeChart's
 *     type list minus the two non-defenders);
 *   - the sorted top tiles: the page's exact sort (stable, dex-order
 *     ties, version-scoped field reads) re-implemented over the data;
 *   - the type-filter counts: the records whose version-scoped types
 *     carry the type;
 *   - the query side of the composed case runs on the SHARED
 *     ROGUE.pokedexSearchText haystack (the same no-mock vm setup as
 *     test/ui/pokedex-browse.test.mjs).
 *
 * Coverage:
 *   1. default state — both selects render their exact option lists with
 *      their defaults; every pinned default is untouched (the full EX
 *      count line, the first-page tiles, 24 tiles).
 *   2. sorting (EX) — bst-desc puts the derived 720-BST species first
 *      (and the derived second second), bst-asc the derived minimum,
 *      dexnum-desc the derived last-dex species; the count line is
 *      untouched by a pure sort.
 *   3. version-scoped sort — bst-desc under EX leads with the EX leader;
 *      the LIVE toggle to Vanilla keeps the sort (it survives) and the
 *      grid now leads with the Vanilla leader (the overlay stats).
 *   4. the type filter (EX) — Fairy filters to the derived count with
 *      the derived first-dex Fairy species first; "All types" restores
 *      the full line; Mystery/Stellar are not options.
 *   5. composed — type + sort + query together (Ghost + bst-desc + a
 *      derived query; the count + first tile derived through the shared
 *      haystack).
 *   6. version re-render — Fairy (EX-only) + a sort survive: the type
 *      select resets to "all", the sort select keeps its value, the
 *      count line is the pinned Vanilla line.
 *   7. 360px — with a type + sort selected the bar carries no
 *      horizontal overflow.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json, data/site.json) ------------------ */

const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json: no records');
const tc = dex.typeChart;
if (!tc || !Array.isArray(tc.types) || !Array.isArray(tc.mult)) throw new Error('data/pokedex.json: missing the top-level typeChart');

const siteCfg = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const PAGE_SIZE = siteCfg && siteCfg.dex ? Number(siteCfg.dex.pageSize) : NaN;
if (!Number.isFinite(PAGE_SIZE) || PAGE_SIZE <= 0) throw new Error('data/site.json: missing a positive dex.pageSize');

const recordsOf = (version) => records.filter((r) => Array.isArray(r.versions) && r.versions.includes(version));
const exRecords = recordsOf('ex');
const vanillaRecords = recordsOf('vanilla');

/* The page's count line for a filtered list at page 1. */
const countLine = (n) => n + ' species · page 1 of ' + Math.max(1, Math.ceil(n / PAGE_SIZE));

/* The project-wide pinned full lines — cross-checked against the data at
 * load so a drifted extraction fails HERE, not as a stale literal. */
const FULL_EX_LINE = countLine(exRecords.length);
const FULL_VANILLA_LINE = countLine(vanillaRecords.length);
assert.equal(FULL_EX_LINE, '1025 species · page 1 of 43', 'the pinned EX full count line drifted');
assert.equal(FULL_VANILLA_LINE, '386 species · page 1 of 17', 'the pinned Vanilla full count line drifted');

/* The sort select's exact option list (the page's SORT_KEYS, one
 * (asc|desc) pair per key — derived here, not re-typed). */
const SORT_KEYS = [
  ['dexnum', 'Dex #'],
  ['bst', 'BST'],
  ['hp', 'HP'],
  ['atk', 'Atk'],
  ['def', 'Def'],
  ['spa', 'Sp. Atk'],
  ['spd', 'Sp. Def'],
  ['spe', 'Speed'],
  ['catch', 'Catch rate'],
  ['exp', 'Base EXP'],
];
const SORT_OPTIONS = [];
for (const [k, label] of SORT_KEYS) {
  for (const d of ['asc', 'desc']) SORT_OPTIONS.push([k + '-' + d, label + ' (' + d + ')']);
}

/* The active build's type options (the page's rule: the typeChart's
 * standard types, Mystery/Stellar excluded — the vanilla overlay under
 * Vanilla). */
const typeOptionsOf = (version) => {
  const chart = version === 'vanilla' && tc.vanilla ? tc.vanilla : tc;
  return chart.types.filter((t) => t !== 'Mystery' && t !== 'Stellar');
};
const EX_TYPE_OPTIONS = typeOptionsOf('ex');
const VAN_TYPE_OPTIONS = typeOptionsOf('vanilla');
assert.equal(EX_TYPE_OPTIONS.length, 18, 'data/pokedex.json: the EX build has 18 standard types');
assert.ok(!EX_TYPE_OPTIONS.includes('Mystery') && !EX_TYPE_OPTIONS.includes('Stellar'), 'the non-defenders are not options');
assert.ok(!VAN_TYPE_OPTIONS.includes('Fairy'), 'the Vanilla build has no Fairy type (the re-render-reset fixture)');

/* The page's version-scoped field read (the dexVariant overlay rule). */
const fieldOf = (r, version, field) =>
  version === 'vanilla' && r.vanilla && typeof r.vanilla === 'object' && r.vanilla[field] !== undefined ? r.vanilla[field] : r[field];

/** The page's sort value for one record/key (version-scoped). */
function sortValueOf(r, version, key) {
  if (key === 'dexnum') return typeof r.dexNum === 'number' ? r.dexNum : null;
  if (key === 'catch') { const c = fieldOf(r, version, 'catchRate'); return typeof c === 'number' ? c : null; }
  if (key === 'exp') { const e = fieldOf(r, version, 'baseExp'); return typeof e === 'number' ? e : null; }
  const s = fieldOf(r, version, 'stats');
  if (!s) return null;
  /* "bst" is the total stat (the record field is stats.total) */
  const f = key === 'bst' ? 'total' : key;
  return typeof s[f] === 'number' ? s[f] : null;
}

/** The page's STABLE sort (decorate-sort-undecorate, dex-order ties, nulls last). */
function sortedList(list, version, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const indexed = list.map((r, i) => ({ v: sortValueOf(r, version, key), i }));
  indexed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (a.v !== b.v) return sign === 1 ? (a.v < b.v ? -1 : 1) : a.v > b.v ? -1 : 1;
    return a.i - b.i;
  });
  return indexed.map((e) => list[e.i]);
}

/* The type-filtered list (version-scoped types). */
const ofType = (list, version, type) => list.filter((r) => Array.isArray(fieldOf(r, version, 'types')) && fieldOf(r, version, 'types').includes(type));

/* The shared on-page/palette haystack (the same no-mock vm setup as
 * pokedex-browse.test.mjs). */
const haystack = (() => {
  const files = [
    'adventure', 'campaigns', 'charms', 'followmons', 'game-modes', 'gameshow', 'hub', 'pokedex',
    'quests', 'routes', 'safari', 'settings', 'timeofday', 'unique-mons', 'versions',
  ];
  const data = { site: siteCfg };
  for (const f of files) data[f] = JSON.parse(readFileSync(path.join(root, 'data', f + '.json'), 'utf8'));
  const window = { ROGUE_DATA_SITE: data.site };
  for (const f of files) window['ROGUE_DATA_' + f.toUpperCase()] = data[f];
  const sandbox = { window };
  vm.createContext(sandbox);
  for (const mod of ['data', 'render', 'search-index']) {
    vm.runInContext(readFileSync(path.join(root, 'site', 'js', mod + '.js'), 'utf8'), sandbox, { filename: mod + '.js' });
  }
  const out = {};
  for (const r of records) out[r.id] = sandbox.window.ROGUE.pokedexSearchText(r);
  return out;
})();

/* --- fixtures (each guard fails loudly on a degenerate choice) ------------ */

/* default view: the first page of tiles in dex order. */
const FIRST_TILES = exRecords.slice(0, 3).map((r) => '#rec-pokedex-' + r.id);
assert.deepEqual(FIRST_TILES, ['#rec-pokedex-bulbasaur', '#rec-pokedex-ivysaur', '#rec-pokedex-venusaur'],
  'the first page of the EX dex starts at #1 (the pinned smoke fixture)');

/* bst-desc EX: a UNIQUE leader (the strongest possible fixture). */
const BST_DESC_EX = sortedList(exRecords, 'ex', 'bst', 'desc');
assert.ok(exRecords.filter((r) => r.stats.total === BST_DESC_EX[0].stats.total).length === 1,
  'the EX bst-desc fixture needs a unique leader');

/* bst-desc Vanilla: the overlay leader (DIFFERENT from the EX leader —
 * that is the point of the version-scoped sort). */
const BST_DESC_VAN = sortedList(vanillaRecords, 'vanilla', 'bst', 'desc');
assert.notEqual(BST_DESC_VAN[0].id, BST_DESC_EX[0].id, 'the Vanilla bst leader must differ from the EX one (the overlay fixture)');

/* bst-asc EX: the derived minimum (ties → dex order). */
const BST_ASC_EX = sortedList(exRecords, 'ex', 'bst', 'asc');

/* dexnum-desc: the derived last-dex species. */
const DEXNUM_DESC_EX = sortedList(exRecords, 'ex', 'dexnum', 'desc');

/* the type filter: Fairy (EX) + Ghost (the composed fixture). */
const FAIRY_EX = ofType(exRecords, 'ex', 'Fairy');
assert.ok(FAIRY_EX.length > 0 && FAIRY_EX.length < exRecords.length, 'a non-trivial EX Fairy count');
const GHOST_EX = ofType(exRecords, 'ex', 'Ghost');
assert.ok(GHOST_EX.length > 0 && GHOST_EX.length < exRecords.length, 'a non-trivial EX Ghost count');

/* composed: Ghost + bst-desc + a query that keeps a single derived
 * species at the top. */
const COMPOSED_QUERY = 'giratina';
const COMPOSED_LIST = sortedList(GHOST_EX.filter((r) => haystack[r.id].includes(COMPOSED_QUERY)), 'ex', 'bst', 'desc');
assert.ok(COMPOSED_LIST.length > 0 && COMPOSED_LIST[0].id === 'giratina',
  `the composed fixture leads with the derived ghost "${COMPOSED_LIST[0] && COMPOSED_LIST[0].id}" (query "${COMPOSED_QUERY}")`);

/* re-render: Fairy (EX-only) resets; the sort survives (speed asc). */
const SPE_ASC_VAN = sortedList(vanillaRecords, 'vanilla', 'spe', 'asc');
assert.ok(SPE_ASC_VAN[0] && SPE_ASC_VAN[0].id, 'the Vanilla speed-asc fixture is defined');

const SETTLE_TIMEOUT_MS = 10_000; // guard for the settle waits (a bound, not a sleep)

let server;
before(async () => {
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- the suite ------------------------------------------------------------
 * Every page function below is SELF-CONTAINED (it references only the
 * DOM and its arguments) — page.evaluate / waitForFunction serialize the
 * function source into the page context, so no node-side free variables.
 * -------------------------------------------------------------------------- */

test('default: both selects render their exact option lists and every pinned default is untouched', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      FULL_EX_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    const facts = await page.evaluate(() => {
      const sel = (id) => {
        const s = document.getElementById(id);
        return s ? { value: s.value, options: [...s.options].map((o) => [o.value, o.textContent]) } : null;
      };
      return {
        sort: sel('dex-sort'),
        type: sel('dex-type'),
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => x.getAttribute('href')),
        regionButtons: document.querySelectorAll('.dex-filter__btn').length,
      };
    });

    // ASSERT — the option lists verbatim + the defaults
    assert.ok(facts.sort, 'the #dex-sort select renders in the browse bar (issue #100)');
    assert.deepEqual(facts.sort.options, SORT_OPTIONS, 'the sort select carries one (asc|desc) pair per SORT_KEYS entry, in order');
    assert.equal(facts.sort.value, 'dexnum-asc', 'the default sort is "Dex # (asc)" — the data order');
    assert.ok(facts.type, 'the #dex-type select renders in the browse bar (issue #100)');
    assert.deepEqual(facts.type.options, [['all', 'All types'], ...EX_TYPE_OPTIONS.map((o) => [o, o])],
      'the type select carries "All types" + the EX typeChart standard types (Mystery/Stellar excluded)');
    assert.equal(facts.type.value, 'all', 'the default type filter is "All types"');

    // ASSERT — every pinned default is untouched by the new controls
    assert.equal(facts.count, FULL_EX_LINE, 'the pinned full EX count line');
    assert.equal(facts.tiles.length, PAGE_SIZE, 'the first (full) page of tiles');
    assert.deepEqual(facts.tiles.slice(0, 3), FIRST_TILES, 'the default sort is the data order — the first tiles are #1–#3 (byte-identical view)');
    assert.equal(facts.regionButtons, 10, 'the 10 region buttons — the selects are not among them');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('sorting (EX): bst-desc / bst-asc / dexnum-desc lead with the derived species and leave the count line untouched', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      FULL_EX_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const firstTile = (id) =>
      page.waitForFunction(
        (x) => {
          const tile = document.querySelector('#dex-grid .dex-tile');
          return tile ? tile.getAttribute('href') === '#rec-pokedex-' + x : false;
        },
        id,
        { timeout: SETTLE_TIMEOUT_MS }
      );

    // ACT + ASSERT — bst-desc: the derived (unique) leader first
    await page.selectOption('#dex-sort', 'bst-desc');
    await firstTile(BST_DESC_EX[0].id);
    let facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => x.getAttribute('href')),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      sort: document.getElementById('dex-sort').value,
    }));
    assert.equal(facts.tiles[0], '#rec-pokedex-' + BST_DESC_EX[0].id, `bst-desc leads with ${BST_DESC_EX[0].name} (the derived unique leader)`);
    assert.equal(facts.tiles[1], '#rec-pokedex-' + BST_DESC_EX[1].id, 'the second tile is the derived second');
    assert.equal(facts.count, FULL_EX_LINE, 'a pure sort does not change the count line');
    assert.equal(facts.sort, 'bst-desc', 'the select holds the selection');

    // ACT + ASSERT — bst-asc: the derived minimum (ties → dex order)
    await page.selectOption('#dex-sort', 'bst-asc');
    await firstTile(BST_ASC_EX[0].id);
    facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => x.getAttribute('href')),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
    }));
    assert.equal(facts.tiles[0], '#rec-pokedex-' + BST_ASC_EX[0].id, `bst-asc leads with ${BST_ASC_EX[0].name} (the derived minimum)`);
    assert.equal(facts.count, FULL_EX_LINE, 'still the full line');

    // ACT + ASSERT — dexnum-desc: the derived last-dex species
    await page.selectOption('#dex-sort', 'dexnum-desc');
    await firstTile(DEXNUM_DESC_EX[0].id);
    facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => x.getAttribute('href')),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
    }));
    assert.equal(facts.tiles[0], '#rec-pokedex-' + DEXNUM_DESC_EX[0].id, `dexnum-desc leads with ${DEXNUM_DESC_EX[0].name} (the derived last-dex species)`);
    assert.equal(facts.count, FULL_EX_LINE, 'still the full line');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('version-scoped sort: bst-desc survives the live toggle and now leads with the Vanilla overlay leader', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — EX, bst-desc (the EX leader leads)
    await page.selectOption('#dex-sort', 'bst-desc');
    await page.waitForFunction(
      (id) => {
        const tile = document.querySelector('#dex-grid .dex-tile');
        return tile ? tile.getAttribute('href') === '#rec-pokedex-' + id : false;
      },
      BST_DESC_EX[0].id,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE version toggle to Vanilla
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      ({ line, id }) =>
        (document.getElementById('dex-count')?.textContent || '').trim() === line &&
        (document.querySelector('#dex-grid .dex-tile')?.getAttribute('href') === '#rec-pokedex-' + id),
      { line: FULL_VANILLA_LINE, id: BST_DESC_VAN[0].id },
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the sort SURVIVED (still bst-desc) and now compares the
    // Vanilla overlay stats: the leader is the derived Vanilla one
    const facts = await page.evaluate(() => ({
      sort: document.getElementById('dex-sort').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      first: document.querySelector('#dex-grid .dex-tile')?.getAttribute('href'),
    }));
    assert.equal(facts.sort, 'bst-desc', 'the sort survives the version re-render (the keys are version-independent)');
    assert.equal(facts.count, FULL_VANILLA_LINE, 'the pinned full Vanilla count line');
    assert.equal(facts.first, '#rec-pokedex-' + BST_DESC_VAN[0].id,
      `the Vanilla leader (${BST_DESC_VAN[0].name}) now leads — the sort reads the overlay stats, not the EX ones`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('the type filter (EX): Fairy filters to the derived count; "All types" restores the full line', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      FULL_EX_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const waitForCount = (line) =>
      page.waitForFunction(
        (l) => (document.getElementById('dex-count')?.textContent || '').trim() === l,
        line,
        { timeout: SETTLE_TIMEOUT_MS }
      );

    // ACT — pick Fairy
    await page.selectOption('#dex-type', 'Fairy');
    await waitForCount(countLine(FAIRY_EX.length));

    // ASSERT — the derived count + the derived first-dex Fairy species
    // (the default sort — dex order — still applies)
    const facts = await page.evaluate(() => ({
      type: document.getElementById('dex-type').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      first: document.querySelector('#dex-grid .dex-tile')?.getAttribute('href'),
    }));
    assert.equal(facts.type, 'Fairy', 'the select holds "Fairy"');
    assert.equal(facts.count, countLine(FAIRY_EX.length), `data/pokedex.json: ${FAIRY_EX.length} EX Fairy species → "${countLine(FAIRY_EX.length)}"`);
    assert.equal(facts.first, '#rec-pokedex-' + FAIRY_EX[0].id, `the first (dex-order) Fairy species is ${FAIRY_EX[0].name}`);

    // ACT — "All types" restores the full line
    await page.selectOption('#dex-type', 'all');
    await waitForCount(FULL_EX_LINE);
    const after = await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim());
    assert.equal(after, FULL_EX_LINE, '"All types" restores the pinned full line');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('composed: type + sort + query together (Ghost + bst-desc + the derived query)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      FULL_EX_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — all three controls at once
    await page.selectOption('#dex-type', 'Ghost');
    await page.selectOption('#dex-sort', 'bst-desc');
    await page.fill('#dex-search', COMPOSED_QUERY);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(COMPOSED_LIST.length),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the derived intersection count + the derived leader
    const facts = await page.evaluate(() => ({
      type: document.getElementById('dex-type').value,
      sort: document.getElementById('dex-sort').value,
      query: document.getElementById('dex-search').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      first: document.querySelector('#dex-grid .dex-tile')?.getAttribute('href'),
    }));
    assert.equal(facts.type, 'Ghost');
    assert.equal(facts.sort, 'bst-desc');
    assert.equal(facts.query, COMPOSED_QUERY);
    assert.equal(facts.count, countLine(COMPOSED_LIST.length),
      `data/pokedex.json: ${COMPOSED_LIST.length} Ghost species matching "${COMPOSED_QUERY}" → "${countLine(COMPOSED_LIST.length)}"`);
    assert.equal(facts.first, '#rec-pokedex-' + COMPOSED_LIST[0].id, `the derived leader is ${COMPOSED_LIST[0].name}`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('version re-render: the EX-only Fairy type filter resets to "all" while the sort survives', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — EX, the EX-only Fairy filter + a sort
    await page.selectOption('#dex-type', 'Fairy');
    await page.selectOption('#dex-sort', 'spe-asc');
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(FAIRY_EX.length),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE toggle to Vanilla (no Fairy in the Vanilla chart)
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      ({ line, options }) =>
        (document.getElementById('dex-count')?.textContent || '').trim() === line &&
        document.getElementById('dex-type')?.options.length === options,
      { line: FULL_VANILLA_LINE, options: VAN_TYPE_OPTIONS.length + 1 },
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the type select reset, the Vanilla option list, the sort
    // intact, the pinned Vanilla line
    const facts = await page.evaluate(() => ({
      type: document.getElementById('dex-type')
        ? { value: document.getElementById('dex-type').value, options: [...document.getElementById('dex-type').options].map((o) => [o.value, o.textContent]) }
        : null,
      sort: document.getElementById('dex-sort').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      first: document.querySelector('#dex-grid .dex-tile')?.getAttribute('href'),
    }));
    assert.equal(facts.type.options.length, VAN_TYPE_OPTIONS.length + 1, `the ${VAN_TYPE_OPTIONS.length} Vanilla standard types + "All types"`);
    assert.ok(!facts.type.options.some(([v]) => v === 'Fairy'), 'the EX-only Fairy option is gone under Vanilla');
    assert.equal(facts.type.value, 'all', 'the Fairy selection the new build lacks reset to "all" (the variant select\'s rule)');
    assert.equal(facts.sort, 'spe-asc', 'the sort survived the re-render');
    assert.equal(facts.count, FULL_VANILLA_LINE, 'the pinned full Vanilla count line (type reset to "all")');
    assert.equal(facts.first, '#rec-pokedex-' + SPE_ASC_VAN[0].id, `the surviving sort now leads with the Vanilla speed-asc leader (${SPE_ASC_VAN[0].name})`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the bar with the sort + type selects carries no horizontal overflow', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    // ARRANGE — the longest labels selected (the widest stress)
    const longestType = EX_TYPE_OPTIONS.reduce((a, b) => (b.length > a.length ? b : a));
    await page.selectOption('#dex-type', longestType);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(ofType(exRecords, 'ex', longestType).length),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the bar is visible and nothing overflows the 360px viewport
    const facts = await page.evaluate(() => {
      const bar = document.querySelector('#dex-overview .dex-browse');
      const sort = document.getElementById('dex-sort');
      const type = document.getElementById('dex-type');
      const right = Math.max(
        sort ? sort.getBoundingClientRect().right : 0,
        type ? type.getBoundingClientRect().right : 0
      );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        barVisible: !!bar && bar.offsetParent !== null,
        selectRight: right,
      };
    });
    assert.equal(facts.barVisible, true, 'the .dex-browse bar (with the sort + type selects) is visible at 360px');
    assert.ok(Number.isFinite(facts.selectRight) && facts.selectRight <= 360, `the selects fit the 360px viewport (right edge ${facts.selectRight}px)`);
    assert.ok(facts.scrollWidth <= 360, `no horizontal overflow at 360px (scrollWidth ${facts.scrollWidth}px <= 360px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

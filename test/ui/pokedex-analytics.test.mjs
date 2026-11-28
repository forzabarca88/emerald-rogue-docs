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
 * pagination; the count line keeps its exact "N entries · page X of Y"
 * shape (issue #174: the listing is ENTRIES — each record's base entry
 * plus one entry per form the data flags `functional: true`, so the EX
 * full line is 1308 entries) and the search haystack is untouched (it
 * stays record-keyed — a matching record surfaces its base entry AND
 * its functional forms).
 *
 * Every expectation is derived from data/pokedex.json (+ site.json for
 * the tile-page size) at load — never hardcoded from memory:
 *   - the option lists verbatim (the SORT_KEYS pairs; the typeChart's
 *     type list minus the two non-defenders);
 *   - the sorted top tiles: the page's exact sort (stable, entry-order
 *     ties, the entry's own stats for the stat keys — a form entry
 *     sorts on its form's stats, issue #174) re-implemented over the
 *     derived entry list;
 *   - the type-filter counts: the ENTRIES whose own types carry the
 *     type (a form entry's form types, not the base's);
 *   - the query side of the composed case runs on the SHARED
 *     ROGUE.pokedexSearchText haystack (the same no-mock vm setup as
 *     test/ui/pokedex-browse.test.mjs).
 *
 * Coverage:
 *   1. default state — both selects render their exact option lists with
 *      their defaults; every pinned default is untouched (the full EX
 *      count line, the first-page tiles, 24 tiles).
 *   2. sorting (EX) — bst-desc puts the derived functional-form leader
 *      first (issue #174: the form entry sorts on its own stats — its
 *      label renders in the tile), bst-asc the derived minimum,
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

/* The page's version-scoped field read (the dexVariant overlay rule). */
const fieldOf = (r, version, field) =>
  version === 'vanilla' && r.vanilla && typeof r.vanilla === 'object' && r.vanilla[field] !== undefined ? r.vanilla[field] : r[field];

/* issue #174 — the page's listing is ENTRIES (pokedex.js buildEntries):
 * each version-scoped record yields its base entry first, then its
 * functional forms (the data's `functional: true` flag — the extractor's
 * pinned diff rule; the page reads it, never re-derives it) in
 * `forms`-array order. Vanilla's `forms: []` overlays → base entries
 * only (386, zero form entries). This mirror derives the same list the
 * page renders, so every fixture below is entry-based. */
function entriesOf(version) {
  const out = [];
  for (const record of recordsOf(version)) {
    const baseTypes = Array.isArray(fieldOf(record, version, 'types')) ? fieldOf(record, version, 'types') : [];
    const baseStats = fieldOf(record, version, 'stats');
    out.push({
      key: record.id,
      record,
      form: null,
      name: fieldOf(record, version, 'name'),
      dexNum: record.dexNum,
      types: baseTypes,
      stats: baseStats,
    });
    const forms = Array.isArray(fieldOf(record, version, 'forms')) ? fieldOf(record, version, 'forms') : [];
    forms.forEach((f, i) => {
      if (!f || f.functional !== true) return;
      out.push({
        key: record.id + '~' + i,
        record,
        form: f,
        name: typeof f.name === 'string' ? f.name : '',
        dexNum: record.dexNum,
        types: Array.isArray(f.types) ? f.types : baseTypes,
        stats: f.stats && typeof f.stats === 'object' ? f.stats : baseStats,
      });
    });
  }
  return out;
}
const exEntries = entriesOf('ex');
const vanillaEntries = entriesOf('vanilla');

/* The page's count line for a filtered list at page 1 — it counts
 * ENTRIES (issue #174). */
const countLine = (n) => n + ' entries · page 1 of ' + Math.max(1, Math.ceil(n / PAGE_SIZE));

/* The project-wide pinned full lines — cross-checked against the data at
 * load so a drifted extraction fails HERE, not as a stale literal. */
const FULL_EX_LINE = countLine(exEntries.length);
const FULL_VANILLA_LINE = countLine(vanillaEntries.length);
assert.equal(FULL_EX_LINE, '1308 entries · page 1 of 55', 'the pinned EX full count line drifted');
assert.equal(FULL_VANILLA_LINE, '386 entries · page 1 of 17', 'the pinned Vanilla full count line drifted');

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

/** The page's sort value for one ENTRY/key (issue #174): the stat keys
 * read the entry's own stats (a form entry's form stats), dexnum /
 * catch / exp read the base record (version-scoped for the latter two). */
function sortValueOf(e, version, key) {
  if (key === 'dexnum') return typeof e.dexNum === 'number' ? e.dexNum : null;
  if (key === 'catch') { const c = fieldOf(e.record, version, 'catchRate'); return typeof c === 'number' ? c : null; }
  if (key === 'exp') { const x = fieldOf(e.record, version, 'baseExp'); return typeof x === 'number' ? x : null; }
  const s = e.stats;
  if (!s) return null;
  /* "bst" is the total stat (the record field is stats.total) */
  const f = key === 'bst' ? 'total' : key;
  return typeof s[f] === 'number' ? s[f] : null;
}

/** The page's STABLE sort over ENTRIES (decorate-sort-undecorate,
 * entry-order ties — a form entry follows its base, nulls last). */
function sortedEntries(list, version, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const indexed = list.map((e, i) => ({ v: sortValueOf(e, version, key), i }));
  indexed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    if (a.v !== b.v) return sign === 1 ? (a.v < b.v ? -1 : 1) : a.v > b.v ? -1 : 1;
    return a.i - b.i;
  });
  return indexed.map((e) => list[e.i]);
}

/* The type-filtered ENTRIES (the entry's own types — a form entry's
 * form types, not the base's; issue #174). */
const ofType = (list, type) => list.filter((e) => Array.isArray(e.types) && e.types.includes(type));

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

/* default view: the first page of tiles in the entry list's own order —
 * each tile asserted as { entry key, href, form label } (the form label
 * is null on base tiles; asserting the key + label, not the href alone,
 * is what distinguishes the two same-record tiles once forms join the
 * listing — issue #174). */
const FIRST_TILES = exEntries.slice(0, 3).map((e) => ({
  entry: e.key,
  href: '#rec-pokedex-' + e.record.id,
  form: e.form ? e.form.name : null,
}));
assert.deepEqual(FIRST_TILES, [
  { entry: 'bulbasaur', href: '#rec-pokedex-bulbasaur', form: null },
  { entry: 'ivysaur', href: '#rec-pokedex-ivysaur', form: null },
  { entry: 'venusaur', href: '#rec-pokedex-venusaur', form: null },
], 'the first page of the EX dex starts at #1 (the pinned smoke fixture)');

/* bst-desc EX: a UNIQUE leader (the strongest possible fixture) — and
 * issue #174 makes it a functional-FORM entry: the form's own stats
 * carry it above every base record (Eternatus Eternamax, 1125). */
const BST_DESC_EX = sortedEntries(exEntries, 'ex', 'bst', 'desc');
assert.ok(exEntries.filter((e) => e.stats && e.stats.total === BST_DESC_EX[0].stats.total).length === 1,
  'the EX bst-desc fixture needs a unique leader');
assert.ok(BST_DESC_EX[0].form !== null,
  'the EX bst-desc leader must be a functional-form entry (issue #174: form entries sort on their own stats)');

/* bst-desc Vanilla: the overlay leader (DIFFERENT from the EX leader —
 * that is the point of the version-scoped sort). Vanilla is base
 * entries only (its `forms: []` overlays), so a 680-total tie breaks to
 * the first-dex record. */
const BST_DESC_VAN = sortedEntries(vanillaEntries, 'vanilla', 'bst', 'desc');
assert.notEqual(BST_DESC_VAN[0].record.id, BST_DESC_EX[0].record.id, 'the Vanilla bst leader must differ from the EX one (the overlay fixture)');
assert.equal(BST_DESC_VAN[0].form, null, 'Vanilla has no functional-form entries (the 386-entry invariant)');

/* bst-asc EX: the derived minimum (ties → dex order). */
const BST_ASC_EX = sortedEntries(exEntries, 'ex', 'bst', 'asc');

/* dexnum-desc: the derived last-dex species (a tie at 1024 → entry
 * order puts the base entry before its forms). */
const DEXNUM_DESC_EX = sortedEntries(exEntries, 'ex', 'dexnum', 'desc');

/* the type filter: Fairy (EX) + Ghost (the composed fixture) — the
 * entry's own types (form entries included; issue #174). */
const FAIRY_EX = ofType(exEntries, 'Fairy');
assert.ok(FAIRY_EX.length > 0 && FAIRY_EX.length < exEntries.length, 'a non-trivial EX Fairy count');
const GHOST_EX = ofType(exEntries, 'Ghost');
assert.ok(GHOST_EX.length > 0 && GHOST_EX.length < exEntries.length, 'a non-trivial EX Ghost count');

/* composed: Ghost + bst-desc + a query that surfaces the derived ghost
 * AND its functional form (issue #174: a matching record surfaces its
 * base entry AND its forms — they share the record's haystack). The
 * 680/680 tie breaks to the base entry (it precedes its form). */
const COMPOSED_QUERY = 'giratina';
const COMPOSED_LIST = sortedEntries(GHOST_EX.filter((e) => haystack[e.record.id].includes(COMPOSED_QUERY)), 'ex', 'bst', 'desc');
assert.ok(COMPOSED_LIST.length > 1 && COMPOSED_LIST[0].key === 'giratina' && COMPOSED_LIST[1].form !== null,
  `the composed fixture leads with the derived ghost "${COMPOSED_LIST[0] && COMPOSED_LIST[0].key}" and its functional form (query "${COMPOSED_QUERY}")`);

/* re-render: Fairy (EX-only) resets; the sort survives (speed asc). */
const SPE_ASC_VAN = sortedEntries(vanillaEntries, 'vanilla', 'spe', 'asc');
assert.ok(SPE_ASC_VAN[0] && SPE_ASC_VAN[0].key, 'the Vanilla speed-asc fixture is defined');

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
      /* the first-page tiles as { entry key, href, form label } (the
         form label is null on base tiles — issue #174: the key + label
         identify a tile, the href alone does not; two tiles share the
         species href) */
      const tiles = [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
        entry: x.getAttribute('data-dex-entry'),
        href: x.getAttribute('href'),
        form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
      }));
      return {
        sort: sel('dex-sort'),
        type: sel('dex-type'),
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        tiles,
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
    assert.equal(facts.count, FULL_EX_LINE, 'the pinned full EX count line (1308 entries — records + functional forms)');
    assert.equal(facts.tiles.length, PAGE_SIZE, 'the first (full) page of tiles');
    assert.deepEqual(facts.tiles.slice(0, 3), FIRST_TILES, 'the default sort is the entry list order — the first tiles are #1–#3 (byte-identical view)');
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
    const firstTile = (key) =>
      page.waitForFunction(
        (x) => {
          const tile = document.querySelector('#dex-grid .dex-tile');
          return tile ? tile.getAttribute('data-dex-entry') === x : false;
        },
        key,
        { timeout: SETTLE_TIMEOUT_MS }
      );

    // ACT + ASSERT — bst-desc: the derived (unique) leader first — a
    // functional-FORM entry (issue #174: it sorts on its own stats)
    await page.selectOption('#dex-sort', 'bst-desc');
    await firstTile(BST_DESC_EX[0].key);
    let facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
        entry: x.getAttribute('data-dex-entry'),
        href: x.getAttribute('href'),
        form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
      })),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      sort: document.getElementById('dex-sort').value,
    }));
    assert.equal(facts.tiles[0].entry, BST_DESC_EX[0].key, `bst-desc leads with ${BST_DESC_EX[0].name} (the derived unique leader)`);
    assert.equal(facts.tiles[0].form, BST_DESC_EX[0].form.name, 'the leader tile carries the .dex-tile__form label (the form display name)');
    assert.equal(facts.tiles[0].href, '#rec-pokedex-' + BST_DESC_EX[0].record.id, 'the form tile links the species record (no new hash scheme)');
    assert.equal(facts.tiles[1].entry, BST_DESC_EX[1].key, 'the second tile is the derived second');
    assert.equal(facts.count, FULL_EX_LINE, 'a pure sort does not change the count line');
    assert.equal(facts.sort, 'bst-desc', 'the select holds the selection');

    // ACT + ASSERT — bst-asc: the derived minimum (ties → dex order)
    await page.selectOption('#dex-sort', 'bst-asc');
    await firstTile(BST_ASC_EX[0].key);
    facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
        entry: x.getAttribute('data-dex-entry'),
        href: x.getAttribute('href'),
        form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
      })),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
    }));
    assert.equal(facts.tiles[0].entry, BST_ASC_EX[0].key, `bst-asc leads with ${BST_ASC_EX[0].name} (the derived minimum)`);
    assert.equal(facts.tiles[0].form, null, 'the derived minimum is a base tile (no form label)');
    assert.equal(facts.count, FULL_EX_LINE, 'still the full line');

    // ACT + ASSERT — dexnum-desc: the derived last-dex species
    await page.selectOption('#dex-sort', 'dexnum-desc');
    await firstTile(DEXNUM_DESC_EX[0].key);
    facts = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
        entry: x.getAttribute('data-dex-entry'),
        href: x.getAttribute('href'),
        form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
      })),
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
    }));
    assert.equal(facts.tiles[0].entry, DEXNUM_DESC_EX[0].key, `dexnum-desc leads with ${DEXNUM_DESC_EX[0].name} (the derived last-dex species)`);
    assert.equal(facts.tiles[0].form, null, 'the derived last-dex species is a base tile');
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
      (key) => {
        const tile = document.querySelector('#dex-grid .dex-tile');
        return tile ? tile.getAttribute('data-dex-entry') === key : false;
      },
      BST_DESC_EX[0].key,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE version toggle to Vanilla
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      ({ line, key }) =>
        (document.getElementById('dex-count')?.textContent || '').trim() === line &&
        (document.querySelector('#dex-grid .dex-tile')?.getAttribute('data-dex-entry') === key),
      { line: FULL_VANILLA_LINE, key: BST_DESC_VAN[0].key },
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the sort SURVIVED (still bst-desc) and now compares the
    // Vanilla overlay stats: the leader is the derived Vanilla one
    const facts = await page.evaluate(() => {
      const x = document.querySelector('#dex-grid .dex-tile');
      return {
        sort: document.getElementById('dex-sort').value,
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        first: x ? { entry: x.getAttribute('data-dex-entry'), href: x.getAttribute('href'), form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null } : null,
      };
    });
    assert.equal(facts.sort, 'bst-desc', 'the sort survives the version re-render (the keys are version-independent)');
    assert.equal(facts.count, FULL_VANILLA_LINE, 'the pinned full Vanilla count line (386 base entries — the invariant)');
    assert.equal(facts.first.entry, BST_DESC_VAN[0].key,
      `the Vanilla leader (${BST_DESC_VAN[0].name}) now leads — the sort reads the overlay stats, not the EX ones`);
    assert.equal(facts.first.form, null, 'Vanilla renders zero form tiles (the 386-entry invariant)');
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

    // ASSERT — the derived count + the derived first-dex Fairy entry
    // (the default sort — the entry list order — still applies; the
    // count includes functional forms whose own types are Fairy)
    const facts = await page.evaluate(() => {
      const x = document.querySelector('#dex-grid .dex-tile');
      return {
        type: document.getElementById('dex-type').value,
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        first: x ? { entry: x.getAttribute('data-dex-entry'), href: x.getAttribute('href'), form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null } : null,
      };
    });
    assert.equal(facts.type, 'Fairy', 'the select holds "Fairy"');
    assert.equal(facts.count, countLine(FAIRY_EX.length), `data/pokedex.json: ${FAIRY_EX.length} EX Fairy entries → "${countLine(FAIRY_EX.length)}"`);
    assert.equal(facts.first.entry, FAIRY_EX[0].key, `the first (dex-order) Fairy entry is ${FAIRY_EX[0].name}`);

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
    // (issue #174: the matching record surfaces its base entry AND its
    // functional form — the form tile follows the base, same href)
    const facts = await page.evaluate(() => ({
      type: document.getElementById('dex-type').value,
      sort: document.getElementById('dex-sort').value,
      query: document.getElementById('dex-search').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      tiles: [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
        entry: x.getAttribute('data-dex-entry'),
        href: x.getAttribute('href'),
        form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
      })),
    }));
    assert.equal(facts.type, 'Ghost');
    assert.equal(facts.sort, 'bst-desc');
    assert.equal(facts.query, COMPOSED_QUERY);
    assert.equal(facts.count, countLine(COMPOSED_LIST.length),
      `data/pokedex.json: ${COMPOSED_LIST.length} Ghost entries matching "${COMPOSED_QUERY}" → "${countLine(COMPOSED_LIST.length)}"`);
    assert.equal(facts.tiles[0].entry, COMPOSED_LIST[0].key, `the derived leader is ${COMPOSED_LIST[0].name}`);
    assert.equal(facts.tiles[1].entry, COMPOSED_LIST[1].key, 'the matching functional-form entry follows its base entry');
    assert.equal(facts.tiles[1].form, COMPOSED_LIST[1].form.name, 'the form tile carries the form label');
    assert.equal(facts.tiles[1].href, facts.tiles[0].href, 'both tiles link the same species record');
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
    const facts = await page.evaluate(() => {
      const x = document.querySelector('#dex-grid .dex-tile');
      return {
        type: document.getElementById('dex-type')
          ? { value: document.getElementById('dex-type').value, options: [...document.getElementById('dex-type').options].map((o) => [o.value, o.textContent]) }
          : null,
        sort: document.getElementById('dex-sort').value,
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        first: x ? { entry: x.getAttribute('data-dex-entry'), href: x.getAttribute('href'), form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null } : null,
      };
    });
    assert.equal(facts.type.options.length, VAN_TYPE_OPTIONS.length + 1, `the ${VAN_TYPE_OPTIONS.length} Vanilla standard types + "All types"`);
    assert.ok(!facts.type.options.some(([v]) => v === 'Fairy'), 'the EX-only Fairy option is gone under Vanilla');
    assert.equal(facts.type.value, 'all', 'the Fairy selection the new build lacks reset to "all" (the variant select\'s rule)');
    assert.equal(facts.sort, 'spe-asc', 'the sort survived the re-render');
    assert.equal(facts.count, FULL_VANILLA_LINE, 'the pinned full Vanilla count line (type reset to "all")');
    assert.equal(facts.first.entry, SPE_ASC_VAN[0].key, `the surviving sort now leads with the Vanilla speed-asc leader (${SPE_ASC_VAN[0].name})`);
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
      countLine(ofType(exEntries, longestType).length),
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

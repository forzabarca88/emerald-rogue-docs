/**
 * The Pokedex browse bar: the region-filter pressed indicator (issue #91)
 * and the dex-variant selector (issue #92) (node --test, zero deps;
 * Playwright resolved by the harness).
 *
 * #91 — selecting a region (e.g. Paldea) used to leave the visual
 * indicator stuck on "All": the click handler set state.region and
 * refreshed ONLY the grid/count/pager (updateBrowse), while the region
 * buttons' aria-pressed was generated only on the full-render path. The
 * filter worked; the indicator did not move. The fix syncs every
 * .dex-filter__btn's aria-pressed from state.region in updateBrowse() —
 * this test asserts the END STATE (pressed flags + count line) after
 * each click, never the sync call itself.
 *
 * #92 — the sticky .dex-browse bar gains the game's Pokédex-variant
 * selector (a native <select id="dex-variant"> — the only 360px-safe form
 * for up to 37 options): the active build's option list from the
 * settings.json range-pokedex-variant record's optionsByVersion (7
 * Vanilla / 37 EX, the same list the in-game menu offers) with an
 * "All variants" default, filtering records by their dexVariants
 * membership (the "all" shorthand = every variant of the build; the
 * data's variant strings are the game's fully-qualified "<region>
 * (<option>)" names, so membership is the option name inside the
 * parentheses). A selection the new build lacks (e.g. the EX-only
 * "Modern" when toggling to Vanilla) resets to "All variants" on the
 * version re-render.
 *
 * Every expectation is derived from data/pokedex.json +
 * data/settings.json (+ data/site.json for the tile-page size) at load —
 * never hardcoded from memory:
 *   - region counts: the region's share of the active build's records
 *     (data order = dex order; the region chips derive from the same
 *     record list in pokedex.js);
 *   - variant membership: records whose version-scoped dexVariants is
 *     the "all" shorthand or a list carrying the option's fully-qualified
 *     name — computed here exactly as the page computes it;
 *   - the combined region+variant+query case: the query side runs on the
 *     SHARED ROGUE.pokedexSearchText haystack (site/js/search-index.js,
 *     loaded into a node:vm sandbox with the real data — the same
 *     no-mock setup as test/search.test.mjs), because the on-page filter
 *     indexes that exact string;
 *   - the two project-wide pinned count lines ("1025 species · page 1 of
 *     37" EX / "386 species · page 1 of 14" Vanilla) are asserted as
 *     literals (they are pinned by smoke/version suites) and cross-checked
 *     against the data-derived value at load.
 *
 * Coverage:
 *   1. #91 — click the Paldea chip (derived count) → the clicked chip is
 *      aria-pressed="true", the "All" chip "false", the count line the
 *      derived Paldea line; click "All" → reversed pressed states + the
 *      pinned full EX line.
 *   2. #92 default state — the select renders "All variants" first then
 *      the EX options verbatim (38 total), value "all", the pinned full
 *      EX count line, 28 .dex-tile tiles, and the 10 .dex-filter__btn
 *      region buttons untouched (the select is not one of them).
 *   3. #92 membership — selecting the EX-only "Modern" option updates the
 *      count line to the data-derived membership (derived from
 *      data/pokedex.json).
 *   4. #92 combined — one derived spot-check of region + variant + query
 *      together (Hoenn + a variant + a query, expected count computed via
 *      the shared haystack).
 *   5. #92 version re-render — selecting "Modern" then the LIVE toggle to
 *      Vanilla resets the select to "All variants" (the option count
 *      shrinks to the Vanilla list) and the count line reads the pinned
 *      Vanilla line.
 *   6. 360px — with the variant select present (its longest option name
 *      selected, the widest stress) the bar is visible and
 *      documentElement.scrollWidth <= 360 (no horizontal overflow).
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before(), closeAll + server.close in after(), and each
 * test guards with skipIfNoPlaywright(t) (the suite self-skips on
 * machines without a Playwright install instead of failing `npm test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json, data/settings.json, data/site.json) */

const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json: no records');

const settings = JSON.parse(readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'));
const variantRange = settings.records.find((r) => r && r.id === 'range-pokedex-variant');
if (!variantRange || !variantRange.optionsByVersion) {
  throw new Error('data/settings.json: missing the range-pokedex-variant record');
}
const EX_OPTIONS = variantRange.optionsByVersion.ex;
const VANILLA_OPTIONS = variantRange.optionsByVersion.vanilla;
if (!Array.isArray(EX_OPTIONS) || EX_OPTIONS.length === 0) throw new Error('data/settings.json: empty ex variant options');
if (!Array.isArray(VANILLA_OPTIONS) || VANILLA_OPTIONS.length === 0) throw new Error('data/settings.json: empty vanilla variant options');

const siteCfg = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const PAGE_SIZE = siteCfg && siteCfg.dex ? Number(siteCfg.dex.pageSize) : NaN;
if (!Number.isFinite(PAGE_SIZE) || PAGE_SIZE <= 0) {
  throw new Error('data/site.json: missing a positive dex.pageSize (the tile-page size)');
}

/** The version-scoped record list (the page's ROGUE.filter, order-preserving). */
const recordsOf = (version) => records.filter((r) => Array.isArray(r.versions) && r.versions.includes(version));
const exRecords = recordsOf('ex');
const vanillaRecords = recordsOf('vanilla');

/** The page's count line for a filtered list at page 1 (pokedex.js updateBrowse). */
const countLine = (n) => n + ' species · page 1 of ' + Math.max(1, Math.ceil(n / PAGE_SIZE));

/* The project-wide pinned full lines — cross-checked against the data at
 * load so a drifted extraction fails HERE, not as a stale literal. */
const FULL_EX_LINE = countLine(exRecords.length);
const FULL_VANILLA_LINE = countLine(vanillaRecords.length);
assert.equal(FULL_EX_LINE, '1025 species · page 1 of 37', 'data/pokedex.json: the pinned EX full count line drifted — update the pinned literal');
assert.equal(FULL_VANILLA_LINE, '386 species · page 1 of 14', 'data/pokedex.json: the pinned Vanilla full count line drifted — update the pinned literal');

/* #91 fixture: a region with a non-trivial EX count (the issue's own
 * example), derived from the data; the chip labels derive from the same
 * record list pokedex.js reads. */
const REGIONS = [...new Set(records.map((r) => r.region))];
assert.equal(REGIONS.length + 1, 10, 'data/pokedex.json: the pinned 10 .dex-filter__btn (All + 9 regions) drifted');
const REGION = 'Paldea';
const PALDEA_N = exRecords.filter((r) => r.region === REGION).length;
assert.ok(REGIONS.includes(REGION) && PALDEA_N > 0, `data/pokedex.json: no "${REGION}" region records for the #91 fixture`);

/* The EX-only "Modern" Rogue dex — the in-game default variant; the
 * fixture guard pins its position (first EX option) so the derived label
 * is the data's, never memory. */
const MODERN = EX_OPTIONS[0];
assert.ok(MODERN.toLowerCase().startsWith('modern'), `data/settings.json: the first EX variant option should be the Modern Rogue dex, got "${MODERN}"`);
assert.ok(!VANILLA_OPTIONS.includes(MODERN), `data/settings.json: "${MODERN}" must be EX-only for the toggle-reset test`);

/**
 * Version-scoped dexVariants (the page's dexVariant overlay rule for
 * that field: the vanilla overlay wins under Vanilla when present, else
 * the EX top level).
 */
const dvOf = (r, version) =>
  version === 'vanilla' && r.vanilla && r.vanilla.dexVariants !== undefined ? r.vanilla.dexVariants : r.dexVariants;

/**
 * Membership of one record under one variant (the page's rule): the
 * "all" shorthand counts for every variant of the active build; the
 * data's variant strings are the game's fully-qualified "<region>
 * (<option>)" names (the settings option name is the parenthesized part),
 * so the option matches the qualified name's tail.
 */
function variantMember(r, version, option) {
  const dv = dvOf(r, version);
  if (dv === 'all') return true;
  if (!Array.isArray(dv)) return false;
  const suffix = ' (' + option + ')';
  return dv.some((v) => typeof v === 'string' && v.length >= suffix.length && v.slice(v.length - suffix.length) === suffix);
}
const MODERN_N = exRecords.filter((r) => variantMember(r, 'ex', MODERN)).length;
assert.ok(MODERN_N > 0, 'data/pokedex.json: no records under the Modern variant — the #92 fixture is degenerate');

/* #92 combined spot-check: region + variant + query, each dimension a
 * strict superset of the intersection (derived below; the guards make a
 * degenerate choice fail loudly). */
const COMBINED = { region: 'Hoenn', variant: 'Sun/Moon', query: 'thunderbolt' };
assert.ok(EX_OPTIONS.includes(COMBINED.variant), `data/settings.json: the combined fixture variant "${COMBINED.variant}" must be an EX option`);
assert.ok(REGIONS.includes(COMBINED.region), `data/pokedex.json: the combined fixture region "${COMBINED.region}" must exist`);

/* The query side runs on the SHARED on-page/palette haystack (the same
 * no-mock vm setup as test/search.test.mjs: real data on a fake window,
 * the three modules loaded in order — version-independent, it unions both
 * variants, so the version does not matter here). */
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

const COMBINED_REGION_N = exRecords.filter((r) => r.region === COMBINED.region).length;
const COMBINED_REGION_VARIANT_N = exRecords.filter((r) => r.region === COMBINED.region && variantMember(r, 'ex', COMBINED.variant)).length;
const COMBINED_REGION_QUERY_N = exRecords.filter(
  (r) => r.region === COMBINED.region && haystack[r.id].includes(COMBINED.query.toLowerCase())
).length;
const COMBINED_N = exRecords.filter(
  (r) => r.region === COMBINED.region && variantMember(r, 'ex', COMBINED.variant) && haystack[r.id].includes(COMBINED.query.toLowerCase())
).length;
assert.ok(
  COMBINED_N > 0 && COMBINED_N < COMBINED_REGION_VARIANT_N && COMBINED_N < COMBINED_REGION_QUERY_N && COMBINED_N < COMBINED_REGION_N,
  `combined fixture must be non-trivial (region ${COMBINED_REGION_N}, +variant ${COMBINED_REGION_VARIANT_N}, +query ${COMBINED_REGION_QUERY_N}, combined ${COMBINED_N})`
);

/* The 360px stress: the longest option name renders the widest select
 * text (the native elision still keeps the box at max-width 170px, but
 * the full text is the honest stress case). */
const LONGEST_OPTION = EX_OPTIONS.reduce((a, b) => (b.length > a.length ? b : a));

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

/** The region buttons' pressed flags, keyed by data-region (page context). */
const pressedState = () =>
  Object.fromEntries(
    [...document.querySelectorAll('.dex-filter__btn')].map((b) => [b.getAttribute('data-region'), b.getAttribute('aria-pressed')])
  );

/* --- the suite ------------------------------------------------------------- */

test('#91: clicking a region chip moves the pressed indicator and the count line (and "All" moves it back)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — pokedex.html at the default (EX) build, no hash
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction((line) => (document.getElementById('dex-count')?.textContent || '').trim() === line, FULL_EX_LINE, {
      timeout: SETTLE_TIMEOUT_MS,
    });
    const initial = await page.evaluate(pressedState);
    assert.equal(initial.all, 'true', 'at load the "All" chip is pressed (state.region = "all")');
    assert.equal(initial[REGION], 'false', `at load the ${REGION} chip is not pressed`);

    // ACT — click the ${REGION} chip (the filter worked before the fix; the
    // indicator is what #91 is about)
    await page.click(`.dex-filter__btn[data-region="${REGION}"]`);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(PALDEA_N),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end state: the indicator follows the filter
    const afterRegion = await page.evaluate(pressedState);
    assert.equal(afterRegion[REGION], 'true', `clicking ${REGION} leaves its chip aria-pressed="true" (issue #91: the indicator moved with the filter)`);
    assert.equal(afterRegion.all, 'false', 'the "All" chip is no longer pressed');
    for (const region of Object.keys(afterRegion)) {
      if (region !== REGION) assert.equal(afterRegion[region], 'false', `the ${region} chip is not pressed`);
    }
    assert.equal(
      await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim()),
      countLine(PALDEA_N),
      `data/pokedex.json: ${PALDEA_N} ${REGION} records → "${countLine(PALDEA_N)}"`
    );

    // ACT — click "All": the indicator and the count return
    await page.click('.dex-filter__btn[data-region="all"]');
    await page.waitForFunction((line) => (document.getElementById('dex-count')?.textContent || '').trim() === line, FULL_EX_LINE, {
      timeout: SETTLE_TIMEOUT_MS,
    });

    // ASSERT — reversed pressed states + the pinned full line
    const afterAll = await page.evaluate(pressedState);
    assert.equal(afterAll.all, 'true', 'clicking "All" re-presses it');
    assert.equal(afterAll[REGION], 'false', `the ${REGION} chip is no longer pressed`);
    assert.equal(
      await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim()),
      FULL_EX_LINE,
      'the pinned full EX count line is back'
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('#92 default: the variant select renders the EX options verbatim and leaves every pinned default untouched', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — read the browse bar's end state at load (nothing selected)
    const facts = await page.evaluate(() => {
      const s = document.getElementById('dex-variant');
      return {
        variant: s ? { value: s.value, options: [...s.options].map((o) => [o.value, o.textContent]) } : null,
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        tiles: document.querySelectorAll('.dex-tile').length,
        regionButtons: document.querySelectorAll('.dex-filter__btn').length,
      };
    });

    // ASSERT — the select: "All variants" first, then the EX options
    // verbatim (data/settings.json range-pokedex-variant), value "all"
    assert.ok(facts.variant, 'the #dex-variant select renders in the browse bar (issue #92)');
    assert.equal(facts.variant.value, 'all', 'the select defaults to "All variants"');
    assert.deepEqual(
      facts.variant.options,
      [['all', 'All variants'], ...EX_OPTIONS.map((o) => [o, o])],
      `data/settings.json: exactly ${EX_OPTIONS.length} EX options + "All variants" first, option names verbatim`
    );

    // ASSERT — every pinned default is untouched by the new control
    assert.equal(facts.count, FULL_EX_LINE, 'the pinned full EX count line (default "all" = no variant filter)');
    assert.equal(facts.tiles, PAGE_SIZE, `data/site.json dex.pageSize = ${PAGE_SIZE} → the first page of tiles`);
    assert.equal(facts.regionButtons, REGIONS.length + 1, 'the 10 .dex-filter__btn region buttons — the select is not one of them');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('#92: selecting the EX-only "Modern" variant filters to the data-derived membership', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — the default full line first
    await page.waitForFunction((line) => (document.getElementById('dex-count')?.textContent || '').trim() === line, FULL_EX_LINE, {
      timeout: SETTLE_TIMEOUT_MS,
    });

    // ACT — pick the Modern option (the in-game default dex, EX-only)
    await page.selectOption('#dex-variant', MODERN);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(MODERN_N),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end state: the selection holds and the count is the exact
    // data-derived membership (records whose dexVariants is "all" or
    // carries the Modern variant)
    const facts = await page.evaluate(() => ({
      variant: document.getElementById('dex-variant').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
      tiles: document.querySelectorAll('.dex-tile').length,
    }));
    assert.equal(facts.variant, MODERN, `the select holds "${MODERN}"`);
    assert.equal(facts.count, countLine(MODERN_N), `data/pokedex.json: ${MODERN_N} records under ${MODERN} → "${countLine(MODERN_N)}"`);
    assert.equal(facts.tiles, Math.min(PAGE_SIZE, MODERN_N), 'the grid shows the first (partial) page of the filtered list');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('#92: region + variant + query combine (one derived spot-check)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — the default full line first
    await page.waitForFunction((line) => (document.getElementById('dex-count')?.textContent || '').trim() === line, FULL_EX_LINE, {
      timeout: SETTLE_TIMEOUT_MS,
    });

    // ACT — apply all three filters: the region chip, the variant select,
    // the on-page search
    await page.click(`.dex-filter__btn[data-region="${COMBINED.region}"]`);
    await page.selectOption('#dex-variant', COMBINED.variant);
    await page.fill('#dex-search', COMBINED.query);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(COMBINED_N),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end state: all three filters hold and the count is the
    // derived intersection (the query side derived through the shared
    // ROGUE.pokedexSearchText haystack the on-page filter indexes)
    const facts = await page.evaluate(() => ({
      pressed: Object.fromEntries(
        [...document.querySelectorAll('.dex-filter__btn')].map((b) => [b.getAttribute('data-region'), b.getAttribute('aria-pressed')])
      ),
      variant: document.getElementById('dex-variant').value,
      query: document.getElementById('dex-search').value,
      count: (document.getElementById('dex-count')?.textContent || '').trim(),
    }));
    assert.equal(facts.pressed[COMBINED.region], 'true', `the ${COMBINED.region} chip stays pressed`);
    assert.equal(facts.variant, COMBINED.variant, `the select holds "${COMBINED.variant}"`);
    assert.equal(facts.query, COMBINED.query, `the search box holds "${COMBINED.query}"`);
    assert.equal(
      facts.count,
      countLine(COMBINED_N),
      `data/pokedex.json: ${COMBINED_N} records in ${COMBINED.region} under ${COMBINED.variant} matching "${COMBINED.query}" → "${countLine(COMBINED_N)}"`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('#92: selecting "Modern" then the live toggle to Vanilla resets the select to "All variants"', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — EX default, the Modern variant active
    await page.selectOption('#dex-variant', MODERN);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(MODERN_N),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE version toggle to Vanilla (the nav.js header buttons)
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      ({ line, options }) =>
        (document.getElementById('dex-count')?.textContent || '').trim() === line &&
        document.getElementById('dex-variant')?.options.length === options,
      { line: FULL_VANILLA_LINE, options: VANILLA_OPTIONS.length + 1 },
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — end state: the Vanilla option list, the reset select, and
    // the pinned Vanilla full line (the Modern selection the new build
    // lacks is gone, not carried over)
    const facts = await page.evaluate(() => {
      const s = document.getElementById('dex-variant');
      return {
        variant: s ? { value: s.value, options: [...s.options].map((o) => [o.value, o.textContent]) } : null,
        count: (document.getElementById('dex-count')?.textContent || '').trim(),
        urlVersion: new URLSearchParams(window.location.search).get('version'),
        togglePressed: document.querySelector('.version-toggle__option[data-version="vanilla"]')?.getAttribute('aria-pressed'),
      };
    });
    assert.equal(facts.urlVersion, 'vanilla', 'the toggle rewrote the URL to ?version=vanilla');
    assert.equal(facts.togglePressed, 'true', 'the Vanilla toggle option is pressed');
    assert.equal(facts.variant.options.length, VANILLA_OPTIONS.length + 1, `data/settings.json: ${VANILLA_OPTIONS.length} Vanilla options + "All variants"`);
    assert.deepEqual(facts.variant.options, [['all', 'All variants'], ...VANILLA_OPTIONS.map((o) => [o, o])], 'the Vanilla option list, verbatim');
    assert.ok(!facts.variant.options.some(([v]) => v === MODERN), `the EX-only "${MODERN}" option is gone under Vanilla`);
    assert.equal(facts.variant.value, 'all', `the select reset to "All variants" (the build no longer offers "${MODERN}")`);
    assert.equal(facts.count, FULL_VANILLA_LINE, 'the pinned full Vanilla count line (variant reset to "all")');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the browse bar with the variant select carries no horizontal overflow', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the 360px viewport (the DESIGN.md §9 contract width), the
  // longest option name selected (the widest stress on the select)
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    await page.selectOption('#dex-variant', LONGEST_OPTION);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(exRecords.filter((r) => variantMember(r, 'ex', LONGEST_OPTION)).length),
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the bar is visible and nothing overflows the 360px viewport
    const facts = await page.evaluate(() => {
      const bar = document.querySelector('#dex-overview .dex-browse');
      const select = document.getElementById('dex-variant');
      const selectRect = select ? select.getBoundingClientRect() : null;
      return {
        scrollWidth: document.documentElement.scrollWidth,
        barVisible: !!bar && bar.offsetParent !== null,
        selectRight: selectRect ? selectRect.right : null,
      };
    });
    assert.equal(facts.barVisible, true, 'the .dex-browse bar (with the variant select) is visible at 360px');
    assert.ok(Number.isFinite(facts.selectRight) && facts.selectRight <= 360, `the select fits the 360px viewport (right edge ${facts.selectRight}px)`);
    assert.ok(facts.scrollWidth <= 360, `no horizontal overflow at 360px (scrollWidth ${facts.scrollWidth}px <= 360px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

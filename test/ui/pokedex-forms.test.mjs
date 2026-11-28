/**
 * The Pokedex functional-form entries (issue #174b) — Playwright
 * (resolved by the harness; node --test, zero deps).
 *
 * The grid's unit is the ENTRY: every version-scoped record yields its
 * base entry plus one entry per form the data flags `functional: true`
 * (the extractor's pinned diff rule — types/stats/abilities differing
 * from the record's top-level values; the page reads the flag and never
 * re-derives it). The EX default is 1308 entries; Vanilla's `forms: []`
 * overlays keep it at 386 base entries (the invariant).
 *
 * The DOM contract (site/js/pages/pokedex.js dexTile):
 *   - every tile carries data-dex-entry="<key>" (a base entry's key is
 *     the record id; a form entry's is "<id>~<formIndex>") and links
 *     the SPECIES' record (#rec-pokedex-<id> — no new hash scheme; the
 *     form's detail is the species' structured Forms section);
 *   - a form tile adds the `dex-tile--form` modifier, the
 *     `.dex-tile__form` mono form-name label,
 *     `aria-label="<form name> (#<NNN>)"`, and the form's own sprite
 *     (the base's when the data ships no `form.sprite`);
 *   - the count line reads "<N> entries · page <x> of <y>" and the
 *     empty state says "No entries match …"; the detail's prev/next
 *     navigation stays record-level (the pokedex-nav suite pins it).
 *
 * Coverage:
 *   1. drift guard — the `functional` flag re-derived for EVERY form in
 *      data/pokedex.json (the extractor's exact rule mirrored, including
 *      the ability-collapse loop), then the rendered EX count line
 *      equals records + functional forms;
 *   2. the first-page form tile — the first functional-form entry on
 *      page 1 renders its label + form sprite + species href (asserted
 *      on data-dex-entry + label — page 1 can hold several tiles
 *      sharing one href);
 *   3. the type filter — a form-only type (Dragon on the derived Mega
 *      Charizard X) surfaces the derived form entry;
 *   4. the stat sort — bst-desc leads with the derived form entry (the
 *      form's OWN stats — the base record sorts far below it);
 *   5. the Vanilla invariant — ?version=vanilla: "386 entries · page 1
 *      of 17" and zero .dex-tile--form tiles;
 *   6. 360px — no horizontal overflow with the form labels.
 *
 * Every expectation is derived from data/pokedex.json (+ site.json for
 * the page size) at load — never hardcoded from memory; the resulting
 * literals are pinned so a data drift fails with a loud message.
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

/* --- the extractor's `functional` rule, mirrored exactly ------------------
 * A form is functional iff it differs from its record's TOP-LEVEL
 * (Expansion) values in any of types / stats / abilities; the field is
 * written ONLY when true. (scripts/extract/pokedex.mjs
 * formIsFunctional — this mirror is the drift guard's re-derivation.) */
const FUNCTIONAL_STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'total'];
function collapseAbilities(abilities) {
  const kept = [];
  let prev = null; // the raw previous slot (ABILITY_NONE initially)
  for (const a of abilities ?? []) {
    if (a && a !== prev) kept.push(a);
    prev = a;
  }
  return kept;
}
function formIsFunctional(form, rec) {
  if (JSON.stringify(form.types) !== JSON.stringify(rec.types)) return true;
  if (form.stats === undefined) return true;
  for (const key of FUNCTIONAL_STAT_KEYS) {
    if (form.stats[key] !== rec.stats[key]) return true;
  }
  if (form.abilities === undefined) return true;
  return JSON.stringify(collapseAbilities(form.abilities)) !== JSON.stringify(collapseAbilities(rec.abilities));
}

/* Drift guard #1 — the data's `functional` field agrees with the rule
 * for EVERY form (it is written only when true, so it is either
 * `true` or absent). */
let formCount = 0;
let functionalCount = 0;
for (const rec of records) {
  for (const form of rec.forms ?? []) {
    formCount += 1;
    const expected = formIsFunctional(form, rec);
    assert.equal(
      form.functional === true,
      expected,
      `data/pokedex.json: ${rec.id} form "${form.name}" — the functional flag (${form.functional === true}) disagrees with the extractor rule (${expected})`
    );
    if (expected) functionalCount += 1;
  }
}
assert.ok(formCount > 0 && functionalCount > 0, 'data/pokedex.json: no forms for the drift guard');

/* --- the entry-list mirror (site/js/pages/pokedex.js buildEntries) --------
 * Records in dex order, the base entry first, then its functional forms
 * in `forms`-array order. Fields resolve through the page's per-field
 * dexVariant rule: under Vanilla the diff-only `vanilla` overlay's value
 * wins when present (shared records' overlay is `forms: []` — that is
 * what keeps Vanilla at its 386 base entries), else the record's.
 * EX reads the top-level fields directly. */
const recordsOf = (version) => records.filter((r) => Array.isArray(r.versions) && r.versions.includes(version));
const fieldOf = (rec, version, field) =>
  version === 'vanilla' && rec.vanilla && rec.vanilla[field] !== undefined ? rec.vanilla[field] : rec[field];
function entriesOf(version) {
  const out = [];
  for (const rec of recordsOf(version)) {
    const baseTypes = Array.isArray(fieldOf(rec, version, 'types')) ? fieldOf(rec, version, 'types') : [];
    const baseStats = fieldOf(rec, version, 'stats');
    const forms = Array.isArray(fieldOf(rec, version, 'forms')) ? fieldOf(rec, version, 'forms') : [];
    out.push({ key: rec.id, record: rec, form: null, name: rec.name, dexNum: rec.dexNum, types: baseTypes, stats: baseStats });
    forms.forEach((f, i) => {
      if (f.functional !== true) return;
      out.push({
        key: rec.id + '~' + i,
        record: rec,
        form: f,
        name: typeof f.name === 'string' ? f.name : '',
        dexNum: rec.dexNum,
        types: Array.isArray(f.types) ? f.types : baseTypes,
        stats: f.stats && typeof f.stats === 'object' ? f.stats : baseStats,
      });
    });
  }
  return out;
}
const exEntries = entriesOf('ex');
const vanEntries = entriesOf('vanilla');

/* The page's count line (pokedex.js updateBrowse) — it counts ENTRIES. */
const countLine = (n) => n + ' entries \u00B7 page 1 of ' + Math.max(1, Math.ceil(n / PAGE_SIZE));
const EX_FULL_LINE = countLine(exEntries.length);
const VAN_FULL_LINE = countLine(vanEntries.length);
assert.equal(EX_FULL_LINE, '1308 entries \u00B7 page 1 of 55', 'data/pokedex.json: the pinned EX full count line drifted — re-derive the fixture');
assert.equal(VAN_FULL_LINE, '386 entries \u00B7 page 1 of 17', 'data/pokedex.json: the pinned Vanilla full count line drifted — re-derive the fixture');
assert.equal(exEntries.length, recordsOf('ex').length + functionalCount, 'EX entries = the EX records + their functional forms (the drift guard invariant)');
assert.equal(vanEntries.length, recordsOf('vanilla').length, 'Vanilla entries = its records (the 386-entry invariant — its forms overlays are all empty)');

/* --- fixtures (each guard fails loudly on a degenerate choice) ------------- */

/* The first functional-form entry on page 1 of the default EX view. */
const FIRST_FORM = exEntries.slice(0, PAGE_SIZE).find((e) => e.form !== null);
assert.ok(FIRST_FORM, 'the fixture needs a functional-form entry on page 1');

/* One tile's expected sprite (the page's formSpriteSrc rule: the form's
 * own art when the data ships `form.sprite`, else the base record's —
 * and the base record's own rule: the id + the -ex suffix when
 * record.spriteEx). */
const spriteOf = (e) =>
  e.form && typeof e.form.sprite === 'string'
    ? './assets/pokemon/' + e.form.sprite + '.png'
    : './assets/pokemon/' + e.record.id + (e.record.spriteEx ? '-ex' : '') + '.png';

/* The form-only-type fixture: the first (entry order) functional form
 * whose own types carry the type but whose base record's do not — a
 * type filter on it must surface the form entry (the data's example:
 * Dragon on Mega Charizard X; the base is Fire/Flying). */
const FORM_TYPE = 'Dragon';
const FORM_TYPE_ENTRY = exEntries.find(
  (e) => e.form && Array.isArray(e.form.types) && e.form.types.includes(FORM_TYPE) && !(Array.isArray(e.record.types) && e.record.types.includes(FORM_TYPE))
);
assert.ok(FORM_TYPE_ENTRY, `the fixture needs a functional form with a form-only ${FORM_TYPE} type`);
const FORM_TYPE_ENTRIES = exEntries.filter((e) => Array.isArray(e.types) && e.types.includes(FORM_TYPE));
const FORM_TYPE_INDEX = FORM_TYPE_ENTRIES.indexOf(FORM_TYPE_ENTRY);
assert.ok(FORM_TYPE_INDEX >= 0 && FORM_TYPE_INDEX < PAGE_SIZE,
  `the form-only ${FORM_TYPE} fixture must land on page 1 of the ${FORM_TYPE} filter (index ${FORM_TYPE_INDEX})`);
assert.ok(FORM_TYPE_ENTRIES.length > 0 && FORM_TYPE_ENTRIES.length < exEntries.length, `a non-trivial EX ${FORM_TYPE} count`);

/* The stat-sort fixture: the derived bst-desc leader — a functional-FORM
 * entry whose own stats carry it above every base record (unique — the
 * strongest possible fixture). */
const bstValue = (e) => (e.stats && typeof e.stats.total === 'number' ? e.stats.total : null);
const BST_SORTED = exEntries
  .map((e, i) => [bstValue(e), i, e])
  .sort((a, b) => {
    const av = a[0] === null ? -Infinity : a[0];
    const bv = b[0] === null ? -Infinity : b[0];
    return bv - av || a[1] - b[1];
  })
  .map((x) => x[2]);
const BST_LEADER = BST_SORTED[0];
assert.ok(BST_LEADER.form !== null, 'the EX bst-desc leader must be a functional-form entry (issue #174: form entries sort on their own stats)');
assert.ok(BST_SORTED.length > 1 && bstValue(BST_LEADER) > (bstValue(BST_SORTED[1]) === null ? -Infinity : bstValue(BST_SORTED[1])),
  'the EX bst-desc fixture needs a unique leader');

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

/* --- shared page-context helper ---------------------------------------------
 * The page.evaluate / waitForFunction callbacks are SERIALIZED into the
 * page context (no node-side free variables). The tile mapping is
 * therefore shared as a SOURCE string + its argument, not as a closure. */
const TILE_FACTS_SRC = (
  () => [...document.querySelectorAll('#dex-grid .dex-tile')].map((x) => ({
    entry: x.getAttribute('data-dex-entry'),
    href: x.getAttribute('href'),
    form: x.querySelector('.dex-tile__form') ? x.querySelector('.dex-tile__form').textContent : null,
    sprite: x.querySelector('.dex-tile__sprite') ? x.querySelector('.dex-tile__sprite').getAttribute('src') : null,
  }))
).toString();
const tileFacts = (page) => page.evaluate((src) => new Function('return ' + src)()(), TILE_FACTS_SRC);

test('drift guard: every form\u2019s functional flag matches the extractor rule, and the rendered EX count line is records + functional forms', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // The load-time re-derivation above already proved the field agrees
    // with the rule for the data's forms — here the LIVE page must
    // render exactly that count: the EX records + their functional
    // forms, paged.
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      EX_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const count = await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim());
    const tiles = await tileFacts(page);
    assert.equal(count, EX_FULL_LINE, `the rendered EX count line is the ${recordsOf('ex').length} EX records + their ${functionalCount} functional forms (${exEntries.length} entries, issue #174)`);
    assert.equal(tiles.length, PAGE_SIZE, 'page 1 draws exactly pageSize tiles');
    assert.ok(tiles.every((x) => typeof x.entry === 'string' && x.entry.length > 0), 'every tile carries a non-empty data-dex-entry key (the entry model)');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('the first-page functional-form tile renders its label, its sprite and the species href', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      EX_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const tiles = await tileFacts(page);
    const tile = tiles.find((x) => x.entry === FIRST_FORM.key);
    assert.ok(tile, `page 1 renders the first functional-form entry ${FIRST_FORM.key} (the ${FIRST_FORM.form.name} form of ${FIRST_FORM.record.id})`);
    assert.equal(tile.form, FIRST_FORM.form.name, 'the tile carries the .dex-tile__form label with the form\u2019s display name');
    assert.equal(tile.sprite, spriteOf(FIRST_FORM), 'the tile shows the form\u2019s own sprite (the base\u2019s only when the data ships no form.sprite)');
    assert.equal(tile.href, '#rec-pokedex-' + FIRST_FORM.record.id, 'the form tile links the SPECIES\u2019 record (no new hash scheme)');
    /* the base entry of the SAME record is on the page too — two tiles
     * share the href, which is why the assertions above key on
     * data-dex-entry + label, not the href alone */
    const base = tiles.find((x) => x.entry === FIRST_FORM.record.id);
    assert.ok(base, 'the base entry of the same record renders on page 1 as well');
    assert.equal(base.href, tile.href, 'base + form tiles of one record share the species href');
    assert.equal(base.form, null, 'the base tile carries no form label');
    /* and the modifier class marks the form tiles */
    const mods = await page.evaluate((key) => {
      const x = [...document.querySelectorAll('#dex-grid .dex-tile')].find((el) => el.getAttribute('data-dex-entry') === key);
      return x ? x.classList.contains('dex-tile--form') : null;
    }, FIRST_FORM.key);
    assert.equal(mods, true, 'the form tile carries the .dex-tile--form modifier class');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('a type filter on a form-only type surfaces the derived form entry', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      EX_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    // ACT — the type filter (a form-only type: the base record does NOT
    // carry it — only the form entry does)
    await page.selectOption('#dex-type', FORM_TYPE);
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      countLine(FORM_TYPE_ENTRIES.length),
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const count = await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim());
    const tiles = await tileFacts(page);
    assert.equal(count, countLine(FORM_TYPE_ENTRIES.length),
      `the ${FORM_TYPE} filter counts the ENTRIES whose own types carry ${FORM_TYPE} — ${FORM_TYPE_ENTRIES.length} (issue #174: form types, not base types)`);
    const tile = tiles[FORM_TYPE_INDEX];
    assert.ok(tile, `the filtered page 1 is full enough to hold the ${FORM_TYPE}-only form (index ${FORM_TYPE_INDEX})`);
    assert.equal(tile.entry, FORM_TYPE_ENTRY.key, `the form-only ${FORM_TYPE} surfaces the derived form entry (${FORM_TYPE_ENTRY.form.name} — the base ${FORM_TYPE_ENTRY.record.id} is not ${FORM_TYPE})`);
    assert.equal(tile.form, FORM_TYPE_ENTRY.form.name, 'the form entry renders its label');
    assert.equal(tile.href, '#rec-pokedex-' + FORM_TYPE_ENTRY.record.id, 'the form tile links the species record');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('bst-desc leads with the derived functional-form entry (the form\u2019s own stats)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      EX_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    // ACT — the stat sort
    await page.selectOption('#dex-sort', 'bst-desc');
    await page.waitForFunction(
      (key) => {
        const tile = document.querySelector('#dex-grid .dex-tile');
        return tile ? tile.getAttribute('data-dex-entry') === key : false;
      },
      BST_LEADER.key,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const count = await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim());
    const first = (await tileFacts(page))[0] || null;
    assert.equal(first.entry, BST_LEADER.key, `bst-desc leads with ${BST_LEADER.form.name} — a functional-form entry sorting on its own ${bstValue(BST_LEADER)}-BST stats (issue #174)`);
    assert.equal(first.form, BST_LEADER.form.name, 'the leader tile carries the form label');
    assert.equal(first.href, '#rec-pokedex-' + BST_LEADER.record.id, 'the leader tile links the species record');
    /* the BASE entry of the leader is far down the list — the same
     * href does NOT lead (the entry, not the record, is the unit) */
    assert.notEqual(first.entry, BST_LEADER.record.id, 'the leader is the form entry, not the base entry of the same record');
    assert.equal(count, EX_FULL_LINE, 'a pure sort does not change the count line');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('Vanilla invariant: 386 base entries, zero form tiles', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      VAN_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const count = await page.evaluate(() => (document.getElementById('dex-count')?.textContent || '').trim());
    const tiles = await tileFacts(page);
    const formTiles = await page.evaluate(() => document.querySelectorAll('#dex-grid .dex-tile--form').length);
    assert.equal(count, VAN_FULL_LINE, 'the Vanilla count line is the 386 shared records\u2019 base entries (their forms overlays are all empty — issue #174\u2019s invariant)');
    assert.equal(formTiles, 0, 'Vanilla renders zero .dex-tile--form tiles');
    assert.equal(tiles.length, PAGE_SIZE, 'page 1 still draws exactly pageSize tiles');
    assert.ok(tiles.every((x) => x.form === null), 'every Vanilla tile is a base tile (no form labels)');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the form labels carry no horizontal overflow', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    // Page 1 of the default EX view holds functional-form tiles (the
    // labels render — the widest-stress grid).
    await page.waitForFunction(
      (line) => (document.getElementById('dex-count')?.textContent || '').trim() === line,
      EX_FULL_LINE,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      formTiles: document.querySelectorAll('#dex-grid .dex-tile--form').length,
      labels: document.querySelectorAll('#dex-grid .dex-tile__form').length,
    }));
    assert.ok(facts.formTiles > 0, 'the 360px fixture needs form tiles on page 1 (the labels are the stress)');
    assert.equal(facts.labels, facts.formTiles, 'every form tile carries exactly one .dex-tile__form label');
    assert.ok(facts.scrollWidth <= 360, `no horizontal overflow at 360px with the form labels (scrollWidth ${facts.scrollWidth}px <= 360px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

/**
 * The Pokedex form-sprite rendering (PR A / issue #85: "no sprites for
 * forms or mega evolutions") — Playwright suite via the shared harness
 * (node --test, zero deps; Playwright resolved by the harness, self-skip
 * contract).
 *
 * The structured-forms section renders a static .dex-form__sprite img in
 * EVERY .dex-form row (js/pages/pokedex.js formSpriteSrc): the form's own
 * flat <formEntryId>.png when the data carries `form.sprite`, else the
 * BASE record's sprite — the no-art forms (the base-identical palette
 * swaps and the name-only rogue custom forms) fall back to it, by design
 * (DESIGN.md §6; a bound onerror handler hides a missing file). Every
 * expectation below is derived from data/pokedex.json at load (the plan
 * names only the deep-link ids charizard / arceus); the base spriteSrc
 * mirrors the page's own rule (record.id + '-ex' when the EX composite
 * diverged, the record's spriteEx flag). Zero console/page errors in
 * every test.
 *
 * Coverage:
 *   a. EX #rec-pokedex-charizard — each of the Mega Charizard X/Y
 *      .dex-form blocks carries an img.dex-form__sprite whose src equals
 *      the data-derived './assets/pokemon/<formEntryId>.png', and every
 *      form sprite in the panel is loaded (naturalWidth > 0);
 *   b. #rec-pokedex-arceus — at least one plate form with its OWN sprite
 *      src (data-derived), loaded (and no unloaded sprite anywhere in
 *      the panel);
 *   c. the first record in data order with a plain {name}-only form
 *      (derived — a no-entry rogue custom form) — its .dex-form--plain
 *      row's img src equals the BASE record's spriteSrc (the fallback
 *      proven in-DOM), loaded;
 *   d. ?version=vanilla #rec-pokedex-charizard — ZERO .dex-form blocks
 *      (the vanilla overlay's forms: [] — Vanilla renders no forms at
 *      all) while the detail itself renders;
 *   e. 360px (DESIGN.md §9) — the charizard detail's forms section
 *      causes no horizontal overflow and every form sprite renders at
 *      the tile token (3rem of the 1rem root = 48px).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json has no records');
const byId = Object.fromEntries(records.map((r) => [r.id, r]));

/* --- derived literals (data/pokedex.json — never hardcoded) ------------------
 * The page's spriteSrc rule (js/pages/pokedex.js): the record's id + '-ex'
 * when the EX composite diverges from the Vanilla one (the record's
 * spriteEx flag), under the EX build.
 */
const baseSpriteSrc = (rec) => './assets/pokemon/' + rec.id + (rec.spriteEx ? '-ex' : '') + '.png';

const charizard = byId.charizard;
if (!charizard) throw new Error('data/pokedex.json: no charizard record');
/* the plan-named megas, located by their data names */
const CHARDIZARD_MEGA_X = (charizard.forms || []).find((f) => f.name === 'Mega Charizard X');
const CHARDIZARD_MEGA_Y = (charizard.forms || []).find((f) => f.name === 'Mega Charizard Y');
if (!CHARDIZARD_MEGA_X || !CHARDIZARD_MEGA_Y) throw new Error('data/pokedex.json: charizard lacks its Mega X/Y forms');
if (typeof CHARDIZARD_MEGA_X.sprite !== 'string' || typeof CHARDIZARD_MEGA_Y.sprite !== 'string') {
  throw new Error('data/pokedex.json: the charizard megas carry no form.sprite');
}
const CHARZARD_FORM_SRCS = (charizard.forms || []).map((f) => (typeof f.sprite === 'string' ? './assets/pokemon/' + f.sprite + '.png' : baseSpriteSrc(charizard)));

const arceus = byId.arceus;
if (!arceus) throw new Error('data/pokedex.json: no arceus record');
const ARCEUS_OWN_SRCS = (arceus.forms || []).filter((f) => typeof f.sprite === 'string').map((f) => './assets/pokemon/' + f.sprite + '.png');
if (ARCEUS_OWN_SRCS.length === 0) throw new Error('data/pokedex.json: no arceus plate form carries a form.sprite');

/* the first record in data (dex) order with a plain {name}-only form — a
 * no-entry rogue custom form whose --plain row renders the base sprite */
const plainRec = records.find((r) => (r.forms || []).some((f) => Object.keys(f).length === 1 && typeof f.name === 'string'));
if (!plainRec) throw new Error('data/pokedex.json: no record carries a plain {name}-only form');

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

/** Wait until every form sprite in the detail has finished loading
 * (complete — success OR failure; the naturalWidth assertions below are
 * the success gate, so a 404 cannot hide behind a timeout). */
async function waitForFormSprites(page, { min = 1 } = {}) {
  await page.waitForFunction(
    (n) => {
      const imgs = [...document.querySelectorAll('#dex-species img.dex-form__sprite')];
      return imgs.length >= n && imgs.every((i) => i.complete);
    },
    min,
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

/** The panel's form-sprite facts: [src, naturalWidth, hidden, offsetWidth]. */
const formSpriteFacts = () =>
  [...document.querySelectorAll('#dex-species img.dex-form__sprite')].map((i) => [
    i.getAttribute('src'),
    i.naturalWidth,
    i.hidden,
    i.offsetWidth,
  ]);

/* --- the suite ------------------------------------------------------------- */

test('charizard (EX): every .dex-form row carries its own loaded form sprite', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the charizard detail at the default (EX) build
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — deep-link charizard and settle the form sprites
    await openDetail(page, 'charizard');
    await waitForFormSprites(page);

    // ASSERT — one img per .dex-form row, in data order, each with the
    // data-derived src and loaded (naturalWidth > 0, not hidden)
    const facts = await page.evaluate(formSpriteFacts);
    const blockCount = await page.evaluate(() => document.querySelectorAll('#dex-species .dex-forms .dex-form').length);
    assert.equal(blockCount, CHARZARD_FORM_SRCS.length, 'one .dex-form block per structured form (data/pokedex.json charizard.forms)');
    assert.equal(facts.length, CHARZARD_FORM_SRCS.length, 'one .dex-form__sprite img per .dex-form row');
    assert.ok(facts.some(([src]) => src === './assets/pokemon/' + CHARDIZARD_MEGA_X.sprite + '.png'), 'Mega Charizard X carries its own form sprite');
    assert.ok(facts.some(([src]) => src === './assets/pokemon/' + CHARDIZARD_MEGA_Y.sprite + '.png'), 'Mega Charizard Y carries its own form sprite');
    for (let i = 0; i < facts.length; i++) {
      const [src, width, hidden] = facts[i];
      assert.equal(src, CHARZARD_FORM_SRCS[i], `form row ${i}: src ${src} ≠ the data-derived src`);
      assert.ok(width > 0, `form row ${i} (${src}): not loaded (naturalWidth ${width})`);
      assert.equal(hidden, false, `form row ${i} (${src}): hidden — the onerror fallback fired`);
    }
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('arceus (EX): a plate form carries its own loaded form sprite', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the arceus detail at the default (EX) build
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — deep-link arceus and settle the form sprites
    await openDetail(page, 'arceus');
    await waitForFormSprites(page);

    // ASSERT — ≥1 plate form with its OWN sprite src (data-derived),
    // loaded — and no unloaded sprite anywhere in the panel
    const facts = await page.evaluate(formSpriteFacts);
    assert.ok(facts.length >= ARCEUS_OWN_SRCS.length, 'every plate form row rendered a sprite');
    const own = facts.filter(([src]) => ARCEUS_OWN_SRCS.includes(src));
    assert.ok(own.length > 0, 'no plate form carries its own form sprite src');
    for (const [src, width, hidden] of own) {
      assert.ok(width > 0, `${src}: not loaded (naturalWidth ${width})`);
      assert.equal(hidden, false, `${src}: hidden — the onerror fallback fired`);
    }
    for (const [, width] of facts) assert.ok(width > 0, `an unloaded form sprite in the panel (naturalWidth ${width})`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('a no-entry custom-form detail: the --plain row renders the BASE sprite fallback', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the first record in data order with a plain {name}-only
  // form (a no-entry rogue custom form — the data names it, the test
  // never hardcodes it)
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — deep-link it and settle the form sprites
    await openDetail(page, plainRec.id);
    await waitForFormSprites(page);

    // ASSERT — the .dex-form--plain row's img src is the BASE record's
    // spriteSrc (the fallback proven in-DOM), loaded; the plain row is
    // the box-less sprite+name row (its sprite is a direct flex child)
    const facts = await page.evaluate((base) => {
      const rows = [...document.querySelectorAll('#dex-species .dex-form--plain')];
      return {
        count: rows.length,
        plain: rows.map((row) => {
          const img = row.querySelector('img.dex-form__sprite');
          return img ? { src: img.getAttribute('src'), width: img.naturalWidth, hidden: img.hidden, base: img.getAttribute('src') === base } : null;
        }),
      };
    }, baseSpriteSrc(plainRec));
    assert.ok(facts.count > 0, `${plainRec.id}: no .dex-form--plain row rendered`);
    for (const row of facts.plain) {
      assert.ok(row, 'a --plain row without an img.dex-form__sprite');
      assert.equal(row.src, baseSpriteSrc(plainRec), 'the --plain row must show the BASE record\'s sprite (form.sprite absent)');
      assert.equal(row.base, true, 'in-DOM proof: the --plain img src equals the base spriteSrc');
      assert.ok(row.width > 0, 'the base-sprite fallback did not load');
      assert.equal(row.hidden, false, 'the base-sprite fallback is hidden');
    }
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('charizard (Vanilla): the detail renders with ZERO .dex-form blocks', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the one-time ?version= override: the Vanilla build
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    // ACT — deep-link charizard (a shared record — the detail renders)
    await openDetail(page, 'charizard');

    // ASSERT — the vanilla overlay's forms: [] — the forms field block
    // is absent entirely (no .dex-form, no --plain row, no sprite img)
    const facts = await page.evaluate(() => ({
      panel: document.getElementById('rec-pokedex-charizard') !== null,
      forms: document.querySelectorAll('#dex-species .dex-form').length,
      plain: document.querySelectorAll('#dex-species .dex-form--plain').length,
      sprites: document.querySelectorAll('#dex-species img.dex-form__sprite').length,
    }));
    assert.equal(facts.panel, true, 'the charizard detail renders under Vanilla (a shared record)');
    assert.equal(facts.forms, 0, 'Vanilla renders no .dex-form blocks (the vanilla overlay\'s forms: [])');
    assert.equal(facts.plain, 0, 'no --plain rows under Vanilla');
    assert.equal(facts.sprites, 0, 'no form-sprite imgs under Vanilla');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('charizard at 360px: the forms section never overflows horizontally', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the 360px contract viewport (DESIGN.md §9)
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    // ACT — deep-link charizard and settle the form sprites
    await openDetail(page, 'charizard');
    await waitForFormSprites(page);

    // ASSERT — no horizontal overflow anywhere in the document, and
    // every form sprite renders at the tile token (3rem of the 1rem
    // root font-size = 48px, square)
    const facts = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      sprites: [...document.querySelectorAll('#dex-species img.dex-form__sprite')].map((i) => [i.offsetWidth, i.offsetHeight]),
    }));
    assert.ok(facts.scrollWidth <= 360, `horizontal overflow at 360px (documentElement.scrollWidth ${facts.scrollWidth})`);
    assert.ok(facts.bodyScrollWidth <= 360, `horizontal overflow at 360px (body.scrollWidth ${facts.bodyScrollWidth})`);
    assert.ok(facts.sprites.length > 0, 'no form sprites rendered');
    for (const [w, h] of facts.sprites) {
      assert.equal(w, 48, `form sprite width ${w} ≠ the tile token (48px)`);
      assert.equal(h, 48, `form sprite height ${h} ≠ the tile token (48px)`);
    }
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

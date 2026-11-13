/**
 * Playwright suite for the Pokedex evolution field (issue #97): the
 * in-game Pokédex's own display — the raw evolution tables run through
 * the game's `Rogue_ModifyEvolution` rewrite, so a species carries one
 * `.dex-evo__branch` row per surviving branch (method caption + target
 * link), its own cell once on top, the prev row trailing the list, and
 * the forms that carry their own branches a `.dex-form__evo` line.
 *
 * (1) Eevee (EX, the default build): 8 branch rows — the full post-
 *     rewrite fan-out (seven stones + the Sylveon move-type evo) — each
 *     row a method caption + a hash-linked target cell, the current cell
 *     "Eevee" on top, no prev row;
 * (2) the live version toggle re-scopes the same open detail to the
 *     Vanilla overlay: 5 rows (no Sylveon, the one-word Thunderstone);
 * (3) Vanilla Golbat: the friendship rewrite's result — a
 *     "Level up at 30" branch to Crobat with the Zubat prev row;
 * (4) forms with their own branches: the Basculin (White Striped) form
 *     block carries the 2 gender branches and the Galarian Yamask form
 *     block its single level-34 Runerigus row (data/pokedex.json
 *     form.evo — the rewrite is keyed by the species value held).
 *
 * Every expected row count / method literal is derived from the
 * committed data/pokedex.json at load, not hardcoded.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const byId = new Map(dex.records.map((r) => [r.id, r]));

let server;
before(async () => {
  // No Playwright → every test self-skips; skip the dist/ build too.
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

const SETTLE_TIMEOUT_MS = 10_000; // guard for the state waits below (a bound, not a sleep)

/* --- derived literals (data/pokedex.json, the active-build evo value) ------ */

/** The build's evo value: the vanilla overlay wins when it carries the
 *  field (an explicit null = "this build has no evo"), else the EX one. */
function evoOf(rec, version) {
  if (version === 'vanilla' && rec.vanilla && typeof rec.vanilla === 'object' && rec.vanilla.evo !== undefined) {
    return rec.vanilla.evo ?? null;
  }
  return rec.evo ?? null;
}
const branchCount = (evo) => (evo ? (evo.evos ? evo.evos.length : 0) + (evo.prev ? 1 : 0) : 0);

const EEVEE_REC = byId.get('eevee');
const EEVEE_EX_ROWS = branchCount(evoOf(EEVEE_REC, 'ex')); // 8 — the seven stones + the Sylveon evo
const EEVEE_VAN_ROWS = branchCount(evoOf(EEVEE_REC, 'vanilla')); // 5 — no Sylveon under Vanilla
const GOLBAT_VAN = evoOf(byId.get('golbat'), 'vanilla');
const GOLBAT_VAN_ROWS = branchCount(GOLBAT_VAN); // 2 — the Crobat branch + the Zubat prev
const GOLBAT_VAN_METHODS = GOLBAT_VAN.evos.map((e) => e.method); // the friendship→level-30 rewrite
const BASCULIN_WHITE = (byId.get('basculin').forms ?? []).find((f) => f.name === 'Basculin (White Striped)');
const BASCULIN_WHITE_ROWS = BASCULIN_WHITE.evo.evos.length; // 2 — the gender branches
const BASCULIN_WHITE_METHODS = BASCULIN_WHITE.evo.evos.map((e) => e.method);
const YAMASK_GALAR = (byId.get('yamask').forms ?? []).find((f) => f.name === 'Galarian Yamask (Galarian)');
const YAMASK_GALAR_METHODS = YAMASK_GALAR.evo.evos.map((e) => e.method); // the level-34 Runerigus

/* --- shared helpers (all page-context functions must be self-contained) ---- */

/** The detail's own evolution field (issue #97): the branch rows under
 *  .dex-species__field > .dex-evo (the per-form .dex-form__evo lines are
 *  a different container) + the current cell's name. */
const evoFacts = () => {
  const panel = document.querySelector('.dex-species');
  if (!panel) return null;
  const field = panel.querySelector('.dex-species__field > .dex-evo');
  const rows = field ? [...field.querySelectorAll(':scope > .dex-evo__branch')] : [];
  const current = panel.querySelector('.dex-evo__cell--current .dex-evo__name');
  return {
    rows: rows.length,
    rowTexts: rows.map((r) => r.textContent.trim()),
    captionPerRow: rows.every((r) => r.querySelector('.dex-evo__method') !== null),
    linkPerRow: rows.every((r) => r.querySelector('.dex-evo__cell') !== null),
    currentName: current ? current.textContent.trim() : null,
  };
};

/** The detail's per-form evo lines, keyed by the form's display name. */
const formEvoFacts = () => {
  const out = {};
  for (const f of document.querySelectorAll('.dex-forms .dex-form')) {
    const name = (f.querySelector('.dex-form__name')?.textContent || '').trim();
    const rows = [...f.querySelectorAll('.dex-form__evo .dex-evo__branch')];
    out[name] = { rows: rows.length, rowTexts: rows.map((r) => r.textContent.trim()) };
  }
  return out;
};

/** Deep-link a species detail and wait for its evo field to settle at
 *  `expectedRows` branch rows (0 = the field is absent — wait for the
 *  detail panel itself). */
async function openSpecies(page, id, expectedRows) {
  await page.evaluate((recId) => {
    window.location.hash = '#rec-pokedex-' + recId;
  }, id);
  await page.waitForFunction(
    (n) => {
      const panel = document.querySelector('.dex-species');
      if (!panel) return false;
      const field = panel.querySelector('.dex-species__field > .dex-evo');
      if (n === 0) return field === null;
      return field !== null && field.querySelectorAll(':scope > .dex-evo__branch').length === n;
    },
    expectedRows,
    { timeout: SETTLE_TIMEOUT_MS },
  );
}

test('pokedex.html (EX): Eevee’s detail shows its 8 post-rewrite branches as branch rows (own cell once, no prev row)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    assert.equal(EEVEE_EX_ROWS, 8, 'sanity: the derived Eevee EX branch count (data/pokedex.json eevee.evo.evos)');
    await openSpecies(page, 'eevee', EEVEE_EX_ROWS);
    const facts = await page.evaluate(evoFacts);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(facts.rows, EEVEE_EX_ROWS, 'the eight Eevee branches render as branch rows');
    assert.equal(facts.currentName, 'Eevee', 'the record’s own cell renders once, on top');
    assert.equal(facts.captionPerRow, true, 'every branch row carries its mono method caption');
    assert.equal(facts.linkPerRow, true, 'every branch row carries its target cell');
    // the post-rewrite content: the artefact/stone methods + the Sylveon evo
    for (const id of ['jolteon', 'vaporeon', 'flareon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon']) {
      assert.ok(
        facts.rowTexts.some((txt) => txt.includes(byId.get(id).name)),
        `Eevee’s branch rows include the ${byId.get(id).name} target (data/pokedex.json eevee.evo.evos)`
      );
    }
    assert.ok(facts.rowTexts.some((txt) => txt.includes('Level up knowing a Fairy-type move')), 'the Sylveon move-type evo branch');
    // no prev row: Eevee has no pre-evolution (evoOf returns evos only)
    assert.equal(evoOf(EEVEE_REC, 'ex').prev, undefined, 'sanity: the data says no prev');
  } finally {
    await close();
  }
});

test('pokedex.html: the live version toggle re-scopes an open Eevee detail to the Vanilla overlay (5 rows)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    assert.equal(EEVEE_VAN_ROWS, 5, 'sanity: the derived Eevee Vanilla branch count (data/pokedex.json eevee.vanilla.evo)');
    await openSpecies(page, 'eevee', EEVEE_EX_ROWS);
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      (n) => {
        const panel = document.querySelector('.dex-species');
        const field = panel?.querySelector('.dex-species__field > .dex-evo');
        return field && field.querySelectorAll(':scope > .dex-evo__branch').length === n;
      },
      EEVEE_VAN_ROWS,
      { timeout: SETTLE_TIMEOUT_MS },
    );
    const facts = await page.evaluate(evoFacts);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(facts.rows, EEVEE_VAN_ROWS, 'the Vanilla overlay shows its five branches');
    assert.equal(facts.currentName, 'Eevee', 'the detail stays open on the same species');
    assert.ok(facts.rowTexts.every((txt) => !txt.includes('Sylveon')), 'no Sylveon branch under Vanilla (the vanilla table has no such evo)');
    assert.ok(facts.rowTexts.some((txt) => txt.includes('Thunderstone')), 'the vanilla one-word Thunderstone method (data/pokedex.json eevee.vanilla.evo)');
  } finally {
    await close();
  }
});

test('pokedex.html (vanilla): Golbat’s detail shows the friendship rewrite as “Level up at 30” with the Zubat prev row', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    await openSpecies(page, 'golbat', GOLBAT_VAN_ROWS);
    const facts = await page.evaluate(evoFacts);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(facts.rows, GOLBAT_VAN_ROWS, 'the Crobat branch + the Zubat prev row');
    for (const method of GOLBAT_VAN_METHODS) {
      assert.ok(facts.rowTexts.some((txt) => txt.includes(method)), `the "${method}" branch caption (data/pokedex.json golbat.vanilla.evo)`);
    }
    assert.ok(facts.rowTexts.some((txt) => txt.includes(byId.get('zubat').name)), 'the prev row links Zubat');
  } finally {
    await close();
  }
});

test('pokedex.html (EX): the forms with their own branches render a .dex-form__evo line (Basculin White’s 2, Galarian Yamask’s 1)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    assert.equal(BASCULIN_WHITE_ROWS, 2, 'sanity: the derived Basculin (White Striped) branch count (data/pokedex.json basculin.forms)');
    await openSpecies(page, 'basculin', 0); // the record itself has no evo — the field is absent
    const forms = await page.evaluate(formEvoFacts);
    const hasField = await page.evaluate(() => document.querySelector('.dex-species .dex-species__field > .dex-evo') !== null);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(hasField, false, 'the basculin record (the red base) renders no evo field of its own');
    const white = forms['Basculin (White Striped)'];
    assert.ok(white, 'the Basculin (White Striped) form block renders');
    assert.equal(white.rows, BASCULIN_WHITE_ROWS, 'the form’s 2 gender branches render under its block');
    for (const method of BASCULIN_WHITE_METHODS) {
      assert.ok(white.rowTexts.some((txt) => txt.includes(method)), `the "${method}" form branch caption (data/pokedex.json basculin.forms)`);
    }

    await page.evaluate(() => {
      window.location.hash = '#rec-pokedex-yamask';
    });
    await page.waitForFunction(
      () => {
        const forms = [...document.querySelectorAll('.dex-forms .dex-form')];
        const y = forms.find((f) => (f.querySelector('.dex-form__name')?.textContent || '').trim() === 'Galarian Yamask (Galarian)');
        return y !== undefined && y.querySelectorAll('.dex-form__evo .dex-evo__branch').length > 0;
      },
      null,
      { timeout: SETTLE_TIMEOUT_MS },
    );
    const allForms = await page.evaluate(formEvoFacts);
    const yamask = allForms['Galarian Yamask (Galarian)'];
    assert.ok(yamask, 'the Galarian Yamask form block renders');
    for (const method of YAMASK_GALAR_METHODS) {
      assert.ok(yamask.rowTexts.some((txt) => txt.includes(method)), `the "${method}" form branch caption (data/pokedex.json yamask.forms)`);
    }
  } finally {
    await close();
  }
});

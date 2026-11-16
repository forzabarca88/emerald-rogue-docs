/**
 * The Pokedex abilities rendering (issue #108; node --test, zero deps;
 * Playwright resolved by the harness) — the in-game pokedex's ability
 * display loop dedupes CONSECUTIVE duplicate abilities
 * (references/pokeemerald-rogue src/rogue_pokedex.c: `ability != prevAbility`
 * while printing the 3-slot ability table), and the renderer must mirror
 * that rule in `abilitiesHtml()` (both call sites: the base Abilities field
 * and the per-form .dex-form blocks). The data keeps the faithful 3-slot
 * table (the 86 forms — mostly Mega forms — carry triple-duplicated
 * abilities), so the END RESULT is what this test pins: each ability name
 * appears exactly once per consecutive run.
 *
 * Fixture (derived from data/pokedex.json at load): charizard — the base
 * record's non-duplicated abilities (Blaze, Solar Power) plus the two
 * triple-duplicated Mega forms (Mega Charizard X ×3 Tough Claws, Mega
 * Charizard Y ×3 Drought).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json) --------------------------------- */

const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const charizard = (Array.isArray(dex.records) ? dex.records : []).find((r) => r.id === 'charizard');
assert.ok(charizard, 'data/pokedex.json: the charizard record');

/* The in-game consecutive-dedupe rule (rogue_pokedex.c's `ability != prevAbility`). */
const dedupe = (abilities) => {
  const kept = [];
  for (const a of abilities) {
    if (a && kept[kept.length - 1] !== a) kept.push(a);
  }
  return kept;
};

/* The fixture: a non-duplicated base record + two triple-duplicated
 * Mega forms (the guard fails loudly on a degenerate choice). */
const BASE_ABILITIES = charizard.abilities || [];
assert.deepEqual(BASE_ABILITIES, ['Blaze', 'Solar Power'], 'the charizard base abilities are non-duplicated (fixture)');
const formOf = (name) => (Array.isArray(charizard.forms) ? charizard.forms : []).find((f) => f.name === name);
const MEGA_X = formOf('Mega Charizard X');
const MEGA_Y = formOf('Mega Charizard Y');
assert.ok(MEGA_X && MEGA_Y, 'the charizard record carries both Mega forms (fixture)');
assert.deepEqual(MEGA_X.abilities, ['Tough Claws', 'Tough Claws', 'Tough Claws'], 'Mega Charizard X is the triple-duplicated form (fixture)');
assert.deepEqual(MEGA_Y.abilities, ['Drought', 'Drought', 'Drought'], 'Mega Charizard Y is the triple-duplicated form (fixture)');
const EXPECTED_BASE = dedupe(BASE_ABILITIES);
const EXPECTED_MEGA_X = dedupe(MEGA_X.abilities);
const EXPECTED_MEGA_Y = dedupe(MEGA_Y.abilities);

let server;
before(async () => {
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

test('the abilities render the in-game consecutive-dedupe result (base field + Mega forms)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + charizard.id });
  try {
    // ARRANGE/ACT — the deep link renders charizard's detail; read the
    // rendered end result: the base Abilities field's names + every
    // .dex-form block's name + abilities, in DOM order
    const facts = await page.evaluate((names) => {
      const namesOf = (el) => [...el.querySelectorAll('.dex-ability__name')].map((x) => x.textContent);
      const base = document.getElementById('dex-f-abilities');
      const forms = [...document.querySelectorAll('#dex-species .dex-form')].map((block) => ({
        name: block.querySelector('.dex-form__name')?.textContent || '',
        abilities: namesOf(block),
      }));
      return {
        basePresent: !!base,
        base: base ? namesOf(base) : null,
        forms: forms.filter((f) => names.includes(f.name)),
      };
    }, [MEGA_X.name, MEGA_Y.name]);

    // ASSERT — the base abilities field is unchanged (no consecutive
    // duplicates in the data → rendered verbatim)
    assert.ok(facts.basePresent, 'the base Abilities field renders in the charizard detail');
    assert.deepEqual(facts.base, EXPECTED_BASE, 'the base abilities render once each (Blaze, Solar Power)');

    // ASSERT — each Mega form's triple-duplicated ability renders exactly
    // once (the in-game consecutive-dedupe rule)
    const megaX = facts.forms.find((f) => f.name === MEGA_X.name);
    const megaY = facts.forms.find((f) => f.name === MEGA_Y.name);
    assert.ok(megaX && megaY, 'both Mega form blocks render in the charizard detail');
    assert.deepEqual(megaX.abilities, EXPECTED_MEGA_X, 'Mega Charizard X renders Tough Claws exactly once');
    assert.deepEqual(megaY.abilities, EXPECTED_MEGA_Y, 'Mega Charizard Y renders Drought exactly once');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

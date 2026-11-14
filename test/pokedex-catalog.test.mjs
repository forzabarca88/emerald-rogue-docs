/**
 * data/pokedex.json top-level catalog guard (issue #99).
 *
 * The `catalog` is the move & ability reference behind the Pokedex
 * detail tables: `moves` keyed by display name (the EX
 * {type, power, accuracy, pp, effect?} values — 0/none → null,
 * placeholder descriptions → null, Dynamax Max Moves beyond
 * MOVES_COUNT get no entry), `abilities` (the EX in-game descriptions;
 * a colliding name's entries joined with ' / '), and `catalog.vanilla`
 * the diff-only Vanilla overlay (moves/abilities sub-keys omitted when
 * empty).
 *
 * The site resolves every learnset/ability name per ACTIVE version
 * (catalog.vanilla under Vanilla, the EX value otherwise), so the
 * contract tested here is: the shapes are valid, every name a build's
 * detail can display resolves for that build, and the vanilla overlay
 * is purely diff (nothing identical to the EX value rides along).
 *
 * Plain file reads of the committed data — no mocks, no build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const cat = dex.catalog;
const vanillaCat = cat && cat.vanilla && typeof cat.vanilla === 'object' ? cat.vanilla : {};

/** The 18 modern standard type display names (the game's gTypeNames
 *  table minus the two non-standard slots — Vanilla's NUMBER_OF_MON_TYPES
 *  stops at DRAGON, so it is the same set minus Fairy). */
const STANDARD_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'
];
/** Every type a move's `.type` can display: the standard names plus the
 *  game's two non-standard slots — Mystery (e.g. vanilla Curse, "functions
 *  differently for GHOSTS") and Stellar (no EX move carries it). */
const TYPES = new Set([...STANDARD_TYPES, 'Mystery', 'Stellar']);

/** The active build's record-field value (the site's dexVariant overlay rule). */
function fieldOf(rec, version, field) {
  if (version === 'vanilla' && rec.vanilla && typeof rec.vanilla === 'object' && rec.vanilla[field] !== undefined) {
    return rec.vanilla[field] ?? null;
  }
  return rec[field] ?? null;
}

/** The active build's catalog lookup (pages/pokedex.js moveEntry/abilityDesc). */
function moveLookup(name, version) {
  if (version === 'vanilla' && vanillaCat.moves && Object.prototype.hasOwnProperty.call(vanillaCat.moves, name)) {
    return vanillaCat.moves[name];
  }
  return cat.moves && Object.prototype.hasOwnProperty.call(cat.moves, name) ? cat.moves[name] : null;
}
function abilityLookup(name, version) {
  if (version === 'vanilla' && vanillaCat.abilities && Object.prototype.hasOwnProperty.call(vanillaCat.abilities, name)) {
    return vanillaCat.abilities[name];
  }
  return cat.abilities && Object.prototype.hasOwnProperty.call(cat.abilities, name) ? cat.abilities[name] : null;
}

const moveNames = (moves) => {
  if (!moves || typeof moves !== 'object') return [];
  const names = [];
  (Array.isArray(moves.levelUp) ? moves.levelUp : []).forEach((p) => names.push(Array.isArray(p) ? p[0] : p));
  (Array.isArray(moves.tm) ? moves.tm : []).forEach((n) => names.push(n));
  (Array.isArray(moves.tutor) ? moves.tutor : []).forEach((n) => names.push(n));
  return names;
};

const abilityNames = (abilities) => (Array.isArray(abilities) ? abilities : []);

/* --- 1. presence + entry shape ---------------------------------------------- */

test('the catalog is present, complete and well-shaped', () => {
  assert.ok(cat && typeof cat === 'object', 'top-level catalog object');
  assert.ok(cat.moves && typeof cat.moves === 'object', 'catalog.moves');
  assert.ok(cat.abilities && typeof cat.abilities === 'object', 'catalog.abilities');
  assert.ok(Object.keys(cat.moves).length >= 800, `catalog.moves populated (${Object.keys(cat.moves).length})`);
  assert.ok(Object.keys(cat.abilities).length >= 100, `catalog.abilities populated (${Object.keys(cat.abilities).length})`);

  const seenTypes = new Set();
  for (const [name, entry] of Object.entries(cat.moves)) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), `move "${name}" entry is an object`);
    for (const key of Object.keys(entry)) {
      assert.ok(['type', 'power', 'accuracy', 'pp', 'effect'].includes(key), `move "${name}": unexpected key "${key}"`);
    }
    assert.ok(TYPES.has(entry.type), `move "${name}": type "${entry.type}" is a display name`);
    seenTypes.add(entry.type);
    /* the power bound is the game's actual max — Explosion is 250 in EX
     * (battle_moves.h) — not the 200 of the mainline games */
    for (const [field, lo, hi] of [['power', 1, 250], ['accuracy', 1, 100], ['pp', 1, 199]]) {
      if (entry[field] !== null && entry[field] !== undefined) {
        assert.ok(Number.isInteger(entry[field]) && entry[field] >= lo && entry[field] <= hi,
          `move "${name}": ${field} ${entry[field]} is an integer in ${lo}..${hi}`);
      } else {
        assert.ok(entry[field] === null || entry[field] === undefined, `move "${name}": ${field} is null or a number`);
      }
    }
    if (entry.effect !== undefined) {
      assert.ok(typeof entry.effect === 'string' && entry.effect.trim().length > 0, `move "${name}": effect is a non-empty string`);
    }
  }
  for (const t of STANDARD_TYPES) assert.ok(seenTypes.has(t), `catalog.moves covers the "${t}" type`);
  for (const [name, desc] of Object.entries(cat.abilities)) {
    assert.ok(typeof desc === 'string' && desc.trim().length > 0, `ability "${name}": non-empty description`);
  }
});

/* --- 2. the vanilla overlay is diff-only ------------------------------------- */

test('every catalog.vanilla entry differs from (or is absent from) its EX counterpart', () => {
  for (const [name, entry] of Object.entries(vanillaCat.moves ?? {})) {
    const ex = cat.moves[name];
    assert.ok(ex === undefined || JSON.stringify(ex) !== JSON.stringify(entry), `vanilla move "${name}" is identical to EX`);
  }
  for (const [name, desc] of Object.entries(vanillaCat.abilities ?? {})) {
    assert.ok(cat.abilities[name] !== desc, `vanilla ability "${name}" is identical to EX`);
  }
});

/* --- 3. every displayed name resolves per active version --------------------- */

test('every learnset move and displayed ability resolves in the active build\'s catalog', () => {
  const problems = [];
  for (const rec of dex.records) {
    for (const version of ['expansion', 'vanilla']) {
      for (const name of moveNames(fieldOf(rec, version, 'moves'))) {
        if (!moveLookup(name, version)) problems.push(`${rec.id} (${version}): move "${name}" uncatalogued`);
      }
      for (const name of abilityNames(fieldOf(rec, version, 'abilities'))) {
        if (!abilityLookup(name, version)) problems.push(`${rec.id} (${version}): ability "${name}" uncatalogued`);
      }
      /* forms render only under EX (the vanilla overlay carries forms: []) */
      if (version === 'expansion') {
        for (const form of rec.forms ?? []) {
          for (const name of abilityNames(form.abilities)) {
            if (!abilityLookup(name, 'expansion')) problems.push(`${rec.id} (form ${form.name}): ability "${name}" uncatalogued`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `uncatalogued names:\n${problems.slice(0, 20).join('\n')}`);
  assert.equal(problems.length, 0, `${problems.length} uncatalogued names`);
});

/* --- 4. content spot-pins ----------------------------------------------------- */

test('spot-pinned catalog entries match the game source', () => {
  const ember = cat.moves['Ember'];
  assert.deepEqual(
    ember && { type: ember.type, power: ember.power, accuracy: ember.accuracy, pp: ember.pp },
    { type: 'Fire', power: 40, accuracy: 100, pp: 25 },
    'Ember stats'
  );
  assert.ok(ember && typeof ember.effect === 'string' && ember.effect.length > 0, 'Ember has an in-game effect');

  assert.ok(cat.abilities['Overgrow'], 'Overgrow is in the EX catalog');
  assert.ok(vanillaCat.abilities && vanillaCat.abilities['Overgrow'], 'Overgrow is in the vanilla overlay (the caps differ)');
  assert.equal(cat.abilities['Overgrow'], 'Ups Grass moves in a pinch.', 'Overgrow EX description');
  assert.equal(vanillaCat.abilities['Overgrow'], 'Ups GRASS moves in a pinch.', 'Overgrow vanilla description');

  assert.equal(cat.moves['Hidden Power'].power, 60, 'EX Hidden Power power (B_HIDDEN_POWER_DMG)');
  assert.equal(vanillaCat.moves['Hidden Power'].power, 1, 'vanilla Hidden Power power');
  assert.equal(cat.moves['Luster Purge'].power, 95, 'EX Luster Purge power (B_UPDATED_MOVE_DATA)');
  assert.equal(vanillaCat.moves['Luster Purge'].power, 70, 'vanilla Luster Purge power');
});

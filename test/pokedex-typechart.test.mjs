/**
 * data/pokedex.json top-level typeChart guard (issue #100, analytics PR
 * 4a).
 *
 * The `typeChart` is the per-build damage-multiplier table the game uses
 * to score attacks — the input of the dex's offensive-coverage /
 * immunity metrics (the "Viability" prose block documents the formulas).
 * The EX table (src/battle_util.c's sTypeEffectivenessTable, a dense
 * 20×20 uq4_12 matrix) ships as the top-level value; the Vanilla table
 * (src/battle_main.c's gTypeEffectiveness flat triple list, 18 types)
 * ships as the diff-only `typeChart.vanilla` overlay ONLY when it
 * genuinely differs from the EX table on the shared axes (the
 * record-overlay convention).
 *
 * The contract tested here: the shapes are valid (the type axes in
 * TYPE_* value order, square matrices, the game's multiplier set), the
 * well-known chart cells read correctly (incl. the EX #if resolution —
 * Ghost/Dark do NOT resist Steel in the shipped build), the vanilla
 * overlay differs from the EX-restricted table on EXACTLY the two
 * pre-Gen-6 Steel-resistance cells, and the "Viability" prose block is
 * present with its formulas and the dual citation.
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

/** The branch's TYPE_* value order (the matrix axes) — the display
 *  names the extractor derives from the type constants. */
const EX_TYPES = [
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Mystery',
  'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy', 'Stellar',
];
const VAN_TYPES = EX_TYPES.filter((t) => t !== 'Fairy' && t !== 'Stellar');
const MULTIPLIERS = new Set([0, 0.5, 1, 2]);

test('the EX typeChart shape: 20 type axes in TYPE_* value order, a square matrix of game multipliers', () => {
  const tc = dex.typeChart;
  assert.ok(tc && typeof tc === 'object', 'data/pokedex.json: the top-level typeChart is present');
  assert.deepEqual(tc.types, EX_TYPES, 'data/pokedex.json: the EX type axes are the 20 TYPE_* values in value order');
  assert.equal(tc.mult.length, 20, 'the EX matrix is 20 rows (one per attacker type)');
  for (const row of tc.mult) {
    assert.equal(Array.isArray(row), true, 'each row is an array');
    assert.equal(row.length, 20, 'each row has 20 cells (one per defender type)');
    for (const v of row) {
      assert.ok(MULTIPLIERS.has(v), `each cell is a game multiplier (${[...MULTIPLIERS].join(', ')})`);
    }
  }
  assert.equal(new Set(tc.mult.flat()).size, 4, 'all four multipliers occur (no dead value)');
  assert.equal(typeof tc.source, 'string', 'the citation string is present');
  assert.match(tc.source, /src\/battle_util\.c @origin\/expansion/, 'cites the EX table');
  assert.match(tc.source, /src\/battle_main\.c @vanilla/, 'cites the vanilla table');
});

test('the EX chart reads the well-known cells (incl. the #if resolution — Ghost/Dark do not resist Steel)', () => {
  const tc = dex.typeChart;
  const c = (atk, def) => tc.mult[tc.types.indexOf(atk)][tc.types.indexOf(def)];
  // the pre-Gen-6 branch would give 0.5 here — the shipped build
  // (B_STEEL_RESISTANCES = GEN_LATEST ≥ GEN_6) gives neutral
  assert.equal(c('Ghost', 'Steel'), 1, 'EX: Ghost is neutral against Steel (B_STEEL_RESISTANCES ≥ GEN_6)');
  assert.equal(c('Dark', 'Steel'), 1, 'EX: Dark is neutral against Steel (B_STEEL_RESISTANCES ≥ GEN_6)');
  // immunities
  assert.equal(c('Ghost', 'Normal'), 0);
  assert.equal(c('Normal', 'Ghost'), 0);
  assert.equal(c('Psychic', 'Dark'), 0);
  assert.equal(c('Dragon', 'Fairy'), 0);
  assert.equal(c('Electric', 'Ground'), 0);
  assert.equal(c('Ground', 'Flying'), 0);
  // supers
  assert.equal(c('Fire', 'Grass'), 2);
  assert.equal(c('Fire', 'Steel'), 2);
  assert.equal(c('Fairy', 'Dragon'), 2);
  assert.equal(c('Fairy', 'Fighting'), 2);
  assert.equal(c('Dark', 'Psychic'), 2);
  assert.equal(c('Bug', 'Psychic'), 2);
  assert.equal(c('Steel', 'Ice'), 2);
  // resistances
  assert.equal(c('Fire', 'Water'), 0.5);
  assert.equal(c('Fairy', 'Steel'), 0.5);
  assert.equal(c('Fairy', 'Fire'), 0.5);
  assert.equal(c('Psychic', 'Psychic'), 0.5);
  // the two non-standard rows are all neutral (the non-defenders)
  for (const t of ['Mystery', 'Stellar']) {
    assert.ok(tc.mult[tc.types.indexOf(t)].every((v) => v === 1), `EX: the ${t} row is all neutral`);
  }
});

test('the vanilla overlay: 18 axes, the pre-Gen-6 chart, and it differs from the EX-restricted table on exactly the two Steel cells', () => {
  const tc = dex.typeChart;
  const van = tc.vanilla;
  assert.ok(van && typeof van === 'object', 'data/pokedex.json: the vanilla overlay is present (the tables genuinely differ)');
  assert.deepEqual(van.types, VAN_TYPES, 'the vanilla axes are the 18 vanilla TYPE_* values (no Fairy/Stellar)');
  assert.equal(van.mult.length, 18);
  for (const row of van.mult) {
    assert.equal(row.length, 18);
    for (const v of row) assert.ok(MULTIPLIERS.has(v), 'vanilla cells are game multipliers');
  }
  const v = (atk, def) => van.mult[van.types.indexOf(atk)][van.types.indexOf(def)];
  const e = (atk, def) => tc.mult[tc.types.indexOf(atk)][tc.types.indexOf(def)];
  // the vanilla (pre-Gen-6) Steel resistances
  assert.equal(v('Ghost', 'Steel'), 0.5, 'vanilla: Ghost resists Steel');
  assert.equal(v('Dark', 'Steel'), 0.5, 'vanilla: Dark resists Steel');
  // other well-known vanilla cells (the triple-list defaults)
  assert.equal(v('Poison', 'Steel'), 0);
  assert.equal(v('Bug', 'Grass'), 2);
  assert.equal(v('Steel', 'Ice'), 2);
  assert.equal(v('Normal', 'Ghost'), 0);
  assert.equal(v('Fire', 'Water'), 0.5);
  assert.equal(v('Electric', 'Ground'), 0);
  // the shared-cell diff is EXACTLY the two pre-Gen-6 Steel cells
  const diffs = [];
  for (const atk of VAN_TYPES) {
    for (const def of VAN_TYPES) {
      if (v(atk, def) !== e(atk, def)) diffs.push(`${atk}>${def}: vanilla=${v(atk, def)} ex=${e(atk, def)}`);
    }
  }
  assert.deepEqual(diffs.sort(), ['Dark>Steel: vanilla=0.5 ex=1', 'Ghost>Steel: vanilla=0.5 ex=1'],
    'the only shared-cell differences are the two pre-Gen-6 Steel resistances');
});

test('the "Viability" prose block: formulas + the dual citation, and none of the pinned search words', () => {
  assert.equal(dex.prose.length, 5, 'the fifth prose block (Viability) joined the four');
  const block = dex.prose.find((b) => b.id === 'viability');
  assert.ok(block, 'the viability block is present');
  assert.equal(block.heading, 'Viability');
  assert.equal(typeof block.text, 'string');
  assert.ok(block.text.length > 0, 'the block has its short text');
  assert.ok(Array.isArray(block.list) && block.list.length >= 5, 'the fact list documents the metrics');
  assert.equal(typeof block.source, 'string');
  assert.match(block.source, /src\/battle_util\.c @origin\/expansion/, 'cites the EX table');
  assert.match(block.source, /src\/battle_main\.c @vanilla/, 'cites the vanilla table');
  // the pinned UI-search query words (the pokedex.html palette rows are
  // count-pinned by test/ui/search.test.mjs) must not gain a hit here
  const hay = [block.text, ...block.list].join(' ').toLowerCase();
  for (const word of ['pikachu', 'turtwig', 'thunderbolt', 'mega', 'spring', 'the final run', 'pokabbie', 'victory lap']) {
    assert.ok(!hay.includes(word), `the viability block must not contain the pinned search word "${word}"`);
  }
});

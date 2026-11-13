/**
 * data/pokedex.json evolution shape + content guard (issue #97).
 *
 * The evo data is the in-game Pokédex's own display: the raw evolution
 * tables run through a line-faithful port of the game's
 * `Rogue_ModifyEvolution` rewrite (src/rogue_baked.c — byte-identical in
 * both branches, the #ifdef ROGUE_EXPANSION split resolved per branch).
 * The emitted shape per record / vanilla-overlay / form:
 *   { prev?: { id, method }, evos?: [ { id, method }, … ] }
 * - `evos` = the surviving post-rewrite branches (SPECIES_NONE targets and
 *   the surviving 0xFFFE EVO_NONE sentinels dropped, capped at 8 like the
 *   in-game display);
 * - `prev` = the smallest-dex-number record (same build) whose own post-
 *   rewrite list targets this species (records by id, forms by their own
 *   species value — which resolves to the form's base record id);
 * - both keys are omitted when absent.
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
const byId = new Map(dex.records.map((r) => [r.id, r]));

/** The active build's evo value: the vanilla overlay wins when it carries
 *  the field (an explicit null means "this build has no evo"), else the
 *  top-level (EX) value. */
function evoOf(rec, version) {
  if (version === 'vanilla' && rec.vanilla && typeof rec.vanilla === 'object' && rec.vanilla.evo !== undefined) {
    return rec.vanilla.evo ?? null;
  }
  return rec.evo ?? null;
}

/** One evo value's branch entries, in display order: evos first, prev last. */
const branchIds = (evo) => (evo ? (evo.evos ?? []).map((e) => e.id) : []);

const methodsOf = (evo, id) => (evo ? (evo.evos ?? []).filter((e) => e.id === id).map((e) => e.method) : []);

const formOf = (rec, name) => (rec.forms ?? []).find((f) => f.name === name) ?? null;

const expectFormEvos = (rec, formName, id, methods, ctx) => {
  const form = formOf(rec, formName);
  assert.ok(form && form.evo, `${ctx}: form "${formName}" carries its own evo`);
  assert.deepEqual(methodsOf(form.evo, id), methods, `${ctx}: form "${formName}" → ${id}`);
};

/* --- 1. shape contract (every evo value in the file) ----------------------- */

test('every evo value (records, vanilla overlays, forms) carries only prev/evos of {id, method}, ≤8 evos, existing targets', () => {
  const problems = [];
  const check = (evo, where) => {
    if (evo === null) return; // explicit "this build has no evo" (vanilla overlay)
    if (evo === undefined) return;
    if (typeof evo !== 'object' || Array.isArray(evo)) return problems.push(`${where}: not an object`);
    for (const key of Object.keys(evo)) {
      if (key !== 'prev' && key !== 'evos') problems.push(`${where}: unexpected key "${key}"`);
    }
    if (evo.evos !== undefined) {
      if (!Array.isArray(evo.evos)) return problems.push(`${where}: evos is not an array`);
      if (evo.evos.length > 8) problems.push(`${where}: ${evo.evos.length} evos exceed the 8-branch display cap`);
      if (evo.evos.length === 0) problems.push(`${where}: empty evos array (the key must be omitted)`);
      for (const e of evo.evos) {
        const keys = Object.keys(e).sort().join(',');
        if (keys !== 'id,method') problems.push(`${where}: evo entry keys [${keys}]`);
        if (!byId.has(e.id)) problems.push(`${where}: evo target "${e.id}" is not a record`);
        if (typeof e.method !== 'string' || !e.method) problems.push(`${where}: evo target ${e.id} has no method text`);
        // a target id MAY repeat with different methods (Kubfu's two
        // stones, Milcery's seven cream forms) — each branch is its own row
      }
    }
    if (evo.prev !== undefined) {
      const keys = Object.keys(evo.prev).sort().join(',');
      if (keys !== 'id,method') problems.push(`${where}: prev keys [${keys}]`);
      if (!byId.has(evo.prev.id)) problems.push(`${where}: prev "${evo.prev.id}" is not a record`);
      if (typeof evo.prev.method !== 'string' || !evo.prev.method) problems.push(`${where}: prev has no method text`);
    }
    if (evo.evos === undefined && evo.prev === undefined) problems.push(`${where}: empty evo object (should be absent)`);
  };
  for (const rec of dex.records) {
    check(rec.evo, `record ${rec.id}`);
    if (rec.vanilla && typeof rec.vanilla === 'object') check(rec.vanilla.evo, `record ${rec.id} vanilla`);
    for (const f of rec.forms ?? []) check(f.evo, `record ${rec.id} form ${f.name}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/* --- 2. prev consistency (the emitted invariant, per build) ---------------- */

test('every prev is a record whose own post-rewrite list targets this species (both builds)', () => {
  const problems = [];
  const check = (evo, selfId, selfBaseId, version) => {
    if (!evo || !evo.prev) return;
    const src = byId.get(evo.prev.id);
    if (!src) return;
    const srcEvo = evoOf(src, version);
    // a form under record R is matched by its own value, which the source
    // list emits as R's record id; a record matches its own id
    const targetsSelf = (srcEvo?.evos ?? []).some((e) => e.id === selfBaseId);
    if (!targetsSelf) problems.push(`${version}: ${evo.prev.id} claims to be the prev of ${selfId} but its ${version} list does not target it`);
  };
  for (const rec of dex.records) {
    for (const version of ['ex', 'vanilla']) {
      if (version === 'vanilla' && rec.versions.indexOf('vanilla') === -1) continue;
      check(evoOf(rec, version), rec.id, rec.id, version);
      for (const f of rec.forms ?? []) check(f.evo, f.name, rec.id, version);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/* --- 3. exact content spot-checks (both builds) ---------------------------- */

const expectEvos = (rec, version, id, methods, ctx) => {
  assert.deepEqual(methodsOf(evoOf(rec, version), id), methods, `${ctx}: ${rec.id} ${version} → ${id}`);
};

const expectBranchIds = (evo, ids, ctx) => {
  assert.deepEqual(branchIds(evo), ids, `${ctx}: branch ids`);
};

const expectPrev = (rec, version, id, method, ctx) => {
  const prev = evoOf(rec, version)?.prev ?? null;
  assert.deepEqual(prev, { id, method }, `${ctx}: ${rec.id} ${version} prev`);
};

test('eevee: 8 EX branches (stones + the Sylveon move-type evo), 5 Vanilla (no Sylveon, Thunderstone one word)', () => {
  const rec = byId.get('eevee');
  expectBranchIds(evoOf(rec, 'ex'), ['jolteon', 'vaporeon', 'flareon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon'], 'eevee ex');
  expectEvos(rec, 'ex', 'jolteon', ['Use Thunder Stone'], 'eevee ex');
  expectEvos(rec, 'ex', 'espeon', ['Use Sun Stone'], 'eevee ex');
  expectEvos(rec, 'ex', 'umbreon', ['Use Moon Stone'], 'eevee ex');
  expectEvos(rec, 'ex', 'sylveon', ['Level up knowing a Fairy-type move'], 'eevee ex');
  assert.equal(evoOf(rec, 'ex').prev, undefined, 'eevee ex: no prev (no pre-evolution)');
  expectBranchIds(evoOf(rec, 'vanilla'), ['jolteon', 'vaporeon', 'flareon', 'espeon', 'umbreon'], 'eevee vanilla');
  expectEvos(rec, 'vanilla', 'jolteon', ['Use Thunderstone'], 'eevee vanilla');
});

test('quilava: 2 EX branches (level + the Hisui artefact), 1 Vanilla', () => {
  const rec = byId.get('quilava');
  expectEvos(rec, 'ex', 'typhlosion', ['Level up at 36', 'Use Hisui Artefact'], 'quilava ex');
  expectPrev(rec, 'ex', 'cyndaquil', 'Level up at 14', 'quilava ex');
  expectEvos(rec, 'vanilla', 'typhlosion', ['Level up at 36'], 'quilava vanilla');
});

test('milcery: 7 EX branches (level 30 default + the 6 nature forms; the 2 overflow slots filtered by the rewrite)', () => {
  const rec = byId.get('milcery');
  expectBranchIds(evoOf(rec, 'ex'), Array(7).fill('alcremie'), 'milcery ex');
  expectEvos(
    rec,
    'ex',
    'alcremie',
    ['Level up at 30', 'Reach 30 as Adamant', 'Reach 30 as Lax', 'Reach 30 as Modest', 'Reach 30 as Gentle', 'Reach 30 as Timid', 'Reach 30 as Jolly'],
    'milcery ex',
  );
});

test('kubfu: both scrolls survive (Moon + Water stone); the 2 NONE rewrites drop', () => {
  const rec = byId.get('kubfu');
  expectEvos(rec, 'ex', 'urshifu', ['Use Moon Stone', 'Use Water Stone'], 'kubfu ex');
});

test('meltan: the synthetic GetBaseEvolution table → 1 branch (Metal Coat)', () => {
  const rec = byId.get('meltan');
  expectEvos(rec, 'ex', 'melmetal', ['Use Metal Coat'], 'meltan ex');
});

test('bisharp: Kingambit via the Leader’s Crest; prev pawniard at 52', () => {
  const rec = byId.get('bisharp');
  expectEvos(rec, 'ex', 'kingambit', ["Use Leader'sCrest"], 'bisharp ex');
  expectPrev(rec, 'ex', 'pawniard', 'Level up at 52', 'bisharp ex');
});

test('pikachu: the Alola artefact branch in EX only; the vanilla Thunderstone stays one word', () => {
  const rec = byId.get('pikachu');
  expectEvos(rec, 'ex', 'raichu', ['Use Thunder Stone', 'Use Alola Artefact'], 'pikachu ex');
  expectPrev(rec, 'ex', 'pichu', 'Level up at 30', 'pikachu ex');
  expectEvos(rec, 'vanilla', 'raichu', ['Use Thunderstone'], 'pikachu vanilla');
});

test('golbat (vanilla): the friendship rewrite → level 30 Crobat; azurill → level 10 Marill (shared override)', () => {
  const golbat = byId.get('golbat');
  expectEvos(golbat, 'vanilla', 'crobat', ['Level up at 30'], 'golbat vanilla');
  expectPrev(golbat, 'vanilla', 'zubat', 'Level up at 22', 'golbat vanilla');
  const azurill = byId.get('azurill');
  expectEvos(azurill, 'vanilla', 'marill', ['Level up at 10'], 'azurill vanilla');
  expectEvos(azurill, 'ex', 'marill', ['Level up at 10'], 'azurill ex');
});

test('rockruff & cosmoem keep their time-of-day evos in EX (the rewrite’s exception); Rockruff (Own Tempo) keeps dusk', () => {
  const rockruff = byId.get('rockruff');
  expectEvos(rockruff, 'ex', 'lycanroc', ['Level up at 25 (daytime)', 'Level up at 25 (night)'], 'rockruff ex');
  expectFormEvos(rockruff, 'Rockruff (Own Tempo)', 'lycanroc', ['Level up at 25 (dusk)'], 'rockruff own tempo ex');
  const cosmoem = byId.get('cosmoem');
  expectEvos(cosmoem, 'ex', 'solgaleo', ['Level up at 53 (daytime)'], 'cosmoem ex');
  expectEvos(cosmoem, 'ex', 'lunala', ['Level up at 53 (night)'], 'cosmoem ex');
});

test('basculin: the record (red base) has no evo; the White Striped form carries the 2 gender branches', () => {
  const rec = byId.get('basculin');
  assert.equal(evoOf(rec, 'ex'), null, 'basculin record: no evo');
  expectFormEvos(rec, 'Basculin (White Striped)', 'basculegion', ['Level up at 36 (male)', 'Level up at 36 (female)'], 'basculin white ex');
});

test('sliggoo: rain survives as plain level 50, fog drops; Hisuian Sliggoo’s prev is the goomy artefact branch', () => {
  const rec = byId.get('sliggoo');
  expectEvos(rec, 'ex', 'goodra', ['Level up at 50'], 'sliggoo ex');
  expectPrev(rec, 'ex', 'goomy', 'Level up at 40', 'sliggoo ex');
  expectFormEvos(rec, 'Hisuian Sliggoo (Hisuian)', 'goodra', ['Level up at 50'], 'hisuian sliggoo ex');
  const hisuian = formOf(rec, 'Hisuian Sliggoo (Hisuian)');
  assert.deepEqual(hisuian.evo.prev, { id: 'goomy', method: 'Use Hisui Artefact' }, 'hisuian sliggoo prev');
});

test('Galarian Yamask form: level 34 Runerigus; the base yamask record keeps its own 34 Cofagrigus', () => {
  const rec = byId.get('yamask');
  expectEvos(rec, 'ex', 'cofagrigus', ['Level up at 34'], 'yamask ex');
  expectFormEvos(rec, 'Galarian Yamask (Galarian)', 'runerigus', ['Level up at 34'], 'galarian yamask ex');
});

test('charizard (EX): prev-only evo — Charmeleon at 36 (the pinned version.test.mjs literal)', () => {
  const rec = byId.get('charizard');
  assert.deepEqual(evoOf(rec, 'ex'), { prev: { id: 'charmeleon', method: 'Level up at 36' } }, 'charizard ex evo shape');
});

test('ursaluna: prev is the Peat Block branch; the Bloodmoon form’s prev is the Moon Stone branch', () => {
  const rec = byId.get('ursaluna');
  expectPrev(rec, 'ex', 'ursaring', 'Use Peat Block', 'ursaluna ex');
  const bloodmoon = formOf(rec, 'Ursaluna (Bloodmoon)');
  assert.ok(bloodmoon && bloodmoon.evo, 'Ursaluna (Bloodmoon) carries its own evo');
  assert.deepEqual(bloodmoon.evo.prev, { id: 'ursaring', method: 'Use Moon Stone' }, 'bloodmoon prev');
});

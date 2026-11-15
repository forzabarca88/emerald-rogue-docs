/**
 * data/pokedex.json evolution shape + content guard (issue #97).
 *
 * The evo data is the in-game Pokédex's own display: the raw evolution
 * tables run through a line-faithful port of the game's
 * `Rogue_ModifyEvolution` rewrite (src/rogue_baked.c — byte-identical in
 * both branches, the #ifdef ROGUE_EXPANSION split resolved per branch).
 * The emitted shape per record / vanilla-overlay / form:
 *   { prev?: { id, method, form? }, evos?: [ { id, method, form? }, … ] }
 * - `evos` = the surviving post-rewrite branches (SPECIES_NONE targets and
 *   the 0xFFFE EVO_NONE sentinels dropped). The in-game list is SCROLLABLE
 *   (4 lines per screen) and shows every survivor — the extractor hard-fails
 *   if a species ever exceeds 8 survivors (today's max is Eevee's 8), so a
 *   future >8 species can never diverge silently;
 * - `prev` = the smallest-dex-number record (same build) whose own post-
 *   rewrite list targets this species (records by id, forms by their own
 *   species value — which resolves to the form's base record id); when the
 *   claiming source is itself a form (Galarian Yamask → Runerigus) the
 *   entry carries `form` — the source form's display name;
 * - `form` (both directions) names the branch target's / prev source's
 *   form — exactly the base record's own `forms` entry — whenever the
 *   in-game name shown for that species value differs from the record's
 *   name (Quilava's Hisuian Typhlosion, Espurr's Meowstic (Female)); a
 *   branch at the target record's own value never carries it;
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

test('every evo value (records, vanilla overlays, forms) carries only prev/evos of {id, method, form?}, ≤8 evos, existing targets', () => {
  const problems = [];
  const check = (evo, where) => {
    if (evo === null) return; // explicit "this build has no evo" (vanilla overlay)
    if (evo === undefined) return;
    if (typeof evo !== 'object' || Array.isArray(evo)) return problems.push(`${where}: not an object`);
    for (const key of Object.keys(evo)) {
      if (key !== 'prev' && key !== 'evos') problems.push(`${where}: unexpected key "${key}"`);
    }
    const checkEntry = (e, label) => {
      if (!e || typeof e !== 'object') return problems.push(`${where}: ${label} is not an object`);
      const keys = Object.keys(e).sort().join(',');
      if (!['id,method', 'form,id,method'].includes(keys)) problems.push(`${where}: ${label} keys [${keys}]`);
      if (!byId.has(e.id)) problems.push(`${where}: ${label} target "${e.id}" is not a record`);
      if (typeof e.method !== 'string' || !e.method) problems.push(`${where}: ${label} ${e.id} has no method text`);
      if (e.form !== undefined) {
        if (typeof e.form !== 'string' || !e.form) problems.push(`${where}: ${label} ${e.id} has an empty form name`);
        else {
          const names = (byId.get(e.id)?.forms ?? []).map((f) => f.name);
          if (!names.includes(e.form)) problems.push(`${where}: ${label} form "${e.form}" is not a forms entry of ${e.id}`);
        }
      }
    };
    if (evo.evos !== undefined) {
      if (!Array.isArray(evo.evos)) return problems.push(`${where}: evos is not an array`);
      if (evo.evos.length > 8) problems.push(`${where}: ${evo.evos.length} evos exceed the extractor's 8-survivor guard (the in-game list is scrollable — the extractor fails beyond 8 so the divergence can never be silent)`);
      if (evo.evos.length === 0) problems.push(`${where}: empty evos array (the key must be omitted)`);
      for (const e of evo.evos) {
        checkEntry(e, 'evo');
        // a target id MAY repeat with different methods (Kubfu's two
        // stones, Milcery's seven cream forms) — each branch is its own row
      }
    }
    if (evo.prev !== undefined) checkEntry(evo.prev, 'prev');
    if (evo.evos === undefined && evo.prev === undefined) problems.push(`${where}: empty evo object (should be absent)`);
  };
  for (const rec of dex.records) {
    check(rec.evo, `record ${rec.id}`);
    if (rec.vanilla && typeof rec.vanilla === 'object') check(rec.vanilla.evo, `record ${rec.id} vanilla`);
    for (const f of rec.forms ?? []) check(f.evo, `record ${rec.id} form ${f.name}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

/* --- 1b. the form-name invariant (both directions, per build) ------------- */

test('the Vanilla build never carries a form name (its evolution tables know no forms)', () => {
  const problems = [];
  const check = (evo, where, version) => {
    if (!evo || typeof evo !== 'object') return;
    for (const e of [...(evo.evos ?? []), ...(evo.prev ? [evo.prev] : [])]) {
      if (e.form !== undefined && version === 'vanilla')
        problems.push(`${where}: the Vanilla build carries a form name ("${e.form}")`);
    }
  };
  for (const rec of dex.records) {
    check(rec.evo, `record ${rec.id}`, 'ex');
    if (rec.vanilla && typeof rec.vanilla === 'object') check(rec.vanilla.evo, `record ${rec.id} vanilla`, 'vanilla');
    for (const f of rec.forms ?? []) check(f.evo, `record ${rec.id} form ${f.name}`, 'ex');
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the evolution-referenced forms join their base record’s forms array (the minimal roster gains)', () => {
  const expectForm = (recId, formName) => {
    const rec = byId.get(recId);
    assert.ok((rec.forms ?? []).some((f) => f.name === formName), `${recId} forms include "${formName}"`);
  };
  expectForm('meowth', 'Alolan Meowth (Alolan)');
  expectForm('meowth', 'Galarian Meowth (Galarian)');
  expectForm('raichu', 'Alolan Raichu (Alolan)');
  expectForm('meowstic', 'Meowstic (Female)');
  expectForm('toxtricity', 'Toxtricity (Low Key)');
  expectForm('urshifu', 'Urshifu (Rapid Strike Style)');
  expectForm('slowbro', 'Galarian Slowbro (Galarian)');
  expectForm('darmanitan', 'Galarian Darmanitan (Standard Mode)');
});

/* --- 2. prev consistency (the emitted invariant, per build) ---------------- */

test('every prev is a record whose own post-rewrite list targets this species (both builds)', () => {
  const problems = [];
  const check = (evo, selfId, selfBaseId, version) => {
    if (!evo || !evo.prev) return;
    const src = byId.get(evo.prev.id);
    if (!src) return;
    // a prev whose source is itself a form (prev.form) is claimed by the
    // form's own evo list, not the base record's (Galarian Yamask → Runerigus)
    const srcForm = evo.prev.form ? (src.forms ?? []).find((f) => f.name === evo.prev.form) ?? null : null;
    const srcEvo = srcForm?.evo ?? evoOf(src, version);
    // a form under record R is matched by its own value, which the source
    // list emits as R's record id; a record matches its own id
    const targetsSelf = (srcEvo?.evos ?? []).some((e) => e.id === selfBaseId);
    if (!targetsSelf) problems.push(`${version}: ${evo.prev.id}${evo.prev.form ? ` (${evo.prev.form})` : ''} claims to be the prev of ${selfId} but its list does not target it`);
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
    ['Level up at 30', 'Reach Lv.30 as Adamant', 'Reach Lv.30 as Lax', 'Reach Lv.30 as Modest', 'Reach Lv.30 as Gentle', 'Reach Lv.30 as Timid', 'Reach Lv.30 as Jolly'],
    'milcery ex',
  );
  // the in-game nature wording (gText_PokedexEvoLevel30Nature: "Reach {LV}30 as {STR_VAR_1}")
  assert.ok(!JSON.stringify(rec.evo).includes('Reach 30 as'), 'the mangled "Reach 30 as" wording is gone');
  // each nature branch names its cream form; the plain level-30 branch the record itself
  const branches = rec.evo.evos;
  assert.equal(branches[0].form, undefined, 'the level-30 branch targets the alcremie record itself');
  const creamForms = branches.slice(1).map((b) => b.form);
  assert.deepEqual(creamForms, ['Alcremie (Berry)', 'Alcremie (Love)', 'Alcremie (Star)', 'Alcremie (Clover)', 'Alcremie (Flower)', 'Alcremie (Ribbon)'], 'the 6 nature branches name the 6 cream forms');
});

test('kubfu: both scrolls survive (Moon + Water stone); the 2 NONE rewrites drop', () => {
  const rec = byId.get('kubfu');
  expectEvos(rec, 'ex', 'urshifu', ['Use Moon Stone', 'Use Water Stone'], 'kubfu ex');
});

test('meltan: the synthetic GetBaseEvolution table → 1 branch (Metal Coat)', () => {
  const rec = byId.get('meltan');
  expectEvos(rec, 'ex', 'melmetal', ['Use Metal Coat'], 'meltan ex');
});

test('bisharp: Kingambit via the Leader’s Crest (the corrected EX item name); prev pawniard at 52', () => {
  const rec = byId.get('bisharp');
  expectEvos(rec, 'ex', 'kingambit', ["Use Leader's Crest"], 'bisharp ex');
  expectPrev(rec, 'ex', 'pawniard', 'Level up at 52', 'bisharp ex');
});

test('form-targeted branches carry the target form’s display name (Quilava, Pikachu, Kubfu, Espurr)', () => {
  const quilava = byId.get('quilava');
  const hisui = (evoOf(quilava, 'ex').evos ?? []).find((e) => e.method === 'Use Hisui Artefact');
  assert.deepEqual(hisui, { id: 'typhlosion', method: 'Use Hisui Artefact', form: 'Hisuian Typhlosion (Hisuian)' }, 'quilava ex: the Hisui artefact branch names Hisuian Typhlosion');
  const plain = (evoOf(quilava, 'ex').evos ?? []).find((e) => e.method === 'Level up at 36');
  assert.equal(plain.form, undefined, 'quilava ex: the level-36 branch is the record itself (no form)');

  const pikachu = byId.get('pikachu');
  const alola = (evoOf(pikachu, 'ex').evos ?? []).find((e) => e.method === 'Use Alola Artefact');
  assert.deepEqual(alola, { id: 'raichu', method: 'Use Alola Artefact', form: 'Alolan Raichu (Alolan)' }, 'pikachu ex: the Alola artefact branch names Alolan Raichu');

  const kubfu = byId.get('kubfu');
  const rapid = (evoOf(kubfu, 'ex').evos ?? []).find((e) => e.method === 'Use Water Stone');
  assert.deepEqual(rapid, { id: 'urshifu', method: 'Use Water Stone', form: 'Urshifu (Rapid Strike Style)' }, 'kubfu ex: the Water stone branch names the Rapid Strike form');
  const single = (evoOf(kubfu, 'ex').evos ?? []).find((e) => e.method === 'Use Moon Stone');
  assert.equal(single.form, undefined, 'kubfu ex: the Moon stone branch is the urshifu record itself (no form)');

  const espurr = byId.get('espurr');
  assert.deepEqual(
    evoOf(espurr, 'ex').evos,
    [
      { id: 'meowstic', method: 'Level up at 25 (male)' },
      { id: 'meowstic', method: 'Level up at 25 (female)', form: 'Meowstic (Female)' },
    ],
    'espurr ex: both gender branches survive — only the female names its form (the male is the record value)',
  );
});

test('form-sourced prevs name their source form (Runerigus, Perrserker, Basculegion)', () => {
  const expectFormPrev = (recId, prev, ctx) => {
    const rec = byId.get(recId);
    assert.deepEqual(evoOf(rec, 'ex').prev, prev, `${ctx}: ${recId} ex prev`);
  };
  expectFormPrev('runerigus', { id: 'yamask', method: 'Level up at 34', form: 'Galarian Yamask (Galarian)' }, 'runerigus');
  expectFormPrev('perrserker', { id: 'meowth', method: 'Level up at 28', form: 'Galarian Meowth (Galarian)' }, 'perrserker');
  expectFormPrev('basculegion', { id: 'basculin', method: 'Level up at 36 (male)', form: 'Basculin (White Striped)' }, 'basculegion');
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

/* --- 3b. the know-move profile rewrite (ModifyKnowMoveEvo) ----------------
 *
 * The C compares the profile's level-up MOVE VALUE against the evo's param
 * (u16 == u16): when the species' level-up profile knows the move, the
 * branch is rewritten to a level evo at max(38, profile level); only a
 * profile that does NOT know the move takes the level-30 fallback — and
 * that fallback exists only for plain EVO_MOVE (the two/three-segment
 * methods are left raw by the C, which the display switch then renders as
 * the TODO placeholder; the site documents the intended level rewrite).
 * The profile levels are the per-species
 * src/data/rogue/pokemon/expansion/<id>/expansion_profile.json lists (the
 * level-up table the C's ModifyKnowMoveEvo reads).
 */

test('know-move profile HIT: 15 EX branches are the level evo at max(38, profile level)', () => {
  expectEvos(byId.get('primeape'), 'ex', 'annihilape', ['Level up at 38'], 'primeape ex (Rage Fist @35)');
  expectEvos(byId.get('lickitung'), 'ex', 'lickilicky', ['Level up at 38'], 'lickitung ex (Rollout @6)');
  expectEvos(byId.get('mime_jr'), 'ex', 'mr_mime', ['Level up at 38'], 'mime_jr ex (Mimic @32)');
  expectEvos(byId.get('bonsly'), 'ex', 'sudowoodo', ['Level up at 38'], 'bonsly ex (Mimic @16)');
  expectEvos(byId.get('aipom'), 'ex', 'ambipom', ['Level up at 38'], 'aipom ex (Double Hit @32)');
  expectEvos(byId.get('yanma'), 'ex', 'yanmega', ['Level up at 38'], 'yanma ex (Ancient Power @33)');
  expectEvos(byId.get('tangela'), 'ex', 'tangrowth', ['Level up at 38'], 'tangela ex (Ancient Power @24)');
  expectEvos(byId.get('piloswine'), 'ex', 'mamoswine', ['Level up at 38'], 'piloswine ex (Ancient Power @1)');
  expectEvos(byId.get('girafarig'), 'ex', 'farigiraf', ['Level up at 38'], 'girafarig ex (Twin Beam @32)');
  expectFormEvos(byId.get('qwilfish'), 'Hisuian Qwilfish (Hisuian)', 'overqwil', ['Level up at 38'], 'qwilfish hisuian ex (Barb Barrage @28)');
  expectEvos(byId.get('clobbopus'), 'ex', 'grapploct', ['Level up at 38'], 'clobbopus ex (Taunt @35)');
  expectEvos(byId.get('steenee'), 'ex', 'tsareena', ['Level up at 38'], 'steenee ex (Stomp @28)');
  expectEvos(byId.get('poipole'), 'ex', 'naganadel', ['Level up at 38'], 'poipole ex (Dragon Pulse @1)');
  // dunsparce: the profile knows Hyper Drill @32 for BOTH segments, so both
  // branches are the level-38 rewrite (the C rewrites EVO_MOVE_TWO_SEGMENT /
  // EVO_MOVE_THREE_SEGMENT to EVO_LEVEL_TWO_SEGMENT / EVO_LEVEL_THREE_SEGMENT,
  // which the display switch renders with the plain level string "Reach LV38")
  // — the two/three-segment TODO placeholder only applies to a profile that
  // LACKS the move
  const duns = evoOf(byId.get('dunsparce'), 'ex');
  assert.deepEqual(
    duns.evos,
    [
      { id: 'dudunsparce', method: 'Level up at 38' },
      { id: 'dudunsparce', method: 'Level up at 38', form: 'Dudunsprce (Three Segment)' },
    ],
    'dunsparce ex: both segments are the level-38 rewrite (Hyper Drill @32)',
  );
});

test('know-move profile MISS: plain EVO_MOVE falls back to level 30 (the 2 branches whose profile lacks the move)', () => {
  expectEvos(byId.get('stantler'), 'ex', 'wyrdeer', ['Level up at 30'], 'stantler ex (Psyshield Bash — not in the profile)');
  expectEvos(byId.get('dipplin'), 'ex', 'hydrapple', ['Level up at 30'], 'dipplin ex (Dragon Cheer — not in the profile)');
});

test('the know-move targets’ prev rows carry the same rewritten method', () => {
  const expect38 = (recId, ctx) => expectPrev(byId.get(recId), 'ex', ctx, 'Level up at 38', `${recId} prev`);
  // each target's claiming source (the record id the prev points at)
  const sources = new Map([
    ['annihilape', 'primeape'],
    ['lickilicky', 'lickitung'],
    ['mr_mime', 'mime_jr'],
    ['sudowoodo', 'bonsly'],
    ['ambipom', 'aipom'],
    ['yanmega', 'yanma'],
    ['tangrowth', 'tangela'],
    ['mamoswine', 'piloswine'],
    ['farigiraf', 'girafarig'],
    ['grapploct', 'clobbopus'],
    ['tsareena', 'steenee'],
    ['naganadel', 'poipole'],
    ['dudunsparce', 'dunsparce'],
  ]);
  for (const [target, source] of sources) expect38(target, source);
  // the form-sourced prev (the branch sits on the Hisuian Qwilfish form)
  assert.deepEqual(
    evoOf(byId.get('overqwil'), 'ex').prev,
    { id: 'qwilfish', method: 'Level up at 38', form: 'Hisuian Qwilfish (Hisuian)' },
    'overqwil prev (the Hisuian Qwilfish form)',
  );
});

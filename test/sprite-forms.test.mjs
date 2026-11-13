/**
 * The shared form-sprite resolver (scripts/extract/sprite-forms.mjs)
 * against the EX ground truth (node --test; the game repo is read-only).
 *
 * Self-skips (the citations.test.mjs pattern) when
 * references/pokeemerald-rogue is absent (CI has no game repo), and —
 * like citations' --changed test — when the repo has moved off the
 * recorded baseline (scripts/verify/baseline.json), since every pinned
 * number below holds only at the baseline revision. Expansion is read
 * via `git show`/`git ls-tree`/`git cat-file` on origin/expansion ONLY —
 * no branch is ever checked out.
 *
 * Assertions (end results of the shared resolver, not its internals):
 *   - the ORACLE: the EX species tables parse to exactly 1505 entries
 *     (the 1507 initializers minus the NONE/EGG slots); 1504 of them
 *     resolve their (front, palette) pair mechanically (965 base
 *     directories + 467 own art + 72 base-identical) and silvally_fairy
 *     is the ONLY unresolved one — the pinned ternary-macro form that
 *     falls back to the base art (classify → own: false);
 *   - spot checks: charizard_mega_x → its own
 *     graphics/pokemon/charizard/mega_x/front.png; arceus_bug → the
 *     BASE Arceus bitmap + an arceus/bug/-dir palette (the palette-swap
 *     shape); unown_b → graphics/pokemon/unown/b/anim_front.png; every
 *     data-referenced Minior core-color form's per-color palette and
 *     every Alcremie per-cream palette exists in the EX tree;
 *   - the cross-extractor drift guard (repo-dependent side): the
 *     committed data/pokedex.json form.sprite set == the on-disk
 *     form-PNG set (base pipeline files classified out via the vanilla
 *     working tree's top-level dirs — egg.png & co. excluded properly)
 *     == the EX ground truth's roster-referenced own forms
 *     (formSpriteManifest ∩ formRosterDomain — the rule both extractors
 *     gate on).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formRosterDomain, formSpriteFile, formSpriteManifest } from '../scripts/extract/sprite-forms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.join(root, 'references', 'pokeemerald-rogue');
const assetDir = path.join(root, 'site', 'assets', 'pokemon');

function git(...gitArgs) {
  const r = spawnSync('git', ['-C', repoDir, ...gitArgs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/**
 * The skip guard (citations.test.mjs pattern): absent repo → skip
 * "not vendored"; present but off-baseline → skip "moved off baseline"
 * (node 24: t.skip() does not stop execution — the test must return).
 */
function guard(t) {
  if (!existsSync(repoDir)) {
    t.skip('references/pokeemerald-rogue not vendored (CI has no game repo)');
    return true;
  }
  const baseline = JSON.parse(readFileSync(path.join(root, 'scripts', 'verify', 'baseline.json'), 'utf8'));
  const head = git('rev-parse', 'HEAD');
  const expansion = git('rev-parse', 'origin/expansion');
  if (head !== baseline.vanilla.sha || expansion !== baseline.expansion.sha) {
    t.skip('game repo has moved off the recorded baseline');
    return true;
  }
  return false;
}

/* --- the shared context (lazy: git runs happen only when a test proceeds) --- */

let ctx = null;

/** The parsed expansion-profile Species lists (one batched cat-file — the
 * same loader the sprites extractor uses; needed by formRosterDomain). */
function expansionProfiles() {
  const tree = git('ls-tree', '-r', 'origin/expansion', '--', 'src/data/rogue/pokemon/expansion');
  const files = [];
  const shas = [];
  for (const line of tree.split('\n')) {
    if (!line || !line.endsWith('expansion_profile.json')) continue;
    const tab = line.indexOf('\t');
    files.push(line.slice(tab + 1));
    shas.push(line.slice(0, tab).split(' ')[2]);
  }
  if (shas.length === 0) return new Map();
  const r = spawnSync('git', ['-C', repoDir, 'cat-file', '--batch'], { input: shas.join('\n') + '\n', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git cat-file --batch (profiles) failed: ' + r.stderr.trim());
  const batch = r.stdout;
  const out = new Map();
  let off = 0;
  for (const file of files) {
    const nl = batch.indexOf(0x0a, off);
    if (nl < 0) throw new Error('malformed git cat-file --batch response (profiles)');
    const [, , size] = batch.toString('utf8', off, nl).split(' ');
    off = nl + 1;
    const body = batch.toString('utf8', off, off + Number(size));
    off += Number(size) + 1; // include the trailing 0x00
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const sp = (data.Species ?? []).map((s) => s.slice('SPECIES_'.length).toLowerCase());
    if (sp.length > 0) {
      const id = file.replace(/^src\/data\/rogue\/pokemon\/expansion\//, '').replace(/\/expansion_profile\.json$/, '');
      out.set(id, sp);
    }
  }
  return out;
}

function load() {
  if (ctx) return ctx;
  const listing = git('ls-tree', '-r', '--name-only', 'origin/expansion', '--', 'graphics/pokemon');
  const lines = listing.split('\n').filter(Boolean);
  const treeFiles = new Set(lines.map((l) => l.slice('graphics/pokemon/'.length)));
  const expIds = new Set(lines.map((l) => l.split('/')[2]));
  const vanillaBaseDirs = new Set(
    readdirSync(path.join(repoDir, 'graphics', 'pokemon')).filter((d) => statSync(path.join(repoDir, 'graphics', 'pokemon', d)).isDirectory())
  );
  const speciesTableTexts = [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => git(`show`, `origin/expansion:src/data/pokemon/species_info/gen_${g}.h`)),
    git('show', 'origin/expansion:src/data/pokemon/species_info.h'),
  ];
  const manifest = formSpriteManifest({
    pokemonH: git('show', 'origin/expansion:src/data/graphics/pokemon.h'),
    speciesTableTexts,
    baseDirs: new Set([...vanillaBaseDirs, ...expIds].map((d) => d.toLowerCase())),
    exTreeFiles: treeFiles,
    label: 'test',
  });
  const rosters = formRosterDomain({
    pokedexH: git('show', 'origin/expansion:include/constants/pokedex.h'),
    speciesTableTexts,
    formTableTexts: [
      git('show', 'origin/expansion:src/data/pokemon/form_species_tables.h'),
      git('show', 'origin/expansion:src/data/pokemon/form_change_tables.h'),
    ],
    profiles: expansionProfiles(),
    label: 'test',
  });
  ctx = { manifest, rosters, treeFiles, vanillaBaseDirs };
  return ctx;
}

test('the manifest reproduces the oracle (1504/1505, silvally_fairy the only unresolved)', (t) => {
  if (guard(t)) return;
  // ACT — build the manifest from the EX ground truth
  const { manifest } = load();

  // ASSERT — the 1505 entries (1507 initializers minus the NONE/EGG
  // slots) and the exact mechanical-resolution split: 1504 of 1505
  const c = manifest.counts;
  assert.equal(manifest.entries.size, 1505, 'EX species entries (expected 1505)');
  assert.equal(c.base + c.own + c.baseIdentical, 1504, 'mechanically resolved entries (expected 1504)');
  assert.equal(c.base, 965, 'base-directory entries');
  assert.equal(c.own, 467, 'own-art form entries');
  assert.equal(c.baseIdentical, 72, 'base-identical form entries');

  // ASSERT — the single unresolved one: the pinned ternary-macro form
  assert.equal(c.ternary, 1, 'ternary-macro entries (expected exactly 1)');
  const ternary = [...manifest.forms.entries()].filter(([, f]) => f.cls === 'ternary-macro').map(([id]) => id);
  assert.deepEqual(ternary, ['silvally_fairy'], 'the one mechanically-unresolvable form');
  const fairy = manifest.classify('silvally_fairy');
  assert.equal(fairy.own, false, 'silvally_fairy must NOT own a dedicated file (base fallback)');
  assert.equal(fairy.reason, 'ternary-macro');
});

test('spot checks: the worked examples resolve to their EX source files', (t) => {
  if (guard(t)) return;
  const { manifest, treeFiles } = load();

  // charizard_mega_x → its own dedicated front file
  const megaX = manifest.classify('charizard_mega_x');
  assert.equal(megaX.own, true);
  assert.equal(megaX.frontPath, 'graphics/pokemon/charizard/mega_x/front.png');

  // arceus_bug → the BASE Arceus bitmap (the palette-swap shape) + an
  // arceus/bug/-dir palette
  const bug = manifest.forms.get('arceus_bug');
  assert.ok(bug, 'arceus_bug is not a form entry');
  assert.equal(bug.frontPath, 'graphics/pokemon/' + bug.basePair[0], 'the plate uses the base Arceus bitmap');
  assert.equal(bug.frontPath, 'graphics/pokemon/arceus/anim_front.png');
  assert.match(bug.palPath, /^graphics\/pokemon\/arceus\/bug\/[a-z0-9_.]+\.pal$/, 'the plate palette lives in the arceus/bug/ dir');
  assert.ok(treeFiles.has(bug.palPath.slice('graphics/pokemon/'.length)), `EX tree missing ${bug.palPath}`);

  // unown_b → the letter's anim_front
  const unownB = manifest.classify('unown_b');
  assert.equal(unownB.own, true);
  assert.equal(unownB.frontPath, 'graphics/pokemon/unown/b/anim_front.png');

  // every data-referenced Minior core-color form: the per-color palette
  // files exist in the EX tree (the manifest gates this, re-asserted here
  // against the plan-named family)
  const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
  const minior = (dex.records.find((r) => r.id === 'minior') || {}).forms || [];
  const coreSprites = minior.filter((f) => typeof f.sprite === 'string' && /^minior_core_/.test(f.sprite));
  assert.ok(coreSprites.length > 0, 'the data carries no Minior core-color form sprites');
  for (const f of coreSprites) {
    const own = manifest.classify(f.sprite);
    assert.equal(own.own, true, `${f.sprite} must be an own form`);
    assert.match(own.palPath, /^graphics\/pokemon\/minior\/core\/[a-z]+\/normal\.pal$/, `per-color palette for ${f.sprite}`);
    assert.ok(treeFiles.has(own.palPath.slice('graphics/pokemon/'.length)), `EX tree missing ${own.palPath}`);
    assert.ok(treeFiles.has(own.frontPath.slice('graphics/pokemon/'.length)), `EX tree missing ${own.frontPath}`);
  }

  // every data-referenced Alcremie per-cream form: the per-cream palette
  // files exist in the EX tree
  const alcremie = (dex.records.find((r) => r.id === 'alcremie') || {}).forms || [];
  const creamSprites = alcremie.filter((f) => typeof f.sprite === 'string' && /^alcremie_(berry|love|star|clover|flower|ribbon)_/.test(f.sprite));
  assert.ok(creamSprites.length > 0, 'the data carries no Alcremie per-cream form sprites');
  for (const f of creamSprites) {
    const own = manifest.classify(f.sprite);
    assert.equal(own.own, true, `${f.sprite} must be an own form`);
    assert.match(own.palPath, /^graphics\/pokemon\/alcremie\/(berry|love|star|clover|flower|ribbon)\/[a-z_]+\.pal$/, `per-cream palette for ${f.sprite}`);
    assert.ok(treeFiles.has(own.palPath.slice('graphics/pokemon/'.length)), `EX tree missing ${own.palPath}`);
  }
});

test('committed data form.sprite set == on-disk form-PNG set == roster-referenced own forms', (t) => {
  if (guard(t)) return;
  const { manifest, rosters, vanillaBaseDirs } = load();

  // ARRANGE — the committed data's form.sprite set
  const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
  const records = Array.isArray(dex.records) ? dex.records : [];
  const recordIds = new Set(records.map((r) => r.id));
  const dataSpriteIds = new Set();
  for (const r of records) {
    for (const f of Array.isArray(r.forms) ? r.forms : []) {
      if (f.sprite !== undefined) dataSpriteIds.add(f.sprite);
    }
  }

  // ACT — the on-disk form-PNG set: stems that are neither record ids,
  // nor <recordId>-ex, nor a vanilla BASE-pipeline species dir (egg.png
  // & co. classify out properly — no exception list)
  const diskStems = readdirSync(assetDir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -'.png'.length))
    .filter((stem) => !recordIds.has(stem) && !(stem.endsWith('-ex') && recordIds.has(stem.slice(0, -3))) && !vanillaBaseDirs.has(stem));

  // the EX ground truth: own forms that some record's form roster references
  const ownReferenced = new Set(
    [...manifest.forms.keys()].filter((id) => manifest.forms.get(id).cls === 'own' && rosters.referenced.has(id))
  );

  // ASSERT — the three sets are one set (data ↔ assets ↔ game truth)
  assert.deepEqual([...dataSpriteIds].sort(), diskStems.sort(), 'data form.sprite set ≠ on-disk form-PNG set');
  assert.deepEqual([...dataSpriteIds].sort(), [...ownReferenced].sort(), 'data form.sprite set ≠ roster-referenced own forms');
  assert.equal(dataSpriteIds.size, [...ownReferenced].length, 'the committed set size drifts from the ground truth');
  for (const id of dataSpriteIds) {
    assert.ok(existsSync(path.join(assetDir, formSpriteFile(id))), `missing ${formSpriteFile(id)}`);
  }
});

/**
 * Pokedex form sprites (PR A / issue #85) — the repo-INDEPENDENT data ↔
 * asset consistency suite (node --test, zero deps, no mocks).
 *
 * Reads ONLY data/pokedex.json, the site/assets/pokemon/ directory listing
 * and the shared scripts/extract/sprite-forms.mjs module (the single
 * source of the flat <formEntryId>.png naming convention — imported, not
 * reimplemented). Every expectation is an end result:
 *   - every form's `sprite` field is a non-empty string naming a file on
 *     disk per formSpriteFile(), and that file is a 128×128 PNG (the IHDR
 *     bytes are parsed from the raw file — no decoder dependency);
 *   - every name-only form (a plain {name} object) carries NO `sprite` —
 *     the base-sprite fallback the page renders for the no-art forms;
 *   - the no-entry rogue custom megas (the plain {name} forms under
 *     heatran / darkrai / zygarde / golisopod / magearna / zeraora /
 *     baxcalibur) all fall back — no sprite field;
 *   - charizard's two megas reference the plan-named ids
 *     charizard_mega_x / charizard_mega_y (located by their data names),
 *     and the flat naming convention (formSpriteFile(id) === id + '.png')
 *     holds for every form sprite;
 *   - every record's vanilla overlay carries `forms: []` (Vanilla renders
 *     zero forms — pokedex.js's dexVariant() never falls through to the
 *     EX forms under the Vanilla build);
 *   - the drift guard, BOTH directions: the data's form.sprite set and the
 *     on-disk form-PNG set are exactly equal. "Form PNG" here = a file
 *     whose stem is neither a record id nor <recordId>-ex; the single
 *     known exception is egg.png — the vanilla graphics/pokemon/egg
 *     pseudo-species directory's BASE-pipeline output (shipped since
 *     issue #78, before form sprites existed), pinned by exact equality
 *     so any NEW stray file fails this test loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formSpriteFile } from '../scripts/extract/sprite-forms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json has no records');
const byId = Object.fromEntries(records.map((r) => [r.id, r]));
const recordIds = new Set(records.map((r) => r.id));

const assetDir = path.join(root, 'site', 'assets', 'pokemon');
const pngFiles = readdirSync(assetDir).filter((f) => f.endsWith('.png'));

/** The on-disk "form PNG" set: stems that are neither record ids nor <id>-ex. */
const diskFormStems = pngFiles
  .map((f) => f.slice(0, -'.png'.length))
  .filter((stem) => !recordIds.has(stem) && !(stem.endsWith('-ex') && recordIds.has(stem.slice(0, -3))));

/** The data's form.sprite set (every form object, every record). */
const dataSpriteIds = new Set();
for (const r of records) {
  for (const f of Array.isArray(r.forms) ? r.forms : []) {
    if (f.sprite !== undefined) dataSpriteIds.add(f.sprite);
  }
}

/** PNG width/height from the IHDR chunk (bytes 16–23) — the extractor
 * writes IHDR first, always 128×128 RGBA. */
function pngIhdrSize(file) {
  const buf = readFileSync(file);
  assert.ok(buf.length > 24, `${file}: too short for a PNG header`);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file}: bad PNG signature`);
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR', `${file}: first chunk is not IHDR`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('every form.sprite names an on-disk 128×128 PNG per formSpriteFile()', () => {
  // ARRANGE — the data's form.sprite set (derived, never hardcoded)
  assert.ok(dataSpriteIds.size > 0, 'data/pokedex.json carries no form.sprite at all');

  // ACT/ASSERT — the naming convention + the file's existence + its IHDR
  for (const id of dataSpriteIds) {
    assert.equal(typeof id, 'string', 'a form.sprite is not a string');
    assert.ok(id, 'an empty form.sprite string');
    assert.equal(formSpriteFile(id), id + '.png', `formSpriteFile broke the flat convention for ${id}`);
    const file = path.join(assetDir, formSpriteFile(id));
    assert.ok(existsSync(file), `missing on disk: ${formSpriteFile(id)} (a form.sprite with no file)`);
    const [w, h] = pngIhdrSize(file);
    assert.equal(w, 128, `${formSpriteFile(id)}: width ${w} (expected 128)`);
    assert.equal(h, 128, `${formSpriteFile(id)}: height ${h} (expected 128)`);
  }
});

test('every name-only form (a plain {name} object) carries no sprite', () => {
  // ARRANGE — walk every form object of every record
  let plain = 0;
  for (const r of records) {
    for (const f of Array.isArray(r.forms) ? r.forms : []) {
      const isPlain = Object.keys(f).length === 1 && typeof f.name === 'string';
      if (isPlain) {
        plain++;
        assert.equal(f.sprite, undefined, `${r.id}: the plain form "${f.name}" must not carry a sprite`);
      } else if (f.sprite !== undefined) {
        assert.equal(typeof f.sprite, 'string', `${r.id}: ${f.name}'s sprite is not a string`);
        assert.ok(f.sprite, `${r.id}: ${f.name}'s sprite is an empty string`);
      }
    }
  }
  // ASSERT — the no-art set is non-trivial (the plain rows + the
  // base-identical data-carrying forms both exist in the data)
  assert.ok(plain > 0, 'no plain {name}-only forms found in the data');
});

test('the no-entry rogue custom megas fall back to the base sprite (no sprite field)', () => {
  // ARRANGE — the plan-named no-entry records (their Mega forms are plain
  // {name} objects: no species entry, no art). Note mareep is NOT here —
  // its "Mega Mareep" IS entry-backed (the EX SPECIES_PIKIN_MEGA
  // initializer, verified in src/data/pokemon/species_info/gen_2.h) and
  // carries sprite pikin_mega + full per-form data.
  const noEntry = ['heatran', 'darkrai', 'zygarde', 'golisopod', 'magearna', 'zeraora', 'baxcalibur'];

  for (const id of noEntry) {
    assert.ok(byId[id], `data/pokedex.json: no record "${id}"`);
    const plain = (byId[id].forms || []).filter((f) => Object.keys(f).length === 1 && typeof f.name === 'string');
    assert.ok(plain.length > 0, `${id}: expected at least one plain {name}-only form (the no-entry custom form)`);
    for (const f of plain) assert.equal(f.sprite, undefined, `${id}: ${f.name} must not carry a sprite`);
  }
});

test('charizard\'s megas reference charizard_mega_x / charizard_mega_y', () => {
  // ARRANGE — locate the forms by their data names (never by index)
  assert.ok(byId.charizard, 'data/pokedex.json: no charizard record');
  const megaX = (byId.charizard.forms || []).find((f) => f.name === 'Mega Charizard X');
  const megaY = (byId.charizard.forms || []).find((f) => f.name === 'Mega Charizard Y');
  assert.ok(megaX, 'charizard has no "Mega Charizard X" form');
  assert.ok(megaY, 'charizard has no "Mega Charizard Y" form');

  // ACT/ASSERT — the plan-named ids (the flat naming convention + the
  // on-disk existence of both files is asserted for EVERY form.sprite in
  // the first test, including these two)
  assert.equal(megaX.sprite, 'charizard_mega_x');
  assert.equal(megaY.sprite, 'charizard_mega_y');
});

test("every record's vanilla overlay carries forms: [] (Vanilla renders zero forms)", () => {
  // ARRANGE — the 386 shared records carry the custom vanilla overlay;
  // the 639 EX-only records carry none at all (their selection clears
  // under Vanilla before any form could render)
  let overlays = 0;
  for (const r of records) {
    if (r.vanilla && typeof r.vanilla === 'object') {
      overlays++;
      assert.ok(
        Array.isArray(r.vanilla.forms) && r.vanilla.forms.length === 0,
        `${r.id}: the vanilla overlay's forms must be [] (got ${JSON.stringify(r.vanilla.forms)})`
      );
    }
  }
  assert.ok(overlays > 0, 'no vanilla overlays found in the data');
});

test('on-disk form-PNG set == data form.sprite set (the drift guard, both directions)', () => {
  // ARRANGE — both sets derived at load (the assertion below is the
  // cross-check; a form PNG shipped without data, or data without a
  // shipped file, fails loudly in the matching direction)
  const diskIds = new Set(diskFormStems);

  // data → disk: every form.sprite has its file
  const missingOnDisk = [...dataSpriteIds].filter((id) => !diskIds.has(id)).sort();
  assert.deepEqual(missingOnDisk, [], `form.sprite ids with no on-disk ${'`<formEntryId>.png`'}: ${missingOnDisk.join(', ')}`);

  // disk → data: every form-like file is data-referenced. The one known
  // exception is egg.png (the base-pipeline output for the vanilla
  // graphics/pokemon/egg pseudo-species dir, shipped since issue #78) —
  // pinned by EXACT equality so any new stray file fails this test.
  const strayOnDisk = diskFormStems.filter((stem) => !dataSpriteIds.has(stem)).sort();
  assert.deepEqual(strayOnDisk, ['egg'], `unexpected non-form files in site/assets/pokemon/: ${strayOnDisk.join(', ')}`);
});

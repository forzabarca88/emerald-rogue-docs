/**
 * Colour-coded Pokémon type chips (issue #173) — Playwright (resolved by
 * the harness; node --test, zero deps).
 *
 * The DOM contract (ROGUE.typeChip in site/js/render.js + the
 * .chip--<type> family in site/css/components.css, tokens.css --type-*
 * hues, DESIGN.md §2/§6):
 *   - ROGUE.typeChip(type) emits `<span class="chip chip--<type>">` for
 *     the 18 EX-standard types (case-insensitive, trimmed) and the plain
 *     neutral `<span class="chip">` for Mystery/Stellar/unknown — the
 *     modifier is an ADDITIONAL class on the same element, so every
 *     existing `.chip` selector keeps matching;
 *   - the typing surfaces that switched to it: the pokedex detail head
 *     (`.dex-species__types`), the per-form chip rows (`.dex-form`),
 *     the move tables' Type cells (`.dex-moves`) and the routes
 *     wild-type chips (`.route-card__chips` — the terrain and
 *     drop-rarity chips stay neutral).
 *
 * Coverage:
 *   a. the derived Fire-type species' detail head carries .chip--fire
 *      (every head chip carries its own modifier + text);
 *   b. the derived two-type functional form (Mega Charizard X —
 *      Fire/Dragon) carries both .chip--fire and .chip--dragon in its
 *      .dex-form block;
 *   c. a move-table Type cell carries its derived type modifier;
 *   d. the derived route with a Fire wild type carries
 *      .route-card__chips .chip--fire while its terrain chip stays
 *      modifier-free (and so does its drop-rarity chip);
 *   e. a derived Mystery-type move (Vanilla's Curse) renders the
 *      neutral .chip with NO chip--* class;
 *   f. 360px routes — no horizontal overflow, the longest type word in
 *      the derived data rendered as a coloured chip (the chips are
 *      white-space: nowrap).
 *
 * Every expectation is derived from data/pokedex.json + data/routes.json
 * at load — never hardcoded from memory; the resulting literals are
 * pinned so a data drift fails with a loud message.
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
const routesData = JSON.parse(readFileSync(path.join(root, 'data', 'routes.json'), 'utf8'));
const routeRecords = Array.isArray(routesData.records) ? routesData.records : [];
if (records.length === 0) throw new Error('data/pokedex.json: no records');
if (routeRecords.length === 0) throw new Error('data/routes.json: no records');

/* The 18 EX-standard types (the typeChart order minus the move-only
 * non-defenders Mystery/Stellar) — the domain ROGUE.typeChip colours. */
const TYPES = new Set(['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy']);
const lc = (t) => String(t).trim().toLowerCase();
const isColourable = (t) => typeof t === 'string' && TYPES.has(lc(t));

/* (a) The derived Fire-type species: the first EX record carrying Fire
 * with a second type (the head is asserted chip-by-chip, so a single
 * type would under-test it). */
const FIRE_SPECIES = records.find((r) => Array.isArray(r.types) && r.types.includes('Fire') && r.types.length >= 2);
assert.ok(FIRE_SPECIES, 'data/pokedex.json: no Fire species with a second type for the head fixture');
assert.equal(FIRE_SPECIES.id, 'charizard', 'data/pokedex.json: the pinned Fire-species fixture drifted — re-derive it');
const FIRE_TYPES = [...new Set(FIRE_SPECIES.types)];
assert.ok(FIRE_TYPES.includes('Fire'), 'the head fixture must carry Fire');

/* (b) The derived two-type functional form: the first (record order)
 * functional form whose own types are exactly Fire+Dragon — the
 * scout\u2019s Mega Charizard X, living in the SAME detail as (a). */
let TWO_TYPE_FORM = null;
let TWO_TYPE_FORM_REC = null;
for (const rec of records) {
  for (const form of rec.forms ?? []) {
    if (form.functional !== true || !Array.isArray(form.types)) continue;
    if (form.types.length === 2 && form.types.includes('Fire') && form.types.includes('Dragon')) {
      TWO_TYPE_FORM = form;
      TWO_TYPE_FORM_REC = rec;
      break;
    }
  }
  if (TWO_TYPE_FORM) break;
}
assert.ok(TWO_TYPE_FORM, 'data/pokedex.json: no Fire/Dragon functional form for the form-block fixture');
assert.equal(TWO_TYPE_FORM_REC.id, 'charizard', 'data/pokedex.json: the Fire/Dragon form must be the head fixture\u2019s (one detail load covers a + b)');
assert.equal(TWO_TYPE_FORM.name, 'Mega Charizard X', 'data/pokedex.json: the pinned two-type form fixture drifted — re-derive it');

/* (c) The derived move: the head fixture's first Level-Up move whose
 * active-build catalog entry carries a colourable type. */
function exMoveEntry(name) {
  return dex.catalog && dex.catalog.moves && dex.catalog.moves[name] ? dex.catalog.moves[name] : null;
}
const LEVEL_UP = (FIRE_SPECIES.moves && FIRE_SPECIES.moves.levelUp) || [];
let MOVE_FIXTURE = null;
for (const p of LEVEL_UP) {
  const name = Array.isArray(p) ? p[0] : p;
  const entry = exMoveEntry(name);
  if (entry && isColourable(entry.type)) {
    MOVE_FIXTURE = { name, type: entry.type, level: Array.isArray(p) && typeof p[1] === 'number' ? p[1] : 0 };
    break;
  }
}
assert.ok(MOVE_FIXTURE, 'data/pokedex.json: the head fixture has no Level-Up move of a colourable type');
assert.equal(MOVE_FIXTURE.name, 'Air Slash', 'data/pokedex.json: the pinned move-table fixture drifted — re-derive it');
assert.equal(MOVE_FIXTURE.type, 'Flying', 'the pinned move-table fixture type drifted — re-derive it');

/* (e) The derived Mystery move: the first Vanilla record whose Level-Up
 * move resolves (the page's moveEntry rule — catalog.vanilla first, EX
 * fallback) to type Mystery, opened under ?version=vanilla. */
const vanillaRecords = records.filter((r) => Array.isArray(r.versions) && r.versions.includes('vanilla'));
function vanillaMoves(rec) {
  return rec.vanilla && rec.vanilla.moves !== undefined ? rec.vanilla.moves : rec.moves;
}
function vanillaMoveEntry(rec, name) {
  const v = dex.catalog.vanilla && dex.catalog.vanilla.moves ? dex.catalog.vanilla.moves[name] : null;
  if (v) return v;
  return exMoveEntry(name);
}
let MYSTERY = null;
for (const rec of vanillaRecords) {
  const m = vanillaMoves(rec) || {};
  for (const p of m.levelUp || []) {
    const name = Array.isArray(p) ? p[0] : p;
    const entry = vanillaMoveEntry(rec, name);
    if (entry && entry.type === 'Mystery') {
      MYSTERY = { name, rec };
      break;
    }
  }
  if (MYSTERY) break;
}
assert.ok(MYSTERY, 'data/pokedex.json: no Vanilla Level-Up Mystery move for the neutral-fallback fixture');
assert.equal(MYSTERY.name, 'Curse', 'data/pokedex.json: the pinned Mystery-move fixture drifted — re-derive it');
assert.equal(MYSTERY.rec.id, 'slowpoke', 'data/pokedex.json: the pinned Mystery-move species drifted — re-derive it');

/* (d) The derived route: the first record with a Fire wild type AND a
 * numeric drop rarity (so terrain + drop chips are both present to
 * assert neutral). */
const FIRE_ROUTE = routeRecords.find((r) => Array.isArray(r.type) && r.type.includes('Fire') && typeof r.dropRarity === 'number');
assert.ok(FIRE_ROUTE, 'data/routes.json: no Fire route with a drop rarity for the routes fixture');
assert.equal(FIRE_ROUTE.id, 'kanto-cave-0', 'data/routes.json: the pinned Fire-route fixture drifted — re-derive it');
assert.ok(FIRE_ROUTE.terrain, 'the route fixture needs a terrain (its chip is the neutral control)');
for (const t of FIRE_ROUTE.type) assert.ok(isColourable(t), `route fixture type ${t} must be colourable`);

/* (f) The longest type word present in the derived route wild types —
 * the nowrap stress at 360px. */
const ROUTE_TYPES = new Set();
routeRecords.forEach((r) => (Array.isArray(r.type) ? r.type : []).forEach((t) => ROUTE_TYPES.add(t)));
const LONGEST_TYPE = [...ROUTE_TYPES].sort((a, b) => b.length - a.length)[0];
assert.ok(LONGEST_TYPE && LONGEST_TYPE.length >= 7, 'the 360px fixture needs a long type word');
assert.equal(LONGEST_TYPE, 'Electric', 'data/routes.json: the pinned longest-type fixture drifted — re-derive it');

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

/* --- shared page-context helpers ---------------------------------------------
 * The page.evaluate callbacks are SERIALIZED into the page context (no
 * node-side free variables) — passed as source strings, per the house
 * pattern. */

/* The detail's typing surfaces: the head chip row, every .dex-form block's
 * chips, and the first (Level Up) move table's first rows (Move cell text
 * + the Type cell's chip). */
const DEX_TYPING_SRC = (
  () => {
    const detail = document.querySelector('#dex-species');
    if (!detail) return null;
    const head = [...detail.querySelectorAll('.dex-species__types .chip')].map((el) => ({
      text: el.textContent.trim(),
      cls: el.className,
    }));
    const forms = [...detail.querySelectorAll('.dex-form')].map((el) => ({
      name: el.querySelector('.dex-form__name') ? el.querySelector('.dex-form__name').textContent.trim() : '',
      chips: [...el.querySelectorAll('.chip-row .chip')].map((c) => ({ text: c.textContent.trim(), cls: c.className })),
    }));
    const table = detail.querySelector('.dex-moves__group .table');
    const rows = table
      ? [...table.querySelectorAll('tbody tr')].slice(0, 10).map((tr) => {
          const tds = [...tr.querySelectorAll('td')];
          const chip = tds[1] ? tds[1].querySelector('.chip') : null;
          return {
            move: tds[0] ? tds[0].textContent.trim() : '',
            type: chip ? { text: chip.textContent.trim(), cls: chip.className } : null,
          };
        })
      : [];
    return { head, forms, rows };
  }
).toString();
const dexTyping = (page) => page.evaluate((src) => new Function('return ' + src)()(), DEX_TYPING_SRC);

/* One route card's chip row (order = terrain, wild types, drop rarity). */
const ROUTE_CHIPS_SRC = (
  (id) => {
    const card = document.getElementById('rec-routes-' + id);
    return card ? [...card.querySelectorAll('.route-card__chips .chip')].map((el) => ({ text: el.textContent.trim(), cls: el.className })) : null;
  }
).toString();
const routeChips = (page, rid) =>
  page.evaluate(
    (o) => new Function('id', 'return (' + o.src + ')(id);')(o.id),
    { src: ROUTE_CHIPS_SRC, id: rid }
  );

/* A chip fact is a TYPE chip for `type` iff it is a .chip whose modifier
 * (when any) is exactly chip--<lc> and whose text is the type itself. */
const chipHasModifier = (cls, type) => cls.split(/\s+/).includes('chip--' + lc(type));

test('the derived Fire species\u2019 detail head carries .chip--fire (every head chip colour-coded)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + FIRE_SPECIES.id });
  try {
    await page.waitForFunction(
      (sel) => Boolean(document.querySelector(sel)),
      '#dex-species .dex-species__types .chip',
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await dexTyping(page);
    assert.ok(facts, 'the deep-linked detail rendered');
    assert.equal(facts.head.length, FIRE_TYPES.length, 'the head renders one chip per distinct type');
    for (const type of FIRE_TYPES) {
      const chip = facts.head.find((c) => c.text === type);
      assert.ok(chip, `the head carries a chip reading "${type}"`);
      assert.ok(chipHasModifier(chip.cls, type), `the head's "${type}" chip carries .chip--${lc(type)} (issue #173 — colour at a glance)`);
    }
    assert.ok(facts.head.some((c) => chipHasModifier(c.cls, 'fire')), 'the head carries .chip--fire');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('the derived Fire/Dragon functional form block carries .chip--fire and .chip--dragon', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + TWO_TYPE_FORM_REC.id });
  try {
    await page.waitForFunction(
      (name) => [...document.querySelectorAll('#dex-species .dex-form__name')].some((el) => el.textContent.trim() === name),
      TWO_TYPE_FORM.name,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await dexTyping(page);
    const block = facts.forms.find((f) => f.name === TWO_TYPE_FORM.name);
    assert.ok(block, `the detail renders the ${TWO_TYPE_FORM.name} .dex-form block`);
    assert.equal(block.chips.length, TWO_TYPE_FORM.types.length, 'the form block renders one chip per form type');
    for (const type of TWO_TYPE_FORM.types) {
      const chip = block.chips.find((c) => c.text === type);
      assert.ok(chip, `the form block carries a chip reading "${type}"`);
      assert.ok(chipHasModifier(chip.cls, type), `the form block's "${type}" chip carries .chip--${lc(type)}`);
    }
    assert.ok(block.chips.some((c) => chipHasModifier(c.cls, 'fire')), 'the form block carries .chip--fire');
    assert.ok(block.chips.some((c) => chipHasModifier(c.cls, 'dragon')), 'the form block carries .chip--dragon');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('a move-table Type cell carries its derived type modifier', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + FIRE_SPECIES.id });
  try {
    await page.waitForFunction(
      (sel) => Boolean(document.querySelector(sel)),
      '.dex-moves__group .table tbody tr',
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await dexTyping(page);
    const row = facts.rows.find((r) => r.move.startsWith(MOVE_FIXTURE.name));
    assert.ok(row, `the Level Up table carries the ${MOVE_FIXTURE.name} row`);
    assert.ok(row.type, 'the row\u2019s Type cell renders a .chip');
    assert.equal(row.type.text, MOVE_FIXTURE.type, 'the Type chip reads the catalog entry\u2019s type');
    assert.ok(chipHasModifier(row.type.cls, MOVE_FIXTURE.type), `the move-table Type cell carries .chip--${lc(MOVE_FIXTURE.type)}`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('the derived Fire route\u2019s wild chips are coloured; terrain + drop-rarity stay neutral', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html' });
  try {
    await page.waitForFunction(
      (id) => Boolean(document.getElementById('rec-routes-' + id)),
      FIRE_ROUTE.id,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const chips = await routeChips(page, FIRE_ROUTE.id);
    assert.ok(chips, 'the route card rendered its chip row');
    assert.equal(chips[0].text, FIRE_ROUTE.terrain, 'the first chip is the terrain');
    assert.ok(!/chip--/.test(chips[0].cls), 'the terrain chip carries no .chip--* modifier (it is not a type)');
    for (const type of FIRE_ROUTE.type) {
      const chip = chips.find((c) => c.text === type);
      assert.ok(chip, `the card carries a chip reading "${type}"`);
      assert.ok(chipHasModifier(chip.cls, type), `the wild-type chip "${type}" carries .chip--${lc(type)} (issue #173)`);
    }
    const fire = chips.find((c) => c.text === 'Fire');
    assert.ok(chipHasModifier(fire.cls, 'fire'), 'the card carries .route-card__chips .chip--fire');
    const drop = chips.find((c) => c.text === 'Drop +' + FIRE_ROUTE.dropRarity);
    assert.ok(drop, 'the card carries its drop-rarity chip');
    assert.ok(!/chip--/.test(drop.cls), 'the drop-rarity chip carries no .chip--* modifier');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('a derived Mystery-type move renders the neutral .chip with no chip--* class', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + MYSTERY.rec.id, version: 'vanilla' });
  try {
    await page.waitForFunction(
      (sel) => Boolean(document.querySelector(sel)),
      '.dex-moves__group .table tbody tr',
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await dexTyping(page);
    const row = facts.rows.find((r) => r.move.startsWith(MYSTERY.name));
    assert.ok(row, `the Vanilla ${MYSTERY.rec.name} Level Up table carries the ${MYSTERY.name} row`);
    assert.ok(row.type, 'the row\u2019s Type cell renders a .chip');
    assert.equal(row.type.text, 'Mystery', 'the Type chip reads the Vanilla catalog entry\u2019s type');
    assert.ok(!/chip--/.test(row.type.cls), 'Mystery is a move-only non-defender — the chip is the neutral .chip, no .chip--* class');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px routes: no horizontal overflow with the longest type word rendered as a coloured chip', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html', width: 360, height: 800 });
  try {
    await page.waitForFunction(
      (line) => (document.getElementById('routes-count')?.textContent || '').trim() === line,
      routeRecords.length + ' routes across all ' + new Set(routeRecords.map((r) => r.region)).size + ' regions',
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const facts = await page.evaluate(
      (longest) => {
        const chips = [...document.querySelectorAll('.route-card__chips .chip')];
        const longestChip = chips.find((c) => c.textContent.trim() === longest);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          longestText: longest,
          longestPresent: Boolean(longestChip),
          longestCls: longestChip ? longestChip.className : null,
        };
      },
      LONGEST_TYPE
    );
    assert.ok(facts.longestPresent, `the "${facts.longestText}" type word (the longest in data/routes.json) renders as a chip`);
    assert.ok(chipHasModifier(facts.longestCls, facts.longestText), 'the longest type word renders as a coloured .chip--<type> chip (white-space: nowrap is the 360px stress)');
    assert.ok(facts.scrollWidth <= 360, `no horizontal overflow at 360px (scrollWidth ${facts.scrollWidth}px <= 360px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

/**
 * The gameplay page's example-run chain (issue #119) is a hand-authored
 * Classic run — one labelled row per badge step (0–13). This guard
 * validates the drawn rows against the `placement` rules in
 * data/adventure.json (end result: the diagram the page shows is a
 * legal draw, never an impossible one): the per-room badge gating, the
 * one-per-path caps (incl. the sim/tower 50/50 alternative), the
 * per-run legendary/hideout/shrine slots, the minimum-route retention
 * behind the den counts, and the boss-ladder order (the end boss is
 * always the next one on the ladder).
 *
 * The rows are read straight out of site/js/pages/gameplay.js (a regex
 * slice of the `var` literals + a vm eval — the same no-mock setup
 * test/search.test.mjs uses) so this guards the source of truth, not a
 * copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pull one top-level `var NAME = <literal>` out of the page script. The
 * literals are flat (single-line entries, no nested containers beyond
 * the value objects), so a slice from the declaration to the matching
 * closing line is exact — a reformat of the declaration fails loudly
 * here instead of silently guarding stale text.
 */
function literalFrom(source, name) {
  const marker = `var ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker.trim()} not found in site/js/pages/gameplay.js`);
  const body = source.slice(start + marker.length);
  const close = body[0] === '{' ? '\n    };' : '\n    ];';
  const end = body.indexOf(close);
  assert.notEqual(end, -1, `could not find the closing ${close.trim()} of var ${name}`);
  return vm.runInNewContext('(' + body.slice(0, end + close.length - 1) + ')', {});
}

test('the example-run chain is a legal Classic draw (issue #119)', () => {
  const source = readFileSync(path.join(root, 'site', 'js', 'pages', 'gameplay.js'), 'utf8');
  const adventure = JSON.parse(readFileSync(path.join(root, 'data', 'adventure.json'), 'utf8'));
  const ROOM_STYLES = literalFrom(source, 'ROOM_STYLES');
  const EXAMPLE_RUN = literalFrom(source, 'EXAMPLE_RUN');

  /* The room vocabulary maps onto the placeable room-type records —
     every key in the draw must be a real room, and room-miniboss
     (placement.kind "never") must be absent from the vocabulary. */
  const ROOM_IDS = {
    route: 'room-route',
    rest: 'room-reststop',
    gap: 'room-none',
    den: 'room-wild-den',
    legend: 'room-legendary',
    hideout: 'room-team-hideout',
    honey: 'room-honey-tree',
    deal: 'room-dark-deal',
    lab: 'room-lab',
    show: 'room-gameshow',
    sign: 'room-sign',
    sim: 'room-battle-sim',
    tower: 'room-battle-tower',
    shrine: 'room-shrine'
  };
  const records = new Map(adventure.records.map((r) => [r.id, r]));
  assert.deepEqual(
    Object.keys(ROOM_STYLES).sort(),
    Object.keys(ROOM_IDS).sort(),
    'ROOM_STYLES must name exactly the placeable room types (room-miniboss is never placed)'
  );
  for (const [key, id] of Object.entries(ROOM_IDS)) {
    assert.ok(records.has(id), `data/adventure.json lost the ${id} record (ROOM_STYLES "${key}")`);
    assert.equal(records.get(id).category, 'room-type', `${id} is no longer a room-type record`);
  }

  /* One row per badge step: 14 rows, badge 0–13 in order, each a
     3-column segment with a 2-or-3-lane split. */
  assert.equal(EXAMPLE_RUN.length, 14, 'one row per badge step (badge 0–13)');
  EXAMPLE_RUN.forEach((seg, i) => {
    assert.equal(seg.badge, i, `row ${i} carries badge ${seg.badge} — rows are badge steps 0–13 in order`);
    assert.equal(seg.rooms.length, 3, `badge ${i}: the Classic segment has 3 room columns`);
    assert.ok(seg.lanes === 2 || seg.lanes === 3, `badge ${i}: the split forks into 2 or 3 lanes`);
    seg.rooms.forEach((key) => assert.ok(ROOM_IDS[key], `badge ${i}: unknown room key "${key}"`));
  });

  /* The boss ladder — derived from the boss records' badge ranges in
     the record names (Gym Leaders 0–7, Elite Four 8–11, Champion 12,
     Final Battle 13; the Victory Lap carries no badge): the end boss of
     row i is always the next one on the ladder. */
  const ladder = {};
  for (const b of adventure.records.filter((r) => r.category === 'boss')) {
    const m = b.name.match(/Badge[s]? (\d+)(?:–(\d+))?/);
    if (!m) continue;
    const prefix = b.name.split(' (')[0].split(' ')[0];
    const start = Number(m[1]);
    const end = m[2] !== undefined ? Number(m[2]) : start;
    for (let n = 0; n <= end - start; n++) {
      ladder[start + n] = end === start ? prefix : `${prefix} ${n + 1}`;
    }
  }
  assert.deepEqual(
    Object.keys(ladder)
      .map(Number)
      .sort((a, b) => a - b),
    [...Array(14).keys()],
    'the boss records span exactly badges 0–13'
  );
  EXAMPLE_RUN.forEach((seg, i) => {
    assert.equal(seg.boss, ladder[i], `badge ${i}: the end boss is ${ladder[i]} (the next ladder step)`);
  });

  /* Badge gating — each room's `placement` note in data/adventure.json. */
  const range = (a, b) => {
    const out = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  };
  const GATED = {
    legend: [1, 2, 3, 4, 5, 7, 8], // assigned slots: Roamer 1–5, Minor 3–5, Box 7–8
    deal: [4, 5, 7, 8, 10, 11, 13], // badge 3+ · skip badges divisible by 3
    lab: [3, 5, 6, 8, 9, 11, 12], // badge 3+ · skip if badge mod 3 = 1
    show: range(0, 5), // badges 0–5
    sign: range(0, 7), // below Elite Four only
    honey: range(1, 13), // badge 1+
    sim: range(1, 13), // badge 1+
    tower: range(1, 13), // badge 1+
    gap: range(1, 13) // never badge 0
  };
  for (const [key, badges] of Object.entries(GATED)) {
    EXAMPLE_RUN.forEach((seg, i) => {
      assert.ok(
        !seg.rooms.includes(key) || badges.includes(seg.badge),
        `badge ${i}: "${key}" is offered on badges ${badges.join('/')} only`
      );
    });
  }

  /* One-per-path caps per segment (the "one per path" placement notes),
     plus the 50/50 sim/tower alternative — never both in one segment. */
  const CAPPED = ['legend', 'hideout', 'honey', 'deal', 'lab', 'show', 'sign', 'sim', 'tower'];
  EXAMPLE_RUN.forEach((seg, i) => {
    for (const key of CAPPED) {
      assert.ok(
        seg.rooms.filter((r) => r === key).length <= 1,
        `badge ${i}: at most one "${key}" per path`
      );
    }
    assert.ok(
      !(seg.rooms.includes('sim') && seg.rooms.includes('tower')),
      `badge ${i}: the Battle Sim and the Tower are the 50/50 alternative pair`
    );
  });

  /* The per-run slots: up to three legendary slots, the two hideouts
     (Early on a badge 2–4, Pre-Legend mirroring the Box legendary),
     and the one pre-rolled shrine badge. */
  const badgesOf = (key) => EXAMPLE_RUN.filter((s) => s.rooms.includes(key)).map((s) => s.badge);
  const legendBadges = badgesOf('legend');
  assert.ok(legendBadges.length <= 3, 'a run carries up to three legendary slots');
  const hideoutBadges = badgesOf('hideout');
  assert.ok(hideoutBadges.length <= 2, 'Classic carries two hideouts per run');
  if (hideoutBadges.length === 2) {
    assert.ok(hideoutBadges.some((b) => b >= 2 && b <= 4), 'the Early hideout lands on a badge 2–4');
    assert.ok(
      hideoutBadges.some((b) => legendBadges.includes(b)),
      'the Pre-Legend hideout mirrors the Box legendary badge'
    );
  }
  const shrineBadges = badgesOf('shrine');
  assert.ok(shrineBadges.length <= 1, 'the shrine appears on one pre-rolled badge per run');
  assert.ok(shrineBadges.every((b) => b >= 1 && b <= 13), 'the shrine badge is rolled within the run');

  /* Minimum-route retention (the wild-den `placement` note — 2 regular
     routes kept on the Elite Four, 1 at the Champion and beyond): at
     most one den per segment until the Champion stage, at most two
     after — and every segment keeps at least one plain route (the
     default room the specials "replace"). */
  EXAMPLE_RUN.forEach((seg, i) => {
    const dens = seg.rooms.filter((r) => r === 'den').length;
    const maxDens = seg.badge >= 12 ? 2 : 1;
    assert.ok(dens <= maxDens, `badge ${i}: at most ${maxDens} den (minimum-route retention)`);
    assert.ok(seg.rooms.includes('route'), `badge ${i}: every segment keeps a plain route`);
  });
});

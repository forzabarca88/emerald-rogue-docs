/*
 * The gameplay page's example path board (issue #119) — one static
 * Classic segment for badge 1, heading for Gym 2 — must stay a legal
 * draw of the generator: every cell a room type the `placement` rules
 * in data/adventure.json allow at badge 1, the layout the generator's
 * shape (3 room columns × 1–3 lanes, the 2–3-lane split in front of
 * the gym, the minimum regular routes kept), and the lane wiring one
 * legal board (every cell reachable from the start line and reaching
 * the boss, at most 3 exits per cell, the boss fan-in = the split's
 * lane count).
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const pageSrc = readFileSync(new URL('../site/js/pages/gameplay.js', import.meta.url), 'utf8');
const boardMatch = pageSrc.match(/\bvar EXAMPLE_BOARD = (\{[\s\S]*?\n    \});/);
assert.ok(boardMatch, 'EXAMPLE_BOARD literal must exist in site/js/pages/gameplay.js');
const BOARD = vm.runInNewContext('(' + boardMatch[1] + ')');

const adventure = JSON.parse(readFileSync(new URL('../data/adventure.json', import.meta.url), 'utf8'));

/* board cell key → room-type record id in data/adventure.json */
const KEY_TO_ROOM = {
  route: 'room-route',
  rest: 'room-reststop',
  den: 'room-wild-den',
  gap: 'room-none',
  show: 'room-gameshow'
};

const roomById = new Map(adventure.records.filter((r) => r.category === 'room-type').map((r) => [r.id, r]));

/* one of the placement `bars` label → the badge range it covers
   (the generator's stages, per the boss-ladder records) */
function tierBadges(label) {
  if (label === 'badge 0') return [0, 0];
  const m = label.match(/^badges (\d+)[–-](\d+)$/);
  if (m) return [Number(m[1]), Number(m[2])];
  if (label === 'Elite Four') return [8, 11];
  if (label === 'Champion+') return [12, 13];
  return null;
}

const badge = BOARD.badge;

test('the example board is one Classic segment on the badge 1 ladder step', () => {
  assert.equal(badge, 1, 'the example board is badge 1 — right after the first badge');
  assert.equal(BOARD.boss, 'Gym 2', 'the boss is the next step on the ladder (Gym Leaders, Badges 0–7)');
  assert.ok([2, 3].includes(BOARD.splitLanes), 'the split fans out into 2–3 lanes');
  assert.equal(BOARD.rooms.length, 3, 'a Classic segment holds 3 room columns');
});

test('every board cell is a room type the placement rules allow at badge 1', () => {
  for (const key of BOARD.rooms.flat()) {
    assert.ok(key in KEY_TO_ROOM, `board key '${key}' must map to a room-type record`);
    const room = roomById.get(KEY_TO_ROOM[key]);
    assert.ok(room, `${KEY_TO_ROOM[key]} must be a room-type record in data/adventure.json`);
    const placement = room.placement;
    assert.notEqual(placement.kind, 'never', `${room.id} is never placed by the generator`);
    /* kind "tier": the badge must fall inside one of the bar tiers */
    if (placement.kind === 'tier') {
      const tiers = placement.bars.map((b) => tierBadges(b.l)).filter((r) => r !== null);
      assert.ok(tiers.length > 0, `${room.id} must carry parseable badge tiers`);
      assert.ok(
        tiers.some(([from, to]) => badge >= from && badge <= to),
        `${room.id} has no placement tier covering badge ${badge}`
      );
    }
    /* kind "roll" with a badge range in the note (e.g. the game show,
       "badges 0–5") */
    if (placement.kind === 'roll') {
      const m = (placement.note || '').match(/badges (\d+)[–-](\d+)/);
      if (m) {
        assert.ok(
          badge >= Number(m[1]) && badge <= Number(m[2]),
          `${room.id} only rolls on ${m[0]} — not badge ${badge}`
        );
      }
    }
    /* the gap (room-none): "never badge 0" */
    if (key === 'gap') assert.notEqual(badge, 0, 'a gap is never placed at badge 0');
  }
});

test('the board layout obeys the generator shape at badge 1', () => {
  for (const column of BOARD.rooms) {
    assert.ok(column.length >= 1 && column.length <= 3, 'each column holds 1–3 lanes');
    assert.ok(column.some((k) => k !== 'gap'), 'each column holds at least one room');
  }
  const cells = BOARD.rooms.flat();
  const routes = cells.filter((k) => k === 'route').length;
  /* "Minimum regular routes are always kept: 3 on badges 0–7" (the
     wild-den placement rule in data/adventure.json) */
  assert.ok(routes >= 3, `badges 0–7 keep at least 3 regular routes (found ${routes})`);
});

test('the lane wiring is one legal board: start line to boss, every cell in the flow', () => {
  const columns = BOARD.rooms;
  const pos = (c, l) => c + ':' + l;
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const [fc, fl, tc, tl] of BOARD.links) {
    assert.ok(fc >= -1 && fc <= 3 && tc >= -1 && tc <= 3, 'links run from the start line (-1) to the boss (3)');
    if (fc !== -1 && fc !== 3) assert.ok(fl >= 0 && fl < columns[fc].length, `from-lane ${fl} out of range in column ${fc}`);
    if (tc !== -1 && tc !== 3) assert.ok(tl >= 0 && tl < columns[tc].length, `to-lane ${tl} out of range in column ${tc}`);
    add(pos(fc, fl), pos(tc, tl));
  }
  /* forward reachability from the start line */
  const reach = new Set();
  const queue = [];
  for (const [fc, fl] of BOARD.links.filter((l) => l[0] === -1).map((l) => [l[0], l[1]])) {
    const p = pos(fc, fl);
    if (!reach.has(p)) {
      reach.add(p);
      queue.push(p);
    }
  }
  while (queue.length) {
    const p = queue.shift();
    for (const n of adj.get(p) || []) {
      if (!reach.has(n)) {
        reach.add(n);
        queue.push(n);
      }
    }
  }
  for (let c = 0; c < columns.length; c++) {
    for (let l = 0; l < columns[c].length; l++) {
      assert.ok(
        reach.has(pos(c, l)),
        `cell '${columns[c][l]}' (column ${c}, lane ${l}) is unreachable from the start line`
      );
      /* every cell must reach the boss: walk its own forward closure */
      const own = new Set([pos(c, l)]);
      const q2 = [pos(c, l)];
      while (q2.length) {
        const p = q2.shift();
        for (const n of adj.get(p) || []) {
          if (!own.has(n)) {
            own.add(n);
            q2.push(n);
          }
        }
      }
      assert.ok(
        [...own].some((p) => p.startsWith('3:')),
        `cell '${columns[c][l]}' (column ${c}, lane ${l}) never reaches the boss`
      );
    }
  }
  /* at most 3 exits per cell (the in-game lane budget) */
  for (const [p, exits] of adj) {
    assert.ok(exits.size <= 3, `cell ${p} has ${exits.size} exits (max 3)`);
  }
  /* the boss fan-in is the split's lane count */
  const bossIn = BOARD.links.filter((l) => l[2] === 3).length;
  assert.equal(bossIn, BOARD.splitLanes, `the boss fan-in (${bossIn}) must equal the split's ${BOARD.splitLanes} lanes`);
});

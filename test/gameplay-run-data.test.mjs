/*
 * The gameplay page's example path board (issue #119) — one static
 * Classic segment for badge 1, heading for Gym 2 — must stay a legal
 * draw of the generator: every cell a room type the `placement` rules
 * in data/adventure.json allow at badge 1, every rest stop in a column
 * the generator can actually place it in (issue #129 — the rest-stop
 * weight, re-verified against references/pokeemerald-rogue
 * src/rogue_adventurepaths.c: a length-5 Classic path (L1191), base 10
 * (L503), +90 near the boss (L509–510), −40 in the first column
 * (L513–514), clamped 0..255 (L593), zero = never placed (L611)), the
 * layout the generator's shape (3 room columns × 1–3 lanes, the 2–3-
 * lane split in front of the gym, the minimum regular routes kept), and
 * the lane wiring one legal board (every cell reachable from the start
 * line and reaching the boss, at most 3 exits per cell, the boss
 * fan-in = the split's lane count).
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

/* The boss ladder, derived from the boss-ladder records in
   data/adventure.json (each record's name carries its badge range —
   Gym Leaders (Badges 0–7), Elite Four (Badges 8–11), Champion
   (Badge 12), Final Battle (Badge 13); the Victory Lap carries none):
   `ladder[badge]` = the end boss a board for that badge heads for. */
const ladder = {};
let lastBadged = -1;
for (const b of adventure.records.filter((r) => r.category === 'boss')) {
  const m = b.name.match(/Badge[s]? (\d+)(?:–(\d+))?/);
  if (!m) continue;
  const prefix = b.name.split(' (')[0].split(' ')[0];
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  lastBadged = Math.max(lastBadged, end);
  for (let n = 0; n <= end - start; n++) {
    ladder[start + n] = end === start ? prefix : `${prefix} ${n + 1}`;
  }
}

/* one of the placement `bars` label → the badge range it covers
   (the generator's stages, per the boss-ladder records: "Elite Four"
   is that record's own badges, "Champion+" runs from the Champion to
   the last badged record) */
function tierBadges(label) {
  if (label === 'badge 0') return [0, 0];
  const m = label.match(/^badges (\d+)[–-](\d+)$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const rec = adventure.records.find((r) => r.category === 'boss' && r.name.startsWith(label.replace(/\+$/, '')));
  const rm = rec && rec.name.match(/Badge[s]? (\d+)(?:–(\d+))?/);
  if (!rm) return null;
  const start = Number(rm[1]);
  const end = label.endsWith('+') ? lastBadged : rm[2] !== undefined ? Number(rm[2]) : start;
  return [start, end];
}

const badge = BOARD.badge;

/* The generator's rest-stop placement weight for a board column
   (issue #129) — re-verified against references/pokeemerald-rogue
   src/rogue_adventurepaths.c: the Classic segment is a length-5 path
   (L1191: totalLength = 3 + 2; the +2 is the initial split + the final
   encounter), rooms only exist at x > 1 (L654–655: routes never fill
   the column in front of the gym, so x = 1 is always empty sand), and
   the board's columns read left→right from the FIRST column — the
   spawn column, x = pathLength − 1 (L1665/L2002: the start line is
   drawn in front of the x == pathLength − 1 rooms) — down to x = 2.
   The rest-stop weight (ReplaceRoomEncounters_CalculateWeight,
   L499–514) is base 10 (L503), +90 when x ≤ 2 (L509–510), −40 in the
   first column (L513–514), clamped to 0..255 (L593) — at zero the room
   is never selected (L611: RogueWeightQuery_HasAnyWeights). In the
   length-5 Classic path the leftmost board column is x = 4: 10 − 40 =
   −30 → 0, so a Rest Stop there is an impossible draw. */
function restStopWeight(siteColumn, pathLength) {
  const x = pathLength - 1 - siteColumn; // board column 0 = first column = x pathLength − 1
  let weight = 10; // L503
  if (x <= 2) weight += 90; // L509–510 (near the boss)
  if (x + 1 === pathLength) weight -= 40; // L513–514 (the first column)
  return Math.min(255, Math.max(0, weight)); // L593
}

test('the example board is one Classic segment on the badge 1 ladder step', () => {
  assert.equal(badge, 1, 'the example board is badge 1 — right after the first badge');
  assert.deepEqual(
    Object.keys(ladder)
      .map(Number)
      .sort((a, b) => a - b),
    [...Array(14).keys()],
    'the boss-ladder records span exactly badges 0–13 (the ladder derivation must see every record)'
  );
  assert.equal(BOARD.boss, ladder[badge], `the boss is the next step on the ladder for badge ${badge} (${ladder[badge]})`);
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

test('a Rest Stop never sits in a zero-weight column (issue #129: the leftmost column at badge 1)', () => {
  const pathLength = 5; // Classic segment: totalLength = 3 + 2 (L1191)
  let sawRest = false;
  for (let c = 0; c < BOARD.rooms.length; c++) {
    BOARD.rooms[c].forEach((key, l) => {
      if (key !== 'rest') return;
      sawRest = true;
      const x = pathLength - 1 - c;
      const w = restStopWeight(c, pathLength);
      assert.ok(
        w > 0,
        `rest stop at column ${c} (lane ${l}) sits in the game's column x=${x} — base 10` +
          (x <= 2 ? ' + 90 near the boss' : ', no near-boss bonus') +
          (x + 1 === pathLength ? ' − 40 first-column penalty' : '') +
          ` → clamped to ${w}: the generator can never place a rest stop there (L499–514, L593, L611)`
      );
    });
  }
  assert.ok(sawRest, 'the example board keeps a rest stop on the path (the badge-1 pedagogy: a full rest stop in play)');
});

test('the board layout obeys the generator shape at badge 1', () => {
  for (const column of BOARD.rooms) {
    assert.ok(column.length >= 1 && column.length <= 3, 'each column holds 1–3 lanes');
    assert.ok(column.some((k) => k !== 'gap'), 'this example keeps at least one room in every column');
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
    /* the flow runs start line (-1) → room columns (0–2) → boss (3):
       a link never leaves the boss and never enters the start line */
    assert.ok(fc >= -1 && fc <= 2 && tc >= 0 && tc <= 3, 'links run from the start line (-1) to the boss (3), never in reverse');
    if (fc === -1) assert.ok(fl >= 0 && fl < columns[0].length, `start-line lane ${fl} out of range (the start line fans out into column 0's ${columns[0].length} lanes)`);
    else assert.ok(fl >= 0 && fl < columns[fc].length, `from-lane ${fl} out of range in column ${fc}`);
    if (tc === 3) assert.ok(tl >= 0 && tl < BOARD.splitLanes, `boss lane ${tl} out of range (the split fans in on ${BOARD.splitLanes} lanes)`);
    else assert.ok(tl >= 0 && tl < columns[tc].length, `to-lane ${tl} out of range in column ${tc}`);
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

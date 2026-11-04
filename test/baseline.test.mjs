/**
 * Cross-check tests for the two independent copies of the Vanilla/EX
 * baseline SHAs, and for the homepage hero stats (node --test, no mocks,
 * no deps — plain file reads of the committed JSON).
 *
 * scripts/verify/baseline.json owns the SHAs that `verify:citations
 * --changed` diffs from, while data/site.json `citations.ref` bakes the
 * same SHAs into every citation permalink the live site renders (the
 * repo + ref in ROGUE.citeHtml). The two files must be bumped in
 * lockstep — if only one moves, every source link silently re-points to
 * the wrong game revision. Nothing else compares them, so these tests do.
 *
 * The hero stats (data/site.json `hero.stats`) are asserted the same way:
 * each stat is derived from the authoritative content data file, so the
 * homepage can't silently go stale when a data file changes:
 *   36 Routes       = data/routes.json record count
 *   14 Bosses       = badge span total of the data/adventure.json boss-ladder
 *                     records (8 gym badges + 4 Elite Four + Champion +
 *                     final; the victory lap carries no badge)
 *   60 Safari slots = regular + legendary slot ranges parsed out of the
 *                     data/safari.json pool-slot-layout record (the same
 *                     parse site/js/pages/safari.js renders the pool from)
 *   9 Quest groups  = data/quests.json display_groups length (the nine
 *                     groups every version renders)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(name) {
  return JSON.parse(readFileSync(path.join(root, name), 'utf8'));
}

/** The hero stat for a given label, asserting it exists exactly once. */
function heroStat(label) {
  const site = readJson('data/site.json');
  const stats = site.hero && Array.isArray(site.hero.stats) ? site.hero.stats : [];
  const matches = stats.filter((s) => s && s.label === label);
  assert.equal(matches.length, 1, `hero.stats has ${matches.length} entries labelled "${label}"`);
  return matches[0];
}

test('citations.ref matches the verify baseline (both branches)', () => {
  // ARRANGE — the two files that must stay in lockstep
  const site = readJson('data/site.json');
  const baseline = readJson('scripts/verify/baseline.json');

  // ACT / ASSERT — each branch's ref equals the baseline SHA, field by field
  for (const branch of ['vanilla', 'expansion']) {
    const ref = site.citations && site.citations.ref ? site.citations.ref[branch] : undefined;
    const base = baseline[branch] && baseline[branch].sha;
    // sanity: both sides are full 40-hex SHAs, so an empty/blanked pair can't pass
    assert.match(ref, /^[0-9a-f]{40}$/, `site.json citations.ref.${branch} is not a 40-hex SHA: ${JSON.stringify(ref)}`);
    assert.match(base, /^[0-9a-f]{40}$/, `baseline.json ${branch}.sha is not a 40-hex SHA: ${JSON.stringify(base)}`);
    assert.equal(
      ref,
      base,
      `data/site.json citations.ref.${branch} (${ref}) != scripts/verify/baseline.json ${branch}.sha (${base}) — bump both files together`
    );
  }
});

test('hero stat "Routes" equals the routes record count', () => {
  // ARRANGE
  const routes = readJson('data/routes.json');
  const stat = heroStat('Routes');

  // ACT
  const expected = routes.records.length;

  // ASSERT
  assert.equal(stat.value, String(expected), `hero Routes=${stat.value} but data/routes.json has ${expected} records`);
});

test('hero stat "Bosses" equals the boss-ladder badge span total', () => {
  // ARRANGE — the five boss-ladder records; each name carries its badge
  // span ("Badges 0–7", "Badges 8–11", "Badge 12", "Badge 13"). The
  // victory lap is the post-ladder endless mode and carries no badge, so
  // the ladder's boss count is the number of distinct badge numbers its
  // records span.
  const adventure = readJson('data/adventure.json');
  const stat = heroStat('Bosses');

  // ACT — expand each boss record's badge span into badge numbers
  const badges = new Set();
  for (const record of adventure.records) {
    if (!String(record.id || '').startsWith('boss-')) continue;
    const range = /Badges (\d+)\s*[–—-]\s*(\d+)/.exec(record.name);
    const single = /\(Badge (\d+)\)/.exec(record.name);
    if (range) {
      for (let badge = Number(range[1]); badge <= Number(range[2]); badge++) badges.add(badge);
    } else if (single) {
      badges.add(Number(single[1]));
    } else if (record.id !== 'boss-victory-lap') {
      assert.fail(`boss record ${record.id} carries no parseable badge span: "${record.name}"`);
    }
  }
  // the ladder must start at badge 0 and have no gaps or shared badges
  const sorted = [...badges].sort((a, b) => a - b);
  assert.equal(sorted[0], 0, `boss ladder starts at badge ${sorted[0]}, expected 0`);
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, `boss ladder gap or overlap at badge ${sorted[i]}`);
  }
  const total = badges.size;

  // ASSERT
  assert.equal(stat.value, String(total), `hero Bosses=${stat.value} but the data/adventure.json boss ladder spans badges ${sorted[0]}–${sorted[sorted.length - 1]} (${total} bosses)`);
});

test('hero stat "Safari slots" equals the parsed pool slot total', () => {
  // ARRANGE — the pool-slot-layout record; the page renders the pool from
  // the "N–M are regular" / "N–M are legendary" ranges in its description
  // (site/js/pages/safari.js does the same parse), so derive it the same way.
  const safari = readJson('data/safari.json');
  const stat = heroStat('Safari slots');
  const layout = safari.records.find((r) => r && r.id === 'pool-slot-layout');
  assert.ok(layout && layout.description, 'data/safari.json has no pool-slot-layout record with a description');

  // ACT — parse both ranges and sum their slot counts
  function slotRange(role) {
    const m = new RegExp('(\\d+)\\s*[–—-]\\s*(\\d+)\\s+are ' + role).exec(layout.description);
    assert.ok(m, `could not parse "N–M are ${role}" from the pool-slot-layout description`);
    return Number(m[2]) - Number(m[1]) + 1;
  }
  const total = slotRange('regular') + slotRange('legendary');

  // ASSERT
  assert.equal(stat.value, String(total), `hero Safari slots=${stat.value} but the pool-slot-layout ranges sum to ${total}`);
});

test('hero stat "Quest groups" equals the display_groups length', () => {
  // ARRANGE — display_groups is the shared top-level list; both versions
  // render all nine groups (empty groups included).
  const quests = readJson('data/quests.json');
  const stat = heroStat('Quest groups');

  // ACT
  const expected = quests.display_groups.length;

  // ASSERT
  assert.equal(stat.value, String(expected), `hero Quest groups=${stat.value} but data/quests.json has ${expected} display groups`);
});

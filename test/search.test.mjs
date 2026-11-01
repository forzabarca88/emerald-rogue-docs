/**
 * Unit tests for site/js/search-index.js (the pure, version-independent
 * search index + version-scoped query for the search palette) and the two
 * render.js helpers it builds on: ROGUE.resolvePlaceholders and
 * ROGUE.effective(record, keys).
 *
 * node --test, zero deps, no DOM, no mocks: loads site/js/data.js,
 * site/js/render.js then site/js/search-index.js into one shared vm
 * sandbox whose fake `window` carries the REAL data/*.json files (read
 * from disk), and asserts end results — entry completeness and shape,
 * placeholder resolution, the FAIRY-swap union, query-time version
 * scoping, ranking/cap and matchIndex, the #31 structured diagram fields'
 * searchability, and the effective/placeholder helper semantics.
 * ROGUE.version is assigned directly on the sandbox's ROGUE (version.js is
 * NOT loaded — it needs localStorage/document).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The 14 content data files — every data/*.json except site.json. */
const CONTENT_FILES = [
  'adventure',
  'campaigns',
  'charms',
  'followmons',
  'game-modes',
  'gameshow',
  'hub',
  'quests',
  'routes',
  'safari',
  'settings',
  'timeofday',
  'unique-mons',
  'versions'
];

const VERSIONS = ['vanilla', 'ex'];

/** The five quest keys quests.js scopes ROGUE.effective to (its DIFF_KEYS). */
const QUEST_KEYS = ['description', 'trigger', 'rewards', 'requirements', 'display_group'];

/**
 * The NFD accent fold the module documents (per code unit, combining
 * marks stripped) — the test uses it to verify folded-query assertions
 * independently of the module's internals.
 */
function fold(s) {
  const out = [];
  const str = s === null || s === undefined ? '' : String(s).toLowerCase();
  for (let i = 0; i < str.length; i++) {
    const d = str.charAt(i).normalize('NFD');
    for (let j = 0; j < d.length; j++) {
      const cu = d.charCodeAt(j);
      if (cu >= 0x0300 && cu <= 0x036f) continue;
      out.push(d.charAt(j));
    }
  }
  return out.join('');
}

/** The page each record's card renders on — the deep-link contract the index must honour. */
function expectedPage(fileId, record) {
  switch (fileId) {
    case 'adventure':
      return './gameplay.html';
    case 'campaigns':
      return record.id === 'campaign-trigger' ? './config.html' : './mechanics.html';
    case 'charms':
    case 'followmons':
    case 'gameshow':
    case 'timeofday':
    case 'unique-mons':
      return './mechanics.html';
    case 'game-modes':
    case 'settings':
      return './config.html';
    case 'hub':
      return './hub.html';
    case 'quests':
      return './quests.html';
    case 'routes':
      return './routes.html';
    case 'safari':
      return './safari.html';
    case 'versions':
      return './versions.html';
  }
  throw new Error('unknown content file: ' + fileId);
}

/** One shared sandbox: real data/*.json on a fake window, the three modules loaded in order. */
const ctx = (() => {
  const data = { site: JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8')) };
  for (const f of CONTENT_FILES) data[f] = JSON.parse(readFileSync(path.join(root, 'data', f + '.json'), 'utf8'));
  const window = { ROGUE_DATA_SITE: data.site };
  for (const f of CONTENT_FILES) window['ROGUE_DATA_' + f.toUpperCase()] = data[f];
  const sandbox = { window };
  vm.createContext(sandbox);
  for (const mod of ['data', 'render', 'search-index']) {
    vm.runInContext(readFileSync(path.join(root, 'site', 'js', mod + '.js'), 'utf8'), sandbox, { filename: mod + '.js' });
  }
  return { rogue: sandbox.window.ROGUE, data: data, entries: sandbox.window.ROGUE.buildSearchIndex() };
})();

const { rogue, data, entries } = ctx;
const byId = new Map(entries.map((e) => [e.id, e]));

test('the index has exactly one entry per record, per prose block and per nav page', () => {
  // ARRANGE — expected shapes derived from the data itself
  const nav = data.site.nav;
  const navPages = nav.map((id) => './' + id + '.html');

  // ASSERT — nav pages: one page- entry per nav item, linking the page itself
  assert.equal(entries.filter((e) => e.id.startsWith('page-')).length, nav.length);
  for (const id of nav) {
    const e = byId.get('page-' + id);
    assert.ok(e, `missing page entry for nav item "${id}"`);
    assert.equal(e.page, './' + id + '.html');
    assert.equal(e.title, data.site.pages[id].title);
    assert.equal(e.anchor, '');
    // [...]: the entry's arrays live in the vm realm — normalize for deep-equality
    assert.deepEqual([...e.versions], ['vanilla', 'ex']);
  }

  // ASSERT — records: exactly one rec- entry per record of each of the 14 files,
  // carrying the record's own versions array and the page that renders it
  let expectedRecs = 0;
  for (const f of CONTENT_FILES) {
    const records = data[f].records;
    expectedRecs += records.length;
    assert.equal(
      entries.filter((e) => e.id.startsWith('rec-' + f + '-')).length,
      records.length,
      `${f}: expected ${records.length} rec- entries, got ${entries.filter((e) => e.id.startsWith('rec-' + f + '-')).length}`
    );
    for (const r of records) {
      const e = byId.get('rec-' + f + '-' + r.id);
      assert.ok(e, `missing rec entry for ${f}/${r.id}`);
      const expectedVersions = Array.isArray(r.versions) ? [...r.versions] : ['vanilla', 'ex'];
      assert.deepEqual([...e.versions], expectedVersions, `${f}/${r.id} versions`);
      assert.equal(e.page, expectedPage(f, r), `${f}/${r.id} page`);
      assert.ok(e.anchor === '' || e.anchor.startsWith('#'), `${f}/${r.id} anchor must be '' or '#<id>', got "${e.anchor}"`);
      assert.ok(navPages.includes(e.page), `${f}/${r.id} page "${e.page}" must be a nav page`);
      assert.equal(e.text.slice(0, e.titleLower.length), e.titleLower, `${f}/${r.id} text must start with its title`);
      assert.equal(e.text, e.text.toLowerCase(), `${f}/${r.id} text must be lowercased`);
    }
  }
  assert.equal(entries.filter((e) => e.id.startsWith('rec-')).length, expectedRecs);

  // ASSERT — prose: every prose block of every file is indexed with a real page and a section anchor
  let expectedProse = 0;
  for (const f of CONTENT_FILES) {
    const blocks = data[f].prose || [];
    expectedProse += blocks.length;
    for (const b of blocks) {
      const e = byId.get('prose-' + f + '-' + b.id);
      assert.ok(e, `missing prose entry for ${f}/${b.id}`);
      assert.match(e.page, /^\.\/[a-z-]+\.html$/, `${f}/${b.id} page must be a relative .html link, got "${e.page}"`);
      assert.ok(e.anchor === '' || e.anchor.startsWith('#'), `${f}/${b.id} anchor must be '' or '#<id>', got "${e.anchor}"`);
    }
  }
  assert.ok(
    entries.filter((e) => e.id.startsWith('prose-')).length >= expectedProse,
    'every prose block must be indexed (cross-page blocks may add extra entries)'
  );
});

test('quest {PKMN}/{POKEBLOCK} placeholders are resolved in the index', () => {
  // ARRANGE — every quest record carrying a raw token in its content fields
  const fields = (r) => [r.name, r.description, r.trigger, r.requirements, r.rewards]
    .map((x) => (x === null || x === undefined ? '' : Array.isArray(x) ? JSON.stringify(x) : String(x)))
    .join(' ');
  const marked = data.quests.records.filter((r) => /\{(PKMN|POKEBLOCK)\}/.test(fields(r)));
  assert.ok(marked.length > 0, 'fixture: at least one placeholder quest is expected');

  // ASSERT — resolved words present, literal tokens absent, from title and text
  for (const r of marked) {
    const e = byId.get('rec-quests-' + r.id);
    assert.ok(e, `missing rec entry for ${r.id}`);
    for (const [token, word] of [
      ['{PKMN}', 'pokémon'],
      ['{POKEBLOCK}', 'pokéblock']
    ]) {
      if (fields(r).includes(token)) {
        assert.ok(e.text.includes(word), `${r.id}: text must contain resolved "${word}"`);
        assert.ok(!e.text.includes(token.toLowerCase()), `${r.id}: text must not carry literal ${token}`);
        assert.ok(!e.title.includes(token), `${r.id}: title must not carry literal ${token}`);
      }
    }
  }
});

test('the FAIRY-swap routes index BOTH the EX and the Vanilla wild types', () => {
  // ARRANGE — derive the swapped set from the data; parse the Vanilla note
  // the same way routes.js does ("Wild types: a, b, c" — three types or none)
  const parseWild = (s) => {
    const m = s.match(/Wild types:\s*([^.;]+)/i);
    if (!m) return [];
    const types = m[1].split(',').map((t) => t.trim()).filter(Boolean);
    return types.length === 3 ? types : [];
  };
  const swapped = data.routes.records.filter(
    (r) => r.differences && typeof r.differences === 'object' && typeof r.differences.vanilla === 'string'
  );
  assert.equal(swapped.length, 6, 'fixture: the six FAIRY-swap routes are expected');

  // ASSERT — each swapped route's haystack carries every EX and Vanilla type word
  for (const r of swapped) {
    const exTypes = r.type;
    const vanillaTypes = parseWild(r.differences.vanilla);
    assert.equal(vanillaTypes.length, 3, `${r.id}: the Vanilla wild types must parse`);
    assert.notDeepEqual(vanillaTypes.slice().sort(), exTypes.slice().sort(), `${r.id}: fixture must actually swap`);
    const e = byId.get('rec-routes-' + r.id);
    const text = fold(e.text);
    for (const t of [...exTypes, ...vanillaTypes]) {
      assert.ok(text.includes(fold(t)), `${r.id}: haystack must contain the type "${t}"`);
    }
  }
});

test('the #31 structured diagram fields are searchable (trimmed-but-rendered text)', () => {
  // ARRANGE — queries that are user-visible strings the #31 batch moved
  // out of the prose into structured fields. Each is absent from the
  // owning block/record's prose text (verified against data/*.json), so a
  // hit proves the structured field made it into the haystack:
  //   "gym bosses"           data/settings.json difficulty-scale
  //                          ladder.tiers[0].label (the ladder visual)
  //   "30 if shiny"          data/safari.json priority-eviction
  //                          score.terms[1].label (the chip equation)
  //   "mid-run — releasing"  data/safari.json entry-released `short`
  //                          (the entry-flow diagram essence)
  //   "spring"               data/hub.json time-weather-season
  //                          cycles.season.phases (the cycle strip)
  //   "odd badge"            data/adventure.json room placement bars'
  //                          conditions (the placement diagram)
  const structured = [
    { q: 'gym bosses', id: 'prose-settings-difficulty-scale', page: './config.html', total: 1 },
    { q: '30 if shiny', id: 'rec-safari-priority-eviction', page: './safari.html', total: 1 },
    { q: 'mid-run \u2014 releasing', id: 'rec-safari-entry-released', page: './safari.html', total: 1 },
    { q: 'spring', id: 'prose-hub-time-weather-season', page: './hub.html', total: 5 },
    { q: 'odd badge', id: 'rec-adventure-room-honey-tree', page: './gameplay.html', total: 3 }
  ];

  // ACT — one query per structured string (EX scope)
  // ASSERT — each surfaces its structured entry at the page that renders
  // the diagram, with the exact result count from the real index
  for (const s of structured) {
    const hits = rogue.searchQuery(entries, s.q, 'ex');
    assert.equal(hits.length, s.total, `"${s.q}" under EX: ${s.total} result(s), derived from the real index`);
    const hit = hits.find((e) => e.id === s.id);
    assert.ok(hit, `"${s.q}" must surface ${s.id} (structured field text, absent from the prose)`);
    assert.equal(hit.page, s.page, `${s.id} deep-links to the page that renders the diagram`);
    // the fields are version-neutral — the same hit survives Vanilla scope
    assert.ok(
      rogue.searchQuery(entries, s.q, 'vanilla').some((e) => e.id === s.id),
      `"${s.q}" also surfaces ${s.id} under Vanilla (the structured field renders identically in both builds)`
    );
  }

  // ASSERT — "odd badge" end result: exactly the three parity-weighted
  // rooms, in index order (the bar conditions each render on the
  // gameplay placement diagram). [...] reconstructs the vm-realm array in
  // the host realm (the same deep-equality rule the other tests use).
  assert.deepEqual([...rogue.searchQuery(entries, 'odd badge', 'ex').map((e) => e.id)], [
    'rec-adventure-room-honey-tree',
    'rec-adventure-room-dark-deal',
    'rec-adventure-room-lab'
  ]);

  // ASSERT — "shiny" on the safari priority entry: its score term
  // "30 if shiny" is the new text (the prose says "shinies", which does
  // not contain "shiny"). The query hits 57 entries under EX — past the
  // 30 cap — so the entry's haystack is checked directly.
  assert.ok(
    byId.get('rec-safari-priority-eviction').text.includes('shiny'),
    'the safari priority record\'s haystack carries "shiny" (from the structured score term)'
  );
});

test('version scoping happens at query time', () => {
  // ARRANGE — the EX-only quests (derived, not hardcoded) and a distinctive
  // word from one of their names, so it title-matches its own entry
  const exOnly = data.quests.records.filter((r) => !r.versions.includes('vanilla'));
  assert.ok(exOnly.length > 0, 'fixture: EX-only quests are expected');
  let best = { id: '', word: '' };
  for (const r of exOnly) {
    const w = r.name.toLowerCase().split(/[^a-z]+/).sort((a, b) => b.length - a.length)[0] || '';
    if (w.length > best.word.length) best = { id: r.id, word: w };
  }
  assert.ok(best.word.length >= 4, `fixture: a distinctive EX-only quest word, got "${best.word}"`);
  const entryId = 'rec-quests-' + best.id;

  // ACT
  const underVanilla = rogue.searchQuery(entries, best.word, 'vanilla');
  const underEx = rogue.searchQuery(entries, best.word, 'ex');

  // ASSERT — an entry never surfaces outside its versions
  for (const e of underVanilla) assert.ok(e.versions.includes('vanilla'), `${e.id} leaked into vanilla results`);
  for (const e of underEx) assert.ok(e.versions.includes('ex'), `${e.id} leaked into ex results`);
  assert.ok(!underVanilla.some((e) => e.id === entryId), `the EX-only quest ${entryId} must not surface under vanilla`);
  assert.ok(underEx.some((e) => e.id === entryId), `the EX-only quest ${entryId} must surface under ex`);

  // ASSERT — the same query under both versions is deterministic
  assert.deepEqual(rogue.searchQuery(entries, best.word, 'vanilla'), underVanilla);
  assert.deepEqual(rogue.searchQuery(entries, best.word, 'ex'), underEx);
});

test('vanilla-side quest wording (structured differences) is searchable', () => {
  // ARRANGE — the first quest whose structured vanilla side rewrites trigger/description
  const quest = data.quests.records.find((r) => {
    const d = r.differences;
    return (
      d &&
      typeof d === 'object' &&
      d.vanilla &&
      typeof d.vanilla === 'object' &&
      ['trigger', 'description'].some((k) => d.vanilla[k] !== undefined && d.vanilla[k] !== r[k])
    );
  });
  assert.ok(quest, 'fixture: a vanilla-side quest rewrite is expected');
  const key = ['trigger', 'description'].find(
    (k) => quest.differences.vanilla[k] !== undefined && quest.differences.vanilla[k] !== quest[k]
  );
  const vText = fold(quest.differences.vanilla[key]);
  const tText = fold(quest[key]);
  // a word n-gram present ONLY in the vanilla-side wording
  const words = vText.split(/[^a-z0-9]+/).filter(Boolean);
  let gram = null;
  for (let n = 6; n >= 2 && !gram; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n).join(' ');
      if (vText.includes(g) && !tText.includes(g)) {
        gram = g;
        break;
      }
    }
  }
  assert.ok(gram, `fixture: a vanilla-only wording n-gram for ${quest.id}/${key}`);
  assert.ok(!tText.includes(gram), 'fixture sanity: the n-gram must be absent from the top-level (EX) wording');

  // ACT + ASSERT — the vanilla-side wording matches the quest under BOTH versions (the union)
  for (const v of VERSIONS) {
    const hits = rogue.searchQuery(entries, gram, v);
    assert.ok(hits.some((e) => e.id === 'rec-quests-' + quest.id), `${quest.id} must match its vanilla-side wording under ${v}`);
  }
});

test('results rank title-starts before title-includes before body, stable within a tier', () => {
  // ARRANGE — a query (derived) hitting all three tiers without exceeding the cap
  const maxResults = data.site.search.maxResults;
  const tierOf = (e, q) => {
    const ft = fold(e.titleLower);
    if (ft.startsWith(q)) return 0;
    if (ft.includes(q)) return 1;
    if (fold(e.text).includes(q)) return 2;
    return -1;
  };
  const scoped = entries.filter((e) => e.versions.includes('ex'));
  const query = ['boss', 'safari', 'charm', 'wild', 'calm', 'the'].find((q) => {
    const tiers = new Set(scoped.map((e) => tierOf(e, q)).filter((t) => t >= 0));
    return tiers.size === 3 && scoped.filter((e) => tierOf(e, q) >= 0).length <= maxResults;
  });
  assert.ok(query, 'fixture: a query hitting all three tiers within the cap');

  // ACT
  const res = rogue.searchQuery(entries, query, 'ex');

  // ASSERT — complete for this query (no cap), tiers in 0 < 1 < 2 order,
  // and each tier keeps the index order
  assert.equal(res.length, scoped.filter((e) => tierOf(e, query) >= 0).length);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].tier <= res[i].tier, `tier out of order at position ${i}`);
  for (const t of [0, 1, 2]) {
    // [...] on both sides: results and entries live in the vm realm
    const expected = [...scoped.filter((e) => tierOf(e, query) === t).map((e) => e.id)];
    const got = [...res.filter((r) => r.tier === t).map((r) => r.id)];
    assert.deepEqual(got, expected, `tier ${t} must keep index order`);
  }
});

test('results are capped at search.maxResults and matchIndex points at a real occurrence', () => {
  // ARRANGE — a query with far more matches than the cap
  const maxResults = data.site.search.maxResults;
  const query = 'the';
  const q = fold(query);
  const totalMatches = entries.filter((e) => e.versions.includes('ex') && fold(e.text).includes(q)).length;
  assert.ok(totalMatches > maxResults, `fixture: "${query}" must overflow the cap of ${maxResults}`);

  // ACT
  const res = rogue.searchQuery(entries, query, 'ex');

  // ASSERT — exactly the cap; every matchIndex a real occurrence of the folded query
  assert.equal(res.length, maxResults);
  for (const r of res) {
    assert.ok(r.matchIndex >= 0 && r.matchIndex + q.length <= r.text.length, `${r.id}: matchIndex out of range`);
    assert.ok(
      fold(r.text.slice(r.matchIndex, r.matchIndex + q.length)).startsWith(q),
      `${r.id}: text.slice(matchIndex, +${q.length}) must start with the folded query`
    );
  }
});

test('ROGUE.effective applies the active version side over the quest keys for every quest', () => {
  // ARRANGE
  const check = (record, version) => {
    const side = record.differences && typeof record.differences === 'object' ? record.differences[version] : null;
    const effSide = side && typeof side === 'object' ? side : null;
    const eff = rogue.effective(record, QUEST_KEYS);
    assert.deepEqual(Object.keys(eff).sort(), Object.keys(record).sort(), `${record.id}: field set`);
    for (const k of Object.keys(record)) {
      const expected = effSide && QUEST_KEYS.includes(k) && effSide[k] !== undefined ? effSide[k] : record[k];
      assert.deepEqual(eff[k], expected, `${record.id}/${version}/${k}`);
    }
  };

  // ACT + ASSERT — field by field, against values computed from the raw record
  try {
    rogue.version = 'ex';
    for (const r of data.quests.records) check(r, 'ex');
    rogue.version = 'vanilla';
    for (const r of data.quests.records) check(r, 'vanilla');
  } finally {
    delete rogue.version;
  }
});

test('ROGUE.effective passes string/absent differences through untouched', () => {
  // ARRANGE — non-quest samples: string-form differences (charms, routes) and none (adventure)
  const samples = [
    data.charms.records.find((r) => r.differences && typeof r.differences === 'object' && typeof r.differences.ex === 'string'),
    data.routes.records.find((r) => r.differences && typeof r.differences === 'object' && typeof r.differences.vanilla === 'string'),
    data.adventure.records.find((r) => r.differences === undefined)
  ];
  assert.ok(samples.every(Boolean), 'fixture: string-diff and no-diff samples are expected');

  // ACT + ASSERT — a copy with exactly the record's fields, nothing overridden
  try {
    for (const version of VERSIONS) {
      rogue.version = version;
      for (const r of samples) {
        const eff = rogue.effective(r, QUEST_KEYS);
        assert.notStrictEqual(eff, r, `${r.id}: must be a copy, not the record itself`);
        assert.deepEqual(Object.keys(eff).sort(), Object.keys(r).sort(), `${r.id}: field set`);
        for (const k of Object.keys(r)) assert.deepEqual(eff[k], r[k], `${r.id}/${k}`);
      }
    }
  } finally {
    delete rogue.version;
  }
});

test('ROGUE.resolvePlaceholders resolves the game tokens and leaves everything else alone', () => {
  // ACT + ASSERT
  assert.equal(rogue.resolvePlaceholders('Catch a {PKMN}!'), 'Catch a Pokémon!');
  assert.equal(rogue.resolvePlaceholders('Eat a {POKEBLOCK}'), 'Eat a Pokéblock');
  assert.equal(rogue.resolvePlaceholders('{PKMN} and {POKEBLOCK} and {PKMN}'), 'Pokémon and Pokéblock and Pokémon');
  assert.equal(rogue.resolvePlaceholders('no tokens here'), 'no tokens here');
  assert.equal(rogue.resolvePlaceholders('keep {UNKNOWN} tokens'), 'keep {UNKNOWN} tokens');
  assert.equal(rogue.resolvePlaceholders(null), '');
  assert.equal(rogue.resolvePlaceholders(undefined), '');
  assert.equal(rogue.resolvePlaceholders(''), '');
});

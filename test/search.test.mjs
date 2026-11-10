/**
 * Unit tests for site/js/search-index.js (the pure, version-independent
 * search index + version-scoped query for the search palette) and the two
 * render.js helpers it builds on: ROGUE.resolvePlaceholders and
 * ROGUE.effective(record, keys).
 *
 * node --test, zero deps, no DOM, no mocks: loads site/js/data.js,
 * site/js/render.js then site/js/search-index.js into one shared vm
 * sandbox whose fake `window` carries the REAL data/*.json files (read
 * from disk), and asserts end results — entry completeness and shape
 * (incl. the original-case textCase parallel of the lowercased text),
 * the per-record deep-link anchors (issue #45: record entries anchor at
 * the per-card id, prose entries keep their section anchors), placeholder
 * resolution, the FAIRY-swap union, query-time version scoping (incl.
 * the fuzzy tier), ranking/cap, the pre-cap total and matchIndex (+
 * matchEnd alignment for accented queries), the fuzzy tier's typo
 * matching (issue #46: Levenshtein ≤ 1 on folded tokens, exact matches
 * rank first, the unknown-word guard, accent-insensitivity), the #31
 * structured diagram fields' searchability, and the
 * effective/placeholder helper semantics.
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

/** The 15 content data files — every data/*.json except site.json. */
const CONTENT_FILES = [
  'adventure',
  'campaigns',
  'charms',
  'followmons',
  'game-modes',
  'gameshow',
  'hub',
  'pokedex',
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

/** Whole tokens of a string (runs of a-z0-9 after lowercasing). */
function tokensOf(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** Levenshtein distance, capped at 2 (the fuzzy tier only needs ≤ 1). */
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[n];
}

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
    case 'pokedex':
      return './pokedex.html';
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

  // ASSERT — site.json's own home content (issue #50): the hero block and
  // every site prose block get one entry each, linking the index page
  // (the hero sits at the page top, the prose at its own DOM id)
  assert.equal(entries.filter((e) => e.id.startsWith('prose-site-')).length, 1 + (data.site.prose || []).length);
  const heroE = byId.get('prose-site-hero');
  assert.ok(heroE, 'missing the site.json hero entry');
  assert.equal(heroE.page, './index.html', 'the hero entry links the index page');
  assert.equal(heroE.anchor, '', 'the hero is at the top of the index page');
  assert.equal(heroE.title, data.site.hero.title);
  assert.deepEqual([...heroE.versions], ['vanilla', 'ex']);
  assert.ok(heroE.text.includes(data.site.hero.subtitle.toLowerCase()), 'the hero subtitle must be in the haystack');
  for (const stat of data.site.hero.stats || []) {
    assert.ok(heroE.text.includes(stat.label.toLowerCase()), `the hero stat label "${stat.label}" must be in the haystack`);
  }
  for (const p of data.site.prose || []) {
    const e = byId.get('prose-site-' + p.id);
    assert.ok(e, `missing site.json prose entry for "${p.id}"`);
    assert.equal(e.page, './index.html', `site.json "${p.id}" links the index page`);
    assert.equal(e.anchor, '#' + p.id, `site.json "${p.id}" anchors at its own DOM id`);
    assert.equal(e.title, p.heading);
    assert.deepEqual([...e.versions], ['vanilla', 'ex']);
    assert.ok(e.text.includes(p.text.toLowerCase()), `site.json "${p.id}" text must be in the haystack`);
  }

  // ASSERT — records: exactly one rec- entry per record of each of the 15 files,
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
      // issue #48: the original-case parallel — lowercasing textCase must
      // reproduce text exactly (1:1 per code unit, so matchIndex/matchEnd
      // slice both identically)
      assert.equal(e.textCase.toLowerCase(), e.text, `${f}/${r.id} textCase must be the 1:1 original-case parallel of text`);
    }
  }
  assert.equal(entries.filter((e) => e.id.startsWith('rec-')).length, expectedRecs);
  // at least some entries actually carry original casing in their haystack
  assert.ok(entries.some((e) => e.textCase !== e.text), 'fixture: mixed-case haystacks are expected');

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

test('record entries anchor at the per-card deep-link id (issue #45); prose entries keep section anchors', () => {
  // ARRANGE — the containing section each record's card renders into
  // (recordTarget's mapping — the same-page fallback search.js uses when
  // the card element is absent). The one cardless record (the campaigns
  // trigger) has no section fallback: its anchor IS the section.
  const sectionOf = (f, r) => {
    switch (f) {
      case 'adventure':
        return r.category === 'boss' ? '#gp-boss' : '#gp-rooms';
      case 'campaigns':
        return r.id === 'campaign-trigger' ? undefined : '#mech-campaigns';
      case 'charms':
        return '#mech-charms';
      case 'followmons':
        return '#mech-followmons';
      case 'game-modes':
        return '#config-modes';
      case 'gameshow':
        return '#mech-gameshow';
      case 'hub':
        if (r.category === 'hub-area') return '#hub-areas';
        if (r.category === 'hub-upgrade') return '#hub-upgrades';
        if (r.category === 'home-decor') return '#hub-decor';
        return undefined;
      case 'quests':
        return '#quest-log';
      case 'pokedex':
        // the species detail panel renders into the overview section
        return '#dex-overview';
      case 'routes':
        return '#routes-table';
      case 'safari':
        return {
          'pool-slot-layout': '#safari-pool',
          'priority-eviction': '#safari-priority',
          'legends-cave': '#safari-legends',
          'pool-sign': '#safari-sign',
          'run-start-ribbon': '#safari-entry'
        }[r.id] || (r.category === 'entry-criterion' ? '#safari-entry' : '');
      case 'settings':
        if (r.category === 'preset') return '#config-difficulty';
        if (r.category === 'toggle') return '#config-toggles';
        if (r.category === 'range') return '#config-ranges';
        return undefined;
      case 'timeofday':
        return '#mech-timeofday';
      case 'unique-mons':
        return '#mech-uniquemons';
      case 'versions':
        return '#version-diffs';
    }
    throw new Error('unknown content file: ' + f);
  };

  // ASSERT — every record entry anchors at its per-card id (version-
  // independent: derived from the record's identity, not the version) and
  // carries its containing section as the same-page fallback
  for (const f of CONTENT_FILES) {
    for (const r of data[f].records) {
      const e = byId.get('rec-' + f + '-' + r.id);
      const expected =
        f === 'campaigns' && r.id === 'campaign-trigger' ? '#config-campaigns' : '#rec-' + f + '-' + r.id;
      assert.equal(e.anchor, expected, `${f}/${r.id}: record entries anchor at the per-card deep-link id`);
      assert.equal(e.section, sectionOf(f, r), `${f}/${r.id}: the containing section rides along as the same-page fallback`);
    }
  }

  // ASSERT — prose entries keep their section anchors (unchanged by the
  // per-card deep links) and carry no section fallback
  const proseAnchors = {
    'prose-quests-display-groups': '#quest-log',
    'prose-hub-what-the-hub-is': '#what-the-hub-is',
    'prose-hub-wander-mons': '#hub-wander',
    'prose-safari-entry-criteria': '#safari-entry',
    'prose-pokedex-reading-entries': '#reading-entries',
    'prose-pokedex-sprite-provenance': '#sprite-provenance',
    'prose-routes-naming-scheme': '#routes-naming',
    'prose-adventure-boss-ladder': '#gp-boss',
    'prose-charms-what-they-are': '#mech-charms',
    'prose-site-hero': ''
  };
  for (const [id, anchor] of Object.entries(proseAnchors)) {
    const e = byId.get(id);
    assert.ok(e, `missing prose entry ${id}`);
    assert.equal(e.anchor, anchor, `${id}: prose anchors stay at the section level`);
    assert.equal(e.section, undefined, `${id}: prose entries carry no section fallback`);
  }
  // the cross-page prose entries keep their per-page section anchors
  const cross = byId.get('prose-hub-what-the-hub-is-gameplay');
  assert.ok(cross, 'missing the cross-page hub prose entry');
  assert.equal(cross.anchor, '#gp-hub', 'the cross-page entry anchors at the gameplay section');
  const crossSafari = byId.get('prose-safari-entry-criteria-gameplay');
  assert.ok(crossSafari, 'missing the cross-page safari prose entry');
  assert.equal(crossSafari.anchor, '#gp-post-run', 'the cross-page entry anchors at the gameplay post-run section');
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

test('the on-page quest filter haystack equals the palette quest haystack (issue #50 parity)', () => {
  // ARRANGE — every quest record. The Quests page writes
  // ROGUE.questSearchText(record) into each card's data-search, and the
  // palette indexes that same text for the quest entries, so the two
  // surfaces must agree exactly.
  const flat = (x) => (x === null || x === undefined ? '' : Array.isArray(x) ? x.join(' ') : String(x));
  const groupTitle = (id) =>
    String(id)
      .split('_')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  const resolved = (s) => rogue.resolvePlaceholders(s).toLowerCase();

  // ASSERT — the palette entry text IS the on-page data-search string
  for (const r of data.quests.records) {
    const e = byId.get('rec-quests-' + r.id);
    assert.ok(e, `missing rec entry for ${r.id}`);
    assert.equal(e.text, rogue.questSearchText(r), r.id + ': palette text must equal the on-page data-search');
    // field by field: name, description/trigger/requirements/rewards, flags
    // and the display group(s) as rendered titles are all present
    for (const k of ['name', 'description', 'flags', 'trigger', 'requirements', 'rewards']) {
      const v = flat(r[k]);
      if (v) assert.ok(e.text.includes(resolved(v)), r.id + '/' + k + ' must be in the shared haystack');
    }
    if (r.display_group) assert.ok(e.text.includes(resolved(groupTitle(r.display_group))), r.id + '/display_group');
    // …and BOTH per-version variants (the structured differences sides)
    const diff = r.differences;
    if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
      for (const v of VERSIONS) {
        const side = diff[v];
        if (!side || typeof side !== 'object' || Array.isArray(side)) continue;
        for (const k of ['description', 'trigger', 'requirements', 'rewards']) {
          const sv = flat(side[k]);
          if (sv) assert.ok(e.text.includes(resolved(sv)), r.id + '/' + v + '/' + k + ' (variant side) must be in the shared haystack');
        }
        if (side.display_group) assert.ok(e.text.includes(resolved(groupTitle(side.display_group))), r.id + '/' + v + '/display_group');
      }
    }
  }
});

test('a {PKMN}-templated quest is found by its concrete species name in BOTH surfaces (issue #50)', () => {
  // ARRANGE — Z-A Royale: the {PKMN}-templated quest whose reward list
  // names a concrete species ("a special Trapinch") that its name and
  // description do NOT mention
  const r = data.quests.records.find((x) => x.id === 'Z_A_ROYALE');
  assert.ok(r, 'fixture: the Z-A Royale quest is expected');
  assert.ok(/\{PKMN\}/.test(JSON.stringify([r.name, r.description, r.trigger, r.requirements, r.rewards])), 'fixture: the quest carries a {PKMN} token');
  const word = 'trapinch';
  assert.ok(!r.name.toLowerCase().includes(word) && !(r.description || '').toLowerCase().includes(word), 'fixture: the species name is absent from name/description');

  // ASSERT — the PALETTE finds it by the species name under EX, and the
  // EX-only quest stays absent under Vanilla
  assert.ok(rogue.searchQuery(entries, word, 'ex').results.some((e) => e.id === 'rec-quests-Z_A_ROYALE'), 'the palette must find the quest by "trapinch" under EX');
  assert.ok(
    !rogue.searchQuery(entries, word, 'vanilla').results.some((e) => e.id === 'rec-quests-Z_A_ROYALE'),
    'the EX-only quest must not surface under Vanilla'
  );

  // ASSERT — the ON-PAGE haystack (what quests.js writes into the card's
  // data-search) carries the same word, placeholder-resolved
  assert.ok(rogue.questSearchText(r).includes(word), 'the on-page data-search must carry "trapinch" (from the rewards)');
  assert.ok(rogue.questSearchText(r).includes('pok\u00e9mon'), 'the on-page data-search carries the resolved {PKMN} word');
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

test('the pokedex entries land on the Pokedex page with the shared on-page haystack (issue #50 parity)', () => {
  // ARRANGE — pokedex is a LAZY chunk: only pokedex.html loads it in the
  // browser, but this sandbox loads every data file (the full index). The
  // palette contract: every species record gets one entry that anchors at
  // the species detail panel's per-card id (issue #45) with the overview
  // section as the same-page fallback
  const byPokeId = (id) => byId.get('rec-pokedex-' + id);
  const pikachu = byPokeId('pikachu');
  assert.ok(pikachu, 'fixture: the Pikachu record is expected');
  assert.equal(pikachu.page, './pokedex.html', 'the palette entry deep-links the Pokedex page');
  assert.equal(pikachu.anchor, '#rec-pokedex-pikachu', 'the entry anchors at the species detail panel card id');
  assert.equal(pikachu.section, '#dex-overview', 'the containing overview section rides along as the same-page fallback');
  assert.deepEqual([...pikachu.versions], VERSIONS, 'Pikachu is a shared species');

  // ACT + ASSERT — a species name ranks its own card first (tier 0), and a
  // concrete MOVE name — absent from every species NAME — surfaces the
  // species that learn it (the learnset union made moves searchable)
  const byName = rogue.searchQuery(entries, 'pikachu', 'ex');
  assert.equal(byName.results[0].id, 'rec-pokedex-pikachu', '"pikachu" ranks the Pikachu species card first');
  assert.equal(byName.results[0].page, './pokedex.html');
  const byMove = rogue.searchQuery(entries, 'thunderbolt', 'ex');
  assert.ok(byMove.results.some((r) => r.id === 'rec-pokedex-rattata'), '"thunderbolt" surfaces a species that learns it (TM)');
  assert.ok(byMove.results.some((r) => r.id === 'rec-pokedex-pikachu'), '"thunderbolt" surfaces Pikachu');

  // ASSERT — an EX-only species (Turtwig) is scoped out under Vanilla, the
  // same query-time version scoping as the quests
  assert.equal(rogue.searchQuery(entries, 'turtwig', 'vanilla').total, 0, '"turtwig" (EX-only) must not surface under Vanilla');
  assert.equal(rogue.searchQuery(entries, 'turtwig', 'ex').results[0].id, 'rec-pokedex-turtwig');

  // ASSERT — the palette entry text IS ROGUE.pokedexSearchText for every
  // record (the issue-#50 on-page/palette parity for the dex)
  for (const r of data.pokedex.records) {
    const e = byId.get('rec-pokedex-' + r.id);
    assert.ok(e, `missing rec entry for ${r.id}`);
    assert.equal(e.text, rogue.pokedexSearchText(r), r.id + ': palette text must equal the on-page filter haystack');
  }
});

test('the #31 structured diagram fields are searchable (trimmed-but-rendered text)', () => {
  // ARRANGE — queries that are user-visible strings the #31 batch moved
  // into structured fields. The first four are absent from the owning
  // block/record's prose text (verified against data/*.json), so a hit
  // proves the structured field made it into the haystack:
  //   "gym bosses"           data/settings.json difficulty-scale
  //                          ladder.tiers[0].label (the ladder visual)
  //   "30 if shiny"          data/safari.json priority-eviction
  //                          score.terms[1].label (the chip equation)
  //   "mid-run — releasing"  data/safari.json entry-released `short`
  //                          (the entry-flow diagram essence)
  //   "spring"               data/hub.json time-weather-season
  //                          cycles.season.phases (the cycle strip)
  // "odd badge" is the exception: data/adventure.json
  // room-honey-tree's description already says "15 on odd badges", so
  // that hit is prose-sourced, while room-dark-deal and room-lab match
  // ONLY via the structured placement.bars[].l labels — the query still
  // proves the placement bars' conditions made it into the haystack
  // (2 of the 3 hits).
  const structured = [
    { q: 'gym bosses', id: 'prose-settings-difficulty-scale', page: './config.html', total: 1 },
    { q: '30 if shiny', id: 'rec-safari-priority-eviction', page: './safari.html', total: 1 },
    { q: 'mid-run \u2014 releasing', id: 'rec-safari-entry-released', page: './safari.html', total: 1 },
    { q: 'spring', id: 'prose-hub-time-weather-season', page: './hub.html', total: 18 },
    { q: 'odd badge', id: 'rec-adventure-room-honey-tree', page: './gameplay.html', total: 3 }
  ];

  // ACT — one query per structured string (EX scope)
  // ASSERT — each surfaces its structured entry at the page that renders
  // the diagram, with the exact result count from the real index
  for (const s of structured) {
    const hits = rogue.searchQuery(entries, s.q, 'ex').results;
    assert.equal(hits.length, s.total, `"${s.q}" under EX: ${s.total} result(s), derived from the real index`);
    const hit = hits.find((e) => e.id === s.id);
    assert.ok(hit, `"${s.q}" must surface ${s.id} (structured field text, absent from the prose)`);
    assert.equal(hit.page, s.page, `${s.id} deep-links to the page that renders the diagram`);
    // the fields are version-neutral — the same hit survives Vanilla scope
    assert.ok(
      rogue.searchQuery(entries, s.q, 'vanilla').results.some((e) => e.id === s.id),
      `"${s.q}" also surfaces ${s.id} under Vanilla (the structured field renders identically in both builds)`
    );
  }

  // ASSERT — "odd badge" end result: exactly the three parity-weighted
  // rooms, in index order (the bar conditions each render on the
  // gameplay placement diagram). [...] reconstructs the vm-realm array in
  // the host realm (the same deep-equality rule the other tests use).
  assert.deepEqual([...rogue.searchQuery(entries, 'odd badge', 'ex').results.map((e) => e.id)], [
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
  for (const e of underVanilla.results) assert.ok(e.versions.includes('vanilla'), `${e.id} leaked into vanilla results`);
  for (const e of underEx.results) assert.ok(e.versions.includes('ex'), `${e.id} leaked into ex results`);
  assert.ok(!underVanilla.results.some((e) => e.id === entryId), `the EX-only quest ${entryId} must not surface under vanilla`);
  assert.ok(underEx.results.some((e) => e.id === entryId), `the EX-only quest ${entryId} must surface under ex`);

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
    assert.ok(hits.results.some((e) => e.id === 'rec-quests-' + quest.id), `${quest.id} must match its vanilla-side wording under ${v}`);
  }
});

test('results rank title-starts before title-includes before body (before the fuzzy tier), stable within a tier', () => {
  // ARRANGE — a query (derived) hitting all three exact tiers without
  // exceeding the cap
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

  // ARRANGE — the fuzzy tier (issue #46) re-derived independently: the
  // query's folded tokens must be KNOWN words (present as whole tokens in
  // the index) so the unknown-word guard keeps tier 3 empty for this
  // query — the fuzzy tier itself is exercised by the dedicated tests
  const qTokens = tokensOf(query);
  const present = new Set();
  for (const e of entries) for (const t of tokensOf(fold(e.text))) present.add(t);
  assert.ok(qTokens.every((t) => present.has(t)), 'fixture: every query token is a known index word (no tier 3)');

  // ACT
  const res = rogue.searchQuery(entries, query, 'ex').results;

  // ASSERT — complete for this query (no cap), tiers in 0 < 1 < 2 < 3
  // order (tier 3 empty here), and each tier keeps the index order
  assert.equal(res.length, scoped.filter((e) => tierOf(e, query) >= 0).length);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].tier <= res[i].tier, `tier out of order at position ${i}`);
  for (const t of [0, 1, 2, 3]) {
    // [...] on both sides: results and entries live in the vm realm
    const expected = [...scoped.filter((e) => tierOf(e, query) === t).map((e) => e.id)];
    const got = [...res.filter((r) => r.tier === t).map((r) => r.id)];
    assert.deepEqual(got, expected, `tier ${t} must keep index order`);
  }
  // the fuzzy flag tracks the tier: no fuzzy rows for a known-word query
  for (const r of res) assert.equal(r.fuzzy, false, `${r.id}: a known-word query yields no fuzzy rows`);
});

test('typo queries (Levenshtein ≤ 1, folded) surface the relevant entries in the fuzzy tier 3 (issue #46)', () => {
  // ARRANGE — the expected set derived from the index itself: every
  // entry (scoped per version) whose folded text carries the whole token
  // "pokemon" — the word the typos are one edit away from. (One more
  // entry contains "pokemon" only inside a longer token —
  // rec-quests-Z_A_ROYALE's "uniquepokemon", more than 1 edit from every
  // typo — and stays out of the fuzzy tier.)
  const expected = (version) =>
    entries.filter((e) => e.versions.includes(version) && tokensOf(fold(e.text)).includes('pokemon'));

  // ACT + ASSERT — each typo: exactly the expected set (the pre-cap
  // total; the capped rows are its first maxResults in stable index
  // order), every result tier 3 + fuzzy-flagged, and the span folds to
  // a token exactly one edit from the query token
  const maxResults = data.site.search.maxResults;
  for (const typo of ['pokeman', 'pokmon', 'Pok\u00e9monn']) {
    const qTok = fold(typo);
    for (const version of VERSIONS) {
      const found = rogue.searchQuery(entries, typo, version);
      const exp = expected(version);
      assert.equal(found.total, exp.length, `${typo}/${version}: total is the pre-cap match count`);
      // [...] on both sides: the expected list lives in the vm realm
      assert.deepEqual(
        [...found.results.map((r) => r.id)],
        [...exp.slice(0, maxResults).map((e) => e.id)],
        `${typo}/${version}: the capped rows are the expected set's first ${maxResults} in index order`
      );
      for (const r of found.results) {
        assert.equal(r.tier, 3, `${typo}/${version}/${r.id}: fuzzy-only results rank in tier 3`);
        assert.equal(r.fuzzy, true, `${typo}/${version}/${r.id}: tier-3 results are fuzzy-flagged`);
        assert.ok(r.matchEnd > r.matchIndex && r.matchEnd <= r.text.length, `${typo}/${version}/${r.id}: fuzzy span in range`);
        const span = fold(r.textCase.slice(r.matchIndex, r.matchEnd));
        assert.equal(lev(qTok, span), 1, `${typo}/${version}/${r.id}: the span folds to a token one edit from the query token`);
      }
    }
  }

  // ASSERT — the two ASCII typos agree exactly (same candidate token,
  // same stable order) — the "same relevant results" the clean word finds
  assert.deepEqual(
    [...rogue.searchQuery(entries, 'pokeman', 'ex').results.map((r) => r.id)],
    [...rogue.searchQuery(entries, 'pokmon', 'ex').results.map((r) => r.id)],
    'pokeman and pokmon surface the identical relevant set, in order'
  );

  // ASSERT — nonsense beyond distance 1 matches nothing (no tier 3)
  for (const noise of ['zzqxwvnotthere', 'zzzzqqqq']) {
    for (const version of VERSIONS) {
      const found = rogue.searchQuery(entries, noise, version);
      assert.equal(found.total, 0, `${noise}/${version}: no tier-3 match beyond distance 1`);
    }
  }
});

test('exact matches for the same root word rank strictly before fuzzy-only ones (tiers 0<1<2<3, issue #46)', () => {
  // ARRANGE — the clean word "pokemon" (exact tiers) vs the typo
  // "pokeman" (fuzzy tier): same root, same relevant entries — the
  // exact query fills tiers 0–2, the typo's matches all sit in tier 3,
  // after every exact match of the clean word.
  const exact = rogue.searchQuery(entries, 'pokemon', 'ex');
  const fuzzy = rogue.searchQuery(entries, 'pokeman', 'ex');

  // ASSERT — the exact query: tiers 0/1/2 only (the unknown-word guard
  // keeps a known word out of tier 3), fuzzy flag off, monotone order
  assert.ok(exact.total > exact.results.length, 'fixture: the exact query overflows the cap');
  assert.ok(exact.results.some((r) => r.tier === 0) && exact.results.some((r) => r.tier === 1) && exact.results.some((r) => r.tier === 2),
    'fixture: the exact query fills all three exact tiers');
  for (const r of exact.results) {
    assert.ok(r.tier <= 2, `${r.id}: a known word never gains tier-3 rows (unknown-word guard)`);
    assert.equal(r.fuzzy, false, r.id);
  }
  for (let i = 1; i < exact.results.length; i++) assert.ok(exact.results[i - 1].tier <= exact.results[i].tier, 'exact tiers stay in 0 < 1 < 2 order');

  // ASSERT — the typo query: every result tier 3 (after every exact
  // tier), and the typo returns the same relevant set minus the one
  // entry where the word is embedded in a longer token (> 1 edit away)
  for (const r of fuzzy.results) assert.equal(r.tier, 3, `${r.id}: the typo's matches rank in tier 3, after every exact match`);
  assert.equal(fuzzy.total, exact.total - 1, 'the typo returns every relevant entry except the one with the word embedded in a longer token');
});

test('exact and fuzzy rows for one root word: the exact row ranks first in one result list (tier order 0<1<2<3, issue #46)', () => {
  // ARRANGE — a minimal synthetic index of PLAIN entries (no precomputed
  // fuzzy fields — searchQuery derives them, so the fixture pins the
  // query contract, not the build): one entry matches the query as an
  // exact SUBSTRING inside a longer word ("pokemans" carries "pokeman"
  // without making it a whole token, so the unknown-word guard stays
  // active), one matches only at Levenshtein 1 ("pokemon" vs "pokeman")
  const mk = (id, text) => ({
    id,
    title: id,
    titleLower: id.toLowerCase(),
    text: text.toLowerCase(),
    textCase: text,
    page: './index.html',
    anchor: '',
    versions: ['vanilla', 'ex']
  });
  const exactEntry = mk('exact-hit', 'the pokemans gather');
  const fuzzyEntry = mk('fuzzy-hit', 'many pokemon around');

  // ACT
  const mixed = rogue.searchQuery([exactEntry, fuzzyEntry], 'pokeman', 'ex');

  // ASSERT — the exact-substring entry (tier 2) ranks BEFORE the
  // fuzzy-only one (tier 3) in the same result list
  assert.deepEqual([...mixed.results.map((r) => r.id)], ['exact-hit', 'fuzzy-hit'], 'exact tier 2 before fuzzy tier 3');
  assert.deepEqual([...mixed.results.map((r) => r.tier)], [2, 3]);
  assert.deepEqual([...mixed.results.map((r) => r.fuzzy)], [false, true]);
  const f = mixed.results[1];
  assert.equal(f.textCase.slice(f.matchIndex, f.matchEnd), 'pokemon', 'fuzzy matchIndex/matchEnd point at the aligned token occurrence');
  // and a nonsense token (no distance-1 neighbour in this index) matches nothing
  assert.equal(rogue.searchQuery([exactEntry, fuzzyEntry], 'zzzqq', 'ex').total, 0, 'no tier-3 match for a token with no neighbour');
});

test('fuzzy matching is accent-insensitive: fold first, then distance (issue #46)', () => {
  // ARRANGE — "Pokémon" (exact after folding) vs "Pokémonn" (one edit
  // after folding) vs "Pokémann" (two edits — beyond distance 1)
  const exact = rogue.searchQuery(entries, 'Pok\u00e9mon', 'ex');
  const typo1 = rogue.searchQuery(entries, 'Pok\u00e9monn', 'ex');
  const typo2 = rogue.searchQuery(entries, 'Pok\u00e9mann', 'ex');

  // ASSERT — the clean accented word stays exact (no tier 3 for a known
  // word), the one-edit accented typo is fully fuzzy and identical to
  // its unaccented twin, the two-edit one matches nothing
  for (const r of exact.results) assert.equal(r.fuzzy, false, `${r.id}: the clean accented word is exact-only`);
  assert.equal(typo2.total, 0, '"Pokémann" is two edits from "pokemon" — beyond distance 1');
  assert.deepEqual(
    [...typo1.results.map((r) => r.id)],
    [...rogue.searchQuery(entries, 'pokmon', 'ex').results.map((r) => r.id)],
    'the accented typo folds to the same candidate as the unaccented one'
  );
  for (const r of typo1.results) assert.equal(r.tier, 3, `${r.id}: the accented typo ranks in tier 3`);

  // ASSERT — the fuzzy span centres on the ACCENTED word in the
  // original casing (the snippet stays original-cased around it)
  assert.ok(
    typo1.results.some((r) => r.textCase.slice(r.matchIndex, r.matchEnd) === 'Pok\u00e9mon'),
    'a capped fuzzy result centres its span on the accented "Pokémon"'
  );
});

test('version scoping applies to the fuzzy tier (issue #46)', () => {
  // ARRANGE — the typo query under both versions; the EX-only entries
  // carrying the "pokemon" token (derived from the index)
  const underEx = rogue.searchQuery(entries, 'pokmon', 'ex');
  const underVanilla = rogue.searchQuery(entries, 'pokmon', 'vanilla');
  const exOnlyCount = entries.filter((e) => e.versions.length === 1 && e.versions[0] === 'ex' && tokensOf(fold(e.text)).includes('pokemon')).length;
  assert.ok(exOnlyCount > 0, 'fixture: some EX-only entries carry the "pokemon" token');

  // ASSERT — no entry leaks outside its versions; exactly the EX-only
  // "pokemon" entries drop the Vanilla-scoped total; deterministic
  for (const r of underVanilla.results) assert.ok(r.versions.includes('vanilla'), `${r.id} leaked into vanilla fuzzy results`);
  assert.equal(underVanilla.total, underEx.total - exOnlyCount, 'exactly the EX-only "pokemon" entries drop out under Vanilla');
  assert.deepEqual(rogue.searchQuery(entries, 'pokmon', 'vanilla'), underVanilla, 'the fuzzy query is deterministic');
});

test('known words never gain fuzzy matches (the unknown-word guard, issue #46)', () => {
  // ARRANGE — words the index actually contains: their distance-1
  // neighbours ("mega"→"meta", "spring"→"string") must NOT count, or
  // every broad query would flood tier 3 and break the pinned counts
  const pinned = [
    ['mega evolution', 5], // the screenshot literal (EX, pokedex page; 4 on the pages without the lazy chunk)
    ['the final run', 2],
    ['spring', 18] // the 5 pre-pokedex hits + 13 pokedex species with spring-season dex text
  ];

  // ACT + ASSERT — each stays at its pinned exact count, fuzzy-free
  for (const [query, expected] of pinned) {
    const found = rogue.searchQuery(entries, query, 'ex');
    assert.equal(found.total, expected, `"${query}" under EX stays at its pinned exact count`);
    for (const r of found.results) assert.equal(r.fuzzy, false, `"${query}"/${r.id}: a known-word query yields no fuzzy rows`);
  }

  // ASSERT — "meta" is one edit from "mega", but the "meta" entries
  // (prose-hub-hub-in-the-loop) never surface for it
  assert.ok(
    !rogue.searchQuery(entries, 'mega', 'ex').results.some((r) => r.id === 'prose-hub-hub-in-the-loop'),
    '"mega" must not pull in the "meta" entries'
  );
});

test('results are capped at search.maxResults (total carries the pre-cap count) and matchIndex points at a real occurrence', () => {
  // ARRANGE — a query with far more matches than the cap
  const maxResults = data.site.search.maxResults;
  const query = 'the';
  const q = fold(query);
  const totalMatches = entries.filter((e) => e.versions.includes('ex') && fold(e.text).includes(q)).length;
  assert.ok(totalMatches > maxResults, `fixture: "${query}" must overflow the cap of ${maxResults}`);

  // ACT
  const found = rogue.searchQuery(entries, query, 'ex');
  const res = found.results;

  // ASSERT — exactly the cap, and the pre-cap total is the full match count
  assert.equal(res.length, maxResults);
  assert.equal(found.total, totalMatches, `"${query}": total must be the pre-cap match count`);
  for (const r of res) {
    assert.ok(r.matchIndex >= 0 && r.matchIndex + q.length <= r.text.length, `${r.id}: matchIndex out of range`);
    assert.ok(
      fold(r.text.slice(r.matchIndex, r.matchIndex + q.length)).startsWith(q),
      `${r.id}: text.slice(matchIndex, +${q.length}) must start with the folded query`
    );
    // the original-case parallel slices at the same span: the highlight
    // span [matchIndex, matchEnd) folds to exactly the query
    assert.ok(r.matchEnd > r.matchIndex && r.matchEnd <= r.textCase.length, `${r.id}: matchEnd out of range`);
    assert.equal(fold(r.textCase.slice(r.matchIndex, r.matchEnd)), q, `${r.id}: textCase.slice(matchIndex, matchEnd) must fold to the query`);
  }
});

test('accented queries keep matchIndex/matchEnd aligned with the original-case textCase', () => {
  // ARRANGE — "Pokémon" (data/quests.json {PKMN} resolution + hub upgrade
  // names): a folded query ("pokemon") that matches the accented
  // original-case text. Fixture: at least one capped result per version
  // highlights the accented word itself
  const q = fold('Pokémon');
  const accentedAtMatch = (version) =>
    rogue.searchQuery(entries, 'Pokémon', version).results.some(
      (r) => r.textCase.slice(r.matchIndex, r.matchIndex + q.length) === 'Pokémon'
    );
  assert.ok(accentedAtMatch('ex'), 'fixture: at least one capped EX result highlights the accented "Pokémon"');
  assert.ok(accentedAtMatch('vanilla'), 'fixture: at least one capped Vanilla result highlights the accented "Pokémon"');

  // ACT + ASSERT — for every capped result under both versions, the
  // original-case slice at [matchIndex, matchEnd) folds to the exact
  // folded query (no off-by-one, accents intact)
  for (const version of VERSIONS) {
    for (const r of rogue.searchQuery(entries, 'Pokémon', version).results) {
      assert.ok(r.matchEnd > r.matchIndex && r.matchEnd <= r.textCase.length, `${version}/${r.id}: matchEnd out of range`);
      assert.equal(fold(r.textCase.slice(r.matchIndex, r.matchEnd)), q, `${version}/${r.id}: the highlighted original-case span must fold to the query`);
      assert.equal(fold(r.text.slice(r.matchIndex, r.matchEnd)), q, `${version}/${r.id}: the same span in the lowercased text must fold to the query`);
    }
  }
});

test('searchQuery reports the pre-cap total alongside the capped results', () => {
  // ARRANGE — a broad query with far more matches than the cap and a
  // narrow one that stays within it (both against the real index)
  const maxResults = data.site.search.maxResults;
  const totalMatches = (query, version) =>
    entries.filter((e) => e.versions.includes(version) && fold(e.text).includes(fold(query))).length;
  assert.ok(totalMatches('masteries', 'ex') > maxResults, 'fixture: "masteries" must overflow the cap under EX');
  assert.ok(totalMatches('mega evolution', 'ex') <= maxResults, 'fixture: "mega evolution" must stay within the cap');

  // ACT + ASSERT — the broad query: the list stays capped, and total is the
  // full pre-cap match count (the UI can distinguish "30 of 135" from "30 of 30")
  const broad = rogue.searchQuery(entries, 'masteries', 'ex');
  assert.equal(broad.results.length, maxResults, '"masteries": the list stays capped at search.maxResults');
  assert.equal(broad.total, totalMatches('masteries', 'ex'), '"masteries": total is the pre-cap match count');
  assert.ok(broad.total > broad.results.length, '"masteries": total must exceed the rows shown');

  // ACT + ASSERT — the narrow query: no overflow — total === rows shown
  const narrow = rogue.searchQuery(entries, 'mega evolution', 'ex');
  assert.equal(narrow.total, totalMatches('mega evolution', 'ex'), '"mega evolution": total matches the real index');
  assert.equal(narrow.results.length, narrow.total, '"mega evolution": uncapped — every match is shown');
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

/**
 * End-to-end tests for the docs site (node --test, no mocks, no deps).
 *
 * (1) The build: runs `node scripts/build.mjs` as a child process, asserts
 *     exit 0, that dist/index.html exists, and that every current data file's
 *     ROGUE_DATA_<ID> global is referenced by dist/data/bundle.js — except
 *     the meta.lazy files, whose global must instead be defined by their own
 *     dist/data/<stem>.js chunk and be absent from bundle.js.
 * (2) The bundle: executes dist/data/bundle.js in a vm sandbox with a fake
 *     `window` and asserts every ROGUE_DATA_<ID> global is actually defined
 *     (catches bundle output that is not valid JavaScript, e.g. hyphenated
 *     meta.ids emitted as bare property assignments) — and that the bundle
 *     defines exactly the non-lazy data files' globals (one window key per
 *     file), while every meta.lazy file's global comes from its own
 *     dist/data/<stem>.js chunk (executed in the same sandbox) and appears
 *     nowhere in bundle.js's code. The counts are derived from the data
 *     files on disk, so the suite passes before and after lazy files land.
 * (3) The served site: serves dist/ over node:http on an ephemeral port and
 *     asserts every content page — index, gameplay, versions, quests, config,
 *     hub, safari, routes, pokedex, mechanics and the 404 fallback — returns 200 with
 *     its page-specific static marker strings (titles from data/site.json),
 *     that every one of the 11 pages wires in the search overlay scripts
 *     (search-index.js before search.js, both after main.js), that the served
 *     sitemap.xml is well-formed XML listing exactly the ten nav pages with
 *     the site.json site.url base (no 404.html), that robots.txt allows all
 *     and references the sitemap, that every nav page's static og:title /
 *     og:description / og:url match its site.json `pages` entry (404.html
 *     carries none — it is not indexable), and that the internal design
 *     contract site/css/DESIGN.md is NOT published (404), that the
 *     self-hosted font assets (site/fonts/ — issue #49) ship in dist and
 *     serve 200 while no page references the Google Fonts CDN, and that
 *     the vendored three.js (site/vendor/ — issue #79) ships in
 *     dist/vendor/ and serves 200 while no page references any CDN host
 *     (jsdelivr / unpkg / cdnjs / Google Fonts) or statically references
 *     the vendored script (it is deferred-injected at run time only).
 * (4) The poisoned build: a temp copy of the repo's build inputs with one
 *     data file whose meta.id breaks out of the window["..."] global-name
 *     interpolation must fail the build (naming the offending file) instead
 *     of emitting injectable JavaScript into bundle.js — and a second
 *     poisoned build in which a meta.lazy data file's stem collides with a
 *     fixed build output (bundle) must fail the build (naming the file)
 *     instead of clobbering dist/data/bundle.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './helpers/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

let server;
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('build exits 0 and bundles every data file', () => {
  // ARRANGE
  const dataFiles = readdirSync(path.join(root, 'data'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  assert.ok(dataFiles.length >= 1, 'expected at least one data file in data/');

  // ACT
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });

  // ASSERT
  assert.equal(result.status, 0, `build exited non-zero:\n${result.stdout}\n${result.stderr}`);
  assert.ok(existsSync(path.join(distDir, 'index.html')), 'dist/index.html is missing after build');
  const bundle = readFileSync(path.join(distDir, 'data', 'bundle.js'), 'utf8');
  for (const file of dataFiles) {
    const data = JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8'));
    const key = `ROGUE_DATA_${String(data.meta.id).toUpperCase()}`;
    if (data.meta.lazy === true) {
      // lazy files ship as their own chunk next to the bundle, never in it
      const stem = file.replace(/\.json$/, '');
      const chunk = readFileSync(path.join(distDir, 'data', `${stem}.js`), 'utf8');
      assert.ok(chunk.includes(key), `dist/data/${stem}.js is missing ${key} for data/${file}`);
      assert.ok(!bundle.includes(key), `bundle.js must not define ${key} for lazy data/${file}`);
    } else {
      assert.ok(bundle.includes(key), `bundle.js is missing ${key} for data/${file}`);
    }
  }
});

test('concurrent builds never expose a missing or half-written dist/', async () => {
  // ARRANGE — the build test above leaves dist/ in place; this mirrors the
  // CI condition where the e2e serve tests and the ui suites' builds hit
  // dist/ at the same time a fresh build is swapping it in
  const indexFile = path.join(distDir, 'index.html');
  assert.ok(existsSync(indexFile), 'dist/index.html must exist before the concurrent builds');
  const server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;

  try {
    // ACT — 6 concurrent builds while the main thread hammers the live
    // server; every response must be a complete 200 (a directory swap —
    // rm + rename, or even a park + rename double rename — leaves dist/
    // missing between the syscalls; the in-place per-file publish must not)
    const children = [];
    const exits = [];
    for (let i = 0; i < 6; i += 1) {
      const child = spawn(process.execPath, ['scripts/build.mjs'], { cwd: root });
      children.push(child);
      child.on('close', (code) => exits.push(code));
    }
    const badStatus = [];
    const t0 = Date.now();
    while (exits.length < children.length) {
      try {
        const res = await fetch(url);
        if (res.status !== 200) {
          badStatus.push(res.status);
          await res.body?.cancel();
        } else {
          await res.body?.cancel();
        }
      } catch {
        badStatus.push('error');
      }
      if (Date.now() - t0 > 60_000) break; // backstop: never hang the suite
    }

    // ASSERT
    assert.ok(exits.length === children.length, 'all builds must finish');
    for (const code of exits) assert.equal(code, 0, `a concurrent build exited ${code}`);
    assert.equal(badStatus.length, 0, `GET /index.html was not 200 during concurrent builds: ${badStatus.slice(0, 5).join(', ')} (${badStatus.length} bad)`);
    assert.ok(existsSync(indexFile), 'dist/index.html must exist after the concurrent builds');
    // the publish leaves no temp residue behind
    const residue = readdirSync(root).filter((f) => f.startsWith('dist.tmp-'));
    assert.deepEqual(residue, [], `build residue left in the repo root: ${residue.join(', ')}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bundle.js is valid JavaScript and defines every ROGUE_DATA_ global', () => {
  // ARRANGE — dist/ is produced by the build test above; the data files are
  // derived from disk and split by meta.lazy (the lazy set may be empty —
  // the assertions hold either way)
  const files = readdirSync(path.join(root, 'data'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const dataFiles = files.map((file) => ({
    file,
    stem: file.replace(/\.json$/, ''),
    data: JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8')),
  }));
  const nonLazy = dataFiles.filter(({ data }) => data.meta.lazy !== true);
  const lazy = dataFiles.filter(({ data }) => data.meta.lazy === true);
  const code = readFileSync(path.join(distDir, 'data', 'bundle.js'), 'utf8');

  // ACT — execute the bundle with a fake `window`, then every lazy chunk in
  // the same sandbox
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'bundle.js' });
  const bundleKeys = Object.keys(sandbox.window).sort();
  for (const { stem } of lazy) {
    vm.runInNewContext(readFileSync(path.join(distDir, 'data', `${stem}.js`), 'utf8'), sandbox, {
      filename: `${stem}.js`,
    });
  }

  // ASSERT — the bundle defines exactly the non-lazy data files' globals, no
  // others (a lazy file that leaked into the bundle would fail this)
  assert.deepEqual(
    bundleKeys,
    nonLazy.map(({ data }) => `ROGUE_DATA_${String(data.meta.id).toUpperCase()}`).sort(),
    'bundle.js must define exactly the non-lazy data files\' ROGUE_DATA_* globals',
  );
  for (const { data } of nonLazy) {
    const key = `ROGUE_DATA_${String(data.meta.id).toUpperCase()}`;
    assert.ok(sandbox.window[key], `bundle.js did not define window["${key}"]`);
    assert.equal(sandbox.window[key].meta.id, data.meta.id, `window["${key}"] has the wrong meta.id`);
  }

  // ASSERT — in total (bundle + lazy chunks) there is exactly one window key
  // per data file, each lazy chunk's global round-trips to its own meta.id,
  // and no lazy global appears anywhere in bundle.js's code
  assert.equal(
    Object.keys(sandbox.window).length,
    dataFiles.length,
    'bundle + lazy chunks must define exactly one window key per data file',
  );
  for (const { data, stem } of lazy) {
    const key = `ROGUE_DATA_${String(data.meta.id).toUpperCase()}`;
    assert.ok(sandbox.window[key], `dist/data/${stem}.js did not define window["${key}"]`);
    assert.equal(sandbox.window[key].meta.id, data.meta.id, `window["${key}"] has the wrong meta.id`);
    assert.ok(!code.includes(key), `bundle.js's code must not contain ${key} (lazy data/${stem}.json)`);
  }
});

// Banned-phrase hygiene lists shared by the adventure guard and the
// all-files scan. The phrases are wrong per-run placement/goal claims that
// leaked into user-facing prose before; "victory lap" is a post-Champion
// spoiler; "Pokabbie" is the developer name that must not appear in prose.
const bannedPhrases = [
  'one per run',
  'exactly one is placed per run',
  'the more you land, the better the reward',
  'useful for grinding experience',
  "try to pocket an item you haven't earned",
  'dropping to 1 after four',
  'the whole run is den-hopping',
];
// "Victory Lap" / "Final Battle (Badge 13)" are allowed as ladder labels in
// record names, and "source" fields are citations — so "victory lap" is
// banned in descriptions only.
const bannedInDescriptions = ['victory lap'];
// Banned in every user-facing record field (name, description) and in all
// free prose. "source" fields are exempt: they are citations quoting game
// code (file paths, constants) that legitimately contains the name.
const bannedAnywhere = ['Pokabbie'];
// meta.description and the prose blocks (both touched by the same passes as
// the records) are free prose — every phrase above applies there (no
// record-name or citation exemptions).
const bannedInProse = [...bannedPhrases, ...bannedInDescriptions, ...bannedAnywhere];

/**
 * Scan one data file's records, meta.description and prose blocks for the
 * banned phrases, case-insensitively. Exemptions, applied by field name
 * wherever the field exists: record `name` (ladder labels) skips
 * bannedPhrases and bannedInDescriptions; record `source` (citations)
 * skips bannedInDescriptions and bannedAnywhere, but still carries
 * bannedPhrases (its parentheticals are site-authored). Returns
 * { hits, proseHits }, each entry naming file, record id, field and phrase.
 */
function scanDataFile(file, data) {
  const hits = [];
  const lower = (value) => String(value ?? '').toLowerCase();
  if (Array.isArray(data.records)) {
    for (const record of data.records) {
      for (const field of ['description', 'source']) {
        const text = lower(record[field]);
        for (const phrase of bannedPhrases) {
          if (text.includes(phrase.toLowerCase())) {
            hits.push(`data/${file} record ${record.id} field ${field} contains "${phrase}"`);
          }
        }
      }
      // The placement strings are rendered free text (not names or
      // citations), so every phrase list applies to them.
      if (record.placement && typeof record.placement === 'object') {
        const placementTexts = [record.placement.note].concat(
          (Array.isArray(record.placement.bars) ? record.placement.bars : []).map((bar) => [bar && bar.t, bar && bar.l]).flat()
        );
        for (const raw of placementTexts) {
          const text = lower(raw);
          if (!text) continue;
          for (const phrase of bannedInProse) {
            if (text.includes(phrase.toLowerCase())) {
              hits.push(`data/${file} record ${record.id} field placement contains "${phrase}"`);
            }
          }
        }
      }
      const description = lower(record.description);
      for (const phrase of bannedInDescriptions) {
        if (description.includes(phrase)) {
          hits.push(`data/${file} record ${record.id} field description contains "${phrase}"`);
        }
      }
      for (const field of ['name', 'description']) {
        const text = lower(record[field]);
        for (const phrase of bannedAnywhere) {
          if (text.includes(phrase.toLowerCase())) {
            hits.push(`data/${file} record ${record.id} field ${field} contains "${phrase}"`);
          }
        }
      }
    }
  }
  // ACT (cont.) — meta.description and every prose block are free prose
  const proseHits = [];
  const proseTargets = [['meta.description', data.meta && data.meta.description]];
  for (const block of Array.isArray(data.prose) ? data.prose : []) {
    proseTargets.push([`prose:${block.id}`, block.text]);
  }
  for (const [where, raw] of proseTargets) {
    const text = lower(raw);
    for (const phrase of bannedInProse) {
      if (text.includes(phrase.toLowerCase())) proseHits.push(`data/${file} ${where} contains "${phrase}"`);
    }
  }
  return { hits, proseHits };
}

test('adventure.json makes no wrong per-run placement or goal claims (records, meta description and prose)', () => {
  // ARRANGE — the room-type/boss records in data/adventure.json
  const adventure = JSON.parse(readFileSync(path.join(root, 'data', 'adventure.json'), 'utf8'));

  // ACT — scan every record's description, source and rendered `placement`
  // strings (the note + bar labels/conds the gameplay placement bars
  // display), meta.description and every prose block, case-insensitively
  const { hits, proseHits } = scanDataFile('adventure.json', adventure);

  // ASSERT — the flagged wrong-claim phrases must all be gone (records and prose)
  assert.deepEqual(hits, [], `wrong-claim phrases still present:\n  ${hits.join('\n  ')}`);
  assert.deepEqual(proseHits, [], `wrong-claim phrases in meta description or prose:\n  ${proseHits.join('\n  ')}`);
});

test('every content data file makes no wrong placement/goal claims or name leaks (records, meta description and prose)', () => {
  // ARRANGE — every content data file on disk (site.json is the site config,
  // not content, and carries no records); the set is derived from data/, so
  // new (lazy or not) content files are scanned automatically
  const files = readdirSync(path.join(root, 'data'))
    .filter((f) => f.endsWith('.json') && f !== 'site.json')
    .sort();
  assert.ok(files.length >= 1, 'expected at least one content data file in data/');

  // ACT + ASSERT — the shared hygiene scan finds no hit in any file, and
  // each failure names the file, record id, field and offending phrase
  for (const file of files) {
    const data = JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8'));
    const { hits, proseHits } = scanDataFile(file, data);
    assert.deepEqual(hits, [], `banned phrases still present in data/${file}:\n  ${hits.join('\n  ')}`);
    assert.deepEqual(proseHits, [], `banned phrases in meta description or prose of data/${file}:\n  ${proseHits.join('\n  ')}`);
  }
});

test('a banned phrase in a data file is flagged with file, record id, field and phrase', () => {
  // ARRANGE — a minimal poisoned record shaped like a routes.json record
  const poisoned = {
    meta: { id: 'routes', description: '' },
    prose: [],
    records: [{ id: 'hoenn-field-0', name: 'Route 1', description: 'Meet Pokabbie on the route.', source: 'src/rogue_routes.h @vanilla L1-2' }],
  };

  // ACT
  const { hits } = scanDataFile('routes.json', poisoned);

  // ASSERT — the hit names the file, record, field and the offending phrase
  assert.deepEqual(hits, ['data/routes.json record hoenn-field-0 field description contains "Pokabbie"']);
});

test('served index page returns 200 and contains the hero marker from site.json', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/index.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /index.html returned ${res.status}`);
    assert.ok(body.includes(site.hero.title), 'index.html is missing the hero title marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served gameplay page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/gameplay.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /gameplay.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.gameplay.title),
      'gameplay.html is missing the page title marker'
    );
    assert.ok(body.includes('Safari'), 'gameplay.html is missing the "Safari" marker');
    assert.ok(body.includes('Boss'), 'gameplay.html is missing the "Boss" marker');
    assert.ok(body.includes('Champion'), 'gameplay.html is missing the "Champion" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served versions page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/versions.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /versions.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.versions.title),
      'versions.html is missing the page title marker'
    );
    assert.ok(body.includes('Vanilla'), 'versions.html is missing the "Vanilla" marker');
    assert.ok(body.includes('EX'), 'versions.html is missing the "EX" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served quests page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/quests.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /quests.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.quests.title),
      'quests.html is missing the page title marker'
    );
    assert.ok(body.includes('Challenges'), 'quests.html is missing the "Challenges" marker');
    assert.ok(body.includes('Mastery'), 'quests.html is missing the "Mastery" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served config page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/config.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /config.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.config.title),
      'config.html is missing the page title marker'
    );
    assert.ok(body.includes('Fast Path'), 'config.html is missing the "Fast Path" marker');
    assert.ok(body.includes('Rainbow'), 'config.html is missing the "Rainbow" marker');
    assert.ok(body.includes('Gauntlet'), 'config.html is missing the "Gauntlet" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served hub page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/hub.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /hub.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.hub.title),
      'hub.html is missing the page title marker'
    );
    assert.ok(body.includes('Upgrades'), 'hub.html is missing the "Upgrades" marker');
    assert.ok(body.includes('Build Parts'), 'hub.html is missing the "Build Parts" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served safari page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/safari.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /safari.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.safari.title),
      'safari.html is missing the page title marker'
    );
    assert.ok(body.includes('Pok\u00e9block'), 'safari.html is missing the "Pok\u00e9block" marker');
    assert.ok(body.includes('Legends Cave'), 'safari.html is missing the "Legends Cave" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served routes page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/routes.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /routes.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.routes.title),
      'routes.html is missing the page title marker'
    );
    assert.ok(body.includes('Wild'), 'routes.html is missing the "Wild" marker');
    assert.ok(body.includes('Forest'), 'routes.html is missing the "Forest" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served pokedex page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/pokedex.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /pokedex.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.pokedex.title),
      'pokedex.html is missing the page title marker'
    );
    assert.ok(body.includes('evolution'), 'pokedex.html is missing the "evolution" marker');
    assert.ok(body.includes('species'), 'pokedex.html is missing the "species" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served mechanics page returns 200 and contains its static markers', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/mechanics.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /mechanics.html returned ${res.status}`);
    assert.ok(
      body.includes(site.pages.mechanics.title),
      'mechanics.html is missing the page title marker'
    );
    assert.ok(body.includes('Charm'), 'mechanics.html is missing the "Charm" marker');
    assert.ok(body.includes('Curse'), 'mechanics.html is missing the "Curse" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served sitemap.xml is well-formed and lists every nav page with the site.json base URL', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  const base = site.site.url.replace(/\/+$/, '');
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${origin}/sitemap.xml`);
    const body = await res.text();

    // ASSERT — 200, well-formed (declaration, single urlset, exactly one
    // <url> block per nav page, closed), correct base URLs, no 404.html
    assert.equal(res.status, 200, `GET /sitemap.xml returned ${res.status}`);
    assert.ok(
      body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'),
      'sitemap.xml is missing its XML declaration'
    );
    assert.ok(
      body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
      'sitemap.xml is missing its urlset element'
    );
    assert.equal(
      body.split('<url>').length - 1,
      site.nav.length,
      `sitemap.xml must open exactly one <url> per nav page (found ${body.split('<url>').length - 1}, expected ${site.nav.length})`
    );
    assert.equal(
      body.split('</url>').length - 1,
      site.nav.length,
      `sitemap.xml must close exactly one </url> per nav page (found ${body.split('</url>').length - 1}, expected ${site.nav.length})`
    );
    for (const id of site.nav) {
      assert.ok(
        body.includes(`<loc>${base}/${id}.html</loc>`),
        `sitemap.xml is missing <loc>${base}/${id}.html</loc>`
      );
    }
    assert.ok(!body.includes('404.html'), 'sitemap.xml must not list the 404 fallback');
    assert.ok(body.trimEnd().endsWith('</urlset>'), 'sitemap.xml must end with </urlset>');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('served robots.txt allows all crawlers and references the sitemap', async () => {
  // ARRANGE
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  const base = site.site.url.replace(/\/+$/, '');
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${origin}/robots.txt`);
    const body = await res.text();

    // ASSERT — 200, allow-all, and an absolute Sitemap: line at the site base
    assert.equal(res.status, 200, `GET /robots.txt returned ${res.status}`);
    assert.ok(body.includes('User-agent: *'), 'robots.txt is missing the User-agent: * line');
    assert.ok(body.includes('Allow: /'), 'robots.txt is missing the Allow: / line');
    assert.ok(
      body.includes(`Sitemap: ${base}/sitemap.xml`),
      `robots.txt must reference the absolute sitemap URL (${base}/sitemap.xml)`
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('every served nav page exposes og:title/og:description/og:url matching its site.json pages entry', async () => {
  // ARRANGE — the same strings main.js uses for the JS-on document title
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  const base = site.site.url.replace(/\/+$/, '');
  const name = site.site.name;
  const esc = (value) =>
    String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT — fetch every nav page (static <head> is what crawlers without JS see)
    for (const id of site.nav) {
      const page = site.pages[id];
      const res = await fetch(`${origin}/${id}.html`);
      const body = await res.text();

      // ASSERT — 200 and all three og: tags match the site.json pages entry
      // (og:title = the JS-on title main.js sets: page title + site name)
      assert.equal(res.status, 200, `GET /${id}.html returned ${res.status}`);
      assert.ok(
        body.includes(`<meta property="og:title" content="${esc(`${page.title} · ${name}`)}">`),
        `${id}.html og:title must match its site.json pages entry (${JSON.stringify(page.title)})`
      );
      assert.ok(
        body.includes(`<meta property="og:description" content="${esc(page.description)}">`),
        `${id}.html og:description must match its site.json pages entry`
      );
      assert.ok(
        body.includes(`<meta property="og:url" content="${base}/${id}.html">`),
        `${id}.html og:url must be the absolute URL under the site.json base`
      );
    }

    // ASSERT — the 404 fallback is not indexable: no og: tags at all
    const res = await fetch(`${origin}/404.html`);
    const body = await res.text();
    assert.equal(res.status, 200, `GET /404.html returned ${res.status}`);
    assert.ok(!body.includes('og:'), '404.html must not carry og: meta tags');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('built dist does not publish the internal design contract site/css/DESIGN.md', async () => {
  // ARRANGE — the build test above produced dist/; DESIGN.md stays in the
  // repo (referenced by AGENTS.md and the CSS sheets) but must not be copied
  assert.ok(existsSync(path.join(root, 'site', 'css', 'DESIGN.md')), 'site/css/DESIGN.md must remain in the repo');
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/css/DESIGN.md`);

    // ASSERT — the built dist must not serve it
    assert.equal(res.status, 404, `GET /css/DESIGN.md returned ${res.status} (the internal design contract must not be published)`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('self-hosted font assets ship in dist and no page references the Google Fonts CDN', async () => {
  // ARRANGE — the 8 vendored woff2 files (IBM Plex Sans + Pixelify Sans,
  // 400/500/600/700 each, issue #49) plus the two OFL license files; the
  // @font-face rules that point at them live in the first sheet
  const woff2Files = [
    'ibm-plex-sans-400.woff2',
    'ibm-plex-sans-500.woff2',
    'ibm-plex-sans-600.woff2',
    'ibm-plex-sans-700.woff2',
    'pixelify-sans-400.woff2',
    'pixelify-sans-500.woff2',
    'pixelify-sans-600.woff2',
    'pixelify-sans-700.woff2',
  ];
  const pages = [
    'index.html',
    'gameplay.html',
    'versions.html',
    'quests.html',
    'config.html',
    'hub.html',
    'safari.html',
    'routes.html',
    'pokedex.html',
    'mechanics.html',
    '404.html',
  ];
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT — fetch every font asset, the tokens sheet, and every page
    for (const file of [...woff2Files, 'OFL-ibm-plex-sans.txt', 'OFL-pixelify-sans.txt']) {
      const res = await fetch(`${base}/fonts/${file}`);
      assert.equal(res.status, 200, `GET /fonts/${file} returned ${res.status} (self-hosted font assets must ship in dist)`);
    }
    const tokens = await (await fetch(`${base}/css/tokens.css`)).text();
    for (const file of woff2Files) {
      assert.ok(tokens.includes(`../fonts/${file}`), `css/tokens.css must declare an @font-face pointing at ../fonts/${file}`);
    }
    for (const page of pages) {
      const body = await (await fetch(`${base}/${page}`)).text();
      assert.ok(
        !body.includes('fonts.googleapis.com') && !body.includes('fonts.gstatic.com'),
        `${page} still references the Google Fonts CDN`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('vendored three.js ships in dist and no page references any CDN host', async () => {
  // ARRANGE — the pinned three.js 0.159.0 UMD build (issue #79; the last
  // release shipping build/three.min.js) plus its unmodified MIT license,
  // committed like the issue-#49 fonts and shipped verbatim into dist/vendor/
  const pages = [
    'index.html',
    'gameplay.html',
    'versions.html',
    'quests.html',
    'config.html',
    'hub.html',
    'safari.html',
    'routes.html',
    'pokedex.html',
    'mechanics.html',
    '404.html',
  ];
  const cdnHosts = [
    'cdn.jsdelivr.net',
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
  ];
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT — fetch the vendored assets and every page's static HTML
    for (const file of ['vendor/three.min.js', 'vendor/three/LICENSE']) {
      const res = await fetch(`${base}/${file}`);
      assert.equal(res.status, 200, `GET /${file} returned ${res.status} (vendored three.js must ship in dist)`);
    }
    for (const page of pages) {
      const body = await (await fetch(`${base}/${page}`)).text();
      for (const host of cdnHosts) {
        assert.ok(!body.includes(host), `${page} references a CDN host (${host})`);
      }
      assert.ok(
        !body.includes('vendor/three.min.js'),
        `${page} statically references the vendored three.js (it must be deferred-injected at run time by the Pokedex page script, never baked into a shell)`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('a data file with a bad meta.id fails the build (no injection into bundle.js)', () => {
  // ARRANGE — a temp copy of the repo's build inputs (site/, scripts/, data/)
  // with one poisoned data file: its filename stem (and matching meta.id)
  // breaks out of the bundle's window["ROGUE_DATA_<ID>"] global-name line
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'build-poison-'));
  try {
    cpSync(path.join(root, 'site'), path.join(tmpRoot, 'site'), { recursive: true });
    cpSync(path.join(root, 'scripts'), path.join(tmpRoot, 'scripts'), { recursive: true });
    cpSync(path.join(root, 'data'), path.join(tmpRoot, 'data'), { recursive: true });
    const poison = 'site"];window.pwned=1;';
    const site = JSON.parse(readFileSync(path.join(tmpRoot, 'data', 'site.json'), 'utf8'));
    site.meta.id = poison;
    writeFileSync(path.join(tmpRoot, 'data', `${poison}.json`), JSON.stringify(site));
    rmSync(path.join(tmpRoot, 'data', 'site.json'));

    // ACT — run the real build against the poisoned data dir
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: tmpRoot,
      encoding: 'utf8',
    });

    // ASSERT — the build fails, naming the offending file and the pattern
    // violation, and never publishes a dist/
    assert.equal(result.status, 1, `poisoned build unexpectedly succeeded:\n${result.stdout}`);
    assert.ok(
      result.stderr.includes(`data/${poison}.json`),
      `error must name the offending file:\n${result.stderr}`,
    );
    assert.ok(
      /"meta\.id".*must match/.test(result.stderr),
      `error must explain the meta.id pattern violation:\n${result.stderr}`,
    );
    assert.ok(!existsSync(path.join(tmpRoot, 'dist')), 'a failing build must not publish a dist/');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('a lazy data file whose stem collides with a fixed build output (bundle) fails the build', () => {
  // ARRANGE — a temp copy of the repo's build inputs (site/, scripts/, data/)
  // with one extra lazy data file whose stem (bundle) would be emitted as
  // dist/data/bundle.js — on top of the shared bundle the build itself emits
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'build-reserved-'));
  try {
    cpSync(path.join(root, 'site'), path.join(tmpRoot, 'site'), { recursive: true });
    cpSync(path.join(root, 'scripts'), path.join(tmpRoot, 'scripts'), { recursive: true });
    cpSync(path.join(root, 'data'), path.join(tmpRoot, 'data'), { recursive: true });
    const poison = {
      meta: { id: 'bundle', title: 'Reserved-stem poison', lazy: true },
      prose: [{ heading: 'Poison', text: 'A lazy data file named bundle.js would clobber the shared bundle.' }],
    };
    writeFileSync(path.join(tmpRoot, 'data', 'bundle.json'), JSON.stringify(poison));

    // ACT — run the real build against the poisoned data dir
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: tmpRoot,
      encoding: 'utf8',
    });

    // ASSERT — the build fails, naming the offending file, and never publishes a dist/
    assert.equal(result.status, 1, `reserved-stem build unexpectedly succeeded:\n${result.stdout}`);
    assert.ok(
      result.stderr.includes('data/bundle.json'),
      `error must name the offending file:\n${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes('reserved stem'),
      `error must explain the reserved-stem collision:\n${result.stderr}`,
    );
    assert.ok(!existsSync(path.join(tmpRoot, 'dist')), 'a failing build must not publish a dist/');
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('served 404 page returns 200 and contains its static marker', async () => {
  // ARRANGE
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT
    const res = await fetch(`${base}/404.html`);
    const body = await res.text();

    // ASSERT
    assert.equal(res.status, 200, `GET /404.html returned ${res.status}`);
    assert.ok(body.includes('Page not found'), '404.html is missing the "Page not found" marker');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

test('every served page wires in the search overlay scripts (search-index.js before search.js, both after main.js)', async () => {
  // ARRANGE — all 11 page shells share the same script-block convention
  const pages = [
    'index.html',
    'gameplay.html',
    'versions.html',
    'quests.html',
    'config.html',
    'hub.html',
    'safari.html',
    'routes.html',
    'pokedex.html',
    'mechanics.html',
    '404.html',
  ];
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ACT — fetch every page
    const bodies = [];
    for (const page of pages) {
      const res = await fetch(`${base}/${page}`);
      bodies.push([page, res.status, await res.text()]);
    }

    // ASSERT — 200, both search script tags present, and loaded in order
    for (const [page, status, body] of bodies) {
      assert.equal(status, 200, `GET /${page} returned ${status}`);
      assert.ok(body.includes('./js/search-index.js'), `${page} is missing the search-index.js script tag`);
      assert.ok(body.includes('./js/search.js'), `${page} is missing the search.js script tag`);
      const mainIdx = body.indexOf('./js/main.js');
      const indexIdx = body.indexOf('./js/search-index.js');
      const searchIdx = body.indexOf('./js/search.js');
      assert.ok(
        mainIdx !== -1 && indexIdx > mainIdx && searchIdx > indexIdx,
        `${page} must load main.js before search-index.js before search.js`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

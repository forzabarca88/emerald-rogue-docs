/**
 * End-to-end tests for the docs site (node --test, no mocks, no deps).
 *
 * (1) The build: runs `node scripts/build.mjs` as a child process, asserts
 *     exit 0, that dist/index.html exists, and that dist/data/bundle.js
 *     references a ROGUE_DATA_<ID> global for every current data file.
 * (2) The bundle: executes dist/data/bundle.js in a vm sandbox with a fake
 *     `window` and asserts every ROGUE_DATA_<ID> global is actually defined
 *     (catches bundle output that is not valid JavaScript, e.g. hyphenated
 *     meta.ids emitted as bare property assignments).
 * (3) The served site: serves dist/ over node:http on an ephemeral port and
 *     asserts every content page — index, gameplay, versions, quests, config,
 *     hub, safari, routes, mechanics and the 404 fallback — returns 200 with
 *     its page-specific static marker strings (titles from data/site.json),
 *     and that every one of the 10 pages wires in the search overlay scripts
 *     (search-index.js before search.js, both after main.js).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    assert.ok(bundle.includes(key), `bundle.js is missing ${key} for data/${file}`);
  }
});

test('bundle.js is valid JavaScript and defines every ROGUE_DATA_ global', () => {
  // ARRANGE — dist/ is produced by the build test above
  const dataFiles = readdirSync(path.join(root, 'data'))
    .filter((f) => f.endsWith('.json'))
    .sort();
  const code = readFileSync(path.join(distDir, 'data', 'bundle.js'), 'utf8');

  // ACT — execute the bundle with a fake `window`
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox, { filename: 'bundle.js' });

  // ASSERT — every bundled data file is reachable via string-key access
  for (const file of dataFiles) {
    const data = JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8'));
    const key = `ROGUE_DATA_${String(data.meta.id).toUpperCase()}`;
    assert.ok(sandbox.window[key], `bundle.js did not define window["${key}"]`);
    assert.equal(sandbox.window[key].meta.id, data.meta.id, `window["${key}"] has the wrong meta.id`);
  }
});

test('adventure.json makes no wrong per-run placement or goal claims (records, meta description and prose)', () => {
  // ARRANGE — the room-type/boss records in data/adventure.json
  const adventure = JSON.parse(readFileSync(path.join(root, 'data', 'adventure.json'), 'utf8'));
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
  // Banned in every record field (name, description, source).
  const bannedAnywhere = ['Pokabbie'];
  // meta.description and the prose blocks (both touched by the same passes as
  // the records) are free prose — every phrase above applies there (no
  // record-name or citation exemptions).
  const bannedInProse = [...bannedPhrases, ...bannedInDescriptions, ...bannedAnywhere];

  // ACT — scan every record's description, source and rendered `placement`
  // strings (the note + bar labels/conds the gameplay placement bars
  // display), case-insensitively
  const hits = [];
  for (const record of adventure.records) {
    for (const field of ['description', 'source']) {
      const text = String(record[field] ?? '').toLowerCase();
      for (const phrase of bannedPhrases) {
        if (text.includes(phrase.toLowerCase())) {
          hits.push(`${record.id}.${field} contains "${phrase}"`);
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
        const text = String(raw ?? '').toLowerCase();
        if (!text) continue;
        for (const phrase of bannedInProse) {
          if (text.includes(phrase.toLowerCase())) {
            hits.push(`${record.id}.placement contains "${phrase}"`);
          }
        }
      }
    }
    const description = String(record.description ?? '').toLowerCase();
    for (const phrase of bannedInDescriptions) {
      if (description.includes(phrase)) {
        hits.push(`${record.id}.description contains "${phrase}"`);
      }
    }
    for (const field of ['name', 'description', 'source']) {
      const text = String(record[field] ?? '').toLowerCase();
      for (const phrase of bannedAnywhere) {
        if (text.includes(phrase.toLowerCase())) {
          hits.push(`${record.id}.${field} contains "${phrase}"`);
        }
      }
    }
  }

  // ACT (cont.) — scan meta.description and every prose block the same way
  const proseHits = [];
  const proseTargets = [['meta.description', adventure.meta && adventure.meta.description]];
  for (const block of Array.isArray(adventure.prose) ? adventure.prose : []) {
    proseTargets.push([`prose:${block.id}`, block.text]);
  }
  for (const [where, raw] of proseTargets) {
    const text = String(raw ?? '').toLowerCase();
    for (const phrase of bannedInProse) {
      if (text.includes(phrase.toLowerCase())) proseHits.push(`${where} contains "${phrase}"`);
    }
  }

  // ASSERT — the flagged wrong-claim phrases must all be gone (records and prose)
  assert.deepEqual(hits, [], `wrong-claim phrases still present:\n  ${hits.join('\n  ')}`);
  assert.deepEqual(proseHits, [], `wrong-claim phrases in meta description or prose:\n  ${proseHits.join('\n  ')}`);
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
  // ARRANGE — all 10 page shells share the same script-block convention
  const pages = [
    'index.html',
    'gameplay.html',
    'versions.html',
    'quests.html',
    'config.html',
    'hub.html',
    'safari.html',
    'routes.html',
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

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
 *     its page-specific static marker strings (titles from data/site.json).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';
import { existsSync, readFile, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

/** Minimal static file server for dist/ (test-only, closed in after()). */
function createStaticServer(dir) {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.normalize(path.join(dir, urlPath));
    if (!filePath.startsWith(dir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    readFile(filePath, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const type =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
        }[path.extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    });
  });
}

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

test('adventure.json records make no wrong per-run placement or goal claims', () => {
  // ARRANGE — the room-type/boss records in data/adventure.json
  const adventure = JSON.parse(readFileSync(path.join(root, 'data', 'adventure.json'), 'utf8'));
  const bannedPhrases = [
    'one per run',
    'exactly one is placed per run',
    'the more you land, the better the reward',
    'useful for grinding experience',
    "try to pocket an item you haven't earned",
    'dropping to 1 after four',
  ];

  // ACT — scan every record's description and source, case-insensitively
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
  }

  // ASSERT — the flagged wrong-claim phrases must all be gone
  assert.deepEqual(hits, [], `wrong-claim phrases still present:\n  ${hits.join('\n  ')}`);
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

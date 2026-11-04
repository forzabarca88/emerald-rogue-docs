/**
 * Regression test for the unescaped version label in site/js/pages/config.js
 * (GitHub issue #52 — latent stored XSS, audit SITE-01).
 *
 * node --test, zero deps, no DOM, no mocks: loads site/js/data.js,
 * site/js/version.js, site/js/render.js then site/js/pages/config.js into a
 * fresh vm sandbox with a fake `window` (real data/*.json on disk) and a
 * minimal fake `document` whose <main> just records its innerHTML. The
 * poisoned-build scenario: data/site.json's `versions.labels.ex` carries an
 * HTML payload — the config page's rendered output must carry it only as
 * escaped entities, never as live markup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PAYLOAD = '<img src=x onerror="window.__xss=1"><svg onload="window.__xss=2">';
const PAYLOAD_ESCAPED = '&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;&lt;svg onload=&quot;window.__xss=2&quot;&gt;';

/**
 * Render the config page in a fresh vm sandbox. `site` is the ROGUE_DATA_SITE
 * config to bundle (real site.json, optionally poisoned). Returns the
 * rendered <main> innerHTML string plus the sandbox's ROGUE.
 */
function renderConfigPage(site) {
  const main = { innerHTML: '' };
  const win = {
    ROGUE_DATA_SITE: site,
    ROGUE_DATA_SETTINGS: JSON.parse(readFileSync(path.join(root, 'data', 'settings.json'), 'utf8')),
    /* the bundle key is meta.id uppercased verbatim — 'GAME-MODES', not 'GAME_MODES' */
    'ROGUE_DATA_GAME-MODES': JSON.parse(readFileSync(path.join(root, 'data', 'game-modes.json'), 'utf8')),
    ROGUE_DATA_CAMPAIGNS: JSON.parse(readFileSync(path.join(root, 'data', 'campaigns.json'), 'utf8')),
    console,
    location: { search: '?version=ex' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  const sandbox = {
    window: win,
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      querySelector: (sel) => (sel === 'main' ? main : null),
    },
    console,
  };
  vm.createContext(sandbox);
  for (const mod of ['data', 'version', 'render']) {
    vm.runInContext(readFileSync(path.join(root, 'site', 'js', mod + '.js'), 'utf8'), sandbox, {
      filename: mod + '.js',
    });
  }
  vm.runInContext(readFileSync(path.join(root, 'site', 'js', 'pages', 'config.js'), 'utf8'), sandbox, {
    filename: 'config.js',
  });
  return { html: main.innerHTML, rogue: win.ROGUE };
}

test('a poisoned versions.labels value is inert in the rendered config page', () => {
  // ARRANGE — the poisoned build: the EX label carries a live-HTML payload
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
  site.versions.labels.ex = PAYLOAD;

  // ACT
  const { html, rogue } = renderConfigPage(site);

  // ASSERT — the page rendered (and at the EX build, so the dynamic
  // "Options — <label> (N)" field block was produced) with the payload only
  // as escaped entities and never as live markup
  assert.equal(rogue.version, 'ex');
  assert.ok(html, 'config page did not render');
  assert.ok(html.includes('class="field-label"'), 'dynamic options field block missing:\n' + html);
  assert.ok(html.includes(PAYLOAD_ESCAPED), 'payload must appear escaped:\n' + html);
  assert.ok(!html.includes(PAYLOAD), 'raw payload found — unescaped interpolation:\n' + html);
  assert.ok(!/<img[\s>]/.test(html) && !/<svg[\s>]/.test(html), 'raw payload tags in output:\n' + html);
});

test('the real (unpoisoned) config page renders the version label unchanged', () => {
  // ARRANGE — the real site.json labels
  const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));

  // ACT
  const { html, rogue } = renderConfigPage(site);

  // ASSERT — the dynamic label shows the real "EX" label verbatim (no
  // escaping needed for the unpoisoned data)
  assert.equal(rogue.version, 'ex');
  assert.ok(
    html.includes('<span class="field-label">Options — ' + site.versions.labels.ex + ' ('),
    'dynamic options label missing or altered:\n' + html
  );
  assert.ok(!html.includes('&lt;') && !html.includes('&gt;'), 'unexpected entities in unpoisoned output:\n' + html);
});

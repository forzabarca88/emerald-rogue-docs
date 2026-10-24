/**
 * Unit tests for ROGUE.citeHtml (site/js/render.js) — the helper that turns
 * a record's `source` citation string into HTML with GitHub permalinks at
 * the pinned baseline (data/site.json `citations`).
 *
 * node --test, zero deps, no DOM, no mocks: loads site/js/data.js then
 * site/js/render.js into a fresh vm sandbox with a fake `window` carrying a
 * ROGUE_DATA_SITE config (test SHAs), and asserts the end-result HTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REPO = 'https://github.com/example/test-repo';
const VANILLA_SHA = 'a'.repeat(40);
const EXPANSION_SHA = 'b'.repeat(40);

/** Load data.js + render.js into a fresh vm sandbox (fake `window`, no DOM). */
function loadRogue(siteData) {
  const sandbox = { window: {} };
  if (siteData) sandbox.window.ROGUE_DATA_SITE = siteData;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, 'site', 'js', 'data.js'), 'utf8'), sandbox, {
    filename: 'data.js',
  });
  vm.runInContext(readFileSync(path.join(root, 'site', 'js', 'render.js'), 'utf8'), sandbox, {
    filename: 'render.js',
  });
  return sandbox.window.ROGUE;
}

/** A ROGUE with the citations config (test SHAs) — mirrors the real site.json shape. */
function rogueWithCitations() {
  return loadRogue({
    citations: {
      repo: REPO,
      ref: { vanilla: VANILLA_SHA, expansion: EXPANSION_SHA },
    },
  });
}

test('concrete file + line range links the file at the vanilla SHA and each line range', () => {
  // ARRANGE
  const rogue = rogueWithCitations();
  const source = 'src/rogue_script.c @vanilla L1147-1166 (note)';

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT — file anchor + a #L1147-L1166 anchor, annotation stays plain
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_script.c" target="_blank" rel="noopener">src/rogue_script.c @vanilla</a>`
    ),
    `missing file anchor:\n${html}`
  );
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_script.c#L1147-L1166" target="_blank" rel="noopener">L1147-1166</a>`
    ),
    `missing line-range anchor:\n${html}`
  );
  assert.ok(html.endsWith(' (note)'), `annotation should stay plain text:\n${html}`);
});

test('file-level cite (no L-refs) links the file with no fragment', () => {
  // ARRANGE
  const rogue = rogueWithCitations();
  const source = 'src/rogue_charms.c @vanilla (CalcValueInternal)';

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT — one anchor, no #L fragment
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_charms.c" target="_blank" rel="noopener">src/rogue_charms.c @vanilla</a>`
    ),
    `missing file anchor:\n${html}`
  );
  assert.ok(!html.includes('#L'), `file-level cite must have no line fragment:\n${html}`);
});

test('dual cite with continuation links the inherited file on the expansion SHA', () => {
  // ARRANGE
  const rogue = rogueWithCitations();
  const source = 'src/rogue_controller.c @vanilla L5033 (x) / @origin/expansion L5040-5086 (y)';

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT — vanilla file + line anchors, then the expansion file (same path)
  // + its line range, with the "@origin/expansion" tail as the continuation anchor
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_controller.c" target="_blank" rel="noopener">src/rogue_controller.c @vanilla</a>`
    ),
    `missing vanilla file anchor:\n${html}`
  );
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_controller.c#L5033" target="_blank" rel="noopener">L5033</a>`
    ),
    `missing vanilla line anchor:\n${html}`
  );
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${EXPANSION_SHA}/src/rogue_controller.c" target="_blank" rel="noopener">@origin/expansion</a>`
    ),
    `missing continuation anchor at the expansion SHA:\n${html}`
  );
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${EXPANSION_SHA}/src/rogue_controller.c#L5040-L5086" target="_blank" rel="noopener">L5040-5086</a>`
    ),
    `missing expansion line-range anchor:\n${html}`
  );
});

test('glob cite links its parent directory (trailing slash)', () => {
  // ARRANGE
  const rogue = rogueWithCitations();
  const source = 'src/data/rogue/trainers/<region>.json @vanilla (CLASS_RIVAL entries)';

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT — directory URL ending in "/", glob pattern escaped in the label
  assert.ok(
    html.includes(
      `<a href="${REPO}/blob/${VANILLA_SHA}/src/data/rogue/trainers/" target="_blank" rel="noopener">src/data/rogue/trainers/&lt;region&gt;.json @vanilla</a>`
    ),
    `missing directory anchor:\n${html}`
  );
  assert.ok(!html.includes('#L'), `glob cite must have no line fragment:\n${html}`);
});

test('claim tokens and non-citation sources render as plain text (no anchors)', () => {
  // ARRANGE
  const rogue = rogueWithCitations();

  // ACT
  const claim = rogue.citeHtml('src/rogue_charms.c @vanilla L100 (x) (identical @origin/expansion)');
  const selfCite = rogue.citeHtml('(site data)');
  const methodCite = rogue.citeHtml('git show origin/expansion:src/rogue_charms.c (diff)');

  // ASSERT — the file still links, but the claim and the non-citations don't
  assert.ok(claim.includes(`<a href="${REPO}/blob/${VANILLA_SHA}/src/rogue_charms.c#L100"`), claim);
  assert.ok(claim.includes('(identical @origin/expansion)'), `claim must stay plain:\n${claim}`);
  assert.ok(!claim.includes('>identical @origin/expansion</a>'), `claim must not be a link target:\n${claim}`);
  assert.equal(selfCite, '(site data)', `self-cite must be untouched plain text:\n${selfCite}`);
  assert.equal(
    methodCite,
    'git show origin/expansion:src/rogue_charms.c (diff)',
    `method cite must be untouched plain text:\n${methodCite}`
  );
});

test('missing citations config degrades to escaped plain text (graceful no-op)', () => {
  // ARRANGE — no ROGUE_DATA_SITE at all
  const rogue = loadRogue(undefined);
  const source = 'src/rogue_script.c @vanilla L1147-1166 (note)';

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT
  assert.equal(html, source, `missing config must yield plain text:\n${html}`);
  assert.ok(!html.includes('<a'), `missing config must yield no anchors:\n${html}`);
});

test('real multi-cite source (adventure.json boss-final) links every unit correctly', () => {
  // ARRANGE — the verbatim source of the boss-final record (concrete cites,
  // a continuation, four byte-identity claims and a glob)
  const adventure = JSON.parse(readFileSync(path.join(root, 'data', 'adventure.json'), 'utf8'));
  const source = adventure.records.find((r) => r.id === 'boss-final').source;
  const rogue = rogueWithCitations();

  // ACT
  const html = rogue.citeHtml(source);

  // ASSERT — every citation unit produces the expected anchor
  const expectAnchor = (href, label) =>
    assert.ok(html.includes(`<a href="${href}" target="_blank" rel="noopener">${label}</a>`), `missing anchor ${href}\n${html}`);
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/include/constants/rogue.h`, 'include/constants/rogue.h @vanilla');
  for (const line of ['L379', 'L394', 'L409']) {
    expectAnchor(`${REPO}/blob/${VANILLA_SHA}/include/constants/rogue.h#${line}`, line);
    expectAnchor(`${REPO}/blob/${EXPANSION_SHA}/include/constants/rogue.h#${line}`, line);
  }
  expectAnchor(`${REPO}/blob/${EXPANSION_SHA}/include/constants/rogue.h`, '@origin/expansion');
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/src/rogue_adventurepaths.c`, 'src/rogue_adventurepaths.c @vanilla');
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/src/rogue_adventurepaths.c#L1862-L1866`, 'L1862-1866');
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/src/rogue_trainers.c`, 'src/rogue_trainers.c @vanilla');
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/src/rogue_trainers.c#L1160-L1167`, 'L1160-1167');
  expectAnchor(`${REPO}/blob/${VANILLA_SHA}/src/data/rogue/trainers/`, 'src/data/rogue/trainers/&lt;region&gt;.json @vanilla');
  // the three byte-identity claims stay plain (never link targets)
  assert.equal((html.match(/\(identical @origin\/expansion\)/g) ?? []).length, 3, html);
  // total: 4 file anchors + 8 line anchors + 1 directory anchor
  assert.equal((html.match(/<a /g) ?? []).length, 13, html);
});

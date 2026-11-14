/*
 * section-nav.test.mjs — the shared .section-nav strip component
 * (issue #98, PR 3/4).
 *
 * Every section strip on the site — the six converted pages (quests,
 * config, hub, safari, routes, mechanics) and the three added pages
 * (gameplay, versions, pokedex overview) — is the ONE .section-nav
 * component (components.css) rendered by ROGUE.sectionNav
 * (render.js), pinned below the sticky site header (`top:
 * var(--site-header-h)` — the header's measured height, published by
 * nav.js on <html>) — the pokedex overview strip excepted, which pins
 * under the sticky .dex-browse bar (`top: var(--dex-scroll-clear)`,
 * measured by pokedex.js). The home page carries NO strip by design
 * (documented in DESIGN.md §6 — its quick-link cards are the
 * navigation).
 *
 * Per strip page:
 *   1. (1280px) the strip exists with the expected chip count —
 *      data-derived where the page derives it (versions = distinct
 *      difference categories, quests = the display groups, pokedex =
 *      Grid + the four prose blocks) and pinned to the page's own
 *      section list otherwise — and clicking the FIRST chip updates
 *      the hash, keeps the page alive (a window sentinel survives —
 *      no full reload) and lands its target BELOW the strip (the
 *      measured scroll-margin clears header + strip + gap)
 *   2. (1280px) mid-scroll the strip is pinned at its sticky `top`
 *      (the computed style's resolved px value — the measured header
 *      bottom for the eight pages, the measured bar bottom + 16px on
 *      pokedex) and never overlaps the sticky header
 *   3. (360px) the strip stays a SINGLE line (its overflow scrolls
 *      horizontally inside the strip, it does not wrap to a second
 *      line), it is still pinned mid-scroll, and the page itself
 *      does not overflow horizontally
 *
 * All chip counts and anchors are derived from the data files at load
 * (the same values the page scripts render from) — no hardcoded
 * literals except the static per-page section lists.
 *
 * Every page is opened under emulated prefers-reduced-motion: reduce —
 * the site's documented reduced-motion policy (base.css) then forces
 * scroll-behavior: auto, so the programmatic and anchor scrolls these
 * tests drive are INSTANT and deterministic (no smooth-scroll
 * animation races). Every assertion here is a motion-independent
 * layout contract.
 *
 * Playwright resolves local-then-global and the suite self-skips when
 * absent (the ci `ui` job installs it, where it is required).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

// File shape follows the harness module header (test/ui/harness.mjs):
// startServer in before() (skipped entirely when Playwright is absent,
// so a self-skipping suite never builds dist/ or races the e2e suite),
// closeAll + server.close() in after(), and each test guarded with the
// harness's skipIfNoPlaywright(t).
let server;
before(async () => {
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

const readData = (file) =>
  JSON.parse(fs.readFileSync(new URL(`../../data/${file}`, import.meta.url), 'utf8'));

const versionsData = readData('versions.json');
const questsData = readData('quests.json');
const pokedexData = readData('pokedex.json');

/** The nine strip pages: the expected chip count (derived where the
 *  page derives it) and the FIRST chip's href (its deep-link target —
 *  every one of them an element that exists on the page). */
const PAGES = [
  { path: 'gameplay.html', chips: 7, firstHref: '#gp-hub' },
  {
    path: 'versions.html',
    chips: new Set(versionsData.records.map((r) => r.category)).size,
    firstHref: '#rec-versions-' + versionsData.records.find((r) => r.category === [...new Set(versionsData.records.map((x) => x.category))][0]).id,
  },
  {
    path: 'quests.html',
    chips: questsData.display_groups.length,
    firstHref: '#quest-' + questsData.display_groups[0].id,
  },
  { path: 'config.html', chips: 5, firstHref: '#config-modes' },
  { path: 'hub.html', chips: 6, firstHref: '#hub-areas' },
  { path: 'safari.html', chips: 5, firstHref: '#safari-pool' },
  { path: 'routes.html', chips: 5, firstHref: '#routes-naming' },
  {
    path: 'pokedex.html',
    chips: 1 + pokedexData.prose.length,
    firstHref: '#dex-browse',
  },
  { path: 'mechanics.html', chips: 6, firstHref: '#mech-charms' },
];

/* openPage + the reduced-motion emulation every test in this suite
 * runs under (see the file header). */
async function openStripPage(options) {
  const ctx = await openPage(options);
  await ctx.page.emulateMedia({ reducedMotion: 'reduce' });
  return ctx;
}

/* Let the (instant under reduced motion) anchor scroll + its sticky
 * reflow land: one full animation-frame round-trip. */
async function waitForScrollSettle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

/* Scroll the page so the strip is 100px INSIDE its pinned range
 * (enough that sticky applies, not enough to release at the section
 * end — the strip's section is always taller than the viewport on
 * these pages) and report whether it pinned at its computed sticky
 * top. Under the suite's reduced-motion emulation the scroll is
 * instant (scroll-behavior: auto), so the reflow is settled by the
 * time this returns. Returns { pinned, stripTop, stickyTop,
 * headerBottom, scrollY, scrolledEnough, target }. */
async function pinState(page) {
  return page.evaluate(async () => {
    const strip = document.querySelector('.section-nav');
    const header = document.getElementById('site-header');
    const stickyTop = parseFloat(getComputedStyle(strip).top);
    const naturalTop = strip.getBoundingClientRect().top + window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const target = Math.min(naturalTop - stickyTop + 100, max);
    window.scrollTo(0, target);
    // one frame so the sticky reflow lands
    await new Promise((r) => requestAnimationFrame(r));
    const rect = strip.getBoundingClientRect();
    return {
      pinned: Math.abs(rect.top - stickyTop) <= 2,
      stripTop: rect.top,
      stickyTop,
      headerBottom: header.getBoundingClientRect().bottom,
      scrollY: window.scrollY,
      target,
      scrolledEnough: window.scrollY >= target - 1,
    };
  });
}

test('the home page carries no section strip (documented decision)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openStripPage({ path: 'index.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    const strip = await page.evaluate(() => document.querySelector('.section-nav'));
    assert.equal(strip, null, 'index.html: the home page has no .section-nav (DESIGN.md §6 — the quick-link cards are its navigation)');
  } finally {
    await close();
  }
});

for (const p of PAGES) {
  test(`${p.path}: the strip renders its ${p.chips} chips and the first chip deep-links without a reload`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    const { page, errors, close } = await openStripPage({ path: p.path, width: 1280, height: 800 });
    try {
      assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

      const present = await page.evaluate((expected) => {
        const strip = document.querySelector('.section-nav');
        if (!strip) return { exists: false, expected, chips: 0 };
        return {
          exists: true,
          expected,
          chips: strip.querySelectorAll('a.chip').length,
          hrefs: [...strip.querySelectorAll('a')].map((a) => a.getAttribute('href')),
        };
      }, p.chips);
      assert.ok(present.exists, `${p.path}: the .section-nav strip is missing`);
      assert.equal(present.chips, p.chips, `${p.path}: ${present.chips} chips (expected ${p.chips} — derived from the data the page renders)`);
      assert.equal(present.hrefs[0], p.firstHref, `${p.path}: the first chip targets ${p.firstHref}`);

      // no full reload: the sentinel survives the hash navigation
      await page.evaluate(() => { window.__snSentinel = true; });
      await page.locator('.section-nav a.chip').first().click();
      await page.waitForFunction((href) => window.location.hash === href, p.firstHref);
      await waitForScrollSettle(page);

      const landed = await page.evaluate((href) => {
        const target = document.querySelector(href);
        const strip = document.querySelector('.section-nav');
        const sRect = strip.getBoundingClientRect();
        const tRect = target.getBoundingClientRect();
        return {
          sentinel: window.__snSentinel === true,
          targetExists: target !== null,
          targetTop: tRect.top,
          stripTop: sRect.top,
          stripBottom: sRect.bottom,
          // the target is HIDDEN when its top edge sits inside the
          // strip's band (below the strip's top, above its bottom).
          // At the scroll top the first sections can sit ABOVE the
          // still-unpinned strip (its natural position) — that is fine.
          hidden: tRect.top > sRect.top + 2 && tRect.top < sRect.bottom - 2,
        };
      }, p.firstHref);
      assert.ok(landed.sentinel, `${p.path}: clicking the first chip navigated the page (the window sentinel was lost)`);
      assert.ok(landed.targetExists, `${p.path}: the chip's target ${p.firstHref} does not exist on the page`);
      assert.ok(
        !landed.hidden,
        `${p.path}: the target (top ${landed.targetTop}) is hidden under the strip (top ${landed.stripTop}, bottom ${landed.stripBottom}) — the scroll-margin clearance is broken`
      );
    } finally {
      await close();
    }
  });

  test(`${p.path}: the strip pins below the header at 1280px`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    const { page, errors, close } = await openStripPage({ path: p.path, width: 1280, height: 800 });
    try {
      assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
      const s = await pinState(page);
      assert.ok(s.scrolledEnough, `${p.path}: the page was not tall enough to exercise the pinned range (scrollY ${s.scrollY})`);
      assert.ok(s.pinned, `${p.path} @1280: the strip is not pinned at its sticky top (top ${s.stripTop}, sticky top ${s.stickyTop})`);
      assert.ok(s.stripTop >= s.headerBottom - 2, `${p.path} @1280: the pinned strip (top ${s.stripTop}) overlaps the sticky header (bottom ${s.headerBottom})`);
    } finally {
      await close();
    }
  });

  test(`${p.path}: at 360px the strip is a single line, pins, and the page does not overflow`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    const { page, errors, close } = await openStripPage({ path: p.path, width: 360, height: 720 });
    try {
      assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

      const singleLine = await page.evaluate(() => {
        const strip = document.querySelector('.section-nav');
        const chip = strip.querySelector('a.chip');
        return {
          stripH: strip.offsetHeight,
          chipH: chip.offsetHeight,
          // single line: the strip's height is one chip + its own
          // padding (12 top + 8 bottom) + the 2px hairline — never a
          // wrapped second line (~2x the chip)
          singleLine: strip.offsetHeight <= chip.offsetHeight + 25,
          pageOverflows: document.documentElement.scrollWidth > window.innerWidth + 1,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      assert.ok(singleLine.singleLine, `${p.path} @360: the strip wrapped to a second line (strip ${singleLine.stripH}px, chip ${singleLine.chipH}px)`);
      assert.ok(!singleLine.pageOverflows, `${p.path} @360: the page overflows horizontally (scrollWidth ${singleLine.scrollWidth} > ${360} + 1)`);

      const s = await pinState(page);
      assert.ok(s.scrolledEnough, `${p.path}: the page was not tall enough to exercise the pinned range (scrollY ${s.scrollY})`);
      assert.ok(s.pinned, `${p.path} @360: the strip is not pinned at its sticky top (top ${s.stripTop}, sticky top ${s.stickyTop})`);
      assert.ok(s.stripTop >= s.headerBottom - 2, `${p.path} @360: the pinned strip (top ${s.stripTop}) overlaps the sticky header (bottom ${s.headerBottom})`);
    } finally {
      await close();
    }
  });
}

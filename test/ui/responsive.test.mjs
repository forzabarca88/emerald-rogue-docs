/**
 * 1280px + 360px layout contract suite (node --test, zero deps; Playwright
 * resolved by the harness).
 *
 * DESIGN.md §9 rule: "the site must not break at 360px". DESIGN.md §4
 * rule: the sticky header is ONE row above 820px (brand | scrollable nav |
 * version toggle — the nav shrinks and scrolls instead of wrapping the
 * toggle), and at/below 820px the nav wraps to a full-width second row
 * while brand + toggle stay on row 1. This suite pins both rules at the
 * two canonical viewports:
 *
 *   1280×800 — desktop: single-row header, no horizontal overflow
 *   360×640  — mobile:   two-row header,  no horizontal overflow
 *
 * Coverage:
 *   1. No horizontal overflow — `document.documentElement.scrollWidth <=
 *      window.innerWidth` — on all 10 pages at both viewports, checked at
 *      the default version (data/site.json `defaultVersion`, "ex") AND,
 *      for the toggle-sensitive pages (TOGGLE_SENSITIVE), at the other
 *      version ("vanilla") too, since re-rendered content can differ in
 *      width.
 *   2. Header contract (base.css `#site-header` rules, DESIGN.md §4/§9):
 *      - 1280px: brand, nav and toggle share ONE row (comparable
 *        offsetTop) and the toggle is visible and clickable;
 *      - 360px: the nav drops to a full-width second row (strictly below
 *        the brand), brand + toggle remain on row 1, and the header
 *        itself does not overflow horizontally.
 *   3. 404.html renders its static marker (the "Error 404" eyebrow and
 *      the "Page not found" h1 from site/404.html) at both viewports.
 *   4. No-JS fallback (harness `js: false`): the shells' static content —
 *      the static <h1> and the `<p class="page-fallback">` where present
 *      — is visible; the empty #site-header / #site-footer shells remain
 *      (their content is JS-injected by js/nav.js, so it is legitimately
 *      absent without JS); and the layout does not overflow at 360px.
 *
 * Waiting is on readiness, never on sleeps: JS-on pages use the harness's
 * ROGUE + landmark waits, then the promise-based `document.fonts.ready`
 * so a webfont swap cannot change text widths between render and measure;
 * JS-off pages settle at DOMContentLoaded, exactly what a no-JS visitor
 * gets (the harness skips the JS-landmark waits in that mode).
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before(), closeAll + server.close in after(), and each
 * test guards with skipIfNoPlaywright(t) (the suite self-skips on
 * machines without a Playwright install instead of failing `npm test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));
const VERSION = site.defaultVersion;
const OTHER_VERSION = VERSION === 'vanilla' ? 'ex' : 'vanilla';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 360, height: 640 },
];

/**
 * All 10 served pages. `h1` is the STATIC <h1> baked into the HTML shell
 * (the no-JS fallback; with JS on, the page scripts replace
 * main.innerHTML — the smoke suite pins the same titles from
 * data/site.json). `fallback` marks the eight content pages that also
 * carry a static `<p class="page-fallback">` line (index's fallback is
 * the <h1> itself; 404 is fully static with its own marker).
 */
const PAGES = [
  { stem: 'index', file: 'index.html', h1: site.hero.title, fallback: false },
  { stem: 'gameplay', file: 'gameplay.html', h1: site.pages.gameplay.title, fallback: true },
  { stem: 'versions', file: 'versions.html', h1: site.pages.versions.title, fallback: true },
  { stem: 'quests', file: 'quests.html', h1: site.pages.quests.title, fallback: true },
  { stem: 'config', file: 'config.html', h1: site.pages.config.title, fallback: true },
  { stem: 'hub', file: 'hub.html', h1: site.pages.hub.title, fallback: true },
  { stem: 'safari', file: 'safari.html', h1: site.pages.safari.title, fallback: true },
  { stem: 'routes', file: 'routes.html', h1: site.pages.routes.title, fallback: true },
  { stem: 'mechanics', file: 'mechanics.html', h1: site.pages.mechanics.title, fallback: true },
  { stem: '404', file: '404.html', h1: 'Page not found', fallback: false },
];

/**
 * The pages whose rendered content depends on the active version (the six
 * pages test/ui/version.test.mjs re-renders): the other-version overflow
 * checks run on these, since re-rendered content can differ in width
 * (232 vs 138 quest cards, 19 vs 12 toggle cards, per-version chips…).
 * index (version-independent hero) and 404 (static) are excluded.
 */
const TOGGLE_SENSITIVE = ['versions', 'routes', 'quests', 'hub', 'config', 'safari'];

/* Same-row offsetTop tolerance (px): .site-header__inner vertically
 * centers items of differing heights in a row as tall as its tallest item
 * (the nav, ~34px), so one-row items' offsetTop spread stays under half
 * the row height (~17px); a wrapped second row sits a full row (~40px)
 * lower, so 20px separates the two states cleanly. */
const SAME_ROW_PX = 20;

/* --- shared helpers (page-context functions must be self-contained) ----- */

/**
 * The document scrollWidth plus the widest offender (for failure
 * diagnostics only — a clipped scroll container's contents can extend
 * past the viewport legitimately, e.g. the .site-nav link row).
 */
const overflowFacts = () => {
  let worst = -1;
  let offender = 'none';
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.right <= worst) continue;
    worst = r.right;
    offender =
      el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '') +
      ` (right edge ${Math.round(r.right)}px)`;
  }
  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    offender,
  };
};

/**
 * Header geometry for the DESIGN.md §4 row contract: the three row items'
 * offsetTops (all relative to the positioned sticky #site-header, so
 * comparable), the nav's rendered width, the header row's content width
 * (for the "full-width second row" check), and the header's own
 * scrollWidth (for the explicit header overflow check).
 */
const headerFacts = () => {
  const top = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.offsetTop : null;
  };
  const nav = document.querySelector('header .site-nav');
  const inner = document.querySelector('header .site-header__inner');
  const pad = inner ? getComputedStyle(inner) : null;
  return {
    brandTop: top('header .site-brand'),
    navTop: top('header .site-nav'),
    toggleTop: top('header .version-toggle'),
    navWidth: nav ? Math.round(nav.getBoundingClientRect().width * 10) / 10 : null,
    rowContentWidth:
      inner && pad
        ? Math.round((inner.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight)) * 10) / 10
        : null,
    headerScrollWidth: document.querySelector('header')?.scrollWidth ?? null,
    innerWidth: window.innerWidth,
  };
};

/**
 * Waits for webfonts to settle (a promise wait, not a sleep) so a
 * font swap cannot change text widths between the harness readiness
 * wait and the width measurement below.
 */
async function fontsSettled(page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The core rule: no horizontal overflow —
 * `document.documentElement.scrollWidth <= window.innerWidth`.
 */
async function assertNoOverflow(page, ctx) {
  await fontsSettled(page);
  const f = await page.evaluate(overflowFacts);
  assert.ok(
    f.scrollWidth <= f.innerWidth,
    `${ctx}: horizontal overflow — documentElement.scrollWidth is ${f.scrollWidth}px in a ${f.innerWidth}px viewport (widest offender: ${f.offender})`
  );
}

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- the suite ------------------------------------------------------------- */

test('the default version is "ex" (the "other version" this suite checks is therefore "vanilla")', () => {
  assert.equal(
    site.defaultVersion,
    'ex',
    'data/site.json defaultVersion changed — the toggle-sensitive pages re-checked at the other version in test/ui/responsive.test.mjs assume that other version is "vanilla"; update OTHER_VERSION usage before proceeding'
  );
});

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow at ${vp.width}×${vp.height} (default version ${VERSION}, all 10 pages)`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    for (const spec of PAGES) {
      const { page, errors, close } = await openPage({ path: spec.file, width: vp.width, height: vp.height });
      try {
        assert.deepEqual(errors, [], `${spec.file}: unexpected page errors: ${errors.join('; ')}`);
        // DESIGN.md §9: the site must not break at 360px (and must not
        // overflow at the desktop width either) — the page-level guard for
        // every viewport/content combination.
        await assertNoOverflow(page, `${spec.file} at ${vp.width}×${vp.height} (version ${VERSION})`);
      } finally {
        await close();
      }
    }
  });

  test(`no horizontal overflow at ${vp.width}×${vp.height} (other version ${OTHER_VERSION}, the ${TOGGLE_SENSITIVE.length} toggle-sensitive pages)`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    for (const stem of TOGGLE_SENSITIVE) {
      const spec = PAGES.find((p) => p.stem === stem);
      const { page, errors, close } = await openPage({
        path: spec.file,
        version: OTHER_VERSION,
        width: vp.width,
        height: vp.height,
      });
      try {
        assert.deepEqual(errors, [], `${spec.file}: unexpected page errors: ${errors.join('; ')}`);
        // the re-rendered (other-version) content can differ in width —
        // e.g. quests renders 138 instead of 232 cards — so the same
        // overflow rule must hold under ?version=<other> too
        await assertNoOverflow(page, `${spec.file} at ${vp.width}×${vp.height} (version ${OTHER_VERSION})`);
      } finally {
        await close();
      }
    }
  });
}

test('header at 1280×800: brand, nav and version toggle share ONE row, and the toggle is visible + clickable', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'index.html', width: 1280, height: 800 });
  try {
    assert.deepEqual(errors, [], 'unexpected page errors: ' + errors.join('; '));
    const f = await page.evaluate(headerFacts);
    for (const [name, value] of Object.entries({ brandTop: f.brandTop, navTop: f.navTop, toggleTop: f.toggleTop })) {
      assert.ok(typeof value === 'number', `missing header item for ${name} (nav.js markup changed?)`);
    }
    // DESIGN.md §4: "Above 820px the header is always one row" — the three
    // items are vertically centered in the same flex row, so their
    // offsetTops stay within SAME_ROW_PX of each other; a wrapped second
    // row would sit a full row height (~40px) lower.
    assert.ok(
      Math.abs(f.brandTop - f.navTop) <= SAME_ROW_PX,
      `1280px: brand (offsetTop ${f.brandTop}) and nav (offsetTop ${f.navTop}) must share one row (within ${SAME_ROW_PX}px); DESIGN.md §4`
    );
    assert.ok(
      Math.abs(f.navTop - f.toggleTop) <= SAME_ROW_PX,
      `1280px: nav (offsetTop ${f.navTop}) and toggle (offsetTop ${f.toggleTop}) must share one row (within ${SAME_ROW_PX}px); DESIGN.md §4`
    );
    assert.ok(
      Math.abs(f.brandTop - f.toggleTop) <= SAME_ROW_PX,
      `1280px: brand (offsetTop ${f.brandTop}) and toggle (offsetTop ${f.toggleTop}) must share one row (within ${SAME_ROW_PX}px); DESIGN.md §4`
    );

    // the toggle is visible: a non-degenerate box fully inside the viewport
    // (its margin-left: auto keeps it on the row's right edge, never off-canvas)
    const box = await page.locator('.version-toggle__option[aria-pressed="true"]').boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, '1280px: the active version-toggle option must have a non-degenerate bounding box');
    assert.ok(
      box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800,
      `1280px: the toggle must sit fully inside the viewport (box: x=${box.x} y=${box.y} ${Math.round(box.width)}×${Math.round(box.height)})`
    );
    // …and clickable: a hit-test at its center resolves to the toggle
    // itself (nothing in the header covers it)
    const hitInsideToggle = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return !!(el && el.closest('.version-toggle'));
      },
      [box.x + box.width / 2, box.y + box.height / 2]
    );
    assert.ok(hitInsideToggle, '1280px: elementFromPoint at the toggle center must resolve inside .version-toggle (nothing covers it)');
  } finally {
    await close();
  }
});

test('header at 360×640: nav drops to a full-width second row, brand + toggle stay on row 1, and the header does not overflow', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // two pages: the default render (index) and a re-rendered one (quests
  // under the other version) — the header markup itself is identical on
  // every page (nav.js), so the contract must hold in both states
  const checks = [
    { file: 'index.html', version: null, ctx: 'index.html (default)' },
    { file: 'quests.html', version: OTHER_VERSION, ctx: `quests.html (version ${OTHER_VERSION})` },
  ];
  for (const { file, version, ctx } of checks) {
    const { page, errors, close } = await openPage({
      path: file,
      version,
      width: 360,
      height: 640,
    });
    try {
      assert.deepEqual(errors, [], `${file}: unexpected page errors: ${errors.join('; ')}`);
      const f = await page.evaluate(headerFacts);
      for (const [name, value] of Object.entries({ brandTop: f.brandTop, navTop: f.navTop, toggleTop: f.toggleTop })) {
        assert.ok(typeof value === 'number', `${ctx}: missing header item for ${name} (nav.js markup changed?)`);
      }
      // DESIGN.md §4/§9: below 820px the nav wraps to a second row —
      // strictly below both row-1 items, which remain on one row together
      assert.ok(
        f.navTop > f.brandTop,
        `${ctx}: the nav (offsetTop ${f.navTop}) must be on the second row, below the brand (offsetTop ${f.brandTop}); DESIGN.md §4`
      );
      assert.ok(
        f.navTop > f.toggleTop,
        `${ctx}: the nav (offsetTop ${f.navTop}) must be on the second row, below the toggle (offsetTop ${f.toggleTop}); DESIGN.md §4`
      );
      assert.ok(
        Math.abs(f.brandTop - f.toggleTop) <= SAME_ROW_PX,
        `${ctx}: brand (offsetTop ${f.brandTop}) and toggle (offsetTop ${f.toggleTop}) must share row 1 (within ${SAME_ROW_PX}px); DESIGN.md §4`
      );
      // …and it is a FULL-WIDTH row: .site-nav is `flex: 1 1 100%` on the
      // wrapped row, so its rendered width equals the header row's content
      // width (container minus gutter)
      assert.ok(
        f.navWidth !== null && f.rowContentWidth !== null && Math.abs(f.navWidth - f.rowContentWidth) <= 2,
        `${ctx}: the second-row nav must span the full content width (nav ${f.navWidth}px vs row content ${f.rowContentWidth}px); DESIGN.md §4`
      );
      // explicit header overflow check (the page-level rule covers the
      // document, but the header is the element §9 calls out)
      assert.ok(
        f.headerScrollWidth <= f.innerWidth,
        `${ctx}: the header overflows horizontally (header.scrollWidth ${f.headerScrollWidth}px > ${f.innerWidth}px viewport); DESIGN.md §9`
      );
      await assertNoOverflow(page, `${ctx} at 360×640`);
    } finally {
      await close();
    }
  }
});

test('404.html renders its static marker at both 1280×800 and 360×640', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  for (const vp of VIEWPORTS) {
    const { page, errors, close } = await openPage({ path: '404.html', width: vp.width, height: vp.height });
    try {
      assert.deepEqual(errors, [], 'unexpected page errors: ' + errors.join('; '));
      const f = await page.evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const h1 = document.querySelector('main.page--404 h1');
        const eyebrow = document.querySelector('main.page--404 .eyebrow');
        return {
          h1Text: h1 ? h1.textContent.trim() : null,
          h1Visible: visible(h1),
          eyebrowText: eyebrow ? eyebrow.textContent.trim() : null,
          eyebrowVisible: visible(eyebrow),
        };
      });
      assert.equal(f.h1Text, 'Page not found', `404.html at ${vp.width}×${vp.height}: the static h1 marker must read "Page not found" (site/404.html), got ${JSON.stringify(f.h1Text)}`);
      assert.ok(f.h1Visible, `404.html at ${vp.width}×${vp.height}: the h1 marker must be visible`);
      assert.equal(f.eyebrowText, 'Error 404', `404.html at ${vp.width}×${vp.height}: the static eyebrow must read "Error 404" (site/404.html), got ${JSON.stringify(f.eyebrowText)}`);
      assert.ok(f.eyebrowVisible, `404.html at ${vp.width}×${vp.height}: the eyebrow must be visible`);
    } finally {
      await close();
    }
  }
});

for (const spec of PAGES) {
  test(`${spec.file} (no-JS): the static fallback is visible and the layout holds at 360×640`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    // js: false — the harness skips the ROGUE/landmark waits (JS-injected
    // content legitimately never appears) and settles at DOMContentLoaded
    const { page, errors, close } = await openPage({ path: spec.file, width: 360, height: 640, js: false });
    try {
      assert.deepEqual(errors, [], `${spec.file} (no-JS): unexpected page errors: ${errors.join('; ')}`);
      const f = await page.evaluate((hasFallback) => {
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const h1 = document.querySelector('main h1');
        return {
          h1Text: h1 ? h1.textContent.trim() : null,
          h1Visible: visible(h1),
          // the eight content pages carry a static <p class="page-fallback">
          // line in the shell (index's fallback is the <h1>; 404 is static)
          fallbackVisible: hasFallback ? visible(document.querySelector('main .page-fallback')) : null,
          headerShell: !!document.getElementById('site-header'),
          footerShell: !!document.getElementById('site-footer'),
          headerInjected: !!document.querySelector('#site-header .site-brand'),
          footerInjected: !!document.querySelector('#site-footer .site-footer__inner'),
        };
      }, spec.fallback);
      assert.equal(
        f.h1Text,
        spec.h1,
        `${spec.file} (no-JS): the shell's static <h1> must read ${JSON.stringify(spec.h1)}, got ${JSON.stringify(f.h1Text)}`
      );
      assert.ok(f.h1Visible, `${spec.file} (no-JS): the static <h1> must be visible (the layout must not collapse without JS)`);
      if (spec.fallback) {
        assert.ok(f.fallbackVisible, `${spec.file} (no-JS): the static <p class="page-fallback"> line must be visible (it is the no-JS content notice)`);
      }
      // the shells' header/footer are EMPTY elements in the HTML — nav.js
      // injects the brand/nav/toggle/footer inner with JS — so without JS
      // the shells exist but carry no injected content (and nothing
      // half-rendered either)
      assert.ok(f.headerShell && f.footerShell, `${spec.file} (no-JS): the #site-header / #site-footer shells from the HTML must remain`);
      assert.equal(f.headerInjected, false, `${spec.file} (no-JS): no .site-brand may appear without JS (header content is injected by js/nav.js)`);
      assert.equal(f.footerInjected, false, `${spec.file} (no-JS): no .site-footer__inner may appear without JS (footer content is injected by js/nav.js)`);
      await assertNoOverflow(page, `${spec.file} (no-JS) at 360×640`);
    } finally {
      await close();
    }
  });
}

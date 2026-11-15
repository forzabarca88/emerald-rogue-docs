/**
 * The Pokedex detail's section strip + Forms-above-Moves reorder
 * (reopened issue #98: "Pokedex requires excessive scrolling through
 * Pokemon's moves to see their forms").
 *
 * The fix under test:
 *   - the structured Forms field renders ABOVE the three move groups
 *     (up to 292 rows on Mew), and
 *   - the species detail carries its own .section-nav strip — one
 *     <button type="button" class="chip" data-target="dex-f-…"> action
 *     chip per PRESENT section in body order (Base stats, Abilities,
 *     [Evolutions], [Forms], Moves, Included in, [Ride], [Notes]),
 *     jumped by ONE delegated scrollIntoView() that NEVER writes the
 *     hash (the detail's contract is #rec-pokedex-<id>; any other hash
 *     drops back to the overview).
 *
 * Selection: the detail strip is selected as
 * `#dex-species .section-nav` — the HIDDEN overview strip is FIRST in
 * the DOM (the overview is hidden, not unrendered, while a detail is
 * open), so a bare `.section-nav` would pick the wrong one.
 *
 * Every expectation is derived from data/pokedex.json at load (the
 * record's fields under the active version — the page's dexVariant
 * rule: the vanilla overlay's field when present, else the EX one) —
 * the same computed values the page script renders from, so the
 * chip-set assertion is a live data↔DOM contract, not a stale literal.
 * The suite's species is charizard: it has an evo field, 3 EX forms
 * and 2 ride in EX, and the Vanilla overlay carries `forms: []` —
 * so the EX chip set and the Vanilla chip set differ on exactly the
 * Forms chip.
 *
 * All tests assert END RESULTS only — DOM order, bounding-rect
 * ordering/pinning, the URL hash, and a window sentinel surviving
 * chip clicks (the no-reload proof). Every page is opened under
 * emulated prefers-reduced-motion: reduce — the site's documented
 * reduced-motion policy (base.css) then forces scroll-behavior: auto,
 * so the delegated scrollIntoView() these tests drive is INSTANT and
 * deterministic (the motion-independent layout contract is what is
 * under test).
 *
 * Coverage:
 *   1. REORDER — EX charizard: #dex-f-forms precedes #dex-f-moves in
 *      the DOM and in bounding rects; the strip sits between
 *      .dex-nav and .dex-species__body in the article.
 *   2. CHIP SET — the data-target list (in order) equals the
 *      data-derived expectation (always-present chips + evo/forms/
 *      ride/notes guarded exactly as the record's fields); every
 *      target resolves in the DOM.
 *   3. VANILLA — ?version=vanilla charizard: no Forms chip, no
 *      #dex-f-forms element, no .dex-forms; the chip set equals the
 *      Vanilla expectation.
 *   4. CLICK — every chip: the hash is byte-identical, the detail
 *      stays open (overview hidden), the target's top lands at/below
 *      the strip's bottom and inside the viewport, the window
 *      sentinel survives (no reload), zero console/page errors.
 *   5. KEYBOARD — a chip is focusable; Enter performs the same jump.
 *   6. TWO STRIPS — detail open ⇒ exactly two .section-nav: the first
 *      is the HIDDEN overview strip (still 2 + prose.length a.chips,
 *      first href #dex-browse), the second the visible detail strip;
 *      mid-scroll the detail strip's sticky top = header bottom ±2px;
 *      after #dex-overview there is one strip (the detail is
 *      unmounted).
 *   7. 360px — detail open: no horizontal overflow, the detail strip
 *      is a single line (the section-nav suite's stripH <= chipH + 25
 *      formula — the inherited one-line behavior, not re-declared),
 *      and a chip click still lands under the strip.
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before() (skipped when Playwright is absent, so a
 * self-skipping suite never builds dist/ or races the e2e suite's own
 * build), closeAll + server.close in after(), and each test guarded
 * with skipIfNoPlaywright(t).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json) --------------------------------
 * The page's dexVariant rule: under Vanilla the record's `vanilla`
 * overlay holds ONLY the differing fields, so the active version's
 * value is the overlay's field when present, else the EX one. The
 * chip-set derivation mirrors speciesSection's render guards exactly
 * (evo field renders when evoRowsHtml is non-empty; forms/ride/notes
 * on their array lengths) — a record with no notes simply gets no
 * Notes chip, and so on.
 */
const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
const PROSE_COUNT = Array.isArray(dex.prose) ? dex.prose.length : 0;
const OVERVIEW_CHIPS = 2 + PROSE_COUNT; // Grid + the prose blocks + Type matchups

const rec = records.find((r) => r.id === 'charizard');
if (!rec) throw new Error('data/pokedex.json: no "charizard" record');

const variantOf = (version, field) =>
  version === 'vanilla' && rec.vanilla && rec.vanilla[field] !== undefined ? rec.vanilla[field] : rec[field];

/** The evo field renders when evoRowsHtml is non-empty (the page's
 *  guard, mirrored exactly): the version-scoped evo value is an object
 *  with at least one id'd evos entry or an id'd prev. */
const evoFieldRenders = (version) => {
  const evo = variantOf(version, 'evo');
  if (!evo || typeof evo !== 'object') return false;
  return (
    (Array.isArray(evo.evos) && evo.evos.some((e) => e && e.id)) || (evo.prev && evo.prev.id)
  );
};

/** The detail strip's expected chips for a version: in body order,
 *  guarded exactly as the record's fields. */
const expectedChips = (version) => {
  const chips = [
    { target: 'dex-f-stats', label: 'Base stats' },
    { target: 'dex-f-abilities', label: 'Abilities' },
  ];
  if (evoFieldRenders(version)) chips.push({ target: 'dex-f-evos', label: 'Evolutions' });
  const forms = Array.isArray(variantOf(version, 'forms')) ? variantOf(version, 'forms') : [];
  if (forms.length) chips.push({ target: 'dex-f-forms', label: 'Forms' });
  chips.push(
    { target: 'dex-f-moves', label: 'Moves' },
    { target: 'dex-f-variants', label: 'Included in' }
  );
  const ride = Array.isArray(variantOf(version, 'ride')) ? variantOf(version, 'ride') : [];
  if (ride.length) chips.push({ target: 'dex-f-ride', label: 'Ride' });
  const notes = Array.isArray(variantOf(version, 'notes')) ? variantOf(version, 'notes') : [];
  if (notes.length) chips.push({ target: 'dex-f-notes', label: 'Notes' });
  return chips;
};

const EX_CHIPS = expectedChips('ex');
const VANILLA_CHIPS = expectedChips('vanilla');
/* the suite's species exercises the version delta: EX has forms, the
 * Vanilla overlay does not — the expected chip lists differ on
 * exactly the Forms chip */
assert.ok(EX_CHIPS.some((c) => c.target === 'dex-f-forms'), 'derived: charizard EX has forms → a Forms chip');
assert.ok(!VANILLA_CHIPS.some((c) => c.target === 'dex-f-forms'), 'derived: charizard Vanilla forms: [] → no Forms chip');

const SETTLE_TIMEOUT_MS = 10_000; // guard for the settle waits (a bound, not a sleep)
const DETAIL_HASH = '#rec-pokedex-charizard';

let server;
before(async () => {
  // No Playwright → every test self-skips; skip the dist/ build too so a
  // Playwright-less CI job does not race N concurrent builds against the
  // e2e suite's own build.
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* openPage + the reduced-motion emulation every test in this suite runs
 * under (see the file header: the scrollIntoView jumps must be instant
 * and deterministic). */
async function openDetailPage(options) {
  const ctx = await openPage(options);
  await ctx.page.emulateMedia({ reducedMotion: 'reduce' });
  return ctx;
}

/** Deep-link charizard's detail by its hash and wait for the panel. */
async function openDetail(page) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, DETAIL_HASH);
  await page.waitForFunction(
    (el) => document.getElementById(el) !== null,
    'rec-pokedex-charizard',
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

/* Let the (instant under reduced motion) scroll + its sticky reflow
 * land: one full animation-frame round-trip (the section-nav suite's
 * convention). */
async function waitForScrollSettle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}

/** The jump invariants for a clicked/Enter'd chip: hash unchanged, the
 *  detail stays open, the target lands at/below the strip's bottom and
 *  inside the viewport, the sentinel survives. */
async function jumpFacts(page, target) {
  return page.evaluate((t) => {
    const strip = document.querySelector('#dex-species .section-nav');
    const el = document.getElementById(t);
    const sRect = strip.getBoundingClientRect();
    const tRect = el ? el.getBoundingClientRect() : null;
    return {
      hash: location.hash,
      overviewHidden: document.getElementById('dex-overview').hidden === true,
      sentinel: window.__dnSentinel === true,
      targetExists: el !== null,
      targetTop: tRect ? tRect.top : null,
      stripBottom: sRect.bottom,
      innerHeight: window.innerHeight,
    };
  }, target);
}

/* --- the suite ------------------------------------------------------------- */

test('reorder: the Forms field sits above the move groups and the strip between .dex-nav and the body', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — EX charizard deep link (has 3 forms + the evo field)
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await openDetail(page);

    // ACT / ASSERT — end results: DOM order, visual order, strip placement
    const order = await page.evaluate(() => {
      const article = document.querySelector('.dex-species');
      const children = [...article.children];
      const idx = (sel) => children.findIndex((el) => el.matches(sel));
      const forms = document.getElementById('dex-f-forms');
      const moves = document.getElementById('dex-f-moves');
      return {
        formsExists: !!forms,
        movesExists: !!moves,
        formsBeforeMoves:
          forms && moves ? !!(forms.compareDocumentPosition(moves) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
        navIdx: idx('.dex-nav'),
        stripIdx: idx('.section-nav'),
        bodyIdx: idx('.dex-species__body'),
        formsTop: forms ? forms.getBoundingClientRect().top : null,
        movesTop: moves ? moves.getBoundingClientRect().top : null,
      };
    });
    assert.ok(order.formsExists, 'the Forms field exists with id dex-f-forms (data/pokedex.json charizard EX: 3 forms)');
    assert.ok(order.movesExists, 'the move groups exist with id dex-f-moves (the .dex-moves box)');
    assert.ok(
      order.formsBeforeMoves,
      'the Forms field precedes the move groups in the DOM (reopened #98 — the owner had to scroll through the move tables to see the forms)'
    );
    assert.ok(
      Number.isFinite(order.formsTop) && Number.isFinite(order.movesTop) && order.formsTop < order.movesTop,
      `the Forms field (top ${order.formsTop}px) sits visually ABOVE the move groups (top ${order.movesTop}px)`
    );
    assert.ok(
      order.navIdx !== -1 && order.stripIdx !== -1 && order.bodyIdx !== -1 &&
        order.navIdx < order.stripIdx && order.stripIdx < order.bodyIdx,
      `the detail strip is a child of the article between .dex-nav (child ${order.navIdx}) and .dex-species__body (child ${order.bodyIdx}) — so it is sticky across the whole detail`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('chip set: the strip lists exactly the record’s present sections in body order (EX)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await openDetail(page);

    // ACT — read the strip's chips (data-target + label, in order) and
    // resolve every target
    const facts = await page.evaluate(() => {
      const strip = document.querySelector('#dex-species .section-nav');
      const chips = [...strip.querySelectorAll('button.chip[data-target]')];
      return {
        chipCount: chips.length,
        targets: chips.map((b) => b.getAttribute('data-target')),
        labels: chips.map((b) => (b.textContent || '').trim()),
        resolved: chips.every((b) => document.getElementById(b.getAttribute('data-target')) !== null),
        hasAnchors: strip.querySelectorAll('a[href]').length,
      };
    });
    // ASSERT — the record-derived expectation (data/pokedex.json charizard
    // EX: evo renders, 3 forms, 2 ride, 0 notes → the guarded chips are
    // exactly evo + forms + ride)
    assert.deepEqual(
      facts.targets,
      EX_CHIPS.map((c) => c.target),
      `data/pokedex.json charizard EX → ${EX_CHIPS.map((c) => c.target).join(', ')} (the guards mirror the render guards)`
    );
    assert.deepEqual(facts.labels, EX_CHIPS.map((c) => c.label), 'the chip labels match the field labels');
    assert.equal(facts.chipCount, EX_CHIPS.length, 'one chip per present section — no more, no fewer');
    assert.ok(facts.resolved, 'every chip’s data-target resolves to an element in the DOM');
    assert.equal(facts.hasAnchors, 0, 'the detail strip carries NO anchors — the hash contract is unbreakable by construction');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('vanilla: under ?version=vanilla charizard loses the Forms chip and the forms section', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', version: 'vanilla', width: 1280, height: 800 });
  try {
    await openDetail(page);

    const facts = await page.evaluate(() => ({
      name: (document.querySelector('.dex-species h2')?.textContent || '').trim(),
      targets: [...document.querySelectorAll('#dex-species .section-nav button.chip[data-target]')].map((b) =>
        b.getAttribute('data-target')
      ),
      formsField: document.getElementById('dex-f-forms') !== null,
      formsBlocks: document.querySelectorAll('#dex-species .dex-forms').length,
    }));
    // ASSERT — the Vanilla overlay carries forms: [] (data/pokedex.json):
    // no Forms chip, no field, no form blocks — and the rest of the chip
    // set is the Vanilla derivation
    assert.equal(facts.formsField, false, 'data/pokedex.json charizard vanilla.overlay.forms: [] → no #dex-f-forms field');
    assert.equal(facts.formsBlocks, 0, 'no .dex-forms container under Vanilla');
    assert.deepEqual(
      facts.targets,
      VANILLA_CHIPS.map((c) => c.target),
      `data/pokedex.json charizard Vanilla → ${VANILLA_CHIPS.map((c) => c.target).join(', ')} (no Forms chip)`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('click: every chip jumps its field without touching the hash (no reload, target below the strip)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await openDetail(page);
    // the no-reload sentinel: a chip click that wrote the hash or
    // navigated would re-execute the page's scripts and lose it
    await page.evaluate(() => {
      window.__dnSentinel = true;
    });

    // ACT — click EVERY chip in order
    const count = await page.locator('#dex-species .section-nav button.chip').count();
    assert.equal(count, EX_CHIPS.length, `the strip has ${EX_CHIPS.length} chips (data-derived)`);
    for (let i = 0; i < count; i++) {
      await page.locator('#dex-species .section-nav button.chip').nth(i).click();
      await waitForScrollSettle(page);
      // ASSERT — per chip: the hash contract, the open detail, the
      // landing (the dex-f-* scroll-margin clears header + strip +
      // 16px, so the target's top is below the strip's bottom), the
      // no-reload proof
      const f = await jumpFacts(page, EX_CHIPS[i].target);
      assert.equal(f.hash, DETAIL_HASH, `chip ${i} (${EX_CHIPS[i].target}): the hash is byte-identical — the click never writes it`);
      assert.equal(f.overviewHidden, true, `chip ${i}: the detail stays open (the overview stays hidden)`);
      assert.ok(f.targetExists, `chip ${i}: the target ${EX_CHIPS[i].target} exists in the DOM`);
      assert.ok(
        Number.isFinite(f.targetTop) && f.targetTop >= f.stripBottom - 2,
        `chip ${i}: the target (top ${f.targetTop}px) lands at/below the strip's bottom (${f.stripBottom}px) — the scroll-margin clearance`
      );
      assert.ok(
        f.targetTop < f.innerHeight,
        `chip ${i}: the target (top ${f.targetTop}px) is inside the viewport`
      );
      assert.equal(f.sentinel, true, `chip ${i}: the window sentinel survived — no reload`);
    }
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('keyboard: a chip is focusable and Enter performs the same jump', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await openDetail(page);
    await page.evaluate(() => {
      window.__dnSentinel = true;
    });

    // ACT — focus the Moves chip (a <button> is natively focusable; the
    // delegated listener treats Enter like a click) and press Enter
    const movesChip = page.locator('#dex-species .section-nav button.chip[data-target="dex-f-moves"]');
    await movesChip.focus();
    const focused = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && a.tagName === 'BUTTON' && a.getAttribute('data-target') === 'dex-f-moves';
    });
    assert.ok(focused, 'the Moves chip is keyboard-focusable (document.activeElement is the button)');
    await page.keyboard.press('Enter');
    await waitForScrollSettle(page);

    // ASSERT — the same invariants as a click
    const f = await jumpFacts(page, 'dex-f-moves');
    assert.equal(f.hash, DETAIL_HASH, 'Enter never writes the hash');
    assert.equal(f.overviewHidden, true, 'the detail stays open');
    assert.ok(
      Number.isFinite(f.targetTop) && f.targetTop >= f.stripBottom - 2,
      `the move groups (top ${f.targetTop}px) landed at/below the strip's bottom (${f.stripBottom}px)`
    );
    assert.equal(f.sentinel, true, 'the window sentinel survived — no reload');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('two strips: hidden overview strip + visible detail strip; the strip pins at the header bottom; overview ⇒ one strip', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 1280, height: 800 });
  try {
    await openDetail(page);

    // ACT — inspect the strip inventory while the detail is open
    const two = await page.evaluate(() => {
      const strips = [...document.querySelectorAll('.section-nav')];
      const first = strips[0];
      return {
        count: strips.length,
        firstHidden: first ? first.offsetParent === null : null,
        firstAnchors: first ? first.querySelectorAll('a.chip').length : 0,
        firstHref: first ? (first.querySelector('a')?.getAttribute('href') ?? null) : null,
        detailVisible: document.querySelector('#dex-species .section-nav')?.offsetParent !== null,
      };
    });
    // ASSERT — the DOM-order guarantee (the overview strip is FIRST —
    // the hidden one) and the detail strip is the visible second
    assert.equal(two.count, 2, 'exactly two .section-nav strips while a detail is open');
    assert.equal(two.firstHidden, true, 'the first strip (first in the DOM) is the HIDDEN overview strip');
    assert.equal(
      two.firstAnchors,
      OVERVIEW_CHIPS,
      `the overview strip still carries its ${OVERVIEW_CHIPS} anchor chips (2 + the data's prose blocks + Type matchups)`
    );
    assert.equal(two.firstHref, '#dex-browse', 'the overview strip’s first chip still targets #dex-browse');
    assert.equal(two.detailVisible, true, 'the detail strip is the visible second strip');

    // ACT — scroll deep into the detail (the move groups): the strip's
    // natural position has scrolled away, so it must pin
    await page.evaluate(() => {
      document.getElementById('dex-f-moves').scrollIntoView();
    });
    await waitForScrollSettle(page);
    const pin = await page.evaluate(() => {
      const strip = document.querySelector('#dex-species .section-nav');
      const header = document.getElementById('site-header');
      return {
        stripTop: strip.getBoundingClientRect().top,
        headerBottom: header.getBoundingClientRect().bottom,
      };
    });
    assert.ok(
      Math.abs(pin.stripTop - pin.headerBottom) <= 2,
      `mid-scroll the detail strip is pinned at the header's bottom (strip top ${pin.stripTop}px vs header bottom ${pin.headerBottom}px, 2px tolerance) — the base --site-header-h top`
    );

    // ACT — return to the overview: the detail (and its strip) unmounts
    await page.evaluate(() => {
      window.location.hash = '#dex-overview';
    });
    await page.waitForFunction(
      () => document.getElementById('dex-overview')?.hidden === false && document.querySelector('.dex-species') === null,
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const one = await page.evaluate(() => ({
      count: document.querySelectorAll('.section-nav').length,
      visible: document.querySelector('.section-nav')?.offsetParent !== null,
    }));
    assert.equal(one.count, 1, 'back in the overview there is exactly ONE strip — the detail strip is unmounted');
    assert.equal(one.visible, true, 'the remaining strip is the visible overview strip');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the detail strip is a single line, the page does not overflow, and a chip click still lands under the strip', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openDetailPage({ path: 'pokedex.html', width: 360, height: 720 });
  try {
    await openDetail(page);

    // ACT — measure the strip at 360 (the inherited one-line behavior:
    // nowrap + overflow-x auto, never re-declared for this strip)
    const narrow = await page.evaluate(() => {
      const strip = document.querySelector('#dex-species .section-nav');
      const chip = strip.querySelector('button.chip');
      return {
        stripH: strip.offsetHeight,
        chipH: chip.offsetHeight,
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    // ASSERT — single line + no page overflow
    assert.ok(
      narrow.stripH <= narrow.chipH + 25,
      `the detail strip is a single line at 360px (strip ${narrow.stripH}px vs chip ${narrow.chipH}px + 25px padding/hairline)`
    );
    assert.ok(
      !narrow.pageOverflows,
      `no horizontal page overflow at 360px (scrollWidth ${narrow.scrollWidth} ≤ 361)`
    );

    // ACT — a chip click (the Moves chip, deep in the detail) still
    // lands under the pinned strip
    await page.locator('#dex-species .section-nav button.chip[data-target="dex-f-moves"]').click();
    await waitForScrollSettle(page);
    const f = await jumpFacts(page, 'dex-f-moves');
    assert.equal(f.hash, DETAIL_HASH, 'the 360px chip click never writes the hash');
    assert.ok(
      Number.isFinite(f.targetTop) && f.targetTop >= f.stripBottom - 2 && f.targetTop < f.innerHeight,
      `the move groups (top ${f.targetTop}px) landed at/below the strip's bottom (${f.stripBottom}px) and inside the viewport`
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

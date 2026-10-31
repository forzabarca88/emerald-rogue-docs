/**
 * All-page render + console-error + content-count smoke suite (node --test,
 * zero deps; Playwright resolved by the harness).
 *
 * For each of the 10 served pages, at the site's default version
 * (data/site.json `defaultVersion` — currently "ex"), this asserts:
 *   1. zero console errors and zero pageerrors (a JS crash surfaces as a
 *      pageerror here — the existing e2e suite only fetches raw HTML and
 *      can never see one);
 *   2. the landmarks: `header .site-brand`, a `nav` (the header's
 *      site-nav), `main.page--<stem>` (the class is on the <main> element
 *      itself), exactly one `h1` in main with the page's title, and the
 *      footer inner that nav.js injects (`footer .site-footer__inner`);
 *   3. the data-derived DOM counts as LITERAL numbers — each expectation
 *      was derived from the cited data file AND the page's rendering code
 *      (site/js/pages/*.js), and every assertion message cites its source.
 *
 * The literals are derived for the "ex" default version (e.g. quests shows
 * all 232 records under ex but only the 138 shared ones under vanilla), so
 * the first test pins the default — if data/site.json's defaultVersion ever
 * changes, that test fails with an explanation instead of eight confusing
 * count failures below.
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before(), closeAll + server.close in after(), and each
 * test guards with skipIfNoPlaywright(t) (the suite self-skips on machines
 * without a Playwright install instead of failing `npm test`).
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

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/**
 * One page spec: the served path, the expected <h1> text, and the
 * data-derived checks. Each check is { sel, expected, why } for a DOM
 * element count, or { sel, text, why } for a live count line's rendered
 * text; `why` is the assertion message citing the data file + version the
 * literal comes from. Pages with no checks in the table are landmark-only
 * (the 404 page is static and renders no data records).
 */
const PAGES = [
  {
    stem: 'index',
    h1: site.hero.title, // home's <h1> is the hero title, not a nav page title
    counts: {
      quickLinkCards: {
        sel: 'main a.card--link',
        expected: 8,
        why: `data/site.json nav lists 9 pages; the home page (home.js) renders a quick-link card for every one except itself: 9 − 1 = 8`,
      },
      heroStats: {
        sel: '.hero__stat',
        expected: 4,
        why: 'data/site.json hero.stats has 4 entries (36 routes / 14 bosses / 60 safari slots / 9 quest groups)',
      },
      runPath: {
        sel: '.hero .run-path',
        expected: 1,
        why: 'the home hero carries exactly one run-path signature diagram (DESIGN.md §5.1, home.js RUN_PATH)',
      },
    },
  },
  {
    stem: 'gameplay',
    h1: site.pages.gameplay.title,
    counts: {
      roomCards: {
        sel: '#gp-rooms .grid > article.card',
        expected: 17,
        why: `data/adventure.json has 17 room-type records, all with versions [vanilla, ex] → all 17 render under version ${VERSION} (gameplay.js ROGUE.filter)`,
      },
      bossLadderItems: {
        sel: '.ladder__item',
        expected: 5,
        why: `data/adventure.json has 5 boss-ladder records (the 14-boss ladder grouped: Gym Leaders 8, Elite Four 4, Champion, Final Battle, Victory Lap), all version ${VERSION} (gameplay.js)`,
      },
      placementRows: {
        sel: '.placement__row',
        expected: 17,
        why: `data/adventure.json: all 17 room-type records carry a structured placement field (values re-encoded from each record's cited description), all versions [vanilla, ex] → one .placement__row per record under version ${VERSION} (gameplay.js placementRow)`,
      },
      placementBars: {
        sel: '.placement__bar',
        expected: 28,
        why: 'data/adventure.json: the 17 room-type placement fields hold 28 bars in total — rest stop 100/20/5/1 by count on path, honey tree + dark deal + lab 2 bars each (badge parity), wild den 4 + gap 3 bars (by tier), the other 10 rooms 1 bar each (gameplay.js placementBarLine)',
      },
    },
  },
  {
    stem: 'versions',
    h1: site.pages.versions.title,
    counts: {
      diffRows: {
        sel: '#version-diffs .diff',
        expected: 19,
        why: 'data/versions.json has 19 records; versions.js renders the whole master list as one .diff row per record, unfiltered by version',
      },
      overviewCells: {
        sel: '#version-overview .voverview__cell',
        expected: 10,
        why: 'data/versions.json: the 19 records span 10 distinct categories → versions.js renders one .voverview__cell per category (the cell set is version-independent; only the counts inside scope to the active build)',
      },
      overviewAnchors: {
        sel: '#version-diffs .diff[id]',
        expected: 10,
        why: 'data/versions.json: 10 distinct categories → versions.js gives the first row of each category its #vover-<category> anchor id',
      },
    },
  },
  {
    stem: 'quests',
    h1: site.pages.quests.title,
    counts: {
      displayGroups: {
        sel: '.quest-group',
        expected: 9,
        why: 'data/quests.json display_groups has 9 groups; quests.js renders every group as a .quest-group even when empty (the empty one shows its "No quests" note)',
      },
      questCards: {
        sel: '.quest-card',
        expected: 232,
        why: `data/quests.json has 232 records and all 232 include version ${VERSION} (138 shared + 94 EX-only) → 232 cards (quests.js ROGUE.filter)`,
      },
      groupChips: {
        sel: '.quest-chips a',
        expected: 9,
        why: 'quests.js renders one anchor chip per display group (9 in data/quests.json)',
      },
      emptyGroups: {
        sel: '.quest-group__empty',
        expected: 1,
        why: `under version ${VERSION} exactly one display group (starter_challenges) holds no quests, so exactly one group renders its "No quests in this group." note`,
      },
      resultLine: {
        sel: '#quest-result',
        text: '232 quests',
        why: 'the quest log\u2019s live count line shows "232 quests" under version ex (one per rendered card, quests.js bindSearch)',
      },
    },
  },
  {
    stem: 'config',
    h1: site.pages.config.title,
    counts: {
      modeCards: {
        sel: '.mode-card',
        expected: 3,
        why: 'data/game-modes.json has 3 game-mode records, all in both versions → 3 cards (config.js)',
      },
      presetCards: {
        sel: '#config-difficulty .set-grid > article.card',
        expected: 5,
        why: `data/settings.json has 5 preset records, all in both versions → 5 cards under version ${VERSION} (config.js)`,
      },
      toggleCards: {
        sel: '#config-toggles .set-grid > article.card',
        expected: 19,
        why: `data/settings.json has 19 toggle records, all 19 available in version ${VERSION} (12 under vanilla) → 19 cards (config.js ROGUE.filter)`,
      },
      rangeCards: {
        sel: '#config-ranges .set-grid > article.card',
        expected: 9,
        why: `data/settings.json has 9 range records, all in both versions → 9 cards under version ${VERSION} (config.js)`,
      },
      campaignPhrases: {
        sel: '.eggs li',
        expected: 7,
        why: "data/campaigns.json campaign-trigger record lists 7 hidden phrases ('SMALL HOLIDAY'…'PLEASE MISS'), one .eggs row each (config.js parsePhrases)",
      },
      diffLadderCells: {
        sel: '#difficulty-scale .diff-ladder__cell',
        expected: 14,
        why: 'data/settings.json difficulty-scale prose: ladder.stages spans 0–13 → 14 numbered stage cells (config.js difficultyLadder)',
      },
      ruleAssemblySteps: {
        sel: '#config-modes .step-strip__step',
        expected: 4,
        why: 'data/game-modes.json rule-application prose: 4 steps → 4 step-strip steps under the mode cards (config.js stepStrip)',
      },
    },
  },
  {
    stem: 'hub',
    h1: site.pages.hub.title,
    counts: {
      areaCards: {
        sel: '.area-card',
        expected: 11,
        why: 'data/hub.json has 60 records split by category: 11 hub-area records → 11 .area-card (hub.js ROGUE.byCategory), all in both versions',
      },
      areaMapBlocks: {
        sel: '#hub-areas .hub-map__block',
        expected: 11,
        why: 'data/hub.json: 11 hub-area records → 11 blocks in the area overview map, one per record across the three access tiers (hub.js areaMap), all in both versions',
      },
      areaMapLinks: {
        sel: '#hub-areas .hub-map__link',
        expected: 3,
        why: 'data/hub.json: the 4 initially-present areas form the starting chain (the intro prose lists them in the same order as the records) → 3 connecting arrows between the 4 built blocks (hub.js areaMap)',
      },
      upgradeCards: {
        sel: '.hub-upgrade',
        expected: 48,
        why: 'data/hub.json: 48 hub-upgrade records → 48 .hub-upgrade cards (hub.js), all in both versions',
      },
      upgradeBarRows: {
        sel: '#hub-upgrades .hub-bars__row',
        expected: 11,
        why: 'data/hub.json: 11 hub-area records → 11 per-area upgrade-count bars (hub.js upgradeBars, counts from the 48 upgrades\' `area` field, including the 2 areas with no upgrades in the shop list)',
      },
      cycleCells: {
        sel: '.hub-cycles__cell',
        expected: 8,
        why: 'data/hub.json time-weather-season `cycles` field: 4 time-of-day codes + 4 seasons → 8 cycle cells (hub.js cycleStrip)',
      },
      decorCards: {
        sel: '#hub-decor article.card',
        expected: 1,
        why: 'data/hub.json: 1 home-decor record → 1 card in the Home Base section (hub.js); 11 + 48 + 1 = 60 records total',
      },
    },
  },
  {
    stem: 'safari',
    h1: site.pages.safari.title,
    counts: {
      poolCells: {
        sel: '.safari-slots__cell',
        expected: 60,
        why: 'data/safari.json pool-slot-layout: slots 0–44 regular (45) + 45–59 legendary (15) → 60 one-cell-per-slot diagram cells (safari.js slotDiagram parses the ranges from the record)',
      },
      entryCards: {
        sel: '.safari-entry article.card',
        expected: 4,
        why: 'data/safari.json has 4 entry-criterion records → 4 stacked cards (safari.js)',
      },
      entryFlowEvents: {
        sel: '.safari-entry-flow__event',
        expected: 4,
        why: 'data/safari.json has 4 entry-criterion records → 4 event rows in the entry-flow diagram (safari.js entryFlow, one row per filtered record: name + `short`)',
      },
      scoreTerms: {
        sel: '.equation__term',
        expected: 2,
        why: 'data/safari.json priority-eviction record carries a 2-chip `score.terms` array (level-gain formula, shiny +30) → 2 .equation__term chips (safari.js scoreEquation)',
      },
      evictionSteps: {
        sel: '.step-strip__step',
        expected: 4,
        why: 'data/safari.json priority-eviction record carries a 4-step `eviction` array → 4 numbered step-strip cells (safari.js stepStrip)',
      },
      caveSteps: {
        sel: '.safari-steps li',
        expected: 8,
        why: 'data/safari.json legends-cave record has 8 steps → 8 numbered list items (safari.js stepsList)',
      },
      recordCards: {
        sel: '#safari-pool article.card, #safari-priority article.card, #safari-legends article.card, #safari-sign article.card',
        expected: 4,
        why: 'data/safari.json renders one cited card per record — the 4 entry-criterion cards above plus one each for pool-slot-layout, priority-eviction, legends-cave and pool-sign (8 cards total; this check covers the 4 non-entry cards)',
      },
    },
  },
  {
    stem: 'routes',
    h1: site.pages.routes.title,
    counts: {
      routeCards: {
        sel: '.route-card',
        expected: 36,
        why: 'data/routes.json has 36 routes (12 Hoenn, 6 Kanto, 6 Johto, 12 Sinnoh), all in both versions → 36 cards under the "all" region filter (routes.js)',
      },
      regionBlocks: {
        sel: '.routes-region',
        expected: 4,
        why: 'data/routes.json uses 4 regions (Hoenn, Kanto, Johto, Sinnoh) → 4 grouped blocks (routes.js uniqueValues("region"))',
      },
      filterButtons: {
        sel: '.routes-filter__btn',
        expected: 5,
        why: 'routes.js renders the "All" filter button plus one per region: 1 + 4 = 5',
      },
      terrainChips: {
        sel: '#routes-types .chip-row .chip',
        expected: 7,
        why: 'data/routes.json records use 7 distinct terrains (Field, Forest, Cave, Mountain, WaterFront, Urban, Island) → one chip each (routes.js uniqueValues("terrain"))',
      },
      matrixCells: {
        sel: '#routes-table .route-matrix__row--region [data-terrain]',
        expected: 24,
        why: 'data/routes.json: 4 regions × the 6 terrain columns from the type-taxonomy block’s structured terrains field ("Field, Forest, Cave, Mountain, WaterFront, Urban") → 24 count cells; the row totals (12/6/6/12) add up to all 36 routes (routes.js routeMatrix)',
      },
      matrixRows: {
        sel: '#routes-table .route-matrix__row',
        expected: 5,
        why: 'the region × terrain matrix renders one head row plus one row per region: 1 + 4 = 5 (routes.js routeMatrix)',
      },
      subTypeRollRows: {
        sel: '.cat-roll__row',
        expected: 2,
        why: 'data/routes.json calm-average-tough block has 2 roll phases (difficulty 0–8: 3/4/1, 9+: 0/1/8) → one stacked bar row each (routes.js catRollVisual)',
      },
      subTypeRollSegments: {
        sel: '.cat-roll__seg',
        expected: 5,
        why: 'the two roll phases render a segment per NON-ZERO weight: 3 (3/4/1) + 2 (0/1/8 — calm 0 renders no segment) = 5 (routes.js catRollVisual)',
      },
      subTypeStripRows: {
        sel: '.cat-strip__row',
        expected: 6,
        why: 'data/routes.json calm-average-tough block has 6 values rows (grass, water, trainer spawn, item drop, item rarity, themed weather) → 6 comparison-strip rows (routes.js catStripVisual)',
      },
      countLine: {
        sel: '#routes-count',
        text: '36 routes across all 4 regions',
        why: 'the routes count line reads "36 routes across all 4 regions" under the "all" filter (routes.js applyRegion)',
      },
    },
  },
  {
    stem: 'mechanics',
    h1: site.pages.mechanics.title,
    counts: {
      charmCards: {
        sel: '.mech-duo__col:nth-child(1) article.card',
        expected: 17,
        why: `data/charms.json has 17 charm records, all in both versions → 17 cards in the Charms column under version ${VERSION} (mechanics.js duoColumn)`,
      },
      curseCards: {
        sel: '.mech-duo__col:nth-child(2) article.card',
        expected: 26,
        why: `data/charms.json has 26 curse records, all in both versions → 26 cards in the Curses column under version ${VERSION} (mechanics.js duoColumn)`,
      },
      mechCards: {
        sel: '.mech-card',
        expected: 98,
        why: `every record card on the page under version ${VERSION}: 43 charms.json + 13 followmons.json + 10 gameshow.json + 8 timeofday.json (includes the 1 EX-only seasonal-species record) + 14 unique-mons.json + 10 campaigns.json = 98 (mechanics.js grid)`,
      },
      stackRows: {
        sel: '.stacks__row',
        expected: 10,
        why: `data/charms.json has 10 records with a capped stack field (5 charms + 5 curses: flinch, shed-skin, grace, priority, endure) → 10 stacking/cap chart rows under version ${VERSION} (mechanics.js stacksHtml)`,
      },
      nettingBars: {
        sel: '.netting__bar',
        expected: 2,
        why: `the netting example plots one bar each for the Catching Charm and the Catching Curse records (data/charms.json stack.per 200 / 40) → 2 bars under version ${VERSION} (mechanics.js nettingHtml)`,
      },
    },
  },
  {
    stem: '404',
    h1: 'Page not found', // static shell — not in data/site.json pages
    counts: {},
  },
];

test('the default version is "ex" (every literal count in this suite is derived from it)', () => {
  assert.equal(
    site.defaultVersion,
    'ex',
    'data/site.json defaultVersion changed — the literal DOM counts in test/ui/smoke.test.mjs are derived for "ex"; re-derive them for the new default before proceeding'
  );
});

for (const spec of PAGES) {
  test(`${spec.stem === '404' ? '404.html' : `${spec.stem}.html`} renders at the default version: no errors, all landmarks, data-derived counts`, async (t) => {
    if (skipIfNoPlaywright(t)) return;
    const { page, errors, close } = await openPage({ path: `${spec.stem}.html` });
    try {
      // Zero console errors + pageerrors first: a pageerror carries the
      // actual JS exception, which is the useful signal when the DOM
      // assertions below would otherwise fail with bare count mismatches.
      assert.deepEqual(
        errors,
        [],
        `${spec.stem}.html (version ${VERSION}): expected zero console errors and pageerrors, got: ${errors.join(' | ')}`
      );

      // Landmarks: the header brand + nav and the footer inner are injected
      // by nav.js into the shells' empty <header id="site-header"> /
      // <footer id="site-footer">; <main class="page page--<stem>"> and the
      // page <h1> belong to the shell (page scripts replace main.innerHTML
      // only, keeping the page--<stem> class on the <main> element itself).
      const landmarkSels = {
        brand: 'header .site-brand',
        nav: 'nav',
        main: `main.page--${spec.stem}`,
        h1: `main.page--${spec.stem} h1`,
        footer: 'footer .site-footer__inner',
      };
      const pageSels = { ...landmarkSels };
      for (const [key, c] of Object.entries(spec.counts)) pageSels[key] = c.sel;
      const result = await page.evaluate((sels) => {
        const out = {};
        for (const [key, sel] of Object.entries(sels)) out[key] = document.querySelectorAll(sel).length;
        const h1 = document.querySelector(sels.h1);
        out.h1Text = h1 ? h1.textContent.trim() : null;
        return out;
      }, pageSels);

      assert.equal(result.brand, 1, `${spec.stem}.html: expected exactly one header .site-brand (nav.js), found ${result.brand}`);
      assert.ok(result.nav >= 1, `${spec.stem}.html: expected at least one <nav> (the header site-nav), found ${result.nav}`);
      assert.equal(result.main, 1, `${spec.stem}.html: expected exactly one main.page--${spec.stem}, found ${result.main}`);
      assert.equal(result.h1, 1, `${spec.stem}.html: expected exactly one <h1> in main, found ${result.h1}`);
      assert.equal(
        result.h1Text,
        spec.h1,
        `${spec.stem}.html: h1 text is ${JSON.stringify(result.h1Text)}, expected ${JSON.stringify(spec.h1)} (from data/site.json)`
      );
      assert.equal(result.footer, 1, `${spec.stem}.html: expected exactly one footer .site-footer__inner (nav.js), found ${result.footer}`);

      // Data-derived DOM counts — literal expectations, each citing its
      // data file + version (see PAGES above).
      for (const [key, c] of Object.entries(spec.counts)) {
        if (typeof c.text === 'string') {
          // live count lines: assert on the rendered text, not a DOM count
          const text = await page.locator(c.sel).first().textContent();
          assert.equal(
            (text || '').trim(),
            c.text,
            `${spec.stem}.html ${c.sel}: expected ${JSON.stringify(c.text)}; ${c.why}`
          );
          continue;
        }
        assert.equal(result[key], c.expected, `${spec.stem}.html ${c.sel}: expected ${c.expected}; ${c.why}`);
      }
    } finally {
      await close();
    }
  });
}

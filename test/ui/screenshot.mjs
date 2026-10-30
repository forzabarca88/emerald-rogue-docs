#!/usr/bin/env node
/**
 * Standalone screenshot-capture tool for the docs site (node builtins only —
 * Playwright is resolved by the harness and is the same deliberate exception
 * to the zero-dependency rule as the UI test suites).
 *
 * Captures the full grid to test/ui/screenshots/ (gitignored working
 * artifacts, never committed):
 *   every page × version × viewport width × state
 *   pages:   index, gameplay, versions, quests, config, hub, safari, routes,
 *            mechanics, 404
 *   version: vanilla, ex (passed as the ?version= one-time override)
 *   width:   1280, 360
 *   state:   plain        → <page>-<version>-<width>.png
 *            search       → <page>-<version>-<width>-search.png — the
 *                           site-wide search palette open with the fixed
 *                           deterministic query SEARCH_QUERY typed through
 *                           the keyboard (the real trigger-open/type/render
 *                           path, no state fakery)
 *            search-empty → <page>-<version>-<width>-search-empty.png —
 *                           index only: the palette open on an empty query
 *                           (input focused, the data/site.json hint shown)
 *
 * SEARCH_QUERY is fixed so the grid is deterministic and comparable across
 * runs; it matches both titles and body text, and the result set is
 * site-wide, so it is the same healthy list on every page — only the
 * version scopes it (5 rows under EX, 3 under Vanilla with the current
 * data, so the pair of captures also shows the version scoping). The
 * per-version expected count is DERIVED at startup by running the real
 * site index (site/js/data.js + render.js + search-index.js over the real
 * data/*.json in a node:vm sandbox — the same no-mock setup
 * test/search.test.mjs uses), and each search-state capture settles on the
 * EXACT count line the index predicts for that version: a render that
 * disagrees with the index fails the run instead of capturing a
 * mid-flight state.
 *
 * 404.html is a real file under dist/: the shared static server returns a
 * bare 404 for missing paths (no 404.html fallback of its own), so the 404
 * page is captured by navigating to 404.html directly — the same way
 * test/ui/smoke.test.mjs does.
 *
 * Every screenshot is fullPage: true — the simplest sensible rule: long
 * pages (quests, mechanics, hub, …) need the full scroll height, and
 * full-page capture of the shorter pages is harmless. The fixed palette
 * overlay behaves in full-page captures: the backdrop dims the whole
 * document, the panel sits below the sticky header (the header is z-ordered
 * ABOVE the backdrop by design — the version toggle stays reachable while
 * the palette is open).
 *
 * Before EVERY capture — plain and palette states alike — the tool settles
 * the entrance motion (DESIGN.md §7: the ≤480ms header/page fade, plus the
 * ≤120ms palette drop for the palette states): the computed opacity of
 * #site-header and .page — and .search-palette__panel for the palette
 * states — must be the final 1 (instant under prefers-reduced-motion, where
 * the kill switch makes the wait a no-op). The probe polls on rAF with a
 * ~2s bound, so a plain capture can never go out as a mid-fade image; a
 * settle that cannot complete fails the run.
 *
 * Exit contract:
 *   - Playwright absent → print the harness SKIP_MESSAGE verbatim and exit 0
 *     (a standalone script cannot t.skip(), so this mirrors the harness
 *     self-skip contract for npm-run invocation).
 *   - Any capture failure (page-load/readiness, entrance-settle timeout or
 *     screenshot error) or any collected console/page error (a non-empty
 *     `errors` array) → print every failure and exit 1.
 *   - Otherwise → print a summary line (count + grid + output dir) and exit 0.
 * The process always exits cleanly: every context plus the shared browser
 * (closeAll()) and the static server are awaited closed before exit.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { startServer, openPage, closeAll, resolvePlaywright, SKIP_MESSAGE } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'test', 'ui', 'screenshots');

const PAGES = ['index', 'gameplay', 'versions', 'quests', 'config', 'hub', 'safari', 'routes', 'mechanics', '404'];
const VERSIONS = ['vanilla', 'ex'];
const WIDTHS = [1280, 360];
const HEIGHT = 800;

/**
 * The fixed palette query for the -search states: it matches both titles
 * (the "Mega Evolution" quest, the versions-diffs record) and body text,
 * and yields a healthy result set on every page (the result is site-wide —
 * the version is the only scope). The per-version COUNTS for it are derived
 * at startup (deriveSearchCounts), never hardcoded.
 */
const SEARCH_QUERY = 'mega evolution';
/** The pages that also capture the empty-query state (…-search-empty.png). */
const EMPTY_QUERY_PAGES = ['index'];
/** Bounded settle timeout for every state wait (a bound, not a sleep). */
const SETTLE_TIMEOUT_MS = 10_000;
/** Bounded settle timeout for the entrance-motion probe (~4× the 480ms fade). */
const ENTRANCE_SETTLE_TIMEOUT_MS = 2_000;

/** First line of an error's message, capped — keeps failure output readable. */
const brief = (err) => String(err && err.message ? err.message : err).split('\n')[0].slice(0, 300);

/** data/site.json search.hint — the empty-query text the -search-empty states settle on. */
const HINT = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8')).search.hint;

/**
 * The expected SEARCH_QUERY result count per version — the real index, not
 * a literal: site/js/data.js + render.js + search-index.js run over the
 * real data/*.json in a node:vm sandbox with a fake window (the same
 * no-mock setup as test/search.test.mjs). A data edit that changes the
 * count re-derives here automatically; a browser render that disagrees with
 * the index fails the capture instead of going stale.
 */
function deriveSearchCounts() {
  const dataDir = path.join(root, 'data');
  const window = { ROGUE_DATA_SITE: JSON.parse(readFileSync(path.join(dataDir, 'site.json'), 'utf8')) };
  for (const f of readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort()) {
    if (f === 'site.json') continue;
    window['ROGUE_DATA_' + f.replace(/\.json$/, '').toUpperCase()] = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
  }
  const sandbox = { window };
  vm.createContext(sandbox);
  for (const mod of ['data', 'render', 'search-index']) {
    vm.runInContext(readFileSync(path.join(root, 'site', 'js', mod + '.js'), 'utf8'), sandbox, { filename: mod + '.js' });
  }
  const entries = sandbox.window.ROGUE.buildSearchIndex();
  const counts = {};
  for (const version of VERSIONS) counts[version] = sandbox.window.ROGUE.searchQuery(entries, SEARCH_QUERY, version).length;
  return counts;
}

/** The count-line text site/js/search.js renders for a settled query (its copy contract). */
function expectedCountText(n, query) {
  return n === 0
    ? 'No results match \u201C' + query + '\u201D.'
    : n + ' result' + (n === 1 ? '' : 's') + ' match \u201C' + query + '\u201D';
}

/**
 * Settle on the entrance motion being finished — for EVERY capture, plain
 * and palette states alike. The probe is the computed opacity of the
 * animating elements (base.css: #site-header and .page run the 480ms
 * --motion-slow fade on load; the palette states additionally probe the
 * panel's ≤120ms drop, passed via `extra`): all must be the final 1 (instant
 * under prefers-reduced-motion, where the kill switch makes the probe a
 * no-op). Polls on rAF, bounded to ~2s; throws on timeout — a capture that
 * cannot settle is a failure, never a mid-fade image.
 */
async function settleEntrance(page, extra = []) {
  await page.waitForFunction(
    (selectors) =>
      selectors.every((sel) => {
        const el = document.querySelector(sel);
        return el !== null && getComputedStyle(el).opacity === '1';
      }),
    ['#site-header', '.page', ...extra],
    { timeout: ENTRANCE_SETTLE_TIMEOUT_MS }
  );
}

/**
 * Settle on the palette being open: root unhidden, the input holding focus,
 * and the entrance motion finished (settleEntrance, plus the panel's
 * opacity at the final 1). Throws on timeout; the caller reports the file.
 */
async function waitForPaletteOpen(page) {
  await settleEntrance(page, ['.search-palette__panel']);
  await page.waitForFunction(
    () => {
      const root = document.getElementById('search-palette');
      if (!root || root.hidden) return false;
      const input = document.querySelector('.search-palette__input');
      return document.activeElement === input;
    },
    null,
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

/** Settle on the exact count line + row count the real index predicts for the version. */
async function waitForQuerySettled(page, n) {
  await page.waitForFunction(
    ({ expected, n }) => {
      const count = document.querySelector('.search-palette__count');
      const rows = document.querySelectorAll('#search-palette-list .search-palette__row').length;
      return Boolean(count) && count.hidden === false && count.textContent.trim() === expected && rows === n;
    },
    { expected: expectedCountText(n, SEARCH_QUERY), n },
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

/** Settle on the empty-query state: the config hint shown, count line and list hidden. */
async function waitForEmptyQuerySettled(page, hint) {
  await page.waitForFunction(
    (hint) => {
      const empty = document.querySelector('.search-palette__empty');
      const count = document.querySelector('.search-palette__count');
      const list = document.getElementById('search-palette-list');
      return (
        Boolean(empty) && empty.hidden === false && empty.textContent.trim() === hint &&
        Boolean(count) && count.hidden === true &&
        Boolean(list) && list.hidden === true
      );
    },
    hint,
    { timeout: SETTLE_TIMEOUT_MS }
  );
}

if (!resolvePlaywright()) {
  console.log(SKIP_MESSAGE);
  process.exit(0);
}

let searchCounts;
try {
  searchCounts = deriveSearchCounts();
} catch (err) {
  console.error(`failed to derive the search-palette result counts from the real index — ${brief(err)}`);
  process.exit(1);
}

const server = await startServer();
const failures = [];
let captured = 0;

/**
 * One search-palette capture: a fresh page load (the same rule as the plain
 * captures), the palette opened via the header trigger, then either
 * SEARCH_QUERY typed through the keyboard or the empty-query state — each
 * settled on its deterministic end state before the fullPage screenshot.
 * Pushes failures and counts captures via the closure counters.
 */
async function capturePaletteState({ pageName, version, width, suffix, query }) {
  const file = `${pageName}-${version}-${width}-${suffix}.png`;
  let opened = null;
  try {
    opened = await openPage({ path: `${pageName}.html`, version, width, height: HEIGHT });
  } catch (err) {
    failures.push(`${file}: page load/readiness failed — ${brief(err)}`);
    return;
  }
  try {
    await opened.page.click('#site-search-trigger');
    await waitForPaletteOpen(opened.page);
    if (query === null) {
      await waitForEmptyQuerySettled(opened.page, HINT);
    } else {
      await opened.page.keyboard.type(query);
      await waitForQuerySettled(opened.page, searchCounts[version]);
    }
    await opened.page.screenshot({ path: path.join(outDir, file), fullPage: true });
    captured += 1;
    console.log(`  captured ${file}`);
  } catch (err) {
    failures.push(`${file}: ${suffix} state failed — ${brief(err)}`);
  } finally {
    await opened.close();
  }
  for (const error of opened.errors) failures.push(`${file}: ${error}`);
}

/** The full grid: 10×2×2 plain + 10×2×2 search states + 1×2×2 empty-query states. */
const TOTAL = PAGES.length * VERSIONS.length * WIDTHS.length * 2 + EMPTY_QUERY_PAGES.length * VERSIONS.length * WIDTHS.length;

try {
  mkdirSync(outDir, { recursive: true });
  for (const page of PAGES) {
    for (const version of VERSIONS) {
      for (const width of WIDTHS) {
        const file = `${page}-${version}-${width}.png`;
        let opened = null;
        try {
          opened = await openPage({ path: `${page}.html`, version, width, height: HEIGHT });
        } catch (err) {
          failures.push(`${file}: page load/readiness failed — ${brief(err)}`);
          continue; // any open context is reaped by closeAll() below
        }
        try {
          // the plain capture must not fire mid-fade: settle the 480ms
          // header/page entrance before the fullPage screenshot
          await settleEntrance(opened.page);
          await opened.page.screenshot({ path: path.join(outDir, file), fullPage: true });
          captured += 1;
          console.log(`  captured ${file}`);
        } catch (err) {
          failures.push(`${file}: capture failed — ${brief(err)}`);
        } finally {
          await opened.close();
        }
        for (const error of opened.errors) failures.push(`${file}: ${error}`);

        // the search-palette states (every cell): the palette open with the
        // fixed SEARCH_QUERY, and (index only) the empty-query state
        await capturePaletteState({ pageName: page, version, width, suffix: 'search', query: SEARCH_QUERY });
        if (EMPTY_QUERY_PAGES.includes(page)) {
          await capturePaletteState({ pageName: page, version, width, suffix: 'search-empty', query: null });
        }
      }
    }
  }
} finally {
  await closeAll();
  await server.close();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(
    `screenshot capture FAILED: ${failures.length} failure(s) across ${captured}/${TOTAL} captures`
  );
  process.exit(1);
}

console.log(
  `captured ${captured} screenshots (${PAGES.length} pages × ${VERSIONS.length} versions × ${WIDTHS.length} widths × 2 states: plain + search-palette with ${JSON.stringify(SEARCH_QUERY)}, plus the empty-query palette state on ${EMPTY_QUERY_PAGES.join(', ')}) → ${path.relative(root, outDir)}/`
);
process.exit(0);

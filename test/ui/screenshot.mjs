#!/usr/bin/env node
/**
 * Standalone screenshot-capture tool for the docs site (node builtins only —
 * Playwright is resolved by the harness and is the same deliberate exception
 * to the zero-dependency rule as the UI test suites).
 *
 * Captures the full grid to test/ui/screenshots/ (gitignored working
 * artifacts, never committed):
 *   every page × version × viewport width
 *   pages:   index, gameplay, versions, quests, config, hub, safari, routes,
 *            mechanics, 404
 *   version: vanilla, ex (passed as the ?version= one-time override)
 *   width:   1280, 360
 *   file:    <page>-<version>-<width>.png
 *
 * 404.html is a real file under dist/: the shared static server returns a
 * bare 404 for missing paths (no 404.html fallback of its own), so the 404
 * page is captured by navigating to 404.html directly — the same way
 * test/ui/smoke.test.mjs does.
 *
 * Every screenshot is fullPage: true — the simplest sensible rule: long
 * pages (quests, mechanics, hub, …) need the full scroll height, and
 * full-page capture of the shorter pages is harmless.
 *
 * Exit contract:
 *   - Playwright absent → print the harness SKIP_MESSAGE verbatim and exit 0
 *     (a standalone script cannot t.skip(), so this mirrors the harness
 *     self-skip contract for npm-run invocation).
 *   - Any capture failure (page-load/readiness or screenshot error) or any
 *     collected console/page error (a non-empty `errors` array) → print every
 *     failure and exit 1.
 *   - Otherwise → print a summary line (count + grid + output dir) and exit 0.
 * The process always exits cleanly: every context plus the shared browser
 * (closeAll()) and the static server are awaited closed before exit.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, SKIP_MESSAGE } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'test', 'ui', 'screenshots');

const PAGES = ['index', 'gameplay', 'versions', 'quests', 'config', 'hub', 'safari', 'routes', 'mechanics', '404'];
const VERSIONS = ['vanilla', 'ex'];
const WIDTHS = [1280, 360];
const HEIGHT = 800;

/** First line of an error's message, capped — keeps failure output readable. */
const brief = (err) => String(err && err.message ? err.message : err).split('\n')[0].slice(0, 300);

if (!resolvePlaywright()) {
  console.log(SKIP_MESSAGE);
  process.exit(0);
}

const server = await startServer();
const failures = [];
let captured = 0;

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
          await opened.page.screenshot({ path: path.join(outDir, file), fullPage: true });
          captured += 1;
          console.log(`  captured ${file}`);
        } catch (err) {
          failures.push(`${file}: screenshot failed — ${brief(err)}`);
        } finally {
          await opened.close();
        }
        for (const error of opened.errors) failures.push(`${file}: ${error}`);
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
    `screenshot capture FAILED: ${failures.length} failure(s) across ${captured}/${PAGES.length * VERSIONS.length * WIDTHS.length} captures`
  );
  process.exit(1);
}

console.log(
  `captured ${captured} screenshots (${PAGES.length} pages × ${VERSIONS.length} versions × ${WIDTHS.length} widths) → ${path.relative(root, outDir)}/`
);
process.exit(0);

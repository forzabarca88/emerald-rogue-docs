/**
 * Zero-npm-dependency Playwright driver for the UI test files in test/ui/.
 * Node builtins only; Playwright itself is resolved at run time and is the
 * single deliberate exception to the project's zero-dependency rule (it is
 * test tooling, never shipped with the site).
 *
 * Resolution order — resolvePlaywright():
 *   1. local install:  createRequire(import.meta.url)('playwright')
 *   2. global install: createRequire(<npm root -g>/__noop.js)('playwright')
 *   3. null            — a missing Playwright is never an error here; the UI
 *                        tests self-skip instead (keeping `npm test` green on
 *                        machines without it) — EXCEPT under CI with
 *                        PLAYWRIGHT_REQUIRED set (the ci `ui` job sets it):
 *                        there a skip would silently no-op the browser gate,
 *                        so the guard throws the install message instead.
 * PLAYWRIGHT_GLOBAL_ROOT (env), when set, overrides the `npm root -g` lookup
 * (tests point it at an empty dir to simulate an absent install — see
 * test/ui/harness-skip.test.mjs).
 * PLAYWRIGHT_REQUIRED (env), when set together with CI, turns the skip path
 * into a hard failure (the ci `ui` job's gate).
 *
 * Skip contract — mirrors the self-skip pattern of test/citations.test.mjs
 * (node 24: t.skip() does not stop execution, so the test must return).
 * Every UI test file is shaped like:
 *
 *   import { test, before, after } from 'node:test';
 *   import { startServer, openPage, closeAll, skipIfNoPlaywright } from './harness.mjs';
 *
 *   let server;
 *   before(async () => { server = await startServer(); });
 *   after(async () => {
 *     await closeAll();          // browser + any stray contexts (no-op if none)
 *     if (server) await server.close();
 *   });
 *
 *   test('a page renders cleanly', async (t) => {
 *     if (skipIfNoPlaywright(t)) return;   // skips with the exact install message
 *     const { page, errors, close } = await openPage({ path: 'index.html' });
 *     try {
 *       ...assertions...
 *       assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
 *     } finally {
 *       await close();
 *     }
 *   });
 *
 * Lifecycle:
 * - one shared chromium launch per test file (process): the first openPage()
 *   call launches lazily, later calls reuse it; closeAll() ends it.
 * - each openPage() creates a fresh context with
 *   { viewport: { width, height }, javaScriptEnabled: js } and collects
 *   console messages of type "error" plus pageerror events into `errors`.
 * - startServer() serves dist/ on an ephemeral port (port 0, bound port read
 *   back from the server) and runs the build first when dist/index.html is
 *   missing; the build is atomic (scripts/build.mjs builds to a temp dir then
 *   renames), so this is safe under node --test's concurrent test files.
 * - openPage() waits for readiness with a 10s timeout per wait: for js=true,
 *   until window.ROGUE is defined AND the page has rendered its landmarks
 *   (header .site-brand plus a non-empty <main>); for js=false (no-JS
 *   fallback checks) until DOMContentLoaded only, since JS-injected
 *   landmarks legitimately never appear.
 */
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../helpers/static-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(root, 'dist');

/** The exact skip message every UI test file reports when Playwright is absent. */
export const SKIP_MESSAGE =
  'Playwright not installed — npm i -g playwright && npx playwright install chromium';

/** Timeout (ms) for each readiness wait in openPage(). */
const READY_TIMEOUT_MS = 10_000;

function tryRequire(req) {
  try {
    return req('playwright');
  } catch {
    return null;
  }
}

/**
 * Resolves the Playwright module (local install first, then the global one
 * under `npm root -g`); returns null when neither is available. Never throws
 * for a missing install — an unavailable `npm` also resolves to null.
 */
export function resolvePlaywright() {
  const local = tryRequire(createRequire(import.meta.url));
  if (local) return local;
  try {
    const globalRoot =
      process.env.PLAYWRIGHT_GLOBAL_ROOT || execSync('npm root -g', { encoding: 'utf8' }).trim();
    return tryRequire(createRequire(path.join(globalRoot, '__noop.js')));
  } catch {
    return null;
  }
}

/** Resolved Playwright, cached per process (undefined = not resolved yet). */
let cachedPw;
function playwright() {
  if (cachedPw === undefined) cachedPw = resolvePlaywright();
  return cachedPw;
}

/**
 * Self-skip guard for the skip contract above: marks the test skipped with
 * SKIP_MESSAGE and returns true when Playwright is absent (the test must
 * `return` — node 24's t.skip() does not stop execution); returns false when
 * Playwright is present so the test proceeds. Under CI with PLAYWRIGHT_REQUIRED
 * (the ci `ui` job) an absent Playwright THROWS the install message instead —
 * a skip there would silently no-op the gate.
 */
export function skipIfNoPlaywright(t) {
  if (playwright()) return false;
  if (process.env.CI && process.env.PLAYWRIGHT_REQUIRED) throw new Error(SKIP_MESSAGE);
  t.skip(SKIP_MESSAGE);
  return true;
}

/**
 * Runs the project build (`node scripts/build.mjs`) ONLY when
 * dist/index.html is absent; the atomic build (A1) makes concurrent
 * invocations under node --test safe. Propagates a build failure as an error
 * carrying the build's stdout/stderr.
 */
export function buildIfMissing() {
  if (existsSync(path.join(distDir, 'index.html'))) return;
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(
      `site build failed (exit ${result.status ?? 'null'}):\n${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`
    );
  }
}

let baseUrl = null;

/**
 * Serves dist/ over the shared static server on an ephemeral port (port 0;
 * the bound port is read back from the server). Builds first if missing.
 * Returns { url, close }; `url` is the base openPage() navigates against.
 */
export async function startServer() {
  buildIfMissing();
  const server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { url: baseUrl, close: () => new Promise((resolve) => server.close(resolve)) };
}

let browserPromise = null;
const openContexts = new Set();

async function sharedBrowser() {
  const pw = playwright();
  if (!pw) throw new Error(SKIP_MESSAGE);
  if (!browserPromise) {
    try {
      browserPromise = Promise.resolve(await pw.chromium.launch());
    } catch (err) {
      // an unlaunchable browser (missing binary) is as much an absent
      // install as a missing module — fail loudly with the install message
      const detail = err && err.message ? String(err.message).split('\n')[0] : String(err);
      throw new Error(`${SKIP_MESSAGE} — the browser launch failed: ${detail.slice(0, 300)}`);
    }
  }
  return browserPromise;
}

/**
 * after-hook friendly cleanup: closes every context still open and the
 * shared browser. Idempotent — a no-op (not an error) when nothing was
 * opened, e.g. on a machine without Playwright.
 */
export async function closeAll() {
  const contexts = [...openContexts];
  openContexts.clear();
  await Promise.allSettled(contexts.map((context) => context.close()));
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    browserPromise = null;
    if (browser) await browser.close();
  }
}

/**
 * Opens a served site page in a fresh context (one shared browser launch per
 * test file — see module header). `version` appends ?version=<version> when
 * set. Waits for readiness (see module header). Returns { page, context,
 * errors, close }; close() closes the context (and its page).
 */
export async function openPage({ path: pagePath = 'index.html', version, width = 1280, height = 800, js = true } = {}) {
  if (!baseUrl) throw new Error('openPage() called before startServer() (see the harness header for the file shape)');
  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    javaScriptEnabled: js,
  });
  openContexts.add(context);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err instanceof Error ? err.message : String(err)}`);
  });

  const url = new URL(pagePath, baseUrl);
  if (version) url.searchParams.set('version', version);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  if (js) {
    await page.waitForFunction(
      () => typeof window.ROGUE !== 'undefined',
      null,
      { timeout: READY_TIMEOUT_MS }
    );
    await page.waitForSelector('header .site-brand', { timeout: READY_TIMEOUT_MS });
    await page.waitForFunction(
      () => (document.querySelector('main')?.textContent || '').trim().length > 0,
      null,
      { timeout: READY_TIMEOUT_MS }
    );
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    openContexts.delete(context);
    await context.close();
  };
  return { page, context, errors, close };
}

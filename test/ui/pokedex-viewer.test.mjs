/**
 * The 3D species viewer (issue #79) — laziness, determinism and context
 * discipline (node --test, zero deps; Playwright resolved by the harness).
 *
 * The viewer is a billboard turntable of the in-game sprite in the Pokedex
 * species detail (DESIGN.md §7): the vendored three.js
 * (./vendor/three.min.js) is deferred-injected only when a detail first
 * opens, the reduced-motion end state is exactly one static frame (no rAF
 * loop — deterministic), and the static <img> stays as the no-WebGL
 * fallback with the same box (no layout shift).
 *
 * Coverage:
 *   1. laziness — pokedex.html with NO selection: no <canvas> in the DOM
 *      AND ./vendor/three.min.js was never requested (the page's request
 *      log, via performance resource entries — nothing extra loads).
 *   2. deterministic render — prefers-reduced-motion: reduce + a deep link
 *      to a concrete SHARED species (pikachu): zero console/page errors,
 *      the detail is open, and EITHER the canvas holds a non-blank static
 *      frame (a few pixels sampled in-page via drawImage → getImageData:
 *      sum > 0, more than one distinct color) OR — when the environment
 *      has no WebGL — the fallback <img> is visible. The canvas occupies
 *      the exact box of the static sprite (inset: 0 of the .dex-viewer
 *      padding box — the wrapper itself carries the box's geometry, so
 *      the layout is the fallback's), and a full request-log scan asserts
 *      zero non-local hosts (the three.js guard at runtime).
 *   3. no context leak — three species opened in sequence via deep-link
 *      changes (two shared + the EX-only turtwig, the default build is EX),
 *      then back to the overview: no page errors, never more than one
 *      <canvas> in the DOM at a time, and the canvas gone on deselect.
 *
 * The reduced-motion test emulates the media BEFORE the detail opens — it
 * loads the grid first, then flips the hash — because the viewer reads the
 * media query at init (which happens on the hash change, not on the
 * initial render), so the emulated value is always the one it sees.
 *
 * File shape follows the harness module header (test/ui/harness.mjs):
 * startServer in before(), closeAll + server.close in after(), and each
 * test guards with skipIfNoPlaywright(t) (the suite self-skips on
 * machines without a Playwright install instead of failing `npm test`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

/* Bounded settle for the lazy viewer: the canvas appears when the deferred
 * three.min.js fetch + the sprite Image have landed (a few ms locally, and
 * the same under the CI SwiftShader path). The 15s bound only elapses in
 * the no-WebGL fallback, where the canvas legitimately never appears. */
const VIEWER_SETTLE_MS = 15_000;

/**
 * Waits for the viewer's end state in the open detail and returns it:
 * 'canvas' (the 3D frame is up) or 'fallback' (no WebGL — the static <img>
 * stays; the wait bound elapsed with no canvas).
 */
async function viewerSettled(page) {
  const hasCanvas = await page
    .waitForFunction(
      () => {
        const c = document.querySelector('#dex-species .dex-viewer canvas');
        return !!c && c.width > 0;
      },
      { timeout: VIEWER_SETTLE_MS, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);
  return hasCanvas ? 'canvas' : 'fallback';
}

/**
 * The http(s) hosts this page requested, minus its own (the performance
 * resource entries are the request log — no extra context plumbing needed).
 */
async function externalHosts(page) {
  return page.evaluate(() => {
    const own = location.host;
    const hosts = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      if (!/^https?:/i.test(entry.name)) continue;
      const host = new URL(entry.name).host;
      if (host !== own) hosts.add(host);
    }
    return [...hosts];
  });
}

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

/* --- the suite ------------------------------------------------------------- */

test('the 3D viewer is lazy: no selection → no <canvas> and no three.min.js request', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the Pokedex at its default (grid) view, no species selected
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — the end state the user sees: the tile grid, no detail
    const facts = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      resources: performance.getEntriesByType('resource').map((e) => e.name),
    }));
    // ASSERT — the vendor script is deferred-injected only when a detail
    // first opens, so it must not even be REQUESTED in the grid view
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(facts.canvases, 0, 'no <canvas> may exist in the grid view (the viewer is mounted only in a species detail)');
    assert.ok(
      !facts.resources.some((url) => url.includes('vendor/three.min.js')),
      `./vendor/three.min.js was requested in the grid view (it must be deferred-injected only when a species detail first opens): ${facts.resources
        .filter((url) => url.includes('vendor/three.min.js'))
        .join(', ')}`
    );
  } finally {
    await close();
  }
});

test('reduced motion: the detail opens with one static frame (or the static-sprite fallback), no errors, no external requests', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — load the grid first, then emulate reduced motion BEFORE the
  // detail opens, so the viewer's init (on the hash change below) reads the
  // emulated value — no race between load-time render and emulateMedia
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // ACT — open the deep link to a concrete shared species
    await page.evaluate(() => {
      window.location.hash = '#rec-pokedex-pikachu';
    });
    await page.waitForSelector('#rec-pokedex-pikachu .dex-species__sprite', { timeout: 10_000 });
    const mode = await viewerSettled(page);

    // ASSERT — the detail is open (the overview hidden) and error-free
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    const detail = await page.evaluate(() => {
      const size = (el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      };
      const panel = document.getElementById('rec-pokedex-pikachu');
      const overview = document.getElementById('dex-overview');
      const canvas = document.querySelector('#dex-species .dex-viewer canvas');
      const img = document.querySelector('#dex-species .dex-species__sprite');
      return {
        detailOpen: !!panel && panel.getBoundingClientRect().width > 0,
        overviewHidden: !!(overview && overview.hidden),
        canvasSize: canvas ? size(canvas) : null,
        imgSize: img ? size(img) : null,
        imgVisible: !!img && img.getBoundingClientRect().width > 0,
      };
    });
    assert.ok(detail.detailOpen, 'the #rec-pokedex-pikachu detail panel must be open');
    assert.ok(detail.overviewHidden, 'the overview must be hidden while the detail is open');

    if (mode === 'canvas') {
      // the canvas occupies the SAME box as the static sprite (DESIGN.md
      // §7: no layout shift — the .dex-viewer wrapper carries the box's
      // geometry, canvas and <img> both sit inset: 0 of its padding box)
      assert.ok(
        detail.canvasSize && detail.imgSize,
        'the canvas and the sprite <img> must both be present in the canvas mode'
      );
      assert.deepEqual(
        detail.canvasSize,
        detail.imgSize,
        `the canvas must occupy the exact box of the static sprite (canvas ${JSON.stringify(detail.canvasSize)} vs img ${JSON.stringify(detail.imgSize)})`
      );
      // the reduced-motion end state is EXACTLY ONE static frame — read it
      // back: drawImage the WebGL canvas onto a 2D canvas (the renderer is
      // created with preserveDrawingBuffer so the frame survives) and
      // sample a few pixels
      const sample = await page.evaluate(() => {
        const canvas = document.querySelector('#dex-species .dex-viewer canvas');
        if (!canvas || !canvas.width || !canvas.height) return null;
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const ctx = off.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(canvas, 0, 0);
        let data;
        try {
          data = ctx.getImageData(0, 0, off.width, off.height).data;
        } catch (err) {
          return null;
        }
        let sum = 0;
        const distinct = new Set();
        const stride = Math.max(1, Math.floor((off.width * off.height) / 120));
        for (let i = 0; i < data.length; i += 4 * stride) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          sum += r + g + b;
          distinct.add((r << 16) | (g << 8) | b);
        }
        return { sum, distinct: distinct.size };
      });
      assert.ok(sample, 'the static frame must be readable back from the canvas');
      assert.ok(sample.sum > 0, 'the static frame must not be blank (sampled pixel sum > 0)');
      assert.ok(sample.distinct >= 2, 'the static frame must show the scene (background + floor/grid/sprite), not one flat color');
    } else {
      // WebGL unavailable in this environment — the documented end state:
      // the static sprite <img> stays, in the same box, error-free
      assert.ok(detail.imgVisible, 'the fallback <img> must be visible when WebGL is unavailable');
    }

    // the three.js guard at runtime: every http(s) request the page made is
    // same-origin (the vendored three.js, the sprite, the fonts — nothing
    // from any external host)
    const hosts = await externalHosts(page);
    assert.deepEqual(hosts, [], `non-local hosts were requested: ${hosts.join(', ')}`);
  } finally {
    await close();
  }
});

test('repeated deep links: at most one canvas at a time, canvas gone on deselect, no errors', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  // ARRANGE — the default (EX) build; two shared species + the EX-only
  // turtwig (a real version-scoped selection), opened in sequence via
  // deep-link changes — the motion loop runs (no reduced-motion
  // emulation), so the loop/dispose paths are exercised too
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  const ids = ['pikachu', 'charmander', 'turtwig'];
  try {
    // ACT — open each species in turn, then back to the overview
    for (const id of ids) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, '#rec-pokedex-' + id);
      await page.waitForSelector(`#rec-pokedex-${id} .dex-species__sprite`, { timeout: 10_000 });
      await viewerSettled(page);
      // ASSERT — never more than one canvas in the DOM at a time (the
      // re-init disposes before it mounts; no renderer/loop accumulation)
      const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
      assert.ok(canvases <= 1, `at most one <canvas> in the DOM at a time (got ${canvases} at #rec-pokedex-${id})`);
    }
    await page.evaluate(() => {
      window.location.hash = '#dex-overview';
    });
    await page.waitForSelector('#dex-overview .dex-grid', { state: 'visible', timeout: 10_000 });

    // ASSERT — deselecting removes the canvas entirely (the loop is
    // cancelled, the shared renderer is idle), and the whole sequence is
    // error-free
    const after = await page.evaluate(() => document.querySelectorAll('canvas').length);
    assert.equal(after, 0, 'deselecting the detail must remove the viewer canvas');
    assert.deepEqual(errors, [], `unexpected page errors across the deep-link sequence: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

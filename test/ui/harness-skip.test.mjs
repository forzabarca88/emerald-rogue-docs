/**
 * The harness skip path, end results only (node --test, zero deps):
 * PLAYWRIGHT_GLOBAL_ROOT pointed at an empty dir simulates an absent
 * Playwright install (the knob documented in test/ui/harness.mjs's header),
 * and with it the guard must —
 *   - non-CI (a developer machine): mark the context skipped with the exact
 *     SKIP_MESSAGE and return true;
 *   - CI + PLAYWRIGHT_REQUIRED (the ci `ui` job's gate): THROW the install
 *     message instead — a skip would silently no-op the gate.
 * node --test runs this file in its own process, so the env overrides below
 * cannot leak into the other suites (and the real global install, when
 * present, is shadowed by the empty dir exactly as documented).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { skipIfNoPlaywright, SKIP_MESSAGE } from './harness.mjs';

const ciSaved = process.env.CI;
const emptyRoot = mkdtempSync(path.join(os.tmpdir(), 'emerald-rogue-pw-empty-'));
delete process.env.CI; // simulate a developer machine (non-CI)
process.env.PLAYWRIGHT_GLOBAL_ROOT = emptyRoot; // the documented absent-install simulation

after(() => {
  if (ciSaved === undefined) delete process.env.CI;
  else process.env.CI = ciSaved;
  delete process.env.PLAYWRIGHT_GLOBAL_ROOT;
  rmSync(emptyRoot, { recursive: true, force: true });
});

test('unresolvable Playwright on a non-CI machine → self-skip with the install message', () => {
  const stub = { skippedWith: null, skip(message) { this.skippedWith = message; } };
  assert.equal(skipIfNoPlaywright(stub), true, 'the guard reports the skip (the test must return)');
  assert.equal(stub.skippedWith, SKIP_MESSAGE, 'the context is marked skipped with the exact install message');
});

test('unresolvable Playwright under CI + PLAYWRIGHT_REQUIRED → throws the install message instead of skipping', () => {
  process.env.CI = 'true';
  process.env.PLAYWRIGHT_REQUIRED = '1';
  try {
    const stub = { skip() { throw new Error('the skip guard must not skip under the CI gate'); } };
    assert.throws(
      () => skipIfNoPlaywright(stub),
      { message: SKIP_MESSAGE },
      'a skip would silently no-op the gate — the install message is thrown',
    );
  } finally {
    delete process.env.CI;
    delete process.env.PLAYWRIGHT_REQUIRED;
  }
});

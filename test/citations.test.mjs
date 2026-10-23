/**
 * Tests for the dev-only citation verifier (node --test, no mocks, no deps).
 *
 * Both tests spawn scripts/verify/citations.mjs as a child process (the tool
 * is not imported). They skip — keeping CI green — when the vendored game
 * repo is absent (references/ is gitignored and CI has none); the --changed
 * test additionally skips when the repo has moved off the recorded baseline
 * (scripts/verify/baseline.json), since its "0 changed" assertion only holds
 * while the repo sits exactly on the baseline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.join(root, 'references', 'pokeemerald-rogue');
const script = path.join(root, 'scripts', 'verify', 'citations.mjs');

test('verify mode passes on the current game repo', (t) => {
  // ARRANGE — the vendored game repo is required (absent in CI)
  if (!existsSync(repoDir)) {
    t.skip('references/pokeemerald-rogue not vendored (CI has no game repo)');
    return;
  }

  // ACT — run the verifier in its default (verify) mode
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });

  // ASSERT — exit 0 and the exact success marker on stdout
  assert.equal(result.status, 0, `verify mode exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ALL CITATIONS VERIFIED/);
});

test('--changed against the identical baseline reports 0 changed cited files', (t) => {
  // ARRANGE — the repo must be present AND still sit on the recorded baseline
  if (!existsSync(repoDir)) {
    t.skip('references/pokeemerald-rogue not vendored (CI has no game repo)');
    return;
  }
  const baseline = JSON.parse(readFileSync(path.join(root, 'scripts', 'verify', 'baseline.json'), 'utf8'));
  const head = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const expansion = spawnSync('git', ['-C', repoDir, 'rev-parse', 'origin/expansion'], { encoding: 'utf8' }).stdout.trim();
  if (head !== baseline.vanilla.sha || expansion !== baseline.expansion.sha) {
    t.skip('game repo has moved off the recorded baseline');
    return;
  }

  // ACT — run impact mode
  const result = spawnSync(process.execPath, [script, '--changed'], { cwd: root, encoding: 'utf8' });

  // ASSERT — exit 0 and the stable empty-intersection marker
  assert.equal(result.status, 0, `--changed exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0 changed cited files/);
});

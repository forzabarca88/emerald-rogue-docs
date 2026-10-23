#!/usr/bin/env node
/**
 * Citation verifier for the Emerald Rogue docs site.
 *
 * DEV-ONLY: run manually (`npm run verify:citations` [+ `--changed`]). The
 * build and tests never invoke this script — only this script and
 * scripts/extract/quests.mjs read the game repo (references/ is gitignored
 * and absent in CI; the two node:test tests for this tool skip when it is).
 *
 * Usage:
 *   node scripts/verify/citations.mjs               # verify mode (default)
 *   node scripts/verify/citations.mjs --changed     # impact mode
 *   node scripts/verify/citations.mjs --repo <path> # default: references/pokeemerald-rogue
 *   node scripts/verify/citations.mjs --help
 *
 * Every object with a string `source` property in data/*.json is a citation
 * record (record label = nearest id, else label, else name, else JSON
 * pointer). A citation is a `path @vanilla` / `path @origin/expansion`
 * match; the line refs for a citation are all `L<start>[-<end>]` from that
 * match to the next. Classifications (never a parse failure):
 *   - claim         — `identical`/`lines` @origin/expansion: the preceding
 *     valid citation's file must be byte-identical between branches (git
 *     blob SHA of the vanilla working-tree file == blob SHA of
 *     origin/expansion:<path>, one long-lived `git cat-file --batch`)
 *   - continuation  — a path token with no extension / not Makefile (the
 *     bare `/` of `… / @origin/expansion L…`): attaches (ref, line refs) to
 *     the most recent valid citation in the same string
 *   - glob          — path contains `<…>`: requires >=1 file matching on the
 *     branch (ls-files / ls-tree, cached); line-range checks are skipped
 *   - non-verifiable — no valid citation at all (method cites like
 *     `git diff …`, `(site data)` self-cites, the site.json footer prose):
 *     skipped, and the record is listed as zero-citation
 *
 * Checks: file existence per ref (vanilla = working tree, expansion = blob
 * present) + every line ref well-formed (no zero-start, no reversed
 * range) and in bounds (line count = \n count + 1 if the file lacks a
 * trailing newline; each distinct file read once per branch). Dual
 * cites use different line numbers per branch — never parity-assumed.
 *
 * Verify mode exits 0 with "ALL CITATIONS VERIFIED: …" or 1 with
 * "FAILURES: <n>" after printing every FAIL line. Impact mode always exits 0
 * (it reports, it does not gate).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const BASELINE_PATH = path.join(PROJECT_ROOT, 'scripts', 'verify', 'baseline.json');
const DEFAULT_REPO = 'references/pokeemerald-rogue';

const CITATION_RE = /([A-Za-z0-9_\-./<>]+)\s+@(vanilla|origin\/expansion)/g;
const LINE_REF_RE = /L(\d+)(?:-(\d+))?/g;
const CLAIM_TOKENS = new Set(['identical', 'lines']);
const SHA_RE = /^[0-9a-f]{40}$/;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, changed: false };
  const value = (flag, index) => {
    const next = argv[index + 1];
    if (next === undefined) fail(`Missing value for ${flag}`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = value(arg, i); i++; }
    else if (arg === '--changed') args.changed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/verify/citations.mjs [--changed] [--repo <path>]\n' +
          '\n' +
          '  (no flags)    verify every data/*.json citation against the game repo\n' +
          '  --changed     impact report: docs records affected by game files changed\n' +
          '                since the recorded baseline (scripts/verify/baseline.json)\n' +
          '  --repo <path> game repo (default: references/pokeemerald-rogue)',
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Repo access (vanilla = working tree, expansion = origin/expansion via git)
// ---------------------------------------------------------------------------

function git(repo, ...gitArgs) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`git ${gitArgs.join(' ')} failed: ${String(error.message).split('\n')[0]}`);
  }
}

function gitBuffer(repo, gitArgs, input) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: null, maxBuffer: 512 * 1024 * 1024, input });
  } catch (error) {
    fail(`git ${gitArgs.join(' ')} failed: ${String(error.message).split('\n')[0]}`);
  }
}

function assertRepoSane(repo) {
  if (!existsSync(repo)) fail(`Game repo not found: ${repo}`);
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== 'vanilla') {
    fail(`Game repo working tree is on "${branch}" — the vanilla ref is read from the working tree, which must be "vanilla" (do not check out other branches).`);
  }
  git(repo, 'rev-parse', '--verify', 'origin/expansion'); // fails if missing
}

function warnDirtyTree(repo) {
  if (git(repo, 'status', '--porcelain').trim() !== '') {
    console.log('WARNING: game repo working tree is dirty — vanilla checks read uncommitted code');
  }
}

// ---------------------------------------------------------------------------
// Baseline (scripts/verify/baseline.json — the recorded game revision)
// ---------------------------------------------------------------------------

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    fail(`Baseline file not found: scripts/verify/baseline.json (the recorded game revision this site documents)`);
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (error) {
    fail(`Baseline file is not valid JSON: ${error.message}`);
  }
  for (const key of ['vanilla', 'expansion']) {
    const sha = baseline && baseline[key] ? baseline[key].sha : undefined;
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
      fail(`Baseline ${key}.sha is missing or not a 40-hex SHA (scripts/verify/baseline.json)`);
    }
  }
  return baseline;
}

function shaInRepo(repo, sha) {
  return spawnSync('git', ['-C', repo, 'cat-file', '-e', sha], { encoding: 'utf8' }).status === 0;
}

// ---------------------------------------------------------------------------
// Source-field collection (every object with a string `source` in data/*.json)
// ---------------------------------------------------------------------------

function collectSourceFields() {
  const dataFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();
  if (dataFiles.length === 0) fail('data/ contains no .json files');
  const records = [];
  for (const file of dataFiles) {
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8'));
    } catch (error) {
      fail(`data/${file}: invalid JSON — ${error.message}`);
    }
    (function walk(node, pointer, inheritedLabel) {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${pointer}/${i}`, inheritedLabel));
        return;
      }
      if (node && typeof node === 'object') {
        const own =
          typeof node.id === 'string' ? node.id
          : typeof node.label === 'string' ? node.label
          : typeof node.name === 'string' ? node.name
          : null;
        // inheritedLabel is the nearest ancestor's own id/label/name (or null —
        // never the JSON pointer, which would shadow a deeper record's pointer).
        if (typeof node.source === 'string') {
          records.push({ file, label: own ?? inheritedLabel ?? pointer, source: node.source });
        }
        for (const [key, value] of Object.entries(node)) walk(value, `${pointer}/${key}`, own ?? inheritedLabel);
      }
    })(data, '', null);
  }
  return { dataFiles, records };
}

// ---------------------------------------------------------------------------
// Citation parser (path @ref matches + classification)
// ---------------------------------------------------------------------------

/** Classify a citation path token (order matters: claims first). */
function classifyToken(token) {
  if (CLAIM_TOKENS.has(token)) return 'claim';
  if (token.includes('<')) return 'glob';
  if (token === 'Makefile' || /\.[A-Za-z0-9]+$/.test(token)) return 'path';
  return 'continuation';
}

/**
 * Parse one source string.
 * @returns {{
 *   units: Array<{file: string, isGlob: boolean, ref: string, lineRefs: Array<{a: number, b: number, text: string}>, continued: boolean}>
 *   claims: Array<{file: string, isGlob: boolean, word: string}>,
 *   unattached: number
 * }}
 */
function parseSource(source) {
  const matches = [...source.matchAll(CITATION_RE)].map((m) => ({
    token: m[1],
    ref: m[2],
    start: m.index, // slice boundary for the next citation's line refs
    end: m.index + m[0].length,
  }));
  const units = [];
  const claims = [];
  let unattached = 0;
  let lastValid = null; // { file, isGlob } — the most recent valid citation
  matches.forEach((match, i) => {
    // Line refs for this match: everything from the end of the match to the
    // next match (annotation L-refs and sub-range lists included; a "/"
    // between L-refs without a tag stays in this citation).
    const segment = source.slice(match.end, i + 1 < matches.length ? matches[i + 1].start : source.length);
    const lineRefs = [...segment.matchAll(LINE_REF_RE)].map((lr) => ({ a: Number(lr[1]), b: Number(lr[2] ?? lr[1]), text: lr[0] }));
    const kind = classifyToken(match.token);
    if (kind === 'claim') {
      // Attach the byte-identical claim to the preceding valid citation's file.
      // A claim with nothing to attach to (or a @vanilla claim) is unverifiable.
      if (lastValid && match.ref === 'origin/expansion') {
        claims.push({ file: lastValid.file, isGlob: lastValid.isGlob, word: match.token });
      } else {
        unattached += 1;
      }
      return;
    }
    if (kind === 'continuation') {
      // Bare `/` (or other extension-less token) carries only the ref + line
      // refs; it attaches to the most recent valid citation (same file). With
      // no preceding valid citation it is unverifiable (the record is then
      // zero-citation if nothing else parses).
      if (lastValid) {
        units.push({ file: lastValid.file, isGlob: lastValid.isGlob, ref: match.ref, lineRefs, continued: true });
      } else {
        unattached += 1;
      }
      return;
    }
    units.push({ file: match.token, isGlob: kind === 'glob', ref: match.ref, lineRefs, continued: false });
    lastValid = { file: match.token, isGlob: kind === 'glob' };
  });
  return { units, claims, unattached };
}

// ---------------------------------------------------------------------------
// Game-repo file access (each distinct file read once per branch)
// ---------------------------------------------------------------------------

function lineCount(buffer) {
  if (buffer.length === 0) return 0;
  let newlines = 0;
  for (let i = 0; i < buffer.length; i++) if (buffer[i] === 0x0a) newlines += 1;
  return buffer[buffer.length - 1] === 0x0a ? newlines : newlines + 1;
}

/** Git blob SHA: sha1("blob <len>\0" + bytes) — comparable to `git ls-tree`/cat-file ids. */
function blobSha(buffer) {
  const hash = createHash('sha1');
  hash.update(`blob ${buffer.length}\0`);
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * One long-lived `git cat-file --batch` process for ALL expansion files:
 * every requested object comes back as `<sha> <type> <size>\n<bytes>\n` (or
 * `<40 zeros> missing\n`).
 */
function fetchExpansionFiles(repo, files) {
  const unique = [...new Set(files)];
  const cache = new Map();
  if (unique.length === 0) return cache;
  const out = gitBuffer(repo, ['cat-file', '--batch'], unique.map((f) => `origin/expansion:${f}\n`).join(''));
  let offset = 0;
  for (const file of unique) {
    const headerEnd = out.indexOf(0x0a, offset);
    if (headerEnd === -1) fail(`git cat-file --batch output ended early (no header for ${file})`);
    const header = out.subarray(offset, headerEnd).toString('utf8');
    offset = headerEnd + 1;
    const [sha, type, sizeStr] = header.split(' ');
    if (sha === '0'.repeat(40) || type === 'missing') {
      cache.set(file, { exists: false, sha: null, lineCount: 0 });
      continue;
    }
    const size = Number(sizeStr);
    if (!Number.isInteger(size) || size < 0 || offset + size + 1 > out.length) {
      fail(`git cat-file --batch output is malformed for ${file} (header: ${JSON.stringify(header)})`);
    }
    const bytes = out.subarray(offset, offset + size);
    offset += size + 1; // object bytes + the trailing newline git emits
    cache.set(file, { exists: true, sha, lineCount: lineCount(bytes) });
  }
  return cache;
}

class RepoFiles {
  constructor(repo) {
    this.repo = repo;
    this.vanillaCache = new Map();
    this.expansionCache = new Map();
    this.lsVanilla = null;
    this.lsExpansion = null;
  }

  /** Tracked files in the vanilla working tree (index). */
  listVanilla() {
    if (this.lsVanilla === null) this.lsVanilla = git(this.repo, 'ls-files').split('\n').filter(Boolean);
    return this.lsVanilla;
  }

  /** All files in the origin/expansion tree. */
  listExpansion() {
    if (this.lsExpansion === null) {
      this.lsExpansion = git(this.repo, 'ls-tree', '-r', '--name-only', 'origin/expansion').split('\n').filter(Boolean);
    }
    return this.lsExpansion;
  }

  /** Vanilla working-tree file info (read once per file). */
  vanillaInfo(file) {
    if (!this.vanillaCache.has(file)) {
      const abs = path.join(this.repo, file);
      this.vanillaCache.set(
        file,
        existsSync(abs)
          ? { exists: true, bytes: readFileSync(abs) }
          : { exists: false, bytes: null },
      );
    }
    const info = this.vanillaCache.get(file);
    return info.exists
      ? { exists: true, lineCount: lineCount(info.bytes), sha: blobSha(info.bytes) }
      : { exists: false, lineCount: 0, sha: null };
  }

  /** Expansion file info (must be pre-fetched via fetchExpansionFiles). */
  expansionInfo(file) {
    const info = this.expansionCache.get(file);
    if (info === undefined) fail(`internal: expansion file ${file} was not pre-fetched`);
    return info;
  }

  expandGlob(pattern, ref) {
    // `<…>` placeholders become `.*`; everything else is literal.
    const re = new RegExp(
      '^' +
        pattern
          .split(/(<[^<>]*>)/g)
          .map((part) => (part.startsWith('<') && part.endsWith('>') && part.length > 2 ? '.*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
          .join('') +
        '$',
    );
    const list = ref === 'vanilla' ? this.listVanilla() : this.listExpansion();
    return list.filter((f) => re.test(f));
  }
}

// ---------------------------------------------------------------------------
// Checks (collect ALL failures, build.mjs style)
// ---------------------------------------------------------------------------

function failLine(record, file, ref, problem) {
  return `FAIL data/${record.file} ${record.label}: ${file} @${ref} — ${problem}`;
}

function checkUnit(record, unit, files) {
  const failures = [];
  if (unit.isGlob) {
    // Glob: >=1 matching file on the branch; line-range checks are skipped.
    if (files.expandGlob(unit.file, unit.ref).length === 0) {
      failures.push(failLine(record, unit.file, unit.ref, `missing on ${unit.ref}`));
    }
    return failures;
  }
  const info = unit.ref === 'vanilla' ? files.vanillaInfo(unit.file) : files.expansionInfo(unit.file);
  if (!info.exists) {
    failures.push(failLine(record, unit.file, unit.ref, `missing on ${unit.ref}`));
    return failures;
  }
  for (const { a, b, text } of unit.lineRefs) {
    if (a < 1) {
      failures.push(failLine(record, unit.file, unit.ref, `invalid line range ${text}`));
    } else if (b < a) {
      failures.push(failLine(record, unit.file, unit.ref, `invalid line range ${text}`));
    } else if (a > info.lineCount) {
      failures.push(failLine(record, unit.file, unit.ref, `line ${a} out of bounds (${info.lineCount} lines on ${unit.ref})`));
    } else if (b > info.lineCount) {
      failures.push(failLine(record, unit.file, unit.ref, `line ${b} out of bounds (${info.lineCount} lines on ${unit.ref})`));
    }
  }
  return failures;
}

function checkClaim(record, claim, files) {
  const failures = [];
  const claimText = claim.word === 'lines' ? '(same lines @origin/expansion)' : '(identical @origin/expansion)';
  const problem = `claims ${JSON.stringify(claimText)} but file differs between the branches`;
  const filesToCheck = claim.isGlob ? files.expandGlob(claim.file, 'vanilla') : [claim.file];
  if (claim.isGlob && filesToCheck.length === 0) return failures; // the glob unit already reported missing
  for (const file of filesToCheck) {
    const vanilla = files.vanillaInfo(file);
    if (!vanilla.exists) {
      if (claim.isGlob) failures.push(failLine(record, file, 'vanilla', 'missing on vanilla'));
      continue; // for a concrete file the citation's own missing check already reports it
    }
    const expansion = files.expansionInfo(file);
    if (!expansion.exists || expansion.sha !== vanilla.sha) {
      failures.push(failLine(record, file, 'origin/expansion', problem));
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Verify mode
// ---------------------------------------------------------------------------

function verifyMode(repo) {
  const baseline = loadBaseline();
  const { dataFiles, records } = collectSourceFields();
  const parsed = records.map((record) => ({ record, parse: parseSource(record.source) }));

  // Raw mention stats over the 528 source fields (sanity self-check).
  let mentionVanilla = 0;
  let mentionExpansion = 0;
  let lineRefsRaw = 0;
  let fileLevelFields = 0;
  let multiCiteFields = 0;
  for (const record of records) {
    mentionVanilla += (record.source.match(/@vanilla/g) ?? []).length;
    mentionExpansion += (record.source.match(/@origin\/expansion/g) ?? []).length;
    const refs = (record.source.match(/L\d+(?:-\d+)?/g) ?? []).length;
    lineRefsRaw += refs;
    if (refs === 0) fileLevelFields += 1;
    if (record.source.includes(';') && [...record.source.matchAll(CITATION_RE)].length > 0) multiCiteFields += 1;
  }

  // Gather every expansion file the checks will need, then fetch them all in
  // one long-lived `git cat-file --batch` process.
  const files = new RepoFiles(repo);
  const expansionNeeded = new Set();
  for (const { parse } of parsed) {
    for (const unit of parse.units) {
      if (unit.ref === 'origin/expansion' && !unit.isGlob) expansionNeeded.add(unit.file);
    }
    for (const claim of parse.claims) {
      if (claim.isGlob) {
        for (const f of files.expandGlob(claim.file, 'vanilla')) expansionNeeded.add(f);
      } else {
        expansionNeeded.add(claim.file);
      }
    }
  }
  files.expansionCache = fetchExpansionFiles(repo, [...expansionNeeded]);

  // Run every check, collecting ALL failures.
  const failures = [];
  const perFile = new Map(); // dataFile -> { ok, failed, skipped }
  for (const file of dataFiles) perFile.set(file, { ok: 0, failed: 0, skipped: 0 });
  const zeroCitation = [];
  for (const { record, parse } of parsed) {
    const recordFailures = [
      ...parse.units.flatMap((unit) => checkUnit(record, unit, files)),
      ...parse.claims.flatMap((claim) => checkClaim(record, claim, files)),
    ];
    failures.push(...recordFailures);
    const counter = perFile.get(record.file);
    if (parse.units.length === 0 && parse.claims.length === 0) {
      counter.skipped += 1;
      zeroCitation.push(record);
    } else if (recordFailures.length > 0) {
      counter.failed += 1;
    } else {
      counter.ok += 1;
    }
  }

  // Parsed totals (citations after classification).
  let directUnits = 0;
  let continuedUnits = 0;
  let globUnits = 0;
  let claimCount = 0;
  let unattached = 0;
  for (const { parse } of parsed) {
    directUnits += parse.units.filter((u) => !u.continued).length;
    continuedUnits += parse.units.filter((u) => u.continued).length;
    globUnits += parse.units.filter((u) => u.isGlob).length + parse.claims.filter((c) => c.isGlob).length;
    claimCount += parse.claims.length;
    unattached += parse.unattached;
  }

  // Report.
  const headSha = git(repo, 'rev-parse', 'HEAD').trim();
  const expansionSha = git(repo, 'rev-parse', 'origin/expansion').trim();
  console.log(`verifying citations — ${path.relative(PROJECT_ROOT, repo) || repo}`);
  console.log(`  vanilla:   working tree (branch vanilla) @ ${headSha}`);
  console.log(`  expansion: origin/expansion @ ${expansionSha}`);
  if (failures.length > 0) {
    console.log('');
    for (const line of failures) console.log(line);
  }
  console.log('');
  console.log('per data file (ok / failed / skipped records):');
  for (const file of dataFiles) {
    const c = perFile.get(file);
    console.log(`  data/${file}: ok ${c.ok}, failed ${c.failed}, skipped ${c.skipped}`);
  }
  console.log('');
  console.log('citations summary:');
  const perFileCounts = dataFiles
    .map((f) => `${f.replace(/\.json$/, '')} ${perFile.get(f).ok + perFile.get(f).failed + perFile.get(f).skipped}`)
    .join(', ');
  console.log(`  source fields: ${records.length} total (${perFileCounts})`);
  console.log(`  raw mentions: ${mentionVanilla} @vanilla, ${mentionExpansion} @origin/expansion`);
  console.log(`  line refs: ${lineRefsRaw} L-refs (raw); ${fileLevelFields} file-level (no L) fields; ${multiCiteFields} ; multi-cite fields`);
  console.log(`  parsed: ${directUnits} direct citations + ${continuedUnits} continuations (${globUnits} glob), ${claimCount} byte-identical claims, ${unattached} unattached`);
  console.log(`  records: ${[...perFile.values()].reduce((n, c) => n + c.ok, 0)} ok, ${[...perFile.values()].reduce((n, c) => n + c.failed, 0)} failed, ${[...perFile.values()].reduce((n, c) => n + c.skipped, 0)} skipped (no verifiable citations)`);
  if (zeroCitation.length > 0) {
    console.log('');
    console.log(`records with no verifiable citations (${zeroCitation.length}):`);
    for (const record of zeroCitation) console.log(`  data/${record.file} ${record.label}`);
  }
  if (headSha !== baseline.vanilla.sha) {
    console.log('NOTE: vanilla has moved past the recorded baseline — run --changed to list affected records');
  }
  if (expansionSha !== baseline.expansion.sha) {
    console.log('NOTE: expansion has moved past the recorded baseline — run --changed to list affected records');
  }
  console.log('');
  if (failures.length > 0) {
    console.log(`FAILURES: ${failures.length}`);
    process.exit(1);
  }
  console.log(
    `ALL CITATIONS VERIFIED: ${records.length} source fields checked (${directUnits + continuedUnits} citation units, ${claimCount} byte-identical claims ok, ${zeroCitation.length} records skipped)`,
  );
}

// ---------------------------------------------------------------------------
// Impact mode (--changed): what changed in the game since the baseline?
// ---------------------------------------------------------------------------

function impactMode(repo) {
  const baseline = loadBaseline();
  for (const [branch, sha] of [
    ['vanilla', baseline.vanilla.sha],
    ['expansion', baseline.expansion.sha],
  ]) {
    if (!shaInRepo(repo, sha)) {
      fail(
        `Baseline ${branch} SHA ${sha} is not in the repo — the clone may be shallow. ` +
          `Run "git -C ${repo} fetch --unshallow" (or a full fetch) and retry.`,
      );
    }
  }

  const { records } = collectSourceFields();
  const parsed = records.map((record) => ({ record, parse: parseSource(record.source) }));
  const files = new RepoFiles(repo);

  // Inverted index: game file -> [{ dataFile, label, refs }], deduped per
  // (data file, record). A claim ties BOTH branches to its file; a glob
  // index-entries every file it matches.
  const index = new Map(); // game file -> Map(`${dataFile}\u0000${label}` -> { dataFile, label, refs })
  const addIndex = (file, dataFile, label, ref) => {
    const key = `${dataFile}\u0000${label}`;
    if (!index.has(file)) index.set(file, new Map());
    const byRecord = index.get(file);
    if (!byRecord.has(key)) byRecord.set(key, { dataFile, label, refs: new Set() });
    byRecord.get(key).refs.add(ref);
  };
  for (const { record, parse } of parsed) {
    const add = (file, ref) => addIndex(file, record.file, record.label, ref);
    for (const unit of parse.units) {
      if (unit.isGlob) {
        for (const f of files.expandGlob(unit.file, unit.ref)) add(f, unit.ref);
      } else {
        add(unit.file, unit.ref);
      }
    }
    for (const claim of parse.claims) {
      const targets = claim.isGlob ? files.expandGlob(claim.file, 'vanilla') : [claim.file];
      for (const f of targets) {
        add(f, 'vanilla');
        add(f, 'expansion');
      }
    }
  }

  const headSha = git(repo, 'rev-parse', 'HEAD').trim();
  const expansionSha = git(repo, 'rev-parse', 'origin/expansion').trim();
  const vanillaChanged = git(repo, 'diff', '--name-only', baseline.vanilla.sha).split('\n').filter(Boolean);
  const expansionChanged = git(repo, 'diff', '--name-only', baseline.expansion.sha, 'origin/expansion').split('\n').filter(Boolean);
  const vanillaSet = new Set(vanillaChanged);
  const expansionSet = new Set(expansionChanged);

  console.log('impact report — game files changed since the recorded baseline (scripts/verify/baseline.json)');
  console.log(`  vanilla:   ${baseline.vanilla.sha} → ${headSha} (working tree, branch vanilla) — ${vanillaChanged.length} changed file(s)`);
  console.log(`  expansion: ${baseline.expansion.sha} → ${expansionSha} (origin/expansion) — ${expansionChanged.length} changed file(s)`);
  console.log('');
  console.log('Affected docs records:');

  // Intersect changed files with the inverted index (branch-aware: a record is
  // affected only when the changed branch is one it actually cites on).
  const affected = [];
  for (const [file, byRecord] of index) {
    const inVanilla = vanillaSet.has(file);
    const inExpansion = expansionSet.has(file);
    if (!inVanilla && !inExpansion) continue;
    for (const { dataFile, label, refs } of byRecord.values()) {
      const hitVanilla = inVanilla && refs.has('vanilla');
      const hitExpansion = inExpansion && refs.has('expansion');
      if (!hitVanilla && !hitExpansion) continue;
      affected.push({
        dataFile,
        label,
        file,
        tag: hitVanilla && hitExpansion ? 'both' : hitVanilla ? 'vanilla' : 'expansion',
      });
    }
  }
  affected.sort((a, b) =>
    a.dataFile === b.dataFile
      ? a.label === b.label
        ? a.file < b.file ? -1 : a.file > b.file ? 1 : 0
        : a.label < b.label ? -1 : 1
      : a.dataFile < b.dataFile ? -1 : 1,
  );
  if (affected.length === 0) {
    console.log('0 changed cited files');
  } else {
    for (const entry of affected) {
      console.log(`data/${entry.dataFile} → ${entry.label} — ${entry.file} [${entry.tag}]`);
    }
  }

  console.log('');
  console.log('Changed but not cited:');
  const allChanged = [...new Set([...vanillaChanged, ...expansionChanged])];
  const uncited = allChanged.filter((f) => !index.has(f));
  const rogueNamed = uncited.filter((f) => /rogue/i.test(f));
  const otherCount = uncited.length - rogueNamed.length;
  if (uncited.length === 0) {
    console.log('  (none)');
  } else {
    for (const f of rogueNamed) {
      const tag = vanillaSet.has(f) && expansionSet.has(f) ? 'both' : vanillaSet.has(f) ? 'vanilla' : 'expansion';
      console.log(`  ${f} [${tag}]`);
    }
    if (otherCount > 0) {
      console.log(
        `  ${otherCount} other changed file(s) — ` +
          `git -C ${repo} diff --name-only ${baseline.vanilla.sha} ; git -C ${repo} diff --name-only ${baseline.expansion.sha} origin/expansion`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.isAbsolute(args.repo) ? args.repo : path.resolve(PROJECT_ROOT, args.repo);
  assertRepoSane(repo);
  warnDirtyTree(repo);
  if (args.changed) impactMode(repo);
  else verifyMode(repo);
}

main();

#!/usr/bin/env node
/**
 * Zero-dependency build for the Emerald Rogue docs site.
 *
 * 1. Copies `site/` into a temp dir (`dist.tmp-<pid>`), then atomically
 *    swaps it into `dist/` (rm + rename), so concurrent builds never see a
 *    half-written `dist/`
 * 2. Validates every `data/*.json` against the binding data envelope:
 *    - `meta.id` must equal the filename stem
 *    - `meta.title` must be a non-empty string
 *    - at least one of `prose` / `records` must be present with content
 *    - every record needs `name` and `source`
 *    - every record's `versions` is a non-empty subset of { "vanilla", "ex" }
 *    - every record's optional `differences` maps version keys ("vanilla",
 *      "ex") to either a free-form string or, for structured differences
 *      (data/quests.json), an object whose keys are a subset of
 *      { description, trigger, rewards, requirements, display_group }
 * 2b. Asserts the four prose contracts the UI parses at run time (the site
 *    re-reads these phrasings with regexes; reword the data and the build
 *    fails instead of the page degrading silently):
 *    - quests: every record's `display_group` (and any per-version
 *      `differences.*.display_group`) is a member of the file's `display_groups`
 *    - safari: the `pool-slot-layout` record's description contains the
 *      "N–M are regular" / "N–M are legendary" ranges safari.js parses
 *    - routes: every record with a vanilla difference starts with the
 *      "Wild types:" phrasing routes.js parses
 *    - campaigns: the `campaign-trigger` record's description lists ≥5
 *      "'PHRASE' (Name)" hidden phrases in the format config.js parses
 * 3. Emits `dist/data/bundle.js` with one line per data file:
 *    `;window.ROGUE_DATA_<ID> = <json>;`  (ID = meta.id uppercased;
 *     bracket notation `window["..."]` when the id is not a valid identifier)
 *
 * Aborts with a non-zero exit and a clear message on any violation.
 * This script only ever reads `site/` and `data/` — never `references/`
 * (which is gitignored and absent in CI).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteDir = path.join(root, 'site');
const dataDir = path.join(root, 'data');
const distDir = path.join(root, 'dist');
const tmpDir = path.join(root, `dist.tmp-${process.pid}`);

const ALLOWED_VERSIONS = new Set(['vanilla', 'ex']);
const DIFFERENCE_FIELDS = new Set(['description', 'trigger', 'rewards', 'requirements', 'display_group']);
const errors = [];

/**
 * Validate a record's optional `differences` object. Each side (vanilla/ex)
 * is either a free-form string or an object of structured per-version field
 * values (keys limited to DIFFERENCE_FIELDS, non-empty values).
 */
function validateDifferences(ctx, recordId, differences) {
  if (typeof differences !== 'object' || differences === null || Array.isArray(differences)) {
    fail(`${ctx} ${recordId}.differences must be an object`);
    return;
  }
  for (const [side, value] of Object.entries(differences)) {
    if (!ALLOWED_VERSIONS.has(side)) {
      fail(`${ctx} ${recordId}.differences has unknown side ${JSON.stringify(side)} (allowed: "vanilla", "ex")`);
      continue;
    }
    if (typeof value === 'string') {
      if (value.trim().length === 0) fail(`${ctx} ${recordId}.differences.${side} must not be an empty string`);
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(`${ctx} ${recordId}.differences.${side} must be a string or an object`);
      continue;
    }
    if (Object.keys(value).length === 0) {
      fail(`${ctx} ${recordId}.differences.${side} must not be an empty object`);
      continue;
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      if (!DIFFERENCE_FIELDS.has(field)) {
        fail(
          `${ctx} ${recordId}.differences.${side} has unknown field ${JSON.stringify(field)}` +
            ` (allowed: ${[...DIFFERENCE_FIELDS].map((f) => `"${f}"`).join(', ')})`,
        );
      }
      if (typeof fieldValue !== 'string' && !Array.isArray(fieldValue)) {
        fail(`${ctx} ${recordId}.differences.${side}.${field} must be a string or an array of strings`);
      } else if (Array.isArray(fieldValue) && fieldValue.some((v) => typeof v !== 'string')) {
        fail(`${ctx} ${recordId}.differences.${side}.${field} must contain only strings`);
      }
    }
  }
}

function fail(message) {
  errors.push(message);
}

// ---------------------------------------------------------------------------
// UI prose contracts — the phrasings site/js/pages/*.js regex-parses at run
// time. These fail the build (naming file + record) instead of letting a
// reworded data file degrade the pages silently.
// ---------------------------------------------------------------------------

/** quests: display_group values must be members of the file's display_groups. */
function checkQuestDisplayGroups(file, data) {
  const ctx = `data/${file}`;
  const groupIds = new Set(
    (Array.isArray(data.display_groups) ? data.display_groups : []).map((g) =>
      typeof g === 'object' && g !== null ? g.id : g,
    ),
  );
  for (const record of Array.isArray(data.records) ? data.records : []) {
    const id = record.id ?? record.name ?? 'records[?]';
    if (typeof record.display_group === 'string' && !groupIds.has(record.display_group)) {
      fail(
        `${ctx}: quest ${id} has display_group ${JSON.stringify(record.display_group)}` +
          ` which is not a member of the file's display_groups`,
      );
    }
    const diff = record.differences;
    if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
      for (const side of ALLOWED_VERSIONS) {
        const value = diff[side];
        if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.display_group === 'string' && !groupIds.has(value.display_group)) {
          fail(
            `${ctx}: quest ${id} differences.${side}.display_group ${JSON.stringify(value.display_group)}` +
              ` is not a member of the file's display_groups`,
          );
        }
      }
    }
  }
}

/** safari: the slot diagram parses "N–M are regular/legendary" from the record. */
function checkSafariSlotLayout(file, data) {
  const rec = (Array.isArray(data.records) ? data.records : []).find((r) => r && r.id === 'pool-slot-layout');
  if (!rec) return;
  const desc = String(rec.description || '');
  for (const role of ['regular', 'legendary']) {
    // the exact phrasing site/js/pages/safari.js slotRange() matches
    const pattern = new RegExp(`\\d+\\s*[\u2013\u2014-]\\s*\\d+\\s+are ${role}`);
    if (!pattern.test(desc)) {
      fail(
        `data/${file}: safari "pool-slot-layout" description must contain the "N–M are ${role}"` +
          ` phrasing that safari.js parses (pattern: /\\d+[–—-]\\d+ are ${role}/)`,
      );
    }
  }
}

/** routes: vanilla wild-type differences use the "Wild types:" phrasing. */
function checkRoutesWildTypes(file, data) {
  for (const rec of Array.isArray(data.records) ? data.records : []) {
    const diff = rec && rec.differences;
    if (diff && typeof diff === 'object' && typeof diff.vanilla === 'string') {
      // the exact prefix site/js/pages/routes.js effectiveTypes() parses
      if (!diff.vanilla.startsWith('Wild types:')) {
        fail(
          `data/${file}: route ${rec.id} differences.vanilla must start with "Wild types:"` +
            ` (the phrasing routes.js parses) — got ${JSON.stringify(diff.vanilla.slice(0, 40))}…`,
        );
      }
    }
  }
}

/** campaigns: the trigger record lists ≥5 "'PHRASE' (Name)" hidden phrases. */
function checkCampaignTrigger(file, data) {
  const rec = (Array.isArray(data.records) ? data.records : []).find((r) => r && r.id === 'campaign-trigger');
  if (!rec) return;
  // the exact pattern site/js/pages/config.js parsePhrases() uses
  const pattern = /'([A-Z][A-Z0-9 ]+?)'\s*\(([A-Za-z]+(?: [A-Za-z]+)*)\)/g;
  const count = (String(rec.description || '').match(pattern) ?? []).length;
  if (count < 5) {
    fail(
      `data/${file}: campaigns "campaign-trigger" description must list at least 5 hidden phrases` +
        ` in the "'PHRASE' (Name)" format config.js parses (found ${count})`,
    );
  }
}

/** Run the UI prose contract checks for one data file (by envelope stem). */
function validateUiContracts(file, stem, data) {
  switch (stem) {
    case 'quests':
      checkQuestDisplayGroups(file, data);
      break;
    case 'safari':
      checkSafariSlotLayout(file, data);
      break;
    case 'routes':
      checkRoutesWildTypes(file, data);
      break;
    case 'campaigns':
      checkCampaignTrigger(file, data);
      break;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate one parsed data file against the envelope.
 * @returns {string|null} meta.id when valid enough to bundle, else null.
 */
function validateEnvelope(file, stem, data) {
  const ctx = `data/${file}:`;

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(`${ctx} top level must be an object`);
    return null;
  }

  const meta = data.meta;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    fail(`${ctx} missing "meta" object`);
    return null;
  }
  if (!isNonEmptyString(meta.id)) {
    fail(`${ctx} "meta.id" must be a non-empty string`);
  } else if (meta.id !== stem) {
    fail(`${ctx} "meta.id" (${JSON.stringify(meta.id)}) must equal the filename stem (${JSON.stringify(stem)})`);
  }
  if (!isNonEmptyString(meta.title)) {
    fail(`${ctx} "meta.title" must be a non-empty string`);
  }

  const hasProse = Array.isArray(data.prose);
  const hasRecords = Array.isArray(data.records);
  if (!hasProse && !hasRecords) {
    fail(`${ctx} must contain at least one of "prose" or "records"`);
    return null;
  }
  if (
    (!hasProse || data.prose.length === 0) &&
    (!hasRecords || data.records.length === 0)
  ) {
    fail(`${ctx} "prose" and "records" are both empty — at least one must contain content`);
  }

  if (hasProse) {
    data.prose.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null) {
        fail(`${ctx} prose[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.heading)) fail(`${ctx} prose[${i}].heading must be a non-empty string`);
      if (!isNonEmptyString(entry.text)) fail(`${ctx} prose[${i}].text must be a non-empty string`);
    });
  }

  if (hasRecords) {
    data.records.forEach((record, i) => {
      if (typeof record !== 'object' || record === null) {
        fail(`${ctx} records[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(record.name)) fail(`${ctx} records[${i}].name must be a non-empty string`);
      if (!isNonEmptyString(record.source)) fail(`${ctx} records[${i}].source must be a non-empty string`);
      const versions = record.versions;
      if (!Array.isArray(versions) || versions.length === 0) {
        fail(`${ctx} records[${i}].versions must be a non-empty array`);
      } else {
        versions.forEach((v) => {
          if (!ALLOWED_VERSIONS.has(v)) {
            fail(`${ctx} records[${i}].versions contains unknown version ${JSON.stringify(v)} (allowed: "vanilla", "ex")`);
          }
        });
      }
      if (record.differences !== undefined) {
        validateDifferences(ctx, record.name ?? `records[${i}]`, record.differences);
      }
    });
  }

  return isNonEmptyString(meta.id) ? meta.id : null;
}

function main() {
  if (!existsSync(siteDir)) fail('site/ directory not found');
  if (!existsSync(dataDir)) fail('data/ directory not found');
  if (errors.length) return report();

  const dataFiles = readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (dataFiles.length === 0) {
    fail('data/ contains no .json files (expected at least site.json)');
    return report();
  }

  const bundleLines = [];
  for (const file of dataFiles) {
    const stem = file.replace(/\.json$/, '');
    let data;
    try {
      data = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'));
    } catch (err) {
      fail(`data/${file}: invalid JSON — ${err.message}`);
      continue;
    }
    const id = validateEnvelope(file, stem, data);
    if (id) {
      validateUiContracts(file, stem, data);
      const globalName = `ROGUE_DATA_${id.toUpperCase()}`;
      // Hyphenated ids (e.g. "game-modes") are not valid identifiers, so emit
      // bracket notation for them: `window.ROGUE_DATA_GAME-MODES = ...` would
      // be parsed as a subtraction and fail with a SyntaxError.
      const lhs = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(globalName)
        ? `window.${globalName}`
        : `window["${globalName}"]`;
      bundleLines.push(`;${lhs} = ${JSON.stringify(data)};`);
    }
  }
  if (errors.length) return report();

  // Assemble the complete build in the temp dir, then swap it into dist/
  // (rename on the same filesystem). Readers of dist/ only ever see a
  // complete build — never a half-written one (matters when builds run
  // concurrently, e.g. under npm test).
  rmSync(tmpDir, { recursive: true, force: true });
  try {
    cpSync(siteDir, tmpDir, { recursive: true });
    mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'data', 'bundle.js'), `${bundleLines.join('\n')}\n`, 'utf8');
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
  // rmSync + renameSync on the same filesystem. A concurrent build may
  // swap its own temp dir into dist/ mid-rm (our final rmdir then fails
  // with ENOTEMPTY) or right after it (our rename does); retry the pair
  // against the fresh state in either case.
  for (;;) {
    try {
      rmSync(distDir, { recursive: true, force: true });
      renameSync(tmpDir, distDir);
      break;
    } catch (err) {
      if (err.code !== 'ENOTEMPTY') {
        rmSync(tmpDir, { recursive: true, force: true });
        throw err;
      }
    }
  }

  console.log(`build ok — ${bundleLines.length} data file(s) bundled → dist/data/bundle.js`);
}

function report() {
  for (const error of errors) console.error(`ERROR: ${error}`);
  console.error(`\nbuild failed with ${errors.length} error(s)`);
  process.exit(1);
}

main();

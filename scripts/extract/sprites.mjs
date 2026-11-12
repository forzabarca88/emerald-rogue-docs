#!/usr/bin/env node
/**
 * scripts/extract/sprites.mjs — dev-only species-sprite extractor.
 *
 * For every Pokémon species directory in the union of the game repo's
 * `graphics/pokemon/` on BOTH branches, composites the in-game Pokedex front
 * art (4/8-bit indexed 64×64) with the species' `normal.pal` (JASC-PAL text
 * palette) and renders it at 2× (128×128) as a deterministic RGBA PNG in
 * `site/assets/pokemon/`:
 *
 *   - vanilla (working tree, branch `vanilla`):
 *       front.png + normal.pal                          (385 species; six of
 *                                                         the stills are 64×256
 *                                                         frame strips → frame 0)
 *       front_normal_form.png + normal_normal_form.pal  (castform)
 *       a/front.png + normal.pal                        (unown)
 *   - expansion (`origin/expansion`, read-only via `git cat-file --batch`):
 *       front.png + normal.pal                          (253 species)
 *       anim_front.png (first 64×64 frame) + normal.pal (773 species)
 *
 * FORM SPRITES (purely additive — the base-species loop above is untouched):
 * for every Expansion species-table entry that is NOT a base species (its id
 * does not name a top-level `graphics/pokemon/` directory), the shared
 * resolver `./sprite-forms.mjs` (imported by BOTH extractors) classifies the
 * form from the game's own INCBIN tables + species entries:
 *   - `own` — the form's resolved (front, palette) pair differs from its base
 *     directory's pair → a dedicated FLAT `<formEntryId>.png` is emitted
 *     through the exact same composite pipeline (e.g. `charizard_mega_x.png`);
 *   - `base-identical` — the pair is the base directory's pair (the base
 *     sprite already looks right, e.g. Deoxys (Normal)) → no file;
 *   - `ternary-macro` — the one pinned exception (`silvally_fairy`, see
 *     sprite-forms.mjs) → base art, no file.
 * Form ids with no species entry at all (the rogue-only custom forms)
 * deliberately get no file — the site falls back to the base sprite.
 * A full per-form resolution report (own / base-identical / ternary, with
 * every form's source files) is printed, and the run fails if any entry's
 * front/palette does not resolve to a real INCBIN source in the EX tree.
 *
 * The 387 species present in BOTH branches are byte-compared (vanilla vs
 * expansion composite); any divergence emits `<id>-ex.png` alongside
 * `<id>.png` (vanilla-preferred) and the full divergent id list is printed.
 *
 * Semantics (in-game fidelity):
 *   - index 0 is ALWAYS transparent (GBA OBJ convention; the PNG tRNS chunk —
 *     which says the same — is ignored);
 *   - JASC 8-bit palette values pass through the game's own RGB555
 *     downconversion (DOWNCONVERT_BIT_DEPTH, tools/gbagfx/gfx.c) and are
 *     expanded back to 8-bit by hardware zero-extension (`(c >> 3) << 3`), so
 *     the output matches the colours the GBA LCD actually shows;
 *   - the PNG's embedded PLTE (where present) is only an artist preview and
 *     may drift from the JASC palette — the JASC file is the runtime truth
 *     (it becomes `normal.gbapal`) and is what we composite with;
 *   - palettes with fewer than 16 entries leave the unused slots
 *     transparent; an image index into an unused slot fails loudly (none do);
 *   - output PNGs are byte-deterministic: filter-0 scanlines, zlib level 9,
 *     no tIME chunk, fixed chunk order (same input → same bytes, so `--check`
 *     is meaningful across runs).
 *
 * Usage:
 *   node scripts/extract/sprites.mjs               # write site/assets/pokemon/
 *   node scripts/extract/sprites.mjs --check       # verify existing outputs are up to date
 *   node scripts/extract/sprites.mjs --repo <path> # default: references/pokeemerald-rogue
 *   node scripts/extract/sprites.mjs --out <dir>   # default: site/assets/pokemon
 *
 * `--check` regenerates every sprite in memory and byte-compares against the
 * output directory; it exits non-zero (listing missing/stale/unexpected
 * files) when they differ, without writing anything.
 *
 * Dev-only: the build and tests never run this. It reads the game repo only
 * (working tree for vanilla, `git cat-file` for expansion — no branch is ever
 * checked out). Run `git -C references/pokeemerald-rogue fetch origin` first
 * so `origin/expansion` is current. Sprites are claimed to be extracted at
 * the pinned `scripts/verify/baseline.json` baseline; a SHA drift prints a
 * warning (bump the baseline after the docs are refreshed).
 *
 * Zero dependencies (node:fs, node:path, node:child_process, node:zlib).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { formRosterDomain, formSpriteFile, formSpriteManifest } from './sprite-forms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function rel(p) {
  return path.relative(ROOT, p) || '.';
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `usage: node scripts/extract/sprites.mjs [--check] [--repo <path>] [--out <dir>]

dev-only species-sprite extractor (see the header of this file for semantics).

  (no flags)            decode + composite every species' front art from both
                        branches and (re)write site/assets/pokemon/ (only files
                        whose content changed)
  --check               verify the existing outputs are up to date; exits
                        non-zero listing missing/stale/unexpected files
  --repo <path>         game repo (default: references/pokeemerald-rogue)
  --out <dir>           output directory (default: site/assets/pokemon)`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

let repoPath = path.join(ROOT, 'references', 'pokeemerald-rogue');
let outDir = path.join(ROOT, 'site', 'assets', 'pokemon');
let check = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--check') check = true;
  else if (a === '--repo') {
    const v = args[++i];
    if (!v) fail('--repo requires a value');
    repoPath = path.resolve(v);
  } else if (a === '--out') {
    const v = args[++i];
    if (!v) fail('--out requires a value');
    outDir = path.resolve(v);
  } else fail(`unknown argument: ${a}\n\n${HELP}`);
}

// ---------------------------------------------------------------------------
// Game repo access (never checks out a branch)
// ---------------------------------------------------------------------------

function git(...gitArgs) {
  const r = spawnSync('git', ['-C', repoPath, ...gitArgs], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${gitArgs.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function gitBytes(gitArgs, input) {
  const r = spawnSync('git', ['-C', repoPath, ...gitArgs], { input, maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${gitArgs.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

function assertRepoSane() {
  if (!existsSync(repoPath)) fail(`game repo not found at ${rel(repoPath)} — clone it first (see AGENTS.md setup)`);
  const branch = git('branch', '--show-current');
  if (branch !== 'vanilla') fail(`game repo working tree must be on branch 'vanilla' (found '${branch || 'detached HEAD'}')`);
  const exp = spawnSync('git', ['-C', repoPath, 'rev-parse', '--verify', '--quiet', 'origin/expansion'], { encoding: 'utf8' });
  if (exp.status !== 0 || !exp.stdout.trim()) fail('game repo has no origin/expansion ref — run: git -C ' + rel(repoPath) + ' fetch origin');
}

function warnBaselineDrift() {
  const basePath = path.join(ROOT, 'scripts', 'verify', 'baseline.json');
  if (!existsSync(basePath)) return;
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const checks = [
    ['vanilla', git('rev-parse', 'HEAD'), base.vanilla?.sha],
    ['expansion', git('rev-parse', 'origin/expansion'), base.expansion?.sha],
  ];
  for (const [name, actual, pinned] of checks) {
    if (pinned && actual !== pinned) {
      console.log(`WARNING: ${name} is at ${actual} but scripts/verify/baseline.json pins ${pinned} — the sprites will not match the pinned baseline; refresh the docs and bump the baseline.`);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG decode (indexed 4/8-bit, the exact shape these sprites have)
// ---------------------------------------------------------------------------

function parseChunks(buf, label) {
  if (buf.length < 8 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`${label}: not a PNG (bad signature)`);
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    if (off + 8 > buf.length) fail(`${label}: truncated PNG chunk header`);
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (!/^[\x21-\x7e]{4}$/.test(type)) fail(`${label}: bad PNG chunk type '${type}'`);
    if (off + 12 + len > buf.length) fail(`${label}: truncated PNG chunk '${type}'`);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

/**
 * Invert PNG scanline filters. `stride` is the BYTES per scanline
 * (ceil(width × depth / 8) — e.g. 32 for a 64-px-wide 4bpp row); the filter
 * reference distance is one byte (the PNG spec's bpp = 1 for depths ≤ 8).
 */
function unfilter(scanlines, stride, height, label) {
  const bpp = 1;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = scanlines[pos++];
    const row = scanlines.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: fail(`${label}: bad PNG filter type ${filter} at row ${y}`);
      }
      out[y * stride + x] = v;
    }
  }
  return out;
}

/**
 * Decode an indexed (colour type 3) 4/8-bit, non-interlaced PNG into
 * { w, h, depth, plte, indices }. Fails loudly on anything else — these
 * sprites are all exactly this shape (64 × {64,128,256}).
 * The tRNS chunk is deliberately ignored: GBA OBJ index 0 is the
 * transparent index regardless of it.
 *
 * The PLTE is an artist preview: the base fronts carry ≤16 entries, but the
 * EX form art (e.g. the Gigantamax sprites) ships 256 — the game still uses
 * the 16-colour JASC palette, and the index-range checks below (against the
 * PLTE length AND the JASC palette length) are the real gate, so the PLTE
 * size is only sanity-bounded (≤256 entries), never assumed.
 */
function decodeIndices(buf, label) {
  const chunks = parseChunks(buf, label);
  const byType = {};
  for (const c of chunks) (byType[c.type] ??= []).push(c);
  if (!byType.IHDR || byType.IHDR.length !== 1) fail(`${label}: missing/duplicate IHDR`);
  const ihdr = byType.IHDR[0].data;
  if (ihdr.length !== 13) fail(`${label}: bad IHDR length ${ihdr.length}`);
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const ctype = ihdr[9];
  const comp = ihdr[10];
  const filt = ihdr[11];
  const inter = ihdr[12];
  if (ctype !== 3) fail(`${label}: colour type ${ctype} (expected 3, indexed)`);
  if (depth !== 4 && depth !== 8) fail(`${label}: bit depth ${depth} (expected 4 or 8)`);
  if (comp !== 0 || filt !== 0 || inter !== 0) fail(`${label}: non-zero compression/filter/interlace in IHDR`);
  if (w !== 64 || h !== 64 && h !== 128 && h !== 256) fail(`${label}: unexpected size ${w}×${h} (expected 64×64, 64×128 or 64×256)`);
  const plte = byType.PLTE ? byType.PLTE[0].data : null;
  if (!plte || plte.length === 0 || plte.length % 3 !== 0 || plte.length > 768) fail(`${label}: missing/invalid PLTE`);
  if (!(byType.IDAT ?? []).length) fail(`${label}: no IDAT chunk`);
  const raw = inflateSync(Buffer.concat(byType.IDAT.map((c) => c.data)));
  const stride = Math.ceil((w * depth) / 8);
  if (raw.length !== h * (1 + stride)) fail(`${label}: inflated size ${raw.length} != expected ${h * (1 + stride)}`);
  const filtered = unfilter(raw, stride, h, label);
  let indices;
  if (depth === 8) {
    indices = filtered;
  } else {
    indices = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const byte = filtered[y * stride + (x >> 1)];
        indices[y * w + x] = x & 1 ? byte & 0x0f : byte >> 4;
      }
    }
  }
  return { w, h, depth, plte, indices };
}

// ---------------------------------------------------------------------------
// JASC-PAL decode (the .pal files: JASC-PAL\r\n0100\r\n<N>\r\n"R G B"…;
// vanilla uses CRLF, expansion uses LF — both accepted; see
// tools/gbagfx/jasc_pal.c for the format the game build itself consumes)
// ---------------------------------------------------------------------------

function parseJasc(buf, label) {
  const text = buf.toString('utf8');
  if (text.startsWith('\uFEFF')) fail(`${label}: BOM in palette file`);
  const lines = text.split(/\r\n|\n/);
  if (lines[0] !== 'JASC-PAL' || lines[1] !== '0100') fail(`${label}: not a JASC-PAL 8-bit palette file`);
  const n = Number(lines[2]);
  if (!Number.isInteger(n) || n < 1 || n > 256) fail(`${label}: bad palette count '${lines[2]}'`);
  const colors = [];
  for (let i = 0; i < n; i++) {
    const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(lines[3 + i] ?? '');
    if (!m) fail(`${label}: bad palette colour line ${i}: ${JSON.stringify(lines[3 + i])}`);
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (r > 255 || g > 255 || b > 255) fail(`${label}: palette colour ${i} out of range`);
    colors.push([r, g, b]);
  }
  const trailing = lines.slice(3 + n).join(' ').trim();
  if (trailing !== '') fail(`${label}: unexpected trailing data after ${n} colours`);
  return colors;
}

// ---------------------------------------------------------------------------
// Composite → 128×128 RGBA → deterministic PNG
// ---------------------------------------------------------------------------

/**
 * 16-slot RGBA table for a JASC palette. Slot 0 is transparent (GBA OBJ
 * convention); used slots carry the JASC colour through the game's own
 * 8→5-bit downconversion and back (hardware zero-extension of the 5-bit
 * value — exactly what the GBA LCD shows). Unused slots (palettes with
 * fewer than 16 entries) stay transparent.
 */
function paletteSlots(colors) {
  const slots = [];
  for (let i = 0; i < 16; i++) {
    if (i === 0 || i >= colors.length) slots.push([0, 0, 0, 0]);
    else {
      const [r, g, b] = colors[i];
      slots.push([(r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3, 255]);
    }
  }
  return slots;
}

function composite(pngBuf, palBuf, label) {
  const img = decodeIndices(pngBuf, label);
  const colors = parseJasc(palBuf, label);
  const maxIdx = img.indices.reduce((m, v) => (v > m ? v : m), 0);
  if (maxIdx >= img.plte.length / 3) fail(`${label}: pixel index ${maxIdx} out of PLTE range`);
  if (maxIdx >= colors.length) fail(`${label}: pixel index ${maxIdx} out of JASC palette range (${colors.length} colours)`);
  if (!img.indices.includes(0)) fail(`${label}: no index-0 (transparent) pixel — this is not a sprite front`);

  const slots = paletteSlots(colors);
  // 64×64 source: for 64×128 / 64×256 frame strips the first frame is the
  // still-front pose the game shows (rows 0..63).
  const out = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 128; y++) {
    const srcY = y >> 1;
    for (let x = 0; x < 128; x++) {
      const idx = img.indices[srcY * 64 + (x >> 1)];
      const [r, g, b, a] = slots[idx];
      const o = (y * 128 + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }

  // Per-output assertions: 128×128, ≥1 transparent pixel, finite size.
  if (out.length !== 128 * 128 * 4) fail(`${label}: bad composite size`);
  let transparent = false;
  for (let i = 3; i < out.length; i += 4) {
    if (out[i] === 0) { transparent = true; break; }
  }
  if (!transparent) fail(`${label}: composite has no transparent pixel (asserted ≥1)`);
  return { png: encodeRgbaPng(128, 128, out, label), depth: img.depth, h: img.h };
}

// ---------------------------------------------------------------------------
// Deterministic RGBA PNG encode (colour type 6, 8-bit, filter 0, level 9)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodeRgbaPng(w, h, rgba, label) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: None
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // comp/filter/interlace bytes are 0 (Buffer.alloc)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  if (!(png.length > 0 && Number.isFinite(png.length) && png.length < 65536)) fail(`${label}: encoded PNG size ${png.length} not finite/sane`);
  return png;
}

// ---------------------------------------------------------------------------
// Per-branch source resolution
// ---------------------------------------------------------------------------

// First match wins; the fallbacks are the vanilla-only layouts (castform's
// form-suffixed stills, unown's letter subdirectories).
const CANDIDATES = [
  { png: 'front.png', pal: 'normal.pal', name: 'front.png' },
  { png: 'anim_front.png', pal: 'normal.pal', name: 'anim_front.png (frame 0)' },
  { png: 'front_normal_form.png', pal: 'normal_normal_form.pal', name: 'front_normal_form.png (castform)' },
  { png: 'a/front.png', pal: 'normal.pal', name: 'a/front.png (unown)' },
];

// Directories under graphics/pokemon/ that are not species records.
const NON_SPECIES_DIRS = new Set(['icon_palettes', 'question_mark']);

function resolveVanilla(id) {
  const base = path.join(repoPath, 'graphics', 'pokemon', id);
  if (!existsSync(base) || !statSync(base).isDirectory()) return null;
  for (const c of CANDIDATES) {
    const p = path.join(base, c.png);
    const l = path.join(base, c.pal);
    if (existsSync(p) && existsSync(l)) {
      return { png: readFileSync(p), pal: readFileSync(l), candidate: c.name };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expansion side (origin/expansion, read-only, one batched cat-file)
// ---------------------------------------------------------------------------

// Phase 1 of the expansion side: the tree listing (top-level species id set +
// every file relative to graphics/pokemon/ + top-level filenames per id).
function expListing() {
  const listing = git('ls-tree', '-r', '--name-only', 'origin/expansion', '--', 'graphics/pokemon');
  const filesBySpecies = new Map(); // id -> Set(top-level filenames)
  const treeFiles = new Set(); // paths relative to graphics/pokemon/
  for (const line of listing.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('/');
    if (parts.length < 4 || parts[0] !== 'graphics' || parts[1] !== 'pokemon') continue;
    treeFiles.add(line.slice('graphics/pokemon/'.length));
    const id = parts[2];
    if (!filesBySpecies.has(id)) filesBySpecies.set(id, new Set());
    if (parts.length === 4) filesBySpecies.get(id).add(parts[3]);
  }
  return { ids: new Set(filesBySpecies.keys()), treeFiles, filesBySpecies };
}

// Phase 2: fetch the base-candidate blobs plus any extra form-sprite sources
// (one batched cat-file) and expose per-id base resolution + raw blob access.
function loadExpansion({ filesBySpecies, treeFiles }, extraWanted) {
  const want = new Map(); // repo path -> true
  for (const [id, files] of filesBySpecies) {
    for (const name of ['front.png', 'anim_front.png', 'normal.pal']) {
      if (files.has(name)) want.set(`graphics/pokemon/${id}/${name}`, true);
    }
  }
  for (const p of extraWanted) {
    if (!treeFiles.has(p.slice('graphics/pokemon/'.length))) fail(`form-sprite source ${p} is not in the EX tree (re-run after 'git fetch origin')`);
    want.set(p, true);
  }
  const tree = git('ls-tree', '-r', 'origin/expansion', '--', 'graphics/pokemon');
  const shaByPath = new Map();
  for (const line of tree.trim().split('\n')) {
    const tab = line.indexOf('\t');
    shaByPath.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]);
  }
  const shas = [...new Set([...want.keys()].map((p) => shaByPath.get(p)).filter(Boolean))];
  if (shas.length === 0) fail('expansion graphics/pokemon tree is empty');
  const batch = gitBytes(['cat-file', '--batch'], shas.join('\n') + '\n');
  const bySha = new Map();
  let off = 0;
  while (off < batch.length) {
    const nl = batch.indexOf(0x0a, off);
    if (nl < 0) fail('malformed git cat-file --batch response');
    const [sha, type, size] = batch.toString('utf8', off, nl).split(' ');
    off = nl + 1;
    if (type !== 'blob') fail(`git cat-file --batch: unexpected type '${type}' for ${sha}`);
    const n = Number(size);
    bySha.set(sha, Buffer.from(batch.subarray(off, off + n)));
    off += n + 1; // include the trailing 0x00
  }
  const resolve = (id) => {
    const files = filesBySpecies.get(id) ?? new Set();
    for (const c of CANDIDATES) {
      if (c.png.includes('/')) continue; // no subdirectory layouts exist on expansion
      if (!files.has(c.png) || !files.has(c.pal)) continue;
      const png = bySha.get(shaByPath.get(`graphics/pokemon/${id}/${c.png}`));
      const pal = bySha.get(shaByPath.get(`graphics/pokemon/${id}/${c.pal}`));
      if (png && pal) return { png, pal, candidate: c.name };
      fail(`expansion/${id}: ls-tree lists ${c.png}/${c.pal} but cat-file returned no blob — repo state inconsistent, re-run after 'git fetch origin'`);
    }
    return null;
  };
  const blob = (repoPath) => bySha.get(shaByPath.get(repoPath));
  return { resolve, blob };
}

// Phase 3: the parsed expansion-profile Species lists (one batched
// cat-file) — inputs to the shared form-roster rule (which form ids a
// record's `forms` list carries).
function expansionProfiles() {
  const tree = git('ls-tree', '-r', 'origin/expansion', '--', 'src/data/rogue/pokemon/expansion');
  const files = [];
  const shas = [];
  for (const line of tree.trim().split('\n')) {
    if (!line || !line.endsWith('expansion_profile.json')) continue;
    const tab = line.indexOf('\t');
    files.push(line.slice(tab + 1));
    shas.push(line.slice(0, tab).split(' ')[2]);
  }
  if (shas.length === 0) return new Map();
  const batch = gitBytes(['cat-file', '--batch'], shas.join('\n') + '\n');
  const out = new Map();
  let off = 0;
  for (const file of files) {
    const nl = batch.indexOf(0x0a, off);
    if (nl < 0) fail('malformed git cat-file --batch response (profiles)');
    const [ , , size] = batch.toString('utf8', off, nl).split(' ');
    off = nl + 1;
    const body = batch.toString('utf8', off, off + Number(size));
    off += Number(size) + 1; // include the trailing 0x00
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const sp = (data.Species ?? []).map((s) => s.slice('SPECIES_'.length).toLowerCase());
    if (sp.length > 0) {
      const id = file.replace(/^src\/data\/rogue\/pokemon\/expansion\//, '').replace(/\/expansion_profile\.json$/, '');
      out.set(id, sp);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

assertRepoSane();
warnBaselineDrift();

const expTree = expListing();

const vanillaDirs = readdirSync(path.join(repoPath, 'graphics', 'pokemon'))
  .filter((d) => statSync(path.join(repoPath, 'graphics', 'pokemon', d)).isDirectory())
  .sort();

// Form-sprite manifest (shared with the pokedex extractor — the single
// source of the form→art rule). Needs the RAW headers: the species
// initializers are macro calls whose #define lives in the same headers.
const formManifest = formSpriteManifest({
  pokemonH: git('show', 'origin/expansion:src/data/graphics/pokemon.h'),
  speciesTableTexts: [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => git(`show`, `origin/expansion:src/data/pokemon/species_info/gen_${g}.h`)),
    git('show', 'origin/expansion:src/data/pokemon/species_info.h'),
  ],
  baseDirs: new Set([...vanillaDirs, ...expTree.ids].map((d) => d.toLowerCase())),
  exTreeFiles: expTree.treeFiles,
  label: 'sprites',
});
const formWanted = [...formManifest.forms.values()].filter((f) => f.cls === 'own').flatMap((f) => [f.frontPath, f.palPath]);
const exp = { ids: expTree.ids, ...loadExpansion(expTree, new Set(formWanted)) };

// Form rosters (shared rule with the pokedex extractor): an own form ships
// art only when a record's `forms` list can reference it. Same raw headers
// as the manifest above.
const formRosters = formRosterDomain({
  pokedexH: git('show', 'origin/expansion:include/constants/pokedex.h'),
  speciesTableTexts: [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => git(`show`, `origin/expansion:src/data/pokemon/species_info/gen_${g}.h`)),
    git('show', 'origin/expansion:src/data/pokemon/species_info.h'),
  ],
  formTableTexts: [
    git('show', 'origin/expansion:src/data/pokemon/form_species_tables.h'),
    git('show', 'origin/expansion:src/data/pokemon/form_change_tables.h'),
  ],
  profiles: expansionProfiles(),
  label: 'sprites',
});

const union = [...new Set([...vanillaDirs, ...exp.ids])].sort();
const skipped = [];
const divergent = [];
const stats = { vanilla: {}, expansion: {} };
const bump = (side, key) => { stats[side][key] = (stats[side][key] ?? 0) + 1; };

const outputs = new Map(); // filename -> PNG buffer
let vanillaCount = 0;
let expansionCount = 0;
let sharedCount = 0;

for (const id of union) {
  if (NON_SPECIES_DIRS.has(id)) {
    skipped.push(id);
    continue;
  }
  const v = resolveVanilla(id);
  const e = exp.ids.has(id) ? exp.resolve(id) : null;
  if (!v && !e) fail(`no front art for species '${id}' (tried ${CANDIDATES.map((c) => c.png).join(', ')} on both branches) — new layout? update the extractor`);

  if (v) {
    const r = composite(v.png, v.pal, `vanilla/${id} (${v.candidate})`);
    bump('vanilla', `src:${r.h === 64 ? '64x64' : `64x${r.h}-frame0`}`);
    bump('vanilla', `depth${r.depth}`);
    bump('vanilla', v.candidate);
    vanillaCount++;
    if (e) {
      const r2 = composite(e.png, e.pal, `expansion/${id} (${e.candidate})`);
      bump('expansion', r2.h === 64 ? '64x64' : `64x${r2.h}-frame0`);
      bump('expansion', `depth${r2.depth}`);
      bump('expansion', e.candidate);
      sharedCount++;
      if (r.png.equals(r2.png)) {
        outputs.set(`${id}.png`, r.png);
      } else {
        outputs.set(`${id}.png`, r.png);
        outputs.set(`${id}-ex.png`, r2.png);
        divergent.push(id);
      }
      continue;
    }
    outputs.set(`${id}.png`, r.png);
  } else {
    const r = composite(e.png, e.pal, `expansion/${id} (${e.candidate})`);
    bump('expansion', r.h === 64 ? '64x64' : `64x${r.h}-frame0`);
    bump('expansion', `depth${r.depth}`);
    bump('expansion', e.candidate);
    expansionCount++;
    outputs.set(`${id}.png`, r.png);
  }
}

// ---- form sprites (purely additive — base outputs above are untouched) ----
const formStats = { own: 0, unreferenced: 0, baseIdentical: 0, ternary: 0 };
const formReport = []; // one line per form entry, sorted by id
for (const [id, form] of formManifest.forms) {
  if (form.cls !== 'own') {
    formStats[form.cls === 'base-identical' ? 'baseIdentical' : 'ternary']++;
    formReport.push([id, form.cls, `${form.cls} — base art (sources: ${form.frontPath} + ${form.palPath})`]);
    continue;
  }
  if (!formRosters.referenced.has(id)) {
    formStats.unreferenced++;
    formReport.push([id, 'own', 'own — NOT referenced by any record form roster — no file (dead species-table data)']);
    continue;
  }
  const png = exp.blob(form.frontPath);
  const pal = exp.blob(form.palPath);
  if (!png || !pal) fail(`form ${id}: ls-tree lists ${form.frontPath}/${form.palPath} but cat-file returned no blob — repo state inconsistent, re-run after 'git fetch origin'`);
  const r = composite(png, pal, `expansion-form/${id} (${form.frontPath.split('/').slice(-2).join('/')})`);
  bump('expansion', r.h === 64 ? '64x64' : `64x${r.h}-frame0`);
  bump('expansion', `depth${r.depth}`);
  formStats.own++;
  formReport.push([id, 'own', `own → ${form.frontPath} + ${form.palPath}`]);
  outputs.set(formSpriteFile(id), r.png);
}
formReport.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const expansionOnly = expansionCount;
const total = outputs.size;

if (check) {
  if (!existsSync(outDir)) fail(`--check: output directory ${rel(outDir)} does not exist — run 'npm run extract:sprites' first`);
  const actual = readdirSync(outDir).sort();
  const missing = [...outputs.keys()].filter((f) => !actual.includes(f));
  const stale = [...outputs.keys()].filter((f) => actual.includes(f) && !outputs.get(f).equals(readFileSync(path.join(outDir, f))));
  const unexpected = actual.filter((f) => !outputs.has(f));
  if (missing.length || stale.length || unexpected.length) {
    console.error(`ERROR: ${rel(outDir)} is not up to date: ${missing.length} missing, ${stale.length} stale, ${unexpected.length} unexpected`);
    for (const f of missing) console.error(`  missing:    ${f}`);
    for (const f of stale) console.error(`  stale:      ${f}`);
    for (const f of unexpected) console.error(`  unexpected: ${f}`);
    fail("run 'npm run extract:sprites' to regenerate");
  }
  console.log(`check ok: ${total} sprite(s) in ${rel(outDir)} are up to date`);
  process.exit(0);
}

// Stale form outputs: a prior generation's <formEntryId>.png for a form that
// is no longer roster-referenced (form-scope only — base files are never
// touched here; --check reports them as unexpected instead).
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir)) {
    const id = f.slice(0, -'.png'.length);
    if (formManifest.forms.has(id) && !outputs.has(f)) {
      rmSync(path.join(outDir, f));
      console.log(`removed stale form output ${f}`);
    }
  }
}

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const [f, buf] of [...outputs.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
  const p = path.join(outDir, f);
  if (!existsSync(p) || !readFileSync(p).equals(buf)) {
    writeFileSync(p, buf);
    written++;
  }
}

const sum = (o) => Object.entries(o).map(([k, n]) => `${k}=${n}`).join(' ');
console.log(`vanilla:   ${vanillaCount} species  [${sum(stats.vanilla)}]`);
console.log(`expansion: ${sharedCount + expansionOnly} species  [${sum(stats.expansion)}]`);
console.log(`shared ids: ${sharedCount}; expansion-only: ${expansionOnly}; skipped non-species dirs: ${skipped.join(', ') || '(none)'}`);
if (divergent.length) {
  console.log(`divergent (branch-specific art) — ${divergent.length} id(s) also emitted as <id>-ex.png:`);
  for (const id of divergent) console.log(`  ${id}`);
} else {
  console.log('divergent: 0 (every shared id composites identically on both branches)');
}
console.log(`form sprites: ${formStats.own} own (emitted as <formEntryId>.png — roster-referenced) · ${formStats.unreferenced} own but unreferenced by any record form roster (no file) · ${formStats.baseIdentical} base-identical (base art) · ${formStats.ternary} ternary-macro (base art) — forms with no species entry get no file (base-sprite fallback)`);
for (const [id, cls, detail] of formReport) console.log(`  ${id}: ${detail}`);
console.log(`wrote ${written} file(s) (${total} total) to ${rel(outDir)}`);

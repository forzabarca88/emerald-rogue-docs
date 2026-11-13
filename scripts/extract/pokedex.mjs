#!/usr/bin/env node
/**
 * Pokédex extraction for the Emerald Rogue docs site (provenance for
 * data/pokedex.json).
 *
 * DEV-ONLY: run manually (`npm run extract:pokedex`). The build and tests never
 * invoke this script — the committed data/pokedex.json is the source of truth.
 *
 * Usage:
 *   node scripts/extract/pokedex.mjs                  # emit data/pokedex.json (both versions)
 *   node scripts/extract/pokedex.mjs --repo <path>    # default: references/pokeemerald-rogue
 *   node scripts/extract/pokedex.mjs --out <path>     # default: data/pokedex.json
 *   node scripts/extract/pokedex.mjs --check          # verify the committed file is up to date
 *
 * Record universe: one record per numbered species in the Expansion national
 * dex — the 1025 `NATIONAL_DEX_*` numbers of include/constants/species.h
 * (origin/expansion, #1–#1025), claimed by each species entry's `.natDexNum`.
 * The species tables (src/data/pokemon/species_info/gen_1..9.h) hold 1505
 * `[SPECIES_X] =` initializers; form groups without an initializer of their
 * own (Castform, Deoxys, Arceus, …) get their base record synthesized from
 * the group's first form, and the dex-less forms (540) are not records — they
 * surface through the base's forms list. (Vanilla's numbered dex is
 * src/data/pokemon/pokedex_entries.h's 387 entries; the two are joined by
 * national dex number.) Each record is joined to the Vanilla working tree's
 * species by national dex number (exact species id when the ids coincide,
 * otherwise the first entry with that number — Vanilla's single-species
 * Castform/Deoxys map onto their Expansion base forms). The 25 Vanilla-only
 * legacy Unown letters (named "?", no Pokédex entry, no profile, absent from
 * every Vanilla dex variant) are excluded from records. Top-level fields carry
 * the Expansion values; the `vanilla` object holds only the fields that differ
 * under Vanilla.
 *
 * Loader semantics replicated:
 *   - A miniature C preprocessor (line continuations, string-aware comments,
 *     #if/#ifdef/#ifndef/#elif/#else/#endif with integer-expression
 *     evaluation, #define/#undef/#error, #include "..." resolved against
 *     include/ and the including file's dir) runs over the Expansion headers
 *     with the real build's config (include/config headers → the P_ and B_
 *     toggles), so `#if P_FAMILY_...` guards in the species tables resolve
 *     exactly as in a ROGUE_EXPANSION build.
 *   - Family `X_MISC_INFO(…)` macro blocks (stats/types/abilities shared by a
 *     species family) are inlined into each entry before that entry's own
 *     designated initializers apply, so later assignments override earlier
 *     ones — the C compiler's semantics.
 *   - Dex variant membership mirrors RoguePokedex_IsSpeciesAllowed /
 *     RoguePokedex_IsBaseSpeciesEnabled (src/rogue_pokedex.c): a variant lists
 *     a species when it contains the species itself or its base species
 *     (GET_BASE_SPECIES_ID — the first member of the form table).
 *   - TM/TR learnability mirrors CanSpeciesLearnTM (src/pokemon.c): a TM is
 *     learnable iff its sTMHMMoves move (src/data/party_menu.h) appears in
 *     the species' LevelUpMoves ∪ TutorMoves profile lists.
 *   - Forms inherit the base species' learnset in-game (the Pokédex resolves
 *     GET_BASE_SPECIES_ID before reading the profile), so form records carry
 *     the base profile's moves.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { NON_SPECIES_DIRS, formSpriteManifest, parseSpriteTables } from './sprite-forms.mjs';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { repo: 'references/pokeemerald-rogue', out: 'data/pokedex.json', check: false };
  const value = (flag, index) => {
    const next = argv[index + 1];
    if (next === undefined) fail(`Missing value for ${flag}`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = value(arg, i); i++; }
    else if (arg === '--out') { args.out = value(arg, i); i++; }
    else if (arg === '--check') args.check = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/extract/pokedex.mjs [--repo <path>] [--out <path>] [--check]');
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
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
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
  git(repo, 'rev-parse', '--verify', 'origin/expansion'); // throws if missing
}

function makeFileProvider(read, exists) {
  const cache = new Map();
  return {
    has(file) { return exists(file); },
    fetch(file) {
      if (!cache.has(file)) cache.set(file, read(file));
      return cache.get(file);
    },
  };
}

// ---------------------------------------------------------------------------
// Miniature C preprocessor
// ---------------------------------------------------------------------------
//
// Handles: line continuations, // and /* */ comments (string-literal aware),
// #if / #ifdef / #ifndef / #elif / #else / #endif with integer-expression
// evaluation, #define (object-like values evaluated; function-like bodies kept
// verbatim for inlining), #undef, #error, #warning, and #include "..."
// resolved against the configured roots plus the including file's directory.
// Every other directive is rejected — each file this extractor touches uses
// only the above.
//
// A Preprocessor owns one shared `defines` map and one shared `enums` map;
// each file is preprocessed at most once per mode. 'output' mode returns the
// active source text (directives removed, includes inlined); 'defines' mode
// only updates the maps.

class Preprocessor {
  constructor({ provider, defines, enums, includeRoots, label }) {
    this.provider = provider;
    this.defines = defines; // Map name -> { params, body } (params null for object-like)
    this.enums = enums; // Map name -> int
    this.includeRoots = includeRoots;
    this.label = label;
    this.processed = new Set(); // "mode:file" keys
    this.defCache = new Map(); // name -> int
    this.defInProgress = new Set();
    this.outputCache = new Map(); // "mode:file" -> output text (a file walked again, e.g. through an including header, returns the same text)
  }

  /** Lazily evaluate an object-like macro body (cycle-safe). */
  evalDefine(name, where) {
    if (this.defCache.has(name)) return this.defCache.get(name);
    const def = this.defines.get(name);
    if (!def || def.params) fail(`${where}: ${name} is not an object-like macro`);
    if (this.defInProgress.has(name)) fail(`${where}: macro cycle involving ${name}`);
    this.defInProgress.add(name);
    let value;
    try {
      value = def.body.trim() === '' ? 1 : this.evalExpr(def.body, `${where} (via ${name})`);
    } finally {
      this.defInProgress.delete(name);
    }
    this.defCache.set(name, value);
    return value;
  }

  /** Evaluate an integer expression; unknown identifiers fail loudly. */
  evalExpr(expr, where, opts = {}) {
    // In a #if condition the C preprocessor replaces identifiers left
    // undefined by macro expansion with 0; data expressions keep failing.
    const unresolvedZero = opts.unresolvedZero === true;
    const toks = tokenizeExpression(expr);
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const accept = (v) => (peek() && peek().v === v ? (next(), true) : false);

    let pPrimary, pMul, pAdd, pShift, pRel, pEq, pBitAnd, pBitXor, pBitOr, pLogicAnd, pLogicOr, pTernary;
    pTernary = () => {
      const cond = pLogicOr();
      if (accept('?')) {
        const t = pTernary();
        if (!accept(':')) throw new Error(`missing ":" in ternary in ${where}`);
        const f = pTernary();
        return cond ? t : f;
      }
      return cond;
    };
    pLogicOr = () => {
      let l = pLogicAnd();
      let used = false;
      // no JS short-circuit: the right side must always be consumed
      while (peek() && peek().t === 'op' && peek().v === '||') { next(); const r = pLogicAnd(); l = l ? 1 : r; used = true; }
      return used ? (l ? 1 : 0) : l; // C: || yields 0/1; a bare operand keeps its value
    };
    pLogicAnd = () => {
      let l = pBitOr();
      let used = false;
      while (peek() && peek().t === 'op' && peek().v === '&&') { next(); const r = pBitOr(); l = l ? r : 0; used = true; }
      return used ? (l ? 1 : 0) : l;
    };
    pBitOr = () => {
      let l = pBitXor();
      while (peek() && peek().t === 'op' && peek().v === '|') { next(); l = l | pBitXor(); }
      return l;
    };
    pBitXor = () => {
      let l = pBitAnd();
      while (peek() && peek().t === 'op' && peek().v === '^') { next(); l = l ^ pBitAnd(); }
      return l;
    };
    pBitAnd = () => {
      let l = pEq();
      while (peek() && peek().t === 'op' && peek().v === '&') { next(); l = l & pEq(); }
      return l;
    };
    pEq = () => {
      let l = pRel();
      for (;;) {
        const tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '==' || tk.v === '!=')) {
          next();
          const r = pRel();
          l = tk.v === '==' ? (l === r ? 1 : 0) : (l !== r ? 1 : 0);
        } else break;
      }
      return l;
    };
    pRel = () => {
      let l = pShift();
      for (;;) {
        const tk = peek();
        if (tk && tk.t === 'op' && ['<', '>', '<=', '>='].includes(tk.v)) {
          next();
          const r = pShift();
          l = tk.v === '<' ? (l < r ? 1 : 0) : tk.v === '>' ? (l > r ? 1 : 0) : tk.v === '<=' ? (l <= r ? 1 : 0) : (l >= r ? 1 : 0);
        } else break;
      }
      return l;
    };
    pShift = () => {
      let l = pAdd();
      for (;;) {
        const tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '<<' || tk.v === '>>')) {
          next();
          const r = pAdd();
          l = tk.v === '<<' ? l << r : l >> r;
        } else break;
      }
      return l;
    };
    pAdd = () => {
      let l = pMul();
      for (;;) {
        const tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
          next();
          const r = pMul();
          l = tk.v === '+' ? l + r : l - r;
        } else break;
      }
      return l;
    };
    pMul = () => {
      let l = pPrimary();
      for (;;) {
        const tk = peek();
        if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
          next();
          const r = pPrimary();
          l = tk.v === '*' ? l * r : Math.trunc(l / r);
        } else break;
      }
      return l;
    };
    pPrimary = () => {
      const tk = next();
      if (!tk) throw new Error(`unexpected end of expression in ${where}`);
      if (tk.t === 'num') return tk.v;
      if (tk.t === 'op') {
        if (tk.v === '!') return pPrimary() ? 0 : 1;
        if (tk.v === '-') return -pPrimary();
        if (tk.v === '+') return pPrimary();
        if (tk.v === '(') {
          const v = pTernary();
          if (!accept(')')) throw new Error(`missing ")" in ${where}`);
          return v;
        }
      }
      if (tk.t === 'id') {
        if (tk.v === 'TRUE') return 1;
        if (tk.v === 'FALSE') return 0;
        if (tk.v === 'defined') {
          if (!accept('(')) throw new Error(`defined( without paren in ${where}`);
          const id = next();
          if (!id || id.t !== 'id') throw new Error(`bad defined() argument in ${where}`);
          if (!accept(')')) throw new Error(`missing ) after defined() in ${where}`);
          return this.defines.has(id.v) || this.enums.has(id.v) ? 1 : 0;
        }
        if (tk.v === 'min' || tk.v === 'max') {
          const a = pTernary();
          if (accept(',')) {
            const b = pTernary();
            return tk.v === 'min' ? Math.min(a, b) : Math.max(a, b);
          }
          return a;
        }
        const def = this.defines.get(tk.v);
        if (def) {
          if (def.params) throw new Error(`function-like macro ${tk.v} used as object-like in ${where}`);
          if (def.body.includes('{') || def.body.includes(';')) fail(`${where}: macro ${tk.v} has a non-constant body and cannot appear in an expression`);
          return this.evalDefine(tk.v, where);
        }
        if (this.enums.has(tk.v)) return this.enums.get(tk.v);
        if (unresolvedZero) return 0;
        throw new Error(`unresolved identifier ${tk.v} in ${where}`);
      }
      throw new Error(`unexpected token ${JSON.stringify(tk)} in ${where}`);
    };

    const result = pTernary();
    if (pos !== toks.length) throw new Error(`leftover tokens ${JSON.stringify(toks.slice(pos))} in ${where}`);
    return result;
  }

  /** Preprocess one file (recursing into includes); at most once per mode. */
  process(file, mode, depth = 0) {
    if (depth > 64) fail(`${this.label}: include depth exceeded at ${file}`);
    const key = `${mode}:${file}`;
    if (this.processed.has(key)) return this.outputCache.get(key) ?? '';
    this.processed.add(key);

    const text = this.provider.fetch(file);
    // join line continuations
    const rawLines = text.split('\n');
    const lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      while (line.trimEnd().endsWith('\\') && i + 1 < rawLines.length) {
        i++;
        line = line.trimEnd().slice(0, -1) + ' ' + rawLines[i];
      }
      lines.push(line);
    }

    const out = [];
    const stack = [];
    const condActive = () => stack.every((f) => f.active);

    let blockComment = false;
    for (const rawLine of lines) {
      let line = '';
      let inString = false;
      for (let i = 0; i < rawLine.length; i++) {
        const ch = rawLine[i];
        if (inString) {
          line += ch;
          if (ch === '\\' && i + 1 < rawLine.length) { line += rawLine[++i]; continue; }
          if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; line += ch; continue; }
        if (blockComment) {
          if (ch === '*' && rawLine[i + 1] === '/') { blockComment = false; i++; }
          continue;
        }
        if (ch === '/' && rawLine[i + 1] === '/') break;
        if (ch === '/' && rawLine[i + 1] === '*') { blockComment = true; i++; continue; }
        line += ch;
      }
      const trimmed = line.trim();
      if (!trimmed.startsWith('#')) {
        if (mode === 'output' && condActive()) out.push(line);
        continue;
      }
      const dm = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif|define|undef|include|error|warning)\b\s*(.*)$/.exec(trimmed);
      if (!dm) fail(`${this.label}: unrecognized directive in ${file}: ${trimmed.slice(0, 60)}`);
      const [, kind, rest] = dm;
      const flow = ['if', 'ifdef', 'ifndef', 'elif', 'else', 'endif'].includes(kind);
      if (!flow && !condActive()) continue; // inactive non-flow directive: ignored

      if (['if', 'ifdef', 'ifndef', 'elif', 'else'].includes(kind)) {
        const top = stack[stack.length - 1];
        if (kind === 'if' || kind === 'ifdef' || kind === 'ifndef') {
          let value;
          if (kind === 'ifdef') value = (this.defines.has(rest.trim()) || this.enums.has(rest.trim())) ? 1 : 0;
          else if (kind === 'ifndef') value = (this.defines.has(rest.trim()) || this.enums.has(rest.trim())) ? 0 : 1;
          else value = this.evalExpr(rest, `${file} #${kind} ${rest.trim()}`, { unresolvedZero: true }) ? 1 : 0;
          stack.push({ active: Boolean(value), taken: Boolean(value), hasElse: false });
        } else if (!top) {
          fail(`${this.label}: #${kind} without #if in ${file}`);
        } else if (kind === 'else') {
          if (top.hasElse) fail(`${this.label}: duplicate #else in ${file}`);
          top.hasElse = true;
          top.active = !top.taken;
        } else {
          // #elif
          if (!top.taken && !top.hasElse) {
            const value = this.evalExpr(rest, `${file} #elif ${rest.trim()}`, { unresolvedZero: true }) ? 1 : 0;
            top.taken = Boolean(value);
            top.active = Boolean(value);
          } else {
            top.active = false;
          }
        }
        continue;
      }
      if (kind === 'endif') {
        if (!stack.length) fail(`${this.label}: #endif without #if in ${file}`);
        stack.pop();
        continue;
      }
      if (kind === 'define') {
        const md = /^([A-Za-z_][A-Za-z0-9_]*)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
        if (!md) fail(`${this.label}: bad #define in ${file}: ${rest.slice(0, 60)}`);
        const [, name, , paramList, body] = md;
        if (paramList !== undefined) {
          const params = paramList.split(',').map((p) => p.trim()).filter(Boolean);
          this.defines.set(name, { params, body: body.trim() });
        } else {
          // Object-like: keep the body and evaluate lazily on first use in an
          // expression (type aliases like `#define RAND_TYPE u32` are never
          // evaluated and cost nothing). Bodies that are struct fragments
          // (the X_MISC_INFO blocks, OLD_UNOWN_BASE_STATS) are marked raw so
          // inlineMacros pastes them in verbatim.
          const bodyTrim = body.trim();
          // A raw (paste-in) body is either a struct fragment (carries a
          // designated-initializer field, `.field =`) or a braced list (the
          // X_FAMILY_TYPES macros). Constant expression bodies are neither.
          const isRaw = bodyTrim.includes('{') || /(^|[^A-Za-z0-9_.])\.[A-Za-z_]\w*\s*=/.test(bodyTrim);
          this.defines.set(name, { params: null, body: bodyTrim, raw: isRaw });
        }
        continue;
      }
      if (kind === 'undef') {
        this.defines.delete(rest.trim());
        continue;
      }
      if (kind === 'include') {
        if (rest.startsWith('<') && rest.endsWith('>')) {
          // System headers (<string.h> & co): compiler-provided, never game
          // code — nothing the species data needs comes from them.
          if (mode === 'output' && condActive()) out.push('');
          continue;
        }
        const im = /^"([^"]+)"$/.exec(rest);
        if (!im) fail(`${this.label}: unsupported #include form in ${file}: ${rest}`);
        const target = im[1];
        const candidates = [
          ...this.includeRoots.map((root) => path.posix.join(root, target)),
          path.posix.normalize(path.posix.join(path.posix.dirname(file), target)),
        ];
        const resolved = candidates.find((c) => this.provider.has(c));
        if (!resolved) {
          // generated/*.h are build-time artifacts (e.g. the quest const
          // table) pulled in by the include chain; the extractor never reads
          // their contents, so they stub out as empty.
          if (/^generated\/|\/generated\//.test(target)) {
            if (mode === 'output' && condActive()) out.push('');
            continue;
          }
          fail(`${this.label}: cannot resolve #include "${target}" (from ${file})`);
        }
        const included = this.process(resolved, 'output', depth + 1);
        if (mode === 'output' && condActive()) out.push(included);
        continue;
      }
      if (kind === 'warning') continue;
      fail(`${this.label}: #error in ${file}: ${rest}`);
    }
    if (stack.length !== 0) fail(`${this.label}: unbalanced #if in ${file}`);
    if (blockComment) fail(`${this.label}: unterminated block comment in ${file}`);
    const result = mode === 'output' ? out.join('\n') : '';
    this.outputCache.set(key, result);
    return result;
  }

  /**
   * Inline macro definitions into an entry body: function-like `NAME(args)`
   * calls expand with their arguments; object-like defines that carry a raw
   * body (the family X_MISC_INFO blocks) are pasted in; evaluated constant
   * defines are left in place for evalExpr.
   */
  /**
   * @param {number} budget total expansions left for this entry; each
   * replacement re-scans the whole text (budget - 1), so a genuine macro
   * cycle burns the budget down and fails instead of looping forever.
   */
  // String-valued macros: their argument IS the data (a pokedex description
  // or a string literal), so expanding them would erase the text. The text
  // resolvers parse their raw argument instead.
  static stringMacros = new Set(['POKEDEX_DESC_STRING', 'COMPOUND_STRING']);

  inlineMacros(text, where, budget = 400) {
    if (budget <= 0) fail(`${where}: macro expansion did not settle`);
    const re = /\b([A-Z][A-Z0-9_]*?)(?!\w)/g;
    let m;
    while ((m = re.exec(text))) {
      const def = this.defines.get(m[1]);
      if (!def) continue;
      if (Preprocessor.stringMacros.has(m[1])) continue;
      let j = m.index + m[1].length;
      while (j < text.length && /\s/.test(text[j])) j++;
      let replacement;
      let consumeTo;
      if (def.params) {
        if (text[j] !== '(') continue; // bare token, not a call
        let k = j + 1;
        let argStart = k;
        const args = [];
        let paren = 1;
        while (k < text.length && paren > 0) {
          if (text[k] === '(') paren++;
          else if (text[k] === ')') paren--;
          else if (text[k] === ',' && paren === 1) { args.push(text.slice(argStart, k).trim()); argStart = k + 1; }
          if (paren > 0) k++;
        }
        if (paren !== 0) fail(`${where}: unbalanced macro arguments for ${m[1]}`);
        args.push(text.slice(argStart, k).trim());
        if (args.length !== def.params.length) continue; // variadic: leave as-is
        replacement = this.expandBody(def.body, def.params, args, where);
        consumeTo = k + 1;
      } else {
        if (!def.raw) continue; // constant define: left in place for evalExpr
        replacement = def.body;
        consumeTo = m.index + m[1].length;
      }
      const out = text.slice(0, m.index) + replacement + text.slice(consumeTo);
      return this.inlineMacros(out, where, budget - 1);
    }
    return text;
  }

  expandBody(body, params, args, where) {
    let out = body;
    params.forEach((p, i) => {
      out = out.replace(new RegExp(`\\b${p}\\b`, 'g'), args[i] ?? '');
    });
    // C token pasting (##): splice the adjacent word tokens together.
    // Pasted names (gAlcremieVanillaCreamPokedexText, gfx symbols) are data,
    // so pasting must happen after substitution; chains (a##b##c) iterate.
    let prev;
    do {
      prev = out;
      out = out.replace(/([A-Za-z0-9_]+)\s*##\s*([A-Za-z0-9_]+)/g, '$1$2');
    } while (out !== prev);
    if (out.includes('##')) fail(`${where}: unresolvable ## paste in macro body`);
    return out;
  }
}

function tokenizeExpression(expr) {
  const toks = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i;
      if (expr[j] === '0' && (expr[j + 1] === 'x' || expr[j + 1] === 'X')) {
        j += 2;
        while (j < expr.length && /[0-9a-fA-F]/.test(expr[j])) j++;
        toks.push({ t: 'num', v: parseInt(expr.slice(i, j), 16) });
      } else {
        while (j < expr.length && /[0-9]/.test(expr[j])) j++;
        if (expr[j] === '.' && j + 1 < expr.length && /[0-9]/.test(expr[j + 1])) {
          j++;
          while (j < expr.length && /[0-9]/.test(expr[j])) j++;
          toks.push({ t: 'num', v: parseFloat(expr.slice(i, j)) });
        } else {
          toks.push({ t: 'num', v: parseInt(expr.slice(i, j), 10) });
        }
      }
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      toks.push({ t: 'id', v: expr.slice(i, j) });
      i = j;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['&&', '||', '<<', '>>', '<=', '>=', '==', '!='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/<>&|^!?:()'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error(`bad char ${JSON.stringify(ch)} in expression ${JSON.stringify(expr)}`);
  }
  return toks;
}

/** Collect enum constants (`enum { A, B = 3, C }`) from raw header text. */
function collectEnums(text, where, enums) {
  const re = /\benum\s*(?:[A-Za-z_]\w*\s*)?\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    let value = 0;
    const stripped = m[1].replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const part of stripped.split(',')) {
      const item = part.trim();
      if (!item) continue;
      const em = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([A-Za-z0-9_+\- ]+))?$/.exec(item);
      if (!em) fail(`${where}: unrecognized enum member ${JSON.stringify(item)}`);
      if (em[2] !== undefined) {
        const simplified = em[2].trim().replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
          if (!enums.has(id)) fail(`${where}: enum initializer references unknown ${id}`);
          return String(enums.get(id));
        });
        value = parseInt(simplified, 10);
        if (Number.isNaN(value)) fail(`${where}: bad enum initializer for ${em[1]}`);
      }
      enums.set(em[1], value);
      value++;
    }
  }
  return enums;
}

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

function titleCaseWord(word) {
  if (!word) return '';
  // already cased: starts upper and carries a lower ('Electric', 'Ice')
  if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word.slice(1))) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseId(id) {
  return id.split('_').map((w) => (w.length === 1 ? w.toUpperCase() : titleCaseWord(w))).join(' ');
}

/** UPPERCASE game strings → Title case for display (Vanilla name tables). */
function titleIfUpper(s) {
  return s.split(' ').map((w) => (w === w.toUpperCase() && /[A-Z]/.test(w) ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
}

/** UPPERCASE Vanilla item names → Title case for display, with the acronym
 *  guard: a ≤2-char all-caps word stays uppercase only when it OPENS the
 *  name ("PP UP" → "PP Up", "X ATTACK" → "X Attack"). Mixed-case words
 *  (the "POKé" ball) pass through untouched. */
function titleItemName(s) {
  return s.split(' ').map((w, i) => {
    if (!(w === w.toUpperCase() && /[A-Z]/.test(w))) return w;
    if (i === 0 && w.length <= 2) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

function unescapeC(literal) {
  return literal.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** Parse concatenated C string literals ("a" "b" …) into one unescaped string. */
function parseStringLiterals(text, where) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push(unescapeC(m[1]));
  if (out.length === 0) fail(`${where}: no string literals found`);
  return out.join('');
}

/**
 * Split an initializer body into top-level `.field = value` pairs (bracket
 * depth aware). Bare macro calls (LEARNSETS(Xyz), ICON(Xyz, 0)) are skipped.
 */
function splitFields(body, where) {
  const fields = [];
  let i = 0;
  const n = body.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++;
    if (i >= n) break;
    if (body[i] === '.') {
      const fm = /^\.\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(body.slice(i));
      if (!fm) fail(`${where}: bad field near ${JSON.stringify(body.slice(i, i + 40))}`);
      const field = fm[1];
      i += fm[0].length;
      while (i < n && /\s/.test(body[i])) i++;
      if (body[i] !== '=') fail(`${where}: expected "=" after .${field}`);
      i++;
      while (i < n && /\s/.test(body[i])) i++;
      const { text, end } = readValue(body, i, where);
      fields.push({ field, value: text.trim() });
      i = end;
    } else if (/[A-Za-z_]/.test(body[i])) {
      const { end } = readValue(body, i, where);
      i = end;
    } else {
      fail(`${where}: unexpected char ${JSON.stringify(body[i])} near ${JSON.stringify(body.slice(i, i + 40))}`);
    }
  }
  return fields;
}

/** Read one comma-terminated value from i, tracking () {} [] depth. */
function readValue(body, i, where) {
  const start = i;
  let depth = 0;
  let inString = false;
  while (i < body.length) {
    const ch = body[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') { inString = true; i++; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) break;
    i++;
  }
  const text = body.slice(start, i);
  if (!text.trim()) fail(`${where}: empty value near ${JSON.stringify(body.slice(Math.max(0, i - 40), i + 10))}`);
  let end = i;
  if (end < body.length && body[end] === ',') end++;
  return { text, end };
}

/** Split a comma-separated list of top-level {...} blocks. */
function splitTopLevelBraces(text, where) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) blocks.push(text.slice(start, i + 1));
    }
  }
  if (depth !== 0) fail(`${where}: unbalanced braces`);
  return blocks;
}

/** Parse `const u8 gXyz[] = _("…" "…")` text arrays; trailing ws trimmed. */
function parseTextArrays(text, where) {
  const out = new Map();
  const re = /const u8 (g[A-Za-z0-9_]+)\[\]\s*=\s*(_\()?(.*?)\)\s*;/gs;
  let m;
  while ((m = re.exec(text))) {
    const [, name, , bodyRaw] = m;
    let lit = bodyRaw.trim();
    if (lit.startsWith('(') && lit.endsWith(')')) lit = lit.slice(1, -1).trim();
    if (!lit.startsWith('"')) continue; // not a string array (byte table) — skip
    try {
      out.set(name, parseStringLiterals(lit, `${where} ${name}`).replace(/[ \t\r\n]+$/, ''));
    } catch (error) {
      fail(`${where} ${name}: ${error.message}`);
    }
  }
  return out;
}

/** Parse a designated name table `[IDX] = _("TEXT")` into Map<idx, text>. */
function parseNameTable(text, arrayNameRe, where) {
  const m = arrayNameRe.exec(text);
  if (!m) fail(`${where}: name table not found (${arrayNameRe})`);
  // the regex is anchored to the array's own opening brace
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let end = open;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = text.slice(open + 1, end);
  const out = new Map();
  const re = /\[\s*([A-Z0-9_]+)\s*\]\s*=\s*_\("((?:[^"\\]|\\.)*)"\)/g;
  let nm;
  while ((nm = re.exec(body))) out.set(nm[1], unescapeC(nm[2]));
  return out;
}

function parseBracedList(value, field, where) {
  const inner = value.match(/^\{([\s\S]*)\}$/);
  if (!inner) fail(`${where}: ${field} not braced: ${value.slice(0, 40)}`);
  return inner[1].split(',').map((s) => s.trim()).filter(Boolean);
}

function formatHeight(decimeters) {
  const m = decimeters / 10;
  return `${Number.isInteger(m) ? m.toFixed(1) : String(m)} m`;
}

function formatWeight(hectograms) {
  const kg = hectograms / 10;
  return `${Number.isInteger(kg) ? kg.toFixed(1) : String(kg)} kg`;
}

// ---------------------------------------------------------------------------
// Evolution method humanization
// ---------------------------------------------------------------------------

// The evolution methods are the EVO_* defines in include/constants/pokemon.h
// — parsed from that canonical file only, because unrelated EVO_* defines in
// data files (EVO_HELD_ITEM_TYPE in items.h) collide with method values.
function evoMethodMap(pp) {
  const raw = pp.provider.fetch('include/constants/pokemon.h');
  const out = new Map();
  for (const line of raw.split('\n')) {
    // EVO_MODE_* are evolution display modes, not methods
    const m = /^\s*#define\s+EVO_(?!MODE_)([A-Z0-9_]+)\s+(.+?)\s*(\/\/.*)?$/.exec(line);
    if (!m) continue;
    let value;
    try { value = pp.evalExpr(m[2], `evoMethodMap ${m[1]}`); } catch { continue; }
    if (value !== 0xfffe && value !== 0xffff) out.set(value, m[1]);
  }
  if (out.size < 20) fail(`evoMethodMap: only ${out.size} evolution methods parsed from include/constants/pokemon.h`);
  return out;
}

function humanizeEvolution(method, param, param2, evoMethods, where, ctx) {
  const methodId = evoMethods.get(method);
  if (!methodId) fail(`${where}: unrecognized evolution method ${method}`);
  const item = (p) => {
    const n = ctx.itemNames.get(p);
    if (!n) fail(`${where}: unknown item value ${p}`);
    return n;
  };
  const move = (p) => {
    const n = ctx.moveNames.get(p);
    if (!n) fail(`${where}: unknown move value ${p}`);
    return n;
  };
  // value -> record id: recordIdByValue resolves through base-form aliases
  // (e.g. SPECIES_CASTFORM aliases CASTFORM_NORMAL's value but only the
  // latter is a record); byValue is the canonical first-name fallback.
  const targetId = ctx.recordIdByValue?.get(param2) ?? ctx.byValue?.get(param2) ?? null;
  const target = targetId ?? null;
  const targetName = () => {
    const n = ctx.displayNames.get(targetId);
    if (!n) fail(`${where}: unknown evolution target species value ${param2}`);
    return n;
  };
  const speciesName = (p) => {
    const id = ctx.recordIdByValue?.get(p) ?? ctx.byValue?.get(p);
    const n = id ? ctx.displayNames.get(id) : undefined;
    if (!n) fail(`${where}: unknown species value ${p}`);
    return n;
  };
  const lv = (s = '') => `Level up at ${param}${s}`;

  switch (methodId) {
    case 'LEVEL': return { target, method: lv() };
    case 'LEVEL_ATK_GT_DEF': return { target, method: lv(' with Attack greater than Defense') };
    case 'LEVEL_ATK_EQ_DEF': return { target, method: lv(' with Attack equal to Defense') };
    case 'LEVEL_ATK_LT_DEF': return { target, method: lv(' with Attack lower than Defense') };
    case 'LEVEL_SILCOON': return { target, method: lv(' (Silcoon personality)') };
    case 'LEVEL_CASCOON': return { target, method: lv(' (Cascoon personality)') };
    case 'LEVEL_NINJASK': return { target, method: lv() };
    case 'LEVEL_SHEDINJA': return { target, method: lv() };
    case 'BEAUTY': return { target, method: `Level up with Beauty ${param} or higher` };
    case 'FRIENDSHIP': return { target, method: 'High friendship' };
    case 'FRIENDSHIP_DAY': return { target, method: 'High friendship (daytime)' };
    case 'FRIENDSHIP_NIGHT': return { target, method: 'High friendship (night)' };
    case 'TRADE': return { target, method: 'Trade' };
    case 'TRADE_ITEM': return { target, method: `Trade while holding ${item(param)}` };
    case 'ITEM': return { target, method: `Use ${item(param)}` };
    case 'ITEM_MALE': return { target, method: `Use ${item(param)} on a male` };
    case 'ITEM_FEMALE': return { target, method: `Use ${item(param)} on a female` };
    case 'ITEM_DAY': return { target, method: `Use ${item(param)} (daytime)` };
    case 'ITEM_NIGHT': return { target, method: `Use ${item(param)} (night)` };
    case 'LEVEL_FEMALE': return { target, method: lv(' (female)') };
    case 'LEVEL_MALE': return { target, method: lv(' (male)') };
    case 'LEVEL_NIGHT': return { target, method: lv(' (night)' ) };
    case 'LEVEL_DAY': return { target, method: lv(' (daytime)') };
    case 'LEVEL_DUSK': return { target, method: lv(' (dusk)') };
    case 'LEVEL_RAIN': return { target, method: lv(' while it is raining') };
    case 'LEVEL_FOG': return { target, method: lv(' in fog') };
    case 'LEVEL_ITEM': return { target, method: `Level up while holding ${item(param)}` };
    case 'ITEM_HOLD': return { target, method: `Level up while holding ${item(param)}` };
    case 'ITEM_HOLD_DAY': return { target, method: `Level up while holding ${item(param)} (daytime)` };
    case 'ITEM_HOLD_NIGHT': return { target, method: `Level up while holding ${item(param)} (night)` };
    case 'MOVE': return { target, method: `Level up knowing ${move(param)}` };
    case 'MOVE_TYPE': {
      const typeName = ctx.typeByValue.get(param);
      if (!typeName) fail(`${where}: unknown type ${param}`);
      return { target, method: `Level up knowing a ${typeName}-type move` };
    }
    case 'FRIENDSHIP_MOVE_TYPE': {
      const typeName = ctx.typeByValue.get(param);
      if (!typeName) fail(`${where}: unknown type ${param}`);
      return { target, method: `High friendship, knowing a ${typeName}-type move` };
    }
    case 'MAPSEC': {
      const secName = ctx.mapsecNames.get(param);
      if (!secName) fail(`${where}: unknown map section value ${param}`);
      return { target, method: `Level up in ${secName}` };
    }
    case 'SPECIFIC_MAP': {
      if (param === ctx.mapNone) return { target, method: 'Level up' };
      const mapName = ctx.mapNames.get(param);
      if (!mapName) fail(`${where}: unknown map value ${param}`);
      return { target, method: `Level up on ${mapName}` };
    }
    case 'SPECIFIC_MON_IN_PARTY': return { target, method: `Level up with ${speciesName(param)} in party` };
    case 'LEVEL_DARK_TYPE_MON_IN_PARTY': return { target, method: lv(' with a Dark-type Pokémon in party') };
    case 'TRADE_SPECIFIC_MON': return { target, method: `Trade for ${targetName()}` };
    case 'LEVEL_NATURE_AMPED': return { target, method: lv(' with an amp-up nature') };
    case 'LEVEL_NATURE_LOW_KEY': return { target, method: lv(' with a low-key nature') };
    case 'CRITICAL_HITS': return { target, method: `Land ${param} critical hits in one battle` };
    case 'SCRIPT_TRIGGER_DMG': return { target, method: `Script trigger at level ${param} or higher` };
    case 'DARK_SCROLL': return { target, method: 'Use the Scroll of Darkness' };
    case 'WATER_SCROLL': return { target, method: 'Use the Scroll of Waters' };
    case 'MOVE_TWO_SEGMENT': return { target, method: `Level up knowing ${move(param)} (two-segment form)` };
    case 'MOVE_THREE_SEGMENT': return { target, method: `Level up knowing ${move(param)} (three-segment form)` };
    case 'LEVEL_FAMILY_OF_THREE': return { target, method: lv(' (family of three)') };
    case 'LEVEL_FAMILY_OF_FOUR': return { target, method: lv(' (family of four)') };
    case 'LEVEL_TWO_SEGMENT': return { target, method: lv() };
    case 'LEVEL_THREE_SEGMENT': return { target, method: lv() };
    case 'LEVEL_30_NATURE': {
      // EX-only (the Milcery rewrite in rogue_baked.c): the in-game string is
      // "Reach {LV}30 as {STR_VAR_1}" — the exact wording, 30 hard-coded
      const natureName = ctx.natureNames?.get(param);
      if (!natureName) fail(`${where}: unknown nature value ${param}`);
      return { target, method: `Reach 30 as ${natureName}` };
    }
    default:
      fail(`${where}: unhumanized evolution method ${methodId}`);
  }
}

// ---------------------------------------------------------------------------
// Port of the game's runtime evolution rewrite (src/rogue_baked.c)
// ---------------------------------------------------------------------------
//
// The in-game Pokédex does NOT show the raw evolution table: every entry is
// run through `Rogue_ModifyEvolution` (byte-identical in both branches —
// the Vanilla/EX split is the #ifdef ROGUE_EXPANSION blocks inside it) which
// rewrites method/param/target (friendship -> level 30, trade -> Link Cable
// item, the Alola/Galar/Hisui artefacts, per-species overrides, ...).
// `modifyEvolution` mirrors that function line-for-line so the site's evo
// data matches what the game displays (issue #97).

// Per-branch resolved EVO_* constants. The two branches assign DIFFERENT
// numbers to several methods (EVO_LEVEL 4 in both, but e.g. EVO_ITEM 27 in
// EX vs 7 in Vanilla), so the constants come from each branch's own
// include/constants/pokemon.h, never shared.
const makeEvoConsts = (branch, pp, where) => {
  const v = (n) => pp.evalExpr(n, `${where} ${n}`);
  const C = {
    EVO_NONE: 0xfffe, // not a #define in Vanilla's header, but the same sentinel the rewrite writes
    EVO_ITEM: v('EVO_ITEM'),
    EVO_LEVEL: v('EVO_LEVEL'),
    EVO_LEVEL_MALE: v('EVO_LEVEL_MALE'),
    EVO_LEVEL_FEMALE: v('EVO_LEVEL_FEMALE'),
    EVO_MOVE: v('EVO_MOVE'),
    EVO_BEAUTY: v('EVO_BEAUTY'),
    EVO_FRIENDSHIP: v('EVO_FRIENDSHIP'),
    EVO_TRADE: v('EVO_TRADE'),
    EVO_LEVEL_ITEM: v('EVO_LEVEL_ITEM'),
    EVO_ITEM_HOLD_DAY: v('EVO_ITEM_HOLD_DAY'),
    EVO_ITEM_HOLD_NIGHT: v('EVO_ITEM_HOLD_NIGHT'),
    EVO_FRIENDSHIP_DAY: v('EVO_FRIENDSHIP_DAY'),
    EVO_FRIENDSHIP_NIGHT: v('EVO_FRIENDSHIP_NIGHT'),
    EVO_LEVEL_DAY: v('EVO_LEVEL_DAY'),
    EVO_LEVEL_NIGHT: v('EVO_LEVEL_NIGHT'),
    EVO_TRADE_ITEM: v('EVO_TRADE_ITEM'),
  };
  if (branch === 'ex') {
    C.EVO_LEVEL_30_NATURE = v('EVO_LEVEL_30_NATURE');
    C.EVO_MOVE_TYPE = v('EVO_MOVE_TYPE');
    C.EVO_MOVE_TWO_SEGMENT = v('EVO_MOVE_TWO_SEGMENT');
    C.EVO_MOVE_THREE_SEGMENT = v('EVO_MOVE_THREE_SEGMENT');
    C.EVO_LEVEL_TWO_SEGMENT = v('EVO_LEVEL_TWO_SEGMENT');
    C.EVO_LEVEL_THREE_SEGMENT = v('EVO_LEVEL_THREE_SEGMENT');
    C.EVO_SPECIFIC_MON_IN_PARTY = v('EVO_SPECIFIC_MON_IN_PARTY');
    C.EVO_CRITICAL_HITS = v('EVO_CRITICAL_HITS');
    C.EVO_SCRIPT_TRIGGER_DMG = v('EVO_SCRIPT_TRIGGER_DMG');
    C.EVO_WATER_SCROLL = v('EVO_WATER_SCROLL');
    C.EVO_DARK_SCROLL = v('EVO_DARK_SCROLL');
    C.EVO_TRADE_SPECIFIC_MON = v('EVO_TRADE_SPECIFIC_MON');
    C.EVO_LEVEL_RAIN = v('EVO_LEVEL_RAIN');
    C.EVO_LEVEL_DARK_TYPE_MON_IN_PARTY = v('EVO_LEVEL_DARK_TYPE_MON_IN_PARTY');
    C.EVO_FRIENDSHIP_MOVE_TYPE = v('EVO_FRIENDSHIP_MOVE_TYPE');
    C.EVO_SPECIFIC_MAP = v('EVO_SPECIFIC_MAP');
    C.EVO_ITEM_NIGHT = v('EVO_ITEM_NIGHT');
    C.EVO_ITEM_DAY = v('EVO_ITEM_DAY');
    C.EVO_MAPSEC = v('EVO_MAPSEC');
  }
  return C;
};

/**
 * Port of `Rogue_ModifyEvolution` (src/rogue_baked.c L377-704). Reads the
 * raw { method, param, target } tuple at `evoIdx` for the species whose
 * value is `speciesValue`, applies the per-species overrides, the
 * Milcery block, the ModifyKnowMoveEvo profile check and the method
 * switch, and returns the rewritten tuple (the raw one untouched).
 *
 * `ctx` is branch-scoped: the resolved EVO_* constants, the
 * SPECIES_NONE value, species/item/nature value lookups,
 * GET_BASE_SPECIES_ID for the Rockruff/Cosmoem time-of-day exception,
 * and the species' level-up learnset profile (what ModifyKnowMoveEvo
 * reads via Rogue_GetPokemonProfile).
 *
 * The run-scoped "invalid evolution" check (L497-504) needs live run
 * state (Rogue_IsRunActive + Pokédex-variant membership) and can never
 * fire in the documented out-of-run state — deliberately not ported.
 */
function modifyEvolution(branch, ctx, speciesValue, evoIdx, evo) {
  const isEx = branch === 'ex';
  const C = ctx.evoConsts;
  const S = (tail) => ctx.species(tail);
  const I = (tail) => ctx.item(tail);
  const out = { method: evo.method, param: evo.param, target: evo.target };

  // "Any species alterations." (L383-388)
  if (speciesValue === S('AZURILL') && evoIdx === 0) {
    out.method = C.EVO_LEVEL;
    out.param = 10;
  }

  // #ifdef ROGUE_EXPANSION (L390-575)
  if (isEx) {
    // Yamask-Galarian: the level evolution to Ronogar
    if (speciesValue === S('YAMASK_GALARIAN') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 34;
    }
    if (speciesValue === S('MELTAN') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('METAL_COAT');
    }
    if (speciesValue === S('SLIGGOO') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
    }
    if ((speciesValue === S('SLIGGOO') || speciesValue === S('SLIGGOO_HISUIAN')) && evoIdx === 1) {
      out.target = ctx.none;
      out.method = C.EVO_NONE;
    }
    if (speciesValue === S('KUBFU') && (evoIdx === 1 || evoIdx === 3)) {
      out.target = ctx.none;
      out.method = C.EVO_NONE;
    }
    if (speciesValue === S('BASCULIN_WHITE_STRIPED')) {
      // Basculin White evolves into Basculion based on gender
      if (evoIdx === 0) {
        out.target = S('BASCULEGION_MALE');
        out.method = C.EVO_LEVEL_MALE;
        out.param = 36;
      } else if (evoIdx === 1) {
        out.target = S('BASCULEGION_FEMALE');
        out.method = C.EVO_LEVEL_FEMALE;
        out.param = 36;
      }
    }
    // Alolan evolutions
    if (
      (speciesValue === S('PIKACHU') && evoIdx === 1) ||
      (speciesValue === S('EXEGGCUTE') && evoIdx === 1) ||
      (speciesValue === S('CUBONE') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('ALOLA_STONE');
    }
    // Galar evolutions
    if (
      (speciesValue === S('KOFFING') && evoIdx === 1) ||
      (speciesValue === S('MIME_JR') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('GALAR_STONE');
    }
    // Hisui evolutions
    if (
      (speciesValue === S('QUILAVA') && evoIdx === 1) ||
      (speciesValue === S('DEWOTT') && evoIdx === 1) ||
      (speciesValue === S('PETILIL') && evoIdx === 1) ||
      (speciesValue === S('RUFFLET') && evoIdx === 1) ||
      (speciesValue === S('GOOMY') && evoIdx === 1) ||
      (speciesValue === S('BERGMITE') && evoIdx === 1) ||
      (speciesValue === S('DARTRIX') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('HISUI_STONE');
    }
    if (speciesValue === S('URSARING') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('PEAT_BLOCK');
    }
    if (speciesValue === S('URSARING') && evoIdx === 1) {
      out.method = C.EVO_ITEM;
      out.param = I('MOON_STONE');
    }
    if (speciesValue === S('BISHARP') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('LEADERS_CREST');
    }
    // Walk evolutions
    if (speciesValue === S('PAWMO') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('BRAMBLIN') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('RELLOR') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('GIMMIGHOUL') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('GIMMIGHOUL_COIN');
    }
  }

  // (The ROGUE_IsRunActive "invalid evolution" check — see the header note.)

  if (out.target !== ctx.none) {
    if (isEx && speciesValue === S('MILCERY')) {
      if (evoIdx === 0) {
        // Default form for neutral natures
        out.method = C.EVO_LEVEL;
        out.target = S('ALCREMIE_STRAWBERRY');
        out.param = 30;
      } else {
        const supportedForms = ['ALCREMIE_BERRY', 'ALCREMIE_LOVE', 'ALCREMIE_STAR', 'ALCREMIE_CLOVER', 'ALCREMIE_FLOWER', 'ALCREMIE_RIBBON'].map(S);
        const supportedNatures = ['ADAMANT', 'LAX', 'MODEST', 'GENTLE', 'TIMID', 'JOLLY'].map((n) => ctx.nature(n));
        if (evoIdx - 1 >= supportedNatures.length) {
          out.method = C.EVO_NONE;
          out.target = ctx.none;
        } else {
          out.method = C.EVO_LEVEL_30_NATURE;
          out.target = supportedForms[evoIdx - 1];
          out.param = supportedNatures[evoIdx - 1];
        }
      }
    }

    // ModifyKnowMoveEvo (L354-376): the species' level-up list (the
    // "assume this was a tutor move" part — the profile's tutor list — is
    // never used by any evolution, so only the level-up loop is ported),
    // then the EVO_MOVE fallback.
    const levelUp = ctx.profileLevelUp(speciesValue);
    const knowMove = (fromMethod, toMethod) => {
      if (out.method !== fromMethod) return;
      if (levelUp) {
        for (const [mv, lvl] of levelUp) {
          if (mv === out.param) {
            out.method = toMethod;
            out.param = Math.max(38, lvl);
            break;
          }
        }
      }
      if (out.method === fromMethod && fromMethod === C.EVO_MOVE) {
        out.method = toMethod;
        out.param = 30;
      }
    };
    knowMove(C.EVO_MOVE, C.EVO_LEVEL);
    if (isEx) {
      knowMove(C.EVO_MOVE_TWO_SEGMENT, C.EVO_LEVEL_TWO_SEGMENT);
      knowMove(C.EVO_MOVE_THREE_SEGMENT, C.EVO_LEVEL_THREE_SEGMENT);
    }

    // The method switch (L581-703) — ported as an if-chain; every C case
    // has a distinct value in both branches, so the semantics match.
    if (out.method === C.EVO_ITEM) {
      if (isEx && out.param === ctx.item('LINKING_CORD')) {
        // Already have a different evolution via the link cable
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      }
    } else if (out.method === C.EVO_BEAUTY) {
      if (isEx) {
        // Uses the prism scale evolution
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else {
        // Make it a level evolution
        out.method = C.EVO_LEVEL;
        out.param = 36;
      }
    } else if (out.method === C.EVO_FRIENDSHIP) {
      out.method = C.EVO_LEVEL;
      out.param = 30;
    } else if (out.method === C.EVO_TRADE) {
      out.method = C.EVO_ITEM;
      out.param = I('LINK_CABLE');
    } else if (out.method === C.EVO_LEVEL_ITEM || out.method === C.EVO_ITEM_HOLD_DAY || out.method === C.EVO_ITEM_HOLD_NIGHT) {
      out.method = C.EVO_ITEM;
    } else if (out.method === C.EVO_FRIENDSHIP_DAY) {
      if (speciesValue === S('EEVEE')) {
        out.method = C.EVO_ITEM;
        out.param = I('SUN_STONE');
      } else {
        out.method = C.EVO_LEVEL;
        out.param = 30;
      }
    } else if (out.method === C.EVO_FRIENDSHIP_NIGHT) {
      if (speciesValue === S('EEVEE')) {
        out.method = C.EVO_ITEM;
        out.param = I('MOON_STONE');
      } else {
        out.method = C.EVO_LEVEL;
        out.param = 30;
      }
    } else if (out.method === C.EVO_LEVEL_DAY || out.method === C.EVO_LEVEL_NIGHT) {
      if (isEx) {
        // Rockruff & Cosmoem are the only species that still have time-based evolutions
        if (speciesValue !== ctx.baseSpecies('ROCKRUFF') && speciesValue !== ctx.baseSpecies('COSMOEM')) {
          out.method = C.EVO_LEVEL;
        }
      } else {
        out.method = C.EVO_LEVEL;
      }
    } else if (out.method === C.EVO_TRADE_ITEM) {
      if (isEx) {
        // These methods are no longer needed since Emerald Expansion has use-item by default
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else {
        out.method = C.EVO_ITEM;
      }
    } else if (isEx) {
      if (out.method === C.EVO_SPECIFIC_MON_IN_PARTY || out.method === C.EVO_CRITICAL_HITS || out.method === C.EVO_SCRIPT_TRIGGER_DMG) {
        out.method = C.EVO_LEVEL;
        out.param = 36;
      } else if (out.method === C.EVO_WATER_SCROLL) {
        out.method = C.EVO_ITEM;
        out.param = I('WATER_STONE');
      } else if (out.method === C.EVO_DARK_SCROLL) {
        out.method = C.EVO_ITEM;
        out.param = I('MOON_STONE');
      } else if (out.method === C.EVO_TRADE_SPECIFIC_MON) {
        out.method = C.EVO_ITEM;
        out.param = I('LINK_CABLE');
      } else if (out.method === C.EVO_LEVEL_RAIN || out.method === C.EVO_LEVEL_DARK_TYPE_MON_IN_PARTY) {
        out.method = C.EVO_LEVEL;
      } else if (out.method === C.EVO_FRIENDSHIP_MOVE_TYPE) {
        out.method = C.EVO_MOVE_TYPE;
      } else if (out.method === C.EVO_SPECIFIC_MAP || out.method === C.EVO_ITEM_NIGHT || out.method === C.EVO_ITEM_DAY) {
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else if (out.method === C.EVO_MAPSEC) {
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      }
    }
  }

  return out;
}

/**
 * The in-game evolution display list for one entry: run every raw tuple
 * through modifyEvolution, drop the SPECIES_NONE targets and the 0xfffe
 * sentinels (EVO_NONE — "not an actual evolution"), and cap at 8
 * (GetEvolutionName only shows displayCount < 8).
 */
function buildEvoDisplayList(branch, ctx, speciesValue, rawList) {
  // GetMaxEvolutionCount: the loop never runs on an empty table, so the
  // per-species overrides can't fire for it either
  if (rawList.length === 0) return [];
  const survivors = [];
  for (let i = 0; i < rawList.length; i++) {
    const evo = modifyEvolution(branch, ctx, speciesValue, i, rawList[i]);
    if (evo.target === ctx.none || evo.method === 0xfffe) continue;
    survivors.push(evo);
    if (survivors.length >= 8) break;
  }
  return survivors;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

function extract(repo) {
  const vanillaProvider = makeFileProvider(
    (f) => {
      const full = path.join(repo, f);
      if (!existsSync(full)) fail(`Vanilla file not found: ${f}`);
      return readFileSync(full, 'utf8');
    },
    (f) => existsSync(path.join(repo, f)),
  );
  const exProvider = makeFileProvider(
    (f) => git(repo, 'show', `origin/expansion:${f}`),
    (f) => {
      try {
        execFileSync('git', ['-C', repo, 'cat-file', '-e', `origin/expansion:${f}`], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
  );

  // ----- preprocessor state ---------------------------------------------------
  // The build's command-line defines (Makefile CPPFLAGS for the default
  // release build), applied before any header is read.
  const buildDefines = (seeds) => {
    const map = new Map();
    for (const [name, value] of seeds) map.set(name, { params: null, body: String(value) });
    return map;
  };

  const exDefines = buildDefines([
    ['MODERN', 1],
    ['TESTING', 0],
    ['ROGUE_EXPANSION', 1],
    ['ROGUE_RELEASE', 1],
  ]);
  const exEnums = new Map();
  // include roots mirror the build's `-iquote include -iquote gflib`.
  const exPp = new Preprocessor({ provider: exProvider, defines: exDefines, enums: exEnums, includeRoots: ['include', 'src', 'gflib'], label: 'expansion' });

  const vanDefines = buildDefines([
    ['MODERN', 1],
    ['ROGUE_RELEASE', 1],
  ]);
  const vanEnums = new Map();
  const vanPp = new Preprocessor({ provider: vanillaProvider, defines: vanDefines, enums: vanEnums, includeRoots: ['include', 'src', 'gflib'], label: 'vanilla' });

  const collectFor = (pp, file) => {
    // #define directives are registered while the file is walked in output
    // mode, and enums are collected from the ACTIVE (post-#if) text so that
    // #if-guarded enum members resolve exactly as the compiler sees them.
    const active = pp.process(file, 'output');
    collectEnums(active, `enum ${file}`, pp.enums);
  };

  // Expansion config + constants (the real build's P_*/B_* toggles)
  for (const f of [
    'include/config.h',
    'include/config/pokemon.h',
    'include/config/species_enabled.h',
    'include/config/battle.h',
    'include/config/item.h',
    'include/config/overworld.h',
    'include/constants/battle.h',
    'include/constants/pokemon.h',
    'include/constants/species.h',
    'include/constants/abilities.h',
    'include/constants/moves.h',
    'include/constants/items.h',
    'include/constants/maps.h',
    'include/constants/region_map_sections.h',
    'include/constants/pokedex.h',
    'include/constants/rogue_pokedex.h',
    'include/constants/rogue.h', // the ITEM_* rogue items the evolution rewrite names (Link Cable, the artefacts)
    'include/global.h', // COMPOUND_STRING, min/max & friends used by the species data
  ]) collectFor(exPp, f);

  // Vanilla constants (no ROGUE_EXPANSION)
  for (const f of [
    'include/global.h',
    'include/constants/battle.h',
    'include/constants/pokemon.h',
    'include/constants/species.h',
    'include/constants/abilities.h',
    'include/constants/moves.h',
    'include/constants/items.h',
    'include/constants/maps.h',
    'include/constants/region_map_sections.h',
    'include/constants/pokedex.h',
    'include/constants/rogue_pokedex.h',
    'include/constants/rogue.h', // ITEM_LINK_CABLE (the Vanilla trade-evo rewrite names it)
  ]) collectFor(vanPp, f);

  // Generic constant resolution: enums first, then object-like macros
  // (the game expresses most constant tables as #defines).
  const resolveConst = (pp, name, where) => {
    if (pp.enums.has(name)) return pp.enums.get(name);
    const def = pp.defines.get(name);
    if (!def) fail(`${where}: unresolved constant ${name}`);
    if (def.params) fail(`${where}: ${name} is a function-like macro`);
    if (def.body.includes('{') || def.body.includes(';')) fail(`${where}: ${name} has a non-constant body`);
    return pp.evalDefine(name, where);
  };
  const collectPrefixed = (pp, prefix, where, filter) => {
    const out = new Map();
    for (const name of new Set([...pp.enums.keys(), ...pp.defines.keys()])) {
      if (!name.startsWith(prefix)) continue;
      let value;
      if (pp.enums.has(name)) value = pp.enums.get(name);
      else {
        const def = pp.defines.get(name);
        // skip function-like macros and struct-initializer bodies
        if (!def || def.params || def.body.includes('{') || def.body.includes(';')) continue;
        try { value = pp.evalDefine(name, `${where} ${name}`); } catch { continue; }
      }
      if (typeof value === 'number' && filter(value, name)) out.set(name, value);
    }
    return out;
  };

  // ----- shared name tables -----------------------------------------------------
  const typeNames = new Map(); // TYPE_X -> "Fire"
  const typeByValue = new Map(); // EX value -> "Fire"
  const vanTypeByValue = new Map(); // vanilla value -> "Fire"
  // The EX table runs TYPE_0..19 (TYPE_NONE = 255 stays out). Vanilla's
  // table stops at DRAGON = 15 (EX inserts MYSTERY, DARK and FAIRY earlier),
  // so each branch keeps its own value map while sharing the name table.
  for (const [name, value] of collectPrefixed(exPp, 'TYPE_', 'types', (v) => v < 200)) {
    typeNames.set(name, titleCaseId(name.slice(5).toLowerCase()));
    typeByValue.set(value, titleCaseId(name.slice(5).toLowerCase()));
  }
  if (!typeNames.has('TYPE_NORMAL')) fail('TYPE_* constants not found');
  for (const [name, value] of collectPrefixed(vanPp, 'TYPE_', 'vanilla types', (v) => v < 200)) {
    const t = titleCaseId(name.slice(5).toLowerCase());
    if (typeNames.has(name) && typeNames.get(name) !== t) fail(`vanilla type ${name} named ${typeNames.get(name)}, expected ${t}`);
    typeNames.set(name, t);
    vanTypeByValue.set(value, t);
  }
  if (!vanTypeByValue.has(vanPp.evalExpr('TYPE_DRAGON', 'vanilla TYPE_DRAGON'))) fail('vanilla TYPE_DRAGON missing');

  const eggGroupNames = new Map();
  const eggGroupByValue = new Map(); // EX values
  const vanEggGroupByValue = new Map(); // vanilla values
  for (const [name, value] of collectPrefixed(exPp, 'EGG_GROUP_', 'egg groups', (v) => v >= 1)) {
    eggGroupNames.set(name, titleCaseId(name.slice('EGG_GROUP_'.length).toLowerCase()));
    eggGroupByValue.set(value, eggGroupNames.get(name));
  }
  if (eggGroupNames.size < 10) fail('EGG_GROUP_* constants not found');
  for (const [name, value] of collectPrefixed(vanPp, 'EGG_GROUP_', 'vanilla egg groups', (v) => v >= 1)) {
    const t = titleCaseId(name.slice('EGG_GROUP_'.length).toLowerCase());
    if (eggGroupNames.has(name) && eggGroupNames.get(name) !== t) fail(`vanilla egg group ${name} named ${eggGroupNames.get(name)}, expected ${t}`);
    eggGroupNames.set(name, t);
    vanEggGroupByValue.set(value, t);
  }
  if (vanEggGroupByValue.size < 10) fail('vanilla EGG_GROUP_* constants not found');

  // species value <-> id tables
  // The canonical species table comes straight from include/constants/species.h
  // (every branch is a `#define SPECIES_X <expr>` line). Reading the file
  // directly keeps rogue aliases (SPECIES_RAVEN_ACE = SPECIES_GOOMY / NONE in
  // include/constants/rogue.h) and save-size helper constants out of the table.
  // entryFiles carry the authoritative `[SPECIES_X] = …` initializers, used to
  // verify that every documented species resolves to a canonical value.
  const speciesTable = (pp, label, entryFiles) => {
    const canon = pp.provider.fetch('include/constants/species.h');
    const entries = [];
    let egg;
    for (const line of canon.split(/\r?\n/)) {
      const m = /^#define\s+(SPECIES_[A-Z0-9_]+)\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const [, name, body] = m;
      if (body.trim().startsWith('{')) continue; // not an expression (unexpected)
      const value = pp.evalExpr(body, `${label} ${name}`);
      if (name === 'SPECIES_EGG') { egg = value; continue; }
      entries.push({ name, value });
    }
    if (egg === undefined) fail(`${label}: SPECIES_EGG missing in species.h`);
    // Vanilla declares the OLD UNOWN B–Z / ' / ? forms after SPECIES_EGG
    // (NUM_SPECIES + 1 … + 26), so the usable range extends past the egg.
    const numSpecies = Math.max(egg, ...entries.map((e) => e.value)) + 1;
    const byValue = new Map();
    const idByValue = new Map();
    for (const { name, value } of entries) {
      if (value < 0 || value >= numSpecies) fail(`${label}: ${name} = ${value} out of range`);
      if (value === 0) continue; // SPECIES_NONE
      // Base forms legitimately alias their first form (SPECIES_CASTFORM =
      // SPECIES_CASTFORM_NORMAL): several ids share one value. byValue keeps
      // the first (lowest) name; idByValue carries every id.
      if (!byValue.has(value)) byValue.set(value, name.slice(8).toLowerCase());
      idByValue.set(name.slice(8).toLowerCase(), value);
    }
    for (const f of entryFiles) {
      for (const m of pp.process(f, 'output').matchAll(/\[SPECIES_([A-Z0-9_]+)\]\s*=/g)) {
        const id = m[1].toLowerCase(); // capture already excludes the SPECIES_ prefix
        if (id === 'none') continue; // the zero-filled SPECIES_NONE slot
        if (!idByValue.has(id)) fail(`${label}: entry ${m[1]} has no canonical species value`);
      }
    }
    return { byValue, idByValue, numSpecies };
  };
  const exEntryFiles = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => `src/data/pokemon/species_info/gen_${g}.h`);
  const exSpecies = speciesTable(exPp, 'expansion species', exEntryFiles);
  const vanSpecies = speciesTable(vanPp, 'vanilla species', ['src/data/pokemon/base_stats.h']);

  // national dex number per species (plain sequential NATIONAL_DEX enums)
  const dexNumbers = (enums, label) => {
    const out = new Map();
    let inBlock = false;
    for (const [name, value] of [...enums.entries()].sort((a, b) => a[1] - b[1])) {
      if (name === 'NATIONAL_DEX_NONE') { inBlock = true; continue; }
      if (!name.startsWith('NATIONAL_DEX_') || !inBlock) continue;
      out.set(name.slice('NATIONAL_DEX_'.length).toLowerCase(), value);
    }
    if (out.size < 100) fail(`${label}: NATIONAL_DEX enum not found (${out.size} entries)`);
    return out;
  };
  const exDexNum = dexNumbers(exEnums, 'expansion');
  const vanDexNum = dexNumbers(vanEnums, 'vanilla');

  // display name tables
  const vanSpeciesNames = new Map(
    [...parseNameTable(vanillaProvider.fetch('src/data/text/species_names.h'), /gSpeciesNames\[\]\[POKEMON_NAME_LENGTH \+ 1\]\s*=\s*\{/, 'vanilla species_names.h').entries()].map(([k, v]) => [k, titleIfUpper(v)]),
  );

  // The EX build ships B_EXPANDED_MOVE_NAMES=FALSE (12-char abbreviated names
  // like "ThunderShock"); the docs want the full names, so re-preprocess
  // move_names.h with the toggle forced. The file has no #includes, so a fresh
  // PP with just the toggle (plus TRUE/FALSE for the #if) is self-contained.
  const exPpFullMoveNames = new Preprocessor({
    provider: exProvider,
    defines: buildDefines([
      ['B_EXPANDED_MOVE_NAMES', 1],
      ['TRUE', 1],
      ['FALSE', 0],
    ]),
    enums: new Map(),
    includeRoots: ['include', 'src', 'gflib'],
    label: 'expansion (full move names)',
  });
  const exMoveNames = new Map(
    [...parseNameTable(exPpFullMoveNames.process('src/data/text/move_names.h', 'output'), /gMoveNames\[\w+\]\[MOVE_NAME_LENGTH \+ 1\]\s*=\s*\{/, 'EX move_names.h').entries()].map(([k, v]) => [k, titleIfUpper(v)]),
  );
  const vanMoveNames = new Map(
    [...parseNameTable(vanPp.process('src/data/text/move_names.h', 'output'), /gMoveNames\[\w+\]\[MOVE_NAME_LENGTH \+ 1\]\s*=\s*\{/, 'vanilla move_names.h').entries()].map(([k, v]) => [k, titleIfUpper(v)]),
  );

  const exAbilityNames = new Map(
    [...parseNameTable(exPp.process('src/data/text/abilities.h', 'output'), /gAbilityNames\[\w+\]\[ABILITY_NAME_LENGTH \+ 1\]\s*=\s*\{/, 'EX abilities.h').entries()].map(([k, v]) => [k, titleIfUpper(v)]),
  );
  const vanAbilityNames = new Map(
    [...parseNameTable(vanPp.process('src/data/text/abilities.h', 'output'), /gAbilityNames\[\w+\]\[ABILITY_NAME_LENGTH \+ 1\]\s*=\s*\{/, 'vanilla abilities.h').entries()].map(([k, v]) => [k, titleIfUpper(v)]),
  );

  // value -> display name for evolution references (which name moves by value)
  const parseMoveByValue = (pp, nameMap, label) => {
    const out = new Map();
    for (const line of pp.provider.fetch('include/constants/moves.h').split('\n')) {
      const m = /^\s*#define\s+(MOVE_[A-Z0-9_]+)\s+(.+?)\s*(\/\/.*)?$/.exec(line);
      if (!m) continue;
      const display = nameMap.get(m[1]);
      if (display === undefined) continue; // aliases / helper constants
      let value;
      try { value = pp.evalExpr(m[2], `${label} ${m[1]}`); } catch { continue; }
      if (!out.has(value)) out.set(value, display);
    }
    if (out.size < 300) fail(`${label}: only ${out.size} named moves resolved`);
    return out;
  };
  const exMoveByValue = parseMoveByValue(exPp, exMoveNames, 'EX moves');
  const vanMoveByValue = parseMoveByValue(vanPp, vanMoveNames, 'vanilla moves');

  // value -> title maps for list fields, so entries can carry expression
  // macros (e.g. `.types = { TOGEPI_FAMILY_TYPE, TOGEPI_FAMILY_TYPE }`)
  // instead of bare constants.
  const abilityByValue = (pp, nameTable, label) => {
    const out = new Map();
    for (const name of nameTable.keys()) {
      if (name === 'ABILITY_NONE') continue;
      out.set(pp.evalExpr(name, `${label} ${name}`), nameTable.get(name));
    }
    return out;
  };
  const exAbilityByValue = abilityByValue(exPp, exAbilityNames, 'EX abilities');
  const vanAbilityByValue = abilityByValue(vanPp, vanAbilityNames, 'vanilla abilities');
  const resolveListValue = (pp, part, nameTable, valueTable, label, where) => {
    const clean = part.trim();
    if (nameTable.has(clean)) return nameTable.get(clean);
    const value = pp.evalExpr(clean, where);
    const title = valueTable.get(value);
    if (title === undefined) fail(`${where}: unknown ${label} ${clean}`);
    return title;
  };

  // value -> display name: the data files own the display names, the
  // constants files own the values (evolution data references items by
  // value). The rogue items (src/data/rogue_items.h — the Link Cable and the
  // Alola/Galar/Hisui artefacts the evolution rewrite names) live in a
  // second table indexed by [ITEM_X - ITEM_ROGUE_ITEM_FIRST].
  const parseItemNames = (pp, raw, rogueRaw, where) => {
    const byConst = new Map();
    const re = /\[ITEM_([A-Z0-9_]+)\]\s*=\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(raw))) {
      const nm = /\.name\s*=\s*_\("((?:[^"\\]|\\.)*)"\)/.exec(m[2]);
      if (nm) byConst.set(`ITEM_${m[1]}`, unescapeC(nm[1]));
    }
    const rg = /\[ITEM_([A-Z0-9_]+)\s*-\s*ITEM_ROGUE_ITEM_FIRST\]\s*=\s*\{([\s\S]*?)\n    \},/g;
    while ((m = rg.exec(rogueRaw))) {
      const nm = /\.name\s*=\s*_\("((?:[^"\\]|\\.)*)"\)/.exec(m[2]);
      if (nm) byConst.set(`ITEM_${m[1]}`, unescapeC(nm[1]));
    }
    const out = new Map();
    for (const file of ['include/constants/items.h', 'include/constants/rogue.h']) {
      for (const line of pp.provider.fetch(file).split('\n')) {
        const cm = /^\s*#define\s+ITEM_([A-Z0-9_]+)\s+(.+?)\s*(\/\/.*)?$/.exec(line);
        if (!cm) continue;
        const display = byConst.get(`ITEM_${cm[1]}`);
        if (display === undefined) continue; // aliases / helper constants
        let value;
        try { value = pp.evalExpr(cm[2], `${where} ${cm[1]}`); } catch { continue; }
        if (!out.has(value)) out.set(value, display);
      }
    }
    if (out.size < 200) fail(`${where}: only ${out.size} named items resolved`);
    return out;
  };
  const exItemNames = parseItemNames(exPp, exPp.process('src/data/items.h', 'output'), exPp.process('src/data/rogue_items.h', 'output'), 'EX items.h');
  // the Vanilla item tables are all-caps ("THUNDERSTONE") — Title case them
  // for display (the EX tables are already Title case in source)
  const vanItemNames = new Map(
    [...parseItemNames(vanPp, vanPp.process('src/data/items.h', 'output'), vanPp.process('src/data/rogue_items.h', 'output'), 'vanilla items.h')].map(([v, n]) => [v, titleItemName(n)]),
  );

  // const-tail -> value for the items the evolution rewrite names
  // (Rogue_ModifyEvolution rewrites methods to EVO_ITEM + these items)
  const parseItemValues = (pp, where) => {
    const out = new Map();
    for (const file of ['include/constants/items.h', 'include/constants/rogue.h']) {
      for (const line of pp.provider.fetch(file).split('\n')) {
        const cm = /^\s*#define\s+ITEM_([A-Z0-9_]+)\s+(.+?)\s*(\/\/.*)?$/.exec(line);
        if (!cm) continue;
        let value;
        try { value = pp.evalExpr(cm[2], `${where} ${cm[1]}`); } catch { continue; }
        if (!out.has(cm[1])) out.set(cm[1], value);
      }
    }
    return out;
  };
  const exItemValues = parseItemValues(exPp, 'EX item values');
  const vanItemValues = parseItemValues(vanPp, 'vanilla item values');

  // value -> nature display name (EX only — the EVO_LEVEL_30_NATURE rewrite
  // is EX-only): the names own src/data/text/nature_names.h, the values the
  // NATURE_* defines in include/constants/pokemon.h
  const exNatureNames = (() => {
    const raw = exPp.process('src/data/text/nature_names.h', 'output');
    const bySymbol = new Map();
    for (const m of raw.matchAll(/static const u8 (s[A-Za-z0-9]+NatureName)\[\]\s*=\s*_\("((?:[^"\\]|\\.)*)"\)/g)) bySymbol.set(m[1], m[2]);
    const out = new Map();
    for (const m of raw.matchAll(/\[NATURE_([A-Z0-9_]+)\]\s*=\s*(s[A-Za-z0-9]+NatureName),/g)) {
      const value = exPp.evalExpr(`NATURE_${m[1]}`, `nature name NATURE_${m[1]}`);
      const name = bySymbol.get(m[2]);
      if (name === undefined) fail(`nature_names.h: ${m[1]} points at undefined ${m[2]}`);
      out.set(value, name);
    }
    if (out.size < 20) fail(`only ${out.size} nature names parsed from nature_names.h`);
    return out;
  })();

  const exMapNames = new Map();
  for (const [name, value] of collectPrefixed(exPp, 'MAP_', 'maps', (v, n) => v < 0x4000 && !n.startsWith('MAPSEC_'))) {
    exMapNames.set(value, titleCaseId(name.slice(4).toLowerCase()));
  }
  const exMapsecNames = new Map();
  for (const [name, value] of collectPrefixed(exPp, 'MAPSEC_', 'map sections', () => true)) {
    exMapsecNames.set(value, titleCaseId(name.slice(7).toLowerCase()));
  }
  const vanMapNames = new Map();
  for (const [name, value] of collectPrefixed(vanPp, 'MAP_', 'vanilla maps', (v, n) => v < 0x4000 && !n.startsWith('MAPSEC_'))) {
    vanMapNames.set(value, titleCaseId(name.slice(4).toLowerCase()));
  }
  const vanMapsecNames = new Map();
  for (const [name, value] of collectPrefixed(vanPp, 'MAPSEC_', 'vanilla map sections', () => true)) {
    vanMapsecNames.set(value, titleCaseId(name.slice(7).toLowerCase()));
  }

  // region boundaries (last species of each region in the national dex enum)
  const anchor = (enums, id) => {
    const v = enums.get(id);
    if (typeof v !== 'number') fail(`missing dex anchor ${id}`);
    return v;
  };
  const regionEnds = [
    ['Kanto', anchor(exEnums, 'NATIONAL_DEX_MEW')],
    ['Johto', anchor(exEnums, 'NATIONAL_DEX_CELEBI')],
    ['Hoenn', anchor(exEnums, 'NATIONAL_DEX_DEOXYS')],
    ['Sinnoh', anchor(exEnums, 'NATIONAL_DEX_ARCEUS')],
    ['Unova', anchor(exEnums, 'NATIONAL_DEX_GENESECT')],
    ['Kalos', anchor(exEnums, 'NATIONAL_DEX_VOLCANION')],
    ['Alola', anchor(exEnums, 'NATIONAL_DEX_MELMETAL')],
    ['Galar', anchor(exEnums, 'NATIONAL_DEX_ENAMORUS')],
    ['Paldea', anchor(exEnums, 'NATIONAL_DEX_PECHARUNT')],
  ];
  const regionFor = (n) => {
    for (const [region, end] of regionEnds) if (n <= end) return region;
    fail(`no region for dex number ${n}`);
  };

  // ----- Expansion entries (gen_1..9.h) ---------------------------------------
  const exNamedTexts = parseTextArrays(exPp.process('src/data/pokemon/species_info.h', 'output'), 'EX species_info.h');

  // Text fields can be ternaries over named texts (the SILVALLY forms select
  // their pokedex text by type). Evaluate each condition top-down until a
  // plain literal or symbol remains.
  const peelTernaries = (pp, value, where) => {
    let v = value.trim();
    for (;;) {
      if (v.startsWith('(') && balancedParenAt(v, 0) === v.length - 1) v = v.slice(1, -1).trim();
      const cut = topLevelTernaryCut(v);
      if (!cut) break;
      const cond = v.slice(0, cut.q).trim();
      const taken = pp.evalExpr(cond, where) ? v.slice(cut.q + 1, cut.colon).trim() : v.slice(cut.colon + 1).trim();
      v = taken;
    }
    return v;
  };
  const balancedParenAt = (s, i) => {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')') { depth--; if (depth === 0) return j; }
    }
    return -1;
  };
  const topLevelTernaryCut = (s) => {
    let depth = 0;
    let q = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '{') depth++;
      else if (c === ')' || c === '}') depth--;
      else if (c === '?' && depth === 0 && q === -1) q = i;
      else if (c === ':' && depth === 0 && q !== -1) return { q, colon: i };
    }
    return null;
  };
  const resolveText = (pp, value, namedTexts, where, kind) => {
    let v = peelTernaries(pp, value, where).trim().replace(/,\s*$/, '');
    if (v.startsWith('_(')) v = v.slice(2, -1).trim();
    else if (v.startsWith('(')) v = v.slice(1, -1).trim();
    if (v.startsWith('"')) return parseStringLiterals(v, where).trim();
    if (/^g[A-Za-z0-9_]+$/.test(v)) {
      if (namedTexts.has(v)) return namedTexts.get(v).trim();
      fail(`${where}: unknown named text ${v}`);
    }
    fail(`${where}: unrecognized ${kind} ${v.slice(0, 40)}`);
  };
  // POKEDEX_DESC_STRING/COMPOUND_STRING are intentionally NOT expanded by
  // inlineMacros (see Preprocessor.stringMacros): EX redefines
  // POKEDEX_DESC_STRING to an empty string (the Rogue dex never shows the
  // pokedex text), but the raw argument in the source is the canonical dex
  // description, so it is extracted verbatim.
  const resolveDescription = (pp, value, namedTexts, where) => {
    let v = value.trim().replace(/,\s*$/, '');
    const sm = /^(POKEDEX_DESC_STRING|COMPOUND_STRING)\(([\s\S]*)\)$/.exec(v);
    if (sm) return parseStringLiterals(sm[2], where).replace(/[ \t\r\n]+$/, '');
    // COMPOUND_STRING(str) inlines to (const u8[]) _(str)
    const cs = /^\(const u8\[\]\)\s*_?\(([\s\S]*)\)$/.exec(v);
    if (cs) return parseStringLiterals(cs[1], where).replace(/[ \t\r\n]+$/, '');
    return resolveText(pp, v, namedTexts, where, 'description');
  };

  const genderOf = (pp, value, where) => {
    if (value === undefined) return null;
    const v = value.trim();
    if (v === 'MON_MALE') return 'Male';
    if (v === 'MON_FEMALE') return 'Female';
    if (v === 'MON_GENDERLESS') return 'Genderless';
    // PERCENT_FEMALE(p) reaches us either raw or as its inlined body
    // min(254, ((p * 255) / 100)); both carry the female percentage p.
    const pm = /^PERCENT_FEMALE\(([^)]*)\)$/.exec(v) ?? /^min\(254, \(\(([\d.]+) \* 255\) \/ 100\)\)$/.exec(v);
    if (pm) {
      const female = pp.evalExpr(pm[1], where);
      const male = 100 - female;
      if (male >= 100) return 'Male';
      if (male <= 0) return 'Female';
      const label = Number.isInteger(male) ? String(male) : male.toFixed(1);
      return `${label}% male`;
    }
    fail(`${where}: unrecognized genderRatio ${v}`);
  };

  const exEvoMethods = evoMethodMap(exPp);
  const vanEvoMethods = evoMethodMap(vanPp);
  const exCtx = {
    byValue: exSpecies.byValue, recordIdByValue: null, // filled after the no-dex exclusion
    moveNames: exMoveByValue, itemNames: exItemNames,
    typeByValue, mapNames: exMapNames, mapsecNames: exMapsecNames,
    mapNone: resolveConst(exPp, 'MAP_NONE', 'MAP_NONE'), displayNames: new Map(),
    natureNames: exNatureNames, // the EVO_LEVEL_30_NATURE humanizer lookup
  };

  const FLAG_FIELDS = ['isLegendary', 'isMythical', 'isUltraBeast', 'isParadoxForm', 'isMegaEvolution', 'isPrimalReversion', 'isUltraBurst', 'isGigantamax', 'isTeraForm', 'isAlolanForm', 'isGalarianForm', 'isHisuianForm', 'isPaldeanForm'];
  const STAT_FIELDS = { baseHP: 'hp', baseAttack: 'atk', baseDefense: 'def', baseSpAttack: 'spa', baseSpDefense: 'spd', baseSpeed: 'spe' };

  const exEntries = new Map(); // id -> entry
  const missingFields = new Map();
  const missingExamples = {};
  for (const file of exEntryFiles) {
    const raw = exPp.process(file, 'output');
    const bm = /\[SPECIES_([A-Z0-9_]+)\]\s*=\s*/g;
    let m;
    while ((m = bm.exec(raw))) {
      const id = m[1].toLowerCase();
      if (!exSpecies.idByValue.has(id)) fail(`${file}: entry for unknown species SPECIES_${m[1]}`);
      let i = bm.lastIndex;
      let inner;
      if (raw[i] === '{') {
        // Block initializer: [SPECIES_X] = { … }
        let depth = 1;
        let end = i;
        for (i++; i < raw.length; i++) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        inner = raw.slice(bm.lastIndex + 1, end); // drop the outer braces
        bm.lastIndex = end + 1;
      } else if (/[A-Za-z_]/.test(raw[i] ?? '')) {
        // One-line macro initializer: [SPECIES_X] = SOME_INFO(args),
        let j = i;
        let paren = 0;
        for (; j < raw.length; j++) {
          if (raw[j] === '(') paren++;
          else if (raw[j] === ')') { paren--; if (paren === 0) { j++; break; } }
        }
        let k = j;
        while (k < raw.length && /\s/.test(raw[k])) k++;
        if (raw[k] !== ',') fail(`${file}: [SPECIES_${m[1]}] macro initializer not followed by a comma`);
        inner = raw.slice(i, j);
        bm.lastIndex = k + 1;
      } else {
        fail(`${file}: unhandled entry initializer for SPECIES_${m[1]}`);
      }
      const where = `${file} [SPECIES_${m[1]}]`;
      let inlined = exPp.inlineMacros(inner, where).trim();
      // Some *_SPECIES_INFO macros are themselves braced initializers.
      if (inlined.startsWith('{') && inlined.endsWith('}')) inlined = inlined.slice(1, -1);
      const fields = splitFields(inlined, where);
      const e = {};
      const evoBlocks = [];
      for (const { field, value } of fields) {
        if (field in STAT_FIELDS) e[STAT_FIELDS[field]] = exPp.evalExpr(value, where);
        else if (field === 'types') {
          const parts = parseBracedList(value, 'types', where);
          // monotypes are stored as { T, T } (never T + TYPE_NONE) — dedupe
          e.types = [...new Set(parts.map((p) => resolveListValue(exPp, p, typeNames, typeByValue, 'type', where)).filter((t) => t !== 'None'))];
          if (e.types.length < 1 || e.types.length > 2) fail(`${where}: bad type count`);
        }
        else if (['catchRate', 'expYield', 'natDexNum', 'height', 'weight', 'evYield_HP', 'evYield_Attack', 'evYield_Defense', 'evYield_SpAttack', 'evYield_SpDefense', 'evYield_Speed'].includes(field)) {
          e[field] = exPp.evalExpr(value, where);
        }
        else if (field === 'genderRatio') e.genderRatio = value;
        else if (field === 'eggGroups') e.eggGroups = parseBracedList(value, 'eggGroups', where).map((g2) => resolveListValue(exPp, g2, eggGroupNames, eggGroupByValue, 'egg group', where));
        else if (field === 'abilities') e.abilities = parseBracedList(value, 'abilities', where).map((a) => { if (a === 'ABILITY_NONE') return null; return resolveListValue(exPp, a, exAbilityNames, exAbilityByValue, 'ability', where); }).filter(Boolean);
        else if (field === 'description') { e.description = value; if (/^g[A-Za-z0-9_]+$/.test(value.trim())) e.namedDescription = true; }
        else if (field === 'categoryName') { e.categoryName = value; if (/^g[A-Za-z0-9_]+$/.test(value.trim())) e.namedCategory = true; }
        else if (field === 'speciesName') { e.speciesName = value; if (/^g[A-Za-z0-9_]+$/.test(value.trim())) e.namedName = true; }
        else if (FLAG_FIELDS.includes(field)) e[field] = Boolean(exPp.evalExpr(value, where));
        else if (field === 'evolutions') {
          const inner = value.match(/^EVOLUTION\(([\s\S]*)\)\s*$/);
          if (!inner) fail(`${where}: evolutions is not an EVOLUTION(…) block`);
          evoBlocks.push(...splitTopLevelBraces(inner[1], where));
        }
        else if (field === 'formSpeciesIdTable') e.formSpeciesIdTable = value.trim();
        else if (field === 'frontPic' || field === 'palette') e[field] = value.trim(); // resolved by the shared sprite-forms manifest (see below)
        else if (['eggCycles', 'friendship', 'growthRate', 'bodyColor', 'forceTeraType', 'cryId', 'footprint', 'cannotBeTraded', 'itemCommon', 'itemRare', 'enemyMonElevation', 'noFlip', 'formChangeTable', 'levelUpLearnset', 'teachableLearnset', 'shinyPalette', 'paletteFemale', 'shinyPaletteFemale', 'allPerfectIVs', 'pokemonOffset', 'pokemonScale', 'trainerOffset', 'trainerScale', 'backAnimId', 'backPic', 'backPicSize', 'backPicYOffset', 'frontAnimDelay', 'frontAnimFrames', 'frontAnimId', 'frontPicSize', 'frontPicYOffset', 'frontPicFemale', 'frontPicSizeFemale', 'backPicFemale', 'backPicSizeFemale', 'iconPalIndex', 'iconSprite', 'iconSpriteFemale', 'iconPalIndexFemale', 'stub'].includes(field)) { /* present in the game struct but not part of the record schema (moves come from the per-species profiles; sprites from the committed site assets; LEARNSETS(x) expands to .stub = 0) */ }
        else fail(`${where}: unhandled entry field .${field}`);
      }
      for (const req of ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'types', 'catchRate', 'expYield', 'genderRatio', 'eggGroups', 'abilities', 'natDexNum', 'height', 'weight', 'description', 'categoryName', 'speciesName']) {
        if (e[req] === undefined) { missingFields[req] = (missingFields[req] ?? 0) + 1; if ((missingFields[req] ?? 0) <= 3) missingExamples[`${req}`] = (missingExamples[req] ?? []).concat(id); }
      }
      if (exEntries.has(id)) fail(`${file}: duplicate entry for ${id}`);
      exEntries.set(id, {
        id,
        value: exSpecies.idByValue.get(id),
        stats: e,
        types: e.types,
        catchRate: e.catchRate,
        baseExp: e.expYield,
        evYields: { hp: e.evYield_HP ?? 0, atk: e.evYield_Attack ?? 0, def: e.evYield_Defense ?? 0, spa: e.evYield_SpAttack ?? 0, spd: e.evYield_SpDefense ?? 0, spe: e.evYield_Speed ?? 0 },
        gender: genderOf(exPp, e.genderRatio, where),
        eggGroups: [...new Set(e.eggGroups)],
        abilities: e.abilities,
        dexNum: e.natDexNum,
        height: formatHeight(e.height),
        weight: formatWeight(e.weight),
        // A few form entries (the MINIOR meteor forms) carry no pokedex
        // text at all: the field is left null and dropped from the record.
        description: e.description !== undefined ? resolveDescription(exPp, e.description, exNamedTexts, where) : null,
        // the in-game category line is <word> Pokémon (the bare word here)
        category: e.categoryName !== undefined ? `${resolveText(exPp, e.categoryName, exNamedTexts, where, 'category')} Pokémon` : null,
        name: e.speciesName !== undefined ? resolveText(exPp, e.speciesName, exNamedTexts, where, 'species name') : null,
        flags: Object.fromEntries(FLAG_FIELDS.map((f) => [f.slice(2).toLowerCase(), e[f] ?? false])),
        evoBlocks,
        formTable: e.formSpeciesIdTable ?? null,
        // the entry's own sprite symbols (cross-checked against the shared
        // sprite-forms manifest — see below; never part of the data record)
        frontPic: e.frontPic ?? null,
        palette: e.palette ?? null,
        namedTextFields: [e.namedName, e.namedCategory, e.namedDescription].filter(Boolean),
        file,
      });
    }
  }
  const exEntryCount = exEntries.size;
  if (exEntryCount < 1000) fail(`only ${exEntryCount} EX entries parsed — something is off`);

  // ----- form tables ---------------------------------------------------------
  const exFormTables = (() => {
    // form species id tables live in two headers
    const raw = exPp.process('src/data/pokemon/form_species_tables.h', 'output')
      + '\n' + exPp.process('src/data/pokemon/form_change_tables.h', 'output');
    const tables = new Map();
    const re = /static const u16 (s[A-Za-z0-9_]+FormSpeciesIdTable)\[\]\s*=\s*\{([\s\S]*?)\};/g;
    let m;
    while ((m = re.exec(raw))) {
      const ids = [...m[2].matchAll(/SPECIES_([A-Z0-9_]+)/g)].map((s) => s[1].toLowerCase()).filter((s) => exSpecies.idByValue.has(s));
      if (ids.length > 0) tables.set(m[1], ids);
    }
    return tables;
  })();

  function formDisplayName(entry, base) {
    const f = entry.flags;
    const baseName = base.name;
    if (f.megaevolution) {
      if (entry.id.endsWith('_mega_x')) return `Mega ${baseName} X`;
      if (entry.id.endsWith('_mega_y')) return `Mega ${baseName} Y`;
      return `Mega ${baseName}`;
    }
    if (f.gigantamax) return `Gigantamax ${baseName}`;
    if (f.primalreversion) return `Primal ${baseName}`;
    if (f.ultraburst) return `Ultra ${baseName}`;
    const regional = f.alolanform ? 'Alolan' : f.galarianform ? 'Galarian' : f.hisuianform ? 'Hisuian' : f.paldeanform ? 'Paldean' : null;
    if (regional) {
      const rest = entry.id.slice(base.id.length + 1).replace(/^(alolan|galarian|hisuian|paldean)_/, '');
      if (!rest) return `${regional} ${baseName}`;
      return `${regional} ${baseName} (${titleCaseId(rest)})`;
    }
    if (f.teraform) {
      const rest = entry.id.slice(base.id.length + 1).replace(/_tera$/, '');
      if (!rest) return `${baseName} (Tera Form)`;
      return `${baseName} (${titleCaseId(rest)}, Tera)`;
    }
    return `${baseName} (${titleCaseId(entry.id.slice(base.id.length + 1))})`;
  }

  // sanity: entry dexNum matches the NATIONAL_DEX enum for the same species.
  // Entries with no NATIONAL_DEX member at all (the mega battle forms) are
  // referenced by their base's form table and are not dex records — but they
  // keep their display names for the base's forms field.
  const exNoDexEntries = [];
  const exNoDexMap = new Map();
  for (const entry of exEntries.values()) {
    const enumNum = exDexNum.get(entry.id);
    if (typeof enumNum !== 'number') {
      exNoDexEntries.push(entry.id);
      continue;
    }
    if (enumNum !== entry.dexNum) fail(`${entry.id}: natDexNum ${entry.dexNum} != NATIONAL_DEX enum ${enumNum}`);
  }
  if (exNoDexEntries.length) {
    const inTables = new Set();
    for (const ids of exFormTables.values()) for (const id of ids) inTables.add(id);
    // mega battle forms are also reachable via form_change_tables.h alone
    const changeRaw = exPp.process('src/data/pokemon/form_change_tables.h', 'output');
    for (const s of changeRaw.matchAll(/SPECIES_([A-Z0-9_]+)/g)) {
      const id = s[1].toLowerCase();
      if (exSpecies.idByValue.has(id)) inTables.add(id);
    }
    const orphan = exNoDexEntries.filter((id) => !inTables.has(id));
    if (orphan.length) fail(`EX entries with no NATIONAL_DEX member, referenced by no form table: ${orphan.join(', ')}`);
    for (const id of exNoDexEntries) { exNoDexMap.set(id, exEntries.get(id)); exEntries.delete(id); }
    console.error(`note: ${exNoDexEntries.length} EX entries have no NATIONAL_DEX member (form/rogue variants, covered by their base's forms field): ${exNoDexEntries.join(', ')}`);
  }

  // Form-group bases: NATIONAL_DEX members whose own initializer is absent —
  // the base name is a plain alias of the first form (castform, deoxys,
  // arceus, …). Synthesize the base record from that first form so the dex
  // entry, evolutions and forms list have a home.
  const exValueGroups = new Map();
  for (const [sid, v] of exSpecies.idByValue) {
    if (!exValueGroups.has(v)) exValueGroups.set(v, []);
    exValueGroups.get(v).push(sid);
  }
  const exSynthesized = [];
  for (const base of [...exDexNum.keys()].sort()) {
    if (exEntries.has(base) || !exSpecies.idByValue.has(base)) continue;
    const donor = (exValueGroups.get(exSpecies.idByValue.get(base)) ?? []).find((g) => exEntries.has(g) || exNoDexMap.has(g));
    if (!donor) fail(`${base}: national-dex species with no species initializer of its own or in any form`);
    const src = exEntries.get(donor) ?? exNoDexMap.get(donor);
    const e = structuredClone(src);
    e.id = base;
    if (e.dexNum !== exDexNum.get(base)) fail(`${base}: donor ${donor} natDexNum ${e.dexNum} != ${exDexNum.get(base)}`);
    exEntries.set(base, e);
    exSynthesized.push(base);
  }
  if (exSynthesized.length) console.error(`note: ${exSynthesized.length} form-group bases have no initializer of their own (plain alias of the first form); synthesized from that form: ${exSynthesized.join(', ')}`);

  // form-table families: every entry sharing one formSpeciesIdTable belongs
  // to that species' family; the family's base is its record member (a real
  // or synthesized entry — the synthesized base claims the table via the
  // donor copy), else the table's first member (rogue families have no record)
  const exFamilyBase = new Map(); // formTable -> baseId
  for (const entry of exEntries.values()) {
    if (entry.formTable && !exFamilyBase.has(entry.formTable)) exFamilyBase.set(entry.formTable, entry.id);
  }
  for (const [table, ids] of exFormTables) {
    if (!exFamilyBase.has(table)) exFamilyBase.set(table, ids[0] ?? null);
  }

  // form membership + display names for every parsed entry: the records AND
  // the dex-less forms (the base's forms list needs the no-dex names too)
  const allExEntries = [...exEntries.values(), ...exNoDexMap.values()];
  for (const entry of allExEntries) {
    if (entry.formTable) {
      const ids = exFormTables.get(entry.formTable);
      if (!ids) fail(`${entry.id}: unknown form table ${entry.formTable}`);
      entry.formIds = ids;
    } else {
      entry.formIds = [entry.id];
    }
    entry.baseId = entry.formTable ? (exFamilyBase.get(entry.formTable) ?? entry.id) : entry.id;
  }

  // display names: base = speciesName; forms derived from flags + id suffix
  const exDisplayNames = exCtx.displayNames;
  for (const entry of allExEntries) {
    const base = exEntries.has(entry.baseId) ? exEntries.get(entry.baseId) : (exNoDexMap.get(entry.baseId) ?? entry);
    if (entry.id === base.id) exDisplayNames.set(entry.id, base.name);
    else exDisplayNames.set(entry.id, formDisplayName(entry, base));
  }

  for (const [field, count] of missingFields) {
    console.error(`note: .${field} absent on ${count} EX entr${count === 1 ? 'y' : 'ies'}: ${missingExamples[field].slice(0, 8).join(', ')}${missingExamples[field].length > 8 ? ', …' : ''}`);
  }

  // value -> the record that OWNS that value: a record's own value maps to
  // itself; a dex-less form's value maps to its family base (evolution
  // targets that reference a form resolve to the base's record)
  exCtx.recordIdByValue = (() => {
    const m = new Map();
    const put = (v, id) => { if (v !== undefined && !m.has(v)) m.set(v, id); };
    for (const entry of exEntries.values()) {
      if (entry.baseId === entry.id) put(exSpecies.idByValue.get(entry.id), entry.id);
    }
    for (const entry of exNoDexMap.values()) {
      put(exSpecies.idByValue.get(entry.id), entry.baseId);
    }
    return m;
  })();

  // EX raw evolution tuples per entry (records AND dex-less forms — the
  // forms run through the same runtime rewrite keyed by their own species
  // value). The 0xfffe (EVO_NONE) slots are KEPT here: they occupy the
  // indices the per-species overrides target; they only get filtered out
  // later if they SURVIVE the rewrite. The post-rewrite display lists are
  // computed after the learnset profiles are available (the
  // ModifyKnowMoveEvo port reads the species' level-up list).
  const parseEvoTuples = (pp, blocks, where, terminator) => {
    const out = [];
    for (const block of blocks) {
      const body = block.replace(/^\{/, '').replace(/\}$/, '').trim();
      const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) fail(`${where}: expected 3 evolution fields: ${body.slice(0, 60)}`);
      const method = pp.evalExpr(parts[0], where);
      if (method === terminator) continue; // the table's end marker (0xffff EX / 0 Vanilla)
      out.push({ method, param: pp.evalExpr(parts[1], where), target: pp.evalExpr(parts[2], where) });
    }
    return out;
  };
  const exEvoRaw = new Map(); // entryId -> raw tuples, in table order
  for (const entry of allExEntries) {
    exEvoRaw.set(entry.id, parseEvoTuples(exPp, entry.evoBlocks, `EX evolution for ${entry.id}`, 0xffff));
  }
  // GetBaseEvolution's SPECIES_MELTAN case — the species table entry has no
  // .evolutions at all; the game uses this fixed table instead
  const meltanEvoRaw = [{ method: 0xfffe, param: 0, target: resolveConst(exPp, 'SPECIES_MELMETAL', 'EX SPECIES_MELMETAL') }];

  // ----- Vanilla species data --------------------------------------------------
  const vanBaseStats = (() => {
    const raw = vanPp.process('src/data/pokemon/base_stats.h', 'output');
    const out = new Map();
    const bm = /\[SPECIES_([A-Z0-9_]+)\]\s*=\s*/g;
    let m;
    while ((m = bm.exec(raw))) {
      const species = m[1].toLowerCase();
      if (species === 'none') continue; // the zero-filled SPECIES_NONE slot
      let i = bm.lastIndex;
      let body;
      if (raw[i] === '{') {
        let depth = 0;
        let end = i;
        for (; i < raw.length; i++) {
          if (raw[i] === '{') depth++;
          else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        body = raw.slice(bm.lastIndex + 1, end); // drop the outer braces
      } else {
        const mm = /^[A-Z0-9_]+/.exec(raw.slice(i));
        if (!mm) fail(`vanilla base_stats: bad entry for ${species}`);
        const def = vanDefines.get(mm[0]);
        if (!def || def.params || !def.body.includes('{')) fail(`vanilla base_stats: unknown macro ${mm[0]}`);
        body = def.body;
        if (body.startsWith('{') && body.endsWith('}')) body = body.slice(1, -1);
      }
      const where = `vanilla base_stats [SPECIES_${m[1]}]`;
      const fields = splitFields(body, where);
      const e = {};
      for (const { field, value } of fields) {
        if (field in STAT_FIELDS) e[STAT_FIELDS[field]] = vanPp.evalExpr(value, where);
        // vanilla base_stats use the pre-.types fields: .type1/.type2 and
        // .eggGroup1/.eggGroup2 (one entry per type/egg group)
        else if (field === 'type1' || field === 'type2') (e.types ??= []).push(resolveListValue(vanPp, value, typeNames, vanTypeByValue, 'type', where));
        else if (field === 'eggGroup1' || field === 'eggGroup2') (e.eggGroups ??= []).push(resolveListValue(vanPp, value, eggGroupNames, vanEggGroupByValue, 'egg group', where));
        else if (field === 'types') e.types = parseBracedList(value, 'types', where).map((p) => resolveListValue(vanPp, p, typeNames, vanTypeByValue, 'type', where));
        else if (field === 'catchRate' || field === 'expYield') e[field] = vanPp.evalExpr(value, where); // numbers, like the EX path — the vanilla overlay keeps only genuinely differing values
        else if (field === 'genderRatio' || field === 'abilities') e[field] = value; // raw: genderOf/parseBracedList resolve them
        else if (field === 'eggGroups') (e.eggGroups ??= []).push(...parseBracedList(value, 'eggGroups', where).map((g2) => resolveListValue(vanPp, g2, eggGroupNames, vanEggGroupByValue, 'egg group', where)));
      }
      // monotypes are stored as { T, T } (never T + TYPE_NONE) — dedupe, mirroring the EX path
      e.types = [...new Set((e.types ?? []).filter((t) => t !== 'None'))];
      for (const req of ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'types', 'catchRate', 'expYield', 'genderRatio', 'eggGroups', 'abilities']) {
        if (e[req] === undefined || (Array.isArray(e[req]) && e[req].length === 0)) fail(`${where}: missing .${req}`);
      }
      out.set(species, {
        stats: e,
        types: e.types,
        catchRate: e.catchRate,
        baseExp: e.expYield,
        gender: genderOf(vanPp, e.genderRatio, where),
        eggGroups: [...new Set(e.eggGroups)],
        abilities: parseBracedList(e.abilities, 'abilities', where).map((a) => { if (a === 'ABILITY_NONE') return null; return resolveListValue(vanPp, a, vanAbilityNames, vanAbilityByValue, 'ability', where); }).filter(Boolean),
      });
    }
    if (out.size < 400) fail(`only ${out.size} vanilla base stats entries parsed`);
    return out;
  })();

  const vanRecordIdByValue = (() => {
    const m = new Map();
    for (const id of vanBaseStats.keys()) {
      const v = vanSpecies.idByValue.get(id);
      if (v !== undefined && !m.has(v)) m.set(v, id);
    }
    return m;
  })();

  // Vanilla raw evolution tuples (the humanizing context is shared with the
  // post-rewrite pass below; the rewrite runs before the display, same as
  // in-game)
  const vanEvoHumanizeCtx = {
    byValue: vanSpecies.byValue, recordIdByValue: vanRecordIdByValue, moveNames: vanMoveByValue, itemNames: vanItemNames,
    typeByValue, mapNames: vanMapNames, mapsecNames: vanMapsecNames,
    mapNone: resolveConst(vanPp, 'MAP_NONE', 'MAP_NONE'),
    displayNames: new Map([...vanSpeciesNames.entries()].map(([k, v]) => [k.replace(/^SPECIES_/, '').toLowerCase(), v])),
  };
  const vanEvoRaw = (() => {
    const raw = vanPp.process('src/data/pokemon/evolution.h', 'output');
    const out = new Map();
    const bm = /\[SPECIES_([A-Z0-9_]+)\]\s*=\s*/g;
    let m;
    while ((m = bm.exec(raw))) {
      const species = m[1].toLowerCase();
      let i = bm.lastIndex;
      if (raw[i] !== '{') continue;
      let depth = 0;
      let end = i;
      for (; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      // drop the outer braces: the entry value is { {block}, {block}, … }
      const body = raw.slice(bm.lastIndex + 1, end);
      out.set(species, parseEvoTuples(vanPp, splitTopLevelBraces(body, `vanilla evolution [SPECIES_${m[1]}]`), `vanilla evolution for ${species}`, 0));
    }
    return out;
  })();

  const vanNamedTexts = parseTextArrays(vanillaProvider.fetch('src/data/pokemon/pokedex_text.h'), 'vanilla pokedex_text.h');

  const vanDexEntries = (() => {
    const raw = vanPp.process('src/data/pokemon/pokedex_entries.h', 'output');
    const out = new Map();
    const bm = /\[NATIONAL_DEX_([A-Z0-9_]+)\]\s*=\s*\{/g;
    let m;
    while ((m = bm.exec(raw))) {
      const dexId = m[1].toLowerCase();
      let i = bm.lastIndex;
      let depth = 1; // opening { already consumed by the match
      let end = i;
      for (; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      const where = `vanilla pokedex_entries [NATIONAL_DEX_${m[1]}]`;
      const fields = splitFields(raw.slice(bm.lastIndex, end), where);
      const e = {};
      for (const { field, value } of fields) {
        if (['categoryName', 'height', 'weight', 'description'].includes(field)) e[field] = value;
      }
      if (e.categoryName === undefined || e.height === undefined || e.weight === undefined || e.description === undefined) fail(`${where}: incomplete entry`);
      out.set(dexId, {
        category: `${resolveText(vanPp, e.categoryName, vanNamedTexts, where, 'category')} Pokémon`,
        height: Number(vanPp.evalExpr(e.height, where)),
        weight: Number(vanPp.evalExpr(e.weight, where)),
        description: e.description,
      });
    }
    return out;
  })();

  // ----- rides / legendaries / dex variants / TMs (both branches) ----------------
  const parseRideMonInfos = (pp, file, label) => {
    const raw = pp.process(file, 'output');
    const out = new Map();
    const re = /\[SPECIES_([A-Z0-9_]+)\]\s*=\s*\{[\s\S]*?\.flags\s*=\s*([^,]+),/g;
    let m;
    while ((m = re.exec(raw))) {
      const species = m[1].toLowerCase();
      const labels = [
        ['RIDE_MON_FLAG_CAN_RIDE', 'Ride'],
        ['RIDE_MON_FLAG_CAN_SWIM', 'Surf'],
        ['RIDE_MON_FLAG_CAN_CLIMB', 'Climb'],
        ['RIDE_MON_FLAG_CAN_FLY', 'Fly'],
      ].filter(([flag]) => m[2].includes(flag)).map(([, l]) => l);
      if (labels.length > 0) out.set(species, labels);
    }
    return out;
  };
  const vanRides = parseRideMonInfos(vanPp, 'src/data/rogue_ridemon_infos.h', 'vanilla rides');
  const exRides = parseRideMonInfos(exPp, 'src/data/rogue_ridemon_infos.h', 'expansion rides');

  const parseLegendaryEncounters = (pp, file, label) => {
    const raw = pp.process(file, 'output');
    const start = raw.indexOf('sRogueLegendaryEncounters');
    if (start === -1) fail(`${label}: sRogueLegendaryEncounters not found in ${file}`);
    const close = raw.indexOf('};', start);
    const body = raw.slice(start, close);
    const species = new Set([...body.matchAll(/ENCOUNTER_MAP\(SPECIES_([A-Z0-9_]+),/g)].map((s) => s[1].toLowerCase()));
    if (species.size === 0) fail(`${label}: no legendary encounters parsed`);
    return species;
  };
  const vanLegendary = parseLegendaryEncounters(vanPp, 'src/data/rogue_routes.h', 'vanilla legendaries');
  const exLegendary = parseLegendaryEncounters(exPp, 'src/data/rogue_routes.h', 'expansion legendaries');

  const parseDexVariants = (pp, file, label) => {
    const raw = pp.process(file, 'output');
    const regionNames = new Map();
    let m;
    const rn = /sRogueDexRegionName_([A-Z0-9_]+)\[\]\s*=\s*_\("([^"]+)"\)/g;
    while ((m = rn.exec(raw))) regionNames.set(m[1], m[2]);
    const variantNames = new Map();
    const vn = /sRogueDexVariantName_([A-Z0-9_]+)\[\]\s*=\s*_\("([^"]+)"\)/g;
    while ((m = vn.exec(raw))) variantNames.set(m[1], m[2]);
    const variants = [];
    const vl = /const u16 sRogueDexVariant_([A-Z0-9_]+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g;
    while ((m = vl.exec(raw))) {
      const id = m[1];
      const species = new Set([...m[2].matchAll(/SPECIES_([A-Z0-9_]+)/g)].map((s) => s[1].toLowerCase()));
      variants.push({ id, name: variantNames.get(id) ?? fail(`${label}: no name for variant ${id}`), species });
    }
    if (variants.length === 0) fail(`${label}: no dex variants parsed`);
    const regionVariants = new Map();
    const rv = /const u16 sRogueDexRegion_([A-Z0-9_]+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g;
    while ((m = rv.exec(raw))) {
      regionVariants.set(m[1], [...m[2].matchAll(/POKEDEX_VARIANT_([A-Z0-9_]+)/g)].map((v) => v[1]));
    }
    for (const variant of variants) {
      const region = [...regionVariants.entries()].find(([, ids]) => ids.includes(variant.id));
      variant.region = region ? region[0] : null;
      variant.regionName = variant.region ? (regionNames.get(variant.region) ?? fail(`${label}: no region name for ${variant.region}`)) : null;
    }
    if (variants.some((v) => !v.regionName)) fail(`${label}: ${variants.filter((v) => !v.regionName).map((v) => v.id).join(', ')} lack a region`);
    return variants;
  };
  const vanVariants = parseDexVariants(vanPp, 'src/data/rogue_pokedex.h', 'vanilla dex variants');
  const exVariants = parseDexVariants(exPp, 'src/data/rogue_pokedex.h', 'expansion dex variants');

  // membership: a variant lists a species when it contains the species or its base
  const variantMembership = (id, variants, idByValue, baseId) => {
    const self = idByValue.get(id);
    const base = idByValue.get(baseId);
    if (typeof self !== 'number' || typeof base !== 'number') fail(`membership: unknown species ${id}/${baseId}`);
    const present = [];
    for (const v of variants) {
      if (v.species.has(id) || v.species.has(baseId)) present.push(`${v.regionName} (${v.name})`);
    }
    return present.length === variants.length ? 'all' : present;
  };

  const parseTmTable = (pp, file, label, moveNames) => {
    const raw = pp.process(file, 'output');
    const start = raw.indexOf('sTMHMMoves');
    if (start === -1) fail(`${label}: sTMHMMoves not found in ${file}`);
    const open = raw.indexOf('{', start);
    let depth = 0;
    let end = open;
    for (let i = open; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = raw.slice(open + 1, end);
    const tms = new Set();
    let m;
    const re = /\[\s*(?:ITEM_TM\d+)\s*-\s*ITEM_TM01\s*\]\s*=\s*(MOVE_[A-Z0-9_]+)/g;
    while ((m = re.exec(body))) {
      const move = m[1];
      if (move === 'MOVE_NONE') continue;
      if (!moveNames.has(move)) fail(`${label}: TM move ${move} has no name`);
      tms.add(moveNames.get(move));
    }
    if (tms.size < 20) fail(`${label}: only ${tms.size} TMs parsed`);
    return tms;
  };
  const vanTmMoves = parseTmTable(vanPp, 'src/data/party_menu.h', 'vanilla TMs', vanMoveNames);
  const exTmMoves = parseTmTable(exPp, 'src/data/party_menu.h', 'expansion TMs', exMoveNames);

  // ----- sprite assets (site/assets/pokemon) ---------------------------------------
  const spriteDir = path.join(PROJECT_ROOT, 'site', 'assets', 'pokemon');
  if (!existsSync(spriteDir)) fail(`sprite asset dir missing: ${spriteDir}`);
  const spriteBase = new Set();
  const spriteEx = new Set();
  for (const f of readdirSync(spriteDir)) {
    if (f.endsWith('-ex.png')) spriteEx.add(f.slice(0, -'-ex.png'.length));
    else if (f.endsWith('.png')) spriteBase.add(f.slice(0, -'.png'.length));
  }

  // EX sprite source files (one ls-tree call): the sprite extractor
  // composites EX art from front.png, falling back to the first frame of
  // anim_front.png — the citation must name the file that actually exists.
  const exSpriteFiles = new Set(
    execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'origin/expansion', 'graphics/pokemon/'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((p) => p.replace(/^graphics\/pokemon\//, '')),
  );
  const exSpriteSource = (id) =>
    exSpriteFiles.has(`${id}/front.png`) ? `graphics/pokemon/${id}/front.png`
    : exSpriteFiles.has(`${id}/anim_front.png`) ? `graphics/pokemon/${id}/anim_front.png`
    : null;

  // ----- form sprites (shared resolver with scripts/extract/sprites.mjs) ---
  // The manifest parses the species tables from RAW text — the preprocessed
  // 'output' above strips #define, so the macro-initializer entries (the
  // OGERPON / XERNEAS / SILVALLY / MINIOR / GENESECT family calls) cannot be
  // re-derived from it. Both parsers must agree, entry for entry (gate below).
  const vanillaArtDirs = new Set();
  if (existsSync(path.join(repo, 'graphics', 'pokemon'))) {
    for (const d of readdirSync(path.join(repo, 'graphics', 'pokemon'), { withFileTypes: true })) {
      if (d.isDirectory()) vanillaArtDirs.add(d.name.toLowerCase());
    }
  }
  const formManifest = formSpriteManifest({
    pokemonH: exProvider.fetch('src/data/graphics/pokemon.h'),
    speciesTableTexts: [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => exProvider.fetch(`src/data/pokemon/species_info/gen_${g}.h`)),
      exProvider.fetch('src/data/pokemon/species_info.h'),
    ],
    // only species art directories — the manifest's baseDirs contract
    // (the icon-palette / placeholder dirs are not base directories)
    baseDirs: new Set(
      [...vanillaArtDirs, ...[...exSpriteFiles].map((p) => p.split('/')[0].toLowerCase())].filter((d) => !NON_SPECIES_DIRS.has(d)),
    ),
    exTreeFiles: exSpriteFiles,
    label: 'pokedex',
  });
  // Gate: the manifest's raw-text parse must agree with this extractor's
  // preprocessor parse — the same entry-id set AND the same resolved
  // front/palette source for every entry.
  const realExIds = new Set([...exNoDexMap.keys(), ...exEntries.keys()]);
  for (const id of exSynthesized) realExIds.delete(id); // synthesized bases have no initializer
  for (const id of formManifest.entries.keys()) if (!realExIds.has(id)) fail(`sprite-forms manifest entry ${id} is missing from the species parse`);
  for (const id of realExIds) if (!formManifest.entries.has(id)) fail(`species entry ${id} is missing from the sprite-forms manifest`);
  const manifestTables = parseSpriteTables(exProvider.fetch('src/data/graphics/pokemon.h'));
  for (const [id, man] of formManifest.entries) {
    const entry = exEntries.get(id) ?? exNoDexMap.get(id);
    if (!entry.frontPic || !entry.palette) fail(`entry ${id}: .frontPic/.palette not captured — skip-list regression?`);
    if (manifestTables.fronts.get(entry.frontPic) !== man.frontPath) fail(`entry ${id}: .frontPic ${entry.frontPic} resolves to ${manifestTables.fronts.get(entry.frontPic) ?? 'nothing'}, manifest has ${man.frontPath}`);
    if (manifestTables.palettes.get(entry.palette) !== man.palPath) fail(`entry ${id}: .palette ${entry.palette} resolves to ${manifestTables.palettes.get(entry.palette) ?? 'nothing'}, manifest has ${man.palPath}`);
  }
  console.error(`note: form sprites — ${formManifest.counts.own} own entries, ${formManifest.counts.baseIdentical} base-identical + ${formManifest.counts.ternary} ternary-macro use the base art; roster-referenced own forms ship <formEntryId>.png (verified against site/assets/pokemon after the records are built); forms with no species entry fall back to the base sprite`);

  // cross-extractor drift guard state (filled by formsOf, checked after the
  // record loop): every own-classified roster form must have its shipped
  // PNG on disk — the sprite extractor emits exactly this set
  const referencedOwn = new Set();
  const missingFormArt = [];

  // ----- profiles ------------------------------------------------------------------
  const profileCache = new Map();
  const profile = (branch, id) => {
    const key = `${branch}:${id}`;
    if (profileCache.has(key)) return profileCache.get(key);
    const base = branch === 'vanilla' ? 'src/data/rogue/pokemon/vanilla' : 'src/data/rogue/pokemon/expansion';
    const file = `${base}/${id}/${branch === 'vanilla' ? 'vanilla_profile.json' : 'expansion_profile.json'}`;
    if (!(branch === 'vanilla' ? vanillaProvider : exProvider).has(file)) {
      profileCache.set(key, null);
      return null;
    }
    const data = JSON.parse((branch === 'vanilla' ? vanillaProvider : exProvider).fetch(file));
    if (!Array.isArray(data.Species) || data.Species.length === 0) fail(`profile ${file}: no Species array`);
    profileCache.set(key, {
      file,
      levelUp: (data.LevelUpMoves ?? []).map((mv) => [mv.Move, mv.Level]),
      tutor: data.TutorMoves ?? [],
      species: data.Species.map((s) => s.slice('SPECIES_'.length).toLowerCase()),
    });
    return profileCache.get(key);
  };

  // Vanilla display names keyed by lowercase id (for evo target humanization)
  const vanDisplayNames = new Map([...vanSpeciesNames.entries()].map(([k, v]) => [k.replace(/^SPECIES_/, '').toLowerCase(), v]));

  const statsOf = (s) => ({ hp: s.hp, atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe, total: s.hp + s.atk + s.def + s.spa + s.spd + s.spe });

  // ----- evolution rewrite (the port of Rogue_ModifyEvolution) ----------------
  // Branch-scoped lookup contexts for the port. profileLevelUp is what
  // ModifyKnowMoveEvo reads (Rogue_GetPokemonProfile — the level-up move
  // list, resolved per species the same way the rest of the record resolves
  // its profile: record id first, then the base id for form entries).
  const exEvoCtx = {
    evoConsts: makeEvoConsts('ex', exPp, 'EX evo constants'),
    none: resolveConst(exPp, 'SPECIES_NONE', 'EX SPECIES_NONE'),
    species: (tail) => exSpecies.idByValue.get(tail.toLowerCase()) ?? fail(`EX evo: unknown species ${tail}`),
    baseSpecies: (tail) => {
      // GET_BASE_SPECIES_ID — the first member of the species' value group
      // (all members share one value, so this is the group's value)
      const v = exSpecies.idByValue.get(tail.toLowerCase()) ?? fail(`EX evo: unknown species ${tail}`);
      const group = exValueGroups.get(v);
      if (!group || group.length === 0) fail(`EX evo: no value group for ${tail}`);
      return v;
    },
    item: (tail) => exItemValues.get(tail) ?? fail(`EX evo: unknown item ${tail}`),
    nature: (tail) => resolveConst(exPp, `NATURE_${tail}`, `EX nature ${tail}`),
    profileLevelUp: (value) => {
      const id = exCtx.recordIdByValue.get(value) ?? exCtx.byValue.get(value);
      const entry = id ? exEntries.get(id) : null;
      const pid = entry ? (profile('ex', entry.id) ? entry.id : entry.baseId) : null;
      const p = pid ? profile('ex', pid) : null;
      return p ? p.levelUp : null;
    },
  };
  const vanEvoCtx = {
    evoConsts: makeEvoConsts('vanilla', vanPp, 'vanilla evo constants'),
    none: resolveConst(vanPp, 'SPECIES_NONE', 'vanilla SPECIES_NONE'),
    species: (tail) => vanSpecies.idByValue.get(tail.toLowerCase()) ?? fail(`vanilla evo: unknown species ${tail}`),
    baseSpecies: (tail) => vanSpecies.idByValue.get(tail.toLowerCase()) ?? fail(`vanilla evo: unknown species ${tail}`),
    item: (tail) => vanItemValues.get(tail) ?? fail(`vanilla evo: unknown item ${tail}`),
    nature: (tail) => resolveConst(vanPp, `NATURE_${tail}`, `vanilla nature ${tail}`),
    profileLevelUp: (value) => {
      const id = vanRecordIdByValue.get(value);
      const p = id ? profile('vanilla', id) : null;
      return p ? p.levelUp : null;
    },
  };

  // The post-rewrite display lists, keyed by entry/record id: the
  // { id, method, target } of every surviving branch (in table order, capped
  // at 8 like the in-game display). `target` (the species value) is kept for
  // the prev computation; it is dropped from the emitted shape.
  const exEvoPost = (() => {
    const out = new Map();
    for (const entry of allExEntries) {
      const raw = entry.id === 'meltan' ? meltanEvoRaw : (exEvoRaw.get(entry.id) ?? []);
      const list = [];
      for (const evo of buildEvoDisplayList('ex', exEvoCtx, entry.value, raw)) {
        const h = humanizeEvolution(evo.method, evo.param, evo.target, exEvoMethods, `EX evolution for ${entry.id}`, exCtx);
        if (!exEntries.has(h.target)) fail(`EX evolution for ${entry.id}: target ${h.target} is not a record`);
        list.push({ id: h.target, method: h.method, target: evo.target });
      }
      out.set(entry.id, list);
    }
    return out;
  })();
  const vanEvoPost = (() => {
    const out = new Map();
    for (const [vanId, raw] of vanEvoRaw) {
      const list = [];
      for (const evo of buildEvoDisplayList('vanilla', vanEvoCtx, vanSpecies.idByValue.get(vanId), raw)) {
        const h = humanizeEvolution(evo.method, evo.param, evo.target, vanEvoMethods, `vanilla evolution for ${vanId}`, vanEvoHumanizeCtx);
        if (!vanBaseStats.has(h.target)) fail(`vanilla evolution for ${vanId}: target ${h.target} has no base stats`);
        list.push({ id: h.target, method: h.method, target: evo.target });
      }
      out.set(vanId, list);
    }
    return out;
  })();

  // { prev?, evos? } for a record or form (issue #97 shape): evos = the
  // post-rewrite branches, prev = the SMALLEST-dex-number record whose own
  // post-rewrite list targets this species. Forms are matched by their own
  // species value; records by id (a record's own value group includes its
  // forms, so matching a record by value would false-positive on form
  // tables).
  const exEvoPair = (selfId, selfValue, selfIsForm) => {
    const evos = exEvoPost.get(selfId) ?? [];
    let prev;
    let best = Infinity;
    for (const [sid, list] of exEvoPost) {
      if (sid === selfId || !exEntries.has(sid)) continue; // only records can be a prev
      const hit = list.find((e) => (selfIsForm ? e.target === selfValue : e.id === selfId));
      if (!hit) continue;
      const dn = exEntries.get(sid).dexNum;
      if (dn < best) { best = dn; prev = { id: sid, method: hit.method }; }
    }
    if (!prev && evos.length === 0) return null;
    return {
      ...(prev ? { prev } : {}),
      ...(evos.length > 0 ? { evos: evos.map(({ id, method }) => ({ id, method })) } : {}),
    };
  };
  const vanEvoPair = (vanId) => {
    const evos = vanEvoPost.get(vanId) ?? [];
    let prev;
    let best = Infinity;
    for (const [sid, list] of vanEvoPost) {
      if (sid === vanId) continue;
      const hit = list.find((e) => e.id === vanId);
      if (!hit) continue;
      const dn = vanDexNum.get(sid) ?? 0;
      if (dn < best) { best = dn; prev = { id: sid, method: hit.method }; }
    }
    if (!prev && evos.length === 0) return null;
    return {
      ...(prev ? { prev } : {}),
      ...(evos.length > 0 ? { evos: evos.map(({ id, method }) => ({ id, method })) } : {}),
    };
  };

  const buildMoves = (profileSpeciesId, branch) => {
    const p = profile(branch, profileSpeciesId);
    if (!p) return null;
    const names = branch === 'ex' ? exMoveNames : vanMoveNames;
    const tms = branch === 'ex' ? exTmMoves : vanTmMoves;
    const levelUp = p.levelUp.map(([mv, lvl]) => [names.get(mv) ?? fail(`profile ${p.file}: unknown move ${mv}`), lvl]);
    const tutor = p.tutor.map((mv) => names.get(mv) ?? fail(`profile ${p.file}: unknown move ${mv}`));
    const known = new Set([...levelUp.map((m) => m[0]), ...tutor]);
    const tm = [...tms].filter((n) => known.has(n)).sort();
    const out = {};
    if (levelUp.length > 0) out.levelUp = levelUp;
    if (tutor.length > 0) out.tutor = tutor;
    if (tm.length > 0) out.tm = tm;
    return Object.keys(out).length > 0 ? out : null;
  };

  // profile Species can reference rogue-only forms (e.g. the custom megas)
  // that have no species_info entry at all — derive their label from the id
  const missingFormName = (baseId, baseName, id) => {
    if (!id.startsWith(`${baseId}_`)) fail(`${id}: cannot derive a form name (not a form of ${baseId})`);
    const rest = id.slice(baseId.length + 1);
    // <core>_mega[xy] or a bare mega[xy] suffix → "Mega <Base> (<Core>) [X]"
    const m = /^(mega)(_([xy]|z))?$/.exec(rest) || /^(.*)_mega(_([xy]|z))?$/.exec(rest);
    if (m) {
      const core = m[1] === 'mega' ? '' : m[1];
      const variant = m[3] ? m[3].toUpperCase() : null;
      let label = `Mega ${baseName}`;
      if (core) label += ` (${titleCaseId(core)})`;
      if (variant) label += ` ${variant}`;
      return label;
    }
    return `${baseName} (${titleCaseId(rest)})`;
  };

  // the record's form ids: the profile's Species list is the authoritative
  // form roster when it lists any (the base is Species[0]); otherwise fall
  // back to the species' form table (the base excluded)
  const formRosterOf = (exId, profileId) => {
    const p = profile('ex', profileId);
    if (p && p.species.length > 1) return p.species.slice(1);
    const entry = exEntries.get(exId);
    if (entry.formIds.length < 2) return [];
    return entry.formIds.filter((f) => f !== exId);
  };

  // per-form data from the form's own species_info entry (dex-less forms —
  // the mega battle forms and regional variants — live in exNoDexMap); each
  // optional field is included only when the entry carries it
  const formObjectOf = (f, exId, baseName, fromProfile) => {
    const entry = exEntries.get(f) ?? exNoDexMap.get(f);
    // rogue-only custom megas (profile-listed, no species_info entry at all)
    // render name-only; a form-table id without an entry is a parse bug
    if (!entry) {
      if (!fromProfile) fail(`${f}: no display name`);
      return { name: missingFormName(exId, baseName, f) };
    }
    const form = { name: exDisplayNames.get(f) };
    form.types = entry.types;
    const st = statsOf(entry.stats);
    if ([st.hp, st.atk, st.def, st.spa, st.spd, st.spe].every(Number.isFinite)) form.stats = st;
    form.abilities = entry.abilities;
    if (Number.isFinite(entry.stats.height)) form.height = entry.height;
    if (Number.isFinite(entry.stats.weight)) form.weight = entry.weight;
    if (entry.description !== null) form.description = entry.description;
    // form art: only forms that OWN their sprite carry a marker — a bare
    // formEntryId whose art ships as <formEntryId>.png (the shared
    // sprite-forms rule; base-identical / ternary / no-entry forms fall
    // back to the base sprite and stay name-only)
    if (formManifest.classify(f).own) form.sprite = f;
    // the form's own evolution branches — the runtime rewrite is keyed by
    // the species value held, so a form runs through it with its own value
    const fevo = exEvoPair(f, entry.value, true);
    if (fevo) form.evo = fevo;
    return form;
  };

  const formsOf = (exId, profileId) => {
    const p = profile('ex', profileId);
    const fromProfile = p && p.species.length > 1;
    const baseName = exDisplayNames.get(exId);
    for (const f of formRosterOf(exId, profileId)) {
      const art = formManifest.classify(f);
      if (!art.own) continue;
      referencedOwn.add(f);
      if (!existsSync(path.join(spriteDir, `${f}.png`))) missingFormArt.push(f);
    }
    const forms = formRosterOf(exId, profileId).map((f) => formObjectOf(f, exId, baseName, fromProfile));
    return forms.length > 0 ? forms : null;
  };

  // ----- join vanilla <-> EX and build records ------------------------------------
  const exByDexNum = new Map();
  for (const entry of exEntries.values()) {
    if (!exByDexNum.has(entry.dexNum)) exByDexNum.set(entry.dexNum, []);
    exByDexNum.get(entry.dexNum).push(entry.id);
  }

  const buildRecord = (vanId, exId) => {
    const ex = exEntries.get(exId);
    const exBaseId = ex.baseId;
    const id = vanId ?? exId;

    if (vanId) {
      const vanDex = vanDexNum.get(vanId);
      if (vanDex !== ex.dexNum) fail(`${vanId}: vanilla dex ${vanDex} != EX dex ${ex.dexNum}`);
    }

    const rec = {};
    rec.id = id;
    rec.name = exDisplayNames.get(exId);
    rec.versions = vanId ? ['vanilla', 'ex'] : ['ex'];
    rec.region = regionFor(ex.dexNum);
    rec.dexNum = ex.dexNum;
    rec.category = ex.category;
    rec.types = ex.types;
    rec.stats = statsOf(ex.stats);
    rec.abilities = ex.abilities;
    rec.catchRate = ex.catchRate;
    rec.height = ex.height;
    rec.weight = ex.weight;
    rec.gender = ex.gender;
    rec.eggGroups = ex.eggGroups;
    rec.baseExp = ex.baseExp;
    rec.description = ex.description;

    const evo = exEvoPair(exId, ex.value, false);
    if (evo) rec.evo = evo;

    const movesProfileId = profile('ex', exId) ? exId : exBaseId;
    const moves = buildMoves(movesProfileId, 'ex');
    if (moves) rec.moves = moves;
    const exProfileFile = profile('ex', movesProfileId)?.file ?? null;

    const forms = formsOf(exId, movesProfileId);
    if (forms) rec.forms = forms;

    rec.dexVariants = variantMembership(exId, exVariants, exSpecies.idByValue, exBaseId);

    if (exRides.has(exId)) rec.ride = exRides.get(exId);
    if (exLegendary.has(exId)) rec.notes = ['Spawns only as a legendary encounter'];

    // sprite markers: asset id is the record's own id, or the base id for forms
    let assetId;
    if (spriteBase.has(id)) assetId = id;
    else if (spriteBase.has(exBaseId)) assetId = exBaseId;
    else fail(`${id}: no sprite asset for ${id} or base ${exBaseId}`);
    if (assetId !== id) rec.sprite = assetId;
    if (spriteEx.has(assetId)) rec.spriteEx = true;

    // vanilla overlay (shared records): only the differing fields
    if (vanId) {
      const van = vanBaseStats.get(vanId) ?? fail(`no vanilla base stats for ${vanId}`);
      const vDex = vanDexEntries.get(vanId) ?? fail(`no vanilla pokedex entry for ${vanId}`);
      const vanValues = {
        name: vanDisplayNames.get(vanId),
        category: vDex.category,
        types: van.types,
        stats: statsOf(van.stats),
        abilities: van.abilities,
        catchRate: van.catchRate,
        height: formatHeight(vDex.height),
        weight: formatWeight(vDex.weight),
        gender: van.gender,
        eggGroups: [...new Set(van.eggGroups)],
        baseExp: van.baseExp,
        description: resolveText(vanPp, vDex.description, vanNamedTexts, `vanilla pokedex_text [${vanId}]`, 'description'),
        evo: vanEvoPair(vanId),
        moves: buildMoves(vanId, 'vanilla'),
        ride: vanRides.get(vanId) ?? null,
        notes: vanLegendary.has(vanId) ? ['Spawns only as a legendary encounter'] : null,
        dexVariants: variantMembership(vanId, vanVariants, vanSpecies.idByValue, vanId),
        forms: [],
      };
      const exValues = {
        name: rec.name, category: rec.category, types: rec.types, stats: rec.stats,
        abilities: rec.abilities, catchRate: rec.catchRate, height: rec.height, weight: rec.weight,
        gender: rec.gender, eggGroups: rec.eggGroups, baseExp: rec.baseExp, description: rec.description,
        evo: rec.evo ?? null, moves: rec.moves ?? null, ride: rec.ride ?? null,
        notes: rec.notes ?? null, dexVariants: rec.dexVariants, forms: rec.forms ?? null,
      };
      const overlay = {};
      for (const [k, vv] of Object.entries(vanValues)) {
        if (JSON.stringify(vv) !== JSON.stringify(exValues[k])) overlay[k] = vv;
      }
      if (Object.keys(overlay).length > 0) rec.vanilla = overlay;
    }

    // source citations: the files actually read for this record
    const cites = [];
    const push = (c) => { if (!cites.includes(c)) cites.push(c); };
    if (vanId) {
      push('src/data/pokemon/base_stats.h @vanilla');
      push('src/data/pokemon/pokedex_entries.h @vanilla');
      push('src/data/pokemon/pokedex_text.h @vanilla');
      if (rec.vanilla?.evo !== undefined) {
        push('src/data/pokemon/evolution.h @vanilla');
        push('src/rogue_baked.c @vanilla'); // the runtime rewrite the display shows
      }
      if (rec.vanilla?.name !== undefined) push('src/data/text/species_names.h @vanilla');
      if (rec.vanilla?.moves !== undefined) push(`src/data/rogue/pokemon/vanilla/${vanId}/vanilla_profile.json @vanilla`);
      if (rec.vanilla?.dexVariants !== undefined) push('src/data/rogue_pokedex.h @vanilla');
      if (rec.vanilla?.ride !== undefined) push('src/data/rogue_ridemon_infos.h @vanilla');
      if (rec.vanilla?.notes !== undefined) push('src/data/rogue_routes.h @vanilla');
    }
    push(`${ex.file} @origin/expansion`);
    if (rec.evo) push('src/rogue_baked.c @origin/expansion'); // the runtime rewrite the display shows
    if (ex.namedTextFields.length > 0) push('src/data/pokemon/species_info.h @origin/expansion');
    if (rec.forms) {
      push('src/data/pokemon/form_species_tables.h @origin/expansion');
      // the per-form data comes from each form's own species_info entry,
      // and an own-art form's sprite source (the palette file too, when it
      // lives outside the form's front directory)
      for (const f of formRosterOf(exId, movesProfileId)) {
        const fe = exEntries.get(f) ?? exNoDexMap.get(f);
        if (fe) push(`${fe.file} @origin/expansion`);
        if (fe && exEvoPair(f, fe.value, true)) push('src/rogue_baked.c @origin/expansion');
        const art = formManifest.classify(f);
        if (art.own) {
          push(`${art.frontPath} @origin/expansion`);
          if (path.dirname(art.palPath) !== path.dirname(art.frontPath)) push(`${art.palPath} @origin/expansion`);
        }
      }
    }
    if (exProfileFile) push(`${exProfileFile} @origin/expansion`);
    // sprite source: the committed <id>.png is vanilla-preferred (the
    // vanilla working tree's front.png) with the EX front file as the
    // EX-only fallback; a divergent composite ships <id>-ex.png from the
    // EX file, so cite both when present.
    const vanSpriteFile = path.join(repo, 'graphics/pokemon', assetId, 'front.png');
    if (existsSync(vanSpriteFile)) {
      push(`graphics/pokemon/${assetId}/front.png @vanilla`);
      if (spriteEx.has(assetId)) {
        const exFile = exSpriteSource(assetId) ?? fail(`${assetId}: divergent EX sprite but no EX source file`);
        push(`${exFile} @origin/expansion`);
      }
    } else {
      const exFile = exSpriteSource(assetId) ?? fail(`${assetId}: no sprite source (vanilla or EX)`);
      push(`${exFile} @origin/expansion`);
    }
    push('src/data/rogue_pokedex.h @origin/expansion');
    if (rec.ride) push('src/data/rogue_ridemon_infos.h @origin/expansion');
    if (rec.notes) push('src/data/rogue_routes.h @origin/expansion');
    if (rec.moves?.tm) push('src/data/party_menu.h @origin/expansion');
    rec.source = cites.join('; ');

    return rec;
  };

  // join: one vanilla species per national dex number (1..386); the legacy
  // Unown letters have no EX counterpart at their dex numbers
  const usedEx = new Set();
  const records = [];
  let sharedCount = 0;
  let vanillaOnly = 0;
  for (const [vanValue, vanId] of vanSpecies.byValue) {
    const vanDex = vanDexNum.get(vanId);
    if (typeof vanDex !== 'number') continue;
    // legacy Unown letters: a NATIONAL_DEX enum slot and base stats, but no
    // pokedex entry in Vanilla (and no EX counterpart) — not records
    if (!vanDexEntries.has(vanId)) {
      vanillaOnly++;
      continue;
    }
    const candidates = (exByDexNum.get(vanDex) ?? []).filter((cid) => !usedEx.has(cid));
    let exId;
    if (candidates.includes(vanId)) exId = vanId;
    else if (candidates.length > 0) {
      // prefer the family base (a candidate whose own base is itself and which
      // is the base of the other candidates)
      const bases = candidates.filter((cid) => {
        const e = exEntries.get(cid);
        return e.baseId === cid && candidates.every((o) => o === cid || exEntries.get(o).baseId === cid);
      });
      exId = bases.length === 1 ? bases[0] : candidates[0];
    }
    if (!exId) {
      vanillaOnly++;
      continue;
    }
    usedEx.add(exId);
    sharedCount++;
    records.push(buildRecord(vanId, exId));
  }
  for (const exId of exEntries.keys()) {
    if (usedEx.has(exId)) continue;
    records.push(buildRecord(null, exId));
  }

  records.sort((a, b) => (a.dexNum - b.dexNum) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (missingFormArt.length) {
    fail(`form sprites missing from ${path.relative(PROJECT_ROOT, spriteDir)} — run 'npm run extract:sprites' first: ${missingFormArt.slice(0, 10).join(', ')}${missingFormArt.length > 10 ? ` (+${missingFormArt.length - 10} more)` : ''}`);
  }
  console.error(`note: form sprites — ${referencedOwn.size} of ${formManifest.counts.own} own entries are roster-referenced; all ${referencedOwn.size} ship <formEntryId>.png (verified on disk)`);

  return { records, counts: { total: records.length, shared: sharedCount, exOnly: records.length - sharedCount, vanillaOnly, exEntries: exEntryCount, noDex: exNoDexMap.size, synthesized: exSynthesized.length } };
}

// ---------------------------------------------------------------------------
// Document envelope (meta + prose)
// ---------------------------------------------------------------------------

function buildDoc({ records, counts }) {
  const spriteExCount = records.filter((r) => r.spriteEx).length;
  const formSpriteCount = records.flatMap((r) => r.forms ?? []).filter((f) => f && f.sprite).length;
  return {
    meta: {
      id: 'pokedex',
      title: 'Pokédex',
      description: 'Every species in both builds — stats, types, evolutions, learnsets, dex-variant membership and Pokédex text — with the Vanilla build\'s differing values alongside the Expansion defaults.',
      lazy: true,
    },
    prose: [
      {
        id: 'the-dex',
        heading: 'The dex',
        text: `This file holds ${counts.total} species records — one per numbered species in the Expansion national dex (#1–#1025).`,
        list: [
          `${counts.total} records = ${counts.shared} shared + ${counts.exOnly} EX-only`,
          `${counts.exEntries} [SPECIES_X] initializers; the ${counts.noDex} dex-less forms ride in their base's forms list`,
          `${counts.synthesized} form groups get a synthesized base record`,
          `${counts.vanillaOnly} legacy Unown letters are not records`,
          '7 dex variants in Vanilla / 37 in EX — the same 13 families, split per generation in EX',
          'variant membership = the game\'s RoguePokedex_IsSpeciesAllowed rule',
        ],
        source: 'src/rogue_pokedex.c @vanilla; src/rogue_pokedex.c @origin/expansion; src/data/rogue_pokedex.h @vanilla; src/data/rogue_pokedex.h @origin/expansion; include/constants/rogue_pokedex.h @vanilla; include/constants/rogue_pokedex.h @origin/expansion',
      },
      {
        id: 'reading-entries',
        heading: 'Reading an entry',
        text: 'Top-level fields carry the Expansion (EX) values. The vanilla overlay holds only the fields that differ between the builds — an absent field means the two builds agree.',
        list: [
          'forms are EX-only — the Vanilla overlay mirrors them as an empty list',
          'height/weight pre-formatted for display (dm/hg ÷ 10)',
          'description is null when a build has no Pokédex text (one case: Minior)',
          'evo.evos = the branches the in-game Pokédex shows (the raw table rewritten by Rogue_ModifyEvolution — friendship evos become level 30, trades become Link Cable items, and per-species overrides rewrite the rest); evo.prev = the lowest-dex-number record whose evo.evos target this species',
          'X_MISC_INFO family stat blocks are expanded — values shown are final',
        ],
        source: 'src/rogue_pokedex.c @vanilla; src/rogue_pokedex.c @origin/expansion; src/rogue_baked.c @vanilla; src/rogue_baked.c @origin/expansion; src/data/pokemon/species_info.h @origin/expansion; src/data/pokemon/base_stats.h @vanilla',
      },
      {
        id: 'moves',
        heading: 'Moves',
        text: `moves comes from each species' baked-in learnset profile — the JSON the game bakes into the Pokédex.`,
        list: [
          'levelUp = [move, level] — level 0 = learned on evolving',
          "tm = the build's TM table (50) ∩ the species' levelUp/tutor moves",
          "forms share the base species' profile — the game resolves the base form first",
          'the base profile, not the trainer-revised one',
        ],
        source: 'src/pokemon.c @vanilla; src/pokemon.c @origin/expansion; src/data/party_menu.h @vanilla; src/data/party_menu.h @origin/expansion',
      },
      {
        id: 'sprite-provenance',
        heading: 'Sprites',
        text: 'Species art is committed under site/assets/pokemon/.',
        list: [
          'a record\'s art is <id>.png (128×128 RGBA)',
          `spriteEx — ${spriteExCount} species also ship <id>-ex.png, used under Expansion`,
          `structured forms that own their art carry form.sprite = <formEntryId> — their art ships as <formEntryId>.png (${formSpriteCount} forms), through the same composite pipeline`,
          'palette-swap forms composite the base bitmap with the form palette (Arceus plates, Silvally, Genesect, Alcremie, Minior, …)',
          'base-identical forms and the one ternary-macro form (Silvally (Fairy)) use the base art',
          'the custom forms without their own art fall back to the base sprite',
          'produced by the dev-only sprite extractor from each build\'s front art',
        ],
        source: 'scripts/extract/sprites.mjs (site data); site/assets/pokemon/ (site data)',
      },
    ],
    records,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.resolve(args.repo);
  assertRepoSane(repo);
  const { records, counts } = extract(repo);
  const doc = buildDoc({ records, counts });
  const rendered = JSON.stringify(doc, null, 2) + '\n';
  const outPath = path.resolve(args.out);
  if (args.check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    if (current === rendered) {
      console.log(`OK ${args.out} is up to date (${counts.total} records: ${counts.shared} shared, ${counts.exOnly} EX-only)`);
      return;
    }
    console.error(`ERROR: ${args.out} is out of date${current === null ? ' (missing)' : ''} — run: npm run extract:pokedex`);
    process.exit(1);
  }
  writeFileSync(outPath, rendered);
  console.log(`Wrote ${args.out}: ${counts.total} records (${counts.shared} shared, ${counts.exOnly} EX-only, ${counts.vanillaOnly} vanilla-only excluded)`);
}

main();

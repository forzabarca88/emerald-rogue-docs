// Shared miniature C preprocessor for the zero-dep extractors.
//
// Moved out of pokedex.mjs so sprites.mjs can run the SAME
// expression semantics (define/enum resolution, #if guards) when it
// parses the raw EVOLUTION tuples for the evolution-reference
// roster. No behaviour change: the class body, tokenizeExpression
// and collectEnums are byte-identical to the originals.

import path from "node:path";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// Command-line build defines (Makefile CPPFLAGS for the default
// release build), applied before any header is read.
export const seedDefines = (seeds) => {
  const map = new Map();
  for (const [name, value] of seeds) map.set(name, { params: null, body: String(value) });
  return map;
};

/**
 * Generic constant resolution shared by the extractors: enums first, then
 * object-like macros (the game expresses most constant tables as #defines).
 */
export function resolveConst(pp, name, where) {
  if (pp.enums.has(name)) return pp.enums.get(name);
  const def = pp.defines.get(name);
  if (!def) fail(`${where}: unresolved constant ${name}`);
  if (def.params) fail(`${where}: ${name} is a function-like macro`);
  if (def.body.includes('{') || def.body.includes(';')) fail(`${where}: ${name} has a non-constant body`);
  return pp.evalDefine(name, where);
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

export class Preprocessor {
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
export function collectEnums(text, where, enums) {
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

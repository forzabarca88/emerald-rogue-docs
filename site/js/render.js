/*
 * render.js — shared rendering helpers and pure utilities. Loads after
 * nav.js; page scripts build on these.
 *
 * Exposes: ROGUE.esc(s), ROGUE.badgeClass(record), ROGUE.badge(record),
 * ROGUE.paragraphs(text), ROGUE.cards(records), ROGUE.table(records, columns),
 * ROGUE.proseSections(prose), ROGUE.section(id, eyebrow, heading, intro, body),
 * ROGUE.chip(text), ROGUE.proseById(data, id), ROGUE.byCategory(records, category),
 * ROGUE.versionLabel(id), ROGUE.resolvePlaceholders(text), ROGUE.effective(record[, keys]),
 * ROGUE.diffNote(record[, text]), ROGUE.citeHtml(source).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  /** The game's quest-text placeholders and their in-game words. */
  var PLACEHOLDERS = { PKMN: 'Pokémon', POKEBLOCK: 'Pokéblock' };

  /** Escape a value for safe insertion into HTML. */
  ROGUE.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** Version badge CSS class for a record: badge--both | badge--ex | badge--vanilla. */
  ROGUE.badgeClass = function (record) {
    var vs = record && Array.isArray(record.versions) ? record.versions : [];
    var hasVanilla = vs.indexOf('vanilla') !== -1;
    var hasEx = vs.indexOf('ex') !== -1;
    if (hasVanilla && hasEx) return 'badge--both';
    if (hasEx) return 'badge--ex';
    if (hasVanilla) return 'badge--vanilla';
    return 'badge--both';
  };

  function siteOrEmpty() {
    try {
      return ROGUE.site();
    } catch (e) {
      return {};
    }
  }

  function badgeHtml(record) {
    var labels = ((siteOrEmpty().versions || {}).labels) || {};
    var vs = record && Array.isArray(record.versions) ? record.versions : [];
    var label;
    if (vs.indexOf('vanilla') !== -1 && vs.indexOf('ex') !== -1) {
      label = labels.both || 'Both';
    } else {
      label = labels[vs[0]] || '';
    }
    return '<span class="badge ' + ROGUE.badgeClass(record) + '">' + ROGUE.esc(label) + '</span>';
  }


  /** Split prose text on blank lines into escaped <p> paragraphs. */
  function paragraphs(text) {
    return String(text === null || text === undefined ? '' : text)
      .split(/\n{2,}/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean)
      .map(function (t) {
        return '<p>' + ROGUE.esc(t) + '</p>';
      })
      .join('');
  }

  /** Prose text → escaped <p> paragraphs (the same rule ROGUE.proseSections uses). */
  ROGUE.paragraphs = function (text) {
    return paragraphs(text);
  };

  /** Version badge markup for a record (the same badge ROGUE.cards() emits). */
  ROGUE.badge = function (record) {
    return badgeHtml(record);
  };

  /** Records → card markup (call ROGUE.filter(records) first for version scoping). */
  ROGUE.cards = function (records) {
    return (Array.isArray(records) ? records : [])
      .map(function (r) {
        var html = '<article class="card">';
        html +=
          '<div class="card__head"><h3 class="card__title">' +
          ROGUE.esc(r.name) +
          '</h3>' + badgeHtml(r) + '</div>';
        if (r.description) html += '<p class="card__desc">' + ROGUE.esc(r.description) + '</p>';
        if (r.source) html += '<p class="card__source">' + ROGUE.citeHtml(r.source) + '</p>';
        return html + '</article>';
      })
      .join('');
  };

  /**
   * Records → table markup.
   * @param {Array} records data records
   * @param {Array<{key: string, label: string}>} columns table columns
   */
  ROGUE.table = function (records, columns) {
    if (!Array.isArray(columns) || columns.length === 0) return '';
    var head =
      '<tr>' +
      columns.map(function (c) {
        return '<th scope="col">' + ROGUE.esc(c.label) + '</th>';
      }).join('') +
      '</tr>';
    var rows = (Array.isArray(records) ? records : [])
      .map(function (r) {
        return (
          '<tr>' +
          columns
            .map(function (c) {
              var v = r ? r[c.key] : '';
              return '<td>' + ROGUE.esc(typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)) + '</td>';
            })
            .join('') +
          '</tr>'
        );
      })
      .join('');
    return '<table class="table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  };

  /** Prose array → stacked <section> markup. */
  ROGUE.proseSections = function (prose) {
    return (Array.isArray(prose) ? prose : [])
      .map(function (p, i) {
        var id = p.id ? ' id="' + ROGUE.esc(p.id) + '"' : '';
        return (
          '<section class="section"' + id + '>' +
          '<div class="section__head"><h2>' + ROGUE.esc(p.heading) + '</h2></div>' +
          '<div class="section__body">' + paragraphs(p.text) + '</div>' +
          '</section>'
        );
      })
      .join('');
  };

  /** Page section: .section with head (eyebrow + heading + optional intro line) and body. */
  ROGUE.section = function (id, eyebrow, heading, intro, body) {
    var html = '<section class="section" id="' + ROGUE.esc(id) + '">';
    html += '<div class="section__head">';
    if (eyebrow) html += '<p class="eyebrow">' + ROGUE.esc(eyebrow) + '</p>';
    html += '<h2>' + ROGUE.esc(heading) + '</h2>';
    if (intro) html += '<p>' + ROGUE.esc(intro) + '</p>';
    html += '</div>';
    html += '<div class="section__body">' + body + '</div></section>';
    return html;
  };

  /** A single .chip tag of escaped text. */
  ROGUE.chip = function (text) {
    return '<span class="chip">' + ROGUE.esc(text) + '</span>';
  };

  /** One entry of a data file's `prose` array by id (null when absent). */
  ROGUE.proseById = function (data, id) {
    var list = data && Array.isArray(data.prose) ? data.prose : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  };

  /** The records of a data file whose `category` matches (unfiltered — apply ROGUE.filter). */
  ROGUE.byCategory = function (records, category) {
    return (Array.isArray(records) ? records : []).filter(function (r) {
      return r && r.category === category;
    });
  };

  /** The site's version label for a version id ("Vanilla"/"EX"), falling back to the id. */
  ROGUE.versionLabel = function (id) {
    var labels = ((siteOrEmpty().versions || {}).labels) || {};
    return labels[id] || id;
  };

  /**
   * A record's `source` citation string → HTML with every cited file (and
   * each of its line ranges) linked to a GitHub permalink at the pinned
   * baseline (data/site.json `citations`: repo URL + per-branch SHAs).
   *
   * Parses with the SAME grammar as scripts/verify/citations.mjs (keep in
   * sync): a citation is a `path @vanilla` / `path @origin/expansion` match;
   * its line refs are all `L<a>[-<b>]` from that match up to the next one;
   * `identical`/`lines` are byte-identity claims (never linked); a
   * bare extension-less token (the `/` of `… / @origin/expansion L…`) is a
   * continuation of the previous citation's file on the other branch; `<…>`
   * is a glob (linked to its parent directory) — and a continuation that
   * inherits a glob links that glob's parent directory on the new branch's
   * SHA instead of a broken literal `<…>` URL. No citation at all (method
   * cites, `(site data)`) or missing config → the whole string escaped
   * plain, so a page can never break on a source field.
   */
  ROGUE.citeHtml = function (source) {
    var text = String(source === null || source === undefined ? '' : source);
    var CITATION_RE = /([A-Za-z0-9_\-./<>]+)\s+@(vanilla|origin\/expansion)/g; // keep in sync with scripts/verify/citations.mjs
    var LINE_REF_RE = /L(\d+)(?:-(\d+))?/g; // keep in sync with scripts/verify/citations.mjs
    var CLAIM_TOKENS = ['identical', 'lines']; // keep in sync with scripts/verify/citations.mjs
    var citations = siteOrEmpty().citations;
    var repo = citations && typeof citations.repo === 'string' ? citations.repo : '';
    var refShas = (citations && citations.ref) || {};
    if (!repo || !refShas.vanilla || !refShas.expansion) return ROGUE.esc(text);

    var shaFor = function (ref) {
      return ref === 'vanilla' ? refShas.vanilla : refShas.expansion;
    };
    // Token classification mirrors classifyToken() in scripts/verify/citations.mjs (order matters: claims first).
    var classifyToken = function (token) {
      if (CLAIM_TOKENS.indexOf(token) !== -1) return 'claim';
      if (token.indexOf('<') !== -1) return 'glob';
      if (token === 'Makefile' || /\.[A-Za-z0-9]+$/.test(token)) return 'path';
      return 'continuation';
    };
    var anchor = function (href, label) {
      return '<a href="' + ROGUE.esc(href) + '" target="_blank" rel="noopener">' + label + '</a>';
    };

    var matches = [];
    var m;
    CITATION_RE.lastIndex = 0;
    while ((m = CITATION_RE.exec(text)) !== null) {
      matches.push({ text: m[0], token: m[1], ref: m[2], start: m.index, end: m.index + m[0].length });
    }
    if (matches.length === 0) return ROGUE.esc(text);

    var html = '';
    var cursor = 0; // end of the region already emitted into `html`
    var lastValid = null; // most recent path/glob token — the file continuations inherit
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      html += ROGUE.esc(text.slice(cursor, match.start));
      // Line refs for this citation: from the end of the match to the next
      // match (annotation L-refs included) — same segment as the verifier.
      var segmentEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
      var segment = text.slice(match.end, segmentEnd);
      var lineRefs = [];
      var lm;
      LINE_REF_RE.lastIndex = 0;
      while ((lm = LINE_REF_RE.exec(segment)) !== null) {
        lineRefs.push({ start: lm.index, end: lm.index + lm[0].length, a: Number(lm[1]), b: lm[2] ? Number(lm[2]) : Number(lm[1]), text: lm[0] });
      }

      var kind = classifyToken(match.token);
      if (kind === 'claim') {
        // Byte-identity claim — plain text, never a link target (the text up
        // to the next citation stays plain too).
        html += ROGUE.esc(match.text + text.slice(match.end, segmentEnd));
        cursor = segmentEnd;
        continue;
      }

      var file = kind === 'continuation' ? lastValid : match.token;
      var sha = shaFor(match.ref);
      if (!file || !sha) {
        // Continuation with nothing to inherit, or unconfigured SHA — plain.
        html += ROGUE.esc(match.text + text.slice(match.end, segmentEnd));
        cursor = segmentEnd;
        continue;
      }
      var baseHref = repo + '/blob/' + sha + '/' + file;

      if (kind === 'glob' || (kind === 'continuation' && file.indexOf('<') !== -1)) {
        // Glob — or a continuation inheriting a glob file: link the parent
        // directory (strip the `<…>` suffix, keep a trailing "/"); the
        // segment carries no line anchors (the verifier skips glob line refs
        // too, so the two parsers stay behaviorally identical).
        var dirPrefix = file.slice(0, file.indexOf('<'));
        if (dirPrefix.indexOf('/') === -1) {
          // No directory to link to — render the citation plain.
          html += ROGUE.esc(match.text);
        } else {
          if (dirPrefix.charAt(dirPrefix.length - 1) !== '/') dirPrefix += '/';
          if (kind === 'continuation') {
            // The bare token stays plain; the "@ref" tail links the inherited
            // glob's parent directory on this branch's SHA.
            var at = match.text.indexOf('@');
            html += ROGUE.esc(match.text.slice(0, at));
            html += anchor(repo + '/blob/' + sha + '/' + dirPrefix, ROGUE.esc('@' + match.ref));
          } else {
            html += anchor(repo + '/blob/' + sha + '/' + dirPrefix, ROGUE.esc(match.text));
          }
        }
        html += ROGUE.esc(segment);
        cursor = segmentEnd;
        if (kind === 'glob') lastValid = match.token;
        continue;
      }

      if (kind === 'continuation') {
        // The bare token (e.g. "/ ") stays plain; the "@ref" tail links the
        // inherited file on the other branch's SHA.
        var at = match.text.indexOf('@');
        html += ROGUE.esc(match.text.slice(0, at));
        html += anchor(baseHref, ROGUE.esc('@' + match.ref));
      } else {
        // Concrete file: the whole "path @ref" match is the file link.
        html += anchor(baseHref, ROGUE.esc(match.text));
        lastValid = match.token;
      }

      // Each line ref in the segment gets its own anchor to that file's line(s).
      var segCursor = 0;
      for (var j = 0; j < lineRefs.length; j++) {
        var lr = lineRefs[j];
        html += ROGUE.esc(segment.slice(segCursor, lr.start));
        html += anchor(baseHref + '#L' + lr.a + (lr.b !== lr.a ? '-L' + lr.b : ''), ROGUE.esc(lr.text));
        segCursor = lr.end;
      }
      html += ROGUE.esc(segment.slice(segCursor));
      cursor = segmentEnd;
    }
    return html;
  };

  /**
   * Replace the game's {PKMN}/{POKEBLOCK} text placeholders with their
   * in-game words ("Pokémon"/"Pokéblock") — the single source of truth
   * for quest text (card rendering and search indexing both go through
   * this). Unknown {…} tokens stay as-is.
   */
  ROGUE.resolvePlaceholders = function (text) {
    return String(text === null || text === undefined ? '' : text).replace(/\{(PKMN|POKEBLOCK)\}/g, function (m, key) {
      return PLACEHOLDERS[key] || m;
    });
  };

  /**
   * A record's fields for the ACTIVE version: a shallow copy of the
   * record's top-level fields (the EX variant) with the active version's
   * structured `differences.<version>` object overrides applied on top.
   * `keys`, when given, is an allow-list: only those field names may be
   * overridden (all other top-level fields are copied either way). Records
   * whose `differences` is a string note (or absent) pass through
   * untouched.
   */
  ROGUE.effective = function (record, keys) {
    var out = {};
    if (record && typeof record === 'object') {
      for (var k in record) {
        if (Object.prototype.hasOwnProperty.call(record, k)) out[k] = record[k];
      }
    }
    var diff = record ? record.differences : null;
    var side = diff && typeof diff === 'object' ? diff[ROGUE.version] : null;
    if (side && typeof side === 'object') {
      Object.keys(side).forEach(function (key) {
        if (side[key] === undefined) return;
        if (Array.isArray(keys) && keys.indexOf(key) === -1) return;
        out[key] = side[key];
      });
    }
    return out;
  };

  /**
   * The "Differs in <other version>" footnote for a record whose data
   * carries per-version `differences`. The note text defaults to the other
   * side's `differences` string; pass a second argument to supply
   * pre-formatted text (e.g. structured per-version fields).
   */
  ROGUE.diffNote = function (record, text) {
    var other = ROGUE.version === 'vanilla' ? 'ex' : 'vanilla';
    if (text === undefined) {
      var diff = record && record.differences;
      if (!diff || typeof diff !== 'object') return '';
      text = typeof diff[other] === 'string' ? diff[other].trim() : '';
    }
    if (!text) return '';
    return (
      '<p class="card__diff"><span class="field-label card__diff-label">' +
      ROGUE.esc('Differs in ' + ROGUE.versionLabel(other)) +
      '</span>' +
      ROGUE.esc(text) +
      '</p>'
    );
  };
})();

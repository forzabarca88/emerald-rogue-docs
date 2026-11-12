/*
 * search-index.js — pure, version-aware site-wide search index + query for
 * the search palette (issue #23). Loads after data.js + render.js (it uses
 * ROGUE.data/ROGUE.site and ROGUE.resolvePlaceholders) and before the page
 * scripts; the overlay UI that consumes this lands later. No DOM access —
 * the whole module is testable in a vm sandbox with the real data/*.json.
 *
 * Exposes:
 *   ROGUE.buildSearchIndex() → Array<Entry>
 *   ROGUE.searchQuery(entries, query, activeVersion) →
 *     { results: Array<Result>, total: number }
 *       results  the ranked list capped at search.maxResults
 *       total    the TOTAL number of matches found, before the cap —
 *                results.length when the cap does not bind; the overlay
 *                uses it to signpost truncation ("30 of 135" vs "30 of 30")
 *
 * Entry shape:
 *   { id, title, titleLower, text, textCase, page, anchor, versions,
 *     foldedText, foldMap, titleFolded, tokens, tokenPos }
 *     id          stable unique key ('page-…' / 'prose-…' / 'rec-…')
 *     title       display title (quest {PKMN}/{POKEBLOCK} placeholders resolved)
 *     titleLower  lowercased title
 *     text        the lowercased search haystack; ALWAYS starts with
 *                 titleLower, so a title match is also a body match
 *     textCase    the SAME haystack with its original casing — a 1:1
 *                 per-code-unit parallel of `text` (sanityCheck asserts
 *                 textCase.toLowerCase() === text), so matchIndex/matchEnd
 *                 (computed against the folded lowercased text) slice it
 *                 identically; the palette slices snippets from it
 *     page        relative page path ('./quests.html' — all links relative)
 *     anchor      the deep-link target: the per-card DOM id
 *                 ('#rec-<file>-<recordId>') for record entries (issue
 *                 #45), the section/block id for prose entries, or ''
 *                 (page top)
 *     section     record entries only — the containing section's anchor,
 *                 the same-page scroll fallback when the card element is
 *                 absent (search.js navigate); absent for prose/page
 *                 entries and for the one cardless record
 *     versions    entry's version availability, e.g. ['vanilla','ex'] —
 *                 used to scope results at QUERY time, not index time
 *     foldedText  `text` NFD-folded (combining marks stripped) — precomputed
 *                 ONCE at build for the query (the fuzzy tier's unit, issue
 *                 #46); matching stays accent-insensitive
 *     foldMap     foldAccents' index map for foldedText — maps a folded
 *                 offset back to the un-folded text (identity for the
 *                 current precomposed data)
 *     titleFolded titleLower NFD-folded (the tier 0/1 exact tests)
 *     tokens      the whole tokens of foldedText (runs of [a-z0-9]),
 *                 first-occurrence order
 *     tokenPos    parallel first-occurrence position of each token in
 *                 foldedText (the fuzzy tier's matchIndex source)
 *
 * Entry sources — one entry each: every data/site.json nav page (title +
 * description, anchor ''), data/site.json's own home-page content — the
 * `hero` block (eyebrow, title, subtitle, the stat value+label pairs)
 * and every `prose` block (heading + text; issue #50) — every `prose`
 * block of the 15 content data files (heading + text + the structured
 * diagram fields), and every record of the 15 content files (name +
 * description + the per-version variant fields + the data-specific chip
 * text the rendering page emits + the structured diagram fields + both
 * string-form `differences` notes). The pokedex file is a LAZY chunk
 * (meta.lazy): pages that don't load dist/data/pokedex.js throw from
 * ROGUE.data('pokedex') and the file is skipped with a warn — the index
 * there simply has no pokedex entries (the pokedex page's palette is the
 * only one that indexes its ~1025 species). Array order: nav pages in site.json
 * nav order, then site.json's hero + prose blocks, then per content file
 * (in CONTENT_FILES order) its prose blocks in data order followed by its
 * records in data order. Prose blocks are anchored at the block's
 * own DOM id when the page renders it via ROGUE.proseSections, else at
 * the containing section's id. Three blocks (hub what-the-hub-is /
 * hub-in-the-loop, safari entry-criteria) are ALSO rendered on the
 * gameplay page — they get one entry per page (duplicate entries on
 * different pages are allowed; duplicate identical entries are not).
 *
 * Version strategy — the index is built ONCE, version-INDEPENDENT:
 *   - Where a record's content differs per build, the haystack is the
 *     UNION of both variants: quest `differences` object sides contribute
 *     every overridable field for BOTH sides (broader than the renderer's
 *     5-key scope — see variantValues below), and the six FAIRY-swap
 *     routes additionally contribute the Vanilla wild types parsed out of
 *     `differences.vanilla` the same way routes.js effectiveTypes() does,
 *     so Vanilla type names are searchable under EX and vice versa.
 *     ROGUE.effective is intentionally NOT called here: it is pinned to
 *     the ACTIVE version, and a version-independent index needs both
 *     sides at build time. variantValues() is the same "top-level +
 *     structured overrides" resolution parameterised by side; the B3
 *     tests lock its parity against ROGUE.effective for both versions.
 *   - The entry's `versions` array (straight from the record) scopes
 *     results at query time, so EX-only quests never surface under
 *     Vanilla.
 *   - Tradeoff: nothing per-version exists that the union can't express —
 *     every per-build difference lives in an explicit field (structured
 *     `differences`, `optionsByVersion`, the routes "Wild types:" note).
 *     The structured diagram fields (see structuredText below) render
 *     identically in both builds — the one per-version structured value
 *     (the Grace `stack.caps` 90/150) is numeric and skipped by the
 *     strings-only rule. The only version-dependent rendered text outside
 *     the union is auto-generated page chrome (e.g. "19 on/off switches
 *     in EX"), which is not record content and is deliberately not
 *     indexed.
 *   - Snippets: because they are union-derived, a shared record can match
 *     on the other build's wording and show it in the snippet; the
 *     destination card (navigated to on Enter) renders the active
 *     version's fields. They are sliced from `textCase` (original
 *     casing) at the matchIndex/matchEnd computed against the folded
 *     lowercased `text` — the two strings are 1:1 aligned per code unit.
 *
 * Deep-link granularity (issue #45): record entries anchor at the
 * per-card DOM id 'rec-<fileId>-<recordId>' — the id every page renderer
 * emits on its record cards (ROGUE.recId in render.js is the single
 * source of the scheme). The id is derived from the record's identity,
 * so it is VERSION-INDEPENDENT: a Vanilla/EX re-render emits the same
 * ids for the same records, and a record that only exists in one build
 * is simply not rendered under the other (its id never appears in the
 * DOM, and query-time version scoping keeps the entry out of the
 * results there). Prose entries keep their section anchors (section-level
 * deep links). The one record with no card of its own — the campaigns
 * trigger (its description is parsed into the config easter-egg phrase
 * table) — keeps the section anchor (#config-campaigns). The card's
 * containing section rides along as the entry's `section` field: search.js
 * uses it as the same-page fallback when the card element is absent (a
 * re-render race, or the card hidden by an on-page filter). Quests used
 * to anchor at their display-group section (a quest whose group differs
 * per build — The Final Run. — at the whole log, #quest-log); the
 * card-level id supersedes that: the card renders in the active
 * version's group under either build and keeps the same id in both.
 *
 * Matching (searchQuery) is accent-INSENSITIVE: query and haystack are
 * NFD-folded (combining marks stripped) before the substring test, so a
 * query for "pokemon" finds "Pokémon". Entry `text` stays plain
 * lowercased (the display casing lives in the 1:1 `textCase` parallel),
 * and folding is per-code-unit with an index map, so `matchIndex`/
 * `matchEnd` always bound a span of the un-folded `text`/`textCase`
 * (identity for the current precomposed data) — the palette slices
 * `textCase` at that span for the original-cased snippet + highlight.
 *
 * Ranking is 4-tier, and every tier keeps the stable index order:
 *   tier 0  the folded title STARTS with the folded query (exact substring)
 *   tier 1  the folded title INCLUDES it (exact substring)
 *   tier 2  the folded body INCLUDES it (exact substring)
 *   tier 3  FUZZY-ONLY (issue #46, typo tolerance): the entry matches the
 *           full query NOWHERE exactly, but one of the query's folded
 *           tokens equals a whole folded text token at Levenshtein
 *           distance 1. Exact tiers are unchanged and ALWAYS rank before
 *           fuzzy-only matches (tier 0 < 1 < 2 < 3); a result carries
 *           `fuzzy: true` on tier 3 and `fuzzy: false` on tiers 0–2.
 *
 * Fuzzy-layer rules (issue #46) — all deterministic, pure JS:
 *   - FOLD FIRST, then distance: both sides are NFD-folded + lowercased
 *     before Levenshtein, so the layer is accent-insensitive ("Pokémonn"
 *     folds to "pokemonn", one deletion from "pokemon").
 *   - TOKEN level: a query token (a run of [a-z0-9] in the folded query)
 *     matches a WHOLE text token at distance exactly 1 — one deletion,
 *     insertion, substitution or transposition. The whole-query substring
 *     always wins: an entry the full query matches exactly never falls
 *     into tier 3, so a typo query surfaces the entries carrying the real
 *     word, ranked after the exact matches of the clean word.
 *   - UNKNOWN-WORD GUARD: a query token only contributes tier-3 matches
 *     when it appears NOWHERE as a whole token in the index. A word the
 *     site actually contains ("mega", "spring", "badge", …) is an exact
 *     word — counting its distance-1 neighbours would flood the results
 *     ("mega" would pull in the "meta" entries, "spring" the "string"
 *     ones, "mega evolution" would match 17 entries instead of the 4
 *     that contain the phrase). Fuzzy is a rescue for misspelled words,
 *     not an augmentation of known ones. The guard is version-independent
 *     (the index is built once, like everything else here); query-time
 *     version scoping still applies to the tier-3 results it produces.
 *   - MULTI-TOKEN QUERIES: a query matches if AT LEAST ONE of its tokens
 *     matches — exact substring on the full query (tiers 0–2) or an
 *     unknown token at distance 1 (tier 3); all tokens are NOT required.
 *     In practice tier 3 fires only when the query carries at least one
 *     unknown token, so a clean multi-token phrase ("mega evolution")
 *     stays exact-only.
 *   - SNIPPET/HIGHLIGHT: a fuzzy match has no contiguous matched
 *     substring. The result's matchIndex/matchEnd point at the FOLDED
 *     best-aligned token occurrence in the text — the candidate token
 *     with the EARLIEST first occurrence in the folded text (all
 *     candidates are at distance exactly 1, so earliest wins) — so the
 *     palette's snippet still centres on it. The `fuzzy` flag tells the
 *     palette NOT to wrap that span in a <mark>: only exact-substring
 *     rows are highlighted (search.js snippet()).
 *   - `total` counts tier-3 matches too; the cap applies to the combined
 *     tier-ordered list.
 *
 * Performance: every entry's foldedText/foldMap/titleFolded/tokens/
 * tokenPos are precomputed ONCE at index build time (makeEntry) — never
 * per query. Per query the work is: fold the query once, one linear pass
 * over all entries' token lists to build the presence set (≈ the index's
 * total token count), ≤ ~1100 candidate-variant lookups per unknown query
 * token, then one candidate scan per entry's token list — linear in the
 * index size, no entries×tokens×tokens blowup (the full index — all 15
 * files incl. the ~1025 pokedex records — is ~1600 entries, and the
 * pokedex page is the only one that ever loads that many).
 *
 * Config: data/site.json `search` block — searchQuery caps the returned
 * list at `search.maxResults` (and reports the pre-cap `total`);
 * placeholder/hint/shortcut/moreResults are read by the overlay UI (B4),
 * not this module. The FALLBACK_MAX_RESULTS constant below is
 * only consulted when the block is missing/invalid (defensive — the
 * config is the source of truth, like version.js's 'ex' fallback).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  var VERSION_IDS = ['vanilla', 'ex'];
  var BOTH_VERSIONS = ['vanilla', 'ex'];

  /** The 15 content data files (every data/*.json except site.json). */
  var CONTENT_FILES = [
    'adventure',
    'campaigns',
    'charms',
    'followmons',
    'game-modes',
    'gameshow',
    'hub',
    'pokedex',
    'quests',
    'routes',
    'safari',
    'settings',
    'timeofday',
    'unique-mons',
    'versions'
  ];

  /** Only used when data/site.json lacks a valid `search.maxResults`. */
  var FALLBACK_MAX_RESULTS = 30;

  /* ------------------------------------------------------------------ *
   * Small value guards — ROGUE.effective returns fields RAW (absent
   * fields are absent; requirements/rewards may be absent, description/
   * trigger can be absent, flags/rewards are arrays).
   * ------------------------------------------------------------------ */

  /** null/undefined-safe string. */
  function str(x) {
    return x === null || x === undefined ? '' : String(x);
  }

  /** null/undefined-safe single-value array. */
  function arr(x) {
    if (Array.isArray(x)) return x;
    if (x === null || x === undefined) return [];
    return [x];
  }

  /** A field value (string | array of strings | missing) → string parts. */
  function toParts(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      var out = [];
      for (var i = 0; i < value.length; i++) out = out.concat(toParts(value[i]));
      return out;
    }
    var s = String(value);
    return s === '' ? [] : [s];
  }

  /* ------------------------------------------------------------------ *
   * Per-version variants
   * ------------------------------------------------------------------ */

  /**
   * The union of BOTH per-version variants of one record field: the
   * top-level (EX base) value plus the value held in each side of a
   * structured `differences` object (object sides only — string-side
   * notes are handled by stringDiffNotes). Records whose `differences`
   * sides are plain strings (charms, routes, hub, …) yield the
   * top-level value only. This is ROGUE.effective's "top-level +
   * structured overrides" resolution for an explicit side instead of the
   * active version — the index is built once, version-independent.
   */
  function variantValues(record, key) {
    var parts = toParts(record ? record[key] : undefined);
    var diff = record && record.differences;
    if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
      for (var i = 0; i < VERSION_IDS.length; i++) {
        var side = diff[VERSION_IDS[i]];
        if (side && typeof side === 'object' && !Array.isArray(side) && side[key] !== undefined) {
          parts = parts.concat(toParts(side[key]));
        }
      }
    }
    return parts;
  }

  /** Both string-form `differences` notes (the "Differs in …" card text). */
  function stringDiffNotes(record) {
    var out = [];
    var diff = record && record.differences;
    if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
      for (var i = 0; i < VERSION_IDS.length; i++) {
        var side = diff[VERSION_IDS[i]];
        if (typeof side === 'string') out.push(side);
      }
    }
    return out;
  }

  /**
   * The FAIRY-swap routes' Vanilla wild types, parsed out of the
   * `differences.vanilla` STRING note ("Wild types: A, B, C.") with the
   * SAME rule as routes.js effectiveTypes() (3 types or none).
   */
  function vanillaWildTypes(record) {
    var diff = record && record.differences;
    if (diff && typeof diff === 'object' && typeof diff.vanilla === 'string') {
      var m = diff.vanilla.match(/Wild types:\s*([^.;]+)/i);
      if (m) {
        var types = m[1]
          .split(',')
          .map(function (t) {
            return t.trim();
          })
          .filter(Boolean);
        if (types.length === 3) return types;
      }
    }
    return [];
  }

  /* ------------------------------------------------------------------ *
   * Structured diagram fields (issue #31) — the CLOSED allow-list of
   * structured fields whose strings the pages render as visible
   * captions/diagram text (the #31 batch trimmed the prose they
   * replaced), so the palette indexes them like that prose. Everything
   * else on a record is deliberately NOT walked: ids, versions, source
   * citations and bare numbers/booleans (weights, odds, stage indexes)
   * are data, not user text — where a number IS the visible label it
   * arrives inside a string (the placement bar's "odd badge" condition,
   * the routes "−20"/"65%" cells). Version-neutral: each field renders
   * identically in both builds (the Grace per-version `stack.caps` are
   * numbers — skipped).
   *
   * Prose-block fields (PROSE_STRUCTURED):
   *   ladder    settings difficulty-scale — tier labels + weather caption
   *   steps     game-modes rule-application — the numbered rule steps
   *   cycles    hub time-weather-season — the day/season phase names
   *   roll      routes calm-average-tough — the phase labels
   *   values    routes calm-average-tough — row labels + the per-sub-type
   *             cells (string cells: "5", "−20", "65%", "—"…)
   *   terrains  routes type-taxonomy — the terrain names
   *   list      prose fact lists — plain string items (the charms
   *             where-they-come-from sources; the pokedex four-block
   *             rewrite, issue #84 — the pokedex page renders them as
   *             .dex-facts lists; the contract .chip is nowrap)
   * Record fields (RECORD_STRUCTURED — the safari `legends-cave` record's
   * `steps` is already indexed by the safari extractor, so `steps` is
   * prose-only here):
   *   short     safari entry-criterion — the one-line flow essence
   *   score     safari priority-eviction — term labels, result, note
   *   eviction  safari priority-eviction — the numbered steps
   *   placement adventure room-type — condition note + bar labels/conds
   *   stack     charms — the unit (per/cap/caps are numbers)
   * ------------------------------------------------------------------ */

  /** Prose-block allow-list, in the order the parts are folded in. */
  var PROSE_STRUCTURED = ['ladder', 'steps', 'cycles', 'roll', 'values', 'terrains', 'list'];

  /** Record allow-list, in the order the parts are folded in. */
  var RECORD_STRUCTURED = ['short', 'score', 'eviction', 'placement', 'stack'];

  /**
   * The user-visible string parts of ONE allow-listed structured field
   * (shape per the comment above). Strings only — bare numbers/booleans
   * are data values and stay out of the haystack.
   */
  function structuredFieldParts(field, value) {
    if (value === null || value === undefined) return [];
    if (field === 'ladder') {
      if (typeof value !== 'object' || Array.isArray(value)) return [];
      var parts = [];
      if (Array.isArray(value.tiers)) {
        for (var t = 0; t < value.tiers.length; t++) {
          var tier = value.tiers[t];
          if (tier && typeof tier === 'object') parts = parts.concat(toParts(tier.label));
        }
      }
      return parts.concat(toParts(value.weather));
    }
    if (field === 'cycles') {
      if (typeof value !== 'object' || Array.isArray(value)) return [];
      var parts2 = toParts(value.day);
      if (value.season && typeof value.season === 'object') parts2 = parts2.concat(toParts(value.season.phases));
      return parts2;
    }
    if (field === 'roll') {
      if (!Array.isArray(value)) return [];
      var parts3 = [];
      for (var r = 0; r < value.length; r++) {
        var phase = value[r];
        if (phase && typeof phase === 'object') parts3 = parts3.concat(toParts(phase.phase));
      }
      return parts3;
    }
    if (field === 'values') {
      if (!Array.isArray(value)) return [];
      var parts4 = [];
      for (var v = 0; v < value.length; v++) {
        var row = value[v];
        if (row && typeof row === 'object') {
          parts4 = parts4.concat(toParts(row.label), toParts(row.calm), toParts(row.average), toParts(row.tough));
        }
      }
      return parts4;
    }
    if (field === 'score') {
      if (typeof value !== 'object' || Array.isArray(value)) return [];
      var parts5 = [];
      if (Array.isArray(value.terms)) {
        for (var s = 0; s < value.terms.length; s++) {
          var term = value.terms[s];
          if (term && typeof term === 'object') parts5 = parts5.concat(toParts(term.label));
        }
      }
      return parts5.concat(toParts(value.result), toParts(value.note));
    }
    if (field === 'placement') {
      if (typeof value !== 'object' || Array.isArray(value)) return [];
      var parts6 = [];
      var bars = Array.isArray(value.bars) ? value.bars : [];
      for (var b = 0; b < bars.length; b++) {
        var bar = bars[b];
        if (bar && typeof bar === 'object') parts6 = parts6.concat(toParts(bar.t), toParts(bar.l));
      }
      return parts6.concat(toParts(value.note));
    }
    if (field === 'stack') {
      return typeof value === 'object' && !Array.isArray(value) ? toParts(value.unit) : [];
    }
    // 'steps', 'terrains', 'list', 'short', 'eviction' — plain string (array) fields
    return toParts(value);
  }

  /**
   * Every allow-listed structured field of one prose block / record, in
   * the list's order (absent fields skipped) — the user-visible diagram
   * text folded into the haystack (see the allow-list comment above).
   */
  function structuredText(holder, fields) {
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return [];
    var parts = [];
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (holder[field] !== undefined) parts = parts.concat(structuredFieldParts(field, holder[field]));
    }
    return parts;
  }

  /* ------------------------------------------------------------------ *
   * Prose + record → page/anchor mapping (derived from site/js/pages/*)
   * ------------------------------------------------------------------ */

  /**
   * Prose block targets. `anchor` = one section for every block; `map`
   * = per-block overrides; `self` = the block keeps its own DOM id (the
   * page renders it via ROGUE.proseSections). Unmapped blocks fall back
   * to '' (page top) — every current data block is mapped.
   */
  var PROSE_TARGETS = {
    adventure: {
      page: './gameplay.html',
      map: { 'how-the-path-works': '#gp-run', 'boss-ladder': '#gp-boss', 'reading-the-rooms': '#gp-rooms' }
    },
    campaigns: { page: './mechanics.html', anchor: '#mech-campaigns' },
    charms: { page: './mechanics.html', anchor: '#mech-charms' },
    followmons: { page: './mechanics.html', anchor: '#mech-followmons' },
    'game-modes': { page: './config.html', anchor: '#config-modes' },
    gameshow: { page: './mechanics.html', anchor: '#mech-gameshow' },
    hub: {
      page: './hub.html',
      self: true,
      map: { 'wander-mons': '#hub-wander', 'time-weather-season': '#hub-time', 'hub-in-the-loop': '#hub-loop' }
    },
    quests: { page: './quests.html', self: true, map: { 'display-groups': '#quest-log' } },
    // the pokedex page renders its four prose blocks via the page-local
    // proseBlockHtml (pages/pokedex.js) — each block keeps its own DOM id
    // (the-dex, reading-entries, moves, sprite-provenance)
    pokedex: { page: './pokedex.html', self: true },
    routes: {
      page: './routes.html',
      map: {
        'naming-scheme': '#routes-naming',
        'type-taxonomy': '#routes-types',
        'calm-average-tough': '#routes-subtypes',
        'on-the-path': '#routes-path'
      }
    },
    safari: {
      page: './safari.html',
      map: {
        'where-it-fits': '#safari-intro',
        'the-pool': '#safari-pool',
        'entry-criteria': '#safari-entry',
        'priority-eviction': '#safari-priority',
        'legends-cave': '#safari-legends'
      }
    },
    settings: { page: './config.html', self: true },
    timeofday: { page: './mechanics.html', anchor: '#mech-timeofday' },
    'unique-mons': { page: './mechanics.html', anchor: '#mech-uniquemons' },
    versions: { page: './versions.html', self: true }
  };

  /**
   * Prose blocks ALSO rendered (via ROGUE.proseById) on a second page —
   * each gets one extra entry so the deep link works from that page.
   */
  var PROSE_CROSS_PAGES = {
    hub: [
      { id: 'what-the-hub-is', page: './gameplay.html', anchor: '#gp-hub' },
      { id: 'hub-in-the-loop', page: './gameplay.html', anchor: '#gp-return' }
    ],
    safari: [{ id: 'entry-criteria', page: './gameplay.html', anchor: '#gp-post-run' }]
  };

  /** The safari record id → its section id (entry-criterion and
   * run-start-ribbon → the entry section, where their cards render). */
  var SAFARI_ANCHORS = {
    'pool-slot-layout': '#safari-pool',
    'priority-eviction': '#safari-priority',
    'legends-cave': '#safari-legends',
    'pool-sign': '#safari-sign',
    'run-start-ribbon': '#safari-entry'
  };

  /**
   * The page + deep-link anchor a record's card renders into.
   * `anchor` is the per-card DOM id (ROGUE.recId — issue #45), stable
   * across Vanilla/EX re-renders; `section` is the containing section's
   * anchor (the same-page scroll fallback when the card element is
   * absent — search.js). The one cardless record (the campaigns trigger)
   * anchors at its section instead.
   */
  function recordTarget(fileId, record) {
    var card = record.id ? '#' + ROGUE.recId(fileId, record.id) : '';
    switch (fileId) {
      case 'adventure':
        return { page: './gameplay.html', anchor: card, section: record.category === 'boss' ? '#gp-boss' : '#gp-rooms' };
      case 'campaigns':
        // config.js owns the trigger record (the easter-egg phrase table
        // is parsed out of its description) — it has no card of its own,
        // so the section owns the deep link; the modes render as cards
        // on mechanics.
        if (record.id === 'campaign-trigger') return { page: './config.html', anchor: '#config-campaigns' };
        return { page: './mechanics.html', anchor: card, section: '#mech-campaigns' };
      case 'charms':
        return { page: './mechanics.html', anchor: card, section: '#mech-charms' };
      case 'followmons':
        return { page: './mechanics.html', anchor: card, section: '#mech-followmons' };
      case 'game-modes':
        return { page: './config.html', anchor: card, section: '#config-modes' };
      case 'gameshow':
        return { page: './mechanics.html', anchor: card, section: '#mech-gameshow' };
      case 'hub':
        if (record.category === 'hub-area') return { page: './hub.html', anchor: card, section: '#hub-areas' };
        if (record.category === 'hub-upgrade') return { page: './hub.html', anchor: card, section: '#hub-upgrades' };
        if (record.category === 'home-decor') return { page: './hub.html', anchor: card, section: '#hub-decor' };
        return { page: './hub.html', anchor: card };
      case 'quests':
        // the card id is version-independent: The Final Run. moves between
        // its per-build display groups, but the card keeps the same id in
        // both (and is absent from the DOM under a build it doesn't exist in)
        return { page: './quests.html', anchor: card, section: '#quest-log' };
      case 'pokedex':
        // the species detail panel's root carries the per-card id while a
        // selection is open; the containing overview section is the
        // same-page fallback when no selection is rendered
        return { page: './pokedex.html', anchor: card, section: '#dex-overview' };
      case 'routes':
        return { page: './routes.html', anchor: card, section: '#routes-table' };
      case 'safari':
        return { page: './safari.html', anchor: card, section: SAFARI_ANCHORS[record.id] || (record.category === 'entry-criterion' ? '#safari-entry' : '') };
      case 'settings':
        if (record.category === 'preset') return { page: './config.html', anchor: card, section: '#config-difficulty' };
        if (record.category === 'toggle') return { page: './config.html', anchor: card, section: '#config-toggles' };
        if (record.category === 'range') return { page: './config.html', anchor: card, section: '#config-ranges' };
        return { page: './config.html', anchor: card };
      case 'timeofday':
        return { page: './mechanics.html', anchor: card, section: '#mech-timeofday' };
      case 'unique-mons':
        return { page: './mechanics.html', anchor: card, section: '#mech-uniquemons' };
      case 'versions':
        return { page: './versions.html', anchor: card, section: '#version-diffs' };
      default:
        return { page: '', anchor: '' };
    }
  }

  /* ------------------------------------------------------------------ *
   * Record haystack extras — the data-specific chip/field text each
   * rendering page emits (name + description + both string diff notes
   * are added centrally by recordParts).
   * ------------------------------------------------------------------ */

  function descriptionParts(record) {
    return variantValues(record, 'description');
  }

  var RECORD_EXTRACTORS = {
    adventure: descriptionParts,
    campaigns: descriptionParts,
    charms: descriptionParts,
    followmons: descriptionParts,
    gameshow: descriptionParts,
    timeofday: descriptionParts,
    'unique-mons': descriptionParts,

    'game-modes': function (r) {
      var parts = descriptionParts(r);
      for (var i = 0; i < arr(r.rules).length; i++) {
        var rule = r.rules[i];
        if (rule && typeof rule === 'object') parts = parts.concat(toParts(rule.label), toParts(rule.detail));
      }
      return parts;
    },

    hub: function (r) {
      var parts = descriptionParts(r);
      if (r.category === 'hub-area') {
        // the area card's cost chip, same rule as hub.js areaCard()
        parts.push(
          r.initiallyPresent
            ? 'Present from the start'
            : typeof r.buildCost === 'number' && r.buildCost > 0
              ? r.buildCost + ' Build Parts'
              : 'Free to build'
        );
        parts = parts.concat(toParts(r.code));
      } else if (r.category === 'hub-upgrade') {
        parts = parts.concat(toParts(r.area));
        // divergent upgrades drop the cost chip and wear "differs by version"
        var diff = r.differences;
        if (!diff && typeof r.cost === 'number' && r.cost > 0) parts.push(r.cost + ' Build Parts');
        parts = parts.concat(toParts(r.code), toParts(r.requirements));
      }
      return parts;
    },

    // the pokedex record's haystack — the SAME field union pokedex.js's
    // on-page filter uses (ROGUE.pokedexSearchText below wraps this via
    // recordParts): name (added centrally), dex number, category, region,
    // description and ALL MOVE NAMES across BOTH per-version variants
    // (top level = EX, plus the vanilla overlay's differing fields), the
    // FORM DISPLAY NAMES (issue #85's structured form objects contribute
    // names only — their per-form types/stats/abilities/descriptions stay
    // out of the haystack), the dex-variant names ("all" keeps the
    // shorthand word), the ride moves and the notes. Strings only — the
    // bare stat numbers, the catch rate and the EXP are data, not user
    // text (the module's rule).
    pokedex: pokedexParts,

    quests: function (r) {
      // name is added centrally; everything else is the UNION of both
      // per-version variants (broader than the renderer's 5-key scope).
      var parts = variantValues(r, 'description');
      parts = parts.concat(toParts(r.flags));
      parts = parts.concat(variantValues(r, 'trigger'));
      parts = parts.concat(variantValues(r, 'requirements'));
      parts = parts.concat(variantValues(r, 'rewards'));
      // the display group(s) as rendered group headings (both variants)
      var groups = {};
      var pushGroup = function (g) {
        if (typeof g === 'string' && g) groups[g] = true;
      };
      pushGroup(r.display_group);
      var diff = r.differences;
      if (diff && typeof diff === 'object' && !Array.isArray(diff)) {
        for (var i = 0; i < VERSION_IDS.length; i++) {
          var side = diff[VERSION_IDS[i]];
          if (side && typeof side === 'object' && !Array.isArray(side)) pushGroup(side.display_group);
        }
      }
      for (var g in groups) {
        if (Object.prototype.hasOwnProperty.call(groups, g)) parts.push(ROGUE.groupTitle(g));
      }
      return parts;
    },

    routes: function (r) {
      var parts = descriptionParts(r);
      parts = parts.concat(toParts(r.region), toParts(r.terrain));
      parts = parts.concat(arr(r.type)); // top-level = EX wild types
      parts = parts.concat(vanillaWildTypes(r)); // FAIRY-swap Vanilla variant
      if (typeof r.dropRarity === 'number') parts.push('Drop +' + r.dropRarity);
      return parts;
    },

    safari: function (r) {
      var parts = descriptionParts(r);
      return parts.concat(toParts(r.steps)); // Legends Cave catch-flow steps
    },

    settings: function (r) {
      var parts = descriptionParts(r);
      if (r.category === 'toggle') {
        parts = parts.concat(toParts(r.menu), toParts(r.code));
        if (r.values && typeof r.values === 'object' && !Array.isArray(r.values)) {
          parts = parts.concat(toParts(r.values.on), toParts(r.values.off));
        }
      } else if (r.category === 'range') {
        parts = parts.concat(toParts(r.menu), toParts(r.code));
        // option lists: top-level, or BOTH per-version variants (the
        // Pokédex slider is 7 options in Vanilla vs 37 in EX)
        var options = [];
        if (r.optionsByVersion && typeof r.optionsByVersion === 'object' && !Array.isArray(r.optionsByVersion)) {
          for (var i = 0; i < VERSION_IDS.length; i++) {
            options = options.concat(arr(r.optionsByVersion[VERSION_IDS[i]]));
          }
        } else {
          options = arr(r.options);
        }
        var values = arr(r.optionValues);
        for (var j = 0; j < options.length; j++) {
          parts.push(values[j] !== undefined ? values[j] + ' \u00b7 ' + options[j] : options[j]);
        }
        if (r.optionDescriptions && typeof r.optionDescriptions === 'object' && !Array.isArray(r.optionDescriptions)) {
          for (var k in r.optionDescriptions) {
            if (Object.prototype.hasOwnProperty.call(r.optionDescriptions, k)) parts = parts.concat(toParts(r.optionDescriptions[k]));
          }
        }
      } else if (r.category === 'preset') {
        var forces = function (list) {
          var out = [];
          for (var i = 0; i < arr(list).length; i++) {
            var f = list[i];
            if (f && typeof f === 'object') out.push(f.name + ': ' + f.value);
          }
          return out;
        };
        parts = parts.concat(forces(r.forcedToggles), forces(r.forcedRanges));
      }
      parts = parts.concat(toParts(r.note));
      return parts;
    },

    versions: function (r) {
      var parts = descriptionParts(r);
      return parts.concat(toParts(r.category));
    }
  };

  /**
   * The pokedex record's haystack parts — one string per user-visible
   * field, BOTH per-version variants unioned (top-level = EX, the vanilla
   * overlay's differing fields on top; mirrors the on-page reader), in
   * the order the local pokedex.js filter used before Step 7 promoted
   * this to the shared ROGUE.pokedexSearchText. The species name itself
   * is added centrally by recordParts — only the overlay's DIFFERING
   * vanilla name is repeated here. `forms` is the structured object list
   * (issue #85) and contributes the form display NAMES only — the
   * per-form types/stats/abilities/descriptions stay out of the haystack.
   * Strings only: a field value that is not a string (a bare number, a
   * null) contributes nothing.
   */
  function pokedexParts(r) {
    var parts = [];
    var push = function (v) {
      if (typeof v === 'string' && v) parts.push(v);
    };
    var pushList = function (v) {
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) push(v[i]);
      }
    };
    // the structured form objects (issue #85): the display NAME per form,
    // in the same position the old string[] forms occupied — the per-form
    // types/stats/abilities/descriptions deliberately stay out of the
    // haystack (the pinned search counts depend on the names-only union)
    var pushForms = function (v) {
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) {
          var f = v[i];
          push(f && typeof f === 'object' ? f.name : f);
        }
      }
    };
    var pushVariants = function (v) {
      if (v === 'all') push('all');
      else pushList(v);
    };
    var pushMoves = function (m) {
      if (!m || typeof m !== 'object') return;
      var levelUp = Array.isArray(m.levelUp) ? m.levelUp : [];
      for (var i = 0; i < levelUp.length; i++) push(Array.isArray(levelUp[i]) ? levelUp[i][0] : levelUp[i]);
      pushList(m.tm);
      pushList(m.tutor);
    };
    push(String(r.dexNum));
    push(r.category);
    push(r.region);
    push(r.description);
    pushList(r.types);
    pushForms(r.forms);
    pushList(r.ride);
    pushList(r.notes);
    pushVariants(r.dexVariants);
    pushMoves(r.moves);
    var v = r.vanilla;
    if (v && typeof v === 'object') {
      push(v.name);
      push(v.category);
      push(v.description);
      pushList(v.types);
      pushForms(v.forms);
      pushList(v.ride);
      pushList(v.notes);
      pushVariants(v.dexVariants);
      pushMoves(v.moves);
    }
    return parts;
  }

  /** name + file-specific parts + structured diagram fields + both string-form difference notes. */
  function recordParts(fileId, record) {
    var parts = [str(record.name)];
    var extract = RECORD_EXTRACTORS[fileId];
    if (extract) parts = parts.concat(extract(record));
    parts = parts.concat(structuredText(record, RECORD_STRUCTURED));
    return parts.concat(stringDiffNotes(record));
  }

  /**
   * A quest record's search haystack — the SAME field union the palette
   * indexes (name + description, trigger, requirements and rewards across
   * BOTH per-version variants + flags + the display group(s) as rendered
   * group headings), placeholder-resolved and lowercased. The palette's
   * quest entry `text` and the Quests page's per-card data-search are
   * BOTH this string (issue #50: the on-page filter has the same coverage
   * as the site-wide palette — a query findable in one is findable in the
   * other). Version-independent by design, like the palette index.
   */
  ROGUE.questSearchText = function (record) {
    return ROGUE.resolvePlaceholders(recordParts('quests', record).join(' ')).toLowerCase();
  };

  /**
   * A pokedex record's search haystack — the SAME field union the palette
   * indexes (name, dex number, category, region, description, both
   * variants' types, all move names, form display names, variant names,
   * ride, notes — strings only, bare stat numbers out), lowercased. The
   * palette's
   * pokedex entry `text` and the Pokedex page's on-page filter are BOTH
   * this string (the issue-#50 on-page/palette parity for the dex),
   * version-independent by design, like the palette index.
   */
  ROGUE.pokedexSearchText = function (record) {
    return ROGUE.resolvePlaceholders(recordParts('pokedex', record).join(' ')).toLowerCase();
  };

  /* ------------------------------------------------------------------ *
   * Entry + index construction
   * ------------------------------------------------------------------ */

  function safeSite() {
    try {
      return ROGUE.site();
    } catch (e) {
      return {};
    }
  }

  /**
   * The whole tokens of a folded lowercased string — runs of [a-z0-9] —
   * in first-occurrence order, each with its first-occurrence index in
   * the string. The fuzzy tier's unit (issue #46); used both at build
   * time (the entry's tokens/tokenPos) and defensively per query for
   * hand-built entry lists that lack the precomputed fields.
   * @returns {{tokens: string[], pos: number[]}}
   */
  function foldedTokens(s) {
    var tokens = [];
    var pos = [];
    var seen = {};
    var m;
    var re = /[a-z0-9]+/g;
    while ((m = re.exec(s)) !== null) {
      if (!Object.prototype.hasOwnProperty.call(seen, m[0])) {
        seen[m[0]] = true;
        tokens.push(m[0]);
        pos.push(m.index);
      }
    }
    return { tokens: tokens, pos: pos };
  }

  /**
   * Build one Entry; `textParts` are joined and placeholder-resolved
   * ONCE — `text` keeps the result lowercased (matching), `textCase`
   * keeps the original casing (the 1:1 parallel the palette slices
   * its snippets from). `text` may be precomputed (the quest entries
   * pass ROGUE.questSearchText so the on-page filter shares the exact
   * same lowercased haystack — issue #50). `section` (record entries
   * only) is the containing section's anchor — the same-page scroll
   * fallback when the card element is absent (issue #45). The
   * fuzzy-tier fields (foldedText, foldMap, titleFolded, tokens,
   * tokenPos) are precomputed HERE, once — the query never re-folds a
   * built entry (issue #46, see the header contract).
   */
  function makeEntry(id, title, textParts, page, anchor, versions, text, section) {
    var resolvedTitle = ROGUE.resolvePlaceholders(title);
    var haystack = ROGUE.resolvePlaceholders(textParts.join(' '));
    if (text === undefined) text = haystack.toLowerCase();
    var titleLower = resolvedTitle.toLowerCase();
    var folded = foldAccents(text);
    var toks = foldedTokens(folded.text);
    return {
      id: id,
      title: resolvedTitle,
      titleLower: titleLower,
      text: text,
      textCase: haystack,
      page: page,
      anchor: anchor,
      versions: versions,
      section: section,
      foldedText: folded.text,
      foldMap: folded.map,
      titleFolded: foldAccents(titleLower).text,
      tokens: toks.tokens,
      tokenPos: toks.pos
    };
  }

  function proseAnchor(fileId, block) {
    var t = PROSE_TARGETS[fileId] || {};
    var id = block && block.id ? block.id : '';
    if (t.map && t.map[id]) return t.map[id];
    if (t.anchor) return t.anchor;
    if (t.self && id) return '#' + id;
    return '';
  }

  /**
   * A prose block's haystack parts: heading + text, plus the optional
   * `trailing` paragraph some blocks carry (charms where-they-come-from)
   * and the allow-listed structured fields (PROSE_STRUCTURED — `list`
   * fact lists fold in there, issue #84) so list-form content stays as
   * searchable as the prose it replaced.
   */
  function proseParts(block) {
    var parts = [str(block && block.heading), str(block && block.text)];
    if (block && block.trailing) parts.push(str(block.trailing));
    parts = parts.concat(structuredText(block, PROSE_STRUCTURED));
    return parts;
  }

  /**
   * Build the full site search index (version-independent — see the
   * header doc). Every nav page, data/site.json's own hero + prose
   * blocks, and every prose block and record of the 15 content data
   * files gets one entry (three prose blocks also render on the gameplay
   * page and get a second entry there).
   */
  ROGUE.buildSearchIndex = function () {
    var entries = [];
    var site = safeSite();
    var pages = site.pages && typeof site.pages === 'object' ? site.pages : {};

    /* 1 — the nav pages (derived from site.json, not assumed). */
    var nav = arr(site.nav);
    for (var n = 0; n < nav.length; n++) {
      var navId = nav[n];
      var page = pages[navId];
      if (!page) continue;
      entries.push(makeEntry('page-' + navId, str(page.title), [str(page.title), str(page.description)], './' + navId + '.html', '', BOTH_VERSIONS));
    }

    /* 2 — data/site.json's own home-page content (issue #50): the hero
     * block (eyebrow/title/subtitle + the stat value+label pairs the home
     * page renders) and every prose block ("About these docs"). The home
     * page renders the hero at the top of the page (anchor '') and the
     * prose via ROGUE.proseSections (anchor = the block's own DOM id). */
    var hero = site.hero && typeof site.hero === 'object' ? site.hero : {};
    if (hero.title) {
      var heroParts = [str(hero.eyebrow), str(hero.title), str(hero.subtitle)];
      var stats = Array.isArray(hero.stats) ? hero.stats : [];
      for (var s = 0; s < stats.length; s++) {
        var stat = stats[s];
        if (stat && typeof stat === 'object') heroParts = heroParts.concat(toParts(stat.value), toParts(stat.label));
      }
      entries.push(makeEntry('prose-site-hero', str(hero.title), heroParts, './index.html', '', BOTH_VERSIONS));
    }
    var siteProse = Array.isArray(site.prose) ? site.prose : [];
    for (var sp = 0; sp < siteProse.length; sp++) {
      var spBlock = siteProse[sp];
      if (!spBlock || typeof spBlock !== 'object') continue;
      var spKey = spBlock.id || 'p' + sp;
      entries.push(
        makeEntry('prose-site-' + spKey, str(spBlock.heading), proseParts(spBlock), './index.html', spBlock.id ? '#' + spBlock.id : '', BOTH_VERSIONS)
      );
    }

    /* 3 + 4 — every prose block and every record of the content files. */
    for (var f = 0; f < CONTENT_FILES.length; f++) {
      var fileId = CONTENT_FILES[f];
      var data;
      try {
        data = ROGUE.data(fileId);
      } catch (e) {
        if (window.console && console.warn) console.warn('ROGUE.buildSearchIndex: no bundled data for "' + fileId + '" — skipped');
        continue;
      }
      var target = PROSE_TARGETS[fileId] || {};

      var prose = Array.isArray(data.prose) ? data.prose : [];
      for (var p = 0; p < prose.length; p++) {
        var block = prose[p];
        if (!block || typeof block !== 'object') continue;
        var key = block.id || 'p' + p;
        entries.push(makeEntry('prose-' + fileId + '-' + key, str(block.heading), proseParts(block), target.page || '', proseAnchor(fileId, block), BOTH_VERSIONS));
        var cross = PROSE_CROSS_PAGES[fileId];
        if (cross) {
          for (var c = 0; c < cross.length; c++) {
            if (cross[c].id === (block.id || '')) {
              entries.push(makeEntry('prose-' + fileId + '-' + key + '-' + cross[c].page.replace(/^\.\//, '').replace(/\.html$/, ''), str(block.heading), proseParts(block), cross[c].page, cross[c].anchor, BOTH_VERSIONS));
            }
          }
        }
      }

      var records = Array.isArray(data.records) ? data.records : [];
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        if (!record || typeof record !== 'object') continue;
        var recKey = record.id || 'r' + i;
        var recTarget = recordTarget(fileId, record);
        // the quest entry's lowercased haystack IS ROGUE.questSearchText —
        // the exact string the Quests page writes into each card's
        // data-search (issue #50 on-page/palette parity); the pokedex
        // entry's IS ROGUE.pokedexSearchText — the exact string the
        // Pokedex page's on-page filter uses; the record entry's anchor
        // is the per-card DOM id (issue #45)
        var sharedHaystack = fileId === 'quests' ? ROGUE.questSearchText(record) : fileId === 'pokedex' ? ROGUE.pokedexSearchText(record) : undefined;
        entries.push(
          makeEntry(
            'rec-' + fileId + '-' + recKey,
            str(record.name),
            recordParts(fileId, record),
            recTarget.page,
            recTarget.anchor,
            Array.isArray(record.versions) ? record.versions : BOTH_VERSIONS,
            sharedHaystack,
            recTarget.section
          )
        );
      }
    }

    return sanityCheck(entries);
  };

  /**
   * Structural sanity over a built index. Silent when healthy (never
   * warns on real data); warns once on any violation — a real check that
   * should only fire if the mapping tables and data drift apart.
   */
  function sanityCheck(entries) {
    var problems = [];
    var seen = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (seen[e.id]) problems.push('duplicate id: ' + e.id);
      seen[e.id] = true;
      if (!e.title || !e.text) {
        problems.push('empty title/text: ' + e.id);
        continue;
      }
      if (e.text !== String(e.text).toLowerCase()) problems.push('text not lowercased: ' + e.id);
      // the 1:1 original-case parallel: if a data character ever lowercases
      // to a different LENGTH (e.g. İ → i + combining dot), textCase and
      // text would misalign and matchIndex/matchEnd would slice it wrongly
      if (typeof e.textCase !== 'string' || e.textCase.toLowerCase() !== e.text)
        problems.push('textCase not the 1:1 original-case parallel of text: ' + e.id);
      if (typeof e.page !== 'string' || e.page.slice(0, 2) !== './' || e.page.slice(-5) !== '.html') problems.push('page not a relative .html link: ' + e.id + ' → ' + e.page);
      if (e.anchor !== '' && e.anchor.charAt(0) !== '#') problems.push('anchor must be "" or "#<id>": ' + e.id + ' → ' + e.anchor);
      var badVersions = !Array.isArray(e.versions) || e.versions.length === 0;
      if (!badVersions) {
        for (var v = 0; v < e.versions.length; v++) {
          if (VERSION_IDS.indexOf(e.versions[v]) === -1) badVersions = true;
        }
      }
      if (badVersions) problems.push('bad versions: ' + e.id);
    }
    if (problems.length && window.console && console.warn) {
      console.warn('ROGUE.buildSearchIndex: ' + problems.length + ' sanity problem(s): ' + problems.slice(0, 5).join('; '));
    }
    return entries;
  }

  /* ------------------------------------------------------------------ *
   * Query
   * ------------------------------------------------------------------ */

  /** data/site.json `search.maxResults` (fallback only when missing/invalid). */
  function searchMaxResults() {
    var search = safeSite().search;
    search = search && typeof search === 'object' ? search : {};
    var n = Number(search.maxResults);
    if (!isFinite(n) || n <= 0) return FALLBACK_MAX_RESULTS;
    return Math.floor(n);
  }

  /**
   * NFD-fold a string (strip combining marks) per code unit: "Pokémon"
   * → "pokemon". `out.map[i]` is the index in the ORIGINAL string of the
   * i-th folded unit — the identity map while the data is precomposed
   * (every current data file is), which keeps matchIndex valid against
   * the un-folded `text`.
   * @returns {{text: string, map: number[]}}
   */
  function foldAccents(s) {
    var out = [];
    var map = [];
    for (var i = 0; i < s.length; i++) {
      var d = s.charAt(i).normalize('NFD');
      for (var j = 0; j < d.length; j++) {
        var cu = d.charCodeAt(j);
        if (cu >= 0x0300 && cu <= 0x036f) continue; // combining mark
        out.push(d.charAt(j));
        map.push(i);
      }
    }
    return { text: out.join(''), map: map };
  }

  /**
   * An entry's folded haystack + fold map + whole tokens (first-
   * occurrence order) with their first-occurrence positions — the
   * precomputed build-time fields when present, derived on the fly
   * otherwise (defensive for hand-built entry lists, e.g. in tests —
   * the same per-query fold the pre-fold era did).
   * @returns {{text: string, map: number[], tokens: string[], pos: number[]}}
   */
  function entryFolded(e) {
    var text = typeof e.text === 'string' ? e.text : '';
    if (typeof e.foldedText === 'string' && Array.isArray(e.foldMap) && Array.isArray(e.tokens) && Array.isArray(e.tokenPos)) {
      return { text: e.foldedText, map: e.foldMap, tokens: e.tokens, pos: e.tokenPos };
    }
    var folded = foldAccents(text);
    var toks = foldedTokens(folded.text);
    return { text: folded.text, map: folded.map, tokens: toks.tokens, pos: toks.pos };
  }

  /** Record `v` in the candidate set when the presence set holds it. */
  function addIfPresent(out, present, v) {
    if (v && present[v]) out[v] = 1;
  }

  /**
   * Every string at Levenshtein distance EXACTLY 1 from the folded
   * token `t` — one deletion, one adjacent transposition, one
   * substitution or one insertion (a-z only: folded tokens contain
   * nothing else) — recording in `out` the ones the presence set holds.
   * Pure string ops, no libraries: the whole of the edit-distance
   * machinery (issue #46). ≤ ~1100 variants for a 20-char token.
   */
  function addLev1Variants(t, present, out) {
    var n = t.length;
    var i, c, ch;
    for (i = 0; i < n; i++) addIfPresent(out, present, t.slice(0, i) + t.slice(i + 1)); // deletion
    for (i = 0; i + 1 < n; i++) addIfPresent(out, present, t.slice(0, i) + t.charAt(i + 1) + t.charAt(i) + t.slice(i + 2)); // transposition
    for (i = 0; i < n; i++) {
      for (c = 97; c <= 122; c++) {
        ch = String.fromCharCode(c);
        if (ch !== t.charAt(i)) addIfPresent(out, present, t.slice(0, i) + ch + t.slice(i + 1)); // substitution
      }
    }
    for (i = 0; i <= n; i++) {
      for (c = 97; c <= 122; c++) {
        ch = String.fromCharCode(c);
        addIfPresent(out, present, t.slice(0, i) + ch + t.slice(i)); // insertion
      }
    }
  }

  /**
   * Search a built index. PURE: no DOM, no globals beyond the site
   * config (for the result cap).
   *
   * @param {Array} entries     from ROGUE.buildSearchIndex()
   * @param {string} query      trimmed; matched accent-insensitively
   * @param {string} activeVersion 'vanilla' | 'ex' — entries whose
   *                             `versions` omit it are excluded (scoping
   *                             happens HERE, at query time)
   * @returns {{results: Array<Result>, total: number}} `results` is
   *   ranked: tier 0 (title starts with the query) before tier 1 (title
   *   includes it) before tier 2 (body match) before tier 3 (fuzzy-only,
   *   issue #46 — see the header contract for the layer's rules);
   *   stable index order within a tier; capped at search.maxResults.
   *   `total` is the TOTAL number of matches found before the cap
   *   (tier 3 included), so the UI can distinguish "30 of 135" from
   *   "30 of 30" (it appends the search.moreResults overflow copy when
   *   total > results.length). Result = the entry's fields (including
   *   the original-case `textCase` parallel) plus:
   *     tier         0 | 1 | 2 | 3 (3 = fuzzy-only)
   *     fuzzy        true on tier 3, false on tiers 0–2 — the palette
   *                  highlights ONLY exact-substring rows (fuzzy spans
   *                  centre the snippet but are never <mark>-wrapped)
   *     matchIndex   tiers 0–2: first index of the (folded) query in
   *                  `text` (for the snippet); tier 3: the EARLIEST
   *                  distance-1 token occurrence in the folded text
   *                  (mapped back through the fold map — the snippet
   *                  centres on it); -1 when the body doesn't contain it
   *     matchEnd     EXCLUSIVE end of that span in `text`/`textCase`
   *                  (-1 with matchIndex) — the snippet's highlight span
   *                  for exact rows; the fuzzy rows' snippet anchor
   */
  ROGUE.searchQuery = function (entries, query, activeVersion) {
    // fold the QUERY the same way the haystacks are folded at match time
    var q = foldAccents(str(query).trim().toLowerCase()).text;
    if (!q || !Array.isArray(entries)) return { results: [], total: 0 };

    /* The fuzzy tier's candidate set (issue #46): a query token is a
     * candidate ONLY when it appears nowhere as a whole token in the
     * index (the unknown-word guard — see the header contract); its
     * distance-1 neighbours that DO exist are the tier-3 targets. Every
     * candidate is at distance exactly 1 (the guard rules out 0 — the
     * token itself is absent). null = no unknown tokens → no tier 3. */
    var qTokens = [];
    var qm;
    var qre = /[a-z0-9]+/g;
    while ((qm = qre.exec(q)) !== null) qTokens.push(qm[0]);
    var candidates = null;
    if (qTokens.length) {
      var present = {};
      for (var p = 0; p < entries.length; p++) {
        var pt = entries[p] ? entryFolded(entries[p]).tokens : [];
        for (var k = 0; k < pt.length; k++) present[pt[k]] = true;
      }
      candidates = {};
      for (var qt = 0; qt < qTokens.length; qt++) {
        if (present[qTokens[qt]]) continue; // known word: exact matching only
        addLev1Variants(qTokens[qt], present, candidates);
      }
    }

    var buckets = [[], [], [], []];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !Array.isArray(e.versions) || e.versions.indexOf(activeVersion) === -1) continue;
      var f = entryFolded(e);
      var titleLower = typeof e.titleLower === 'string' ? e.titleLower : str(e.title).toLowerCase();
      var titleFolded = typeof e.titleFolded === 'string' ? e.titleFolded : foldAccents(titleLower).text;
      var tier = -1;
      if (titleFolded.indexOf(q) === 0) tier = 0;
      else if (titleFolded.indexOf(q) !== -1) tier = 1;
      else if (f.text.indexOf(q) !== -1) tier = 2;
      var result = {
        id: e.id,
        title: e.title,
        titleLower: titleLower,
        text: e.text,
        textCase: e.textCase,
        page: e.page,
        anchor: e.anchor,
        versions: e.versions,
        section: e.section
      };
      if (tier !== -1) {
        // exact substring: the first occurrence of the folded query in
        // the folded haystack, mapped back to the un-folded text via the
        // fold map — snippet + highlight ready
        var fi = f.text.indexOf(q);
        result.tier = tier;
        result.fuzzy = false;
        result.matchIndex = fi === -1 ? -1 : f.map[fi];
        result.matchEnd = fi === -1 ? -1 : f.map[fi + q.length - 1] + 1;
      } else if (candidates) {
        // fuzzy tier 3: the candidate token with the EARLIEST first
        // occurrence in the folded text (all candidates are at distance
        // exactly 1) — the snippet centres on it; the `fuzzy` flag keeps
        // the palette from highlighting it (no contiguous match)
        var best = null;
        for (var t = 0; t < f.tokens.length; t++) {
          if (!candidates[f.tokens[t]]) continue;
          if (!best || f.pos[t] < best.pos) best = { pos: f.pos[t], len: f.tokens[t].length };
        }
        if (best) {
          result.tier = 3;
          result.fuzzy = true;
          result.matchIndex = f.map[best.pos];
          result.matchEnd = f.map[best.pos + best.len - 1] + 1;
        }
      }
      if (result.tier !== undefined) buckets[result.tier].push(result);
    }

    var out = buckets[0].concat(buckets[1], buckets[2], buckets[3]);
    // total = the full pre-cap match count, so the overlay can signpost
    // truncation even though the returned list is capped
    return {
      results: out.slice(0, searchMaxResults()),
      total: out.length
    };
  };
})();

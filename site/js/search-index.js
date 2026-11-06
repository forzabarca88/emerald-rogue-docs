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
 *   { id, title, titleLower, text, textCase, page, anchor, versions }
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
 *
 * Entry sources — one entry each: every data/site.json nav page (title +
 * description, anchor ''), data/site.json's own home-page content — the
 * `hero` block (eyebrow, title, subtitle, the stat value+label pairs)
 * and every `prose` block (heading + text; issue #50) — every `prose`
 * block of the 14 content data files (heading + text + the structured
 * diagram fields), and every record of the 14 content files (name +
 * description + the per-version variant fields + the data-specific chip
 * text the rendering page emits + the structured diagram fields + both
 * string-form `differences` notes). Array order: nav pages in site.json
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

  /** The 14 content data files (every data/*.json except site.json). */
  var CONTENT_FILES = [
    'adventure',
    'campaigns',
    'charms',
    'followmons',
    'game-modes',
    'gameshow',
    'hub',
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
  var PROSE_STRUCTURED = ['ladder', 'steps', 'cycles', 'roll', 'values', 'terrains'];

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
    // 'steps', 'terrains', 'short', 'eviction' — plain string (array) fields
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

  /** "mon_masteries" → "Mon Masteries" (the group-title rule quests.js uses). */
  function groupTitle(id) {
    return String(id)
      .split('_')
      .map(function (w) {
        return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
      })
      .join(' ');
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

  /** The safari record id → its section id (entry-criterion → the entry section). */
  var SAFARI_ANCHORS = {
    'pool-slot-layout': '#safari-pool',
    'priority-eviction': '#safari-priority',
    'legends-cave': '#safari-legends',
    'pool-sign': '#safari-sign'
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
        if (Object.prototype.hasOwnProperty.call(groups, g)) parts.push(groupTitle(g));
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
   * Build one Entry; `textParts` are joined and placeholder-resolved
   * ONCE — `text` keeps the result lowercased (matching), `textCase`
   * keeps the original casing (the 1:1 parallel the palette slices
   * its snippets from). `text` may be precomputed (the quest entries
   * pass ROGUE.questSearchText so the on-page filter shares the exact
   * same lowercased haystack — issue #50). `section` (record entries
   * only) is the containing section's anchor — the same-page scroll
   * fallback when the card element is absent (issue #45).
   */
  function makeEntry(id, title, textParts, page, anchor, versions, text, section) {
    var resolvedTitle = ROGUE.resolvePlaceholders(title);
    var haystack = ROGUE.resolvePlaceholders(textParts.join(' '));
    if (text === undefined) text = haystack.toLowerCase();
    return {
      id: id,
      title: resolvedTitle,
      titleLower: resolvedTitle.toLowerCase(),
      text: text,
      textCase: haystack,
      page: page,
      anchor: anchor,
      versions: versions,
      section: section
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
   * `list` items and `trailing` paragraph some blocks carry (charms
   * where-they-come-from) so list-form content stays as searchable as
   * the prose it replaced, plus the structured diagram fields the #31
   * batch moved out of the prose (structuredText).
   */
  function proseParts(block) {
    var parts = [str(block && block.heading), str(block && block.text)];
    if (block && Array.isArray(block.list)) {
      for (var i = 0; i < block.list.length; i++) parts.push(str(block.list[i]));
    }
    if (block && block.trailing) parts.push(str(block.trailing));
    parts = parts.concat(structuredText(block, PROSE_STRUCTURED));
    return parts;
  }

  /**
   * Build the full site search index (version-independent — see the
   * header doc). Every nav page, data/site.json's own hero + prose
   * blocks, and every prose block and record of the 14 content data
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
        // data-search (issue #50 on-page/palette parity); the record
        // entry's anchor is the per-card DOM id (issue #45)
        entries.push(
          makeEntry(
            'rec-' + fileId + '-' + recKey,
            str(record.name),
            recordParts(fileId, record),
            recTarget.page,
            recTarget.anchor,
            Array.isArray(record.versions) ? record.versions : BOTH_VERSIONS,
            fileId === 'quests' ? ROGUE.questSearchText(record) : undefined,
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
   * Search a built index. PURE: no DOM, no globals beyond the site
   * config (for the result cap).
   *
   * @param {Array} entries     from ROGUE.buildSearchIndex()
   * @param {string} query      lowercased + trimmed; substring match
   * @param {string} activeVersion 'vanilla' | 'ex' — entries whose
   *                             `versions` omit it are excluded (scoping
   *                             happens HERE, at query time)
   * @returns {{results: Array<Result>, total: number}} `results` is
   *   ranked: tier 0 (title starts with the query) before tier 1 (title
   *   includes it) before tier 2 (body match); stable index order within
   *   a tier; capped at search.maxResults. `total` is the TOTAL number
   *   of matches found before the cap, so the UI can distinguish "30 of
   *   135" from "30 of 30" (it appends the search.moreResults overflow
   *   copy when total > results.length). Result = the entry's fields
   *   (including the original-case `textCase` parallel) plus:
   *     tier         0 | 1 | 2
   *     matchIndex   first index of the query in `text` (for the snippet;
   *                  -1 when the body doesn't contain it)
   *     matchEnd     EXCLUSIVE end of that match in `text`/`textCase`
   *                  (the folded occurrence mapped back through
   *                  foldAccents' index map; -1 with matchIndex) — the
   *                  snippet's highlight span, so the palette slices the
   *                  original-case `textCase` at exactly the match
   */
  ROGUE.searchQuery = function (entries, query, activeVersion) {
    // fold the QUERY the same way the haystacks are folded at match time
    var q = foldAccents(str(query).trim().toLowerCase()).text;
    if (!q || !Array.isArray(entries)) return { results: [], total: 0 };

    var buckets = [[], [], []];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || !Array.isArray(e.versions) || e.versions.indexOf(activeVersion) === -1) continue;
      var titleLower = typeof e.titleLower === 'string' ? e.titleLower : str(e.title).toLowerCase();
      var text = typeof e.text === 'string' ? e.text : '';
      var fTitle = foldAccents(titleLower).text;
      var fText = foldAccents(text);
      var tier = -1;
      if (fTitle.indexOf(q) === 0) tier = 0;
      else if (fTitle.indexOf(q) !== -1) tier = 1;
      else if (fText.text.indexOf(q) !== -1) tier = 2;
      if (tier === -1) continue;
      var fi = fText.text.indexOf(q);
      buckets[tier].push({
        id: e.id,
        title: e.title,
        titleLower: e.titleLower,
        text: e.text,
        textCase: e.textCase,
        page: e.page,
        anchor: e.anchor,
        versions: e.versions,
        section: e.section,
        tier: tier,
        // span of the match in the un-folded `text`/`textCase`
        // (foldAccents' map) — snippet-ready: slice `textCase` at
        // [matchIndex, matchEnd) for the original-cased highlight
        matchIndex: fi === -1 ? -1 : fText.map[fi],
        matchEnd: fi === -1 ? -1 : fText.map[fi + q.length - 1] + 1
      });
    }

    var out = buckets[0].concat(buckets[1], buckets[2]);
    // total = the full pre-cap match count, so the overlay can signpost
    // truncation even though the returned list is capped
    return {
      results: out.slice(0, searchMaxResults()),
      total: out.length
    };
  };
})();

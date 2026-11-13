/*
 * pages/pokedex.js — the full species dex from data/pokedex.json.
 *
 * The data file is a LAZY chunk (meta.lazy): dist/data/pokedex.js loads
 * only on this page, never into the bundle the other nine pages share
 * (the 1025 records are a multi-megabyte file). The page recreates the
 * in-game Pokedex (src/rogue_pokedex.c) as two views of one page:
 *
 *   1. the overview view (#dex-overview) — GRID-FIRST (issue #86): the
 *      dex is the first thing on the page. The browse section leads
 *      with the .dex-browse bar — one container holding the toolbar
 *      (an on-page .search filter + a region filter whose selection
 *      survives version re-renders, derived like routes.js + the
 *      dex-variant <select> (issue #92) — the active build's
 *      range-pokedex-variant options from settings.json with an "All
 *      variants" default, filtering by the records' dexVariants
 *      membership and resetting to "all" on a version change that no
 *      longer offers the selection), the live
 *      #dex-count line ("<N> species · page <x> of <y>") and the
 *      .dex-pager (prev / next buttons + "page X of Y"), with the pager
 *      BETWEEN the count and the grid, so paging never requires
 *      scrolling down. The bar sticks under the site header: the
 *      position: sticky rule in pages.css reads --dex-browse-top on
 *      <main> (the header's rendered offsetHeight measured on load +
 *      resize — the search.js setPaletteTop pattern), and the overview
 *      sections' scroll clearance reads --dex-scroll-clear (header +
 *      the bar's measured offsetHeight + 16px, also setBrowseTop — the
 *      bar's height varies with the viewport, the region chips wrap at
 *      360px, so it is measured, never hardcoded). The .dex-grid
 *      follows the bar: exactly site.json
 *      dex.pageSize (28 — the in-game Overview's tile page) .dex-tile
 *      <a> links per page, each a lazy-loaded sprite (onerror → the
 *      placeholder tile showing the dex number in mono) + the active
 *      version's #NNN. The four prose blocks (issue #84 — each
 *      renders its short 1–2 sentence `text` plus its `list` facts as
 *      a scannable .dex-facts list) sit BELOW the grid now — their
 *      ids stay intact, so the search palette's same-page Enter still
 *      scrolls to them. Any filter change (search or region) resets to
 *      page 1.
 *   2. the species detail view (#dex-species) — rendered only while a
 *      selection exists; the .dex-species panel's root carries
 *      id = ROGUE.recId('pokedex', record.id) (the issue-#45 deep-link
 *      scheme, #rec-pokedex-<id>): the pixelated sprite, the name, the
 *      version badge, the #NNN chip, the type chips, the category, the
 *      .dex-nav prev/next strip (issue #86 — plain #rec-pokedex-<id>
 *      hash links to the neighbours in the active version's FULL
 *      dex-order list, the grid's list before the on-page filter, so
 *      the neighbours always match what the grid shows; each link is a
 *      mono label (arrow + "Prev"/"Next" + #NNN, the trailing arrow on
 *      the next side) + the display-face name span — the 360px
 *      ellipsis point, full name in the link's title; the missing side
 *      at a list end renders as an empty slot), the
 *      seven stat rows with value bars (width = value/255 capped, BST
 *      row last), the meta rows (catch rate / height / weight / gender
 *      / egg groups / base EXP), the Pokédex text, the abilities, the
 *      .dex-evo evolution line (prev / current / next — the neighbors
 *      are hash links with mono method captions, the "easy to navigate"
 *      requirement; a target missing from the active build renders as a
 *      plain non-link cell), the three move groups (Level Up as
 *      "Name (Lv n)" chips — level 0 renders "(Evo)" per the moves
 *      prose — / TM & TR / Tutor), the structured forms section
 *      (issue #85 — one .dex-form block per form: the form’s sprite
 *      (a .dex-form__sprite img — the form’s own <formEntryId>.png
 *      via its `sprite` field, the base record’s sprite as the
 *      fallback for the no-art forms, a bound onerror handler hides
 *      it if it is ever missing), the display-face name, the form’s
 *      type chips, its stat rows (the shared statRowsHtml in a
 *      .dex-stats box, BST row last), its abilities, its
 *      height/weight in the base meta’s mono treatment, its Pokédex
 *      text; a name-only custom form with no species entry is a
 *      plain sprite+name row), the “Included in”
 *      dex-variant chips (a single "All N variants" chip for the
 *      dexVariants: "all" shorthand, N from the settings.json
 *      range-pokedex-variant record's optionsByVersion length), the
 *      ride chips, the notes list and the .card__source citation
 *      (ROGUE.citeHtml).
 *
 * Routing: a hash of #rec-pokedex-<id> selects that species (the
 * overview hides, the detail shows and scrolls into view); any other
 * hash — including the empty one and #dex-overview itself — returns to
 * the overview. A deep link that arrives on load is honoured by the
 * first render (the hashchange listener covers later changes).
 *
 * Version semantics: the record's top-level fields are the EX variant;
 * `vanilla` holds ONLY the differing fields, so the active version's
 * value is read by the local dexVariant() resolver (ROGUE.effective
 * cannot be reused — it is pinned to the structured `differences`
 * object the other data files use, not this custom per-record overlay).
 * ROGUE.filter scopes the grid; an EX-only selection that cannot
 * resolve under Vanilla clears to the overview (and re-resolves, with
 * the detail back, if the toggle returns). The region selection, the
 * query and the variant survive re-renders, like routes.js / quests.js
 * (the variant resets to "all" when the new build's option list no
 * longer carries it).
 *
 * The on-page search filters the same lowercased haystack the
 * site-wide palette indexes — ROGUE.pokedexSearchText(record)
 * (search-index.js, loaded before this page script; the union of name,
 * dex number, category, both variants' types, description, region, all
 * move names, forms, variant names, ride, notes — strings only, bare
 * stat numbers out). The palette's pokedex entry `text` and this
 * on-page filter are the SAME string (the issue-#50 on-page/palette
 * parity for the dex).
 *
 * The 3D species viewer (issue #79): the detail head's sprite sits in a
 * .dex-viewer box that doubles as the mount for a three.js billboard
 * turntable (js/three-viewer.js — the site's one 3D placement, see
 * DESIGN.md §7). The vendored three.js (./vendor/three.min.js, the
 * third self-hosted asset family, DESIGN.md §11) is deferred-injected
 * ONCE (promise-memoized) the first time a species detail opens — never
 * in any shell's static markup — and the viewer is disposed on
 * deselect, version re-render and every re-init, so no loop or WebGL
 * context accumulates under repeated toggles/deep links. The static
 * <img> stays in the box as the no-WebGL / texture-failure fallback
 * (no layout shift either way).
 */
(function () {
  'use strict';

  /** A #rec-pokedex-<id> hash — the issue-#45 deep-link scheme. */
  var REC_HASH = /^#rec-pokedex-(.+)$/;

  /** The seven stat rows in display order (the BST row is last). */
  var STAT_ROWS = [
    ['hp', 'HP'],
    ['atk', 'ATK'],
    ['def', 'DEF'],
    ['spa', 'SP.A'],
    ['spd', 'SP.D'],
    ['spe', 'SPE'],
    ['total', 'BST']
  ];

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('pokedex');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var records = Array.isArray(data.records) ? data.records : [];
    var byId = {};
    records.forEach(function (r) {
      if (r && r.id) byId[r.id] = r;
    });

    /* The tile-page size — data/site.json dex.pageSize is the single
     * source (the in-game Overview's 28-tile page); 28 is only a
     * fallback for a misconfigured site.json. */
    var pageSize = Number(site && site.dex ? site.dex.pageSize : NaN);
    if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = 28;

    /* Surviving state: the query, region and variant filters persist
     * across version re-renders (quests.js / routes.js pattern) — the
     * variant is the one filter that also RESETS (to 'all') when the
     * new build's option list no longer offers the selection; the page
     * clamps itself when a version change shrinks the list; the
     * selection (a record id from the URL hash) persists so an
     * EX-only species that is hidden under Vanilla comes back with
     * the detail when the toggle returns. */
    var state = {
      query: '',
      region: 'all',
      variant: 'all',
      page: 1,
      selection: null
    };

    /* The lowercased on-page search haystack per record, precomputed
     * once via the SHARED ROGUE.pokedexSearchText (search-index.js) —
     * the exact string the site-wide palette indexes for the pokedex
     * entries, so the on-page filter has the same coverage as the
     * palette (the issue-#50 parity). Version-independent — it unions
     * BOTH variants. */
    var searchText = {};
    records.forEach(function (r) {
      searchText[r.id] = ROGUE.pokedexSearchText(r);
    });

    /**
     * The active version's value for a record field: the record's
     * top-level (EX) field, or the vanilla overlay's when present.
     * The overlay holds only the differing fields (a field with no
     * vanilla counterpart is mirrored as an empty value in it, so a
     * per-version reader never falls through to the Expansion one —
     * see the reading-entries prose), which is why the `!== undefined`
     * test is the correct presence check.
     */
    function dexVariant(record, field) {
      var v = record.vanilla;
      if (ROGUE.version === 'vanilla' && v && typeof v === 'object' && v[field] !== undefined) {
        return v[field];
      }
      return record[field];
    }

    /**
     * The species' sprite for the active version: Vanilla always uses
     * the vanilla-preferred <id>.png; EX uses <id>-ex.png when the
     * record's EX composite differs from the Vanilla one (spriteEx),
     * else <id>.png. EX-only species ship only <id>.png (the sprite
     * provenance prose block documents this).
     */
    function spriteSrc(record) {
      var file = record.id + (ROGUE.version === 'ex' && record.spriteEx ? '-ex' : '') + '.png';
      return './assets/pokemon/' + file;
    }

    /**
     * A structured form's sprite (issue #85): the form's own
     * <formEntryId>.png when the data carries `form.sprite` (the
     * extractor ships a dedicated file for every form that owns its
     * art — the bare field is the file name without .png, mirroring
     * how rec.sprite stores an id), else the BASE record's sprite:
     * the no-art forms (the base-identical palette-swap forms and the
     * rogue-only custom forms) fall back to it by design (the
     * sprites-provenance prose block documents the convention).
     */
    function formSpriteSrc(form, record) {
      return form && typeof form.sprite === 'string'
        ? './assets/pokemon/' + form.sprite + '.png'
        : spriteSrc(record);
    }

    /** Unique non-empty region values, in data order (routes.js pattern). */
    function uniqueRegions() {
      var out = [];
      records.forEach(function (r) {
        if (r && typeof r.region === 'string' && out.indexOf(r.region) === -1) out.push(r.region);
      });
      return out;
    }
    var regions = uniqueRegions();

    /**
     * The active build's dex-variant option list (issue #92): the
     * settings.json range-pokedex-variant record's optionsByVersion
     * array for the active build (7 Vanilla / 37 EX — the same list
     * the in-game Pokédex menu offers; the the-dex prose documents the
     * counts). [] when the record is absent, so the browse bar's
     * select degrades to "All variants" only and the detail's chip to
     * "All variants".
     */
    function variantOptions() {
      try {
        var settings = ROGUE.data('settings');
        var list = Array.isArray(settings.records) ? settings.records : [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (r && r.id === 'range-pokedex-variant' && r.optionsByVersion && Array.isArray(r.optionsByVersion[ROGUE.version])) {
            return r.optionsByVersion[ROGUE.version];
          }
        }
      } catch (e) {
        /* settings absent — no variant options */
      }
      return [];
    }

    /** The active version's dex-variant count (the "All N variants" chip). */
    function variantCount() {
      return variantOptions().length;
    }

    /**
     * Whether a record belongs to the selected dex variant (issue #92):
     * the record's `dexVariants` — read version-scoped through the
     * dexVariant() overlay resolver — is either the 'all' shorthand
     * (every variant of the active build) or an array of the game's
     * fully-qualified variant names, "<region> (<option>)" (the
     * range-pokedex-variant option name is the parenthesized part — the
     * same strings the extractor derives from the game's region +
     * variant display names), so membership is the option name as the
     * qualified name's tail.
     */
    function variantIncludes(record, option) {
      var dv = dexVariant(record, 'dexVariants');
      if (dv === 'all') return true;
      if (!Array.isArray(dv)) return false;
      var suffix = ' (' + option + ')';
      for (var i = 0; i < dv.length; i++) {
        var v = dv[i];
        if (typeof v === 'string' && v.length >= suffix.length && v.slice(v.length - suffix.length) === suffix) return true;
      }
      return false;
    }

    /**
     * The active version's FULL record list in data order (= dex
     * order) — the base the browse grid derives its filtered list
     * from (filteredList applies the region/query filters on top of
     * it). The detail's prev/next neighbours (issue #86) come from
     * this unfiltered list, so they always match what the grid shows
     * for the active build.
     */
    function orderedList() {
      return ROGUE.filter(records);
    }

    /** The (version-scoped, region-, variant- and query-filtered) list, in data order. */
    function filteredList() {
      var q = state.query.trim().toLowerCase();
      return ROGUE.filter(records).filter(function (r) {
        if (state.region !== 'all' && r.region !== state.region) return false;
        if (state.variant !== 'all' && !variantIncludes(r, state.variant)) return false;
        if (q && searchText[r.id].indexOf(q) === -1) return false;
        return true;
      });
    }

    /**
     * The selected record, or null: the hash-derived id must exist AND
     * resolve under the active version — an EX-only selection cannot
     * resolve under Vanilla (it clears to the overview).
     */
    function selectedRecord() {
      if (!state.selection || !byId[state.selection]) return null;
      var rec = byId[state.selection];
      if (!rec.versions || rec.versions.indexOf(ROGUE.version) === -1) return null;
      return rec;
    }

    /** The record id carried by the current URL hash, or null. */
    function hashSelection() {
      var m = String(window.location.hash).match(REC_HASH);
      return m ? m[1] : null;
    }

    /* --- the overview view ------------------------------------------------ */

    /**
     * One of the four prose blocks (issue #84): the SAME structure
     * ROGUE.proseSections emits — <section class="section" id="…">
     * with a .section__head h2 and a .section__body — the ids are
     * load-bearing anchors (the search index indexes its pokedex
     * prose entries at #<block-id>). The body is the block's short
     * 1–2 sentence `text` (the same ROGUE.paragraphs treatment the
     * shared renderer used) followed by its `list` facts as a
     * scannable .dex-facts list — the contract .chip is
     * white-space: nowrap, and the fact sentences run to ~90 chars,
     * so chips would overflow the 360px viewport.
     */
    function proseBlockHtml(block) {
      var html = '<section class="section"' + (block.id ? ' id="' + ROGUE.esc(block.id) + '"' : '') + '>';
      html += '<div class="section__head"><h2>' + ROGUE.esc(block.heading) + '</h2></div>';
      html += '<div class="section__body">' + ROGUE.paragraphs(block.text);
      if (Array.isArray(block.list)) {
        html +=
          '<ul class="dex-facts">' +
          block
            .list.map(function (item) {
              return '<li>' + ROGUE.esc(item) + '</li>';
            })
            .join('') +
          '</ul>';
      }
      return html + '</div></section>';
    }

    /** One .dex-tile link: lazy sprite (+ onerror placeholder), #NNN. */
    function dexTile(record) {
      var id = ROGUE.esc(ROGUE.recId('pokedex', record.id));
      /* the active version's name — the vanilla overlay carries a
       * `name` only when it differs (e.g. ho_oh: "Ho-Oh" → "Ho-oh") */
      var name = ROGUE.esc(dexVariant(record, 'name'));
      return (
        '<a class="dex-tile" href="#' + id + '" title="' + name + '" aria-label="' + name + '">' +
        '<img class="dex-tile__sprite" src="' + ROGUE.esc(spriteSrc(record)) + '" alt="" loading="lazy" width="128" height="128">' +
        '<span class="dex-tile__ph" aria-hidden="true">#' + record.dexNum + '</span>' +
        '<span class="dex-tile__num">#' + record.dexNum + '</span>' +
        '</a>'
      );
    }

    function pagerInner(pages) {
      return (
        '<button type="button" class="dex-pager__btn" data-dex-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>&larr; Prev</button>' +
        '<span class="dex-pager__page">page ' + state.page + ' of ' + pages + '</span>' +
        '<button type="button" class="dex-pager__btn" data-dex-page="next"' + (state.page >= pages ? ' disabled' : '') + '>Next &rarr;</button>'
      );
    }

    function browseSection() {
      var filterBtns =
        '<button type="button" class="chip dex-filter__btn" data-region="all" aria-pressed="' + (state.region === 'all') + '">All</button>' +
        regions
          .map(function (r) {
            return (
              '<button type="button" class="chip dex-filter__btn" data-region="' +
              ROGUE.esc(r) +
              '" aria-pressed="' +
              (state.region === r) +
              '">' +
              ROGUE.esc(r) +
              '</button>'
            );
          })
          .join('');

      /* The dex-variant selector (issue #92): a native <select> is the
       * only 360px-safe form for up to 37 options (chips would
       * overflow) — "All variants" (value "all") first, then the active
       * build's option names verbatim (the settings.json
       * range-pokedex-variant record), the current selection carried as
       * the selected option. The toolbar's flex-wrap absorbs it and
       * setBrowseTop's JS-measured sticky offsets track any extra wrap
       * line, so no new breakpoint is needed. */
      var variantSel =
        '<select id="dex-variant" class="dex-variant__select" aria-label="Filter species by Pokédex variant">' +
        '<option value="all"' + (state.variant === 'all' ? ' selected' : '') + '>All variants</option>' +
        variantOptions()
          .map(function (o) {
            return '<option value="' + ROGUE.esc(o) + '"' + (state.variant === o ? ' selected' : '') + '>' + ROGUE.esc(o) + '</option>';
          })
          .join('') +
        '</select>';

      /* The .dex-browse bar (issue #86): toolbar + count + pager in ONE
       * container — the pager sits between the count and the grid, so
       * paging never requires scrolling down. This is the sticky bar
       * (styled in pages.css: position: sticky, top:
       * var(--dex-browse-top), solid token background, z-index below
       * --z-header — the variable setBrowseTop below; documented in
       * DESIGN.md §6). Note the container's CLASS is .dex-browse while
       * the enclosing section's id is also "dex-browse" (ROGUE.section)
       * — a .dex-browse selector targets the bar only. */
      return ROGUE.section(
        'dex-browse',
        'Overview',
        'Browse the ' + ROGUE.versionLabel(ROGUE.version) + ' dex',
        'As the in-game Overview draws it — ' + pageSize + ' tiles a page. Open a tile for the full entry, or search and filter first.',
        '<div class="dex-browse">' +
        '<div class="dex-toolbar">' +
        '<div class="search dex-search"><input type="search" id="dex-search" placeholder="Search species" aria-label="Search species"></div>' +
        '<div class="dex-filter" role="group" aria-label="Filter species by region">' +
        filterBtns +
        '</div>' +
        variantSel +
        '</div>' +
        '<p class="dex-count" id="dex-count" role="status"></p>' +
        '<nav class="dex-pager" id="dex-pager" aria-label="Dex pages"></nav>' +
        '</div>' +
        '<div class="dex-grid" id="dex-grid"></div>' +
        '<p class="dex-empty" id="dex-empty" hidden></p>'
      );
    }

    /* --- the 3D species viewer (issue #79) ----------------------------------
     * The vendored three.js is deferred-injected once — promise-memoized,
     * cached for the page lifetime — the first time a species detail
     * opens. It resolves false (and is not retried — a missing vendor
     * file is not a transient fault) when the script itself fails to
     * load; the static sprite <img> stays in place on every failure
     * path (js/three-viewer.js handles the rest). The viewer is
     * (re-)mounted on every detail render and disposed on every
     * overview render, so repeated deep links / version toggles never
     * accumulate loops or WebGL contexts. */

    var threeLoad = null;

    function loadThree() {
      if (window.THREE) return Promise.resolve(true);
      if (threeLoad) return threeLoad;
      threeLoad = new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = './vendor/three.min.js';
        script.onload = function () {
          resolve(true);
        };
        script.onerror = function () {
          resolve(false);
        };
        document.body.appendChild(script);
      });
      return threeLoad;
    }

    function disposeViewer() {
      if (window.ROGUE3D) window.ROGUE3D.dispose();
    }

    function mountViewer(record) {
      var id = record.id;
      disposeViewer(); /* re-init on every detail render (species change, version re-render) */
      var src = spriteSrc(record);
      var start = function () {
        /* a later render may have superseded this one (a fast deep link or
         * toggle) — mount only if this species is still the selection */
        if (state.selection !== id || !window.THREE || !window.ROGUE3D) return;
        var mount = document.querySelector('#dex-species .dex-viewer');
        if (!mount) return;
        window.ROGUE3D.init(mount, src);
      };
      if (window.THREE && window.ROGUE3D) start();
      else loadThree().then(start);
    }

    /* --- the species detail view ------------------------------------------ */

    function statRowsHtml(stats) {
      return STAT_ROWS.map(function (row) {
        var value = Number(stats ? stats[row[0]] : NaN);
        if (!Number.isFinite(value) || value < 0) value = 0;
        var width = Math.min(100, (value / 255) * 100);
        return (
          '<div class="dex-stat">' +
          '<span class="dex-stat__label">' + row[1] + '</span>' +
          '<div class="dex-stat__bar" aria-hidden="true"><span class="dex-stat__fill" style="width:' + width.toFixed(1) + '%"></span></div>' +
          '<span class="dex-stat__value">' + value + '</span>' +
          '</div>'
        );
      }).join('');
    }

    function metaHtml(record) {
      var num = function (v) {
        var n = Number(v);
        return Number.isFinite(n) ? String(n) : '—';
      };
      var egg = Array.isArray(dexVariant(record, 'eggGroups')) ? dexVariant(record, 'eggGroups') : [];
      var rows = [
        ['Catch rate', num(dexVariant(record, 'catchRate'))],
        ['Height', dexVariant(record, 'height') || '—'],
        ['Weight', dexVariant(record, 'weight') || '—'],
        ['Gender', dexVariant(record, 'gender') || '—'],
        ['Egg groups', egg.join(', ') || '—'],
        ['Base EXP', num(dexVariant(record, 'baseExp'))]
      ];
      return rows
        .map(function (r) {
          return (
            '<div class="dex-meta__row"><span class="dex-meta__label">' +
            ROGUE.esc(r[0]) +
            '</span><span class="dex-meta__value">' +
            ROGUE.esc(r[1]) +
            '</span></div>'
          );
        })
        .join('');
    }

    /**
     * The evolution line — prev / current / next. Each neighbor is a
     * hash link to its own detail (#rec-pokedex-<id>) with the mono
     * method caption; a neighbor that does not exist in the active
     * build (e.g. a Gen 4 pre-ev of a Vanilla species) renders as a
     * plain, non-link cell instead of a dead link. The data shape
     * (issue #97): { prev?: {id, method}, evos?: [{id, method}] } —
     * the record's own cell renders once, then one .dex-evo__branch
     * row per evo (method caption + target link), then the prev row
     * when present (the pre-evo link + the method that leads to this
     * species). evos are the branches the in-game Pokédex shows after
     * the game's own rewrite pass, so a species can carry several
     * (Eevee's eight) — and the same method can appear twice with
     * different targets (Kubfu's two stones).
     */
    function evoCellHtml(id) {
      var rec = byId[id];
      if (!rec) return '';
      var name = ROGUE.esc(dexVariant(rec, 'name'));
      var inBuild = rec.versions && rec.versions.indexOf(ROGUE.version) !== -1;
      if (inBuild) {
        return '<a class="dex-evo__cell dex-evo__link" href="#' + ROGUE.esc(ROGUE.recId('pokedex', id)) + '"><span class="dex-evo__name">' + name + '</span></a>';
      }
      return '<span class="dex-evo__cell dex-evo__cell--absent"><span class="dex-evo__name">' + name + '</span></span>';
    }

    /** One .dex-evo__branch row: the mono method caption and the target
     *  cell (the evo direction puts the caption first; the prev row
     *  puts the pre-evo cell first, the caption trailing it toward the
     *  species the branch belongs to). */
    function evoBranchHtml(evo, isPrev) {
      var bits = [];
      var caption = '';
      if (evo && typeof evo.method === 'string') caption = '<span class="dex-evo__method">' + (isPrev ? ROGUE.esc(evo.method) + ' \u2192' : '\u2192 ' + ROGUE.esc(evo.method)) + '</span>';
      var cell = evoCellHtml(evo.id);
      if (isPrev) {
        if (cell) bits.push(cell);
        if (caption) bits.push(caption);
      } else {
        if (caption) bits.push(caption);
        if (cell) bits.push(cell);
      }
      return '<div class="dex-evo__branch">' + bits.join('') + '</div>';
    }

    /** The branch rows for an evo value (used by the detail's
     *  Evolutions field and the per-form evo lines). */
    function evoRowsHtml(evo) {
      var rows = [];
      if (evo && Array.isArray(evo.evos)) {
        evo.evos.forEach(function (e) {
          if (e && e.id) rows.push(evoBranchHtml(e, false));
        });
      }
      if (evo && evo.prev && evo.prev.id) rows.push(evoBranchHtml(evo.prev, true));
      return rows.join('');
    }

    function evoHtml(record) {
      var evo = dexVariant(record, 'evo');
      if (!evo || typeof evo !== 'object') return '';
      var rows = evoRowsHtml(evo);
      if (!rows) return '';
      var current = '<span class="dex-evo__cell dex-evo__cell--current"><span class="dex-evo__name">' + ROGUE.esc(dexVariant(record, 'name')) + '</span></span>';
      return '<div class="dex-species__field"><span class="field-label">Evolutions</span><div class="dex-evo">' + current + rows + '</div></div>';
    }

    function movesHtml(moves) {
      var levelUp = (Array.isArray(moves && moves.levelUp) ? moves.levelUp : [])
        .map(function (p) {
          var name = Array.isArray(p) ? p[0] : p;
          var level = Array.isArray(p) ? p[1] : null;
          /* level 0 marks moves learned on evolving (the moves prose) */
          var label = typeof level === 'number' && level > 0 ? name + ' (Lv ' + level + ')' : name + ' (Evo)';
          return ROGUE.chip(label);
        })
        .join('');
      var groups = [
        ['Level Up', levelUp],
        ['TM &amp; TR', (Array.isArray(moves && moves.tm) ? moves.tm : []).map(ROGUE.chip).join('')],
        ['Tutor', (Array.isArray(moves && moves.tutor) ? moves.tutor : []).map(ROGUE.chip).join('')]
      ];
      return (
        '<div class="dex-moves">' +
        groups
          .map(function (g) {
            return '<div class="dex-moves__group"><span class="field-label">' + g[0] + '</span>' + (g[1] ? '<div class="chip-row">' + g[1] + '</div>' : '<span class="dex-moves__none">\u2014</span>') + '</div>';
          })
          .join('') +
        '</div>'
      );
    }

    function fieldBlock(label, inner) {
      return '<div class="dex-species__field"><span class="field-label">' + label + '</span>' + inner + '</div>';
    }

    /**
     * One .dex-form block (issue #85): the form's sprite — a
     * .dex-form__sprite img whose src is formSpriteSrc(form, record)
     * (the form's own <formEntryId>.png, else the base record's
     * sprite) — then the display-face form name, the form's type
     * chips (deduped the same way as the base types), its stat rows —
     * the shared statRowsHtml() in the same .dex-stats box the base
     * stats use, so the BST row is last — its abilities (the in-game
     * triple repeat kept, like the base abilities), its
     * height/weight in the base meta's mono treatment, and its
     * Pokédex text. A name-only form (a rogue-only custom form with
     * no species entry and no per-form data) renders as a plain
     * sprite+name row — the sprite is the base record's there — no
     * empty stat block or chip rows. alt="" on the sprite: it is
     * decorative, the form name is the adjacent text.
     */
    function formHtml(f, record) {
      var name = f && typeof f.name === 'string' ? f.name : '';
      var sprite = ROGUE.esc(formSpriteSrc(f, record));
      var types = [];
      (Array.isArray(f && f.types) ? f.types : []).forEach(function (t) {
        if (typeof t === 'string' && types.indexOf(t) === -1) types.push(t);
      });
      var abilities = Array.isArray(f && f.abilities) ? f.abilities : [];
      var stats = f && f.stats && typeof f.stats === 'object' ? f.stats : null;
      var height = f && typeof f.height === 'string' ? f.height : '';
      var weight = f && typeof f.weight === 'string' ? f.weight : '';
      var description = f && typeof f.description === 'string' ? f.description : '';

      /* name-only form (no per-form data) — a plain sprite+name row
       * (the form has no art of its own, so the sprite is the base
       * record's) */
      if (!types.length && !stats && !abilities.length && !height && !weight && !description) {
        return (
          '<div class="dex-form dex-form--plain">' +
          '<img class="dex-form__sprite" src="' + sprite + '" width="128" height="128" alt="">' +
          '<h3 class="dex-form__name">' +
          ROGUE.esc(name) +
          '</h3>' +
          '</div>'
        );
      }

      var html =
        '<div class="dex-form">' +
        '<img class="dex-form__sprite" src="' + sprite + '" width="128" height="128" alt="">' +
        '<h3 class="dex-form__name">' +
        ROGUE.esc(name) +
        '</h3>';
      if (types.length) html += '<div class="chip-row">' + types.map(ROGUE.chip).join('') + '</div>';
      if (stats) html += '<div class="dex-stats">' + statRowsHtml(stats) + '</div>';
      if (abilities.length) html += '<div class="chip-row">' + abilities.map(ROGUE.chip).join('') + '</div>';
      if (height || weight) {
        html +=
          '<div class="dex-form__meta">' +
          (height
            ? '<div class="dex-meta__row"><span class="dex-meta__label">Height</span><span class="dex-meta__value">' +
              ROGUE.esc(height) +
              '</span></div>'
            : '') +
          (weight
            ? '<div class="dex-meta__row"><span class="dex-meta__label">Weight</span><span class="dex-meta__value">' +
              ROGUE.esc(weight) +
              '</span></div>'
            : '') +
          '</div>';
      }
      if (description) html += '<p class="dex-desc">' + ROGUE.esc(description) + '</p>';
      /* the form's own evolution branches (issue #97) — the runtime
       * rewrite is keyed by the species value held, so a form like
       * Basculin (White Striped) or Galarian Yamask carries branches
       * of its own; the block's name is the implicit center, so only
       * the branch rows render (no current cell) */
      var formEvoRows = f && f.evo && typeof f.evo === 'object' ? evoRowsHtml(f.evo) : '';
      if (formEvoRows) html += '<div class="dex-form__evo"><span class="field-label">Evolutions</span><div class="dex-evo">' + formEvoRows + '</div></div>';
      html += '</div>';
      return html;
    }

    /** The Forms field: one .dex-form block per structured form (issue #85). */
    function formsHtml(forms, record) {
      return (
        '<div class="dex-forms">' +
        forms
          .map(function (f) {
            return formHtml(f, record);
          })
          .join('') +
        '</div>'
      );
    }

    /**
     * The detail's prev/next strip (issue #86): the neighbours in the
     * active version's FULL record list (orderedList — data order =
     * dex order, the grid's list before the on-page region/query
     * filter, so the neighbours always match what the grid shows for
     * the active build). Each neighbour is a plain hash link
     * (#rec-pokedex-<id>) — the existing hashchange routing re-renders
     * the detail without a page load — a mono label (arrow +
     * "Prev"/"Next" + the neighbour's #NNN dexNum, the trailing arrow
     * on the next side) + the active-version name in its own span:
     * pages.css makes the name the ellipsis point at 360px (the full
     * name stays in the link's title attribute). At the ends of the
     * list the missing side renders as an empty slot, so the strip
     * keeps its two-sided layout.
     */
    function dexNavHtml(record) {
      var list = orderedList();
      var idx = list.indexOf(record);
      if (idx === -1) return '';
      var link = function (rec, dir) {
        var name = ROGUE.esc(dexVariant(rec, 'name'));
        var label = dir === 'prev' ? '&larr; Prev\u00A0\u00A0#' + rec.dexNum : 'Next\u00A0\u00A0#' + rec.dexNum;
        var tail = dir === 'next' ? '<span class="dex-nav__label">&rarr;</span>' : '';
        return (
          '<a class="dex-nav__link dex-nav__link--' +
          dir +
          '" href="#' +
          ROGUE.esc(ROGUE.recId('pokedex', rec.id)) +
          '" title="' +
          name +
          '">' +
          '<span class="dex-nav__label">' +
          label +
          '</span><span class="dex-nav__name">' +
          name +
          '</span>' +
          tail +
          '</a>'
        );
      };
      var slot = function (rec, dir) {
        return rec ? link(rec, dir) : '<span class="dex-nav__end" aria-hidden="true"></span>';
      };
      return (
        '<nav class="dex-nav" aria-label="Adjacent species in dex order">' +
        slot(idx > 0 ? list[idx - 1] : null, 'prev') +
        slot(idx < list.length - 1 ? list[idx + 1] : null, 'next') +
        '</nav>'
      );
    }

    function speciesSection(record) {
      var name = dexVariant(record, 'name');
      var category = dexVariant(record, 'category');
      var description = dexVariant(record, 'description');
      var stats = dexVariant(record, 'stats');
      var abilities = Array.isArray(dexVariant(record, 'abilities')) ? dexVariant(record, 'abilities') : [];
      var moves = dexVariant(record, 'moves');
      var forms = Array.isArray(dexVariant(record, 'forms')) ? dexVariant(record, 'forms') : [];
      var ride = Array.isArray(dexVariant(record, 'ride')) ? dexVariant(record, 'ride') : [];
      var notes = Array.isArray(dexVariant(record, 'notes')) ? dexVariant(record, 'notes') : [];
      var variants = dexVariant(record, 'dexVariants');

      /* the in-game representation repeats a mono type twice (type1 ==
       * type2 under Vanilla) — display the distinct types only */
      var types = [];
      (Array.isArray(dexVariant(record, 'types')) ? dexVariant(record, 'types') : []).forEach(function (t) {
        if (typeof t === 'string' && types.indexOf(t) === -1) types.push(t);
      });

      var html = '<section class="section" id="dex-species">';
      html += '<a class="dex-back" href="#dex-overview">\u2190 Back to the dex</a>';
      html += '<article class="dex-species" id="' + ROGUE.esc(ROGUE.recId('pokedex', record.id)) + '">';

      html +=
        '<div class="dex-species__head">' +
        /* .dex-viewer is the sprite box AND the 3D viewer's mount (issue
         * #79): the static <img> inside stays as the no-WebGL /
         * texture-failure fallback layer; the box geometry is unchanged,
         * so the canvas (when present) occupies the exact same box */
        '<div class="dex-viewer">' +
        '<img class="dex-species__sprite" src="' + ROGUE.esc(spriteSrc(record)) + '" alt="' + ROGUE.esc(name) + '" width="128" height="128">' +
        '</div>' +
        '<div class="dex-species__id">' +
        '<h2>' + ROGUE.esc(name) + '</h2>' +
        '<div class="dex-species__badges">' + ROGUE.badge(record) + '<span class="chip">#' + record.dexNum + '</span></div>' +
        (types.length ? '<div class="chip-row dex-species__types">' + types.map(ROGUE.chip).join('') + '</div>' : '') +
        (category ? '<p class="dex-species__category">' + ROGUE.esc(category) + '</p>' : '') +
        '</div>' +
        '</div>';

      /* The prev/next strip (issue #86) sits directly under the head,
       * so the neighbouring species are reachable without scrolling
       * back to the grid or the page top. */
      html += dexNavHtml(record);

      html += '<div class="dex-species__body">';
      html += fieldBlock('Base stats', '<div class="dex-stats">' + statRowsHtml(stats) + '</div>');
      html += fieldBlock('Details', '<div class="dex-meta">' + metaHtml(record) + '</div>');
      if (description) html += '<p class="dex-desc">' + ROGUE.esc(description) + '</p>';
      html += fieldBlock(
        'Abilities',
        abilities.length ? '<div class="chip-row">' + abilities.map(ROGUE.chip).join('') + '</div>' : '<span class="dex-moves__none">\u2014</span>'
      );
      html += evoHtml(record);
      html += movesHtml(moves);
      if (forms.length) html += fieldBlock('Forms', formsHtml(forms, record));
      html += fieldBlock(
        'Included in',
        variants === 'all'
          ? '<div class="chip-row">' + ROGUE.chip(variantCount() ? 'All ' + variantCount() + ' variants' : 'All variants') + '</div>'
          : '<div class="chip-row">' + (Array.isArray(variants) ? variants : []).map(ROGUE.chip).join('') + '</div>'
      );
      if (ride.length) html += fieldBlock('Ride', '<div class="chip-row">' + ride.map(ROGUE.chip).join('') + '</div>');
      if (notes.length) {
        html += fieldBlock(
          'Notes',
          '<ul class="dex-notes">' + notes.map(function (n) {
            return '<li>' + ROGUE.esc(n) + '</li>';
          }).join('') + '</ul>'
        );
      }
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      html += '</div></article></section>';
      return html;
    }

    /* --- rendering ---------------------------------------------------------
     * render() rebuilds main wholesale (load, version change, selection
     * change); updateBrowse() refreshes only the grid / count line /
     * pager, so a keystroke in the search input keeps its focus. */

    function render() {
      var main = document.querySelector('main');
      if (!main) return;
      var selected = selectedRecord();
      var title = ((site.pages || {}).pokedex || {}).title || 'Pokédex';

      var html = '<h1>' + ROGUE.esc(title) + '</h1>';
      html += '<div id="dex-overview"' + (selected ? ' hidden' : '') + '>';
      /* Grid-first (issue #86): the dex is the first thing on the page
       * — the browse section (bar + grid) leads and the four prose
       * blocks follow (their ids stay intact, so the search palette's
       * same-page Enter still scrolls to them). */
      html += browseSection();
      html += (Array.isArray(data.prose) ? data.prose : []).map(proseBlockHtml).join('');
      html += '</div>';
      if (selected) html += speciesSection(selected);

      main.innerHTML = html;
      bindToolbar();
      /* The browse end state stays fresh even while the detail is open
       * (the overview is hidden, not unrendered) — returning to it shows
       * the current count line and grid page immediately. */
      updateBrowse();
      if (selected) {
        var panel = document.getElementById(ROGUE.recId('pokedex', selected.id));
        if (panel) {
          /* the form-sprite fallback (DESIGN.md §6): the extractor
           * gates every form file's presence, but a sprite that is
           * ever missing hides itself (img.hidden) instead of
           * breaking its row — the error event does not bubble, so
           * the one delegated listener sits on the panel in the
           * capture phase (a fresh panel exists per render) */
          panel.addEventListener(
            'error',
            function (e) {
              var t = e.target;
              if (t && t.classList && t.classList.contains('dex-form__sprite')) t.hidden = true;
            },
            true
          );
        }
        if (panel) panel.scrollIntoView();
        mountViewer(selected);
      } else {
        disposeViewer();
      }
      /* keep the sticky bar's measurements fresh on every render —
       * the bar exists again once the detail closes (hidden while it is
       * open, so setBrowseTop's guard skips that render) */
      setBrowseTop();
    }

    /** The live end state of the overview: grid tiles, count line, empty
     *  note and pager — recomputed from the current filters. */
    function updateBrowse() {
      var grid = document.getElementById('dex-grid');
      var count = document.getElementById('dex-count');
      var empty = document.getElementById('dex-empty');
      var pager = document.getElementById('dex-pager');
      if (!grid || !count || !pager) return;

      var list = filteredList();
      var pages = Math.max(1, Math.ceil(list.length / pageSize));
      if (state.page > pages) state.page = pages;
      if (state.page < 1) state.page = 1;
      var slice = list.slice((state.page - 1) * pageSize, state.page * pageSize);
      var q = state.query.trim();

      grid.innerHTML = slice.map(dexTile).join('');
      grid.hidden = slice.length === 0;
      if (empty) {
        empty.hidden = slice.length !== 0;
        empty.textContent = q
          ? 'No species match \u201C' + q + '\u201D.'
          : state.variant !== 'all'
            ? 'No ' + ROGUE.versionLabel(ROGUE.version) + ' species in ' + state.region + ' under ' + state.variant + '.'
            : 'No ' + ROGUE.versionLabel(ROGUE.version) + ' species in ' + state.region + '.';
      }
      count.textContent = list.length + ' species \u00B7 page ' + state.page + ' of ' + pages;
      pager.innerHTML = pagerInner(pages);
      bindBrowse();

      /* The region chips' pressed state follows state.region (issue
       * #91): the full render generates the initial aria-pressed with
       * this SAME comparison, and this sync keeps the click-driven
       * refresh (which re-renders only grid/count/pager) in step — the
       * indicator moves with the filter. */
      document.querySelectorAll('.dex-filter__btn').forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-region') === state.region));
      });
    }

    /* Listeners on the parts updateBrowse() replaces: the pager buttons
     * and the lazy-sprite onerror → placeholder fallback. */
    function bindBrowse() {
      document.querySelectorAll('#dex-pager .dex-pager__btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pages = Math.max(1, Math.ceil(filteredList().length / pageSize));
          var next = state.page + (btn.getAttribute('data-dex-page') === 'next' ? 1 : -1);
          if (next < 1 || next > pages || next === state.page) return;
          state.page = next;
          updateBrowse();
        });
      });
      document.querySelectorAll('#dex-grid img.dex-tile__sprite').forEach(function (img) {
        img.addEventListener('error', function () {
          var tile = img.closest('.dex-tile');
          if (tile) tile.classList.add('dex-tile--placeholder');
          img.hidden = true;
        });
      });
    }

    /* Listeners on the toolbar (search input, region buttons, variant
     * select) — bound on the full render only; they keep the input alive
     * by refreshing just the browse end state (updateBrowse), never
     * re-rendering main. */
    function bindToolbar() {
      var input = document.getElementById('dex-search');
      if (input) {
        input.value = state.query;
        input.addEventListener('input', function () {
          state.query = input.value;
          state.page = 1;
          updateBrowse();
        });
      }
      document.querySelectorAll('.dex-filter__btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.region = btn.getAttribute('data-region');
          state.page = 1;
          updateBrowse();
        });
      });
      var variant = document.getElementById('dex-variant');
      if (variant) {
        /* The selected option in the fresh markup comes from
         * state.variant; reading the value back makes the select
         * authoritative, so a value the current build's option list
         * lacks can never linger in state (it falls back to "all"). */
        state.variant = variant.value;
        variant.addEventListener('change', function () {
          state.variant = variant.value;
          state.page = 1;
          updateBrowse();
        });
      }
    }

    /* --- wiring ------------------------------------------------------------- */

    /**
     * The sticky browse bar's measurements (issue #86 — the JS wiring;
     * the pages.css rules read both variables): the #site-header's
     * rendered height (the header is two rows at EVERY width — issue
     * #90 — and its height is width-dependent only at ≤560px, the
     * compact search-trigger/toggle set, which is why the bar
     * re-measures on resize), set on <main> as --dex-browse-top (the
     * bar's sticky top offset), plus
     * --dex-scroll-clear = header + the bar's rendered offsetHeight +
     * 16px — the scroll-margin-top the overview's sections (the
     * #dex-browse section + the four prose blocks) use so
     * hash-navigated targets land BELOW the sticky header AND the
     * sticky bar. The bar's height varies with the viewport (the 10
     * region chips wrap to extra rows at 360px), so it is measured
     * here, never hardcoded in CSS. The search.js setPaletteTop
     * pattern exactly — measure on load, re-measure on resize (and on
     * every render, so the value tracks the bar as the detail
     * opens/closes) — with this page's own element + variable names so
     * they never clash with the palette's --palette-top. Set on <main>
     * (which the bar and the deep-link scroll targets all inherit
     * from), not on the bar itself. Guarded for the bar being absent
     * or hidden (the detail view hides the whole overview — a
     * display:none bar has offsetHeight 0): the value is then left at
     * its last visible measurement (or the CSS fallback, before the
     * first overview render). #dex-species keeps a header-only
     * clearance — the bar is hidden while the detail is open.
     */
    function setBrowseTop() {
      var main = document.querySelector('main');
      if (!main) return;
      var header = document.getElementById('site-header');
      var top = header ? header.offsetHeight : 60;
      main.style.setProperty('--dex-browse-top', top + 'px');
      /* offsetParent is null while the overview is hidden (the detail
       * is open) — skip the update so the last visible measurement
       * stays put. */
      var bar = document.querySelector('#dex-overview .dex-browse');
      if (bar && bar.offsetParent !== null) {
        main.style.setProperty('--dex-scroll-clear', (top + bar.offsetHeight + 16) + 'px');
      }
    }

    state.selection = hashSelection();
    render();

    /* A #rec-pokedex-<id> hash selects that species; any other hash —
     * including the empty one — returns to the overview. */
    window.addEventListener('hashchange', function () {
      state.selection = hashSelection();
      render();
    });

    /* The header is two rows at every width (issue #90) — its
     * rendered height is width-dependent only at ≤560px (the compact
     * search-trigger/toggle set) — and so is the bar's own wrapping
     * (its toolbar wraps at narrow widths): re-measure both (the
     * search.js resize-listener pattern for --palette-top). */
    window.addEventListener('resize', function () {
      setBrowseTop();
    });

    /* Version changes re-render (the grid re-scopes, the sprites and
     * per-version fields flip, an EX-only selection clears to the
     * overview); the query, region, variant and selection survive —
     * except the variant when the new build's option list (per-build:
     * 7 Vanilla / 37 EX) no longer offers the selection (e.g. the
     * EX-only "Modern" under Vanilla), which resets to "all". */
    ROGUE.onChange(function () {
      if (state.variant !== 'all' && variantOptions().indexOf(state.variant) === -1) state.variant = 'all';
      render();
    });
  });
})();

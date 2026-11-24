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
 *      longer offers the selection + the issue-#100 sort and type
 *      selects — #dex-sort, one (asc|desc) pair per key (Dex #, BST,
 *      HP, Atk, Def, Sp. Atk, Sp. Def, Speed, Catch rate, Base EXP)
 *      with a stable decorate-sort-undecorate, and #dex-type, the
 *      active build's standard types from the top-level typeChart with
 *      an "All types" default), the live
 *      #dex-count line ("<N> species · page <x> of <y>") and the
 *      .dex-pager (prev / next buttons + "page X of Y"), with the pager
 *      BETWEEN the count and the grid, so paging never requires
 *      scrolling down. The bar sticks under the site header: the
 *      position: sticky rule in pages.css reads --dex-browse-top on
 *      <main> (the header's rendered offsetHeight measured on load +
 *      resize — the search.js setPaletteTop pattern). The shared
 *      .section-nav strip (issue #98 — Grid + the prose blocks)
 *      sits between the bar and the grid, pinned under the bar via the
 *      measured --dex-scroll-clear (header + the bar's offsetHeight +
 *      16px), and the overview sections' scroll clearance reads
 *      --dex-section-clear (that value + the strip's offsetHeight,
 *      also setBrowseTop — the bar's height varies with the viewport,
 *      the region chips wrap at 360px, so it is measured, never
 *      hardcoded). The .dex-grid
 *      follows the strip: exactly site.json
 *      dex.pageSize (24 — the site's tile page; the in-game Overview
 *      draws 28) .dex-tile
 *      <a> links per page, each a lazy-loaded sprite (onerror → the
 *      placeholder tile showing the dex number in mono) + the active
 *      version's #NNN. The prose blocks (issue #84 — each renders its
 *      short 1–2 sentence `text` plus its `list` facts as a
 *      scannable .dex-facts list — including the issue-#100 "Viability"
 *      block, whose fact list documents the metrics the analytics
 *      visualisations (PR 4b) will compute) sit BELOW the grid now —
 *      their ids stay intact, so the search palette's same-page Enter
 *      still scrolls to them. Any filter change (search, region,
 *      variant, type or sort) resets to page 1.
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
 *      at a list end renders as an empty slot), the detail's OWN
 *      .section-nav strip (reopened #98 — "Pokedex requires excessive
 *      scrolling through Pokemon's moves to see their forms": every
 *      section must be one chip away without scrolling) — one action
 *      chip (button.chip[data-target="dex-f-…"] via ROGUE.sectionNav's
 *      `target` item, NO anchors) per PRESENT section in body order —
 *      Base stats, Abilities, Evolutions (when the evo field renders),
 *      Forms (when the record has forms), Moves, Included in, Ride
 *      (when the record has ride), Notes (when the record has notes) —
 *      built from the same computed values the body renders, so a chip
 *      never points at an absent field. The jump is bindDetailNav's
 *      ONE delegated click listener: getElementById(target).
 *      scrollIntoView() with NO behavior argument (the CSS-gated
 *      motion) and NO hash write (the detail's hash stays
 *      #rec-pokedex-<id>). The strip is a child of the article (sticky
 *      across the whole detail, Mew's 292-row move list included),
 *      pinned under the site header (the base `top:
 *      var(--site-header-h)` — the --dex-scroll-clear override is
 *      scoped to #dex-overview .section-nav), and its measured
 *      clearance (header + the strip's offsetHeight + 16px —
 *      setBrowseTop) publishes --dex-detail-clear: the scroll-margin
 *      of each dex-f-* field (the .dex-species__field divs + the
 *      .dex-moves box — the dex-f-* ids are JS-only jump targets,
 *      never hash anchors). The deep-link target is the ARTICLE
 *      itself — pages.css gives it the measured header-only scroll
 *      margin (the old 112px rule sat inert on the wrapping
 *      <section>, where it could never apply — absorbed: the detail
 *      now opens with its sprite visible under the sticky header),
 *      the seven stat rows with value bars (width = value/255 capped, BST
 *      row last), the meta rows (catch rate / height / weight / gender
 *      / egg groups / base EXP), the Pokédex text, the abilities
 *      (issue #99 — one .dex-ability block each: the display-face name +
 *      the in-game description from the top-level catalog, resolved per
 *      active version (catalog.vanilla under Vanilla); name-only when the
 *      build's catalog has no entry — the catalog details are visible
 *      but NOT indexed by the site search, the documented #99
 *      trade-off), the .dex-evo evolution line (prev / current / next —
 *      the neighbors are hash links with mono method captions, the
 *      "easy to navigate" requirement; a target missing from the active
 *      build renders as a plain non-link cell), the structured forms
 *      section ABOVE the move groups (reopened #98 — the owner had to
 *      scroll through up to 292 move rows to see their forms; issue
 *      #85 — one .dex-form block per form: the form’s sprite
 *      (a .dex-form__sprite img — the form’s own <formEntryId>.png
 *      via its `sprite` field, the base record’s sprite as the
 *      fallback for the no-art forms, a bound onerror handler hides
 *      it if it is ever missing), the display-face name, the form’s
 *      type chips, its stat rows (the shared statRowsHtml in a
 *      .dex-stats box, BST row last), its abilities, its
 *      height/weight in the base meta’s mono treatment, its Pokédex
 *      text; a name-only custom form with no species entry is a
 *      plain sprite+name row), the three move groups (issue #99 — one
 *      contract .table each: Move — name + the mono `Lv n` level tag
 *      (Level Up only; level 0 → `(Evo)`) —, the Type chip, the mono
 *      Pow / Acc / PP, the in-game effect; cells the active build's
 *      catalog lacks render "—"), the “Included in"
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
 * first render (the hashchange listener covers later changes). The
 * detail's section strip never writes the hash (its chips are
 * buttons; the delegated jump is scroll-only) — the contract above is
 * unbreakable by construction.
 *
 * Version semantics: the record's top-level fields are the EX variant;
 * `vanilla` holds ONLY the differing fields, so the active version's
 * value is read by the local dexVariant() resolver (ROGUE.effective
 * cannot be reused — it is pinned to the structured `differences`
 * object the other data files use, not this custom per-record overlay).
 * ROGUE.filter scopes the grid; an EX-only selection that cannot
 * resolve under Vanilla clears to the overview (and re-resolves, with
 * the detail back, if the toggle returns). The region selection, the
 * query, the variant and the sort survive re-renders, like
 * routes.js / quests.js (the variant and the issue-#100 type filter
 * reset to "all" when the new build's option list no longer carries
 * the selection — e.g. Fairy under Vanilla).
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
 * .dex-viewer box that doubles as the mount for the shared 3D foundation
 * (js/three-scene.js — the site's 3D system; the Pokedex species detail
 * is its first placement, see DESIGN.md §7). The vendored three.js
 * (./vendor/three.min.js, the third self-hosted asset family,
 * DESIGN.md §11) is deferred-injected ONCE — ROGUE3D.load(),
 * promise-memoized and the one place the vendored script is ever loaded
 * — the first time a species detail opens, never in any shell's static
 * markup — and the viewer is disposed on deselect, version re-render
 * and every re-init, so no loop or WebGL context accumulates under
 * repeated toggles/deep links (one context per page lifetime — the
 * foundation's shared renderer is deliberately kept across deselects).
 * The static <img> stays in the box as the no-WebGL / texture-failure
 * fallback (no layout shift either way).
 *
 * The issue-#100 analytics visualisations (PR 4b) — two hand-rolled
 * inline-SVG charts (ES5 string-built, viewBox + width:100%, STATIC —
 * no animation or transitions, trivially reduced-motion-safe), both
 * event-delegated (a couple of listeners on the chart container, data-
 * attributes read off the event target — never one listener per
 * element), both tokens-only (DESIGN.md §6 documents the ramps):
 *   A. the stat radar (.dex-radar) under the detail's stat bars: a
 *      6-axis spider (hp/atk/def/spa/spd/spe, normalized to 255 like
 *      the bars), the selected species' polygon in --color-emerald
 *      (solid token fill + fill-opacity, no rgba), the compare
 *      species' polygon in --color-gold when the compare typeahead
 *      (issue #110 — the .dex-radar__compare search input over the
 *      active version's dex, replacing the old full-dex native select)
 *      picks one; ONE delegated pointerover listener on the container reads
 *      data-axis off the 6 wide invisible hit sectors (pointer-events:
 *      all — hover AND touch tap at 360px) and writes the mono
 *      caption "<stat>: <value>[ vs <compare value>]" (values
 *      version-scoped through dexVariant()); the caption shows the
 *      last axis read (a tap must persist — no pointerleave clearing).
 *   B. the type matchup heatmap (.dex-typechart) — a new overview
 *      section AFTER the prose blocks (the 7th .section-nav chip):
 *      an N×N grid of the ACTIVE version's standard types (EX 18 / 
 *      Vanilla 17, derived from the top-level typeChart at render
 *      time, never hardcoded), attacker rows × defender columns, cells
 *      binned by the chart's four values {0, 0.5, 1, 2} into the
 *      four-token dark→light ramp (×0 --color-surface, ×0.5
 *      --color-raised, ×1 --color-line, ×2 --color-muted). Two
 *      delegated listeners on the SVG: pointerover/tap a cell → the
 *      mono caption "<att> → <def>: ×<value>"; a pointerover on a
 *      defender column header previews the column caption ("<def>: 
 *      ×2: … · ×0: …") and a click pins/unpins it (gold band + the
 *      caption persist). The species select (default "None", the
 *      active dex) highlights the species' own type rows (emerald
 *      bands) and computes the viability prose's coverage metric as
 *      TWO mono lines using the dual-type PRODUCT rule (mult(d) =
 *      ∏ chart[t][d] over the species' types): "hits
 *      super-effective: n/N" (defenders with product ≥ 2) and
 *      "at-or-below-neutral: n/N" (product ≤ 1), N = the active
 *      build's standard-type count. A column pin and a species
 *      selection are mutually exclusive. At ≤560px the wrapper
 *      block-scrolls horizontally (min-width 480px — the .table
 *      pattern) so the page never overflows.
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

    /* The top-level `catalog` (issue #99): the move & ability reference
     * behind the detail tables — the Expansion values keyed by display
     * name, `catalog.vanilla` the diff-only Vanilla overlay. A missing
     * entry renders name-only (abilities) or "—" cells (move tables) —
     * never a fabricated stat or description. NOTE: the catalog details
     * are VISIBLE but not indexed by the site search (the issue-#99
     * trade-off — ROGUE.pokedexSearchText is unchanged; folding them
     * into the haystack is a flagged proposal for a later batch). */
    var catalog = data.catalog && typeof data.catalog === 'object' ? data.catalog : null;
    var catalogVanilla = catalog && catalog.vanilla && typeof catalog.vanilla === 'object' ? catalog.vanilla : null;

    /** The active build's move entry (type/power/accuracy/pp/effect). */
    function moveEntry(name) {
      if (!catalog) return null;
      if (ROGUE.version === 'vanilla' && catalogVanilla && catalogVanilla.moves && catalogVanilla.moves[name]) {
        return catalogVanilla.moves[name];
      }
      return catalog.moves && catalog.moves[name] ? catalog.moves[name] : null;
    }

    /** The active build's ability description (null when uncatalogued). */
    function abilityDesc(name) {
      if (!catalog) return null;
      if (ROGUE.version === 'vanilla' && catalogVanilla && catalogVanilla.abilities && typeof catalogVanilla.abilities[name] === 'string') {
        return catalogVanilla.abilities[name];
      }
      return catalog.abilities && typeof catalog.abilities[name] === 'string' ? catalog.abilities[name] : null;
    }

    /* The tile-page size — data/site.json dex.pageSize is the single
     * source (the site's 24-tile page — the in-game Overview draws 28);
     * 24 is only a fallback for a misconfigured site.json. */
    var pageSize = Number(site && site.dex ? site.dex.pageSize : NaN);
    if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = 24;

    /* Surviving state: the query, region and variant filters persist
     * across version re-renders (quests.js / routes.js pattern) — the
     * variant is the one filter that also RESETS (to 'all') when the
     * new build's option list no longer offers the selection; the page
     * clamps itself when a version change shrinks the list; the
     * selection (a record id from the URL hash) persists so an
     * EX-only species that is hidden under Vanilla comes back with
     * the detail when the toggle returns. The issue-#100 controls
     * join the same state: `type` ("all" or a standard type from the
     * top-level typeChart — the same reset rule as the variant) and
     * `sort` (a "<key>-asc|desc" SORT_KEYS entry — version-independent,
     * so it never resets; "dexnum-asc" is the data order, which keeps
     * the default view byte-identical). */
    var state = {
      query: '',
      region: 'all',
      variant: 'all',
      type: 'all',
      sort: 'dexnum-asc',
      page: 1,
      selection: null,
      /* The issue-#100 visualisation selections (PR 4b): the radar's
       * compare species (a record id) and the typechart's species
       * highlight (a record id) + pinned defender column (a type
       * name). All three survive re-renders like the filters above,
       * and all three reset when the active build no longer offers
       * the selection (an EX-only record under Vanilla, a Fairy
       * column under Vanilla) — the variant/type-filter reset rule. */
      radarCompare: null,
      tcSpecies: null,
      tcCol: null
    };

    /* The lowercased on-page search haystack per record, precomputed
     * once via the SHARED ROGUE.pokedexSearchText (search-index.js) —
     * the exact string the site-wide palette indexes for the pokedex
     * entries, so the on-page filter has the same coverage as the
     * palette (the issue-#50 parity). Version-independent — it unions
     * BOTH variants. */
    var searchText = {};
    /* the FOLDED (accent-stripped) copy of each haystack — the radar
     * compare typeahead (issue #110) matches accent-insensitively, the
     * site palette's rule (search-index.js folds NFD before its
     * substring test, so a query for "pokemon" finds "Pokémon"). */
    var searchFolded = {};
    records.forEach(function (r) {
      searchText[r.id] = ROGUE.pokedexSearchText(r);
      searchFolded[r.id] = foldAccents(searchText[r.id]);
    });

    /**
     * NFD-fold a string (strip combining marks) per code unit — the
     * SAME fold search-index.js applies to every index entry and query
     * before its substring test. Only the folded text is needed here
     * (never the index map), so the fold stays this simple.
     */
    function foldAccents(s) {
      var out = '';
      for (var i = 0; i < s.length; i++) {
        var d = s.charAt(i).normalize('NFD');
        for (var j = 0; j < d.length; j++) {
          var cu = d.charCodeAt(j);
          if (cu >= 0x0300 && cu <= 0x036f) continue; // combining mark
          out += d.charAt(j);
        }
      }
      return out;
    }

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

    /* The issue-#100 sort keys: [SORT_KEYS id, display label]. The stat
     * keys (bst = stats.total, hp..spe) and catch/exp read through
     * dexVariant(), so the Vanilla stats/catchRate/baseExp overlays are
     * what the sort compares under Vanilla. "dexnum-asc" is the data
     * order (records are already in national-dex order), so the default
     * sort is the identity and the default view is byte-identical. */
    var SORT_KEYS = [
      ['dexnum', 'Dex #'],
      ['bst', 'BST'],
      ['hp', 'HP'],
      ['atk', 'Atk'],
      ['def', 'Def'],
      ['spa', 'Sp. Atk'],
      ['spd', 'Sp. Def'],
      ['spe', 'Speed'],
      ['catch', 'Catch rate'],
      ['exp', 'Base EXP']
    ];

    /** A normalized "<key>-asc|desc" sort value (anything else → the default). */
    function normSort(v) {
      for (var i = 0; i < SORT_KEYS.length; i++) {
        var k = SORT_KEYS[i][0];
        if (v === k + '-asc' || v === k + '-desc') return v;
      }
      return 'dexnum-asc';
    }

    /** The version-scoped value of one sort key (null → sorts last). */
    function sortValue(record, key) {
      if (key === 'dexnum') return typeof record.dexNum === 'number' ? record.dexNum : null;
      if (key === 'catch') {
        var c = dexVariant(record, 'catchRate');
        return typeof c === 'number' ? c : null;
      }
      if (key === 'exp') {
        var e = dexVariant(record, 'baseExp');
        return typeof e === 'number' ? e : null;
      }
      var s = dexVariant(record, 'stats');
      if (!s) return null;
      /* "bst" is the total stat (the record field is stats.total) */
      var f = key === 'bst' ? 'total' : key;
      return typeof s[f] === 'number' ? s[f] : null;
    }

    /**
     * A STABLE decorate-sort-undecorate of the (already filtered) list:
     * the original index breaks every tie (equal values keep their dex
     * order), and nulls sort last in either direction — so every
     * "key-dir" pair is deterministic.
     */
    function sortList(list) {
      var parts = String(state.sort).split('-');
      var key = 'dexnum';
      for (var i = 0; i < SORT_KEYS.length; i++) {
        if (SORT_KEYS[i][0] === parts[0]) key = SORT_KEYS[i][0];
      }
      var dir = parts[1] === 'desc' ? -1 : 1;
      var indexed = [];
      for (var j = 0; j < list.length; j++) indexed.push({ v: sortValue(list[j], key), i: j });
      indexed.sort(function (a, b) {
        if (a.v === null && b.v === null) return a.i - b.i;
        if (a.v === null) return 1;
        if (b.v === null) return -1;
        if (a.v !== b.v) return dir === 1 ? (a.v < b.v ? -1 : 1) : a.v > b.v ? -1 : 1;
        return a.i - b.i;
      });
      var out = [];
      for (var k = 0; k < indexed.length; k++) out.push(list[indexed[k].i]);
      return out;
    }

    /**
     * The ACTIVE build's typeChart object ({types, mult}): the
     * diff-only `typeChart.vanilla` overlay under Vanilla, else the
     * EX chart — null when the data lacks a usable chart. Every
     * chart read in this page goes through here (the heatmap, the
     * coverage metric, the filter options), so the version scoping
     * has exactly one source.
     */
    function activeTypeChart() {
      var tc = data.typeChart;
      if (!tc || typeof tc !== 'object' || !Array.isArray(tc.types) || !Array.isArray(tc.mult)) return null;
      if (ROGUE.version === 'vanilla' && tc.vanilla && Array.isArray(tc.vanilla.types) && Array.isArray(tc.vanilla.mult)) {
        return tc.vanilla;
      }
      return tc;
    }

    /**
     * The active build's type-filter options (issue #100): the
     * top-level typeChart's type list for the active build (the
     * diff-only `typeChart.vanilla` overlay under Vanilla, else the
     * EX chart) minus the non-defenders (Mystery/Stellar — the
     * IS_STANDARD_TYPE rule; they are chart rows, never species types).
     * Falls back to the union of the species types actually in the dex
     * (version-scoped) when the chart is absent or malformed, so the
     * control degrades to "All types" + the real types, never to a
     * dead select.
     */
    function typeOptions() {
      var tc = activeTypeChart();
      var out = [];
      if (tc) {
        for (var i = 0; i < tc.types.length; i++) {
          var t = tc.types[i];
          if (typeof t === 'string' && t !== 'Mystery' && t !== 'Stellar' && out.indexOf(t) === -1) out.push(t);
        }
      }
      if (out.length === 0) {
        for (var j = 0; j < records.length; j++) {
          var ts = dexVariant(records[j], 'types');
          if (Array.isArray(ts)) {
            for (var k = 0; k < ts.length; k++) {
              var u = ts[k];
              if (typeof u === 'string' && out.indexOf(u) === -1) out.push(u);
            }
          }
        }
        out.sort();
      }
      return out;
    }

    /**
     * The active version's FULL record list in data order (= dex
     * order) — the base the browse grid derives its filtered list
     * from (filteredList applies the region/variant/type/query filters
     * and the sort on top of it). The detail's prev/next neighbours
     * (issue #86) come from this unfiltered list, so they always match
     * what the grid shows for the active build.
     */
    function orderedList() {
      return ROGUE.filter(records);
    }

    /** The (version-scoped, region-, variant-, type- and query-filtered) list, sorted per state.sort. */
    function filteredList() {
      var q = state.query.trim().toLowerCase();
      var list = ROGUE.filter(records).filter(function (r) {
        if (state.region !== 'all' && r.region !== state.region) return false;
        if (state.variant !== 'all' && !variantIncludes(r, state.variant)) return false;
        if (state.type !== 'all') {
          var ts = dexVariant(r, 'types');
          if (!Array.isArray(ts) || ts.indexOf(state.type) === -1) return false;
        }
        if (q && searchText[r.id].indexOf(q) === -1) return false;
        return true;
      });
      /* the default sort is the data order (dex order) — skip the
       * decorate pass entirely so the default view is byte-identical */
      return state.sort === 'dexnum-asc' ? list : sortList(list);
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

      /* The sort + type selects (issue #100): the SAME native-<select>
       * pattern as the variant select (170px max, tokens-only, the
       * toolbar's flex-wrap absorbs them, setBrowseTop tracks any extra
       * wrap line). The sort select carries one (asc|desc) pair per
       * SORT_KEYS entry ("Dex # (asc)" is the default — the data
       * order); the type select carries "All types" + the active
       * build's standard types from the typeChart. The fresh markup's
       * selected options come from state, and bindToolbar reads the
       * value back (the select is authoritative). */
      var sortSel =
        '<select id="dex-sort" class="dex-sort__select" aria-label="Sort species">' +
        SORT_KEYS
          .map(function (k) {
            return ['asc', 'desc']
              .map(function (d) {
                var value = k[0] + '-' + d;
                return '<option value="' + value + '"' + (state.sort === value ? ' selected' : '') + '>' + k[1] + ' (' + d + ')</option>';
              })
              .join('');
          })
          .join('') +
        '</select>';
      var typeSel =
        '<select id="dex-type" class="dex-type__select" aria-label="Filter species by type">' +
        '<option value="all"' + (state.type === 'all' ? ' selected' : '') + '>All types</option>' +
        typeOptions()
          .map(function (t) {
            return '<option value="' + ROGUE.esc(t) + '"' + (state.type === t ? ' selected' : '') + '>' + ROGUE.esc(t) + '</option>';
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

      /* The section strip (issue #98): Grid + the prose blocks (five —
       * the fourth is the issue-#100 "Viability" block) + the issue-#100
       * PR-4b "Type matchups" heatmap (the 7th chip — the new overview
       * section AFTER the prose blocks) —
       * the shared .section-nav re-pinned under the sticky bar (the
       * pages.css .page--pokedex .section-nav rule sets its `top` to
       * the measured --dex-scroll-clear). It sits between the bar and
       * the grid, inside this section, so it pins while paging, releases
       * when the section ends, and hides with the overview when a
       * species detail is open. */
      var sectionNav = ROGUE.sectionNav(
        [{ id: 'dex-browse', label: 'Grid' }]
          .concat(
            (Array.isArray(data.prose) ? data.prose : []).map(function (block) {
              return { id: block.id, label: block.heading };
            })
          )
          .concat([{ id: 'dex-typechart', label: 'Type matchups' }]),
        'Pokedex overview sections'
      );

      return ROGUE.section(
        'dex-browse',
        'Overview',
        'Browse the ' + ROGUE.versionLabel(ROGUE.version) + ' dex',
        'The site’s tile page — ' + pageSize + ' tiles a page (the in-game Overview draws 28). Open a tile for the full entry, or search and filter first.',
        '<div class="dex-browse">' +
        '<div class="dex-toolbar">' +
        '<div class="search dex-search"><input type="search" id="dex-search" placeholder="Search species" aria-label="Search species"></div>' +
        '<div class="dex-filter" role="group" aria-label="Filter species by region">' +
        filterBtns +
        '</div>' +
        variantSel +
        sortSel +
        typeSel +
        '</div>' +
        '<p class="dex-count" id="dex-count" role="status"></p>' +
        '<nav class="dex-pager" id="dex-pager" aria-label="Dex pages"></nav>' +
        '</div>' +
        sectionNav +
        '<div class="dex-grid" id="dex-grid"></div>' +
        '<p class="dex-empty" id="dex-empty" hidden></p>'
      );
    }

    /* --- issue-#100 visualisation A: the stat radar (detail) ----------------
     * Geometry: a 300×300 viewBox, center (150,150), axis radius 96
     * (the 255 max — the stat bars' own value/255 normalization), axis
     * labels at radius 114, the 6 hit sectors out to radius 126 (they
     * tile the full 360° in 60° wedges, so every point of the chart is
     * tappable), the mono "255" tick centred on the vertical axis above
     * the outer ring's top vertex (baseline at cy − r − 4 — clear of the
     * ring's slanted top edges). The six axes in STAT_ROWS order minus
     * the BST row: hp top, then clockwise atk / def / spd / spe / spa. */
    var RADAR_AXES = [
      ['hp', 'HP'],
      ['atk', 'ATK'],
      ['def', 'DEF'],
      ['spa', 'SP.A'],
      ['spd', 'SP.D'],
      ['spe', 'SPE']
    ];
    var RADAR_GEOM = { size: 300, cx: 150, cy: 150, r: 96, labelR: 114, hitR: 126, max: 255 };

    /** The radar's default caption (a sector read replaces it — the
     * last axis read is never auto-cleared; a tap must persist). */
    var RADAR_CAPTION_DEFAULT = 'Hover or tap an axis for its value.';

    /** The compare typeahead's visible-row cap (issue #110): the old
     * native select listed every species of the active build; the
     * input shows a bounded ranked list instead. */
    var RADAR_COMPARE_CAP = 12;

    /** A radar vertex for axis i at stat value v (clamped to 0…255). */
    function radarPoint(i, v) {
      var n = Number(v);
      if (!Number.isFinite(n) || n < 0) n = 0;
      if (n > RADAR_GEOM.max) n = RADAR_GEOM.max;
      var a = ((-90 + i * 60) * Math.PI) / 180;
      var r = (n / RADAR_GEOM.max) * RADAR_GEOM.r;
      return (RADAR_GEOM.cx + r * Math.cos(a)).toFixed(1) + ',' + (RADAR_GEOM.cy + r * Math.sin(a)).toFixed(1);
    }

    /** The polygon `points` string for one species' six stats. */
    function radarPolyPoints(stats) {
      return RADAR_AXES.map(function (ax, i) {
        return radarPoint(i, stats ? stats[ax[0]] : 0);
      }).join(' ');
    }

    /** A ring-guide / axis-line endpoint at fraction f of the radius. */
    function radarGeomPoint(i, f) {
      var a = ((-90 + i * 60) * Math.PI) / 180;
      var r = f * RADAR_GEOM.r;
      return (RADAR_GEOM.cx + r * Math.cos(a)).toFixed(1) + ',' + (RADAR_GEOM.cy + r * Math.sin(a)).toFixed(1);
    }

    /** The hexagonal ring at fraction f of the radius (f = k/4). */
    function radarRingPoints(f) {
      var pts = [];
      for (var i = 0; i < 6; i++) pts.push(radarGeomPoint(i, f));
      return pts.join(' ');
    }

    /**
     * The wide invisible hit sector for axis i: a 60° wedge from the
     * center out to hitR (the wedge midpoints every 15° — the wedge
     * edges are shared by adjacent sectors, so the six tile the full
     * circle with no gap or overlap). fill:none + pointer-events:all
     * in CSS makes it the tappable target without painting anything.
     */
    function radarSectorPoints(i) {
      var pts = [RADAR_GEOM.cx + ',' + RADAR_GEOM.cy];
      for (var d = -30; d <= 30; d += 15) {
        var a = ((-90 + i * 60 + d) * Math.PI) / 180;
        pts.push(
          (RADAR_GEOM.cx + RADAR_GEOM.hitR * Math.cos(a)).toFixed(1) + ',' +
          (RADAR_GEOM.cy + RADAR_GEOM.hitR * Math.sin(a)).toFixed(1)
        );
      }
      return pts.join(' ');
    }

    /**
     * The radar's static SVG (string-built): the 4 ring guides
     * (25/50/75/100% of 255), the 6 axis lines, the mono axis labels +
     * the "255" tick centred above the outer ring's top vertex, the
     * species polygon
     * (--color-emerald, solid token fill + fill-opacity), the compare
     * polygon (--color-gold) when present, the vertex dots, and the 6
     * invisible hit sectors LAST (topmost — they take the pointers).
     */
    function radarSvg(record, compare) {
      var g = RADAR_GEOM;
      var s = '<svg class="dex-radar__svg" viewBox="0 0 ' + g.size + ' ' + g.size + '" role="img" aria-label="Base stat radar">';
      var k;
      for (k = 1; k <= 4; k++) {
        s += '<polygon class="dex-radar__ring" points="' + radarRingPoints(k / 4) + '"/>';
      }
      for (var i = 0; i < 6; i++) {
        var p = radarGeomPoint(i, 1).split(',');
        s += '<line class="dex-radar__axis" x1="' + g.cx + '" y1="' + g.cy + '" x2="' + p[0] + '" y2="' + p[1] + '"/>';
      }
      for (i = 0; i < 6; i++) {
        var a = ((-90 + i * 60) * Math.PI) / 180;
        var lx = (g.cx + g.labelR * Math.cos(a)).toFixed(1);
        var ly = (g.cy + g.labelR * Math.sin(a) + 3.5).toFixed(1);
        s += '<text class="dex-radar__label" x="' + lx + '" y="' + ly + '" text-anchor="middle">' + RADAR_AXES[i][1] + '</text>';
      }
      s += '<text class="dex-radar__tick" x="' + g.cx + '" y="' + (g.cy - g.r - 4) + '" text-anchor="middle">255</text>';
      var stats = dexVariant(record, 'stats') || {};
      s += '<polygon class="dex-radar__poly dex-radar__poly--main" points="' + radarPolyPoints(stats) + '"/>';
      if (compare) {
        var cstats = dexVariant(compare, 'stats') || {};
        s += '<polygon class="dex-radar__poly dex-radar__poly--compare" points="' + radarPolyPoints(cstats) + '"/>';
      }
      for (i = 0; i < 6; i++) {
        var m = radarPoint(i, stats ? stats[RADAR_AXES[i][0]] : 0).split(',');
        s += '<circle class="dex-radar__dot dex-radar__dot--main" cx="' + m[0] + '" cy="' + m[1] + '" r="3"/>';
      }
      if (compare) {
        for (i = 0; i < 6; i++) {
          var cstats2 = dexVariant(compare, 'stats') || {};
          var c = radarPoint(i, cstats2 ? cstats2[RADAR_AXES[i][0]] : 0).split(',');
          s += '<circle class="dex-radar__dot dex-radar__dot--compare" cx="' + c[0] + '" cy="' + c[1] + '" r="2.5"/>';
        }
      }
      for (i = 0; i < 6; i++) {
        s += '<polygon class="dex-radar__hit" data-axis="' + RADAR_AXES[i][0] + '" points="' + radarSectorPoints(i) + '"/>';
      }
      s += '</svg>';
      return s;
    }

    /**
     * The mono caption for one radar axis: "<stat>: <value>" or
     * "<stat>: <value> vs <compare value>" when a compare is active —
     * both values version-scoped through dexVariant().
     */
    function radarCaptionText(record, axisKey) {
      var idx = -1;
      for (var i = 0; i < RADAR_AXES.length; i++) {
        if (RADAR_AXES[i][0] === axisKey) idx = i;
      }
      if (idx === -1) return '';
      var stats = dexVariant(record, 'stats') || {};
      var v = Number(stats[axisKey]);
      if (!Number.isFinite(v) || v < 0) v = 0;
      var text = RADAR_AXES[idx][1] + ': ' + v;
      var compare = compareRecord();
      if (compare) {
        var cstats = dexVariant(compare, 'stats') || {};
        var cv = Number(cstats[axisKey]);
        if (!Number.isFinite(cv) || cv < 0) cv = 0;
        text += ' vs ' + cv;
      }
      return text;
    }

    /** The compare record for the current selection, or null. */
    function compareRecord() {
      var rec = state.radarCompare ? byId[state.radarCompare] : null;
      if (!rec || !rec.versions || rec.versions.indexOf(ROGUE.version) === -1) return null;
      return rec;
    }

    /**
     * The compare typeahead's ranked rows (issue #110): a plain
     * substring filter over the ACTIVE build's dex on the shared
     * ROGUE.pokedexSearchText haystacks — accent-insensitive (folded
     * like the site palette): tier 0 the folded name STARTS with the
     * query, tier 1 the folded name INCLUDES it, tier 2 the folded
     * haystack INCLUDES it — stable dex order within a tier, capped
     * at RADAR_COMPARE_CAP rows. Empty query → no rows (the default
     * state is no compare).
     */
    function compareResults(query) {
      var q = foldAccents(query.trim().toLowerCase());
      if (!q) return [];
      var list = orderedList();
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var name = foldAccents(dexVariant(r, 'name').toLowerCase());
        var tier = name.indexOf(q) === 0 ? 0 : name.indexOf(q) !== -1 ? 1 : searchFolded[r.id].indexOf(q) !== -1 ? 2 : -1;
        if (tier !== -1) out.push({ r: r, tier: tier });
      }
      /* the sort is stable (ES2019+), so a tier-0/1/2 grouping keeps
       * the data order within each tier */
      out.sort(function (a, b) {
        return a.tier - b.tier;
      });
      return out.slice(0, RADAR_COMPARE_CAP);
    }

    /** The legend's swatch keys (the selected species + the compare when present). */
    function radarLegend(record, compare) {
      return (
        '<span class="dex-radar__key"><span class="dex-radar__swatch dex-radar__swatch--main"></span>' + ROGUE.esc(dexVariant(record, 'name')) + '</span>' +
        (compare ? '<span class="dex-radar__key"><span class="dex-radar__swatch dex-radar__swatch--compare"></span>' + ROGUE.esc(dexVariant(compare, 'name')) + '</span>' : '')
      );
    }

    /**
     * The radar field (rendered under the detail's stat bars): the
     * compare typeahead (issue #110 — a .search-styled input over the
     * active build's dex + its capped result list; a picked species'
     * name stays in the input, an empty input means no compare), the
     * SVG stage, the swatch legend and the mono caption (the last axis
     * read — a tap must persist, so nothing clears it). A compare
     * change re-swaps ONLY the stage, legend and caption
     * (renderRadar) — the input keeps its value and focus, and the
     * delegated container listeners sit on the container, never on the
     * swapped markup.
     */
    function radarInner(record) {
      var compare = compareRecord();
      return (
        '<div class="dex-radar__controls">' +
        '<input type="search" id="dex-radar-compare" class="search dex-radar__compare" placeholder="Compare with a species" aria-label="Compare the stat radar with a species" value="' + ROGUE.esc(compare ? dexVariant(compare, 'name') : '') + '">' +
        '</div>' +
        '<ul id="dex-radar-compare-list" class="dex-radar__compare-list" hidden></ul>' +
        '<div class="dex-radar__stage">' + radarSvg(record, compare) + '</div>' +
        '<div class="dex-radar__legend">' + radarLegend(record, compare) + '</div>' +
        '<p class="dex-radar__caption" id="dex-radar-caption">' + RADAR_CAPTION_DEFAULT + '</p>'
      );
    }

    function radarHtml(record) {
      return fieldBlock('Stat profile', '<div class="dex-radar" id="dex-radar">' + radarInner(record) + '</div>');
    }

    /**
     * The radar's delegated listeners, bound once per full render on the
     * .dex-radar container (plus the input's own listeners — the input
     * element is per-render, like bindToolbar's):
     *   - pointerover — data-axis read off the target: the six
     *     invisible hit sectors are the only children carrying it.
     *     pointerover fires for BOTH pointer hover and touch tap (a
     *     touch dispatches pointerover on touch-down), so hover and tap
     *     share one code path; the caption it writes is the last axis
     *     read and is never auto-cleared (a tap must persist — there is
     *     deliberately no pointerleave handler).
     *   - click — data-id read off a typeahead row (issue #110): the
     *     compare pick. Rows carry no data-axis, so the two delegated
     *     reads never collide.
     *   - input — re-renders the result list; clearing the input (the
     *     whole value, not a partial edit) clears the compare.
     *   - keydown Enter — picks the first visible row (the input has no
     *     keyboard row navigation of its own — the list is capped).
     * The container listeners outlive renderRadar's partial stage/
     * legend swaps (they sit on the container, not the inner markup).
     */
    function bindRadar(record) {
      var radar = document.getElementById('dex-radar');
      if (!radar) return;
      radar.addEventListener('pointerover', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var axis = t.getAttribute('data-axis');
        if (!axis) return;
        var cap = document.getElementById('dex-radar-caption');
        if (cap) cap.textContent = radarCaptionText(record, axis);
      });
      radar.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var id = t.getAttribute('data-id');
        if (!id) return;
        selectCompare(record, id);
      });
      var input = document.getElementById('dex-radar-compare');
      if (input) {
        input.addEventListener('input', function () {
          if (input.value.trim() === '') {
            state.radarCompare = null;
            renderRadar(record);
          }
          renderCompareList();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var row = document.querySelector('#dex-radar-compare-list .dex-radar__compare-row');
          if (row) selectCompare(record, row.getAttribute('data-id'));
        });
      }
      renderRadar(record);
    }

    /**
     * Re-renders the typeahead's result list from the input's current
     * value (compareResults — capped ranked rows, data-id on each). The
     * list hides (and empties) when the query matches nothing — the
     * default empty-input state shows no rows at all.
     */
    function renderCompareList() {
      var input = document.getElementById('dex-radar-compare');
      var list = document.getElementById('dex-radar-compare-list');
      if (!input || !list) return;
      var rows = compareResults(input.value);
      if (rows.length === 0) {
        list.innerHTML = '';
        list.hidden = true;
        return;
      }
      list.hidden = false;
      list.innerHTML = rows
        .map(function (m) {
          return '<li class="dex-radar__compare-row" data-id="' + ROGUE.esc(m.r.id) + '" role="option">' + ROGUE.esc(dexVariant(m.r, 'name')) + '</li>';
        })
        .join('');
    }

    /**
     * Picks a typeahead row: sets state.radarCompare (survives re-renders
     * like every other page state — the reset-when-the-active-build
     * lacks-the-species rule is the one in the onChange handler), shows
     * the picked species' name in the input, hides the list, and
     * refreshes the compare parts of the radar.
     */
    function selectCompare(record, id) {
      var rec = byId[id];
      if (!rec || !rec.versions || rec.versions.indexOf(ROGUE.version) === -1) return;
      state.radarCompare = id;
      var input = document.getElementById('dex-radar-compare');
      if (input) input.value = dexVariant(rec, 'name');
      var list = document.getElementById('dex-radar-compare-list');
      if (list) {
        list.innerHTML = '';
        list.hidden = true;
      }
      renderRadar(record);
    }

    /**
     * Refreshes ONLY what a compare change touches — the SVG stage, the
     * legend and the caption (back to the default — the old full re-swap
     * did the same). The typeahead input is untouched, so its value and
     * focus survive (no full re-swap of the radar block).
     */
    function renderRadar(record) {
      var radar = document.getElementById('dex-radar');
      if (!radar) return;
      var compare = compareRecord();
      var stage = radar.querySelector('.dex-radar__stage');
      if (stage) stage.innerHTML = radarSvg(record, compare);
      var legend = radar.querySelector('.dex-radar__legend');
      if (legend) legend.innerHTML = radarLegend(record, compare);
      var cap = document.getElementById('dex-radar-caption');
      if (cap) cap.textContent = RADAR_CAPTION_DEFAULT;
    }

    /* --- issue-#100 visualisation B: the type matchup heatmap (overview) ---- */

    /* The typechart's unambiguous 3–4 letter axis abbreviations (the
     * full names stay in the captions and legend — these only label
     * the tight SVG gutters). A type missing from the map renders its
     * full name, never a broken label. */
    var TYPE_ABBR = {
      Normal: 'Nor',
      Fighting: 'Fig',
      Flying: 'Fly',
      Poison: 'Pos',
      Ground: 'Gnd',
      Rock: 'Roc',
      Bug: 'Bug',
      Ghost: 'Gho',
      Steel: 'Ste',
      Fire: 'Fire',
      Water: 'Wat',
      Grass: 'Gra',
      Electric: 'Ele',
      Psychic: 'Psy',
      Ice: 'Ice',
      Dragon: 'Dra',
      Dark: 'Dark',
      Fairy: 'Fair',
      Mystery: '??',
      Stellar: 'Stel'
    };

    function typeAbbr(t) {
      return typeof TYPE_ABBR[t] === 'string' ? TYPE_ABBR[t] : t;
    }

    /* The cell geometry: 24-unit cells, a 52-unit left gutter for the
     * row labels, a 44-unit top gutter for the -45°-rotated column
     * labels, a 20-unit right gutter (the last column's rotated label
     * overflows the grid's right edge by up to ~15.6 units at its
     * 4-char mono max — the gutter keeps it inside the viewBox) and an
     * 8-unit bottom pad. N comes from typeOptions() (EX 18 / Vanilla
     * 17) — the grid is derived, never hardcoded. */
    var TC_GEOM = { cell: 24, left: 52, top: 44, right: 20, pad: 8 };

    /** The bin class suffix for a multiplier (0→i0, 0.5→i1, 1→i2, 2→i3). */
    function tcBin(m) {
      if (m <= 0.25) return 0;
      if (m <= 0.75) return 1;
      if (m <= 1.5) return 2;
      return 3;
    }

    /**
     * The typechart's static SVG (string-built): the N×N cells
     * (binned fills, data-at/data-def/data-mult for the delegation),
     * the row labels (abbreviated, right-aligned), the rotated column
     * labels (each with an invisible tappable hit rect above its
     * column), and the hidden highlight bands — one emerald row band
     * per type, one gold column band per type (visibility toggled by
     * the species select / column pin). The bands sit topmost with
     * pointer-events:none so they never steal a cell's pointer.
     */
    function typechartSvg(types) {
      var tc = activeTypeChart();
      if (!tc) {
        return '<svg class="dex-typechart__grid" viewBox="0 0 480 480" role="img" aria-label="Type matchup chart (no chart data)"></svg>';
      }
      var N = types.length;
      var g = TC_GEOM;
      var w = g.left + N * g.cell + g.right;
      var h = g.top + N * g.cell + g.pad;
      var s = '<svg class="dex-typechart__grid" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Type matchup chart: rows attack, columns defend">';
      var a, d;
      for (a = 0; a < N; a++) {
        var atk = types[a];
        var atkI = tc.types.indexOf(atk);
        for (d = 0; d < N; d++) {
          var def = types[d];
          var defI = tc.types.indexOf(def);
          var m = atkI !== -1 && defI !== -1 ? tc.mult[atkI][defI] : 1;
          s +=
            '<rect class="dex-typechart__cell dex-typechart__cell--i' +
            tcBin(m) +
            '" data-at="' +
            ROGUE.esc(atk) +
            '" data-def="' +
            ROGUE.esc(def) +
            '" data-mult="' +
            m +
            '" x="' +
            (g.left + d * g.cell) +
            '" y="' +
            (g.top + a * g.cell) +
            '" width="' +
            g.cell +
            '" height="' +
            g.cell +
            '"/>';
        }
      }
      for (a = 0; a < N; a++) {
        s +=
          '<text class="dex-typechart__label dex-typechart__label--row" data-row="' +
          ROGUE.esc(types[a]) +
          '" x="' +
          (g.left - 6) +
          '" y="' +
          (g.top + a * g.cell + g.cell / 2 + 3.5) +
          '" text-anchor="end">' +
          ROGUE.esc(typeAbbr(types[a])) +
          '</text>';
      }
      for (d = 0; d < N; d++) {
        var hx = g.left + d * g.cell + g.cell - 3;
        var hy = g.top - 5;
        s +=
          '<rect class="dex-typechart__hit" data-col="' +
          ROGUE.esc(types[d]) +
          '" x="' +
          (g.left + d * g.cell - 4) +
          '" y="0" width="' +
          (g.cell + 8) +
          '" height="' +
          (g.top - 8) +
          '"/>';
        s +=
          '<text class="dex-typechart__label dex-typechart__label--col" data-col="' +
          ROGUE.esc(types[d]) +
          '" x="' +
          hx +
          '" y="' +
          hy +
          '" text-anchor="start" transform="rotate(-45 ' +
          hx +
          ' ' +
          hy +
          ')">' +
          ROGUE.esc(typeAbbr(types[d])) +
          '</text>';
      }
      for (a = 0; a < N; a++) {
        s +=
          '<rect class="dex-typechart__band dex-typechart__band--row" data-row="' +
          ROGUE.esc(types[a]) +
          '" x="' +
          g.left +
          '" y="' +
          (g.top + a * g.cell) +
          '" width="' +
          N * g.cell +
          '" height="' +
          g.cell +
          '"/>';
      }
      for (d = 0; d < N; d++) {
        s +=
          '<rect class="dex-typechart__band dex-typechart__band--col" data-col="' +
          ROGUE.esc(types[d]) +
          '" x="' +
          (g.left + d * g.cell) +
          '" y="' +
          g.top +
          '" width="' +
          g.cell +
          '" height="' +
          N * g.cell +
          '"/>';
      }
      s += '</svg>';
      return s;
    }

    /**
     * The viability prose's offensive coverage for one record (issue
     * #150 — best-of-own-types against a SINGLE defender type): for
     * every standard defender type d, best(d) = the BEST of chart[t][d]
     * over the species' (version-scoped, deduped) own attack types —
     * a move is one type, so the strongest of its own-type moves decides
     * and best(d) tops out at ×2 (the old product rule let a dual type
     * reach ×4, and a resist row could hide a super-effective row: a
     * Bug/Steel vs Fairy is ×2 via Steel, not the ×1 the product gave).
     * Then: super = the defenders with best(d) ≥ 2, atOrBelow = the
     * defenders with best(d) ≤ 1, N = the active build's standard-type
     * count. The metric is labeled on the page with its limit: the type
     * chart alone — it ignores learnable moves, STAB and dual-type
     * defenders.
     */
    function coverageOf(record) {
      var tc = activeTypeChart();
      var std = typeOptions();
      if (!tc) return { sup: 0, atOrBelow: 0, N: std.length };
      var types = [];
      (Array.isArray(dexVariant(record, 'types')) ? dexVariant(record, 'types') : []).forEach(function (t) {
        if (typeof t === 'string' && types.indexOf(t) === -1) types.push(t);
      });
      var sup = 0;
      var atOrBelow = 0;
      std.forEach(function (def) {
        var defI = tc.types.indexOf(def);
        var best = 0;
        types.forEach(function (t) {
          var atkI = tc.types.indexOf(t);
          if (atkI !== -1 && defI !== -1 && tc.mult[atkI][defI] > best) best = tc.mult[atkI][defI];
        });
        if (best >= 2) sup++;
        if (best <= 1) atOrBelow++;
      });
      return { sup: sup, atOrBelow: atOrBelow, N: std.length };
    }

    /** The cell caption: "<att> → <def>: ×<value>" (the data's exact multiplier). */
    function tcCellCaption(atk, def, m) {
      return atk + ' \u2192 ' + def + ': \u00D7' + String(m);
    }

    /**
     * The column caption: "<def>: ×2: <super-effective attackers> ·
     * ×0: <immunities>" — both lists in the chart's type order, an
     * em-dash when a side is empty.
     */
    function tcColumnCaption(col) {
      var tc = activeTypeChart();
      if (!tc) return col;
      var colI = tc.types.indexOf(col);
      var sup = [];
      var imm = [];
      tc.types.forEach(function (t, i) {
        if (t === 'Mystery' || t === 'Stellar' || colI === -1) return;
        var m = tc.mult[i][colI];
        if (m === 2) sup.push(t);
        if (m === 0) imm.push(t);
      });
      return col + ': \u00D72: ' + (sup.join(', ') || '\u2014') + ' \u00B7 \u00D70: ' + (imm.join(', ') || '\u2014');
    }

    /** The typechart section — the new overview section AFTER the
     *  prose blocks (the 7th .section-nav chip): the species select,
     *  the block-scrolling SVG, the token-ramp legend, the mono
     *  caption and the two coverage lines (hidden until a species is
     *  picked). */
    function typechartSection() {
      var sel =
        '<select id="dex-typechart-species" class="dex-typechart__species" aria-label="Highlight a species\'s type rows">' +
        '<option value="">None</option>' +
        orderedList()
          .map(function (r) {
            return '<option value="' + ROGUE.esc(r.id) + '"' + (state.tcSpecies === r.id ? ' selected' : '') + '>' + ROGUE.esc(dexVariant(r, 'name')) + '</option>';
          })
          .join('') +
        '</select>';
      var legend =
        [
          ['0', 'immune'],
          ['0.5', 'resisted'],
          ['1', 'neutral'],
          ['2', 'super-effective']
        ]
          .map(function (b) {
            return '<span class="dex-typechart__key"><span class="dex-typechart__swatch dex-typechart__swatch--i' + tcBin(Number(b[0])) + '"></span>\u00D7' + b[0] + ' ' + b[1] + '</span>';
          })
          .join('');
      return (
        '<section class="section" id="dex-typechart">' +
        '<div class="section__head"><h2>Type matchups</h2></div>' +
        '<div class="section__body">' +
        '<div class="dex-typechart">' +
        '<div class="dex-typechart__controls"><span class="field-label">Species</span>' + sel + '</div>' +
        '<div class="dex-typechart__scroll">' + typechartSvg(typeOptions()) + '</div>' +
        '<div class="dex-typechart__legend">' + legend + '</div>' +
        '<p class="dex-typechart__caption" id="dex-typechart-caption">Hover or tap a cell \u00B7 click a defender column to pin it.</p>' +
        '<div class="dex-typechart__coverage" id="dex-typechart-coverage" hidden></div>' +
        '</div>' +
        '</div>' +
        '</section>'
      );
    }

    /**
     * Applies the typechart's persisted state (the pinned column /
     * the species row highlight + the two coverage lines) to the
     * current DOM — called after every full render (fresh markup)
     * and after every interaction. A column pin and a species
     * selection are mutually exclusive (each clears the other).
     */
    function applyTypechart() {
      var section = document.getElementById('dex-typechart');
      if (!section) return;
      var coverage = section.querySelector('.dex-typechart__coverage');
      var on = function (el, cls) {
        el.classList.add(cls);
      };
      section.querySelectorAll('.dex-typechart__band--on').forEach(function (el) {
        el.classList.remove('dex-typechart__band--on');
      });
      section.querySelectorAll('.dex-typechart__label--on').forEach(function (el) {
        el.classList.remove('dex-typechart__label--on');
      });
      if (state.tcCol) {
        var colSel = '.dex-typechart__band--col[data-col="' + state.tcCol + '"], .dex-typechart__label--col[data-col="' + state.tcCol + '"]';
        section.querySelectorAll(colSel).forEach(function (el) {
          on(el, el.classList.contains('dex-typechart__band') ? 'dex-typechart__band--on' : 'dex-typechart__label--on');
        });
      }
      if (state.tcSpecies && byId[state.tcSpecies]) {
        var rec = byId[state.tcSpecies];
        var types = [];
        (Array.isArray(dexVariant(rec, 'types')) ? dexVariant(rec, 'types') : []).forEach(function (t) {
          if (typeof t === 'string' && types.indexOf(t) === -1) types.push(t);
        });
        types.forEach(function (t) {
          section
            .querySelectorAll('.dex-typechart__band--row[data-row="' + t + '"], .dex-typechart__label--row[data-row="' + t + '"]')
            .forEach(function (el) {
              on(el, el.classList.contains('dex-typechart__band') ? 'dex-typechart__band--on' : 'dex-typechart__label--on');
            });
        });
        var cov = coverageOf(rec);
        if (coverage) {
          coverage.innerHTML =
            '<p class="dex-typechart__line">super-effective (best of its own types vs. a single defender): ' + cov.sup + '/' + cov.N + '</p>' +
            '<p class="dex-typechart__line">at-or-below-neutral (best of its own types vs. a single defender): ' + cov.atOrBelow + '/' + cov.N + '</p>' +
            '<p class="dex-typechart__limit">type-chart only \u2014 ignores learnable moves, STAB and dual-type defenders</p>';
          coverage.hidden = false;
        }
      } else if (coverage) {
        coverage.innerHTML = '';
        coverage.hidden = true;
      }
    }

    /**
     * The typechart's two delegated listeners (on the SVG — the
     * target's data-attributes carry everything; 324 cell listeners
     * is out) + the species select. pointerover covers BOTH pointer
     * hover and touch tap (a touch dispatches pointerover on
     * touch-down); the caption shows the last read and is never
     * auto-cleared (a tap must persist — no pointerleave handler).
     * The click listener is the column pin (a click distinguishes a
     * deliberate selection from a hover pass-through).
     */
    function bindTypechart() {
      var section = document.getElementById('dex-typechart');
      if (!section) return;
      var svg = section.querySelector('.dex-typechart__grid');
      var caption = document.getElementById('dex-typechart-caption');
      var select = document.getElementById('dex-typechart-species');
      if (select) {
        select.addEventListener('change', function () {
          state.tcSpecies = select.value || null;
          state.tcCol = null; /* mutually exclusive with the column pin */
          applyTypechart();
          if (caption) caption.textContent = 'Hover or tap a cell \u00B7 click a defender column to pin it.';
        });
      }
      if (svg) {
        svg.addEventListener('pointerover', function (e) {
          var t = e.target;
          if (!t || !t.getAttribute || !caption) return;
          var mult = t.getAttribute('data-mult');
          if (mult !== null) {
            caption.textContent = tcCellCaption(t.getAttribute('data-at'), t.getAttribute('data-def'), Number(mult));
          } else {
            var col = t.getAttribute('data-col');
            if (col !== null) caption.textContent = tcColumnCaption(col);
          }
        });
        svg.addEventListener('click', function (e) {
          var t = e.target;
          if (!t || !t.getAttribute) return;
          var col = t.getAttribute('data-col');
          if (col === null) return;
          state.tcCol = state.tcCol === col ? null : col;
          if (state.tcCol) {
            state.tcSpecies = null; /* mutually exclusive */
            if (select) select.value = '';
          }
          applyTypechart();
          if (caption) caption.textContent = state.tcCol ? tcColumnCaption(state.tcCol) : 'Hover or tap a cell \u00B7 click a defender column to pin it.';
        });
      }
      applyTypechart();
    }

    /* --- the 3D species viewer (issue #79) — on the shared 3D foundation ---
     * The vendored three.js is deferred-injected exactly once —
     * ROGUE3D.load() is promise-memoized and is the ONE place the
     * vendored script is ever loaded — the first time a species detail
     * opens. It resolves false (and is not retried — a missing vendor
     * file is not a transient fault) when the script itself fails to
     * load; the static sprite <img> stays in place on every failure
     * path (js/three-scene.js handles the rest). The viewer is
     * (re-)mounted on every detail render and disposed on every
     * overview render, so repeated deep links / version toggles never
     * accumulate loops or WebGL contexts — one context per page
     * lifetime (the foundation's shared renderer survives deselects).
     *
     * The dex's scene (issue #111): a GBA-affine-style perspective sway
     * of the 128×128 species PNG — a NearestFilter sRGB CanvasTexture on
     * an unlit double-sided plane floating on a plain --color-bg
     * backdrop (no floor, no grid — the in-game Pokedex sprite floats on
     * a plain background). The plane swings toward/away from the viewer
     * within a limited Y tilt (never a full 360° turntable) plus a
     * gentle idle bob: the pose is a pure function of scene time mutating
     * the pre-built group only — no per-frame allocations. */

    /* The dex placement's fixed scene constants (ported from the
     * discarded js/three-viewer.js): one full left↔right swing every
     * ~6s, one bob every ~3.7s. SPRITE_HEIGHT is sized so the in-frame
     * art renders at about the same scale as the static <img> fallback
     * (the 128×128 frame fills the box there) — 2.2 high is ~90% of the
     * framed height, the transparent frame margins do the rest. The
     * camera is FIXED per mount (no per-frame movement, no per-frame
     * RNG); the distance leaves headroom so the plane's corners stay in
     * frame through the whole sway. */
    var VIEWER_CAMERA = { fov: 38, position: [0, 1.6, 3.6], lookAt: [0, 0.9, 0], near: 0.1, far: 50 };
    var VIEWER_TOKENS = { background: '--color-bg' };
    var SPRITE_HEIGHT = 2.2;
    var BASE_Y = 1.1; /* sprite center at rest */
    var SWAY_SPEED = 1.05; /* rad/s */
    var SWAY_MAX_TILT = 0.55; /* rad (~31°) — max Y tilt from the viewer */
    var BOB_SPEED = 1.7; /* rad/s */
    var BOB_AMPLITUDE = 0.03;

    /** Pixel-art crisp sprite texture: drawn 1:1 onto a scratch canvas
     *  at native size, NearestFilter for mag AND min, no mipmaps
     *  (required with nearest min — and the 128×128 art needs none),
     *  sRGB so the palette renders exactly as the token-palette PNG. */
    function makeSpriteTexture(THREE, image) {
      var w = image.naturalWidth || image.width || 128;
      var h = image.naturalHeight || image.height || 128;
      var scratch = document.createElement('canvas');
      scratch.width = w;
      scratch.height = h;
      var ctx = scratch.getContext('2d');
      if (!ctx) throw new Error('no 2d context for the sprite texture');
      ctx.drawImage(image, 0, 0);
      var texture = new THREE.CanvasTexture(scratch);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.userData.aspect = w / h;
      return texture;
    }

    function disposeViewer() {
      if (window.ROGUE3D) window.ROGUE3D.dispose();
    }

    /**
     * The dex's build callback for ROGUE3D.mount: the fixed camera, the
     * plain token backdrop and the unlit double-sided sprite plane (a
     * GBA sprite has no real depth — the "3D" is the perspective sway,
     * not a model), the plane sized from the texture's aspect (the art
     * is square, but don't assume it). Returns the sway pose(t).
     */
    function buildSpriteScene(THREE, scene, camera, colors, image) {
      camera.fov = VIEWER_CAMERA.fov;
      camera.near = VIEWER_CAMERA.near;
      camera.far = VIEWER_CAMERA.far;
      camera.position.set(VIEWER_CAMERA.position[0], VIEWER_CAMERA.position[1], VIEWER_CAMERA.position[2]);
      camera.lookAt(new THREE.Vector3(VIEWER_CAMERA.lookAt[0], VIEWER_CAMERA.lookAt[1], VIEWER_CAMERA.lookAt[2]));

      /* No floor, no grid (issue #111): the in-game Pokedex sprite floats
       * on a plain background — the scene background (the .dex-viewer
       * box's own --color-bg) is the backdrop. */
      scene.background = new THREE.Color(colors.background);

      var group = new THREE.Group();
      var material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
      var plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      group.add(plane);
      group.position.y = BASE_Y;
      scene.add(group);

      var texture = makeSpriteTexture(THREE, image);
      material.map = texture;
      var aspect = texture.userData.aspect || 1;
      plane.geometry.dispose();
      plane.geometry = new THREE.PlaneGeometry(SPRITE_HEIGHT * aspect, SPRITE_HEIGHT);

      /* The GBA-affine-style perspective sway — a bounded Y oscillation,
       * not a full turn — plus the gentle idle bob. A pure function of
       * scene time (deterministic). */
      return function pose(t) {
        group.rotation.y = Math.sin(t * SWAY_SPEED) * SWAY_MAX_TILT;
        group.position.y = BASE_Y + Math.sin(t * BOB_SPEED) * BOB_AMPLITUDE;
      };
    }

    function mountViewer(record) {
      var id = record.id;
      disposeViewer(); /* re-init on every detail render (species change, version re-render) */
      if (!window.ROGUE3D) return;
      var src = spriteSrc(record);
      var start = function () {
        /* a later render may have superseded this one (a fast deep link or
         * toggle) — mount only if this species is still the selection */
        if (state.selection !== id || !window.ROGUE3D) return;
        var box = document.querySelector('#dex-species .dex-viewer');
        if (!box) return;
        /* The sprite image loads async (a few ms locally): the canvas is
         * only mounted once its texture source has landed, so the first
         * frame already shows the sprite (the reduced-motion static
         * frame is sampled right after the canvas appears). */
        var image = new Image();
        image.onload = function () {
          /* the same supersede guard — the load can race a newer render */
          if (state.selection !== id) return;
          var mount = document.querySelector('#dex-species .dex-viewer');
          if (!mount) return;
          window.ROGUE3D.mount(mount, {
            tokens: VIEWER_TOKENS,
            build: function (THREE, scene, camera, colors) {
              return buildSpriteScene(THREE, scene, camera, colors, image);
            }
          });
        };
        image.onerror = function () { /* texture failure → the static <img> stays, silently */ };
        image.src = src;
      };
      window.ROGUE3D.load().then(function (ok) {
        if (ok) start();
      });
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
     * (issue #97): { prev?: {id, method, form?}, evos?: [{id, method,
     * form?}] } — the record's own cell renders once, then one
     * .dex-evo__branch row per evo (method caption + target link), then
     * the prev row when present (the pre-evo link + the method that
     * leads to this species). evos are the branches the in-game
     * Pokédex shows after the game's own rewrite pass, so a species can
     * carry several (Eevee's eight) — and the same method can appear
     * twice with different targets (Kubfu's two stones). `form` names
     * the target's form (Quilava's Hisuian Typhlosion, Galarian Yamask
     * as Runerigus' pre-ev) — the cell shows the form name, the link
     * still lands on the target record.
     */
    function evoCellHtml(id, formName) {
      var rec = byId[id];
      if (!rec) return '';
      // a form-targeted branch (issue #97) shows the form's display name —
      // exactly the target record's forms entry — while the deep link still
      // lands on the target record itself
      var name = formName || ROGUE.esc(dexVariant(rec, 'name'));
      var inBuild = rec.versions && rec.versions.indexOf(ROGUE.version) !== -1;
      if (inBuild) {
        return '<a class="dex-evo__cell dex-evo__link" href="#' + ROGUE.esc(ROGUE.recId('pokedex', id)) + '"><span class="dex-evo__name">' + name + '</span></a>';
      }
      return '<span class="dex-evo__cell dex-evo__cell--absent"><span class="dex-evo__name">' + name + '</span></span>';
    }

    /** One .dex-evo__branch row: the mono method caption and the target
     *  cell (the evo direction puts the caption first; the prev row
     *  puts the pre-evo cell first, the caption trailing it toward the
     *  species the branch belongs to). When the branch's entry carries a
     *  form (issue #97 — Hisuian Typhlosion, Basculegion (Male), ...),
     *  the cell shows that form's name instead of the record's. */
    function evoBranchHtml(evo, isPrev) {
      var bits = [];
      var caption = '';
      if (evo && typeof evo.method === 'string') caption = '<span class="dex-evo__method">' + (isPrev ? ROGUE.esc(evo.method) + ' \u2192' : '\u2192 ' + ROGUE.esc(evo.method)) + '</span>';
      var formName = evo && typeof evo.form === 'string' ? ROGUE.esc(evo.form) : '';
      var cell = evoCellHtml(evo.id, formName);
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
      /* id="dex-f-evos" — the detail strip's Evolutions chip jump
       * target (JS-only, never a hash anchor) */
      return '<div class="dex-species__field" id="dex-f-evos"><span class="field-label">Evolutions</span><div class="dex-evo">' + current + rows + '</div></div>';
    }

    /* The abilities field (issue #99): one .dex-ability block per
     * ability — the display-face name + the in-game description from the
     * active build's catalog (catalog.vanilla under Vanilla); an ability
     * with no catalog entry renders its name only, never a fake "—".
     * The in-game display loop (src/rogue_pokedex.c) prints each slot
     * only when it is non-empty AND differs from the RAW previous slot
     * (it sets prevAbility unconditionally, empty slots included), so
     * consecutive duplicates (the 3-slot table's triple repeats — mostly
     * Mega forms) render once here too, and a name repeated across an
     * empty slot still renders both times. */
    function abilitiesHtml(abilities) {
      if (!abilities.length) return '<span class="dex-moves__none">\u2014</span>';
      var kept = [];
      var prev = null; /* the raw previous slot (ABILITY_NONE initially) */
      abilities.forEach(function (a) {
        if (a && a !== prev) kept.push(a);
        prev = a;
      });
      return (
        kept
          .map(function (a) {
            var desc = abilityDesc(a);
            return (
              '<div class="dex-ability">' +
              '<span class="dex-ability__name">' + ROGUE.esc(a) + '</span>' +
              (desc ? '<span class="dex-ability__desc">' + ROGUE.esc(desc) + '</span>' : '') +
              '</div>'
            );
          })
          .join('')
      );
    }

    /* The three move groups (issue #99): one contract .table per group —
     * Move / Type / Pow / Acc / PP / Effect. Each row carries the active
     * build's catalog entry (moveEntry — catalog.vanilla under Vanilla);
     * cells the catalog lacks render "—", never a fabricated stat. The
     * Move cell's mono level tag is the Level Up group's `Lv n` (level 0 →
     * `(Evo)` per the moves prose); Type is a .chip; Pow/Acc/PP are mono
     * <code> values. The html-flagged columns are pre-escaped here. */
    var MOVE_COLUMNS = [
      { key: 'move', label: 'Move', html: true },
      { key: 'type', label: 'Type', html: true },
      { key: 'pow', label: 'Pow', html: true },
      { key: 'acc', label: 'Acc', html: true },
      { key: 'pp', label: 'PP', html: true },
      { key: 'effect', label: 'Effect' }
    ];
    function moveRowHtml(name, level) {
      var entry = moveEntry(name);
      var levelTag = level === null ? '' : level > 0 ? '<code>Lv ' + level + '</code>' : '<code>(Evo)</code>';
      var num = function (v) {
        return typeof v === 'number' ? '<code>' + v + '</code>' : '\u2014';
      };
      return {
        move: ROGUE.esc(name) + (levelTag ? ' ' + levelTag : ''),
        type: entry && entry.type ? ROGUE.chip(entry.type) : '\u2014',
        pow: num(entry ? entry.power : null),
        acc: num(entry ? entry.accuracy : null),
        pp: num(entry ? entry.pp : null),
        effect: entry && entry.effect ? entry.effect : '\u2014'
      };
    }
    /* The .dex-moves box carries id="dex-f-moves": the detail strip's
     * Moves chip jump target (the dex-f-* ids are JS-only —
     * getElementById + scrollIntoView, never hash anchors). */
    function movesHtml(moves) {
      var m = moves && typeof moves === 'object' ? moves : {};
      var levelUpRows = (Array.isArray(m.levelUp) ? m.levelUp : []).map(function (p) {
        var name = Array.isArray(p) ? p[0] : p;
        /* level 0 marks moves learned on evolving (the moves prose) */
        var level = Array.isArray(p) && typeof p[1] === 'number' ? p[1] : 0;
        return moveRowHtml(name, level);
      });
      var groupTable = function (rows) {
        return rows.length ? ROGUE.table(rows, MOVE_COLUMNS) : '<span class="dex-moves__none">\u2014</span>';
      };
      return (
        '<div class="dex-moves" id="dex-f-moves">' +
        '<div class="dex-moves__group"><span class="field-label">Level Up</span>' +
        groupTable(levelUpRows) +
        '</div>' +
        '<div class="dex-moves__group"><span class="field-label">TM &amp; TR</span>' +
        groupTable((Array.isArray(m.tm) ? m.tm : []).map(function (n) {
          return moveRowHtml(n, null);
        })) +
        '</div>' +
        '<div class="dex-moves__group"><span class="field-label">Tutor</span>' +
        groupTable((Array.isArray(m.tutor) ? m.tutor : []).map(function (n) {
          return moveRowHtml(n, null);
        })) +
        '</div>' +
        '</div>'
      );
    }

    /* One detail field block. The optional third `id` is the detail
     * strip's jump target (the dex-f-* ids — JS-only, never hash
     * anchors). */
    function fieldBlock(label, inner, id) {
      return (
        '<div class="dex-species__field"' +
        (id ? ' id="' + id + '"' : '') +
        '><span class="field-label">' +
        label +
        '</span>' +
        inner +
        '</div>'
      );
    }

    /**
     * One .dex-form block (issue #85): the form's sprite — a
     * .dex-form__sprite img whose src is formSpriteSrc(form, record)
     * (the form's own <formEntryId>.png, else the base record's
     * sprite) — then the display-face form name, the form's type
     * chips (deduped the same way as the base types), its stat rows —
     * the shared statRowsHtml() in the same .dex-stats box the base
     * stats use, so the BST row is last — its abilities (the in-game
     * display rule mirrored by the shared abilitiesHtml() — consecutive
     * duplicates render once), its
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
      if (abilities.length) html += abilitiesHtml(abilities);
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

      /* The detail's OWN .section-nav strip (reopened #98 — the owner
       * had to scroll through up to 292 move rows to see a species'
       * forms): one action chip (button.chip[data-target="dex-f-…"] —
       * ROGUE.sectionNav's `target` item, NO anchors) per PRESENT
       * section, in body order, built from the same computed values
       * the body below renders (the guards mirror the render guards,
       * so a chip never points at an absent field). The jump is
       * bindDetailNav's ONE delegated click listener (scrollIntoView,
       * no behavior arg — the CSS-gated motion) — the hash is NEVER
       * written (the detail's hash contract is #rec-pokedex-<id>; any
       * other hash would drop back to the overview). A child of the
       * article → sticky across the whole detail. */
      var evoField = evoHtml(record);
      var detailNavItems = [
        { id: 'dex-f-stats', label: 'Base stats', target: 'dex-f-stats' },
        { id: 'dex-f-abilities', label: 'Abilities', target: 'dex-f-abilities' }
      ];
      if (evoField) detailNavItems.push({ id: 'dex-f-evos', label: 'Evolutions', target: 'dex-f-evos' });
      if (forms.length) detailNavItems.push({ id: 'dex-f-forms', label: 'Forms', target: 'dex-f-forms' });
      detailNavItems.push(
        { id: 'dex-f-moves', label: 'Moves', target: 'dex-f-moves' },
        { id: 'dex-f-variants', label: 'Included in', target: 'dex-f-variants' }
      );
      if (ride.length) detailNavItems.push({ id: 'dex-f-ride', label: 'Ride', target: 'dex-f-ride' });
      if (notes.length) detailNavItems.push({ id: 'dex-f-notes', label: 'Notes', target: 'dex-f-notes' });
      html += ROGUE.sectionNav(detailNavItems, 'Species page sections');

      html += '<div class="dex-species__body">';
      html += fieldBlock('Base stats', '<div class="dex-stats">' + statRowsHtml(stats) + '</div>', 'dex-f-stats');
      /* the issue-#100 stat radar (PR 4b) — under the stat bars, per
       * the plan: the 6-axis spider of this entry's (version-scoped)
       * stats, with the compare typeahead (issue #110) */
      html += radarHtml(record);
      html += fieldBlock('Details', '<div class="dex-meta">' + metaHtml(record) + '</div>');
      if (description) html += '<p class="dex-desc">' + ROGUE.esc(description) + '</p>';
      html += fieldBlock('Abilities', abilitiesHtml(abilities), 'dex-f-abilities');
      html += evoField;
      /* the structured forms field sits ABOVE the move groups
       * (reopened #98 — seeing the forms must not require scrolling
       * through the move tables); id="dex-f-forms" serves the strip's
       * Forms chip */
      if (forms.length) html += fieldBlock('Forms', formsHtml(forms, record), 'dex-f-forms');
      html += movesHtml(moves);
      html += fieldBlock(
        'Included in',
        variants === 'all'
          ? '<div class="chip-row">' + ROGUE.chip(variantCount() ? 'All ' + variantCount() + ' variants' : 'All variants') + '</div>'
          : '<div class="chip-row">' + (Array.isArray(variants) ? variants : []).map(ROGUE.chip).join('') + '</div>',
        'dex-f-variants'
      );
      if (ride.length) html += fieldBlock('Ride', '<div class="chip-row">' + ride.map(ROGUE.chip).join('') + '</div>', 'dex-f-ride');
      if (notes.length) {
        html += fieldBlock(
          'Notes',
          '<ul class="dex-notes">' + notes.map(function (n) {
            return '<li>' + ROGUE.esc(n) + '</li>';
          }).join('') + '</ul>',
          'dex-f-notes'
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
      /* the issue-#100 type matchup heatmap (PR 4b) — the new overview
       * section AFTER the prose blocks (the 7th .section-nav chip) */
      html += typechartSection();
      html += '</div>';
      if (selected) html += speciesSection(selected);

      main.innerHTML = html;
      /* measure the sticky offsets BEFORE anything scrolls: a
       * load-time deep link's panel.scrollIntoView() below must see
       * the measured clearances (the pre-measurement CSS fallbacks
       * err lower — the deep link would land tucked under the header
       * on the first render otherwise). Every render re-measures so
       * the values track the bar / strips as the detail opens and
       * closes — a hidden bar or strip has offsetHeight 0 and its
       * guard keeps the last visible value. */
      setBrowseTop();
      bindToolbar();
      /* The issue-#100 visualisations (PR 4b): the typechart renders
       * with the overview on every render (hidden — but present —
       * while the detail is open, so its bindings run regardless);
       * the radar exists only while a detail is open. */
      bindTypechart();
      if (selected) bindRadar(selected);
      if (selected) bindDetailNav();
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
          : state.type !== 'all'
            ? 'No ' + ROGUE.versionLabel(ROGUE.version) + ' ' + ROGUE.esc(state.type) + '-type species in ' + ROGUE.esc(state.region) + '.'
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

    /* Listeners on the toolbar (search input, region buttons, the
     * variant/sort/type selects) — bound on the full render only; they
     * keep the input alive by refreshing just the browse end state
     * (updateBrowse), never re-rendering main. */
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
      var sort = document.getElementById('dex-sort');
      if (sort) {
        /* same read-back rule as the variant select: the fresh markup's
         * selected option comes from state.sort, and reading the value
         * back (normalized) makes the select authoritative */
        state.sort = normSort(sort.value);
        sort.addEventListener('change', function () {
          state.sort = normSort(sort.value);
          state.page = 1;
          updateBrowse();
        });
      }
      var type = document.getElementById('dex-type');
      if (type) {
        /* "all" or one of the active build's typeChart options (the
         * markup was built from typeOptions(), so an out-of-list value
         * can only come from a stale DOM — it falls back to "all") */
        state.type = type.value === 'all' || typeOptions().indexOf(type.value) !== -1 ? type.value : 'all';
        type.addEventListener('change', function () {
          state.type = type.value === 'all' || typeOptions().indexOf(type.value) !== -1 ? type.value : 'all';
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
     * 16px — the sticky offset the .section-nav strip (issue #98)
     * pins at, just under the bar; plus
     * --dex-section-clear = header + the bar + the strip's rendered
     * offsetHeight + 16px — the scroll-margin-top the overview's
     * sections (the #dex-browse section + the four prose blocks) use
     * so hash-navigated targets land BELOW the sticky header AND the
     * sticky bar AND the strip. The bar's height varies with the
     * viewport (the 10
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
     * first overview render). The detail's own strip (reopened #98)
     * adds
     * --dex-detail-clear = header + the detail strip's rendered
     * offsetHeight + 16px — the scroll-margin-top the detail's dex-f-*
     * fields use so the strip's action chips land BELOW the pinned
     * detail strip. Measured while the detail is open (the last
     * visible value persists while it is closed — the variable is only
     * read in the detail context); the detail's deep-link target (the
     * .dex-species article) keeps a header-only clearance — the bar
     * and the overview strip are hidden while the detail is open, and
     * the detail strip itself sits inside the article, below its top
     * edge.
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
        /* the strip sits inside the #dex-browse section (between the bar
         * and the grid), so it is visible exactly when the bar is */
        var strip = document.querySelector('#dex-overview .section-nav');
        if (strip && strip.offsetParent !== null) {
          main.style.setProperty('--dex-section-clear', (top + bar.offsetHeight + strip.offsetHeight + 16) + 'px');
        }
      }
      /* the detail's own strip (reopened #98) — visible exactly when
       * the detail is open (the mirror of the bar's guard): its
       * measured clearance is the scroll target of the strip's action
       * chips (the dex-f-* fields must land BELOW the pinned strip).
       * The last visible value persists while the detail is closed —
       * the variable is only read in the detail context. */
      var detailStrip = document.querySelector('#dex-species .section-nav');
      if (detailStrip && detailStrip.offsetParent !== null) {
        main.style.setProperty('--dex-detail-clear', (top + detailStrip.offsetHeight + 16) + 'px');
      }
    }

    /* The detail's section strip (reopened #98): ONE delegated click
     * listener on the strip (a fresh element per render — the house
     * pattern of bindRadar / bindTypechart). The chips are the
     * ROGUE.sectionNav `target` action chips (button.chip[data-target]
     * — NO anchors), so the jump is getElementById(target).
     * scrollIntoView() with NO behavior argument: the site's
     * scroll-behavior is CSS-gated (base.css — smooth under
     * no-preference, forced auto under reduce), the jump is
     * reduced-motion-safe by construction, and the URL hash is NEVER
     * written (the detail's contract is #rec-pokedex-<id>; any other
     * hash would drop the page back to the overview). */
    function bindDetailNav() {
      var strip = document.querySelector('#dex-species .section-nav');
      if (!strip) return;
      strip.addEventListener('click', function (e) {
        var t = e.target;
        var target = t && t.getAttribute ? t.getAttribute('data-target') : null;
        /* a click on a child of the chip (e.g. a count span, if one
         * were ever added) walks up one level to it */
        if (!target && t && t.parentNode && t.parentNode.getAttribute) {
          target = t.parentNode.getAttribute('data-target');
        }
        if (!target) return;
        var el = document.getElementById(target);
        if (el) el.scrollIntoView();
      });
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
     * overview); the query, region, variant, sort and selection survive
     * — the sort is version-independent (its keys read through
     * dexVariant, so "bst-desc" under Vanilla sorts by the Vanilla
     * stats) — except the variant and the issue-#100 type filter when
     * the new build's option list (the variant's per-build options;
     * the typeChart's per-build standard types) no longer offers the
     * selection (e.g. the EX-only "Modern" variant or Fairy under
     * Vanilla), which resets to "all". */
    ROGUE.onChange(function () {
      if (state.variant !== 'all' && variantOptions().indexOf(state.variant) === -1) state.variant = 'all';
      if (state.type !== 'all' && typeOptions().indexOf(state.type) === -1) state.type = 'all';
      /* the issue-#100 visualisation selections (PR 4b) reset by the
       * same rule as the filters: an EX-only compare/species record
       * under Vanilla, or a pinned column (e.g. Fairy) the new build's
       * chart lacks */
      if (state.radarCompare && (!byId[state.radarCompare] || byId[state.radarCompare].versions.indexOf(ROGUE.version) === -1)) state.radarCompare = null;
      if (state.tcSpecies && (!byId[state.tcSpecies] || byId[state.tcSpecies].versions.indexOf(ROGUE.version) === -1)) state.tcSpecies = null;
      if (state.tcCol !== null && typeOptions().indexOf(state.tcCol) === -1) state.tcCol = null;
      render();
    });
  });
})();

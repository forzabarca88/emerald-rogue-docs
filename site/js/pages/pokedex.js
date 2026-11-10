/*
 * pages/pokedex.js — the full species dex from data/pokedex.json.
 *
 * The data file is a LAZY chunk (meta.lazy): dist/data/pokedex.js loads
 * only on this page, never into the bundle the other nine pages share
 * (the 1025 records are a multi-megabyte file). The page recreates the
 * in-game Pokedex (src/rogue_pokedex.c) as two views of one page:
 *
 *   1. the overview view (#dex-overview) — the four prose sections,
 *      then the toolbar (an on-page .search filter + a region filter
 *      whose selection survives version re-renders, derived like
 *      routes.js), the live #dex-count line ("<N> species · page <x>
 *      of <y>"), and the .dex-grid: exactly site.json dex.pageSize
 *      (28 — the in-game Overview's tile page) .dex-tile <a> links per
 *      page, each a lazy-loaded sprite (onerror → the placeholder tile
 *      showing the dex number in mono) + the active version's #NNN.
 *      The .dex-pager (prev / next buttons + "page X of Y") pages the
 *      list; any filter change (search or region) resets to page 1.
 *   2. the species detail view (#dex-species) — rendered only while a
 *      selection exists; the .dex-species panel's root carries
 *      id = ROGUE.recId('pokedex', record.id) (the issue-#45 deep-link
 *      scheme, #rec-pokedex-<id>): the pixelated sprite, the name, the
 *      version badge, the #NNN chip, the type chips, the category, the
 *      seven stat rows with value bars (width = value/255 capped, BST
 *      row last), the meta rows (catch rate / height / weight / gender
 *      / egg groups / base EXP), the Pokédex text, the abilities, the
 *      .dex-evo evolution line (prev / current / next — the neighbors
 *      are hash links with mono method captions, the "easy to navigate"
 *      requirement; a target missing from the active build renders as a
 *      plain non-link cell), the three move groups (Level Up as
 *      "Name (Lv n)" chips — level 0 renders "(Evo)" per the moves
 *      prose — / TM & TR / Tutor), the forms chips, the "Included in"
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
 * the detail back, if the toggle returns). The region selection and the
 * query survive re-renders, like routes.js / quests.js.
 *
 * The on-page search filters the same lowercased haystack the
 * site-wide palette indexes — ROGUE.pokedexSearchText(record)
 * (search-index.js, loaded before this page script; the union of name,
 * dex number, category, both variants' types, description, region, all
 * move names, forms, variant names, ride, notes — strings only, bare
 * stat numbers out). The palette's pokedex entry `text` and this
 * on-page filter are the SAME string (the issue-#50 on-page/palette
 * parity for the dex).
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

    /* Surviving state: the query and region filter persist across
     * version re-renders (quests.js / routes.js pattern); the page
     * clamps itself when a version change shrinks the list; the
     * selection (a record id from the URL hash) persists so an
     * EX-only species that is hidden under Vanilla comes back with
     * the detail when the toggle returns. */
    var state = {
      query: '',
      region: 'all',
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
     * The active version's dex-variant count for the "All N variants"
     * chip: the settings.json range-pokedex-variant record's
     * optionsByVersion list for the active build (7 Vanilla / 37 EX —
     * the same counts the-dex prose documents). 0 when the record is
     * absent, so the label degrades to "All variants".
     */
    function variantCount() {
      try {
        var settings = ROGUE.data('settings');
        var list = Array.isArray(settings.records) ? settings.records : [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          if (r && r.id === 'range-pokedex-variant' && r.optionsByVersion && Array.isArray(r.optionsByVersion[ROGUE.version])) {
            return r.optionsByVersion[ROGUE.version].length;
          }
        }
      } catch (e) {
        /* settings absent — the label degrades to "All variants" */
      }
      return 0;
    }

    /** The (version-scoped, region-filtered, query-filtered) list, in data order. */
    function filteredList() {
      var q = state.query.trim().toLowerCase();
      return ROGUE.filter(records).filter(function (r) {
        if (state.region !== 'all' && r.region !== state.region) return false;
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

      return ROGUE.section(
        'dex-browse',
        'Overview',
        'Browse the ' + ROGUE.versionLabel(ROGUE.version) + ' dex',
        'As the in-game Overview draws it — ' + pageSize + ' tiles a page. Open a tile for the full entry, or search and filter first.',
        '<div class="dex-toolbar">' +
        '<div class="search dex-search"><input type="search" id="dex-search" placeholder="Search species" aria-label="Search species"></div>' +
        '<div class="dex-filter" role="group" aria-label="Filter species by region">' +
        filterBtns +
        '</div>' +
        '</div>' +
        '<p class="dex-count" id="dex-count" role="status"></p>' +
        '<div class="dex-grid" id="dex-grid"></div>' +
        '<p class="dex-empty" id="dex-empty" hidden></p>' +
        '<nav class="dex-pager" id="dex-pager" aria-label="Dex pages"></nav>'
      );
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
     * method caption between it and the current species; a neighbor
     * that does not exist in the active build (e.g. a Gen 4 pre-ev of
     * a Vanilla species) renders as a plain, non-link cell instead of
     * a dead link.
     */
    function evoHtml(record) {
      var evo = dexVariant(record, 'evo');
      if (!evo || typeof evo !== 'object') return '';
      var inBuild = function (id) {
        var rec = byId[id];
        return rec && rec.versions && rec.versions.indexOf(ROGUE.version) !== -1;
      };
      var cell = function (id) {
        var rec = byId[id];
        if (!rec) return '';
        var name = ROGUE.esc(dexVariant(rec, 'name'));
        if (inBuild(id)) {
          return '<a class="dex-evo__cell dex-evo__link" href="#' + ROGUE.esc(ROGUE.recId('pokedex', id)) + '"><span class="dex-evo__name">' + name + '</span></a>';
        }
        return '<span class="dex-evo__cell dex-evo__cell--absent"><span class="dex-evo__name">' + name + '</span></span>';
      };
      var method = function (text) {
        return '<span class="dex-evo__method">\u2192 ' + ROGUE.esc(text) + '</span>';
      };
      var parts = [];
      if (evo.prev && evo.prev.id) {
        parts.push(cell(evo.prev.id));
        if (evo.prev.method) parts.push(method(evo.prev.method));
      }
      parts.push('<span class="dex-evo__cell dex-evo__cell--current"><span class="dex-evo__name">' + ROGUE.esc(dexVariant(record, 'name')) + '</span></span>');
      if (evo.next && evo.next.id) {
        if (evo.next.method) parts.push(method(evo.next.method));
        parts.push(cell(evo.next.id));
      }
      return '<div class="dex-species__field"><span class="field-label">Evolutions</span><div class="dex-evo">' + parts.join('') + '</div></div>';
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
        '<img class="dex-species__sprite" src="' + ROGUE.esc(spriteSrc(record)) + '" alt="' + ROGUE.esc(name) + '" width="128" height="128">' +
        '<div class="dex-species__id">' +
        '<h2>' + ROGUE.esc(name) + '</h2>' +
        '<div class="dex-species__badges">' + ROGUE.badge(record) + '<span class="chip">#' + record.dexNum + '</span></div>' +
        (types.length ? '<div class="chip-row dex-species__types">' + types.map(ROGUE.chip).join('') + '</div>' : '') +
        (category ? '<p class="dex-species__category">' + ROGUE.esc(category) + '</p>' : '') +
        '</div>' +
        '</div>';

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
      if (forms.length) html += fieldBlock('Forms', '<div class="chip-row">' + forms.map(ROGUE.chip).join('') + '</div>');
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
      html += ROGUE.proseSections(data.prose);
      html += browseSection();
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
        if (panel) panel.scrollIntoView();
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
          : 'No ' + ROGUE.versionLabel(ROGUE.version) + ' species in ' + state.region + '.';
      }
      count.textContent = list.length + ' species \u00B7 page ' + state.page + ' of ' + pages;
      pager.innerHTML = pagerInner(pages);
      bindBrowse();
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

    /* Listeners on the toolbar (search input + region buttons) — bound on
     * the full render only; they keep the input alive by refreshing just
     * the browse end state (updateBrowse), never re-rendering main. */
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
    }

    /* --- wiring ------------------------------------------------------------- */

    state.selection = hashSelection();
    render();

    /* A #rec-pokedex-<id> hash selects that species; any other hash —
     * including the empty one — returns to the overview. */
    window.addEventListener('hashchange', function () {
      state.selection = hashSelection();
      render();
    });

    /* Version changes re-render (the grid re-scopes, the sprites and
     * per-version fields flip, an EX-only selection clears to the
     * overview); the query, region and selection survive. */
    ROGUE.onChange(render);
  });
})();

/*
 * pages/routes.js — the route system from data/routes.json.
 *
 * Sections:
 *   1. The naming-scheme explainer (prose)
 *   2. In-page anchor-chip nav
 *   3. Route types — the terrain taxonomy (prose) + a chip row of the
 *      terrains present in the table (derived from the records)
 *   4. Calm / average / tough sub-types (prose)
 *   5. The 36 routes — region-grouped card grids with an All / region
 *      filter (the selection survives a version re-render); each card
 *      carries its terrain, its active version's wild types as .chip
 *      tags (the six FAIRY-swap routes re-read the Vanilla variant from
 *      their `differences`), its drop rarity, its version badge and a
 *      per-version difference note
 *   6. How routes appear on the adventure path (prose)
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('routes');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var records = Array.isArray(data.records) ? data.records : [];
    var pages = site.pages || {};

    /* the active region filter — survives a version re-render */
    var state = { region: 'all' };
    var totalRoutes = 0;
    var regionCount = 0;

    /** Unique non-empty string values for a record key, in data order. */
    function uniqueValues(key) {
      var out = [];
      records.forEach(function (r) {
        if (r && typeof r[key] === 'string' && out.indexOf(r[key]) === -1) out.push(r[key]);
      });
      return out;
    }

    /**
     * Active version's wild types. The record's top-level `type` is the
     * EX variant; for Vanilla the FAIRY-swap routes re-read their variant
     * from differences.vanilla ("Wild types: A, B, C.").
     */
    function effectiveTypes(record) {
      if (
        ROGUE.version === 'vanilla' &&
        record.differences &&
        typeof record.differences.vanilla === 'string'
      ) {
        var m = record.differences.vanilla.match(/Wild types:\s*([^.;]+)/i);
        if (m) {
          var types = m[1].split(',').map(function (t) {
            return t.trim();
          }).filter(Boolean);
          if (types.length === 3) return types;
        }
      }
      return Array.isArray(record.type) ? record.type : [];
    }

    function routeCard(record) {
      var tags = [];
      if (record.terrain) tags.push(ROGUE.chip(record.terrain));
      effectiveTypes(record).forEach(function (t) {
        tags.push(ROGUE.chip(t));
      });
      if (typeof record.dropRarity === 'number') tags.push(ROGUE.chip('Drop +' + record.dropRarity));

      var html = '<article class="card route-card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        ROGUE.badge(record) +
        '</div>';
      html += '<div class="chip-row route-card__chips">' + tags.join('') + '</div>';
      html += ROGUE.diffNote(record);
      if (record.source) html += '<p class="card__source">' + ROGUE.esc(record.source) + '</p>';
      return html + '</article>';
    }

    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc((pages.routes || {}).title || 'Routes') + '</h1>';

      /* The naming scheme. */
      var naming = ROGUE.proseById(data, 'naming-scheme');
      if (naming) html += ROGUE.section('routes-naming', 'Naming scheme', naming.heading, null, ROGUE.paragraphs(naming.text));

      /* Anchor-chip nav. */
      var nav = [
        { id: 'routes-naming', label: 'Naming' },
        { id: 'routes-types', label: 'Types' },
        { id: 'routes-subtypes', label: 'Sub-types' },
        { id: 'routes-table', label: 'The ' + records.length + ' routes' },
        { id: 'routes-path', label: 'On the path' }
      ];
      html +=
        '<nav class="routes-chips" aria-label="Routes sections">' +
        nav
          .map(function (n) {
            return '<a class="chip" href="#' + ROGUE.esc(n.id) + '">' + ROGUE.esc(n.label) + '</a>';
          })
          .join('') +
        '</nav>';

      /* Terrain taxonomy + the terrains present in the table. */
      var tax = ROGUE.proseById(data, 'type-taxonomy');
      var terrains = uniqueValues('terrain');
      html +=
        ROGUE.section(
          'routes-types',
          'Terrain',
          tax ? tax.heading : 'Route types and wild Pokémon',
          null,
          (tax ? ROGUE.paragraphs(tax.text) : '') +
            (terrains.length
              ? '<p class="field-label routes-terrains">Terrains in the table</p><div class="chip-row">' +
                terrains.map(ROGUE.chip).join('') +
                '</div>'
              : '')
        );

      /* Calm / average / tough sub-types. */
      var sub = ROGUE.proseById(data, 'calm-average-tough');
      if (sub) html += ROGUE.section('routes-subtypes', 'Sub-types', sub.heading, null, ROGUE.paragraphs(sub.text));

      /* The route table, grouped by region with a region filter. */
      var regions = uniqueValues('region');
      regionCount = regions.length;
      var kept = ROGUE.filter(records);
      totalRoutes = kept.length;

      var filterBtns =
        '<button type="button" class="chip routes-filter__btn" data-region="all" aria-pressed="' +
        (state.region === 'all') +
        '">All</button>' +
        regions
          .map(function (r) {
            return (
              '<button type="button" class="chip routes-filter__btn" data-region="' +
              ROGUE.esc(r) +
              '" aria-pressed="' +
              (state.region === r) +
              '">' +
              ROGUE.esc(r) +
              '</button>'
            );
          })
          .join('');

      var groups = regions
        .map(function (r) {
          var items = kept.filter(function (rec) {
            return rec.region === r;
          });
          if (!items.length) return '';
          return (
            '<div class="routes-region" data-region="' +
            ROGUE.esc(r) +
            '"><h3 class="routes-region__title">' +
            ROGUE.esc(r) +
            ' <span class="routes-region__count">' +
            items.length +
            '</span></h3><div class="grid routes-region__grid">' +
            items.map(routeCard).join('') +
            '</div></div>'
          );
        })
        .join('');

      html +=
        ROGUE.section(
          'routes-table',
          'Route table',
          'The ' + kept.length + ' routes',
          'Grouped by region. The chips on each card are its terrain, its ' +
            ROGUE.versionLabel(ROGUE.version) +
            ' wild types and its item drop rarity bonus.',
          '<div class="routes-filter" role="group" aria-label="Filter routes by region">' +
            filterBtns +
            '</div>' +
            '<p class="routes-count" id="routes-count" role="status"></p>' +
            groups
        );

      /* How routes appear on the adventure path. */
      var pathProse = ROGUE.proseById(data, 'on-the-path');
      if (pathProse) html += ROGUE.section('routes-path', 'The adventure path', pathProse.heading, null, ROGUE.paragraphs(pathProse.text));

      main.innerHTML = html;
      applyRegion();

      document.querySelectorAll('.routes-filter__btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.region = btn.getAttribute('data-region');
          applyRegion();
        });
      });
    }

    /** Show/hide region blocks + update the count line (no re-render). */
    function applyRegion() {
      var visible = 0;
      document.querySelectorAll('.routes-filter__btn').forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('data-region') === state.region));
      });
      document.querySelectorAll('.routes-region').forEach(function (g) {
        var show = state.region === 'all' || g.getAttribute('data-region') === state.region;
        g.hidden = !show;
        if (show) visible += g.querySelectorAll('.route-card').length;
      });
      var line = document.getElementById('routes-count');
      if (line) {
        line.textContent =
          state.region === 'all'
            ? totalRoutes + ' routes across all ' + regionCount + ' regions'
            : visible + ' routes in ' + state.region;
      }
    }

    /* Version changes re-render (wild types + difference notes follow the
     * active version); the region filter is kept. */
    render();
    ROGUE.onChange(render);
  });
})();

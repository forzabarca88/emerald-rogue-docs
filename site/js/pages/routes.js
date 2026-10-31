/*
 * pages/routes.js — the route system from data/routes.json.
 *
 * Sections:
 *   1. The naming-scheme explainer (prose)
 *   2. In-page anchor-chip nav
 *   3. Route types — the terrain taxonomy (prose) + a chip row of the
 *      terrains present in the table (derived from the records)
 *   4. Calm / average / tough sub-types — the trimmed prose plus two
 *      visuals rendered from the block's structured `roll` / `values`
 *      fields (issue #31): a two-phase stacked probability bar for the
 *      roll (one bar per boss-difficulty phase, segments in the roll
 *      weights' proportions, mono weight labels) and a 3-column
 *      comparison strip (calm | average | tough, one row per tuned value)
 *   5. The 36 routes — a region × terrain count matrix above the
 *      region-grouped card grids with an All / region filter (the
 *      selection survives a version re-render); each card carries its
 *      terrain, its active version's wild types as .chip tags (the six
 *      FAIRY-swap routes re-read the Vanilla variant from their
 *      `differences`), its drop rarity, its version badge and a
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
     * from the differences.vanilla STRING note ("Wild types: A, B, C.").
     * This string parse is route-specific — generic structured-
     * difference resolution lives in ROGUE.effective (site/js/render.js).
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
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /**
     * The canonical terrain columns for the matrix — the six named
     * terrain types from the type-taxonomy block's structured `terrains`
     * field (re-encoded from the trimmed prose). If it is ever removed
     * the matrix falls back to the terrains present in the records
     * (which then also include the seventh "Island" terrain).
     */
    function canonicalTerrains(tax, presentTerrains) {
      var list = tax && Array.isArray(tax.terrains) ? tax.terrains : [];
      var out = [];
      list.forEach(function (t) {
        if (typeof t === 'string' && t && out.indexOf(t) === -1) out.push(t);
      });
      return out.length ? out : presentTerrains;
    }

    /* --- The calm / average / tough visual (issue #31) ------------------
     * Both visuals render from the calm-average-tough prose block's
     * structured `roll` / `values` fields — a re-encoding of the numbers
     * the trimmed prose used to carry. Sub-type hues: calm = emerald,
     * average = the both-mix, tough = gold (existing tokens only). The
     * stacked bars are decorative (aria-hidden) — the phase labels, the
     * legend and the captions carry the same meaning for screen readers. */

    function catLegend() {
      return (
        '<div class="cat-roll__legend">' +
        ['calm', 'average', 'tough']
          .map(function (k) {
            return (
              '<span class="cat-roll__legend-item">' +
              '<span class="cat-roll__swatch cat-roll__swatch--' + k + '"></span>' +
              k +
              '</span>'
            );
          })
          .join('') +
        '</div>'
      );
    }

    function catRollVisual(sub) {
      var roll = (sub && Array.isArray(sub.roll) ? sub.roll : []).filter(function (p) {
        return (
          p &&
          typeof p.phase === 'string' &&
          typeof p.calm === 'number' &&
          typeof p.average === 'number' &&
          typeof p.tough === 'number' &&
          p.calm + p.average + p.tough > 0
        );
      });
      var rows = roll
        .map(function (p) {
          var total = p.calm + p.average + p.tough;
          if (!(total > 0)) return null;
          var segs = ['calm', 'average', 'tough']
            .map(function (k) {
              if (!p[k]) return '';
              return (
                '<span class="cat-roll__seg cat-roll__seg--' +
                k +
                '" style="width:' +
                (100 * p[k]) / total +
                '%">' +
                '<span class="cat-roll__num">' + p[k] + '</span>' +
                '</span>'
              );
            })
            .join('');
          return (
            '<div class="cat-roll__row">' +
            '<span class="cat-roll__phase">' + ROGUE.esc(p.phase) + '</span>' +
            '<div class="cat-roll__bar" aria-hidden="true">' +
            segs +
            '</div>' +
            '</div>'
          );
        })
        .filter(Boolean)
        .join('');
      if (!rows) return '';
      return (
        '<figure class="cat-roll">' +
        catLegend() +
        rows +
        '<figcaption class="cat-roll__caption">' +
        ROGUE.esc(
          'Every Route room rolls its sub-type from these weights — ' +
            roll
              .map(function (p) {
                return 'calm ' + p.calm + ' / average ' + p.average + ' / tough ' + p.tough + ' at ' + p.phase;
              })
              .join(', then ') +
            ' — so tough routes dominate the late game.'
        ) +
        '</figcaption>' +
        '</figure>'
      );
    }

    function catStripVisual(sub) {
      var values = sub && Array.isArray(sub.values) ? sub.values : [];
      var rows = values
        .map(function (v) {
          if (
            !v ||
            typeof v.label !== 'string' ||
            typeof v.calm !== 'string' ||
            typeof v.average !== 'string' ||
            typeof v.tough !== 'string'
          )
            return null;
          return (
            '<div class="cat-strip__row">' +
            '<span class="cat-strip__label">' + ROGUE.esc(v.label) + '</span>' +
            ['calm', 'average', 'tough']
              .map(function (k) {
                return (
                  '<span class="cat-strip__val cat-strip__val--' +
                  k +
                  '"><span class="cat-roll__swatch cat-roll__swatch--' +
                  k +
                  '"></span>' +
                  ROGUE.esc(v[k]) +
                  '</span>'
                );
              })
              .join('') +
            '</div>'
          );
        })
        .filter(Boolean)
        .join('');
      if (!rows) return '';
      return (
        '<figure class="cat-strip">' +
        '<div class="cat-strip__head">' +
        '<span class="cat-strip__cell"></span>' +
        ['calm', 'average', 'tough']
          .map(function (k) {
            return (
              '<span class="cat-strip__cell cat-strip__cell--' +
              k +
              '"><span class="cat-roll__swatch cat-roll__swatch--' +
              k +
              '"></span>' +
              k +
              '</span>'
            );
          })
          .join('') +
        '</div>' +
        rows +
        '<figcaption class="cat-strip__caption">' +
        'What the sub-type tunes, read calm → average → tough: encounter counts, trainer spawn chance, item drop chance and rarity, and the chance of themed weather.' +
        '</figcaption>' +
        '</figure>'
      );
    }

    /* --- The region × terrain matrix (issue #31) -------------------------
     * One row per region (data order), a cell per canonical terrain (the
     * route count) and a row-total column — the totals add up to all 36
     * routes. The grid is decorative (aria-hidden); the figcaption
     * carries the same meaning for screen readers, including the Sinnoh
     * routes that carry no terrain class and the seventh "Island"
     * terrain beyond the six matrix columns. */
    function routeMatrix(terrains) {
      var regions = uniqueValues('region');
      var rows = regions.map(function (r) {
        var items = records.filter(function (rec) {
          return rec.region === r;
        });
        return {
          region: r,
          cells: terrains.map(function (t) {
            return items.filter(function (rec) {
              return rec.terrain === t;
            }).length;
          }),
          total: items.length
        };
      });
      if (!rows.length || !terrains.length) return '';

      /* the grid template is per-data (6 terrain columns from the
         structured field, or 7 under the fallback to the terrains
         present in the records) */
      var gridCols =
        'grid-template-columns:minmax(0,1.3fr) ' +
        terrains
          .map(function () {
            return 'minmax(0,1fr)';
          })
          .join(' ') +
        ' minmax(0,1.2fr)';

      var head =
        '<span class="route-matrix__cell route-matrix__cell--head route-matrix__cell--label"></span>' +
        terrains
          .map(function (t) {
            return (
              '<span class="route-matrix__cell route-matrix__cell--head" data-terrain="' +
              ROGUE.esc(t) +
              '">' +
              ROGUE.esc(t) +
              '</span>'
            );
          })
          .join('') +
        '<span class="route-matrix__cell route-matrix__cell--head route-matrix__cell--total">Total</span>';

      var body = rows
        .map(function (row) {
          return (
            '<div class="route-matrix__row route-matrix__row--region" style="' + gridCols + '">' +
            '<span class="route-matrix__cell route-matrix__cell--label">' +
            ROGUE.esc(row.region) +
            '</span>' +
            row.cells
              .map(function (n, i) {
                return (
                  '<span class="route-matrix__cell" data-terrain="' +
                  ROGUE.esc(terrains[i]) +
                  '">' +
                  n +
                  '</span>'
                );
              })
              .join('') +
            '<span class="route-matrix__cell route-matrix__cell--total">' + row.total + '</span>' +
            '</div>'
          );
        })
        .join('');

      var captionParts = [
        'Routes of each terrain by region — ' +
          rows
            .map(function (row) {
              return row.total + ' ' + row.region;
            })
            .join(', ') +
          ', ' +
          records.length +
          ' in all.'
      ];
      var noTerrain = records.filter(function (r) {
        return !r.terrain;
      });
      var offCol = records.filter(function (r) {
        return r.terrain && terrains.indexOf(r.terrain) === -1;
      });
      if (noTerrain.length) {
        var ntRegions = uniqueValues('region').filter(function (r) {
          return noTerrain.some(function (x) {
            return x.region === r;
          });
        });
        var ntTotal =
          ntRegions.length === 1 ? rows.filter(function (row) { return row.region === ntRegions[0]; })[0].total : null;
        captionParts.push(
          noTerrain.length +
            (ntTotal ? ' of the ' + ntTotal + ' ' + ntRegions[0] : '') +
            ' routes are numbered real-route maps with no terrain class.'
        );
      }
      if (offCol.length) {
        captionParts.push(
          offCol
            .map(function (r) {
              return r.name;
            })
            .join(', ') +
          ' ' +
          (offCol.length === 1 ? 'rides' : 'ride') +
          ' a further "' +
          offCol[0].terrain +
          '" terrain beyond the matrix columns (the terrain chips above list them all).'
        );
      }
      var caption = captionParts.join(' ');

      return (
        '<figure class="route-matrix">' +
        '<div class="route-matrix__grid" aria-hidden="true">' +
        '<div class="route-matrix__row route-matrix__row--head" style="' + gridCols + '">' +
        head +
        '</div>' +
        body +
        '</div>' +
        '<figcaption class="route-matrix__caption">' +
        ROGUE.esc(caption) +
        '</figcaption>' +
        '</figure>'
      );
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
      var matrixTerrains = canonicalTerrains(tax, terrains);
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

      /* Calm / average / tough sub-types: trimmed prose + the two visuals
       * (the roll bar and the value strip) from the structured fields. */
      var sub = ROGUE.proseById(data, 'calm-average-tough');
      if (sub) {
        html +=
          ROGUE.section('routes-subtypes', 'Sub-types', sub.heading, null, ROGUE.paragraphs(sub.text)) +
          '<div class="routes-subtypes-visuals">' +
          catRollVisual(sub) +
          catStripVisual(sub) +
          '</div>';
      }

      /* The route table: region × terrain matrix, then the cards grouped
         by region with a region filter. */
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
          'The matrix counts each region’s routes by terrain, then the routes are grouped by region. The chips on each card are its terrain, its ' +
            ROGUE.versionLabel(ROGUE.version) +
            ' wild types and its item drop rarity bonus.',
          routeMatrix(matrixTerrains) +
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

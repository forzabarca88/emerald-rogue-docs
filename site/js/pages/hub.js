/*
 * pages/hub.js — the persistent hub town from data/hub.json.
 *
 * Sections:
 *   1. Intro prose (what the hub is / building areas and upgrades)
 *   2. In-page anchor-chip nav
 *   3. Areas — the 11 hub areas as cards (present-from-start / free to
 *      build / N Build Parts cost chip + the area code)
 *   4. Upgrades — the workbench upgrades as a searchable card grid
 *      (area, cost, requirements, version badge). Records whose
 *      behaviour differs per version (Treat Shop, Lab Unique Typings,
 *      Pokéblock Shop) drop the ambiguous cost/requirement meta and
 *      wear a "differs in <other version>" note instead.
 *   5. Wandering Pokémon + time/season prose
 *   6. Home styles & decor (the one version-split decor set)
 *   7. The hub in the run loop
 *
 * The .search filter narrows upgrades client-side by name / description /
 * area (the query survives a version re-render); version changes re-render
 * the page (every record exists in both builds, so the visible scoping is
 * the per-version differences notes flipping to the active version).
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('hub');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var records = Array.isArray(data.records) ? data.records : [];
    var prose = Array.isArray(data.prose) ? data.prose : [];
    var pages = site.pages || {};

    /* the active search query — survives a version re-render */
    var state = { query: '' };

    /** Plain record card: name, badge, description, diff note, source. */
    function simpleCard(record) {
      var html = '<article class="card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        ROGUE.badge(record) +
        '</div>';
      if (record.description) html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html += ROGUE.diffNote(record);
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    function areaCard(record) {
      var costChip = record.initiallyPresent
        ? ROGUE.chip('Present from the start')
        : typeof record.buildCost === 'number' && record.buildCost > 0
          ? ROGUE.chip(record.buildCost + ' Build Parts')
          : ROGUE.chip('Free to build');

      var html = '<article class="card area-card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        ROGUE.badge(record) +
        '</div>';
      if (record.description) html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html +=
        '<div class="chip-row area-card__meta">' +
        costChip +
        (record.code ? ROGUE.chip(record.code) : '') +
        '</div>';
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    function upgradeCard(record) {
      var diff = record.differences && typeof record.differences === 'object' ? record.differences : null;
      var meta = [];
      if (record.area) meta.push(ROGUE.chip(record.area));
      if (diff) {
        meta.push(ROGUE.chip('differs by version'));
      } else if (typeof record.cost === 'number' && record.cost > 0) {
        meta.push(ROGUE.chip(record.cost + ' Build Parts'));
      }
      if (record.code) meta.push(ROGUE.chip(record.code));

      var html =
        '<article class="card hub-upgrade" data-search="' +
        ROGUE.esc((record.name + ' ' + (record.description || '') + ' ' + (record.area || '')).toLowerCase()) +
        '">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        ROGUE.badge(record) +
        '</div>';
      if (record.description) html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html += '<div class="chip-row hub-upgrade__meta">' + meta.join('') + '</div>';
      if (!diff && Array.isArray(record.requirements) && record.requirements.length) {
        html +=
          '<p class="hub-upgrade__field"><span class="field-label">Requires</span><span class="chip-row">' +
          record.requirements.map(ROGUE.chip).join('') +
          '</span></p>';
      }
      html += ROGUE.diffNote(record);
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /* One render pass builds the whole page (string building + a single
     * innerHTML) — 60 cards must not be appended one by one. */
    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc((pages.hub || {}).title || 'Hub') + '</h1>';

      /* Intro prose (the first two entries introduce the page). */
      html += ROGUE.proseSections(
        prose.filter(function (p) {
          return p && (p.id === 'what-the-hub-is' || p.id === 'building-areas-and-upgrades');
        })
      );

      /* Anchor-chip nav across the page's sections. */
      var nav = [
        { id: 'hub-areas', label: 'Areas' },
        { id: 'hub-upgrades', label: 'Upgrades' },
        { id: 'hub-wander', label: 'Wander mons' },
        { id: 'hub-time', label: 'Time & seasons' },
        { id: 'hub-decor', label: 'Home decor' },
        { id: 'hub-loop', label: 'In the loop' }
      ];
      html +=
        '<nav class="hub-chips" aria-label="Hub sections">' +
        nav
          .map(function (n) {
            return '<a class="chip" href="#' + ROGUE.esc(n.id) + '">' + ROGUE.esc(n.label) + '</a>';
          })
          .join('') +
        '</nav>';

      /* The 11 hub areas. */
      var areas = ROGUE.filter(ROGUE.byCategory(records, 'hub-area'));
      html +=
        ROGUE.section(
          'hub-areas',
          'Areas',
          'The ' + areas.length + ' hub areas',
          null,
          '<div class="grid">' + areas.map(areaCard).join('') + '</div>'
        );

      /* The workbench upgrades (searchable). */
      var upgrades = ROGUE.filter(ROGUE.byCategory(records, 'hub-upgrade'));
      html +=
        ROGUE.section(
          'hub-upgrades',
          'Build shop',
          'Workbench upgrades (' + upgrades.length + ')',
          'Everything the build shop\u2019s Areas and Upgrades menus offer, searchable by name, description or area.',
          '<div class="search hub-search"><input type="search" id="hub-search" placeholder="Search upgrades by name, description or area" aria-label="Search upgrades by name, description or area"></div>' +
          '<p class="hub-result" id="hub-result" role="status">' + upgrades.length + ' upgrades</p>' +
          '<div class="grid hub-upgrades__grid">' +
            upgrades.map(upgradeCard).join('') +
            '</div>'
        );

      /* Wandering mons + time/season prose. */
      [
        ['wander-mons', 'hub-wander', 'Wandering Pokémon'],
        ['time-weather-season', 'hub-time', 'Hub clock']
      ].forEach(function (p) {
        var proseEntry = ROGUE.proseById(data, p[0]);
        if (proseEntry) {
          html += ROGUE.section(p[1], p[2], proseEntry.heading, null, ROGUE.paragraphs(proseEntry.text));
        }
      });

      /* Home styles & decor. */
      var decor = ROGUE.filter(ROGUE.byCategory(records, 'home-decor'));
      if (decor.length) {
        html +=
          ROGUE.section(
            'hub-decor',
            'Home Base',
            'Home styles & decor',
            null,
            '<div class="grid">' + decor.map(simpleCard).join('') + '</div>'
          );
      }

      /* The hub in the run loop. */
      var loop = ROGUE.proseById(data, 'hub-in-the-loop');
      if (loop) html += ROGUE.section('hub-loop', 'The loop', loop.heading, null, ROGUE.paragraphs(loop.text));

      /* capture the live query before the DOM (and its input) is replaced */
      state.query = inputKeep();
      main.innerHTML = html;
      bindSearch(upgrades.length);
    }

    /* The query survives a version re-render (read back from the live
     * input before it is replaced). */
    function inputKeep() {
      var el = document.getElementById('hub-search');
      return el ? el.value : '';
    }

    /** Client-side filter over the precomputed card search index. */
    function bindSearch(total) {
      var input = document.getElementById('hub-search');
      var line = document.getElementById('hub-result');
      if (!input || !line) return;

      input.value = state.query;
      var cards = Array.prototype.slice.call(document.querySelectorAll('.hub-upgrade'));
      apply(input.value);

      input.addEventListener('input', function () {
        state.query = input.value;
        apply(input.value);
      });

      function apply(raw) {
        var q = String(raw).trim().toLowerCase();
        var visible = 0;
        cards.forEach(function (card) {
          var hit = !q || String(card.getAttribute('data-search')).indexOf(q) !== -1;
          card.hidden = !hit;
          if (hit) visible++;
        });
        line.textContent = q
          ? visible === 0
            ? 'No upgrades match \u201C' + String(raw).trim() + '\u201D.'
            : visible + ' of ' + total + ' upgrades match \u201C' + String(raw).trim() + '\u201D'
          : total + ' upgrade' + (total === 1 ? '' : 's');
      }
    }

    /* Version changes re-render (the differences notes flip to the
     * active version); the query is kept. */
    render();
    ROGUE.onChange(render);
  });
})();

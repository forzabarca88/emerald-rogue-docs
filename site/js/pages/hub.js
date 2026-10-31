/*
 * pages/hub.js — the persistent hub town from data/hub.json.
 *
 * Sections:
 *   1. Intro prose (what the hub is / building areas and upgrades)
 *   2. In-page anchor-chip nav
 *   3. Areas — the area overview map (the 11 records in their three
 *      access tiers, the built areas drawn as the starting chain)
 *      above the 11 area cards (present-from-start / free to build /
 *      N Build Parts cost chip + the area code)
 *   4. Upgrades — the per-area upgrade-count bars (one bar per area,
 *      from the upgrades' `area` field) above the searchable card grid
 *      (area, cost, requirements, version badge). Records whose
 *      behaviour differs per version (Treat Shop, Lab Unique Typings,
 *      Pokéblock Shop) drop the ambiguous cost/requirement meta and
 *      wear a "differs in <other version>" note instead.
 *   5. Wandering Pokémon prose + the day/season cycle strip (from the
 *      time-weather-season prose's `cycles` field) + clock prose
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

    /**
     * The area overview map (issue #31): the 11 hub-area records in
     * their three access tiers — present from the start, free to build,
     * and Build Parts (cheapest first). Each block shows the record
     * name + its cost. The built tier is drawn as the starting chain
     * (the record order matches the order the "what-the-hub-is" intro
     * lists them, "Labs, the Town Exit, the Safari Area and the Town
     * Square") — the only adjacency the data states; the buildable
     * areas stand alone. The tiers are decorative (aria-hidden); the
     * visible caption and the area cards below carry the meaning.
     */
    function areaMap(areas) {
      if (!areas.length) return '';
      var built = areas.filter(function (a) { return a.initiallyPresent; });
      var free = areas.filter(function (a) { return !a.initiallyPresent && !a.buildCost; });
      var paid = areas
        .filter(function (a) { return !a.initiallyPresent && a.buildCost; })
        .sort(function (a, b) { return a.buildCost - b.buildCost; });

      function block(r, extra) {
        var tag = r.initiallyPresent
          ? 'from the start'
          : r.buildCost
            ? r.buildCost + ' Build Parts'
            : 'free';
        return (
          '<div class="hub-map__block' + (extra ? ' ' + extra : '') + '">' +
          '<span class="hub-map__name">' + ROGUE.esc(r.name) + '</span>' +
          '<span class="hub-map__cost">' + ROGUE.esc(tag) + '</span>' +
          '</div>'
        );
      }

      function tier(label, html) {
        return (
          '<div class="hub-map__tier">' +
          '<span class="hub-map__tier-label">' + ROGUE.esc(label) + '</span>' +
          '<div class="hub-map__blocks">' +
          html +
          '</div>' +
          '</div>'
        );
      }

      var html = '<div class="hub-map"><div class="hub-map__tiers" aria-hidden="true">';
      html +=
        tier(
          'Present from the start',
          built
            .map(function (r, i) {
              return (
                block(r, 'hub-map__block--built') +
                (i < built.length - 1 ? '<span class="hub-map__link">\u2192</span>' : '')
              );
            })
            .join('')
        );
      if (free.length) html += tier('Free to build', free.map(function (r) { return block(r); }).join(''));
      if (paid.length) html += tier('Build Parts', paid.map(function (r) { return block(r); }).join(''));
      html += '</div>';

      /* the gate note is data-driven: only a free area whose own record
       * states the Pokabbie requirement earns it */
      var gated = free.filter(function (a) { return /Pokabbie/.test(a.description || ''); });
      var gateNote = gated.length
        ? '; ' +
          joinNames(gated.map(function (a) { return ROGUE.esc(a.name); })) +
          ' is free, but only after you have met Pokabbie'
        : '';
      html +=
        '<p class="hub-map__caption">All ' +
        areas.length +
        ' areas by access tier. The ' +
        built.length +
        ' built areas sit in the starting chain \u2014 ' +
        joinNames(built.map(function (a) { return ROGUE.esc(a.name); })) +
        ' \u2014 and every new area attaches to one you already own' +
        gateNote +
        '.</p>';
      return html + '</div>';
    }

    /** "A, B and C" (escaped names come in pre-escaped). */
    function joinNames(names) {
      if (names.length <= 1) return names.join('');
      return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    /**
     * The per-area upgrade-count bars (issue #31): one bar per hub-area
     * record (11), counts from the hub-upgrade records' `area` field,
     * descending (ties keep record order). An area with no upgrades gets
     * an empty dashed track (Park and the Challenge Area have none in
     * the shop list). The grid is decorative (aria-hidden); the mono
     * counts and the visible caption carry the meaning.
     */
    function upgradeBars(areas, upgrades) {
      if (!areas.length) return '';

      /* the upgrade `area` field holds short names ("Town Exit") while
       * the area records may carry a parenthesised suffix ("Town Exit
       * (Adventure Entrance)") — match the prefix before " (" as well */
      function countFor(areaName) {
        var n = 0;
        upgrades.forEach(function (u) {
          if (!u || !u.area) return;
          if (u.area === areaName || areaName.indexOf(u.area + ' (') === 0) n += 1;
        });
        return n;
      }

      var rows = areas
        .map(function (a, i) {
          return { name: a.name, count: countFor(a.name), order: i };
        })
        .sort(function (x, y) {
          return y.count - x.count || x.order - y.order;
        });
      var max = rows.reduce(function (m, r) { return Math.max(m, r.count); }, 0);
      var withUpgrades = rows.filter(function (r) { return r.count > 0; }).length;
      var none = rows.filter(function (r) { return !r.count; }).map(function (r) { return ROGUE.esc(r.name); });

      var html = '<div class="hub-bars"><div class="hub-bars__grid" aria-hidden="true">';
      rows.forEach(function (r) {
        var pct = max ? Math.round((r.count / max) * 100) : 0;
        /* an empty track carries no fill span at all (the "never" style
         * of the gameplay placement bars) */
        html +=
          '<div class="hub-bars__row' + (r.count ? '' : ' hub-bars__row--empty') + '">' +
          '<p class="hub-bars__name">' + ROGUE.esc(r.name) + '</p>' +
          '<div class="hub-bars__bar">' +
          '<span class="hub-bars__track">' +
          (r.count ? '<span class="hub-bars__fill" style="width:' + pct + '%"></span>' : '') +
          '</span>' +
          '<span class="hub-bars__count">' +
          r.count +
          '</span>' +
          '</div>' +
          '</div>';
      });
      html += '</div>';
      var caption =
        upgrades.length + ' upgrades across ' + withUpgrades + ' of the ' + rows.length + ' areas';
      if (none.length) caption += ' \u2014 ' + joinNames(none) + ' have none in the shop list (the empty tracks)';
      html += '<p class="hub-bars__caption">' + caption + '</p></div>';
      return html;
    }

    /**
     * The day/season cycle strip (issue #31): the two cycles in the
     * time-weather-season prose's `cycles` field (the four time-of-day
     * codes, the four two-day seasons) as two rows of phase cells with
     * arrow links and a loop-back glyph. The rows are decorative
     * (aria-hidden); the visible caption and the clock prose below
     * carry the meaning.
     */
    function cycleStrip() {
      var entry = ROGUE.proseById(data, 'time-weather-season');
      var cycles = entry && entry.cycles;
      if (!cycles || typeof cycles !== 'object') return '';
      var day = Array.isArray(cycles.day) ? cycles.day : [];
      var season = cycles.season;
      var seasons = season && Array.isArray(season.phases) ? season.phases : [];
      if (!day.length && !seasons.length) return '';

      function row(label, phases) {
        var cells =
          phases
            .map(function (p, i) {
              return (
                '<span class="hub-cycles__cell">' + ROGUE.esc(p) + '</span>' +
                (i < phases.length - 1 ? '<span class="hub-cycles__arrow">\u2192</span>' : '')
              );
            })
            .join('') + '<span class="hub-cycles__loop">\u21bb</span>';
        return (
          '<div class="hub-cycles__row">' +
          '<span class="hub-cycles__row-label">' + ROGUE.esc(label) + '</span>' +
          '<div class="hub-cycles__cells">' +
          cells +
          '</div>' +
          '</div>'
        );
      }

      var html = '<div class="hub-cycles"><div class="hub-cycles__rows" aria-hidden="true">';
      if (day.length) html += row('Time of day', day);
      if (seasons.length) {
        html += row(
          'Seasons' + (season.days ? ' \u00b7 ' + season.days + ' in-game days each' : ''),
          seasons
        );
      }
      html += '</div>';
      var caption =
        'The day cycles through ' + day.length + ' codes and the year through ' + seasons.length + ' seasons';
      if (season.days) caption += ', each lasting ' + season.days + ' in-game days';
      caption += '.';
      html += '<p class="hub-cycles__caption">' + caption + '</p></div>';
      return html;
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

      /* The 11 hub areas: the overview map above the cards. */
      var areas = ROGUE.filter(ROGUE.byCategory(records, 'hub-area'));
      html +=
        ROGUE.section(
          'hub-areas',
          'Areas',
          'The ' + areas.length + ' hub areas',
          null,
          areaMap(areas) + '<div class="grid">' + areas.map(areaCard).join('') + '</div>'
        );

      /* The workbench upgrades (searchable), with the per-area count bars. */
      var upgrades = ROGUE.filter(ROGUE.byCategory(records, 'hub-upgrade'));
      html +=
        ROGUE.section(
          'hub-upgrades',
          'Build shop',
          'Workbench upgrades (' + upgrades.length + ')',
          'Everything the build shop\u2019s Areas and Upgrades menus offer, searchable by name, description or area.',
          upgradeBars(areas, upgrades) +
          '<div class="search hub-search"><input type="search" id="hub-search" placeholder="Search upgrades by name, description or area" aria-label="Search upgrades by name, description or area"></div>' +
          '<p class="hub-result" id="hub-result" role="status">' + upgrades.length + ' upgrades</p>' +
          '<div class="grid hub-upgrades__grid">' +
            upgrades.map(upgradeCard).join('') +
            '</div>'
        );

      /* Wandering mons prose, then the day/season cycle strip + clock prose. */
      [
        ['wander-mons', 'hub-wander', 'Wandering Pokémon'],
        ['time-weather-season', 'hub-time', 'Hub clock']
      ].forEach(function (p) {
        var proseEntry = ROGUE.proseById(data, p[0]);
        if (proseEntry) {
          var body = (p[0] === 'time-weather-season' ? cycleStrip() : '') + ROGUE.paragraphs(proseEntry.text);
          html += ROGUE.section(p[1], p[2], proseEntry.heading, null, body);
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

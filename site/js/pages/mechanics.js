/*
 * pages/mechanics.js — the six mechanic systems, one section each, in
 * this order:
 *
 *   1. Charms & Curses — the system's three prose blocks, then the
 *      records as two card columns (17 charms | 26 curses)
 *   2. Overworld Followmons
 *   3. Game Show
 *   4. Time of Day & Seasons (the EX-only seasonal-species record is
 *      filtered out of the Vanilla view)
 *   5. Unique mons (the lab)
 *   6. Legacy Campaigns — the hidden-phrase unlock record plus all seven
 *      campaign-mode records
 *
 * Every card carries its version badge, a per-version "differs in" note
 * where the record has `differences`, and its source citation. An
 * in-page anchor-chip strip links to each section; version changes
 * re-render so the badges and difference notes follow the active build.
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var files, site;
    try {
      files = {
        charms: ROGUE.data('charms'),
        followmons: ROGUE.data('followmons'),
        gameshow: ROGUE.data('gameshow'),
        timeofday: ROGUE.data('timeofday'),
        uniquemons: ROGUE.data('unique-mons'),
        campaigns: ROGUE.data('campaigns')
      };
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var pages = site.pages || {};

    function recordsOf(d) {
      return Array.isArray(d && d.records) ? d.records : [];
    }

    /** Plain record card: name, badge, description, diff note, source. */
    function card(record) {
      var html = '<article class="card mech-card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        ROGUE.badge(record) +
        '</div>';
      if (record.description) html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html += ROGUE.diffNote(record);
      if (record.source) html += '<p class="card__source">' + ROGUE.esc(record.source) + '</p>';
      return html + '</article>';
    }

    /** A data file's prose blocks as subhead + paragraphs. */
    function proseBlocks(d) {
      return (Array.isArray(d && d.prose) ? d.prose : [])
        .map(function (p) {
          return '<h3 class="mech-subhead">' + ROGUE.esc(p.heading) + '</h3>' + ROGUE.paragraphs(p.text);
        })
        .join('');
    }

    /** Version-scoped card grid. */
    function grid(records) {
      return '<div class="grid mech-grid">' + ROGUE.filter(records).map(card).join('') + '</div>';
    }

    /** One labelled column of stacked cards (the charms | curses duo). */
    function duoColumn(label, records) {
      var kept = ROGUE.filter(records);
      return (
        '<div class="mech-duo__col">' +
        '<h3 class="mech-subhead">' +
        ROGUE.esc(label) +
        ' (' +
        kept.length +
        ')</h3>' +
        '<div class="mech-duo__cards">' +
        kept.map(card).join('') +
        '</div></div>'
      );
    }

    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc((pages.mechanics || {}).title || 'Mechanics') + '</h1>';

      /* Anchor-chip nav across the six systems. */
      var nav = [
        { id: 'mech-charms', label: 'Charms & Curses' },
        { id: 'mech-followmons', label: 'Followmons' },
        { id: 'mech-gameshow', label: 'Game Show' },
        { id: 'mech-timeofday', label: 'Time of Day' },
        { id: 'mech-uniquemons', label: 'Unique mons' },
        { id: 'mech-campaigns', label: 'Campaigns' }
      ];
      html +=
        '<nav class="mech-chips" aria-label="Mechanic systems">' +
        nav
          .map(function (n) {
            return '<a class="chip" href="#' + ROGUE.esc(n.id) + '">' + ROGUE.esc(n.label) + '</a>';
          })
          .join('') +
        '</nav>';

      /* Charms & Curses: prose, then the two card columns. */
      var charms = files.charms;
      var charmRecords = recordsOf(charms).filter(function (r) {
        return r && r.category === 'charm';
      });
      var curseRecords = recordsOf(charms).filter(function (r) {
        return r && r.category === 'curse';
      });
      html +=
        ROGUE.section(
          'mech-charms',
          'Charms & Curses',
          (charms.meta && charms.meta.title) || 'Charms & Curses',
          charms.meta && charms.meta.description,
          proseBlocks(charms) +
            '<div class="mech-duo">' +
            duoColumn('Charms', charmRecords) +
            duoColumn('Curses', curseRecords) +
            '</div>'
        );

      /* One section per remaining system: prose blocks + record grid. */
      [
        ['mech-followmons', 'Followmons', files.followmons],
        ['mech-gameshow', 'Game Show', files.gameshow],
        ['mech-timeofday', 'Time of Day & Seasons', files.timeofday],
        ['mech-uniquemons', 'Unique mons', files.uniquemons],
        ['mech-campaigns', 'Campaigns', files.campaigns]
      ].forEach(function (entry) {
        var d = entry[2];
        html += ROGUE.section(entry[0], entry[1], (d.meta && d.meta.title) || entry[1], d.meta && d.meta.description, proseBlocks(d) + grid(recordsOf(d)));
      });

      main.innerHTML = html;
    }

    /* Version changes re-render (badges, the EX-only seasonal-species
     * record and the difference notes follow the active version). */
    render();
    ROGUE.onChange(render);
  });
})();

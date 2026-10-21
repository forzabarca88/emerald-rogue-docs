/*
 * pages/safari.js — the hub's Safari Zone from data/safari.json.
 *
 * Sections:
 *   1. Intro prose (the Safari Zone in the hub)
 *   2. In-page anchor-chip nav
 *   3. The 60-slot pool — the slot layout rendered as a two-block slot
 *      diagram (regular 0–44 vs legendary 45–59; the ranges and counts
 *      are parsed out of the layout record's description, not hardcoded)
 *      above the cited record card
 *   4. Entry — the four ways a Pokémon enters the pool as stacked cards
 *   5. Priority & eviction — the scoring/eviction card
 *   6. Legends Cave — the legendary catch flow as a numbered step list
 *      (from the record's `steps`, a true sequence so it is numbered),
 *      the 10-Pokéblock offering, and a per-version roster difference
 *      note
 *   7. View & dismiss — the pool sign's two actions
 *
 * All records exist in both builds; the version toggle surfaces the
 * Legends Cave roster difference for the active version.
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('safari');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var records = Array.isArray(data.records) ? data.records : [];
    var pages = site.pages || {};

    function recordById(id) {
      return records.filter(function (r) {
        return r && r.id === id;
      })[0] || null;
    }

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
      if (record.source) html += '<p class="card__source">' + ROGUE.esc(record.source) + '</p>';
      return html + '</article>';
    }

    /**
     * Parse "N–M are regular" / "N–M are legendary" out of the
     * slot-layout record's description so the diagram's ranges and counts
     * come from the data, not from here.
     */
    function slotRange(text, role) {
      var re = new RegExp('(\\d+)\\s*[\u2013\u2014-]\\s*(\\d+)\\s+are ' + role);
      var m = String(text || '').match(re);
      return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
    }

    /** The 60-slot pool as two labelled blocks of one cell per slot. */
    function slotDiagram() {
      var rec = recordById('pool-slot-layout');
      if (!rec || !rec.description) return '';
      var reg = slotRange(rec.description, 'regular');
      var leg = slotRange(rec.description, 'legendary');
      if (!reg || !leg) return '';

      function cells(count) {
        var out = '';
        for (var i = 0; i < count; i++) out += '<span class="safari-slots__cell"></span>';
        return out;
      }

      var regCount = reg.end - reg.start + 1;
      var legCount = leg.end - leg.start + 1;

      var html = '<div class="safari-slots">';
      html +=
        '<div class="safari-slots__group">' +
        '<span class="safari-slots__range">Slots ' + reg.start + '\u2013' + reg.end + '</span>' +
        '<h3 class="safari-slots__label">Regular</h3>' +
        '<p class="safari-slots__count">' +
        regCount +
        ' slots \u2014 the open zone spawns only from these.</p>' +
        '<div class="safari-slots__cells" aria-hidden="true">' + cells(regCount) + '</div>' +
        '</div>';
      html +=
        '<div class="safari-slots__group safari-slots__group--legend">' +
        '<span class="safari-slots__range">Slots ' + leg.start + '\u2013' + leg.end + '</span>' +
        '<h3 class="safari-slots__label">Legendary</h3>' +
        '<p class="safari-slots__count">' +
        legCount +
        ' slots \u2014 reachable only through the Legends Cave.</p>' +
        '<div class="safari-slots__cells" aria-hidden="true">' + cells(legCount) + '</div>' +
        '</div>';
      return html + '</div>';
    }

    /** The Legends Cave flow as a numbered list (CSS counters number it). */
    function stepsList(record) {
      var steps = Array.isArray(record.steps) ? record.steps : [];
      if (!steps.length) return '';
      return (
        '<ol class="safari-steps">' +
        steps.map(function (s) {
          return '<li>' + ROGUE.esc(s) + '</li>';
        }).join('') +
        '</ol>'
      );
    }

    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc((pages.safari || {}).title || 'Safari Zone') + '</h1>';

      /* Intro prose. */
      var intro = ROGUE.proseById(data, 'where-it-fits');
      if (intro) html += ROGUE.section('safari-intro', 'The hub', intro.heading, null, ROGUE.paragraphs(intro.text));

      /* Anchor-chip nav. */
      var nav = [
        { id: 'safari-pool', label: 'The pool' },
        { id: 'safari-entry', label: 'How mons enter' },
        { id: 'safari-priority', label: 'Priority & eviction' },
        { id: 'safari-legends', label: 'Legends Cave' },
        { id: 'safari-sign', label: 'View & dismiss' }
      ];
      html +=
        '<nav class="safari-chips" aria-label="Safari Zone sections">' +
        nav
          .map(function (n) {
            return '<a class="chip" href="#' + ROGUE.esc(n.id) + '">' + ROGUE.esc(n.label) + '</a>';
          })
          .join('') +
        '</nav>';

      /* The 60-slot pool: diagram + cited layout card. */
      var poolProse = ROGUE.proseById(data, 'the-pool');
      var layout = recordById('pool-slot-layout');
      html +=
        ROGUE.section(
          'safari-pool',
          'The pool',
          poolProse ? poolProse.heading : 'The 60-slot pool',
          poolProse ? poolProse.text : null,
          slotDiagram() + (layout ? simpleCard(layout) : '')
        );

      /* The four entry criteria as a stacked list. */
      var entryProse = ROGUE.proseById(data, 'entry-criteria');
      var entries = ROGUE.filter(ROGUE.byCategory(records, 'entry-criterion'));
      html +=
        ROGUE.section(
          'safari-entry',
          'Entry',
          entryProse ? entryProse.heading : 'How Pokémon enter the pool',
          entryProse ? entryProse.text : null,
          '<div class="safari-entry">' + entries.map(simpleCard).join('') + '</div>'
        );

      /* Priority & eviction. */
      var priProse = ROGUE.proseById(data, 'priority-eviction');
      var priRec = recordById('priority-eviction');
      html +=
        ROGUE.section(
          'safari-priority',
          'Priority & eviction',
          priProse ? priProse.heading : 'Priority and eviction',
          priProse ? priProse.text : null,
          priRec ? simpleCard(priRec) : ''
        );

      /* Legends Cave: numbered steps + cited card (with roster diff note). */
      var caveProse = ROGUE.proseById(data, 'legends-cave');
      var cave = recordById('legends-cave');
      html +=
        ROGUE.section(
          'safari-legends',
          'Legends Cave',
          caveProse ? caveProse.heading : 'The Legends Cave',
          caveProse ? caveProse.text : null,
          cave ? stepsList(cave) + simpleCard(cave) : ''
        );

      /* View & dismiss the pool. */
      var sign = recordById('pool-sign');
      if (sign) html += ROGUE.section('safari-sign', 'Pool sign', sign.name, null, simpleCard(sign));

      main.innerHTML = html;
    }

    /* Version changes re-render (the Legends Cave roster difference note
     * flips to the active version). */
    render();
    ROGUE.onChange(render);
  });
})();

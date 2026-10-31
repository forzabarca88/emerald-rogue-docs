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
 *   4. Entry — the four entry events as a converging flow diagram (one
 *      row per entry-criterion record: name + one-line `short` essence,
 *      arrows into a pool block whose counts come from the parsed slot
 *      ranges), above the four stacked cards (which carry the cites)
 *   5. Priority & eviction — the priority score as a chip equation
 *      (terms/operators from the record's `score` field) plus the
 *      eviction sequence as a numbered step strip (`eviction` field),
 *      above the cited record card
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
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /**
     * Parse "N–M are regular" / "N–M are legendary" out of the
     * slot-layout record's description so the diagrams' ranges and
     * counts come from the data, not from here.
     */
    function slotRange(text, role) {
      var re = new RegExp('(\\d+)\\s*[\u2013\u2014-]\\s*(\\d+)\\s+are ' + role);
      var m = String(text || '').match(re);
      return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
    }

    /** The parsed pool geometry, shared by the slot diagram and the entry flow. */
    function poolInfo() {
      var rec = recordById('pool-slot-layout');
      if (!rec || !rec.description) return null;
      var reg = slotRange(rec.description, 'regular');
      var leg = slotRange(rec.description, 'legendary');
      if (!reg || !leg) return null;
      var regCount = reg.end - reg.start + 1;
      var legCount = leg.end - leg.start + 1;
      return { reg: reg, leg: leg, regCount: regCount, legCount: legCount, total: regCount + legCount };
    }

    /** The 60-slot pool as two labelled blocks of one cell per slot. */
    function slotDiagram() {
      var pool = poolInfo();
      if (!pool) return '';

      function cells(count) {
        var out = '';
        for (var i = 0; i < count; i++) out += '<span class="safari-slots__cell"></span>';
        return out;
      }

      var html = '<div class="safari-slots">';
      html +=
        '<div class="safari-slots__group">' +
        '<span class="safari-slots__range">Slots ' + pool.reg.start + '\u2013' + pool.reg.end + '</span>' +
        '<h3 class="safari-slots__label">Regular</h3>' +
        '<p class="safari-slots__count">' +
        pool.regCount +
        ' slots \u2014 the open zone spawns only from these.</p>' +
        '<div class="safari-slots__cells" aria-hidden="true">' + cells(pool.regCount) + '</div>' +
        '</div>';
      html +=
        '<div class="safari-slots__group safari-slots__group--legend">' +
        '<span class="safari-slots__range">Slots ' + pool.leg.start + '\u2013' + pool.leg.end + '</span>' +
        '<h3 class="safari-slots__label">Legendary</h3>' +
        '<p class="safari-slots__count">' +
        pool.legCount +
        ' slots \u2014 reachable only through the Legends Cave.</p>' +
        '<div class="safari-slots__cells" aria-hidden="true">' + cells(pool.legCount) + '</div>' +
        '</div>';
      return html + '</div>';
    }

    /** The Legends Cave flow as a numbered list (CSS counters number it). */
    function stepsList(record) {
      var steps = Array.isArray(record.steps) ? record.steps : [];
      if (!steps.length) return '';
      return (
        '<ol class="safari-steps">' +
        steps
          .map(function (s) {
            return '<li>' + ROGUE.esc(s) + '</li>';
          })
          .join('') +
        '</ol>'
      );
    }

    /**
     * The four entry events converging into the pool block: one row per
     * entry-criterion record (name + one-line `short` essence), arrows
     * into a pool block whose counts come from the parsed slot ranges.
     * Every cell is placed explicitly (positive line numbers — a
     * "1 / -1" span is not reserved against later auto-placed items,
     * so the events would flow into the pool column).
     */
    function entryFlow(entries) {
      if (!entries.length) return '';
      var pool = poolInfo();
      var rows = entries
        .map(function (r, i) {
          var row = i + 1;
          return (
            '<div class="safari-entry-flow__event" style="grid-row:' + row + ';grid-column:1">' +
            '<h3 class="safari-entry-flow__name">' +
            ROGUE.esc(r.name) +
            '</h3>' +
            (r.short
              ? '<p class="safari-entry-flow__essence">' + ROGUE.esc(r.short) + '</p>'
              : '') +
            '</div>' +
            '<span class="safari-entry-flow__arrow" style="grid-row:' + row + ';grid-column:2" aria-hidden="true">\u2192</span>'
          );
        })
        .join('');
      var poolBlock =
        pool &&
        '<div class="safari-entry-flow__pool" style="grid-column:3;grid-row:1/' + (entries.length + 1) + '">' +
        '<h3 class="safari-entry-flow__name">The pool</h3>' +
        '<p class="safari-entry-flow__count">' +
        pool.total +
        ' slots \u2014 ' +
        pool.regCount +
        ' regular, ' +
        pool.legCount +
        ' legendary</p>' +
        '</div>';
      return (
        '<div class="safari-entry-flow"><div class="safari-entry-flow__grid">' +
        rows +
        poolBlock +
        '</div></div>'
      );
    }

    /**
     * The priority score as a chip equation: each term is a mono chip, a
     * term's `op` renders as the operator before it, and `result` renders
     * after a trailing "=" (all values from the record's `score` field).
     */
    function scoreEquation(record) {
      var score = record && record.score;
      if (!score || !Array.isArray(score.terms) || !score.terms.length) return '';
      var html = '<div class="equation">';
      score.terms.forEach(function (term) {
        if (term.op) html += '<span class="equation__op">' + ROGUE.esc(term.op) + '</span>';
        html += '<span class="equation__term">' + ROGUE.esc(term.label) + '</span>';
      });
      if (score.result) {
        html +=
          '<span class="equation__op">=</span><span class="equation__result">' +
          ROGUE.esc(score.result) +
          '</span>';
      }
      if (score.note) html += '<p class="equation__note">' + ROGUE.esc(score.note) + '</p>';
      return html + '</div>';
    }

    /** A short true sequence (3–5 steps) as a wrapping numbered strip. */
    function stepStrip(steps, label) {
      if (!Array.isArray(steps) || !steps.length) return '';
      return (
        '<ol class="step-strip"' +
        (label ? ' aria-label="' + ROGUE.esc(label) + '"' : '') +
        '>' +
        steps
          .map(function (s, i) {
            return (
              '<li class="step-strip__step">' +
              '<span class="step-strip__index">' +
              (i + 1) +
              '</span>' +
              '<span class="step-strip__label">' +
              ROGUE.esc(s) +
              '</span>' +
              '</li>'
            );
          })
          .join('') +
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

      /* Entry: the four events as a converging flow, then the cards. */
      var entryProse = ROGUE.proseById(data, 'entry-criteria');
      var entries = ROGUE.filter(ROGUE.byCategory(records, 'entry-criterion'));
      html +=
        ROGUE.section(
          'safari-entry',
          'Entry',
          entryProse ? entryProse.heading : 'How Pokémon enter the pool',
          entryProse ? entryProse.text : null,
          entryFlow(entries) +
            '<div class="safari-entry">' +
            entries.map(simpleCard).join('') +
            '</div>'
        );

      /* Priority & eviction: score equation + eviction strip + card. */
      var priProse = ROGUE.proseById(data, 'priority-eviction');
      var priRec = recordById('priority-eviction');
      var priEquation = priRec ? scoreEquation(priRec) : '';
      var priStrip = priRec ? stepStrip(priRec.eviction, 'Eviction, step by step') : '';
      html +=
        ROGUE.section(
          'safari-priority',
          'Priority & eviction',
          priProse ? priProse.heading : 'Priority and eviction',
          priProse ? priProse.text : null,
          (priEquation || priStrip
            ? '<div class="safari-priority">' + priEquation + priStrip + '</div>'
            : '') + (priRec ? simpleCard(priRec) : '')
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

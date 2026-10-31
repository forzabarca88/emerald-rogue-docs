/*
 * pages/mechanics.js — the six mechanic systems, one section each, in
 * this order:
 *
 *   1. Charms & Curses — the system's three prose blocks (the
 *      netting example and the stacking/cap chart sit under the first
 *      two), then the records as two card columns (17 charms | 26 curses)
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
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
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

    /**
     * One prose block of the charms section: subhead + text, an
     * optional `list` (the where-they-come-from sources), an optional
     * `trailing` paragraph, then `extra` (the diagrams that replace the
     * block's former structure — issue #31).
     */
    function charmProse(d, id, extra) {
      var block = ROGUE.proseById(d, id);
      if (!block) return '';
      var html = '<h3 class="mech-subhead">' + ROGUE.esc(block.heading) + '</h3>';
      if (block.text) html += ROGUE.paragraphs(block.text);
      if (Array.isArray(block.list)) {
        html +=
          '<ul class="mech-list">' +
          block
            .list.map(function (item) {
              return '<li>' + ROGUE.esc(item) + '</li>';
            })
            .join('') +
          '</ul>';
      }
      if (block.trailing) html += ROGUE.paragraphs(block.trailing);
      return html + (extra || '');
    }

    function recordById(d, id) {
      return (recordsOf(d) || []).filter(function (r) {
        return r && r.id === id;
      })[0];
    }

    /**
     * The netting example (issue #31): two bars — one of each Catching
     * item — above the `.equation` netting math. Values from the two
     * records' `stack.per` (their sources cite the CalcValueInternal
     * EFFECT_CATCH_RATE line: count × 200 / count × 40).
     */
    function nettingHtml() {
      var charm = recordById(files.charms, 'charm-catching');
      var curse = recordById(files.charms, 'curse-catching');
      if (!charm || !curse || !charm.stack || !curse.stack) return '';
      var c = charm.stack.per;
      var k = curse.stack.per;
      var scale = Math.max(c, k);
      var net = c - k;
      var netText = (net >= 0 ? 'net +' : 'net −') + Math.abs(net) + '%';
      var bar = function (record, value, sign, curseCls) {
        return (
          '<div class="netting__bar">' +
          '<p class="netting__name">' +
          ROGUE.esc(record.name) +
          '</p>' +
          '<span class="netting__track">' +
          '<span class="netting__fill' + (curseCls ? ' netting__fill--curse' : '') + '" style="width:' + (value / scale) * 100 + '%"></span>' +
          '</span>' +
          '<span class="netting__value">' +
          sign +
          value +
          '%</span>' +
          '</div>'
        );
      };
      return (
        '<div class="netting">' +
        '<div class="netting__bars" aria-hidden="true">' +
        bar(charm, c, '+', false) +
        bar(curse, k, '−', true) +
        '</div>' +
        '<div class="equation">' +
        '<span class="equation__term">+' +
        c +
        '% · one ' +
        ROGUE.esc(charm.name) +
        '</span>' +
        '<span class="equation__op">−</span>' +
        '<span class="equation__term">' +
        k +
        '% · one ' +
        ROGUE.esc(curse.name) +
        '</span>' +
        '<span class="equation__op">=</span>' +
        '<span class="equation__result">' +
        netText +
        '</span>' +
        '<p class="equation__note">The smaller total is subtracted from the larger on a 100% base — equal per-item values cancel item-for-item.</p>' +
        '</div>' +
        '</div>'
      );
    }

    /** One cap line: `cls` = '' (the shared cap) or a version modifier;
     *  `active` lines are solid + labelled in their hue, the others
     *  dashed + muted. */
    function capLine(cls, bottomPct, label, active) {
      return (
        '<span class="stacks__cap' +
        (cls ? ' ' + cls : '') +
        (active ? '' : ' stacks__cap--dim') +
        '" style="bottom:' +
        bottomPct +
        '%">' +
        '<span class="stacks__caplabel">' +
        label +
        '</span>' +
        '</span>'
      );
    }

    /**
     * One stack-chart row (issue #31): a column of bars, one per item
     * held, rising to the cap line. Bar values = min(count × per, cap)
     * — the CalcValueInternal lines each record's source cites. Grace
     * rows plot BOTH version caps on a fixed 150 track (emerald 90 /
     * gold 150), the active version's line solid; the row's bars use
     * the active version's cap, so a version toggle re-renders them.
     */
    function stackRow(record) {
      var s = record.stack;
      var v = ROGUE.version;
      var caps = s.caps || { vanilla: s.cap, ex: s.cap };
      var cap = v === 'vanilla' ? caps.vanilla : caps.ex;
      var scale = s.caps ? caps.ex : cap;
      var n = Math.ceil(cap / s.per);
      var isCurse = record.category === 'curse';
      var bars = '';
      var vals = '';
      for (var i = 1; i <= n; i++) {
        var val = Math.min(i * s.per, cap);
        bars +=
          '<span class="stacks__bar' +
          (isCurse ? ' stacks__bar--curse' : '') +
          '" style="height:' +
          Math.round((val / scale) * 1000) / 10 +
          '%"></span>';
        vals += '<span>' + val + '</span>';
      }
      var capsHtml;
      if (s.caps) {
        capsHtml =
          capLine('stacks__cap--vanilla', Math.round((caps.vanilla / scale) * 1000) / 10, caps.vanilla + ' · Vanilla', v === 'vanilla') +
          capLine('stacks__cap--ex', Math.round((caps.ex / scale) * 1000) / 10, caps.ex + ' · EX', v === 'ex');
      } else {
        capsHtml = capLine('', 100, cap + (s.unit || '') + ' cap', true);
      }
      return (
        '<div class="stacks__row">' +
        '<h4 class="stacks__name">' +
        ROGUE.esc(record.name) +
        '</h4>' +
        '<p class="stacks__note">+' +
        s.per +
        (s.unit || '') +
        ' per item</p>' +
        '<div class="stacks__plot">' +
        '<div class="stacks__bars">' +
        capsHtml +
        bars +
        '</div>' +
        '<div class="stacks__vals">' +
        vals +
        '</div>' +
        '</div>' +
        '</div>'
      );
    }

    /**
     * The stacking/cap chart (issue #31): one row per capped chance
     * effect — the records carrying a `stack` field with a cap (10:
     * five charms, five curses). Decorative (aria-hidden); the caption
     * and the cited cards below carry the meaning.
     */
    function stacksHtml() {
      var rows = recordsOf(files.charms)
        .filter(function (r) {
          return r && r.stack && (r.stack.cap !== undefined || r.stack.caps);
        })
        .map(stackRow);
      if (!rows.length) return '';
      return (
        '<div class="stacks">' +
        '<div class="stacks__grid" aria-hidden="true">' +
        rows.join('') +
        '</div>' +
        '<p class="stacks__caption">Each column is one more item held — columns stop at the cap, where holding more adds nothing. Chance rows plot the capped chance (cap line at 90%); the Grace rows plot the stacked bonus itself (a move’s secondary-effect odds × (100 + bonus) / 100) with both version caps — Vanilla 90 (emerald) and EX 150 (gold), the active version’s line solid.</p>' +
        '</div>'
      );
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
      /* The three prose blocks with their diagrams: the netting
         example under the netting prose, the stacking/cap chart under
         the scaling prose, then the sources list. */
      html +=
        ROGUE.section(
          'mech-charms',
          'Charms & Curses',
          (charms.meta && charms.meta.title) || 'Charms & Curses',
          charms.meta && charms.meta.description,
          charmProse(charms, 'what-they-are', nettingHtml()) +
            charmProse(charms, 'scaling', stacksHtml()) +
            charmProse(charms, 'where-they-come-from') +
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

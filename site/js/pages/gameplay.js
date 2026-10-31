/*
 * pages/gameplay.js — the core gameplay loop, one section per phase:
 * hub → run (the generated path, how rooms are placed, every room
 * type, the boss ladder) → post-run (how the run's Pokémon feed the
 * Safari Zone) → back to the hub.
 * Rendered from data/adventure.json, data/hub.json and data/safari.json;
 * the guide links use page titles from data/site.json. Room and boss
 * records are version-scoped with ROGUE.filter and carry version badges.
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var adventure, hub, safari, site;
    try {
      adventure = ROGUE.data('adventure');
      hub = ROGUE.data('hub');
      safari = ROGUE.data('safari');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var pages = site.pages || {};
    var hubLabel = (pages.hub || {}).title || 'Hub';
    var safariLabel = (pages.safari || {}).title || 'Safari Zone';

    function guideLink(href, label) {
      return (
        '<p class="loop__more"><a href="./' + ROGUE.esc(href) + '.html">' +
        'Open the full ' + ROGUE.esc(label) + ' guide →</a></p>'
      );
    }

    function records(data, category) {
      return ROGUE.filter(ROGUE.byCategory(Array.isArray(data && data.records) ? data.records : [], category));
    }

    /* Run-path diagram building blocks for the labelled variant
       (DESIGN.md §5.1): one column wrapper per step — node on top,
       mono caption below. The diagram root stays aria-hidden; the
       visible <p> caption next to it carries the meaning. */
    var LINK = '<span class="run-path__link"></span>';

    function cell(nodeClass, label) {
      return (
        '<span class="run-path__cell"><span class="run-path__node' +
        (nodeClass ? ' ' + nodeClass : '') +
        '"></span><span class="run-path__label">' +
        label +
        '</span></span>'
      );
    }

    /* A typical Classic 5-column segment, mixing the room types a
       player usually encounters: hub → route → rest stop (dashed) →
       gap (hollow) → split (fork of two lanes — two or three in the
       game) → boss. */
    var labeledSegment =
      '<div class="run-path run-path--labeled" aria-hidden="true">' +
      cell('run-path__node--hub', 'Hub') +
      LINK +
      cell('', 'Route') +
      LINK +
      cell('run-path__node--rest', 'Rest') +
      LINK +
      cell('run-path__node--gap', 'Gap') +
      LINK +
      '<span class="run-path__cell"><span class="run-path__fork">' +
      '<span class="run-path__lane"><span class="run-path__link"></span></span>' +
      '<span class="run-path__lane"><span class="run-path__link"></span></span>' +
      '</span><span class="run-path__label">Split</span></span>' +
      LINK +
      cell('run-path__node--boss', 'Boss') +
      '</div>';

    /* The Fast Path hidden-route segment (2 room columns): every
       leftover route of the segment becomes a wild den. */
    var denSegment =
      '<div class="run-path run-path--labeled" aria-hidden="true">' +
      cell('run-path__node--hub', 'Hub') +
      LINK +
      cell('run-path__node--den', 'Den') +
      LINK +
      cell('run-path__node--den', 'Den') +
      LINK +
      cell('run-path__node--boss', 'Boss') +
      '</div>';

    /* Placement diagram rows (issue #31): one bar per placement value —
       track + fill + a mono "value · condition" label. Bar width:
       placement weights on a 0–200 scale (the legendary's weight is the
       max), path rolls and tier chances on 0–100, "fixed" fills the
       track, "never" leaves it empty (values from each record's
       `placement` field, re-encoded from its cited description). */
    function placementBarLine(bar, kind) {
      var valueText, width;
      if (typeof bar.v === 'number') {
        valueText = kind === 'weight' ? String(bar.v) : bar.v + '%';
        width = kind === 'weight' ? (bar.v / 200) * 100 : Math.max(0, Math.min(100, bar.v));
      } else {
        valueText = bar.t || '';
        width = kind === 'fixed' ? 100 : 0;
      }
      return (
        '<div class="placement__bar">' +
        '<span class="placement__track">' +
        (width > 0 ? '<span class="placement__fill" style="width:' + width + '%"></span>' : '') +
        '</span>' +
        '<span class="placement__value">' +
        ROGUE.esc(valueText) +
        (bar.l ? ' <span class="placement__cond">' + ROGUE.esc(bar.l) + '</span>' : '') +
        '</span></div>'
      );
    }

    /* One placement row: the room name, its condition note, its bars. */
    function placementRow(record) {
      var p = record.placement;
      var kind = p.kind || 'roll';
      var bars = (Array.isArray(p.bars) ? p.bars : [])
        .map(function (bar) {
          return placementBarLine(bar, kind);
        })
        .join('');
      return (
        '<div class="placement__row' + (kind === 'never' ? ' placement__row--never' : '') + '">' +
        '<h3 class="placement__name">' +
        ROGUE.esc(record.name) +
        '</h3>' +
        (p.note ? '<p class="placement__note">' + ROGUE.esc(p.note) + '</p>' : '') +
        '<div class="placement__bars">' +
        bars +
        '</div></div>'
      );
    }

    var html = '<h1>' + ROGUE.esc((pages.gameplay || {}).title || 'Gameplay') + '</h1>';

    /* Phase strip — in-page navigation through the loop. */
    var phases = [
      { id: 'gp-hub', label: 'Hub' },
      { id: 'gp-run', label: 'Run' },
      { id: 'gp-post-run', label: 'Post-run' },
      { id: 'gp-return', label: 'Back to the hub' }
    ];
    html += '<nav class="loop" aria-label="Gameplay loop phases">';
    html += phases
      .map(function (ph, i) {
        return (
          (i ? '<span class="loop__arrow" aria-hidden="true">→</span>' : '') +
          '<a class="chip loop__phase" href="#' + ROGUE.esc(ph.id) + '">' +
          ROGUE.esc(ph.label) + '</a>'
        );
      })
      .join('');
    html += '</nav>';

    /* Phase 1 — the hub. */
    var hubIntro = ROGUE.proseById(hub, 'what-the-hub-is');
    if (hubIntro) {
      html += ROGUE.section('gp-hub', 'The hub', hubIntro.heading, null, ROGUE.paragraphs(hubIntro.text) + guideLink('hub', hubLabel));
    }

    /* Phase 2 — the run: the freshly generated path, with the labelled
       path-segment diagram (DESIGN.md §5.1). */
    var pathProse = ROGUE.proseById(adventure, 'how-the-path-works');
    if (pathProse) {
      html +=
        ROGUE.section(
          'gp-run',
          'The run',
          pathProse.heading,
          null,
          ROGUE.paragraphs(pathProse.text) +
            '<div class="path-diagram">' +
            labeledSegment +
            '<p class="path-diagram__caption">A typical Classic segment: hub plus five steps, left to right — the split forks into two or three lanes.</p>' +
            '</div>'
        );
    }

    /* The run — every room type on a generated path (shared by the
       placement diagram and the room-type cards). */
    var rooms = records(adventure, 'room-type');

    /* The run — how rooms are placed (issue #31): a bar row per room
       type, above the room cards. The bar grid is decorative
       (aria-hidden) — the visible caption and the room cards below
       carry the meaning. */
    var placementRecs = rooms.filter(function (r) {
      return r && r.placement && Array.isArray(r.placement.bars);
    });
    if (placementRecs.length) {
      html +=
        ROGUE.section(
          'gp-placement',
          'The run — placement',
          'How rooms are placed',
          "Every path starts as all routes; special rooms then earn their columns — by a path roll, a placement weight, or a tiered chance. Bar length is each room's value on its own scale (weights to 200, percentages to 100%); the mono labels carry the exact figures.",
          '<div class="placement">' +
            '<div class="placement__grid" aria-hidden="true">' +
            placementRecs.map(placementRow).join('') +
            '</div>' +
            '<p class="placement__caption">At a glance only — the room cards below carry the full rules and citations.</p>' +
            '</div>'
        );
    }

    /* The run — every room type on a generated path (the full cards,
       the reading-the-rooms note, the fast-path den callout). */
    var roomsNote = ROGUE.proseById(adventure, 'reading-the-rooms');
    html +=
      ROGUE.section(
        'gp-rooms',
        'The run — room types',
        'Room types',
        adventure.meta && adventure.meta.description,
        '<div class="grid">' + ROGUE.cards(rooms) + '</div>' +
          (roomsNote
            ? '<h3 class="rooms__note">' + ROGUE.esc(roomsNote.heading) + '</h3>' +
              ROGUE.paragraphs(roomsNote.text)
            : '') +
          '<div class="path-diagram rooms__den">' +
          denSegment +
          '<p class="path-diagram__caption">Fast Path, hidden-route step: every leftover route in the segment becomes a wild den — that whole segment is den-hopping.</p>' +
          '</div>'
      );

    /* The run — the boss ladder. */
    var ladderProse = ROGUE.proseById(adventure, 'boss-ladder');
    var bosses = records(adventure, 'boss');
    if (ladderProse || bosses.length) {
      var ladder = '<ol class="ladder">';
      ladder += bosses
        .map(function (b, i) {
          var idx = i + 1 < 10 ? '0' + (i + 1) : String(i + 1);
          return (
            '<li class="ladder__item">' +
            '<span class="ladder__index" aria-hidden="true">' + idx + '</span>' +
            '<div class="ladder__main">' +
            '<div class="ladder__head">' +
            '<h3 class="ladder__name">' + ROGUE.esc(b.name) + '</h3>' +
            ROGUE.badge(b) +
            '</div>' +
            '<p class="ladder__desc">' + ROGUE.esc(b.description) + '</p>' +
            '<p class="card__source">' + ROGUE.citeHtml(b.source) + '</p>' +
            '</div></li>'
          );
        })
        .join('');
      ladder += '</ol>';
      html += ROGUE.section(
        'gp-boss',
        'The run — boss ladder',
        ladderProse ? ladderProse.heading : 'The boss ladder',
        null,
        (ladderProse ? ROGUE.paragraphs(ladderProse.text) : '') + ladder
      );
    }

    /* Phase 3 — post-run: the Safari hand-off. */
    var entryProse = ROGUE.proseById(safari, 'entry-criteria');
    if (entryProse) {
      html += ROGUE.section(
        'gp-post-run',
        'Post-run',
        entryProse.heading,
        null,
        ROGUE.paragraphs(entryProse.text) + guideLink('safari', safariLabel)
      );
    }

    /* Phase 4 — back to the hub. */
    var hubLoop = ROGUE.proseById(hub, 'hub-in-the-loop');
    if (hubLoop) {
      html += ROGUE.section(
        'gp-return',
        'Back to the hub',
        hubLoop.heading,
        null,
        ROGUE.paragraphs(hubLoop.text) + guideLink('hub', hubLabel)
      );
    }

    var main = document.querySelector('main');
    if (main) main.innerHTML = html;
  });
})();

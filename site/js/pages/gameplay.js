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

    /* Room vocabulary for the example-run chain (issue #119) — one
       entry per placeable room type in data/adventure.json (category
       "room-type"): the mono label the node carries, and the node
       modifier it renders as. Every special encounter shares the one
       --special node style (DESIGN.md §5.1); the labels tell the rooms
       apart. room-miniboss is deliberately absent — it is never placed
       by the generator. */
    var ROOM_STYLES = {
      route: { label: 'Route', node: '' },
      rest: { label: 'Rest', node: 'run-path__node--rest' },
      gap: { label: 'Gap', node: 'run-path__node--gap' },
      den: { label: 'Den', node: 'run-path__node--den' },
      legend: { label: 'Legend', node: 'run-path__node--special' },
      hideout: { label: 'Hideout', node: 'run-path__node--special' },
      honey: { label: 'Honey', node: 'run-path__node--special' },
      deal: { label: 'Dark Deal', node: 'run-path__node--special' },
      lab: { label: 'Lab', node: 'run-path__node--special' },
      show: { label: 'Game Show', node: 'run-path__node--special' },
      sign: { label: 'Sign', node: 'run-path__node--special' },
      sim: { label: 'Sim', node: 'run-path__node--special' },
      tower: { label: 'Tower', node: 'run-path__node--special' },
      shrine: { label: 'Shrine', node: 'run-path__node--special' }
    };

    /*
     * An example run (issue #119) — one row per badge step (badge 0–13:
     * 14 Classic segments). Hand-authored from the `placement` rules in
     * data/adventure.json so every row is a legal draw; NO RNG — the
     * rows are fixed so the page's screenshots stay deterministic. Each
     * row reads Hub → 3 room columns → Split (2 or 3 lanes) → Boss, and
     * the boss is the next one on the ladder (the boss-ladder prose:
     * "the room at the end of the path is always the next one on the
     * ladder") — Gym 1–8 (badges 0–7), Elite 1–4 (badges 8–11),
     * Champion (12), Final (13).
     *
     * Placement rules encoded (each room's `placement` field in
     * data/adventure.json):
     *  - route (room-route): "the default room — special encounters
     *    replace routes" — every segment keeps at least one plain
     *    route here;
     *  - legend (room-legendary): weight 200, "placed on its assigned
     *    badge · one per path" — the run's three slots: the Roamer on a
     *    badge 1–5 (row 3), the Minor on a badge 3–5 (row 5), the Box
     *    on a badge 7–8 (row 8);
     *  - hideout (room-team-hideout): "placed on its assigned badge ·
     *    one per path" — the Early hideout on a badge 2–4 missing the
     *    legendary badges (row 2), the Pre-Legend mirroring the Box
     *    legendary's badge (row 8);
     *  - shrine (room-shrine): one per RUN on the run's pre-rolled
     *    badge (row 1) — unlike the other specials, whose cap is per
     *    path;
     *  - deal (room-dark-deal): badge 3+ after a 25% roll, "skip badges
     *    divisible by 3" — rows 4, 7, 13;
     *  - lab (room-lab): badge 3+ after a 25% roll, "skip if badge
     *    mod 3 = 1" — rows 5, 11;
     *  - show (room-gameshow): "badges 0–5" — row 0;
     *  - sign (room-sign): "below Elite Four only (badges 0–7)" —
     *    rows 1, 7;
     *  - sim / tower (room-battle-sim / room-battle-tower): "badge 1+
     *    · one per path" — the 50/50 alternative pair, never both in
     *    one segment (tower row 4, sim row 10);
     *  - honey (room-honey-tree): "badge 1+ · one per path" — row 10;
     *  - den (room-wild-den): "each remaining route rolls" with the
     *    minimum regular routes always kept (3 on badges 0–7, 2 for
     *    the Elite Four, 1 at the Champion and beyond) — zero dens
     *    on the badges 0–7 rows, at most one per segment on the Elite
     *    rows (2 at the Champion+ rows, where only one route is kept)
     *    — rows 11, 12, 13;
     *  - gap (room-none): "never badge 0" — row 9 only;
     *  - rest (room-reststop): any badge, weight 100/20/5/1 by rest
     *    stops already on the path — one per segment here: rows
     *    0, 2, 3, 6, 9.
     * test/gameplay-run-data.test.mjs re-validates these rows against
     * the same rules. */
    var EXAMPLE_RUN = [
      { badge: 0, boss: 'Gym 1', lanes: 2, rooms: ['route', 'rest', 'show'] },
      { badge: 1, boss: 'Gym 2', lanes: 2, rooms: ['shrine', 'sign', 'route'] },
      { badge: 2, boss: 'Gym 3', lanes: 3, rooms: ['hideout', 'route', 'rest'] },
      { badge: 3, boss: 'Gym 4', lanes: 2, rooms: ['legend', 'route', 'rest'] },
      { badge: 4, boss: 'Gym 5', lanes: 3, rooms: ['route', 'deal', 'tower'] },
      { badge: 5, boss: 'Gym 6', lanes: 2, rooms: ['legend', 'lab', 'route'] },
      { badge: 6, boss: 'Gym 7', lanes: 2, rooms: ['route', 'rest', 'route'] },
      { badge: 7, boss: 'Gym 8', lanes: 3, rooms: ['sign', 'deal', 'route'] },
      { badge: 8, boss: 'Elite 1', lanes: 2, rooms: ['legend', 'hideout', 'route'] },
      { badge: 9, boss: 'Elite 2', lanes: 2, rooms: ['rest', 'gap', 'route'] },
      { badge: 10, boss: 'Elite 3', lanes: 3, rooms: ['sim', 'honey', 'route'] },
      { badge: 11, boss: 'Elite 4', lanes: 2, rooms: ['lab', 'route', 'den'] },
      { badge: 12, boss: 'Champion', lanes: 3, rooms: ['route', 'den', 'den'] },
      { badge: 13, boss: 'Final', lanes: 2, rooms: ['deal', 'den', 'route'] }
    ];

    /* One example-run row: Hub → 3 room columns → Split (2–3 lanes)
       → Boss, each step in a labelled cell (the --chain variant
       tightens the links so the widest labels still fit at 360px). */
    function exampleRunRow(segment) {
      var lanes = '';
      for (var i = 0; i < segment.lanes; i++) {
        lanes +=
          '<span class="run-path__lane"><span class="run-path__link"></span></span>';
      }
      return (
        '<div class="run-path run-path--labeled run-path--chain" aria-hidden="true">' +
        cell('run-path__node--hub', 'Hub') +
        LINK +
        segment.rooms
          .map(function (key) {
            return cell(ROOM_STYLES[key].node, ROOM_STYLES[key].label);
          })
          .join(LINK) +
        LINK +
        '<span class="run-path__cell"><span class="run-path__fork">' +
        lanes +
        '</span><span class="run-path__label">Split</span></span>' +
        LINK +
        cell('run-path__node--boss', segment.boss) +
        '</div>'
      );
    }

    /* The room-type legend (node style → room type), for the chain's
       panel. */
    var LEGEND = [
      { node: 'run-path__node--hub', name: 'Hub' },
      { node: '', name: 'Route' },
      { node: 'run-path__node--rest', name: 'Rest Stop' },
      { node: 'run-path__node--gap', name: 'Gap' },
      { node: 'run-path__node--den', name: 'Wild Den' },
      { node: 'run-path__node--special', name: 'Special Room' },
      { node: 'run-path__node--boss', name: 'Boss' }
    ];

    function legendItem(entry) {
      return (
        '<span class="run-legend__item"><span class="run-path__node' +
        (entry.node ? ' ' + entry.node : '') + '"></span>' +
        '<span class="run-legend__name">' +
        entry.name +
        '</span></span>'
      );
    }

    /* The three mode shapes (the how-the-path-works prose in
       data/adventure.json): a compact schematic run-path per mode.
       `rooms` is the ROOM COLUMN count — the generator's totalLength
       minus its two fixed columns (the initial split and the final
       encounter — src/rogue_adventurepaths.c's "// +2 to account for
       final encounter and initial split"): Classic totalLength 5 →
       3 rooms; Fast Path 6 → 4 (3 at the Champion stage, where
       totalLength is 5); Gauntlet 7 → 5 rooms on badge 0, then
       totalLength 2 → 0 rooms after the first badge (the boss right
       after the split). */
    var MODE_SHAPES = [
      { name: 'Classic', rooms: 3, note: '3 rooms, split, boss' },
      { name: 'Fast Path', rooms: 4, note: '4 rooms (3 at the Champion stage)' },
      { name: 'Gauntlet', rooms: 5, note: '5 rooms on badge 0, then none (boss right after the split)' }
    ];

    /* A mini mode-shape path: hub → N route nodes → split (two lanes)
       → boss, on the --mini schematic scale. */
    function miniPath(roomCount) {
      var rooms = '';
      for (var i = 0; i < roomCount; i++) {
        rooms += (i ? LINK : '') + '<span class="run-path__node"></span>';
      }
      return (
        '<div class="run-path run-path--mini" aria-hidden="true">' +
        '<span class="run-path__node run-path__node--hub"></span>' +
        LINK +
        rooms +
        LINK +
        '<span class="run-path__fork"><span class="run-path__lane"><span class="run-path__link"></span></span>' +
        '<span class="run-path__lane"><span class="run-path__link"></span></span></span>' +
        LINK +
        '<span class="run-path__node run-path__node--boss"></span>' +
        '</div>'
      );
    }

    function modeShapeRow(mode) {
      return (
        '<div class="mode-shape">' +
        '<span class="mode-shape__label">' + mode.name + '</span>' +
        miniPath(mode.rooms) +
        '<span class="mode-shape__note">' + mode.note + '</span>' +
        '</div>'
      );
    }

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

    /* The section strip (issue #98): one chip per section — below the
     * decorative .loop phase strip, which stays above it. */
    html +=
      ROGUE.sectionNav(
        [
          { id: 'gp-hub', label: 'Hub' },
          { id: 'gp-run', label: 'Run' },
          { id: 'gp-placement', label: 'Placement' },
          { id: 'gp-rooms', label: 'Room types' },
          { id: 'gp-boss', label: 'Boss ladder' },
          { id: 'gp-post-run', label: 'Post-run' },
          { id: 'gp-return', label: 'Back to the hub' }
        ],
        'Gameplay sections'
      );

    /* Phase 1 — the hub. */
    var hubIntro = ROGUE.proseById(hub, 'what-the-hub-is');
    if (hubIntro) {
      html += ROGUE.section('gp-hub', 'The hub', hubIntro.heading, null, ROGUE.paragraphs(hubIntro.text) + guideLink('hub', hubLabel));
    }

    /* Phase 2 — the run: the example-run chain (issue #119) — one
       labelled row per badge step (0–13), re-rolled after each boss,
       with the room-type legend and the three mode shapes. */
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
            '<div class="run-legend" aria-hidden="true">' +
            LEGEND.map(legendItem).join('') +
            '</div>' +
            '<div class="run-chain">' +
            EXAMPLE_RUN.map(exampleRunRow).join('') +
            '</div>' +
            '<p class="path-diagram__caption">An example Classic run: one row per badge step (0–13, top to bottom) — the path re-rolls after every boss, and every room column can be a route or a special room at the odds in <a href="#gp-placement">How rooms are placed</a>.</p>' +
            '<div class="mode-shapes">' +
            MODE_SHAPES.map(modeShapeRow).join('') +
            '</div>' +
            '<p class="path-diagram__caption">The three mode shapes, same read order — Fast Path steps hold 4 rooms (3 at the Champion stage); the Gauntlet opens with 5 rooms on badge 0, then none (boss right after the split).</p>' +
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
        '<div class="grid">' + ROGUE.cards(rooms, 'adventure') + '</div>' +
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
            '<li class="ladder__item" id="' + ROGUE.esc(ROGUE.recId('adventure', b.id)) + '">' +
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

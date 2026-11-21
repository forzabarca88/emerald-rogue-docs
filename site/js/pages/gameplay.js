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

    /*
     * The example path board (issue #119) — ONE Classic segment for
     * badge 1: the board rolled right after the first badge, heading
     * for Gym 2. Hand-authored from the `placement` rules in
     * data/adventure.json — every cell is a legal draw at badge 1
     * (routes and rest stops any badge; the wild den at the 40% badge
     * 1–7 tier; the gap at the 5% badge 1–7 tier; the game show at the
     * 50% roll on badges 0–5) — and NO RNG: the board is fixed so the
     * page's screenshots stay deterministic.
     *
     * `rooms` reads left to right, the in-game board layout (columns ×
     * lanes): the spawn column (the FIRST column, game x = pathLength −
     * 1), then two more room columns down to x = 2 (the always-empty
     * column in front of the gym is x = 1); each column is a list of
     * 1–3 lane cells, top to bottom. A cell is a room key — `gap` is the
     * in-game empty-sand lane (ADVPATH_ROOM_NONE: no object, just
     * path). The rest stop sits in the rightmost (near-boss) column:
     * the generator's rest-stop weight clamps to zero in the first
     * column (a length-5 Classic path: base 10 − 40 first-column
     * penalty → 0, rogue_adventurepaths.c L499–514/L593), so the
     * leftmost column can never carry one. `splitLanes` is the 2–3-lane
     * fan-out from the last column into the boss through the
     * always-empty column in front of the gym. `links` is the lane
     * wiring, one [fromCol, fromLane, toCol, toLane] each — column -1
     * is the start line, column 3 the boss: one legal roll (every cell
     * reachable from the start line and reaching the boss, each cell at
     * most 3 exits, the boss fan-in = splitLanes). The minimum-route
     * retention keeps 3 of the 4 routes plain — one of them is the den.
     * test/gameplay-run-data.test.mjs re-validates the board against
     * the same rules. */
    var EXAMPLE_BOARD = {
      badge: 1,
      boss: 'Gym 2',
      splitLanes: 2,
      rooms: [
        ['route', 'route'],
        ['den', 'route', 'gap'],
        ['show', 'rest']
      ],
      links: [
        [-1, 0, 0, 0],
        [-1, 1, 0, 1],
        [0, 0, 1, 0],
        [0, 0, 1, 1],
        [0, 1, 1, 1],
        [0, 1, 1, 2],
        [1, 0, 2, 0],
        [1, 1, 2, 0],
        [1, 1, 2, 1],
        [1, 2, 2, 1],
        [2, 0, 3, 0],
        [2, 1, 3, 0]
      ]
    };

    /* The board's geometry (viewBox units — the SVG scales to the panel
       width; DESIGN.md §5.1): the sand board, the start line, the 3 room
       columns (lane rows top/mid/bot — a 2-lane column takes the top and
       bottom rows, a 1-lane column the middle, the lanes drifting row by
       row like the in-game board), the always-empty split space and the
       boss. */
    var BOARD = {
      w: 336,
      h: 164,
      sand: { x: 4, y: 8, w: 328, h: 148, r: 8 },
      startX: 20,
      colX: [64, 136, 208],
      bossX: 298,
      bossInset: 15.6, /* the rotated boss square's left vertex */
      laneY: [26, 76, 126],
      node: 10, /* half-size of a 20-unit node square */
      labelDy: 23 /* label baseline below the node centre */
    };

    /* The route squares' type marker (the in-game per-type route
       sprite) — grass / water / fire in order of appearance. */
    var ROUTE_MARKS = ['grass', 'water', 'fire'];

    /* The lane rows a column's cells sit on (see BOARD.laneY). */
    function laneRows(count) {
      if (count === 3) return BOARD.laneY;
      if (count === 2) return [BOARD.laneY[0], BOARD.laneY[2]];
      return [BOARD.laneY[1]];
    }

    /* The centre of a board position: column -1 is the start line (the
       start line's links leave it at the neighbour column's lane row),
       0–2 the room columns, 3 the boss (the middle row). */
    function posXY(col, lane) {
      var x = col === -1 ? BOARD.startX : col === 3 ? BOARD.bossX : BOARD.colX[col];
      var y =
        col === -1
          ? laneRows(EXAMPLE_BOARD.rooms[0].length)[lane]
          : col === 3
            ? BOARD.laneY[1]
            : laneRows(EXAMPLE_BOARD.rooms[col].length)[lane];
      return [x, y];
    }

    /* One link of the sand path: a straight run when both ends share a
       row, an elbow (horizontal, one vertical, horizontal) through the
       mid-gap rail when they don't — the in-game T-junctions. */
    function linkPath(link) {
      var f = posXY(link[0], link[1]);
      var t = posXY(link[2], link[3]);
      var x1 = link[0] === -1 ? f[0] : f[0] + BOARD.node;
      var x2 = link[2] === 3 ? t[0] - BOARD.bossInset : t[0] - BOARD.node;
      if (f[1] === t[1]) return 'M' + x1 + ' ' + f[1] + 'H' + x2;
      var midX = Math.round((x1 + x2) / 2);
      return 'M' + x1 + ' ' + f[1] + 'H' + midX + 'V' + t[1] + 'H' + x2;
    }

    /* One room cell's node (the gap draws none — its lane is empty sand,
       and only its label marks the position): the route squares carry
       their type marker (ROUTE_MARKS, in order of appearance); the rest
       stop is the dashed outline; the den is the gold square, the
       sibling of the gold boss diamond; the game show is the small
       screen glyph. */
    function cellNode(key, x, y, routeIndex) {
      var n =
        '<rect class="path-board__node' +
        (key === 'rest' ? ' path-board__node--rest' : key === 'den' ? ' path-board__node--den' : '') +
        '" x="' +
        (x - BOARD.node) +
        '" y="' +
        (y - BOARD.node) +
        '" width="' +
        BOARD.node * 2 +
        '" height="' +
        BOARD.node * 2 +
        '"/>';
      var mark = '';
      if (key === 'route') {
        var kind = ROUTE_MARKS[routeIndex % ROUTE_MARKS.length];
        if (kind === 'grass') mark = '<polygon class="path-board__mark" points="' + [x, y - 4.5, x - 4.5, y + 3.5, x + 4.5, y + 3.5].join(',') + '"/>';
        else if (kind === 'water') mark = '<circle class="path-board__mark" cx="' + x + '" cy="' + y + '" r="4"/>';
        else mark = '<polygon class="path-board__mark" points="' + [x, y - 4.5, x + 4.5, y, x, y + 4.5, x - 4.5, y].join(',') + '"/>';
      } else if (key === 'show') {
        mark = '<rect class="path-board__mark" x="' + (x - 3.5) + '" y="' + (y - 3.5) + '" width="7" height="7"/>';
      }
      return n + mark;
    }

    /* The board's static inline SVG (DESIGN.md §5.1): the sand, the
       start line, the elbow sand path, the room nodes with their inline
       mono labels (the labels replace a legend), and the gold boss
       diamond labelled with its ladder step. Decorative — the visible
       caption and micro-note carry the meaning. */
    function boardSvg() {
      var s = '<svg class="path-board" viewBox="0 0 ' + BOARD.w + ' ' + BOARD.h + '" aria-hidden="true">';
      var sd = BOARD.sand;
      s += '<rect class="path-board__sand" x="' + sd.x + '" y="' + sd.y + '" width="' + sd.w + '" height="' + sd.h + '" rx="' + sd.r + '"/>';
      s += '<line class="path-board__start" x1="' + BOARD.startX + '" y1="' + BOARD.laneY[0] + '" x2="' + BOARD.startX + '" y2="' + BOARD.laneY[2] + '"/>';
      EXAMPLE_BOARD.links.forEach(function (link) {
        s += '<path class="path-board__line" d="' + linkPath(link) + '"/>';
      });
      var routeSeen = 0;
      EXAMPLE_BOARD.rooms.forEach(function (column, c) {
        var rows = laneRows(column.length);
        column.forEach(function (key, lane) {
          var x = BOARD.colX[c];
          var y = rows[lane];
          if (key !== 'gap') {
            s += cellNode(key, x, y, key === 'route' ? routeSeen++ : -1);
          }
          s += '<text class="path-board__label" x="' + x + '" y="' + (y + BOARD.labelDy) + '" text-anchor="middle">' + key + '</text>';
        });
      });
      s += '<rect class="path-board__boss" x="' + (BOARD.bossX - 11) + '" y="' + (BOARD.laneY[1] - 11) + '" width="22" height="22" transform="rotate(45 ' + BOARD.bossX + ' ' + BOARD.laneY[1] + ')"/>';
      s += '<text class="path-board__label path-board__label--boss" x="' + BOARD.bossX + '" y="' + (BOARD.laneY[1] + BOARD.labelDy + 4) + '" text-anchor="middle">' + ROGUE.esc(EXAMPLE_BOARD.boss) + '</text>';
      s += '<text class="path-board__label" x="' + BOARD.startX + '" y="' + (BOARD.laneY[2] + BOARD.labelDy) + '" text-anchor="middle">start</text>';
      return s + '</svg>';
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

    /* Phase 2 — the run: the how-the-path-works prose (how a run is
       actually played) + the example path board (issue #119) — ONE
       Classic segment (badge 1 → Gym 2) as a static inline SVG: the
       sand, the lane wiring, the room nodes with their inline mono
       labels, and the boss. */
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
            boardSvg() +
            '<p class="path-diagram__caption">One Classic segment — the board after your first badge, heading for Gym 2; every badge re-rolls a fresh one.</p>' +
            '<p class="path-diagram__note">A lane with no marker is just empty sand — the path still runs through it. Only the boss is mandatory.</p>' +
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

/*
 * pages/gameplay.js — the core gameplay loop, one section per phase:
 * hub → run (the generated path, every room type, the boss ladder) →
 * post-run (how the run's Pokémon feed the Safari Zone) → back to the hub.
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

    /* Phase 2 — the run: the freshly generated path. */
    var pathProse = ROGUE.proseById(adventure, 'how-the-path-works');
    if (pathProse) {
      html += ROGUE.section('gp-run', 'The run', pathProse.heading, null, ROGUE.paragraphs(pathProse.text));
    }

    /* The run — every room type on a generated path. */
    var roomsNote = ROGUE.proseById(adventure, 'reading-the-rooms');
    html +=
      ROGUE.section(
        'gp-rooms',
        'The run — room types',
        'Room types',
        adventure.meta && adventure.meta.description,
        '<div class="grid">' + ROGUE.cards(records(adventure, 'room-type')) + '</div>' +
          (roomsNote
            ? '<h3 class="rooms__note">' + ROGUE.esc(roomsNote.heading) + '</h3>' +
              ROGUE.paragraphs(roomsNote.text)
            : '')
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
            '<p class="card__source">' + ROGUE.esc(b.source) + '</p>' +
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

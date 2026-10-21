/*
 * pages/home.js — home page. The hero is built around the run-path
 * signature element (DESIGN.md §5.1): eyebrow, title and subtitle from
 * data/site.json, the pure-CSS run path, and the stat blocks. Below the
 * hero: quick-link cards for every other nav page, then the "About these
 * docs" prose. All content comes from data/site.json.
 */
(function () {
  'use strict';

  // The run-path markup is binding: keep it in sync with the contract
  // comment above .run-path in site/css/pages.css (DESIGN.md §5.1).
  var RUN_PATH =
    '<div class="run-path" aria-hidden="true">' +
    '<span class="run-path__node run-path__node--hub"></span>' +
    '<span class="run-path__link"></span>' +
    '<span class="run-path__node"></span>' +
    '<span class="run-path__link"></span>' +
    '<span class="run-path__fork">' +
    '<span class="run-path__lane">' +
    '<span class="run-path__node"></span>' +
    '<span class="run-path__link"></span>' +
    '<span class="run-path__node"></span>' +
    '</span>' +
    '<span class="run-path__lane">' +
    '<span class="run-path__node run-path__node--rest"></span>' +
    '<span class="run-path__link"></span>' +
    '<span class="run-path__node"></span>' +
    '</span>' +
    '</span>' +
    '<span class="run-path__link"></span>' +
    '<span class="run-path__node run-path__node--boss"></span>' +
    '</div>';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var site;
    try {
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    /* Hero: eyebrow / title / subtitle → run path → stat blocks. */
    var hero = site.hero || {};
    var html = '<section class="section hero">';
    html += '<div class="section__head">';
    if (hero.eyebrow) html += '<p class="eyebrow">' + ROGUE.esc(hero.eyebrow) + '</p>';
    html += '<h1>' + ROGUE.esc(hero.title || '') + '</h1>';
    if (hero.subtitle) html += '<p class="hero__subtitle">' + ROGUE.esc(hero.subtitle) + '</p>';
    html += '</div>';
    html += RUN_PATH;
    if (Array.isArray(hero.stats) && hero.stats.length) {
      html +=
        '<ul class="hero__stats">' +
        hero.stats
          .map(function (s) {
            return (
              '<li class="hero__stat">' +
              '<span class="hero__stat-value">' + ROGUE.esc(s.value) + '</span>' +
              '<span class="hero__stat-label">' + ROGUE.esc(s.label) + '</span>' +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    }
    html += '</section>';

    /* Quick-link cards for every other nav page. */
    var active = document.body.getAttribute('data-page') || '';
    var pages = site.pages || {};
    var links = (site.nav || []).filter(function (id) {
      return id !== active && pages[id];
    });
    if (links.length) {
      html +=
        '<section class="section"><div class="section__head"><h2>' +
        ROGUE.esc((site.quickLinks || {}).heading || 'Explore the docs') +
        '</h2></div>';
      html +=
        '<div class="grid">' +
        links
          .map(function (id) {
            var p = pages[id];
            return (
              '<a class="card card--link" href="./' + ROGUE.esc(id) + '.html">' +
              '<h3 class="card__title">' + ROGUE.esc(p.title) + '</h3>' +
              '<p class="card__desc">' + ROGUE.esc(p.description || '') + '</p>' +
              '</a>'
            );
          })
          .join('') +
        '</div></section>';
    }

    /* "About these docs" prose (data/site.json). */
    html += ROGUE.proseSections(site.prose);

    var main = document.querySelector('main');
    if (main) main.innerHTML = html;
  });
})();

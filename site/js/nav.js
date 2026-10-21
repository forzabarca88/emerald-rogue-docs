/*
 * nav.js — injects the site header (brand, nav links, version toggle) and
 * footer into the empty #site-header / #site-footer elements, entirely from
 * data/site.json. Loads after version.js + data.js; uses ROGUE.esc from
 * render.js at run time (all scripts are parsed before ready() fires).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  function siteOrEmpty() {
    try {
      return ROGUE.site();
    } catch (e) {
      return null;
    }
  }

  function versionOptionsHtml(site, current) {
    var vs = site.versions || {};
    return (vs.order || []).map(function (id) {
      var active = id === current;
      return (
        '<button type="button" class="version-toggle__option' +
        (active ? ' version-toggle__option--active' : '') +
        '" data-version="' + ROGUE.esc(id) +
        '" aria-pressed="' + String(active) + '">' +
        ROGUE.esc((vs.labels || {})[id] || id) +
        '</button>'
      );
    }).join('');
  }

  function syncToggle(current) {
    document.querySelectorAll('.version-toggle__option').forEach(function (btn) {
      var active = btn.getAttribute('data-version') === current;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('version-toggle__option--active', active);
    });
  }

  function buildHeader(site) {
    var header = document.getElementById('site-header');
    if (!header) return;
    var active = document.body.getAttribute('data-page') || '';
    var pages = site.pages || {};
    var nav = (site.nav || []).filter(function (id) {
      return pages[id];
    });
    var links = nav
      .map(function (id) {
        var p = pages[id];
        var cls = 'site-nav__link' + (id === active ? ' site-nav__link--active' : '');
        return (
          '<a class="' + cls + '" href="./' + ROGUE.esc(id) + '.html"' +
          (id === active ? ' aria-current="page"' : '') + '>' +
          ROGUE.esc(p.title) +
          '</a>'
        );
      })
      .join('');
    var brand = (site.site || {}).name || 'Rogue Docs';

    header.innerHTML =
      '<div class="container site-header__inner">' +
        '<a class="site-brand" href="./index.html">' + ROGUE.esc(brand) + '</a>' +
        '<nav class="site-nav" aria-label="Primary">' + links + '</nav>' +
        '<div class="version-toggle" role="group" aria-label="Game version">' +
          versionOptionsHtml(site, ROGUE.version) +
        '</div>' +
      '</div>';

    header.querySelectorAll('.version-toggle__option').forEach(function (btn) {
      btn.addEventListener('click', function () {
        ROGUE.setVersion(btn.getAttribute('data-version'));
      });
    });
  }

  function buildFooter(site) {
    var footer = document.getElementById('site-footer');
    if (!footer) return;
    var f = (site.site || {}).footer || {};
    footer.innerHTML =
      '<div class="container site-footer__inner">' +
        (f.text ? '<p>' + ROGUE.esc(f.text) + '</p>' : '') +
        (f.source ? '<p class="site-footer__source">' + ROGUE.esc(f.source) + '</p>' : '') +
      '</div>';
  }

  function init() {
    var site = siteOrEmpty();
    if (!site) {
      window.console.error('nav.js: data/site.json is missing from the bundle');
      return;
    }
    buildHeader(site);
    buildFooter(site);
    ROGUE.onChange(syncToggle);
  }

  ROGUE.ready(init);
})();

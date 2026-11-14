/*
 * nav.js — replaces the shells' static no-JS header/footer markup (brand
 * + nav links + footer only — the search trigger and version toggle are
 * JS-only, so they are omitted from the static shells) with the full
 * header (brand, nav links, the icon-only search trigger, version toggle)
 * and footer, entirely from data/site.json. It is the single source of
 * the header/footer when JS runs: buildHeader/buildFooter assign
 * .innerHTML on the existing #site-header / #site-footer elements, which
 * overwrites the static content, so nothing is duplicated. Loads after
 * version.js + data.js; uses ROGUE.esc from render.js at run time (all
 * scripts are parsed before ready() fires).
 *
 * The search trigger (#site-search-trigger, .site-search-trigger) is emitted
 * between the nav and the version toggle (the toggle stays last/rightmost).
 * nav.js only emits it — search.js binds the click and owns the overlay.
 * Its aria-label comes from the data/site.json `search` block's `label`
 * field (defensive fallback to "Search the site" when it is absent).
 *
 * After the header is replaced, nav.js also publishes the header's
 * measured rendered height on <html> as --site-header-h (at load + on
 * resize) — the sticky .section-nav strips' top offset (components.css)
 * and the base of the adopting pages' anchor scroll-margins (pages.css);
 * the header's height is width-dependent (two rows at every width —
 * issue #90 — with the ≤560px compact set), so it is measured, never
 * hardcoded.
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

    /* the trigger's accessible label (data/site.json search.label, with the
     * same defensive-fallback pattern search.js uses for its config strings) */
    var searchBlock = site.search && typeof site.search === 'object' ? site.search : {};
    var searchLabel = typeof searchBlock.label === 'string' && searchBlock.label !== '' ? searchBlock.label : 'Search the site';

    /* icon-only magnifier (stroke: currentColor) — the overlay itself is
     * owned by search.js; the trigger sits BETWEEN the nav and the toggle */
    var searchTrigger =
      '<button type="button" class="site-search-trigger" id="site-search-trigger" ' +
      'aria-label="' + ROGUE.esc(searchLabel) + '" aria-haspopup="dialog">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
      'stroke-linecap="round" aria-hidden="true" focusable="false">' +
      '<circle cx="10.5" cy="10.5" r="6.5"></circle>' +
      '<line x1="15.4" y1="15.4" x2="21" y2="21"></line>' +
      '</svg></button>';

    header.innerHTML =
      '<div class="container site-header__inner">' +
        '<a class="site-brand" href="./index.html">' + ROGUE.esc(brand) + '</a>' +
        '<nav class="site-nav" aria-label="Primary">' + links + '</nav>' +
        searchTrigger +
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

  /** Publish the sticky header's rendered height on <html> as
   *  --site-header-h — the .section-nav strips' sticky top offset
   *  (components.css) and the base of the pages' anchor
   *  scroll-margins. The header is two rows at EVERY width (issue
   *  #90) and its height is width-dependent only at ≤560px (the
   *  compact search-trigger/toggle set), so it is measured live —
   *  never hardcoded — and re-measured on resize. The search.js
   *  setPaletteTop pattern (measure on load, re-measure on resize),
   *  with this file's own element + variable name. */
  function measureHeaderHeight() {
    var header = document.getElementById('site-header');
    if (!header) return;
    document.documentElement.style.setProperty('--site-header-h', header.offsetHeight + 'px');
  }

  function init() {
    var site = siteOrEmpty();
    if (!site) {
      window.console.error('nav.js: data/site.json is missing from the bundle');
      return;
    }
    buildHeader(site);
    buildFooter(site);
    measureHeaderHeight();
    window.addEventListener('resize', measureHeaderHeight);
    ROGUE.onChange(syncToggle);
  }

  ROGUE.ready(init);
})();

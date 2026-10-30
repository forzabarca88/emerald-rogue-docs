/*
 * search.js — the site-wide search overlay (command-palette dialog,
 * issue #23). Loaded after data.js + render.js + search-index.js and
 * before the page scripts, in every shell (including 404.html, where no
 * page script runs — the overlay needs no page-script state).
 *
 * On ROGUE.ready it:
 *   1. builds the site index ONCE — ROGUE.buildSearchIndex() is
 *      version-independent (see search-index.js);
 *   2. appends the hidden `.search-palette` root to <body>: a backdrop +
 *      a panel (role="dialog" aria-modal="true", aria-label from the
 *      data/site.json `search` block's placeholder — the block has no
 *      dedicated label field) holding the search input (placeholder +
 *      aria-label from the same config), a live result-count line
 *      (role="status"), an empty-state element and the results list
 *      (role="listbox");
 *   3. binds the open triggers:
 *        - the header's icon-only button #site-search-trigger (emitted by
 *          nav.js between the nav and the version toggle). It TOGGLES:
 *          clicking it while the palette is open closes it;
 *        - the single-character `search.shortcut` key (default "/") on the
 *          document. Suppressed while an input/textarea/select/
 *          contenteditable holds focus (in-page searches — quests/hub —
 *          keep their own "/") and while a modifier key is held. While the
 *          palette is already open the shortcut does nothing special: it
 *          simply types into the palette input, which already holds focus.
 *   4. queries on every input event: ROGUE.searchQuery(entries, value,
 *      ROGUE.version). Each result row shows the title (plus a version
 *      badge via ROGUE.badge when the entry is single-version), a snippet
 *      around the match — text[matchIndex−40 … matchIndex+80], "…" where
 *      clipped (text is the lowercased haystack, per the search-index
 *      module) — and the page's NAV title from data/site.json (never the
 *      raw filename);
 *   5. keyboard: ArrowDown/ArrowUp move the active row (WRAP-AROUND, via
 *      aria-activedescendant + [data-active]); Enter navigates to
 *      entry.page + entry.anchor as a RELATIVE url (./quests.html#quest-…
 *      form, plain relative navigation — the active version rides along
 *      via localStorage, never the URL). When the target IS the current
 *      page it scrolls to the anchor (or the page top) WITHOUT a reload or
 *      URL change; cross-page targets set location.href. Escape closes.
 *      While open, Tab is swallowed: the input is the dialog's only
 *      focusable control, so there is nowhere inside it to move to, and
 *      the background page must stay unfocusable (the header — which is
 *      intentionally reachable while open so the version toggle can
 *      re-scope results — keeps its own tab order);
 *   6. closing: Escape, a click on the backdrop, or a successful Enter.
 *      Closing RESETS the query (the next open starts fresh) and restores
 *      focus to the trigger button. There is no exit animation (the
 *      entrance is the palette's only motion), so close is instant and
 *      deterministic.
 *   7. version: a stored ROGUE.onChange subscription re-runs the query
 *      with the new version while the palette is open (results re-scope
 *      live — e.g. EX-only quests drop out under Vanilla).
 *
 * Copy: an empty query shows the config `hint`; a non-empty query shows
 * "N result(s) match "q"" or "No results match "q"." in the count line —
 * the quests.js result-line style (curly quotes, no verb agreement).
 * Nothing is hardcoded beyond defensive fallbacks for a missing `search`
 * block (the same pattern as version.js's "ex" fallback).
 *
 * Layering: the root sits BELOW the sticky header (z-index:
 * calc(var(--z-header) − 1)) so the header's version toggle stays
 * clickable while the palette is open; the panel's top offset
 * (--palette-top) is set at open time to the header's rendered height +
 * 16px (and re-set on resize while open), so the two-row mobile header
 * never hides the panel. The overlay is position:fixed and appended to
 * <body> — no layout shift when it opens or closes.
 *
 * Stable ids (used by tests): #site-search-trigger (nav.js),
 * #search-palette (the root), #search-palette-list (the listbox),
 * #search-result-<i> (rows, aria-activedescendant targets).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  /** The header trigger button (emitted by nav.js between nav and toggle). */
  var TRIGGER_ID = 'site-search-trigger';
  /** The results listbox (referenced by the input's aria-controls). */
  var LIST_ID = 'search-palette-list';
  /** Row ids: 'search-result-0', … (aria-activedescendant targets). */
  var ROW_ID_PREFIX = 'search-result-';
  /** Snippet window around the match (the search-index module contract). */
  var SNIPPET_BEFORE = 40;
  var SNIPPET_AFTER = 80;
  /** Gap between the sticky header and the panel top (--palette-top). */
  var HEADER_GAP_PX = 16;

  /** data/site.json `search` block, with defensive fallbacks (see header doc). */
  function searchConfig() {
    var site = {};
    try {
      site = ROGUE.site() || {};
    } catch (e) {
      site = {};
    }
    var s = site.search && typeof site.search === 'object' ? site.search : {};
    return {
      placeholder: typeof s.placeholder === 'string' && s.placeholder !== '' ? s.placeholder : 'Search the site\u2026',
      hint: typeof s.hint === 'string' && s.hint !== '' ? s.hint : 'Press / to search',
      shortcut: typeof s.shortcut === 'string' && s.shortcut !== '' ? s.shortcut : '/'
    };
  }

  function init() {
    var config = searchConfig();
    var pages = {};
    try {
      pages = ROGUE.site().pages || {};
    } catch (e) {
      pages = {};
    }

    /* The index is built ONCE — version-independent (see search-index.js). */
    var entries = [];
    try {
      entries = ROGUE.buildSearchIndex();
    } catch (e) {
      window.console.error('search.js: failed to build the site search index', e);
    }

    /* ---- state + elements ------------------------------------------------ */
    var root, backdrop, panel, form, input, countLine, emptyEl, list, trigger;
    var isOpen = false;
    var activeIndex = -1;
    var currentResults = [];
    var offVersion = null;

    /* ---- markup (the panel's aria-label is the config placeholder) ------- */
    function buildDom() {
      root = document.createElement('div');
      root.className = 'search-palette';
      root.id = 'search-palette';
      root.hidden = true;
      root.innerHTML =
        '<div class="search-palette__backdrop" aria-hidden="true"></div>' +
        '<div class="search-palette__panel" role="dialog" aria-modal="true" aria-label="' +
        ROGUE.esc(config.placeholder) +
        '"><form class="search-palette__form" role="search"><div class="search search-palette__search">' +
        '<input type="search" class="search-palette__input" placeholder="' +
        ROGUE.esc(config.placeholder) +
        '" aria-label="' +
        ROGUE.esc(config.placeholder) +
        '" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' +
        LIST_ID +
        '"></div></form>' +
        '<p class="search-palette__count" role="status" hidden></p>' +
        '<p class="search-palette__empty" role="status" hidden></p>' +
        '<ul class="search-palette__list" id="' +
        LIST_ID +
        '" role="listbox" aria-label="Search results" hidden></ul></div>';
      backdrop = root.querySelector('.search-palette__backdrop');
      panel = root.querySelector('.search-palette__panel');
      form = root.querySelector('.search-palette__form');
      input = root.querySelector('.search-palette__input');
      countLine = root.querySelector('.search-palette__count');
      emptyEl = root.querySelector('.search-palette__empty');
      list = root.querySelector('#' + LIST_ID);
      trigger = document.getElementById(TRIGGER_ID);
      document.body.appendChild(root);
    }

    /* ---- helpers ---------------------------------------------------------- */

    /** The page's nav title from data/site.json (never the raw filename). */
    function pageLabel(entry) {
      var stem = String(entry.page || '').replace(/^\.\//, '').replace(/\.html$/, '');
      var page = pages[stem];
      return page && page.title ? page.title : stem || '\u2026';
    }

    /** A snippet around the match: 40 chars before, 80 after, "…" where clipped. */
    function snippet(text, matchIndex) {
      var t = typeof text === 'string' ? text : '';
      if (typeof matchIndex !== 'number' || matchIndex < 0) matchIndex = 0;
      var start = Math.max(0, matchIndex - SNIPPET_BEFORE);
      var end = Math.min(t.length, matchIndex + SNIPPET_AFTER);
      var s = t.slice(start, end);
      if (start > 0) s = '\u2026' + s;
      if (end < t.length) s = s + '\u2026';
      return s;
    }

    function rowHtml(result, i) {
      var singleVersion = Array.isArray(result.versions) && result.versions.length === 1;
      var html =
        '<li class="search-palette__row" id="' +
        ROW_ID_PREFIX +
        i +
        '" role="option" aria-selected="false" data-index="' +
        i +
        '"><div class="search-palette__row-head"><span class="search-palette__row-name">' +
        ROGUE.esc(result.title) +
        '</span>';
      if (singleVersion) html += ROGUE.badge({ versions: result.versions });
      html +=
        '</div><p class="search-palette__row-snippet">' +
        ROGUE.esc(snippet(result.text, result.matchIndex)) +
        '</p><p class="search-palette__row-meta">' +
        ROGUE.esc(pageLabel(result)) +
        '</p></li>';
      return html;
    }

    /* ---- rendering --------------------------------------------------------- */

    function renderQuery(raw) {
      var q = String(raw === null || raw === undefined ? '' : raw).trim();
      currentResults = q ? ROGUE.searchQuery(entries, q, ROGUE.version) : [];
      var n = currentResults.length;

      /* exactly one of the count line / empty state is visible: the empty
       * query shows the config hint; a non-empty query shows the match
       * count or the no-match message (quests.js result-line copy style) */
      if (!q) {
        countLine.hidden = true;
        emptyEl.hidden = false;
        emptyEl.textContent = config.hint;
      } else if (n === 0) {
        emptyEl.hidden = true;
        countLine.hidden = false;
        countLine.textContent = 'No results match \u201C' + q + '\u201D.';
      } else {
        emptyEl.hidden = true;
        countLine.hidden = false;
        countLine.textContent = n + ' result' + (n === 1 ? '' : 's') + ' match \u201C' + q + '\u201D';
      }

      if (n) {
        list.innerHTML = currentResults
          .map(rowHtml)
          .join('');
        list.hidden = false;
      } else {
        list.innerHTML = '';
        list.hidden = true;
      }
      setActive(0);
    }

    /** Move the active row (aria-activedescendant + [data-active]) and keep it in view. */
    function setActive(i) {
      var rows = list.querySelectorAll('.search-palette__row');
      if (i < 0 || i >= rows.length) i = -1;
      activeIndex = i;
      for (var k = 0; k < rows.length; k++) {
        var on = k === i;
        rows[k].setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) rows[k].setAttribute('data-active', '');
        else rows[k].removeAttribute('data-active');
      }
      if (i >= 0 && rows[i]) {
        input.setAttribute('aria-activedescendant', rows[i].id);
        rows[i].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    /* ---- open / close ------------------------------------------------------- */

    /** Park the panel just below the sticky header (one row at ≥820px, two rows below). */
    function setPaletteTop() {
      var header = document.getElementById('site-header');
      var top = (header ? header.offsetHeight : 60) + HEADER_GAP_PX;
      root.style.setProperty('--palette-top', top + 'px');
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      setPaletteTop();
      root.hidden = false;
      input.value = '';
      renderQuery('');
      input.setAttribute('aria-expanded', 'true');
      void root.offsetWidth; // reflow so the entrance transition runs
      root.classList.add('search-palette--open');
      input.focus();
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      root.classList.remove('search-palette--open');
      root.hidden = true;
      input.value = '';
      input.setAttribute('aria-expanded', 'false');
      currentResults = [];
      activeIndex = -1;
      if (trigger) trigger.focus();
    }

    /* ---- navigation ----------------------------------------------------------- */

    function navigate(result) {
      var targetFile = String(result.page || '').replace(/^\.\//, '');
      var segments = window.location.pathname.split('/');
      var currentFile = segments.length ? segments[segments.length - 1] : '';
      if (!currentFile) currentFile = 'index.html';
      if (targetFile === currentFile) {
        // same page: scroll to the anchor (or the top) without a reload or URL change
        var el = result.anchor ? document.getElementById(result.anchor.slice(1)) : null;
        if (el) el.scrollIntoView();
        else window.scrollTo(0, 0);
      } else {
        window.location.href = result.page + (result.anchor || '');
      }
    }

    function activate() {
      var result = activeIndex >= 0 ? currentResults[activeIndex] : null;
      if (!result) return;
      close();
      navigate(result);
    }

    /* ---- events ------------------------------------------------------------------ */

    /** True when the focused element is a text entry (in-page searches keep their "/"). */
    function isTypingTarget(el) {
      if (!el || typeof el.tagName !== 'string') return false;
      var tag = el.tagName.toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
    }

    function rowFrom(event) {
      var t = event.target;
      if (!t || typeof t.closest !== 'function') return null;
      return t.closest('li.search-palette__row');
    }

    function onKeydown(e) {
      if (isOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var n = currentResults.length;
          if (!n) return;
          var dir = e.key === 'ArrowDown' ? 1 : -1;
          setActive(activeIndex < 0 ? 0 : (activeIndex + dir + n) % n); // wrap-around
        } else if (e.key === 'Enter' && e.target === input) {
          e.preventDefault(); // never let the form submit
          activate();
        } else if (e.key === 'Tab') {
          e.preventDefault(); // trap: the input is the dialog's only focusable control
        }
        return;
      }
      /* closed: the configured shortcut opens the palette */
      if (e.key === config.shortcut && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
        if (isTypingTarget(document.activeElement)) return;
        e.preventDefault();
        open();
      }
    }

    function bind() {
      document.addEventListener('keydown', onKeydown);

      if (trigger) {
        trigger.addEventListener('click', function () {
          if (isOpen) close();
          else open(); // toggles
        });
      }

      backdrop.addEventListener('click', function () {
        close();
      });

      input.addEventListener('input', function () {
        renderQuery(input.value);
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
      });

      list.addEventListener('mouseover', function (e) {
        var row = rowFrom(e);
        if (row) setActive(Number(row.getAttribute('data-index')));
      });

      list.addEventListener('mousedown', function (e) {
        if (rowFrom(e)) e.preventDefault(); // keep the input focused (no blur)
      });

      list.addEventListener('click', function (e) {
        var row = rowFrom(e);
        if (!row) return;
        var result = currentResults[Number(row.getAttribute('data-index'))];
        if (!result) return;
        close();
        navigate(result);
      });

      /* version changes re-scope the OPEN palette live; the unsubscribe fn is
       * stored (the overlay lives for the page lifetime, so it is never called) */
      offVersion = ROGUE.onChange(function () {
        if (isOpen) renderQuery(input.value);
      });

      window.addEventListener('resize', function () {
        if (isOpen) setPaletteTop();
      });
    }

    buildDom();
    bind();
  }

  ROGUE.ready(init);
})();

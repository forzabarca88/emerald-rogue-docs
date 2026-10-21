/*
 * version.js — Vanilla/EX version state. Loads after data/bundle.js.
 *
 * Precedence: ?version= URL param > localStorage > defaultVersion from
 * data/site.json (falls back to "ex" when site.json is absent/invalid).
 *
 * Exposes: ROGUE.ready(fn), ROGUE.version, ROGUE.setVersion(v),
 * ROGUE.onChange(fn), ROGUE.filter(records).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};
  var ALLOWED = ['vanilla', 'ex'];
  var STORAGE_KEY = 'emerald-rogue-version';
  var listeners = [];

  function valid(v) {
    return ALLOWED.indexOf(v) !== -1;
  }

  function siteDefault() {
    try {
      var v = (window.ROGUE_DATA_SITE || {}).defaultVersion;
      return valid(v) ? v : 'ex';
    } catch (e) {
      return 'ex';
    }
  }

  function paramVersion() {
    try {
      var v = new URLSearchParams(window.location.search).get('version');
      return valid(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function storedVersion() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      return valid(v) ? v : null;
    } catch (e) {
      return null; // storage unavailable (file://, private mode)
    }
  }

  function writeUrl(v) {
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('version', v);
      window.history.replaceState(window.history.state, '', url);
    } catch (e) {
      // best effort — some contexts (file://) disallow history rewrites
    }
  }

  // ?version= is an intentional one-time override: it takes precedence for this load only and is never persisted to localStorage.
  var state = paramVersion() || storedVersion() || siteDefault();

  Object.defineProperty(ROGUE, 'version', {
    enumerable: true,
    configurable: true,
    get: function () {
      return state;
    }
  });

  /** Set the active version. Persists to localStorage + ?version=, notifies onChange listeners. */
  ROGUE.setVersion = function (v) {
    if (!valid(v)) return false;
    if (v === state) return true;
    state = v;
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch (e) {
      // best effort
    }
    writeUrl(v);
    listeners.slice().forEach(function (fn) {
      try {
        fn(v);
      } catch (err) {
        window.console.error(err);
      }
    });
    return true;
  };

  /** Subscribe to version changes. Returns an unsubscribe function. */
  ROGUE.onChange = function (fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (l) {
        return l !== fn;
      });
    };
  };

  /** Keep only the records whose `versions` include the current version. */
  ROGUE.filter = function (records) {
    return (Array.isArray(records) ? records : []).filter(function (r) {
      return r && Array.isArray(r.versions) && r.versions.indexOf(state) !== -1;
    });
  };

  /* Tiny DOM-ready helper shared by all site scripts (page scripts run at
   * the end of <body>, so this normally fires immediately). */
  ROGUE.ready = function (fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };
})();

/*
 * data.js — access to the bundled data files. Loads after version.js.
 *
 * Exposes: ROGUE.data(id), ROGUE.site().
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  /** Return the parsed data object for a meta.id (e.g. "quests"). Throws when the id is not bundled. */
  ROGUE.data = function (id) {
    var key = 'ROGUE_DATA_' + String(id).toUpperCase();
    var data = window[key];
    if (!data || typeof data !== 'object') {
      throw new Error('ROGUE.data("' + id + '"): no bundled data for this id (expected window.' + key + ')');
    }
    return data;
  };

  /** Shortcut for the site configuration (data/site.json). */
  ROGUE.site = function () {
    return ROGUE.data('site');
  };
})();

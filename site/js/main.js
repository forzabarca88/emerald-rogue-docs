/*
 * main.js — app bootstrap. Loads after render.js, before page scripts.
 * Keeps the browser tab title + meta description driven by data/site.json
 * (the static values in <head> are only the no-JS fallback).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  ROGUE.ready(function () {
    var site;
    try {
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }
    var stem = document.body.getAttribute('data-page') || '';
    var page = (site.pages || {})[stem];
    if (!page) return;
    var name = (site.site || {}).name || '';
    document.title = page.title + (name ? ' · ' + name : '');
    var meta = document.querySelector('meta[name="description"]');
    if (meta && page.description) meta.setAttribute('content', page.description);
  });
})();

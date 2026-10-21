/*
 * pages/versions.js — Vanilla vs EX. The intro prose and the master list
 * of difference records come from data/versions.json. Each record renders
 * as a comparison row: a Vanilla column vs an EX column (values from the
 * record's `differences`, else the shared description; "not present"
 * where the record's `versions` do not include a build). The global
 * version toggle highlights the active version's column and dims rows
 * that only exist in the other build.
 */
(function () {
  'use strict';

  var DIFFS_ID = 'version-diffs';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('versions');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var labels = ((site.versions || {}).labels) || {};
    var label = function (id) {
      return labels[id] || id;
    };
    var records = Array.isArray(data.records) ? data.records : [];

    /** Cell text for one version of a record; null when the record does not apply. */
    function columnText(record, diff, version) {
      if (!record || !Array.isArray(record.versions) || record.versions.indexOf(version) === -1) {
        return null;
      }
      if (diff && typeof diff[version] === 'string' && diff[version].trim()) {
        return diff[version];
      }
      return record.description || '';
    }

    function column(version, text) {
      var absent = text === null || text === undefined;
      return (
        '<div class="diff__col diff__col--' + version + (absent ? ' diff__col--absent' : '') + '">' +
        '<span class="diff__col-label">' + ROGUE.esc(label(version)) + '</span>' +
        '<p class="diff__col-text">' +
        ROGUE.esc(absent ? 'Not present in this build.' : text) +
        '</p></div>'
      );
    }

    function mergedBoth(record) {
      return (
        '<div class="diff__col diff__col--both">' +
        '<span class="diff__col-label">' + ROGUE.esc(label('both')) + '</span>' +
        '<p class="diff__col-text">' + ROGUE.esc(record.description || '') + '</p>' +
        '</div>'
      );
    }

    function row(record) {
      var vs = Array.isArray(record.versions) ? record.versions : [];
      var both = vs.indexOf('vanilla') !== -1 && vs.indexOf('ex') !== -1;
      var diff = record.differences && typeof record.differences === 'object' ? record.differences : null;
      var cols;
      if (both && !diff) {
        cols = mergedBoth(record);
      } else {
        cols = column('vanilla', columnText(record, diff, 'vanilla')) + column('ex', columnText(record, diff, 'ex'));
      }
      var scope = both ? 'both' : vs[0] || 'ex';
      return (
        '<div class="diff diff--scope-' + scope + '">' +
        '<div class="diff__feature">' +
        '<h3 class="diff__name">' + ROGUE.esc(record.name) + '</h3>' +
        '<p class="diff__meta">' +
        ROGUE.badge(record) +
        (record.category ? '<span class="chip">' + ROGUE.esc(record.category) + '</span>' : '') +
        '</p></div>' +
        '<div class="diff__cols">' + cols + '</div>' +
        '</div>'
      );
    }

    var html = '<h1>' + ROGUE.esc(((site.pages || {}).versions || {}).title || 'Versions') + '</h1>';

    /* Intro prose (data/versions.json). */
    html += ROGUE.proseSections(data.prose);

    /* The master list of differences. */
    html +=
      '<section class="section"><div class="section__head">' +
      '<p class="eyebrow">Feature by feature</p>' +
      '<h2>' + ROGUE.esc((data.meta && data.meta.title) || 'Vanilla vs Expansion') + '</h2>' +
      '<p>' + ROGUE.esc((data.meta && data.meta.description) || '') + '</p>' +
      '</div><div class="section__body">' +
      '<div class="diffs diffs--' + ROGUE.esc(ROGUE.version) + '" id="' + DIFFS_ID + '">' +
      records.map(row).join('') +
      '</div></div></section>';

    var main = document.querySelector('main');
    if (main) main.innerHTML = html;

    /* The toggle re-highlights the active version's column. */
    var diffsEl = document.getElementById(DIFFS_ID);
    function syncDiffs() {
      if (!diffsEl) return;
      diffsEl.classList.toggle('diffs--vanilla', ROGUE.version === 'vanilla');
      diffsEl.classList.toggle('diffs--ex', ROGUE.version === 'ex');
    }
    syncDiffs();
    ROGUE.onChange(syncDiffs);
  });
})();

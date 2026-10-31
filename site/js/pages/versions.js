/*
 * pages/versions.js — Vanilla vs EX. The intro prose and the master list
 * of difference records come from data/versions.json. Each record renders
 * as a comparison row: a Vanilla column vs an EX column (values from the
 * record's `differences`, else the shared description; "not present"
 * where the record's `versions` do not include a build). The global
 * version toggle highlights the active version's column and dims rows
 * that only exist in the other build.
 *
 * Above the rows, an at-a-glance overview strip (issue #31): one count
 * cell per distinct record `category` (first-appearance order) showing
 * how many differences in that category apply to the ACTIVE build. The
 * strip re-renders with the toggle (the rows themselves stay put — they
 * only dim); a 0-count category recedes as a non-link, and each live
 * cell anchor-scrolls to the first row of its category (only that row
 * carries the #vover-<category> id). The visible caption carries the
 * strip's meaning.
 */
(function () {
  'use strict';

  var DIFFS_ID = 'version-diffs';
  var OVERVIEW_ID = 'version-overview';

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

    /** Distinct record categories in first-appearance order (data/versions.json). */
    var categories = [];
    records.forEach(function (r) {
      if (r && r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
    });

    /** How many records of `cat` apply to the given build. */
    function categoryCount(cat, version) {
      var n = 0;
      records.forEach(function (r) {
        var vs = Array.isArray(r.versions) ? r.versions : [];
        if (r.category === cat && vs.indexOf(version) !== -1) n += 1;
      });
      return n;
    }

    /** One overview cell; a 0-count category recedes as a non-link. */
    function overviewCell(cat, version) {
      var n = categoryCount(cat, version);
      var inner =
        '<span class="voverview__count">' + n + '</span>' +
        '<span class="voverview__name">' + ROGUE.esc(cat) + '</span>';
      if (n === 0) {
        return '<span class="voverview__cell voverview__cell--off" aria-disabled="true">' + inner + '</span>';
      }
      return '<a class="voverview__cell" href="#vover-' + ROGUE.esc(cat) + '">' + inner + '</a>';
    }

    /** The strip plus its caption line (the caption carries the meaning). */
    function overviewHtml(version) {
      var total = 0;
      var live = 0;
      categories.forEach(function (cat) {
        var n = categoryCount(cat, version);
        total += n;
        if (n > 0) live += 1;
      });
      var caption =
        total + (total === 1 ? ' difference' : ' differences') +
        ' in ' + label(version) +
        ' across ' + live + (live === 1 ? ' category' : ' categories') +
        ' — pick a category to jump to its first row.';
      return (
        '<div class="voverview__cells">' +
        categories
          .map(function (cat) {
            return overviewCell(cat, version);
          })
          .join('') +
        '</div>' +
        '<p class="voverview__caption">' + ROGUE.esc(caption) + '</p>'
      );
    }

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

    /** `anchor` (optional) is the #vover-<category> id of the first row in a category. */
    function row(record, anchor) {
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
        '<div class="diff diff--scope-' + scope + '"' + (anchor ? ' id="' + ROGUE.esc(anchor) + '"' : '') + '">' +
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

    /* The first row of each category carries its anchor id. */
    var firstSeen = {};
    var rows = records
      .map(function (r) {
        var anchor = null;
        if (r && r.category && !firstSeen[r.category]) {
          firstSeen[r.category] = true;
          anchor = 'vover-' + r.category;
        }
        return row(r, anchor);
      })
      .join('');

    /* The master list of differences (overview strip above the rows). */
    html +=
      '<section class="section"><div class="section__head">' +
      '<p class="eyebrow">Feature by feature</p>' +
      '<h2>' + ROGUE.esc((data.meta && data.meta.title) || 'Vanilla vs Expansion') + '</h2>' +
      '<p>' + ROGUE.esc((data.meta && data.meta.description) || '') + '</p>' +
      '</div><div class="section__body">' +
      '<div class="voverview" id="' + OVERVIEW_ID + '">' + overviewHtml(ROGUE.version) + '</div>' +
      '<div class="diffs diffs--' + ROGUE.esc(ROGUE.version) + '" id="' + DIFFS_ID + '">' +
      rows +
      '</div></div></section>';

    var main = document.querySelector('main');
    if (main) main.innerHTML = html;

    /* The toggle re-highlights the rows and re-renders the overview strip. */
    var diffsEl = document.getElementById(DIFFS_ID);
    var overviewEl = document.getElementById(OVERVIEW_ID);
    function syncDiffs() {
      if (diffsEl) {
        diffsEl.classList.toggle('diffs--vanilla', ROGUE.version === 'vanilla');
        diffsEl.classList.toggle('diffs--ex', ROGUE.version === 'ex');
      }
      if (overviewEl) overviewEl.innerHTML = overviewHtml(ROGUE.version);
    }
    syncDiffs();
    ROGUE.onChange(syncDiffs);
  });
})();

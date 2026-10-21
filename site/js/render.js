/*
 * render.js — shared rendering helpers and pure utilities. Loads after
 * nav.js; page scripts build on these.
 *
 * Exposes: ROGUE.esc(s), ROGUE.badgeClass(record), ROGUE.badge(record),
 * ROGUE.paragraphs(text), ROGUE.cards(records), ROGUE.table(records, columns),
 * ROGUE.proseSections(prose), ROGUE.section(id, eyebrow, heading, intro, body),
 * ROGUE.chip(text), ROGUE.proseById(data, id), ROGUE.byCategory(records, category),
 * ROGUE.versionLabel(id), ROGUE.diffNote(record[, text]).
 */
(function () {
  'use strict';

  var ROGUE = window.ROGUE = window.ROGUE || {};

  /** Escape a value for safe insertion into HTML. */
  ROGUE.esc = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** Version badge CSS class for a record: badge--both | badge--ex | badge--vanilla. */
  ROGUE.badgeClass = function (record) {
    var vs = record && Array.isArray(record.versions) ? record.versions : [];
    var hasVanilla = vs.indexOf('vanilla') !== -1;
    var hasEx = vs.indexOf('ex') !== -1;
    if (hasVanilla && hasEx) return 'badge--both';
    if (hasEx) return 'badge--ex';
    if (hasVanilla) return 'badge--vanilla';
    return 'badge--both';
  };

  function siteOrEmpty() {
    try {
      return ROGUE.site();
    } catch (e) {
      return {};
    }
  }

  function badgeHtml(record) {
    var labels = ((siteOrEmpty().versions || {}).labels) || {};
    var vs = record && Array.isArray(record.versions) ? record.versions : [];
    var label;
    if (vs.indexOf('vanilla') !== -1 && vs.indexOf('ex') !== -1) {
      label = labels.both || 'Both';
    } else {
      label = labels[vs[0]] || '';
    }
    return '<span class="badge ' + ROGUE.badgeClass(record) + '">' + ROGUE.esc(label) + '</span>';
  }


  /** Split prose text on blank lines into escaped <p> paragraphs. */
  function paragraphs(text) {
    return String(text === null || text === undefined ? '' : text)
      .split(/\n{2,}/)
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean)
      .map(function (t) {
        return '<p>' + ROGUE.esc(t) + '</p>';
      })
      .join('');
  }

  /** Prose text → escaped <p> paragraphs (the same rule ROGUE.proseSections uses). */
  ROGUE.paragraphs = function (text) {
    return paragraphs(text);
  };

  /** Version badge markup for a record (the same badge ROGUE.cards() emits). */
  ROGUE.badge = function (record) {
    return badgeHtml(record);
  };

  /** Records → card markup (call ROGUE.filter(records) first for version scoping). */
  ROGUE.cards = function (records) {
    return (Array.isArray(records) ? records : [])
      .map(function (r) {
        var html = '<article class="card">';
        html +=
          '<div class="card__head"><h3 class="card__title">' +
          ROGUE.esc(r.name) +
          '</h3>' + badgeHtml(r) + '</div>';
        if (r.description) html += '<p class="card__desc">' + ROGUE.esc(r.description) + '</p>';
        if (r.source) html += '<p class="card__source">' + ROGUE.esc(r.source) + '</p>';
        return html + '</article>';
      })
      .join('');
  };

  /**
   * Records → table markup.
   * @param {Array} records data records
   * @param {Array<{key: string, label: string}>} columns table columns
   */
  ROGUE.table = function (records, columns) {
    if (!Array.isArray(columns) || columns.length === 0) return '';
    var head =
      '<tr>' +
      columns.map(function (c) {
        return '<th scope="col">' + ROGUE.esc(c.label) + '</th>';
      }).join('') +
      '</tr>';
    var rows = (Array.isArray(records) ? records : [])
      .map(function (r) {
        return (
          '<tr>' +
          columns
            .map(function (c) {
              var v = r ? r[c.key] : '';
              return '<td>' + ROGUE.esc(typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v)) + '</td>';
            })
            .join('') +
          '</tr>'
        );
      })
      .join('');
    return '<table class="table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  };

  /** Prose array → stacked <section> markup. */
  ROGUE.proseSections = function (prose) {
    return (Array.isArray(prose) ? prose : [])
      .map(function (p, i) {
        var id = p.id ? ' id="' + ROGUE.esc(p.id) + '"' : '';
        return (
          '<section class="section"' + id + '>' +
          '<div class="section__head"><h2>' + ROGUE.esc(p.heading) + '</h2></div>' +
          '<div class="section__body">' + paragraphs(p.text) + '</div>' +
          '</section>'
        );
      })
      .join('');
  };

  /** Page section: .section with head (eyebrow + heading + optional intro line) and body. */
  ROGUE.section = function (id, eyebrow, heading, intro, body) {
    var html = '<section class="section" id="' + ROGUE.esc(id) + '">';
    html += '<div class="section__head">';
    if (eyebrow) html += '<p class="eyebrow">' + ROGUE.esc(eyebrow) + '</p>';
    html += '<h2>' + ROGUE.esc(heading) + '</h2>';
    if (intro) html += '<p>' + ROGUE.esc(intro) + '</p>';
    html += '</div>';
    html += '<div class="section__body">' + body + '</div></section>';
    return html;
  };

  /** A single .chip tag of escaped text. */
  ROGUE.chip = function (text) {
    return '<span class="chip">' + ROGUE.esc(text) + '</span>';
  };

  /** One entry of a data file's `prose` array by id (null when absent). */
  ROGUE.proseById = function (data, id) {
    var list = data && Array.isArray(data.prose) ? data.prose : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  };

  /** The records of a data file whose `category` matches (unfiltered — apply ROGUE.filter). */
  ROGUE.byCategory = function (records, category) {
    return (Array.isArray(records) ? records : []).filter(function (r) {
      return r && r.category === category;
    });
  };

  /** The site's version label for a version id ("Vanilla"/"EX"), falling back to the id. */
  ROGUE.versionLabel = function (id) {
    var labels = ((siteOrEmpty().versions || {}).labels) || {};
    return labels[id] || id;
  };

  /**
   * The "Differs in <other version>" footnote for a record whose data
   * carries per-version `differences`. The note text defaults to the other
   * side's `differences` string; pass a second argument to supply
   * pre-formatted text (e.g. structured per-version fields).
   */
  ROGUE.diffNote = function (record, text) {
    var other = ROGUE.version === 'vanilla' ? 'ex' : 'vanilla';
    if (text === undefined) {
      var diff = record && record.differences;
      if (!diff || typeof diff !== 'object') return '';
      text = typeof diff[other] === 'string' ? diff[other].trim() : '';
    }
    if (!text) return '';
    return (
      '<p class="card__diff"><span class="field-label card__diff-label">' +
      ROGUE.esc('Differs in ' + ROGUE.versionLabel(other)) +
      '</span>' +
      ROGUE.esc(text) +
      '</p>'
    );
  };
})();

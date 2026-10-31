/*
 * pages/config.js — the run-configuration reference.
 *
 * Sections, all rendered strictly from data:
 *   1. intro prose (data/settings.json) — the difficulty-scale block
 *      renders the 0–13 ladder visual (one numbered cell per stage,
 *      tier-colored, weather-onset caption) from its structured `ladder`
 *      field around the trimmed prose.
 *   2. Game modes — the three rule sets as cards with their full rule
 *      tables (data/game-modes.json), plus the cross-cutting rule
 *      assembly as a `.step-strip` numbered flow (from the prose
 *      block's `steps` field) over the trimmed prose.
 *   3. Difficulty — the 0–4 level range and the five preset records
 *      with their forced-toggle / forced-slider chips (data/settings.json).
 *   4. Toggles — the on/off switches grouped by their settings submenu
 *      (Edit Difficulty / Adventure / Trainers). EX-only toggles (Affection
 *      FX, the Sinnoh–Paldea trainer regions) are filtered out of the
 *      Vanilla view via ROGUE.filter.
 *   5. Ranges — every slider with its option list and player-facing
 *      option descriptions; the Pokédex variant renders the active
 *      version's option list (7 Vanilla vs 37 EX).
 *   6. Campaigns — a compact easter-egg callout listing the hidden
 *      unlock phrases, parsed from data/campaigns.json's trigger record
 *      and joined to the campaign-mode records.
 *
 * Version changes re-render the page (filtered records, per-version
 * option lists). An in-page anchor-chip strip links to each section.
 */
(function () {
  'use strict';

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var settings, modes, campaigns, site;
    try {
      settings = ROGUE.data('settings');
      modes = ROGUE.data('game-modes');
      campaigns = ROGUE.data('campaigns');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var sRecords = Array.isArray(settings.records) ? settings.records : [];
    var mRecords = Array.isArray(modes.records) ? modes.records : [];
    var cRecords = Array.isArray(campaigns.records) ? campaigns.records : [];
    var pages = site.pages || {};

    function findRecord(list, id) {
      return list.filter(function (r) {
        return r && r.id === id;
      })[0] || null;
    }

    function fieldBlock(label, inner) {
      return '<p class="set-field"><span class="field-label">' + label + '</span>' + inner + '</p>';
    }

    /* --- Difficulty ladder (data/settings.json `difficulty-scale`) ------ */

    /**
     * The 0–13 difficulty ladder: one numbered cell per stage, colored by
     * tier (emerald gyms → gold Elite Four outline → solid gold champion),
     * a tier key row above and the weather-onset fact as the visible
     * caption. The cell board is decorative (aria-hidden) — the key row
     * (tier names + ranges) and the caption carry the same meaning for
     * screen readers. Every value comes from the prose block's structured
     * `ladder` field.
     */
    function difficultyLadder(l) {
      if (!l || !Array.isArray(l.tiers) || !l.tiers.length) return '';
      var first = l.stages && typeof l.stages.first === 'number' ? l.stages.first : l.tiers[0].first;
      var last = l.stages && typeof l.stages.last === 'number' ? l.stages.last : l.tiers[l.tiers.length - 1].last;
      if (!(last >= first)) return '';
      var kindFor = {};
      l.tiers.forEach(function (t) {
        for (var n = t.first; n <= t.last; n++) kindFor[n] = t.kind;
      });
      var cells = '';
      for (var n = first; n <= last; n++) {
        cells +=
          '<li class="diff-ladder__cell diff-ladder__cell--' +
          ROGUE.esc(kindFor[n] || 'gym') +
          '">' +
          n +
          '</li>';
      }
      var keys = l.tiers
        .map(function (t) {
          return (
            '<span class="diff-ladder__key diff-ladder__key--' +
            ROGUE.esc(t.kind) +
            '">' +
            ROGUE.esc(t.label) +
            ' ' +
            t.first +
            '\u2013' +
            t.last +
            '</span>'
          );
        })
        .join('');
      return (
        '<figure class="diff-ladder">' +
        '<div class="diff-ladder__keys">' +
        keys +
        '</div>' +
        '<ol class="diff-ladder__board" style="grid-template-columns:repeat(' +
        (last - first + 1) +
        ',minmax(0,1fr))" aria-hidden="true">' +
        cells +
        '</ol>' +
        (l.weather
          ? '<figcaption class="diff-ladder__caption">' + ROGUE.esc(l.weather) + '</figcaption>'
          : '') +
        '</figure>'
      );
    }

    /** The difficulty-scale prose block as a section with the ladder visual. */
    function difficultyScaleSection(p) {
      return ROGUE.section(
        'difficulty-scale',
        '',
        p.heading,
        '',
        ROGUE.paragraphs(p.text) + difficultyLadder(p.ladder)
      );
    }

    /** A short true sequence (3–5 steps) as a wrapping numbered strip. */
    function stepStrip(steps, label) {
      if (!Array.isArray(steps) || !steps.length) return '';
      return (
        '<ol class="step-strip"' +
        (label ? ' aria-label="' + ROGUE.esc(label) + '"' : '') +
        '>' +
        steps
          .map(function (s, i) {
            return (
              '<li class="step-strip__step">' +
              '<span class="step-strip__index">' +
              (i + 1) +
              '</span>' +
              '<span class="step-strip__label">' +
              ROGUE.esc(s) +
              '</span>' +
              '</li>'
            );
          })
          .join('') +
        '</ol>'
      );
    }

    /* --- Game modes ------------------------------------------------------ */

    function modeCard(record) {
      var html = '<article class="card mode-card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' + ROGUE.esc(record.name) +
        '</h3>' + ROGUE.badge(record) + '</div>';
      html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      var rules = Array.isArray(record.rules) ? record.rules : [];
      if (rules.length) {
        html +=
          '<ul class="mode-rules">' +
          rules
            .map(function (r) {
              return (
                '<li><span class="mode-rules__label">' + ROGUE.esc(r.label) + '</span>' +
                '<span class="mode-rules__detail">' + ROGUE.esc(r.detail) + '</span></li>'
              );
            })
            .join('') +
          '</ul>';
      }
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /* --- Presets --------------------------------------------------------- */

    function presetCard(record) {
      var html = '<article class="card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' + ROGUE.esc(record.name) +
        '</h3>' + ROGUE.badge(record) + '</div>';
      html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      var toggles = Array.isArray(record.forcedToggles) ? record.forcedToggles : [];
      html += fieldBlock(
        'Forced toggles',
        toggles.length
          ? '<span class="chip-row">' + toggles.map(function (t) { return ROGUE.chip(t.name + ': ' + t.value); }).join('') + '</span>'
          : '<span class="set-none">none</span>'
      );
      var ranges = Array.isArray(record.forcedRanges) ? record.forcedRanges : [];
      html += fieldBlock(
        'Forced sliders',
        ranges.length
          ? '<span class="chip-row">' + ranges.map(function (r) { return ROGUE.chip(r.name + ': ' + r.value); }).join('') + '</span>'
          : '<span class="set-none">none</span>'
      );
      if (record.note) html += '<p class="set-note">' + ROGUE.esc(record.note) + '</p>';
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /* --- Toggles --------------------------------------------------------- */

    function toggleCard(record) {
      var html = '<article class="card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' + ROGUE.esc(record.name) +
        '</h3>' + ROGUE.badge(record) + '</div>';
      html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html += '<div class="chip-row set-meta">' + ROGUE.chip(record.menu) + ROGUE.chip(record.code) + '</div>';
      var values = record.values && typeof record.values === 'object' ? record.values : null;
      if (values) {
        var rows = '';
        ['on', 'off'].forEach(function (k) {
          if (typeof values[k] === 'string') {
            rows +=
              '<div class="set-values__row"><span class="set-values__key">' + ROGUE.esc(k) + '</span>' +
              '<span class="set-values__text">' + ROGUE.esc(values[k]) + '</span></div>';
          }
        });
        if (rows) html += '<div class="set-values">' + rows + '</div>';
      }
      if (record.note) html += '<p class="set-note">' + ROGUE.esc(record.note) + '</p>';
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /* --- Ranges ---------------------------------------------------------- */

    function rangeCard(record) {
      var version = ROGUE.version;
      var options = Array.isArray(record.options)
        ? record.options
        : Array.isArray(record.optionsByVersion && record.optionsByVersion[version])
          ? record.optionsByVersion[version]
          : [];
      var values = Array.isArray(record.optionValues) ? record.optionValues : null;

      var html = '<article class="card">';
      html +=
        '<div class="card__head"><h3 class="card__title">' + ROGUE.esc(record.name) +
        '</h3>' + ROGUE.badge(record) + '</div>';
      html += '<p class="card__desc">' + ROGUE.esc(record.description) + '</p>';
      html += '<div class="chip-row set-meta">' + ROGUE.chip(record.menu) + ROGUE.chip(record.code) + '</div>';

      html += fieldBlock(
        'Options' + (record.optionsByVersion ? ' — ' + ROGUE.versionLabel(version) + ' (' + options.length + ')' : ''),
        '<span class="chip-row">' +
        options
          .map(function (o, i) {
            return ROGUE.chip(values ? values[i] + ' · ' + o : o);
          })
          .join('') +
        '</span>'
      );

      var descs = record.optionDescriptions && typeof record.optionDescriptions === 'object' ? record.optionDescriptions : null;
      if (descs) {
        var rows = Object.keys(descs)
          .map(function (k) {
            return (
              '<li><span class="set-descs__name">' + ROGUE.esc(k) + '</span>' +
              '<span class="set-descs__text">' + ROGUE.esc(descs[k]) + '</span></li>'
            );
          })
          .join('');
        html += '<ul class="set-descs">' + rows + '</ul>';
      }

      var diff = record.differences && typeof record.differences === 'object' ? record.differences[version] : null;
      if (typeof diff === 'string' && diff.trim()) html += '<p class="set-note">' + ROGUE.esc(diff) + '</p>';
      if (record.note) html += '<p class="set-note">' + ROGUE.esc(record.note) + '</p>';
      if (record.source) html += '<p class="card__source">' + ROGUE.citeHtml(record.source) + '</p>';
      return html + '</article>';
    }

    /* --- Campaigns (easter eggs) ---------------------------------------- */

    /**
     * Parse the hidden phrases out of the trigger record's description:
     * "'SMALL HOLIDAY' (BST Cup), …" → [{ phrase, shortName }].
     */
    function parsePhrases(text) {
      var out = [];
      if (typeof text !== 'string') return out;
      var re = /'([A-Z][A-Z0-9 ]+?)'\s*\(([A-Za-z]+(?: [A-Za-z]+)*)\)/g;
      var m;
      while ((m = re.exec(text))) {
        out.push({ phrase: m[1], shortName: m[2] });
      }
      return out;
    }

    function campaignsSection() {
      var trigger = findRecord(cRecords, 'campaign-trigger');
      var modeRecords = ROGUE.byCategory(cRecords, 'campaign-mode');
      var phrases = parsePhrases(trigger ? trigger.description : '');

      var body;
      if (phrases.length >= 5) {
        var rows = phrases
          .map(function (p) {
            var rec = modeRecords.filter(function (r) {
              return r.name === p.shortName || r.name.indexOf(p.shortName) === 0;
            })[0] || null;
            return (
              '<li><span class="chip eggs__phrase">' + ROGUE.esc(p.phrase) + '</span>' +
              '<span class="eggs__arrow" aria-hidden="true">→</span>' +
              '<span class="eggs__name">' + ROGUE.esc(rec ? rec.name : p.shortName) + '</span></li>'
            );
          })
          .join('');
        body = '<ul class="eggs">' + rows + '</ul>';
        if (trigger && trigger.source) body += '<p class="card__source eggs__source">' + ROGUE.citeHtml(trigger.source) + '</p>';
      } else if (trigger && trigger.description) {
        /* fallback: the raw trigger text still carries every phrase */
        body = ROGUE.paragraphs(trigger.description);
        if (trigger.source) body += '<p class="card__source eggs__source">' + ROGUE.citeHtml(trigger.source) + '</p>';
      } else {
        body = '<p class="set-note">No campaign data available.</p>';
      }

      var mechanicsLabel = (pages.mechanics || {}).title || 'Mechanics';
      body +=
        '<p class="config__more"><a href="./mechanics.html">Open the full ' +
        ROGUE.esc(mechanicsLabel) + ' guide →</a></p>';

      var intro = (Array.isArray(campaigns.prose) ? campaigns.prose : [])[0] || null;
      return ROGUE.section('config-campaigns', 'Easter eggs', (campaigns.meta && campaigns.meta.title) || 'Campaigns', intro ? intro.text : '', body);
    }

    /* --- Page ------------------------------------------------------------ */

    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc((pages.config || {}).title || 'Configuration') + '</h1>';
      /* Intro prose; the difficulty-scale block grows the 0–13 ladder
         visual around its trimmed text (all other blocks render plain). */
      html += (Array.isArray(settings.prose) ? settings.prose : [])
        .map(function (p) {
          if (p && p.id === 'difficulty-scale' && p.ladder) return difficultyScaleSection(p);
          return ROGUE.proseSections([p]);
        })
        .join('');

      /* In-page section strip (anchor chips). */
      var nav = [
        { id: 'config-modes', label: 'Game modes' },
        { id: 'config-difficulty', label: 'Difficulty' },
        { id: 'config-toggles', label: 'Toggles' },
        { id: 'config-ranges', label: 'Ranges' },
        { id: 'config-campaigns', label: 'Easter eggs' }
      ];
      html +=
        '<nav class="config-chips" aria-label="Configuration sections">' +
        nav.map(function (n) {
          return '<a class="chip" href="#' + ROGUE.esc(n.id) + '">' + ROGUE.esc(n.label) + '</a>';
        }).join('') +
        '</nav>';

      /* 1 — Game modes (data/game-modes.json). */
      var modeProse = (Array.isArray(modes.prose) ? modes.prose : []);
      var overview = modeProse.filter(function (p) { return p.id === 'overview'; })[0] || null;
      var ruleApplication = modeProse.filter(function (p) { return p.id === 'rule-application'; })[0] || null;
      var modeCards = ROGUE.filter(mRecords).map(modeCard).join('');
      html +=
        ROGUE.section(
          'config-modes',
          'Game modes',
          (modes.meta && modes.meta.title) || 'Game Modes',
          overview ? overview.text : (modes.meta && modes.meta.description) || '',
          '<div class="grid">' + modeCards + '</div>' +
          (ruleApplication
            ? '<h3 class="config-subhead">' + ROGUE.esc(ruleApplication.heading) + '</h3>' +
              stepStrip(ruleApplication.steps, ruleApplication.heading) +
              ROGUE.paragraphs(ruleApplication.text)
            : '')
        );

      /* 2 — Difficulty: level range + preset cards (data/settings.json). */
      var presetRange = findRecord(sRecords, 'range-difficulty-preset');
      var presets = ROGUE.filter(ROGUE.byCategory(sRecords, 'preset'));
      var rangeChips = presetRange && Array.isArray(presetRange.options)
        ? presetRange.options
            .map(function (o, i) {
              return ROGUE.chip(presetRange.optionValues ? presetRange.optionValues[i] + ' · ' + o : o);
            })
            .join('')
        : '';
      html +=
        ROGUE.section(
          'config-difficulty',
          'Difficulty',
          'Difficulty presets',
          presetRange ? presetRange.description : (settings.meta && settings.meta.description) || '',
          (rangeChips ? fieldBlock('Level range', '<span class="chip-row">' + rangeChips + '</span>') : '') +
          '<div class="grid set-grid">' + presets.map(presetCard).join('') + '</div>'
        );

      /* 3 — Toggles, grouped by their settings submenu. */
      var toggles = ROGUE.filter(ROGUE.byCategory(sRecords, 'toggle'));
      var menus = [];
      toggles.forEach(function (t) {
        if (menus.indexOf(t.menu) === -1) menus.push(t.menu);
      });
      var toggleBody = menus
        .map(function (menu) {
          var items = toggles.filter(function (t) { return t.menu === menu; });
          return (
            '<h3 class="config-subhead">' + ROGUE.esc(menu) + '</h3>' +
            '<div class="grid set-grid">' + items.map(toggleCard).join('') + '</div>'
          );
        })
        .join('');
      html +=
        ROGUE.section(
          'config-toggles',
          'Toggles',
          'On/off toggles',
          toggles.length + ' on/off switches in ' + ROGUE.versionLabel(ROGUE.version) + ', grouped by the settings submenu that holds them.',
          toggleBody
        );

      /* 4 — Ranges (every slider, per-version option lists). */
      var ranges = ROGUE.filter(ROGUE.byCategory(sRecords, 'range'));
      html +=
        ROGUE.section(
          'config-ranges',
          'Ranges',
          'Ranges & sliders',
          ranges.length + ' sliders in ' + ROGUE.versionLabel(ROGUE.version) + ', each with its options and the player-facing description of every option.',
          '<div class="grid set-grid">' + ranges.map(rangeCard).join('') + '</div>'
        );

      /* 5 — Campaigns easter-egg callout (data/campaigns.json). */
      html += campaignsSection();

      main.innerHTML = html;
    }

    render();
    ROGUE.onChange(render);
  });
})();

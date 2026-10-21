/*
 * pages/quests.js — the full quest log from data/quests.json.
 *
 * Renders the intro prose, then all nine display groups (stacked sections
 * with an in-page anchor-chip nav) as quest cards. Each card shows the
 * name, version badge (ROGUE.badge), description, flags, trigger,
 * requirements (where present) and rewards, with the game's {PKMN}/
 * {POKEBLOCK} placeholders resolved to "Pokémon"/"Pokéblock".
 *
 * Version semantics: the record's top-level fields are the EX variant;
 * `differences` is a structured object — { vanilla: {…}, ex: {…} } — where
 * each side holds ONLY the record fields that differ (description/trigger/
 * rewards/requirements/display_group) in the same humanized shape as the
 * top-level fields. For the active version we apply that version's
 * overrides on top of the top-level fields, and the card shows a
 * "differs in <other version>" note (ROGUE.diffNote) listing the other
 * build's differing fields. A quest whose display group differs per
 * version (e.g. The Final Run.) is placed in the active version's group.
 * The search index is built from the placeholder-RESOLVED text, so a
 * query for "Pokémon" matches cards that display it.
 *
 * A global .search filter narrows cards across all groups by
 * name/description (client-side, over a precomputed lowercase index);
 * groups with no matches are hidden, and the group counts update live.
 * Version changes re-render the whole log (filtered records + variants);
 * the current query is reapplied.
 */
(function () {
  'use strict';

  var PLACEHOLDERS = { PKMN: 'Pokémon', POKEBLOCK: 'Pokéblock' };
  var DIFF_KEYS = ['description', 'trigger', 'rewards', 'requirements', 'display_group'];

  /** Replace the game's {PKMN}/{POKEBLOCK} text placeholders. */
  function resolve(text) {
    return String(text === null || text === undefined ? '' : text).replace(/\{(PKMN|POKEBLOCK)\}/g, function (m, key) {
      return PLACEHOLDERS[key] || m;
    });
  }

  /**
   * Effective fields for the active version: top-level (the EX variant)
   * with the active version's structured `differences` overrides applied.
   */
  function effective(record) {
    var f = {
      name: record.name,
      description: record.description || '',
      trigger: record.trigger || '',
      rewards: Array.isArray(record.rewards) ? record.rewards.slice() : [],
      requirements: Array.isArray(record.requirements) ? record.requirements.slice() : [],
      flags: Array.isArray(record.flags) ? record.flags.slice() : [],
      display_group: record.display_group
    };
    var diff = record.differences;
    var side = diff && typeof diff === 'object' ? diff[window.ROGUE.version] : null;
    if (side && typeof side === 'object') {
      DIFF_KEYS.forEach(function (key) {
        if (side[key] === undefined) return;
        if (key === 'rewards' || key === 'requirements') {
          f[key] = Array.isArray(side[key]) ? side[key].slice() : [];
        } else {
          f[key] = side[key];
        }
      });
    }
    return f;
  }

  window.ROGUE.ready(function () {
    var ROGUE = window.ROGUE;
    var data, site;
    try {
      data = ROGUE.data('quests');
      site = ROGUE.site();
    } catch (e) {
      window.console.error(e);
      return;
    }

    var records = Array.isArray(data.records) ? data.records : [];
    var groups = (Array.isArray(data.display_groups) ? data.display_groups : []).map(function (g) {
      return g && typeof g === 'object' ? g : { id: g };
    });

    /* the active search query — survives a version re-render */
    var state = { query: '' };

    /** "final_quests" → "Final Quests" (titles derived from the group ids). */
    function groupTitle(id) {
      return String(id)
        .split('_')
        .map(function (w) {
          return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
        })
        .join(' ');
    }

    /** The other build's differing fields as one "Label: value · …" note line. */
    function diffText(side) {
      var labels = {
        display_group: 'Group',
        description: 'Description',
        trigger: 'Trigger',
        requirements: 'Requirements',
        rewards: 'Rewards'
      };
      return ['display_group', 'description', 'trigger', 'requirements', 'rewards']
        .filter(function (key) {
          return side[key] !== undefined;
        })
        .map(function (key) {
          if (key === 'display_group') return labels[key] + ': ' + groupTitle(side[key]);
          if (key === 'requirements' || key === 'rewards') {
            var values = Array.isArray(side[key]) ? side[key].map(resolve) : [resolve(side[key])];
            return labels[key] + ': ' + values.join(', ');
          }
          return labels[key] + ': ' + resolve(side[key]);
        })
        .join(' · ');
    }

    /* a <div>, not a <p>: the Requirements/Rewards fields hold a <ul>, and
     * a <p> cannot contain block content (the browser would splice the list
     * out of the paragraph and leave an empty <p> behind) */
    function fieldBlock(label, inner) {
      return '<div class="quest-card__field"><span class="field-label">' + label + '</span>' + inner + '</div>';
    }

    function questCard(record, eff) {
      var html =
        '<article class="card quest-card" data-search="' +
        ROGUE.esc((resolve(eff.name) + ' ' + resolve(eff.description)).toLowerCase()) +
        '">';
      html +=
        '<div class="card__head"><h3 class="card__title">' +
        ROGUE.esc(resolve(eff.name)) +
        '</h3>' + ROGUE.badge(record) + '</div>';
      if (eff.description) html += '<p class="card__desc">' + ROGUE.esc(resolve(eff.description)) + '</p>';
      if (eff.flags.length) {
        html += '<div class="chip-row quest-card__flags">' + eff.flags.map(ROGUE.chip).join('') + '</div>';
      }
      if (eff.trigger) html += fieldBlock('Trigger', '<span class="quest-card__text">' + ROGUE.esc(resolve(eff.trigger)) + '</span>');
      if (eff.requirements.length) {
        html +=
          fieldBlock(
            'Requirements',
            '<ul class="quest-card__list">' +
              eff.requirements.map(function (r) {
                return '<li>' + ROGUE.esc(resolve(r)) + '</li>';
              }).join('') +
              '</ul>'
          );
      }
      if (eff.rewards.length) {
        html +=
          fieldBlock(
            'Rewards',
            '<ul class="quest-card__list">' +
              eff.rewards.map(function (r) {
                return '<li>' + ROGUE.esc(resolve(r)) + '</li>';
              }).join('') +
              '</ul>'
          );
      }
      var diff = record.differences && typeof record.differences === 'object' ? record.differences : null;
      var otherSide = diff ? diff[ROGUE.version === 'vanilla' ? 'ex' : 'vanilla'] : null;
      if (otherSide && typeof otherSide === 'object' && Object.keys(otherSide).length) {
        html += ROGUE.diffNote(record, diffText(otherSide));
      }
      if (record.source) html += '<p class="card__source">' + ROGUE.esc(record.source) + '</p>';
      return html + '</article>';
    }

    /* Group the (version-filtered) records by their active-version display
     * group, keeping the data's record order (Type Challenges is sorted
     * alphabetically, mirroring the in-game UI per its sort_alphabetically
     * flag). */
    function grouped() {
      var kept = ROGUE.filter(records);
      var byGroup = {};
      kept.forEach(function (r) {
        var eff = effective(r);
        var g = eff.display_group || 'default_quests';
        (byGroup[g] = byGroup[g] || []).push({ record: r, eff: eff });
      });
      return groups.map(function (g) {
        var items = byGroup[g.id] || [];
        if (g.sort_alphabetically) {
          items = items.slice().sort(function (a, b) {
            return String(a.eff.name).localeCompare(String(b.eff.name));
          });
        }
        return { id: g.id, title: groupTitle(g.id), items: items };
      });
    }

    /* One render pass builds the entire log (string building + a single
     * innerHTML) — 200+ cards must not be appended one by one. */
    function render() {
      var main = document.querySelector('main');
      if (!main) return;

      var html = '<h1>' + ROGUE.esc(((site.pages || {}).quests || {}).title || 'Quests') + '</h1>';

      /* Intro prose, minus the display-groups paragraph which introduces
       * the log section itself. */
      var introProse = (Array.isArray(data.prose) ? data.prose : []).filter(function (p) {
        return p && p.id !== 'display-groups';
      });
      var groupsProse = (Array.isArray(data.prose) ? data.prose : []).filter(function (p) {
        return p && p.id === 'display-groups';
      })[0] || null;

      html += ROGUE.proseSections(introProse);

      /* The quest log: anchor-chip nav, search, live result line, groups. */
      var groupedNow = grouped();
      var total = groupedNow.reduce(function (n, g) {
        return n + g.items.length;
      }, 0);

      html +=
        '<section class="section" id="quest-log"><div class="section__head">' +
        '<p class="eyebrow">Quest Log</p>' +
        '<h2>' + ROGUE.esc(groupsProse ? groupsProse.heading : 'The display groups') + '</h2>' +
        (groupsProse ? '<p>' + ROGUE.esc(groupsProse.text) + '</p>' : '') +
        '</div><div class="section__body quest-log">';

      html +=
        '<nav class="quest-chips" aria-label="Quest display groups">' +
        groupedNow
          .map(function (g) {
            return (
              '<a class="chip" href="#quest-' + ROGUE.esc(g.id) + '">' +
              ROGUE.esc(g.title) +
              ' <span class="quest-chips__count" data-count="' + ROGUE.esc(g.id) + '">' + g.items.length + '</span></a>'
            );
          })
          .join('') +
        '</nav>';

      html +=
        '<div class="search quest-search"><input type="search" id="quest-search" placeholder="Search quests by name or description" aria-label="Search quests by name or description"></div>' +
        '<p class="quest-result" id="quest-result" role="status">' + total + ' quests</p>';

      groupedNow.forEach(function (g) {
        var cards = g.items.map(function (it) {
          return questCard(it.record, it.eff);
        });
        html +=
          '<div class="quest-group" id="quest-' + ROGUE.esc(g.id) + '" data-group="' + ROGUE.esc(g.id) + '">' +
          '<h3 class="quest-group__title">' + ROGUE.esc(g.title) +
          ' <span class="quest-group__count" data-count="' + ROGUE.esc(g.id) + '">' + g.items.length + '</span></h3>';
        if (cards.length) {
          html += '<div class="grid quest-group__grid">' + cards.join('') + '</div>';
        } else {
          html += '<p class="quest-group__empty">No quests in this group.</p>';
        }
        html += '</div>';
      });

      html += '</div></section>';
      /* capture the live query before the DOM (and its input) is replaced */
      state.query = inputKeep();
      main.innerHTML = html;
      bindSearch(groupedNow);
    }

    /* The query survives a version re-render (read back from the live input
     * before it is replaced). */
    function inputKeep() {
      var el = document.getElementById('quest-search');
      return el ? el.value : '';
    }

    /** Client-side name/description filter over the precomputed card index. */
    function bindSearch(groupedNow) {
      var input = document.getElementById('quest-search');
      var resultLine = document.getElementById('quest-result');
      if (!input || !resultLine) return;

      input.value = state.query;
      applyFilter(input.value);

      input.addEventListener('input', function () {
        state.query = input.value;
        applyFilter(input.value);
      });

      function applyFilter(raw) {
        var q = String(raw).trim().toLowerCase();
        var visibleTotal = 0;

        groupedNow.forEach(function (g) {
          var groupEl = document.querySelector('.quest-group[data-group="' + ROGUE.esc(g.id) + '"]');
          if (!groupEl) return;
          var visible = 0;
          groupEl.querySelectorAll('.quest-card').forEach(function (card) {
            var hit = !q || String(card.getAttribute('data-search')).indexOf(q) !== -1;
            card.hidden = !hit;
            if (hit) visible++;
          });
          visibleTotal += visible;
          groupEl.hidden = q !== '' && visible === 0;
          /* the group heading count and the chip row count stay in step */
          document.querySelectorAll('[data-count="' + ROGUE.esc(g.id) + '"]').forEach(function (el) {
            el.textContent = String(q ? visible : g.items.length);
          });
        });

        /* keep the chip row in step with the groups */
        document.querySelectorAll('.quest-chips a').forEach(function (a) {
          var id = a.getAttribute('href').slice('#quest-'.length);
          var groupEl = document.querySelector('.quest-group[data-group="' + ROGUE.esc(id) + '"]');
          if (groupEl) a.hidden = groupEl.hidden;
        });

        resultLine.textContent = q
          ? visibleTotal === 0
            ? 'No quests match \u201C' + String(raw).trim() + '\u201D.'
            : visibleTotal + ' quest' + (visibleTotal === 1 ? '' : 's') + ' match \u201C' + String(raw).trim() + '\u201D'
          : visibleTotal + ' quest' + (visibleTotal === 1 ? '' : 's');
      }
    }

    /* Version changes re-render (records filter out, variants flip, and a
     * quest whose group differs per version moves); the query is kept. */
    render();
    ROGUE.onChange(render);
  });
})();

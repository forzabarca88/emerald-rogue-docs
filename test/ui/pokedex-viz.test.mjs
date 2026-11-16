/**
 * The Pokedex analytics visualisations (issue #100, PR 4b; node --test,
 * zero deps; Playwright resolved by the harness) — the two static-SVG
 * blocks the page renders from the top-level typeChart + the records'
 * version-scoped stats:
 *
 *   A. The BASE-STAT RADAR (#dex-radar, in the species detail, under
 *      the stat bars) — a six-axis polygon (HP/ATK/DEF/SP.A/SP.D/SPE,
 *      0–255 scale, 4 ring guides) in the build's emerald, plus an
 *      optional COMPARE polygon (gold) from the .dex-radar__compare
 *      species TYPEAHEAD (issue #110 — a search input over the active
 *      build's dex: accent-insensitive substring on the shared pokedex
 *      haystacks, name-first ranked, a bounded row list). ONE delegated
 *      pointerover listener on the container (the six invisible hit
 *      sectors carry data-axis — pointerover fires for hover AND tap)
 *      writes the mono caption "<STAT>: <value>[ vs <compare>]" — the
 *      last axis read, never auto-cleared.
 *
 *   B. The TYPE MATCHUP HEATMAP (#dex-typechart, the overview's last
 *      section — the 7th .section-nav chip) — the N×N grid (N = the
 *      active build's standard types: 18 EX / 17 Vanilla) as 4-bin
 *      token-ramp cells (×0 immune → --color-surface, ×0.5 →
 *      --color-raised, ×1 → --color-line, ×2 → --color-muted), rows =
 *      attackers, columns = defenders, mono abbreviated gutter labels.
 *      ONE delegated pointerover (cell → "<Att> → <Def>: ×<mult>") +
 *      click (a defender column header → the gold column band + the
 *      "<Def>: ×2: … · ×0: …" caption). The species select highlights
 *      the species' own type rows (emerald bands) and appends the two
 *      derived coverage lines ("hits super-effective: S/N" /
 *      "at-or-below-neutral: A/N"). A column pin and a species
 *      selection are mutually exclusive. The SVG keeps a 480px
 *      min-width inside an overflow-x:auto wrapper — the 360px block
 *      scroll (never page overflow).
 *
 * Both blocks are STATIC SVG (no animation, no transitions —
 * reduced-motion-safe by construction); every version-scoped read
 * (the radar's stats, the chart's matrix, the option lists) goes
 * through the active build, so a live toggle re-renders both.
 *
 * Every expectation is derived from data/pokedex.json at load — never
 * hardcoded from memory: the typeChart matrix (EX + the vanilla
 * overlay), the records' version-scoped stats/types, the page's radar
 * geometry re-implemented (same constants), and the page's caption /
 * coverage formats re-implemented. The fixture guards fail loudly on a
 * degenerate choice (a compare species present in BOTH builds for the
 * survival case, an EX-ONLY one for the re-render-reset case, a
 * detail species whose radar polygon genuinely differs between the
 * builds, a dual-type coverage species).
 *
 * Coverage:
 *   1. typechart (EX) — the 18×18 grid after the last prose section,
 *      the derived viewBox, the type labels, the derived cell bins
 *      (spot cells incl. the EX-only Ghost→Steel ×1 cell), the legend,
 *      the default caption.
 *   2. typechart (Vanilla) — the 17×17 grid (no Fairy), the two
 *      drift cells one bin darker (Ghost/Dark → Steel ×0.5).
 *   3. typechart interaction (EX) — the cell caption on pointerover,
 *      the column pin (band + label + derived caption), then the
 *      species selection taking over (mutual exclusivity) with the
 *      derived row bands + coverage lines.
 *   4. typechart coverage (Vanilla) — the derived lines + bands.
 *   5. typechart re-render — the EX-only species selection resets
 *      under the live toggle.
 *   6. radar (EX detail) — the derived main polygon (ring/axis/sector
 *      counts), the compare typeahead (empty input by default; a typed
 *      fragment shows a bounded filtered row list containing the
 *      species — not the full dex), the legend, the default caption,
 *      no compare polygon.
 *   7. radar compare — picking a typeahead row renders the derived
 *      second polygon, the two-key legend, and the "vs" caption on a
 *      sector pointerover.
 *   8. radar version scope — the polygon re-reads the Vanilla overlay
 *      (derived different points) and the EX-only compare resets (the
 *      typeahead is cleared).
 *   9. 360px — the heatmap block-scrolls (svg wider than the wrapper)
 *      and neither view overflows the page.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, resolvePlaywright, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* --- derived literals (data/pokedex.json) --------------------------------- */

const dex = JSON.parse(readFileSync(path.join(root, 'data', 'pokedex.json'), 'utf8'));
const records = Array.isArray(dex.records) ? dex.records : [];
if (records.length === 0) throw new Error('data/pokedex.json: no records');
const tc = dex.typeChart;
if (!tc || !Array.isArray(tc.types) || !Array.isArray(tc.mult)) throw new Error('data/pokedex.json: missing the top-level typeChart');
const byId = {};
for (const r of records) byId[r.id] = r;

const recordsOf = (version) => records.filter((r) => Array.isArray(r.versions) && r.versions.includes(version));
const exRecords = recordsOf('ex');
const vanillaRecords = recordsOf('vanilla');

/* The active build's typeChart (the page's activeTypeChart() rule). */
const chartOf = (version) => (version === 'vanilla' && tc.vanilla ? tc.vanilla : tc);

/* The standard defender/attacker types (Mystery/Stellar excluded —
 * the page's typeOptions() rule). */
const typeOptionsOf = (version) => chartOf(version).types.filter((t) => t !== 'Mystery' && t !== 'Stellar');
const EX_TYPES = typeOptionsOf('ex');
const VAN_TYPES = typeOptionsOf('vanilla');
assert.equal(EX_TYPES.length, 18, 'data/pokedex.json: the EX build has 18 standard types');
assert.equal(VAN_TYPES.length, 17, 'data/pokedex.json: the Vanilla build has 17 standard types');
assert.ok(!VAN_TYPES.includes('Fairy'), 'the Vanilla build has no Fairy type');

/* The 4-bin ramp (the page's tcBin rule). */
const binOf = (m) => (m <= 0.25 ? 0 : m <= 0.75 ? 1 : m <= 1.5 ? 2 : 3);

/* The grid geometry (the page's TC_GEOM — mirrored, not re-typed). */
const TC = { cell: 24, left: 52, top: 44, pad: 8 };
const viewBoxOf = (n) => '0 0 ' + (TC.left + n * TC.cell + TC.pad) + ' ' + (TC.top + n * TC.cell + TC.pad);
assert.equal(viewBoxOf(18), '0 0 492 484', 'the EX viewBox derives from the geometry');
assert.equal(viewBoxOf(17), '0 0 468 460', 'the Vanilla viewBox derives from the geometry');

/* The version-scoped stats/types (the page's dexVariant overlay rule). */
const variantOf = (r, version, field) =>
  version === 'vanilla' && r.vanilla && typeof r.vanilla === 'object' && r.vanilla[field] !== undefined ? r.vanilla[field] : r[field];
const statsOf = (r, version) => variantOf(r, version, 'stats') || {};
const typesOf = (r, version) => {
  const t = variantOf(r, version, 'types');
  return Array.isArray(t) ? t : [];
};

/* The page's coverage lines for one record (the coverageOf rule). */
function coverageOf(record, version) {
  const chart = chartOf(version);
  const std = typeOptionsOf(version);
  const types = [];
  for (const t of typesOf(record, version)) if (typeof t === 'string' && types.indexOf(t) === -1) types.push(t);
  let sup = 0;
  let atOrBelow = 0;
  for (const def of std) {
    const defI = chart.types.indexOf(def);
    let prod = 1;
    for (const t of types) {
      const atkI = chart.types.indexOf(t);
      if (atkI !== -1 && defI !== -1) prod *= chart.mult[atkI][defI];
    }
    if (prod >= 2) sup++;
    if (prod <= 1) atOrBelow++;
  }
  return { sup, atOrBelow, N: std.length };
}

/* The page's caption formats (tcCellCaption / tcColumnCaption). */
const cellCaptionOf = (atk, def, m) => atk + ' \u2192 ' + def + ': \u00D7' + String(m);
function columnCaptionOf(version, col) {
  const chart = chartOf(version);
  const colI = chart.types.indexOf(col);
  const sup = [];
  const imm = [];
  chart.types.forEach((t, i) => {
    if (t === 'Mystery' || t === 'Stellar' || colI === -1) return;
    if (chart.mult[i][colI] === 2) sup.push(t);
    if (chart.mult[i][colI] === 0) imm.push(t);
  });
  return col + ': \u00D72: ' + (sup.join(', ') || '\u2014') + ' \u00B7 \u00D70: ' + (imm.join(', ') || '\u2014');
}

/* The radar geometry (the page's RADAR_GEOM/RADAR_AXES — mirrored). */
const RADAR = { cx: 150, cy: 150, r: 96, max: 255 };
const RADAR_AXES = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const RADAR_LABELS = { hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SP.A', spd: 'SP.D', spe: 'SPE' };
function radarPolyPointsOf(stats) {
  return RADAR_AXES.map((k, i) => {
    let v = Number(stats ? stats[k] : 0);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > RADAR.max) v = RADAR.max;
    const a = ((-90 + i * 60) * Math.PI) / 180;
    const r = (v / RADAR.max) * RADAR.r;
    return (RADAR.cx + r * Math.cos(a)).toFixed(1) + ',' + (RADAR.cy + r * Math.sin(a)).toFixed(1);
  }).join(' ');
}
const radarCaptionOf = (record, version, axis) => {
  const v = Number(statsOf(record, version)[axis]);
  const n = Number.isFinite(v) && v >= 0 ? v : 0;
  return RADAR_LABELS[axis] + ': ' + n;
};

/* The row bands render in the CHART's type order (the grid's row order),
 * not the record's types-array order — the derived expected bands. */
const bandsOf = (record, version) =>
  typeOptionsOf(version).filter((t) => typesOf(record, version).includes(t));

/* The typechart's caption defaults. */
const TYPECHART_CAPTION_DEFAULT = 'Hover or tap a cell \u00B7 click a defender column to pin it.';
const RADAR_CAPTION_DEFAULT = 'Hover or tap an axis for its value.';
const LEGEND_KEYS = ['\u00D70 immune', '\u00D70.5 resisted', '\u00D71 neutral', '\u00D72 super-effective'];

/* --- fixtures (each guard fails loudly on a degenerate choice) ------------ */

/* The detail species: present in BOTH builds with a radar polygon that
 * genuinely DIFFERS (the version-scoped stats fixture). */
const DETAIL = byId.butterfree;
assert.ok(DETAIL && DETAIL.versions.includes('ex') && DETAIL.versions.includes('vanilla'),
  'the radar fixture needs a species in both builds (butterfree)');
const EX_POINTS = radarPolyPointsOf(statsOf(DETAIL, 'ex'));
const VAN_POINTS = radarPolyPointsOf(statsOf(DETAIL, 'vanilla'));
assert.notEqual(EX_POINTS, VAN_POINTS, 'the radar fixture needs version-differing stats');

/* The compare species: in BOTH builds (survives a re-render). */
const COMPARE = byId.beedrill;
assert.ok(COMPARE && COMPARE.versions.includes('ex') && COMPARE.versions.includes('vanilla'),
  'the compare fixture needs a species in both builds (beedrill)');
const COMPARE_POINTS = radarPolyPointsOf(statsOf(COMPARE, 'ex'));

/* The re-render-reset compare: EX-ONLY. */
const EX_ONLY_COMPARE = byId.wormadam;
assert.ok(EX_ONLY_COMPARE && EX_ONLY_COMPARE.versions.includes('ex') && !EX_ONLY_COMPARE.versions.includes('vanilla'),
  'the re-render fixture needs an EX-only species (wormadam)');

/* The coverage species: a DUAL type (two row bands) — wormadam under EX,
 * butterfree under Vanilla. */
assert.equal(typesOf(EX_ONLY_COMPARE, 'ex').length, 2, 'the EX coverage fixture is dual-type');
assert.equal(typesOf(DETAIL, 'vanilla').length, 2, 'the Vanilla coverage fixture is dual-type');
const WORMADAM_COV = coverageOf(EX_ONLY_COMPARE, 'ex');
const BUTTERFREE_COV_VAN = coverageOf(DETAIL, 'vanilla');
assert.ok(WORMADAM_COV.sup > 0 && WORMADAM_COV.atOrBelow > 0, 'a non-trivial EX coverage');
assert.ok(BUTTERFREE_COV_VAN.sup > 0 && BUTTERFREE_COV_VAN.atOrBelow > 0, 'a non-trivial Vanilla coverage');

/* Spot cells (derived from the matrix): a ×2, a ×0, a ×1 (EX-only cell),
 * and the two build-drift cells (Ghost/Dark → Steel). */
const multOf = (version, atk, def) => {
  const chart = chartOf(version);
  return chart.mult[chart.types.indexOf(atk)][chart.types.indexOf(def)];
};
assert.equal(multOf('ex', 'Rock', 'Bug'), 2, 'the derived spot cell Rock→Bug is ×2');
assert.equal(multOf('ex', 'Ghost', 'Normal'), 0, 'the derived spot cell Ghost→Normal is ×0');
assert.equal(multOf('ex', 'Ghost', 'Steel'), 1, 'EX: Ghost→Steel is ×1 (the drift cell)');
assert.equal(multOf('vanilla', 'Ghost', 'Steel'), 0.5, 'Vanilla: Ghost→Steel is ×0.5 (the drift cell)');
assert.equal(multOf('vanilla', 'Dark', 'Steel'), 0.5, 'Vanilla: Dark→Steel is ×0.5 (the drift cell)');

const CAPTION_CELL = cellCaptionOf('Fire', 'Water', multOf('ex', 'Fire', 'Water'));

/* The overview's last prose section (the typechart renders after it) +
 * the .section-nav chip count (Grid + every prose block + Type matchups). */
const proseIds = Array.isArray(dex.prose) ? dex.prose.map((p) => p.id) : [];
assert.equal(proseIds.length, 5, 'data/pokedex.json: the five short prose blocks');
const LAST_PROSE_ID = proseIds[proseIds.length - 1];
assert.equal(LAST_PROSE_ID, 'viability', 'the typechart renders after the last prose block');
const SECTION_NAV_CHIPS = 2 + proseIds.length;

const SETTLE_TIMEOUT_MS = 10_000; // guard for the settle waits (a bound, not a sleep)

let server;
before(async () => {
  if (resolvePlaywright()) server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- the suite ------------------------------------------------------------
 * Every page function below is SELF-CONTAINED (it references only the
 * DOM and its arguments) — page.evaluate / waitForFunction serialize
 * the function source into the page context, so no node-side free
 * variables.
 * -------------------------------------------------------------------------- */

test('typechart (EX): the 18\u00D718 grid after the last prose section, with the derived cells, labels, legend and default caption', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    const facts = await page.evaluate((args) => {
      const section = document.getElementById('dex-typechart');
      if (!section) return { present: false };
      const svg = section.querySelector('svg');
      const cells = section.querySelectorAll('.dex-typechart__cell');
      const rowLabels = [...section.querySelectorAll('.dex-typechart__label--row')].map((x) => x.getAttribute('data-row'));
      const colLabels = [...section.querySelectorAll('.dex-typechart__label--col')].map((x) => x.getAttribute('data-col'));
      const cell = (atk, def) => {
        const c = section.querySelector('.dex-typechart__cell[data-at="' + atk + '"][data-def="' + def + '"]');
        return c ? { cls: c.getAttribute('class').split(' ').pop(), mult: c.getAttribute('data-mult') } : null;
      };
      const lastProse = document.getElementById(args.lastProseId);
      const after = lastProse ? lastProse.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING : false;
      return {
        present: true,
        viewBox: svg ? svg.getAttribute('viewBox') : null,
        cells: cells.length,
        rowLabels,
        colLabels,
        rockBug: cell('Rock', 'Bug'),
        ghostNormal: cell('Ghost', 'Normal'),
        ghostSteel: cell('Ghost', 'Steel'),
        legend: [...section.querySelectorAll('.dex-typechart__key')].map((x) => x.textContent.trim()),
        caption: (document.getElementById('dex-typechart-caption')?.textContent || '').trim(),
        coverageHidden: document.getElementById('dex-typechart-coverage')?.hidden,
        afterLastProse: !!after,
        sectionNavChips: document.querySelectorAll('#dex-overview .section-nav a').length,
      };
    }, { lastProseId: LAST_PROSE_ID });

    // ASSERT — the section renders last (the 7th chip = Grid + 5 prose + Type matchups)
    assert.ok(facts.present, 'the #dex-typechart section renders in the EX overview (issue #100)');
    assert.equal(facts.afterLastProse, true, 'the section sits AFTER the last prose block');
    assert.equal(facts.sectionNavChips, SECTION_NAV_CHIPS, 'the .section-nav strip carries Grid + the prose blocks + Type matchups');

    // ASSERT — the derived grid
    assert.equal(facts.viewBox, viewBoxOf(EX_TYPES.length), 'the EX viewBox derives from the grid geometry');
    assert.equal(facts.cells, EX_TYPES.length * EX_TYPES.length, 'one cell per (attacker, defender) pair');
    assert.deepEqual(facts.rowLabels, EX_TYPES, 'the row labels are the EX standard types, in chart order');
    assert.deepEqual(facts.colLabels, EX_TYPES, 'the column labels are the EX standard types, in chart order');

    // ASSERT — the derived cell bins (the 4-bin ramp on the exact matrix)
    assert.deepEqual(facts.rockBug, { cls: 'dex-typechart__cell--i3', mult: '2' }, 'Rock→Bug renders the derived \u00D72 bin');
    assert.deepEqual(facts.ghostNormal, { cls: 'dex-typechart__cell--i0', mult: '0' }, 'Ghost→Normal renders the derived \u00D70 bin');
    assert.deepEqual(facts.ghostSteel, { cls: 'dex-typechart__cell--i2', mult: '1' }, 'EX Ghost→Steel is the \u00D71 (neutral) bin — the drift cell');

    // ASSERT — the legend + the default caption + no coverage yet
    assert.deepEqual(facts.legend, LEGEND_KEYS, 'the 4-bin legend (token ramp, dark\u2192light)');
    assert.equal(facts.caption, TYPECHART_CAPTION_DEFAULT, 'the default caption');
    assert.equal(facts.coverageHidden, true, 'the coverage lines are hidden until a species is picked');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('typechart (Vanilla): the 17\u00D717 grid (no Fairy) with the two Steel cells one bin darker', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    const facts = await page.evaluate(() => {
      const section = document.getElementById('dex-typechart');
      if (!section) return { present: false };
      const cell = (atk, def) => {
        const c = section.querySelector('.dex-typechart__cell[data-at="' + atk + '"][data-def="' + def + '"]');
        return c ? { cls: c.getAttribute('class').split(' ').pop(), mult: c.getAttribute('data-mult') } : null;
      };
      return {
        present: true,
        viewBox: section.querySelector('svg')?.getAttribute('viewBox') || null,
        cells: section.querySelectorAll('.dex-typechart__cell').length,
        colLabels: [...section.querySelectorAll('.dex-typechart__label--col')].map((x) => x.getAttribute('data-col')),
        ghostSteel: cell('Ghost', 'Steel'),
        darkSteel: cell('Dark', 'Steel'),
      };
    });

    // ASSERT — the Vanilla-scoped grid
    assert.ok(facts.present, 'the #dex-typechart section renders under Vanilla');
    assert.equal(facts.viewBox, viewBoxOf(VAN_TYPES.length), 'the Vanilla viewBox derives from the 17-type grid');
    assert.equal(facts.cells, VAN_TYPES.length * VAN_TYPES.length, '17\u00D717 cells');
    assert.deepEqual(facts.colLabels, VAN_TYPES, 'no Fairy label under Vanilla');
    assert.deepEqual(facts.ghostSteel, { cls: 'dex-typechart__cell--i1', mult: '0.5' }, 'Vanilla Ghost→Steel is \u00D70.5 — one bin darker than EX');
    assert.deepEqual(facts.darkSteel, { cls: 'dex-typechart__cell--i1', mult: '0.5' }, 'Vanilla Dark→Steel is \u00D70.5 — one bin darker than EX');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('typechart interaction (EX): the cell caption, the column pin, and the species selection taking over', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ACT — pointerover the Fire→Water cell (hover AND tap share the
    // one delegated listener)
    await page.evaluate(() => {
      const cell = document.querySelector('#dex-typechart .dex-typechart__cell[data-at="Fire"][data-def="Water"]');
      cell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    let caption = await page.evaluate(() => document.getElementById('dex-typechart-caption').textContent);
    assert.equal(caption, CAPTION_CELL, 'the cell caption is the derived "<Att> \u2192 <Def>: \u00D7<mult>" (last read, never cleared)');

    // ACT — click the Normal column header (the pin)
    await page.evaluate(() => {
      const label = document.querySelector('#dex-typechart .dex-typechart__label--col[data-col="Normal"]');
      label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const pin = await page.evaluate(() => {
      const band = document.querySelector('#dex-typechart .dex-typechart__band--col[data-col="Normal"]');
      return {
        bandOn: band ? band.classList.contains('dex-typechart__band--on') : null,
        labelOn: document.querySelector('#dex-typechart .dex-typechart__label--col[data-col="Normal"]').classList.contains('dex-typechart__label--on'),
        otherColOn: document.querySelectorAll('#dex-typechart .dex-typechart__band--col.dex-typechart__band--on').length,
        caption: document.getElementById('dex-typechart-caption').textContent,
      };
    });
    assert.equal(pin.bandOn, true, 'the pinned column\u2019s gold band turns on');
    assert.equal(pin.labelOn, true, 'the pinned column label turns gold');
    assert.equal(pin.otherColOn, 1, 'exactly one column band is on');
    assert.equal(pin.caption, columnCaptionOf('ex', 'Normal'), 'the pin caption is the derived "\u00D72: … \u00B7 \u00D70: …" list');

    // ACT — pick the dual-type species (mutual exclusivity: the pin
    // clears, the species\u2019 rows light up)
    await page.selectOption('#dex-typechart-species', EX_ONLY_COMPARE.id);
    const sp = await page.evaluate(() => {
      const section = document.getElementById('dex-typechart');
      return {
        colBandsOn: section.querySelectorAll('.dex-typechart__band--col.dex-typechart__band--on').length,
        rowBands: [...section.querySelectorAll('.dex-typechart__band--row.dex-typechart__band--on')].map((b) => b.getAttribute('data-row')),
        coverageHidden: document.getElementById('dex-typechart-coverage').hidden,
        lines: [...document.querySelectorAll('#dex-typechart-coverage .dex-typechart__line')].map((p) => p.textContent),
        select: document.getElementById('dex-typechart-species').value,
      };
    });
    assert.equal(sp.colBandsOn, 0, 'the species selection cleared the column pin');
    assert.deepEqual(sp.rowBands, bandsOf(EX_ONLY_COMPARE, 'ex'), 'the species\u2019 own type rows light up (both of them, in chart order)');
    assert.equal(sp.coverageHidden, false, 'the coverage lines appear');
    assert.deepEqual(
      sp.lines,
      ['hits super-effective: ' + WORMADAM_COV.sup + '/' + WORMADAM_COV.N, 'at-or-below-neutral: ' + WORMADAM_COV.atOrBelow + '/' + WORMADAM_COV.N],
      'the coverage lines are the derived offensive-coverage counts'
    );
    assert.equal(sp.select, EX_ONLY_COMPARE.id, 'the select holds the species');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('typechart coverage (Vanilla): the derived lines + row bands under the 17-type chart', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', version: 'vanilla' });
  try {
    // ACT — pick the dual-type species (present in both builds)
    await page.selectOption('#dex-typechart-species', DETAIL.id);
    const sp = await page.evaluate(() => {
      const section = document.getElementById('dex-typechart');
      return {
        rowBands: [...section.querySelectorAll('.dex-typechart__band--row.dex-typechart__band--on')].map((b) => b.getAttribute('data-row')),
        lines: [...document.querySelectorAll('#dex-typechart-coverage .dex-typechart__line')].map((p) => p.textContent),
      };
    });
    assert.deepEqual(sp.rowBands, bandsOf(DETAIL, 'vanilla'), 'the Vanilla row bands are the Vanilla types (in chart order)');
    assert.deepEqual(
      sp.lines,
      ['hits super-effective: ' + BUTTERFREE_COV_VAN.sup + '/' + BUTTERFREE_COV_VAN.N, 'at-or-below-neutral: ' + BUTTERFREE_COV_VAN.atOrBelow + '/' + BUTTERFREE_COV_VAN.N],
      'the Vanilla coverage counts run over the 17 standard defenders'
    );
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('typechart re-render: the EX-only species selection resets under the live toggle', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html' });
  try {
    // ARRANGE — EX, the EX-only species selected
    await page.selectOption('#dex-typechart-species', EX_ONLY_COMPARE.id);
    await page.waitForFunction(
      (n) => document.querySelectorAll('#dex-typechart-coverage .dex-typechart__line').length === n,
      2,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE toggle to Vanilla (the species is not in its dex)
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      (n) => (document.getElementById('dex-count')?.textContent || '').includes(n + ' species'),
      '386',
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the selection reset, the coverage cleared, the options
    // scoped to the Vanilla dex
    const facts = await page.evaluate(() => ({
      select: document.getElementById('dex-typechart-species').value,
      options: document.getElementById('dex-typechart-species').options.length,
      coverageHidden: document.getElementById('dex-typechart-coverage').hidden,
      bandsOn: document.querySelectorAll('#dex-typechart .dex-typechart__band--on').length,
    }));
    assert.equal(facts.select, '', 'the EX-only selection the new build lacks reset to "None"');
    assert.equal(facts.options, vanillaRecords.length + 1, 'the options are the Vanilla dex + "None"');
    assert.equal(facts.coverageHidden, true, 'the coverage lines are gone');
    assert.equal(facts.bandsOn, 0, 'no highlight bands remain');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('radar (EX detail): the derived polygon, the rings/axes/sectors, and the compare typeahead', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + DETAIL.id });
  try {
    const facts = await page.evaluate((points) => {
      const radar = document.getElementById('dex-radar');
      if (!radar) return { present: false };
      const svg = radar.querySelector('svg');
      const compareSel = document.getElementById('dex-radar-compare');
      return {
        present: true,
        viewBox: svg ? svg.getAttribute('viewBox') : null,
        rings: radar.querySelectorAll('.dex-radar__ring').length,
        axes: radar.querySelectorAll('.dex-radar__axis').length,
        labels: [...radar.querySelectorAll('.dex-radar__label')].map((x) => x.textContent),
        sectors: [...radar.querySelectorAll('.dex-radar__hit')].map((x) => x.getAttribute('data-axis')),
        mainPoints: radar.querySelector('.dex-radar__poly--main')?.getAttribute('points') || null,
        comparePoly: !!radar.querySelector('.dex-radar__poly--compare'),
        legend: [...radar.querySelectorAll('.dex-radar__key')].map((x) => x.textContent.trim()),
        caption: (document.getElementById('dex-radar-caption')?.textContent || '').trim(),
        compareTag: compareSel ? compareSel.tagName : null,
        compareValue: compareSel ? compareSel.value : null,
      };
    }, EX_POINTS);

    // ASSERT — the radar renders in the detail with the derived polygon
    assert.ok(facts.present, 'the #dex-radar block renders in the species detail (issue #100)');
    assert.equal(facts.viewBox, '0 0 300 300', 'the radar viewBox (the page geometry)');
    assert.equal(facts.rings, 4, 'the 4 ring guides (25/50/75/100% of 255)');
    assert.equal(facts.axes, 6, 'the 6 axis lines');
    assert.deepEqual(facts.labels, RADAR_AXES.map((k) => RADAR_LABELS[k]), 'the 6 mono axis labels');
    assert.deepEqual(facts.sectors, RADAR_AXES, 'the 6 hit sectors (data-axis, in axis order)');
    assert.equal(facts.mainPoints, EX_POINTS, 'the main polygon is the derived EX-stat points (version-scoped)');
    assert.equal(facts.comparePoly, false, 'no compare polygon until one is picked');
    assert.deepEqual(facts.legend, [DETAIL.name], 'the legend keys the selected species');
    assert.equal(facts.caption, RADAR_CAPTION_DEFAULT, 'the default caption');
    assert.equal(facts.compareTag, 'INPUT', 'the compare control is a search input (issue #110 — the full-dex native select is gone)');
    assert.equal(facts.compareValue, '', 'the typeahead is empty by default (no compare)');

    // ACT — type a distinctive fragment: a bounded filtered list, not the full dex
    await page.fill('#dex-radar-compare', COMPARE.name);
    const rows = await page.evaluate(() => {
      const list = document.getElementById('dex-radar-compare-list');
      if (!list) return { hidden: true, rows: [] };
      return {
        hidden: list.hidden,
        rows: [...list.querySelectorAll('.dex-radar__compare-row')].map((x) => ({
          id: x.getAttribute('data-id'),
          text: x.textContent.trim()
        }))
      };
    });
    assert.equal(rows.hidden, false, 'the typeahead shows its result list while typing');
    assert.ok(rows.rows.length >= 1 && rows.rows.length < exRecords.length, 'the result list is a bounded filtered list — not the full dex');
    assert.equal(rows.rows[0].id, COMPARE.id, 'the name match ranks first');
    assert.equal(rows.rows[0].text, COMPARE.name, 'the first row shows the species display name');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('radar compare: the derived second polygon, the two-key legend, and the "vs" caption', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + DETAIL.id });
  try {
    // ACT — pick the compare species through the typeahead (present in
    // both builds): type the name, click the row
    await page.fill('#dex-radar-compare', COMPARE.name);
    await page.evaluate((id) => {
      const row = document.querySelector('#dex-radar-compare-list .dex-radar__compare-row[data-id="' + id + '"]');
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, COMPARE.id);
    const facts = await page.evaluate((points) => {
      const radar = document.getElementById('dex-radar');
      return {
        mainPoints: radar.querySelector('.dex-radar__poly--main')?.getAttribute('points') || null,
        comparePoints: radar.querySelector('.dex-radar__poly--compare')?.getAttribute('points') || null,
        legend: [...radar.querySelectorAll('.dex-radar__key')].map((x) => x.textContent.trim()),
        compareValue: document.getElementById('dex-radar-compare').value,
        listHidden: document.getElementById('dex-radar-compare-list').hidden,
      };
    }, COMPARE_POINTS);
    assert.equal(facts.mainPoints, EX_POINTS, 'the main polygon is untouched by a compare');
    assert.equal(facts.comparePoints, COMPARE_POINTS, 'the compare polygon is the derived compare-stat points');
    assert.deepEqual(facts.legend, [DETAIL.name, COMPARE.name], 'the legend keys both species (emerald + gold)');
    assert.equal(facts.compareValue, COMPARE.name, 'the input holds the picked species');
    assert.equal(facts.listHidden, true, 'the result list hides after a pick');

    // ACT — pointerover the HP hit sector (hover AND tap share the
    // one delegated listener)
    await page.evaluate(() => {
      const sector = document.querySelector('#dex-radar .dex-radar__hit[data-axis="hp"]');
      sector.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    const caption = await page.evaluate(() => document.getElementById('dex-radar-caption').textContent);
    assert.equal(caption, radarCaptionOf(DETAIL, 'ex', 'hp') + ' vs ' + Number(statsOf(COMPARE, 'ex').hp),
      'the caption is the derived "<STAT>: <value> vs <compare>" (last read, never cleared)');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('radar version scope: the polygon re-reads the Vanilla overlay and the EX-only compare resets', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html#rec-pokedex-' + DETAIL.id });
  try {
    // ARRANGE — EX, the EX-ONLY compare picked through the typeahead
    await page.fill('#dex-radar-compare', EX_ONLY_COMPARE.name);
    await page.evaluate((id) => {
      const row = document.querySelector('#dex-radar-compare-list .dex-radar__compare-row[data-id="' + id + '"]');
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, EX_ONLY_COMPARE.id);
    await page.waitForFunction(
      () => !!document.querySelector('#dex-radar .dex-radar__poly--compare'),
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ACT — the LIVE toggle to Vanilla
    await page.click('.version-toggle__option[data-version="vanilla"]');
    await page.waitForFunction(
      (points) => document.querySelector('#dex-radar .dex-radar__poly--main')?.getAttribute('points') === points,
      VAN_POINTS,
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // ASSERT — the polygon re-read the overlay stats; the EX-only
    // compare reset (the typeahead cleared)
    const facts = await page.evaluate(() => {
      const radar = document.getElementById('dex-radar');
      return {
        mainPoints: radar.querySelector('.dex-radar__poly--main')?.getAttribute('points') || null,
        comparePoly: !!radar.querySelector('#dex-radar .dex-radar__poly--compare'),
        compareValue: document.getElementById('dex-radar-compare').value,
      };
    });
    assert.equal(facts.mainPoints, VAN_POINTS, 'the main polygon is the derived Vanilla-overlay points (genuinely different from EX)');
    assert.equal(facts.comparePoly, false, 'the EX-only compare\u2019s polygon is gone');
    assert.equal(facts.compareValue, '', 'the EX-only compare reset (the typeahead is cleared) under Vanilla');
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

test('360px: the heatmap block-scrolls and neither view overflows the page', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'pokedex.html', width: 360, height: 800 });
  try {
    // ASSERT — the overview: the grid block-scrolls INSIDE its wrapper
    // (svg wider than the wrapper), the page never overflows
    const ov = await page.evaluate(() => {
      const wrap = document.querySelector('#dex-typechart .dex-typechart__scroll');
      const svg = document.querySelector('#dex-typechart svg');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        wrapVisible: !!wrap && wrap.offsetParent !== null,
        wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
        svgWidth: svg ? svg.getBoundingClientRect().width : null,
        wrapWidth: wrap ? wrap.getBoundingClientRect().width : null,
        scrollable: wrap ? wrap.scrollWidth > wrap.clientWidth : null,
      };
    });
    assert.equal(ov.wrapVisible, true, 'the typechart scroll wrapper is visible at 360px');
    assert.equal(ov.wrapOverflowX, 'auto', 'the wrapper is the horizontal-scroll container');
    assert.ok(ov.svgWidth > ov.wrapWidth, `the svg (${ov.svgWidth}px) keeps its min-width wider than the wrapper (${ov.wrapWidth}px)`);
    assert.equal(ov.scrollable, true, 'the wrapper is actually scrollable (block scroll, not page scroll)');
    assert.ok(ov.scrollWidth <= 360, `no page overflow at 360px (scrollWidth ${ov.scrollWidth}px)`);

    // ACT — the detail view (the radar fits without its own scroll)
    await page.evaluate((id) => { window.location.hash = '#rec-pokedex-' + id; }, DETAIL.id);
    await page.waitForFunction(
      () => !!document.getElementById('dex-radar'),
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    const det = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(det.scrollWidth <= 360, `the detail (radar included) never overflows at 360px (scrollWidth ${det.scrollWidth}px)`);
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
  } finally {
    await close();
  }
});

/**
 * Vanilla/EX toggle behavior suite (node --test, zero deps; Playwright
 * resolved by the harness).
 *
 * The toggle is the two .version-toggle__option[data-version] buttons that
 * js/nav.js injects into the header; the active option carries BOTH the
 * .version-toggle__option--active modifier and aria-pressed="true" (base.css
 * styles from both, per DESIGN.md §5.2). Clicking an option calls
 * ROGUE.setVersion, which rewrites the URL to ?version=<v>
 * (history.replaceState), stores the choice, and re-renders the page through
 * ROGUE.onChange (version.js). A ?version= URL param on load is a one-time
 * override: it wins for that load only and is never stored, so a subsequent
 * navigation without the param falls back to the stored choice / the site
 * default (data/site.json defaultVersion, currently "ex").
 *
 * Every expectation below is a literal derived from the cited data file and
 * the page's rendering code (same style as smoke.test.mjs):
 *   versions.html — the #version-diffs container class (diffs--ex /
 *                   diffs--vanilla) that pages.css keys the active-version
 *                   column highlighting off; 19 rows, 6 EX-only
 *                   .diff--scope-ex rows (data/versions.json), unchanged by
 *                   the toggle; the at-a-glance category overview
 *                   (#version-overview): 10 cells (one per distinct
 *                   category, data/versions.json) whose counts scope to the
 *                   active build — 19 in EX (no receded cells) vs 13 in
 *                   Vanilla (mechanics + timeofday recede at 0).
 *   routes.html   — the six FAIRY-swap routes (data/routes.json records with
 *                   per-version `differences`): a Fairy chip in EX, the
 *                   Vanilla wild types (routes.js parses them from
 *                   differences.vanilla) and ZERO Fairy chips under Vanilla;
 *                   36 cards + the count line in both.
 *   quests.html   — the 94 EX-only quests (data/quests.json: 232 total, 138
 *                   shared): 232 cards / "232 quests" in EX, 138 cards /
 *                   "138 quests" under Vanilla; 9 groups with the same one
 *                   empty group (starter_challenges) in both; the 94
 *                   .badge--ex badges drop to 0.
 *   hub.html      — the 3 per-version-divergent workbench upgrades
 *                   (data/hub.json `differences`): their "Differs in …"
 *                   note flips with the active version.
 *   config.html   — the 7 EX-only settings toggles (data/settings.json: 19
 *                   total, 12 in Vanilla): 19 toggle cards in EX, 12 under
 *                   Vanilla.
 *   safari.html   — a version-identical page: stable counts, only the
 *                   Legends Cave roster note flips (data/safari.json).
 *
 * Waiting is always on a version-specific DOM state (the re-render itself,
 * or the URL rewrite) — no arbitrary sleeps.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, openPage, closeAll, skipIfNoPlaywright } from './harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = JSON.parse(readFileSync(path.join(root, 'data', 'site.json'), 'utf8'));

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await closeAll();
  if (server) await server.close();
});

/* --- derived literals ------------------------------------------------------
 * The six FAIRY-swap routes (data/routes.json: the only records with a
 * per-version `differences` object). `ex` is the record's top-level `type`
 * (the EX variant); `vanilla` is what routes.js parses out of
 * differences.vanilla ("Wild types: …").
 */
const FAIRY_SWAPS = {
  'Hoenn Mountain 1': { ex: ['Fairy', 'Dark', 'Psychic'], vanilla: ['Fighting', 'Dark', 'Psychic'] },
  'Hoenn Urban 1': { ex: ['Fairy', 'Ice', 'Bug'], vanilla: ['Water', 'Ice', 'Bug'] },
  'Kanto Urban 0': { ex: ['Water', 'Fairy', 'Steel'], vanilla: ['Water', 'Psychic', 'Steel'] },
  'Johto Cave 0': { ex: ['Ice', 'Fairy', 'Ground'], vanilla: ['Ice', 'Dark', 'Ground'] },
  'Sinnoh Route 209': { ex: ['Fairy', 'Ghost', 'Electric'], vanilla: ['Normal', 'Ghost', 'Electric'] },
  'Sinnoh Route 210': { ex: ['Dragon', 'Psychic', 'Fairy'], vanilla: ['Dragon', 'Psychic', 'Ghost'] },
};

/* The 7 EX-only settings toggles (data/settings.json: the toggle records
 * whose `versions` is ["ex"] only). */
const EX_ONLY_TOGGLES = ['Affection FX', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'];

/* The 3 per-version-divergent workbench upgrades (data/hub.json: the
 * hub-upgrade records carrying a `differences` object). */
const DIVERGENT_UPGRADES = ['Unique Pokémon Types', 'Treat Shop', 'Pokéblock Shop'];

const SETTLE_TIMEOUT_MS = 10_000; // guard for the state waits below (a bound, not a sleep)

/* --- shared helpers (all page-context functions must be self-contained) ---- */

/** Both header toggle options: label, aria-pressed and the --active class. */
const toggleState = () =>
  Object.fromEntries(
    [...document.querySelectorAll('.version-toggle__option')].map((b) => [
      b.getAttribute('data-version'),
      {
        label: b.textContent.trim(),
        pressed: b.getAttribute('aria-pressed'),
        active: b.classList.contains('version-toggle__option--active'),
      },
    ])
  );

/** The routes page's per-card chips + difference-note label, keyed by name. */
const routeFacts = () => {
  const chipsOf = (c) => [...c.querySelectorAll('.route-card__chips .chip')].map((e) => e.textContent.trim());
  const cards = [...document.querySelectorAll('.route-card')];
  return {
    count: cards.length,
    countLine: (document.getElementById('routes-count')?.textContent || '').trim(),
    fairyCards: cards.filter((c) => chipsOf(c).includes('Fairy')).length,
    byName: Object.fromEntries(
      cards.map((c) => [
        c.querySelector('h3.card__title').textContent.trim(),
        {
          chips: chipsOf(c),
          diff: c.querySelector('.card__diff-label')?.textContent.trim() ?? null,
        },
      ])
    ),
  };
};

/** Assert the toggle shows `active` (labels, pressed + active class, other side off). */
async function assertToggle(page, active, ctx) {
  const t = await page.evaluate(toggleState);
  assert.ok(
    t.vanilla && t.ex,
    `${ctx}: expected both .version-toggle__option buttons in the header (nav.js), got ${JSON.stringify(Object.keys(t))}`
  );
  assert.equal(t.vanilla.label, 'Vanilla', `${ctx}: vanilla option label (data/site.json versions.labels)`);
  assert.equal(t.ex.label, 'EX', `${ctx}: ex option label (data/site.json versions.labels)`);
  assert.equal(t[active].pressed, 'true', `${ctx}: the ${active} option should be aria-pressed="true"`);
  assert.equal(t[active].active, true, `${ctx}: the ${active} option should carry .version-toggle__option--active`);
  const other = active === 'vanilla' ? 'ex' : 'vanilla';
  assert.equal(t[other].pressed, 'false', `${ctx}: the ${other} option should be aria-pressed="false"`);
  assert.equal(t[other].active, false, `${ctx}: the ${other} option should NOT carry .version-toggle__option--active`);
}

/**
 * Click a toggle option and wait for the re-render to settle: the URL
 * rewrite (setVersion → history.replaceState, version.js) AND a
 * version-specific DOM predicate — the re-render's own visible result.
 */
async function clickToggle(page, version, settled, ctx) {
  await page.click(`.version-toggle__option[data-version="${version}"]`);
  await page.waitForFunction(
    (v) => new URLSearchParams(window.location.search).get('version') === v,
    version,
    { timeout: SETTLE_TIMEOUT_MS }
  );
  await page.waitForFunction(settled, null, { timeout: SETTLE_TIMEOUT_MS });
  const urlVersion = new URL(page.url()).searchParams.get('version');
  assert.equal(urlVersion, version, `${ctx}: clicking the toggle should rewrite the URL to ?version=${version}, got ${page.url()}`);
}

/* --- the suite ------------------------------------------------------------- */

test('the default version is "ex" (every initial-state literal in this suite is derived from it)', () => {
  assert.equal(
    site.defaultVersion,
    'ex',
    'data/site.json defaultVersion changed — the initial-state DOM counts in test/ui/version.test.mjs are derived for "ex"; re-derive them before proceeding'
  );
});

test('versions.html: header toggle shows both editions with the default (EX) active, and the EX column highlighting is in effect', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'versions.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'versions.html (default)');

    const facts = await page.evaluate(() => {
      const scopeEx = [...document.querySelectorAll('#version-diffs .diff--scope-ex')];
      return {
        hasEx: document.getElementById('version-diffs')?.classList.contains('diffs--ex') ?? false,
        hasVanilla: document.getElementById('version-diffs')?.classList.contains('diffs--vanilla') ?? false,
        rows: document.querySelectorAll('#version-diffs .diff').length,
        scopeEx: scopeEx.length,
        scopeExBadges: scopeEx.filter((r) => r.querySelector('.badge--ex')).length,
        overCells: document.querySelectorAll('#version-overview .voverview__cell').length,
        overOff: document.querySelectorAll('#version-overview .voverview__cell--off').length,
        overTotal: [...document.querySelectorAll('#version-overview .voverview__count')].reduce(
          (n, e) => n + Number(e.textContent.trim()),
          0
        ),
        overCaption: (document.querySelector('#version-overview .voverview__caption')?.textContent || '').trim(),
      };
    });
    // pages.css keys the column highlighting off this container class
    assert.equal(facts.hasEx, true, 'versions.html (default ex): #version-diffs should carry diffs--ex (versions.js syncDiffs)');
    assert.equal(facts.hasVanilla, false, 'versions.html (default ex): #version-diffs should not carry diffs--vanilla');
    assert.equal(facts.rows, 19, 'data/versions.json has 19 records; versions.js renders the whole master list, unfiltered by version');
    assert.equal(facts.scopeEx, 6, 'data/versions.json: 6 records are EX-only → 6 .diff--scope-ex rows');
    assert.equal(facts.scopeExBadges, 6, 'every EX-only row wears its .badge--ex badge (ROGUE.badgeClass)');
    // the at-a-glance overview: one cell per distinct category, counts scoped to EX
    assert.equal(facts.overCells, 10, 'data/versions.json: the 19 records span 10 distinct categories → 10 .voverview__cell (versions.js overviewHtml)');
    assert.equal(facts.overOff, 0, 'data/versions.json: every category holds at least one EX difference → no receded (.voverview__cell--off) cells in EX');
    assert.equal(facts.overTotal, 19, 'the per-category counts sum to all 19 records (every record applies to EX)');
    assert.equal(
      facts.overCaption,
      '19 differences in EX across 10 categories — pick a category to jump to its first row.',
      'the overview caption counts the active build (versions.js overviewHtml)'
    );
  } finally {
    await close();
  }
});

test('versions.html: clicking Vanilla flips the column highlighting and the toggle state (rows stay)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'versions.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await clickToggle(
      page,
      'vanilla',
      () => document.getElementById('version-diffs')?.classList.contains('diffs--vanilla') === true,
      'versions.html'
    );
    await assertToggle(page, 'vanilla', 'versions.html (after click)');

    const facts = await page.evaluate(() => ({
      hasEx: document.getElementById('version-diffs')?.classList.contains('diffs--ex') ?? false,
      hasVanilla: document.getElementById('version-diffs')?.classList.contains('diffs--vanilla') ?? false,
      rows: document.querySelectorAll('#version-diffs .diff').length,
      scopeEx: document.querySelectorAll('#version-diffs .diff--scope-ex').length,
      overCells: document.querySelectorAll('#version-overview .voverview__cell').length,
      overOff: document.querySelectorAll('#version-overview .voverview__cell--off').length,
      overOffNames: [...document.querySelectorAll('#version-overview .voverview__cell--off .voverview__name')].map((e) => e.textContent.trim()),
      overTotal: [...document.querySelectorAll('#version-overview .voverview__count')].reduce(
        (n, e) => n + Number(e.textContent.trim()),
        0
      ),
      overCaption: (document.querySelector('#version-overview .voverview__caption')?.textContent || '').trim(),
    }));
    assert.equal(facts.hasVanilla, true, 'versions.html: after the click #version-diffs should carry diffs--vanilla');
    assert.equal(facts.hasEx, false, 'versions.html: after the click #version-diffs should not carry diffs--ex');
    // the rows themselves are not re-rendered: all 19 stay, and the 6
    // EX-only rows keep their scope (pages.css dims them as a whole)
    assert.equal(facts.rows, 19, 'versions.html: the 19 difference rows are version-independent');
    assert.equal(facts.scopeEx, 6, 'versions.html: the 6 EX-only rows remain rendered under Vanilla (dimmed by CSS, not removed)');
    // the overview re-renders for the active build: same 10 categories, but
    // the counts scope to Vanilla (19 − the 6 EX-only records = 13)
    assert.equal(facts.overCells, 10, 'the 10 category cells stay (the set is version-independent)');
    assert.equal(facts.overOff, 2, 'data/versions.json: mechanics (3 EX-only records) and timeofday (1 EX-only record) hold no Vanilla differences → 2 receded cells');
    assert.deepEqual(facts.overOffNames, ['mechanics', 'timeofday'], 'the receded categories are exactly mechanics and timeofday (first-appearance order in data/versions.json)');
    assert.equal(facts.overTotal, 13, 'the per-category counts sum to the 13 records that apply to Vanilla');
    assert.equal(
      facts.overCaption,
      '13 differences in Vanilla across 8 categories — pick a category to jump to its first row.',
      'the overview caption re-counts for the active build (versions.js syncDiffs/onChange)'
    );
  } finally {
    await close();
  }
});

test('routes.html: the six FAIRY-swap routes show a Fairy chip in EX; the total stays 36', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'routes.html (default)');

    const facts = await page.evaluate(routeFacts);
    assert.equal(facts.count, 36, 'data/routes.json: 36 routes, all in both versions → 36 cards under the "all" filter');
    assert.equal(facts.countLine, '36 routes across all 4 regions', 'the routes count line (routes.js applyRegion)');
    // data/routes.json: exactly these six records carry Fairy in the EX type
    assert.equal(facts.fairyCards, 6, 'routes.html (EX): exactly the six FAIRY-swap routes should show a Fairy chip');
    for (const [name, variants] of Object.entries(FAIRY_SWAPS)) {
      const card = facts.byName[name];
      assert.ok(card, `routes.html (EX): missing the ${name} card`);
      const types = variants.ex;
      for (const type of types) {
        assert.ok(card.chips.includes(type), `routes.html (EX): ${name} should show its EX wild-type chip "${type}" (data/routes.json top-level type)`);
      }
      assert.equal(card.diff, 'Differs in Vanilla', `routes.html (EX): ${name} difference note should read "Differs in Vanilla"`);
    }
  } finally {
    await close();
  }
});

test('routes.html: clicking Vanilla rewrites the URL, re-renders the swap routes, persists across pages, and round-trips back to EX', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);

    // EX → Vanilla: settle on Hoenn Mountain 1's re-rendered Fighting chip
    await clickToggle(
      page,
      'vanilla',
      () => {
        const c = [...document.querySelectorAll('.route-card')].find((c) =>
          c.querySelector('h3.card__title')?.textContent.trim() === 'Hoenn Mountain 1'
        );
        return c && [...c.querySelectorAll('.route-card__chips .chip')].some((e) => e.textContent.trim() === 'Fighting');
      },
      'routes.html (EX→Vanilla)'
    );
    await assertToggle(page, 'vanilla', 'routes.html (after click)');

    const v = await page.evaluate(routeFacts);
    assert.equal(v.count, 36, 'the total route count stays 36 under Vanilla (all 36 routes exist in both builds)');
    assert.equal(v.countLine, '36 routes across all 4 regions', 'the count line is version-independent');
    // data/routes.json: no Vanilla wild-type list contains Fairy
    assert.equal(v.fairyCards, 0, 'routes.html (Vanilla): no route should show a Fairy chip');
    for (const [name, variants] of Object.entries(FAIRY_SWAPS)) {
      const card = v.byName[name];
      assert.ok(card, `routes.html (Vanilla): missing the ${name} card`);
      const types = variants.vanilla;
      for (const type of types) {
        assert.ok(card.chips.includes(type), `routes.html (Vanilla): ${name} should show its Vanilla wild-type chip "${type}" (parsed from data/routes.json differences.vanilla by routes.js)`);
      }
      assert.equal(card.diff, 'Differs in EX', `routes.html (Vanilla): ${name} difference note should read "Differs in EX"`);
    }

    // the choice persists past a navigation without ?version= (setVersion
    // stores it; nav links carry no query string) — asserted on the next
    // page's rendered content, not on the storage key
    await page.goto(`${server.url}/quests.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.getElementById('quest-result')?.textContent || '').trim() === '138 quests',
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await assertToggle(page, 'vanilla', 'quests.html (persisted Vanilla choice)');
    assert.equal(
      new URL(page.url()).searchParams.get('version'),
      null,
      'quests.html reached without ?version= — the 138-card Vanilla state must come from the stored choice, not a URL override'
    );

    // Vanilla → EX round-trip on the quests page: settle on the 232-card render
    await clickToggle(
      page,
      'ex',
      () => (document.getElementById('quest-result')?.textContent || '').trim() === '232 quests',
      'quests.html (Vanilla→EX)'
    );
    await assertToggle(page, 'ex', 'quests.html (after round-trip)');
    assert.equal(
      await page.locator('.quest-card').count(),
      232,
      'the round-trip back to EX restores all 232 quests (data/quests.json)'
    );
  } finally {
    await close();
  }
});

test('routes.html: a ?version= URL param is a one-time override that never persists', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'routes.html', version: 'vanilla' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    assert.equal(
      new URL(page.url()).searchParams.get('version'),
      'vanilla',
      'the ?version= param is present for that load'
    );
    // the override wins for this load: Vanilla rendering, Vanilla toggle
    const facts = await page.evaluate(routeFacts);
    await assertToggle(page, 'vanilla', 'routes.html (?version=vanilla)');
    const hm1 = facts.byName['Hoenn Mountain 1'];
    assert.ok(hm1?.chips.includes('Fighting'), '?version=vanilla should render Hoenn Mountain 1 with its Vanilla wild types');
    assert.equal(facts.fairyCards, 0, '?version=vanilla should render no Fairy chips');

    // navigation WITHOUT the param falls back to the site default (ex) —
    // the override was one-time and never stored
    await page.goto(`${server.url}/safari.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('.version-toggle__option[data-version="ex"]')?.getAttribute('aria-pressed') === 'true',
      null,
      { timeout: SETTLE_TIMEOUT_MS }
    );
    await assertToggle(page, 'ex', 'safari.html (after a ?version= load)');
    const caveLabels = await page.evaluate(() =>
      [...document.querySelectorAll('#safari-legends .card__diff-label')].map((e) => e.textContent.trim())
    );
    assert.deepEqual(
      caveLabels,
      ['Differs in Vanilla'],
      'safari.html re-rendered in the EX variant — the ?version= override did not persist to the next page'
    );
  } finally {
    await close();
  }
});

test('quests.html: EX shows all 232 quests (94 EX badges); the result line and group counts follow the data', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'quests.html (default)');

    const facts = await page.evaluate(() => {
      const emptyGroup = document.querySelector('.quest-group__empty');
      return {
        cards: document.querySelectorAll('.quest-card').length,
        result: (document.getElementById('quest-result')?.textContent || '').trim(),
        groups: document.querySelectorAll('.quest-group').length,
        empty: document.querySelectorAll('.quest-group__empty').length,
        emptyId: emptyGroup ? emptyGroup.closest('.quest-group')?.id ?? null : null,
        badgeEx: document.querySelectorAll('.quest-card .badge--ex').length,
        groupCounts: Object.fromEntries(
          [...document.querySelectorAll('.quest-group__count')].map((el) => [el.getAttribute('data-count'), el.textContent.trim()])
        ),
        hasMegaEvolution: [...document.querySelectorAll('.quest-card h3.card__title')].some(
          (h) => h.textContent.trim() === 'Mega Evolution'
        ),
      };
    });
    assert.equal(facts.cards, 232, 'data/quests.json: 232 records, all include ex (138 shared + 94 EX-only) → 232 cards');
    assert.equal(facts.result, '232 quests', 'the quest log live count line (quests.js bindSearch)');
    assert.equal(facts.groups, 9, 'data/quests.json display_groups: 9 groups, all rendered');
    assert.equal(facts.empty, 1, 'under EX exactly one group (starter_challenges) holds no quests');
    assert.equal(facts.emptyId, 'quest-starter_challenges', 'the empty group under EX is starter_challenges');
    assert.equal(facts.badgeEx, 94, 'the 94 EX-only records wear the .badge--ex badge (ROGUE.badgeClass)');
    assert.ok(facts.hasMegaEvolution, 'the EX-only quest "Mega Evolution" (data/quests.json) is present under EX');
    assert.deepEqual(
      {
        mon_masteries: facts.groupCounts.mon_masteries,
        default_challenges: facts.groupCounts.default_challenges,
        type_challenges: facts.groupCounts.type_challenges,
        region_challenges: facts.groupCounts.region_challenges,
      },
      { mon_masteries: '133', default_challenges: '21', type_challenges: '19', region_challenges: '12' },
      'per-group heading counts under EX (data/quests.json, effective EX display_group)'
    );
  } finally {
    await close();
  }
});

test('quests.html: clicking Vanilla drops the 94 EX-only quests to 138 cards and the EX badges to zero', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'quests.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await clickToggle(
      page,
      'vanilla',
      () => (document.getElementById('quest-result')?.textContent || '').trim() === '138 quests',
      'quests.html (EX→Vanilla)'
    );
    await assertToggle(page, 'vanilla', 'quests.html (after click)');

    const facts = await page.evaluate(() => {
      const emptyGroup = document.querySelector('.quest-group__empty');
      return {
        cards: document.querySelectorAll('.quest-card').length,
        result: (document.getElementById('quest-result')?.textContent || '').trim(),
        groups: document.querySelectorAll('.quest-group').length,
        empty: document.querySelectorAll('.quest-group__empty').length,
        emptyId: emptyGroup ? emptyGroup.closest('.quest-group')?.id ?? null : null,
        badgeEx: document.querySelectorAll('.quest-card .badge--ex').length,
        groupCounts: Object.fromEntries(
          [...document.querySelectorAll('.quest-group__count')].map((el) => [el.getAttribute('data-count'), el.textContent.trim()])
        ),
        hasMegaEvolution: [...document.querySelectorAll('.quest-card h3.card__title')].some(
          (h) => h.textContent.trim() === 'Mega Evolution'
        ),
      };
    });
    assert.equal(facts.cards, 138, 'data/quests.json: only the 138 shared records include vanilla → 138 cards');
    assert.equal(facts.result, '138 quests', 'the result-count line updates to the rendered card count');
    assert.equal(facts.groups, 9, 'all 9 display groups stay rendered under Vanilla');
    assert.equal(facts.empty, 1, 'under Vanilla exactly one group (starter_challenges) holds no quests');
    assert.equal(facts.emptyId, 'quest-starter_challenges', 'the empty group under Vanilla is the same one (starter_challenges)');
    assert.equal(facts.badgeEx, 0, 'no .badge--ex badge under Vanilla — the 94 EX-only records (and their badges) are filtered out');
    assert.equal(facts.hasMegaEvolution, false, 'the EX-only quest "Mega Evolution" is absent under Vanilla');
    assert.deepEqual(
      {
        mon_masteries: facts.groupCounts.mon_masteries,
        default_challenges: facts.groupCounts.default_challenges,
        type_challenges: facts.groupCounts.type_challenges,
        region_challenges: facts.groupCounts.region_challenges,
      },
      { mon_masteries: '56', default_challenges: '16', type_challenges: '18', region_challenges: '5' },
      'per-group heading counts under Vanilla (data/quests.json, effective Vanilla display_group)'
    );
  } finally {
    await close();
  }
});

test('hub.html: the three per-version upgrades flip their "Differs in …" note with the toggle', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'hub.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'hub.html (default)');

    const fact = () =>
      page.evaluate((names) => {
        const cards = Object.fromEntries(
          [...document.querySelectorAll('.hub-upgrade')].map((c) => [
            c.querySelector('h3.card__title').textContent.trim(),
            {
              chips: [...c.querySelectorAll('.hub-upgrade__meta .chip')].map((e) => e.textContent.trim()),
              diff: c.querySelector('.card__diff-label')?.textContent.trim() ?? null,
            },
          ])
        );
        return {
          total: document.querySelectorAll('.hub-upgrade').length,
          diffNotes: [...document.querySelectorAll('.hub-upgrade .card__diff')].length,
          cards: Object.fromEntries(names.map((n) => [n, cards[n] ?? null])),
        };
      }, DIVERGENT_UPGRADES);

    const ex = await fact();
    assert.equal(ex.total, 48, 'data/hub.json: 48 hub-upgrade records, all in both versions → 48 cards');
    assert.equal(ex.diffNotes, 3, 'exactly the three divergent upgrades (data/hub.json `differences`) wear a .card__diff note');
    for (const name of DIVERGENT_UPGRADES) {
      const card = ex.cards[name];
      assert.ok(card, `hub.html (EX): missing the ${name} upgrade card`);
      assert.ok(card.chips.includes('differs by version'), `hub.html (EX): ${name} keeps its "differs by version" meta chip`);
      assert.ok(!card.chips.some((c) => c.endsWith('Build Parts')), `hub.html (EX): ${name} drops its ambiguous cost chip (hub.js)`);
      assert.equal(card.diff, 'Differs in Vanilla', `hub.html (EX): ${name} note should read "Differs in Vanilla"`);
    }

    await clickToggle(
      page,
      'vanilla',
      () =>
        [...document.querySelectorAll('.hub-upgrade .card__diff-label')].length === 3 &&
        [...document.querySelectorAll('.hub-upgrade .card__diff-label')].every((e) => e.textContent.trim() === 'Differs in EX'),
      'hub.html (EX→Vanilla)'
    );
    await assertToggle(page, 'vanilla', 'hub.html (after click)');

    const v = await fact();
    assert.equal(v.total, 48, 'the upgrade grid size is version-independent (all 48 upgrades exist in both builds)');
    assert.equal(v.diffNotes, 3, 'the three divergent upgrades keep their note under Vanilla');
    for (const name of DIVERGENT_UPGRADES) {
      const card = v.cards[name];
      assert.equal(card?.diff, 'Differs in EX', `hub.html (Vanilla): ${name} note should flip to "Differs in EX"`);
      assert.ok(card?.chips.includes('differs by version'), `hub.html (Vanilla): ${name} keeps its "differs by version" meta chip`);
    }
  } finally {
    await close();
  }
});

test('config.html: the 7 EX-only settings disappear under Vanilla (19 → 12 toggle cards)', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'config.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'config.html (default)');

    const fact = () =>
      page.evaluate((names) => ({
        toggleCards: document.querySelectorAll('#config-toggles .set-grid > article.card').length,
        intro: (document.querySelector('#config-toggles .section__head p:not(.eyebrow)')?.textContent || '').trim(),
        present: names.filter(
          (n) => [...document.querySelectorAll('#config-toggles h3.card__title')].some((h) => h.textContent.trim() === n)
        ),
      }), EX_ONLY_TOGGLES);

    const ex = await fact();
    assert.equal(ex.toggleCards, 19, 'data/settings.json: 19 toggle records, all available in EX → 19 cards (config.js ROGUE.filter)');
    assert.equal(ex.intro, '19 on/off switches in EX, grouped by the settings submenu that holds them.', 'the section intro counts the active version (config.js)');
    assert.deepEqual(ex.present, EX_ONLY_TOGGLES, 'all 7 EX-only toggles are present under EX');

    await clickToggle(
      page,
      'vanilla',
      () => document.querySelectorAll('#config-toggles .set-grid > article.card').length === 12,
      'config.html (EX→Vanilla)'
    );
    await assertToggle(page, 'vanilla', 'config.html (after click)');

    const v = await fact();
    assert.equal(v.toggleCards, 12, 'data/settings.json: only 12 toggle records are available in Vanilla (the 7 EX-only ones are filtered out)');
    assert.equal(v.intro, '12 on/off switches in Vanilla, grouped by the settings submenu that holds them.', 'the section intro counts the active version');
    assert.deepEqual(v.present, [], 'no EX-only toggle card under Vanilla');
  } finally {
    await close();
  }
});

test('safari.html: a version-identical page re-renders on toggle with stable content and a flipped cave note', async (t) => {
  if (skipIfNoPlaywright(t)) return;
  const { page, errors, close } = await openPage({ path: 'safari.html' });
  try {
    assert.deepEqual(errors, [], `unexpected page errors: ${errors.join('; ')}`);
    await assertToggle(page, 'ex', 'safari.html (default)');

    const fact = () =>
      page.evaluate(() => ({
        cells: document.querySelectorAll('.safari-slots__cell').length,
        steps: document.querySelectorAll('.safari-steps li').length,
        caveLabels: [...document.querySelectorAll('#safari-legends .card__diff-label')].map((e) => e.textContent.trim()),
      }));

    const ex = await fact();
    assert.equal(ex.cells, 60, 'data/safari.json: 60 pool slots (45 regular + 15 legendary) in both versions');
    assert.equal(ex.steps, 8, 'data/safari.json legends-cave: 8 steps in both versions');
    assert.deepEqual(ex.caveLabels, ['Differs in Vanilla'], 'safari.html (EX): the Legends Cave roster note reads "Differs in Vanilla"');

    await clickToggle(
      page,
      'vanilla',
      () =>
        [...document.querySelectorAll('#safari-legends .card__diff-label')].length === 1 &&
        [...document.querySelectorAll('#safari-legends .card__diff-label')].every((e) => e.textContent.trim() === 'Differs in EX'),
      'safari.html (EX→Vanilla)'
    );
    await assertToggle(page, 'vanilla', 'safari.html (after click)');

    const v = await fact();
    assert.equal(v.cells, 60, 'the slot diagram is version-identical');
    assert.equal(v.steps, 8, 'the Legends Cave flow is version-identical');
    assert.deepEqual(v.caveLabels, ['Differs in EX'], 'safari.html (Vanilla): the roster note flips to "Differs in EX"');
  } finally {
    await close();
  }
});

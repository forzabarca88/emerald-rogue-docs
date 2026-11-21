/*
 * End-result regressions for the generated data/quests.json wording
 * (issues #133, #134, #135). The committed JSON is the source of truth —
 * the extractor (scripts/extract/quests.mjs) is re-run to regenerate it,
 * and `npm run extract:quests -- --check` gates the sync — so these
 * assertions run against the committed file and need no game repo.
 *
 * #134 — "Not Today!": the second trigger is `FlagGet[FLAG_ROGUE_RIVAL_DISABLED]`
 * with `fail: SUCCESS` (src/data/rogue/quests/default_quests.json L860-879,
 * both builds). The old formatter dropped `fail: SUCCESS` and printed the
 * OPPOSITE condition ("the … flag is set (no action)"); the success branch
 * must render as a player instruction.
 *
 * #133 — "I am Speed": `RunTimerLessThanMins[150]` checks the run's
 * PLAY-TIME counter (PlayTimeCounter, reset in BeginRogueRun —
 * src/rogue_controller.c L4751-4752), not the world clock, and requires
 * strictly under 150 minutes (src/rogue_quest.c L1787-1792). The trigger
 * must say "run play time" in hours/minutes, never "in-game run time".
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const data = JSON.parse(readFileSync(new URL('../data/quests.json', import.meta.url), 'utf8'));
const record = (id) => {
  const r = data.records.find((x) => x.id === id);
  assert.ok(r, `fixture: quest record ${id} must exist in data/quests.json`);
  return r;
};

test('#134: "Not Today!" renders the fail:SUCCESS branch as a player instruction', () => {
  // ARRANGE — the committed record (vanilla + ex, trigger identical in both)
  const quest = record('NOT_TODAYEMARK');

  // ACT + ASSERT — the success branch is present and phrased as the
  // instruction the game performs: the quest completes when the flag is NOT
  // set; the old opposite-condition print and the no-action stub are gone
  assert.match(
    quest.trigger,
    /unless the "Rival battle disabled" flag is set, the quest completes\./,
    'the negative success branch must read as a player instruction (false → complete)'
  );
  assert.doesNotMatch(quest.trigger, /\(no action\)/, 'the dropped-branch stub must not remain in print');
});

test('#133: "I am Speed" measures run play time, not the world clock', () => {
  // ARRANGE — the committed record (vanilla + ex, trigger identical in both)
  const quest = record('I_AM_SPEED');

  // ACT + ASSERT — both the complete and the fail branch name the play-time
  // counter with the 150-minute limit as 2 h 30 min, in plain words
  const matches = quest.trigger.match(/your run play time is under 2 hours 30 minutes/g) ?? [];
  assert.equal(matches.length, 2, 'both trigger branches must state "run play time is under 2 hours 30 minutes"');
  assert.doesNotMatch(quest.trigger, /in-game run time/, 'the old "in-game run time" wording must not remain');
  assert.doesNotMatch(quest.trigger, /150 minutes/, 'the raw minute count must be rendered as hours + minutes');
});

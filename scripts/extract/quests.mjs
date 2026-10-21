#!/usr/bin/env node
/**
 * Quest extraction for the Emerald Rogue docs site (provenance for data/quests.json).
 *
 * DEV-ONLY: run manually (`npm run extract:quests`). The build and tests never
 * invoke this script — the committed data/quests.json is the source of truth.
 *
 * Usage:
 *   node scripts/extract/quests.mjs                     # process BOTH refs, emit merged data/quests.json
 *   node scripts/extract/quests.mjs --ref expansion     # single ref (records carry one version)
 *   node scripts/extract/quests.mjs --repo <path>       # default: references/pokeemerald-rogue
 *   node scripts/extract/quests.mjs --out <path>        # default: data/quests.json
 *   node scripts/extract/quests.mjs --check             # verify the committed file is up to date
 *
 * Loader semantics replicated 1:1 from the game:
 *   - `tools/Pokabbie/Build/CustomJson/main.cpp` (ExpandCommonArrayGroup*): the main
 *     file's own `quest_groups` come first, then `includes` (paths relative to the
 *     including file) are expanded recursively; a file-level `defaults` object is
 *     shallow-copied under each quest object (quest keys win per top-level key).
 *   - `tools/Pokabbie/Build/CustomJson/QuestExporter.cpp` (GatherQuests): quest id =
 *     FormatQuestId(template-expanded `name`); `display_group` comes from the quest
 *     object (usually via file `defaults`); a quest gets the `UNLOCKED_BY_DEFAULT`
 *     flag when no other quest's `quest` reward points at it; trigger
 *     `template_params` redirect params from the quest-level `template_params`.
 *   - Version gating: quest/reward/requirement-level `"#if"` conditions and raw
 *     `#ifdef ROGUE_EXPANSION` tokens inside trigger param lists. Vanilla build =
 *     ROGUE_EXPANSION undefined, expansion build = defined. (The quest JSON files
 *     are byte-identical between the two branches — verified with git diff.)
 *
 * Note on group ordering: nlohmann::json objects iterate in *sorted* key order
 * (std::map), so the exporter walks expanded group names lexicographically. We
 * replicate that for stable ordering, although the group names themselves are
 * never used to derive quest data (display group comes from the quest object).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_FILE = 'src/data/rogue/quests.json';
const QUESTS_DIR = 'src/data/rogue/quests';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { repo: 'references/pokeemerald-rogue', ref: null, out: 'data/quests.json', check: false };
  const value = (flag, index) => {
    const next = argv[index + 1];
    if (next === undefined) fail(`Missing value for ${flag}`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') { args.repo = value(arg, i); i++; }
    else if (arg === '--ref') { args.ref = value(arg, i); i++; }
    else if (arg === '--out') { args.out = value(arg, i); i++; }
    else if (arg === '--check') args.check = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/extract/quests.mjs [--repo <path>] [--ref vanilla|expansion] [--out <path>] [--check]');
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (args.ref !== null && !['vanilla', 'expansion'].includes(args.ref)) {
    fail(`--ref must be "vanilla" or "expansion" (got ${JSON.stringify(args.ref)})`);
  }
  return args;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Repo access (vanilla = working tree, expansion = origin/expansion via git)
// ---------------------------------------------------------------------------

function git(repo, ...gitArgs) {
  try {
    return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    fail(`git ${gitArgs.join(' ')} failed: ${String(error.message).split('\n')[0]}`);
  }
}

function assertRepoSane(repo, ref) {
  if (!existsSync(repo)) fail(`Game repo not found: ${repo}`);
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (ref === 'vanilla' && branch !== 'vanilla') {
    fail(`Game repo working tree is on "${branch}" — the vanilla ref is read from the working tree, which must be "vanilla" (do not check out other branches).`);
  }
  if (ref === 'expansion') {
    git(repo, 'rev-parse', '--verify', 'origin/expansion'); // throws if missing
  }
}

function readRefFile(repo, ref, file) {
  if (ref === 'vanilla') return readFileSync(path.join(repo, file), 'utf8');
  return git(repo, 'show', `origin/expansion:${file}`);
}

// ---------------------------------------------------------------------------
// Loader: ExpandCommonArrayGroup + GatherQuests replica
// ---------------------------------------------------------------------------

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Shallow merge exactly like the exporter: `destGroup = defaults; then quest keys overwrite.` */
function mergeDefaults(defaults, quest) {
  const merged = defaults ? clone(defaults) : {};
  for (const [key, value] of Object.entries(quest)) merged[key] = clone(value);
  return merged;
}

/**
 * Expand one file's `quest_groups` (own groups + includes, recursively).
 * Returns an array of { name, quests } — later sorted by name to mirror the
 * std::map (sorted-key) iteration order of nlohmann::json.
 */
function expandQuestGroups(repo, ref, filePath, cache, counter) {
  if (cache.has(filePath)) return cache.get(filePath);

  const raw = JSON.parse(readRefFile(repo, ref, filePath));
  const dir = filePath.slice(0, filePath.lastIndexOf('/') + 1) || '.';

  const groups = [];

  // 1. Own groups first (a file-level "condition" renames them; the quest
  //    exporter never reads the group name, so this is cosmetic — replicated
  //    anyway for fidelity).
  const condition = typeof raw.condition === 'string' && raw.condition !== '' ? raw.condition : '';
  for (const [groupName, quests] of Object.entries(raw.quest_groups ?? {})) {
    const name = condition !== '' ? `#if ${condition} // ${groupName}` : groupName;
    const merged = quests.map((quest) => mergeDefaults(raw.defaults ?? null, quest));
    groups.push({ name, quests: merged, sourceFile: filePath });
  }

  // 2. Includes (relative to this file), each expanded with the SHARED counter.
  for (const includeRel of raw.includes ?? []) {
    const includePath = (dir + includeRel).replaceAll('\\', '/');
    const included = expandQuestGroups(repo, ref, includePath, cache, counter);
    for (const group of included) {
      counter.value += 1;
      groups.push({
        name: `${String(counter.value).padStart(6, '0')}_${group.name} // [${includePath}]`,
        quests: group.quests,
        sourceFile: group.sourceFile,
      });
    }
  }

  groups.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  cache.set(filePath, groups);
  return groups;
}

// --- template + id helpers (QuestExporter.cpp) ---

/**
 * QuestExpandString's MON_SPECIES special case (QuestExporter.cpp):
 * `expandString("SPECIES_", "", value)` strips the prefix, then
 * `capitalize(to_lower(...))` lowercases and uppercases the first char only.
 * (So SPECIES_JANGMO_O -> "Jangmo_o", not "Jangmo-O".)
 */
function prettySpecies(value) {
  const stripped = value.startsWith('SPECIES_') ? value.slice('SPECIES_'.length) : value;
  const lower = stripped.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** QuestExpandString: replace %KEY% with the quest's template_params[KEY]. */
function expandQuestString(quest, text) {
  let out = text;
  for (const [key, value] of Object.entries(quest.template_params ?? {})) {
    const token = `%${key}%`;
    let replacement = String(value);
    if (key === 'MON_SPECIES') replacement = prettySpecies(replacement);
    out = out.split(token).join(replacement);
  }
  return out;
}

/**
 * FormatQuestId (QuestExporter.cpp L763-785): quest id from the (expanded)
 * display name. Mirrors the exporter exactly, including its ASCII-only
 * `strutil::to_upper` (tools/.../CustomJson/StringUtils.h maps only 'a'-'z').
 * JS `String.prototype.toUpperCase()` must NOT be used here: it is
 * Unicode-aware and would turn "é" into "É" BEFORE the é→E replacement below
 * ran, producing "POKÉ_BALL_GOEMARK" instead of the game's "POKE_BALL_GOEMARK".
 */
function formatQuestId(name) {
  let id = name.replace(/[a-z]/g, (ch) => ch.toUpperCase());
  id = id.replaceAll(' ', '_');
  id = id.replaceAll('-', '_');
  id = id.replaceAll('!', 'EMARK');
  id = id.replaceAll('?', 'QMARK');
  id = id.replaceAll('Ã©', 'E'); // mojibake é (kept for parity with the exporter)
  id = id.replaceAll('é', 'E');
  id = id.replaceAll(/[,."'()\[\]{}]/g, '');
  id = id.replaceAll('+', 'PLUS');
  id = id.replaceAll('…', '');
  return id;
}

/**
 * GatherQuests: flatten expanded groups into quest entries.
 * Trigger `template_params` redirect: params listed there are appended (in order)
 * from the quest-level `template_params`.
 */
function gatherQuests(groups) {
  const quests = [];
  for (const group of groups) {
    for (const questObj of group.quests) {
      if (typeof questObj.name !== 'string') fail(`Quest without a name in ${group.sourceFile}`);
      const name = expandQuestString(questObj, questObj.name);
      const triggers = (questObj.triggers ?? []).map((trigger) => {
        const params = [];
        for (const param of trigger.params ?? []) {
          params.push(typeof param === 'number' ? String(param) : param);
        }
        for (const key of trigger.template_params ?? []) {
          const value = questObj.template_params?.[key];
          if (value === undefined) fail(`Trigger template param "${key}" has no quest-level value in ${group.sourceFile}`);
          params.push(typeof value === 'number' ? String(value) : value);
        }
        return {
          condition: trigger.condition,
          pass: trigger.pass ?? 'PENDING',
          fail: trigger.fail ?? 'PENDING',
          on: [...(trigger.on ?? [])],
          params,
        };
      });
      quests.push({
        id: formatQuestId(name),
        name,
        description: expandQuestString(questObj, questObj.description ?? ''),
        displayGroup: questObj.display_group ?? '',
        preprocessorCondition: typeof questObj['#if'] === 'string' ? questObj['#if'] : '',
        flags: [...(questObj.flags ?? [])],
        triggers,
        rewards: clone(questObj.rewards ?? []),
        requirements: clone(questObj.requirements ?? []),
        sourceFile: group.sourceFile,
      });
    }
  }
  return quests;
}

// ---------------------------------------------------------------------------
// Per-version filtering (preprocessor conditions)
// ---------------------------------------------------------------------------

const REFS = [
  { ref: 'vanilla', version: 'vanilla', isExpansion: false },
  { ref: 'expansion', version: 'ex', isExpansion: true },
];

function conditionActive(condition, isExpansion) {
  if (condition === '') return true;
  if (condition === 'defined(ROGUE_EXPANSION)') return isExpansion;
  if (condition === '!defined(ROGUE_EXPANSION)') return !isExpansion;
  fail(`Unsupported preprocessor condition: ${JSON.stringify(condition)}`);
}

/**
 * Strip raw `#ifdef`/`#ifndef`/`#endif` tokens from a trigger param list and
 * keep only the params active for this build (mirrors the generated C code).
 */
function filterRawParams(params, isExpansion) {
  const out = [];
  const activeStack = [];
  for (const param of params) {
    if (param === '#ifdef ROGUE_EXPANSION') {
      activeStack.push(isExpansion);
      continue;
    }
    if (param === '#ifndef ROGUE_EXPANSION') {
      activeStack.push(!isExpansion);
      continue;
    }
    if (param === '#endif') {
      if (activeStack.length === 0) fail('Stray #endif in trigger params');
      activeStack.pop();
      continue;
    }
    if (param.startsWith('#')) fail(`Unsupported raw preprocessor token in trigger params: ${JSON.stringify(param)}`);
    if (activeStack.every(Boolean)) out.push(param);
  }
  if (activeStack.length !== 0) fail('Unbalanced #ifdef/#endif in trigger params');
  return out;
}

/** Build the set of quest entries present in one version's compiled table. */
function buildForRef(ref, quests) {
  const isExpansion = ref.isExpansion;
  const entries = [];
  for (const quest of quests) {
    if (!conditionActive(quest.preprocessorCondition, isExpansion)) continue;
    const rewards = quest.rewards.filter((reward) => conditionActive(reward['#if'] ?? '', isExpansion));
    const requirements = quest.requirements.filter((requirement) => conditionActive(requirement['#if'] ?? '', isExpansion));
    const triggers = quest.triggers.map((trigger) => ({
      ...trigger,
      params: filterRawParams(trigger.params, isExpansion),
    }));
    entries.push({ ...quest, rewards, requirements, triggers });
  }

  // UNLOCKED_BY_DEFAULT: a quest missing from every active `quest` reward gets it.
  // Divergence from the real loader: GatherQuests (QuestExporter.cpp L1230-1267)
  // computes isUnlockedViaReward over the FULL both-build quest list pre-gating
  // (the "#if" conditions only take effect later, at C compile time), whereas this
  // generator computes it per-build over each build's active entries. Verified
  // identical for this dataset; it would diverge for a future shared quest whose
  // only unlock source is a "quest" reward gated to the other build.
  const rewarded = new Set();
  for (const entry of entries) {
    for (const reward of entry.rewards) {
      if (reward.quest !== undefined) rewarded.add(formatQuestId(reward.quest));
    }
  }
  for (const entry of entries) {
    if (!rewarded.has(entry.id)) entry.flags = [...entry.flags, 'UNLOCKED_BY_DEFAULT'];
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Human-readable rendering (trigger/reward/requirement/flag text)
// ---------------------------------------------------------------------------

const DIFFICULTY_NAMES = { EASY: 'Easy', AVERAGE: 'Average', HARD: 'Hard', BRUTAL: 'Brutal', CUSTOM: 'Custom' };
const DIFFICULTY_CONSTS = {
  ROGUE_GYM_START_DIFFICULTY: 0,
  ROGUE_GYM_MID_DIFFICULTY: 4,
  ROGUE_ELITE_START_DIFFICULTY: 8,
  ROGUE_FINAL_CHAMP_DIFFICULTY: 13,
  ROGUE_CHAMP_START_DIFFICULTY: 12,
};
const BUILD_AMOUNTS = {
  QUEST_REWARD_SMALL_BUILD_AMOUNT: 5,
  QUEST_REWARD_MEDIUM_BUILD_AMOUNT: 15,
  QUEST_REWARD_LARGE_BUILD_AMOUNT: 30,
};
const MONEY_REWARDS = {
  QUEST_REWARD_SMALL_MONEY: '¥1,000',
  QUEST_REWARD_MEDIUM_MONEY: '¥2,000',
  QUEST_REWARD_LARGE_MONEY: '¥5,000',
  QUEST_REWARD_LARGEST_MONEY: '¥20,000',
};
const ROOM_TYPES = {
  ADVPATH_ROOM_NONE: 'none',
  ADVPATH_ROOM_ROUTE: 'Route',
  ADVPATH_ROOM_RESTSTOP: 'Rest Stop',
  ADVPATH_ROOM_LEGENDARY: 'Legendary encounter',
  ADVPATH_ROOM_MINIBOSS: 'mini-boss (unused)',
  ADVPATH_ROOM_TEAM_HIDEOUT: 'Team Hideout',
  ADVPATH_ROOM_WILD_DEN: 'Wild Den',
  ADVPATH_ROOM_HONEY_TREE: 'Honey Tree',
  ADVPATH_ROOM_GAMESHOW: 'Game Show',
  ADVPATH_ROOM_DARK_DEAL: 'Dark Deal',
  ADVPATH_ROOM_LAB: 'Lab',
  ADVPATH_ROOM_SHRINE: 'Shrine',
  ADVPATH_ROOM_CATCHING_CONTEST: 'Catching Contest',
  ADVPATH_ROOM_SIGN: 'Sign',
  ADVPATH_ROOM_BATTLE_SIM: 'Battle Simulator',
  ADVPATH_ROOM_BATTLE_TOWER: 'Battle Tower',
  ADVPATH_ROOM_BOSS: 'Boss',
};
const TRIGGER_FLAGS = {
  RUN_START: 'At the start of a run',
  RUN_END: 'At the end of a run',
  WILD_BATTLE_START: 'When a wild battle starts',
  WILD_BATTLE_END: 'When a wild battle ends',
  WILD_BATTLE_END_TURN: 'At the end of a turn in a wild battle',
  TRAINER_BATTLE_START: 'When a Trainer battle starts',
  TRAINER_BATTLE_END: 'When a Trainer battle ends',
  TRAINER_BATTLE_END_TURN: 'At the end of a turn in a Trainer battle',
  ANY_BATTLE_START: 'When any battle starts',
  ANY_BATTLE_END: 'When any battle ends',
  MISC_UPDATE: 'On background game updates (e.g. when quests unlock, runs end, saves load)',
  EARN_BADGE: 'When you earn a badge',
  ENTER_HALL_OF_FAME: 'When you enter the Hall of Fame',
  MAP_SPECIFIC_EVENT: 'On a map event',
  POKEDEX_UPDATE: 'When your Pokédex is updated',
  ENTER_ENCOUNTER: 'When you enter an encounter',
  EXIT_ENCOUNTER: 'When you leave an encounter',
  MON_FAINTED: 'When a Pokémon faints',
  MON_LEGEND_CAUGHT: 'When you catch a Legendary Pokémon',
  MON_SHINY_CAUGHT: 'When you catch a Shiny Pokémon',
  MON_NON_SHINY_CAUGHT: 'When you catch a non-Shiny Pokémon',
  ANY_MON_CAUGHT: 'When you catch a Pokémon',
  FIELD_ITEM_USED: 'When you use a field item',
  BATTLE_ITEM_USED: 'When you use a battle item',
};
const DEX_REGIONS = {
  ROGUE: 'Rogue', KANTO: 'Kanto', JOHTO: 'Johto', HOENN: 'Hoenn', NATIONAL: 'National', EXTRAS: 'Extras',
  SINNOH: 'Sinnoh', UNOVA: 'Unova', KALOS: 'Kalos', ALOLA: 'Alola', GALAR: 'Galar', PALDEA: 'Paldea',
};
const DEX_VARIANTS = {
  POKEDEX_VARIANT_LEGENDS_ZA: "Legend's Z-A",
  POKEDEX_VARIANT_LEGENDS_ZAFULLDLC: "Legend's Z-A (Full DLC)",
};
const TEAMS = {
  TEAM_NUM_KANTO_ROCKET: 'Team Rocket (Kanto)',
  TEAM_NUM_JOHTO_ROCKET: 'Team Rocket (Johto)',
  TEAM_NUM_AQUA: 'Team Aqua',
  TEAM_NUM_MAGMA: 'Team Magma',
  TEAM_NUM_GALACTIC: 'Team Galactic',
  TEAM_NUM_PLASMA: 'Team Plasma',
  TEAM_NUM_FLARE: 'Team Flare',
};
const CONFIG_RANGES = {
  CONFIG_RANGE_TRAINER_LEVEL: 'trainer level',
  CONFIG_RANGE_BATTLE_FORMAT: 'battle format',
  CONFIG_RANGE_POKEDEX_VARIANT: 'Pokédex variant',
  CONFIG_RANGE_GAME_MODE_NUM: 'game mode',
  CONFIG_RANGE_DIFFICULTY_PRESET: 'difficulty preset',
  CONFIG_RANGE_REVISION_MODE: 'revision mode',
  CONFIG_RANGE_TRAINER_ORDER: 'trainer order',
};
const CONFIG_VALUES = {
  BATTLE_FORMAT_DOUBLES: 'Doubles',
  BATTLE_FORMAT_MIXED: 'Mixed',
  BATTLE_FORMAT_SINGLE: 'Singles',
  TRAINER_ORDER_RAINBOW: 'Rainbow',
  TRAINER_ORDER_OFFICIAL: 'Official',
  TRAINER_ORDER_DEFAULT: 'Default',
  ROGUE_GAME_MODE_STANDARD: 'Classic',
  ROGUE_GAME_MODE_GAUNTLET: 'Gauntlet',
  ROGUE_GAME_MODE_FAST_PATH: 'Fast Path',
};
const TYPE_NAMES = {
  NORMAL: 'Normal', FIGHTING: 'Fighting', FLYING: 'Flying', POISON: 'Poison', GROUND: 'Ground',
  ROCK: 'Rock', BUG: 'Bug', GHOST: 'Ghost', STEEL: 'Steel', FIRE: 'Fire', WATER: 'Water',
  GRASS: 'Grass', ELECTRIC: 'Electric', PSYCHIC: 'Psychic', ICE: 'Ice', DRAGON: 'Dragon',
  DARK: 'Dark', FAIRY: 'Fairy',
};
const SPECIES_FORMS = { ALOLAN: 'Alolan', GALARIAN: 'Galarian', HISUIAN: 'Hisuian', PALDEAN: 'Paldean' };
const SPECIES_SPECIAL = { JANGMO_O: 'Jangmo-o', PIKACHU_ORIGINAL_CAP: 'Pikachu (Original Cap)' };
const ITEM_SPECIAL = { C_GEAR: 'C-Gear', POKEBLOCK_SHINY: 'Shiny Pokéblock', POKEBLOCK: 'Pokéblock' };
// In-game display names (src/data/rogue_items.h, both branches) that diverge
// from the identifier-derived humanization. The docs are EX-focused and EX uses
// title-case names, so the shared humanized text uses the title-case spelling
// for both builds; the one exception is ITEM_SHOP_PRICE_CURSE, where vanilla
// ships the "DISCOUND CURSE" typo, which we keep on the vanilla side only.
const ITEM_NAMES = {
  BUILDING_SUPPLIES: 'Build Parts',
  WILD_IV_CURSE: 'Strength Curse',
  BATTLE_ITEM_CURSE: 'Embargo Curse',
  SPECIES_CLAUSE_CURSE: 'Species Curse',
  WILD_EGG_SPECIES_CURSE: 'Baby Curse',
  PARTY_CURSE: 'Capacity Curse',
  SHOP_PRICE_CURSE: { vanilla: 'DISCOUND CURSE', ex: 'Discount Curse' },
  WILD_ENCOUNTER_CURSE: 'Wild Curse',
  RANDOMAN_ROUTE_SPAWN_CURSE: 'Wahey Curse',
  RANDOMAN_ALWAYS_SPAWN_CURSE: 'Wahey+ Curse',
};
// In-game settings labels (src/data/rogue_strings.h gText_DifficultyBagWipe,
// identical in both branches) for config toggles referenced in requirements.
const TOGGLE_NAMES = { BAG_WIPE: 'Fresh Start' };
// In-game home-decor names (src/data/rogue/decorations/objects.json, identical
// in both branches) for ids whose identifier-derived text would mangle acronyms.
const DECOR_NAMES = { PC: 'PC', PC_WANDERING_PKMN: 'PC wandering {PKMN}' };
const FLAG_TEXT = {
  FLAG_ROGUE_RIVAL_DISABLED: 'Rival battle disabled',
  FLAG_ROGUE_HAS_RANDOM_STARTER: 'random starter received',
  FLAG_ROGUE_RANDOM_TRADE_WAS_ACTIVE: 'Mr. Randoman trade was active',
  FLAG_ROGUE_RANDOM_TRADE_DISABLED: 'Mr. Randoman trade was avoided',
  FLAG_ROGUE_RANDOM_TRADE_WAS_FULL_PARTY: 'last Mr. Randoman trade was a full-party trade',
};
const VAR_TEXT = {
  VAR_ROGUE_TOTAL_RUN_CATCHES: 'total catches this run',
};
const MAP_TEXT = {
  MAP_ROGUE_INTERIOR_CHALLENGE_FRONTIER: 'the Challenge Frontier',
};
const REQUIREMENT_OPS = {
  EQUAL: (n, item) => `exactly ${n}× ${item}`,
  NOT_EQUAL: (n, item) => `not ${n}× ${item}`,
  GREATER_THAN: (n, item) => `more than ${n}× ${item}`,
  LESS_THAN: (n, item) => `fewer than ${n}× ${item}`,
  GREATER_THAN_EQUAL: (n, item) => `at least ${n}× ${item}`,
  LESS_THAN_EQUAL: (n, item) => `at most ${n}× ${item}`,
};

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function humanizeSegments(segments) {
  return segments.map((segment) => cap(segment.toLowerCase())).join(' ');
}

function humanSpecies(value) {
  if (typeof value !== 'string' || !value.startsWith('SPECIES_')) return value;
  const tail = value.slice('SPECIES_'.length);
  if (SPECIES_SPECIAL[tail]) return SPECIES_SPECIAL[tail];
  const parts = tail.split('_');
  const last = parts[parts.length - 1];
  if (parts.length > 1 && SPECIES_FORMS[last]) {
    return `${SPECIES_FORMS[last]} ${humanizeSegments(parts.slice(0, -1))}`;
  }
  return humanizeSegments(parts);
}

function humanItem(value, version) {
  if (typeof value !== 'string' || !value.startsWith('ITEM_')) return value;
  const tail = value.slice('ITEM_'.length);
  const named = ITEM_NAMES[tail];
  if (named !== undefined) return typeof named === 'string' ? named : named[version];
  if (ITEM_SPECIAL[tail]) return ITEM_SPECIAL[tail];
  return humanizeSegments(tail.split('_'));
}

function humanMoney(value) {
  if (MONEY_REWARDS[value]) return MONEY_REWARDS[value];
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? `¥${asNumber.toLocaleString('en-US')}` : value;
}

/** Reward/requirement item counts may be constants (see C++ ParseInt) or plain numbers. */
function resolveCount(value) {
  const v = String(value);
  if (BUILD_AMOUNTS[v] !== undefined) return String(BUILD_AMOUNTS[v]);
  return v;
}

function humanDifficulty(value) {
  return DIFFICULTY_NAMES[value] ?? value;
}

function evalDifficultyExpr(value) {
  const match = /^([A-Z_]+)(?:\s*([+-])\s*(\d+))?$/.exec(String(value).trim());
  if (!match) return value;
  const base = DIFFICULTY_CONSTS[match[1]];
  if (base === undefined) return value;
  const delta = match[2] === '-' ? -Number(match[3]) : Number(match[3] ?? 0);
  return base + delta;
}

function humanList(values) {
  const list = [...values];
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function stripTextTags(text) {
  return text.replaceAll(/\{[A-Z_ ]+\}/g, '').trim();
}

function humanQuestRef(value) {
  // QUEST_ID_* trigger params or plain quest names inside `quest` rewards
  const tail = value.startsWith('QUEST_ID_') ? value.slice('QUEST_ID_'.length) : value;
  const text = tail.replaceAll('EMARK', '!').replaceAll('QMARK', '?').replaceAll('_', ' ');
  // light title-case (ids are all caps): "TASTE THE RAINBOW" -> "Taste the Rainbow"
  return text.split(' ').map((word) => cap(word.toLowerCase())).join(' ');
}

function humanTrainerRegion(value) {
  const match = /^CONFIG_TOGGLE_TRAINER_([A-Z]+)$/.exec(value);
  if (match) return DEX_REGIONS[match[1]] ?? match[1];
  return value;
}

function describeCondition(trigger, version) {
  const p = trigger.params;
  switch (trigger.condition) {
    case 'Always': return 'always';
    case 'DifficultyGreaterThan': return `difficulty is above ${evalDifficultyExpr(p[0])}`;
    case 'DifficultyLessThan': return `difficulty is below ${evalDifficultyExpr(p[0])}`;
    case 'IsStandardRunActive': return 'a Standard run is active';
    case 'HasCompletedQuestAND': return `all of these quests are complete: ${humanList(p.map(humanQuestRef))}`;
    case 'HasCompletedQuestOR': return `any of these quests is complete: ${humanList(p.map(humanQuestRef))}`;
    case 'PartyContainsType': return `your party contains a ${TYPE_NAMES[p[0].replace(/^TYPE_/, '')] ?? p[0]} type Pokémon`;
    case 'PartyOnlyContainsType': return `your party contains only ${TYPE_NAMES[p[0].replace(/^TYPE_/, '')] ?? p[0]} type Pokémon`;
    case 'PartyContainsLegendary': return 'your party contains a Legendary Pokémon';
    case 'PartyContainsOnlyLegendaries': return 'your party contains only Legendary Pokémon';
    case 'PartyContainsOnlyShinys': return 'your party contains only Shiny Pokémon';
    case 'PartyContainsOnlyStarters': return 'your party contains only Starter Pokémon';
    case 'PartyContainsOnlyUniqueTypes': return 'no two Pokémon in your party share a type';
    case 'PartyContainsInitialPartner': return 'your original Partner Pokémon is in your party';
    case 'PartyContainsSpecies': return `your party contains any of: ${humanList(p.map(humanSpecies))}`;
    case 'PartyContainsAllSpecies': return `your party contains all of: ${humanList(p.map(humanSpecies))}`;
    case 'PartyMaxBSTLessThan': return `the highest Base Stat Total in your party is below ${p[0]}`;
    case 'CurrentlyInMap': return `you are in ${MAP_TEXT[p[0]] ?? humanizeSegments(p[0].replace(/^MAP_/, '').split('_'))}`;
    case 'CurrentlyInRoomType': return `you are in a ${ROOM_TYPES[p[0]] ?? p[0]}`;
    case 'AreOnlyTheseTrainersActive': return `only ${humanTrainerRegion(p[0])} Trainers are enabled`;
    case 'IsPokedexRegion': return `the Pokédex is set to a ${DEX_REGIONS[p[0].replace(/^POKEDEX_REGION_/, '')] ?? p[0]} variant`;
    case 'IsPokedexVariant': return `the Pokédex is set to one of: ${humanList(p.map((v) => DEX_VARIANTS[v] ?? humanizeSegments(v.replace(/^POKEDEX_VARIANT_/, '').split('_'))))}`;
    case 'CanUnlockFinalQuest': return 'every other Main Quest is completed and its rewards collected';
    case 'HasBuiltAllAreas': return 'every hub area has been built';
    case 'IsFinalQuestConditionMet': return 'the Final Quest settings are met (only Rogue Trainers enabled, Standard game mode, and the matching National Pokédex)';
    case 'PokedexEntryCountGreaterThan': return `you have caught more than ${p[0]} Pokémon in the Pokédex`;
    case 'PokedexShinyEntryCountGreaterThan': return `you have more than ${p[0]} Shiny Pokémon in the Pokédex`;
    case 'InAdventureEncounterType': return `the current adventure room is one of: ${humanList(p.map((v) => ROOM_TYPES[v] ?? v))}`;
    case 'TotalMoneySpentGreaterThan': return `you have spent more than ¥${Number(p[0]).toLocaleString('en-US')} on the current map`;
    case 'PlayerMoneyGreaterThan': return `you have more than ¥${Number(p[0]).toLocaleString('en-US')} in your pocket`;
    case 'RandomanWasUsed': return 'you used a Mr. Randoman trade here';
    case 'RandomanWasActive': return 'a Mr. Randoman trade was available during this run';
    case 'LastRandomanWasFullParty': return 'your last Mr. Randoman trade used your full party';
    case 'LastItemWasAny': return `the item you just used is one of: ${humanList(p.map((v) => humanItem(v, version)))}`;
    case 'BagContainsItemsOR': return `you have any of these items in your bag: ${humanList(p.map((v) => humanItem(v, version)))}`;
    case 'FlagGet': return `the "${FLAG_TEXT[p[0]] ?? humanizeSegments(p[0].replace(/^FLAG_/, '').split('_'))}" flag is set`;
    case 'VarGetEqual': return `the ${VAR_TEXT[p[0]] ?? humanizeSegments(p[0].replace(/^VAR_/, '').split('_'))} equals ${p[1]}`;
    case 'VarGetLessThan': return `the ${VAR_TEXT[p[0]] ?? humanizeSegments(p[0].replace(/^VAR_/, '').split('_'))} is less than ${p[1]}`;
    case 'VarGetGreaterThan': return `the ${VAR_TEXT[p[0]] ?? humanizeSegments(p[0].replace(/^VAR_/, '').split('_'))} is more than ${p[1]}`;
    case 'RunTimerLessThanMins': return `your in-game run time is under ${p[0]} minutes`;
    case 'IsConfigRangeEqualToAny': {
      const range = CONFIG_RANGES[p[0]] ?? p[0];
      const values = p.slice(1).map((v) => CONFIG_VALUES[v] ?? humanizeSegments(String(v).split('_')));
      return values.length === 1 ? `${range} is set to ${values[0]}` : `${range} is set to one of: ${humanList(values)}`;
    }
    case 'SpeciesMasteryComplete':
      return p.length === 1
        ? `you have mastered the ${humanSpecies(p[0])} species line`
        : `you have mastered any of these species lines: ${humanList(p.map(humanSpecies))}`;
    case 'CurrentEvilTeamIs': return `your run's Evil Team is one of: ${humanList(p.map((v) => TEAMS[v] ?? v))}`;
    default:
      fail(`Unrecognised quest condition callback: ${JSON.stringify(trigger.condition)}`);
  }
}

function describeTrigger(trigger, version) {
  // TRIGGER_FLAGS phrases already start with "When/At/On" — use them as-is.
  const when = trigger.on.map((flag) => TRIGGER_FLAGS[flag] ?? flag).join(' or ');
  const cond = describeCondition(trigger, version);
  const passText = trigger.pass === 'SUCCESS' ? 'the quest completes' : trigger.pass === 'FAIL' ? 'the quest fails' : null;
  const failText = trigger.fail === 'FAIL' ? 'the quest fails' : trigger.fail === 'BREAK' ? 'further trigger checks are skipped' : null;

  if (cond === 'always') {
    if (passText && !failText) return `${when}: ${passText}.`;
    if (!passText && failText) return `${when}: ${failText}.`;
    if (passText && failText) return `${when}: ${passText} (${failText}).`;
    return `${when}: ${cond} (no action).`;
  }
  if (passText && failText) return `${when}: if ${cond} then ${passText}, otherwise ${failText}.`;
  if (passText && !failText) return `${when}: if ${cond} then ${passText}.`;
  if (!passText && failText) return `${when}: unless ${cond}, ${failText}.`;
  return `${when}: ${cond} (no action).`;
}

function describeTriggers(entry, version) {
  if (entry.triggers.length === 0) return 'No triggers (unlocks but never completes on its own).';
  return entry.triggers.map((trigger) => describeTrigger(trigger, version)).join(' ');
}

function describeRequirement(requirement, version) {
  if (requirement.item !== undefined) {
    const count = resolveCount(requirement.count ?? '1');
    const item = humanItem(requirement.item, version);
    return `you have ${REQUIREMENT_OPS[requirement.operation ?? 'GREATER_THAN_EQUAL'](count, item)}`;
  }
  if (requirement.flag !== undefined) {
    const state = requirement.state === false || requirement.state === 'FALSE' ? 'unset' : 'set';
    return `the "${FLAG_TEXT[requirement.flag] ?? humanizeSegments(requirement.flag.replace(/^FLAG_/, '').split('_'))}" flag is ${state}`;
  }
  if (requirement.config_toggle !== undefined) {
    const on = requirement.state === false || requirement.state === 'FALSE' ? false : true;
    const region = humanTrainerRegion(requirement.config_toggle);
    if (region !== requirement.config_toggle) {
      return `${region} Trainers are ${on ? 'enabled' : 'disabled'}`;
    }
    const tail = requirement.config_toggle.replace(/^CONFIG_TOGGLE_/, '');
    const label = TOGGLE_NAMES[tail] ?? humanizeSegments(tail.split('_'));
    return `${label} is ${on ? 'on' : 'off'}`;
  }
  if (requirement.config_range !== undefined) {
    const range = CONFIG_RANGES[requirement.config_range] ?? requirement.config_range;
    const value = CONFIG_VALUES[requirement.value] ?? humanizeSegments(String(requirement.value).split('_'));
    const op = requirement.operation ?? 'EQUAL';
    return op === 'EQUAL' ? `${range} is set to ${value}` : `${range} ${op.toLowerCase()} ${value}`;
  }
  return JSON.stringify(requirement);
}

function describeReward(reward, version) {
  let text = null;
  if (reward.species !== undefined) {
    const species = humanSpecies(reward.species);
    const shiny = reward.shiny === true || reward.shiny === 'TRUE';
    const custom = reward.custom_mon_id !== undefined && reward.custom_mon_id !== 'CUSTOM_MON_NONE';
    text = `${shiny ? 'Shiny ' : custom ? 'a special ' : ''}${species} (level 10)`;
  } else if (reward.item !== undefined) {
    const count = resolveCount(reward.count ?? '1');
    text = count === '1' ? humanItem(reward.item, version) : `${count}× ${humanItem(reward.item, version)}`;
  } else if (reward.shop_item !== undefined) {
    text = `Unlocks ${humanItem(reward.shop_item, version)} in the shop`;
  } else if (reward.money !== undefined) {
    text = humanMoney(reward.money);
  } else if (reward.quest !== undefined) {
    text = `Unlocks quest: ${reward.quest}`;
  } else if (reward.flag !== undefined) {
    text = reward.custom_popup
      ? `Unlocks ${reward.custom_popup.title} (${stripTextTags(reward.custom_popup.subtitle)})`
      : `Sets flag ${reward.flag}`;
  } else if (reward.hub_upgrade !== undefined) {
    text = reward.custom_popup
      ? `Unlocks ${reward.custom_popup.title} (${stripTextTags(reward.custom_popup.subtitle)})`
      : `Unlocks hub upgrade: ${humanizeSegments(reward.hub_upgrade.replace(/^HUB_UPGRADE_/, '').split('_'))}`;
  } else if (reward.decor !== undefined) {
    const tail = reward.decor.replace(/^DECOR_ID_/, '');
    text = `Unlocks home decor: ${DECOR_NAMES[tail] ?? humanizeSegments(tail.split('_'))}`;
  } else if (reward.decor_variant !== undefined) {
    text = `Unlocks home decor variant: ${humanizeSegments(String(reward.decor_variant).replace(/^DECOR_VARIANT_/, '').split('_'))}`;
  } else if (reward.outfit_unlock !== undefined) {
    text = reward.custom_popup
      ? `Unlocks outfit: ${reward.custom_popup.title}`
      : `Unlocks outfit: ${humanizeSegments(reward.outfit_unlock.replace(/^OUTFIT_UNLOCK_/, '').split('_'))}`;
  } else {
    fail(`Unrecognised reward object: ${JSON.stringify(reward)}`);
  }

  const notes = [];
  if (reward.visibility === 'OBSCURED') notes.push('shown as ??? in the quest log');
  if (reward.visibility === 'INVISIBLE') notes.push('hidden from the quest log');
  const difficulty = reward.difficulty ?? 'EASY';
  if (difficulty !== 'EASY') notes.push(`earned only when completed at ${humanDifficulty(difficulty)} difficulty or above`);
  if (notes.length > 0) text = `${text} (${notes.join(', ')})`;
  return text;
}

const FLAG_TEXT_MAP = [
  ['MAIN_QUEST_DEFAULT', 'Main quest'],
  ['CHALLENGE_DEFAULT', 'Challenge'],
  ['MON_MASTERY_DEFAULT', 'Mon mastery'],
  ['ACTIVE_IN_RUN', 'Active in runs'],
  ['ACTIVE_IN_HUB', 'Active in the hub'],
  ['ACTIVE_ALWAYS', 'Active in runs and hub'],
  ['UNLOCKED_BY_DEFAULT', 'Unlocked from the start'],
];

function humanFlags(flags) {
  return flags.map((flag) => {
    const known = FLAG_TEXT_MAP.find(([id]) => id === flag);
    if (known) return known[1];
    fail(`Unrecognised quest flag: ${JSON.stringify(flag)}`);
  });
}

// ---------------------------------------------------------------------------
// Merging + record building
// ---------------------------------------------------------------------------

function semanticView(entry, version) {
  return {
    description: entry.description.replaceAll('\\n', '\n'),
    displayGroup: entry.displayGroup,
    flags: humanFlags(entry.flags),
    trigger: describeTriggers(entry, version),
    rewards: entry.rewards.map((reward) => describeReward(reward, version)),
    requirements: entry.requirements.map((requirement) => describeRequirement(requirement, version)),
  };
}

function sourceCitation(entry, versions) {
  if (versions.includes('vanilla') && versions.includes('ex')) {
    return `${entry.sourceFile} @vanilla (identical @origin/expansion)`;
  }
  if (versions.includes('ex')) {
    return `${entry.sourceFile} @origin/expansion (quest gated by "#if defined(ROGUE_EXPANSION)")`;
  }
  return `${entry.sourceFile} @vanilla (quest gated by "#if !defined(ROGUE_EXPANSION)")`;
}

function buildMergedRecord(id, byBuild) {
  const versions = REFS.filter(({ version }) => byBuild[version] !== undefined).map(({ version }) => version);
  // EX is the focus of the docs: prefer its values for the shared fields.
  const primary = byBuild.ex ?? byBuild.vanilla;
  const primaryVersion = byBuild.ex !== undefined ? 'ex' : 'vanilla';
  const primaryView = semanticView(primary, primaryVersion);
  const record = {
    id,
    name: primary.name,
    description: primaryView.description,
    display_group: primary.displayGroup,
    flags: primaryView.flags,
    trigger: primaryView.trigger,
    rewards: primaryView.rewards,
    versions,
    source: sourceCitation(primary, versions),
  };
  if (primary.requirements.length > 0) record.requirements = primaryView.requirements;

  if (versions.length === 2) {
    const vanilla = semanticView(byBuild.vanilla, 'vanilla');
    const ex = semanticView(byBuild.ex, 'ex');
    // flags is not part of the per-version differences schema; fail loudly
    // rather than silently dropping a difference if the source grows one.
    if (JSON.stringify(vanilla.flags) !== JSON.stringify(ex.flags)) {
      fail(`flags differ between versions for ${id} — extend the differences schema before regenerating`);
    }
    // Structured per-version differences: one object per side holding ONLY the
    // record fields that differ, each value in the same humanized form as the
    // top-level field (strings for description/trigger/display_group, string
    // arrays for rewards/requirements).
    const differing = ['description', 'trigger', 'rewards', 'requirements', 'displayGroup'].filter(
      (key) => JSON.stringify(vanilla[key]) !== JSON.stringify(ex[key]),
    );
    if (differing.length > 0) {
      const pick = (view) => {
        const side = {};
        for (const key of differing) side[key === 'displayGroup' ? 'display_group' : key] = view[key];
        return side;
      };
      record.differences = { vanilla: pick(vanilla), ex: pick(ex) };
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Prose + meta (static, sourced from the loader + rogue_quest.c)
// ---------------------------------------------------------------------------

const META = {
  id: 'quests',
  title: 'Quests',
  description: 'Every quest in Pokémon Emerald Rogue — main quests, challenges and mon masteries — with plain-language triggers, rewards and Vanilla/EX availability.',
};

const PROSE = [
  {
    id: 'system',
    heading: 'A data-driven quest system',
    text: 'Every quest is defined in JSON, not code: src/data/rogue/quests.json pulls in 13 of the 14 files in src/data/rogue/quests/ via "includes" (template.json is included by nothing), and each file\'s top-level "defaults" object supplies shared fields (display group, flags, triggers) that individual quests override per-key. At build time the CustomJson tool (quests_c exporter in tools/Pokabbie/Build/CustomJson/QuestExporter.cpp) compiles all of it into one C table consumed by src/rogue_quest.c. The quest files are byte-identical between the two branches — the Vanilla/EX split is done with "#if defined(ROGUE_EXPANSION)" gates on individual quests and rewards, so 94 quests (plus several extra rewards on shared quests) exist only in EX. Names, descriptions and trigger parameters support %TEMPLATE% placeholders (e.g. every mon mastery is one template entry), and the quest log text keeps the game\'s {PKMN}/{POKEBLOCK} placeholders for "Pokémon"/"Pokéblock".',
  },
  {
    id: 'display-groups',
    heading: 'The nine display groups',
    text: 'The Quest Log groups quests into nine display groups, in this order: Final Quests, Starter Quests, Default Quests, Starter Challenges, Default Challenges, Evil Team Challenges, Region Challenges, Type Challenges and Mon Masteries. Each quest carries a display_group (usually inherited from its file\'s defaults; a few quests, like the "Final Run" in EX, sit in a different group per version). Only Type Challenges is sorted alphabetically in the in-game UI. Starter Challenges is defined in the source but currently holds no quests.',
  },
  {
    id: 'quest-classes',
    heading: 'Main quests, challenges and mon masteries',
    text: 'There are three quest classes. Main quests (IS_MAIN_QUEST) are one-shot story objectives — once completed they cannot be repeated. Challenges (IS_CHALLENGE) are repeatable: completing one at a higher difficulty unlocks that tier\'s additional rewards, and challenges stay hidden ("suppressed") until the challenges feature itself is unlocked. Mon masteries (IS_MON_MASTERY) track a species line automatically and keep progressing in the background even while suppressed. Each quest is ACTIVE_IN_RUN, ACTIVE_IN_HUB or both (ACTIVE_ALWAYS). A quest that is not handed over by another quest\'s reward is UNLOCKED_BY_DEFAULT (unlocked at new game); the rest chain off a "quest unlock" reward — e.g. "Post Game?" unlocks most of the challenge content.',
  },
  {
    id: 'triggers-rewards',
    heading: 'How triggers, requirements and rewards work',
    text: 'A quest completes or fails when a trigger event fires — run start/end, earning a badge, entering the Hall of Fame, catching a Pokémon, using a field item, a map event, a battle event — and the trigger\'s condition passes. Conditions check the current difficulty, party composition, config settings, Pokédex progress, money and more; each record\'s "trigger" field summarises them in plain language. Active quests can also carry requirements: the quest silently fails if one stops being met (e.g. a required item runs out or a setting changes). Rewards are difficulty-tiered: a reward marked HARD is only granted once the quest has been completed at Hard difficulty or above, which is why challenges are worth repeating. {PKMN} and {POKEBLOCK} in names/descriptions are the game\'s text placeholders for "Pokémon" and "Pokéblock".',
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function extractForRef(repo, ref) {
  assertRepoSane(repo, ref);
  const cache = new Map();
  const counter = { value: 0 };
  const groups = expandQuestGroups(repo, ref, MAIN_FILE, cache, counter);
  return gatherQuests(groups);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.isAbsolute(args.repo) ? args.repo : path.resolve(PROJECT_ROOT, args.repo);

  const targets = args.ref === null ? REFS : REFS.filter((entry) => entry.ref === args.ref);
  const rawByRef = {};
  const perRefStats = {};
  for (const target of targets) {
    const quests = extractForRef(repo, target.ref);
    const perFile = {};
    for (const quest of quests) perFile[quest.sourceFile] = (perFile[quest.sourceFile] ?? 0) + 1;
    perRefStats[target.ref] = { total: quests.length, perFile };
    rawByRef[target.version] = buildForRef(target, quests);
  }

  // Merge by quest id; final ordering is imposed by the sort below.
  const byId = new Map();
  const pushEntry = (entry, version) => {
    if (!byId.has(entry.id)) byId.set(entry.id, {});
    byId.get(entry.id)[version] = entry;
  };
  for (const target of REFS) {
    if (rawByRef[target.version]) for (const entry of rawByRef[target.version]) pushEntry(entry, target.version);
  }

  const displayGroups = (() => {
    const main = JSON.parse(readRefFile(repo, targets[0].ref, MAIN_FILE));
    return (main.display_groups ?? []).map((group) => ({
      id: group.id,
      sort_alphabetically: Boolean(group.sort_alphabetically),
    }));
  })();
  const groupOrder = new Map(displayGroups.map((group, index) => [group.id, index]));

  const records = [...byId.entries()]
    .map(([id, byBuild]) => buildMergedRecord(id, byBuild))
    .sort((a, b) => {
      const ga = groupOrder.get(a.display_group) ?? 99;
      const gb = groupOrder.get(b.display_group) ?? 99;
      if (ga !== gb) return ga - gb;
      // plain code-unit compare for deterministic, locale-independent ordering
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  // Validation
  const knownGroups = new Set(displayGroups.map((group) => group.id));
  const seenIds = new Set();
  for (const record of records) {
    if (seenIds.has(record.id)) fail(`Duplicate quest id: ${record.id}`);
    seenIds.add(record.id);
    if (!knownGroups.has(record.display_group)) fail(`Unknown display group ${JSON.stringify(record.display_group)} for ${record.id}`);
    if (record.versions.length === 0) fail(`No versions for ${record.id}`);
  }

  const output = { meta: META, prose: PROSE, display_groups: displayGroups, records };
  const rendered = `${JSON.stringify(output, null, 2)}\n`;

  const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(PROJECT_ROOT, args.out);
  if (args.check) {
    const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
    if (existing !== rendered) {
      fail(`--check: ${outPath} is out of date (re-run without --check to regenerate)`);
    }
    console.log(`check ok — ${outPath} matches generated output (${records.length} records)`);
    return;
  }

  // Write (only when changed, so re-runs are idempotent) and report the summary.
  const previous = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (previous !== rendered) {
    writeFileSync(outPath, rendered, 'utf8');
    console.log(`wrote ${outPath}`);
  } else {
    console.log(`${outPath} unchanged (idempotent re-run)`);
  }

  // Summary: raw object counts per ref/file, merged record counts per group/version.
  for (const target of targets) {
    const stats = perRefStats[target.ref];
    console.log(`\n[${target.ref}] ${stats.total} raw quest objects (compiled: ${rawByRef[target.version].length})`);
    for (const [file, count] of Object.entries(stats.perFile)) console.log(`  ${count.toString().padStart(4)}  ${file}`);
  }
  const byGroup = {};
  const byVersion = { vanilla: 0, ex: 0 };
  let both = 0;
  for (const record of records) {
    byGroup[record.display_group] = (byGroup[record.display_group] ?? 0) + 1;
    if (record.versions.includes('vanilla')) byVersion.vanilla += 1;
    if (record.versions.includes('ex')) byVersion.ex += 1;
    if (record.versions.length === 2) both += 1;
  }
  console.log(`\nmerged: ${records.length} records — in both versions: ${both}, EX-only: ${byVersion.ex - both}, Vanilla-only: ${byVersion.vanilla - both}`);
  console.log('per display group:');
  for (const group of displayGroups) {
    console.log(`  ${(byGroup[group.id] ?? 0).toString().padStart(4)}  ${group.id}`);
  }
}

main();

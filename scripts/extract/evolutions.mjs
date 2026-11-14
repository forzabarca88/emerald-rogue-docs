// Shared evolution machinery for the zero-dep extractors (issue #97).
//
// The in-game Pokédex does NOT show the raw evolution table: every entry is
// run through `Rogue_ModifyEvolution` (src/rogue_baked.c — byte-identical in
// both branches; the Vanilla/EX split is the #ifdef ROGUE_EXPANSION blocks
// inside it), which rewrites method/param/target (friendship -> level 30,
// trade -> Link Cable item, the Alola/Galar/Hisui artefacts, per-species
// overrides, ...). `modifyEvolution` mirrors that function line-for-line so
// the site's evo data matches what the game displays.
//
// pokedex.mjs uses this module to emit the per-record/form { prev?, evos? }
// shape; sprites.mjs runs the SAME port over the raw species tables purely
// to know which form entries evolutions reference (evoLinks) so their
// sprites ship (exEvoRosters — the single source of that rule, also
// re-derived by the sprite-forms drift test from the game source).

import { Preprocessor, seedDefines, collectEnums, resolveConst } from './preprocessor.mjs';
import { collectMacros, expandBody, sliceEntries, stripComments } from './sprite-forms.mjs';

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// The build's command-line defines (Makefile CPPFLAGS for the default
// release build), applied before any header is read.
export const EX_BUILD_SEEDS = [
  ['MODERN', 1],
  ['TESTING', 0],
  ['ROGUE_EXPANSION', 1],
  ['ROGUE_RELEASE', 1],
];
export const VAN_BUILD_SEEDS = [
  ['MODERN', 1],
  ['ROGUE_RELEASE', 1],
];

// The headers that seed the EX preprocessor with the constants the species
// tables and their evolution rewrites resolve (include roots mirror the
// build's `-iquote include -iquote gflib`).
export const EX_CONSTANT_HEADERS = [
  'include/config.h',
  'include/config/pokemon.h',
  'include/config/species_enabled.h',
  'include/config/battle.h',
  'include/config/item.h',
  'include/config/overworld.h',
  'include/constants/battle.h',
  'include/constants/pokemon.h',
  'include/constants/species.h',
  'include/constants/abilities.h',
  'include/constants/moves.h',
  'include/constants/items.h',
  'include/constants/maps.h',
  'include/constants/region_map_sections.h',
  'include/constants/pokedex.h',
  'include/constants/rogue_pokedex.h',
  'include/constants/rogue.h', // the ITEM_* rogue items the evolution rewrite names (Link Cable, the artefacts)
  'include/global.h', // COMPOUND_STRING, min/max & friends used by the species data
];

/**
 * ITEM_ const-tail -> value for the items the evolution rewrite names
 * (Rogue_ModifyEvolution rewrites methods to EVO_ITEM + these items). The
 * regular items live in include/constants/items.h, the rogue items (the Link
 * Cable and the Alola/Galar/Hisui artefacts) in include/constants/rogue.h —
 * both as plain `#define ITEM_X <expr>` lines.
 */
export function parseItemValues(pp, where) {
  const out = new Map();
  for (const file of ['include/constants/items.h', 'include/constants/rogue.h']) {
    for (const line of pp.provider.fetch(file).split('\n')) {
      const cm = /^\s*#define\s+ITEM_([A-Z0-9_]+)\s+(.+?)\s*(\/\/.*)?$/.exec(line);
      if (!cm) continue;
      let value;
      try { value = pp.evalExpr(cm[2], `${where} ${cm[1]}`); } catch { continue; }
      if (!out.has(cm[1])) out.set(cm[1], value);
    }
  }
  return out;
}

// Per-branch resolved EVO_* constants. The two branches assign DIFFERENT
// numbers to several methods (EVO_LEVEL 4 in both, but e.g. EVO_ITEM 27 in
// EX vs 7 in Vanilla), so the constants come from each branch's own
// include/constants/pokemon.h, never shared.
export const makeEvoConsts = (branch, pp, where) => {
  const v = (n) => pp.evalExpr(n, `${where} ${n}`);
  const C = {
    EVO_NONE: 0xfffe, // not a #define in Vanilla's header, but the same sentinel the rewrite writes
    EVO_ITEM: v('EVO_ITEM'),
    EVO_LEVEL: v('EVO_LEVEL'),
    EVO_LEVEL_MALE: v('EVO_LEVEL_MALE'),
    EVO_LEVEL_FEMALE: v('EVO_LEVEL_FEMALE'),
    EVO_MOVE: v('EVO_MOVE'),
    EVO_BEAUTY: v('EVO_BEAUTY'),
    EVO_FRIENDSHIP: v('EVO_FRIENDSHIP'),
    EVO_TRADE: v('EVO_TRADE'),
    EVO_LEVEL_ITEM: v('EVO_LEVEL_ITEM'),
    EVO_ITEM_HOLD_DAY: v('EVO_ITEM_HOLD_DAY'),
    EVO_ITEM_HOLD_NIGHT: v('EVO_ITEM_HOLD_NIGHT'),
    EVO_FRIENDSHIP_DAY: v('EVO_FRIENDSHIP_DAY'),
    EVO_FRIENDSHIP_NIGHT: v('EVO_FRIENDSHIP_NIGHT'),
    EVO_LEVEL_DAY: v('EVO_LEVEL_DAY'),
    EVO_LEVEL_NIGHT: v('EVO_LEVEL_NIGHT'),
    EVO_TRADE_ITEM: v('EVO_TRADE_ITEM'),
  };
  if (branch === 'ex') {
    C.EVO_LEVEL_30_NATURE = v('EVO_LEVEL_30_NATURE');
    C.EVO_MOVE_TYPE = v('EVO_MOVE_TYPE');
    C.EVO_MOVE_TWO_SEGMENT = v('EVO_MOVE_TWO_SEGMENT');
    C.EVO_MOVE_THREE_SEGMENT = v('EVO_MOVE_THREE_SEGMENT');
    C.EVO_LEVEL_TWO_SEGMENT = v('EVO_LEVEL_TWO_SEGMENT');
    C.EVO_LEVEL_THREE_SEGMENT = v('EVO_LEVEL_THREE_SEGMENT');
    C.EVO_SPECIFIC_MON_IN_PARTY = v('EVO_SPECIFIC_MON_IN_PARTY');
    C.EVO_CRITICAL_HITS = v('EVO_CRITICAL_HITS');
    C.EVO_SCRIPT_TRIGGER_DMG = v('EVO_SCRIPT_TRIGGER_DMG');
    C.EVO_WATER_SCROLL = v('EVO_WATER_SCROLL');
    C.EVO_DARK_SCROLL = v('EVO_DARK_SCROLL');
    C.EVO_TRADE_SPECIFIC_MON = v('EVO_TRADE_SPECIFIC_MON');
    C.EVO_LEVEL_RAIN = v('EVO_LEVEL_RAIN');
    C.EVO_LEVEL_DARK_TYPE_MON_IN_PARTY = v('EVO_LEVEL_DARK_TYPE_MON_IN_PARTY');
    C.EVO_FRIENDSHIP_MOVE_TYPE = v('EVO_FRIENDSHIP_MOVE_TYPE');
    C.EVO_SPECIFIC_MAP = v('EVO_SPECIFIC_MAP');
    C.EVO_ITEM_NIGHT = v('EVO_ITEM_NIGHT');
    C.EVO_ITEM_DAY = v('EVO_ITEM_DAY');
    C.EVO_MAPSEC = v('EVO_MAPSEC');
  }
  return C;
};

/**
 * Port of `Rogue_ModifyEvolution` (src/rogue_baked.c L377-704). Reads the
 * raw { method, param, target } tuple at `evoIdx` for the species whose
 * value is `speciesValue`, applies the per-species overrides, the
 * Milcery block, the ModifyKnowMoveEvo profile check and the method
 * switch, and returns the rewritten tuple (the raw one untouched).
 *
 * `ctx` is branch-scoped: the resolved EVO_* constants, the
 * SPECIES_NONE value, species/item/nature value lookups,
 * GET_BASE_SPECIES_ID for the Rockruff/Cosmoem time-of-day exception,
 * and the species' level-up learnset profile (what ModifyKnowMoveEvo
 * reads via Rogue_GetPokemonProfile).
 *
 * The run-scoped "invalid evolution" check (L497-504) needs live run
 * state (Rogue_IsRunActive + Pokédex-variant membership) and can never
 * fire in the documented out-of-run state — deliberately not ported.
 */
export function modifyEvolution(branch, ctx, speciesValue, evoIdx, evo) {
  const isEx = branch === 'ex';
  const C = ctx.evoConsts;
  const S = (tail) => ctx.species(tail);
  const I = (tail) => ctx.item(tail);
  const out = { method: evo.method, param: evo.param, target: evo.target };

  // "Any species alterations." (L383-388)
  if (speciesValue === S('AZURILL') && evoIdx === 0) {
    out.method = C.EVO_LEVEL;
    out.param = 10;
  }

  // #ifdef ROGUE_EXPANSION (L390-575)
  if (isEx) {
    // Yamask-Galarian: the level evolution to Ronogar
    if (speciesValue === S('YAMASK_GALARIAN') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 34;
    }
    if (speciesValue === S('MELTAN') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('METAL_COAT');
    }
    if (speciesValue === S('SLIGGOO') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
    }
    if ((speciesValue === S('SLIGGOO') || speciesValue === S('SLIGGOO_HISUIAN')) && evoIdx === 1) {
      out.target = ctx.none;
      out.method = C.EVO_NONE;
    }
    if (speciesValue === S('KUBFU') && (evoIdx === 1 || evoIdx === 3)) {
      out.target = ctx.none;
      out.method = C.EVO_NONE;
    }
    if (speciesValue === S('BASCULIN_WHITE_STRIPED')) {
      // Basculin White evolves into Basculion based on gender
      if (evoIdx === 0) {
        out.target = S('BASCULEGION_MALE');
        out.method = C.EVO_LEVEL_MALE;
        out.param = 36;
      } else if (evoIdx === 1) {
        out.target = S('BASCULEGION_FEMALE');
        out.method = C.EVO_LEVEL_FEMALE;
        out.param = 36;
      }
    }
    // Alolan evolutions
    if (
      (speciesValue === S('PIKACHU') && evoIdx === 1) ||
      (speciesValue === S('EXEGGCUTE') && evoIdx === 1) ||
      (speciesValue === S('CUBONE') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('ALOLA_STONE');
    }
    // Galar evolutions
    if (
      (speciesValue === S('KOFFING') && evoIdx === 1) ||
      (speciesValue === S('MIME_JR') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('GALAR_STONE');
    }
    // Hisui evolutions
    if (
      (speciesValue === S('QUILAVA') && evoIdx === 1) ||
      (speciesValue === S('DEWOTT') && evoIdx === 1) ||
      (speciesValue === S('PETILIL') && evoIdx === 1) ||
      (speciesValue === S('RUFFLET') && evoIdx === 1) ||
      (speciesValue === S('GOOMY') && evoIdx === 1) ||
      (speciesValue === S('BERGMITE') && evoIdx === 1) ||
      (speciesValue === S('DARTRIX') && evoIdx === 1)
    ) {
      out.method = C.EVO_ITEM;
      out.param = I('HISUI_STONE');
    }
    if (speciesValue === S('URSARING') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('PEAT_BLOCK');
    }
    if (speciesValue === S('URSARING') && evoIdx === 1) {
      out.method = C.EVO_ITEM;
      out.param = I('MOON_STONE');
    }
    if (speciesValue === S('BISHARP') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('LEADERS_CREST');
    }
    // Walk evolutions
    if (speciesValue === S('PAWMO') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('BRAMBLIN') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('RELLOR') && evoIdx === 0) {
      out.method = C.EVO_LEVEL;
      out.param = 20;
    }
    if (speciesValue === S('GIMMIGHOUL') && evoIdx === 0) {
      out.method = C.EVO_ITEM;
      out.param = I('GIMMIGHOUL_COIN');
    }
  }

  // (The ROGUE_IsRunActive "invalid evolution" check — see the header note.)

  if (out.target !== ctx.none) {
    if (isEx && speciesValue === S('MILCERY')) {
      if (evoIdx === 0) {
        // Default form for neutral natures
        out.method = C.EVO_LEVEL;
        out.target = S('ALCREMIE_STRAWBERRY');
        out.param = 30;
      } else {
        const supportedForms = ['ALCREMIE_BERRY', 'ALCREMIE_LOVE', 'ALCREMIE_STAR', 'ALCREMIE_CLOVER', 'ALCREMIE_FLOWER', 'ALCREMIE_RIBBON'].map(S);
        const supportedNatures = ['ADAMANT', 'LAX', 'MODEST', 'GENTLE', 'TIMID', 'JOLLY'].map((n) => ctx.nature(n));
        if (evoIdx - 1 >= supportedNatures.length) {
          out.method = C.EVO_NONE;
          out.target = ctx.none;
        } else {
          out.method = C.EVO_LEVEL_30_NATURE;
          out.target = supportedForms[evoIdx - 1];
          out.param = supportedNatures[evoIdx - 1];
        }
      }
    }

    // ModifyKnowMoveEvo (L354-376): the species' level-up list (the
    // "assume this was a tutor move" part — the profile's tutor list — is
    // never used by any evolution, so only the level-up loop is ported),
    // then the EVO_MOVE fallback.
    const levelUp = ctx.profileLevelUp(speciesValue);
    const knowMove = (fromMethod, toMethod) => {
      if (out.method !== fromMethod) return;
      if (levelUp) {
        for (const [mv, lvl] of levelUp) {
          if (mv === out.param) {
            out.method = toMethod;
            out.param = Math.max(38, lvl);
            break;
          }
        }
      }
      if (out.method === fromMethod && fromMethod === C.EVO_MOVE) {
        out.method = toMethod;
        out.param = 30;
      }
    };
    knowMove(C.EVO_MOVE, C.EVO_LEVEL);
    if (isEx) {
      knowMove(C.EVO_MOVE_TWO_SEGMENT, C.EVO_LEVEL_TWO_SEGMENT);
      knowMove(C.EVO_MOVE_THREE_SEGMENT, C.EVO_LEVEL_THREE_SEGMENT);
    }

    // The method switch (L581-703) — ported as an if-chain; every C case
    // has a distinct value in both branches, so the semantics match.
    if (out.method === C.EVO_ITEM) {
      if (isEx && out.param === ctx.item('LINKING_CORD')) {
        // Already have a different evolution via the link cable
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      }
    } else if (out.method === C.EVO_BEAUTY) {
      if (isEx) {
        // Uses the prism scale evolution
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else {
        // Make it a level evolution
        out.method = C.EVO_LEVEL;
        out.param = 36;
      }
    } else if (out.method === C.EVO_FRIENDSHIP) {
      out.method = C.EVO_LEVEL;
      out.param = 30;
    } else if (out.method === C.EVO_TRADE) {
      out.method = C.EVO_ITEM;
      out.param = I('LINK_CABLE');
    } else if (out.method === C.EVO_LEVEL_ITEM || out.method === C.EVO_ITEM_HOLD_DAY || out.method === C.EVO_ITEM_HOLD_NIGHT) {
      out.method = C.EVO_ITEM;
    } else if (out.method === C.EVO_FRIENDSHIP_DAY) {
      if (speciesValue === S('EEVEE')) {
        out.method = C.EVO_ITEM;
        out.param = I('SUN_STONE');
      } else {
        out.method = C.EVO_LEVEL;
        out.param = 30;
      }
    } else if (out.method === C.EVO_FRIENDSHIP_NIGHT) {
      if (speciesValue === S('EEVEE')) {
        out.method = C.EVO_ITEM;
        out.param = I('MOON_STONE');
      } else {
        out.method = C.EVO_LEVEL;
        out.param = 30;
      }
    } else if (out.method === C.EVO_LEVEL_DAY || out.method === C.EVO_LEVEL_NIGHT) {
      if (isEx) {
        // Rockruff & Cosmoem are the only species that still have time-based evolutions
        if (speciesValue !== ctx.baseSpecies('ROCKRUFF') && speciesValue !== ctx.baseSpecies('COSMOEM')) {
          out.method = C.EVO_LEVEL;
        }
      } else {
        out.method = C.EVO_LEVEL;
      }
    } else if (out.method === C.EVO_TRADE_ITEM) {
      if (isEx) {
        // These methods are no longer needed since Emerald Expansion has use-item by default
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else {
        out.method = C.EVO_ITEM;
      }
    } else if (isEx) {
      if (out.method === C.EVO_SPECIFIC_MON_IN_PARTY || out.method === C.EVO_CRITICAL_HITS || out.method === C.EVO_SCRIPT_TRIGGER_DMG) {
        out.method = C.EVO_LEVEL;
        out.param = 36;
      } else if (out.method === C.EVO_WATER_SCROLL) {
        out.method = C.EVO_ITEM;
        out.param = I('WATER_STONE');
      } else if (out.method === C.EVO_DARK_SCROLL) {
        out.method = C.EVO_ITEM;
        out.param = I('MOON_STONE');
      } else if (out.method === C.EVO_TRADE_SPECIFIC_MON) {
        out.method = C.EVO_ITEM;
        out.param = I('LINK_CABLE');
      } else if (out.method === C.EVO_LEVEL_RAIN || out.method === C.EVO_LEVEL_DARK_TYPE_MON_IN_PARTY) {
        out.method = C.EVO_LEVEL;
      } else if (out.method === C.EVO_FRIENDSHIP_MOVE_TYPE) {
        out.method = C.EVO_MOVE_TYPE;
      } else if (out.method === C.EVO_SPECIFIC_MAP || out.method === C.EVO_ITEM_NIGHT || out.method === C.EVO_ITEM_DAY) {
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      } else if (out.method === C.EVO_MAPSEC) {
        out.method = C.EVO_NONE;
        out.target = ctx.none;
      }
    }
  }

  return out;
}

/**
 * The in-game evolution display list for one entry: run every raw tuple
 * through modifyEvolution, drop the SPECIES_NONE targets and the 0xfffe
 * sentinels (EVO_NONE — "not an actual evolution"), and cap at 8
 * (GetEvolutionName only shows displayCount < 8).
 */
export function buildEvoDisplayList(branch, ctx, speciesValue, rawList) {
  // GetMaxEvolutionCount: the loop never runs on an empty table, so the
  // per-species overrides can't fire for it either
  if (rawList.length === 0) return [];
  const survivors = [];
  for (let i = 0; i < rawList.length; i++) {
    const evo = modifyEvolution(branch, ctx, speciesValue, i, rawList[i]);
    if (evo.target === ctx.none || evo.method === 0xfffe) continue;
    survivors.push(evo);
    if (survivors.length >= 8) break;
  }
  return survivors;
}

export const parseEvoTuples = (pp, blocks, where, terminator) => {
  const out = [];
  for (const block of blocks) {
    const body = block.replace(/^\{/, '').replace(/\}$/, '').trim();
    const parts = body.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) fail(`${where}: expected 3 evolution fields: ${body.slice(0, 60)}`);
    const method = pp.evalExpr(parts[0], where);
    if (method === terminator) continue; // the table's end marker (0xffff EX / 0 Vanilla)
    out.push({ method, param: pp.evalExpr(parts[1], where), target: pp.evalExpr(parts[2], where) });
  }
  return out;
};

/**
 * The raw evolution tuples of one fully macro-expanded species-table entry
 * body (`.evolutions = EVOLUTION({...}, ...)` — absent → []). Shared by the
 * sprite extractor, which expands its entries through sprite-forms.mjs's
 * expandBody rather than the pokedex extractor's preprocessor walk. The
 * closing paren is found by depth: no other parens survive expansion inside
 * the EVOLUTION block (plain constants), but the scan stays exact.
 */
export function evoTuplesOfBody(pp, expandedBody, where, terminator) {
  const m = /\.evolutions\s*=\s*EVOLUTION\(/.exec(expandedBody);
  if (!m) return [];
  let depth = 0;
  let end = -1;
  for (let p = m.index + m[0].length - 1; p < expandedBody.length; p++) {
    const c = expandedBody[p];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end < 0) fail(`${where}: unbalanced parens in .evolutions EVOLUTION block`);
  const inner = expandedBody.slice(m.index + m[0].length, end);
  const blocks = [];
  let d = 0;
  let start = -1;
  for (let p = 0; p < inner.length; p++) {
    const c = inner[p];
    if (c === '{') { if (d === 0) start = p; d++; }
    else if (c === '}') { d--; if (d === 0) blocks.push(inner.slice(start, p + 1)); }
  }
  if (d !== 0) fail(`${where}: unbalanced braces in .evolutions EVOLUTION block`);
  return parseEvoTuples(pp, blocks, where, terminator);
}

// ---------------------------------------------------------------------------
// Evolution references (shared by the pokedex and sprite extractors)
// ---------------------------------------------------------------------------

/**
 * Which form entries do the in-game evolution lists reference — the
 * single source of the evo-driven roster extension.
 *
 * Given the post-rewrite display lists (see buildEvoDisplayList) for every
 * species entry, this reports, per surviving branch, WHICH id names the
 * branch's target (the form name the Pokédex implies: "Hisuian
 * Typhlosion", "Basculegion (Male)", ...), and per record/form, which
 * record/form is its in-game `prev` (the lowest-dex-number source whose
 * list targets it, a record beating a form at equal dex number). Every
 * form entry that appears as a branch target or as a prev source must
 * ride in its record's form roster for the site to document it (and for
 * the sprite extractor to ship <formEntryId>.png).
 *
 * Inputs (all deterministic, all derivable from the game's species data):
 * - entries:    Map entryId -> { id, value, baseId, dexNum, isRecord }
 * - lists:      Map entryId -> post-rewrite branches [{ id, method, target }]
 * - recordOf:   (speciesValue) -> the record id that value resolves to
 * - idsByValue: Map speciesValue -> every species id holding that value,
 *               in include/constants/species.h order
 * - baseRosterOf: (recordId) -> the record's form roster WITHOUT any
 *               evo-driven additions (the profile/form-table roster)
 *
 * Returns:
 * - evoFormOf:  Map `${entryId}\u0000${branchIdx}` -> the id that names the
 *               branch target (null when the target is the target record's
 *               own value — the in-game display shows the record name)
 * - prevOf:     Map selfId (record or roster form id) ->
 *               { id, srcId, method, isForm } | null (id = the source's
 *               record id, the deep-link target)
 * - refs:       Map recordId -> sorted form-entry ids its evolutions
 *               reference that the base roster lacks
 */
export function evoLinks({ entries, lists, recordOf, idsByValue, baseRosterOf, label = 'evoLinks' }) {
  const added = new Map(); // recordId -> Set(formEntryId)
  const addRef = (rec, fid) => {
    if (!added.has(rec)) added.set(rec, new Set());
    added.get(rec).add(fid);
  };
  const isFormEntry = (id) => entries.has(id) && entries.get(id).baseId !== id;
  // A prev source is a FORM for naming/roster purposes only when its value
  // differs from its record's own value — an alias-base species (SPECIES_X
  // #defined to a form value, e.g. SPECIES_BURMY = SPECIES_BURMY_PLANT_CLOAK)
  // has its record's initializer under the form's id, and the in-game name
  // at that value is the record's name, not a form's.
  const srcIsForm = (id) =>
    isFormEntry(id) && entries.get(id).value !== entries.get(entries.get(id).baseId).value;
  const rosterOf = (rec) => {
    const s = new Set(baseRosterOf(rec) ?? []);
    const a = added.get(rec);
    if (a) for (const f of a) s.add(f);
    return s;
  };

  // The id that names a branch target: the in-game Pokédex shows the
  // TARGET species' entry name. When the target value IS the target
  // record's own value (the base form's value, shared with its aliases),
  // that is the record name — no form. Otherwise it is the form name,
  // taken from the TARGET record's documented roster when it already
  // carries an id for the value (that is the name the site shows for the
  // form), else the first form entry in species.h order — which then
  // joins the TARGET record's roster (and its sprite ships).
  const evoFormOf = new Map();
  for (const [sid, list] of lists) {
    list.forEach((e, idx) => {
      const targetRec = recordOf(e.target);
      if (targetRec !== undefined && entries.get(targetRec)?.value === e.target) {
        evoFormOf.set(`${sid}\u0000${idx}`, null);
        return;
      }
      const group = (idsByValue.get(e.target) ?? []).filter((g) => g !== targetRec);
      const targetRoster = rosterOf(targetRec);
      const pick = group.find((c) => targetRoster.has(c)) ?? group.find((c) => isFormEntry(c)) ?? group[0] ?? null;
      if (pick === null) fail(`${label}: ${sid} branch ${idx} targets value ${e.target} no id holds`);
      if (isFormEntry(pick)) addRef(targetRec, pick);
      evoFormOf.set(`${sid}\u0000${idx}`, pick);
    });
  }

  // prev: the [dexNum, isForm]-minimum source whose list targets self.
  // Records match by id (a record's value group includes its forms —
  // matching by value would false-positive on the form tables); forms by
  // their own species value. The self's own list never counts. A form
  // source joins its record's roster, and the newly rostered form itself
  // becomes a prev target (e.g. Alolan Meowth's prev = Meowth), so the
  // pass runs to a fixpoint (monotone: rosters only grow).
  const selfsOf = () => {
    const selfs = [];
    for (const [id, meta] of entries) {
      if (!meta.isRecord) continue;
      selfs.push({ id, value: meta.value, isForm: false });
      for (const f of rosterOf(id)) if (entries.has(f)) selfs.push({ id: f, value: entries.get(f).value, isForm: true });
    }
    return selfs;
  };
  let selfs = selfsOf();
  let prevOf = new Map();
  for (let iter = 0; iter < 100; iter++) {
    const countRefs = () => [...added.values()].reduce((n, set) => n + set.size, 0);
    const before = countRefs();
    const next = new Map();
    for (const self of selfs) {
      let best = null;
      for (const [sid, list] of lists) {
        if (sid === self.id) continue;
        const smeta = entries.get(sid);
        const hit = self.isForm ? list.find((e) => e.target === self.value) : list.find((e) => e.id === self.id);
        if (!hit) continue;
        const key = [smeta.dexNum, srcIsForm(sid) ? 1 : 0];
        if (!best || key[0] < best[0] || (key[0] === best[0] && key[1] < best[1])) {
          best = [key[0], key[1], smeta.baseId, sid, hit.method, srcIsForm(sid)];
        }
      }
      if (best) {
        next.set(self.id, { id: best[2], srcId: best[3], method: best[4], isForm: best[5] });
        if (best[5]) addRef(best[2], best[3]);
      }
    }
    const grown = countRefs() !== before;
    const same = next.size === prevOf.size && [...next].every(([k, v]) => {
      const o = prevOf.get(k);
      return o && o.id === v.id && o.srcId === v.srcId && o.method === v.method && o.isForm === v.isForm;
    });
    prevOf = next;
    if (!grown && same) break;
    if (iter === 99) fail(`${label}: prev fixpoint did not settle`);
    if (grown) selfs = selfsOf();
  }

  const refs = new Map();
  for (const [rec, set] of added) {
    const base = new Set(baseRosterOf(rec) ?? []);
    const extra = [...set].filter((f) => !base.has(f)).sort();
    if (extra.length > 0) refs.set(rec, extra);
  }
  return { evoFormOf, prevOf, refs };
}

// ---------------------------------------------------------------------------
// exEvoRosters — the evolution-driven form-roster additions
// ---------------------------------------------------------------------------
//
// The in-game Pokédex displays form-targeted evolution branches (the
// Alola/Galar/Hisui stone species, Milcery's cream forms, Basculin White's
// gender branches, ...) and its "evolves from" (prev) scan covers the
// dex-less form slots (Galarian Yamask → Runerigus, Galarian Meowth →
// Perrserker, ...). This re-runs the shared port above (the same
// Rogue_ModifyEvolution rewrite pokedex.mjs runs) over the raw EX species
// tables, and the shared evoLinks pass reports the form ids those
// post-rewrite lists reference. Those forms join their record's form roster
// (the identical refs pokedex.mjs applies), so their <formEntryId>.png
// files ship for the site to document them.
//
// @param {object} provider       { fetch(path), has(path) } over origin/expansion
// @param {string[]} genTableTexts  the nine EX species_info/gen_1..9.h texts —
//                                  the pokedex extractor's entry domain
//                                  (NOT species_info.h: its egg/placeholder
//                                  entries are outside the pokedex domain)
// @param {object} baseDomain     a formRosterDomain() result (records,
//                                  rosters, entryFormTable, donorOf,
//                                  formTables, dexValue, referenced)
// @param {object} profiles       { species: Map, levelUp: Map } — the
//                                  expansion-profile Species and LevelUpMoves
// @returns {Map<string, string[]>} record id → extra form ids
export function exEvoRosters({ provider, genTableTexts, baseDomain, profiles }) {
  const exEnums = new Map();
  const exPp = new Preprocessor({ provider, defines: seedDefines(EX_BUILD_SEEDS), enums: exEnums, includeRoots: ['include', 'src', 'gflib'], label: 'expansion (evolution references)' });
  for (const f of EX_CONSTANT_HEADERS) {
    collectEnums(exPp.process(f, 'output'), `enum ${f}`, exEnums);
  }

  // species id -> SPECIES_ value (the canonical species table straight from
  // include/constants/species.h — the same source the pokedex extractor
  // reads, rogue aliases in include/constants/rogue.h excluded)
  const idByValue = new Map();
  for (const line of provider.fetch('include/constants/species.h').split(/\r?\n/)) {
    const m = /^#define\s+(SPECIES_[A-Z0-9_]+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    if (m[2].trim().startsWith('{')) continue; // not an expression (unexpected)
    if (m[1] === 'SPECIES_EGG') continue;
    const value = exPp.evalExpr(m[2], `species ${m[1]}`);
    if (value === 0) continue; // SPECIES_NONE
    idByValue.set(m[1].slice('SPECIES_'.length).toLowerCase(), value);
  }
  if (idByValue.size < 1500) fail(`expansion species.h parsed ${idByValue.size} species values (expected ~1505+)`);
  const idsByValue = new Map(); // value -> every id holding it, in species.h order
  for (const [id, value] of idByValue) {
    if (!idsByValue.has(value)) idsByValue.set(value, []);
    idsByValue.get(value).push(id);
  }

  // macro-expanded entry bodies (the shared slice/expand machinery the
  // manifest and rosters already rely on) — parsed before the value maps
  // below, which need the dex-less form ids
  const expandedBodies = new Map();
  for (const txt of genTableTexts) {
    const clean = stripComments(txt);
    const macros = collectMacros([clean]);
    for (const e of sliceEntries(clean)) {
      const id = e.id.toLowerCase();
      if (id === 'none') continue; // the zero-filled SPECIES_NONE slot
      if (expandedBodies.has(id)) fail(`evo rosters: duplicate entry [SPECIES_${e.id}]`);
      expandedBodies.set(id, expandBody(e.body, macros));
    }
  }

  // Family bases — the EXACT algorithm the pokedex extractor uses
  // (exFamilyBase): the first record (national-dex order) whose own — or,
  // for a synthesized base, its donor's — form table is T, else the table's
  // first parsed member. A record's / form's baseId is that family base
  // when it has a form table, itself otherwise.
  const entryFormTableOf = (id) => baseDomain.entryFormTable.get(id)
    ?? (baseDomain.donorOf.has(id) ? baseDomain.entryFormTable.get(baseDomain.donorOf.get(id)) : undefined);
  const exFamilyBaseOf = new Map(); // form table -> base id
  for (const rec of baseDomain.records) {
    const t = entryFormTableOf(rec);
    if (t && !exFamilyBaseOf.has(t)) exFamilyBaseOf.set(t, rec);
  }
  for (const [table, ids] of baseDomain.formTables) {
    if (!exFamilyBaseOf.has(table)) exFamilyBaseOf.set(table, ids[0] ?? null);
  }
  const baseIdOf = (id) => {
    const t = entryFormTableOf(id);
    return t ? (exFamilyBaseOf.get(t) ?? id) : id;
  };

  // record id per species value — the same rule the pokedex extractor uses
  // (exCtx.recordIdByValue): a family-base record owns its value, and every
  // dex-less form's value resolves to its family's base; first put wins
  const recordsSet = new Set(baseDomain.records);
  const recordIdByValue = new Map();
  const putRecord = (v, id) => { if (v !== undefined && !recordIdByValue.has(v)) recordIdByValue.set(v, id); };
  for (const rec of baseDomain.records) {
    if (baseIdOf(rec) === rec) putRecord(idByValue.get(rec), rec);
  }
  for (const id of expandedBodies.keys()) {
    if (recordsSet.has(id)) continue;
    putRecord(idByValue.get(id), baseIdOf(id));
  }

  // the evo-rewrite context (the same shape pokedex.mjs feeds the port):
  // species/item/nature values, the SPECIES_NONE sentinel, and each
  // species' level-up list for the ModifyKnowMoveEvo profile check
  const itemValues = parseItemValues(exPp, 'evo roster items');
  const evoCtx = {
    evoConsts: makeEvoConsts('ex', exPp, 'evo roster constants'),
    none: resolveConst(exPp, 'SPECIES_NONE', 'SPECIES_NONE'),
    species: (tail) => idByValue.get(tail.toLowerCase()) ?? fail(`evo rosters: unknown species ${tail}`),
    baseSpecies: (tail) => idByValue.get(tail.toLowerCase()) ?? fail(`evo rosters: unknown species ${tail}`),
    item: (tail) => itemValues.get(tail) ?? fail(`evo rosters: unknown item ${tail}`),
    nature: (tail) => resolveConst(exPp, `NATURE_${tail}`, `evo roster nature ${tail}`),
    profileLevelUp: (value) => {
      // pokedex parity: record id first, then the family base id
      const id = recordIdByValue.get(value);
      if (!id || !recordsSet.has(id)) return null;
      const pid = profiles.species.has(id) ? id : baseIdOf(id);
      return profiles.levelUp.get(pid) ?? null;
    },
  };

  // post-rewrite display lists per entry (the { id, method, target } of
  // every surviving branch — `method` stays the numeric EVO_* here; evoLinks
  // only consumes targets, the record id and the dex tie-breaks)
  const lists = new Map();
  for (const id of expandedBodies.keys()) {
    const value = idByValue.get(id);
    if (value === undefined) fail(`evo rosters: entry ${id} has no canonical species value`);
    // GetBaseEvolution's SPECIES_MELTAN case — the species table entry has
    // no .evolutions at all; the game uses this fixed table instead
    const raw = id === 'meltan'
      ? [{ method: 0xfffe, param: 0, target: resolveConst(exPp, 'SPECIES_MELMETAL', 'SPECIES_MELMETAL') }]
      : evoTuplesOfBody(exPp, expandedBodies.get(id), `evo roster ${id}`, 0xffff);
    const list = [];
    for (const evo of buildEvoDisplayList('ex', evoCtx, value, raw)) {
      const target = recordIdByValue.get(evo.target);
      if (!target) fail(`evo rosters: ${id} evolution target value ${evo.target} is not a record`);
      list.push({ id: target, method: evo.method, target: evo.target });
    }
    lists.set(id, list);
  }

  // the evoLinks entry domain: every record (national-dex order — the
  // synthesized bases included, as prev targets) plus every dex-less form
  // entry (baseId = its family's record, dexNum inherited from the base)
  const entries = new Map();
  for (const rec of baseDomain.records) {
    entries.set(rec, { id: rec, value: idByValue.get(rec), baseId: rec, dexNum: baseDomain.dexValue.get(rec), isRecord: true });
  }
  for (const id of expandedBodies.keys()) {
    if (entries.has(id)) continue;
    const baseId = baseIdOf(id);
    entries.set(id, { id, value: idByValue.get(id), baseId, dexNum: baseDomain.dexValue.get(baseId) ?? 0, isRecord: false });
  }

  return evoLinks({
    entries,
    lists,
    recordOf: (v) => recordIdByValue.get(v),
    idsByValue,
    baseRosterOf: (rec) => baseDomain.rosters.get(rec) ?? [],
    label: 'evolution references',
  }).refs;
}

# Project Maintenance

Project maintenance notes extracted from `AGENTS.md`.

## Subject Matter Expert Notes

Navigation only — the game repo (`references/pokeemerald-rogue`) and the cited data files own the detail.

**Baseline.** The site documents the in-game version **2.2.1** (Vanilla `v2.2.1a`, EX `v2.2.1`), not a GitHub release (git tags stop at v2.1). Version string: `src/data/rogue_strings.h` L6; save-compat marker `SAVE_VER_ID_*` in `include/rogue_save.h`. Authoritative branch SHAs: `scripts/verify/baseline.json` (bump only after the docs are refreshed and `verify:citations` passes). The `CHANGELOG.md` on `origin/expansion` is the stale upstream (Pokeemerald-Expansion 1.6/1.7-era) changelog — do not use it as release notes.

**Repo access.** Working tree = Vanilla (clean, branch `vanilla`); EX is read-only via `git show origin/expansion:<path>`; never check out branches in the game repo; `git fetch origin` before reading (SPEC.md).

**Citation legend.** `file @vanilla L123-125 (note) (identical @origin/expansion) / @origin/expansion L125-127`; `;` separates multiple cites; dual cites use different line numbers per branch (never assume parity); no `L` = drift-proof file-level cite; `(site data)` self-cites and `git …` method cites are non-verifiable.

**Data file → game code map** (the data files own the line numbers; rows list the primary files per data file, not exhaustive — a few secondary cited files, e.g. `src/rogue_trainers.c`, `src/pokemon.c`, `src/battle_util.c`, appear in citations without a row):
- `adventure.json` → `src/rogue_adventurepaths.c`; `include/constants/rogue.h` (room enum, boss-ladder consts); `src/rogue_controller.c`; `src/data/rogue/trainers/rogue.json`; `data/maps/Rogue_AdventurePaths/scripts.pory`
- `campaigns.json` → `src/rogue_campaign.c`; `data/maps/Rogue_Hub_Interior_ConfigRoom/scripts.pory`
- `charms.json` → `src/rogue_charms.c` (CalcValueInternal); `src/battle_script_commands.c`; `data/scripts/Rogue/Strings/Rogue_Strings_Items.pory`
- `followmons.json` → `src/rogue_followmon.c` (+ `rogue_controller.c` calls, its shiny odds/rolls, `rogue_adventurepaths.c` room pre-rolls, `rogue_script.c` Shiny Pie; `include/constants/rogue.h` spawn-slot consts)
- `game-modes.json` → `src/rogue_settings.c`; `src/rogue_settings_ui.c`; `src/rogue_controller.c`; `src/rogue_adventurepaths.c` (fast path)
- `gameshow.json` → `data/maps/Rogue_Encounter_GameShow/{scripts,map}.pory/json`; `src/rogue_gameshow.c`
- `hub.json` → `src/data/rogue_hub.h` (all 48 upgrades); `Rogue_Strings_Items.pory` (names); `src/rogue_hub.c`
- `pokedex.json` → `src/data/pokemon/species_info/gen_1..9.h` (EX entries); `include/constants/species.h` (NATIONAL_DEX enum, form tables); `src/data/pokemon/{base_stats,pokedex_entries,pokedex_text,evolution}.h` (vanilla); `src/data/rogue/pokemon/{vanilla,expansion}/<id>/` (learnset profiles); `src/data/rogue_pokedex.h` (dex variants); `src/data/party_menu.h` (TMs); `src/data/rogue_ridemon_infos.h` (rides); `src/data/rogue_routes.h` (legendary encounters); `graphics/pokemon/<id>/` (sprite sources)
- `quests.json` → `src/data/rogue/quests.json` + 13 included files under `src/data/rogue/quests/` (byte-identical across branches; EX split via `#if defined(ROGUE_EXPANSION)` gates)
- `routes.json` → `src/data/rogue_routes.h` (36 route records + wild tables); `src/rogue_controller.c` (sub-types); `include/constants/songs.h`
- `safari.json` → `src/rogue_safari.c` (pool/eviction); `include/constants/rogue.h` (60-slot consts); `src/rogue_controller.c` (run start/end: snapshot, Starter Bag hand-out, ribbon stamping); `src/rogue_save.c` (hub-state snapshot/restore); `data/maps/Rogue_Interior_SafariCave/scripts.pory`
- `settings.json` → `src/rogue_settings_ui.c` (19 toggles/9 ranges); `include/constants/rogue.h` (`CONFIG_TOGGLE_*`); `src/data/rogue_strings.h`; `src/rogue_settings.c`
- `timeofday.json` → `src/rogue_timeofday.c`; `src/rogue_controller.c` (clock); `data/maps/Rogue_Area_Home/scripts.pory` (bed presets)
- `unique-mons.json` → `src/rogue_gifts.c` (lab slots/rarity/ability pools); `src/data/rogue/custom_mons.json`
- `versions.json` → one record per divergence, each citing its own implementing file (`Makefile` L4 EXPANSION flag, `include/constants/rogue.h` pokedex variants, `rogue_gifts.c`, `rogue_charms.c` Grace cap, …)
- `site.json` → footer source line only

**Drift hotspots.** Most-cited: `src/data/rogue/quests/default_masteries.json` (104) · `data/scripts/Rogue/Strings/Rogue_Strings_Items.pory` (95) · `src/data/rogue_hub.h` (60) · `include/constants/rogue.h` (53) · `src/rogue_controller.c` (51 — 6000+ lines, also one of the 14 divergent files). The 14 rogue files differing between branches (74 ins/74 del): `src/rogue_assistant.c`, `rogue_assistantbox.c`, `rogue_charms.c`, `rogue_controller.c`, `rogue_gameshow.c`, `rogue_gifts.c`, `rogue_hub.c`, `rogue_player_customisation.c`, `rogue_safari.c`, `rogue_voltorbflip.c`, `rogue_worldmap.c`, `include/rogue.h`, `include/constants/rogue.h`, `include/constants/rogue_pokedex.h` — changes to these need both the Vanilla and EX cite re-checked.

**Maintenance workflow.** `git -C references/pokeemerald-rogue fetch origin` → `npm run verify:citations` (fail = stale citations, fix the data first) → `npm run verify:citations -- --changed` (precise "what to review since the baseline" list) → update affected `data/*.json` (facts first, then line cites; quests regenerate via `npm run extract:quests`) → `npm run verify:citations && npm test` → bump `scripts/verify/baseline.json`. Known historical failure modes: wrong-unit formula misreads (not machine-checkable — read the code) and stale line cites (the verifier catches these).

**Hard rules.** Build/test never touch `references/`; only dev-only scripts read the game repo; zero dependencies.

## Github Notes

GitHub access from the agent is a GitHub App installation (`my-pi-agent-app[bot]`) provided by the `pi-github-app-auth` Pi extension. The correct way to interact:

- **Git**: plain `git fetch/push/pull` just works — the extension injects `GH_TOKEN` (installation token) and an ephemeral `credential.https://github.com` helper into agent bash. **Never** add manual auth (tokens in URLs, `-c http.extraHeader=…`): it conflicts with the helper and fails with "invalid credentials". GitHub SSH is deliberately blocked in agent shells.
- **API**: `curl -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/forzabarca88/emerald-rogue-docs/…` (the token is in the agent env; never print it).
- **App-token quirks** (verified): `GET /user` 403 and the repo `permissions` map all-false are normal, not permission problems. `POST /repos/…/branches` 404s — create/delete branches via `POST /repos/…/git/refs` / `DELETE /repos/…/git/refs/heads/<branch>` instead. Contents API: `PUT` takes `branch` (branch must already exist), `GET` takes `ref`. There is no API to delete PRs or issues — close them (the web UI can delete draft PRs). `PUT /repos/…/pulls/{n}/merge` may 404 persistently (PR mergeable, no branch protection) — the fallback is the GraphQL `mergePullRequest` mutation (same merge-commit method, `POST https://api.github.com/graphql`).
- **Workflow** (per Core Principles): `git push origin <branch>` → `POST /pulls` (base `main`) → poll `GET /actions/runs?head_sha=<head-sha>&event=pull_request` until `status=completed` and require `conclusion=success` (per-job detail: `/actions/runs/{id}/jobs`) → `PUT /pulls/{n}/merge` (merge commit, matches repo history) → `DELETE /git/refs/heads/<branch>` → `git fetch origin main:main` to fast-forward local `main`. Always compare branch state against `origin/main`, not a possibly-stale local `main`.


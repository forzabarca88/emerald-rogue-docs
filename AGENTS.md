# AGENTS.md

## Core Principles

- **DESIGN AND BUILD PRODUCTION GRADE CODE FROM THE START** - i.e. no monolithic files when they can modularised, no unnecessary duplication of code, no hardcoded values when they can be placed in a centralised config file, etc.
- Keep `AGENTS.md` and all related linked files minimal - **only** keep information which will be required every time you look at this project. Project structure should **always** be kept up to date, and include a CONCISE single sentence description of each file in the project.  Do not modify `Core Principles`, but review and remove anything else from the document which is not required.
- Never write to `main` branch directly when interacting with the Github repository. The workflow must always be `push non-default-branch` -> `create pull request into main branch` -> `ensure successful actions workflow completion (if applicable)` ->  `merge pull request into main branch` -> `delete the merged branch`.
- Do **not** make assumptions without testing and validating first. Follow the scientific method.
- You **must** review your own code as you write as a *Senior Software Engineer*.
- Write the bare minimum of tests - follow **ARRANGE, ACT, ASSERT**. You must test the end result, NOT the implmentation details.
- When fixing bugs or issues, you must replicate the problem with a failing test first. The failing test should go green once you fix the application code.
- If you start the application (e.g. for testing), you must validate that the application is stopped before marking the task complete.
- Use mocks for testing sparingly - if the code requires excessive mocking, then redesign the implementation to be easier to test.
- **You must assume that your knowledge is outdated** - always research topics and frameworks before making decisions.

## Important Notes

### Running commands

- **Every bash command must be run with a timeout set.** Any command that could block (servers, browsers, network fetches, builds/tests) needs an explicit timeout — never run one bare. A command that hangs to its timeout is a bug in the command's teardown (e.g. a server handle never closed, a browser context left open): fix the teardown, keep the timeout as the backstop.

### Project Structure

- [project-structure.md](project-structure.md) — the one-line description of every file in the project (kept up to date per the Core Principles).

### Project Maintenance

- [project-maintenance.md](project-maintenance.md) — the game-repo subject-matter expert notes (baseline, repo access, citation legend, data-file→game-code map, drift hotspots, maintenance workflow, hard rules) and the agent's GitHub access notes.

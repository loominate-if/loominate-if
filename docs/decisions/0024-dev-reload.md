# 0024. Reloading during development

- **Status:** Accepted, 2026-11-19
- **Issue:** [#53](https://github.com/loominate-if/loominate-if/issues/53)
- **Design:** [Tooling](../DESIGN.md#tooling), [ADR 0012](0012-rulebooks-hooks-registries.md), [ADR 0016](0016-bundler-plugin.md), [ADR 0022](0022-player-shell-and-browser-saves.md), [ADR 0023](0023-game-config-and-cli-commands.md)

## Context

`loominate dev` recompiles a game as it's edited (ADR 0016). Edits should keep the player's place where possible, and the game's errors should show in the browser as well as the terminal. Objects, rulebooks, hooks, and registries are module-level handles with unique names (ADR 0012). Swapping modules in place would define them twice, which is an error today.

## Decision

- **An edit reloads the page.** No game module accepts hot updates, so Vite reloads the page after any edit to a passage file or module. Every module is evaluated afresh, so nothing is defined twice.
- **The player's place survives through the autosave.** The player shell autosaves after every move, and resumes silently on a reload in the same tab (ADR 0022). After an edit, the page comes back at the same passage and beat, with the same state, showing the edited text. Undo history doesn't survive the reload, as with any reload.
- **When the save no longer fits the edited game,** for example because its passage was renamed, the shell doesn't throw or overwrite it. The start screen says the game in progress can't be continued, with the reason, and offers New game. The same protects players when a released game changes under their save.
- **Errors show in the browser.** The plugin sends the game's errors to Vite's error overlay whenever a page connects, which includes the reload after each edit. The overlay lists every error, one per line as in the terminal, with the first one's location and the lines around it. Warnings stay in the terminal. Fixing the last error removes the overlay at the next reload, and the terminal says the game has no problems.

## Consequences

- Editing is a reload away from seeing the change in place, with no module-level bookkeeping in core.
- In-place hot swapping, keeping undo history across edits, would need handles that can be redefined. It can come later without changing how games are written.
- A game with its own shell instead of `playGame` keeps its place only if it resumes a save on reload too.

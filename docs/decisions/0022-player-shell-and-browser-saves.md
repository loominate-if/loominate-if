# 0022. The player shell and browser saves

- **Status:** Accepted, 2026-11-19
- **Issue:** [#230](https://github.com/loominate-if/loominate-if/issues/230)
- **Design:** [Core runtime](../DESIGN.md#core-runtime) (Saving), [ADR 0008](0008-random-streams.md), [ADR 0010](0010-save-format.md), [ADR 0017](0017-layouts-and-widgets.md)

## Context

Core has saves, slots, autosave, and export and import over a `SaveStorage` the host supplies, but no browser side (ADR 0010). Loading a save means a new store, story, undo history, and page, which each game was wiring up by hand. A game also needs a fresh master seed for each new game, which ADR 0008 leaves to whatever starts it.

## Decision

### Browser storage

`createBrowserStorage(gameId)` is a `SaveStorage` over IndexedDB, since saves carry the event record and can outgrow localStorage. Every game on an origin shares one database, `loominate-saves`, and each slot is keyed `[gameId, slot]`, so games never see each other's saves.

### The player shell

`playGame(container, { passages, start, game })` plays a game with one call:

- **Starting.** It creates the store, story, undo history, and page. A new game gets a fresh master seed from the browser's random source, the one place randomness enters, and stored with the game. `seed` overrides it for a seed-of-the-day or tests.
- **Autosave.** It checkpoints undo and autosaves after every move on the page, beats included, in order, one at a time. A failed autosave goes to `onError` and doesn't stop play.
- **Reloads carry on.** A reload, or going back and forward, in the same tab resumes from the autosave without asking. The shell marks the tab in `sessionStorage` when a game starts. That lasts through reloads and is cleared when the tab closes, so it tells a reload from a return.
- **Returning players choose.** A player who comes back after closing the tab, with an autosave, gets a start screen offering Continue, focused, or New game, noting a save from another game version. The start screen is drawn as a page (`.loominate-page`, with `data-screen="start"`), so the game's styles and theme apply to it. The title is its heading, Continue is a continue button, and New game is a choice, so the first screen looks like the game. Where session storage is unavailable, every visit counts as a return, which is still safe. A broken autosave doesn't block a new game; it's listed in the save menu with its problem.
- **Storage.** It uses browser storage, or memory for the visit when the browser has none, as some private windows don't.

### The game menu and save menu

- A `game-menu` widget has Undo, Save, and Load. The shell registers it and adds it to the `page` layout's header, unless the game has replaced that layout, in which case the game places it.
- Undo stays focusable when there's nothing to undo, marked `aria-disabled`, as disabled links are (#43).
- Save and Load open the save menu, a native modal `<dialog>`, which brings focus trapping, Escape to close, and the right semantics. It lists slots newest first, with the autosave and unreadable slots. It saves under a name to a new slot (`save-1`, `save-2`, …), and each slot can be loaded, saved over, exported as a `.json` download, or deleted. Delete asks once more on the same button. Imports come from a file picker into a new slot, never over an existing one. Outcomes and failures are announced in a status line.

## Consequences

- A game's `main.ts` can be one `playGame` call. The CLI's templates (#52) can use it, and custom shells still build from `mountPage` and core's saves.
- The menu's labels are English for now; localizing the shell's own text is future work.
- Each game's `page` layout gains the game menu unless it's customized. A game that replaces `page` adds `game-menu` itself, wherever it wants it.

# 0040. Showing errors the story's code throws

- **Status:** Accepted, 2026-11-22
- **Issue:** [#274](https://github.com/loominate-if/loominate-if/issues/274)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0022](0022-player-shell-and-browser-saves.md), [ADR 0024](0024-dev-reload.md)

## Context

When story code threw while the game was playing, such as an `{on enter: …}` effect calling `move(box, box)`, the click seemed to do nothing, and the error reached only the browser's console. When `story.ts` threw while the game loaded, the page stayed blank, and the terminal running the dev server said nothing. Core already rolls back a move whose effect throws, but nothing told the player or the author.

## Decision

### During play

- The page catches errors from following a choice, moving past a beat, and skipping. It shows the message at the top of the passage, as `.loominate-error` with `role="alert"` so it's announced, logs the error with its stack to the console, and passes it to `mountPage`'s new `onError` option. The next move clears it.
- A move whose effect throws is rolled back by core, so the game stays where it was, at the passage before the choice. An error drawing the passage after a move that worked leaves the move in place, and Undo takes it back.
- The words are the message table's `page.error`, "Something went wrong: …" (ADR 0039).
- Core never touches the DOM. The page shows the error.

### While loading

- The generated entry point imports an error module before anything else. It listens for uncaught errors and rejections and shows them in the game's container, as `.loominate-fatal` with `role="alert"`: "The game couldn't start." while loading, or "Something went wrong." after. The dev server's page adds the stack.
- Built games include it too, so a player sees a message instead of a blank page.
- Its words are English, not from the message table: an error while loading may come before the table, or presentation, has loaded.

### In the terminal

- Vite already prints uncaught browser errors in the dev server's terminal, with a code frame at the author's line, so the error module leaves them to it.
- Errors the page catches during play never reach Vite, so the generated entry passes the page an `onError` that sends them to the dev server, which prints them with their stack.

## Consequences

- An author sees every error the story's code throws, in the page and the terminal, and a player sees a message rather than nothing.
- A game with its own entry point, rather than the generated one, gets the page's handling of play errors, but has to show load errors itself.
- Type errors in dev are still unreported until #279.

# Playing a game in the browser

`playGame` plays a game in a page with one call. It handles saves kept in the browser, autosave, Continue for returning players, undo, and the save menu. [ADR 0022](../decisions/0022-player-shell-and-browser-saves.md) records the decisions behind this guide.

```ts
import { playGame } from "@loominate-if/presentation";
import { passages } from "./game.weft";

await playGame(document.querySelector("#app")!, {
  passages,
  start: "Start",
  game: { id: "lantern-road", version: "1.0.0" },
  title: "Lantern Road",
});
```

- `game` is the game's stable ID, which keeps its saves apart from other games', and its version, which saves record so the player can be told when a save is from another version.
- `title` is shown on the start screen.
- `page` passes options to the page, such as `pacing` or `continueLabel`.
- `seed` makes the master seed for a new game. Each new game gets a fresh random one by default.
- `storage` replaces browser storage, for example with `createMemoryStorage()` in tests.

## What players get

- **Autosave** after every move. When they come back, a start screen offers **Continue** or **New game**.
- **Undo**, **Save**, and **Load** in the game menu, in the page's header.
- **The save menu**, which saves under a name, loads, saves over a slot, exports a save as a file, imports one, and deletes, asking first. It's a dialog that works from the keyboard and with screen readers.
- A note when a save was made by another version of the game.

## Placing the game menu

The game menu is a widget named `game-menu`. If your game replaces the `page` layout, put it where you want it:

```ts
layouts.replace("page", {
  regions: ["header", "main", "footer"],
  widgets: { header: ["game-menu", "status-line"] },
});
```

## Building your own shell

`playGame` is built from parts you can use directly: `mountPage` for the page, `createBrowserStorage(gameId)` for slots in the browser, and core's `createSaves`, `createStore`, `createStory`, and `createHistory`.

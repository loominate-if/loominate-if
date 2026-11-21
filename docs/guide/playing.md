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

- **Autosave** after every move. Reloading the page carries straight on. When they come back after closing the tab, a start screen offers **Continue** or **New game**.
- **Undo**, **Save**, and **Load** in the game menu, in the page's header.
- **The save menu**, which saves under a name, loads, saves over a slot, exports a save as a file, imports one, and deletes, asking first. It's a dialog that works from the keyboard and with screen readers.
- A note when a save was made by another version of the game.

## Styling the start screen

The start screen is drawn as a page, so your theme and page styles apply to it as they do in play: Continue looks like a continue point and New game like a choice. To style it alone, use `.loominate-page[data-screen="start"]`.

## Placing the game menu

The game menu is a widget named `game-menu`. If your game replaces the `page` layout, put it where you want it:

```ts
layouts.replace("page", {
  regions: ["header", "main", "footer"],
  widgets: { header: ["game-menu", "status-line"] },
});
```

## Following the game

`playGame` returns the player. `player.story`, `player.page`, and `player.store` are the game in play, and change when a game starts or loads. `player.onChange(listener)` calls the listener when a game starts or loads, after each move, and after an undo, and returns a function that stops it. The [inspector](inspector.md) uses it to keep up. `player.history` lists the moves that can be undone and made again, and `player.travel(steps)` goes back that many moves when `steps` is negative, or forward again when it's positive; the inspector's History tab is built on them. `player.playReplay(replay)` starts a new game from a replay file, each of its moves an undo step, and `player.toReplay()` gives the game in play as one; the inspector's Replay tab uses them.

## Building your own shell

`playGame` is built from parts you can use directly: `mountPage` for the page, `createBrowserStorage(gameId)` for slots in the browser, and core's `createSaves`, `createStore`, `createStory`, and `createHistory`.

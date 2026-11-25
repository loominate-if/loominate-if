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
- **Undo**, **Save**, **Load**, **Restart**, **Story log**, and **Transcript** in the game menu, in the page's header. Restart asks once more on the same button, "Confirm restart", and moving away cancels it. It starts the story over with a fresh seed, replacing the autosave. Each button has a tooltip saying what it does, which stays clear when a game rewords the buttons ([Rewording the library](messages.md)). Saved slots are kept, but the game left behind isn't saved: save first to keep it.
- **The save menu**, which saves under a name, loads, saves over a slot, exports a save as a file, imports one, and deletes, asking first. It's a dialog that works from the keyboard and with screen readers.
- A note when a save was made by another version of the game.
- **Errors shown, not swallowed.** If the story's code throws during a move, the page shows "Something went wrong: …" at the top of the passage, and the game stays where it was, as a failed move is rolled back. The next move clears it. `mountPage`'s `onError` option gets the error too. The words are the `page.error` message ([Rewording the library](messages.md)).

## The story log and transcript

The game menu has **Story log** and **Transcript**, each opening a dialog beside the page, read from the event record, so undo trims them. Focus goes to its filter; Escape or **Close** closes it, and the newest is at the bottom.

- **The story log** is the narrative, for rereading: passage prose and scenes, a room's description on the first visit only, what the player noticed, and what was said, each line by its speaker ("Maid: “Gone, miss?”"), with the player's own lines in italics. Navigation, actions, menus, system messages, and later visits' room descriptions are left out. **Show** filters it to dialogue only.
- **An event tagged `log`** is put in the story log, whatever its kind, as a chapter heading in a system message; one tagged `no-log` is left out.
- **Text for the story log:** prose written for single pages doesn't always read smoothly strung together. A directive on its own line marks the paragraph after it, or before it:

  ```
  :: Study [room: study]
  {log only}
  The next morning, Elsie went back to the study.

  A quiet study. Somewhere far off is a vault.

  {page only}
  Choose Ring for the maid to call her.

  You set the brooch on the desk.
  {in log: "Elsie set her mother's brooch on the desk."}
  ```

  `{log only}` is connective text: in the story log, never on the page or in the story so far. `{page only}` is for the page alone, such as an instruction to the player. `{in log: "…"}`, after a paragraph, gives the log its own wording of it, while the page shows the paragraph as written. The transcript has both.
- **The transcript** is every event, numbered, with its kind and its text or fields, for testers and bug reports. **Show** filters it by kind, and **Copy** copies it, one event a line.
- **Speakers** are named by `nameSpeakers`; the world model names each by their body's name. `storyLog(events)` and `transcript(events)` give the same as data, for a game's own view.

## Saves from older versions

A save records the game's version. When a player loads one made by another version, it loads as it is: stable IDs mean most changes to a game need nothing, and a property a new version adds needs nothing either, since a save keeps only values that differ from their defaults.

When a change does need saves brought forward, such as an object's ID changing, declare migration steps in `story.ts`. Each step brings a save from one version to the next, changing the saved state as data:

<!-- example: packages/core/src/save/migrations.test.ts#migrate -->
```ts
migrate({ from: "1.0.0", to: "1.1.0" }, (save) => {
  save.rename("oldLamp", "lamp");
  save.renameField("door", "shut", "isOpen", (shut) => !shut);
});
migrate({ from: "1.1.0", to: "1.2.0" }, (save) => {
  save.remove("shed");
});
```

- **Running the steps:** a save from 1.0.0, loaded by 1.2.0, runs the step from 1.0.0, then the step from 1.1.0. Versions are matched exactly.
- **What a step can do:** `rename` an object, which moves every reference to it too; `renameField`, converting its value if you like; `remove` an object, setting references to it to `null`; and `get`, `set`, and `unset` a field.
- **When no step leads from a save's version:** once a game declares any steps, a save they can't bring forward is refused, with the versions in the reason: "this save is from version 0.9.0 of the game, and no migration leads from it to 1.2.0". The save menu lists it as one that can't be loaded.
- **A step that throws** stops the load, naming the step.

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

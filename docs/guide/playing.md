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
- `title` is shown on the start screen, and names story log exports.
- `author`, if given, is shown under the title on the start screen, "by Your Name", and recorded in story log exports.
- `cover`, if given, is the game's cover art on the start screen: `cover: { image: "cover.jpg", alt: "A lantern on a long road" }`, an image in the game's `public/` folder, with what it shows for those who can't see it. It goes in `loominate.config.ts` too.
- `startScreen: false` goes straight into a new game instead of opening on the start screen, offering Continue only to a returning player, as for a game embedded in another page.
- `page` passes options to the page, such as `pacing` or `continueLabel`.
- `seeds` lets players see and share seeds; see [Shareable seeds](#shareable-seeds).
- `seed` makes the master seed for a new game. Each new game gets a fresh random one by default.
- `storage` replaces browser storage, for example with `createMemoryStorage()` in tests.

## What players get

- **A start screen,** the first thing every game shows: the title, the byline, and the cover if there is one, then **Continue** if there's a game in progress, **Load a saved game** if there are saves, and **New game**. Nothing begins until the player chooses.
- **Autosave** after every move. Reloading the page in the same tab carries straight on, past the start screen; coming back after closing the tab opens on it again.
- **Undo**, **Save**, **Load**, **Restart**, **Story log**, and **Transcript** in the game menu, in the page's header. Restart asks once more on the same button, "Confirm restart", and moving away cancels it. It starts the story over with a fresh seed, replacing the autosave. Each button has a tooltip saying what it does, which stays clear when a game rewords the buttons ([Rewording the library](messages.md)). Saved slots are kept, but the game left behind isn't saved: save first to keep it.
- **The save menu**, which saves under a name, loads, saves over a slot, exports a save as a file, imports one, and deletes, asking first. It's a dialog that works from the keyboard and with screen readers.
- A note when a save was made by another version of the game.
- **Errors shown, not swallowed.** If the story's code throws during a move, the page shows "Something went wrong: …" at the top of the passage, and the game stays where it was, as a failed move is rolled back. The next move clears it. `mountPage`'s `onError` option gets the error too. The words are the `page.error` message ([Rewording the library](messages.md)).

## The command line

The game menu's **Command line** turns on a text field below the passage, for playing by typing. It's for every game, branching stories too, and is off until the player turns it on. Their choice is remembered for every game in that browser, since it's how they like to play. A game can start with it on with `page: { commandLine: true }`.

- **It takes only what the page offers:**
  - the passage's choices, by their labels ("climb the tower", "west");
  - the actions in things' menus, by their labels or their [verb phrases](actions.md#verb-phrases) with the things named ("take coin", "pull on the bell");
  - a layout's action lists, such as a conversation's topics ("ask about the weather").
- **Suggestions follow the typing.** Each typed word starts a word in order, and articles and punctuation don't matter: "sig ship" is "Signal the ship".
  - Up and Down pick a suggestion, Tab completes it, and Enter does it, or what's typed.
  - With the list closed, Up and Down recall earlier commands, and Escape clears the field.
- **It never answers "I don't understand":**
  - several matches: "Did you mean Ask about the weather or Ask about the butler?", listed to pick;
  - none: "That isn't something you can do here. You could: …";
  - something offered but disabled: its reason, "Polish the bell: You have no cloth.".
- **Screen readers:** focus stays in the field. When typing pauses, the suggestions are read: "2 suggestions: Ring the bell, Ring for help." What a command does is read through the page's live region, as after any move. A link followed with the mouse or keyboard moves focus as it always does. Speech tools such as Voice Control and Voice Access type into the field like a keyboard, so no speech input of the game's own is needed. Suggestions help most with invented names that dictation gets wrong.
- **An action that asks for a number** is taken from its menu, which asks for it, rather than typed.
- **A game adds commands** with `commandSources.register(name, (game) => [...])`, each a `label`, optional `phrases`, an optional `disabled` reason, and `run`.

## Shareable seeds

A game with random streams can let players share the world they got. Turn it on with `seeds` in `loominate.config.ts`:

```ts
export default defineConfig({
  game: { id: "lantern-road", version: "1.2.0" },
  start: "Start",
  seeds: true,
});
```

- **`seeds: true`:** each new game's seed is three words, like `amber-lantern-fog`.
  - The game menu's **Seed** shows it with the game's version, `amber-lantern-fog@1.2.0`. **Copy** copies it, and **Copy link** copies a link that offers it.
  - The dialog's **Play a seed** field starts a new game from one. Capitals and spaces don't matter: "Amber Lantern Fog" is the same seed.
  - The start screen offers **New game with a seed…**.
  - A link with `?seed=…` offers **Play this seed** on the start screen, beside Continue, so it never replaces the game in play unasked.
- **Another version:** a seed from another version of the game still plays, after a note that its world may differ.
- **`seeds: "daily"`:** today's seed, the same for everyone that day (by the date in UTC). **Seed** shows it, and there's no field to enter another.
- **`seeds: "amber-lantern-fog"`,** or any other text: the seed every game starts from. Nothing is shown.
- **Off by default.** A story with nothing random has nothing to share, and doesn't carry the word list.
- **The same seed and version give the same world,** since each stream's draws come from the seed and its name alone (see [Randomness](../DESIGN.md#randomness)).

## The story log and transcript

The game menu has **Story log** and **Transcript**, each opening a dialog beside the page, read from the event record, so undo trims them. Focus goes to its filter; Escape or **Close** closes it, and the newest is at the bottom.

- **The story log** is the narrative, for rereading: passage prose and scenes, a room's description on the first visit only, what the player noticed, and what was said, each line by its speaker ("Maid: “Gone, miss?”"), with the player's own lines in italics. Navigation, actions, menus, system messages, and later visits' room descriptions are left out. **Show** filters it to dialogue only.
- **An event tagged `log`** is put in the story log, whatever its kind, as a chapter heading in a system message; one tagged `no-log` is left out. One tagged `log-only` is in the story log and not on the page, as `{emit "Elsie lit the lamp.", tags: log-only}`. The inspector guide's [table](inspector.md) says what shows where.
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
- **Chapters and export:** `{chapter "The House on the Hill"}` in a passage, or `chapter("…")` in effect code, starts a chapter when the player reaches it. The story log shows its title as a heading; reaching the same marker again doesn't start another. The story log's **Export** saves it as EPUB, HTML, or Markdown, named after the game, divided into chapters there. What comes before the first chapter is an opening part under the game's title. The game config's `title` and `author` are the book's. A game's own button can call `exportStoryLog(events, "epub", { title, author })`.
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

# 0010. Save format

- **Status:** Accepted, 2026-11-17
- **Issue:** [#22](https://github.com/loominate-if/loominate-if/issues/22)
- **Design:** [Core runtime](../DESIGN.md#core-runtime) (Saving, Save durability)

## Context

The design asks for autosave, named slots, and export/import, with saves carrying the game version and engine version. Migration hooks are [#100](https://github.com/loominate-if/loominate-if/issues/100). Before they exist, the format needs settling, along with:
- what a save holds, and whether that includes undo history;
- what happens to a save from another version of the game;
- how autosave works;
- where slots are kept, given that core never touches the DOM.

Once games ship, the save format is a contract: players' saves must keep loading.

## Decision

### Save files

A save file is one line of JSON:

```json
{"format":"loominate-save","version":1,"game":{"id":"lantern-road","version":"1.0.0"},"engine":"0.0.0","savedAt":"2026-11-17T12:00:00.000Z","label":"Bridge","state":{...}}
```

- `format` marks the file as a save; `version` is the save file version, 1 here.
- `game` is the game's stable `id` and its `version`, supplied by the host. `engine` is `ENGINE_VERSION`, core's package version, kept in step by a test.
- `savedAt` is the wall-clock time, as ISO 8601. It's metadata for save menus; the game never reads it (design principle 4).
- `label` is the player's name for the save, when they gave one.
- `state` is the whole state store's snapshot. That already holds the event record, the action log (ADR 0009), the seed and stream positions (ADR 0008), so a loaded save carries on exactly, and any save can become a replay.
- Undo history isn't saved. Loading starts a fresh history, as most IF systems do, which keeps saves small and the history's diff format out of the save contract.
- `writeSave` writes fields in a fixed order. `readSave` accepts exactly this shape and explains anything else: invalid JSON, the wrong `format`, a newer version, a missing or unknown field, or a snapshot the store rejects. Unknown fields are refused, so adding a field means a new version.

### Loading across versions

- A save from a different game (another `game.id`) is refused.
- A save in a newer save file version is refused, with a message saying a newer engine made it.
- A save from another version of the same game loads, and its summary says `sameGameVersion: false` so the shell can warn. Stable IDs make most saves load cleanly across versions; migration hooks (#100) will run at this point once they exist.

### Slots

- `createSaves({ storage, game })` manages slots for one game: `save`, `autosave`, `load`, `list`, `delete`, `export`, and `import`.
- Slots are kept in a `SaveStorage` the host supplies: four methods (`get`, `set`, `delete`, `slots`) over slot names and save file text, synchronous or asynchronous. Core provides `createMemoryStorage()`; browser storage and the save menu are presentation's ([#230](https://github.com/loominate-if/loominate-if/issues/230)).
- `list()` gives summaries (everything but the state, plus the slot and current passage) newest first, ties broken by slot name so the order never depends on the storage. Slots that can't be loaded come last, each with its reason, so one bad file never hides the others.
- Export gives a slot's file text; import checks a file can be loaded into this game before writing it to a slot, so a bad import never overwrites a save.

### Autosave

- There's one autosave slot, `autosave`, which `saves.autosave(store)` overwrites. Named saves can't use it.
- Core does no timing. The player shell calls `autosave()` after each action, and offers Continue by loading it.

## Consequences

- The save format is now versioned. Changing what version 1 means breaks players' saves; additions need version 2 and a reader for version 1.
- Saves grow with the event record, which is the biggest part of the state. Browser storage should be IndexedDB rather than localStorage (#230). Trimming or compacting the record is a separate decision if saves get too large.
- Hosts supply the game ID and version. The compiler and CLI will fill them in from the game's package.
- Replay files should name the game and engine the same way ([#228](https://github.com/loominate-if/loominate-if/issues/228)).
- Saving an instance of generated content (the procedural generation kit) needs nothing extra, since instances are state.

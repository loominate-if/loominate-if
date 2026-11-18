# 0011. Persistent cross-playthrough store

- **Status:** Accepted, 2026-11-17
- **Issue:** [#23](https://github.com/loominate-if/loominate-if/issues/23)
- **Design:** [Core runtime](../DESIGN.md#core-runtime) (Persistent cross-playthrough data), design principle 4 (determinism)

## Context

Achievements, unlocked endings, galleries, settings, and roguelike meta-progression need data that survives restarts and that undo never touches, kept apart from save slots. The design leaves open how authors reach it, where it's kept, and how it fits determinism. If game logic reads persistent data ("once you've seen an ending, the start rolls differently"), a seed and an action list alone no longer reproduce a playthrough, since the result also depends on what the player had unlocked.

## Decision

### The store

- Persistent data is a second store beside the game state, with the same reads and writes (`get`, `has`, `entity`, `ids`, `set`, `delete`) and the same stable IDs and value rules.
- `openPersistent({ storage, game })` opens a game's data from a `PersistentStorage` the host supplies (`read` and `write` of one text file), or starts it empty. `createPersistent()` is one in memory only.
- Writes go to storage in the background, and writes made together are stored together, so a turn is one write. `flush()` waits for them and reports a failed write.
- Storage is the host's, separate from save slots: the browser one is part of [#230](https://github.com/loominate-if/loominate-if/issues/230).

### In a story

- `StoryOptions.persistent` gives the story its persistent data. It defaults to an empty store in memory, so plain stories never need to think about it.
- Effects get `context.persistent` to read and write, and rendering gets it read-only, as with `context.state`.
- Undo, restarting, and loading a save never touch persistent data. A move that fails is the exception: its persistent writes are rolled back with it, so a failed move leaves nothing behind anywhere.

### Determinism

- When the story begins, it copies the persistent data into game state at `$persistent.atBegin`. So saves carry it, and any save can still become a replay.
- Replay file version 3 records that copy as `persistent` (ADR 0009). `playReplay` swaps in an in-memory store holding it, so a replay plays exactly as the original did, and never reads or changes the player's real persistent data. Older replay files play against no persistent data.

### The file

```json
{"format":"loominate-persistent","version":1,"game":{"id":"lantern-road","version":"1.0.0"},"state":{"endings":{"end":true}}}
```

- `readPersistent` refuses another game's data, a newer version, unknown fields, and anything the store rejects, explaining each. Game versions aren't compared: persistent data is meant to outlast updates.

## Consequences

- The persistent data file is a versioned format; changing what version 1 means loses players' achievements and settings.
- Every save and replay holds a copy of the persistent data as it was when the story began. That's usually small; a game that keeps large data there pays for it in each save.
- Persistent writes made during a playthrough are part of what a replay reproduces, inside its sandbox.
- Typed `persistent()` objects, like `object()` (ADR 0006), can build on this later.

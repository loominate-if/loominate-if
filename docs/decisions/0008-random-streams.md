# 0008. Random streams

- **Status:** Accepted, 2026-11-17
- **Issue:** [#24](https://github.com/loominate-if/loominate-if/issues/24)
- **Design:** [Randomness](../DESIGN.md#randomness), design principle 4 (determinism)

## Context

All randomness comes from named streams derived from a master seed and stored in state, so a seed and an action list reproduce a playthrough, shared seeds give the same world, and undo can't reroll. The design leaves open:
- the generator and how stream seeds are derived;
- where streams keep their position;
- how authors define and draw from them;
- what the master seed is and where it comes from.

Once games ship, the generator and derivation are part of the save, replay, and shared-seed contract: changing them changes every result.

## Decision

### Generator and derivation

- Streams use **sfc32** (Chris Doty-Humphrey's Small Fast Chaotic generator), with 128 bits of state as four unsigned 32-bit words. It's fast, passes the PractRand statistical tests, and uses only 32-bit integer arithmetic, so results are identical in every JavaScript engine.
- A stream's starting state is the **cyrb128** hash of `<master seed>\u0000<stream name>` over UTF-16 code units, followed by 15 discarded draws to mix it.
- A stream's name is its full path: a substream of `world` named `level-3` is `world/level-3`. The starting state depends only on the master seed and the name, never on what any stream has drawn, so:
  - drawing more from one stream never shifts another;
  - a substream gives the same results whenever it's first used, whatever the player did before.
- Both functions live in core with golden tests checked against an independent implementation.

### Draws

- `next()` is a 32-bit draw divided by 2³²: from 0 inclusive to 1 exclusive.
- `int(min, max)` is inclusive at both ends and unbiased: draws at or above the largest multiple of the range that fits in 2³² are rejected and drawn again. The range has at most 2³² values.
- `chance(p)` is `next() < p`; `pick(items)` is `items[int(0, length - 1)]`; `shuffle(items)` is Fisher–Yates from the end, returning a copy.

### State

- The master seed is a string, stored at `$random.seed` when the story begins, before the start passage's effects. A loaded save keeps its own seed. `StoryOptions.seed` defaults to `"0"`; whatever starts a new game (the player, the CLI, a seed-of-the-day page) supplies a fresh one. Core never makes one up, since it has no source of randomness of its own.
- Each stream's position is a field of `$streams`, named by the stream's full name and holding its four state words. A stream has no field until its first draw.
- Because positions are ordinary state, undo rewinds them, so undoing and retrying gives the same result, and save, load, and replay need nothing extra.

### API

- `randomStream(name)` returns a stream; `stream.substream(name)` returns a substream. Names are non-empty and have no `/`.
- Streams are stateless handles over the running story's store, like objects (ADR 0006). Authors define them once in a module: `export const weather = randomStream("weather")`.
- A draw changes state, so it's refused while a passage renders, with the same error as writing to an object. Draws belong in effects.

## Consequences

- The generator, the derivation, the 15-draw warm-up, and the draw functions are now part of the save, replay, and shared-seed contract. Changing any of them changes results for existing seeds and needs a version bump of that contract.
- Saves grow by one field per stream used, four numbers each.
- Renaming a stream changes its results; stream names are stable IDs like any other.
- Opting a stream out of undo, so retrying rerolls it, needs history support and is [#226](https://github.com/loominate-if/loominate-if/issues/226).
- Memorable seed words ("amber-lantern-fog") and seed entry belong to whatever starts a game. Any string works as a seed.
- Dice notation such as `roll("2d6", stream)` can build on `int()` in the RPG kit.

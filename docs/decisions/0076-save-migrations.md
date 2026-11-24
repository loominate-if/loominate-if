# 0076. Save migrations

- **Status:** Accepted, 2026-11-24
- **Issue:** [#100](https://github.com/loominate-if/loominate-if/issues/100)
- **Design:** [Core runtime](../DESIGN.md#core-runtime), [ADR 0010](0010-save-format.md)

## Context

Saves record the game's version, and one from another version loads as it is, with a note. Authors need a way to bring a 1.0 save forward when a later version changes something a save holds, such as an object's ID. When no way exists, the error must be clear. Stable IDs make most migrations unnecessary.

## Decision

- **Steps between versions.** `migrate({ from, to }, step)` in `story.ts` declares how a save from game version `from` becomes one for `to`.
  - Loading runs the steps from the save's version, one after another, until the running version.
  - Versions are matched exactly, not as semver ranges.
  - Each version has at most one step onward, and a step to itself, or steps that loop, are errors.
- **A step changes the saved state as data,** before anything loads, so no objects, rules, or story are involved. It's given helpers for the usual changes:
  - `rename(from, to)` moves an object's fields and points every reference to it, wherever nested, at the new ID;
  - `renameField(id, from, to, convert?)`;
  - `remove(id)` deletes an object and sets references to it to `null`;
  - `get`, `set`, and `unset`, and `ids` and `has`.
  - A property a new version adds needs no step: a save keeps only values that differ from their defaults.
- **When no path exists:**
  - A game with no steps loads older saves as it does today.
  - Once a game declares steps, a save they can't bring to the running version is refused. The reason names the save's version, the running one, and the versions the steps start from.
  - The save menu shows it with the other saves that can't be loaded.
- **Where it runs:** core's `createSaves`, in `load`, `list`, and `import`. A loaded save's summary gives `migratedThrough`, the versions it went through.
- **The save format doesn't change.** Migrations work on the state a save already holds, so `SAVE_VERSION` stays 1.

## Consequences

- Replays record actions, not state, so migrations don't apply to them. A replay from another version still says so, and may diverge.
- Passage renames, and changes to the engine's own entries (`$story`, `$visits`), go through `get` and `set` for now. If they come up often, they can get helpers of their own.
- The engine's save format version (`SAVE_VERSION`) will need its own migrations when it changes, which is core's job, not the game's.

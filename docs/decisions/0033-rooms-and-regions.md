# 0033. Rooms, regions, and tag roles that run on arrival

- **Status:** Accepted, 2026-11-21. How a role's value is evaluated is revised by [ADR 0034](0034-exits-and-directions.md).
- **Issue:** [#63](https://github.com/loominate-if/loominate-if/issues/63)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0015](0015-compiler-extensions.md), [ADR 0031](0031-containment-and-scope.md), [ADR 0032](0032-minds-and-bodies.md)

## Context

The design links a passage to a room with the `room:` tag, groups rooms into regions for shared rules, descriptions, and ambience, and asks for per-location visit tracking. Places, containment, and the player's body already existed (ADRs 0031 and 0032); nothing tied a passage to a place, and the compiler's tag roles (ADR 0015) were names only.

## Decision

### `room:` passages

- A passage tagged `[room: cellar]` describes the place `cellar`. Arriving at it moves the player's body into the place and counts a visit. Authors no longer write `{on enter: move(player, cellar)}`.
- The value is an export of the game's scope module, as code, so TypeScript checks it: a typo is "isn't defined" on the tag, and something that isn't a place is a type error there. That keeps author mistakes at compile time (design principle 6).
- The move runs before the passage's own `{on enter: …}` code, so that code sees the player in the room. A body already in the room, even inside something there, isn't moved.
- Room passages are `entry` passages, never reported unreachable, since exits (#64) will enter them.
- Several passages may describe one room, such as a room by day and by night.

### Visits

- A visit to a room is an arrival at one of its passages. `visitsTo(room)` counts them, including the current one, like a passage's `visits`. Moving the player with `move()` alone doesn't count one.
- Counts are state on a world-owned object, `world:visits`, so undo, saves, and the inspector see them. Per-mind visit memory (#200) builds on this.

### Regions

- `region(id, definition)` is an object with a name and the regions it's in, so regions nest. A place joins regions by listing them in `regions`. Both are ordinary state.
- `roomDefaults` gives member rooms defaults for whatever they don't set themselves, copied into each room's definition when it's defined, the nearest region's first. Defaults are copied as property descriptors, so a getter stays a getter, with `this` the room: a rule such as "every room in the wing is dark while the power is out" is a getter default reading state.
- `onEnter(room)` and `onLeave(room)` run when the player's body moves across the region's edge, by any `move()`, including being carried in something. Outer regions are entered before inner ones and left after them, with ties by ID. They don't run for where the player starts, or when the player changes bodies, since nothing moved.
- `regionsOf(t)` and `isInRegion(t, region)` answer membership, sorted by ID.
- Shared descriptions, such as a `[region: house]` passage shown in every member room, aren't part of this. They can come later as a passage role, and a region's data and hooks already cover ambience.

### Tag roles that run on arrival

- A compiler extension's tag role may name an `arrival` runtime export. In a passage with the role, the compiler calls it as `runtime(value, context)` at the start of the passage's enter effects, with the role's value copied in as code. Its type errors are mapped to the tag, like any passage code. Tags now record where their value is (`valueSpan`).
- The world model's extension is plain data in `packages/world/src/extension.ts`, named in its package.json as `loominate.extension` (ADR 0023). It imports nothing from the compiler, so the runtime package takes no tooling dependency (ADR 0001); the compiler checks its shape when it loads.

## Consequences

- Games using rooms list `@loominate-if/world` in their config's `extensions`.
- Exits (#64) move the player between rooms through these passages; the compass reads the player's room.
- `enterRoom` is public, since generated code imports it; calling it from story code works the same way.
- A region's `roomDefaults` are read when rooms are defined, so changing a region's own state doesn't change rooms' defaults, except through getters.
- Moves are observed through an internal listener in `move()`. Assigning `location` directly bypasses it, as it bypasses `move()`'s checks (ADR 0031).

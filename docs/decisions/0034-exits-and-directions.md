# 0034. Exits, directions, doors, and obstacles

- **Status:** Accepted, 2026-11-21
- **Issue:** [#64](https://github.com/loominate-if/loominate-if/issues/64)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0033](0033-rooms-and-regions.md), [ADR 0031](0031-containment-and-scope.md)

## Context

The design has rooms declare exits, optionally with distances or travel times and with doors or other obstacles, and makes directions a registry rather than a fixed eight. The compass widget (#81) reads exits and shows a locked door disabled, with the door supplying the reason. Rooms (ADR 0033) tie passages to places, but nothing yet led from one room to another.

## Decision

### Declaring exits

- Exits are declared with `connect(room, { north: library, down: { to: cellar, via: cellarDoor, minutes: 2 } })` in `story.ts`, after the rooms. They can't be a property of the place's definition, because rooms refer to each other, and a `const` can't be used before it's defined.
- Each room's exits are state, on a world-owned object `world:exits:<room>`, so `setExit(room, direction, exit | null)` changes them during play, such as a collapsed tunnel, and undo and saves keep the change. A room is connected once; one changed during play must be connected, even with no exits, since objects can't be defined during play.
- Exits are one-way. A two-way way is connected on both sides, which also allows one-way chutes and trapdoors.
- `minutes` is data for the game clock (#84); nothing reads it yet.

### Directions

- Directions are a registry. The eight compass points, `up`, `down`, `in`, and `out` are built in, each with its opposite. `direction(name, { label, opposite })` adds a game's own, such as `fore` and `aft`.
- The `Directions` interface lists them for TypeScript, extended by declaration merging like core's `EventKinds`, so an exit in an unregistered direction is a type error and, in plain JavaScript, a runtime error.
- Exits are listed in registration order: the built-in ones, then the game's own.

### Doors and obstacles

- An exit can go `via` a thing that may block it. `obstacle` is a mixin with a `blocks(traveler)` method that returns why the way is blocked, or `undefined`. A thing spreads it in and gives its own `blocks`.
- `door` is `openable` with a `blocks` that says "The cellar door is locked." or "… is closed." Spread `lockable` in for a door that locks.
- A door is one thing that both rooms' exits name. It isn't in the containment tree; scope adds the doors and obstacles on a room's exits to what can be sensed in that room, so it's in scope from both sides, and opening it from one side opens it for both.
- A closed door blocks the way: nothing opens it implicitly yet. Actions (#76) can add "open the door first" as a rule.

### `{exits}`

- `{exits}` in a room passage shows the player's room's exits as ordinary links, each to the passage describing where it goes. A blocked exit's link is disabled with its reason, as a guard with a reason, so the inspector explains it like any link. An exit to a room the player has visited names the room: "North, to the library".
- An exit to a room no passage describes is an error when the links are shown.

### Which passage an exit leads to

- A room with one passage is entered through it. A room with several must tag exactly one `arrive`, as in `[room: hall, arrive]`; the world model's compiler check reports a room with none or several.
- The world model learns which passages describe each room when the game loads, through a new `register` runtime on tag roles, called as `register(value, { id, tags })` for each passage with the role.
- To call `register` at load, a role's value is now evaluated once when the game loads, as a constant of the passage module, and passed to both `register` and `arrival`. It's still copied from the tag as code, and checked as the runtime's first parameter, so its errors still point at the tag. This replaces ADR 0033's copy of the value inside the passage's enter effects.

## Consequences

- The compass (#81) reads `exitsOf` and `blockedReason`, and whether a room is visited for whether to name it.
- Travel time costs (#84) read `minutes`, and NPC travel (#137) walks exits.
- A role's value is now evaluated at load. For an export's name, as roles take, that's the same; a role whose value must be computed at arrival would compute it in its runtime instead.
- Generated room passage modules call world's `registerRoom` when imported, so the world model must be imported before them, which the scope module's imports guarantee.

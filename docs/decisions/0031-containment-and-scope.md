# 0031. Things, containment, scope, and light

- **Status:** Accepted, 2026-11-21
- **Issue:** [#62](https://github.com/loominate-if/loominate-if/issues/62)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0001](0001-repository-layout.md), [ADR 0006](0006-object-definitions.md)

## Context

The world model starts with objects in places: things, containers, surfaces, and locations, the tree of what's in what, and scope, what one thing can see, reach, or hear. Everything later in Phase 2 builds on these: rooms and exits, minds and bodies, perception, and actions. The design asks for TADS-style mixins rather than class hierarchies.

## Decision

### A new package

- The world model is `@loominate-if/world`, a runtime package on top of core (ADR 0001), so a game that doesn't import it never loads it. It depends only on core for now; presentation joins when it has widgets, such as the compass.
- It's marked private, so releases don't publish it until the world model is ready for authors. Its first publish will be by hand, then its trusted publisher is set up, as for any new package (ADR 0029).

### Containment

- Each thing stores one `location`: the thing or place it's in or on, or `null` for nowhere. Contents are computed by finding the things whose location is the parent. A thing can never be in two places, and a move is one change for undo, saves, and replays.
- Whether a thing is *in* or *on* its parent comes from the parent: containers and places hold things `in`, surfaces hold them `on`. A thing holds things in only one way.
- `move(thing, to)` checks only that the move makes structural sense: `to` holds things, a place isn't moved, and nothing goes inside itself. Whether a move is allowed, such as into a locked chest, is for actions (#76).
- Contents, scope, and every list are sorted by ID, so results never depend on the order things were defined or moved (design principle 4).

### Kinds are mixins

- `thing(id, definition)` and `place(id, definition)` build on core's `object()` (ADR 0006): the ID is stable, data properties are state, and methods have `this` typed. `thing()` defaults `location` to `null`; `place()` adds `holds: "in"` and `isDark: false`.
- Behaviors are mixins spread into a definition: `container`, `surface`, `openable`, `lockable`, `transparent`, and `lightSource`. A thing can combine them, such as a chest that's a container, opens, and locks, with methods of its own beside theirs. There are no classes to inherit from.
- Mixins mark what a thing can do with state, such as `holds`, `isOpen`, and `isTransparent`, which containment and scope read. A container that isn't `openable` is always open.
- Only things defined with `thing()` and `place()` are part of the world. Objects made during play from templates join it in a later task ([#272](https://github.com/loominate-if/loominate-if/issues/272)).

### Scope

Each sense spreads through the containment tree from the observer until something stops it:

- **Places** stop every sense: nothing is sensed from another place. Connections between places, such as seeing into the next room, come with rooms and regions (#63) and perception (#69).
- **Sight** is stopped by a closed container that isn't transparent, in either direction: from outside it, its contents can't be seen, and from inside it, nothing outside can.
- **Reach** is stopped by any closed container, transparent or not.
- **Hearing** isn't stopped by anything within the place.

`canSee`, `canReach`, and `canHear` answer for one target, and `inScope(observer, sense)` lists everything in scope, excluding the observer. Scope is computed from any thing, since actors and bodies come in #65.

### Light

- A place is lit unless it's `isDark`. A lit light source lights everything in sight of it, so light spreads exactly where sight does: through open and transparent containers and across surfaces, but not out of a closed opaque one.
- Without light, nothing can be seen. Since a lit source in sight would have lit the place, there's no separate rule for seeing light sources in the dark.
- Inside a closed opaque container, it's dark unless a light source inside is lit.
- Reaching and hearing don't need light.

## Consequences

- Scope looks at every thing for each question. That's fast enough for hand-written games; a game with thousands of things may need an index later, kept out of the state store.
- Perception (#69) decides what the player notices; it builds on these senses, and may add how far each reaches.
- `location` is an ordinary data property, so code can assign it directly, bypassing `move`'s checks. The containment functions guard against cycles all the same.

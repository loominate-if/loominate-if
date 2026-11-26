# 0127. Hidden exits

- **Status:** Accepted, 2026-11-26
- **Issue:** [#431](https://github.com/loominate-if/loominate-if/issues/431), part of [#393](https://github.com/loominate-if/loominate-if/issues/393)
- **Design:** [World model](../DESIGN.md#world-model), [ADR 0034](0034-exits-and-directions.md), [ADR 0126](0126-full-map.md)

## Context

The full map (ADR 0126) lists every exit of each visited room. An author asked for a way to keep an exit off it, as a secret passage, and chose that hiding it should hide it everywhere the player could learn of it, not only from the map.

## Decision

- **`hidden: true` on an exit's definition,** as `connect(library, { north: { to: vault, hidden: true } })`. It's stored with the exit, in state.
- **Revealed with `setExit`,** giving the exit without `hidden`. As any exit change, undo, saves, and replays follow it. Saves made before this have no `hidden` fields, which reads as not hidden, so they still load.
- **Hidden from the player everywhere:** the compass, the `{exits}` links, and the auto-map's drawing, list, and summary leave it out. Someone the player sees take it "leaves", with no way named, and can't be followed; someone arriving through it isn't said to come from that way, unless the player knows a way to where they came from.
- **Still a way for the game:** `exitsOf` lists it, marked `hidden`; characters' routes, travel time, and sound carrying use it. The map layout uses it too, so revealing it doesn't move rooms already drawn.
- **Shown to the author:** the story map's Rooms view labels it "(hidden)", and the World inspector tab lists each place's exits, hidden ones marked.

## Consequences

- A door or obstacle on a hidden exit is still a thing in the room, in scope and listed; an author makes it secret separately, if it would give the way away.
- A game's own UI built on `exitsOf` must filter hidden exits itself.

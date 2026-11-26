# 0128. Markers on the auto-map

- **Status:** Accepted, 2026-11-26
- **Issue:** [#396](https://github.com/loominate-if/loominate-if/issues/396), part of [#393](https://github.com/loominate-if/loominate-if/issues/393)
- **Design:** [World model](../DESIGN.md#world-model), [ADR 0035](0035-knowledge-and-facts.md), [ADR 0125](0125-auto-map.md), [ADR 0126](0126-full-map.md)

## Context

The epic (#393) asked for markers on the auto-map: things the author marks and people, where the player last saw them, which is what the player knows, not where they are; and stubs for unexplored exits. A mind remembered whether it had seen a thing, but not where.

## Decision

- **Every mind remembers where it last saw each thing:** `lastSaw(thing)` gives the room, or `undefined`. It's part of the mind's memories, so undo, saves, amnesia, and `forget` cover it as they do the rest, and any mind can be asked, not only the player's.
  - Arriving in a room, or noticing something, records the room for everything in sight.
  - Arriving in a room also forgets anything last seen there that isn't there now: the mind sees it's gone.
  - The player watching someone leave forgets where they are, as the player doesn't know where they went.
  - Saves from before have no sightings, which reads as none; nothing breaks.
- **What's marked:** people, by name, unless marked `onMap: false`; things marked `onMap`. What the player carries isn't marked. The marking is part of the definition, not state, like a room's pin:
  - `onMap: true` marks a thing by its name;
  - `onMap: "chest"` by a short label;
  - `onMap: { label, icon }` with an image's URL as well. The game supplies the images; none ship with Loominate.
- **Words always, icons optional:** each marker has words, which the room's tooltip, its spoken reading, and the full map's list use ("Last seen here: Tobias, chest."). The drawing shows a marker's icon if it has one, or a small mark, round for a person and a diamond for a thing, up to three a room and "+2" for the rest.
- **Stubs:** a short dashed line off a room toward each exit to a room the player hasn't been to, hidden exits left out. Up, down, in, and out point to the diagonals their rooms go beside, and are named on the full map.
- **Both maps** show markers and stubs; the small map's spoken summary is unchanged.
- **The inspector** shows, for each mind, where it last saw each thing.

## Consequences

- `story.ts` can't import an image yet, as the compiler doesn't know asset modules ([#434](https://github.com/loominate-if/loominate-if/issues/434)). Until then, an icon is a file in `public/` or a `data:` URL, which single-file builds need.
- A thing carried off by someone isn't known to have moved until the player sees its room again.
- Players' own notes on rooms are #397.

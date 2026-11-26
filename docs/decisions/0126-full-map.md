# 0126. The full map

- **Status:** Accepted, 2026-11-26
- **Issue:** [#395](https://github.com/loominate-if/loominate-if/issues/395), part of [#393](https://github.com/loominate-if/loominate-if/issues/393)
- **Design:** [Presentation](../DESIGN.md#presentation), [ADR 0125](0125-auto-map.md)

## Context

The small auto-map (ADR 0125) shows a window around the player, and to a screen reader it's one image with a summary. The epic (#393) asked for the whole map too, opened from the small one, scrollable when large, with tooltips, and with a keyboard-navigable list of the visited rooms, their known exits, and where they lead. Arrow keys were to move between rooms on the drawing, reading each.

## Decision

- **The small map opens it.** Given the whole map, the small map is a button, labelled with its summary, that opens the full map in a modal `<dialog>`, as the story log does. Escape or Close returns focus to it. Without the whole map, it stays an image.
- **The data stays plain.** `automapWidget` takes `full(game)`, which gives every room the player knows in cells, with links, and each room's ways out (`AutomapWay`: what it says, and the room it leads to if the player knows it). The world model supplies every visited room, on a grid just big enough for them.
- **The drawing has rooms to move between.** Each room is focusable, one at a time in the tab order, and read with its ways: "kitchen. West: the taproom. North: not explored." Focus starts on the player's room.
  - **Arrow keys move on the grid,** not along exits: to the nearest room within 45 degrees of that direction, straight ahead counting for more than across. Every room is within 45 degrees of some direction from any other, so every room can be reached, including rooms up a ladder or with no way between. Home goes back to the player's room.
  - **A tooltip** gives a room's full name, which its box may shorten, on hover and on focus.
  - **Large maps scroll**, and the room with focus scrolls into view.
- **The list beside it** names each room, the player's marked, with its ways: "East: the kitchen" to a room the player has been to, "North: not explored" to one they haven't. Choosing a room in the list moves focus to it on the drawing.
- **The words are messages:** `automap.way` in the world model; `automap.title`, `automap.keys`, `automap.rooms`, `automap.room`, `automap.here`, and `automap.close` in presentation.

## Consequences

- Every exit of a visited room is listed until authors can hide one; hidden exits are #431, which leaves them out of the map, the compass, and the exit links.
- Unexplored exits are only in the list for now; #396 draws them as stubs, with markers for things and people.
- Arrow keys on the grid don't say whether a way joins two rooms; the list and each room's reading do.

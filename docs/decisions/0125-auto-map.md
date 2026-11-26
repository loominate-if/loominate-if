# 0125. The auto-map

- **Status:** Accepted, 2026-11-25
- **Issue:** [#394](https://github.com/loominate-if/loominate-if/issues/394), part of [#393](https://github.com/loominate-if/loominate-if/issues/393)
- **Design:** [Presentation](../DESIGN.md#presentation), [World model](../DESIGN.md#world-model), [ADR 0063](0063-compass.md), [ADR 0124](0124-rooms-on-the-story-map.md)

## Context

The design lists an auto-map among the widgets, and the epic (#393) settled its shape:
- an opt-in widget showing the rooms around the player;
- visited rooms only;
- a grid from compass directions, north up;
- author pins for exits that don't fit;
- nudged clashes flagged in dev;
- accessible by default.

The story map's Rooms view (ADR 0124) already lays rooms out on such a grid.

## Decision

- **Like the compass:** presentation draws a generic `automapWidget` from plain data: rooms in cells, links between them, and a summary. The world model supplies it from game state each time it's drawn, so undo, saves, and replays agree. It registers it as `automap` for a game to place, as with `addToHeader("automap")`, and `automap({ columns, rows })` changes the window.
- **One layout for both maps:** the world's `_worldMap()` lays out every room with exits, with `gridLayout` (ADR 0124), and both the Rooms view and the auto-map use it.
  - **Anchor:** the room the player's body starts in by definition. That's read from the objects' defaults in an empty store, so rooms stay in place as the player moves, and after a save is loaded.
  - **Pins:** `place("hall", { map: { x: 2, y: 0 } })` puts a room in a cell, x to the east and y to the south from the anchor. It's kept as part of the definition, not state. Pinned rooms are placed first, and the layout walks on from them as from any room.
- **The small map** is a window five cells across and three down, centred on the player's room.
  - **Rooms:** only rooms the player has visited are drawn; their places come from the whole map, so they don't move as it grows. The player's room is marked.
  - **Ways:** a two-way way is one line, and a one-way exit has an arrow. A way that isn't a compass step is drawn dashed and named, as "Up / Down", read from the room met first. Ways to rooms just outside the window run off its edge.
- **For a screen reader,** the small map is one image (`role="img"`) labelled with a summary: where the player is, and the visited rooms next to it, as "Map: you're in the taproom. Visited nearby: the kitchen to the east, the landing upstairs." The words are messages (`automap.summary`, `automap.nearby`), so a game can reword them. Browsing room by room comes with the full map (#395).
- **Nudged rooms are flagged for the author, never the player:**
  - the story map's Rooms view tags them in its outline, with the pin that keeps them where they are;
  - the World inspector tab shows each place's cell, and whether it was nudged or pinned.

## Consequences

- The full map, opened from the small one, with its accessible list, is #395; markers for things, people, and unexplored exits are #396; players' notes are #397.
- The layout is computed each time the map is drawn. Games of a few hundred rooms are quick; larger ones may want caching keyed to exits changing.
- A game's own directions put their room to the east of the one they lead from. A game can pin rooms where that isn't right.

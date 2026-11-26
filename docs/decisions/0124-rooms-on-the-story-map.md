# 0124. Rooms on the story map

- **Status:** Accepted, 2026-11-25
- **Issue:** [#426](https://github.com/loominate-if/loominate-if/issues/426)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0123](0123-story-map.md), [the auto-map epic](https://github.com/loominate-if/loominate-if/issues/393)

## Context

The story map (ADR 0123) draws passages from the compiler's output. The design asks for rooms too. Rooms and exits are written in TypeScript, as `connect(hall, { north: library, down: { to: cellar, via: trapdoor } })`, often through helpers or loops, so reading them from the code would miss some, and would know rooms only by their variable names. The auto-map (#393) needs rooms on a grid by compass direction as well.

## Decision

- **From the running game,** as `loominate coverage` reads its checks. A new core registry, `mapViews`, holds views packages add. Each gives nodes (with optional grid cells) and edges from the begun game. The CLI begins the game once in Node and reads every registered view:
  - `loominate map` does this through a Vite server of its own;
  - the dev server uses a fresh module runner on each request, so the world's module-level registries start clean each time.
  - If the game can't load, or can't begin, a view says why, and the Passages view still shows.
- **The world model's Rooms view:**
  - **Rooms:** every room with exits, and every room an exit leads to, by name. The start is the room the player's body is in when the game begins. Rooms are tagged with their room passages.
  - **Exits:** each edge has its direction's label, "through the" its door when there is one, and is marked guarded when there's a door.
  - **Order:** nodes come in the order a player meets them, from the start along the exits.
- **On a grid by compass,** with `gridLayout` in the world model, plain data in and out, which the auto-map reuses:
  - The start is at (0, 0). Each room is one step from the room it's first reached from, walking compass exits breadth first, each room's own exits before other rooms' exits into it.
  - Up, down, in, and out put their room beside the one they lead from, to the northeast, southeast, northwest, and southwest; a game's own directions put it to the east. Those exits are drawn after the compass ones, so they don't take a compass room's cell.
  - A room whose cell is taken goes to the nearest free one, and is listed as nudged.
  - Groups not reached from the start go to the right.
  - Exits that don't run one step in their direction are marked bent.
- **Drawing a grid view:** the CLI puts each room in its cell, with ways straight between them. A bent way between neighbouring cells stays straight, and others curve around through a point off to the side. The viewer draws a way both directions as one line without arrows, labels bent ways with their directions ("up / down", read from the room met first), and in the outline lists a room's **Exits** by direction and only its **one-way** ways in.
- **The view in the address:** the viewer opens on the view named in the page's address (`#rooms`), and keeps the address in step as the reader chooses, so a link can point at a view.

## Consequences

- The map shows exits as the game begins. Exits added or changed in play (`setExit`) appear as they start.
- Pins (`place(…, { map: { x, y } })`) and flagging nudged rooms in dev come with the auto-map (#394), on the same layout.
- Reading the views costs a game load each time the map is drawn, which is quick for games of a few hundred rooms. Larger ones may want caching keyed to the session's changes.

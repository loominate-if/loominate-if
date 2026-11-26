# The story map

The story map draws your game's passages and the ways between them, the overview Twine shows in its editor. It's built from what the compiler reads, so it's always the game as written.

## Opening it

While `loominate dev` runs, open the **Story map** address it prints, `/__loominate/map` on the dev server. The map redraws each time you save a passage file or `story.ts`, keeping your place.

To keep or share a map, write it as one HTML file that opens by double-click:

```sh
npx loominate map
```

This writes `dist/story-map.html`. `--out` writes it somewhere else, as `npx loominate map --out map.html`. The map is drawn even when the game has errors, since a link to a missing passage is something it shows.

## Reading it

- **Boxes** are passages. The start is at the top, marked ▶. A passage nothing leads to has an amber dashed outline, and a passage that's linked to but doesn't exist has a red one.
- **Arrows** are links and passage targets, as `{continue -> Platform}`. A dashed arrow is a guarded link, which `{when …}` can hide or disable. A dotted one is inside an `{if}`, so it's there only sometimes.
- **The outline** beside the picture lists the same passages, from the start along the links, then any nothing reaches. Each passage lists what it leads to and what it's reached from, with each link's label, and its file and line.

Pan by dragging the picture, and zoom with the mouse wheel or the **−**, **Fit**, and **+** buttons.

## Rooms

A game that uses the world model has a second view, **Rooms**, chosen with the buttons at the top (or by adding `#rooms` to the map's address). It shows every room with exits, by name, as a hand-drawn map would:

- **North is up and east is right.** The room the player starts in is marked ▶, and each room steps from the last in its exit's direction.
- **A way both directions is one line.** A one-way exit has an arrow, and an exit through a door is dashed.
- **Up, down, in, and out** put their room beside the one they lead from (up to the northeast, down to the southeast, in to the northwest, out to the southwest), with the way written on the line, as "up / down". So does a direction of your own, such as `fore`.
- **Rooms that would land on the same spot** move to the nearest free one, and their exit is drawn curved.
- **Rooms not reached from the start** are drawn to the right.

In the outline, each room lists its **Exits** by direction, as "North: library" or "Down, through the trapdoor: cellar", and any room with a **one-way** exit into it. A room described by a passage says so, as "passage: Cellar".

The rooms are read from the game itself: the map begins it once, as `loominate coverage` does, so exits made in loops or helpers are there too. They're the exits when the game begins; exits that change in play, with `setExit`, show as they start. If the game can't begin, the Rooms view says why, and the Passages view still works.

## By keyboard and screen reader

The outline is the map for keyboards and screen readers. The picture is hidden from screen readers and follows the outline.

- **Each passage or room** is a heading, so a screen reader's heading navigation moves between them.
- **Following a link:** each name under "Leads to" and "Reached from" is a button. It moves focus to that passage's heading, and the picture moves to it.
- **Opening a passage** in your editor: in the dev server, each passage has an **Open** button, which opens its file at its line in the editor Vite finds (set the `LAUNCH_EDITOR` environment variable to choose one). A standalone map shows the file and line instead.
- **Updates** after an edit are announced politely ("Map updated"), and focus stays where it was.

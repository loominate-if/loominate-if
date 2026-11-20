# The inspector

The inspector is a panel beside your game that shows what's going on inside it. `npm run dev` adds it to every game. [ADR 0028](../decisions/0028-inspector-shell.md) records the decisions behind this guide.

## Opening it

Click **Inspector** in the bottom corner of the page, or press Control+\` (Control and the backquote key) anywhere. The panel opens on the right and the game narrows beside it. On a narrow window it covers the game instead. **Close**, Escape, or Control+\` again closes it. It stays open when the page reloads after an edit.

## The state tree

The **State** tab lists every object in your game with every property, as it is now:

- Objects come first, sorted by ID: those in `story.ts`, objects from packages you use (such as `loominate:display`, presentation's display settings), and objects created during play, with the template they came from.
- Values still at their default from the object's definition are dimmed. A reference to another object shows as an arrow, `→ shed`.
- What your last move changed is highlighted, so you can see what a choice did.
- **Engine state**, at the end, is what the story engine keeps: the current passage, visit counts, the random streams, and the move history.
- Type in the filter box to show only objects whose ID contains what you type.

The tree only shows the game; it never changes it.

## The event log

The **Events** tab lists everything the game has recorded, oldest first: each passage's prose as the player read it, moves between passages, the effects that ran (`{on enter: …}` and the like), beats the player moved past, and anything your code `emit`s.

- Each row shows the event's number, its kind, and a summary. Open a row to see all its fields.
- What your last move added is highlighted. An undo takes its events back out of the log.
- **Kinds** narrows the log to the kinds you choose. **Tags** shows events that have every tag you choose; tags come from code that emits events, as in `emit("system", { text: "The lamp is lit." }, ["lamp"])`.
- A long game shows its latest 500 events, and says how many there are in all.

## In a build

An ordinary `npm run build` leaves the inspector out entirely. To include it, for example in a build for testers, run:

```sh
npx loominate build --inspector
```

## Panels

Each tab is a panel registered in `panels`, from `@loominate-if/inspector`, and packages such as the world model will add their own tabs this way. A panel has a title, and a `mount` function that draws it and returns `update()`, which the inspector calls when the game changes while the tab is showing:

<!-- example: packages/inspector/src/inspect.test.ts#where-panel -->
```ts
panels.register("where", {
  title: "Where",
  mount(element, { player }) {
    const update = () => {
      element.textContent = `At ${player.story?.current ?? "nowhere yet"}`;
    };
    update();
    return { update };
  },
});
```

The panel's element is inside the inspector's shadow root, so the game's styles don't reach it.

Registering a panel imports the inspector, so a game module that does it would carry the inspector into every build. A way for games and packages to add panels only where the inspector is loaded comes with [#188](https://github.com/loominate-if/loominate-if/issues/188).

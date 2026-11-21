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

The **Events** tab lists everything the game has recorded, oldest first: each passage's prose as the player read it, moves between passages, the effects that ran (`{on enter: …}` and the like), and beats the player moved past.

- Each row shows the event's number, its kind, and a summary. Open a row to see all its fields.
- What your last move added is highlighted. An undo takes its events back out of the log.
- **Kinds** narrows the log to the kinds you choose.
- **Tags** shows events that have every tag you choose. It appears once some event has tags. The events Loominate records have none yet, and passages can't record events of their own yet ([#261](https://github.com/loominate-if/loominate-if/issues/261)); until then, tags come from extensions that record events.
- A long game shows its latest 500 events, and says how many there are in all.

## Why a choice is hidden

The **Choices** tab lists every choice where the player is: the links and continue points that can be followed, and those that can't. For each one that can't, it shows:

- whether the player sees it **disabled** or it's **hidden**;
- the condition from its `{when …}` that doesn't hold;
- the value of each part of that condition, so you can see which part closed it. For `{when lamp.lit && lamp.oil > 0}`, it shows `lamp.lit`, `lamp.oil > 0`, and `lamp.oil`, with values that make a condition false highlighted. A part that can't be read on its own, such as `door.open` in `door && door.open` when there's no door, says why;
- what the player is told, for a link with a `reason:`.

## Which rules ran

The **Rules** tab shows, for each turn, the rulebooks and hooks that ran and every rule in them: its name, the package that added it (`game` for your own), and what it did. A decide rule *passed* or *decided*; a fold rule *changed the value*, *left it as it was*, or *settled* it; a hook's rules *ran*. The rule that settled a result is in bold.

- A turn ends at each move, undo, jump through history, and new or loaded game. **Start** is what ran as the game began.
- Rulebooks and hooks that ran with no rules are listed in one line, such as "With no rules: passageLeave, turnEnd".
- What an autosave ran is listed with the turn it saved.
- The tab keeps the last 50 turns. It starts afresh when the page reloads, since the trace isn't part of the game's state.

## Going back in time

The **History** tab lists every move in the game, from **Start**, with the passage each one reached. Select a move to jump to just after it; select a later one to jump forward again. Jumping uses the game's undo history, so the game comes back exactly as it was.

- Open a move's changes to see the properties it set, such as `lamp.lit default → true`. "default" means the property hadn't changed from its starting value.
- After jumping back, a new move discards the moves ahead, as undo does. The tab says how many moves that would be.
- The game autosaves where you jump to, so a reload carries on from there. The moves ahead are gone after a reload.
- What ran before the first move, the start passage's own effects, can't be undone, so **Start** is the earliest you can go.

## Replaying a bug report

The **Replay** tab plays a replay file: the game's seed and every move the player made, small enough to attach to a bug report.

- **Download replay** saves the game you're playing as `<game id>-replay.json`.
- **Open replay…** starts a new game from a replay file and goes to its start. **Next** and **Back** step through its moves, and the tab says what the next one is; the History tab lists them too.
- If a move in the replay can't be made, for example because a link was renamed since, the replay stops before it and the tab says which move and why. It also says when the replay was made with another version of the game or engine, the likeliest cause.
- The replay plays against the persistent data (achievements, settings) it began with, not yours.
- Making a move of your own leaves the replay; open the file again to go back to it.

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

The Choices tab is built the same way: each kind of choice has an explainer in `explainers`, which lists the choices of that kind on offer now and says why any can't be made. Links are the first; the world model will add its actions and conversation topics.

The Rules tab hears about rule runs through core's `traceRules(listener)`, which tools of your own can use too.

### Adding your own

Registering a panel or an explainer imports the inspector, so do it in an **inspector module**, which is loaded only where the inspector is: in `loominate dev`, and in `loominate build --inspector`. A build without the inspector carries none of it. Name your game's module in `loominate.config.ts`:

```ts
export default defineConfig({
  game: { id: "my-game", version: "0.1.0" },
  start: "Start",
  inspector: "inspector.ts",
});
```

Then create `inspector.ts` beside it, starting with this import, and put each `panels.register(...)` call from above after it:

```ts
import { panels } from "@loominate-if/inspector";
```

Install the inspector as a dev dependency (`npm install -D @loominate-if/inspector`): your game's type check covers this module too, and reports the import as missing without it.

A package does the same in its package.json, beside its compiler extension if it has one, and is listed in the game's `extensions` as usual:

```json
"loominate": {
  "extension": "./dist/extension.js",
  "inspector": "./dist/inspector.js"
}
```

Packages' modules load in the order `extensions` lists them, then the game's own.

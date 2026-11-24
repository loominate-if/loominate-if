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

The **Events** tab lists everything the game has recorded, oldest first: each passage's prose as the player read it, moves between passages, the effects that ran (`{on enter: …}` and the like), beats the player moved past, and events you record yourself.

- Each row shows the event's number, its kind, and a summary. Open a row to see all its fields.
- What your last move added is highlighted. An undo takes its events back out of the log.
- **Kinds** narrows the log to the kinds you choose.
- **Tags** shows events that have every tag you choose. Every event recorded in a passage carries the passage's tags, so choosing `scene` shows everything that happened in your `[scene]` passages.
- A long game shows its latest 500 events, and says how many there are in all.

### Recording your own

Record an event to mark something in the log, such as a clue found or a ship that turned, and tag it so it's easy to find. In a passage, `{emit …}` records one when the player reaches it, and `emit(…)` does the same in effect code:

<!-- example: packages/compiler/src/modules/fixtures/lamp-room.weft#Lamp Room -->
```weft
:: Lamp Room [scene]
{on enter: lamp.light()}
{emit "Wind howls.", tags: storm}
The lamp room.
{beat 1s}
{emit "The ship turns.", kind: scene, tags: ship storm}
{on enter: if (visits === 1) emit("system", { text: "First time up here." }, ["first"])}
Far out, lights.
```

- `{emit "Wind howls.", tags: storm}` records a `system` event with the text and the tag `storm`. Give `kind:` to record another kind of text: `narrative`, `scene`, `dialogue`, or `action-result`. The page shows a move's `action-result` and `perception` events after the passage's text, before its choices; the others go to the story so far.
- Written after a beat, it records when the player reaches that part, just as code there runs then. It never records when the passage is only shown.
- `emit(kind, fields, tags)` takes any kind of event, including ones a package adds, and its fields are type-checked. Use it in `{on enter: …}` and the other effect phases; in shown text it's an error, because showing a passage can't change anything.
- Each of these events also has the passage's tags, first: the ship turning is tagged `scene`, `ship`, and `storm`.

Code in `story.ts` records events with `emit` from `@loominate-if/core`, and they get the tags of the passage the player is in:

<!-- example: packages/core/src/events/tags.test.ts#bell -->
```ts
const bell = object("bell", {
  rung: 0,
  ring() {
    this.rung += 1;
    emit("system", { text: "The bell rings." }, ["bell"]);
  },
});
```

A walkthrough test can check them through `game.record`:

<!-- example: packages/testing/src/play.test.ts#events -->
```ts
game.choose("Light the lamp");
const lit = game.record.events({ kinds: ["system"], tags: ["lamp"] });
expect(lit.map((e) => e.text)).toEqual(["The lamp is lit."]);
```

Events are part of the game's state, so undo takes them back, saves keep them, and a replay records them again. They show in the log, not on the page; showing `system` messages to the player is [#270](https://github.com/loominate-if/loominate-if/issues/270).

## Why a choice is hidden

The **Choices** tab lists every choice where the player is: the links and continue points that can be followed, and those that can't. For each one that can't, it shows:

- whether the player sees it **disabled** or it's **hidden**;
- the condition from its `{when …}` that doesn't hold;
- the value of each part of that condition, so you can see which part closed it. For `{when lamp.lit && lamp.oil > 0}`, it shows `lamp.lit`, `lamp.oil > 0`, and `lamp.oil`, with values that make a condition false highlighted. A part that can't be read on its own, such as `door.open` in `door && door.open` when there's no door, says why;
- what the player is told, for a link with a `reason:`.

Its **Actions** section lists the actions on things' menus: those of the things with a `{menu …}` link in the passage, and, with the world model, everything else the player can reach or carries. An action with more than one thing is listed once. For each action that can't be taken, and each action link, it says whether verify hid it or check disabled it, the reason, and the rule that decided, with its rulebook and the package that added it: "Decided by the verify rule `things in reach` in `every action: verify`, from @loominate-if/world." An action's own rules are named after it, such as `open: own`, and come from the package its `source:` names, or `game`.

With the world model, a **Topics** section lists the topic entries of everyone the player is talking to, or, when they aren't talking, of everyone in the room. For each it says whether it would answer now, and if not, why: its condition is false, its actor state isn't current, its scene isn't happening, it's only for an unprompted goodbye, or another entry outranks it, by name: "Outranked by butler:mind:ask:letter#2."

Its **Storylets** section, in a game with storylets, lists each one with its deck, priority, and place in the order, and while one isn't eligible, why: the named tests in its `when` that don't hold, that it's once only and has been seen, or how long it has left to rest. The [storylets guide](storylets.md) has more.

## Which rules ran

The **Rules** tab shows, for each turn, the rulebooks and hooks that ran and every rule in them: its name, the package that added it (`game` for your own), and what it did. A decide rule *passed* or *decided*; a fold rule *changed the value*, *left it as it was*, or *settled* it; a hook's rules *ran*. The rule that settled a result is in bold.

- A turn ends at each move, undo, jump through history, and new or loaded game. **Start** is what ran as the game began.
- Rulebooks and hooks that ran with no rules are listed in one line, such as "With no rules: passageLeave, turnEnd".
- What an autosave ran is listed with the turn it saved.
- The tab keeps the last 50 turns. It starts afresh when the page reloads, since the trace isn't part of the game's state.

## Fuses and daemons

With the world model, a **Fuses and daemons** tab lists every fuse and daemon in the order they were defined. For each, it shows:

- whether it's a fuse or a daemon;
- its state: **Running**, **Not started**, **Fired** (a fuse that went off), **Cancelled** (a fuse that was), or **Stopped** (a daemon that was);
- when it fires next, as the time of day or the move, and how long until then;
- its timing, such as "after 30 minutes" or "every 2 moves", and what's special about it: whether it interrupts, stands out, has a priority, or joins a group's sentence;
- where it comes from: `game`, or the package its `source:` names.

It's the world model's own inspector module, so games that don't use the world model don't have it.

## Stats

With the world model, a **Stats** tab lists every body's stats: base, and now with modifiers applied, and each modifier's source and when it wears off. A mental stat names the mind it comes from, the one in the body now.

## NPCs

With the world model, an **NPCs** tab has a row for each NPC, the player aside:

- **Where** they are, and their **level**: observed only, scheduled (they have a timetable), or simulated.
- **Turn now:** whether they'll take a turn after the next move, and why: simulated, busy with an agenda item, seen or heard by the player, or out of sight.
- **Agenda:** each item, with its priority, whether it's active and ready, and which acts next.
- **Timetable:** the entry they're in now, and the next to begin, with when.

Below it, a **Timeline** lists what NPCs did, newest first: each action, done or refused and why, each move their timetable made, and each time they caught up. It shows what happened offstage; **Include what the player saw** adds the rest. These are `npc` events in the event record, which the page never shows, so the Events tab lists them too, and undo, saves, and replays keep them.

## Conversation

With the world model, a **Conversation** tab shows the conversation and the topics behind it.

- **Now:** who the player is talking to, which of them is addressed, each one's open node and whether it's restrictive, the exit (free, soft, or hard), and each lock, with its level, what holds it (an NPC, or an NPC's node, as "the maid's node tea"), and its reason. With no conversation, it says so.
- **Topics:** every topic entry of the character chosen in **Topics of**, the person addressed at first, or anyone with entries. For each:
  - **What it answers,** as "Ask the maid about the gold", its ID (a block's is its first paragraph's line ID, as `Maid:3f2a9c`), and its scope, priority, and options, such as `again`, `opens: tea`, or `reveals: butlerSawThief`.
  - **When:** its condition as written, a block's `when:` with each part's value, or a TypeScript entry's function, with its value now.
  - **Answers now:** whether it would answer now, and if not, why: its condition, its state or scene or node, another entry outranking it, or a restrictive node holding it up.
  - **Suggested now:** whether `{topics}` and conversation mode offer it now, and if not, why: the player isn't talking to them, or they aren't the one addressed; it's a greeting, goodbye, or catch-all; it says `suggested: false`; the player doesn't know of the subject, or isn't carrying the thing; another entry answers it; or a restrictive node is open.

## The world

With the world model, a **World** tab shows the world as a tree: each place, with what's in it nested under it, then what's out of the world, and minds with no body. A body shows the mind in it now, and a stack its count. The tree starts open on the place the player is in, and keeps what you've opened as the game moves. **Show the player** opens the way to them again.

- **Moving through it:** the up and down arrow keys move. Right opens a node, or moves into it, and Left closes it, or moves to what holds it. Home and End go to the first and last node.
- **Details:** Enter, Space, or a click chooses a node, and its details show beside the tree:
  - what it's in, out to its place;
  - for a body, the mind in it, and for a mind, its body;
  - its properties.
- **What a mind knows:** for a mind, or a body with a mind in it, the facts it knows, with where it learned each, the things it has seen, and the things it knows of without having seen them.
- **Who knows of a thing:** for a thing, which minds have seen it and which know of it.
- **Jumping:** a name in the details is a button that goes to that node in the tree.

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

The Choices tab is built the same way: each kind of choice has an explainer in `explainers`, which lists the choices of that kind on offer now and says why any can't be made. Links are the first and things' actions the second; the world model adds conversation topics. The world model adds its Fuses and daemons panel from an inspector module of its own.

The Rules tab hears about rule runs through core's `traceRules(listener)`, which tools of your own can use too.

A package's inspector module is the one part of it that may import `@loominate-if/inspector`, as an optional peer dependency, so a game that doesn't use the inspector never installs or builds it. It lives in a folder of its own under `src`, named by `"loominate": { "inspector": "./dist/<folder>/inspector.js" }`. The layering check makes sure nothing else in the package imports the inspector.

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

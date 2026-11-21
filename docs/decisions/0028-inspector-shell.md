# 0028. The inspector shell and state tree

- **Status:** Accepted, 2026-11-20
- **Issue:** [#45](https://github.com/loominate-if/loominate-if/issues/45), with the panel registry from [#188](https://github.com/loominate-if/loominate-if/issues/188)
- **Design:** [Tooling](../DESIGN.md#tooling), [ADR 0001](0001-repository-layout.md)

## Context

The inspector is an in-game debugging panel. Its first view is the state tree: every object and every property. Later panels show the event log, why choices are hidden, fired rules, and time travel, and optional packages such as the world model add their own. It has to be there while a game is developed and cost nothing in a released one (ADR 0001, rule 5).

The state store holds only values that differ from an object's defaults, which live in the object's definition. A tree built from the store alone leaves out every object that hasn't changed.

## Decision

### Where it shows

- The inspector is a panel docked to the side of the page. When the window is at least 48rem wide it narrows the game beside it, so both stay usable; on narrower windows it covers the game.
- A button in the corner and Control with the backquote key (Control+\`) open and close it. Escape closes it from inside, and focus returns to where it was. It stays open through a reload in the same tab.
- It's drawn in a shadow root, so the game's styles and the inspector's don't affect each other.

### When it's included

- `loominate dev` adds it to the generated entry point for every game. `loominate build --inspector` includes it in a build, for example one for testers. An ordinary build carries none of its code.
- The CLI resolves the inspector from the game if the game installed it, and otherwise uses its own copy, so games needn't install it. Builds and the dev server dedupe `@loominate-if/core` and `@loominate-if/presentation`, so the game, its extensions, and the inspector share one copy of objects and registries.

### Panels

- Each tab is a panel in the `panels` registry: a title, and `mount(element, { player })` returning a view with `update()`. The inspector's own state tree is registered there the same way an optional package registers its panels, so the inspector never depends on them.
- A panel is drawn the first time its tab is shown and updated when the game changes while it's showing, or when it's shown again. A panel that throws shows an error in its tab, and the others carry on.
- `Player.onChange(listener)` in presentation tells the inspector when the game changes: a new or loaded game, each move, and each undo. `Player.store` gives the store of the game in play.

### The state tree

- Core's public `describeObjects(store)` lists every object, those defined in code and those created during play, with every data property, its value, and whether it's still the default. The tree shows those objects first, sorted by ID, with values still at their default dimmed and references to other objects as arrows. The engine's own state, under IDs starting with `$`, follows in a collapsed group.
- What changed since the panel last updated is highlighted, and announced as "changed" to screen readers. A new or loaded game marks nothing.
- The tree is read-only. An ID filter narrows it.

### The event log

Added with [#46](https://github.com/loominate-if/loominate-if/issues/46).

- The **Events** panel lists the event record oldest first, reading it with `createEventRecord(player.store)`, so it needs nothing more from the player. Each row has the event's `seq`, kind, a one-line summary, and its tags; opening a row shows every field.
- Filters choose kinds and tags. As in core's `EventQuery`, an event must have every chosen tag, and must be one of the chosen kinds. Core's own events carry no tags yet, and passage code can't record events yet ([#261](https://github.com/loominate-if/loominate-if/issues/261)), so filtering by kind is how to narrow the log for now.
- Events added since the panel last updated are marked; after an undo, nothing is. The panel draws the latest 500 matching events and counts the rest, so a long game stays quick to inspect.

### Why a choice is hidden

Added with [#47](https://github.com/loominate-if/loominate-if/issues/47).

- The **Choices** panel lists the choices where the player is, from each explainer in the `explainers` registry ([#188](https://github.com/loominate-if/loominate-if/issues/188)). An explainer has a title and `explain({ player })`, returning each choice of its kind with whether it's available and, if not, whether it's hidden or disabled, the condition, the condition's parts, and the reason the player is told. Core's links and continue points are the first explainer; the world model and kits add theirs for actions and topics.
- So the panel can show which part of a condition closed a link, the compiler passes each `condition` argument with a `parts()` function beside its value and text. It splits the condition at `&&`, `||`, `??`, `!`, `?:`, and parentheses, and lists each comparison with its sides that aren't literals. Core's `linkGuard` calls `parts()` only when the guard is closed, and records each part's value as the inspector writes it (`→ lamp` for an object), or the error it threw, on `LinkGuard.parts`.
- A part on its own can fail to type-check where the whole condition doesn't: `door.open` loses the narrowing that `door &&` gave it. The condition as written is type-checked as before, and its parts' copies aren't checked again; they're evaluated with errors caught, and an error is shown as the part's explanation.

### Which rules ran

Added with [#48](https://github.com/loominate-if/loominate-if/issues/48).

- Core's `traceRules(listener)` calls listeners after every rulebook and hook run with a `RuleRun`: its name and kind, each rule's step (name, source package, outcome), and the rule that decided, if one did. Runs started with `explain` aren't reported. A listener that throws is ignored, and with no listeners nothing extra happens, so tracing never changes how a game plays.
- The trace is kept in memory by the inspector, not in the state store, so saves, undo, and replays are unchanged. The cost is that it starts afresh on each page load.
- The **Rules** panel groups runs into turns, ending one at each `onChange`, and keeps the last 50. The inspector starts tracing when its module loads, which in `loominate dev` is before the game starts, so the start's rules are its first turn. Autosave runs the `save` hook after the turn it saves has ended, so `save` runs join the latest turn.

### Time travel

Added with [#49](https://github.com/loominate-if/loominate-if/issues/49).

- The **History** panel moves the game through the player's own undo history rather than keeping snapshots of its own: undo already stores every move as a diff, and going back and forward through diffs lands on exactly the same state.
- `Player.history` lists the moves that can be undone and redone, each labeled with its move (a link's label, "Continue", "Next page", "After a beat"). `Player.travel(steps)` goes back or forward that many moves as one change: one redraw, one autosave, and one `onChange`. Going past either end throws a `RangeError`.
- A new move after jumping back drops the moves ahead, as undo does. Keeping them as a branch would need a tree of diffs in core's history; the panel says how many moves a new move would discard instead.
- Each move lists the object properties it changed, drawn when opened, and names the engine state it changed (such as `$events`) without listing it.

## Consequences

- `describeObjects` is public, so world and kit panels can show objects the same way.
- A game run by `loominate dev` always has the inspector; the toggle button is visible in a corner of the page during development.
- Editing values from the tree is left for later (#258), as is loading replay files (#50).

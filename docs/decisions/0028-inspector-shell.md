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

## Consequences

- `describeObjects` is public, so world and kit panels can show objects the same way.
- A game run by `loominate dev` always has the inspector; the toggle button is visible in a corner of the page during development.
- Editing values from the tree is left for later, as is everything in the other inspector issues (#46–#50) and the explanation providers in #188.

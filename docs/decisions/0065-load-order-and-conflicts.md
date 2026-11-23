# 0065. Runtime load order, and conflicts found before the game runs

- **Status:** Accepted, 2026-11-24
- **Issue:** [#74](https://github.com/loominate-if/loominate-if/issues/74)
- **Design:** [Extensibility](../DESIGN.md#extensibility), [ADR 0012](0012-rulebooks-hooks-registries.md), [ADR 0015](0015-compiler-extensions.md), [ADR 0023](0023-game-config-and-cli-commands.md)

## Context

Extensions are npm packages that register rules, widgets, effects, and the like. Load order should be explicit, and conflicting registrations reported at compile time, so meaning never depends on load order.

The config's `extensions` list already ordered compiler extensions and inspector modules. But at runtime, packages loaded in whatever order the game's code imported them. The compiler already refused clashing syntax. A runtime registration under a taken name (in a registry, a rulebook, the actions, or the world model's fuses, scenes, journeys, and holidays) already threw, but only as the game started, in the browser.

## Decision

- **Runtime order:** the config's list sets the runtime order too. The game's generated entry imports each listed package that has a runtime entry (a `main`, or a `"."` export) first, in the order listed, before the game's passages and so before `story.ts`.
- **Recognising a clash:** registering a name that's taken throws core's `NameTaken`, a `StateError` marked `taken`, at every such place in core and the world model. Tools can tell a clash from other mistakes by the mark, whichever copy of core threw it.
- **Finding it before the game runs:** before a build, and as `loominate dev` starts, the CLI loads the listed packages and then the scope module in Node, through a Vite server in middleware mode with everything transformed, in the game's order. If one throws `NameTaken`, it's reported naming the package (and where the config lists it), or `story.ts`, with the message naming the one that registered the name first. It's an error: the build doesn't start, and the dev server says so in the terminal.
  - Anything else that fails loading code in Node, such as code that needs a browser, isn't reported here. The page reports it, where the code really runs.
  - Passages aren't loaded: they register only rooms, which can't clash.
- **Taking a name over on purpose** uses `replace()`, which isn't a clash.

## Consequences

- A build or dev start costs one extra load of the game's packages in Node, about a second for a game using the world model.
- The order is written down in one place for the compiler, the inspector, and the game alike.

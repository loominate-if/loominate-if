# 0012. Rulebooks, hooks, and registries

- **Status:** Accepted, 2026-11-18
- **Issue:** [#26](https://github.com/loominate-if/loominate-if/issues/26)
- **Design:** [Extensibility](../DESIGN.md#extensibility), design principles 5 (explainable) and 7 (open library)

## Context

Library behavior must be built from the same mechanisms authors use: named rules in rulebooks that can be inserted before or after others, replaced, or removed; typed lifecycle hooks; and name-keyed registries. The inspector shows which rule fired and which package added it. The design leaves open how rules are collected, how a rulebook decides its result, how order is settled, and where hooks fire.

## Decision

### Module-level handles

- Rulebooks, hooks, and registries are module-level handles, like random streams (ADR 0008) and objects (ADR 0006): `export const damage = rulebook("damage", { kind: "fold" })`. Packages add rules when their modules load.
- They hold behavior, not state, so they live outside the state store. Anything a rule changes still goes through the store.
- Names are global and unique within each kind, so the inspector can never confuse two.
- Every rule and registry entry records its `source` package; it defaults to `"game"`, the author's own code. A replacement records who replaced it.

### Two kinds of rulebook

Each rulebook picks its kind when it's made:

- **`decide`**, after Inform 7: rules run in order; a rule returning `undefined` lets the next run, and the first to return a value settles the result. If none does, the result is `otherwise(input)`, or `undefined` without one. For questions such as "can the player take this?".
- **`fold`**: each rule takes the value from the one before and returns the next, so a calculation builds up rule by rule (base damage, plus strength, times a critical hit). A rule settles the result early by returning `stop(value)`, with the `stop` it's given. Only `stop` makes a stop, so no value is mistaken for one.

`explain()` runs a rulebook as `run()` does and also returns what each rule did (`continued`, `decided`, `changed`, `unchanged`, `stopped`) and which rule settled the result.

### Order

- Rules without placements run in the order they were added, which follows module import order. ES module evaluation order is fixed by the import graph, so the order is the same on every run, in every engine.
- `before` and `after` place a rule relative to others by name. The order is a topological sort that always takes the earliest-added rule that's ready, so placements move only the rules they must.
- `replace` changes a rule's behavior and keeps its place. `remove` takes it out; placements relative to a removed rule are ignored, so removing one rule never breaks another.
- Placing a rule relative to a name that never existed, or placements that form a cycle, is an error naming the rules, raised when the rulebook is first run or listed. So a package may place its rules relative to rules from a package that loads later.

### Hooks

- A hook is a rulebook in which every handler runs, so handlers are named, placed, replaced, and removed the same way. `hook(name)` gives the hook by name.
- Payloads are typed by the `HookKinds` interface, which packages extend with declaration merging (as with `EventKinds`) and run with `hook(name).run(payload)`.
- Core fires:
  - `gameStart`, when a new story begins, before the start passage is entered;
  - `passageLeave`, after a passage's own `leave` effect;
  - `passageEnter`, after a passage's own `firstVisit` and `enter` effects, before its prose is recorded;
  - `turnEnd`, after each action and its prose (not after beginning);
  - `save` and `load`, after a save is written or read.
- Hooks during a move get the same context as effects. They can change state and persistent data, and a handler that throws rolls back the whole move, like an effect. `save` and `load` only observe: changing state outside a move would break replays.
- Action stages and clock advance belong to the world model, which adds them to `HookKinds`.

### Registries

- `registry<T>(name)` holds values by key, in registration order, each with its source. `register` refuses a taken key, naming who holds it; `replace` substitutes a value in place; `remove` takes it out.

## Consequences

- Every library behavior an author might want to change should be a rule, hook handler, or registry entry, never hard-coded (design principle 7).
- Load order is module import order for now. Explicit load order for extension packages, and compile-time warnings for conflicting registrations, are [#74](https://github.com/loominate-if/loominate-if/issues/74).
- `rules()` and `explain()` give the inspector each rule's order, source, and outcome. Showing which rules fired on each turn ([#48](https://github.com/loominate-if/loominate-if/issues/48)) needs a record of runs, which can build on `explain()`.
- Because handles are global, a module evaluated twice (for example by hot reload) would define a rulebook twice and fail. The dev server will need to reset them when it reloads modules.

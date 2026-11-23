# 0068. Stats and resources

- **Status:** Accepted, 2026-11-24
- **Issue:** [#94](https://github.com/loominate-if/loominate-if/issues/94)
- **Design:** [Stats, traits, and relationships](../DESIGN.md#stats-traits-and-relationships), [ADR 0032](0032-minds-and-bodies.md), [ADR 0067](0067-relationships.md)

## Context

The design asks for numeric stats, skills, and spendable resources (energy, money, hit points), with derived values. Each stat declares whether it's physical, staying with the body, or mental, travelling with the mind. A body swap must move mental stats with the mind. Modifiers (#95) will build on stats.

## Decision

- **Declaring:** a game declares its stats by name in the `Stats` interface, by declaration merging, and with `stats({ … })`, as relationships are (ADR 0067). A game and its packages can each declare their own. A stat used but never declared is an error naming how to declare it.
  - A **kept** stat says `on: "body"` or `on: "mind"`, with a `start` and limits. Its `max` is a number, or a formula over other stats.
  - A **resource** is a kept stat with `resource: true`, which can be spent and restored.
  - A **derived** stat is a formula, as `(who) => stat(who, "strength") * 5`. It can't be set.
- **The library keeps the values,** in state, by the body or mind they're kept on. That gives #95's modifiers one place to apply.
- **Reading:** `stat(who, name)` takes an actor, a body, or a mind.
  - Asked of a body (and an actor is its body), a physical stat is the body's, and a mental stat is the mind's now in it. So a body swap moves mental stats with the mind.
  - Asked of a mind, a mental stat is its own, and a physical stat is its body's.
  - A body with no mind has its mental stats at their start.
  - Values are clamped to the limits as they're read, so a max that's a formula is always current.
- **Changing:** `setStat` and `changeStat` change a stat, clamped. Called in `story.ts` as the game loads, they set how things start, by whose body it is, since nothing is in any body yet.
- **Resources:** `canSpend(who, name, amount)` gives why not, for an action's `check`, through the `stat.notEnough` message ("You don't have enough energy."). `spend` takes it, throwing with that reason if there isn't enough, and `restore` gives it back up to the max.

## Consequences

- An actor's plain properties (traits, #93) and declared stats sit side by side. A number the library needn't clamp, derive, or modify can stay a plain property.
- Modifiers (#95) will add sources and durations on top of `stat`.

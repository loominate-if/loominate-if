# 0069. Modifiers

- **Status:** Accepted, 2026-11-24
- **Issue:** [#95](https://github.com/loominate-if/loominate-if/issues/95)
- **Design:** [Stats, traits, and relationships](../DESIGN.md#stats-traits-and-relationships), [ADR 0068](0068-stats.md), [ADR 0055](0055-inspecting-fuses-and-daemons.md)

## Context

Buffs, debuffs, and bonuses should have sources and durations, expire by the clock, and be visible in the inspector. Stats (ADR 0068) keep their values in one place for modifiers to apply to.

## Decision

- **Writing one:** `modify(who, stat, { by | times, from, lasts, wearsOff })` adds `by` or multiplies by `times`.
  - **One per source:** a new modifier from the same `from` replaces the last, so a second potion refreshes rather than doubles. Different sources stack.
  - **Combining:** `stat()` sums the additions onto the base, multiplies, then clamps to the stat's limits, so a modifier can't take a stat past them.
  - **Removing:** `unmodify(who, stat, from)` removes one. `baseStat` is the value without modifiers, and `modifiersOf` lists them.
- **Placement:** a modifier is kept with its stat, on the body or the mind, in state, so a mental one travels with the mind. In `story.ts`, `modify` sets how things start.
- **Duration:** `lasts` is `minutes(n)` or `moves(n)`, stored as when it wears off. It stops applying from that moment. It's removed, and its `wearsOff` text told, standing out, by rules on the `clockAdvance` and `turnEnd` hooks, rather than a fuse each: fuses are defined at load, and modifiers are made during play.
- **Changing the base:** `changeStat`, `spend`, and `restore` work on the base value, so a temporary modifier isn't kept when it wears off. `canSpend` checks the modified value.
- **The inspector:** the world model's inspector module gains a **Stats** tab. It shows each body's stats, base and now, the mind a mental stat comes from, and each modifier's source and when it wears off.

## Consequences

- Within a long jump of the clock, a modifier stops applying at its moment, but its `wearsOff` text is told at the next step of the jump, not interleaved with fuses' lines by the minute.

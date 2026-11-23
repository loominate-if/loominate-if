# 0051. Interrupting time jumps, and breaking ties

- **Status:** Accepted, 2026-11-23
- **Issue:** [#86](https://github.com/loominate-if/loominate-if/issues/86)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0049](0049-game-clock.md), [ADR 0050](0050-fuses-and-daemons.md)

## Context

Sleeping or long travel advances the clock step by step to each scheduled event, firing them in order (ADR 0050 already steps). Any event can interrupt the jump, leaving the clock at that moment. Events scheduled for the same minute must fire in a deterministic priority order.

## Decision

- **Interrupting:** a fuse or daemon interrupts with `interrupts: true` on its definition, or by calling `clock.interrupt()` from its code when it depends. Calling `clock.interrupt()` while the clock isn't moving on is an error.
- **Which advances:** every `clock.advance(n)` can be interrupted, including an action's `minutes` (through `actionTime`) and travel. It doesn't need to know it's a "jump". It returns `{ minutes, interrupted, by }`: the minutes that passed, and the ID of the fuse or daemon that stopped it.
- **The interrupting minute:** when one interrupts, everything else due at that same minute still fires, since it's all "now". Later minutes are skipped, and their fuses and daemons stay due for the next advance.
- **Ties:** fuses and daemons due at the same moment fire by `priority`, higher first, defaulting to 0, then in the order they were defined.
- **Nesting:** a fuse can advance the clock as it fires. That inner advance is a jump of its own, and an interrupt during it stops only it.

## Consequences

- An interrupted action still happens. It takes only the time up to the interruption, and its report is unchanged. A wait or sleep action (#87) reads `advance`'s result to say how it ended.
- Replays reproduce the order exactly, since nothing depends on anything but state and definition order.

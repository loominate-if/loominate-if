# 0052. Summing up repeated notices in a time jump

- **Status:** Accepted, 2026-11-23
- **Issue:** [#305](https://github.com/loominate-if/loominate-if/issues/305)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0050](0050-fuses-and-daemons.md), [ADR 0051](0051-time-jumps.md)

## Context

A long jump of the clock past a daemon every 15 minutes told one notice per firing, which reads like a log. A game should be able to say "The church bells rang throughout the night." instead.

## Decision

- **Holding notices:** during one `clock.advance`, what fuses and daemons say is held, then written up when the advance ends, whether it ran to the end or was interrupted. A jump started inside another's firing leaves the outer jump to write everything up. Firings still run at their own minutes, so their effects on state are unchanged.
- **The write-up:** lines are told in the order they were said. A fuse or daemon that spoke more than once and sums it up says its summary where it first spoke, in place of all its lines.
- **Summaries:** a fuse's or daemon's `summary` gets `{ count, from, to, lines }`, where `from` and `to` are the clock's minutes at its first and last firings. `timeOfDay(minutes)` words those. A summary that returns nothing or empty keeps the lines.
- **Game-wide:** without a `summary`, the `schedule.repeated` message decides, given `{ source, lines, count }`. It's empty by default, which keeps each line, so nothing changes unless a game rewords it. Messages are text, so an empty result is how a message says "keep the lines".
- **Interruptions:** the line of what interrupted the jump is never summed up, even for a daemon whose earlier firings are. It stays where it fell, after any summary that began earlier.
- **Single firings and moves:** a single firing keeps its own line. Timers counted in moves fire one move at a time, outside any jump, so they're never summed up.

## Consequences

- Joining several daemons' summaries into one sentence ("…the church bells rang and an owl hooted") isn't included. Summaries are whole sentences, and joining them needs clause-shaped ones; it can come later on `list.join`.
- Undo and replays give the same notices, since the write-up depends only on what fired, in order.

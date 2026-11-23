# 0056. A continue isn't a move

- **Status:** Accepted, 2026-11-23
- **Issue:** [#311](https://github.com/loominate-if/loominate-if/issues/311)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0049](0049-game-clock.md), [ADR 0050](0050-fuses-and-daemons.md)

## Context

A `{continue}` was a "follow" like any link, so it ran `turnEnd`. That made the clock's move count go up, fired fuses and daemons counted in moves, and added to the status line's "Moves: N". A continue only acknowledges what was read, so:
- "every move" daemons ran faster in games with more asides;
- "in 3 moves" depended on how a scene was split into passages;
- two games with the same choices counted differently.

## Decision

- **What counts:** a move is a choice the player makes: following a link, taking an action, or a `goTo`. A continue isn't, and nor is moving past a beat, which never ran `turnEnd`.
- **The hook:** `turnEnd` now says what kind of move it was, as `move`: `"follow"`, `"continue"`, `"act"`, or `"goTo"` (core's `MoveKind`). It still runs after a continue, so rules can decide for themselves.
- **The count:** `Story.moves` counts moves from the action log, skipping continues and beats. The status line shows it.
- **The clock:** `clock.moves`, and with it every fuse and daemon counted in moves, skips continues.
- **Unchanged:** a continue is still a step to undo, and still in replays. Nothing new is stored, since the count comes from the log.
- **No flag yet:** there's no way to make a particular continue count. A `counts` flag can come if a game needs one.

## Consequences

- A save made before this change replays the same, but its clock's move count, which is state, keeps the continues it counted then.

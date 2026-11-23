# 0050. Fuses and daemons

- **Status:** Accepted, 2026-11-23
- **Issue:** [#85](https://github.com/loominate-if/loominate-if/issues/85)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0049](0049-game-clock.md)

## Context

A fuse fires once, at a time or after a delay; a daemon recurs. Both must be cancellable and survive save, load, and undo. That means living in the state store, but their code can't be stored.

## Decision

- **Defining one:** `fuse(id, { after, running }, fire)` and `daemon(id, { every, running }, fire)` are defined when the game loads, in `story.ts` or a module it imports. The ID is unique among fuses and daemons. Each keeps its timing in a world-owned object, `world:fuse:<id>` or `world:daemon:<id>`, holding whether it's running and when it's due. Undo, saves, and replays restore that state, and the inspector (#91) can list it.
- **Delays:** `minutes(n)` counts on the game clock, and `moves(n)` counts on its move count, for things that happen every move whether or not time passes. A delay is a whole number, 1 or more.
- **Starting and stopping:** each one waits until `start()`, unless it's `running: true`, in which case it's due its delay after the game begins. `start()` counts from now, and starting it again starts it over. `cancel()` stops a fuse, and `stop()` stops a daemon; either can be started again. `isRunning`, `firesAt`, and `unit` say where it stands.
- **What it says:** `fire` returns what the player is told, as text or a `t` template, or nothing. That text is recorded as a new core event kind, `scheduled`, with the fuse or daemon's ID as `source`. The page shows it with the move's notices, after the passage's text or where `{notices}` puts it. The walkthrough API's `notices` and `transcript` include it.
- **Long advances:** `clock.advance(n)` steps to each fuse and daemon due on the way, in time order, setting the clock to that moment (with `clockAdvance` for each step) before it fires. A daemon fires once per period crossed. Moves are counted on `turnEnd`, and timers counted in moves fire right after.
- **Ties:** timers due at the same moment fire in the order they were defined, which is deterministic. A daemon is rescheduled before its code runs, so the code can stop it.

## Consequences

- Interrupting a time jump, and priorities for ties, are #86's. They build on the same stepping.
- A fuse or daemon removed from a later version of the game leaves its state unused in old saves. A new one in a save that never had it starts with its defined state.

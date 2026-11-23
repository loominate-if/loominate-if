# 0049. The game clock

- **Status:** Accepted, 2026-11-22
- **Issue:** [#84](https://github.com/loominate-if/loominate-if/issues/84)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0044](0044-action-pipeline.md)

## Context

Games need in-world time, in minutes. Most actions are free, travel costs time, and any code can advance the clock, even partway through an action. A per-move counter is needed for things that happen "every move". Core already sent actions' time through an `actionTime` hook, for a clock to come, and exits already took `minutes`.

## Decision

- **Where it lives:** the clock is the world model's `clock`. Its state is a world-owned object, `world:clock`, holding the minutes elapsed, the moves made, and any change to `travelMinutes` during play. Undo, saves, and replays see it.
- **Telling the time:** `clock.minutes` is the time since the game began. `clock.day`, `clock.hour`, and `clock.minute` count from the start `startClock({ at: "HH:MM", day })` sets, which is authored, not state. `timeOfDay()` words the time through the `clock.time` message, as "9:45 pm" by default. Days, weekdays, and seasons are the calendar's (#88).
- **Moving time on:** `clock.advance(minutes)` takes a whole number, 0 or more, and runs the `clockAdvance` hook with the minutes before and after, for fuses and daemons (#85) to come. A handler for `actionTime` advances the clock by an action's `minutes`.
- **Travel:** arriving at a room through `enterRoom` from a room joined to it by an exit takes the exit's `minutes`. If the exit doesn't give any, it takes `clock.travelMinutes`, which `startClock({ travelMinutes })` sets and which defaults to 0. A game can change it during play. Moving between rooms with no exit between them takes no time.
- **Counting moves:** `clock.moves` counts moves on the `turnEnd` hook, so it covers following a link, taking an action, and travel, but not beginning. Undo winds it back.
- **Showing the time:** a `clock` widget shows the time, labelled "Time" for screen readers. It isn't in the header unless a game calls `addToHeader("clock")`, so games that don't use time don't show it. It's built on presentation's new `textWidget`, so the world model needs no DOM of its own.

## Consequences

- No game logic reads the wall clock, so replays reproduce time exactly.
- Fuses, daemons, and time jumps (#85, #86) build on `clockAdvance` and `clock.moves`.
- If two exits join the same rooms, travel takes the first one's minutes, in direction order. The story doesn't know which exit link was followed, only where the player arrived.

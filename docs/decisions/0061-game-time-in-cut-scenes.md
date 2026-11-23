# 0061. Game time in cut scenes

- **Status:** Accepted, 2026-11-23
- **Issue:** [#90](https://github.com/loominate-if/loominate-if/issues/90)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0049](0049-game-clock.md), [Cut scenes and beats](../DESIGN.md#cut-scenes-and-beats)

## Context

A cut scene's beats take real seconds. Whether the scene costs game minutes should be a separate, explicit choice. Beats already never touched the game clock, but there was no way for a cut scene to say what game time it covers short of effect code.

## Decision

- **Minutes on beats:** `{beat 2s, minutes: 120}`, `{wait minutes: 30}`, and `{page minutes: 600}` say how much game time passes as the player moves past the beat. `BeatNode` gains `minutes`. A beat without it costs no game time. Minutes are a whole number, 0 or more.
- **How the time passes:** `Story.advance` records the beat, then runs core's new `beatTime` hook with the passage and minutes, then the next part's effects and prose. So the part's text and effects see the new time, and what fuses and daemons say on the way belongs to that part. Core has no clock, so the world model's clock handles `beatTime`, as it handles `actionTime`. A game without the world model can handle the hook itself.
- **Skipping:** the game time passes however the player moves past a beat, waiting it out or skipping it, since moving past is the logged move. Replays reproduce it exactly.
- **Whole passages:** `{on enter: clock.advance(…)}` still works for a whole passage.

## Consequences

- Named arguments on a directive with no positional argument have no leading comma: `{wait minutes: 30}`, but `{beat 2s, minutes: 120}`.

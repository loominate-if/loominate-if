# 0062. Journeys that can be stopped partway

- **Status:** Accepted, 2026-11-24
- **Issue:** [#304](https://github.com/loominate-if/loominate-if/issues/304)
- **Design:** [Time and scheduling](../DESIGN.md#time-and-scheduling), [ADR 0034](0034-exits-and-directions.md), [ADR 0051](0051-time-jumps.md), [ADR 0059](0059-closing-time.md)

## Context

A long journey, such as a subway ride, should be stoppable partway by an emergency, a bomb on the tracks ahead, but not by lesser events: a phone call should just be told on the way. Ordinary travel moves the player into the destination first and passes the exit's minutes after, so ADR 0051 made it uninterruptible. Exits are state, so they can't hold a `stopsFor` function. Core's `redirect` (ADR 0059) now lets a move end somewhere other than where its link pointed.

## Decision

- **Defining a journey:** `journey(name, { stopsFor, stopsAt })` is defined at load. An exit names it: `{ to: downtown, minutes: 40, journey: "subway" }`. The name is stored with the exit, which keeps exits plain data.
- **Its link:** a journey exit's link is an `{act}` link for an internal world action, `world:journey`, whose argument is the direction, as plain data for replays. The action:
  - checks the exit's door or obstacle, as any way does;
  - moves the clock on by the exit's minutes, or `travelMinutes`, with the journey's `stopsFor`. Anything that interrupts stops it unless it says;
  - then moves the player to the destination, or, if interrupted, to `stopsAt`, and redirects to that place's room passage. Without `stopsAt`, an interrupted journey leaves the player where they set out.
- **One move:** it's one move and one undo step. The destination's passage is entered only if the player arrives. What interrupted the journey is told on the page that follows.
- **Resuming:** a stopped journey isn't resumed automatically. The place it stops at has whatever exits the author connects.

## Consequences

- Ordinary exits are unchanged: they move the player first and can't be stopped.
- A journey's link is an action, so it shows in the inspector's Choices panel as the `world:journey` action, with its blocked reason if a door is in the way.

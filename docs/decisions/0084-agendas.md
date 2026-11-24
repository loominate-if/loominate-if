# 0084. Agendas

- **Status:** Accepted, 2026-11-24
- **Issue:** [#107](https://github.com/loominate-if/loominate-if/issues/107)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0081](0081-npc-actions.md), [ADR 0082](0082-npc-turns.md)

## Context

NPCs should pursue goals, adv3Lite-style, that can interrupt their schedules: "find the player and deliver the warning". NPCs have turns (ADR 0082) and act through the shared pipeline (ADR 0081), but had no goals, no way to move towards someone, and no way to speak.

## Decision

- **`agenda(npc, name, { priority, ready, act, starts })`** adds an item.
  - In the NPC's turn, the highest-priority item that's active and ready takes one step through `act`. Ties go by the order added.
  - `act` calls `done()` when the goal is met.
  - The items share one turn rule per NPC, named `agenda`, so the inspector shows it with their turn.
- **Active items are game state:** `starts: false` waits for `startAgenda`, `stopAgenda` sets an item aside, and `done()` stops it. In `story.ts`, `startAgenda` and `stopAgenda` set how things start.
- **An NPC with an active, ready item acts even unseen,** until it's done. The NPC module takes reasons for acting unseen from other modules through an internal registry, so a kit or game can add its own.
- **`stepToward(npc, target)`** takes one step along the shortest way, by breadth-first search over exits in direction order, through `go`. So a locked or closed door stops it, and the route doesn't plan around doors. It returns true once the NPC is where the target is.
- **`say(npc, text)`** narrates a line through `happen`, as "The butler says, “…”" to those who see the NPC, or "Someone says, “…”" to those who only hear them. Conversations (#109) will have their own; this is a line in passing.

## Consequences

- An NPC blocked by a locked door keeps trying each turn. A game handles that in `act`, as by another item or opening the door.
- Scheduled NPCs (#105) will let agenda items interrupt their timetable.

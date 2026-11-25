# 0111. Paced NPCs and routes

- **Status:** Accepted, 2026-11-25
- **Issue:** [#137](https://github.com/loominate-if/loominate-if/issues/137)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0082](0082-npc-turns.md), [ADR 0084](0084-agendas.md)

## Context

The design's simulated NPCs travel room to room on daemon-driven paths and act on the world offstage. NPC turns (ADR 0082) come one after each of the player's moves, so a simulated NPC already acts offstage, but a three-hour wait gives them one step. Daemons already fire at each of their times during a jump of the clock, can interrupt it, and sum up what they said.

## Decision

- **Paced turns:** `simulate(npc, { every })`, in `story.ts`, gives a simulated NPC a turn every so often on the game clock, `minutes(5)`, or in moves, `moves(2)`, instead of after every move.
  - Each paced NPC's turns are a daemon of their own, `world:pace:` and their mind's ID, running from the start, so the clock stops at each during a jump and they take it at its own time. Their turn is the same as any NPC's: their rules, through the action pipeline.
  - Pacing is set as the game loads, since a daemon's code can't be saved. In play, `simulate(npc, false)` and `simulate(npc)` switch them off and on, still paced; switched off, they're observed only.
- **Coming into view stops a wait.** If a paced NPC's turn brings them into the player's sight or hearing, their daemon interrupts the jump there, as an interrupting fuse does. What doesn't stop for it, such as a journey that says what it stops for, goes on.
- **What the player sees is summed up.** What the player would perceive during a paced turn becomes the daemon's line, so a jump that fires it more than once sums it up, as daemons' repeats are ([ADR 0052](0052-summing-up-repeats.md)). By default each line is said once, in order, with how many times it happened, through the `npc.repeats` message: "The sentry paces past, 3 times." A `summary` words it otherwise. One turn keeps its own line. Those lines are told as scheduled notices, standing out.
- **Routes:** `route(npc, places, { every, loop })` is a patrol built on paced turns. Each turn steps toward the next place through `go`, so doors stop them; once there, they head for the next, and with `loop` round again. Where they are on it is state.
- **The inspector** shows a paced NPC's level with their pace, "simulated, every 5 minutes".

## Consequences

- A long wait plays out offstage as it would have move by move, deterministically: daemons due at the same moment fire by priority, then the order defined.
- What a paced NPC is seen doing is told as a scheduled notice, not a perception event, since it's the daemon's line. Minds still see and learn through perception.
- Agenda items and turn rules work unchanged on a paced NPC; they just come on the clock.

# 0082. NPC turns and simulation levels

- **Status:** Accepted, 2026-11-24
- **Issue:** [#104](https://github.com/loominate-if/loominate-if/issues/104)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0081](0081-npc-actions.md)

## Context

NPCs choose a simulation level: observed only, the default, at no cost to the author; scheduled (#105); or simulated. `actAs` (ADR 0081) lets an NPC act, but nothing gave them turns.

## Decision

- **An NPC's turn comes after each of the player's moves,** when the world model's `turnEnd` rule runs, after the move counter. A continue isn't a move (ADR 0056), so it gives no turns. One move gives one turn, however much time it took: time-driven behaviour uses fuses and daemons.
- **`everyTurn(npc, name, rule)`** adds a rule to that NPC's turn. Each NPC's turn is its own hook, `npc:` and their mind's ID, declared with a template literal key on `HookKinds`. So the inspector's Rules tab shows whose turn ran and what each rule did, and an NPC who got no turn shows nothing. Rules run in the order added, and NPCs take turns in ID order, so play is deterministic.
- **Observed only, the default:** an NPC gets a turn only while the player's body can see or hear theirs, by the perception layer's rules. An NPC with no turn rules does nothing, at no cost.
- **Simulated:** `simulate(npc)` gives them a turn after every move, wherever they are. Their actions are narrated only to whoever sees them, through `actAs`. It's game state, so it can change in play, and in `story.ts` it's how they start. `simulate(npc, false)` reverts it.
- **`getsTurn(npc)`** says whether an NPC gets a turn now, for code and the inspector.

## Consequences

- Agendas (#107) will be rules in the same turn. Scheduled NPCs (#105) are placed by their timetable, not by turns.
- A simulated NPC's turn runs every move, so many simulated NPCs with costly rules slow every move. Most characters should stay observed only.

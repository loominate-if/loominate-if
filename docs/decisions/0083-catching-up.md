# 0083. Catching up an unseen NPC

- **Status:** Accepted, 2026-11-24
- **Issue:** [#356](https://github.com/loominate-if/loominate-if/issues/356)
- **Design:** [NPCs](../DESIGN.md#npcs), [ADR 0082](0082-npc-turns.md)

## Context

An observed-only NPC takes no turns while the player can't perceive them (ADR 0082), so state their offstage actions should have changed doesn't change. Simulating them works, but costs a turn every move.

## Decision

- **`catchUp(npc, name, rule)`** adds a rule working out what an NPC did while unseen. It runs once, just before their first turn after a stretch without one, given the game minutes and the player's moves since their last turn.
- **It changes state directly,** not through actions: nobody saw it, so nothing is narrated or checked.
- **Each NPC's catching up is its own hook,** `catchUp:` and their mind's ID, so the inspector shows it.
- **The world model records each NPC's last turn in game state:** whether they got one after the last move, and the clock's minutes and the move count when they last did. So undo, saves, and replays agree.
- **As the game begins,** every NPC counts as last seen then, if the player can perceive them. One in view from the start never catches up until they've been out of view.
- **A simulated NPC** gets a turn every move, so never catches up.

## Consequences

- Catching up fires when the NPC is seen again. An offstage change to a room they're not in, seen before they are, needs a fuse or daemon, or `simulate`. The broader form, catching up when a room or thing is observed, is #179 (lazy processes).
- The guide sets out when to use `catchUp`, fuses and daemons, or `simulate`.

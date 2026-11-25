# 0110. NPCs telling each other what they know

- **Status:** Accepted, 2026-11-25
- **Issue:** [#135](https://github.com/loominate-if/loominate-if/issues/135)
- **Design:** [Open questions](../DESIGN.md#open-questions), [NPCs](../DESIGN.md#npcs), [ADR 0035](0035-knowledge-and-facts.md), [ADR 0081](0081-npc-actions.md), [ADR 0101](0101-knowledge-sharing.md)

## Context

The design left open whether simulated NPCs can exchange facts with each other while the player is absent, and in which phase. Minds can already learn facts with a source, companions share with the player by policy (ADR 0101), and NPCs act offstage through the same action pipeline as the player (ADR 0081). What's missing is one NPC telling another, and whether anything spreads by itself, the gossip that relationships, presence, and knowledge were meant to support.

## Decision

- **Yes, in Phase 4,** in two ways.
- **Telling, explicitly.** The standard `tell` action, taken as an NPC with `actAs(npc, tell({ who, about }))`, teaches the hearer the fact, sourced to the teller. It goes through the action pipeline like any NPC action, so its rules apply, a hearer who isn't there can't be told, and it's recorded as an `npc` event. Topic entries stay the player's: an NPC telling an NPC answers with no entry.
- **Gossip, by choice.** A fact defined with `spreads: true` passes, after each move, between NPCs together in a place who both get a turn that move, from one who knows it to one who doesn't, sourced to the teller. Facts without it never spread by themselves.
  - **Who:** NPCs who get a turn, by the simulation levels (ADR 0082): seen, simulated, or acting on an agenda. Two observed-only NPCs who meet offstage don't gossip, as they don't act.
  - **Order:** pairs in ID order, then facts in the order defined, so a seed and moves replay it.
  - **Not the player:** gossip is between NPCs. What the player learns from companions is ADR 0101's.
  - **Recorded** as an `npc` event for each exchange, so the inspector's timeline lists it, offstage or not.
- **Seen or heard by the player:** narrated, not learned. "Marta whispers something to Tobias.", once a move for each pair, as a message games can reword. The player sees them talk but doesn't learn what was said. A game that wants a conversation overheard tells the player itself, with `happen(…, { reveals })` or `{reveal …}`.

## Consequences

- Gossip, jealousy, and reputation can be built from relationships, presence, and spreading facts, with no per-pair code.
- A game turns gossip on fact by fact, so a plain world-model game is unchanged.
- Implementing it is a Phase 4 task under the NPC epic (#136).

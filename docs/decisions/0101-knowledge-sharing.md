# 0101. Knowledge sharing between the player and companions

- **Status:** Accepted, 2026-11-24
- **Issue:** [#124](https://github.com/loominate-if/loominate-if/issues/124)
- **Design:** [Companions](../DESIGN.md#companions), [ADR 0098](0098-companions.md)

## Context

Knowledge is per actor, with an author-chosen policy: shared while together, shared when reunited (the default), or only through conversation. What a companion learns while away is theirs, and on reunion "What did you find?" can tell it.

## Decision

- **Setting the policy:** `knowledgeSharing(policy)`, in `story.ts`, sets the game's policy. `companion(npc, { shares })` sets one companion's.
- **The policies:**
  - **`reunion`:** after each move, the player and each companion in the same place share everything each knows.
  - **`together`:** they share what they know except what either learned or saw while apart from the other. Those are noted as game state through an internal listener in the knowledge module.
  - **`conversation`:** nothing is shared by itself.
- **What's shared:** facts, learned from whoever knew them (their body), and things seen, which the other learns about (known of, not seen).
- **"What they found":** a named topic, `found`. Each companion gets two entries. One, while they know facts the player doesn't, tells each fact's text and teaches it, from them. The other, unsuggested, says there's nothing new. A game's own entry for `found` can take over.

## Consequences

- Sharing runs after each move, after NPCs' turns, so a fact learned during a move is shared at its end.
- Companions don't share with each other; group knowledge among NPCs can come with group conversations.

# 0087. The conversation model

- **Status:** Accepted, 2026-11-24
- **Issue:** [#110](https://github.com/loominate-if/loominate-if/issues/110)
- **Design:** [Conversations](../DESIGN.md#conversations)

## Context

Conversations are designed for groups from the start, with one-on-one as a group of one. Topics, nodes, exit control, and conversation mode all need an underlying model: who's in the conversation, who the player is addressing, and what locks hold them in it, with their owners.

## Decision

- **One conversation at a time, the player's,** kept in state (`world:conversation`):
  - its participants, by mind ID, in the order they joined;
  - the one addressed;
  - its locks.
- **Functions change it, during play:** `startConversation(npc | npcs)` (the first addressed), `address`, `joinConversation`, `leaveConversation`, and `endConversation`. They throw outside play, since they're state changes a replay must repeat. A read-only `conversation` view and `inConversationWith` read it; the view shows bodies, since that's what authors hold.
- **Locks are one per owner:** `lockConversation({ by, level, reason })`, where `by` is a participant or a node's ID, and `level` is `soft` or `hard`. `conversation.exit` is the strictest. A participant's locks go when they leave, and all go when the conversation ends. "Hear me out" is part of conversation nodes (#116), and enforcing locks is exit control (#117).
- **Leaving:** after each move, after NPCs' turns, a participant who isn't in the player's place leaves. When the addressee leaves, the first remaining participant is addressed, and with no one left the conversation ends. A lock doesn't stop this; stopping the player walking out of a hard lock is exit control's job.

## Consequences

- NPC-to-NPC conversations aren't modelled; group conversations in Phase 4 build on this one.
- Narrating arrivals and departures in a conversation comes with conversation mode (#118).

# 0093. Conversation nodes

- **Status:** Accepted, 2026-11-24
- **Issue:** [#116](https://github.com/loominate-if/loominate-if/issues/116)
- **Design:** [Conversation nodes](../DESIGN.md#conversation-nodes), [ADR 0088](0088-topic-entries.md), [ADR 0092](0092-topic-blocks.md)

## Context

Nodes handle moments that need structure, such as an NPC asking a question. A node can restrict the player to its replies, or add them alongside the regular topics. If the player changes the subject, the NPC can press the point.

## Decision

- **Defining:** `convNode(npc, name, { restricts, presses })` defines a node. `presses` is text, or a function returning it.
- **Opening:** an entry's `opens: node` opens it after the entry answers, closing any other of the NPC's nodes. `openNode(npc, node)` opens one from code; the NPC must be in the conversation. Which node is open is game state, per NPC.
- **Its entries:** entries `in: node` apply only while it's open, and rank above a scene's, an actor state's, and the actor's.
- **Changing the subject:**
  - with `restricts`, an exchange no node entry answers isn't answered. The NPC presses the point, with its `presses` line or a default message, and the node stays open. Showing and giving are held up the same way.
  - without it, the exchange is answered as usual, and then the NPC presses the point if it has a `presses` line.
  - Greeting and goodbye are never held up.
- **Closing:** a node closes when one of its own entries answers, unless that entry says `stays: true`; on `closeNode(npc)`; or when the NPC leaves the conversation.
- **Suggestions:** while a restrictive node is open, `{topics}` suggests only its replies, then goodbye. An open node's `yes` and `no` entries are suggested first, as "Say yes" and "Say no".
- **Passage files:** `opens:` and `stays` on blocks, and a `node:` tag role on actor passages that scopes their blocks, like `state:`.

## Consequences

- Hard locks and "hear me out" (#117) can be owned by nodes, by their IDs.
- A node that presses each turn the player does nothing, as adv3Lite's NodeContinuationTopic does, could come later.

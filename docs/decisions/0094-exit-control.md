# 0094. Exit control

- **Status:** Accepted, 2026-11-24
- **Issue:** [#117](https://github.com/loominate-if/loominate-if/issues/117)
- **Design:** [Exit control](../DESIGN.md#exit-control), [ADR 0087](0087-conversation-model.md), [ADR 0093](0093-conversation-nodes.md)

## Context

Conversations have four exit levels: free, soft block (the NPC objects, but the player can insist), hard lock (only the node's replies until one is chosen), and hear me out (a cut scene within the conversation, after which control returns). Every locked node must have a reachable way out, and undo must always work through locks.

## Decision

- **Nodes lock:** `convNode(npc, name, { exit: "soft" | "hard", objects })`.
  - While the node is open, it holds a lock on the conversation, owned by its ID, with its `objects` line as the reason. Closing the node unlocks it.
  - A hard node is restrictive too.
  - `lockConversation` remains for locks from code.
- **What a lock holds:** goodbye and the room's exits.
  - **Soft:** the first goodbye, or the first try at an exit, is met with the objection and doesn't happen. The exit link takes an internal action that objects. Trying again goes, and the state of having insisted lasts until the conversation ends.
  - **Hard:** goodbye is disabled by its check, and exit links are disabled, both with the reason.
  - A game's own links aren't held: the lock can't know what they mean.
- **Hear me out:** an entry's `hearMeOut: passage` redirects the move to that passage after the entry answers. In blocks it's written `-> Passage`, checked like a link.
  - Core now remembers the passage the player was at before the current one.
  - `{continue back}` continues there, so a cut scene returns to the conversation, which is still held, since the player hasn't moved.
  - `{continue}` still needs a target or `back`. Argument specs gain `unless` for that.
- **A way out:** as the game starts, the world checks every hard node has a reply that closes it, an entry in it without `stays`. If one doesn't, the game stops with an error naming the node and how to fix it, which `loominate dev` and `loominate test` report. A node the game closes from code says `closedElsewhere: true`. Replies with conditions can't be judged, so they count.
- **Undo** isn't affected by locks; it restores the conversation's state like any other.
- **A parser fix:** a `-> Name` target in a directive is a passage name, so an apostrophe in it no longer starts a string. `{continue -> Maid's room}` failed before.

## Consequences

- The inspector's view of active locks and their sources is #119.
- The way-out check runs when the game starts, not at compile time, since nodes are defined in TypeScript.

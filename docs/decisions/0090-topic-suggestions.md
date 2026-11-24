# 0090. Topic suggestions, revealing, and informing

- **Status:** Accepted, 2026-11-24
- **Issue:** [#113](https://github.com/loominate-if/loominate-if/issues/113)
- **Design:** [Topic entries](../DESIGN.md#topic-entries), [ADR 0088](0088-topic-entries.md)

## Context

Topics should be suggested only when the player knows the subject, and responses should be able to reveal facts to the player and inform NPCs. Conversation mode (#118) will give suggestions a screen; until then, passages need a way to show them.

## Decision

- **`{topics}`**, a content directive like `{exits}`, lists a link for each suggestion while the player is talking. Each link takes its action. `suggestedTopics()` gives the same suggestions as labels and action calls.
- **A suggestion** is an `ask` or `tell` subject the addressee has an entry for, if that entry would answer now and the player knows the subject, in the order the entries were defined. "Say goodbye" comes last. Catch-alls and entries with `suggested: false` aren't suggested.
- **What the player knows:**
  - a fact they've learned;
  - a thing they've seen, learned about, or that's `isFamiliar`;
  - a named topic, known from the start unless defined with `known: false`. The knowledge module accepts named topics through an internal registry, so `player.learnAbout(topic)` teaches one.
- **Facts get an optional `name`,** such as "the missing gold", for suggestions. Without one, the fact's text is quoted.
- **`reveals`** on an entry teaches its facts, from the NPC, to the player and to everyone else in the conversation, as a group will need.
- **Telling an NPC a fact** teaches it to them, from the player, whatever they reply, unless the entry that answers says `informs: false`.
- **Asking or telling about a fact the player doesn't know** isn't offered. Things and topics can still be asked about unsuggested, as by a parser.

## Consequences

- A thing the story mentions but the player hasn't seen, such as gold in a locked vault, isn't suggested until it's made familiar. The guide says so.
- Group conversations will reuse `reveals` as it is.

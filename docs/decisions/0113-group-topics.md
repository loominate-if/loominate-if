# 0113. Group topics and choosing whom to address

- **Status:** Accepted, 2026-11-25
- **Issue:** [#141](https://github.com/loominate-if/loominate-if/issues/141)
- **Design:** [Group conversations](../DESIGN.md#group-conversations), [ADR 0095](0095-conversation-mode.md)

## Context

The design has the player pick an addressee by their highlighted portrait, with the menu showing that character's topics, and group-level topics addressing everyone. Conversation mode (ADR 0095) already shows a portrait button for each participant, pressed for the one addressed, and suggests the addressee's topics. Nothing addressed the group, and each portrait was its own Tab stop, so a large group meant many.

## Decision

- **Group entries:** `groupTopic({ ask | tell | askOrTell, says })` gives every conversation an entry of its own, not any character's. It's suggested while two or more are in the conversation, whoever is addressed, as "Ask everyone about the storm", and only for a subject the player knows.
  - Taking it, through the `askEveryone` and `tellEveryone` actions, says the player's line and the entry's `says`. `speaker` names who answers for the group, for the story log; without it, the answer is narration.
  - `reveals` teaches the player and everyone in the conversation. Telling everyone a fact teaches it to all of them.
  - `when`, `priority`, and `suggested` work as for a character's entries.
  - While a restrictive node is open, group topics aren't suggested.
- **The cast is a toolbar:** one Tab stop, at the one addressed, with the arrow keys, Home, and End moving focus between portraits, and Enter or Space addressing one. Moving focus doesn't address anyone.

## Consequences

- A game writes what a group says as one line, or a function over who's there, without per-character plumbing. Reactions from each participant are #142.
- Group entries aren't any character's, so the inspector's per-character topic list doesn't show them.

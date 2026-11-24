# 0091. Show and give topics

- **Status:** Accepted, 2026-11-24
- **Issue:** [#114](https://github.com/loominate-if/loominate-if/issues/114)
- **Design:** [Topic entries](../DESIGN.md#topic-entries), [ADR 0088](0088-topic-entries.md)

## Context

Showing and giving are ordinary actions that should route to show and give topics, with the inventory still available in a conversation. They already answer through the `giving` and `showing` rulebooks, where a game's rules decide reactions.

## Decision

- **Entries:** `show`, `give`, and `showOrGive`, each with a thing or `anything`.
  - A give entry keeps the NPC's hands to themselves unless it says `takes: true`.
  - A fact can't be shown or given.
- **Where entries answer:** `give` and `show` consult two internal rulebooks, `giving: topics` and `showing: topics`. They run after `giving` and `showing` and before the default refusal.
  - Rules have no "last" position, and a world rule added at load would run before a game's own, so a separate step is the way to keep the game's rules first.
  - The topic rule in each is named `topic entries`, so the Rules tab shows when it answered.
- **When an entry answers:**
  - only for the player's showing and giving, not NPCs';
  - the NPC joins the conversation, with any implicit hello;
  - it takes a minute.
  - With no entry, the default refusal answers and no conversation starts.
- **Suggestions:** `{topics}` and `suggestedTopics()` add "Show …" and "Give …" for each thing the player carries that the addressee has a particular entry for, if it would answer. Things' menus still offer showing and giving everything else.

## Consequences

- A thing a game's own rule answers is still suggested if the NPC has an entry for it, since the exchange is worth offering.
- Conversation mode (#118) can show the same suggestions next to the inventory.

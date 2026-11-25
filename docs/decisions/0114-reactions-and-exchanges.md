# 0114. Reactions and scripted exchanges

- **Status:** Accepted, 2026-11-25
- **Issue:** [#142](https://github.com/loominate-if/loominate-if/issues/142)
- **Design:** [Group conversations](../DESIGN.md#group-conversations), [ADR 0113](0113-group-topics.md)

## Context

The design has topic entries trigger reactions from other participants, limited by priority and a cap per exchange, and NPCs exchange scripted lines as beats. Conversation lines are `action-result` events tagged with their speaker, which the story log attributes. A passage's beats pace its own prose, and passage text carries no speaker.

## Decision

- **Reactions are entries of the reacting character's:** `topic(maid, { reacts: { ask: letter }, says })`, or `{reacts ask letter}` in their actor passage. `reacts` takes what an entry answers, kind and subject. They're kept apart from the entries that answer, so a reaction never answers an exchange itself.
- **After an answer,** each other participant's best reaction to the exchange, by the usual ranking and `when` and `in`, is a candidate. Candidates go by priority, then by the order they're in the conversation. As many as the cap allows are said, as their speakers' words.
- **The cap:** one an exchange by default. `reactionsPerExchange(n)` sets the game's, and an answering entry's `reactions: n` its own, `0` for none.
- **Scripted exchanges:** `exchange(name, [[speaker, text], …])` defines one in `story.ts`. An entry's `then: name` plays it after answering, and `playExchange(name)` from code, in a conversation.
  - The first line is said at once. While it plays, the conversation suggests only **Continue**, the `continueExchange` action, which says the next line. After the last, the topics come back.
  - Each line is an `action-result` tagged with its speaker, so the page's conversation, the story log, and the transcript attribute it.
  - Lines are paced by the player's Continue, not by a passage's beats, which can't name a speaker. Each Continue is a move, so undo takes back a line at a time.

## Consequences

- A character's reactions sit with their other entries, in their actor passage, not in the entries they react to.
- Coverage reports list reactions with the topics, as "The maid reacting to: Ask the butler about the letter".
- An exchange played outside a conversation is refused. A cut scene with `hearMeOut` remains the way to tell a longer story with its own beats.

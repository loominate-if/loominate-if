# 0096. The inspector's Conversation tab

- **Status:** Accepted, 2026-11-24
- **Issue:** [#119](https://github.com/loominate-if/loominate-if/issues/119)
- **Design:** [Group conversations](../DESIGN.md#group-conversations), [Exit control](../DESIGN.md#exit-control), [ADR 0088](0088-topic-entries.md)

## Context

The inspector should show active conversation locks and their sources, and every topic of a character with its conditions. In particular, it should explain why a topic isn't suggested.

## Decision

- **A Conversation tab** in the world model's inspector module.
  - **Now:** the participants, who's addressed, each one's open node, the exit, and each lock with its level, its owner by name (an NPC, or an NPC's node), and its reason.
  - **Topics:** a picker of the characters with entries, starting at the addressee, and a row for each of the chosen character's entries.
- **Each row says:**
  - what the entry answers, its ID, scope, priority and options;
  - its condition as written;
  - whether it would answer now, and why not, as the Choices tab's Topics section does;
  - whether it's suggested now, and why not.
- **Conditions as written:** a topic block's `when:` keeps the condition argument the compiler passes, with its source text and parts. A TypeScript entry's `when` shows its function's source, as the development server has it.
- **Why a topic isn't suggested** follows `suggestedTopics`' own rules, checked in order. The player isn't talking to them, or they aren't addressed. It's a greeting, goodbye or catch-all. It says `suggested: false`. The player doesn't know of the subject, or isn't carrying the thing. Another entry answers it, or, if only a catch-all would, why this one doesn't. Or a restrictive node is open.
- **Internal data:** `_conversationNow`, `_topicRows` and `_topicCharacters`.

## Consequences

- A coverage report (#130) can use the same rows for topics that can never be suggested.
- In a production build a TypeScript `when`'s source may be minified, but the inspector isn't in builds unless asked for.

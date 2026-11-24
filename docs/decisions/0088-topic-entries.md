# 0088. Topic entries and matching

- **Status:** Accepted, 2026-11-24
- **Issue:** [#111](https://github.com/loominate-if/loominate-if/issues/111)
- **Design:** [Topic entries](../DESIGN.md#topic-entries), [ADR 0087](0087-conversation-model.md)

## Context

NPCs answer the player through adv3Lite-style topic entries, each declaring when it applies, with a match priority, the most specific match winning. Topics live on the actor, an actor state, a conversation node, or a scene. Matching must be deterministic and explainable in the inspector. The passage-file syntax (#115) compiles to whatever the TypeScript API is.

## Decision

- **`topic(npc, entry)`** in `story.ts`:
  - The entry's kind is one of `ask`, `tell`, `askOrTell` (each with a subject), `yes`, `no`, `hello`, or `bye`.
  - A hello or bye can be `implicit: true`, only when nothing was said; `false`, only when said; or neither, for both.
  - `says` is text, or a function that returns it and may change state.
  - `when`, `in` (an actor state or a scene) and `priority` say when it applies.
- **Subjects** are things, facts, named topics, or `anything`.
  - `topics({ weather: "the weather" })` makes named topics as objects, `topic:weather`, so action arguments can carry them.
  - Facts aren't objects, so `ask` and `tell` take a fact by its ID.
- **Matching:** among the entries that apply, the highest priority wins, then the most specific, then the first defined.
  - Most specific means a scene's entry, then an actor state's, then the actor's; and a particular subject over `anything`.
  - Nodes (#116) will rank above scenes.
  - With no match, a default message answers.
- **Actor states** are named per NPC by `actorStates(npc, names, { starts })` and held as game state. `setActorState` changes the state, or sets how it starts when called in `story.ts`.
- **The player's side is standard actions:** `ask`, `tell`, `hello`, `goodbye`, `yes` and `no`, so links, menus, the parser and the inspector all use them.
  - Each takes a minute.
  - Asking starts the conversation, or brings the NPC into it, with any implicit hello.
  - A conversation ending without goodbye runs each participant's implicit bye, told how it ended (`apart` or `ended`).
- **Responses** are `action-result` events tagged `topic` and `speaker:<body>`, so the page shows them after the move. The story log (#126) can attribute them from the tag.
- **Explaining:** a Topics section in the inspector's Choices tab lists each entry of those the player is talking to, or of those present. It says whether each would answer now and, if not, why, naming any entry that outranks it.

## Consequences

- Entry IDs are the mind, kinds, subject, and the entry's number among the NPC's, so they change if entries are reordered. They're for the inspector, not saves.
- Suggesting topics from knowledge, revealing facts (#113), event lists (#112), and show and give topics (#114) build on these entries.

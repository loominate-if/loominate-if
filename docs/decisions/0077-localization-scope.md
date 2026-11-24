# 0077. Localization scope for version one

- **Status:** Accepted, 2026-11-24
- **Issue:** [#60](https://github.com/loominate-if/loominate-if/issues/60)
- **Design:** [Extensibility](../DESIGN.md#extensibility), [ADR 0038](0038-message-parameters.md), [ADR 0039](0039-message-table.md)

## Context

Every library message goes through the message table (ADR 0039), and the world model's English grammar through the message parameter and fallback registries (ADR 0038). The open question was whether version one ships only English, or a second language to prove the table works. A second language means more than messages: the grammar's articles, pronouns, and verb agreement are English code, and a language such as French needs gender and elision.

## Decision

- **Version one ships English only.**
- **A pseudo-locale test proves nothing bypasses the table** (`packages/world/src/pseudo-locale.test.ts`).
  - It replaces every registered message with its key in marks, `⟦take.label⟧`, and every message parameter and fallback the same way.
  - It plays a world-model game through the player shell in jsdom: a room's text and exits, a thing's menu and the form asking how many, the inventory, the clock and compass, and each button in the header and game menu.
  - Every visible text and accessible name (`aria-label`, `title`, and the like) must be marked messages or the game's own words, which the test marks with ω or Ω. Anything else is library English that bypassed the table, and fails the test, naming the element and its text.
  - **Checked that it catches a bypass:** leaving the Undo button's message and "How many?" unreplaced makes it report both.
- **The grammar stays English for now.** It's replaceable already, since a language package replaces the parameters and fallback through their registries. It becomes a named language module, with a documented interface, when a second language actually arrives.
- **Author-facing words stay English:** compiler errors, runtime errors for authors, and the inspector.

## Consequences

- A new player-facing string in the shell or the world model must go through the message table, or the pseudo-locale test fails. A new widget or menu should be added to what the test opens.
- Line-by-line localization of a game's own prose, through line IDs, is still to come, outside version one's scope.

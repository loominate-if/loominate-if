# 0095. Conversation mode

- **Status:** Accepted, 2026-11-24
- **Issue:** [#118](https://github.com/loominate-if/loominate-if/issues/118)
- **Design:** [Conversation mode](../DESIGN.md#conversation-mode), [ADR 0017](0017-layouts-and-widgets.md), [ADR 0087](0087-conversation-model.md)

## Context

Conversations should switch to a layout that focuses on the characters (portraits with changeable expressions, dialogue, topic options) while the room recedes. The layout must be reskinnable or replaceable, accessible, and keyboard operable. NPCs can start a conversation through an agenda item. A conversation ends by goodbye or by world events, such as an NPC leaving on their schedule, and should end cleanly then.

## Decision

- **Presentation gains two generic widgets,** whose data is plain and whose actions the package supplies:
  - `castWidget`: a list of portrait buttons, pressed for the one addressed, showing an image or initials;
  - `actionListWidget`: a list of buttons that take actions, disabled ones shown with why.
- **Layouts can say `standardHeader: true`**, so their header shows the page layout's header widgets (the game menu and what packages add) before their own.
- **Themes get hooks:** notices carry the tags their events share as `data-tags`, alongside the page's existing `data-layout`.
- **The world model registers the `conversation` layout:**
  - regions `header`, `cast`, `main` and `topics`;
  - the widgets `conversation-cast` and `conversation-topics`, from the conversation's participants, portraits, and suggested topics;
  - a standard header.
- **Switching:** starting a conversation switches `display.layout` to it, remembering the layout before. Ending one, however it ends, switches back. Both are game state.
  - `conversationMode({ layout })` picks a game's own layout, and `conversationMode(false)` turns switching off.
  - While the layout shows, `{topics}` in a passage shows nothing, so topics aren't listed twice.
- **Portraits:** `portrait(npc, { image, expressions })`, and `setExpression`/`expressionOf`, game state per mind. An entry's `expression` (or a block's) sets it as the entry answers. A portrait with no image shows initials.
- **NPCs start conversations** with `approach(npc, { says, opens })` in an agenda item, which returns whether they were with the player to do it.
- **Choosing a portrait** takes an internal `address` action, so it's a move that undo and replays see.
- **Walkthroughs:** the testing API's `choose(label)` also takes a button in the current layout's action lists, through an internal hook that action lists keep. So a walkthrough chooses topics the same way in conversation mode.
- **Default styles:** the cast and topic buttons are styled, the room's own prose in conversation mode is muted, and what's said isn't italic.

## Consequences

- The story-so-far drawer sits between the passage and the topics, as it's part of `main`.
- Group conversations (Phase 4) will reuse the cast, with more than one portrait already supported.
- Inventory stays where the game puts it, as in the header; the topics include showing and giving what the addressee has entries for.

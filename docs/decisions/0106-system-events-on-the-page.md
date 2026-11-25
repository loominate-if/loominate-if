# 0106. System events on the page

- **Status:** Accepted, 2026-11-24
- **Issue:** [#270](https://github.com/loominate-if/loominate-if/issues/270)
- **Design:** [Event record](../DESIGN.md), [ADR 0030](0030-recording-events.md), [ADR 0103](0103-story-log.md)

## Context

`{emit "…"}` records `system` events by default, which the page didn't show. `action-result` events already show, as notices. Three things were open:
- whether and where the page shows system messages;
- how an author keeps an event off the page, for the story log alone;
- how a screen reader announces them.

## Decision

- **The page shows system events as notices,** with the move's others: where `{notices}` puts them, or after the passage's text, before its choices, in the order recorded.
  - Each is its own paragraph, with the class `loominate-system`, so themes can set it apart.
  - The default theme shows it smaller and muted.
  - The story so far shows them too.
- **`log-only` keeps an event off the page,** the tag `{log only}` paragraphs get ([ADR 0104](0104-connective-text.md)). Such an event is also left out of the story so far, and is in the story log whatever its kind.
- **Screen readers read them with the rest of the new text** after the player's move, as notices are now: focus moves to just before what's new. There's no separate announcement.
- **The story log still leaves out system messages** unless they're tagged `log` or `log-only`, as ADR 0103 decided: they're the game speaking, not the story.

## Consequences

- An existing game's `{emit}` messages now appear to the player. Tagged `log-only`, one is for the story log alone; tagged `log-only` and `no-log`, for the inspector and transcript alone.
- The inspector guide has a table of what shows where.

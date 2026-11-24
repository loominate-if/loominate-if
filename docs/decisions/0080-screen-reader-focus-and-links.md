# 0080. Screen readers: where focus goes, and links as links

- **Status:** Accepted, 2026-11-24
- **Issue:** [#352](https://github.com/loominate-if/loominate-if/issues/352)
- **Design:** [Accessibility](../DESIGN.md#accessibility), [ADR 0045](0045-reason-tooltips.md), [ADR 0079](0079-preact-for-presentation.md)

## Context

The passage was a polite live region that also took focus after each move, and since #351, focus went to the first paragraph a beat revealed. Testing with VoiceOver in Firefox on macOS showed three problems:

- **Links inside a focused block of text weren't read:** "You could look in the (pause) first", for the inline link "supply shed". VoiceOver reads a focused non-interactive element as a block, and doesn't name the buttons inside it.
- **New text was read twice:** once for the focus, without the inline link, and once by the live region, with it.
- **Focusing a paragraph made VoiceOver describe it as a group,** with "one more item" and similar hints.

Before deciding, four versions were compared with VoiceOver on a throwaway branch:

- A, today: buttons, focus on the new paragraph;
- B: real links, focus on the new paragraph;
- C: real links, focus on a screen-reader-only heading before the new text;
- D: real links, focus on the whole passage.

C read best: the inline links were read in place, as links.

## Decision

- **Links to passages are real links** (`<a href>`, with the page following them on click or Enter).
  - Screen readers read them inside their sentence, as links, which says what's clickable. Voice control's "click supply shed" works on them too.
  - Continue, Skip, and things' names, which open menus, stay buttons: they act rather than go somewhere.
  - A link that can't be followed is still focusable, `aria-disabled`, with its reason as its description.
- **Focus goes to a heading only screen readers see,** just before the new text: "Passage" after a move, "More" after a beat. These are the `page.passageHeading` and `page.moreHeading` messages.
  - This happens after every move and beat the player makes, and when the game loads, so a screen reader starts at the story rather than the header's controls.
  - Focusing a heading, not text, means a screen reader reads on from it, naming the links, without describing a block of text.
  - The next Tab reaches the first choice.
- **The passage isn't a live region,** so text the player moves focus to isn't read twice. What changes without the player moving focus is read through a separate hidden live region (`.loominate-announce`), with only the new text:
  - a timed beat passing while the player is elsewhere;
  - undo, loading a save, or travel in the inspector (`Page.refresh`).
- **The passage keeps its paragraphs' elements** when the heading before them comes or goes: the passage is one flat list of keyed elements.

## Consequences

- **Space no longer follows a link to a passage:** Enter does, as on any web page. Space still presses buttons: Continue, Skip, things' names, and the menus.
- **VoiceOver's own hints, and reading a whole page as it loads, are the player's settings,** in VoiceOver Utility's verbosity options. The page doesn't try to change them.
- **Players hear a word before new text,** "Passage" or "More". A game can reword or translate both.
- **A command line (#131)** would let a screen-reader player play from one text field. #131 notes it as an accessibility feature.

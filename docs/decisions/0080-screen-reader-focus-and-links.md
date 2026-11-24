# 0080. Screen readers: where focus goes, and links as links

- **Status:** Accepted, 2026-11-24
- **Issue:** [#352](https://github.com/loominate-if/loominate-if/issues/352)
- **Design:** [Accessibility](../DESIGN.md#accessibility), [ADR 0045](0045-reason-tooltips.md), [ADR 0079](0079-preact-for-presentation.md)

## Context

The passage was a polite live region that also took focus after each move, and since #351, focus went to the first paragraph a beat revealed. Testing with VoiceOver in Firefox on macOS showed three problems:

- **Links inside a focused block of text weren't read:** "You could look in the (pause) first", for the inline link "supply shed". VoiceOver reads a focused non-interactive element as a block, and doesn't name the buttons inside it.
- **New text was read twice:** once for the focus, without the inline link, and once by the live region, with it.
- **Focusing a paragraph made VoiceOver describe it as a group,** with "one more item" and similar hints.

Several versions were compared with VoiceOver, first in the game on a throwaway branch, then on a plain reference page (`scratch/20-screen-reader-patterns/`, untracked) with one standard pattern per button, in Safari and Firefox.

- **Focusing a heading before the new text** announced only the heading. VoiceOver doesn't read on from where focus lands; reading on is something the player starts.
- **Focusing the new paragraph** read it as a block, still without its links.
- **A live region,** filled with the new text, read it, links included, in both browsers. With focus also moved to a heading first, it read best: the heading, then the new text, once.
- **Text that seemed to read well earlier was a page reload,** where VoiceOver reads the whole page by itself. That had made the heading alone look like it worked.

## Decision

- **Links to passages are real links** (`<a href>`, with the page following them on click or Enter).
  - Screen readers read them inside their sentence, as links, which says what's clickable. Voice control's "click supply shed" works on them too.
  - Continue, Skip, and things' names, which open menus, stay buttons: they act rather than go somewhere.
  - A link that can't be followed is still focusable, `aria-disabled`, with its reason as its description.
- **Focus goes to a heading only screen readers see, then the new text is read through a live region.** That's the reference page's pattern that worked.
  - **The heading:** just before the new text, "Passage" after a move or "More" after a beat. These are the `page.passageHeading` and `page.moreHeading` messages. The next Tab reaches the first choice.
  - **The live region** (`.loominate-announce`) is emptied at once and filled with the new text 300 ms later, as separate changes, so the heading is heard first, and the same words are read again if they come again. Its element stays the same from move to move.
  - **When:** after every move and beat the player makes. Also, without moving focus, when a timed beat passes while the player is elsewhere, and when undo, loading a save, or travel in the inspector changes what's on screen (`Page.refresh`).
  - **When the game loads,** the heading takes focus, so a screen reader starts at the story rather than the header's controls. Nothing is announced, since a screen reader reads a newly loaded page by itself. A redraw that changes nothing, as the shell's just after mounting, is quiet too.
- **The passage isn't a live region,** so new text isn't read twice.
- **The passage keeps its paragraphs' elements** when the heading before them comes or goes: the passage is one flat list of keyed elements.

## Consequences

- **Space no longer follows a link to a passage:** Enter does, as on any web page. Space still presses buttons: Continue, Skip, things' names, and the menus.
- **VoiceOver's own hints, and reading a whole page as it loads, are the player's settings,** in VoiceOver Utility's verbosity options. The page doesn't try to change them.
- **Players hear a word before new text,** "Passage" or "More". A game can reword or translate both.
- **A live region reads link labels as plain words.** A player who moves through the text hears them named as links.
- **An automated check by ear is possible** with Guidepup, which drives the real VoiceOver and records what it says (`bench/screen-reader/`). On macOS it needs Full Disk Access for the terminal that runs it, because it swaps VoiceOver's preferences while it runs, so it isn't run routinely.
- **A command line (#131)** would let a screen-reader player play from one text field. #131 notes it as an accessibility feature.

# 0105. Exporting the story log

- **Status:** Accepted, 2026-11-24
- **Issue:** [#129](https://github.com/loominate-if/loominate-if/issues/129)
- **Design:** [Story log and transcripts](../DESIGN.md#story-log-and-transcripts), [ADR 0103](0103-story-log.md)

## Context

Players can export the story log as Markdown, HTML, or EPUB, structured by author-placed chapter markers. The EPUB output must be valid.

## Decision

- **Chapter markers:**
  - `{chapter "Title"}` is a core arrival directive that records a `chapter` event, with its `title`, when the player reaches it;
  - `chapter("Title")` does the same from code during a move;
  - the story log shows a chapter as a heading;
  - a marker reached again, with the current chapter's title, doesn't start another;
  - what comes before the first chapter is an untitled opening part.
- **Where:** the story log dialog has **Export as** EPUB, HTML, or Markdown, and **Export**, which downloads a file named after the game. The public `exportStoryLog(events, format, options)` returns the file's name, type, and contents, for a game's own button or a test.
- **The formats:**
  - **Markdown:** the title as `#`, chapters as `##`, speakers in bold, the player's lines in italics, with Markdown's special characters escaped.
  - **HTML:** a standalone page, a `section` per chapter.
  - **EPUB 3:** a zip with the mimetype first, `META-INF/container.xml`, a package document, a navigation document, and an XHTML file per chapter. The package records the title, author, language, identifier, and modified date.
- **The zip is written in about seventy lines, stored without compression,** as EPUB allows, so no dependency reaches the player.

## Consequences

- Exported EPUBs are larger than compressed ones; a story log is small text.
- The modified date is wall-clock time, as a save's time is: metadata, not game logic.
- Tests read the EPUB back with their own zip reader, checking each entry's CRC and that every XML file parses. EPUBCheck, the W3C's validator, needs Java, which wasn't available when this was written.
- A game's author isn't in the game config yet, so the dialog's exports have only the title.

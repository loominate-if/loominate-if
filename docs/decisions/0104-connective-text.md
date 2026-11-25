# 0104. Connective text for the story log

- **Status:** Accepted, 2026-11-24
- **Issue:** [#128](https://github.com/loominate-if/loominate-if/issues/128)
- **Design:** [Story log and transcripts](../DESIGN.md#story-log-and-transcripts), [ADR 0103](0103-story-log.md)

## Context

Authors need alternate or connecting text used only in the story log, so prose written for standalone pages reads smoothly when strung together, with syntax in passage files.

## Decision

- **Paragraph markers,** as core directives that compile to a `log` node:
  - `{log only}` marks the next paragraph as only in the story log;
  - `{page only}` marks the next paragraph as only on the page;
  - `{in log: "…"}`, after a paragraph, gives the log's wording of it. It's the directive `in` with a named `log:` argument, which keeps the colon form authors expect.
- **Rendering folds the marks** into the paragraphs as `log: "only" | "never"` and `logText` on the text node, and drops them.
- **Who sees what:**
  - the page doesn't show a log-only paragraph;
  - the record keeps what the page showed apart from what only the log reads: the page's text, tagged `no-log` when it's page-only or has its own log wording, and the log's text, tagged `log-only`;
  - the story so far, which is what the page showed, skips `log-only` events;
  - the story log reads both kinds of event by the existing `log`/`no-log` rules;
  - the transcript has everything.
- **Line IDs** are the paragraph's, for both of its events.

## Consequences

- A conditional paragraph (`{if …}`) can be marked like any other.
- Inline, word-level alternates aren't supported; a paragraph's own log wording covers them.

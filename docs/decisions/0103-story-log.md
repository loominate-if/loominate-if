# 0103. The story log and full transcript

- **Status:** Accepted, 2026-11-24
- **Issue:** [#127](https://github.com/loominate-if/loominate-if/issues/127)
- **Design:** [Story log and transcripts](../DESIGN.md#story-log-and-transcripts)

## Context

One event record feeds three views: the page, the story log for rereading, and the full transcript for testers. Movement, menus and system messages are left out of the story log by default. Authors override with tags, readers filter, undo trims the log, and dialogue is attributed to its speaker.

## Decision

- **`storyLog(events)`,** in presentation, gives the log's entries.
  - **What's in:** `narrative`, `scene`, `dialogue` and `room-description`, and what was noticed: `perception`, `action-result`, `scheduled`.
  - **Room prose:** a room passage's narrative appears on its first visit only, counted from the navigation events.
  - **Order:** each move reads as the page shows it: `lead` notices, then prose, then the rest.
  - **Tags:** `log` puts any event in, and `no-log` leaves one out.
  - **Speakers:** each line's speaker comes from a `dialogue` event's `speaker` or a `speaker:` tag, named through `nameSpeakers`. The world model names bodies by their names, and the player "You". The player's own lines, tagged `player`, are marked as theirs.
- **`transcript(events)`** gives every event with its kind and its text, or its fields when it has none. `transcriptText` makes it plain text.
- **In the player:** the game menu gains "Story log" and "Transcript". Each opens a native modal `<dialog>`, as the save menu does. The log can be filtered to dialogue only, and the transcript by kind and copied.
- **Undo:** both read the record, which lives in the state, so undo trims them.

## Consequences

- Export (#129) builds on `storyLog`.
- Connective text (#128) can be events tagged for the log, or a log-only variant of a line.

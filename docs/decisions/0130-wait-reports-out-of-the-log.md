# 0130. Wait reports out of the story log

- **Status:** Accepted, 2026-11-26
- **Issue:** [#387](https://github.com/loominate-if/loominate-if/issues/387), part of [#134](https://github.com/loominate-if/loominate-if/issues/134)
- **Design:** [Story log and transcript](../DESIGN.md#story-log-and-transcripts), [ADR 0044](0044-action-pipeline.md)

## Context

The standard `wait` and `waitUntil` actions report as plain `action-result` events ("You wait fifteen minutes."), which the story log reads as narration. A playthrough that waits often fills its story log, and its EPUB export, with them. They aren't the story, and they aren't the player's words either. An action's report couldn't carry tags, so neither the library nor an author's own action could say otherwise.

## Decision

- **Core: `reportTags` on actions.** `action(name, { report, reportTags: ["no-log"] })` records the report's `action-result` event with those tags. Any action can use it, and the tags mean what they do anywhere: `no-log`, `log`, `log-only`, or a game's own.
- **World: waits are tagged `no-log`.** The story log leaves out `wait` and `waitUntil` reports, and keeps what happened while the player waited, as "Wren arrives from above." The page and the transcript show them as before.
- Tagging them `player`, to read as the player's move in italics, was considered; a wait isn't something the player says or does in the story, so it reads better left out.

## Consequences

- Story logs and exports of playthroughs that wait read as the story.
- The tags belong to the action's definition, not its report rules, so a game that wants waits in its log defines a wait action of its own.
- New public API: `ActionDefinition.reportTags`.

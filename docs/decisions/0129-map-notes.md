# 0129. Players' notes on the map, and actions outside the story

- **Status:** Accepted, 2026-11-26
- **Issue:** [#397](https://github.com/loominate-if/loominate-if/issues/397), part of [#393](https://github.com/loominate-if/loominate-if/issues/393)
- **Design:** [Presentation](../DESIGN.md#presentation), [The action pipeline](../DESIGN.md#the-action-pipeline), [ADR 0044](0044-action-pipeline.md), [ADR 0126](0126-full-map.md)

## Context

The epic (#393) asked for the player's own notes on rooms, kept with the save and undone with it. State changes must be recorded so undo and replays see them (design principles 3 and 4), and the only recorded changes the player makes are moves. Every action was a turn: the move count went up and characters with `everyTurn` rules acted, so writing a note would have let someone walk off. A continue was the one move that wasn't counted (#311), and each `turnEnd` rule skipped it by name.

## Decision

- **Core: actions outside the story.** `action(name, { …, turn: false })` is logged, saved, undone, and replayed like any action, but it isn't a turn: `turnEnd` doesn't run, so no rule counts it or gives anyone else a turn, and `story.moves` doesn't count it. The page redraws after one without moving focus, so the player stays where they were, as in a dialog. Like TADS's system actions, a game can use it for its own.
- **World: `noteRoom({ room, text })`,** an action outside the story. It writes the player's note on a room they've been to, replacing any, or removes it given empty text. Notes are trimmed and cut to `MAP_NOTE_LENGTH` (500) characters. The room needn't be in reach.
- **Whose notes:** the person playing's, not a character's. They're kept in one world object, by room, so they stay when the game switches who the player is.
- **On the full map:** each room in the list has **Add note**, or **Edit note** and **Remove note**, whose spoken names say which room ("Add note: hall"). Writing one opens a labelled field in place; **Save note** keeps it, **Cancel** or Escape gives it up without closing the map, and focus goes back to the room's button. A note shows as a page mark on the room's box, with the note as its tooltip, in the room's tooltip and reading ("Your note: …"), and in the list. The small map shows the mark too.
- **Generic in presentation:** `automapWidget` takes `note(host, room, text)`; without it, notes are shown but can't be written.

## Consequences

- An undo after writing a note undoes the note, as its own step, named "Note on the kitchen".
- `story.act` takes an untyped `ActionCall`, so examples take a note with `perform`, which is typed.

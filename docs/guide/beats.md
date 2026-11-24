# Beats and cut scenes

Beats pace a passage: a pause, a wait for the player, or a page break. The player reaches the passage's parts in turn, and the story remembers how far they've got, so undo, saves, and replays stop at beat boundaries. [ADR 0021](../decisions/0021-beats.md) records the decisions behind this guide.

## In a passage

```
:: Arrival [scene]
The train is gone before you've finished stepping down.
{beat 1.5s}
{on enter: lamp.lit = true}
Fog has swallowed the platform. Somewhere ahead, a lamp
gutters in the window of {station.theName}.
{wait}
You are not, it seems, expected.
{continue -> Platform}
```

- `{beat 1.5s}` pauses, then shows what follows. Write the time as `1.5s` or `300ms`.
- `{wait}` waits until the player moves on.
- `{page}` waits until the player moves on, then shows what follows in place of what came before, for long introductions. Earlier pages stay in the story so far.
- Beats go at the top level of a passage, not inside `{if}` or emphasis.
- `{continue back}` goes back to the passage the player was at before this one, for a cut scene played from somewhere else, as an NPC's "hear me out" in a conversation.

## Things that happen mid-scene

`{on enter: …}` and `{on first visit: …}` written after a beat run when the player reaches that part, not when they enter the passage. In the example, the lamp lights when the fog appears. `{on first visit: …}` there runs only on the passage's first visit. `{on leave: …}` belongs to the whole passage, so write it before the first beat.

## Game time

A beat's pause is real time, on screen; it never moves the game clock. Whether a cut scene costs game time is a separate choice you make, beat by beat, with `minutes`: that much game time passes as the player moves past the beat, whether they wait it out or skip it.

```
:: Night watch [cutscene]
You settle in by the fire. It's {timeOfDay()}.
{beat 2s, minutes: 120}
The fire burns low. It's {timeOfDay()}.
{beat 2s, minutes: 180}
Grey light creeps over the hills. It's {timeOfDay()}.
{page}
You stand and stretch.
```

Two real seconds each, and five game hours in all. The time passes before the next part, so its text and effects see the new time, and fuses and daemons due on the way fire in order; what they say belongs to that part. `{wait minutes: 30}` and `{page minutes: 600}` work the same way. A beat without `minutes` costs no game time. The world model's clock keeps the time, hearing it through core's `beatTime` hook; without the world model, a game can handle that hook with its own clock. To cost the whole passage at once, `{on enter: clock.advance(30)}` still works.

## What players get

- After a timed pause, the next part appears below what's shown. Clicking the page hurries the pause along.
- At `{wait}` and `{page}`, a Continue button moves on.
- While any beat is left, a Skip button shows the rest of the passage at once.
- Screen readers announce each new part as it appears, without repeating what came before.
- When the player prefers reduced motion, timed pauses pass at once. `{wait}` and `{page}` still wait for them.
- Undo steps back one beat at a time, and a game saved mid-scene loads at the same beat.

## In code

`mountPage` plays beats. Its options:

- `onMove(move)` is called for each beat the player moves past, with the beat, as well as for each choice. Checkpoint undo history or autosave there, and both stop at beat boundaries.
- `pacing: "immediate"` passes timed pauses at once, as reduced motion does. Offer it as a setting, for example for screen-reader players.
- `continueLabel` and `skipLabel` change the buttons' labels.

Without the page, `story.render()` says what's pending: `beat` is the next beat, if any, and `step` is how many the player has moved past. `story.advance()` moves past the next one.

# 0021. Beats and cut scenes

- **Status:** Accepted, 2026-11-19
- **Issue:** [#41](https://github.com/loominate-if/loominate-if/issues/41)
- **Design:** [Cut scenes and beats](../DESIGN.md#cut-scenes-and-beats), [ADR 0009](0009-replay-files.md), [ADR 0015](0015-compiler-extensions.md), [ADR 0020](0020-named-effects.md)

## Context

The design calls for scenes made of beats the runtime understands: timed pauses, waits for the player, paced reveals, and continue points. Players can skip or fast-forward. Reduced-motion settings and screen readers get the text immediately. Save and undo happen cleanly at beat boundaries, scenes can trigger events mid-sequence, and long introductions can page. Until now, `{beat}` and `{wait}` were compile errors naming this issue (ADR 0005).

## Decision

### Beats divide a passage into parts, in story state

- `{beat 1.5s}` is a timed pause and `{wait}` waits for the player. `{page}` waits for the player, then shows what follows in place of what came before. They're core content directives that compile to `beat()`, `wait()`, and `pageBreak()`, each returning a `BeatNode`.
- The story stores how many beats the player has moved past in the current passage, at `$story.step`, cleared when they enter a passage. `render()` shows the parts up to that step, from the last page break before it, with the choices among them. It sets `beat` to the beat still to come, and `step` to the count.
- `story.advance()` moves past the next beat. It's an action, so it's logged, undone, saved, and replayed like a move. It records a `beat` event and the newly revealed part's prose, so the event record stays exactly what the player read. It doesn't run turn hooks: whether a cut scene costs game time is a separate choice (DESIGN, game time versus presentation time).
- Replay files are now version 5, which adds `{"type": "advance"}`. Older versions still play, and they can't contain it.

### Scenes change things as they unfold

- `{on enter: …}` and `{on first visit: …}` written after a beat run when the player reaches that part: `firstVisit` only on the passage's first visit, `enter` every time. Compiled passages carry them as `beats`, one entry per beat. `{on leave: …}` belongs to the whole passage, so writing it after a beat is a compile error.
- A beat inside `{if}` or emphasis is a compile error. Parts must be the same however the passage renders, or effects would attach to the wrong part.
- Directive definitions say `beat: true` to be beats, so kits can add beat-like directives, such as the visual novel kit's textbox (ADR 0015).

### The page plays them

- **Timed beats** wait out their duration with a wall-clock timer, then call `advance()`. Wall-clock time paces only the presentation; the story moves on through the logged action. A click on the page, away from its controls, hurries the pause along.
- **`{wait}` and `{page}`** show a Continue button. While any beat is pending, a Skip button moves past every remaining beat at once, without playing their named effects.
- **A new part is added after what's on screen**, so the live region announces only the new text, and only that part's named effects play. A page break clears the screen first. The story-so-far drawer treats each earlier page of a passage as its own turn.
- **Pacing.** With `pacing: "immediate"`, or when the player prefers reduced motion, timed beats pass at once as the player arrives. `{wait}` and `{page}` still wait, since they're interactions, not motion. A game can offer `immediate` as a setting, for example for screen-reader players. Undo and `refresh()` don't move on by themselves.
- `onMove` is called for each beat moved past, with the `BeatNode`, so an undo checkpoint or autosave there stops at beat boundaries.

## Consequences

- A save made mid-scene restores to the same beat, and a replay reproduces every beat. The cost is one action per beat in the log.
- `PageOptions.onMove` now receives `Choice | BeatNode`.
- Fast-forwarding a whole replay is just playing it, since beats are actions. The page's Skip is the in-play equivalent.
- The textbox, auto-advance, and NPC exchanges planned for later phases build on beats rather than inventing their own pacing.

# 0036. Visit memory per mind, and amnesia

- **Status:** Accepted, 2026-11-22
- **Issue:** [#200](https://github.com/loominate-if/loominate-if/issues/200)
- **Design:** [Inline code and effect phases](../DESIGN.md#inline-code-and-effect-phases), [World model library](../DESIGN.md#world-model-library), [ADR 0035](0035-knowledge-and-facts.md)

## Context

Core counts visits per passage, once for the whole game (#21). Authors want "first visit" from the point of view of the player character: after switching characters, the new one's first visit should read as a first visit, and an amnesiac should find familiar places unfamiliar. Remembering where you've been is a memory, and memories belong to minds (ADR 0035), which core doesn't know.

## Decision

### Core

- Core still counts every real visit in `$visits`, read as `story.totalVisits(id)`, for the story map, coverage, and the inspector.
- `useVisitMemory({ count, record })` sets where visits are remembered. `count(passage)` returns the remembered count, or `undefined` to use the real one; `record(passage)` runs during the move, after the real count goes up. With none set, memory is the real count, so a game without the world model sees no change.
- `story.visits(id)`, `story.visited(id)`, and a passage's `visits`, `firstVisit`, and `visited()` answer from memory. `{on first visit: …}`, after a beat too, runs on the first remembered visit, so text and effects agree. One-time changes to the world belong in state, such as a flag, rather than in `on first visit`.
- The memory is set for the whole program, like hooks, not per story: a game has one world model.

### World

- The world model sets the visit memory when it's imported. Visits are kept in the player's mind's knowledge record, per passage and per room. Before `startAs`, `count` returns `undefined`.
- `visitsTo(room)` is the player's mind's count, as passages' `visits` are, and `totalVisitsTo(room)` the real one. `{exits}` names rooms the player's mind has visited.
- Forgetting is for good: `forget(place)` also forgets visits to the place and the passages that describe it, `forgetVisits(passage)` one passage's, and `forgetVisits()` every passage's and room's.

### Amnesia

- `loseMemory()` blocks everything a mind remembers, until `regainMemory()`: facts, things seen and familiar, and visits. `hasAmnesia` says whether it's in effect.
- The record keeps two layers, the mind's memories and those formed during amnesia, and while amnesia lasts only the second is recalled or written. Lifting it merges them: visits add up, seen and familiar combine, and a fact in both keeps the earlier source. `forget()` and `forgetVisits()` reach both layers. Amnesia doesn't nest: losing memory again while amnesiac does nothing.

## Consequences

- Without the world model nothing changes; with it, a game that switches characters sees first visits per character. A game relying on `on first visit` running once per game must use a flag instead.
- `record` runs inside the move, so undo, saves, and replays cover remembered visits like any state.
- The inspector shows both: real counts under `$visits`, a mind's under `world:knowledge:<mind>`. A dedicated view can come with the object tree (#82).

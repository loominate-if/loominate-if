# 0060. Scenes

- **Status:** Accepted, 2026-11-23
- **Issue:** [#68](https://github.com/loominate-if/loominate-if/issues/68)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0044](0044-action-pipeline.md), [ADR 0050](0050-fuses-and-daemons.md)

## Context

The world model should have scenes: named periods of the story with start and end conditions, which add rules, actions, and topics while active. That's the scene of Inform 7 and adv3Lite. The design also used `[scene]` for a cut scene, a passage of beats, which the visual-novel sense of the word suggests. Rules are code, registered when the game loads, while whether a scene is happening is state that undo and loading a save change.

## Decision

- **The name:** the world model's period is a **scene**, as IF authors know it from Inform 7 and adv3Lite. A cut-scene passage will be tagged `[cutscene]` when that role is built. The design doc now says so. Guides and examples that use `[scene]` as a plain tag keep it until then. The core `scene` event kind is left as it is.
- **Defining one:** `scene(id, options)` keeps its state in `world:scene:<id>`: whether it's happening, how many times it has started, when it last started, and how it last ended.
- **Starting:**
  - `startsWhen` is checked after every move (a `turnEnd` rule) and whenever a fuse or daemon fires (a new internal listener in the schedule), in the order scenes were defined.
  - `startsAt` (with `on`) uses a timed daemon.
  - `scene.start()` starts it from code.
- **Ending:**
  - `endsWhen` is one condition (ending `"ended"`) or several, each naming its ending, like Inform's "ends happily".
  - `lasts` uses a fuse, ending `"timeUp"`.
  - `scene.end(how)` ends it from code.
  - `onStart` and `onEnd(how)` may return text, recorded as a standing-out `scheduled` event from `scene:<id>`.
- **Repeats:** a scene happens once unless `recurring: true`, or a number of times at most. Starting a finished one-time scene, or one that's happening, from code is an error. Its conditions stop starting it.
- **Rules:** `scene.rule(book, name, fn)` registers the rule once, at load, wrapped so it takes part only while the scene is happening. While it isn't, a decide rule decides nothing, a fold rule passes its value on, and a hook's rule does nothing. So undo and loading always agree with what's happening. Its source reads "game (during the storm)" for the inspector.
  - The issue asked that a scene's rules be removed when it ends. They're registered for good instead, and take no part while it isn't happening. Adding and removing them for real would have to be redone on every undo and load.
- **Actions:** core's action definition gains `during`, any `Period` (an ID, a name, and `isHappening`), so core needn't know about scenes. While it isn't happening, the action isn't offered: a verify rule hides it, and the inspector explains with the `action.notDuring` message, core's first message of its own.

## Consequences

- Topics come with conversations, and can take `during` too.
- #90 (whether a cut scene costs game time) and #89's "scenes start at a time" build on this: a scene can start at a time, and a cut scene can start a scene.

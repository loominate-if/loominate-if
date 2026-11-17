# 0009. Action log and replay files

- **Status:** Accepted, 2026-11-17
- **Issue:** [#25](https://github.com/loominate-if/loominate-if/issues/25)
- **Design:** [Randomness](../DESIGN.md#randomness), [Tooling](../DESIGN.md#tooling), design principle 4 (determinism)

## Context

A seed plus an action list reproduces a playthrough, and bug reports can be small replay files. The design leaves open:
- what counts as an action, and how a logged action finds the same choice again;
- where the log lives, and how it interacts with undo and saves;
- the replay file format;
- what happens when a replay no longer fits the game.

## Decision

### Actions

- An action is something the player did that moves the story on. Phase 1 has two:
  - `{"type": "follow", "choice": {...}}`, from `story.follow()`;
  - `{"type": "goTo", "passage": "..."}`, from `story.goTo()`.
- A followed choice is logged as its `type` (`link` or `continue`), `target`, and `label`: the same fields `follow()` already matches choices by. Guards aren't logged; they're worked out again on replay, so a replay can't follow a link that's closed.
- Beginning the story isn't an action. It follows from the seed and the start passage.
- Later layers add action types (parser commands, world actions, conversation topics) with a new replay version.

### The log

- The story keeps its log in the state store, at `$actions`: a `length` field, then one field per action by index, as the event record does.
- An action is logged only once it succeeds, so a refused choice or a move whose effect throws leaves no entry.
- Because the log is ordinary state, undo trims it and saves carry it. A replay made after undoing reproduces the current state, not the undone path. A save can always be turned into a replay.

### Replay files

A replay file is JSON:

```json
{
  "format": "loominate-replay",
  "version": 1,
  "seed": "fog-bound",
  "actions": [
    {"type":"follow","choice":{"type":"link","target":"Road","label":"Walk on"}},
    {"type":"goTo","passage":"Cellar"}
  ]
}
```

- `format` marks the file as a replay; `version` is the file version, 1 here; `seed` is the master seed (ADR 0008); `actions` lists every action since the story began, in order.
- `writeReplay` writes fields in a fixed order with one action per line, so the same replay always gives the same text and replays diff well.
- `readReplay` accepts exactly this shape and explains anything else: invalid JSON, the wrong `format`, a newer version, a missing or unknown field. Unknown fields are refused rather than ignored, so nothing in a file is silently dropped; adding a field means a new version.

### Playing a replay

- `story.playReplay(replay)` needs a story that hasn't begun, over a fresh store. It stores the replay's seed, begins, and takes each action in order.
- Playing a replay reproduces the whole store, including the event record and the action log, so the copy can itself be saved or turned into a replay.
- If an action fails, for example because the game changed since the replay was made, the error names the action ("replay action 3 of 5 (continue to "Road"): ...") and the story stays at the last action that worked, so the inspector can show where it diverged.

## Consequences

- Replay files are now a format with a version. Changing what version 1 means breaks existing replays; additions need version 2.
- Saves grow by one small entry per action, much less than the event record they already carry.
- Replays don't record the game or engine version yet. Saving (#22) settles how those versions are named; replay files should carry them the same way, in a later version ([#228](https://github.com/loominate-if/loominate-if/issues/228)).
- A replay depends on passage IDs and choice labels. Renaming a link's label breaks replays that follow it, just as renaming a passage does.
- Opening replay files in the inspector, and running them as walkthrough tests, build on `readReplay` and `playReplay`.

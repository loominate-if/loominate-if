# Walkthrough tests

A walkthrough test plays your game the way a player would, makes choices in order, and checks what the player sees and what the game's state is. Run them with:

```sh
npm test
```

That's `loominate test`, which runs every `*.test.ts` file in the game with [Vitest](https://vitest.dev). Name files to run only those (`npm test -- cellar`), or add `--watch` to rerun as you edit. [ADR 0026](../decisions/0026-walkthrough-tests.md) records the decisions behind this guide.

## A first walkthrough

```ts
import { play } from "@loominate-if/testing";
import { expect, test } from "vitest";
import { lamp } from "./story.js";

test("lighting the lamp", () => {
  const game = play();
  expect(game.text).toContain("An unlit lamp sits on the table.");

  game.choose("Light the lamp");
  expect(lamp.lit).toBe(true);

  game.choose("Continue");
  expect(game.choices).toEqual(["Look around"]);
});
```

`play()` starts a new game from the start passage in `loominate.config.ts`, with every passage file in the game. Your objects, like `lamp`, read and write the walkthrough's state, so you can check them directly.

## Making moves

- `game.choose("Light the lamp")` makes the choice with that label. A continue point without a label is `"Continue"`.
- `game.notices` is what the player noticed during the last move, such as "You hear a door slam from above.", one per line. `game.text` has them where the page shows them: where the passage's `{notices}` is, or else after its text and before its choices.
- `game.advance()` moves past the next beat (`{beat}`, `{wait}`, or `{page}`), and `game.skip()` moves past all of them.
- `game.undo()` takes back the last move.

Each returns the game, so you can chain them: `game.choose("Go down").skip().choose("Open the door")`.

If a choice isn't there, the test fails, saying which choices there were. If it's a link whose condition doesn't hold, it also says the condition and the reason the player is told:

```
There's no choice "Go down" in passage "Stairs". "Go down" can't be followed: `lamp.lit` doesn't hold (the player is told "It's too dark."). The choices are: "Back up".
```

## Checking what the player sees

| | |
| --- | --- |
| `game.passage` | The current passage's name. |
| `game.text` | The prose on screen, one paragraph per line, with what the player noticed where the page shows it. |
| `game.notices` | What the player noticed during the last move, and what their actions did. |
| `game.choices` | The labels of the choices that can be made now. |
| `game.unavailable` | Links that can't be followed now, each with its `label`, `condition`, `reason` (if the player is told one), and whether it's `shown` disabled or hidden. |
| `game.beat` | The beat waiting to be moved past, if any. |
| `game.transcript` | Every paragraph the player has read so far. |

## Seeds, saves, and replays

- Random results are the same every run: walkthroughs use the seed `"walkthrough"` unless you pass another, `play({ seed: "stormy" })`.
- `play({ from: state })` starts from a saved state instead of a new game.
- `game.replay()` gives the replay file for the playthrough, to attach to a bug report or to check that two runs match.
- `game.record` is the event record: `game.record.events({ tags: ["lamp"] })` lists the events with a tag, such as ones your passages record ([inspector guide](inspector.md#recording-your-own)).
- `game.story`, `game.store`, and `game.history` are there for anything else.

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

- `game.choose("Light the lamp")` makes the choice with that label. A continue point without a label is `"Continue"`. It also takes a button with that label in the layout's action lists, such as conversation mode's topics.
- `game.notices` is what the player noticed during the last move, such as "You hear a door slam from above.", one paragraph per line, as the page shows them: the atmosphere from fuses and daemons is one line. `game.text` has them where the page shows them: where the passage's `{notices}` is, or else after its text and before its choices.
- `game.advance()` moves past the next beat (`{beat}`, `{wait}`, or `{page}`), and `game.skip()` moves past all of them.
- `game.act("Ring the bell")` takes an action from a menu by its label: the menu of anything the player can act on, or that a link on screen opens a menu for. If it's disabled, the test fails with the reason.
- `game.undo()` takes back the last move.

<!-- example: packages/testing/src/menus.test.ts#act -->
```ts
const game = play({ passages, start: "Hall" }).act("Ring the bell");
expect(game.notices).toBe("Ding!");
```

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
| `game.menu(thing)` | A thing's menu: each entry's `label`, and why it's `disabled`, if it is. |
| `game.compass` | The compass's ways out, each with its `label`, `title`, whether it's `available`, and its `reason`, or `undefined` if the game has no compass. |

## Seeds, saves, and replays

- Random results are the same every run: walkthroughs use the seed `"walkthrough"` unless you pass another, `play({ seed: "stormy" })`.
- `play({ from: state })` starts from a saved state instead of a new game.
- `game.replay()` gives the replay file for the playthrough, to attach to a bug report or to check that two runs match.
- `game.record` is the event record: `game.record.events({ tags: ["lamp"] })` lists the events with a tag, such as ones your passages record ([inspector guide](inspector.md#recording-your-own)).
- `game.story`, `game.store`, and `game.history` are there for anything else.

## Coverage reports

`npx loominate coverage` reports, in two parts, what players can't reach and what your walkthroughs never reach:

```
Can't be reached (2):
  Passages
    rooms.weft:11: Nothing leads to `Cellar` from `Hall`, so players can't reach it. …
  Facts
    the affair (affair): No topic is about it, so no one can be asked about it. …

Not reached by walkthroughs (3 of 22, from 7 tests):
  Passages: all 5 reached
  Topics: 2 of 15 not reached
    Say no to the maid
    Ask Rex about what they found
  Actions: 1 of 2 not reached
    Wave the fan
```

- **Can't be reached** is what the game's structure rules out:
  - passages nothing leads to, and rooms no exit leads to, as the compiler warns;
  - with the world model, facts no topic is about, so no one can be asked about them;
  - conversation nodes no topic opens;
  - actions on things that are all out of the world when the game begins;
  - a game that can't start at all, as when a hard-locked node has no way out.
- **Code can do what the structure can't show.** If a walkthrough reaches something the structure rules out, such as a passage only code goes to, that finding is left out. A node the game opens with `openNode()` can say `openedElsewhere: true` instead.
- **Not reached by walkthroughs** is like code coverage: every passage, action on a thing, topic, fact, and conversation node, with those your walkthroughs never reached, so you know what to write a walkthrough for. A passage counts once it's visited, a topic once it answers, a fact once the player knows it, and a node once one of its replies answers.
- **In CI,** `npx loominate coverage --strict` fails when anything can't be reached or a walkthrough fails. What walkthroughs don't reach never fails it. `--json coverage.json` writes the report as a file too.
- **Packages add their own checks** with `coverageChecks.register(name, { title, unreachable, items, reached })` from `@loominate-if/core`. Each part is a function given the begun game, or the walkthrough's game at its end: `unreachable` returns findings, each with a `label`, a `why`, and an optional `key`; `items` lists what to reach, each with a `key` and a `label`; and `reached` gives the keys reached.

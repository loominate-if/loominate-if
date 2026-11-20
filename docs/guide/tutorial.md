# Tutorial: The Last Watch

This tutorial builds *The Last Watch*, a short branching story. A lighthouse keeper on a stormy night has to find the matches, light the lamp, and decide whether to signal a ship running for the rocks. There are three endings.

On the way you'll meet most of what a plain story needs: passages and links, state kept in TypeScript objects, conditions, links that stay hidden or disabled until they can be followed, code that runs when the player arrives or leaves, pauses and page breaks, effects, randomness, and walkthrough tests. There's no world model: a story like this one never needs it.

The finished game is in [`examples/branching-story`](../../examples/branching-story). All the code below is copied from it, and Loominate's own tests build it and play it through, so what you type here works.

## Create the game

Set up a new game as in [Getting started](getting-started.md):

```sh
npm create @loominate-if the-last-watch
cd the-last-watch
npm install
```

The new game's `loominate.config.ts` already has the title, *The Last Watch*, from the folder's name, and starts at the passage named `Start`. Delete `start.weft` and `walkthrough.test.ts`; you'll write your own.

## The story's state

Everything in the story that can change is kept in objects. Replace `story.ts` with this:

<!-- example: examples/branching-story/story.ts -->
```ts
// The objects the story's passages use. Everything exported here is in scope in passage files.
import { object, randomStream } from "@loominate-if/core";

/** You: the lighthouse keeper. */
export const keeper = object("keeper", {
  /** Whether you've found the matches in the shed. */
  hasMatches: false,
});

/** The lighthouse lamp. */
export const lamp = object("lamp", {
  lit: false,
  /** Days of oil left. Each time you leave the lamp room, it burns a little more. */
  oil: 3,
});

/** What happens out on the water tonight. */
export const night = object("night", {
  /** The ship in danger, chosen when the story begins. */
  ship: "",
  signalled: false,
  /** Whether the ship turned away from the rocks. */
  turned: false,
  logEntries: 0,
});

/** The storm, for whatever's left to chance. */
export const storm = randomStream("storm");

/** The ships that might be out tonight. */
export const SHIPS: readonly string[] = [
  "the Marguerite",
  "the Hollow Bell",
  "the Ansel Grey",
  "the Kestrel",
];
```

- `object("lamp", { … })` makes an object with an ID, `"lamp"`, and its starting state. The ID is how saves find the object again, so don't change it once players have saves.
- Its properties are the story's state. Read and set them as you would any property, `lamp.lit = true`, and undo, saves, and replays see every change.
- Everything `story.ts` exports can be used in passages without importing it.
- `randomStream("storm")` is a named source of chance. What it gives follows from the game's seed, so a replay of a playthrough meets the same ship. Use streams, never `Math.random()`, for anything that affects the story.
- `night.ship` starts empty. The opening chooses it.

## The opening

Passages live in `.weft` files, and every one in the folder is part of the game. Make `intro.weft`, with the passage the game starts in:

<!-- example: examples/branching-story/intro.weft#Start -->
```weft
:: Start [scene]
{on first visit: night.ship = storm.pick(SHIPS)}
The supply boat left you here in October, with a crate of oil, a crate of tins, and the promise that someone would come back in spring.
{page}
Tonight the wind has a voice. It worries at the shutters and pulls at the door, and somewhere below the cliff the sea is breaking white.
{beat 1.5s}
It is time to light the lamp.
{continue -> Cottage, label: "Begin"}
```

- `:: Start [scene]` begins a passage named `Start`. Words in square brackets are tags, which label a passage; these don't change how it plays.
- `{on first visit: …}` runs its code the first time the player arrives, and only then. The code is TypeScript, type-checked against `story.ts`: `storm.pick(SHIPS)` chooses one of the ships.
- `{page}` waits until the player presses Continue, then shows what follows in place of the first page, the way a book turns a page.
- `{beat 1.5s}` pauses before the last line. Clicking hurries it along, and players who prefer reduced motion don't wait at all.
- `{continue -> Cottage, label: "Begin"}` is a button, labelled Begin, that goes to the passage named `Cottage`.

Start the dev server:

```sh
npm run dev
```

The terminal, and the page in your browser, say there's no passage named `Cottage`. Every link is checked as you write it, so a misspelled or missing passage is reported before anyone plays. The next passage fixes this one.

## The cottage and the shed

Add these two passages to `intro.weft`:

<!-- example: examples/branching-story/intro.weft#Cottage -->
```weft
:: Cottage
{if firstVisit}The cottage is cold.{else}The cottage is as you left it.{/if} Your coat hangs by the door, and the tower stands black against the clouds. You could look in the [[supply shed -> Shed]] first, or go straight up.

[[Climb the tower -> Stairs]]
[[Stay by the fire -> Hearth]]{when visited("Stairs"), hidden}
```

<!-- example: examples/branching-story/intro.weft#Shed -->
```weft
:: Shed
{on first visit: keeper.hasMatches = true}
{if firstVisit}Behind the oil drums you find a tin of matches, dry as bone. You pocket it.{else}There's nothing else here you need.{/if}

[[Back to the cottage -> Cottage]]
```

- `{if firstVisit}…{else}…{/if}` shows one text or the other. `firstVisit` holds on the player's first visit to the passage.
- `[[supply shed -> Shed]]` is a link, written inside the sentence: its label, then the passage it goes to.
- `{when visited("Stairs"), hidden}` after a link guards it. The link stays hidden until the player has been up the stairs, so the choice to give up appears only once they've seen the tower. Passage names in code, like `"Stairs"`, are checked too.
- `{on first visit: keeper.hasMatches = true}` in the shed gives the keeper the matches. Code like this runs once for each time the player actually arrives. Undo takes it back, and loading a save or drawing the passage again never runs it twice.

## Up the tower

Make `tower.weft`, with the stairs:

<!-- example: examples/branching-story/tower.weft#Stairs -->
```weft
:: Stairs
{effect shake}
The spiral stair shudders as a gust hits the tower. {visits === 1 ? "A hundred and twelve steps to the top." : "The steps again, slick with damp."}

[[Light the lamp -> Lamp Room]]{when keeper.hasMatches, reason: "Your pockets are empty. The matches are in the shed."}
[[Go back down -> Cottage]]
```

- `{effect shake}` shakes the page as the player arrives. Effects play only on arrival, a click finishes them, and they're skipped for players who prefer reduced motion. The [effects guide](effects.md) lists them all.
- Anything else in braces is a TypeScript expression, and the passage shows its value. `visits` is how many times the player has arrived here, this time included.
- `{when keeper.hasMatches, reason: "…"}` shows the link disabled, with the reason, until the keeper has the matches. The player sees what they can't do yet, and why.

## The lamp room

Add the lamp room to `tower.weft`:

<!-- example: examples/branching-story/tower.weft#Lamp Room -->
```weft
:: Lamp Room
{on enter: lamp.lit = true}
{on leave: lamp.oil -= 1}
{effect typewriter}
The wick takes the flame, and the great lens turns it into a beam that sweeps across the water.
{if night.turned}Far to the south, {night.ship} is running for shelter.{else}Far out, a ship's lights: {night.ship}, running before the storm, straight for the rocks.{/if}

[[Signal the ship -> Signal]]{when !night.signalled, disabled}
[[Write in the log -> Log]]
[[Sleep until morning -> Dawn]]{when night.turned, hidden}
[[Sleep until morning -> Wreck]]{when !night.turned, hidden}
```

- `{on enter: …}` runs each time the player arrives, and `{on leave: …}` each time they leave. Climbing up lights the lamp, and every trip out of the room burns a night's oil.
- `{effect typewriter}` reveals the next paragraph a character at a time.
- `{night.ship}` shows the ship's name, whichever one the storm chose.
- `{when !night.signalled, disabled}` shows the link disabled, with no reason given, once the ship has been signalled.
- The two *Sleep until morning* links go to different endings, each hidden unless its condition holds. The player sees one, and it leads to the ending their choices earned.

## Signalling the ship

Add the signal, and the keeper's log:

<!-- example: examples/branching-story/tower.weft#Signal -->
```weft
:: Signal
{on enter: night.signalled = true}
You work the shutter: long, short, long. *Rocks. Turn back.*
{beat 2s}
{on enter: night.turned = true}
For a long moment, nothing. Then, slowly, the ship's lights swing away to the south.
{wait}
They are safe, or they will be.
{continue -> Lamp Room, label: "Back to the lamp"}
```

<!-- example: examples/branching-story/tower.weft#Log -->
```weft
:: Log
{on enter: night.logEntries += 1}
You write by the lamp's light. Entry {night.logEntries}: {if night.turned}Signalled {night.ship}; she turned south.{else}Wind north-east and rising. {night.ship} in sight.{/if} Oil for {lamp.oil} {lamp.oil === 1 ? "night" : "nights"}.
{continue -> Lamp Room}
```

- After `{beat 2s}`, the story waits two seconds before the ship answers. Code written after a beat runs when the player reaches that part, so the ship turns only once the pause is over.
- `{wait}` waits until the player presses Continue.
- `*Rocks. Turn back.*` is emphasis, and `**…**` is strong emphasis.
- `{continue -> Lamp Room}` with no label is a Continue button.

The [beats guide](beats.md) has more on pauses, waits, and page breaks.

## The endings

Make `endings.weft`:

<!-- example: examples/branching-story/endings.weft#Dawn -->
```weft
:: Dawn [ending]
{effect fade}
Morning comes grey and quiet. Far to the south, a ship rides at anchor in the lee of the headland: {night.ship}, safe.

**The end.**
```

<!-- example: examples/branching-story/endings.weft#Wreck -->
```weft
:: Wreck [ending]
In the morning the beach is strewn with timber, and a nameboard lies half buried in the sand. It reads {night.ship}.

**The end.**
```

<!-- example: examples/branching-story/endings.weft#Hearth -->
```weft
:: Hearth [ending]
You sit by the fire and listen to the wind, and you don't climb the tower again. Whatever passed on the water in the night, you never learn.

**The end.**
```

A passage with no links ends the story. `{effect fade}` fades the last morning in.

With every passage written, the terminal says the game has no problems. Play it through in the browser: find the matches, light the lamp, and try each ending. Edits reload the page where you were, and the game menu's Undo takes back a move.

## Test it

A walkthrough test plays the game as a player would and checks what happens. Make `walkthroughs.test.ts`:

<!-- example: examples/branching-story/walkthroughs.test.ts#setup -->
```ts
import { play } from "@loominate-if/testing";
import { describe, expect, it } from "vitest";
import { keeper, lamp, night, SHIPS } from "./story.js";

/** Plays from the start to the cottage, past the opening's page break and beat. */
const arrive = (seed?: string) =>
  play(seed === undefined ? {} : { seed })
    .advance()
    .advance()
    .choose("Begin");
```

`arrive()` plays the opening: `advance()` moves past a beat or page break, as Continue does, and `choose("Begin")` makes a choice by its label. Then add a test that plays to the good ending, inside a `describe("The Last Watch", () => { … })` block:

<!-- example: examples/branching-story/walkthroughs.test.ts#dawn -->
```ts
it("ends at dawn when the keeper signals the ship", () => {
  const game = arrive().choose("supply shed").choose("Back to the cottage");
  game.choose("Climb the tower").choose("Light the lamp");
  expect(lamp.lit).toBe(true);
  expect(game.text).toContain(`Far out, a ship's lights: ${night.ship}`);
  expect(game.choices).toEqual(["Signal the ship", "Write in the log", "Sleep until morning"]);

  game.choose("Signal the ship");
  expect(night.signalled).toBe(true);
  // The ship turns only once the pause is over: an effect written after a beat.
  expect(night.turned).toBe(false);
  game.advance();
  expect(night.turned).toBe(true);
  expect(game.text).toContain("the ship's lights swing away to the south");
  expect(game.beat).toEqual({ type: "beat" });
  game.advance().choose("Back to the lamp");

  // Signalling is now shown disabled, and sleeping leads to the good ending.
  expect(game.unavailable.map((u) => [u.label, u.shown])).toContainEqual([
    "Signal the ship",
    true,
  ]);
  game.choose("Sleep until morning");
  expect(game.passage).toBe("Dawn");
  expect(game.text).toContain(`${night.ship}, safe.`);
  expect(game.choices).toEqual([]);
});
```

- `game.text` is the prose on screen, and `game.choices` the choices the player can make.
- Your objects, like `lamp` and `night`, hold the walkthrough's state, so the test checks them directly: the ship turns only after the pause.
- `game.unavailable` lists the links the player can't follow, and whether they're shown disabled or hidden.
- Walkthroughs use the same seed every run, so the ship is the same each time.

Run it:

```sh
npm test
```

The example has a walkthrough for each ending, and ones for the locked lamp, undo, saves, and replays. When an edit breaks a path through your story, a walkthrough says which choice wasn't there, and why. The [walkthrough guide](walkthroughs.md) has the rest.

## Share it

```sh
npm run build
npm run build:single
```

The first writes a static site to `dist/`, for any web host. The second writes `dist/the-last-watch.html`, one file that opens by double-click. [Getting started](getting-started.md#build-it) has the details.

## Where next

- [Playing](playing.md): saves, autosave, the start screen, and the game menu.
- [Beats](beats.md) and [effects](effects.md): pacing and motion.
- [Theming](theming.md): colours, fonts, and layout.
- [Walkthroughs](walkthroughs.md): everything a test can check.

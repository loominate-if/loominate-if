# The world model

The world model is an optional package for games with places and things in them: rooms to move between, boxes to open, and lamps to light. A plain branching story doesn't need it, and pays nothing for it.

It's `@loominate-if/world`. It isn't published to npm yet, while the rest of the world model is built ([Phase 2](https://github.com/loominate-if/loominate-if/issues/58)); this guide grows with it. ADRs [0031](../decisions/0031-containment-and-scope.md), [0032](../decisions/0032-minds-and-bodies.md), [0033](../decisions/0033-rooms-and-regions.md), and [0034](../decisions/0034-exits-and-directions.md) record the decisions behind it.

So far, the world model keeps track of where things are, what can be sensed, which mind is in which body, which room the player is in, and the ways between rooms. It doesn't show anything or add links by itself: a thing in a room doesn't appear in the passage, and there's no "open the box" until you write one. Your passages decide what to show, with checks such as `{if canSee(player, coin)}`, and links call methods such as `box.open()` in an `on enter` effect. Export from `story.ts` every thing a passage mentions. Listing what's in a room, the compass, and actions come in later tasks ([#69](https://github.com/loominate-if/loominate-if/issues/69), [#81](https://github.com/loominate-if/loominate-if/issues/81), [#76](https://github.com/loominate-if/loominate-if/issues/76)).

## Places and things

A **place**, such as a room, is where things are. A **thing** has a name and a `location`: the place or thing it's in or on. Define them in `story.ts`, like any object:

<!-- example: packages/world/src/world.test.ts#places -->
```ts
const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
const cellar = place("cellar", { name: "cellar", isDark: true });
```

<!-- example: packages/world/src/world.test.ts#things -->
```ts
const table = thing("table", { ...surface, name: "oak table", location: study });
const coin = thing("coin", { name: "silver coin", location: table });
const box = thing("box", { ...container, ...openable, name: "tin box", location: study });
const gem = thing("gem", { name: "green gem", location: box });
const clock = thing("clock", { name: "ticking clock", location: box });
const caseOf = thing("case", {
  ...container,
  ...openable,
  ...transparent,
  name: "glass case",
  location: study,
});
const ring = thing("ring", { name: "gold ring", location: caseOf });
```

- `place()` and `thing()` build on core's `object()`, so the first argument is the stable ID, and every data property is state that undo, saves, and the inspector see.
- What a thing can do comes from **mixins** spread into its definition:
  - `container` holds things in it, and `surface` holds things on it.
  - `openable` opens and closes. A container that isn't openable is always open.
  - `lockable` locks. A locked `openable` won't open, and only a closed one locks.
  - `transparent` can be seen through when closed.
  - `lightSource` gives light when it's lit.
- A place is lit unless you give it `isDark: true`.

Mixins combine freely, with methods of the thing's own beside theirs:

<!-- example: packages/world/src/world.test.ts#chest -->
```ts
const chest = thing("chest", {
  ...container,
  ...openable,
  ...lockable,
  name: "oak chest",
  location: cellar,
  /** A method of its own, beside the mixins'. */
  describe(): string {
    return `${this.name}, ${this.isOpen ? "open" : "closed"}${this.isLocked ? " and locked" : ""}`;
  },
});
```

### Writing about things

A thing's `name` is its bare noun, "cellar door" rather than "the cellar door", so text can say "the cellar door", "a cellar door", or "The cellar door" as it needs. The world model registers adv3Lite-style message parameters for core's `t` templates. A thing's grammar is optional:

<!-- example: packages/world/src/grammar.test.ts#grammar -->
```ts
export const door = thing("door", { name: "cellar door", location: hall });
export const apple = thing("apple", { name: "apple", location: hall });
export const coins = thing("coins", { name: "coins", isPlural: true, location: hall });
export const hour = thing("hour", { name: "hour", article: "an" });
export const mira = actor("mira", { body: { name: "Mira", pronoun: "she", location: hall } });
export const sam = actor("sam", { body: { name: "Sam", location: hall } });
```

- `isProper`: a proper name takes no article. It defaults to whether the name starts with a capital, so "Mira" needs nothing.
- `isPlural`: "some coins", and plural verbs.
- `article`: the indefinite article when the guess from the spelling is wrong, such as `"an"` for "hour", or `"some"` for "coal".
- `pronoun`: `"she"`, `"he"`, `"they"`, or `"it"`. A plural, or a body such as an actor, defaults to `"they"`, and anything else to `"it"`.

`{the ${x}}`, `{The ${x}}`, `{a ${x}}`, and `{A ${x}}` name a thing with an article, capitalized as the parameter is:

<!-- example: packages/world/src/grammar.test.ts#articles -->
```ts
expect(t`{The ${door}} creaks; {a ${apple}} rolls; {a ${coins}} glint.`()).toBe(
  "The cellar door creaks; an apple rolls; some coins glint.",
);
expect(t`{A ${door}}, {a ${hour}}, {the ${mira}}.`()).toBe("A cellar door, an hour, Mira.");
```

**Verbs agree with their subject.** Mark the subject with `subj`, then write each verb in braces as you would for "it", `{falls}`, `{is}`, `{carries}`, and it agrees: plural for plurals and "you". The player's current body is "you", whoever the player is playing. A verb can also name its own subject, as in `{is ${door}}`:

<!-- example: packages/world/src/grammar.test.ts#agreement -->
```ts
const falls = (who: ObjectRef) => t`{The subj ${who}} {falls} and {is} gone.`();
expect(falls(apple)).toBe("The apple falls and is gone.");
expect(falls(coins)).toBe("The coins fall and are gone.");
expect(falls(mira)).toBe("Mira falls and is gone.");
expect(falls(sam)).toBe("Sam falls and is gone.");
expect(falls(you)).toBe("You fall and are gone.");
```

**Pronouns** refer to the subject, or to the thing given: `{he}` (or `{she}`, `{they}`, `{it}`), `{him}` (`{them}`), `{his}` (`{their}`, `{its}`), and `{himself}` (`{herself}`, `{themselves}`, `{itself}`) are the same four parameters, whichever word you write. `{her}` isn't one, being both "him" and "his". A subject pronoun becomes the subject, and verbs after it agree with the pronoun, so a "they" person reads "Sam waits. They nod.":

<!-- example: packages/world/src/grammar.test.ts#pronouns -->
```ts
expect(t`{The subj ${mira}} {picks} up the key. {He} {pockets} it.`()).toBe(
  "Mira picks up the key. She pockets it.",
);
expect(t`{The subj ${coins}} spill; you gather {him} into {his ${mira}} purse.`()).toBe(
  "The coins spill; you gather them into her purse.",
);
expect(t`{The subj ${you}} {sees} {himself}.`()).toBe("You see yourself.");
expect(t`{She subj ${sam}} {nods}; {they subj ${coins}} {clink}.`()).toBe(
  "They nod; they clink.",
);
```

- Any word in braces that isn't a registered parameter is taken as a verb, so a misspelled parameter, such as `{teh ${door}}`, prints as a verb rather than failing. Checking names when the game compiles is [#235](https://github.com/loominate-if/loominate-if/issues/235).
- The world model's own messages are written this way: "The cellar door is locked.", "Mira arrives from outside.", "North, to the library". A game rewords them in the message table ([Rewording the library](messages.md)), where a template names what it's about by name, as `{the door}`.

### Vocabulary

A thing can list the words a player might use for it, for a parser to come: nothing reads them yet, but a game written now will work with one later. Most things need nothing, since `vocabOf(thing)` takes the words of the name: the last word is a noun, the others are adjectives, and the name's plural is a plural. Add any others as `vocab`:

<!-- example: packages/world/src/vocabulary.test.ts#vocab -->
```ts
export const lantern = thing("lantern", {
  name: "brass lantern",
  vocab: { nouns: ["lamp", "light"], adjectives: ["old"] },
  location: hall,
});
```

<!-- example: packages/world/src/vocabulary.test.ts#vocabOf -->
```ts
expect(vocabOf(lantern)).toEqual({
  nouns: ["lantern", "lamp", "light"],
  adjectives: ["brass", "old"],
  plurals: ["lanterns"],
});
```

Vocabulary is state, like the name, so it can change during play, as when the player learns what something really is. Each entry is one word.

### Things made during play

A game that makes things as it goes, such as treasure in a chest or loot in a generated dungeon, defines a **thing template** with `thingTemplate()`, which takes what `thing()` does, mixins included. Core's `spawn()` makes one from it during play, in an effect. Its ID comes from what made it, as in `gen:chest:coin-1`, so undo, saves, and replays give the same things. From then on it's part of the world like any thing: it can be moved, it's listed in contents, sorted by ID, and it can be seen, reached, and heard, and named in text:

<!-- example: packages/world/src/spawned.test.ts#template -->
```ts
export const chest = thing("chest", { ...container, ...openable, name: "chest", location: vault });
export const coin = thingTemplate("coin", { name: "gold coin" });
export const pouch = thingTemplate("pouch", { ...container, name: "leather pouch" });
```

<!-- example: packages/world/src/spawned.test.ts#spawn -->
```ts
chest.open();
move(spawn(coin, chest), chest); // gen:chest:coin-1
move(spawn(coin, chest), chest); // gen:chest:coin-2
```

### Listing what's here

`listContents(holder)` lists what's directly in or on something, as the player would see it: "a brass key, a map, and two mice", or "nothing". Alike things are listed once, with a count: things made from the same template, or marked `isEquivalent`, with the same name. A name's plural adds "s" or "es" to its last word, or comes from `pluralName`:

<!-- example: packages/world/src/listing.test.ts#things -->
```ts
export const chest = thing("chest", { ...container, ...openable, name: "chest", location: vault });
export const table = thing("table", { ...surface, name: "table", location: vault });
export const coin = thingTemplate("coin", { name: "gold coin" });
export const key = thing("key", { name: "brass key", location: table });
export const map = thing("map", { name: "map", location: table });
export const mouse1 = thing("mouse1", {
  name: "mouse",
  pluralName: "mice",
  isEquivalent: true,
  location: table,
});
export const mouse2 = thing("mouse2", {
  name: "mouse",
  pluralName: "mice",
  isEquivalent: true,
  location: table,
});
```

<!-- example: packages/world/src/listing.test.ts#listing -->
```ts
expect(listContents(chest)).toBe("three gold coins");
expect(listContents(table)).toBe("a brass key, a map, and two mice");
```

- Only what the player can see is listed, so nothing in a closed box or in the dark, but what the player carries always is. The player is never listed, so `listContents(cellar)` lists what's in the room around them.
- Things are listed in ID order, so a listing is the same every time.
- Export it from `story.ts` to use it in passages, `export { listContents } from "@loominate-if/world";`, then write `The chest holds {listContents(chest)}.`
- The words come from the message table: `list.empty` ("nothing"), `list.join` ("a, b, and c"), `list.group` ("three gold coins"), and `number.words` ("three", up to twelve, then digits) ([Rewording the library](messages.md)).

## Moving things

`move(thing, to)` moves a thing into or onto another, or out of the world with `move(thing, null)`. It's one change, so one undo takes it back. It refuses a move that makes no sense: into something that can't hold things, or into the thing itself or something inside it. Whether the player may make the move, such as into a locked chest, is for actions to decide.

- `contents(parent)` lists what's directly in or on something, sorted by ID.
- `placeOf(thing)` is the place a thing is in, however deep, and `isWithin(thing, other)` says whether it's anywhere inside `other`.

## What can be seen, reached, and heard

Scope is what one thing can sense of the others. Every sense stops at the edge of a place.

| | Stopped by | Needs light |
| --- | --- | --- |
| **See** | a closed container that isn't `transparent` | yes |
| **Reach** | any closed container, even a transparent one | no |
| **Hear** | nothing inside the place | no |

<!-- example: packages/world/src/world.test.ts#scope -->
```ts
expect(canSee(player, ring)).toBe(true);
expect(canReach(player, ring)).toBe(false);
expect(canReach(player, coin)).toBe(true);
caseOf.open();
expect(canReach(player, ring)).toBe(true);
```

- `canSee`, `canReach`, and `canHear` answer for one thing. `inScope(observer, sense)` lists everything in scope, sorted by ID: the observer's place, what's in it, and what the observer carries, but not the observer.
- Shut inside a closed wardrobe, a thing senses only what's in the wardrobe, and hears the room around it.

## Light

In a dark place, nothing can be seen until something lights it. A lit light source lights everything in sight of it: one the player carries, one on a table, or one behind glass. One shut in a closed box lights only the inside of the box. Reaching and hearing don't need light.

<!-- example: packages/world/src/world.test.ts#light -->
```ts
move(player, cellar);
move(lamp, cellar);
expect(isInLight(player)).toBe(false);
expect(ids(inScope(player, "see"))).toEqual([]);
expect(canReach(player, rat)).toBe(true);
lamp.light();
expect(isInLight(player)).toBe(true);
expect(ids(inScope(player, "see"))).toEqual(["cellar", "chest", "lamp", "rat"]);
```

`isInLight(observer)` says whether there's light where the observer is.

## Minds and bodies

An **actor**, such as the player character or an NPC, is two linked halves: a **body**, the thing in the world that's moved, seen, and carries things, and a **mind**, what it knows and thinks. Most games never separate them. `actor()` makes both, with each half in its own section:

<!-- example: packages/world/src/actors.test.ts#actor -->
```ts
export const mira = actor("mira", {
  body: { name: "Mira", location: hall, strength: 2 },
  mind: { courage: 3 },
});
```

- The actor is its body: `move(mira, attic)` moves her, and `location: mira` puts something in her hands. Her body's ID is `mira`, and her mind's is `mira:mind`.
- The actor reads its mind's properties through, so `mira.courage` is her mind's. `mira.mind` and `mira.body` are the halves. A key in both halves is an error.

### The player

Name the mind the player starts as in `story.ts`. Pass an actor, and the player is its mind:

<!-- example: packages/world/src/actors.test.ts#player -->
```ts
export const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);
```

`playAs(mind)` switches who the player is during play. `playerMind()` and `playerBody()` answer for whoever it is now, and everything else, such as scope, takes a body, so nothing treats the player specially:

<!-- example: packages/world/src/actors.test.ts#play-as -->
```ts
playAs(mira);
expect(playerMind().id).toBe("mira:mind");
expect(ids(inScope(playerAt(), "see"))).toContain("statue");
```

### Possession and swaps

A mind inhabits one body, in control or as a passenger. `mind()` and `body()` make the halves on their own, for a ghost without a body or a statue without a mind:

<!-- example: packages/world/src/actors.test.ts#minds -->
```ts
export const ghost = mind("ghost", { name: "ghost", malice: 2 });
export const statue = body("statue", { name: "marble statue", location: hall });
```

`possess(mind, body)` puts a mind in control of a body. The mind that was in control stays as a passenger, watching:

<!-- example: packages/world/src/actors.test.ts#possess -->
```ts
possess(ghost, mira);
expect(mindOf(mira)?.id).toBe("ghost");
expect(ids(passengersOf(mira))).toEqual(["mira:mind"]);
expect(mira.courage).toBe(3); // still Mira's own
```

- `possess(ghost, mira, { displaced: "out" })` casts Mira's mind out of any body instead.
- `possess(ghost, mira, { as: "passenger" })` has the ghost ride along, with Mira still in control.

When the possessor leaves, with `leaveBody(mind)` or by possessing another body, the mind it displaced takes control again:

<!-- example: packages/world/src/actors.test.ts#leave -->
```ts
leaveBody(ghost);
expect(mindOf(mira)?.id).toBe("mira:mind");
```

To leave the body empty instead, such as in a trance, say so. The displaced mind stays inside as a passenger, without control, until something gives it back with `possess(mira.mind, mira)`:

<!-- example: packages/world/src/actors.test.ts#trance -->
```ts
leaveBody(ghost, { restore: false });
expect(mindOf(mira)).toBeUndefined();
expect(ids(passengersOf(mira))).toEqual(["mira:mind"]);
```

Only a mind that was displaced takes control back. One that rode along as a passenger never does, and possessors stacked on one body unwind in order.

`swapBodies(a, b)` exchanges two minds' bodies:

<!-- example: packages/world/src/actors.test.ts#swap -->
```ts
swapBodies(you, tom);
expect(mindOf(tom)?.id).toBe("you:mind");
expect(mindOf(you)?.id).toBe("tom:mind");
expect(tom.mood).toBe("sleepy"); // the actor's own mind, wherever it is
```

`bodyOf(mind)`, `mindOf(body)`, and `passengersOf(body)` say who's where. Every change is state, so undo, saves, and the inspector see it.

## Rooms and regions

A **room** is a place a passage describes. Tag the passage with `room:` and the place it describes, and arriving at the passage moves the player there and counts a visit:

<!-- example: packages/cli/src/fixtures/rooms.weft -->
```weft
:: Hall [room: hall]
{if visitsTo(hall) === 1}A draughty hall.{else}The hall again.{/if} You're in {you.location?.id ?? "nowhere"}.
{exits}
[[Unlock the cellar door -> Unlock]]{when cellarDoor.isLocked, hidden}
[[Knock on the door]]{act knock({ thing: cellarDoor })}

:: Unlock
{on enter: cellarDoor.unlock(); cellarDoor.open(); happen(cellarDoor, { seen: "The cellar door creaks open." })}
The key turns.
{notices}
You step back as it swings wide.
{continue -> Hall}

:: Cellar [room: cellar]
Cellar visits: {visitsTo(cellar)}. You're in {you.location?.id ?? "nowhere"}. You see {listContents(cellar)}.
{exits}
{if player.hasSeen(note)}A [[note]]{menu note} lies on the floor.{/if}
{if player.knows(facts.culprit)}You know who did it, from {player.sourceOf(facts.culprit)?.from?.id ?? "nowhere"}.{/if}
[[Read the note -> Note]]{when !player.knows(facts.culprit), hidden}

:: Note
{reveal facts.culprit, from: note}
The note says the butler did it.
{continue -> Cellar}
```

- The `room:` tag comes from the world model's compiler extension, so list the package in `loominate.config.ts`: `extensions: ["@loominate-if/world"]`.
- The value is an export of `story.ts`, checked like any other code: a typo, or something that isn't a place, is an error on the tag.
- The move happens before the passage's own `{on enter: …}` code, so that code sees the player in the room. A player already there, even sitting in a chair there, stays put.
- The player needs a body: call `startAs()` in `story.ts` ([Minds and bodies](#minds-and-bodies)).
- Room passages are never reported as unreachable, since [exits](#exits) lead to them.
- A room can have more than one passage, such as by day and by night. Tag the one exits lead to with `arrive`, as in `[room: hall, arrive]`, or the compiler reports it.

`{exits}` shows the room's exits as links, and `cellarDoor` is a door; [Exits](#exits) explains both.

`visitsTo(room)` counts the player's arrivals at a room's passages, including this one, so `visitsTo(hall) === 1` is the first visit. It's what the player's mind remembers, as passages' own `visits` are ([Remembering visits](#remembering-visits)); `totalVisitsTo(room)` counts every arrival, whoever made it. It's state, so undo and saves keep it:

<!-- example: packages/world/src/rooms.test.ts#enter -->
```ts
enterRoom(cellar);
expect(you.location?.id).toBe("cellar");
expect(visitsTo(cellar)).toBe(1);
```

### Regions

A **region** groups rooms that share defaults and rules, such as every room in a manor. Rooms list the regions they're in, and regions can be in other regions:

<!-- example: packages/world/src/rooms.test.ts#regions -->
```ts
export const estate = region("estate", { name: "estate" });
export const manor = region("manor", {
  name: "manor",
  regions: [estate],
  roomDefaults: { isDark: true },
  onEnter() {
    log.entries.push("enter manor");
  },
  onLeave() {
    log.entries.push("leave manor");
  },
});
export const hall = place("hall", { name: "hall", regions: [manor], isDark: false });
export const cellar = place("cellar", { name: "cellar", regions: [manor] });
export const garden = place("garden", { name: "garden", regions: [estate] });
```

- `roomDefaults` gives each member room whatever it doesn't set itself: the cellar is dark, and the hall isn't, because it says so. A nearer region's default wins over one around it.
- A default can be a getter, with `this` the room, so it follows state. Every room in the east wing goes dark when the power fails:

<!-- example: packages/world/src/rooms.test.ts#dynamic-default -->
```ts
roomDefaults: {
  get isDark(): boolean {
    return power.isOut;
  },
},
```

- `onEnter(room)` and `onLeave(room)` run when the player moves into or out of the region: from the hall into the gallery runs only the east wing's `onEnter`, since the player was already in the manor. Regions around others are entered first and left last. They run for the player's moves, including being carried in something, but not for where the player starts, or for a change of bodies.
- `regionsOf(t)` lists the regions a place, thing, or region is in, and `isInRegion(t, region)` asks about one.

## Exits

A room's exits are declared with `connect()` in `story.ts`, after the rooms, since rooms refer to each other. An exit leads to a room, and can go `via` a door, and say how long it takes in minutes, for [the game clock](#time). Exits are one-way, so connect both rooms for a way there and back:

<!-- example: packages/world/src/exits.test.ts#connect -->
```ts
export const hall = place("hall", { name: "hall" });
export const library = place("library", { name: "library" });
export const cellar = place("cellar", { name: "cellar" });
export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "cellar door" });

connect(hall, {
  north: library,
  down: { to: cellar, via: cellarDoor },
});
connect(library, { south: { to: hall, minutes: 1 } });
connect(cellar, { up: { to: hall, via: cellarDoor } });
```

`{exits}` in a room passage shows the player's room's exits as links, in direction order, each leading to the passage that describes where it goes. A blocked exit is disabled with its reason, which the inspector's Choices panel explains like any other link. An exit to a room the player has visited names it, as in "North, to the library":

<!-- example: packages/world/src/exits.test.ts#links -->
```ts
expect(summary()).toEqual(["North -> Library", "Down -> Cellar [The cellar door is locked.]"]);
cellarDoor.unlock();
expect(summary()).toEqual(["North -> Library", "Down -> Cellar [The cellar door is closed.]"]);
cellarDoor.open();
expect(summary()).toEqual(["North -> Library", "Down -> Cellar"]);
```

- `exitsOf(room)` lists a room's exits, and `blockedReason(exit, traveler)` says why one is blocked.
- `setExit(room, direction, exit)` changes an exit during play, and `setExit(room, direction, null)` removes one, such as when a tunnel collapses. Exits are state, so undo and saves keep the change. A room changed this way must be connected in `story.ts`, even with no exits: `connect(cave, {})`.

### Doors and obstacles

A **door** is one thing that both rooms' exits name with `via`. It's in scope from both rooms, and opening it from one side opens it for both. Spread in `door`, and `lockable` for one that locks. A closed door blocks the way until something opens it: until actions arrive, write a link that does, such as `{on enter: cellarDoor.open()}`.

Anything else can stand in the way with `obstacle` and a `blocks()` method of its own, which says why the way is blocked, or returns `undefined` when it isn't:

<!-- example: packages/world/src/exits.test.ts#obstacle -->
```ts
export const rubble = thing("rubble", {
  ...obstacle,
  name: "heap of rubble",
  isCleared: false,
  blocks() {
    return this.isCleared ? undefined : "Rubble blocks the way.";
  },
});
```

### Directions

The eight compass points, `up`, `down`, `in`, and `out` are built in, each with its opposite. A game adds its own, such as a ship's, by extending the `Directions` interface and registering each, so an exit in a direction nobody registered is a type error. They're listed after the built-in ones, in the order they're registered:

<!-- example: packages/world/src/exits.test.ts#directions -->
```ts
declare module "@loominate-if/world" {
  interface Directions {
    fore: true;
    aft: true;
  }
}
direction("fore", { opposite: "aft", label: "Fore" });
direction("aft", { opposite: "fore", label: "Aft" });
```

Each direction also says how to go that way and come from it, "to the north" and "from the north", which perception uses for "Mira leaves to the north". `up` and `down` say "upstairs" and "from above", "downstairs" and "from below". Give a game's own with `toward:` and `from:`, as in `direction("fore", { toward: "forward", from: "from the bow" })`.

## Knowledge and facts

A **fact** is something a mind can know, such as who took the letter. Define facts in `story.ts`, one at a time with `fact()`, or several at once with `defineFacts()`, whose keys are their IDs. Minds remember facts by ID, so keep each ID stable once players have saves:

<!-- example: packages/world/src/knowledge.test.ts#facts -->
```ts
export const facts = defineFacts({
  missingLetter: "The letter is missing from the desk.",
  butlerHandledLetter: "The butler handled the letter before supper.",
});
export const affair = fact("affair", { text: "The colonel and the cook are lovers." });
```

Every mind can learn facts, and remembers where it first learned each one: a thing or mind it came `from`, the passage it was revealed in, or both. An actor answers for its mind:

<!-- example: packages/world/src/knowledge.test.ts#learn -->
```ts
expect(maid.knows(affair)).toBe(false);
maid.learn(affair, { from: diary });
maid.learn(affair, { from: you });
expect(maid.knows(affair)).toBe(true);
expect(maid.sourceOf(affair)?.from?.id).toBe("diary");
```

`{reveal}` in a passage teaches the player a fact when they reach it, recording the passage, and `from:` names where it came from. Like `{emit}`, it never runs when the passage is only shown:

<!-- example: packages/cli/src/fixtures/rooms.weft#Note -->
```weft
:: Note
{reveal facts.culprit, from: note}
The note says the butler did it.
{continue -> Cellar}
```

### The player

`player` stands for whichever mind the player controls now. Write `player.knows(…)` for what the player knows: it follows the player through `playAs()`, possession, and body swaps, while `you.knows(…)` always asks the `you` actor's own mind:

<!-- example: packages/world/src/knowledge.test.ts#player -->
```ts
you.learn(affair);
playAs(maid);
expect(player.knows(affair)).toBe(false); // the player is the maid now
expect(you.knows(affair)).toBe(true);
```

### Seen and familiar

Arriving at a room passage marks everything the player's body can see there as seen, by the mind in control and by any passenger, so nothing is seen in the dark or inside a closed box. `see(thing)` marks one by hand, such as when a box is opened. A thing a mind knows of without seeing it is **familiar**: `learnAbout(thing)` makes it familiar to one mind, and `isFamiliar: true` on a thing makes it familiar to everyone:

<!-- example: packages/world/src/knowledge.test.ts#familiar -->
```ts
export const portrait = thing("portrait", { name: "late duke's portrait", isFamiliar: true });
```

<!-- example: packages/world/src/knowledge.test.ts#knowsAbout -->
```ts
expect(you.knowsAbout(portrait)).toBe(true); // isFamiliar: everyone knows of it
expect(you.knowsAbout(diary)).toBe(false);
you.learnAbout(diary); // the maid mentioned it
expect(you.knowsAbout(diary)).toBe(true);
expect(you.hasSeen(diary)).toBe(false);
```

- `knows(fact)`, `sourceOf(fact)`, and `knownFacts()` ask about facts; `hasSeen(thing)` and `knowsAbout(thing)` about things.
- `forget(fact)` or `forget(thing)` takes one back.
- Knowledge is state, so undo and saves cover it, and the inspector shows each mind's on the object `world:knowledge:<mind>`.
- The names of these methods belong to every mind, so a mind's own properties can't use them.

### Remembering visits

With the world model, where the player has been is a memory of the player's mind. A passage's `visits`, `firstVisit`, and `visited()`, `{on first visit: …}`, and `visitsTo(room)` all answer for the mind the player controls now, so after `playAs()` a new character's first visit reads, and runs, as a first visit. The story still counts every real visit, for the story map, coverage, and the inspector, as `story.totalVisits(passage)` and `totalVisitsTo(room)`:

<!-- example: packages/world/src/memory.test.ts#switch -->
```ts
playAs(mira);
expect(go(story, "Study")).toBe("A study you don't know.");
expect(story.visits("Study")).toBe(1); // Mira's
expect(story.totalVisits("Study")).toBe(2); // everyone's
expect(visitsTo(study)).toBe(1);
expect(totalVisitsTo(study)).toBe(2);
```

One-time changes to the world, which should happen once whoever arrives, belong in a flag on an object rather than in `{on first visit: …}`.

- `forget(room)` forgets visiting a room and its passages, as well as seeing it.
- `forgetVisits(passage)` forgets one passage's visits, and `forgetVisits()` every passage's and room's.
- The inspector's State panel shows the real counts under `$visits`, and each mind's under `world:knowledge:<mind>`.

### Amnesia

`forget()` is for good. `loseMemory()` blocks everything a mind remembers, facts, things seen and familiar, and visits, until `regainMemory()` lifts it. New memories still form meanwhile, and when it lifts they join the old ones: visits add up, and a fact learned both times keeps its first source. `hasAmnesia` says whether it's in effect, and forgetting during it reaches the blocked memories too:

<!-- example: packages/world/src/memory.test.ts#amnesia -->
```ts
you.loseMemory();
expect(you.hasAmnesia).toBe(true);
expect(you.knows(facts.secret)).toBe(false);
expect(you.hasSeen(globe)).toBe(false);
go(story, "Lobby");
expect(go(story, "Study")).toBe("A study you don't know.");
you.regainMemory();
expect(you.knows(facts.secret)).toBe(true);
expect(story.visits("Study")).toBe(2); // one before, one during
```

## Perception

`happen(thing, …)` makes something perceptible. Everyone who can see the thing notices `seen`, everyone who can only hear it, in the dark or through a closed box, notices `heard`, and with `far`, everyone a room away hears it, told which way it came from. `carries: 2` reaches two exits away. With `reveals`, every mind that notices learns a fact, sourced to the thing:

<!-- example: packages/world/src/perception.test.ts#house -->
```ts
export const landing = place("landing", { name: "landing" });
export const hall = place("hall", { name: "hall" });
export const cellar = place("cellar", { name: "cellar", isDark: true });
export const garden = place("garden", { name: "garden" });
connect(landing, { down: hall });
connect(hall, { up: landing, down: cellar, out: garden });
connect(cellar, { up: hall });
connect(garden, { in: hall });

export const bedroomDoor = thing("bedroomDoor", { name: "bedroom door", location: landing });
```

<!-- example: packages/world/src/perception.test.ts#slam -->
```ts
happen(bedroomDoor, {
  seen: "The bedroom door slams shut.",
  heard: "A door slams.",
  far: (from) => `You hear a door slam ${from}.`,
  reveals: facts.someoneUpstairs,
});
```

From the hall, below the landing, the player reads "You hear a door slam from above." on the page after the passage's text and before its choices, for the move it happened in. So a passage that shoos the cat reads `"Shoo!"` and then "The cat slinks off outside.", though the cat left while the passage's effects ran, before its text was shown. The story-so-far drawer keeps it there, and a walkthrough test reads it in `game.notices`, and in `game.text` where the page shows it.

To put them somewhere else in a passage, write `{notices}` where they go:

<!-- example: packages/cli/src/fixtures/rooms.weft#Unlock -->
```weft
:: Unlock
{on enter: cellarDoor.unlock(); cellarDoor.open(); happen(cellarDoor, { seen: "The cellar door creaks open." })}
The key turns.
{notices}
You step back as it swings wide.
{continue -> Hall}
```

`{notices}` works in any passage, with or without the world model, since actions' results (`action-result` events) go there too, as does what [fuses and daemons](#fuses-and-daemons) say (`scheduled` events). The story-so-far drawer keeps notices after their part's text either way.

- Only the mind the player controls is told. Every mind that notices, the player's and NPCs', in control or riding along as a passenger, learns `reveals` and sees what it saw.
- Without `heard`, only those who see it notice; without `far`, nothing is heard from other rooms. Sound carries through exits the way they lead, whatever's in the way.
- It's recorded as a `perception` event, so the inspector's Events panel lists it.

### Comings and goings

An actor moving into or out of the player's room, while the player can see, is narrated without the author asking: "Mira arrives from outside.", "Mira leaves upstairs.", with the way from the room's exits. Nothing is narrated in the dark, or for the player's own moves. Everyone in the room who can see a newcomer sees it. An actor can say it its own way with `arrives(from)` and `leaves(toward)` on its body, or stay quiet by returning `undefined`:

<!-- example: packages/world/src/perception.test.ts#leaves -->
```ts
export const cat = actor("cat", {
  body: {
    name: "cat",
    location: hall,
    leaves(toward: string | undefined) {
      return `The cat slinks off ${toward ?? "somewhere"}.`;
    },
    arrives() {
      return undefined; // it comes and goes as it pleases, unseen
    },
  },
});
```

## Time

The world model keeps a game clock in minutes. Time passes only when something says so, so a game that never mentions it pays nothing. Set when the game begins once, in `story.ts`:

<!-- example: packages/world/src/clock.test.ts#clock -->
```ts
startClock({ at: "21:30" });
export const kitchen = place("kitchen", { name: "kitchen" });
export const garden = place("garden", { name: "garden" });
export const lane = place("lane", { name: "lane" });
connect(kitchen, { out: { to: garden, minutes: 2 }, north: lane });
connect(garden, { in: { to: kitchen, minutes: 2 } });
connect(lane, { south: kitchen });

export const brew = action<{ thing: typeof kitchen }>("brew", {
  label: "Brew tea",
  minutes: 5,
  run: () => {
    clock.advance(1); // waiting for the kettle, partway through
  },
  report: () => `You brew tea. It's ${timeOfDay()}.`,
});
```

- **Actions** take their `minutes`, through core's `actionTime` hook.
- **Travel** takes the `minutes` of the exit the player goes through, or the clock's `travelMinutes`, which is 0 unless `startClock({ travelMinutes })` or `clock.travelMinutes = …` changes it. Moving the player between rooms with no exit between them takes no time.
- **Any code** can call `clock.advance(minutes)` in an effect or an action stage, even partway through an action, as `brew` does while the kettle boils.

<!-- example: packages/world/src/clock.test.ts#travel -->
```ts
choose("Out"); // 2 minutes, as the exit says
expect(now()).toBe("day 1, 9:32 pm, 1 moves");
choose("In");
choose("North"); // no minutes: travelMinutes, 0 by default
expect(now()).toBe("day 1, 9:34 pm, 3 moves");
clock.travelMinutes = 10;
choose("South");
expect(now()).toBe("day 1, 9:44 pm, 4 moves");
```

`clock.minutes` is the time since the game began; `clock.day`, `clock.hour` (0–23), and `clock.minute` say when it is, from the start time. `timeOfDay()` words it through the `clock.time` message, "9:45 pm" by default, and `timeOfDay(minutes)` words another time on the clock. `clock.moves` counts the player's moves: links followed, actions taken, and travel, but not continues, moving past a beat, beginning, or undoing. A continue only acknowledges what the player read, so it isn't a decision, and an "every move" daemon shouldn't run faster in a game with more passage breaks. The `clockAdvance` hook runs after time moves on, with the minutes before and after.

The clock and the move count are state, so undo, saves, and replays restore them, and nothing reads the computer's clock.

### Fuses and daemons

A **fuse** runs once, a delay after it starts; a **daemon** runs again and again, every so often. A delay is counted in the clock's minutes, `minutes(30)`, or in the player's moves, `moves(3)`, for things that happen "every move" whether or not time passes. Whatever one returns is shown to the player with the move's notices, after the passage's text and before its choices.

<!-- example: packages/world/src/schedule.test.ts#fuse -->
```ts
export const bridge = thing("bridge", { name: "rope bridge", isStanding: true });
export const collapse = fuse("collapse", { after: minutes(30) }, () => {
  bridge.isStanding = false;
  return `At ${timeOfDay()}, somewhere behind you, timber gives way with a roar.`;
});
```

<!-- example: packages/world/src/schedule.test.ts#daemons -->
```ts
export const bells = daemon("bells", { every: minutes(15) }, () => `Bells ring at ${timeOfDay()}.`);
export const drip = daemon("drip", { every: moves(2), running: true }, () => "Water drips.");
```

Define them in `story.ts`, or a module it imports, with an ID of their own, because their code can't be saved: only whether each is running and when it's due is state, so undo, saves, and replays restore it. Each waits until it's started, unless it says `running: true`:

- `collapse.start()`, in an effect such as `{on enter: collapse.start()}`, starts it, counting its delay from now. Starting it while it's running starts it over.
- `collapse.cancel()` stops a fuse, and `bells.stop()` stops a daemon. Either can be started again.
- `isRunning` says whether it's waiting to fire, and `firesAt` when it will next: the clock's `minutes`, or the move count, as its `unit` says.

When time jumps past several firings, as a 30-minute wait past a daemon every 15 minutes, the clock stops at each, so each fires at its own time and sees it: the bells ring at 12:15 and again at 12:30. Those due at the same moment fire by their `priority`, higher first (0 unless they say), then in the order they were defined, so the order is the same in every playthrough.

<!-- example: packages/world/src/schedule.test.ts#moves -->
```ts
choose("Look around");
expect(said()).toEqual([]);
choose("Look around"); // the second move
expect(said()).toEqual(["drip: Water drips."]);
expect(drip.firesAt).toBe(4);
```

### Interrupting a jump

Any fuse or daemon can stop a jump of the clock where it fires, as footsteps waking someone who sleeps: give it `interrupts: true`, or call `clock.interrupt()` from its code when it depends.

<!-- example: packages/world/src/schedule.test.ts#interrupt -->
```ts
export const footsteps = fuse("footsteps", { after: minutes(180), interrupts: true }, () => {
  return "You're woken by footsteps.";
});
export const owl = daemon("owl", { every: minutes(60) }, () => {
  if (owlWakes) clock.interrupt();
  return `An owl hoots at ${timeOfDay()}.`;
});
```

`clock.advance(…)` then stops at that moment, after whatever else is due at that same minute, and says how far it got:

<!-- example: packages/world/src/schedule.test.ts#sleep -->
```ts
const slept = clock.advance(8 * 60);
expect(slept).toEqual({ minutes: 180, interrupted: true, by: "footsteps" });
expect(timeOfDay()).toBe("3:00 am");
```

An advance can be interrupted by anything, unless it says what it stops for. A subway ride shouldn't stop for a phone call, only for a bomb on the tracks. The call still fires at its own time, and is told, but time goes on:

<!-- example: packages/world/src/schedule.test.ts#ride -->
```ts
export const phone = fuse("phone", { after: minutes(10), interrupts: true }, () => {
  return "Your phone buzzes: your house alarm is ringing.";
});
export const bomb = fuse("bomb", { after: minutes(25), interrupts: true }, () => {
  return "A blast ahead shakes the carriage, and the train grinds to a halt.";
});
export const ride = action<{ thing: typeof bridge }>("ride", {
  label: "Ride the subway",
  minutes: 40,
  stopsFor: (by) => by === bomb.id,
});
```

`stopsFor` goes on an action, for its `minutes`, or on `clock.advance(n, { stopsFor })` from code, and `() => false` means nothing stops it. An interrupted action still happens, but takes only the time up to the interruption. A sleep or wait action reads `advance`'s result to say what happened, as in "You sleep until 3 a.m."

Travel through an exit isn't stopped partway, since the player has already arrived when its minutes pass. What's due on the way fires and is told. Journeys that can be stopped partway are [#304](https://github.com/loominate-if/loominate-if/issues/304).

### Summing up repeats

A long jump past a daemon that fires every quarter hour would tell each firing: "The tower clock strikes 12:15 am. The tower clock strikes 12:30 am. …". To write it as prose instead, give the daemon a `summary`. When it fires more than once in one jump, its summary is told in place of its lines, where it first spoke. Every firing still happens, at its own time; only the telling is summed up.

<!-- example: packages/world/src/schedule.test.ts#summary -->
```ts
export const tower = thing("tower", { name: "clock tower", struck: 0 });
export const quarters = daemon(
  "quarters",
  {
    every: minutes(15),
    summary: ({ count, from, to }) =>
      `The tower clock struck the quarters ${String(count)} times, from ${timeOfDay(from)} to ${timeOfDay(to)}.`,
  },
  () => {
    tower.struck += 1;
    return `The tower clock strikes ${timeOfDay()}.`;
  },
);
```

A summary is given the `count`, the clock's `minutes` when it `from` first and `to` last fired, and its `lines`. `timeOfDay(minutes)` words such a time. What interrupted the jump is never summed up; it keeps its own line, after the summary:

<!-- example: packages/world/src/schedule.test.ts#slept -->
```ts
clock.advance(8 * 60);
expect(said().filter((s) => /quarters|footsteps/.test(s))).toEqual([
  "quarters: The tower clock struck the quarters 12 times, from 12:15 am to 3:00 am.",
  "footsteps: You're woken by footsteps.",
]);
```

A single firing keeps its own line, so a short wait past one quarter still says "The tower clock strikes 12:15 am." For every daemon without a `summary`, the `schedule.repeated` message decides, given its `lines` and `count`; it's empty by default, which keeps each line. Reword it to sum up repeats game-wide:

<!-- example: packages/world/src/schedule.test.ts#repeated -->
```ts
messages.replace("schedule.repeated", ({ lines, count }) =>
  count > 2 ? `${lines[0] ?? ""} It happens again and again.` : "",
);
```

### Atmosphere and what stands out

What fuses and daemons say is **atmosphere** by default: a move's atmosphere runs together as one paragraph, where the first of it falls, so a player who has heard the church bells before can skim it. A fuse or daemon with `standsOut: true` gets a paragraph of its own instead, as other notices do, so a detail that matters isn't lost in the noise. What interrupts a jump always stands out.

Daemons can also **join** a group's sentence when they fire more than once in a jump. Each gives the group it `joins` and its `clause`, and `sentence(group, …)` says how the group's sentence reads; without it, the clauses are joined and capitalised. Groups keep different noises apart, such as outside and in the house:

<!-- example: packages/world/src/schedule.test.ts#groups -->
```ts
sentence("outside", ({ list }) => `Outside, ${list} through the night.`);
export const chimes = daemon(
  "chimes",
  { every: minutes(30), joins: "outside", clause: () => "the chapel chimes rang" },
  () => `The chapel chimes ring for ${timeOfDay()}.`,
);
export const rooks = daemon(
  "rooks",
  { every: minutes(60), joins: "outside", clause: () => "the rooks muttered" },
  () => "Rooks mutter in the elms.",
);
export const pipes = daemon(
  "pipes",
  {
    every: minutes(45),
    joins: "house",
    clause: ({ count }) => `the pipes knocked ${String(count)} times`,
  },
  () => "The pipes knock.",
);
export const mouse = daemon("mouse", { every: minutes(50) }, () => "A mouse scratches.");
export const smoke = daemon("smoke", { every: minutes(100), standsOut: true }, () => {
  return "You smell smoke!";
});
```

After a long night's sleep, the atmosphere is one paragraph, with the joined sentences where their first member first spoke, and the smoke and the footsteps each stand on their own:

<!-- example: packages/world/src/schedule.test.ts#night -->
```ts
expect(paragraphs()).toEqual([
  "Outside, the chapel chimes rang and the rooks muttered through the night." +
    " The pipes knocked 4 times." +
    " A mouse scratches. A mouse scratches. A mouse scratches.",
  "You smell smoke!",
  "You're woken by footsteps.",
]);
```

A daemon that fired only once keeps its own line in the paragraph, and one with a `clause` but no repeat doesn't join. A joined sentence is always atmosphere.

### Waiting

The world model's standard `wait` and `waitUntil` actions let time pass. Offer them as links, `[[Wait a while]]{act wait({ minutes: 10 })}`, or in a Wait menu in the page's header:

<!-- example: packages/world/src/waiting.test.ts#links -->
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- calls of two actions
const links: ActionCall<any>[] = [
  wait({ minutes: 10 }),
  waitUntil({ time: "06:00" }),
  waitUntil({ fires: "train", atMost: 60 }),
  waitUntil({ condition: "kiosk opens" }),
];
```

`waitUntil` waits for one of three things:

- `time: "06:00"`: the next time it's 6:00, today or tomorrow. It isn't offered at 6:00 itself.
- `fires: "train"`: until that fuse or daemon next fires. It isn't offered while it isn't running.
- `condition: "kiosk opens"`: until a condition named with `waitCondition(…)` holds. It isn't offered while it already does. An action's arguments go into replays, so a wait names its condition rather than holding a function.

For `fires` and `condition`, `atMost` is the most minutes to wait before giving up, a day unless it says.

<!-- example: packages/world/src/waiting.test.ts#waits -->
```ts
export const train = daemon(
  "train",
  { every: minutes(25), running: true },
  () => "A train pulls in.",
);
export const shop = thing("shop", { name: "kiosk", isOpen: false, location: platform });
export const shopkeeper = fuse("shopkeeper", { after: minutes(40), running: true }, () => {
  shop.isOpen = true;
  return "The kiosk's shutter rattles up.";
});
waitCondition("kiosk opens", () => shop.isOpen);
export const alarm = fuse("alarm", { after: minutes(15), interrupts: true }, () => {
  return "A fire alarm shrieks!";
});
```

<!-- example: packages/world/src/waiting.test.ts#until -->
```ts
choose("Wait until train");
expect([timeOfDay(), told()]).toEqual([
  "5:55 am",
  ["A train pulls in.", "You wait 25 minutes."],
]);
choose("Wait until kiosk opens");
expect(timeOfDay()).toBe("6:10 am");
expect(told().slice(2)).toEqual(["The kiosk's shutter rattles up.", "You wait 15 minutes."]);
```

A wait is passive, so anything that interrupts stops it: "A fire alarm shrieks! Your wait ends at 5:45 am." Its report says how it ended. Waiting for a fuse, a daemon, or a condition, it says how long it took ("You wait 25 minutes."), since what came says what happened. Waiting for a time of day, it says the time ("You wait until 6:00 am."). The reports are messages you can reword: `wait.done`, `waitUntil.done`, `waitUntil.came`, `wait.interrupted`, and `waitUntil.gaveUp`.

The Wait menu is opt-in. `waitMenu` adds a Wait button to the header, listing the waits you give it, each with its own label or yours. Like a thing's menu, it leaves out waits that aren't offered.

<!-- example: packages/world/src/waiting.test.ts#menu -->
```ts
waitMenu([
  { call: wait({ minutes: 10 }) },
  { call: waitUntil({ time: "06:00" }), label: "Wait until dawn" },
]);
```

### Showing the time

The world model registers a `clock` widget showing `timeOfDay()`, labelled "Time" for screen readers. It isn't shown unless the game adds it, in `story.ts`:

```ts
import { addToHeader } from "@loominate-if/presentation";
addToHeader("clock");
```

Reword it with `messages.replace("clock.time", ({ hour, minute }) => …)`, or replace the widget's view to draw a dial. Presentation's `textWidget({ text, label })` makes a widget like it for any line of text, such as a score.


# The world model

The world model is an optional package for games with places and things in them: rooms to move between, boxes to open, and lamps to light. A plain branching story doesn't need it, and pays nothing for it.

It's `@loominate-if/world`. It isn't published to npm yet, while the rest of the world model is built ([Phase 2](https://github.com/loominate-if/loominate-if/issues/58)); this guide grows with it. ADRs [0031](../decisions/0031-containment-and-scope.md), [0032](../decisions/0032-minds-and-bodies.md), [0033](../decisions/0033-rooms-and-regions.md), and [0034](../decisions/0034-exits-and-directions.md) record the decisions behind it.

So far, the world model keeps track of where things are, what can be sensed, which mind is in which body, which room the player is in, and the ways between rooms. It doesn't show anything or add links by itself: a thing in a room doesn't appear in the passage, and there's no "open the box" until you write one. Your passages decide what to show, with checks such as `{if canSee(player, coin)}`, and links call methods such as `box.open()` in an `on enter` effect. Export from `story.ts` every thing a passage mentions. Listing what's in a room, the compass, and actions come in later tasks ([#69](https://github.com/loominate-if/loominate-if/issues/69), [#81](https://github.com/loominate-if/loominate-if/issues/81), [#76](https://github.com/loominate-if/loominate-if/issues/76)).

## Places and things

A **place**, such as a room, is where things are. A **thing** has a name and a `location`: the place or thing it's in or on. Define them in `story.ts`, like any object:

<!-- example: packages/world/src/world.test.ts#places -->
```ts
const hall = place("hall", { name: "the hall" });
const study = place("study", { name: "the study" });
const cellar = place("cellar", { name: "the cellar", isDark: true });
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
export const ghost = mind("ghost", { name: "the ghost", malice: 2 });
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

:: Unlock
{on enter: cellarDoor.unlock(); cellarDoor.open()}
The key turns, and the door swings open.
{continue -> Hall}

:: Cellar [room: cellar]
Cellar visits: {visitsTo(cellar)}. You're in {you.location?.id ?? "nowhere"}.
{exits}
```

- The `room:` tag comes from the world model's compiler extension, so list the package in `loominate.config.ts`: `extensions: ["@loominate-if/world"]`.
- The value is an export of `story.ts`, checked like any other code: a typo, or something that isn't a place, is an error on the tag.
- The move happens before the passage's own `{on enter: …}` code, so that code sees the player in the room. A player already there, even sitting in a chair there, stays put.
- The player needs a body: call `startAs()` in `story.ts` ([Minds and bodies](#minds-and-bodies)).
- Room passages are never reported as unreachable, since [exits](#exits) lead to them.
- A room can have more than one passage, such as by day and by night. Tag the one exits lead to with `arrive`, as in `[room: hall, arrive]`, or the compiler reports it.

`{exits}` shows the room's exits as links, and `cellarDoor` is a door; [Exits](#exits) explains both.

`visitsTo(room)` counts the player's arrivals at a room's passages, including this one, so `visitsTo(hall) === 1` is the first visit. It's state, so undo and saves keep it:

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
export const estate = region("estate", { name: "the estate" });
export const manor = region("manor", {
  name: "the manor",
  regions: [estate],
  roomDefaults: { isDark: true },
  onEnter() {
    log.entries.push("enter manor");
  },
  onLeave() {
    log.entries.push("leave manor");
  },
});
export const hall = place("hall", { name: "the hall", regions: [manor], isDark: false });
export const cellar = place("cellar", { name: "the cellar", regions: [manor] });
export const garden = place("garden", { name: "the garden", regions: [estate] });
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

A room's exits are declared with `connect()` in `story.ts`, after the rooms, since rooms refer to each other. An exit leads to a room, and can go `via` a door, and say how long it takes in minutes, for the game clock to come. Exits are one-way, so connect both rooms for a way there and back:

<!-- example: packages/world/src/exits.test.ts#connect -->
```ts
export const hall = place("hall", { name: "the hall" });
export const library = place("library", { name: "the library" });
export const cellar = place("cellar", { name: "the cellar" });
export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "the cellar door" });

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
  name: "a heap of rubble",
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

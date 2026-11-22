# The world model

The world model is an optional package for games with places and things in them: rooms to move between, boxes to open, and lamps to light. A plain branching story doesn't need it, and pays nothing for it.

It's `@loominate-if/world`. It isn't published to npm yet, while the rest of the world model is built ([Phase 2](https://github.com/loominate-if/loominate-if/issues/58)); this guide grows with it. [ADR 0031](../decisions/0031-containment-and-scope.md) records the decisions behind it.

So far, the world model keeps track of where things are, what can be sensed, and which mind is in which body. It doesn't show anything or add links by itself: a thing in a room doesn't appear in the passage, and there's no "open the box" until you write one. Your passages decide what to show, with checks such as `{if canSee(player, coin)}`, and links call methods such as `box.open()` in an `on enter` effect. Export from `story.ts` every thing a passage mentions. Room descriptions and actions come in later tasks ([#63](https://github.com/loominate-if/loominate-if/issues/63), [#69](https://github.com/loominate-if/loominate-if/issues/69), [#76](https://github.com/loominate-if/loominate-if/issues/76)).

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

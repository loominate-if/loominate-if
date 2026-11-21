# The world model

The world model is an optional package for games with places and things in them: rooms to move between, boxes to open, and lamps to light. A plain branching story doesn't need it, and pays nothing for it.

It's `@loominate-if/world`. It isn't published to npm yet, while the rest of the world model is built ([Phase 2](https://github.com/loominate-if/loominate-if/issues/58)); this guide grows with it. [ADR 0031](../decisions/0031-containment-and-scope.md) records the decisions behind it.

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

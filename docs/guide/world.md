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

- Any word in braces that isn't a registered parameter is taken as a verb. So the compiler checks every `t` template in the game's code and passages, and warns of a name one or two letters from a parameter's, unless it's a verb the world model knows, such as `{is}` or `{has}`: "`{teh}` isn't a message parameter, so @loominate-if/world reads it as a verb. Did you mean `{the}`?"
- Braces that don't match, or a parameter with no name first, are errors at their line when the game compiles. So is any unregistered name in a game without the world model. Write `{{` and `}}` to print braces.
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

## Stacks

Ninety-nine turnips are one thing with a count, not ninety-nine things. Define a kind of stackable thing with `stackable`, and an authored stack with `stack`, which takes an ID like any thing:

<!-- example: packages/world/src/stacks.test.ts#stacks -->
```ts
export const turnip = stackable("turnip", { name: "turnip" });
export const crate = stack("crate", turnip, { count: 99, location: barn });
export const ticket = stackable("ticket", { name: "raffle ticket", merges: false });
```

A stack's name follows its count. A stack of 99 is "the turnips" and "99 turnips", and takes plural verbs; a stack of one is "the turnip" and "a turnip". Listing shows a stack with its count: "99 turnips and a raffle ticket".

- **Splitting:** `split(stack, n)` makes a new stack of `n`, of the same kind and in the same place. Its ID comes from the one it was split from, as `gen:crate:turnip-1`, so undo, saves, and replays agree.
- **Merging:** stacks of a kind merge whenever one is moved to where another is. The one already there takes the count, so the player never carries "three turnips and two turnips". A kind with `merges: false`, such as numbered tickets, never merges.
- **Counting:** `countOf(stack)` is how many it holds, and `setCount` changes it. At 0, it leaves the world. `stackIn(holder, kind)` finds the stack of a kind in or on something.

<!-- example: packages/world/src/stacks.test.ts#split -->
```ts
const three = split(crate, 3); // gen:crate:turnip-1, still in the barn
expect([three.id, countOf(three), countOf(crate)]).toEqual(["gen:crate:turnip-1", 3, 96]);
move(three, you);
const two = split(crate, 2);
move(two, you); // joins the three you carry
expect(countOf(three)).toBe(5);
```

A stack's menu offers taking one or all, and dropping one or all once it's carried. Taking one splits it off and moves it to the player, where it joins any of its kind:

<!-- example: packages/world/src/stacks.test.ts#menus -->
```ts
expect(menu(crate)).toEqual([
  "Examine the turnips",
  "Take all 99 turnips",
  "Take a turnip",
  "Take some turnips…",
]);
perform(takeOne({ thing: crate }));
perform(takeOne({ thing: crate }));
const held = stackIn(you, turnip);
expect(held && countOf(held)).toBe(2);
expect(held && menu(held)).toEqual([
  "Examine the turnips",
  "Drop all two turnips",
  "Drop a turnip",
]);
```

A stack of more than two also offers "Take some turnips…" and, once carried, "Drop some turnips…". They ask how many, from one to the whole stack, in a [number field in the menu](actions.md#asking-for-a-number):

<!-- example: packages/world/src/stacks.test.ts#some -->
```ts
perform(takeSome({ thing: crate, count: 10 }));
const held = stackIn(you, turnip);
expect([held && countOf(held), countOf(crate)]).toEqual([10, 89]);
if (held) perform(dropSome({ thing: held, count: 4 }));
expect([held && countOf(held), countOf(crate)]).toEqual([6, 93]);
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

### Who others take you for

Others see bodies, not minds. Who they think they're facing is a belief: by default, the person the body belongs to, an actor's own mind, whichever mind is in it now. A disguise makes a body pass for someone else, another actor, or a stranger:

<!-- example: packages/world/src/identity.test.ts#people -->
```ts
export const roy = actor("roy", { body: { name: "Roy", isProper: true, location: gate } });
export const captain = actor("captain", { body: { name: "captain", location: gate } });
export const guard = actor("guard", { body: { name: "guard", location: gate } });
export const bob = mind("bob", { name: "Bob" });
relationships({ regard: {} });
// In story.ts, as the game loads, these set how things start.
setRelationship(guard, captain, { regard: 5 });
setRelationship(guard, roy, { regard: -3 });
/** What the guard says to whoever he takes `someone` for. */
export const greeting = (someone: typeof roy): string => {
  const feeling = relationshipTo(guard, someone).regard;
  return feeling > 0
    ? "“Evening, sir. Go on through.”"
    : feeling < 0
      ? "“You. Turn around.”"
      : "“State your business.”";
};
```

<!-- example: packages/world/src/identity.test.ts#disguise -->
```ts
expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual(["roy:mind", "“You. Turn around.”"]);
disguise(roy, { as: captain });
expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual([
  "captain:mind",
  "“Evening, sir. Go on through.”",
]);
expect(relationship(guard, roy).regard).toBe(-3); // how he feels about Roy hasn't changed
```

- `whoIs(observer, body)` is who the observer believes the body is, or `undefined` for a stranger.
- **How things start:** in `story.ts`, as the game loads, `disguise` and `setRelationship` set how things start. Every new game begins that way. During play, in effects and actions, they change things, and undo and saves see the change.
- **What an NPC acts on:** `relationshipTo(observer, body)` is how they feel about whoever they believe the body is ([relationships](#relationships)). So a disguise changes what they do, but never how they feel about the real person.
- **Seeing through:** `expose(body, observer)` means the observer has seen who's really there, through the disguise and past whose body it is. A new disguise, or another mind in the body, can fool them again. `seesThrough(observer, body)` says whether they do.

<!-- example: packages/world/src/identity.test.ts#expose -->
```ts
expose(roy, guard);
expect([name(whoIs(guard, roy)), greeting(roy), seesThrough(guard, roy)]).toEqual([
  "roy:mind",
  "“You. Turn around.”",
  true,
]);
disguise(roy, { as: "a hooded figure" });
expect([name(whoIs(guard, roy)), greeting(roy)]).toEqual([
  "a stranger",
  "“State your business.”",
]);
```

Possession and body swaps fool people the same way: Bob in Roy's body is taken for Roy, until someone learns better.

<!-- example: packages/world/src/identity.test.ts#possession -->
```ts
possess(bob, roy);
expect(name(whoIs(guard, roy))).toBe("roy:mind"); // the guard sees Roy's body
expose(roy, guard);
expect(name(whoIs(guard, roy))).toBe("bob");
```

Everyone recognises everyone, so there's no "have we met". A game that wants strangers can treat whoever it likes as one in its own rules.

### Relationships

How each mind feels about each other mind is a **relationship**: a directed pair, so how Mira feels about you needn't be how you feel about her, in dimensions your game declares, such as affection, trust, and rivalry. Declare them once, with where every pair starts and the limits a change is kept within:

<!-- example: packages/world/src/relationships.test.ts#dimensions -->
```ts
declare module "@loominate-if/world" {
  interface Dimensions {
    affection: true;
    trust: true;
  }
}
relationships({ affection: { min: -10, max: 10 }, trust: { start: 2 } });
```

`relationship(mira, you)` gives a pair's values, and `setRelationship` and `changeRelationship` change them, clamped to the limits. In `story.ts`, as the game loads, they set how things start. A dimension you use but haven't declared is an error that says so.

<!-- example: packages/world/src/relationships.test.ts#pairs -->
```ts
expect(relationship(mira, you)).toEqual({ affection: 4, trust: 2 });
expect(relationship(you, mira)).toEqual({ affection: 0, trust: 2 }); // the other way round
```

**Thresholds** fire as a pair's value crosses them, in the move that changes it: `reaches` from below, `falls` from above. What one returns stands out. It fires once for each pair, until the value goes back past it, which re-arms it:

<!-- example: packages/world/src/relationships.test.ts#thresholds -->
```ts
threshold("smitten", { dimension: "affection", reaches: 8 }, ({ observer }) =>
  observer.id === "mira:mind" ? "Mira can't stop smiling at you." : undefined,
);
threshold("wary", { dimension: "trust", falls: 0 }, () => "Mira watches you warily now.");
```

<!-- example: packages/world/src/relationships.test.ts#smitten -->
```ts
visit("Compliment her"); // 6
visit("Compliment her"); // 8: smitten
visit("Compliment her"); // 10, the most it can be: already smitten
expect([relationship(mira, you).affection, told()]).toEqual([
  10,
  ["Mira can't stop smiling at you."],
]);
```

`relationshipTo(observer, body)` reads toward whoever the observer believes a body is, so it follows [disguises](#who-others-take-you-for).

## Traits

A trait needs nothing special: it's a property you give an object or an actor, typed like any other, so a passage, an action, or a line of text tests it directly. A flag, a value, or a list of tags all work, and all are state, so undo and saves keep them:

<!-- example: packages/world/src/traits.test.ts#things -->
```ts
export const sword = thing("sword", {
  name: "sword",
  location: hall,
  isCursed: true, // a flag
  weight: 3, // a value
  tags: ["silver", "old"] as string[], // a set of tags
});
```

<!-- example: packages/world/src/traits.test.ts#action -->
```ts
export const wield = action<{ thing: typeof sword }>("wield", {
  on: sword,
  label: "Wield the sword",
  check: ({ thing }) =>
    thing.isCursed && !thing.tags.includes("blessed")
      ? "The cursed blade burns your hand."
      : undefined,
  report: "You lift the sword.",
});
```

Change one like any property, in an effect or an action. A list is replaced, not changed in place:

<!-- example: packages/world/src/traits.test.ts#bless -->
```ts
sword.tags = [...sword.tags, "blessed"];
```

On an actor, put each trait on the half it belongs to. Build and appearance go on the body and stay with it; personality, memories, and quirks go on the mind, and travel with it into another body:

<!-- example: packages/world/src/traits.test.ts#actors -->
```ts
export const mira = actor("mira", {
  body: { name: "Mira", isProper: true, location: hall, strength: 2 }, // build stays with the body
  mind: { courage: 3, quirks: ["hums when nervous"] as string[] }, // personality travels with the mind
});
export const ghost = mind("ghost", { name: "ghost", courage: 9, quirks: [] as string[] });
```

`mira.courage` is always Mira's own, wherever her mind is. For whoever is in her body now, ask the body's mind:

<!-- example: packages/world/src/traits.test.ts#possession -->
```ts
possess(ghost, mira);
expect(mira.strength).toBe(2); // Mira's body is as strong as ever
expect(mindOf(mira)?.id).toBe("ghost");
expect((mindOf(mira) as unknown as { courage: number }).courage).toBe(9); // whoever's in it is bold
expect(mira.courage).toBe(3); // Mira's own courage, wherever her mind is
```

## Stats and resources

For numbers the library should look after, such as strength, wits, and energy, declare **stats**. Each says where it's kept: on the body, physical, which stays with the body; or on the mind, mental, which travels with the mind. A resource is spent and restored, up to a maximum that can be worked out from other stats, and a derived stat is a formula over others:

<!-- example: packages/world/src/stats.test.ts#stats -->
```ts
declare module "@loominate-if/world" {
  interface Stats {
    strength: true;
    wits: true;
    energy: true;
    carry: true;
  }
}
stats({
  strength: { on: "body", start: 2, min: 0, max: 10 },
  wits: { on: "mind", start: 3 },
  energy: { on: "body", resource: true, start: 4, max: (who) => 5 + stat(who, "strength") },
  carry: { derived: (who) => stat(who, "strength") * 5 },
});
```

- **Reading:** `stat(who, name)` works for an actor, a body, or a mind. Asked of a body, a mental stat is the stat of whoever is in it now; asked of a mind, it's that mind's own.
- **Changing:** `setStat` and `changeStat` change a stat, clamped to its limits. In `story.ts`, as the game loads, they set how things start.

<!-- example: packages/world/src/stats.test.ts#starting -->
```ts
setStat(ox, "strength", 9); // an ox's body is strong
setStat(ox, "wits", 1); // and its mind, slow
```

So a body swap moves mental stats with the mind:

<!-- example: packages/world/src/stats.test.ts#swap -->
```ts
swapBodies(you, ox);
expect(stat(you, "strength")).toBe(2); // your old body, as weak as ever
expect(stat(you, "wits")).toBe(1); // but the ox's mind is in it now
expect(stat(ox, "wits")).toBe(3); // and yours is in the ox: strong and clever
```

**Resources:** `canSpend(who, name, amount)` says why not, for an action's `check`, and `spend` takes it. `restore` gives it back, up to the max. The reason is the `stat.notEnough` message: "You don't have enough energy."

<!-- example: packages/world/src/stats.test.ts#spend -->
```ts
export const haul = action<{ thing: typeof ox }>("haul", {
  label: "Haul the cart",
  check: ({ body }) => (body ? canSpend(body, "energy", 3) : undefined),
  run: ({ body }) => {
    if (body) spend(body, "energy", 3);
  },
  report: "You haul the cart across the yard.",
});
```

### Modifiers

A **modifier** changes a stat for a while: a potion's strength, a poison's weakness, a blessing's wit. It adds `by` an amount, or multiplies it by `times`, from a source. A new one from the same source replaces the last, so a second potion refreshes the first rather than doubling it, while different sources stack: additions first, then multiplications, and the result stays within the stat's limits:

<!-- example: packages/world/src/modifiers.test.ts#modify -->
```ts
modify(you, "strength", {
  by: 2,
  from: "potion",
  lasts: minutes(30),
  wearsOff: "The potion's warmth fades.",
});
modify(you, "strength", { times: 0.5, from: "poison" });
expect([stat(you, "strength"), baseStat(you, "strength")]).toEqual([2, 2]); // (2 + 2) × 0.5
unmodify(you, "strength", "poison");
expect(stat(you, "strength")).toBe(4);
```

`lasts` is in `minutes(…)` or `moves(…)`. It wears off by the clock, saying its `wearsOff`, if it has one, as it does:

<!-- example: packages/world/src/modifiers.test.ts#refresh -->
```ts
modify(you, "strength", {
  by: 2,
  from: "potion",
  lasts: minutes(30),
  wearsOff: "The potion's warmth fades.",
});
expect(stat(you, "strength")).toBe(4); // refreshed, not doubled
clock.advance(29);
expect(stat(you, "strength")).toBe(4);
clock.advance(1); // 30 minutes after the second potion
expect([stat(you, "strength"), modifiersOf(you, "strength"), told()]).toEqual([
  2,
  [],
  ["The potion's warmth fades."],
]);
```

`baseStat` is a stat without its modifiers, and `modifiersOf` lists them. `changeStat`, `spend`, and `restore` work on the base, so a potion's strength isn't kept when it wears off. A modifier is kept with its stat, on the body or the mind, so a mental one travels with the mind. In `story.ts`, `modify` sets how things start:

<!-- example: packages/world/src/modifiers.test.ts#curse -->
```ts
modify(ox, "wits", { by: -1, from: "curse" }); // the ox starts cursed
```

The inspector's **Stats** tab lists every body's stats, base and now, with their modifiers and when each wears off.

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
- Room passages aren't reported as unreachable for want of a link, since [exits](#exits) lead to them. But if no exit can lead to a room, the compiler warns at its room tag: `attic.weft:1:11 warning: No exit leads to the room \`attic\`, so the player can't reach "Attic"`. It reads your code without running it, so it only warns when it's sure. Any use of the room's name other than its own definition and the "from" side of `connect(…)` might be a way in (an exit's `to:`, a journey's `stopsAt:`, `move(you, attic)` in code), and keeps it quiet. So does a link to the passage, and starting the game there.
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

### Journeys

A **journey** is a way long enough to be stopped partway: a subway ride a bomb on the tracks brings to a halt, though a phone call on the way is only told. Define it with `journey()`, and have exits name it:

<!-- example: packages/world/src/journeys.test.ts#journey -->
```ts
export const phone = fuse("phone", { after: minutes(10), interrupts: true }, () => {
  return "Your phone buzzes: your house alarm is ringing.";
});
export const bomb = fuse("bomb", { after: minutes(25), interrupts: true }, () => {
  return "A blast ahead shakes the carriage, and the train grinds to a halt.";
});
journey("subway", { stopsFor: (by) => by === bomb.id, stopsAt: tunnel });
connect(platform, {
  east: { to: downtown, minutes: 40, journey: "subway" },
  north: { to: busStop },
});
```

- **How it's taken:** a journey's link is taken as one move. The clock moves on first, with the journey's `stopsFor` saying what may stop it (anything that interrupts, unless it says).
- **If nothing stops it:** the player arrives, and the story goes on to the destination's room passage.
- **If something stops it:** the player ends up at `stopsAt`, and its room passage, or, without `stopsAt`, back where they set out. The destination's passage is only entered if they arrive.

<!-- example: packages/world/src/journeys.test.ts#arrive -->
```ts
choose("East");
expect([story.current, firstLine()]).toEqual([
  "Downtown",
  "You step out downtown. It's 8:40 am.",
]);
expect(told()).toEqual(["Your phone buzzes: your house alarm is ringing."]);
```

<!-- example: packages/world/src/journeys.test.ts#stopped -->
```ts
choose("East");
expect([story.current, firstLine()]).toEqual([
  "Tunnel",
  "You're stuck in a dark tunnel. It's 8:25 am.",
]);
expect(told()).toEqual([
  "Your phone buzzes: your house alarm is ringing.",
  "A blast ahead shakes the carriage, and the train grinds to a halt.",
]);
```

A stopped journey carries on only by the exits you give the place it stopped, such as walking the tunnel back to the platform. A door or obstacle on a journey blocks it as it does any way.

### The compass

The world model registers a `compass` widget: a button for each way out of the player's room, the eight compass points in a grid and up, down, in, out, and your own directions beside it. Place it, as you would the clock:

```ts
import { addToHeader } from "@loominate-if/presentation";
addToHeader("compass");
```

<!-- example: packages/world/src/compass.test.ts#ways -->
```ts
expect(ways()).toEqual(["N North", "E East", "Down Down (The cellar door is locked.)"]);
```

- **Blocked ways:** a way a locked or closed door blocks is disabled, and the door's reason is its tooltip and what a screen reader hears.
- **Points with no way:** each is a faint dot in its cell, not a button, and screen readers skip it, so the rose keeps its shape and a missing way doesn't look like a blocked one.
- **Taking a way:** a button takes the way as the `{exits}` links do, journeys included, even in a passage that shows no `{exits}`.
- **Names:** a way names where it leads once the player has been there.
- **Keys:** the numpad works when focus isn't in a text field: 8, 2, 4, and 6 for the points, 7, 9, 1, and 3 for the diagonals, and + and - for up and down.

Change the defaults by replacing the widget: `widgets.replace("compass", compass({ names: "all", keys: "vi" }))`. `names` is `"visited"` (the default), `"all"`, or `"none"`, and `keys` is `"numpad"` (the default), `"vi"` for h j k l y u b n, `"both"`, or `"none"`. The short labels are the `compass.short` message, and what the compass is called, for screen readers, is `compass.label`.

The compass's data is plain, a list of ways with each one's direction, label, title, and whether it can be taken and why not, so you can replace its view to draw a brass ship's compass or a subway map, keeping the data.

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

## NPCs acting

An NPC takes actions through the same pipeline as the player, so locks, keys, reach, and a game's own rules apply to them equally. `actAs(npc, call)` runs every stage for them and returns whether it was done and, if not, why:

<!-- example: packages/world/src/npcs.test.ts#world -->
```ts
export const ironKey = thing("ironKey", { name: "iron key", location: hall });
export const cellarDoor = thing("cellarDoor", {
  ...door,
  ...lockable,
  name: "cellar door",
  key: ironKey,
  isLocked: true,
});
connect(hall, { down: { to: cellar, via: cellarDoor }, east: study });
connect(cellar, { up: { to: hall, via: cellarDoor } });
connect(study, { west: hall });
export const butler = actor("butler", { body: { name: "butler", location: hall } });
```

<!-- example: packages/world/src/npcs.test.ts#locked -->
```ts
const tried = actAs(butler, go({ way: "down" }));
expect(tried).toEqual({ done: false, reason: "The cellar door is locked." });
expect(placeOf(butler)?.id).toBe("hall");
```

- **Moving:** the standard `go` action takes an NPC through one of the room's exits, as `go({ way: "north" })`. A locked or closed door stops them, as it would the player. The player moves through the story's passages and exits instead, so `go` refuses the player.
- **What the player hears:** only what they see, in the third person: "The butler unlocks the cellar door." An NPC's coming and going is narrated as any actor's is. Out of sight, nothing is narrated. A refusal is never narrated, but `actAs` returns it, for code such as an agenda to react to.
- **Time:** an NPC's action takes none of the game's time.
- **Giving to the player:** the player takes what they're given, unless a rule in `giving` says otherwise.

<!-- example: packages/world/src/npcs.test.ts#through -->
```ts
actAs(butler, take({ thing: ironKey }));
actAs(butler, unlock({ thing: cellarDoor }));
actAs(butler, open({ thing: cellarDoor }));
expect(actAs(butler, go({ way: "down" })).done).toBe(true);
```

Each standard action has a `seen` message for onlookers, such as `take.seen`, which a game can reword. An action of your own says what onlookers see with `seen`.

### Turns and simulation levels

An NPC acts on its own in its turn, which comes after each of the player's moves. `everyTurn` adds a rule to an NPC's turn, and `simulate` makes an NPC act wherever they are:

<!-- example: packages/world/src/npc-turns.test.ts#turns -->
```ts
everyTurn(butler, "tidies the hall", ({ npc }) => {
  if (cake.location?.id === "hall") actAs(npc, take({ thing: cake }));
});
// The villain is simulated: they act wherever they are.
simulate(villain);
everyTurn(villain, "steals", ({ npc }) => {
  if (gold.location?.id === "vault") actAs(npc, take({ thing: gold }));
});
```

- **Observed only, the default:** an NPC takes a turn only while the player can see or hear them. Most characters need nothing more, and an NPC with no turn rules costs nothing.
- **Simulated:** with `simulate(npc)`, they take a turn after every move, wherever they are, acting offstage too; what they do is narrated only if the player sees it. `simulate(npc, false)` makes them observed only again. It's game state, so it can change in play; in `story.ts`, it's how they start.
- **Order:** an NPC's rules run in the order they're added, and NPCs take their turns in ID order, so the same moves always give the same results. A continue isn't a move, so it gives no turns, and a long wait gives one turn, not one per minute.
- **In the inspector:** each NPC's turn is its own hook, `npc:` and their ID, in the Rules tab, so you can see whose turn ran and what each rule did. `getsTurn(npc)` says whether an NPC gets one now.

### Catching up

An observed-only NPC takes no turns while unseen, so whatever they'd have done offstage doesn't happen. `catchUp` works it out when they're next seen: it runs once, just before their first turn after a stretch without one, with how long that was. It changes state directly, not through actions, since nobody saw it:

<!-- example: packages/world/src/catch-up.test.ts#catch-up -->
```ts
catchUp(butler, "tidied the hall", ({ npc, minutes, moves }) => {
  caught.push({ minutes, moves });
  // Long enough away, and the hall got tidied, unseen.
  if (minutes >= 30 && cake.location?.id === "hall") move(cake, npc);
});
```

Which to use for what happens offstage:

| | For | Cost |
| --- | --- | --- |
| `catchUp` | an NPC's own doings, worked out when they're next seen | nothing while they're unseen |
| fuses and daemons | timed effects on the world, whoever's watching: "the baker restocks at 6 am" | one check per minute or move each |
| `simulate` | the few characters who must act every move, wherever they are | a turn every move |

`catchUp` fires when the NPC is seen again, not when a room they changed is. For that, use a fuse or daemon, or `simulate`. In the inspector, each NPC's catching up is the hook `catchUp:` and their ID.

### Schedules

A scheduled NPC follows a timetable: from a time of day, they're in a place, on the days the calendar says. Where they are is worked out from the clock whenever it matters, with no step-by-step simulation, so they're in the right place after any jump in time:

<!-- example: packages/world/src/timetables.test.ts#timetable -->
```ts
schedule(baker, [
  { at: "05:30", in: bakery },
  { at: "13:00", in: market, on: { weekday: ["tuesday", "thursday"] } },
  { at: "13:00", in: bakery }, // the other days
  { at: "20:00", in: home },
]);
```

- **Which entry:** the latest one that's begun, on a day its `on` matches, working back across days. Among entries at the same time, the first listed that applies wins, so a general entry can follow particular ones, as the bakery after the market above. `on` is the calendar's query: weekdays, months, seasons, holidays, parts of the day.
- **Moving:** when the timetable puts them somewhere else, they're placed there at once, after the next move or jump in time. Seen leaving or arriving, it's narrated as any actor's coming and going is. At the start of the game, they're simply where it says.
- **Agendas come first:** while they have an active, ready agenda item, the timetable doesn't move them. Afterwards they go where it says by then, so an entry they missed is skipped. Anything that depends on them being somewhere, such as a stall opening, should check where they are, `placeOf(baker)`, not the time.
- **`whereScheduled(npc, minutes?)`** says where the timetable puts them, now or at any time.

The inspector's **NPCs** tab shows each NPC's place, whether they get a turn and why, their agenda items and which acts next, and their timetable now and next, with a timeline of what they did offstage.

### Agendas

An agenda item is a goal an NPC pursues across turns, as adv3Lite's are. In the NPC's turn, the highest-priority item that's active and ready takes one step, until it calls `done()`:

<!-- example: packages/world/src/agendas.test.ts#warning -->
```ts
agenda(butler, "warn the player", {
  priority: 10,
  starts: false,
  act: ({ npc, done }) => {
    if (!stepToward(npc, you)) return; // one step a turn, until he's there
    say(npc, "“The east wing is on fire!”");
    done();
  },
});
```

An event gives the NPC the goal, as part of a move:

<!-- example: packages/world/src/agendas.test.ts#fire -->
```ts
fire.isBurning = true;
startAgenda(butler, "warn the player");
```

- **`priority`** decides among items that are ready, higher first, then the order they were added. **`ready`** says whether an item can act now; it defaults to always.
- **`starts: false`** keeps an item waiting for `startAgenda`. `stopAgenda` sets one aside, and `isAgendaActive` says whether one is still to do. Which items are active is game state.
- **While an NPC has an active, ready item, they act even unseen,** as if simulated, so the butler can cross the house to find the player. Once it's done, they're observed only again.
- **`stepToward(npc, target)`** takes one step along the shortest way to a place, or to where a thing or person is, through `go`, so a locked or closed door stops them. It returns true once they're there. Among equally short ways, it goes by direction order.
- **`say(npc, text)`** narrates a line to whoever sees them, as "The butler says, “The east wing is on fire!”", or only hears them, as "Someone says, …". Write the speech with its quotation marks. These are the `say.seen` and `say.heard` messages.

## Conversations

Conversations follow adv3Lite's model, and are built for groups from the start: one-on-one is a group of one. Topics, conversation nodes, and conversation mode come next; underneath them is the conversation itself. There's one at a time, the player's:

<!-- example: packages/world/src/conversations.test.ts#group -->
```ts
startConversation([butler, maid]); // the butler is addressed first
address(maid);
joinConversation(cook);
leaveConversation(maid);
```

- **`startConversation(npc)`** or **`startConversation([npc, …])`** starts one; the first is addressed. **`address`** changes who the player is talking to, **`joinConversation`** and **`leaveConversation`** change who's in it, and **`endConversation`** ends it. They change game state, so do them during play: in a passage's effect, an action, or an NPC's turn, as an agenda item that comes to talk.
- **`conversation`** says how it is now: `active`, `participants` and `addressee` (their bodies), `locks`, and `exit`. **`inConversationWith(npc)`** says whether someone's in it.
- **Someone no longer with the player leaves it,** after each move: they walked off on their timetable, or the player left. With no one left, it ends.

### Locks

A lock says whether the player may leave. Its owner is a participant, or a conversation node by its ID, and each owner holds one; locking again replaces it:

<!-- example: packages/world/src/conversations.test.ts#lock -->
```ts
lockConversation({ by: butler, level: "soft", reason: "He hasn't finished." });
lockConversation({ by: "accusation", level: "hard" }); // a conversation node's
```

`conversation.exit` is the strictest: `free`, `soft` (the NPC objects, but the player can insist), or `hard` (they can't leave). `unlockConversation(owner)` removes one, a participant's go when they leave, and all go when it ends.

### Topics

A topic entry is what an NPC says when the player asks or tells them about something, says yes or no, greets them, or says goodbye. The subject is a thing, a fact, a named topic from `topics`, or `anything`, for whatever they have no particular entry for:

<!-- example: packages/world/src/topics.test.ts#entries -->
```ts
const { war } = topics({ war: "the war" });
const [onDuty, offDuty] = actorStates(butler, ["onDuty", "offDuty"], { starts: "onDuty" });

topic(butler, { ask: letter, says: "“I placed it on the desk myself, sir.”" });
topic(butler, { ask: letter, in: offDuty, says: "“Off the record? I took it.”" });
topic(butler, { ask: letter, in: storm, says: "“Not now, sir, the windows!”" });
topic(butler, { ask: war, says: "“I'd rather not, sir.”" });
topic(butler, { ask: facts.missingLetter, says: "“Missing, sir? Surely not.”" });
topic(butler, { askOrTell: anything, says: "“I couldn't say, sir.”" });
topic(butler, { hello: true, says: "“Sir?”" });
topic(butler, { bye: true, implicit: false, says: "“Very good, sir.”" });
topic(butler, { bye: true, implicit: true, says: "The butler bows as you go." });
```

- **Kinds:** `ask`, `tell`, `askOrTell`, `yes`, `no`, `hello`, and `bye`. A `hello` or `bye` with `implicit: true` is said only when nothing was: talking starts with a question, or the conversation ends without goodbye. With `implicit: false`, only when it's said; with neither, both.
- **`says`** is the text, or a function that returns it and can change state, given `{ npc, about, how }`; `how` says how a conversation ended for a `bye`: `goodbye`, `apart`, or `ended`.
- **A list of responses,** one each time the entry answers, for a topic asked about again. `order` says how: `stop`, the default, says each in turn, then keeps saying the last; `cycle` goes back to the first; and `shuffle` says each once a round in a random order, never starting a round with the one just said. Shuffling draws from a random stream per entry, so a seed and the moves replay it.
- **When it applies:** `when`, a condition; `in`, an actor state of theirs or a scene, so it applies only in that state or while the scene is happening; and `priority`, higher first.
- **Which answers:** among entries that apply, the highest priority, then the most specific (a scene's, then an actor state's, then the actor's; a particular subject over `anything`), then the first defined. With none, the NPC gives a default response: "The butler has nothing to say about that." The inspector's Choices tab shows which entry answers each, and why each other doesn't.

<!-- example: packages/world/src/topic-lists.test.ts#lists -->
```ts
topic(butler, {
  ask: letter,
  says: [
    "“The letter, sir? On the desk.”",
    "“As I said, sir. On the desk.”",
    "He sighs. “The desk, sir.”",
  ], // order: "stop" by default
});
topic(maid, { ask: weather, order: "cycle", says: ["“Cold.”", "“Colder.”"] });
topic(cook, {
  askOrTell: anything,
  order: "shuffle",
  says: ["“I couldn't say.”", "She shrugs.", "“Ask the butler.”", "“Not now, dear.”"],
});
```

**Actor states**, as adv3Lite's, are named states an NPC is in, such as on duty and off duty. `actorStates(npc, names, { starts })` gives them, `setActorState(npc, state)` changes it (in `story.ts`, how they start), and `actorStateOf(npc)` says which is current.

**The player talks** through standard actions, as any action is taken: by `{act …}` links, menus, or the parser later.

- `ask({ who, about })` and `tell({ who, about })` name a thing or topic, or a fact by its ID, as `about: facts.missingLetter.id`. They start a conversation with `who` if need be, with any implicit hello, or bring them into it, and address them.
- `hello({ who })` greets someone; `goodbye({})` ends the conversation, with the addressee's goodbye; and `yes({})` and `no({})` answer the addressee.
- Each exchange takes a minute of game time.
- When a conversation ends without goodbye, as when the player walks off, each participant says their implicit goodbye.

What NPCs say is recorded as `action-result` events tagged `topic` and `speaker:` and their body's ID, so the page shows it after the move.

### Conversation nodes

A node is a moment in a conversation that needs structure, such as an NPC asking a question. An entry `opens` it after answering, and entries `in` it apply only while it's open, ahead of all others:

<!-- example: packages/world/src/topic-nodes.test.ts#node -->
```ts
export const proposal = convNode(butler, "proposal", {
  restricts: true,
  presses: "“Well, sir? Will you take the post?”",
});
topic(butler, { ask: job, opens: proposal, says: "“There is a post, sir. Will you take it?”" });
topic(butler, { yes: true, in: proposal, says: "“Splendid, sir.”" });
topic(butler, { no: true, in: proposal, says: "“A pity, sir.”" });
```

- **`convNode(npc, name, { restricts, presses })`** defines one.
- **Restrictive:** while it's open, only its own entries answer. Changing the subject gets the `presses` line instead, or "The butler waits for your answer.", and it stays open. `{topics}` suggests only its replies, then goodbye.
- **Not restrictive:** other exchanges are answered as usual, and then the NPC presses the point, if it has a `presses` line.
- **Yes and no:** an open node's `yes` and `no` entries are suggested first: "Say yes", "Say no".
- **Closing:** it closes when one of its own entries answers, unless that entry says `stays: true`; on `closeNode(npc)`; or when the NPC leaves the conversation. Greeting and goodbye are never held up, so the player can always say goodbye. Exit control will add locks.
- **`openNode(npc, node)`** opens one from code, as an agenda item that comes to ask something would. The NPC must be in the conversation. `openNodeOf(npc)` says which is open.

### Exit control

A node can hold the player in the conversation while it's open, with `exit`; the node owns the lock, and closing it unlocks:

<!-- example: packages/world/src/topic-exits.test.ts#exits -->
```ts
export const accusation = convNode(inspector, "accusation", {
  exit: "hard",
  presses: "“Answer the question.”",
});
topic(inspector, { ask: murder, opens: accusation, says: "“Did you do it?”" });
topic(inspector, { no: true, in: accusation, says: "“We'll see.”" });

export const confession = convNode(widow, "confession", {
  exit: "soft",
  objects: "“Please, I haven't finished!”",
});
topic(widow, { ask: will, opens: confession, says: "“There's something you should know.”" });
topic(widow, { ask: husband, hearMeOut: "The widow's tale", says: "“Let me tell you about him.”" });
```

| Level | What it does |
| --- | --- |
| Free (the default) | Goodbye and the room's exits always work. |
| `exit: "soft"` | The first goodbye, or the first try at an exit, is met with the node's `objects` line, or "“Just a moment,” the widow says. “I haven't finished.”", and doesn't happen. Trying again insists, and goes. |
| `exit: "hard"` | Goodbye and the room's exits are disabled, with the node's `objects` line or "You can't leave until you answer the inspector.", and only the node's replies are answered: a hard node is restrictive. |
| `hearMeOut` | On an entry, a passage the NPC tells after answering: the player goes to that cut scene, the conversation held, and its `{continue back}` returns them to where they were talking. |

- **A way out:** as the game starts, every hard node must have a reply that closes it, one without `stays`, or the game stops with an error naming the node. A node the game closes from code says `closedElsewhere: true`.
- **Undo** always works, locks or not.
- **The game's own links** are its own business: a lock holds goodbye and the room's exits, not every link a passage has.
- **In passage files,** a block's `-> Passage` is its `hearMeOut`, checked like a link: `{ask husband, -> The widow's tale}`.
- `lockConversation` still locks from code, for locks no node owns.

### Conversation mode

While the player's talking, the page switches to the `conversation` layout, which focuses on the characters:

- **The header** keeps the game menu and what packages add to it.
- **`context`:** the passage's own prose, as a strip above: where the player is, and what the passage says about the conversation.
- **`cast` beside `main`:** a portrait for each character in the conversation, the one addressed marked, and choosing another addresses them; beside it, the conversation so far, each line as it was said, the player's own lines ("You ask the maid about the gold.") muted. New lines are read to screen readers, and focus goes to just before them.
- **`topics`:** the suggested topics as buttons, showing and giving included. A button that can't be taken now is shown disabled, with why, as goodbye under a hard lock.
- **`more`:** the passage's own links, such as the room's exits, in a closed disclosure named after the room, "In the study". Locks still apply to them.
- **`history`:** the story so far, at the very bottom.

When the conversation ends, by goodbye, by walking off, or by the NPC leaving on their timetable, the page goes back to the layout before. Elsewhere during a conversation, as in a hear-me-out cut scene, the usual layout shows, and the conversation's comes back with the player. Which layout is showing is game state, so undo, saves, and replays agree, and the conversation so far is read from the event record, so undo takes back its lines too.

- **`{topics}`** in a passage shows nothing while the layout lists the topics, so a room passage can keep it for games without conversation mode.
- **Portraits:** `portrait(npc, { image, expressions })` gives an NPC an image, and one per expression. Without one, their portrait is their initials. Their expression is game state: `setExpression(npc, "stern")`, or an entry's `expression: "stern"` as it answers, `expression: "stern"` on a block too. `expressionOf(npc)` reads it.

<!-- example: packages/world/src/conversation-mode.test.ts#portraits -->
```ts
portrait(butler, { image: "butler.png", expressions: { stern: "butler-stern.png" } });
topic(butler, { ask: letter, expression: "stern", says: "“I couldn't say, sir.”" });
```

- **NPCs start conversations** with `approach(npc, { says, opens })` in an agenda item. With the player, it starts one, or brings them into the player's, says their line, opens a node if given, and returns true; otherwise false.

<!-- example: packages/world/src/conversation-mode.test.ts#approach -->
```ts
const dinner = convNode(cook, "dinner", { presses: "“Well? Dinner?”" });
topic(cook, { yes: true, in: dinner, says: "“Good. Eight sharp.”" });
const kitchen = object("kitchen", { isReady: false });
agenda(cook, "announce dinner", {
  ready: () => kitchen.isReady,
  act: ({ npc, done }) => {
    if (approach(npc, { says: "“Will you be wanting dinner?”", opens: dinner })) done();
  },
});
```

- **Restyling:** the widgets are `conversation-cast` and `conversation-topics`, presentation's `castWidget` and `actionListWidget` with the world's data. Restyle them with theme CSS, replace their views, or replace the layout under the same name. `conversationMode({ layout: "my-talk" })` switches to a layout of your own, and `conversationMode(false)` turns the switching off.
- **Time:** each exchange takes a minute of game time.
- **Walkthroughs:** `game.choose("Ask about the letter")` takes a topic's button as it does a link.

### Topics in passage files

An NPC's topics can be written as blocks in an actor passage, the prose of each block its response:

<!-- example: packages/cli/src/fixtures/butler.weft#Butler -->
```
:: Butler [actor: butler, state: onDuty]

{hello}
"Sir?"

{ask weather}
"Grey, sir. And it was the butler, if you take my meaning."
{reveal facts.culprit, from: butler}

{ask weather, again}
"As I said, sir. Grey."

{ask past, -> The butler's tale}
"Hear me out, sir."

{ask job, opens: proposal}
"There is a post, sir. Will you take it?"
```

- **`[actor: butler]`** makes the passage the butler's, and it's made only of blocks; anything before the first is an error. `state: onDuty`, `scene: storm`, or `node: proposal` on the passage scope every block in it, so a node's replies can have a passage of their own, as below.

- **Blocks:** `{ask …}`, `{tell …}`, `{ask or tell …}`, `{show …}`, `{give …}`, and `{show or give …}` take a subject; `{yes}`, `{no}`, `{hello}`, and `{bye}` don't. After the subject, a block can say `again`, and a give `takes`; `{hello}` and `{bye}` can say `implicit` or `explicit`. Any block can say `stays`. Named, they take `when:`, `priority:`, `in:`, `opens:`, `suggested:`, and, for `{tell}`, `informs:`.
- **Checked as code:** the actor, states, scenes, and subjects are TypeScript, so a misspelled one is an error at its line: "`wether` isn't defined. Did you mean `weather`?"
- **The response** is the block's prose, `{if}` and printed values included, each paragraph said with its line ID. `{reveal …}` and `{on enter: …}` run each time the block answers, `{on first visit: …}` the first time. Links, beats, and `{on leave: …}` can't go in a block.
- **`again`** applies only once the NPC has answered the same exchange before, by any entry, and comes first among entries of its priority: the first block answers the first time, the `again` block every time after. In TypeScript it's `again: true`.
- Lists that cycle or shuffle are TypeScript only, for now.

A node's replies in a passage of their own:

<!-- example: packages/cli/src/fixtures/butler.weft#Butler proposal -->
```
:: Butler proposal [actor: butler, node: proposal]

{yes}
"Splendid, sir."

{no}
"A pity, sir."
```

### Showing and giving

Showing and giving are the ordinary `show` and `give` actions. When the game's own `giving` and `showing` rules don't answer, the addressee's topic entries do, before the default refusal:

<!-- example: packages/world/src/topic-handing.test.ts#handing -->
```ts
topic(butler, {
  show: photograph,
  says: "He studies it a moment too long. “I couldn't say, sir.”",
});
topic(maid, { give: locket, takes: true, says: "“Oh! My mother's!”" });
topic(maid, { give: anything, says: "“I couldn't accept that, miss.”" });
```

- **Kinds:** `show`, `give`, and `showOrGive`, each with a thing or `anything`.
- **Taking:** a `give` entry keeps their hands to themselves unless it says `takes: true`, so a refusal is as easy as a thank-you.
- **When an entry answers,** the NPC joins the conversation, with any implicit hello, and it takes a minute. With no entry, the default refusal answers, and no conversation starts.
- **Only the player:** entries answer the player's showing and giving, not NPCs handing things to each other.
- **Suggested:** while the player's talking, `{topics}` suggests showing or giving each thing they carry that the addressee has a particular entry for: "Show the photograph", "Give the locket". Everything else stays on the things' own menus, so the whole inventory is available in a conversation.

### What the player knows

Topics are suggested only when the player knows the subject, and answers can teach the player, and others, new facts:

<!-- example: packages/world/src/topic-knowledge.test.ts#knowledge -->
```ts
const facts = defineFacts({
  butlerTookLetter: { text: "The butler took the letter.", name: "the butler and the letter" },
  goldMissing: { text: "The gold is missing.", name: "the missing gold" },
});
const { weather, affair } = topics({
  weather: "the weather",
  affair: { name: "the affair", known: false },
});

topic(maid, { ask: gold, says: "“In the vault, miss.”" });
topic(maid, {
  ask: weather,
  says: "“Cold, miss. And I saw the butler with a letter.”",
  reveals: facts.butlerTookLetter,
});
topic(maid, { ask: affair, says: "“Hush, miss!”" });
topic(maid, { ask: facts.butlerTookLetter, says: "“I'll say no more, miss.”" });
topic(maid, { tell: facts.goldMissing, says: "“Missing? Oh, miss!”" });
topic(maid, { ask: ledger, suggested: false, says: "“The ledger? Cook keeps it.”" });
topic(maid, { askOrTell: anything, says: "“I wouldn't know, miss.”" });
```

- **`{topics}`** in a passage lists, while the player's talking to someone, a link for each subject the addressee has an entry for that would answer now, and the player knows, then "Say goodbye". `suggestedTopics()` gives the same, as labels and actions, for a game's own interface.
  - The player knows a fact once they've learned it; a thing once they've seen it, learned about it, or it's `isFamiliar`; and a named topic from the start, unless it's defined with `known: false`, until `player.learnAbout(topic)`.
  - A fact's `name` is how the player refers to it in a suggestion, "the missing gold"; without one, its text is quoted.
  - Catch-alls aren't suggested, nor entries with `suggested: false`, which still answer when asked.
- **`reveals`** on an entry: when it answers, the player learns the facts from the NPC, and so does everyone else in the conversation.
- **Telling an NPC a fact** teaches it to them, from the player, whatever they reply, unless the entry says `informs: false`.
- The player can't ask or tell about a fact they don't know: "You don't know anything about that."

## Scenes

A **scene** is a named period of the story, as Inform 7 and adv3Lite have them: a storm, a dinner party, a chase. It starts when something holds, at a time, or when your code says, and ends the same ways, and while it's happening it can add rules and actions. (It isn't a cut scene, a passage of timed beats.)

<!-- example: packages/world/src/scenes.test.ts#storm -->
```ts
export const storm = scene("storm", {
  name: "the storm",
  startsWhen: () => clock.is("evening") && at(cliff),
  endsWhen: { sheltered: () => at(cave) },
  lasts: minutes(60),
  onStart: () => "Thunder cracks overhead, and rain sweeps the cliff.",
  onEnd: (how) => (how === "sheltered" ? "You're out of the rain." : "The storm blows itself out."),
});
export const signal = action<{ thing: typeof cliff }>("signal", {
  label: "Fire a flare",
  report: "Your flare arcs out over the sea.",
});
storm.rule(signal.check, "the wind snatches flares", () => "The wind snatches the flare away.");
export const brace = action<{ thing: typeof cliff }>("brace", {
  label: "Brace against the wind",
  during: storm,
  report: "You brace against the wind.",
});
```

- **Starting:** `startsWhen` is checked after every move and whenever a fuse or daemon fires. `startsAt: "19:00"`, with `on` days if you like, starts it at a time. `storm.start()` starts it from code.
- **Ending:** `endsWhen` is a condition, or several, each naming an ending. `lasts: minutes(60)` ends it as `"timeUp"`, and `storm.end("escaped")` ends it from code. `storm.howEnded` says how it last ended.
- **Saying so:** `onStart` and `onEnd` may return what the player is told, which stands out.
- **Rules:** `storm.rule(rulebook, name, fn)` adds a rule that takes part only while the storm is happening, like Inform's "Instead of firing a flare during the Storm". It's registered once, when the game loads, so undo and loading a save always agree with what's happening. The inspector shows it as from "game (during the storm)".
- **Actions:** `during: storm` on an action offers it only while the storm is happening.

<!-- example: packages/world/src/scenes.test.ts#happening -->
```ts
choose("Wait 10 minutes"); // a move: the storm's condition holds
expect([storm.isHappening, storm.timesStarted]).toEqual([true, 1]);
expect(offered()).toContain("Brace against the wind");
expect(statusOf(signal({ thing: cliff })).disabled).toBe("The wind snatches the flare away.");
choose("In");
expect([storm.isHappening, storm.howEnded, storm.hasEnded]).toEqual([false, "sheltered", true]);
```

A scene happens once, unless it says `recurring: true`, or a number of times at most. Starting a finished one-time scene from code is an error that says so. `storm.hasHappened`, `storm.hasEnded`, `storm.timesStarted`, and `storm.startedAt` say what's happened, for text and conditions, as in `{if storm.isHappening}Rain lashes the window.{/if}`.

<!-- example: packages/world/src/scenes.test.ts#tide -->
```ts
export const tide = scene("tide", {
  startsAt: "19:00",
  lasts: minutes(30),
  recurring: 2,
  onStart: () => "The tide comes in.",
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

Travel through an ordinary exit isn't stopped partway, since the player has already arrived when its minutes pass. What's due on the way fires and is told. For a way that can be stopped partway, make it a [journey](#journeys).

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

### The calendar

The clock keeps a calendar too. It's the real one by default, started from a date:

<!-- example: packages/world/src/calendar.test.ts#start -->
```ts
startClock({ at: "23:30", date: "1923-10-31" });
holiday("thanksgiving", { month: "november", weekday: "thursday", nth: -1 });
holiday("christmas", { month: "december", date: 25 });
```

<!-- example: packages/world/src/calendar.test.ts#dates -->
```ts
expect(dateText()).toBe("Wednesday, 31 October 1923");
expect([calendar.weekday, calendar.month, calendar.date, calendar.year]).toEqual([
  "wednesday",
  "october",
  31,
  1923,
]);
expect(calendar.season).toBe("autumn");
clock.advance(60);
expect(dateText()).toBe("Thursday, 1 November 1923");
```

`calendar` says the `weekday`, `month`, `date`, `year`, and `season`, with weekdays and months in lowercase, and the `holidays` today is. `dateText()` words the date through the `calendar.date` message. The seasons are the northern meteorological ones, spring from March to May; `useCalendar(gregorian({ seasons: "southern" }))`, or months of your own for each, change them.

A game can choose another calendar with `useCalendar`:

- `countedDays(…)`: "Day 1", "Day 2", with a week and seasons if you give them. Seasons follow each other, so many days each, round and round. There are no months or years, so those are `undefined`.
- `defineCalendar(…)`: one of your own, with its own months and their lengths, its own week, a leap day, and seasons by month. Years count from 1, and `startClock({ date: { year, month, date } })` starts it.

<!-- example: packages/world/src/calendar-own.test.ts#own -->
```ts
export const reckoning = defineCalendar({
  months: [
    { name: "Frostmoot", days: 30 },
    { name: "Thaw", days: 28 },
    { name: "Greening", days: 31 },
    { name: "Highsun", days: 30 },
    { name: "Harvest", days: 29 },
  ],
  week: [
    "Firstday",
    "Seconday",
    "Thirdday",
    "Fourthday",
    "Fifthday",
    "Sixthday",
    "Seventhday",
    "Eighthday",
  ],
  leap: { month: "Thaw", days: 1, when: (year) => year % 4 === 0 },
  seasons: { winter: ["Frostmoot", "Thaw"], summer: ["Greening", "Highsun"], autumn: ["Harvest"] },
});
```

<!-- example: packages/world/src/calendar-own.test.ts#counted -->
```ts
export const survival = countedDays({
  week: ["Moonday", "Sunday", "Starday"],
  seasons: [
    { name: "dry", days: 5 },
    { name: "wet", days: 3 },
  ],
});
```

<!-- example: packages/world/src/calendar-own.test.ts#days -->
```ts
expect([dateText(), calendar.month, calendar.year]).toEqual([
  "Moonday, day 1",
  undefined,
  undefined,
]);
clock.advance(3 * DAY);
expect([dateText(), calendar.season, calendar.holidays]).toEqual([
  "Moonday, day 4",
  "dry",
  ["landfall"],
]);
```

`calendar.is({ weekday, month, season, holiday })` checks today, for conditions, guards, and text: each part given must match, and a list matches any of its names. Names are checked against the calendar, so a typo is an error, not a silent `false`.

**Holidays** are plain data, named with `holiday(name, rule)`: a date each year, `{ month: "december", date: 25 }`; the nth weekday of a month, `{ month: "november", weekday: "thursday", nth: -1 }` (-1 is the last); or a day of the game, `{ day: 4 }`.

**Daemons at a time of day** fire on the days `on` says, as weekdays or any calendar check, such as `{ holiday: "thanksgiving" }` or `{ season: "summer" }`. They're stepped to like any other, so sleeping through Tuesday still opens the market:

<!-- example: packages/world/src/calendar.test.ts#market -->
```ts
export const market = daemon(
  "market",
  { at: "08:00", on: ["tuesday", "thursday"], running: true },
  () => `The market opens, ${dateText()}.`,
);
```

<!-- example: packages/world/src/calendar.test.ts#week -->
```ts
expect(market.firesAt).toBe(8 * 60 + 30); // Thursday 08:00
clock.advance(7 * DAY);
expect(said()).toEqual([
  "The market opens, Thursday, 1 November 1923.",
  "The market opens, Tuesday, 6 November 1923.",
]);
```

### Parts of the day and opening hours

`clock.is("night")` says whether it's that part of the day, and `clock.part` which it is. The parts are dawn from 5:00, morning from 7:00, afternoon from 12:00, evening from 17:00, and night from 21:00, until `dayParts({ … })` names your own. `clock.between("09:00", "17:00")` checks a span, running past midnight if it ends earlier than it starts, and `calendar.is({ part: "night", weekday: "friday" })` checks parts with days:

<!-- example: packages/world/src/hours.test.ts#parts -->
```ts
expect([clock.part, clock.is("morning"), clock.between("08:00", "09:00")]).toEqual([
  "morning",
  true,
  true,
]);
clock.advance(13 * 60); // 21:30
expect([clock.part, calendar.is({ part: "night", weekday: "friday" })]).toEqual([
  "night",
  true,
]);
expect(clock.between("21:00", "02:00")).toBe(true); // past midnight
```

In a passage, `{if clock.is("night")}Stars wheel overhead.{else}The sky is grey.{/if}` varies a description, and a link's `{when …}` or an action's `check` can vary what's offered.

**Opening hours** go on a door or other obstacle on an exit, with `openingHours`, and `of` names the place whose hours they are. Outside them, the way into that place is blocked with why, before the door's own reason, as a locked door does. The way out is never closed by the hours, so someone inside at closing time can always leave; the door's own reason, such as being locked, still applies. `on` takes weekdays or any calendar check, and a `close` earlier than `open` closes after midnight, counted as the day it opened:

<!-- example: packages/world/src/hours.test.ts#hours -->
```ts
export const bakeryDoor = thing("bakeryDoor", {
  ...door,
  ...openingHours({
    of: bakery,
    open: "09:00",
    close: "17:00",
    on: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  }),
  name: "bakery door",
});
export const tavernDoor = thing("tavernDoor", {
  ...door,
  ...openingHours({ of: tavern, open: "17:00", close: "01:00" }), // until after midnight
  name: "tavern door",
});
connect(street, { in: { to: bakery, via: bakeryDoor }, east: { to: tavern, via: tavernDoor } });
```

<!-- example: packages/world/src/hours.test.ts#closed -->
```ts
expect(exits()).toEqual([
  "East: The tavern is closed until 5:00 pm.",
  "In: The bakery is closed until 9:00 am.",
]);
clock.advance(30); // 9:00 on Friday
expect(exits()).toEqual(["East: The tavern is closed until 5:00 pm.", "In: open"]);
clock.advance(8 * 60); // 17:00 on Friday
expect(exits()).toEqual(["East: open", "In: The bakery is closed until 9:00 am on Monday."]);
```

`isOpenNow(bakeryDoor)` checks it from code, such as a shopkeeper's action. The hours are state, so `bakeryDoor.hours = …` changes them during play, for a holiday, say. The reason is the `hours.closed` message.

### Closing time

Someone inside when a place closes is free to leave, and nothing else happens, since they may have something to finish there. To have something happen, list it with `closingTime`, step by step after closing:

<!-- example: packages/world/src/closing.test.ts#closing -->
```ts
closingTime(bakeryDoor, [
  { after: minutes(5), say: "The baker glares at you over the counter." },
  {
    after: minutes(20),
    say: "“We're closed, dear,” says the baker, and shows you out.",
    moveTo: street,
    unless: () => till.isPaying,
  },
]);
```

- **What a step does:** `say` tells the player something, `moveTo` moves them to a place and the story to its room's passage, and `do` runs code of your own, which may return more to say.
- **Who it affects:** each step happens only if the player is still inside, and stands out in its own paragraph.
- **Interrupting:** a step that happens interrupts a jump of the clock, so a long wait in the bakery is cut short by the baker's glare.
- **`unless`:** a step waits while this holds, such as while the player is paying. It's checked again each minute and each move, and the step happens once it's clear.

<!-- example: packages/world/src/closing.test.ts#shown out -->
```ts
choose("Wait 30 minutes"); // to 17:20, but the glare at 17:05 stops it
expect([timeOfDay(), story.current]).toEqual(["5:05 pm", "Bakery"]);
choose("Wait 30 minutes");
expect([timeOfDay(), story.current]).toEqual(["5:20 pm", "Street"]);
expect(told()).toEqual([
  "The baker glares at you over the counter.",
  "Your wait ends at 5:05 pm.",
  "“We're closed, dear,” says the baker, and shows you out.",
  "Your wait ends at 5:20 pm.",
]);
```

It's built from a daemon at the door's closing time and a fuse for each step, named `closing:<door>…`, so the inspector's Fuses and daemons tab lists them.

### Sending the player elsewhere

A step that moves the player out happens partway through a move, a wait, say, when the story can't change passages. Core's `redirect(passage)` handles that, and you can call it yourself from an effect, an action, or a fuse or daemon as it fires. When the move is done, the story goes on to that passage, as part of the same move:

<!-- example: packages/core/src/passages/redirect.test.ts#trapdoor -->
```ts
enter: ({ emit }) => {
  if (floorRotten) {
    emit("perception", { text: "The floor gives way!", sense: "see" });
    redirect("Cellar");
  }
},
```

The passage the player was going to is entered first, with its effects, then left. Undo takes back both passages at once, and a replay makes the same move and is redirected the same way.

What led to the redirect comes first on the page, before the passage the player was sent to, since it's how they got there: "The floor gives way!", then "You land in the cellar." Atmosphere from fuses and daemons stays after the text, as usual. In the story so far, it sits between the passage they left and the one they landed in.

### Showing the time

The world model registers a `clock` widget showing `timeOfDay()`, labelled "Time" for screen readers. It isn't shown unless the game adds it, in `story.ts`:

```ts
import { addToHeader } from "@loominate-if/presentation";
addToHeader("clock");
```

Reword it with `messages.replace("clock.time", ({ hour, minute }) => …)`, or replace the widget's view to draw a dial. Presentation's `textWidget({ text, label })` makes a widget like it for any line of text, such as a score.


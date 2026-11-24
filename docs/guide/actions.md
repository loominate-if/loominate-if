# Actions

An **action** is something a player can do, such as open a door or ring a bell, beyond following a link to another passage. Every action, from a link today, and from menus, NPCs, and a parser to come, runs through the same four stages. [ADR 0044](../decisions/0044-action-pipeline.md) records the decisions behind this guide.

1. **Verify:** does it make sense here? If not, it isn't offered at all.
2. **Check:** is it allowed now? If not, it's offered disabled, with the reason.
3. **Action:** do it, taking its time.
4. **Report:** say what happened. The page shows it after the passage's text, as a notice.

## Defining one

Define an action in `story.ts` with `action(name, { … })`, naming the things it acts on in its type. Each function is optional:

<!-- example: packages/core/src/actions/actions.test.ts#open -->
```ts
export const open = action<{ thing: typeof door }>("open", {
  label: ({ thing }) => `Open the ${thing.name}`,
  verify: ({ thing }) => (thing.isOpen ? "It's already open." : undefined),
  check: ({ thing }) => (thing.isLocked ? "It's locked." : undefined),
  run: ({ thing }) => {
    thing.open();
  },
  report: ({ thing }) => `You open the ${thing.name}.`,
  minutes: 1,
});
```

- `label` is what the player sees; it defaults to the action's name.
- `verify` and `check` return why not, or `undefined`.
- `report` is text, or a function of the things, recorded as an `action-result` event. A `t` template works, naming things by name, as `{the thing}`.
- `minutes` is how long it takes. Core has no clock; the game clock (#84) will count it, through the `actionTime` hook.

## Offering one from a passage

`{act …}` after a link makes it an action link. It needs no `->`: it stays on the passage. Following it performs the action, and the action's report appears after the passage's text:

<!-- example: packages/cli/src/fixtures/rooms.weft#Hall -->
```weft
:: Hall [room: hall]
{if visitsTo(hall) === 1}A draughty hall.{else}The hall again.{/if} You're in {you.location?.id ?? "nowhere"}.
{exits}
[[Unlock the cellar door -> Unlock]]{when cellarDoor.isLocked, hidden}
[[Knock on the door]]{act knock({ thing: cellarDoor })}
```

- A link whose action fails verify is hidden; the inspector's Choices panel lists it with the reason and the rule that gave it, as it does every action on a menu ([the inspector](inspector.md#why-a-choice-is-hidden)). One that fails check is disabled with the reason, as any link with `{when …, reason: …}`: the player sees it in a tooltip when they hover, focus, or tap the link.
- The action is called with its things by name, as `knock({ thing: cellarDoor })`, so TypeScript checks them against what the action expects.
- An action link is a move like any other: undo takes it back, saves keep it, and a replay takes it again. It's logged as an `act` move, with the action's name and its things.

Code performs an action with `perform(call)`, in an effect, through every stage: `{on enter: perform(knock({ thing: cellarDoor }))}`. It returns whether it was done, and why not.

An action can also be offered only during a period of the story: `during: storm` hides it while the world model's [scene](world.md#scenes) `storm` isn't happening.

## Things' menus

A thing's name in the text can open a menu of what the player can do with it. Write the name as a link with `{menu …}`; like `{act}`, it needs no `->`:

```weft
A [[brass bell]]{menu bell} hangs by the door.
```

Choosing the name opens the menu under it. The arrow keys move through it, Enter or a click takes an action, and Escape, Tab, or a click elsewhere closes it, giving focus back to the name. Actions whose verify fails aren't listed. Those whose check fails are listed disabled, with the reason under them. Taking one is the same move as an action link: it stays on the passage, its report shows after the text, and undo, saves, and replays cover it.

An action says whose menus offer it:

- `on: bell`, or `on: [bell, gong]`, offers it on those things' menus.
- `for: (thing) => …` offers it on every thing the function says yes to, as the world model's standard actions do.

Either way, the menu's thing is the action's `thing`, so an action offered on menus names its thing `thing`: `action<{ thing: Bell }>("ring", { on: bell, … })`. `actionsFor(thing)` lists what a thing's menu offers, and `story.act(call)` takes one, as the menu does.

### Asking for a number

An action can ask the player for a number before it's taken, such as how many coins to bet. `asks` names each argument it asks for, with a label and limits, as text or worked out from its things, and `confirm` names the button that takes it:

<!-- example: packages/core/src/actions/asks.test.ts#asks -->
```ts
export const bet = action<{ thing: typeof table; coins: number }>("bet", {
  on: table,
  label: "Bet some coins…",
  asks: { coins: { label: "How many coins?", min: 1, max: () => purse.coins, start: 2 } },
  confirm: "Bet",
  run: ({ coins }) => {
    purse.coins -= coins;
    table.pot += coins;
  },
  report: ({ coins }) => `You push ${String(coins)} coins into the pot.`,
});
```

- **In a menu,** choosing it puts a form where the menu was: a labelled number field for each number, with its limit ("of 12") beside it, and buttons to take it or go **Back** to the menu. Enter takes it, and Escape goes back.
- **Checking the number:** a number outside its limits isn't taken. The form says why ("Choose a whole number from 1 to 12.") and stays open.
- **The rules** see the number as the argument: `run: ({ coins }) => …`.
- **Limits:** `min` defaults to 1, `start` to `min`, and `max` to no limit.
- **In code,** give the number: `perform(bet({ thing: table, coins: 5 }))`. A call without it, or with one outside its limits, is refused with an error that says which.
- **Rewording:** without `confirm`, the button says "OK", the `menu.ask.confirm` message.

## Rules

Each stage is a rulebook, so an action's behavior can be added to, replaced, or removed without changing its definition, as TADS's `modify` does. The definition's own function is the rule `"<name>: own"`, so new rules can go before or after it:

<!-- example: packages/core/src/actions/actions.test.ts#rules -->
```ts
open.check.rule(
  "not while the bell rings",
  ({ thing }) => (bell.rung > 0 ? `The bell drowns out the ${thing.name}.` : undefined),
  { before: "open: own" },
);
```

- `open.verify`, `open.check`, `open.report` are decide rulebooks: the first rule to give a reason, or text, wins.
- `open.perform` runs every rule, in order.
- `open.minutes` passes the count from rule to rule.
- `everyAction.verify` and `everyAction.check` hold rules for every action, run before each action's own.

## Verb phrases

An action can say what a player might type for it, for the parser and autocomplete command line to come. Nothing reads them yet, but a game that has them works with a parser later. A phrase is words, a slot for each of the action's things by its role, and optional words in parentheses:

<!-- example: packages/core/src/actions/verbs.test.ts#verbs -->
```ts
const unlock = action<{ thing: typeof door; tool: typeof key }>("verbs-unlock", {
  on: door,
  with: { tool: key },
  verbs: [
    "unlock {thing} with {tool}",
    "use {tool} on {thing}",
    "Turn (the) {tool} in {thing}",
  ],
});
```

- **Checked when the game compiles:** a slot that isn't one of the action's roles is an error at the phrase: "`{key}` isn't one of unlock's roles: thing, tool."
- **Checked as the game loads:** braces and parentheses that don't match, and a phrase with no words outside its slots, are errors then.
- **Reading them:** `unlock.verbs` gives each phrase as written and in parts (words, optional words, and slots), for a parser to match against.
- **The standard actions** come with the usual phrases: "examine", "x", and "look at"; "take", "get", and "pick up"; "drop" and "put down"; and so on. Add to an action's phrases in its definition.

## With the world model

The world model says who acts and adds rules every action follows:

- The player's mind acts, through its body: an action's rules see them as `actor` and `body`, and they follow `playAs()` and possession.
- An action isn't offered to a mind with no body ("You have no body to act with."), or when one of its things is out of the player's reach ("The barrel is out of reach."). A door is in reach from both rooms it joins.

<!-- example: packages/world/src/acting.test.ts#kick -->
```ts
export const kick = action<{ thing: Thing }>("kick", {
  run: (c: ActionContext<{ thing: Thing }>) => {
    seen.push(`${c.actor?.id ?? "-"} in ${c.body?.id ?? "-"} kicks ${c.thing.id}`);
  },
  report: "Thud.",
});
```

### Standard actions

The world model defines these actions, each offered on the menus of the things it suits:

| Action | On | What it does |
| --- | --- | --- |
| `examine` | every thing but places | Says the thing's `description`, text or a `t` template, or "You see nothing special about the statue." |
| `take` | things that can be carried | Moves it into the player's body. Not offered for what they already have. |
| `drop` | things the player carries | Puts it where they are. |
| `open`, `close` | `openable` things | Opens or closes it. A locked one can't be opened. |
| `lock`, `unlock` | `lockable` things | Locks or unlocks it, if the player carries its `key`. A lock with no `key` needs none. An open thing must be closed to lock. |
| `give`, `show` | things the player carries, to someone present | Gives or shows it to them; a rule in `giving` or `showing` says how they react. |

<!-- example: packages/world/src/standard.test.ts#things -->
```ts
export const key = thing("key", { name: "iron key", location: hall });
export const chest = thing("chest", {
  ...container,
  ...openable,
  ...lockable,
  key,
  name: "oak chest",
  description: "Iron bands hold it shut.",
  location: hall,
});
export const statue = thing("statue", { name: "statue", isFixed: true, location: hall });
```

<!-- example: packages/world/src/standard.test.ts#menus -->
```ts
expect(menu(key)).toEqual(["Examine the iron key", "Take the iron key"]);
expect(menu(chest)).toEqual([
  "Examine the oak chest",
  "Take the oak chest",
  "Open the oak chest (The oak chest is locked.)",
  "Unlock the oak chest (You need the iron key.)",
]);
```

- A thing can't be taken if it's a place, a body, a door or obstacle, or marked `isFixed: true`.
- Their words are in the message table, as `take.label` ("Take the iron key"), `take.done` ("You take the iron key."), and so on ([Rewording the library](messages.md)).
- Each is an ordinary action, exported from `@loominate-if/world`, so change one with its rules, as in `take.check.rule("too heavy", …)`. A game's own action can't reuse their names: call it something else, or change theirs.

### Giving and showing

`give` and `show` are offered on what the player carries, to anyone present, and on that person's menu too: "Give the coin to the toll keeper". How they react is up to rules in the `giving` and `showing` rulebooks. The first rule to answer decides, with `accept(text, then?)`, so they take what they're given, or `react(text, then?)`, so they don't. `then` is anything else that happens:

<!-- example: packages/world/src/giving.test.ts#reactions -->
```ts
giving.rule("the keeper takes the toll", ({ thing, to }) =>
  to.id === keeper.id && thing.id === coin.id
    ? accept("The keeper bites the coin, and nods.")
    : undefined,
);
showing.rule("the keeper knows the pass", ({ thing, to }) =>
  to.id === keeper.id && thing.id === pass.id
    ? react("The keeper squints at the seal, and unlocks the gate.", () => {
        gate.isLocked = false;
      })
    : undefined,
);
```

With no answer, they decline: "The toll keeper doesn't want the pebble.", or for showing, "The toll keeper glances at the pebble." Those are the `give.declined` and `show.unmoved` messages.

### Actions with more than one thing

"Pry the crate open with the crowbar" has two things: the crate, its `thing`, and the crowbar, its `tool`. `with` names each of an action's other things for menus to fill in, as a fixed thing or a test for things that suit:

<!-- example: packages/world/src/multi.test.ts#pry -->
```ts
export const pry = action<{ thing: typeof crate; tool: Thing }>("pry", {
  on: crate,
  with: { tool: crowbar },
  label: t`Pry {the thing} open with {the tool}`,
  verify: ({ thing }) => (thing.isOpen ? "It's open already." : undefined),
  run: ({ thing }) => {
    thing.open();
  },
  report: t`You lever {the thing} open with {the tool}.`,
});
```

<!-- example: packages/world/src/multi.test.ts#cut -->
```ts
const isSharp = (t: object): boolean => "isSharp" in t && t.isSharp === true;
export const cut = action<{ thing: Thing; blade: Thing }>("cut", {
  for: (t) => t.id === "rope",
  with: { blade: isSharp },
  label: t`Cut {the thing} with {the blade}`,
  report: t`You cut {the thing} with {the blade}.`,
});
```

The action is offered on every participant's menu, the crate's and the crowbar's, and only when all of them are in reach:

<!-- example: packages/world/src/multi.test.ts#menus -->
```ts
expect(menu(crate)).toEqual(["Pry the crate open with the crowbar"]);
expect(menu(crowbar)).toEqual(["Pry the crate open with the crowbar"]);
```

A test is tried on every thing the player can reach, never the thing in another role, and the menu has one entry for each thing that passes:

<!-- example: packages/world/src/multi.test.ts#suits -->
```ts
expect(menu(rope)).toEqual(["Cut the rope with the axe", "Cut the rope with the knife"]);
expect(menu(knife)).toEqual(["Cut the rope with the knife"]);
```

A passage can still offer one directly, with every thing given: `[[Pry it open]]{act pry({ thing: crate, tool: crowbar })}`. Without the world model, menus fill only the fixed things, unless the game says what to try with `useCandidates(() => […])`.

### The inventory

The world model adds an inventory to the page's header: "You carry: an iron key, a map", or "nothing". Each name opens the thing's menu. A game that replaces the `page` layout places the `inventory` widget itself, and presentation's `thingsWidget` makes others like it.

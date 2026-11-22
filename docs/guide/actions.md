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

- A link whose action fails verify is hidden; the inspector's Choices panel lists it with the reason. One that fails check is disabled with the reason, as any link with `{when …, reason: …}`: the player sees it in a tooltip when they hover, focus, or tap the link.
- The action is called with its things by name, as `knock({ thing: cellarDoor })`, so TypeScript checks them against what the action expects.
- An action link is a move like any other: undo takes it back, saves keep it, and a replay takes it again. It's logged as an `act` move, with the action's name and its things.

Code performs an action with `perform(call)`, in an effect, through every stage: `{on enter: perform(knock({ thing: cellarDoor }))}`. It returns whether it was done, and why not.

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

The world model doesn't define actions such as open, take, or drop yet; they'll come with the context menus (#77). Write your own with `action()` meanwhile.

# Storylets

A storylet is a passage that becomes eligible as conditions are met: the weather, a relationship, a place, a day. A hub passage offers the eligible ones as choices, or the story draws one, choosing by priority, with once-only storylets and cooldowns taking them out of the pool for good or for a while. They work in any story, with or without the world model. [ADR 0070](../decisions/0070-storylets.md) records the decisions behind this guide.

## Making storylets

The prose is an ordinary passage. In `story.ts`, `storylet` makes it a storylet, with when it's eligible and how it's chosen:

<!-- example: packages/core/src/passages/storylets.test.ts#storylets -->
```ts
storylet("Rainy visit", {
  when: { "it's raining": () => weather.raining, "Mira likes you": () => mira.affection >= 3 },
  priority: 2,
  once: true,
  deck: "evenings",
});
storylet("Card game", { deck: "evenings", cooldown: 2 });
storylet("Long walk", { deck: "evenings", cooldown: 2, label: "Go for a long walk" });
storylet("Letter", { deck: "mornings" });
```

- **`when`**: a test, as `() => weather.raining`, or named tests. With names, the inspector says which ones don't hold. Without `when`, it's always eligible.
- **`priority`**: higher comes first. It defaults to 0.
- **`once`**: once seen, it's never eligible again.
- **`cooldown`**: how long it rests after it's seen. A number counts moves: `cooldown: 2` offers it again two moves after the one it was seen in. With the world model, `minutes(…)` and `days(…)` count the game clock.
- **`deck`**: a name, so a passage can offer or draw only that deck's storylets.
- **`label`**: the link's text in a hand. It defaults to the passage's name.

A storylet is seen whenever the player arrives at it, however they got there. A storylet whose passage doesn't exist is an error as the game starts.

## Offering and drawing them

`{storylets}` offers a hand: a link to each eligible storylet, in order. `{storylets evenings}` offers only that deck's, and `limit` caps how many:

<!-- example: packages/cli/src/fixtures/storylets.weft#Start -->
```weft
:: Start
Evening falls over the village. What will you do?
{storylets evenings, limit: 2}
[[Sleep until morning -> Dawn]]
```

`{storylet}` draws one instead: as the player arrives, they go straight to the first eligible storylet, as part of the same move. If none is eligible, the passage carries on:

<!-- example: packages/cli/src/fixtures/storylets.weft#Dawn -->
```weft
:: Dawn
{storylet mornings}
Nothing comes with the morning.
[[Back to the evening -> Start]]
```

In code, `storyletsIn("evenings")` gives the eligible storylets in order, for drawing with `redirect` or showing in a widget.

## The order

Eligible storylets come in this order:

1. Highest priority first.
2. Then the one seen longest ago, or never.
3. Then a tie-break worked out from the game's seed and the move. It changes from move to move, and the same seed and moves always give the same order, so replays and walkthrough tests repeat it exactly.

The order is worked out without changing anything, so a hand can be shown while the passage renders.

## With the world model

The world model's clock lets a cooldown count game time:

<!-- example: packages/world/src/storylets.test.ts#cooldown -->
```ts
storylet("Market day", { deck: "mornings", cooldown: days(7) }); // once a week, by the clock
```

## In the inspector

The **Choices** tab's **Storylets** section lists every storylet in the game, with its deck, priority, and place in the order. While one isn't eligible, it says why: which of its named tests don't hold, that it's once only and has been seen, or how long it has left to rest. A game without storylets doesn't show the section.

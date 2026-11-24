# 0070. Storylets

- **Status:** Accepted, 2026-11-24
- **Issue:** [#97](https://github.com/loominate-if/loominate-if/issues/97)
- **Design:** [Storylets and stackable items](../DESIGN.md#storylets-and-stackable-items), [ADR 0008](0008-random-streams.md), [ADR 0048](0048-explaining-actions.md)

## Context

A pool of events should become eligible as conditions are met, and the runtime should choose among them by priority, with once-only rules, cooldowns, and recency. Selection must be deterministic, and the inspector must say why a storylet isn't eligible.

## Decision

- **A storylet is a passage.** `storylet(passage, { when, priority, once, cooldown, deck, label })` in `story.ts` makes it one. The prose stays in `.weft` files, and the rules are code. `when` is a test, or named tests the inspector can name. A storylet naming no passage is an error as the story begins.
- **In core.** A plain branching story can use storylets without the world model. Cooldowns count moves there. The world model's clock registers game time with core, through an internal hook, so a cooldown can be `minutes(…)` or the new `days(…)`.
- **Meeting them:**
  - `{storylets deck, limit: n}` is a content directive giving a link to each eligible storylet, in order.
  - `{storylet deck}` is an arrival directive that redirects to the first, as part of the move, or does nothing if none is eligible.
  - `storyletsIn(deck)` gives the order to code.
- **The order:** highest priority, then the one seen longest ago (or never), then a tie-break hashed from the seed, the move count, and the passage.
  - **Not a random stream:** the issue's discussion said a draw from a `storylets` stream. But a stream's draws change state, and a hand is worked out while a passage renders, which must change nothing. The hash gives the same guarantees: it varies from move to move and from seed to seed, and the same seed and moves always give the same order, through undo and replay.
- **Seeing:** a storylet is seen whenever the player arrives at it, recorded in state (how often, the order seen in, the move, and the game time, if there is a clock). The move it's seen in is its count once that move ends, so `cooldown: 2` offers it again two moves later. A continue isn't a move (ADR 0056).
- **A game without storylets runs none of this:** core adds its hook rules with the first `storylet` call.
- **The inspector:** the Choices tab gains a Storylets section listing each storylet with its deck, priority, and place in the order, or why it isn't eligible. Explainers gain `hideWhenEmpty`, so a game without storylets doesn't see the section, and `why`, the inspector's own words for a reason that isn't a condition or a rule.
- **`story.ts` always runs.** A generated passage module imported `story.ts` only for the names it used, so a `story.ts` that only made storylets never ran. Every passage module now imports it, by name or for its effects alone.

## Consequences

- Hands are recomputed at each render, so a storylet whose `when` changes during a passage's effects is offered or not as the passage shows.
- A locked storylet, shown but not available as in some quality-based narratives, isn't offered yet.

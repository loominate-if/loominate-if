# 0078. Giving and showing, and menus in walkthroughs

- **Status:** Accepted, 2026-11-24
- **Issue:** [#345](https://github.com/loominate-if/loominate-if/issues/345)
- **Design:** [World model library](../DESIGN.md#world-model-library), [ADR 0027](0027-first-acceptance-games.md), [ADR 0046](0046-context-menus.md)

## Context

Gate 2's NPC (#59) can be given or shown things, and reacts through rules. The world model had no actions for either. Its walkthrough must check menus and the compass, but walkthroughs could only follow links.

## Decision

- **Standard actions** `give` and `show`, on things the player carries, with a `to` role filled by anyone present but the player. They're offered on the thing's menu and on that person's. Like every action, both things must be within reach.
- **Reaction rulebooks,** `giving` and `showing`, are decide rulebooks over the thing, who it's for, and who's acting.
  - The first rule to answer decides, with `accept(text, then?)`: for giving, they take it, and it moves to them. Or with `react(text, then?)`: they don't.
  - `then` is anything else that happens. The text is what the action reports.
  - With no answer, the `give.declined` and `show.unmoved` messages say so.
- **Through rules, not handlers on the NPC,** so a package or a scene can add reactions and order them like any rule.
- **Walkthrough helpers** in `@loominate-if/testing`:
  - `game.menu(thing)` lists a thing's menu, with why entries are disabled.
  - `game.act(label)` takes an action from any menu the player could open, as a move. A disabled one fails the test with its reason.
  - `game.compass` gives the compass widget's ways, so testing depends on presentation, not on the world model.

## Consequences

- Topics and conversation reactions, as in adv3Lite's `GiveTopic` and `ShowTopic`, are Phase 3. They can be rules in these same rulebooks.

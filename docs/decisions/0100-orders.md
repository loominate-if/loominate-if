# 0100. Orders as actions

- **Status:** Accepted, 2026-11-24
- **Issue:** [#123](https://github.com/loominate-if/loominate-if/issues/123)
- **Design:** [Companions](../DESIGN.md#companions), [ADR 0081](0081-npc-actions.md), [ADR 0098](0098-companions.md)

## Context

"Ask Mira to wait here" or "Ask Tom to pick the lock" should go through verify and check, so companions can refuse, and their own skills and inventory are used. Giving and taking items between characters are ordinary actions. A refusal's reason must be shown.

## Decision

- **`order(action)`** makes an order: an action the player takes, named `order:` and the action's name, whose things are `who` and the action's own.
  - It's offered when the NPC is here, and the action's verify as the NPC lets it. Core gains an internal `_statusAs(call, as)` for checking as another actor.
  - None of its things need be in the player's reach, since the NPC does the reaching.
  - It takes a minute.
- **Asking** records the player's line, tagged `topic` and `player`, then the NPC answers. The first of these applies:
  - **they refuse:** a rule in the `obeying` rulebook gives a refusal, which is said as theirs. Its default rule refuses for NPCs who aren't companions.
  - **they can't:** the action's verify or check as them fails: "Tom can't: …".
  - **they do it:** they perform the action with `actAs`, narrated by its `seen`.
- **Standard orders:**
  - "Ask Mira to wait here" and "Ask Mira to come along", on a companion's menu, order the NPC actions `stay` and `comeAlong`.
  - "Ask Mira for the key", on the menu of a thing someone here carries, orders them to `give` it to the player, so `giving` rules apply.

## Consequences

- An action's messages are written for whoever takes it, so "Tom can't: Not without a lockpick." reads as the NPC's reason when the action's own check is phrased neutrally.
- The parser can take orders by their verbs, as "tom, pick the lock", when it comes.
